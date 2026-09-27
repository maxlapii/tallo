import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { InventoryApi } from '../api/endpoints';
import type { InventoryMovement, Product } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icon';
import { useLiveEvents, type LiveEvent } from '../realtime/RealtimeContext';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { Badge, EmptyState, ErrorBlock, LoadingBlock, StatTile } from '../components/ui';
import { formatDateTime } from '../utils/format';

type AdjustType = 'PURCHASE' | 'RETURN' | 'DAMAGE' | 'ADJUSTMENT';

export function InventoryPage() {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = user?.role === 'ADMIN';
  const [products, setProducts] = useState<Product[]>([]);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onlyLow, setOnlyLow] = useState(false);
  const [q, setQ] = useState('');
  const [adjusting, setAdjusting] = useState<Product | null>(null);
  const [type, setType] = useState<AdjustType>('ADJUSTMENT');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [inv, mv] = await Promise.all([
        InventoryApi.list({ q: q || undefined, lowStock: onlyLow || undefined, limit: 500 }),
        InventoryApi.movements({ limit: 50 }),
      ]);
      setProducts(inv.products);
      setLowStockCount(inv.lowStockCount);
      setMovements(mv.movements);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [q, onlyLow]);

  useEffect(() => {
    void load();
  }, [load]);

  const onLive = useCallback(
    (e: LiveEvent) => {
      if (e.type === 'stock.changed') void load();
    },
    [load],
  );
  useLiveEvents(onLive);

  function openAdjust(p: Product) {
    setAdjusting(p);
    setType('ADJUSTMENT');
    setQty('');
    setNote('');
    setFormError(null);
  }

  async function submitAdjust(e: FormEvent) {
    e.preventDefault();
    if (!adjusting) return;
    const n = Math.trunc(Number(qty));
    if (!Number.isFinite(n) || n === 0) {
      setFormError('Enter a non-zero whole number. Use a negative number to remove stock.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const { movement } = await InventoryApi.adjust({
        productId: adjusting.id,
        type,
        quantity: n,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      toast.success(`${adjusting.name}: stock is now ${movement.stockAfter}`);
      setAdjusting(null);
      void load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Adjustment failed');
    } finally {
      setSaving(false);
    }
  }

  const totalUnits = products.reduce((a, p) => a + p.stockQty, 0);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Stock</h1>
          <p className="sub">Every stock change is recorded as a movement.</p>
        </div>
        <div className="page-actions">
          <div className="input-with-icon" style={{ width: 280 }}>
            <Icon name="search" className="icon" />
            <input
              className="input"
              placeholder="Search products…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search stock"
            />
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={onlyLow}
              onChange={(e) => setOnlyLow(e.target.checked)}
            />{' '}
            Low stock only
          </label>
        </div>
      </div>

      <div className="grid grid-3">
        <StatTile label="Products" value={products.length} icon="box" />
        <StatTile label="Units on hand" value={totalUnits} icon="layers" tone="info" />
        <StatTile
          label="Low stock"
          value={lowStockCount}
          icon="alert"
          tone={lowStockCount > 0 ? 'warn' : 'default'}
          testId="stat-low-stock"
        />
      </div>

      {error && <ErrorBlock message={error} onRetry={() => void load()} />}
      <div className="grid-main-side wide">
        <section className="card">
          <div className="card-header">
            <h2>Stock levels</h2>
          </div>
          <div className="card-body table-wrap" style={{ paddingTop: 12 }}>
            {loading ? (
              <LoadingBlock />
            ) : products.length === 0 ? (
              <EmptyState title="No products" />
            ) : (
              <table className="table stack" data-testid="inventory-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>SKU</th>
                    <th className="num">Stock</th>
                    <th className="num">Threshold</th>
                    <th>Status</th>
                    {isAdmin && <th />}
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id} data-testid={`stock-row-${p.sku}`}>
                      <td className="strong primary">{p.name}</td>
                      <td className="mono muted" data-label="SKU">
                        {p.sku}
                      </td>
                      <td className="num strong" data-label="Stock" data-testid={`stock-${p.sku}`}>
                        {p.stockQty}
                      </td>
                      <td className="num muted" data-label="Threshold">
                        {p.lowStockThreshold}
                      </td>
                      <td data-label="Status">
                        {p.stockQty === 0 ? (
                          <Badge tone="danger">Out</Badge>
                        ) : p.lowStock ? (
                          <Badge tone="warning">Low</Badge>
                        ) : (
                          <Badge tone="success">OK</Badge>
                        )}
                      </td>
                      {isAdmin && (
                        <td className="actions">
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            onClick={() => openAdjust(p)}
                            data-testid={`adjust-${p.sku}`}
                          >
                            Adjust
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h2>Recent movements</h2>
          </div>
          <div className="card-body table-wrap" style={{ paddingTop: 12 }}>
            {movements.length === 0 ? (
              <EmptyState title="No movements yet" />
            ) : (
              <table className="table stack" data-testid="movements-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>When</th>
                    <th>Type</th>
                    <th className="num">Qty</th>
                    <th className="num">After</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m) => (
                    <tr key={m.id}>
                      <td className="primary">{m.productName}</td>
                      <td className="muted small" data-label="When">
                        {formatDateTime(m.createdAt)}
                      </td>
                      <td data-label="Type">
                        <Badge tone={m.quantity > 0 ? 'success' : 'danger'}>{m.type}</Badge>
                      </td>
                      <td className="num strong" data-label="Qty">
                        {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                      </td>
                      <td className="num" data-label="After">
                        {m.stockAfter}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      <Modal
        open={adjusting !== null}
        title={`Adjust stock: ${adjusting?.name ?? ''}`}
        onClose={() => setAdjusting(null)}
        testId="adjust-modal"
      >
        <form onSubmit={submitAdjust} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="alert alert-info">
            <Icon name="info" /> Current stock: <strong>{adjusting?.stockQty}</strong>
          </div>
          <div className="field">
            <label htmlFor="adj-type">Reason</label>
            <select
              id="adj-type"
              className="select"
              value={type}
              onChange={(e) => setType(e.target.value as AdjustType)}
              data-testid="adjust-type"
            >
              <option value="PURCHASE">Purchase / stock received (+)</option>
              <option value="RETURN">Customer return (+)</option>
              <option value="DAMAGE">Damage / write-off (−)</option>
              <option value="ADJUSTMENT">Stock count adjustment (±)</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="adj-qty">Quantity change</label>
            <input
              id="adj-qty"
              className="input input-lg mono"
              inputMode="numeric"
              placeholder="e.g. 10 or -3"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              autoFocus
              data-testid="adjust-qty"
            />
            <span className="small muted">Positive adds stock, negative removes it.</span>
          </div>
          <div className="field">
            <label htmlFor="adj-note">Note</label>
            <input
              id="adj-note"
              className="input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional"
            />
          </div>
          {formError && (
            <div className="alert alert-error" role="alert">
              <Icon name="alert" /> {formError}
            </div>
          )}
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setAdjusting(null)}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving}
              data-testid="adjust-submit"
            >
              {saving ? 'Saving…' : 'Apply adjustment'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
