import { useEffect, useMemo, useState } from 'react';
import { validatePayments, type PaymentMethod } from '@tallo/shared';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { money, parseMoneyInput } from '../utils/format';

export interface PaymentLine {
  method: PaymentMethod;
  amount: string;
  referenceNo: string;
}

interface Props {
  open: boolean;
  total: number;
  initialMethod?: PaymentMethod;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (payments: { method: PaymentMethod; amount: number; referenceNo?: string }[]) => void;
}

const METHODS: { id: PaymentMethod; label: string; icon: string }[] = [
  { id: 'CASH', label: 'Cash', icon: 'cash' },
  { id: 'CARD', label: 'Card', icon: 'card' },
  { id: 'QR', label: 'QR', icon: 'qr' },
];

export function PaymentModal({
  open,
  total,
  initialMethod = 'CASH',
  submitting,
  error,
  onClose,
  onConfirm,
}: Props) {
  const [lines, setLines] = useState<PaymentLine[]>([
    { method: initialMethod, amount: total.toFixed(2), referenceNo: '' },
  ]);

  useEffect(() => {
    if (open) setLines([{ method: initialMethod, amount: total.toFixed(2), referenceNo: '' }]);
  }, [open, total, initialMethod]);

  const parsed = useMemo(
    () =>
      lines.map((l) => ({
        method: l.method,
        amountCents: Math.round((parseMoneyInput(l.amount) ?? 0) * 100),
        referenceNo: l.referenceNo,
      })),
    [lines],
  );

  const validation = useMemo(() => {
    try {
      return {
        ok: true as const,
        result: validatePayments(
          Math.round(total * 100),
          parsed.filter((p) => p.amountCents > 0),
        ),
      };
    } catch (e) {
      return { ok: false as const, message: (e as Error).message };
    }
  }, [parsed, total]);

  const paid = parsed.reduce((a, p) => a + p.amountCents, 0) / 100;
  const remaining = Math.max(0, Math.round((total - paid) * 100) / 100);

  function update(i: number, patch: Partial<PaymentLine>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function setSingleMethod(method: PaymentMethod) {
    setLines([{ method, amount: total.toFixed(2), referenceNo: '' }]);
  }

  function addSplit() {
    setLines((ls) => [
      ...ls,
      {
        method: ls[0]?.method === 'CASH' ? 'CARD' : 'CASH',
        amount: remaining.toFixed(2),
        referenceNo: '',
      },
    ]);
  }

  function quickCash(amount: number) {
    setLines((ls) =>
      ls.map((l, idx) => (idx === 0 ? { ...l, method: 'CASH', amount: amount.toFixed(2) } : l)),
    );
  }

  const single = lines.length === 1;
  const quick = [
    total,
    Math.ceil(total),
    Math.ceil(total / 5) * 5,
    Math.ceil(total / 10) * 10,
    Math.ceil(total / 20) * 20,
  ]
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 5);

  return (
    <Modal open={open} title="Take payment" onClose={onClose} testId="payment-modal">
      <div className="summary-row total" style={{ borderTop: 'none', paddingTop: 0 }}>
        <span>Amount due</span>
        <span className="val" data-testid="payment-due">
          {money(total)}
        </span>
      </div>

      {single && (
        <div className="segmented" role="radiogroup" aria-label="Payment method">
          {METHODS.map((m) => (
            <button
              key={m.id}
              type="button"
              className={lines[0]?.method === m.id ? 'active primary' : ''}
              onClick={() => setSingleMethod(m.id)}
              data-testid={`pay-method-${m.id.toLowerCase()}`}
              role="radio"
              aria-checked={lines[0]?.method === m.id}
            >
              <Icon name={m.icon} size={14} /> {m.label}
            </button>
          ))}
        </div>
      )}

      {lines.map((line, i) => (
        <div
          key={i}
          className="card"
          style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          {!single && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <select
                className="select"
                style={{ width: 140, height: 36 }}
                value={line.method}
                onChange={(e) => update(i, { method: e.target.value as PaymentMethod })}
              >
                {METHODS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-ghost btn-icon btn-sm"
                onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                aria-label="Remove payment"
              >
                <Icon name="trash" size={16} />
              </button>
            </div>
          )}
          <div className="field">
            <label htmlFor={`amount-${i}`}>
              {line.method === 'CASH' ? 'Cash received' : 'Amount'}
            </label>
            <input
              id={`amount-${i}`}
              className="input input-lg mono"
              inputMode="decimal"
              value={line.amount}
              onChange={(e) => update(i, { amount: e.target.value })}
              data-testid={`pay-amount-${i}`}
              autoFocus={i === 0}
              onFocus={(e) => e.target.select()}
            />
          </div>
          {line.method === 'CASH' && i === 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {quick.map((q) => (
                <button
                  key={q}
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => quickCash(q)}
                >
                  {money(q)}
                </button>
              ))}
            </div>
          )}
          {line.method !== 'CASH' && (
            <div className="field">
              <label htmlFor={`ref-${i}`}>Reference / approval no. (optional)</label>
              <input
                id={`ref-${i}`}
                className="input"
                value={line.referenceNo}
                onChange={(e) => update(i, { referenceNo: e.target.value })}
                placeholder="e.g. AUTH-12345"
              />
            </div>
          )}
        </div>
      ))}

      {lines.length < 3 && (
        <button
          type="button"
          className="btn btn-modify btn-sm"
          onClick={addSplit}
          style={{ alignSelf: 'flex-start' }}
        >
          <Icon name="plus" size={14} /> Split payment
        </button>
      )}

      <div className="summary-row">
        <span>Paid</span>
        <span className="val">{money(paid)}</span>
      </div>
      {validation.ok ? (
        <div className="summary-row">
          <span>Change</span>
          <span className="val" data-testid="payment-change" style={{ color: 'var(--success)' }}>
            {money(validation.result.changeCents / 100)}
          </span>
        </div>
      ) : (
        <div className="summary-row">
          <span>Remaining</span>
          <span className="val" style={{ color: 'var(--danger)' }}>
            {money(remaining)}
          </span>
        </div>
      )}
      {!validation.ok && paid > 0 && (
        <div className="small" style={{ color: 'var(--danger)' }}>
          {validation.message}
        </div>
      )}
      {error && (
        <div className="alert alert-error" role="alert">
          <Icon name="alert" /> {error}
        </div>
      )}

      <button
        type="button"
        className="btn btn-checkout btn-lg btn-block"
        disabled={!validation.ok || submitting}
        onClick={() =>
          onConfirm(
            parsed
              .filter((p) => p.amountCents > 0)
              .map((p) => ({
                method: p.method,
                amount: p.amountCents / 100,
                ...(p.referenceNo.trim() ? { referenceNo: p.referenceNo.trim() } : {}),
              })),
          )
        }
        data-testid="confirm-payment"
      >
        {submitting ? 'Processing…' : `Confirm ${money(total)}`}
      </button>
    </Modal>
  );
}
