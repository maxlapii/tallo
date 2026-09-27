import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listAuditLogs } from '../../src/services/auditService.js';
import { createTestApp, loginAs, type TestContext } from '../helpers.js';

describe('/api/inventory', () => {
  let ctx: TestContext;
  let admin: string;
  let cashier: string;
  let cokeId: number;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  beforeEach(async () => {
    ctx = createTestApp();
    admin = await loginAs(ctx.app, 'admin');
    cashier = await loginAs(ctx.app, 'cashier');
    cokeId = ctx.db.get<{ id: number }>("SELECT id FROM products WHERE sku = 'COKE-001'")!.id;
    ctx.db.run('UPDATE products SET stock_qty = 10, low_stock_threshold = 5 WHERE id = ?', [
      cokeId,
    ]);
  });
  afterEach(() => ctx.db.close());

  it('critical: stock 10, adjust -3 => stock 7, movement -3, audited', async () => {
    const res = await request(ctx.app)
      .post('/api/inventory/adjust')
      .set(auth(admin))
      .send({ productId: cokeId, type: 'ADJUSTMENT', quantity: -3, note: 'Stock count' });
    expect(res.status).toBe(201);
    expect(res.body.movement).toMatchObject({
      productId: cokeId,
      type: 'ADJUSTMENT',
      quantity: -3,
      stockAfter: 7,
      productSku: 'COKE-001',
      userName: 'Store Admin',
    });
    const product = await request(ctx.app).get(`/api/products/${cokeId}`).set(auth(admin));
    expect(product.body.product.stockQty).toBe(7);
    const audits = listAuditLogs(ctx.db, 'products', cokeId).filter(
      (l) => l.action === 'INVENTORY_ADJUST',
    );
    expect(audits).toHaveLength(1);
  });

  it('rejects an adjustment below zero with INSUFFICIENT_STOCK and no changes', async () => {
    const before = (
      await request(ctx.app).get(`/api/inventory/movements?productId=${cokeId}`).set(auth(admin))
    ).body.movements.length;
    const res = await request(ctx.app)
      .post('/api/inventory/adjust')
      .set(auth(admin))
      .send({ productId: cokeId, type: 'DAMAGE', quantity: -11 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(
      (await request(ctx.app).get(`/api/products/${cokeId}`).set(auth(admin))).body.product
        .stockQty,
    ).toBe(10);
    const after = (
      await request(ctx.app).get(`/api/inventory/movements?productId=${cokeId}`).set(auth(admin))
    ).body.movements.length;
    expect(after).toBe(before);
  });

  it('GET /api/inventory returns stock with low-stock detection', async () => {
    ctx.db.run("UPDATE products SET stock_qty = 3 WHERE sku = 'BURGER-001'"); // threshold 5
    const res = await request(ctx.app).get('/api/inventory').set(auth(cashier));
    expect(res.status).toBe(200);
    expect(res.body.lowStockCount).toBe(1);
    const burger = res.body.products.find((p: { sku: string }) => p.sku === 'BURGER-001');
    expect(burger.lowStock).toBe(true);
    const low = await request(ctx.app).get('/api/inventory?lowStock=true').set(auth(cashier));
    expect(low.body.products.map((p: { sku: string }) => p.sku)).toEqual(['BURGER-001']);
  });

  it('lists movements filtered by product and type', async () => {
    await request(ctx.app)
      .post('/api/inventory/adjust')
      .set(auth(admin))
      .send({ productId: cokeId, type: 'PURCHASE', quantity: 5 });
    await request(ctx.app)
      .post('/api/inventory/adjust')
      .set(auth(admin))
      .send({ productId: cokeId, type: 'DAMAGE', quantity: -1 });
    const all = await request(ctx.app)
      .get(`/api/inventory/movements?productId=${cokeId}`)
      .set(auth(cashier));
    expect(all.body.movements.map((m: { type: string }) => m.type)).toEqual([
      'DAMAGE',
      'PURCHASE',
      'PURCHASE',
    ]);
    const damage = await request(ctx.app)
      .get(`/api/inventory/movements?type=DAMAGE`)
      .set(auth(cashier));
    expect(damage.body.movements).toHaveLength(1);
    expect(damage.body.movements[0].stockAfter).toBe(14);
    expect(
      (await request(ctx.app).get('/api/inventory/movements?type=BOGUS').set(auth(cashier))).status,
    ).toBe(400);
  });

  it('cashier cannot adjust stock', async () => {
    const res = await request(ctx.app)
      .post('/api/inventory/adjust')
      .set(auth(cashier))
      .send({ productId: cokeId, type: 'ADJUSTMENT', quantity: 1 });
    expect(res.status).toBe(403);
  });

  it('validates adjustment input', async () => {
    const res = await request(ctx.app)
      .post('/api/inventory/adjust')
      .set(auth(admin))
      .send({ productId: cokeId, type: 'SALE', quantity: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
  });
});
