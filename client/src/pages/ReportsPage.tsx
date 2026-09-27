import { useCallback, useEffect, useState } from 'react';
import { ReportsApi } from '../api/endpoints';
import type { DailyReport, InventoryReport, PaymentReport, ProductReport } from '../api/types';
import { Icon } from '../components/Icon';
import { Badge, ErrorBlock, LoadingBlock, StatTile } from '../components/ui';
import { money, todayIso } from '../utils/format';

type Tab = 'daily' | 'payments' | 'products' | 'inventory';

export function ReportsPage() {
  const [tab, setTab] = useState<Tab>('daily');
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [range, setRange] = useState({ from: todayIso(), to: todayIso() });
  const [daily, setDaily] = useState<DailyReport | null>(null);
  const [payments, setPayments] = useState<PaymentReport | null>(null);
  const [products, setProducts] = useState<ProductReport | null>(null);
  const [inventory, setInventory] = useState<InventoryReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, p, pr, inv] = await Promise.all([
        ReportsApi.daily(range),
        ReportsApi.payments(range),
        ReportsApi.products(range),
        ReportsApi.inventory(),
      ]);
      setDaily(d.report);
      setPayments(p.report);
      setProducts(pr.report);
      setInventory(inv.report);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'daily', label: 'Daily sales', icon: 'trend' },
    { id: 'payments', label: 'Payments', icon: 'wallet' },
    { id: 'products', label: 'Products', icon: 'box' },
    { id: 'inventory', label: 'Inventory', icon: 'layers' },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Reports</h1>
          <p className="sub">Calculated live from sales, payments, refunds, and stock.</p>
        </div>
        <div className="page-actions filter-bar">
          <input
            type="date"
            className="input"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="From date"
            style={{ width: 160 }}
          />
          <span className="muted">to</span>
          <input
            type="date"
            className="input"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="To date"
            style={{ width: 160 }}
          />
          <button type="button" className="btn btn-primary" onClick={() => setRange({ from, to })}>
            <Icon name="refresh" size={16} /> Apply
          </button>
        </div>
      </div>

      <div className="segmented" role="tablist" style={{ alignSelf: 'flex-start' }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'active' : ''}
            onClick={() => setTab(t.id)}
            data-testid={`report-tab-${t.id}`}
          >
            <Icon name={t.icon} size={14} /> {t.label}
          </button>
        ))}
      </div>

      {error && <ErrorBlock message={error} onRetry={() => void load()} />}
      {loading ? (
        <LoadingBlock />
      ) : (
        <>
          {tab === 'daily' && daily && (
            <div data-testid="daily-report">
              <div className="grid grid-4">
                <StatTile
                  label="Transactions"
                  value={daily.transactions}
                  hint={`${daily.itemsSold} items sold`}
                  icon="receipt"
                  testId="report-transactions"
                />
                <StatTile
                  label="Gross sales"
                  value={money(daily.grossSales)}
                  hint={`Discounts ${money(daily.discounts)}`}
                  icon="trend"
                  tone="info"
                  testId="report-gross"
                />
                <StatTile label="Tax collected" value={money(daily.tax)} icon="tag" />
                <StatTile
                  label="Net sales"
                  value={money(daily.netSales)}
                  hint={`Avg. ${money(daily.averageSale)} per sale`}
                  icon="wallet"
                  testId="report-net"
                />
              </div>
              <div className="grid grid-3" style={{ marginTop: 16 }}>
                <StatTile
                  label="Refunds"
                  value={money(daily.refunds)}
                  hint={`${daily.refundCount} refunds`}
                  icon="undo"
                  tone="danger"
                  testId="report-refunds"
                />
                <StatTile
                  label="Net after refunds"
                  value={money(daily.netAfterRefunds)}
                  icon="check"
                />
                <StatTile
                  label="Period"
                  value={daily.from === daily.to ? daily.from : `${daily.from} → ${daily.to}`}
                  icon="history"
                />
              </div>
            </div>
          )}

          {tab === 'payments' && payments && (
            <section className="card">
              <div className="card-header">
                <h2>Payment summary</h2>
              </div>
              <div className="card-body table-wrap">
                <table className="table stack" data-testid="payments-report">
                  <thead>
                    <tr>
                      <th>Method</th>
                      <th className="num">Payments</th>
                      <th className="num">Received</th>
                      <th className="num">Refunded</th>
                      <th className="num">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.methods.map((m) => (
                      <tr key={m.method}>
                        <td className="primary">
                          <Badge>{m.method}</Badge>
                        </td>
                        <td className="num" data-label="Payments">
                          {m.count}
                        </td>
                        <td className="num" data-label="Received">
                          {money(m.amount)}
                        </td>
                        <td className="num muted" data-label="Refunded">
                          {money(m.refunded)}
                        </td>
                        <td className="num strong" data-label="Net">
                          {money(m.net)}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td className="strong primary">Total</td>
                      <td />
                      <td className="num strong" data-label="Received">
                        {money(payments.total)}
                      </td>
                      <td className="num strong" data-label="Refunded">
                        {money(payments.refunded)}
                      </td>
                      <td className="num strong" data-label="Net">
                        {money(payments.net)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {tab === 'products' && products && (
            <section className="card">
              <div className="card-header">
                <h2>Product sales</h2>
              </div>
              <div className="card-body table-wrap">
                {products.products.length === 0 ? (
                  <p className="muted">No products sold in this period.</p>
                ) : (
                  <table className="table stack" data-testid="products-report">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>SKU</th>
                        <th className="num">Qty sold</th>
                        <th className="num">Refunded</th>
                        <th className="num">Revenue</th>
                        <th className="num">Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.products.map((p) => (
                        <tr key={p.productId}>
                          <td className="strong primary">{p.name}</td>
                          <td className="mono muted" data-label="SKU">
                            {p.sku}
                          </td>
                          <td className="num" data-label="Qty sold">
                            {p.quantitySold}
                          </td>
                          <td className="num muted" data-label="Refunded">
                            {p.quantityRefunded}
                          </td>
                          <td className="num" data-label="Revenue">
                            {money(p.revenue)}
                          </td>
                          <td className="num strong" data-label="Net">
                            {money(p.netRevenue)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          )}

          {tab === 'inventory' && inventory && (
            <>
              <div className="grid grid-3">
                <StatTile label="Units on hand" value={inventory.totalUnits} icon="layers" />
                <StatTile
                  label="Stock value (cost)"
                  value={money(inventory.totalStockValue)}
                  icon="wallet"
                  tone="info"
                />
                <StatTile
                  label="Low stock"
                  value={inventory.lowStockCount}
                  icon="alert"
                  tone={inventory.lowStockCount > 0 ? 'warn' : 'default'}
                />
              </div>
              <section className="card">
                <div className="card-header">
                  <h2>Inventory</h2>
                </div>
                <div className="card-body table-wrap">
                  <table className="table stack" data-testid="inventory-report">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Category</th>
                        <th className="num">Stock</th>
                        <th className="num">Threshold</th>
                        <th className="num">Value</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inventory.products.map((p) => (
                        <tr key={p.productId}>
                          <td className="strong primary">{p.name}</td>
                          <td className="muted" data-label="Category">
                            {p.categoryName ?? '—'}
                          </td>
                          <td className="num" data-label="Stock">
                            {p.stockQty}
                          </td>
                          <td className="num muted" data-label="Threshold">
                            {p.lowStockThreshold}
                          </td>
                          <td className="num" data-label="Value">
                            {money(p.stockValue)}
                          </td>
                          <td data-label="Status">
                            {!p.active ? (
                              <Badge tone="dark">Inactive</Badge>
                            ) : p.lowStock ? (
                              <Badge tone="warning">Low</Badge>
                            ) : (
                              <Badge tone="success">OK</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </>
      )}
    </>
  );
}
