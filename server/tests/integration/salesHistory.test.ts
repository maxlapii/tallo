import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bearer,
  createTestApp,
  loginAs,
  openRegisterFor,
  productIdBySku,
  type TestContext,
} from '../helpers.js';

describe('GET /api/sales (history)', () => {
  let ctx: TestContext;
  let cashier: string;
  let admin: string;
  beforeEach(async () => {
    ctx = createTestApp();
    cashier = await loginAs(ctx.app, 'cashier');
    admin = await loginAs(ctx.app, 'admin');
    await openRegisterFor(ctx.app, cashier);
    await openRegisterFor(ctx.app, admin);
    const coke = productIdBySku(ctx.db, 'COKE-001');
    await request(ctx.app)
      .post('/api/sales')
      .set(bearer(cashier))
      .send({
        items: [{ productId: coke, quantity: 1 }],
        payments: [{ method: 'CASH', amount: 5 }],
      });
    await request(ctx.app)
      .post('/api/sales')
      .set(bearer(cashier))
      .send({
        items: [{ productId: coke, quantity: 1 }],
        payments: [{ method: 'CARD', amount: 2.2 }],
      });
    await request(ctx.app)
      .post('/api/sales')
      .set(bearer(admin))
      .send({
        items: [{ productId: coke, quantity: 2 }],
        payments: [{ method: 'QR', amount: 4.4 }],
      });
    ctx.db.run(
      "UPDATE sales SET created_at = '2020-01-15T10:00:00.000Z' WHERE receipt_no = '000001'",
    );
  });
  afterEach(() => ctx.db.close());

  it('lists sales newest first with summary fields', async () => {
    const res = await request(ctx.app).get('/api/sales').set(bearer(cashier));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.sales.map((s: { receiptNo: string }) => s.receiptNo)).toEqual([
      '000003',
      '000002',
      '000001',
    ]);
    expect(res.body.sales[0]).toMatchObject({
      cashierName: 'Store Admin',
      total: 4.4,
      paymentMethods: ['QR'],
      status: 'COMPLETED',
    });
  });

  it('filters by date range', async () => {
    const old = await request(ctx.app)
      .get('/api/sales?from=2020-01-01&to=2020-01-31')
      .set(bearer(cashier));
    expect(old.body.sales.map((s: { receiptNo: string }) => s.receiptNo)).toEqual(['000001']);
    const none = await request(ctx.app)
      .get('/api/sales?from=2019-01-01&to=2019-12-31')
      .set(bearer(cashier));
    expect(none.body.total).toBe(0);
    expect((await request(ctx.app).get('/api/sales?from=bad').set(bearer(cashier))).status).toBe(
      400,
    );
  });

  it('filters by receipt number, cashier, and payment method', async () => {
    const byReceipt = await request(ctx.app)
      .get('/api/sales?receiptNo=000002')
      .set(bearer(cashier));
    expect(byReceipt.body.sales).toHaveLength(1);
    const adminId = ctx.db.get<{ id: number }>("SELECT id FROM users WHERE username = 'admin'")!.id;
    const byCashier = await request(ctx.app)
      .get(`/api/sales?cashierId=${adminId}`)
      .set(bearer(cashier));
    expect(byCashier.body.sales.map((s: { receiptNo: string }) => s.receiptNo)).toEqual(['000003']);
    const byMethod = await request(ctx.app)
      .get('/api/sales?paymentMethod=CARD')
      .set(bearer(cashier));
    expect(byMethod.body.sales.map((s: { receiptNo: string }) => s.receiptNo)).toEqual(['000002']);
    expect(
      (await request(ctx.app).get('/api/sales?paymentMethod=BITCOIN').set(bearer(cashier))).status,
    ).toBe(400);
    expect((await request(ctx.app).get('/api/sales?status=VOID').set(bearer(cashier))).status).toBe(
      400,
    );
  });

  it('paginates', async () => {
    const page = await request(ctx.app).get('/api/sales?limit=2&offset=1').set(bearer(cashier));
    expect(page.body.total).toBe(3);
    expect(page.body.sales.map((s: { receiptNo: string }) => s.receiptNo)).toEqual([
      '000002',
      '000001',
    ]);
  });

  it('completed sales are immutable: no update/delete routes exist', async () => {
    expect(
      (await request(ctx.app).put('/api/sales/1').set(bearer(admin)).send({ total: 0 })).status,
    ).toBe(404);
    expect((await request(ctx.app).delete('/api/sales/1').set(bearer(admin))).status).toBe(404);
    expect(
      (await request(ctx.app).patch('/api/sales/1').set(bearer(admin)).send({ total: 0 })).status,
    ).toBe(404);
  });
});
