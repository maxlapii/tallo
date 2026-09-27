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

describe('SALE role (order-only staff)', () => {
  let ctx: TestContext;
  let sale: string;
  let cashier: string;
  let admin: string;
  let coke: number;
  beforeEach(async () => {
    ctx = createTestApp();
    sale = await loginAs(ctx.app, 'sale');
    cashier = await loginAs(ctx.app, 'cashier');
    admin = await loginAs(ctx.app, 'admin');
    coke = productIdBySku(ctx.db, 'COKE-001');
  });
  afterEach(() => ctx.db.close());

  it('can log in and is reported with role SALE', async () => {
    const me = await request(ctx.app).get('/api/auth/me').set(bearer(sale));
    expect(me.body.user).toMatchObject({
      username: 'sale',
      role: 'SALE',
      fullName: 'Sales Associate',
    });
  });

  it('cannot place an order until a cashier has opened a register', async () => {
    const status = await request(ctx.app).get('/api/registers/status').set(bearer(sale));
    expect(status.body.status).toMatchObject({
      canSell: false,
      openRegisters: 0,
      ownRegisterId: null,
    });
    const before = snapshot(ctx.db);
    const res = await request(ctx.app)
      .post('/api/sales')
      .set(bearer(sale))
      .send({
        items: [{ productId: coke, quantity: 1 }],
        payments: [{ method: 'CASH', amount: 5 }],
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REGISTER_NOT_OPEN');
    expect(res.body.error.message).toMatch(/cashier/);
    expect(snapshot(ctx.db)).toEqual(before);
  });

  it("places orders against the store's open register; cash lands in that drawer", async () => {
    const registerId = await openRegisterFor(ctx.app, cashier, 100);
    const status = await request(ctx.app).get('/api/registers/status').set(bearer(sale));
    expect(status.body.status).toMatchObject({ canSell: true, openRegisters: 1 });
    const res = await request(ctx.app)
      .post('/api/sales')
      .set(bearer(sale))
      .send({
        items: [{ productId: coke, quantity: 2 }],
        payments: [{ method: 'CASH', amount: 10 }],
      });
    expect(res.status).toBe(201);
    expect(res.body.sale).toMatchObject({
      registerId,
      cashierName: 'Sales Associate',
      total: 4.4,
      change: 5.6,
    });
    expect(stockOf(ctx.db, coke)).toBe(98);
    const reg = await request(ctx.app).get('/api/registers/current').set(bearer(cashier));
    expect(reg.body.register.summary).toMatchObject({
      cashSales: 4.4,
      expectedCash: 104.4,
      salesCount: 1,
    });
  });

  it('uses the most recently opened register when several are open', async () => {
    await openRegisterFor(ctx.app, cashier, 50);
    ctx.db.run("UPDATE registers SET opened_at = '2020-01-01T00:00:00.000Z'");
    const adminReg = await openRegisterFor(ctx.app, admin, 20);
    const res = await request(ctx.app)
      .post('/api/sales')
      .set(bearer(sale))
      .send({
        items: [{ productId: coke, quantity: 1 }],
        payments: [{ method: 'CARD', amount: 2.2 }],
      });
    expect(res.body.sale.registerId).toBe(adminReg);
  });

  it('only sees its own orders in history and detail', async () => {
    await openRegisterFor(ctx.app, cashier, 100);
    const own = await request(ctx.app)
      .post('/api/sales')
      .set(bearer(sale))
      .send({
        items: [{ productId: coke, quantity: 1 }],
        payments: [{ method: 'CASH', amount: 5 }],
      });
    const other = await request(ctx.app)
      .post('/api/sales')
      .set(bearer(cashier))
      .send({
        items: [{ productId: coke, quantity: 1 }],
        payments: [{ method: 'CASH', amount: 5 }],
      });
    const list = await request(ctx.app).get('/api/sales').set(bearer(sale));
    expect(list.body.total).toBe(1);
    expect(list.body.sales[0].id).toBe(own.body.sale.id);
    // cashierId filter cannot widen the scope
    const widened = await request(ctx.app)
      .get(`/api/sales?cashierId=${other.body.sale.cashierId}`)
      .set(bearer(sale));
    expect(widened.body.total).toBe(1);
    expect(
      (await request(ctx.app).get(`/api/sales/${own.body.sale.id}`).set(bearer(sale))).status,
    ).toBe(200);
    expect(
      (await request(ctx.app).get(`/api/sales/${other.body.sale.id}`).set(bearer(sale))).status,
    ).toBe(403);
    expect(
      (await request(ctx.app).get(`/api/sales/${own.body.sale.id}/receipt`).set(bearer(sale)))
        .status,
    ).toBe(200);
    expect(
      (await request(ctx.app).get(`/api/sales/${other.body.sale.id}/receipt`).set(bearer(sale)))
        .status,
    ).toBe(403);
    // cashier still sees everything
    expect((await request(ctx.app).get('/api/sales').set(bearer(cashier))).body.total).toBe(2);
  });

  it('can read the catalogue (with live stock counts) but not the stock pages', async () => {
    expect((await request(ctx.app).get('/api/products').set(bearer(sale))).status).toBe(200);
    expect(
      (await request(ctx.app).get('/api/products/lookup?code=COKE-001').set(bearer(sale))).status,
    ).toBe(200);
    expect((await request(ctx.app).get('/api/categories').set(bearer(sale))).status).toBe(200);
    const products = await request(ctx.app).get('/api/products').set(bearer(sale));
    expect(typeof products.body.products[0].stockQty).toBe('number');
  });

  it.each([
    ['POST', '/api/products', { sku: 'X', name: 'X', price: 1 }],
    ['PUT', '/api/products/1', { price: 1 }],
    ['DELETE', '/api/products/1', undefined],
    ['POST', '/api/categories', { name: 'X' }],
    ['POST', '/api/inventory/adjust', { productId: 1, type: 'ADJUSTMENT', quantity: 1 }],
    ['GET', '/api/inventory', undefined],
    ['GET', '/api/inventory/movements', undefined],
    ['GET', '/api/registers/current', undefined],
    ['GET', '/api/registers', undefined],
    ['POST', '/api/registers/open', { openingCash: 1 }],
    ['POST', '/api/registers/close', { actualCash: 1 }],
    ['POST', '/api/registers/cash-in', { amount: 1 }],
    ['GET', '/api/reports/daily', undefined],
    ['GET', '/api/reports/inventory', undefined],
    ['GET', '/api/users', undefined],
    ['POST', '/api/users', { username: 'x', password: 'password1', fullName: 'X', role: 'SALE' }],
  ])('is forbidden: %s %s', async (method, path, body) => {
    const req = request(ctx.app)
      [method.toLowerCase() as 'get' | 'post' | 'put' | 'delete'](path)
      .set(bearer(sale));
    const res = body ? await req.send(body) : await req;
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('cannot refund, even its own order', async () => {
    await openRegisterFor(ctx.app, cashier, 100);
    const own = await request(ctx.app)
      .post('/api/sales')
      .set(bearer(sale))
      .send({
        items: [{ productId: coke, quantity: 1 }],
        payments: [{ method: 'CASH', amount: 5 }],
      });
    const res = await request(ctx.app)
      .post(`/api/sales/${own.body.sale.id}/refund`)
      .set(bearer(sale))
      .send({
        items: [{ saleItemId: own.body.sale.items[0].id, quantity: 1 }],
        refundMethod: 'CASH',
      });
    expect(res.status).toBe(403);
    // A cashier can refund it from their register.
    const ok = await request(ctx.app)
      .post(`/api/sales/${own.body.sale.id}/refund`)
      .set(bearer(cashier))
      .send({
        items: [{ saleItemId: own.body.sale.items[0].id, quantity: 1 }],
        refundMethod: 'CASH',
      });
    expect(ok.status).toBe(201);
  });

  it('admin can create SALE users for extra devices and update roles', async () => {
    const created = await request(ctx.app)
      .post('/api/users')
      .set(bearer(admin))
      .send({ username: 'tablet2', password: 'device-pass-1', fullName: 'Tablet 2', role: 'SALE' });
    expect(created.status).toBe(201);
    expect(created.body.user.role).toBe('SALE');
    const login = await request(ctx.app)
      .post('/api/auth/login')
      .send({ username: 'tablet2', password: 'device-pass-1' });
    expect(login.status).toBe(200);
    const updated = await request(ctx.app)
      .put(`/api/users/${created.body.user.id}`)
      .set(bearer(admin))
      .send({ role: 'CASHIER', fullName: 'Tablet Two' });
    expect(updated.body.user).toMatchObject({ role: 'CASHIER', fullName: 'Tablet Two' });
    const deactivated = await request(ctx.app)
      .put(`/api/users/${created.body.user.id}`)
      .set(bearer(admin))
      .send({ active: false });
    expect(deactivated.body.user.active).toBe(false);
    expect((await request(ctx.app).get('/api/auth/me').set(bearer(login.body.token))).status).toBe(
      401,
    );
    // admin cannot lock themselves out
    const adminId = ctx.db.get<{ id: number }>("SELECT id FROM users WHERE username = 'admin'")!.id;
    expect(
      (
        await request(ctx.app)
          .put(`/api/users/${adminId}`)
          .set(bearer(admin))
          .send({ active: false })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(ctx.app)
          .put(`/api/users/${adminId}`)
          .set(bearer(admin))
          .send({ role: 'SALE' })
      ).status,
    ).toBe(400);
    expect(
      (await request(ctx.app).put('/api/users/999').set(bearer(admin)).send({ active: false }))
        .status,
    ).toBe(404);
  });

  it('the same SALE account can be signed in on several devices at once', async () => {
    await openRegisterFor(ctx.app, cashier, 100);
    const device1 = await loginAs(ctx.app, 'sale');
    const device2 = await loginAs(ctx.app, 'sale');
    const a = await request(ctx.app)
      .post('/api/sales')
      .set(bearer(device1))
      .send({
        items: [{ productId: coke, quantity: 1 }],
        payments: [{ method: 'CASH', amount: 5 }],
      });
    const b = await request(ctx.app)
      .post('/api/sales')
      .set(bearer(device2))
      .send({
        items: [{ productId: coke, quantity: 1 }],
        payments: [{ method: 'CASH', amount: 5 }],
      });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(stockOf(ctx.db, coke)).toBe(98);
  });
});
