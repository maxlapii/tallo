import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config/index.js';
import { Database } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { createLogger } from '../src/utils/logger.js';

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ...loadConfig({
      NODE_ENV: 'test',
      JWT_SECRET: 'test-jwt-secret-not-for-production',
      LOG_LEVEL: 'silent',
      DATA_DIR: ':memory:',
    }),
    ...overrides,
  };
}

/** Fresh in-memory database with all migrations and seed data applied. */
export function createTestDb(): Database {
  const db = new Database(':memory:');
  migrate(db);
  seed(db);
  return db;
}

export interface TestContext {
  db: Database;
  app: Express;
  config: AppConfig;
}

export function createTestApp(configOverrides: Partial<AppConfig> = {}): TestContext {
  const db = createTestDb();
  const config = testConfig(configOverrides);
  const app = createApp({ db, config, logger: createLogger('silent') });
  return { db, app, config };
}

export async function loginAs(
  app: Express,
  username: 'admin' | 'cashier' | 'sale',
  password = 'test-password',
): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.token as string;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function openRegisterFor(
  app: Express,
  token: string,
  openingCash = 100,
): Promise<number> {
  const res = await request(app)
    .post('/api/registers/open')
    .set(bearer(token))
    .send({ openingCash });
  if (res.status !== 201)
    throw new Error(`Open register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.register.id as number;
}

export function productIdBySku(db: Database, sku: string): number {
  const row = db.get<{ id: number }>('SELECT id FROM products WHERE sku = ?', [sku]);
  if (!row) throw new Error(`No product with sku ${sku}`);
  return row.id;
}

export function stockOf(db: Database, productId: number): number {
  return db.get<{ stock_qty: number }>('SELECT stock_qty FROM products WHERE id = ?', [productId])!
    .stock_qty;
}

export function countRows(db: Database, table: string): number {
  return db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)!.n;
}

/** Snapshot of every financial/inventory table used to assert "nothing changed". */
export function snapshot(db: Database): Record<string, number> {
  const tables = [
    'sales',
    'sale_items',
    'payments',
    'inventory_movements',
    'cash_movements',
    'refunds',
    'refund_items',
  ];
  const out: Record<string, number> = {};
  for (const t of tables) out[t] = countRows(db, t);
  out.stock_sum = db.get<{ s: number }>('SELECT COALESCE(SUM(stock_qty), 0) AS s FROM products')!.s;
  return out;
}
