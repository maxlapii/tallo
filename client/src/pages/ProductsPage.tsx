import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { CategoriesApi, PrintersApi, ProductsApi } from '../api/endpoints';
import type { Category, Printer, Product, ProductInput } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { ProductImage } from '../components/ProductImage';
import { Badge, EmptyState, ErrorBlock, LoadingBlock } from '../components/ui';
import { money } from '../utils/format';

interface FormState {
  sku: string;
  barcode: string;
  name: string;
  imageUrl: string;
  categoryId: string;
  printerId: string;
  costPrice: string;
  price: string;
  taxRate: string;
  stockQty: string;
  lowStockThreshold: string;
  active: boolean;
}

const emptyForm: FormState = {
  sku: '',
  barcode: '',
  name: '',
  imageUrl: '',
  categoryId: '',
  printerId: '',
  costPrice: '',
  price: '',
  taxRate: '0',
  stockQty: '0',
  lowStockThreshold: '0',
  active: true,
};

function toForm(p: Product): FormState {
  return {
    sku: p.sku,
    barcode: p.barcode ?? '',
    name: p.name,
    imageUrl: p.imageUrl ?? '',
    categoryId: p.categoryId ? String(p.categoryId) : '',
    printerId: p.printerId ? String(p.printerId) : '',
    costPrice: String(p.costPrice),
    price: String(p.price),
    taxRate: String(p.taxRate),
    stockQty: String(p.stockQty),
    lowStockThreshold: String(p.lowStockThreshold),
    active: p.active,
  };
}

export function ProductsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = user?.role === 'ADMIN';
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Product | null | 'new'>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [catModal, setCatModal] = useState(false);
  const [catName, setCatName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, c, pr] = await Promise.all([
        ProductsApi.list({
          q: search || undefined,
          active: showInactive ? undefined : true,
          limit: 500,
        }),
        CategoriesApi.list(true),
        PrintersApi.list(),
      ]);
      setPrinters(pr.printers);
      setProducts(p.products);
      setCategories(c.categories);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [search, showInactive]);

  useEffect(() => {
    void load();
  }, [load]);

  function openNew() {
    setForm(emptyForm);
    setFieldErrors({});
    setFormError(null);
    setEditing('new');
  }

  function openEdit(p: Product) {
    setForm(toForm(p));
    setFieldErrors({});
    setFormError(null);
    setEditing(p);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    setFieldErrors({});
    const body: ProductInput = {
      sku: form.sku.trim(),
      barcode: form.barcode.trim() || null,
      name: form.name.trim(),
      imageUrl: form.imageUrl.trim() || null,
      printerId: form.printerId ? Number(form.printerId) : null,
      categoryId: form.categoryId ? Number(form.categoryId) : null,
      costPrice: Number(form.costPrice || 0),
      price: Number(form.price),
      taxRate: Number(form.taxRate || 0),
      lowStockThreshold: Number(form.lowStockThreshold || 0),
      active: form.active,
    };
    try {
      if (editing === 'new') {
        await ProductsApi.create({ ...body, stockQty: Number(form.stockQty || 0) });
        toast.success('Product created');
      } else if (editing) {
        await ProductsApi.update(editing.id, body);
        toast.success('Product updated');
      }
      setEditing(null);
      void load();
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(err.message);
        if (err.details && typeof err.details === 'object')
          setFieldErrors(err.details as Record<string, string[]>);
      } else setFormError('Could not save product');
    } finally {
      setSaving(false);
    }
  }

  async function remove(p: Product) {
    if (!window.confirm(`Delete "${p.name}"? Products with sales history are deactivated instead.`))
      return;
    try {
      const r = await ProductsApi.remove(p.id);
      toast.success(r.deleted ? 'Product deleted' : 'Product deactivated (it has history)');
      void load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function addCategory(e: FormEvent) {
    e.preventDefault();
    try {
      await CategoriesApi.create({ name: catName.trim() });
      setCatName('');
      toast.success('Category created');
      void load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function setCategoryPrinter(c: Category, printerId: number | null) {
    try {
      await CategoriesApi.update(c.id, { printerId });
      toast.success(`${c.name} routed`);
      void load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function toggleCategory(c: Category) {
    try {
      await CategoriesApi.update(c.id, { active: !c.active });
      void load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const field = (key: keyof FormState, label: string, props: Record<string, unknown> = {}) => (
    <div className="field">
      <label htmlFor={`f-${key}`}>{label}</label>
      <input
        id={`f-${key}`}
        className={fieldErrors[key] ? 'input error' : 'input'}
        value={String(form[key])}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        data-testid={`product-${key}`}
        {...props}
      />
      {fieldErrors[key] && <span className="field-error">{fieldErrors[key]![0]}</span>}
    </div>
  );

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Products</h1>
          <p className="sub">{products.length} products in the catalogue</p>
        </div>
        <div className="page-actions">
          <form
            className="input-with-icon"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(q.trim());
            }}
            style={{ width: 300 }}
          >
            <Icon name="search" className="icon" />
            <input
              className="input"
              placeholder="Search name, SKU, barcode…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              data-testid="product-search"
              aria-label="Search products"
            />
          </form>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />{' '}
            Show inactive
          </label>
          {isAdmin && (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setCatModal(true)}>
                <Icon name="tag" size={16} /> Categories
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={openNew}
                data-testid="new-product"
              >
                <Icon name="plus" size={16} /> New product
              </button>
            </>
          )}
        </div>
      </div>

      {error && <ErrorBlock message={error} onRetry={() => void load()} />}
      <div className="card">
        {loading ? (
          <LoadingBlock />
        ) : products.length === 0 ? (
          <EmptyState
            title="No products found"
            hint={search ? 'Try another search term.' : 'Create your first product to get started.'}
          />
        ) : (
          <div className="table-wrap">
            <table className="table stack" data-testid="products-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU</th>
                  <th>Barcode</th>
                  <th>Category</th>
                  <th className="num">Cost</th>
                  <th className="num">Price</th>
                  <th className="num">Tax</th>
                  <th className="num">Stock</th>
                  <th>Status</th>
                  {isAdmin && <th />}
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id} data-testid={`product-row-${p.sku}`}>
                    <td className="strong primary">
                      <span className="cell-with-thumb">
                        <ProductImage
                          className="thumb-sm"
                          src={p.imageUrl}
                          name={p.name}
                          categoryName={p.categoryName}
                        />
                        {p.name}
                      </span>
                    </td>
                    <td className="mono" data-label="SKU">
                      {p.sku}
                    </td>
                    <td className="mono muted" data-label="Barcode">
                      {p.barcode ?? '—'}
                    </td>
                    <td data-label="Category">
                      {p.categoryName ?? <span className="muted">—</span>}
                    </td>
                    <td className="num muted" data-label="Cost">
                      {money(p.costPrice)}
                    </td>
                    <td className="num strong" data-label="Price">
                      {money(p.price)}
                    </td>
                    <td className="num" data-label="Tax">
                      {p.taxRate}%
                    </td>
                    <td className="num" data-label="Stock">
                      {p.stockQty} {p.lowStock && <Badge tone="warning">Low</Badge>}
                    </td>
                    <td data-label="Status">
                      {p.active ? (
                        <Badge tone="success">Active</Badge>
                      ) : (
                        <Badge tone="dark">Inactive</Badge>
                      )}
                    </td>
                    {isAdmin && (
                      <td className="actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon btn-sm"
                          onClick={() => openEdit(p)}
                          aria-label={`Edit ${p.name}`}
                        >
                          <Icon name="edit" size={16} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon btn-sm"
                          onClick={() => void remove(p)}
                          aria-label={`Delete ${p.name}`}
                        >
                          <Icon name="trash" size={16} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={editing !== null}
        title={editing === 'new' ? 'New product' : 'Edit product'}
        onClose={() => setEditing(null)}
        wide
        testId="product-modal"
      >
        <form onSubmit={save} className="form-grid">
          {field('name', 'Name', { required: true, autoFocus: true })}
          <div className="field">
            <label htmlFor="f-categoryId">Category</label>
            <select
              id="f-categoryId"
              className="select"
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            >
              <option value="">Uncategorised</option>
              {categories
                .filter((c) => c.active)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-printerId">Print area</label>
            <select
              id="f-printerId"
              className="select"
              value={form.printerId}
              onChange={(e) => setForm({ ...form, printerId: e.target.value })}
              data-testid="product-printerId"
            >
              <option value="">Use category's printer</option>
              {printers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.area}
                </option>
              ))}
            </select>
          </div>
          {field('sku', 'SKU', { required: true })}
          {field('barcode', 'Barcode')}
          <div className="field full">
            <label htmlFor="f-imageUrl">Image URL</label>
            <div className="image-field">
              <ProductImage
                className="thumb-lg"
                src={form.imageUrl.trim() || null}
                name={form.name || 'Product'}
                categoryName={
                  categories.find((c) => String(c.id) === form.categoryId)?.name ?? null
                }
              />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input
                  id="f-imageUrl"
                  className={fieldErrors.imageUrl ? 'input error' : 'input'}
                  placeholder="https://…/photo.jpg"
                  value={form.imageUrl}
                  onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
                  data-testid="product-imageUrl"
                />
                <span className="small muted">
                  Paste a link to a product photo. Square or 4:3 images look best.
                </span>
                {fieldErrors.imageUrl && (
                  <span className="field-error">{fieldErrors.imageUrl[0]}</span>
                )}
              </div>
            </div>
          </div>
          {field('price', 'Selling price', { required: true, inputMode: 'decimal' })}
          {field('costPrice', 'Cost price', { inputMode: 'decimal' })}
          {field('taxRate', 'Tax rate (%)', { inputMode: 'decimal' })}
          {field('lowStockThreshold', 'Low-stock threshold', { inputMode: 'numeric' })}
          {editing === 'new' ? (
            field('stockQty', 'Initial stock', { inputMode: 'numeric' })
          ) : (
            <div className="field">
              <label>Stock</label>
              <div className="muted small" style={{ paddingTop: 10 }}>
                Adjust stock from the Stock page so every change is recorded.
              </div>
            </div>
          )}
          <label className="checkbox full">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />{' '}
            Active (available for sale)
          </label>
          {formError && (
            <div className="alert alert-error full" role="alert">
              <Icon name="alert" /> {formError}
            </div>
          )}
          <div className="form-actions full">
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving}
              data-testid="save-product"
            >
              {saving ? 'Saving…' : 'Save product'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={catModal} title="Categories" onClose={() => setCatModal(false)}>
        <form onSubmit={addCategory} style={{ display: 'flex', gap: 8 }}>
          <input
            className="input"
            placeholder="New category name"
            value={catName}
            onChange={(e) => setCatName(e.target.value)}
            required
          />
          <button type="submit" className="btn btn-primary">
            Add
          </button>
        </form>
        <table className="table">
          <tbody>
            {categories.map((c) => (
              <tr key={c.id}>
                <td className="strong">{c.name}</td>
                <td className="muted">{c.productCount} products</td>
                <td>
                  <select
                    className="select"
                    style={{ height: 32 }}
                    value={c.printerId ?? ''}
                    onChange={(e) =>
                      void setCategoryPrinter(c, e.target.value ? Number(e.target.value) : null)
                    }
                    aria-label={`Print area for ${c.name}`}
                    data-testid={`category-printer-${c.id}`}
                  >
                    <option value="">No print area</option>
                    {printers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.area}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={() => void toggleCategory(c)}
                  >
                    {c.active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Modal>
    </>
  );
}
