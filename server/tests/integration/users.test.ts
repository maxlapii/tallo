import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listAuditLogs } from '../../src/services/auditService.js';
import { createTestApp, loginAs, type TestContext } from '../helpers.js';

describe('/api/users', () => {
  let ctx: TestContext;
  let adminToken: string;
  beforeEach(async () => {
    ctx = createTestApp();
    adminToken = await loginAs(ctx.app, 'admin');
  });
  afterEach(() => ctx.db.close());

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('admin can create a user and the change is audited', async () => {
    const res = await request(ctx.app).post('/api/users').set(auth(adminToken)).send({
      username: 'new.cashier',
      password: 'a-strong-pass',
      fullName: 'New Cashier',
      role: 'CASHIER',
    });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ username: 'new.cashier', role: 'CASHIER', active: true });

    const logs = listAuditLogs(ctx.db, 'users', res.body.user.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action: 'USER_CREATE',
      entity: 'users',
      entity_id: res.body.user.id,
    });
    expect(JSON.parse(logs[0]!.details!)).toEqual({ username: 'new.cashier', role: 'CASHIER' });
    expect(logs[0]!.details).not.toContain('a-strong-pass');

    // New user can log in.
    const login = await request(ctx.app)
      .post('/api/auth/login')
      .send({ username: 'new.cashier', password: 'a-strong-pass' });
    expect(login.status).toBe(200);
  });

  it('rejects a duplicate username (case-insensitive) with DUPLICATE_USERNAME', async () => {
    const res = await request(ctx.app)
      .post('/api/users')
      .set(auth(adminToken))
      .send({ username: 'Admin', password: 'a-strong-pass', fullName: 'Dup', role: 'CASHIER' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_USERNAME');
    expect(listAuditLogs(ctx.db, 'users')).toHaveLength(0);
  });

  it.each([
    [
      'short username',
      { username: 'ab', password: 'a-strong-pass', fullName: 'X', role: 'CASHIER' },
    ],
    [
      'invalid characters',
      { username: 'bad user!', password: 'a-strong-pass', fullName: 'X', role: 'CASHIER' },
    ],
    [
      'short password',
      { username: 'validname', password: 'short', fullName: 'X', role: 'CASHIER' },
    ],
    [
      'unknown role',
      { username: 'validname', password: 'a-strong-pass', fullName: 'X', role: 'OWNER' },
    ],
    ['missing full name', { username: 'validname', password: 'a-strong-pass', role: 'CASHIER' }],
  ])('rejects invalid input: %s', async (_label, body) => {
    const res = await request(ctx.app).post('/api/users').set(auth(adminToken)).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
  });

  it('cashier cannot create users', async () => {
    const cashierToken = await loginAs(ctx.app, 'cashier');
    const res = await request(ctx.app)
      .post('/api/users')
      .set(auth(cashierToken))
      .send({ username: 'sneaky', password: 'a-strong-pass', fullName: 'X', role: 'ADMIN' });
    expect(res.status).toBe(403);
    expect(ctx.db.get('SELECT id FROM users WHERE username = ?', ['sneaky'])).toBeUndefined();
  });

  it('gets a single user and 404s for a missing one', async () => {
    const ok = await request(ctx.app).get('/api/users/1').set(auth(adminToken));
    expect(ok.status).toBe(200);
    expect(ok.body.user.username).toBe('admin');
    const missing = await request(ctx.app).get('/api/users/999').set(auth(adminToken));
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
    const bad = await request(ctx.app).get('/api/users/abc').set(auth(adminToken));
    expect(bad.status).toBe(400);
  });
});
