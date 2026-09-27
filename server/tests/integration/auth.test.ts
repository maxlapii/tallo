import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, loginAs, type TestContext } from '../helpers.js';

describe('POST /api/auth/login', () => {
  let ctx: TestContext;
  beforeEach(() => {
    ctx = createTestApp();
  });
  afterEach(() => ctx.db.close());

  it('returns a token and the user for valid credentials', async () => {
    const res = await request(ctx.app)
      .post('/api/auth/login')
      .send({ username: 'cashier', password: 'test-password' });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user).toMatchObject({
      username: 'cashier',
      role: 'CASHIER',
      fullName: 'Front Cashier',
    });
    expect(res.body.user).not.toHaveProperty('password_hash');
    expect(res.body.user).not.toHaveProperty('passwordHash');
  });

  it('rejects a wrong password with 401 UNAUTHORIZED', async () => {
    const res = await request(ctx.app)
      .post('/api/auth/login')
      .send({ username: 'cashier', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Invalid username or password' },
    });
  });

  it('rejects an unknown username with 401', async () => {
    const res = await request(ctx.app)
      .post('/api/auth/login')
      .send({ username: 'nobody', password: 'test-password' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects an inactive user', async () => {
    ctx.db.run("UPDATE users SET active = 0 WHERE username = 'cashier'");
    const res = await request(ctx.app)
      .post('/api/auth/login')
      .send({ username: 'cashier', password: 'test-password' });
    expect(res.status).toBe(401);
  });

  it('validates the request body', async () => {
    const res = await request(ctx.app).post('/api/auth/login').send({ username: 'cashier' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
    expect(res.body.error.details).toHaveProperty('password');
  });

  it('rejects malformed JSON', async () => {
    const res = await request(ctx.app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"username": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
  });

  it('rate limits repeated login attempts', async () => {
    const limited = createTestApp({ loginRateLimit: { max: 2, windowMs: 60_000 } });
    try {
      const attempt = () =>
        request(limited.app)
          .post('/api/auth/login')
          .send({ username: 'cashier', password: 'wrong' });
      expect((await attempt()).status).toBe(401);
      expect((await attempt()).status).toBe(401);
      const third = await attempt();
      expect(third.status).toBe(429);
      expect(third.body.error.code).toBe('RATE_LIMITED');
    } finally {
      limited.db.close();
    }
  });
});

describe('authentication middleware', () => {
  let ctx: TestContext;
  beforeEach(() => {
    ctx = createTestApp();
  });
  afterEach(() => ctx.db.close());

  it('rejects requests without a token', async () => {
    const res = await request(ctx.app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a malformed Authorization header', async () => {
    const res = await request(ctx.app).get('/api/auth/me').set('Authorization', 'Basic abc');
    expect(res.status).toBe(401);
  });

  it('rejects an invalid token', async () => {
    const res = await request(ctx.app).get('/api/auth/me').set('Authorization', 'Bearer nope');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns the current user for a valid token', async () => {
    const token = await loginAs(ctx.app, 'admin');
    const res = await request(ctx.app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ username: 'admin', role: 'ADMIN' });
  });

  it('rejects a token for a user deactivated after login', async () => {
    const token = await loginAs(ctx.app, 'cashier');
    ctx.db.run("UPDATE users SET active = 0 WHERE username = 'cashier'");
    const res = await request(ctx.app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});

describe('role authorization', () => {
  let ctx: TestContext;
  beforeEach(() => {
    ctx = createTestApp();
  });
  afterEach(() => ctx.db.close());

  it('forbids a cashier from listing users', async () => {
    const token = await loginAs(ctx.app, 'cashier');
    const res = await request(ctx.app).get('/api/users').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action' },
    });
  });

  it('allows an admin to list users', async () => {
    const token = await loginAs(ctx.app, 'admin');
    const res = await request(ctx.app).get('/api/users').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.users.map((u: { username: string }) => u.username)).toEqual([
      'admin',
      'cashier',
      'sale',
    ]);
  });

  it('requires authentication before checking roles', async () => {
    const res = await request(ctx.app).get('/api/users');
    expect(res.status).toBe(401);
  });
});
