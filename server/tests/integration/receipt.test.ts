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

describe('GET /api/sales/:id/receipt', () => {
  let ctx: TestContext;
  let cashier: string;
  beforeEach(async () => {
    ctx = createTestApp({ storeName: 'Test Store' });
    cashier = await loginAs(ctx.app, 'cashier');
    await openRegisterFor(ctx.app, cashier, 50);
  });
  afterEach(() => ctx.db.close());

  it('returns printable receipt data with totals, payment and change', async () => {
    const coke = productIdBySku(ctx.db, 'COKE-001');
    const burger = productIdBySku(ctx.db, 'BURGER-001');
    const sale = await request(ctx.app)
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
    ctx.db.run("UPDATE products SET price_cents = 12345, name = 'Changed' WHERE id = ?", [coke]);

    const res = await request(ctx.app)
      .get(`/api/sales/${sale.body.sale.id}/receipt`)
      .set(bearer(cashier));
    expect(res.status).toBe(200);
    const r = res.body.receipt;
    expect(r).toMatchObject({
      storeName: 'Test Store',
      receiptNo: '000001',
      cashier: 'Front Cashier',
      subtotal: 9,
      discount: 0.5,
      tax: 0.85,
      total: 9.35,
      received: 10,
      change: 0.65,
      status: 'COMPLETED',
    });
    expect(r.items).toEqual([
      { name: 'Coca Cola', sku: 'COKE-001', quantity: 2, unitPrice: 2, total: 4 },
      { name: 'Burger', sku: 'BURGER-001', quantity: 1, unitPrice: 5, total: 5 },
    ]);
    expect(r.payments).toEqual([{ method: 'CASH', amount: 10, referenceNo: null }]);
    expect(typeof r.date).toBe('string');
  });

  it('404s for an unknown sale', async () => {
    const res = await request(ctx.app).get('/api/sales/999/receipt').set(bearer(cashier));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SALE_NOT_FOUND');
  });
});
