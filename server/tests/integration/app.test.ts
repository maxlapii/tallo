import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import { createLogger } from '../../src/utils/logger.js';
import { createTestApp, type TestContext } from '../helpers.js';

describe('app basics', () => {
  let ctx: TestContext;
  beforeEach(() => {
    ctx = createTestApp();
  });
  afterEach(() => ctx.db.close());

  it('GET /api/health reports ok', async () => {
    const res = await request(ctx.app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('unknown API routes return NOT_FOUND in the standard error format', async () => {
    const res = await request(ctx.app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });
});

describe('errorHandler', () => {
  it('maps unexpected errors to INTERNAL_ERROR without leaking details', async () => {
    const app = express();
    app.get('/boom', () => {
      throw new Error('database exploded: secret detail');
    });
    app.use(errorHandler(createLogger('silent')));
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
    expect(JSON.stringify(res.body)).not.toContain('secret detail');
  });

  it('maps async errors thrown from handlers', async () => {
    const app = express();
    app.get('/async-boom', async () => {
      await Promise.resolve();
      throw new Error('async failure');
    });
    app.use(errorHandler(createLogger('silent')));
    const res = await request(app).get('/async-boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});
