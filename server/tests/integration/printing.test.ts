import { createServer, type Server } from 'node:net';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eventBus, type LiveEvent } from '../../src/realtime/eventBus.js';
import {
  dispatchQueuedNetworkJobs,
  renderEscPos,
  resolveProductPrinters,
  type PrintJob,
} from '../../src/services/printService.js';
import {
  createTestApp,
  loginAs,
  openRegisterFor,
  productIdBySku,
  type TestContext,
} from '../helpers.js';

/** Fake ESC/POS printer: a TCP server that records what it receives. */
function fakePrinter(): Promise<{ server: Server; port: number; received: Buffer[] }> {
  return new Promise((resolve) => {
    const received: Buffer[] = [];
    const server = createServer((socket) => {
      socket.on('data', (chunk) => received.push(Buffer.from(chunk)));
    });
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, port: (server.address() as AddressInfo).port, received }),
    );
  });
}

describe('printers and routing', () => {
  let ctx: TestContext;
  let admin: string;
  let cashier: string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  beforeEach(async () => {
    ctx = createTestApp({ storeName: 'Test Store' });
    admin = await loginAs(ctx.app, 'admin');
    cashier = await loginAs(ctx.app, 'cashier');
  });
  afterEach(() => ctx.db.close());

  it('seeds one printer per area and routes categories to them', async () => {
    const res = await request(ctx.app).get('/api/printers').set(auth(cashier));
    expect(res.status).toBe(200);
    expect(res.body.printers.map((p: { area: string }) => p.area)).toEqual([
      'Counter',
      'Drink maker',
      'Kitchen 1',
      'Kitchen 2',
    ]);
    const counter = res.body.printers[0];
    expect(counter).toMatchObject({ type: 'BROWSER', printsReceipts: true, printsTickets: false });
    const cats = await request(ctx.app).get('/api/categories').set(auth(cashier));
    const byName = Object.fromEntries(
      cats.body.categories.map((c: { name: string; printerId: number }) => [c.name, c.printerId]),
    );
    const byArea = Object.fromEntries(
      res.body.printers.map((p: { area: string; id: number }) => [p.area, p.id]),
    );
    expect(byName.Beverages).toBe(byArea['Drink maker']);
    expect(byName.Food).toBe(byArea['Kitchen 1']);
    expect(byName.Snacks).toBe(byArea['Kitchen 2']);
  });

  it('admin can create, update, test, and delete printers; cashier cannot', async () => {
    const created = await request(ctx.app)
      .post('/api/printers')
      .set(auth(admin))
      .send({ name: 'Bar', area: 'Bar', type: 'NETWORK', host: '192.0.2.10' });
    expect(created.status).toBe(201);
    expect(created.body.printer).toMatchObject({
      area: 'Bar',
      type: 'NETWORK',
      host: '192.0.2.10',
      port: 9100,
      printsTickets: true,
      printsReceipts: false,
      active: true,
    });
    const id = created.body.printer.id;
    const updated = await request(ctx.app)
      .put(`/api/printers/${id}`)
      .set(auth(admin))
      .send({ port: 9101, printsReceipts: true });
    expect(updated.body.printer).toMatchObject({
      port: 9101,
      printsReceipts: true,
      host: '192.0.2.10',
    });
    const bad = await request(ctx.app)
      .post('/api/printers')
      .set(auth(admin))
      .send({ name: 'X', area: 'X', type: 'NETWORK' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details).toHaveProperty('host');
    const test = await request(ctx.app).post(`/api/printers/${id}/test`).set(auth(admin));
    expect(test.status).toBe(200);
    expect(test.body.ok).toBe(false); // unreachable documentation address
    const deleted = await request(ctx.app).delete(`/api/printers/${id}`).set(auth(admin));
    expect(deleted.body).toEqual({ deleted: true, deactivated: false });
    expect(
      (
        await request(ctx.app)
          .post('/api/printers')
          .set(auth(cashier))
          .send({ name: 'X', area: 'X', type: 'BROWSER' })
      ).status,
    ).toBe(403);
    expect((await request(ctx.app).get('/api/printers').set(auth(cashier))).status).toBe(200);
  });

  it('product printer override beats the category printer', async () => {
    const printers = (await request(ctx.app).get('/api/printers').set(auth(admin))).body
      .printers as { id: number; area: string }[];
    const kitchen2 = printers.find((p) => p.area === 'Kitchen 2')!.id;
    const drinks = printers.find((p) => p.area === 'Drink maker')!.id;
    const coke = productIdBySku(ctx.db, 'COKE-001');
    expect(resolveProductPrinters(ctx.db, [coke]).get(coke)).toBe(drinks);
    const res = await request(ctx.app)
      .put(`/api/products/${coke}`)
      .set(auth(admin))
      .send({ printerId: kitchen2 });
    expect(res.body.product.printerId).toBe(kitchen2);
    expect(resolveProductPrinters(ctx.db, [coke]).get(coke)).toBe(kitchen2);
    await request(ctx.app).put(`/api/products/${coke}`).set(auth(admin)).send({ printerId: null });
    expect(resolveProductPrinters(ctx.db, [coke]).get(coke)).toBe(drinks);
    expect(
      (
        await request(ctx.app)
          .put(`/api/products/${coke}`)
          .set(auth(admin))
          .send({ printerId: 999 })
      ).status,
    ).toBe(400);
  });

  it("a sale creates one ticket per area with only that area's items plus the counter receipt", async () => {
    await openRegisterFor(ctx.app, cashier, 100);
    const coke = productIdBySku(ctx.db, 'COKE-001'); // Drink maker
    const burger = productIdBySku(ctx.db, 'BURGER-001'); // Kitchen 1
    const fries = productIdBySku(ctx.db, 'FRIES-001'); // Kitchen 1
    const events: LiveEvent[] = [];
    const off = eventBus.subscribe((e) => events.push(e));
    let saleId: number;
    try {
      const res = await request(ctx.app)
        .post('/api/sales')
        .set(auth(cashier))
        .send({
          items: [
            { productId: coke, quantity: 2 },
            { productId: burger, quantity: 1 },
            { productId: fries, quantity: 3 },
          ],
          payments: [{ method: 'CASH', amount: 20 }],
        });
      expect(res.status).toBe(201);
      saleId = res.body.sale.id;
    } finally {
      off();
    }
    const jobs = (
      await request(ctx.app).get(`/api/print-jobs?saleId=${saleId!}`).set(auth(cashier))
    ).body.jobs as PrintJob[];
    const byArea = Object.fromEntries(jobs.map((j) => [j.printerArea, j]));
    expect(Object.keys(byArea).sort()).toEqual(['Counter', 'Drink maker', 'Kitchen 1']);
    expect(byArea['Kitchen 2']).toBeUndefined(); // no snacks ordered
    expect(byArea['Drink maker']!.kind).toBe('TICKET');
    expect(byArea['Drink maker']!.payload).toMatchObject({
      kind: 'TICKET',
      area: 'Drink maker',
      items: [{ name: 'Coca Cola', quantity: 2 }],
    });
    expect((byArea['Kitchen 1']!.payload as { items: unknown[] }).items).toEqual([
      { name: 'Burger', quantity: 1, sku: 'BURGER-001' },
      { name: 'French Fries', quantity: 3, sku: 'FRIES-001' },
    ]);
    expect(byArea.Counter!.kind).toBe('RECEIPT');
    expect(byArea.Counter!.payload).toMatchObject({
      kind: 'RECEIPT',
      storeName: 'Test Store',
      total: 19.8,
      received: 20,
      change: 0.2,
    });
    expect(jobs.every((j) => j.status === 'QUEUED')).toBe(true);
    const printEvents = events.filter((e) => e.type === 'print.job');
    expect(printEvents).toHaveLength(3);
  });

  it('a print station can list its queue and acknowledge a browser job', async () => {
    await openRegisterFor(ctx.app, cashier, 100);
    const sale = await loginAs(ctx.app, 'sale');
    const coke = productIdBySku(ctx.db, 'COKE-001');
    await request(ctx.app)
      .post('/api/sales')
      .set(auth(sale))
      .send({
        items: [{ productId: coke, quantity: 1 }],
        payments: [{ method: 'CASH', amount: 5 }],
      });
    const printers = (await request(ctx.app).get('/api/printers').set(auth(sale))).body
      .printers as { id: number; area: string }[];
    const drinks = printers.find((p) => p.area === 'Drink maker')!.id;
    const queue = await request(ctx.app)
      .get(`/api/print-jobs?printerId=${drinks}&status=QUEUED`)
      .set(auth(sale));
    expect(queue.body.jobs).toHaveLength(1);
    const job = queue.body.jobs[0];
    const ack = await request(ctx.app).post(`/api/print-jobs/${job.id}/printed`).set(auth(sale));
    expect(ack.body.job.status).toBe('PRINTED');
    expect(ack.body.job.printedAt).toBeTruthy();
    expect(
      (
        await request(ctx.app)
          .get(`/api/print-jobs?printerId=${drinks}&status=QUEUED`)
          .set(auth(sale))
      ).body.jobs,
    ).toHaveLength(0);
    // reprint puts it back in the queue
    const retry = await request(ctx.app).post(`/api/print-jobs/${job.id}/retry`).set(auth(cashier));
    expect(retry.body.job.status).toBe('QUEUED');
    expect(
      (await request(ctx.app).post(`/api/print-jobs/${job.id}/retry`).set(auth(sale))).status,
    ).toBe(403);
    expect(
      (await request(ctx.app).get('/api/print-jobs?status=BOGUS').set(auth(cashier))).status,
    ).toBe(400);
  });

  it('network printers receive ESC/POS bytes over TCP and failures are recorded with retry', async () => {
    const printer = await fakePrinter();
    try {
      const created = await request(ctx.app).post('/api/printers').set(auth(admin)).send({
        name: 'Kitchen TCP',
        area: 'Kitchen TCP',
        type: 'NETWORK',
        host: '127.0.0.1',
        port: printer.port,
      });
      const tcpId = created.body.printer.id;
      const cats = (await request(ctx.app).get('/api/categories').set(auth(admin))).body
        .categories as { id: number; name: string }[];
      const food = cats.find((c) => c.name === 'Food')!.id;
      await request(ctx.app)
        .put(`/api/categories/${food}`)
        .set(auth(admin))
        .send({ printerId: tcpId });
      const test = await request(ctx.app).post(`/api/printers/${tcpId}/test`).set(auth(admin));
      expect(test.body.ok).toBe(true);

      await openRegisterFor(ctx.app, cashier, 100);
      const burger = productIdBySku(ctx.db, 'BURGER-001');
      const res = await request(ctx.app)
        .post('/api/sales')
        .set(auth(cashier))
        .send({
          items: [{ productId: burger, quantity: 2 }],
          payments: [{ method: 'CARD', amount: 11 }],
          customerName: 'Table 4',
        });
      expect(res.status).toBe(201);
      // The sale response returns before dispatch; wait for the dispatcher to finish.
      await dispatchQueuedNetworkJobs(ctx.db);
      await new Promise((r) => setTimeout(r, 150));
      const jobs = (
        await request(ctx.app).get(`/api/print-jobs?printerId=${tcpId}`).set(auth(cashier))
      ).body.jobs as PrintJob[];
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.status).toBe('PRINTED');
      expect(jobs[0]!.attempts).toBe(1);
      const bytes = Buffer.concat(printer.received);
      expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0x1b, 0x40])); // ESC @ init
      const text = bytes.toString('latin1');
      expect(text).toContain('KITCHEN TCP');
      expect(text).toContain('2 x Burger');
      expect(text).toContain('For: Table 4');
      expect(bytes.subarray(-3)).toEqual(Buffer.from([0x1d, 0x56, 0x00])); // full cut

      // Printer goes offline: job fails and can be retried later.
      await new Promise<void>((resolve) => printer.server.close(() => resolve()));
      const reprint = await request(ctx.app)
        .post(`/api/sales/${res.body.sale.id}/print`)
        .set(auth(cashier))
        .send({ kinds: ['TICKET'] });
      expect(reprint.status).toBe(201);
      const failed = reprint.body.jobs.find((j: PrintJob) => j.printerId === tcpId) as PrintJob;
      expect(failed.status).toBe('FAILED');
      expect(failed.error).toMatch(/ECONNREFUSED|timed out/);
      expect((failed.payload as { reprint: boolean }).reprint).toBe(true);
      const again = await request(ctx.app)
        .post(`/api/print-jobs/${failed.id}/retry`)
        .set(auth(cashier));
      expect(again.body.job.status).toBe('FAILED');
      expect(again.body.job.attempts).toBe(2);
    } finally {
      printer.server.close();
    }
  });

  it('printing problems never fail the sale', async () => {
    await openRegisterFor(ctx.app, cashier, 100);
    ctx.db.exec(
      "CREATE TRIGGER fail_print BEFORE INSERT ON print_jobs BEGIN SELECT RAISE(ABORT, 'printer table broken'); END",
    );
    const coke = productIdBySku(ctx.db, 'COKE-001');
    const res = await request(ctx.app)
      .post('/api/sales')
      .set(auth(cashier))
      .send({
        items: [{ productId: coke, quantity: 1 }],
        payments: [{ method: 'CASH', amount: 5 }],
      });
    expect(res.status).toBe(201);
    expect(
      (await request(ctx.app).get(`/api/print-jobs?saleId=${res.body.sale.id}`).set(auth(cashier)))
        .body.jobs,
    ).toHaveLength(0);
  });
});

describe('renderEscPos', () => {
  it('renders a receipt with totals and a cut', () => {
    const bytes = renderEscPos({
      kind: 'RECEIPT',
      storeName: 'Shop',
      receiptNo: '000009',
      createdAt: '2026-01-02T03:04:05.000Z',
      cashier: 'Cash Ier',
      customerName: null,
      items: [{ name: 'Coca Cola', quantity: 2, unitPrice: 2, total: 4 }],
      subtotal: 4,
      discount: 0.5,
      tax: 0.35,
      total: 3.85,
      payments: [{ method: 'CASH', amount: 5 }],
      received: 5,
      change: 1.15,
      reprint: true,
    });
    const text = bytes.toString('latin1');
    expect(text).toContain('Shop');
    expect(text).toContain('** REPRINT **');
    expect(text).toContain('Receipt #000009');
    expect(text).toContain('2026-01-02 03:04');
    expect(text).toMatch(/2 x Coca Cola\s+4\.00/);
    expect(text).toMatch(/Discount\s+-0\.50/);
    expect(text).toMatch(/TOTAL\s+3\.85/);
    expect(text).toMatch(/Change\s+1\.15/);
    expect(bytes.subarray(-3)).toEqual(Buffer.from([0x1d, 0x56, 0x00]));
  });
});
