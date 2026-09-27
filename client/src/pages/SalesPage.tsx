import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SalesApi } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { useLiveEvents, type LiveEvent } from '../realtime/RealtimeContext';
import type { PaymentMethod, SaleSummary } from '../api/types';
import { Icon } from '../components/Icon';
import {
  Badge,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  statusLabel,
  statusTone,
} from '../components/ui';
import { formatDateTime, money, todayIso } from '../utils/format';

const PAGE = 25;

export function SalesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isSale = user?.role === 'SALE';
  const [sales, setSales] = useState<SaleSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [receiptNo, setReceiptNo] = useState('');
  const [method, setMethod] = useState<PaymentMethod | ''>('');
  const [applied, setApplied] = useState({
    from: todayIso(),
    to: todayIso(),
    receiptNo: '',
    method: '' as PaymentMethod | '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await SalesApi.list({
        from: applied.from || undefined,
        to: applied.to || undefined,
        receiptNo: applied.receiptNo || undefined,
        paymentMethod: applied.method || undefined,
        limit: PAGE,
        offset: page * PAGE,
      });
      setSales(r.sales);
      setTotal(r.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [applied, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const onLive = useCallback(
    (e: LiveEvent) => {
      if (e.type === 'sale.created' || e.type === 'refund.created') void load();
    },
    [load],
  );
  useLiveEvents(onLive);

  function apply() {
    setPage(0);
    setApplied({ from, to, receiptNo: receiptNo.trim(), method });
  }

  function clear() {
    setFrom('');
    setTo('');
    setReceiptNo('');
    setMethod('');
    setPage(0);
    setApplied({ from: '', to: '', receiptNo: '', method: '' });
  }

  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{isSale ? 'My orders' : 'Sales history'}</h1>
          <p className="sub">{total} sales match the current filters</p>
        </div>
      </div>

      <div className="card card-pad filter-bar">
        <div className="field">
          <label htmlFor="from">From</label>
          <input
            id="from"
            type="date"
            className="input"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="to">To</label>
          <input
            id="to"
            type="date"
            className="input"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="receipt">Receipt #</label>
          <input
            id="receipt"
            className="input"
            placeholder="000123"
            value={receiptNo}
            onChange={(e) => setReceiptNo(e.target.value)}
            data-testid="filter-receipt"
          />
        </div>
        <div className="field">
          <label htmlFor="method">Payment</label>
          <select
            id="method"
            className="select"
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod | '')}
          >
            <option value="">Any</option>
            <option value="CASH">Cash</option>
            <option value="CARD">Card</option>
            <option value="QR">QR</option>
          </select>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={apply}
          data-testid="apply-filters"
        >
          <Icon name="search" size={16} /> Search
        </button>
        <button type="button" className="btn btn-ghost" onClick={clear}>
          Clear
        </button>
      </div>

      {error && <ErrorBlock message={error} onRetry={() => void load()} />}
      <div className="card">
        {loading ? (
          <LoadingBlock />
        ) : sales.length === 0 ? (
          <EmptyState
            icon="receipt"
            title="No sales found"
            hint="Adjust the filters or make a sale in the POS."
          />
        ) : (
          <div className="table-wrap">
            <table className="table stack" data-testid="sales-table">
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Date</th>
                  <th>Cashier</th>
                  <th>Payment</th>
                  <th>Status</th>
                  <th className="num">Total</th>
                  <th className="num">Refunded</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <tr
                    key={s.id}
                    className="clickable"
                    onClick={() => navigate(`/sales/${s.id}`)}
                    data-testid={`sale-row-${s.receiptNo}`}
                  >
                    <td className="strong primary">#{s.receiptNo}</td>
                    <td className="muted" data-label="Date">
                      {formatDateTime(s.createdAt)}
                    </td>
                    <td data-label="Cashier">{s.cashierName}</td>
                    <td data-label="Payment">
                      {s.paymentMethods.map((m) => (
                        <Badge key={m}>{m}</Badge>
                      ))}
                    </td>
                    <td data-label="Status">
                      <Badge tone={statusTone(s.status)}>{statusLabel(s.status)}</Badge>
                    </td>
                    <td className="num strong" data-label="Total">
                      {money(s.total)}
                    </td>
                    <td className="num muted" data-label="Refunded">
                      {s.refundedTotal > 0 ? `-${money(s.refundedTotal)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 20px',
              borderTop: '1px solid var(--border)',
            }}
          >
            <span className="muted small">
              Page {page + 1} of {pages}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                disabled={page + 1 >= pages}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
