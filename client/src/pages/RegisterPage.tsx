import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { RegistersApi } from '../api/endpoints';
import type { Register } from '../api/types';
import { Icon } from '../components/Icon';
import { useLiveEvents, type LiveEvent } from '../realtime/RealtimeContext';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { Badge, EmptyState, ErrorBlock, LoadingBlock, StatTile } from '../components/ui';
import { formatDateTime, money, parseMoneyInput } from '../utils/format';

type Action = 'open' | 'close' | 'cash-in' | 'cash-out' | null;

const TITLES: Record<Exclude<Action, null>, string> = {
  open: 'Open Shift',
  close: 'Close Shift',
  'cash-in': 'Cash in',
  'cash-out': 'Cash out',
};

export function RegisterPage() {
  const toast = useToast();
  const [register, setRegister] = useState<Register | null>(null);
  const [history, setHistory] = useState<Register[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<Action>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [closed, setClosed] = useState<Register | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cur, list] = await Promise.all([
        RegistersApi.current(),
        RegistersApi.list({ limit: 20 }),
      ]);
      setRegister(cur.register);
      setHistory(list.registers.filter((r) => r.status === 'CLOSED'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onLive = useCallback(
    (e: LiveEvent) => {
      if (e.type === 'sale.created' || e.type === 'refund.created' || e.type === 'register.changed')
        void load();
    },
    [load],
  );
  useLiveEvents(onLive);

  function start(a: Action) {
    setAction(a);
    setAmount(a === 'close' && register ? register.summary.expectedCash.toFixed(2) : '');
    setNote('');
    setFormError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = parseMoneyInput(amount);
    if (value === null) {
      setFormError('Enter a valid amount.');
      return;
    }
    setSaving(true);
    setFormError(null);
    const n = note.trim() ? { note: note.trim() } : {};
    try {
      if (action === 'open') {
        await RegistersApi.open({ openingCash: value, ...n });
        toast.success('Shift opened');
      } else if (action === 'close') {
        const r = await RegistersApi.close({ actualCash: value, ...n });
        setClosed(r.register);
        toast.success('Shift closed');
      } else if (action === 'cash-in') {
        await RegistersApi.cashIn({ amount: value, ...n });
        toast.success(`${money(value)} added to the drawer`);
      } else if (action === 'cash-out') {
        await RegistersApi.cashOut({ amount: value, ...n });
        toast.success(`${money(value)} removed from the drawer`);
      }
      setAction(null);
      void load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Action failed');
    } finally {
      setSaving(false);
    }
  }

  const diffTone = (d: number | null) =>
    d === null || d === 0 ? 'success' : Math.abs(d) < 1 ? 'warning' : 'danger';

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Shift</h1>
          <p className="sub">
            Open a shift with your starting float, track the drawer, and reconcile when you close.
          </p>
        </div>
        <div className="page-actions">
          {register ? (
            <>
              <button
                type="button"
                className="btn btn-modify"
                onClick={() => start('cash-in')}
                data-testid="cash-in"
              >
                <Icon name="plus" size={16} /> Cash in
              </button>
              <button
                type="button"
                className="btn btn-modify"
                onClick={() => start('cash-out')}
                data-testid="cash-out"
              >
                <Icon name="minus" size={16} /> Cash out
              </button>
              <button
                type="button"
                className="btn btn-dark"
                onClick={() => start('close')}
                data-testid="close-register"
              >
                <Icon name="lock" size={16} /> Close Shift
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => start('open')}
              data-testid="open-register"
            >
              <Icon name="unlock" size={16} /> Open Shift
            </button>
          )}
        </div>
      </div>

      {error && <ErrorBlock message={error} onRetry={() => void load()} />}
      {loading ? (
        <LoadingBlock />
      ) : register ? (
        <>
          <div className="grid grid-4">
            <StatTile
              label="Opening float"
              value={money(register.summary.openingCash)}
              hint={`Opened ${formatDateTime(register.openedAt)}`}
              icon="unlock"
            />
            <StatTile
              label="Cash sales"
              value={money(register.summary.cashSales)}
              hint={`${register.summary.salesCount} sales, ${money(register.summary.totalSales)} total`}
              icon="trend"
              tone="info"
              testId="stat-cash-sales"
            />
            <StatTile
              label="Cash in / out"
              value={`${money(register.summary.cashIn)} / ${money(register.summary.cashOut)}`}
              hint={`Refunds ${money(register.summary.cashRefunds)}`}
              icon="cash"
            />
            <StatTile
              label="Expected in drawer"
              value={money(register.summary.expectedCash)}
              hint="Opening + cash sales + in − out − refunds"
              icon="wallet"
              testId="stat-expected-cash"
            />
          </div>
          <section className="card">
            <div className="card-header">
              <h2>Drawer activity</h2>
              <Badge tone="success">Open</Badge>
            </div>
            <div className="card-body table-wrap" style={{ paddingTop: 12 }}>
              <table className="table stack" data-testid="cash-movements">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>When</th>
                    <th>Note / reference</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {register.movements.map((m) => (
                    <tr key={m.id}>
                      <td className="primary">
                        <Badge tone={m.amount >= 0 ? 'success' : 'danger'}>
                          {m.type.replace('_', ' ')}
                        </Badge>
                      </td>
                      <td className="muted" data-label="When">
                        {formatDateTime(m.createdAt)}
                      </td>
                      <td className="muted wrap" data-label="Note">
                        {m.note ?? (m.referenceType ? `${m.referenceType} #${m.referenceId}` : '—')}
                      </td>
                      <td className="num strong" data-label="Amount">
                        {m.amount >= 0 ? money(m.amount) : `-${money(-m.amount)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <div className="card">
          <EmptyState
            icon="lock"
            title="No shift is open"
            hint="Open a shift with your starting float to begin taking payments."
            action={
              <button type="button" className="btn btn-primary" onClick={() => start('open')}>
                <Icon name="unlock" size={16} /> Open Shift
              </button>
            }
          />
        </div>
      )}

      <section className="card">
        <div className="card-header">
          <h2>Previous shifts</h2>
        </div>
        <div className="card-body table-wrap" style={{ paddingTop: 12 }}>
          {history.length === 0 ? (
            <p className="muted">No closed shifts yet.</p>
          ) : (
            <table className="table stack" data-testid="register-history">
              <thead>
                <tr>
                  <th>Opened</th>
                  <th>Closed</th>
                  <th>User</th>
                  <th className="num">Sales</th>
                  <th className="num">Expected</th>
                  <th className="num">Counted</th>
                  <th className="num">Difference</th>
                </tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.id} data-testid={`register-row-${r.id}`}>
                    <td className="primary">{formatDateTime(r.openedAt)}</td>
                    <td className="muted" data-label="Closed">
                      {r.closedAt ? formatDateTime(r.closedAt) : '—'}
                    </td>
                    <td data-label="User">{r.userName}</td>
                    <td className="num" data-label="Sales">
                      {r.summary.salesCount}
                    </td>
                    <td className="num" data-label="Expected">
                      {money(r.expectedCash)}
                    </td>
                    <td className="num" data-label="Counted">
                      {money(r.actualCash)}
                    </td>
                    <td className="num" data-label="Difference">
                      <Badge tone={diffTone(r.difference)}>
                        {r.difference === null
                          ? '—'
                          : r.difference >= 0
                            ? money(r.difference)
                            : `-${money(-r.difference)}`}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <Modal
        open={action !== null}
        title={action ? TITLES[action] : ''}
        onClose={() => setAction(null)}
        testId="register-modal"
      >
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {action === 'close' && register && (
            <div className="alert alert-info">
              <Icon name="info" />
              <div>
                Expected cash in drawer:{' '}
                <strong data-testid="close-expected">{money(register.summary.expectedCash)}</strong>
                . Count the drawer and enter the actual amount.
              </div>
            </div>
          )}
          <div className="field">
            <label htmlFor="reg-amount">
              {action === 'open'
                ? 'Opening cash'
                : action === 'close'
                  ? 'Actual cash counted'
                  : 'Amount'}
            </label>
            <input
              id="reg-amount"
              className="input input-lg mono"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
              data-testid="register-amount"
              onFocus={(e) => e.target.select()}
            />
          </div>
          <div className="field">
            <label htmlFor="reg-note">Note</label>
            <input
              id="reg-note"
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
            <button type="button" className="btn btn-secondary" onClick={() => setAction(null)}>
              Cancel
            </button>
            <button
              type="submit"
              className={action === 'close' ? 'btn btn-dark' : 'btn btn-primary'}
              disabled={saving}
              data-testid="register-submit"
            >
              {saving ? 'Saving…' : action ? TITLES[action] : ''}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={closed !== null}
        title="Shift closed"
        onClose={() => setClosed(null)}
        testId="reconciliation-modal"
      >
        {closed && (
          <>
            <div className="grid grid-3">
              <div className="card stat">
                <span className="label">Expected</span>
                <span className="value" data-testid="recon-expected">
                  {money(closed.expectedCash)}
                </span>
              </div>
              <div className="card stat">
                <span className="label">Counted</span>
                <span className="value" data-testid="recon-actual">
                  {money(closed.actualCash)}
                </span>
              </div>
              <div className="card stat">
                <span className="label">Difference</span>
                <span
                  className="value"
                  data-testid="recon-difference"
                  style={{ color: closed.difference === 0 ? 'var(--success)' : 'var(--danger)' }}
                >
                  {closed.difference !== null && closed.difference < 0
                    ? `-${money(-closed.difference)}`
                    : money(closed.difference)}
                </span>
              </div>
            </div>
            <dl className="kv">
              <dt>Opening float</dt>
              <dd>{money(closed.summary.openingCash)}</dd>
              <dt>Cash sales</dt>
              <dd>{money(closed.summary.cashSales)}</dd>
              <dt>Cash refunds</dt>
              <dd>-{money(closed.summary.cashRefunds)}</dd>
              <dt>Cash in</dt>
              <dd>{money(closed.summary.cashIn)}</dd>
              <dt>Cash out</dt>
              <dd>-{money(closed.summary.cashOut)}</dd>
            </dl>
            <div className="form-actions">
              <button type="button" className="btn btn-primary" onClick={() => setClosed(null)}>
                Done
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
