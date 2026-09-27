import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { InventoryApi, RegistersApi, ReportsApi, SalesApi } from '../api/endpoints';
import type { DailyReport, Register, SaleSummary } from '../api/types';
import { Icon } from '../components/Icon';
import { useLiveEvents, type LiveEvent } from '../realtime/RealtimeContext';
import {
  Badge,
  ErrorBlock,
  LoadingBlock,
  StatTile,
  statusLabel,
  statusTone,
} from '../components/ui';
import { formatDateTime, money, todayIso } from '../utils/format';

export function DashboardPage() {
  const [report, setReport] = useState<DailyReport | null>(null);
  const [register, setRegister] = useState<Register | null>(null);
  const [lowStock, setLowStock] = useState<number>(0);
  const [recent, setRecent] = useState<SaleSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (tick === 0) setLoading(true);
    Promise.all([
      ReportsApi.daily({ date: todayIso() }),
      RegistersApi.current(),
      InventoryApi.list({ lowStock: true, active: true, limit: 1 }),
      SalesApi.list({ limit: 6 }),
    ])
      .then(([r, reg, inv, sales]) => {
        if (cancelled) return;
        setReport(r.report);
        setRegister(reg.register);
        setLowStock(inv.lowStockCount);
        setRecent(sales.sales);
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const onLive = useCallback((e: LiveEvent) => {
    if (e.type !== 'connected') setTick((t) => t + 1);
  }, []);
  useLiveEvents(onLive);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 data-testid="dashboard-title">Overview</h1>
          <p className="sub">Today at a glance</p>
        </div>
        <div className="page-actions">
          <Link to="/pos" className="btn btn-primary">
            <Icon name="cart" size={16} /> Open POS
          </Link>
        </div>
      </div>

      {error && <ErrorBlock message={error} />}
      {loading ? (
        <LoadingBlock />
      ) : (
        <>
          <div className="grid grid-4">
            <StatTile
              label="Today's sales"
              value={money(report?.netSales)}
              hint={`${report?.transactions ?? 0} transactions`}
              icon="trend"
              testId="stat-sales"
            />
            <StatTile
              label="Items sold"
              value={report?.itemsSold ?? 0}
              hint={`Avg. ${money(report?.averageSale)} per sale`}
              icon="box"
              tone="info"
            />
            <StatTile
              label="Refunds"
              value={money(report?.refunds)}
              hint={`${report?.refundCount ?? 0} refunds today`}
              icon="undo"
              tone="danger"
            />
            <StatTile
              label="Low stock"
              value={lowStock}
              hint={lowStock > 0 ? 'Products at or below threshold' : 'All products stocked'}
              icon="alert"
              tone={lowStock > 0 ? 'warn' : 'default'}
            />
          </div>

          <div className="grid-main-side">
            <section className="card">
              <div className="card-header">
                <h2>Recent sales</h2>
                <Link to="/sales" className="btn btn-sm btn-secondary">
                  View all
                </Link>
              </div>
              <div className="card-body table-wrap" style={{ paddingTop: 12 }}>
                {recent.length === 0 ? (
                  <p className="muted">No sales yet. Open the POS to make your first sale.</p>
                ) : (
                  <table className="table stack">
                    <thead>
                      <tr>
                        <th>Receipt</th>
                        <th>Date</th>
                        <th>Cashier</th>
                        <th>Status</th>
                        <th className="num">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recent.map((s) => (
                        <tr key={s.id}>
                          <td className="primary">
                            <Link to={`/sales/${s.id}`} className="strong">
                              #{s.receiptNo}
                            </Link>
                          </td>
                          <td className="muted" data-label="Date">
                            {formatDateTime(s.createdAt)}
                          </td>
                          <td data-label="Cashier">{s.cashierName}</td>
                          <td data-label="Status">
                            <Badge tone={statusTone(s.status)}>{statusLabel(s.status)}</Badge>
                          </td>
                          <td className="num strong" data-label="Total">
                            {money(s.total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>

            <section className="card">
              <div className="card-header">
                <h2>Shift</h2>
                <Badge tone={register ? 'success' : 'dark'}>{register ? 'Open' : 'Closed'}</Badge>
              </div>
              <div
                className="card-body"
                style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
              >
                {register ? (
                  <>
                    <dl className="kv">
                      <dt>Opened</dt>
                      <dd>{formatDateTime(register.openedAt)}</dd>
                      <dt>Cash sales</dt>
                      <dd>{money(register.summary.cashSales)}</dd>
                      <dt>Expected cash</dt>
                      <dd>{money(register.summary.expectedCash)}</dd>
                    </dl>
                    <Link to="/shift" className="btn btn-secondary">
                      Manage shift
                    </Link>
                  </>
                ) : (
                  <>
                    <p className="muted">
                      Open a shift with your starting float before taking payments.
                    </p>
                    <Link to="/shift" className="btn btn-primary">
                      <Icon name="unlock" size={16} /> Open Shift
                    </Link>
                  </>
                )}
              </div>
            </section>
          </div>
        </>
      )}
    </>
  );
}
