import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../api/client';
import { PrintersApi, PrintJobsApi } from '../api/endpoints';
import type { Printer, PrinterInput, PrintJob } from '../api/types';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { Badge, EmptyState, ErrorBlock, LoadingBlock } from '../components/ui';
import { useLiveEvents, type LiveEvent } from '../realtime/RealtimeContext';
import { formatDateTime } from '../utils/format';

interface Form {
  name: string;
  area: string;
  type: 'BROWSER' | 'NETWORK';
  host: string;
  port: string;
  printsReceipts: boolean;
  printsTickets: boolean;
  active: boolean;
}

const empty: Form = {
  name: '',
  area: '',
  type: 'BROWSER',
  host: '',
  port: '9100',
  printsReceipts: false,
  printsTickets: true,
  active: true,
};

function toForm(p: Printer): Form {
  return {
    name: p.name,
    area: p.area,
    type: p.type,
    host: p.host ?? '',
    port: String(p.port ?? 9100),
    printsReceipts: p.printsReceipts,
    printsTickets: p.printsTickets,
    active: p.active,
  };
}

function jobTone(status: PrintJob['status']) {
  return status === 'PRINTED'
    ? 'success'
    : status === 'FAILED'
      ? 'danger'
      : status === 'SENDING'
        ? 'info'
        : 'warning';
}

export function PrintersPage() {
  const toast = useToast();
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Printer | 'new' | null>(null);
  const [form, setForm] = useState<Form>(empty);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, j] = await Promise.all([PrintersApi.list(true), PrintJobsApi.list({ limit: 40 })]);
      setPrinters(p.printers);
      setJobs(j.jobs);
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
      if (e.type === 'print.job') void load();
    },
    [load],
  );
  useLiveEvents(onLive);

  function open(p: Printer | 'new') {
    setForm(p === 'new' ? empty : toForm(p));
    setFieldErrors({});
    setFormError(null);
    setEditing(p);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    setFieldErrors({});
    const body: PrinterInput = {
      name: form.name.trim(),
      area: form.area.trim(),
      type: form.type,
      host: form.type === 'NETWORK' ? form.host.trim() : null,
      port: form.type === 'NETWORK' ? Number(form.port || 9100) : null,
      printsReceipts: form.printsReceipts,
      printsTickets: form.printsTickets,
      active: form.active,
    };
    try {
      if (editing === 'new') await PrintersApi.create(body);
      else if (editing) await PrintersApi.update(editing.id, body);
      toast.success(editing === 'new' ? 'Printer added' : 'Printer updated');
      setEditing(null);
      void load();
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(err.message);
        if (err.details && typeof err.details === 'object')
          setFieldErrors(err.details as Record<string, string[]>);
      } else setFormError('Could not save printer');
    } finally {
      setSaving(false);
    }
  }

  async function test(p: Printer) {
    setTesting(p.id);
    try {
      const r = await PrintersApi.test(p.id);
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setTesting(null);
    }
  }

  async function remove(p: Printer) {
    if (!window.confirm(`Remove "${p.name}"? Printers with history are deactivated instead.`))
      return;
    try {
      const r = await PrintersApi.remove(p.id);
      toast.success(r.deleted ? 'Printer removed' : 'Printer deactivated');
      void load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function retry(job: PrintJob) {
    try {
      const r = await PrintJobsApi.retry(job.id);
      if (r.job.status === 'FAILED') toast.error(r.job.error ?? 'Print failed again');
      else
        toast.success(
          r.job.printerType === 'NETWORK' ? 'Sent to printer' : 'Queued for the print station',
        );
      void load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Printers & areas</h1>
          <p className="sub">
            Each area gets its own printer. Kitchen tickets only include that area's items.
          </p>
        </div>
        <div className="page-actions">
          <Link to="/print-station" className="btn btn-secondary">
            <Icon name="print" size={16} /> Open print station
          </Link>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => open('new')}
            data-testid="new-printer"
          >
            <Icon name="plus" size={16} /> Add printer
          </button>
        </div>
      </div>

      {error && <ErrorBlock message={error} onRetry={() => void load()} />}
      <div className="card">
        {loading ? (
          <LoadingBlock />
        ) : printers.length === 0 ? (
          <EmptyState
            icon="print"
            title="No printers yet"
            hint="Add a printer for each area: counter, drink maker, kitchen…"
          />
        ) : (
          <div className="table-wrap">
            <table className="table stack" data-testid="printers-table">
              <thead>
                <tr>
                  <th>Area</th>
                  <th>Printer</th>
                  <th>Type</th>
                  <th>Prints</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {printers.map((p) => (
                  <tr key={p.id} data-testid={`printer-row-${p.id}`}>
                    <td className="strong primary">{p.area}</td>
                    <td data-label="Printer">{p.name}</td>
                    <td data-label="Type">
                      {p.type === 'NETWORK' ? (
                        <span>
                          Network{' '}
                          <span className="muted mono small">
                            {p.host}:{p.port}
                          </span>
                        </span>
                      ) : (
                        'Browser / print station'
                      )}
                    </td>
                    <td data-label="Prints">
                      {[p.printsTickets ? 'Tickets' : null, p.printsReceipts ? 'Receipts' : null]
                        .filter(Boolean)
                        .join(' + ') || '—'}
                    </td>
                    <td data-label="Status">
                      {p.active ? (
                        <Badge tone="success">Active</Badge>
                      ) : (
                        <Badge tone="dark">Inactive</Badge>
                      )}
                    </td>
                    <td className="actions">
                      {p.type === 'NETWORK' && (
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          disabled={testing === p.id}
                          onClick={() => void test(p)}
                        >
                          {testing === p.id ? 'Testing…' : 'Test'}
                        </button>
                      )}{' '}
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-sm"
                        onClick={() => open(p)}
                        aria-label={`Edit ${p.name}`}
                      >
                        <Icon name="edit" size={16} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-sm"
                        onClick={() => void remove(p)}
                        aria-label={`Remove ${p.name}`}
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <section className="card">
        <div className="card-header">
          <h2>Recent print jobs</h2>
          <span className="live-dot on">
            <span className="dot" /> Live
          </span>
        </div>
        <div className="card-body table-wrap" style={{ paddingTop: 12 }}>
          {jobs.length === 0 ? (
            <p className="muted">No print jobs yet. They appear here as orders are placed.</p>
          ) : (
            <table className="table stack" data-testid="print-jobs-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Area</th>
                  <th>Kind</th>
                  <th>Status</th>
                  <th>When</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td className="strong primary">#{j.payload.receiptNo}</td>
                    <td data-label="Area">{j.printerArea}</td>
                    <td data-label="Kind">{j.kind === 'TICKET' ? 'Ticket' : 'Receipt'}</td>
                    <td data-label="Status">
                      <Badge tone={jobTone(j.status)}>{j.status}</Badge>
                      {j.error && <span className="small muted"> {j.error}</span>}
                    </td>
                    <td className="muted" data-label="When">
                      {formatDateTime(j.createdAt)}
                    </td>
                    <td className="actions">
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={() => void retry(j)}
                      >
                        <Icon name="refresh" size={14} /> Reprint
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <Modal
        open={editing !== null}
        title={editing === 'new' ? 'Add printer' : 'Edit printer'}
        onClose={() => setEditing(null)}
        testId="printer-modal"
      >
        <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="pr-area">Area</label>
              <input
                id="pr-area"
                className={fieldErrors.area ? 'input error' : 'input'}
                required
                placeholder="Kitchen 1"
                value={form.area}
                onChange={(e) => setForm({ ...form, area: e.target.value })}
                data-testid="printer-area"
                autoFocus
              />
              <span className="small muted">Printed as the ticket header.</span>
            </div>
            <div className="field">
              <label htmlFor="pr-name">Printer name</label>
              <input
                id="pr-name"
                className={fieldErrors.name ? 'input error' : 'input'}
                required
                placeholder="Epson TM-T20"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                data-testid="printer-name"
              />
            </div>
          </div>
          <div className="field">
            <span className="label">Connection</span>
            <div className="segmented">
              <button
                type="button"
                className={form.type === 'BROWSER' ? 'active' : ''}
                onClick={() => setForm({ ...form, type: 'BROWSER' })}
                data-testid="printer-type-browser"
              >
                Browser / print station
              </button>
              <button
                type="button"
                className={form.type === 'NETWORK' ? 'active' : ''}
                onClick={() => setForm({ ...form, type: 'NETWORK' })}
                data-testid="printer-type-network"
              >
                Network (ESC/POS)
              </button>
            </div>
            <span className="small muted">
              {form.type === 'BROWSER'
                ? 'Jobs appear on a print-station screen for this area; a device there prints them with its own printer.'
                : 'Sent directly to a receipt printer over the network (raw TCP, usually port 9100).'}
            </span>
          </div>
          {form.type === 'NETWORK' && (
            <div className="form-grid">
              <div className="field">
                <label htmlFor="pr-host">Host / IP</label>
                <input
                  id="pr-host"
                  className={fieldErrors.host ? 'input error' : 'input'}
                  placeholder="192.168.1.50"
                  value={form.host}
                  onChange={(e) => setForm({ ...form, host: e.target.value })}
                  data-testid="printer-host"
                />
                {fieldErrors.host && <span className="field-error">{fieldErrors.host[0]}</span>}
              </div>
              <div className="field">
                <label htmlFor="pr-port">Port</label>
                <input
                  id="pr-port"
                  className="input"
                  inputMode="numeric"
                  value={form.port}
                  onChange={(e) => setForm({ ...form, port: e.target.value })}
                />
              </div>
            </div>
          )}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.printsTickets}
              onChange={(e) => setForm({ ...form, printsTickets: e.target.checked })}
            />{' '}
            Prints kitchen tickets for items routed to this area
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.printsReceipts}
              onChange={(e) => setForm({ ...form, printsReceipts: e.target.checked })}
              data-testid="printer-receipts"
            />{' '}
            Prints customer receipts (counter)
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />{' '}
            Active
          </label>
          {formError && (
            <div className="alert alert-error" role="alert">
              <Icon name="alert" /> {formError}
            </div>
          )}
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving}
              data-testid="save-printer"
            >
              {saving ? 'Saving…' : 'Save printer'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
