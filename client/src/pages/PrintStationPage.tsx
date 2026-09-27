import { useCallback, useEffect, useRef, useState } from 'react';
import { PrintersApi, PrintJobsApi } from '../api/endpoints';
import type { Printer, PrintJob } from '../api/types';
import { Icon } from '../components/Icon';
import { PrintTicket } from '../components/PrintTicket';
import { useToast } from '../components/Toast';
import { Badge, EmptyState, ErrorBlock, LoadingBlock } from '../components/ui';
import { useLiveEvents, type LiveEvent } from '../realtime/RealtimeContext';
import { formatDateTime } from '../utils/format';

const KEY_PRINTER = 'pos.printStation.printerId';
const KEY_AUTO = 'pos.printStation.autoPrint';

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

/**
 * Print station: the device sitting at an area (counter, drink maker,
 * kitchen…) opens this page, picks its area, and receives that area's jobs
 * live. Each job can be printed with the device's own printer (browser print)
 * and is marked printed so every other screen sees it done.
 */
export function PrintStationPage() {
  const toast = useToast();
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [printerId, setPrinterId] = useState<number | null>(() => {
    const v = readLocal(KEY_PRINTER);
    return v ? Number(v) : null;
  });
  const [autoPrint, setAutoPrint] = useState(() => readLocal(KEY_AUTO) === '1');
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [done, setDone] = useState<PrintJob[]>([]);
  const [selected, setSelected] = useState<PrintJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const printedOnce = useRef(new Set<number>());

  useEffect(() => {
    PrintersApi.list()
      .then((r) => setPrinters(r.printers))
      .catch((e: Error) => setError(e.message));
  }, []);

  const load = useCallback(async () => {
    if (printerId === null) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [queued, printed] = await Promise.all([
        PrintJobsApi.list({ printerId, status: 'QUEUED', limit: 100 }),
        PrintJobsApi.list({ printerId, status: 'PRINTED', limit: 10 }),
      ]);
      setJobs([...queued.jobs].reverse());
      setDone(printed.jobs);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [printerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onLive = useCallback(
    (e: LiveEvent) => {
      if (e.type === 'print.job' && e.payload.printerId === printerId) void load();
    },
    [load, printerId],
  );
  useLiveEvents(onLive);

  const printer = printers.find((p) => p.id === printerId) ?? null;

  function choose(id: number | null) {
    setPrinterId(id);
    writeLocal(KEY_PRINTER, id === null ? null : String(id));
    setSelected(null);
  }

  function toggleAuto(v: boolean) {
    setAutoPrint(v);
    writeLocal(KEY_AUTO, v ? '1' : '0');
  }

  const printJob = useCallback(
    async (job: PrintJob, ack = true) => {
      setSelected(job);
      await new Promise((r) => setTimeout(r, 50)); // let the print area render
      window.print();
      if (ack) {
        try {
          await PrintJobsApi.printed(job.id);
        } catch (err) {
          toast.error((err as Error).message);
        }
      }
    },
    [toast],
  );

  async function markPrinted(job: PrintJob) {
    try {
      await PrintJobsApi.printed(job.id);
      if (selected?.id === job.id) setSelected(null);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  // Auto-print newly arrived jobs once.
  useEffect(() => {
    if (!autoPrint) return;
    const next = jobs.find((j) => !printedOnce.current.has(j.id));
    if (!next) return;
    printedOnce.current.add(next.id);
    void printJob(next);
  }, [jobs, autoPrint, printJob]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Print station{printer ? `: ${printer.area}` : ''}</h1>
          <p className="sub">
            Jobs for this area arrive here live. Print them with this device's printer, then mark
            them done.
          </p>
        </div>
        <div className="page-actions">
          <select
            className="select"
            style={{ width: 220 }}
            value={printerId ?? ''}
            onChange={(e) => choose(e.target.value ? Number(e.target.value) : null)}
            aria-label="Area"
            data-testid="station-printer"
          >
            <option value="">Choose an area…</option>
            {printers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.area} · {p.name}
              </option>
            ))}
          </select>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={autoPrint}
              onChange={(e) => toggleAuto(e.target.checked)}
              data-testid="station-autoprint"
            />{' '}
            Auto-print new jobs
          </label>
        </div>
      </div>

      {error && <ErrorBlock message={error} onRetry={() => void load()} />}
      {printerId === null ? (
        <div className="card">
          <EmptyState
            icon="print"
            title="Choose this device's area"
            hint="Counter, drink maker, kitchen 1… Jobs routed to that area will show up here."
          />
        </div>
      ) : loading ? (
        <LoadingBlock />
      ) : (
        <div className="grid-main-side">
          <section className="card">
            <div className="card-header">
              <h2>Queue</h2>
              <Badge tone={jobs.length ? 'warning' : 'success'}>
                {jobs.length ? `${jobs.length} waiting` : 'All clear'}
              </Badge>
            </div>
            <div
              className="card-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
            >
              {jobs.length === 0 ? (
                <EmptyState
                  icon="check"
                  title="Nothing waiting"
                  hint="New orders for this area will appear instantly."
                />
              ) : (
                jobs.map((j) => (
                  <div
                    className={selected?.id === j.id ? 'job-card selected' : 'job-card'}
                    key={j.id}
                    data-testid={`job-${j.id}`}
                    onClick={() => setSelected(j)}
                  >
                    <div className="job-head">
                      <strong>#{j.payload.receiptNo}</strong>
                      <Badge tone={j.kind === 'TICKET' ? 'info' : 'default'}>
                        {j.kind === 'TICKET' ? 'Ticket' : 'Receipt'}
                      </Badge>
                      {j.payload.reprint && <Badge tone="warning">Reprint</Badge>}
                      <span className="muted small" style={{ marginLeft: 'auto' }}>
                        {formatDateTime(j.createdAt)}
                      </span>
                    </div>
                    {j.payload.kind === 'TICKET' && (
                      <ul className="job-items">
                        {j.payload.items.map((i, idx) => (
                          <li key={idx}>
                            <span className="ticket-qty">{i.quantity}×</span> {i.name}
                          </li>
                        ))}
                      </ul>
                    )}
                    {j.payload.customerName && (
                      <div className="small muted">For {j.payload.customerName}</div>
                    )}
                    <div className="job-actions">
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          void printJob(j);
                        }}
                        data-testid={`print-job-${j.id}`}
                      >
                        <Icon name="print" size={14} /> Print
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-checkout"
                        onClick={(e) => {
                          e.stopPropagation();
                          void markPrinted(j);
                        }}
                        data-testid={`done-job-${j.id}`}
                      >
                        <Icon name="check" size={14} /> Done
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
          <aside className="card">
            <div className="card-header">
              <h2>Preview</h2>
            </div>
            <div className="card-body print-area">
              {selected ? (
                <PrintTicket payload={selected.payload} />
              ) : (
                <p className="muted">
                  Select a job to preview it. The preview is what gets printed.
                </p>
              )}
            </div>
            {done.length > 0 && (
              <>
                <div className="card-header">
                  <h2>Recently printed</h2>
                </div>
                <div
                  className="card-body"
                  style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
                >
                  {done.map((j) => (
                    <div key={j.id} className="summary-row">
                      <span>
                        #{j.payload.receiptNo} · {j.kind === 'TICKET' ? 'Ticket' : 'Receipt'}
                      </span>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => void printJob(j, false)}
                      >
                        Reprint
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
