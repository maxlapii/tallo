import { z } from 'zod';
import { connect } from 'node:net';
import type { Database } from '../db/connection.js';
import { eventBus } from '../realtime/eventBus.js';
import { InvalidRequestError, NotFoundError } from '../utils/errors.js';
import { parseBody } from '../utils/validation.js';
import { recordAudit } from './auditService.js';
import { EscPos } from './escpos.js';
import type { AuthUser } from './types.js';

/* ------------------------------------------------------------------ */
/* Printers                                                             */
/* ------------------------------------------------------------------ */

export type PrinterType = 'BROWSER' | 'NETWORK';

interface PrinterRow {
  id: number;
  name: string;
  area: string;
  type: PrinterType;
  host: string | null;
  port: number | null;
  prints_receipts: number;
  prints_tickets: number;
  active: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Printer {
  id: number;
  name: string;
  area: string;
  type: PrinterType;
  host: string | null;
  port: number | null;
  printsReceipts: boolean;
  printsTickets: boolean;
  active: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export const printerInputSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    area: z.string().trim().min(1).max(40),
    type: z.enum(['BROWSER', 'NETWORK']),
    host: z.string().trim().max(200).nullable().optional(),
    port: z.number().int().min(1).max(65535).nullable().optional(),
    printsReceipts: z.boolean().optional(),
    printsTickets: z.boolean().optional(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'NETWORK' && !v.host) {
      ctx.addIssue({
        code: 'custom',
        path: ['host'],
        message: 'Network printers need a host or IP address',
      });
    }
  });
export type PrinterInput = z.infer<typeof printerInputSchema>;

function toPrinter(r: PrinterRow): Printer {
  return {
    id: r.id,
    name: r.name,
    area: r.area,
    type: r.type,
    host: r.host,
    port: r.port,
    printsReceipts: r.prints_receipts === 1,
    printsTickets: r.prints_tickets === 1,
    active: r.active === 1,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listPrinters(db: Database, includeInactive = true): Printer[] {
  const where = includeInactive ? '' : ' WHERE active = 1';
  return db
    .all<PrinterRow>(`SELECT * FROM printers${where} ORDER BY sort_order, name COLLATE NOCASE`)
    .map(toPrinter);
}

export function getPrinter(db: Database, id: number): Printer {
  const row = db.get<PrinterRow>('SELECT * FROM printers WHERE id = ?', [id]);
  if (!row) throw new NotFoundError('Printer not found');
  return toPrinter(row);
}

export function createPrinter(db: Database, actor: AuthUser, input: unknown): Printer {
  const d = parseBody(printerInputSchema, input);
  return db.transaction(() => {
    const r = db.run(
      `INSERT INTO printers (name, area, type, host, port, prints_receipts, prints_tickets, active, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        d.name,
        d.area,
        d.type,
        d.type === 'NETWORK' ? (d.host ?? null) : null,
        d.type === 'NETWORK' ? (d.port ?? 9100) : null,
        d.printsReceipts ? 1 : 0,
        d.printsTickets === false ? 0 : 1,
        d.active === false ? 0 : 1,
        d.sortOrder ?? 0,
      ],
    );
    recordAudit(db, {
      userId: actor.id,
      action: 'PRINTER_CREATE',
      entity: 'printers',
      entityId: r.lastInsertRowid,
      details: { name: d.name, area: d.area, type: d.type },
    });
    return getPrinter(db, r.lastInsertRowid);
  });
}

export function updatePrinter(db: Database, actor: AuthUser, id: number, input: unknown): Printer {
  const before = getPrinter(db, id);
  const d = parseBody(printerInputSchema, {
    ...printerToInput(before),
    ...(typeof input === 'object' && input !== null ? input : {}),
  });
  return db.transaction(() => {
    db.run(
      `UPDATE printers SET name = ?, area = ?, type = ?, host = ?, port = ?, prints_receipts = ?, prints_tickets = ?, active = ?,
         sort_order = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
      [
        d.name,
        d.area,
        d.type,
        d.type === 'NETWORK' ? (d.host ?? null) : null,
        d.type === 'NETWORK' ? (d.port ?? 9100) : null,
        d.printsReceipts ? 1 : 0,
        d.printsTickets === false ? 0 : 1,
        d.active === false ? 0 : 1,
        d.sortOrder ?? 0,
        id,
      ],
    );
    recordAudit(db, {
      userId: actor.id,
      action: 'PRINTER_UPDATE',
      entity: 'printers',
      entityId: id,
      details: { fields: Object.keys(input as object) },
    });
    return getPrinter(db, id);
  });
}

function printerToInput(p: Printer): PrinterInput {
  return {
    name: p.name,
    area: p.area,
    type: p.type,
    host: p.host,
    port: p.port,
    printsReceipts: p.printsReceipts,
    printsTickets: p.printsTickets,
    active: p.active,
    sortOrder: p.sortOrder,
  };
}

/** Printers referenced by jobs or routing are deactivated instead of deleted. */
export function deletePrinter(
  db: Database,
  actor: AuthUser,
  id: number,
): { deleted: boolean; deactivated: boolean } {
  return db.transaction(() => {
    getPrinter(db, id);
    const referenced =
      db.get('SELECT 1 FROM print_jobs WHERE printer_id = ? LIMIT 1', [id]) ??
      db.get('SELECT 1 FROM categories WHERE printer_id = ? LIMIT 1', [id]) ??
      db.get('SELECT 1 FROM products WHERE printer_id = ? LIMIT 1', [id]);
    if (referenced) {
      db.run(
        "UPDATE printers SET active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
        [id],
      );
      recordAudit(db, {
        userId: actor.id,
        action: 'PRINTER_DEACTIVATE',
        entity: 'printers',
        entityId: id,
      });
      return { deleted: false, deactivated: true };
    }
    db.run('DELETE FROM printers WHERE id = ?', [id]);
    recordAudit(db, {
      userId: actor.id,
      action: 'PRINTER_DELETE',
      entity: 'printers',
      entityId: id,
    });
    return { deleted: true, deactivated: false };
  });
}

/** Opens a TCP connection to a network printer to verify it is reachable. */
export function testPrinterConnection(
  printer: Printer,
  timeoutMs = 3000,
): Promise<{ ok: boolean; message: string }> {
  if (printer.type !== 'NETWORK')
    return Promise.resolve({
      ok: true,
      message: 'Browser printers print from a print station screen.',
    });
  return new Promise((resolve) => {
    const socket = connect({ host: printer.host ?? '', port: printer.port ?? 9100 });
    const done = (ok: boolean, message: string) => {
      socket.destroy();
      resolve({ ok, message });
    };
    socket.setTimeout(timeoutMs, () => done(false, 'Connection timed out'));
    socket.once('connect', () =>
      done(true, `Connected to ${printer.host}:${printer.port ?? 9100}`),
    );
    socket.once('error', (err) => done(false, err.message));
  });
}

/* ------------------------------------------------------------------ */
/* Routing                                                              */
/* ------------------------------------------------------------------ */

/** Effective printer per product: product override, else the category's printer. */
export function resolveProductPrinters(
  db: Database,
  productIds: number[],
): Map<number, number | null> {
  const unique = [...new Set(productIds)];
  const map = new Map<number, number | null>();
  if (unique.length === 0) return map;
  const rows = db.all<{ id: number; printer_id: number | null }>(
    `SELECT p.id, COALESCE(p.printer_id, c.printer_id) AS printer_id
     FROM products p LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.id IN (${unique.map(() => '?').join(',')})`,
    unique,
  );
  for (const r of rows) map.set(r.id, r.printer_id);
  return map;
}

/* ------------------------------------------------------------------ */
/* Jobs                                                                 */
/* ------------------------------------------------------------------ */

export type JobKind = 'RECEIPT' | 'TICKET';
export type JobStatus = 'QUEUED' | 'SENDING' | 'PRINTED' | 'FAILED';

export interface TicketPayload {
  kind: 'TICKET';
  area: string;
  storeName: string;
  receiptNo: string;
  createdAt: string;
  cashier: string;
  customerName: string | null;
  note: string | null;
  items: { name: string; quantity: number; sku: string }[];
  reprint: boolean;
}

export interface ReceiptPayload {
  kind: 'RECEIPT';
  storeName: string;
  receiptNo: string;
  createdAt: string;
  cashier: string;
  customerName: string | null;
  items: { name: string; quantity: number; unitPrice: number; total: number }[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  payments: { method: string; amount: number }[];
  received: number;
  change: number;
  reprint: boolean;
}

export type JobPayload = TicketPayload | ReceiptPayload;

interface JobRow {
  id: number;
  sale_id: number;
  printer_id: number;
  printer_name?: string;
  printer_area?: string;
  printer_type?: PrinterType;
  kind: JobKind;
  status: JobStatus;
  payload: string;
  error: string | null;
  attempts: number;
  created_at: string;
  printed_at: string | null;
}

export interface PrintJob {
  id: number;
  saleId: number;
  printerId: number;
  printerName: string;
  printerArea: string;
  printerType: PrinterType;
  kind: JobKind;
  status: JobStatus;
  payload: JobPayload;
  error: string | null;
  attempts: number;
  createdAt: string;
  printedAt: string | null;
}

const JOB_SELECT = `SELECT j.*, p.name AS printer_name, p.area AS printer_area, p.type AS printer_type
                    FROM print_jobs j JOIN printers p ON p.id = j.printer_id`;

function toJob(r: JobRow): PrintJob {
  return {
    id: r.id,
    saleId: r.sale_id,
    printerId: r.printer_id,
    printerName: r.printer_name ?? '',
    printerArea: r.printer_area ?? '',
    printerType: r.printer_type ?? 'BROWSER',
    kind: r.kind,
    status: r.status,
    payload: JSON.parse(r.payload) as JobPayload,
    error: r.error,
    attempts: r.attempts,
    createdAt: r.created_at,
    printedAt: r.printed_at,
  };
}

export function getJob(db: Database, id: number): PrintJob {
  const row = db.get<JobRow>(`${JOB_SELECT} WHERE j.id = ?`, [id]);
  if (!row) throw new NotFoundError('Print job not found');
  return toJob(row);
}

export interface JobFilter {
  printerId?: number | undefined;
  status?: JobStatus | undefined;
  saleId?: number | undefined;
  limit?: number | undefined;
}

export function listJobs(db: Database, filter: JobFilter = {}): PrintJob[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.printerId !== undefined) {
    where.push('j.printer_id = ?');
    params.push(filter.printerId);
  }
  if (filter.status !== undefined) {
    where.push('j.status = ?');
    params.push(filter.status);
  }
  if (filter.saleId !== undefined) {
    where.push('j.sale_id = ?');
    params.push(filter.saleId);
  }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  return db
    .all<JobRow>(`${JOB_SELECT}${whereSql} ORDER BY j.id DESC LIMIT ?`, [...params, limit])
    .map(toJob);
}

interface SaleForPrint {
  id: number;
  receipt_no: string;
  created_at: string;
  cashier_name: string;
  customer_name: string | null;
  note: string | null;
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
  paid_cents: number;
  change_cents: number;
}

/**
 * Creates the print jobs for a sale: one TICKET per area that has routed
 * items (only that area's items), and one RECEIPT per printer that prints
 * receipts. Runs in its own transaction after the sale has committed, so a
 * printing problem can never roll back a sale. Returns the created jobs.
 */
export function enqueueJobsForSale(
  db: Database,
  storeName: string,
  saleId: number,
  options: { reprint?: boolean; kinds?: JobKind[] } = {},
): PrintJob[] {
  const sale = db.get<SaleForPrint>(
    `SELECT s.id, s.receipt_no, s.created_at, u.full_name AS cashier_name, c.name AS customer_name, s.note,
            s.subtotal_cents, s.discount_cents, s.tax_cents, s.total_cents, s.paid_cents, s.change_cents
     FROM sales s JOIN users u ON u.id = s.cashier_id LEFT JOIN customers c ON c.id = s.customer_id WHERE s.id = ?`,
    [saleId],
  );
  if (!sale) throw new NotFoundError('Sale not found');
  const items = db.all<{
    product_id: number;
    product_name: string;
    product_sku: string;
    quantity: number;
    unit_price_cents: number;
    subtotal_cents: number;
  }>(
    'SELECT product_id, product_name, product_sku, quantity, unit_price_cents, subtotal_cents FROM sale_items WHERE sale_id = ? ORDER BY id',
    [saleId],
  );
  const payments = db.all<{ payment_method: string; amount_cents: number }>(
    'SELECT payment_method, amount_cents FROM payments WHERE sale_id = ? ORDER BY id',
    [saleId],
  );
  const printers = listPrinters(db, false);
  const kinds = new Set(options.kinds ?? ['TICKET', 'RECEIPT']);
  const reprint = options.reprint ?? false;
  const routing = resolveProductPrinters(
    db,
    items.map((i) => i.product_id),
  );

  const jobs: { printerId: number; kind: JobKind; payload: JobPayload }[] = [];
  if (kinds.has('TICKET')) {
    for (const printer of printers.filter((p) => p.printsTickets)) {
      const routed = items.filter((i) => routing.get(i.product_id) === printer.id);
      if (routed.length === 0) continue;
      jobs.push({
        printerId: printer.id,
        kind: 'TICKET',
        payload: {
          kind: 'TICKET',
          area: printer.area,
          storeName,
          receiptNo: sale.receipt_no,
          createdAt: sale.created_at,
          cashier: sale.cashier_name,
          customerName: sale.customer_name,
          note: sale.note,
          items: routed.map((i) => ({
            name: i.product_name,
            quantity: i.quantity,
            sku: i.product_sku,
          })),
          reprint,
        },
      });
    }
  }
  if (kinds.has('RECEIPT')) {
    for (const printer of printers.filter((p) => p.printsReceipts)) {
      jobs.push({
        printerId: printer.id,
        kind: 'RECEIPT',
        payload: {
          kind: 'RECEIPT',
          storeName,
          receiptNo: sale.receipt_no,
          createdAt: sale.created_at,
          cashier: sale.cashier_name,
          customerName: sale.customer_name,
          items: items.map((i) => ({
            name: i.product_name,
            quantity: i.quantity,
            unitPrice: i.unit_price_cents / 100,
            total: i.subtotal_cents / 100,
          })),
          subtotal: sale.subtotal_cents / 100,
          discount: sale.discount_cents / 100,
          tax: sale.tax_cents / 100,
          total: sale.total_cents / 100,
          payments: payments.map((p) => ({
            method: p.payment_method,
            amount: p.amount_cents / 100,
          })),
          received: sale.paid_cents / 100,
          change: sale.change_cents / 100,
          reprint,
        },
      });
    }
  }

  const created = db.transaction(() =>
    jobs.map((j) => {
      const r = db.run(
        'INSERT INTO print_jobs (sale_id, printer_id, kind, payload) VALUES (?, ?, ?, ?)',
        [saleId, j.printerId, j.kind, JSON.stringify(j.payload)],
      );
      return getJob(db, r.lastInsertRowid);
    }),
  );
  for (const job of created) {
    eventBus.broadcast({
      type: 'print.job',
      payload: {
        jobId: job.id,
        printerId: job.printerId,
        printerArea: job.printerArea,
        kind: job.kind,
        saleId,
        receiptNo: sale.receipt_no,
        status: job.status,
      },
    });
  }
  return created;
}

/** A print station (browser printer) confirms it printed the job. */
export function markJobPrinted(db: Database, id: number): PrintJob {
  const job = getJob(db, id);
  db.run(
    "UPDATE print_jobs SET status = 'PRINTED', error = NULL, printed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
    [id],
  );
  const updated = getJob(db, id);
  eventBus.broadcast({
    type: 'print.job',
    payload: {
      jobId: id,
      printerId: job.printerId,
      printerArea: job.printerArea,
      kind: job.kind,
      saleId: job.saleId,
      receiptNo: job.payload.receiptNo,
      status: 'PRINTED',
    },
  });
  return updated;
}

/** Puts a FAILED/PRINTED job back in the queue (reprint). */
export function requeueJob(db: Database, id: number): PrintJob {
  getJob(db, id);
  db.run("UPDATE print_jobs SET status = 'QUEUED', error = NULL, printed_at = NULL WHERE id = ?", [
    id,
  ]);
  const job = getJob(db, id);
  eventBus.broadcast({
    type: 'print.job',
    payload: {
      jobId: id,
      printerId: job.printerId,
      printerArea: job.printerArea,
      kind: job.kind,
      saleId: job.saleId,
      receiptNo: job.payload.receiptNo,
      status: 'QUEUED',
    },
  });
  return job;
}

/* ------------------------------------------------------------------ */
/* Network dispatch (ESC/POS over TCP)                                  */
/* ------------------------------------------------------------------ */

export function renderEscPos(payload: JobPayload): Buffer {
  const p = new EscPos();
  const when = new Date(payload.createdAt);
  const time = `${when.toISOString().slice(0, 10)} ${when.toISOString().slice(11, 16)}`;
  if (payload.kind === 'TICKET') {
    p.align('center').big(true).bold(true).line(payload.area.toUpperCase()).big(false).bold(false);
    if (payload.reprint) p.line('** REPRINT **');
    p.line(`Order #${payload.receiptNo}`).line(time).align('left').rule();
    if (payload.customerName) p.line(`For: ${payload.customerName}`);
    p.bold(true).big(true);
    for (const i of payload.items) p.line(`${i.quantity} x ${i.name}`);
    p.big(false).bold(false);
    if (payload.note) p.rule().line(`Note: ${payload.note}`);
    p.rule().line(`Server: ${payload.cashier}`).feed().cut();
    return p.toBuffer();
  }
  p.align('center').bold(true).big(true).line(payload.storeName).big(false).bold(false);
  if (payload.reprint) p.line('** REPRINT **');
  p.line(`Receipt #${payload.receiptNo}`)
    .line(time)
    .line(`Cashier: ${payload.cashier}`)
    .align('left')
    .rule();
  for (const i of payload.items)
    p.row(`${i.quantity} x ${i.name}`.slice(0, 30), i.total.toFixed(2));
  p.rule().row('Subtotal', payload.subtotal.toFixed(2));
  if (payload.discount > 0) p.row('Discount', `-${payload.discount.toFixed(2)}`);
  p.row('Tax', payload.tax.toFixed(2))
    .bold(true)
    .row('TOTAL', payload.total.toFixed(2))
    .bold(false)
    .rule();
  for (const pay of payload.payments) p.row(pay.method, pay.amount.toFixed(2));
  p.row('Received', payload.received.toFixed(2))
    .row('Change', payload.change.toFixed(2))
    .rule()
    .align('center')
    .line('Thank you')
    .feed()
    .cut();
  return p.toBuffer();
}

function sendToPrinter(host: string, port: number, data: Buffer, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };
    socket.setTimeout(timeoutMs, () => finish(new Error('Printer connection timed out')));
    socket.once('error', (err) => finish(err));
    socket.once('connect', () => {
      socket.write(data, (err) => {
        if (err) finish(err);
        else socket.end(() => finish());
      });
    });
  });
}

/**
 * Sends one queued job to its network printer. Claims the job atomically
 * (QUEUED → SENDING) so concurrent dispatchers never double-print.
 */
export async function dispatchJob(db: Database, id: number): Promise<PrintJob> {
  const claimed = db.run(
    "UPDATE print_jobs SET status = 'SENDING', attempts = attempts + 1 WHERE id = ? AND status = 'QUEUED'",
    [id],
  );
  if (claimed.changes === 0) return getJob(db, id);
  const job = getJob(db, id);
  const printer = getPrinter(db, job.printerId);
  if (printer.type !== 'NETWORK') {
    // Browser printers are served by a print station; leave the job queued.
    db.run("UPDATE print_jobs SET status = 'QUEUED' WHERE id = ?", [id]);
    return getJob(db, id);
  }
  try {
    await sendToPrinter(printer.host ?? '', printer.port ?? 9100, renderEscPos(job.payload));
    db.run(
      "UPDATE print_jobs SET status = 'PRINTED', error = NULL, printed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
      [id],
    );
  } catch (err) {
    db.run("UPDATE print_jobs SET status = 'FAILED', error = ? WHERE id = ?", [
      (err as Error).message,
      id,
    ]);
  }
  const updated = getJob(db, id);
  eventBus.broadcast({
    type: 'print.job',
    payload: {
      jobId: id,
      printerId: job.printerId,
      printerArea: job.printerArea,
      kind: job.kind,
      saleId: job.saleId,
      receiptNo: job.payload.receiptNo,
      status: updated.status,
    },
  });
  return updated;
}

/** Dispatches every queued job that belongs to a network printer. */
export async function dispatchQueuedNetworkJobs(db: Database): Promise<PrintJob[]> {
  const ids = db
    .all<{ id: number }>(
      "SELECT j.id FROM print_jobs j JOIN printers p ON p.id = j.printer_id WHERE j.status = 'QUEUED' AND p.type = 'NETWORK' ORDER BY j.id",
    )
    .map((r) => r.id);
  const results: PrintJob[] = [];
  for (const id of ids) results.push(await dispatchJob(db, id));
  return results;
}

export const routingSchema = z.object({ printerId: z.number().int().positive().nullable() });

export function assertPrinterExists(db: Database, printerId: number | null | undefined): void {
  if (printerId === null || printerId === undefined) return;
  if (!db.get('SELECT id FROM printers WHERE id = ?', [printerId]))
    throw new InvalidRequestError('Printer not found');
}
