import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

describe('POST /api/sales (checkout)', () => {
  let ctx: TestContext;
  let cashier: string;
  let coke: number;
  let burger: number;
  beforeEach(async () => {
    ctx = createTestApp();
    cashier = await loginAs(ctx.app, 'cashier');
    await openRegisterFor(ctx.app, cashier, 100);
    coke = productIdBySku(ctx.db, 'COKE-001'); // 2.00, 10% tax
    burger = productIdBySku(ctx.db, 'BURGER-001'); // 5.00, 10% tax
    ctx.db.run('UPDATE products SET stock_qty = 10 WHERE id = ?', [coke]);
  });
  afterEach(() => ctx.db.close());

  const checkout = (token: string, body: object) =>
    request(ctx.app).post('/api/sales').set(bearer(token)).send(body);

  it('successful sale: stock 10 sold 2 => sale, items, payment, stock 8, movement -2', async () => {
    const res = await checkout(cashier, {
      items: [{ productId: coke, quantity: 2 }],
      payments: [{ method: 'CASH', amount: 4.4 }],
    });
    expect(res.status).toBe(201);
    const sale = res.body.sale;
    expect(sale).toMatchObject({
      receiptNo: '000001',
      status: 'COMPLETED',
      subtotal: 4,
      discount: 0,
      tax: 0.4,
      total: 4.4,
      paid: 4.4,
      change: 0,
      cashierName: 'Front Cashier',
    });
    expect(sale.items).toHaveLength(1);
    expect(sale.items[0]).toMatchObject({
      productId: coke,
      productName: 'Coca Cola',
      productSku: 'COKE-001',
      quantity: 2,
      unitPrice: 2,
      total: 4.4,
    });
    expect(sale.payments).toEqual([expect.objectContaining({ method: 'CASH', amount: 4.4 })]);
    expect(stockOf(ctx.db, coke)).toBe(8);
    const mv = await request(ctx.app)
      .get(`/api/inventory/movements?productId=${coke}&type=SALE`)
      .set(bearer(cashier));
    expect(mv.body.movements).toHaveLength(1);
    expect(mv.body.movements[0]).toMatchObject({
      quantity: -2,
      stockAfter: 8,
      referenceType: 'SALE',
      referenceId: sale.id,
    });
  });

  it('CLAUDE.md example: coke x2 + burger x1, discount 0.50, 10% tax => total 9.35, cash 10 => change 0.65', async () => {
    const res = await checkout(cashier, {
      items: [
        { productId: coke, quantity: 2 },
        { productId: burger, quantity: 1 },
      ],
      discount: 0.5,
      payments: [{ method: 'CASH', amount: 10 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.sale).toMatchObject({
      subtotal: 9,
      discount: 0.5,
      tax: 0.85,
      total: 9.35,
      paid: 10,
      change: 0.65,
    });
  });

  it('server computes totals; client-supplied totals are ignored', async () => {
    const res = await checkout(cashier, {
      items: [{ productId: coke, quantity: 1 }],
      total: 0.01,
      subtotal: 0.01,
      payments: [{ method: 'CASH', amount: 2.2 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.sale.total).toBe(2.2);
  });

  it('insufficient stock: stock 1, requested 2 => rejected with no changes', async () => {
    ctx.db.run('UPDATE products SET stock_qty = 1 WHERE id = ?', [coke]);
    const before = snapshot(ctx.db);
    const res = await checkout(cashier, {
      items: [{ productId: coke, quantity: 2 }],
      payments: [{ method: 'CASH', amount: 10 }],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(stockOf(ctx.db, coke)).toBe(1);
    expect(snapshot(ctx.db)).toEqual(before);
  });

  it('duplicate lines are merged before stock validation', async () => {
    ctx.db.run('UPDATE products SET stock_qty = 3 WHERE id = ?', [coke]);
    const res = await checkout(cashier, {
      items: [
        { productId: coke, quantity: 2 },
        { productId: coke, quantity: 2 },
      ],
      payments: [{ method: 'CASH', amount: 100 }],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(stockOf(ctx.db, coke)).toBe(3);
  });

  it('invalid product => rejected, no database changes', async () => {
    const before = snapshot(ctx.db);
    const res = await checkout(cashier, {
      items: [
        { productId: coke, quantity: 1 },
        { productId: 9999, quantity: 1 },
      ],
      payments: [{ method: 'CASH', amount: 100 }],
    });
    expect(res.status).toBe(404);
    expect(snapshot(ctx.db)).toEqual(before);
  });

  it('inactive product cannot be sold', async () => {
    ctx.db.run('UPDATE products SET active = 0 WHERE id = ?', [burger]);
    const before = snapshot(ctx.db);
    const res = await checkout(cashier, {
      items: [{ productId: burger, quantity: 1 }],
      payments: [{ method: 'CASH', amount: 100 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/inactive/);
    expect(snapshot(ctx.db)).toEqual(before);
  });

  it('payment mismatch: total 4.40, paid 4.00 => rejected', async () => {
    const before = snapshot(ctx.db);
    const res = await checkout(cashier, {
      items: [{ productId: coke, quantity: 2 }],
      payments: [{ method: 'CASH', amount: 4 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PAYMENT');
    expect(snapshot(ctx.db)).toEqual(before);
  });

  it('exact payment succeeds', async () => {
    const res = await checkout(cashier, {
      items: [{ productId: burger, quantity: 4 }],
      payments: [{ method: 'CARD', amount: 22, referenceNo: 'AUTH123' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.sale).toMatchObject({ total: 22, paid: 22, change: 0 });
    expect(res.body.sale.payments[0]).toMatchObject({ method: 'CARD', referenceNo: 'AUTH123' });
  });

  it('cash overpayment returns change', async () => {
    const res = await checkout(cashier, {
      items: [{ productId: burger, quantity: 4 }],
      payments: [{ method: 'CASH', amount: 25 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.sale).toMatchObject({ total: 22, paid: 25, change: 3 });
  });

  it.each(['CARD', 'QR'])('%s overpayment is rejected', async (method) => {
    const res = await checkout(cashier, {
      items: [{ productId: burger, quantity: 4 }],
      payments: [{ method, amount: 25 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PAYMENT');
  });

  it('split payment cash 40 + card 60 on a 100 total', async () => {
    ctx.db.run('UPDATE products SET price_cents = 10000, tax_rate_bp = 0 WHERE id = ?', [burger]);
    const res = await checkout(cashier, {
      items: [{ productId: burger, quantity: 1 }],
      payments: [
        { method: 'CASH', amount: 40 },
        { method: 'CARD', amount: 60 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.sale.payments).toHaveLength(2);
    expect(res.body.sale.paymentMethods.sort()).toEqual(['CARD', 'CASH']);
    expect(res.body.sale.change).toBe(0);
    // Register only receives the cash part.
    const reg = await request(ctx.app).get('/api/registers/current').set(bearer(cashier));
    expect(reg.body.register.summary.cashSales).toBe(40);
    expect(reg.body.register.summary.expectedCash).toBe(140);
  });

  it('split payment with cash change: register receives cash minus change', async () => {
    ctx.db.run('UPDATE products SET price_cents = 10000, tax_rate_bp = 0 WHERE id = ?', [burger]);
    const res = await checkout(cashier, {
      items: [{ productId: burger, quantity: 1 }],
      payments: [
        { method: 'CARD', amount: 60 },
        { method: 'CASH', amount: 50 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.sale.change).toBe(10);
    const reg = await request(ctx.app).get('/api/registers/current').set(bearer(cashier));
    expect(reg.body.register.summary.cashSales).toBe(40);
  });

  it('discount larger than subtotal is rejected', async () => {
    const res = await checkout(cashier, {
      items: [{ productId: coke, quantity: 1 }],
      discount: 5,
      payments: [{ method: 'CASH', amount: 5 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
  });

  it('requires an open register (REGISTER_NOT_OPEN)', async () => {
    const admin = await loginAs(ctx.app, 'admin');
    const before = snapshot(ctx.db);
    const res = await checkout(admin, {
      items: [{ productId: coke, quantity: 1 }],
      payments: [{ method: 'CASH', amount: 5 }],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REGISTER_NOT_OPEN');
    expect(snapshot(ctx.db)).toEqual(before);
  });

  it('validates the request body', async () => {
    expect(
      (await checkout(cashier, { items: [], payments: [{ method: 'CASH', amount: 1 }] })).status,
    ).toBe(400);
    expect(
      (
        await checkout(cashier, {
          items: [{ productId: coke, quantity: 0 }],
          payments: [{ method: 'CASH', amount: 1 }],
        })
      ).status,
    ).toBe(400);
    expect(
      (await checkout(cashier, { items: [{ productId: coke, quantity: 1 }], payments: [] })).status,
    ).toBe(400);
    expect(
      (
        await checkout(cashier, {
          items: [{ productId: coke, quantity: 1 }],
          payments: [{ method: 'CHEQUE', amount: 5 }],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await checkout(cashier, {
          items: [{ productId: coke, quantity: 1 }],
          payments: [{ method: 'CASH', amount: 2.205 }],
        })
      ).status,
    ).toBe(400);
  });

  it('MANDATORY: database failure during inventory update rolls back sale, payment, stock, and movements', async () => {
    ctx.db.exec(`CREATE TRIGGER simulate_failure BEFORE INSERT ON inventory_movements
                 WHEN NEW.product_id = ${burger} BEGIN SELECT RAISE(ABORT, 'simulated inventory failure'); END`);
    const before = snapshot(ctx.db);
    const res = await checkout(cashier, {
      items: [
        { productId: coke, quantity: 2 },
        { productId: burger, quantity: 1 },
      ],
      payments: [{ method: 'CASH', amount: 20 }],
    });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(snapshot(ctx.db)).toEqual(before);
    expect(stockOf(ctx.db, coke)).toBe(10);
    expect(stockOf(ctx.db, burger)).toBe(50);
    ctx.db.exec('DROP TRIGGER simulate_failure');
    // The database is usable afterwards and the receipt sequence is unaffected.
    const ok = await checkout(cashier, {
      items: [{ productId: coke, quantity: 1 }],
      payments: [{ method: 'CASH', amount: 5 }],
    });
    expect(ok.status).toBe(201);
    expect(ok.body.sale.receiptNo).toBe('000001');
  });

  it('stores historical price and name on sale items', async () => {
    const res = await checkout(cashier, {
      items: [{ productId: coke, quantity: 1 }],
      payments: [{ method: 'CASH', amount: 5 }],
    });
    ctx.db.run("UPDATE products SET price_cents = 999, name = 'Renamed' WHERE id = ?", [coke]);
    const sale = await request(ctx.app).get(`/api/sales/${res.body.sale.id}`).set(bearer(cashier));
    expect(sale.body.sale.items[0]).toMatchObject({ productName: 'Coca Cola', unitPrice: 2 });
  });

  it('records the customer name when provided', async () => {
    const res = await checkout(cashier, {
      items: [{ productId: coke, quantity: 1 }],
      payments: [{ method: 'CASH', amount: 5 }],
      customerName: 'Jane',
    });
    expect(res.body.sale.customerName).toBe('Jane');
  });
});
