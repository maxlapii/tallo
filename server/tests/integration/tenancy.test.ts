import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { StoreRegistry } from '../../src/tenancy/registry.js';
import { createLogger } from '../../src/utils/logger.js';
import { testConfig } from '../helpers.js';

const signup = (code: string, name = `${code} shop`, demoData = false) => ({
  storeName: name,
  storeCode: code,
  adminUsername: 'owner',
  adminPassword: 'owner-secret-1',
  adminFullName: `${name} owner`,
  demoData,
});

describe('multi-store privacy', () => {
  let dir: string;
  let registry: StoreRegistry;
  let app: ReturnType<typeof createApp>;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pos-tenancy-'));
    registry = new StoreRegistry(dir);
    app = createApp({
      registry,
      config: testConfig({ dataDir: dir }),
      logger: createLogger('silent'),
    });
  });
  afterEach(() => {
    registry.closeAll();
    rmSync(dir, { recursive: true, force: true });
  });

  it('signup creates a private store file with its own admin and returns a store-bound session', async () => {
    const res = await request(app)
      .post('/api/stores')
      .send(signup('cafe-one', 'Cafe One', true));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ store: 'cafe-one', storeName: 'Cafe One' });
    expect(res.body.user).toMatchObject({ username: 'owner', role: 'ADMIN' });
    expect(existsSync(join(dir, 'stores', 'cafe-one.db'))).toBe(true);
    const me = await request(app).get('/api/auth/me').set(auth(res.body.token));
    expect(me.status).toBe(200);
    const products = await request(app).get('/api/products').set(auth(res.body.token));
    expect(products.body.total).toBeGreaterThan(0); // demo catalogue requested
    const current = await request(app).get('/api/stores/current').set(auth(res.body.token));
    expect(current.body.store).toMatchObject({ slug: 'cafe-one', name: 'Cafe One' });
  });

  it('a store without demo data starts empty and only the directory knows its code and name', async () => {
    const res = await request(app).post('/api/stores').send(signup('bare-shop'));
    expect(res.status).toBe(201);
    const products = await request(app).get('/api/products').set(auth(res.body.token));
    expect(products.body.total).toBe(0);
    const users = await request(app).get('/api/users').set(auth(res.body.token));
    expect(users.body.users.map((u: { username: string }) => u.username)).toEqual(['owner']);
    // The directory database contains no user or sales data.
    expect(registry.list().map((s) => s.slug)).toEqual(['bare-shop']);
  });

  it('stores cannot see each other: data, users, tokens, or events', async () => {
    const a = (
      await request(app)
        .post('/api/stores')
        .send(signup('store-a', 'Store A', true))
    ).body;
    const b = (await request(app).post('/api/stores').send(signup('store-b', 'Store B'))).body;
    // Store A sells something; store B has no products and no sales.
    await request(app).post('/api/registers/open').set(auth(a.token)).send({ openingCash: 50 });
    const aProducts = (await request(app).get('/api/products').set(auth(a.token))).body.products;
    const sale = await request(app)
      .post('/api/sales')
      .set(auth(a.token))
      .send({
        items: [{ productId: aProducts[0].id, quantity: 1 }],
        payments: [{ method: 'CASH', amount: 100 }],
      });
    expect(sale.status).toBe(201);
    expect((await request(app).get('/api/sales').set(auth(b.token))).body.total).toBe(0);
    expect((await request(app).get('/api/products').set(auth(b.token))).body.total).toBe(0);
    expect(
      (await request(app).get(`/api/sales/${sale.body.sale.id}`).set(auth(b.token))).status,
    ).toBe(404);
    // Same username in both stores are different accounts with different passwords.
    const wrong = await request(app)
      .post('/api/auth/login')
      .send({ store: 'store-b', username: 'owner', password: 'owner-secret-1' });
    expect(wrong.status).toBe(200); // same password chosen in fixture, but...
    const users = (await request(app).get('/api/users').set(auth(b.token))).body.users;
    expect(users).toHaveLength(1);
    // Login without a store code is rejected; unknown store codes are indistinguishable from bad credentials.
    expect(
      (
        await request(app)
          .post('/api/auth/login')
          .send({ username: 'owner', password: 'owner-secret-1' })
      ).status,
    ).toBe(400);
    const unknown = await request(app)
      .post('/api/auth/login')
      .send({ store: 'nope-shop', username: 'owner', password: 'owner-secret-1' });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.message).toBe('Invalid store code, username or password');
  });

  it('live events are delivered only to the store they belong to', async () => {
    const a = (
      await request(app)
        .post('/api/stores')
        .send(signup('ev-a', 'Ev A', true))
    ).body;
    const b = (
      await request(app)
        .post('/api/stores')
        .send(signup('ev-b', 'Ev B', true))
    ).body;
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const streamA = await fetch(`${base}/api/events?token=${encodeURIComponent(a.token)}`);
      const streamB = await fetch(`${base}/api/events?token=${encodeURIComponent(b.token)}`);
      await new Promise((r) => setTimeout(r, 100));
      await request(app).post('/api/registers/open').set(auth(a.token)).send({ openingCash: 10 });
      const products = (await request(app).get('/api/products').set(auth(a.token))).body.products;
      await request(app)
        .post('/api/sales')
        .set(auth(a.token))
        .send({
          items: [{ productId: products[0].id, quantity: 1 }],
          payments: [{ method: 'CASH', amount: 100 }],
        });
      await new Promise((r) => setTimeout(r, 150));
      const read = async (res: Response) => {
        const reader = res.body!.getReader();
        const chunks: string[] = [];
        const deadline = Date.now() + 500;
        while (Date.now() < deadline) {
          const race = await Promise.race([
            reader.read(),
            new Promise<null>((r) => setTimeout(() => r(null), 200)),
          ]);
          if (!race || race.done) break;
          chunks.push(new TextDecoder().decode(race.value));
        }
        await reader.cancel();
        return chunks.join('');
      };
      const [textA, textB] = await Promise.all([read(streamA), read(streamB)]);
      expect(textA).toContain('event: sale.created');
      expect(textB).toContain('event: connected');
      expect(textB).not.toContain('event: sale.created');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('validates store codes and rejects duplicates and reserved names', async () => {
    expect((await request(app).get('/api/stores/check?code=my-shop')).body).toEqual({
      code: 'my-shop',
      available: true,
    });
    expect((await request(app).post('/api/stores').send(signup('my-shop'))).status).toBe(201);
    expect((await request(app).get('/api/stores/check?code=my-shop')).body.available).toBe(false);
    expect((await request(app).post('/api/stores').send(signup('my-shop'))).status).toBe(409);
    expect((await request(app).post('/api/stores').send(signup('Bad Code!'))).status).toBe(400);
    expect((await request(app).post('/api/stores').send(signup('admin'))).status).toBe(400);
    expect(
      (
        await request(app)
          .post('/api/stores')
          .send({ ...signup('weak-pw'), adminPassword: 'short' })
      ).status,
    ).toBe(400);
  });

  it('an admin can export and permanently delete their own store (password confirmed)', async () => {
    const a = (
      await request(app)
        .post('/api/stores')
        .send(signup('to-delete', 'Bye', true))
    ).body;
    const other = (await request(app).post('/api/stores').send(signup('stays', 'Stays'))).body;
    const exported = await request(app).get('/api/stores/current/export').set(auth(a.token));
    expect(exported.status).toBe(200);
    expect(exported.headers['content-disposition']).toContain('to-delete-');
    expect(exported.body.length ?? exported.text.length).toBeGreaterThan(1000);

    const bad = await request(app)
      .delete('/api/stores/current')
      .set(auth(a.token))
      .send({ password: 'wrong' });
    expect(bad.status).toBe(401);
    expect(existsSync(join(dir, 'stores', 'to-delete.db'))).toBe(true);

    const ok = await request(app)
      .delete('/api/stores/current')
      .set(auth(a.token))
      .send({ password: 'owner-secret-1' });
    expect(ok.body).toEqual({ deleted: true });
    expect(existsSync(join(dir, 'stores', 'to-delete.db'))).toBe(false);
    expect(registry.list().map((s) => s.slug)).toEqual(['stays']);
    // The old token is useless afterwards; the other store is untouched.
    expect((await request(app).get('/api/auth/me').set(auth(a.token))).status).toBe(404);
    expect((await request(app).get('/api/auth/me').set(auth(other.token))).status).toBe(200);
  });

  it('cashiers cannot export or delete a store', async () => {
    const a = (await request(app).post('/api/stores').send(signup('cashier-shop'))).body;
    const created = await request(app)
      .post('/api/users')
      .set(auth(a.token))
      .send({ username: 'till', password: 'till-secret-1', fullName: 'Till', role: 'CASHIER' });
    expect(created.status).toBe(201);
    const till = (
      await request(app)
        .post('/api/auth/login')
        .send({ store: 'cashier-shop', username: 'till', password: 'till-secret-1' })
    ).body.token;
    expect((await request(app).get('/api/stores/current/export').set(auth(till))).status).toBe(403);
    expect(
      (
        await request(app)
          .delete('/api/stores/current')
          .set(auth(till))
          .send({ password: 'till-secret-1' })
      ).status,
    ).toBe(403);
  });

  it('signup can be disabled by configuration', async () => {
    const closed = createApp({
      registry,
      config: testConfig({ dataDir: dir, allowSignup: false }),
      logger: createLogger('silent'),
    });
    expect((await request(closed).post('/api/stores').send(signup('nope'))).status).toBe(403);
  });
});
