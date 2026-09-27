import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listAuditLogs } from '../../src/services/auditService.js';
import { createTestApp, loginAs, type TestContext } from '../helpers.js';

describe('/api/products', () => {
  let ctx: TestContext;
  let admin: string;
  let cashier: string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  beforeEach(async () => {
    ctx = createTestApp();
    admin = await loginAs(ctx.app, 'admin');
    cashier = await loginAs(ctx.app, 'cashier');
  });
  afterEach(() => ctx.db.close());

  it('lists seeded products with category names and decimal money', async () => {
    const res = await request(ctx.app).get('/api/products').set(auth(cashier));
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(3);
    const coke = res.body.products.find((p: { sku: string }) => p.sku === 'COKE-001');
    expect(coke).toMatchObject({
      name: 'Coca Cola',
      price: 2,
      costPrice: 1,
      taxRate: 10,
      stockQty: 100,
      categoryName: 'Beverages',
      active: true,
      lowStock: false,
    });
  });

  it('admin can create a product (with initial stock movement) and it is audited', async () => {
    const res = await request(ctx.app).post('/api/products').set(auth(admin)).send({
      sku: 'TEA-001',
      barcode: '111222333',
      name: 'Green Tea',
      price: 1.75,
      costPrice: 0.5,
      taxRate: 7.5,
      stockQty: 12,
      lowStockThreshold: 3,
    });
    expect(res.status).toBe(201);
    expect(res.body.product).toMatchObject({
      sku: 'TEA-001',
      price: 1.75,
      costPrice: 0.5,
      taxRate: 7.5,
      stockQty: 12,
      lowStock: false,
    });
    const id = res.body.product.id;
    const movements = await request(ctx.app)
      .get(`/api/inventory/movements?productId=${id}`)
      .set(auth(admin));
    expect(movements.body.movements).toHaveLength(1);
    expect(movements.body.movements[0]).toMatchObject({
      type: 'PURCHASE',
      quantity: 12,
      stockAfter: 12,
    });
    expect(listAuditLogs(ctx.db, 'products', id).map((l) => l.action)).toEqual(['PRODUCT_CREATE']);
  });

  it('admin can update a product and price changes are audited', async () => {
    const list = await request(ctx.app).get('/api/products?q=COKE-001').set(auth(admin));
    const id = list.body.products[0].id;
    const res = await request(ctx.app)
      .put(`/api/products/${id}`)
      .set(auth(admin))
      .send({ price: 2.25, name: 'Coke Classic' });
    expect(res.status).toBe(200);
    expect(res.body.product).toMatchObject({ price: 2.25, name: 'Coke Classic', sku: 'COKE-001' });
    const actions = listAuditLogs(ctx.db, 'products', id).map((l) => l.action);
    expect(actions).toContain('PRODUCT_PRICE_CHANGE');
    expect(actions).toContain('PRODUCT_UPDATE');
  });

  it('update cannot change stock directly', async () => {
    const list = await request(ctx.app).get('/api/products?q=COKE-001').set(auth(admin));
    const id = list.body.products[0].id;
    const res = await request(ctx.app)
      .put(`/api/products/${id}`)
      .set(auth(admin))
      .send({ stockQty: 999 });
    expect(res.status).toBe(200);
    expect(res.body.product.stockQty).toBe(100);
  });

  it('searches by SKU, barcode, and name', async () => {
    for (const [q, expected] of [
      ['BURGER-001', 'Burger'],
      ['0490000000033', 'Water'],
      ['coca', 'Coca Cola'],
    ]) {
      const res = await request(ctx.app).get(`/api/products?q=${q}`).set(auth(cashier));
      expect(res.status).toBe(200);
      expect(res.body.products.map((p: { name: string }) => p.name)).toContain(expected);
    }
  });

  it('exact lookup by barcode then SKU (case-insensitive)', async () => {
    const byBarcode = await request(ctx.app)
      .get('/api/products/lookup?code=0490000000019')
      .set(auth(cashier));
    expect(byBarcode.body.product.sku).toBe('COKE-001');
    const bySku = await request(ctx.app)
      .get('/api/products/lookup?code=burger-001')
      .set(auth(cashier));
    expect(bySku.body.product.name).toBe('Burger');
    const missing = await request(ctx.app).get('/api/products/lookup?code=NOPE').set(auth(cashier));
    expect(missing.status).toBe(404);
    const empty = await request(ctx.app).get('/api/products/lookup').set(auth(cashier));
    expect(empty.status).toBe(400);
  });

  it('filters by category, active, and low stock', async () => {
    const cats = await request(ctx.app).get('/api/categories').set(auth(cashier));
    const bev = cats.body.categories.find((c: { name: string }) => c.name === 'Beverages');
    const byCat = await request(ctx.app)
      .get(`/api/products?categoryId=${bev.id}`)
      .set(auth(cashier));
    expect(byCat.body.products.every((p: { categoryId: number }) => p.categoryId === bev.id)).toBe(
      true,
    );

    ctx.db.run("UPDATE products SET stock_qty = 2 WHERE sku = 'WATER-001'");
    const low = await request(ctx.app).get('/api/products?lowStock=true').set(auth(cashier));
    expect(low.body.products.map((p: { sku: string }) => p.sku)).toEqual(['WATER-001']);
    expect(low.body.products[0].lowStock).toBe(true);

    ctx.db.run("UPDATE products SET active = 0 WHERE sku = 'WATER-001'");
    const active = await request(ctx.app).get('/api/products?active=true').set(auth(cashier));
    expect(active.body.products.map((p: { sku: string }) => p.sku)).not.toContain('WATER-001');
    const bad = await request(ctx.app).get('/api/products?active=maybe').set(auth(cashier));
    expect(bad.status).toBe(400);
  });

  it('rejects duplicate SKU with DUPLICATE_SKU (case-insensitive)', async () => {
    const res = await request(ctx.app)
      .post('/api/products')
      .set(auth(admin))
      .send({ sku: 'coke-001', name: 'Dup', price: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_SKU');
  });

  it('rejects duplicate barcode with DUPLICATE_BARCODE', async () => {
    const res = await request(ctx.app)
      .post('/api/products')
      .set(auth(admin))
      .send({ sku: 'NEW-001', barcode: '0490000000019', name: 'Dup', price: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_BARCODE');
  });

  it('rejects duplicate SKU/barcode on update', async () => {
    const list = await request(ctx.app).get('/api/products?q=WATER-001').set(auth(admin));
    const id = list.body.products[0].id;
    const sku = await request(ctx.app)
      .put(`/api/products/${id}`)
      .set(auth(admin))
      .send({ sku: 'COKE-001' });
    expect(sku.body.error.code).toBe('DUPLICATE_SKU');
    const bc = await request(ctx.app)
      .put(`/api/products/${id}`)
      .set(auth(admin))
      .send({ barcode: '0490000000019' });
    expect(bc.body.error.code).toBe('DUPLICATE_BARCODE');
    // keeping own values is fine
    const same = await request(ctx.app)
      .put(`/api/products/${id}`)
      .set(auth(admin))
      .send({ sku: 'WATER-001', barcode: '0490000000033' });
    expect(same.status).toBe(200);
  });

  it('rejects an unknown category', async () => {
    const res = await request(ctx.app)
      .post('/api/products')
      .set(auth(admin))
      .send({ sku: 'X-1', name: 'X', price: 1, categoryId: 999 });
    expect(res.status).toBe(404);
  });

  it('validates input with field details', async () => {
    const res = await request(ctx.app)
      .post('/api/products')
      .set(auth(admin))
      .send({ sku: 'BAD SKU', name: '', price: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
    expect(Object.keys(res.body.error.details)).toEqual(
      expect.arrayContaining(['sku', 'name', 'price']),
    );
  });

  it('cashier cannot create, update, or delete products', async () => {
    expect(
      (
        await request(ctx.app)
          .post('/api/products')
          .set(auth(cashier))
          .send({ sku: 'A', name: 'A', price: 1 })
      ).status,
    ).toBe(403);
    expect(
      (await request(ctx.app).put('/api/products/1').set(auth(cashier)).send({ price: 1 })).status,
    ).toBe(403);
    expect((await request(ctx.app).delete('/api/products/1').set(auth(cashier))).status).toBe(403);
  });

  it('requires authentication', async () => {
    expect((await request(ctx.app).get('/api/products')).status).toBe(401);
  });

  it('delete deactivates a product with history and hard-deletes one without', async () => {
    const created = await request(ctx.app)
      .post('/api/products')
      .set(auth(admin))
      .send({ sku: 'TMP-001', name: 'Temp', price: 1 });
    const del = await request(ctx.app)
      .delete(`/api/products/${created.body.product.id}`)
      .set(auth(admin));
    expect(del.body).toEqual({ deleted: true, deactivated: false });
    expect(
      (await request(ctx.app).get(`/api/products/${created.body.product.id}`).set(auth(admin)))
        .status,
    ).toBe(404);

    const list = await request(ctx.app).get('/api/products?q=COKE-001').set(auth(admin));
    const cokeId = list.body.products[0].id; // has a seed inventory movement
    const del2 = await request(ctx.app).delete(`/api/products/${cokeId}`).set(auth(admin));
    expect(del2.body).toEqual({ deleted: false, deactivated: true });
    expect(
      (await request(ctx.app).get(`/api/products/${cokeId}`).set(auth(admin))).body.product.active,
    ).toBe(false);
  });

  it('returns 404 for a missing product and 400 for a bad id', async () => {
    expect((await request(ctx.app).get('/api/products/9999').set(auth(admin))).status).toBe(404);
    expect((await request(ctx.app).get('/api/products/abc').set(auth(admin))).status).toBe(400);
  });
});

describe('/api/categories', () => {
  let ctx: TestContext;
  let admin: string;
  let cashier: string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  beforeEach(async () => {
    ctx = createTestApp();
    admin = await loginAs(ctx.app, 'admin');
    cashier = await loginAs(ctx.app, 'cashier');
  });
  afterEach(() => ctx.db.close());

  it('lists seeded categories with product counts', async () => {
    const res = await request(ctx.app).get('/api/categories').set(auth(cashier));
    expect(res.status).toBe(200);
    const bev = res.body.categories.find((c: { name: string }) => c.name === 'Beverages');
    expect(bev.productCount).toBeGreaterThanOrEqual(2);
  });

  it('admin can create and update; duplicates are rejected', async () => {
    const created = await request(ctx.app)
      .post('/api/categories')
      .set(auth(admin))
      .send({ name: 'Desserts' });
    expect(created.status).toBe(201);
    const dup = await request(ctx.app)
      .post('/api/categories')
      .set(auth(admin))
      .send({ name: 'desserts' });
    expect(dup.status).toBe(409);
    const updated = await request(ctx.app)
      .put(`/api/categories/${created.body.category.id}`)
      .set(auth(admin))
      .send({ name: 'Sweets', active: false });
    expect(updated.body.category).toMatchObject({ name: 'Sweets', active: false });
    const visible = await request(ctx.app).get('/api/categories').set(auth(admin));
    expect(visible.body.categories.map((c: { name: string }) => c.name)).not.toContain('Sweets');
    const all = await request(ctx.app).get('/api/categories?includeInactive=true').set(auth(admin));
    expect(all.body.categories.map((c: { name: string }) => c.name)).toContain('Sweets');
    expect(
      (await request(ctx.app).put('/api/categories/999').set(auth(admin)).send({ name: 'X' }))
        .status,
    ).toBe(404);
  });

  it('cashier cannot create categories', async () => {
    expect(
      (await request(ctx.app).post('/api/categories').set(auth(cashier)).send({ name: 'X' }))
        .status,
    ).toBe(403);
  });
});

describe('product images', () => {
  let ctx: TestContext;
  let admin: string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  beforeEach(async () => {
    ctx = createTestApp();
    admin = await loginAs(ctx.app, 'admin');
  });
  afterEach(() => ctx.db.close());

  it('seeded products carry image URLs', async () => {
    const res = await request(ctx.app).get('/api/products?q=COKE-001').set(auth(admin));
    expect(res.body.products[0].imageUrl).toMatch(/^https:\/\//);
  });

  it('admin can set, change, and clear an image URL', async () => {
    const created = await request(ctx.app).post('/api/products').set(auth(admin)).send({
      sku: 'IMG-001',
      name: 'With image',
      price: 1,
      imageUrl: 'https://example.com/a.jpg',
    });
    expect(created.status).toBe(201);
    expect(created.body.product.imageUrl).toBe('https://example.com/a.jpg');
    const id = created.body.product.id;
    const changed = await request(ctx.app)
      .put(`/api/products/${id}`)
      .set(auth(admin))
      .send({ imageUrl: 'https://example.com/b.png' });
    expect(changed.body.product.imageUrl).toBe('https://example.com/b.png');
    const cleared = await request(ctx.app)
      .put(`/api/products/${id}`)
      .set(auth(admin))
      .send({ imageUrl: null });
    expect(cleared.body.product.imageUrl).toBeNull();
  });

  it('rejects non-http image URLs', async () => {
    const res = await request(ctx.app)
      .post('/api/products')
      .set(auth(admin))
      .send({ sku: 'IMG-002', name: 'Bad image', price: 1, imageUrl: 'javascript:alert(1)' });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveProperty('imageUrl');
  });
});
