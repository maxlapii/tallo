import type { Database } from './connection.js';
import { hashPassword } from '../services/passwordService.js';

/**
 * Deterministic seed data used by development, tests, and E2E runs.
 * Seeding is idempotent: re-running updates existing rows instead of failing.
 */
export const SEED_PASSWORD = 'test-password';

export const SEED_USERS = [
  { username: 'admin', fullName: 'Store Admin', role: 'ADMIN' },
  { username: 'cashier', fullName: 'Front Cashier', role: 'CASHIER' },
  { username: 'sale', fullName: 'Sales Associate', role: 'SALE' },
] as const;

export const SEED_PRINTERS = [
  {
    name: 'Counter receipt printer',
    area: 'Counter',
    printsReceipts: true,
    printsTickets: false,
    sort: 0,
  },
  { name: 'Drink maker', area: 'Drink maker', printsReceipts: false, printsTickets: true, sort: 1 },
  { name: 'Kitchen 1', area: 'Kitchen 1', printsReceipts: false, printsTickets: true, sort: 2 },
  { name: 'Kitchen 2', area: 'Kitchen 2', printsReceipts: false, printsTickets: true, sort: 3 },
] as const;

/** Category → printer area routing. */
export const SEED_CATEGORIES = [
  { name: 'Beverages', area: 'Drink maker' },
  { name: 'Food', area: 'Kitchen 1' },
  { name: 'Snacks', area: 'Kitchen 2' },
] as const;

export const SEED_PRODUCTS = [
  {
    sku: 'COKE-001',
    barcode: '0490000000019',
    image: 'https://images.unsplash.com/photo-1554866585-cd94860890b7?w=640&q=80',
    name: 'Coca Cola',
    category: 'Beverages',
    costCents: 100,
    priceCents: 200,
    taxBp: 1000,
    stock: 100,
    low: 10,
  },
  {
    sku: 'BURGER-001',
    barcode: '0490000000026',
    image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=640&q=80',
    name: 'Burger',
    category: 'Food',
    costCents: 250,
    priceCents: 500,
    taxBp: 1000,
    stock: 50,
    low: 5,
  },
  {
    sku: 'WATER-001',
    barcode: '0490000000033',
    image: 'https://images.unsplash.com/photo-1523362628745-0c100150b504?w=640&q=80',
    name: 'Water',
    category: 'Beverages',
    costCents: 40,
    priceCents: 100,
    taxBp: 0,
    stock: 100,
    low: 20,
  },
  {
    sku: 'CHIPS-001',
    barcode: '0490000000040',
    image: 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=640&q=80',
    name: 'Potato Chips',
    category: 'Snacks',
    costCents: 80,
    priceCents: 150,
    taxBp: 1000,
    stock: 40,
    low: 10,
  },
  {
    sku: 'FRIES-001',
    barcode: '0490000000057',
    image: 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=640&q=80',
    name: 'French Fries',
    category: 'Food',
    costCents: 120,
    priceCents: 300,
    taxBp: 1000,
    stock: 60,
    low: 10,
  },
  {
    sku: 'COFFEE-001',
    barcode: '0490000000064',
    image: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=640&q=80',
    name: 'Coffee',
    category: 'Beverages',
    costCents: 60,
    priceCents: 250,
    taxBp: 1000,
    stock: 80,
    low: 15,
  },
] as const;

let seedHash: string | null = null;

export interface SeedUserInput {
  username: string;
  password: string;
  fullName: string;
  role: 'ADMIN' | 'CASHIER' | 'SALE';
}

/** Creates or updates a single user (used when a new store is provisioned). */
export function seedUser(db: Database, u: SeedUserInput): number {
  const hash =
    u.password === SEED_PASSWORD
      ? (seedHash ??= hashPassword(SEED_PASSWORD))
      : hashPassword(u.password);
  db.run(
    `INSERT INTO users (username, password_hash, full_name, role, active)
     VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(username) DO UPDATE SET
       password_hash = excluded.password_hash,
       full_name     = excluded.full_name,
       role          = excluded.role,
       active        = 1,
       updated_at    = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    [u.username, hash, u.fullName, u.role],
  );
  return db.get<{ id: number }>('SELECT id FROM users WHERE username = ?', [u.username])!.id;
}

/** Full development seed: demo users + demo catalogue. */
export function seed(db: Database): void {
  db.transaction(() => {
    for (const u of SEED_USERS) seedUser(db, { ...u, password: SEED_PASSWORD });
    seedDemoCatalog(db);
  });
}

/** Demo categories, printers, and products (no user accounts). Idempotent. */
export function seedDemoCatalog(db: Database): void {
  db.transaction(() => {
    for (const p of SEED_PRINTERS) {
      const existing = db.get<{ id: number }>('SELECT id FROM printers WHERE area = ?', [p.area]);
      if (existing) continue;
      db.run(
        `INSERT INTO printers (name, area, type, prints_receipts, prints_tickets, active, sort_order)
         VALUES (?, ?, 'BROWSER', ?, ?, 1, ?)`,
        [p.name, p.area, p.printsReceipts ? 1 : 0, p.printsTickets ? 1 : 0, p.sort],
      );
    }

    for (const c of SEED_CATEGORIES) {
      const printer = db.get<{ id: number }>('SELECT id FROM printers WHERE area = ?', [c.area]);
      db.run(
        `INSERT INTO categories (name, printer_id) VALUES (?, ?)
         ON CONFLICT(name) DO UPDATE SET active = 1, printer_id = COALESCE(categories.printer_id, excluded.printer_id)`,
        [c.name, printer?.id ?? null],
      );
    }

    for (const p of SEED_PRODUCTS) {
      const category = db.get<{ id: number }>('SELECT id FROM categories WHERE name = ?', [
        p.category,
      ]);
      const existing = db.get<{ id: number; stock_qty: number }>(
        'SELECT id, stock_qty FROM products WHERE sku = ?',
        [p.sku],
      );
      if (existing) {
        db.run(
          `UPDATE products SET barcode = ?, name = ?, category_id = ?, image_url = ?, cost_price_cents = ?, price_cents = ?,
             tax_rate_bp = ?, low_stock_threshold = ?, active = 1,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ?`,
          [
            p.barcode,
            p.name,
            category?.id ?? null,
            p.image,
            p.costCents,
            p.priceCents,
            p.taxBp,
            p.low,
            existing.id,
          ],
        );
        continue;
      }
      const r = db.run(
        `INSERT INTO products (sku, barcode, name, category_id, image_url, cost_price_cents, price_cents, tax_rate_bp,
                               stock_qty, low_stock_threshold, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          p.sku,
          p.barcode,
          p.name,
          category?.id ?? null,
          p.image,
          p.costCents,
          p.priceCents,
          p.taxBp,
          p.stock,
          p.low,
        ],
      );
      db.run(
        `INSERT INTO inventory_movements (product_id, type, quantity, stock_after, reference_type, note)
         VALUES (?, 'PURCHASE', ?, ?, 'SEED', 'Seed stock')`,
        [r.lastInsertRowid, p.stock, p.stock],
      );
    }
  });
}
