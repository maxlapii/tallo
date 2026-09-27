import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { PrintJobsApi, SalesApi } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import type { PaymentMethod, Receipt, Sale } from '../api/types';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { Badge, ErrorBlock, LoadingBlock, statusLabel, statusTone } from '../components/ui';
import { ReceiptView } from '../pos/ReceiptView';
import { formatDateTime, money } from '../utils/format';

export function SaleDetailPage() {
  const { id } = useParams();
  const saleId = Number(id);
  const toast = useToast();
  const { user } = useAuth();
  const [sale, setSale] = useState<Sale | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [qtys, setQtys] = useState<Record<number, number>>({});
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>('CASH');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, r] = await Promise.all([SalesApi.get(saleId), SalesApi.receipt(saleId)]);
      setSale(s.sale);
      setReceipt(r.receipt);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [saleId]);

  useEffect(() => {
    void load();
  }, [load]);

  function openRefund() {
    if (!sale) return;
    setQtys({});
    setRefundMethod(sale.paymentMethods[0] ?? 'CASH');
    setReason('');
    setFormError(null);
    setRefunding(true);
  }

  const refundLines = sale
    ? sale.items
        .filter((i) => (qtys[i.id] ?? 0) > 0)
        .map((i) => ({ saleItemId: i.id, quantity: qtys[i.id]! }))
    : [];
  const refundEstimate = sale
    ? sale.items.reduce((a, i) => a + (i.total / i.quantity) * (qtys[i.id] ?? 0), 0)
    : 0;

  async function submitRefund(e: FormEvent) {
    e.preventDefault();
    if (refundLines.length === 0) {
      setFormError('Select at least one item to refund.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const r = await SalesApi.refund(saleId, {
        items: refundLines,
        refundMethod,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      toast.success(`Refunded ${money(r.refund.total)}`);
      setRefunding(false);
      void load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Refund failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingBlock />;
  if (error || !sale)
    return <ErrorBlock message={error ?? 'Sale not found'} onRetry={() => void load()} />;

  const refundable = user?.role !== 'SALE' && sale.items.some((i) => i.refundableQuantity > 0);

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Link to="/sales" className="btn btn-ghost btn-icon" aria-label="Back to sales">
            <Icon name="arrowLeft" />
          </Link>
          <div>
            <h1 data-testid="sale-title">Receipt #{sale.receiptNo}</h1>
            <p className="sub">
              {formatDateTime(sale.createdAt)} · {sale.cashierName}
              {sale.customerName ? ` · ${sale.customerName}` : ''}
            </p>
          </div>
          <Badge tone={statusTone(sale.status)}>{statusLabel(sale.status)}</Badge>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setShowReceipt(true)}>
            <Icon name="print" size={16} /> Receipt
          </button>
          {user?.role !== 'SALE' && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                void PrintJobsApi.reprintSale(saleId)
                  .then((r) =>
                    toast.success(
                      `${r.jobs.length} print job${r.jobs.length === 1 ? '' : 's'} queued`,
                    ),
                  )
                  .catch((e: Error) => toast.error(e.message))
              }
              data-testid="reprint-tickets"
            >
              <Icon name="print" size={16} /> Reprint tickets
            </button>
          )}
          {refundable && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={openRefund}
              data-testid="refund-button"
            >
              <Icon name="undo" size={16} /> Refund
            </button>
          )}
        </div>
      </div>

      <div className="grid-main-side">
        <section className="card">
          <div className="card-header">
            <h2>Items</h2>
          </div>
          <div className="card-body table-wrap" style={{ paddingTop: 12 }}>
            <table className="table stack" data-testid="sale-items">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">Qty</th>
                  <th className="num">Price</th>
                  <th className="num">Discount</th>
                  <th className="num">Tax</th>
                  <th className="num">Total</th>
                  <th className="num">Refunded</th>
                </tr>
              </thead>
              <tbody>
                {sale.items.map((i) => (
                  <tr key={i.id}>
                    <td className="primary wrap">
                      <div className="strong">{i.productName}</div>
                      <div className="muted small mono">{i.productSku}</div>
                    </td>
                    <td className="num" data-label="Qty">
                      {i.quantity}
                    </td>
                    <td className="num" data-label="Price">
                      {money(i.unitPrice)}
                    </td>
                    <td className="num muted" data-label="Discount">
                      {i.discount > 0 ? `-${money(i.discount)}` : '—'}
                    </td>
                    <td className="num muted" data-label="Tax">
                      {money(i.tax)}
                    </td>
                    <td className="num strong" data-label="Total">
                      {money(i.total)}
                    </td>
                    <td className="num" data-label="Refunded">
                      {i.refundedQuantity > 0 ? (
                        <Badge tone="warning">{i.refundedQuantity}</Badge>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sale.refunds.length > 0 && (
            <>
              <div className="card-header">
                <h2>Refunds</h2>
              </div>
              <div className="card-body table-wrap" style={{ paddingTop: 12 }}>
                <table className="table stack" data-testid="sale-refunds">
                  <thead>
                    <tr>
                      <th>Items</th>
                      <th>When</th>
                      <th>By</th>
                      <th>Method</th>
                      <th>Reason</th>
                      <th className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sale.refunds.map((r) => (
                      <tr key={r.id}>
                        <td className="primary wrap">
                          {r.items.map((i) => `${i.quantity} × ${i.productName}`).join(', ')}
                        </td>
                        <td className="muted" data-label="When">
                          {formatDateTime(r.createdAt)}
                        </td>
                        <td data-label="By">{r.userName}</td>
                        <td data-label="Method">
                          <Badge>{r.refundMethod}</Badge>
                        </td>
                        <td className="muted wrap" data-label="Reason">
                          {r.reason ?? '—'}
                        </td>
                        <td className="num strong" data-label="Amount">
                          -{money(r.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        <section className="card">
          <div className="card-header">
            <h2>Summary</h2>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="summary-row">
              <span>Subtotal</span>
              <span className="val">{money(sale.subtotal)}</span>
            </div>
            <div className="summary-row">
              <span>Discount</span>
              <span className="val">-{money(sale.discount)}</span>
            </div>
            <div className="summary-row">
              <span>Tax</span>
              <span className="val">{money(sale.tax)}</span>
            </div>
            <div className="summary-row total">
              <span>Total</span>
              <span className="val">{money(sale.total)}</span>
            </div>
            <div className="divider" style={{ margin: '6px 0' }} />
            {sale.payments.map((p) => (
              <div className="summary-row" key={p.id}>
                <span>
                  {p.method}
                  {p.referenceNo ? <span className="muted small"> · {p.referenceNo}</span> : null}
                </span>
                <span className="val">{money(p.amount)}</span>
              </div>
            ))}
            <div className="summary-row">
              <span>Change</span>
              <span className="val">{money(sale.change)}</span>
            </div>
            {sale.refundedTotal > 0 && (
              <div className="summary-row" style={{ color: 'var(--danger)' }}>
                <span>Refunded</span>
                <span className="val" style={{ color: 'var(--danger)' }}>
                  -{money(sale.refundedTotal)}
                </span>
              </div>
            )}
          </div>
        </section>
      </div>

      <Modal
        open={refunding}
        title={`Refund receipt #${sale.receiptNo}`}
        onClose={() => setRefunding(false)}
        wide
        testId="refund-modal"
      >
        <form onSubmit={submitRefund} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Sold</th>
                <th className="num">Refundable</th>
                <th className="num">Refund qty</th>
              </tr>
            </thead>
            <tbody>
              {sale.items.map((i) => (
                <tr key={i.id}>
                  <td className="strong">{i.productName}</td>
                  <td className="num">{i.quantity}</td>
                  <td className="num">{i.refundableQuantity}</td>
                  <td className="num">
                    <input
                      type="number"
                      className="input mono"
                      style={{ width: 90, height: 36, textAlign: 'right' }}
                      min={0}
                      max={i.refundableQuantity}
                      value={qtys[i.id] ?? 0}
                      disabled={i.refundableQuantity === 0}
                      onChange={(e) =>
                        setQtys({
                          ...qtys,
                          [i.id]: Math.min(
                            i.refundableQuantity,
                            Math.max(0, Math.floor(Number(e.target.value) || 0)),
                          ),
                        })
                      }
                      aria-label={`Refund quantity for ${i.productName}`}
                      data-testid={`refund-qty-${i.productSku}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="refund-method">Refund method</label>
              <select
                id="refund-method"
                className="select"
                value={refundMethod}
                onChange={(e) => setRefundMethod(e.target.value as PaymentMethod)}
                data-testid="refund-method"
              >
                <option value="CASH">Cash (from shift drawer)</option>
                <option value="CARD">Card</option>
                <option value="QR">QR</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="refund-reason">Reason</label>
              <input
                id="refund-reason"
                className="input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>
          <div className="summary-row total">
            <span>Estimated refund</span>
            <span className="val">{money(Math.round(refundEstimate * 100) / 100)}</span>
          </div>
          {formError && (
            <div className="alert alert-error" role="alert">
              <Icon name="alert" /> {formError}
            </div>
          )}
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setRefunding(false)}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-danger"
              disabled={saving || refundLines.length === 0}
              data-testid="refund-submit"
            >
              {saving ? 'Refunding…' : 'Confirm refund'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={showReceipt} title="Receipt" onClose={() => setShowReceipt(false)}>
        {receipt && (
          <>
            <ReceiptView receipt={receipt} />
            <div className="form-actions">
              <button type="button" className="btn btn-primary" onClick={() => window.print()}>
                <Icon name="print" size={16} /> Print
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
