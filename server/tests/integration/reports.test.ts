import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { todayUtc } from '../../src/services/reportService.js';
import {
  bearer,
  createTestApp,
  loginAs,
  openRegisterFor,
  productIdBySku,
  type TestContext,
} from '../helpers.js';

describe('/api/reports', () => {
  let ctx: TestContext;
  let cashier: string;
  let coke: number;
  let burger: number;
  const today = todayUtc();
  beforeEach(async () => {
    ctx = createTestApp();
    cashier = await loginAs(ctx.app, 'cashier');
    await openRegisterFor(ctx.app, cashier, 100);
    coke = productIdBySku(ctx.db, 'COKE-001'); // 2.00 @10%
    burger = productIdBySku(ctx.db, 'BURGER-001'); // 5.00 @10%
    // Sale 1: 2 coke + 1 burger, discount 0.50 => 9.35 cash 10 (change 0.65)
    const s1 = await request(ctx.app)
      .post('/api/sales')
      .set(bearer(cashier))
      .send({
        items: [
          { productId: coke, quantity: 2 },
          { productId: burger, quantity: 1 },
        ],
        discount: 0.5,
        payments: [{ method: 'CASH', amount: 10 }],
      });
    // Sale 2: 3 burger => 16.50 card
    await request(ctx.app)
      .post('/api/sales')
      .set(bearer(cashier))
      .send({
        items: [{ productId: burger, quantity: 3 }],
        payments: [{ method: 'CARD', amount: 16.5 }],
      });
    // Sale 3: 1 coke => 2.20 split QR 1.20 + cash 1.00
    await request(ctx.app)
      .post('/api/sales')
      .set(bearer(cashier))
      .send({
        items: [{ productId: coke, quantity: 1 }],
        payments: [
          { method: 'QR', amount: 1.2 },
          { method: 'CASH', amount: 1 },
        ],
      });
    // Refund 1 coke from sale 1 (cash): coke line total (4.00 - 0.22 discount alloc + tax) / 2
    await request(ctx.app)
      .post(`/api/sales/${s1.body.sale.id}/refund`)
      .set(bearer(cashier))
      .send({
        items: [{ saleItemId: s1.body.sale.items[0].id, quantity: 1 }],
        refundMethod: 'CASH',
      });
  });
  afterEach(() => ctx.db.close());

  it('daily sales report totals match the known sales', async () => {
    const res = await request(ctx.app).get(`/api/reports/daily?date=${today}`).set(bearer(cashier));
    expect(res.status).toBe(200);
    const r = res.body.report;
    expect(r).toMatchObject({
      from: today,
      to: today,
      transactions: 3,
      grossSales: 26,
      discounts: 0.5,
      tax: 2.55,
      netSales: 28.05,
      refundCount: 1,
      itemsSold: 7,
    });
    expect(r.refunds).toBeGreaterThan(0);
    expect(r.netAfterRefunds).toBeCloseTo(r.netSales - r.refunds, 2);
    expect(r.averageSale).toBeCloseTo(r.netSales / 3, 2);
  });

  it('daily report is empty for a day without sales and defaults to today', async () => {
    const empty = await request(ctx.app)
      .get('/api/reports/daily?date=2000-01-01')
      .set(bearer(cashier));
    expect(empty.body.report).toMatchObject({
      transactions: 0,
      grossSales: 0,
      netSales: 0,
      refunds: 0,
      averageSale: 0,
    });
    const def = await request(ctx.app).get('/api/reports/daily').set(bearer(cashier));
    expect(def.body.report.from).toBe(today);
    expect(
      (
        await request(ctx.app)
          .get('/api/reports/daily?from=2024-02-01&to=2024-01-01')
          .set(bearer(cashier))
      ).status,
    ).toBe(400);
  });

  it('payment summary reports cash (net of change), card, qr, and refunds', async () => {
    const res = await request(ctx.app)
      .get(`/api/reports/payments?date=${today}`)
      .set(bearer(cashier));
    const r = res.body.report;
    const cash = r.methods.find((m: { method: string }) => m.method === 'CASH');
    const card = r.methods.find((m: { method: string }) => m.method === 'CARD');
    const qr = r.methods.find((m: { method: string }) => m.method === 'QR');
    expect(cash).toMatchObject({ count: 2, amount: 9.35 + 1 });
    expect(cash.refunded).toBeGreaterThan(0);
    expect(card).toMatchObject({ count: 1, amount: 16.5, refunded: 0 });
    expect(qr).toMatchObject({ count: 1, amount: 1.2, refunded: 0 });
    expect(r.total).toBeCloseTo(9.35 + 16.5 + 2.2, 2);
    expect(r.net).toBeCloseTo(r.total - r.refunded, 2);
  });

  it('product sales report aggregates quantities and revenue per product', async () => {
    const res = await request(ctx.app)
      .get(`/api/reports/products?from=${today}&to=${today}`)
      .set(bearer(cashier));
    const products = res.body.report.products;
    const burgerRow = products.find((p: { sku: string }) => p.sku === 'BURGER-001');
    const cokeRow = products.find((p: { sku: string }) => p.sku === 'COKE-001');
    expect(burgerRow).toMatchObject({ quantitySold: 4, quantityRefunded: 0 });
    expect(burgerRow.revenue).toBeCloseTo(5.5 - 0.28 + 16.5, 1); // burger line in sale 1 carries 0.28 of the discount
    expect(cokeRow).toMatchObject({ quantitySold: 3, quantityRefunded: 1 });
    expect(cokeRow.netRevenue).toBeCloseTo(cokeRow.revenue - cokeRow.refunded, 2);
  });

  it('inventory report lists stock, low-stock status, and stock value', async () => {
    ctx.db.run('UPDATE products SET stock_qty = 2 WHERE id = ?', [burger]); // threshold 5
    const res = await request(ctx.app).get('/api/reports/inventory').set(bearer(cashier));
    const r = res.body.report;
    const burgerRow = r.products.find((p: { sku: string }) => p.sku === 'BURGER-001');
    expect(burgerRow).toMatchObject({ stockQty: 2, lowStock: true, stockValue: 5 }); // cost 2.50 x 2
    expect(r.lowStockCount).toBe(1);
    expect(r.totalUnits).toBe(
      r.products.reduce((a: number, p: { stockQty: number }) => a + p.stockQty, 0),
    );
  });

  it('requires authentication', async () => {
    expect((await request(ctx.app).get('/api/reports/daily')).status).toBe(401);
  });
});
