import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listAuditLogs } from '../../src/services/auditService.js';
import { computeRefundAmounts } from '../../src/services/refundService.js';
import {
  bearer,
  createTestApp,
  loginAs,
  openRegisterFor,
  productIdBySku,
  snapshot,
  stockOf,
  type TestContext,
} from '../helpers.js';

describe('POST /api/sales/:id/refund', () => {
  let ctx: TestContext;
  let cashier: string;
  let coke: number;
  let burger: number;
  let saleId: number;
  let cokeItemId: number;
  let burgerItemId: number;
  beforeEach(async () => {
    ctx = createTestApp();
    cashier = await loginAs(ctx.app, 'cashier');
    await openRegisterFor(ctx.app, cashier, 100);
    coke = productIdBySku(ctx.db, 'COKE-001');
    burger = productIdBySku(ctx.db, 'BURGER-001');
    ctx.db.run('UPDATE products SET stock_qty = 10 WHERE id = ?', [coke]);
    // sale: 5 coke (2.00, 10%) + 1 burger (5.00, 10%) => 15.00 + 1.50 = 16.50
    const res = await request(ctx.app)
      .post('/api/sales')
      .set(bearer(cashier))
      .send({
        items: [
          { productId: coke, quantity: 5 },
          { productId: burger, quantity: 1 },
        ],
        payments: [{ method: 'CASH', amount: 20 }],
      });
    saleId = res.body.sale.id;
    cokeItemId = res.body.sale.items[0].id;
    burgerItemId = res.body.sale.items[1].id;
  });
  afterEach(() => ctx.db.close());

  const refund = (body: object) =>
    request(ctx.app).post(`/api/sales/${saleId}/refund`).set(bearer(cashier)).send(body);

  it('sale qty 5, refund 2 => allowed; stock 10 -> 5 -> 7; movement +2; cash out of register; audited', async () => {
    expect(stockOf(ctx.db, coke)).toBe(5);
    const res = await refund({
      items: [{ saleItemId: cokeItemId, quantity: 2 }],
      refundMethod: 'CASH',
      reason: 'Damaged',
    });
    expect(res.status).toBe(201);
    expect(res.body.refund).toMatchObject({
      refundMethod: 'CASH',
      reason: 'Damaged',
      subtotal: 4,
      tax: 0.4,
      total: 4.4,
      userName: 'Front Cashier',
    });
    expect(res.body.refund.items).toEqual([
      expect.objectContaining({ saleItemId: cokeItemId, quantity: 2, total: 4.4 }),
    ]);
    expect(res.body.sale.status).toBe('PARTIALLY_REFUNDED');
    expect(res.body.sale.items[0]).toMatchObject({ refundedQuantity: 2, refundableQuantity: 3 });
    expect(res.body.sale.refundedTotal).toBe(4.4);
    expect(stockOf(ctx.db, coke)).toBe(7);

    const mv = await request(ctx.app)
      .get(`/api/inventory/movements?productId=${coke}&type=RETURN`)
      .set(bearer(cashier));
    expect(mv.body.movements[0]).toMatchObject({
      quantity: 2,
      stockAfter: 7,
      referenceType: 'REFUND',
    });

    const reg = await request(ctx.app).get('/api/registers/current').set(bearer(cashier));
    expect(reg.body.register.summary.cashRefunds).toBe(4.4);
    expect(reg.body.register.summary.expectedCash).toBe(100 + 16.5 - 4.4);

    expect(listAuditLogs(ctx.db, 'sales', saleId).map((l) => l.action)).toContain('SALE_REFUND');
  });

  it('already refunded 2, new refund 4 => rejected (REFUND_EXCEEDS_QUANTITY) with no changes', async () => {
    await refund({ items: [{ saleItemId: cokeItemId, quantity: 2 }], refundMethod: 'CASH' });
    const before = snapshot(ctx.db);
    const res = await refund({
      items: [{ saleItemId: cokeItemId, quantity: 4 }],
      refundMethod: 'CASH',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REFUND_EXCEEDS_QUANTITY');
    expect(snapshot(ctx.db)).toEqual(before);
    expect(stockOf(ctx.db, coke)).toBe(7);
  });

  it('refunding more than sold in one request is rejected', async () => {
    const res = await refund({
      items: [{ saleItemId: cokeItemId, quantity: 6 }],
      refundMethod: 'CASH',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REFUND_EXCEEDS_QUANTITY');
  });

  it('refunding everything marks the sale REFUNDED and refunds the exact sale total', async () => {
    const res = await refund({
      items: [
        { saleItemId: cokeItemId, quantity: 5 },
        { saleItemId: burgerItemId, quantity: 1 },
      ],
      refundMethod: 'CASH',
    });
    expect(res.status).toBe(201);
    expect(res.body.refund.total).toBe(16.5);
    expect(res.body.sale.status).toBe('REFUNDED');
    const again = await refund({
      items: [{ saleItemId: cokeItemId, quantity: 1 }],
      refundMethod: 'CASH',
    });
    expect(again.status).toBe(400);
    expect(again.body.error.message).toMatch(/already been fully refunded/);
  });

  it('partial refunds in steps never leave rounding cents behind', async () => {
    // Line: 3 x 3.33 @ 10% tax => subtotal 9.99, tax 1.00 (0.999 rounds), total 10.99
    ctx.db.run('UPDATE products SET price_cents = 333, stock_qty = 100 WHERE id = ?', [burger]);
    const sale = await request(ctx.app)
      .post('/api/sales')
      .set(bearer(cashier))
      .send({
        items: [{ productId: burger, quantity: 3 }],
        payments: [{ method: 'CASH', amount: 20 }],
      });
    const itemId = sale.body.sale.items[0].id;
    const total = sale.body.sale.total;
    const r1 = await request(ctx.app)
      .post(`/api/sales/${sale.body.sale.id}/refund`)
      .set(bearer(cashier))
      .send({ items: [{ saleItemId: itemId, quantity: 1 }], refundMethod: 'CASH' });
    const r2 = await request(ctx.app)
      .post(`/api/sales/${sale.body.sale.id}/refund`)
      .set(bearer(cashier))
      .send({ items: [{ saleItemId: itemId, quantity: 1 }], refundMethod: 'CASH' });
    const r3 = await request(ctx.app)
      .post(`/api/sales/${sale.body.sale.id}/refund`)
      .set(bearer(cashier))
      .send({ items: [{ saleItemId: itemId, quantity: 1 }], refundMethod: 'CASH' });
    const sum = r1.body.refund.total + r2.body.refund.total + r3.body.refund.total;
    expect(Math.round(sum * 100) / 100).toBe(total);
    expect(r3.body.sale.status).toBe('REFUNDED');
  });

  it('card refunds do not require an open register and do not touch cash', async () => {
    const admin = await loginAs(ctx.app, 'admin');
    const before = ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM cash_movements')!.n;
    const res = await request(ctx.app)
      .post(`/api/sales/${saleId}/refund`)
      .set(bearer(admin))
      .send({ items: [{ saleItemId: burgerItemId, quantity: 1 }], refundMethod: 'CARD' });
    expect(res.status).toBe(201);
    expect(res.body.refund.total).toBe(5.5);
    expect(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM cash_movements')!.n).toBe(before);
  });

  it('cash refunds require an open register', async () => {
    const admin = await loginAs(ctx.app, 'admin');
    const res = await request(ctx.app)
      .post(`/api/sales/${saleId}/refund`)
      .set(bearer(admin))
      .send({ items: [{ saleItemId: burgerItemId, quantity: 1 }], refundMethod: 'CASH' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REGISTER_NOT_OPEN');
  });

  it('rejects items from another sale, unknown sales, and invalid bodies', async () => {
    const other = await request(ctx.app)
      .post('/api/sales')
      .set(bearer(cashier))
      .send({
        items: [{ productId: coke, quantity: 1 }],
        payments: [{ method: 'CASH', amount: 5 }],
      });
    const foreignItem = other.body.sale.items[0].id;
    expect(
      (await refund({ items: [{ saleItemId: foreignItem, quantity: 1 }], refundMethod: 'CASH' }))
        .status,
    ).toBe(404);
    expect(
      (
        await request(ctx.app)
          .post('/api/sales/999/refund')
          .set(bearer(cashier))
          .send({ items: [{ saleItemId: 1, quantity: 1 }], refundMethod: 'CASH' })
      ).status,
    ).toBe(404);
    expect((await refund({ items: [], refundMethod: 'CASH' })).status).toBe(400);
    expect(
      (await refund({ items: [{ saleItemId: cokeItemId, quantity: 0 }], refundMethod: 'CASH' }))
        .status,
    ).toBe(400);
  });

  it('transaction rollback: failure while returning stock leaves refund tables and stock unchanged', async () => {
    ctx.db.exec(
      `CREATE TRIGGER fail_return BEFORE INSERT ON inventory_movements WHEN NEW.type = 'RETURN' BEGIN SELECT RAISE(ABORT, 'boom'); END`,
    );
    const before = snapshot(ctx.db);
    const res = await refund({
      items: [{ saleItemId: cokeItemId, quantity: 1 }],
      refundMethod: 'CASH',
    });
    expect(res.status).toBe(500);
    expect(snapshot(ctx.db)).toEqual(before);
    expect(
      ctx.db.get<{ s: string }>('SELECT status AS s FROM sales WHERE id = ?', [saleId])!.s,
    ).toBe('COMPLETED');
  });
});

describe('computeRefundAmounts', () => {
  const item = {
    quantity: 3,
    subtotal_cents: 999,
    discount_cents: 0,
    tax_cents: 100,
    total_cents: 1099,
    refunded_quantity: 0,
  };
  it('is proportional for partial quantities', () => {
    expect(computeRefundAmounts(item, { subtotal: 0, tax: 0, total: 0 }, 1)).toEqual({
      subtotalCents: 333,
      taxCents: 33,
      totalCents: 366,
    });
  });
  it('refunds the remainder when the last units are returned', () => {
    const last = { ...item, refunded_quantity: 2 };
    expect(computeRefundAmounts(last, { subtotal: 666, tax: 66, total: 732 }, 1)).toEqual({
      subtotalCents: 333,
      taxCents: 34,
      totalCents: 367,
    });
  });
  it('accounts for allocated discounts', () => {
    const discounted = {
      quantity: 2,
      subtotal_cents: 1000,
      discount_cents: 200,
      tax_cents: 80,
      total_cents: 880,
      refunded_quantity: 0,
    };
    expect(computeRefundAmounts(discounted, { subtotal: 0, tax: 0, total: 0 }, 1)).toEqual({
      subtotalCents: 400,
      taxCents: 40,
      totalCents: 440,
    });
  });
});
