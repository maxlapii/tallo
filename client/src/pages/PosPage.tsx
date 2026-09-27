import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  addToCart,
  cartTotals,
  removeFromCart,
  setCartQuantity,
  type CartItem,
  type PaymentMethod,
} from '@tallo/shared';
import { ApiError } from '../api/client';
import { CategoriesApi, ProductsApi, RegistersApi, SalesApi } from '../api/endpoints';
import type { Category, Product, Receipt, SellStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useLiveEvents, type LiveEvent } from '../realtime/RealtimeContext';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { EmptyState, ErrorBlock, LoadingBlock } from '../components/ui';
import { ProductImage } from '../components/ProductImage';
import {
  useCustomerDisplayPublisher,
  useFullscreen,
  type DisplayState,
} from '../pos/customerDisplay';
import { PaymentModal } from '../pos/PaymentModal';
import { ReceiptView } from '../pos/ReceiptView';
import { money, parseMoneyInput } from '../utils/format';

const CATEGORY_ICON: Record<string, string> = {
  Beverages: 'coffee',
  Food: 'food',
  Snacks: 'snack',
};

export function PosPage() {
  const toast = useToast();
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [status, setStatus] = useState<SellStatus | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [paying, setPaying] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [orderOpen, setOrderOpen] = useState(false);
  const [paidState, setPaidState] = useState<Extract<DisplayState, { mode: 'paid' }> | null>(null);
  const { active: fullscreen, toggle: toggleFullscreen } = useFullscreen();
  const isStaff = user?.role === 'ADMIN' || user?.role === 'CASHIER';
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, c, r] = await Promise.all([
        ProductsApi.list({ active: true, limit: 500 }),
        CategoriesApi.list(),
        RegistersApi.status(),
      ]);
      setProducts(p.products);
      setCategories(c.categories);
      setStatus(r.status);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Lock page scroll while the mobile order sheet is open.
  useEffect(() => {
    document.body.classList.toggle('sheet-open', orderOpen);
    return () => document.body.classList.remove('sheet-open');
  }, [orderOpen]);

  const onLive = useCallback((e: LiveEvent) => {
    if (e.type === 'stock.changed') {
      const map = new Map(e.payload.products.map((x) => [x.productId, x.stockQty]));
      setProducts((ps) =>
        ps.map((p) =>
          map.has(p.id)
            ? { ...p, stockQty: map.get(p.id)!, lowStock: map.get(p.id)! <= p.lowStockThreshold }
            : p,
        ),
      );
      setCart((c) =>
        c.map((i) => (map.has(i.productId) ? { ...i, stockQty: map.get(i.productId)! } : i)),
      );
    } else if (e.type === 'register.changed') {
      RegistersApi.status()
        .then((r) => setStatus(r.status))
        .catch(() => undefined);
    }
  }, []);
  useLiveEvents(onLive);

  const discountCents = Math.round((parseMoneyInput(discount) ?? 0) * 100);
  const totals = useMemo(() => {
    try {
      return { ok: true as const, t: cartTotals(cart, discountCents) };
    } catch (e) {
      return { ok: false as const, message: (e as Error).message, t: cartTotals(cart, 0) };
    }
  }, [cart, discountCents]);

  const displayState = useMemo<DisplayState>(() => {
    if (paidState) return paidState;
    if (cart.length === 0) return { mode: 'idle', storeName: 'Tallo' };
    return {
      mode: 'order',
      storeName: 'Tallo',
      lines: cart.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        unitPrice: i.unitPriceCents / 100,
        lineTotal: (i.unitPriceCents * i.quantity) / 100,
        imageUrl: i.imageUrl ?? null,
      })),
      subtotal: totals.t.subtotalCents / 100,
      discount: totals.t.discountCents / 100,
      tax: totals.t.taxCents / 100,
      total: totals.t.totalCents / 100,
      customerName: customerName.trim() || null,
    };
  }, [cart, totals, customerName, paidState]);
  const display = useCustomerDisplayPublisher(displayState);

  // Any new cart activity ends the "paid" screen on the customer display.
  useEffect(() => {
    if (cart.length > 0) setPaidState(null);
  }, [cart.length]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (categoryId !== null && p.categoryId !== categoryId) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode ?? '').toLowerCase().includes(q)
      );
    });
  }, [products, query, categoryId]);

  const countByCategory = useMemo(() => {
    const m = new Map<number | null, number>();
    for (const p of products) m.set(p.categoryId, (m.get(p.categoryId) ?? 0) + 1);
    return m;
  }, [products]);

  const inCart = (id: number) => cart.find((i) => i.productId === id)?.quantity ?? 0;

  function add(p: Product, qty = 1) {
    const current = inCart(p.id);
    if (current + qty > p.stockQty) {
      toast.error(`Only ${p.stockQty} × ${p.name} in stock`);
      return;
    }
    setCart((c) =>
      addToCart(
        c,
        {
          productId: p.id,
          name: p.name,
          sku: p.sku,
          unitPriceCents: Math.round(p.price * 100),
          taxRateBp: Math.round(p.taxRate * 100),
          stockQty: p.stockQty,
          categoryName: p.categoryName,
          imageUrl: p.imageUrl,
        },
        qty,
      ),
    );
  }

  function setQty(productId: number, qty: number) {
    const p = products.find((x) => x.id === productId);
    if (p && qty > p.stockQty) {
      toast.error(`Only ${p.stockQty} × ${p.name} in stock`);
      qty = p.stockQty;
    }
    setCart((c) => setCartQuantity(c, productId, qty));
  }

  /** Enter in the search box = barcode scan: exact lookup, add, clear. */
  async function handleScan(e: FormEvent) {
    e.preventDefault();
    const code = query.trim();
    if (!code) return;
    const local = products.find(
      (p) => p.barcode === code || p.sku.toLowerCase() === code.toLowerCase(),
    );
    if (local) {
      add(local);
      setQuery('');
      return;
    }
    try {
      const { product } = await ProductsApi.lookup(code);
      if (!product.active) {
        toast.error(`${product.name} is inactive`);
        return;
      }
      add(product);
      setQuery('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        if (visible.length === 1) {
          add(visible[0]!);
          setQuery('');
        } else {
          toast.error(`No product found for "${code}"`);
        }
      } else {
        toast.error((err as Error).message);
      }
    }
  }

  async function confirmPayment(
    payments: { method: PaymentMethod; amount: number; referenceNo?: string }[],
  ) {
    setSubmitting(true);
    setPayError(null);
    try {
      const { sale } = await SalesApi.checkout({
        items: cart.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        discount: discountCents / 100,
        payments,
        ...(customerName.trim() ? { customerName: customerName.trim() } : {}),
      });
      const { receipt: r } = await SalesApi.receipt(sale.id);
      setPaying(false);
      setReceipt(r);
      setPaidState({
        mode: 'paid',
        storeName: r.storeName,
        receiptNo: r.receiptNo,
        total: r.total,
        received: r.received,
        change: r.change,
        methods: r.payments.map((p) => p.method),
      });
      setCart([]);
      setDiscount('');
      setCustomerName('');
      toast.success(`Sale #${sale.receiptNo} completed`);
      void load();
    } catch (err) {
      setPayError(err instanceof ApiError ? err.message : 'Payment failed. Please try again.');
      if (
        err instanceof ApiError &&
        (err.code === 'INSUFFICIENT_STOCK' || err.code === 'REGISTER_NOT_OPEN')
      )
        void load();
    } finally {
      setSubmitting(false);
    }
  }

  function closeReceipt() {
    setReceipt(null);
    setPaidState(null);
    searchRef.current?.focus();
  }

  if (loading && status === undefined) return <LoadingBlock label="Loading catalogue…" />;

  return (
    <div className="pos-layout">
      <div className="pos-catalog">
        {error && <ErrorBlock message={error} onRetry={() => void load()} />}
        {status && !status.canSell && (
          <div className="alert alert-warning" role="alert" data-testid="register-closed-banner">
            <Icon name="lock" />
            <div style={{ flex: 1 }}>{status.reason}</div>
            {user?.role !== 'SALE' && (
              <Link to="/shift" className="btn btn-sm btn-dark">
                Open Shift
              </Link>
            )}
          </div>
        )}

        <div
          className="card card-pad"
          style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
        >
          <div className="pos-toolbar">
            <div className="pos-toolbar-left">
              <h2>Categories</h2>
              <div className="pos-modes">
                <button
                  type="button"
                  className={fullscreen ? 'btn btn-sm btn-dark' : 'btn btn-sm btn-secondary'}
                  onClick={() => void toggleFullscreen()}
                  data-testid="fullscreen-toggle"
                  title={fullscreen ? 'Exit full screen' : 'Full screen'}
                  aria-pressed={fullscreen}
                >
                  <Icon name={fullscreen ? 'collapse' : 'expand'} size={14} />{' '}
                  {fullscreen ? 'Exit' : 'Full screen'}
                </button>
                {isStaff && (
                  <button
                    type="button"
                    className={
                      display.connected ? 'btn btn-sm btn-dark' : 'btn btn-sm btn-secondary'
                    }
                    onClick={() => void display.openDisplay()}
                    data-testid="customer-display-toggle"
                    title="Open the customer-facing screen in a second window (drag it to the other monitor)"
                  >
                    <Icon name="monitor" size={14} />{' '}
                    {display.connected ? 'Customer display on' : 'Customer display'}
                    {display.connected && <span className="dot-live" />}
                  </button>
                )}
              </div>
            </div>
            <form className="input-with-icon pos-search" onSubmit={handleScan}>
              <Icon name="scan" className="icon" />
              <input
                ref={searchRef}
                className="input"
                placeholder="Scan barcode or search name / SKU…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
                data-testid="pos-search"
                aria-label="Search products"
              />
            </form>
          </div>
          <div className="chip-row" role="tablist">
            <button
              type="button"
              className={categoryId === null ? 'chip active' : 'chip'}
              onClick={() => setCategoryId(null)}
              role="tab"
              aria-selected={categoryId === null}
            >
              <span className="chip-icon">
                <Icon name="grid" />
              </span>
              <span>
                <span className="chip-label">All items</span>
                <div className="chip-count">{products.length} items</div>
              </span>
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                className={categoryId === c.id ? 'chip active' : 'chip'}
                onClick={() => setCategoryId(c.id)}
                role="tab"
                aria-selected={categoryId === c.id}
                data-testid={`category-${c.id}`}
              >
                <span className="chip-icon">
                  <Icon name={CATEGORY_ICON[c.name] ?? 'tag'} />
                </span>
                <span>
                  <span className="chip-label">{c.name}</span>
                  <div className="chip-count">{countByCategory.get(c.id) ?? 0} items</div>
                </span>
              </button>
            ))}
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="card">
            <EmptyState
              icon="search"
              title="No products match"
              hint="Try a different search or category."
            />
          </div>
        ) : (
          <div className="product-grid" data-testid="product-grid">
            {visible.map((p) => {
              const qty = inCart(p.id);
              const out = p.stockQty === 0;
              return (
                <div
                  key={p.id}
                  className={
                    out
                      ? 'product-card disabled'
                      : qty > 0
                        ? 'product-card in-cart'
                        : 'product-card'
                  }
                  role="button"
                  tabIndex={0}
                  onClick={() => !out && add(p)}
                  onKeyDown={(e) => e.key === 'Enter' && !out && add(p)}
                  data-testid={`product-card-${p.sku}`}
                >
                  <div className="product-thumb">
                    <ProductImage
                      src={p.imageUrl}
                      name={p.name}
                      categoryName={p.categoryName}
                      eager
                    />
                    <span
                      className={
                        out ? 'stock-pill out' : p.lowStock ? 'stock-pill low' : 'stock-pill'
                      }
                    >
                      {out ? 'Out of stock' : p.lowStock ? `Low · ${p.stockQty}` : 'Available'}
                    </span>
                  </div>
                  <div>
                    <div className="p-name truncate">{p.name}</div>
                    <div className="p-meta">
                      <span>{p.categoryName ?? 'Uncategorised'}</span>
                      <span>•</span>
                      <span>{p.sku}</span>
                    </div>
                  </div>
                  <div className="p-footer">
                    <span className="p-price">{money(p.price)}</span>
                    {qty === 0 ? (
                      <button
                        type="button"
                        className="btn btn-add"
                        disabled={out}
                        onClick={(e) => {
                          e.stopPropagation();
                          add(p);
                        }}
                        aria-label={`Add one ${p.name}`}
                        data-testid={`add-${p.sku}`}
                      >
                        Add
                      </button>
                    ) : (
                      <div className="stepper" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="minus"
                          onClick={() => setQty(p.id, qty - 1)}
                          aria-label={`Remove one ${p.name}`}
                        >
                          <Icon name="minus" size={14} />
                        </button>
                        <span className="qty" data-testid={`qty-${p.sku}`}>
                          {qty}
                        </span>
                        <button
                          type="button"
                          className="plus"
                          onClick={() => add(p)}
                          aria-label={`Add one ${p.name}`}
                          data-testid={`add-${p.sku}`}
                        >
                          <Icon name="plus" size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <aside
        className={orderOpen ? 'card order-panel open' : 'card order-panel'}
        data-testid="order-panel"
      >
        <div className="sheet-handle" aria-hidden="true" />
        <div className="card-header" style={{ paddingBottom: 10 }}>
          <div>
            <h2>Current order</h2>
            <div className="small muted">{totals.t.itemCount} items</div>
          </div>
          {cart.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setCart([])}
              data-testid="clear-cart"
            >
              <Icon name="trash" size={14} /> Clear
            </button>
          )}
        </div>
        <div style={{ padding: '0 16px 10px' }}>
          <input
            className="input"
            placeholder="Customer name (optional)"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            aria-label="Customer name"
          />
        </div>
        <div className="order-items">
          {cart.length === 0 ? (
            <EmptyState
              icon="cart"
              title="Cart is empty"
              hint="Scan a barcode or tap a product to add it."
            />
          ) : (
            cart.map((item) => (
              <div
                key={item.productId}
                className="order-item"
                data-testid={`cart-item-${item.sku}`}
              >
                <ProductImage
                  className="thumb"
                  src={item.imageUrl}
                  name={item.name}
                  categoryName={item.categoryName}
                />
                <div className="info">
                  <div className="name truncate">{item.name}</div>
                  <div className="price">{money(item.unitPriceCents / 100)} each</div>
                  <div className="stepper">
                    <button
                      type="button"
                      className="minus"
                      onClick={() => setQty(item.productId, item.quantity - 1)}
                      aria-label="Decrease quantity"
                    >
                      <Icon name="minus" size={12} />
                    </button>
                    <input
                      className="qty"
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(e) =>
                        setQty(item.productId, Math.max(0, Math.floor(Number(e.target.value) || 0)))
                      }
                      aria-label={`Quantity of ${item.name}`}
                      data-testid={`cart-qty-${item.sku}`}
                    />
                    <button
                      type="button"
                      className="plus"
                      onClick={() => setQty(item.productId, item.quantity + 1)}
                      aria-label="Increase quantity"
                    >
                      <Icon name="plus" size={12} />
                    </button>
                  </div>
                </div>
                <div className="right">
                  <span className="line-total">
                    {money((item.unitPriceCents * item.quantity) / 100)}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon btn-sm"
                    onClick={() => setCart((c) => removeFromCart(c, item.productId))}
                    aria-label={`Remove ${item.name}`}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="order-summary">
          <div className="summary-row">
            <span>Subtotal</span>
            <span className="val" data-testid="cart-subtotal">
              {money(totals.t.subtotalCents / 100)}
            </span>
          </div>
          <div className="summary-row">
            <span>Discount</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="muted">$</span>
              <input
                className={
                  totals.ok ? 'input discount-input mono' : 'input discount-input mono error'
                }
                inputMode="decimal"
                placeholder="0.00"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                aria-label="Discount amount"
                data-testid="cart-discount"
              />
            </span>
          </div>
          {!totals.ok && (
            <div className="small" style={{ color: 'var(--danger)', textAlign: 'right' }}>
              {totals.message}
            </div>
          )}
          <div className="summary-row">
            <span>Tax</span>
            <span className="val" data-testid="cart-tax">
              {money(totals.t.taxCents / 100)}
            </span>
          </div>
          <div className="summary-row total">
            <span>Total</span>
            <span className="val" data-testid="cart-total">
              {money(totals.t.totalCents / 100)}
            </span>
          </div>
          <div className="method-tiles" role="radiogroup" aria-label="Payment method">
            {(
              [
                { id: 'CASH', label: 'Cash', icon: 'cash' },
                { id: 'CARD', label: 'Card', icon: 'card' },
                { id: 'QR', label: 'QR', icon: 'qr' },
              ] as { id: PaymentMethod; label: string; icon: string }[]
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={method === m.id}
                className={method === m.id ? 'method-tile active' : 'method-tile'}
                onClick={() => setMethod(m.id)}
                data-testid={`method-${m.id.toLowerCase()}`}
              >
                <Icon name={m.icon} size={18} />
                {m.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-checkout btn-lg btn-block"
            disabled={cart.length === 0 || !totals.ok || !status?.canSell}
            onClick={() => {
              setPayError(null);
              setOrderOpen(false);
              setPaying(true);
            }}
            data-testid="checkout-button"
          >
            <Icon name="wallet" />{' '}
            {status?.canSell
              ? 'Checkout'
              : user?.role === 'SALE'
                ? 'Waiting for shift'
                : 'Open Shift to pay'}
          </button>
        </div>
      </aside>

      {orderOpen && <div className="order-backdrop" onClick={() => setOrderOpen(false)} />}
      <div className="order-bar" data-testid="order-bar">
        <div>
          <div className="ob-total">{money(totals.t.totalCents / 100)}</div>
          <div className="ob-items">{totals.t.itemCount} items in order</div>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setOrderOpen((o) => !o)}
          aria-expanded={orderOpen}
        >
          {orderOpen ? 'Hide order' : 'View order'}
        </button>
      </div>

      <PaymentModal
        open={paying}
        total={totals.t.totalCents / 100}
        initialMethod={method}
        submitting={submitting}
        error={payError}
        onClose={() => !submitting && setPaying(false)}
        onConfirm={confirmPayment}
      />

      <Modal
        open={receipt !== null}
        title="Sale complete"
        onClose={closeReceipt}
        testId="receipt-modal"
      >
        {receipt && (
          <>
            <ReceiptView receipt={receipt} />
            <div className="form-actions">
              <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
                <Icon name="print" size={16} /> Print
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={closeReceipt}
                data-testid="new-sale"
              >
                New sale
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
