import { z } from 'zod';
import { basisPointsToPercent, fromCents, percentToBasisPoints, toCents } from '@tallo/shared';
import type { Database } from '../db/connection.js';
import { ConflictError, ErrorCodes, NotFoundError } from '../utils/errors.js';
import {
  moneySchema,
  nonNegativeIntSchema,
  parseBody,
  taxRateSchema,
} from '../utils/validation.js';
import { recordAudit } from './auditService.js';
import { assertPrinterExists } from './printService.js';
import type { AuthUser } from './types.js';

export interface ProductRow {
  id: number;
  sku: string;
  barcode: string | null;
  name: string;
  category_id: number | null;
  category_name?: string | null;
  image_url: string | null;
  printer_id: number | null;
  cost_price_cents: number;
  price_cents: number;
  tax_rate_bp: number;
  stock_qty: number;
  low_stock_threshold: number;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: number;
  sku: string;
  barcode: string | null;
  name: string;
  categoryId: number | null;
  categoryName: string | null;
  imageUrl: string | null;
  printerId: number | null;
  costPrice: number;
  price: number;
  taxRate: number;
  stockQty: number;
  lowStockThreshold: number;
  lowStock: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export const productInputSchema = z.object({
  sku: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(
      /^[A-Za-z0-9._-]+$/,
      'SKU may only contain letters, numbers, dots, underscores, and hyphens',
    ),
  barcode: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9-]+$/, 'Barcode may only contain letters, numbers, and hyphens')
    .nullable()
    .optional(),
  name: z.string().trim().min(1).max(120),
  categoryId: z.number().int().positive().nullable().optional(),
  imageUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => /^https?:\/\/\S+$/i.test(v), 'Image must be an http(s) URL')
    .nullable()
    .optional(),
  printerId: z.number().int().positive().nullable().optional(),
  costPrice: moneySchema.optional(),
  price: moneySchema,
  taxRate: taxRateSchema.optional(),
  stockQty: nonNegativeIntSchema.optional(),
  lowStockThreshold: nonNegativeIntSchema.optional(),
  active: z.boolean().optional(),
});
export type ProductInput = z.infer<typeof productInputSchema>;

export const productUpdateSchema = productInputSchema.omit({ stockQty: true }).partial();
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;

export function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    sku: row.sku,
    barcode: row.barcode,
    name: row.name,
    categoryId: row.category_id,
    categoryName: row.category_name ?? null,
    imageUrl: row.image_url ?? null,
    printerId: row.printer_id ?? null,
    costPrice: fromCents(row.cost_price_cents),
    price: fromCents(row.price_cents),
    taxRate: basisPointsToPercent(row.tax_rate_bp),
    stockQty: row.stock_qty,
    lowStockThreshold: row.low_stock_threshold,
    lowStock: row.stock_qty <= row.low_stock_threshold,
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT = `SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id`;

export interface ProductFilter {
  q?: string | undefined;
  categoryId?: number | undefined;
  active?: boolean | undefined;
  lowStock?: boolean | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export function listProducts(
  db: Database,
  filter: ProductFilter = {},
): { products: Product[]; total: number } {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.q) {
    const like = `%${filter.q}%`;
    where.push('(p.sku LIKE ? OR p.barcode LIKE ? OR p.name LIKE ?)');
    params.push(like, like, like);
  }
  if (filter.categoryId !== undefined) {
    where.push('p.category_id = ?');
    params.push(filter.categoryId);
  }
  if (filter.active !== undefined) {
    where.push('p.active = ?');
    params.push(filter.active ? 1 : 0);
  }
  if (filter.lowStock) {
    where.push('p.stock_qty <= p.low_stock_threshold');
  }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const total =
    db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM products p${whereSql}`, params)?.n ?? 0;
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const offset = Math.max(filter.offset ?? 0, 0);
  const rows = db.all<ProductRow>(
    `${SELECT}${whereSql} ORDER BY p.name COLLATE NOCASE LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return { products: rows.map(toProduct), total };
}

export function getProduct(db: Database, id: number): Product {
  const row = db.get<ProductRow>(`${SELECT} WHERE p.id = ?`, [id]);
  if (!row) throw new NotFoundError('Product not found');
  return toProduct(row);
}

/** Exact match on barcode first, then SKU (case-insensitive). Used by scanners. */
export function lookupProductByCode(db: Database, code: string): Product {
  const row =
    db.get<ProductRow>(`${SELECT} WHERE p.barcode = ?`, [code]) ??
    db.get<ProductRow>(`${SELECT} WHERE p.sku = ? COLLATE NOCASE`, [code]);
  if (!row) throw new NotFoundError('Product not found');
  return toProduct(row);
}

function assertUnique(
  db: Database,
  sku: string,
  barcode: string | null | undefined,
  excludeId = 0,
): void {
  const skuDup = db.get('SELECT id FROM products WHERE sku = ? AND id <> ?', [sku, excludeId]);
  if (skuDup) throw new ConflictError(ErrorCodes.DUPLICATE_SKU, `SKU "${sku}" already exists`);
  if (barcode) {
    const bcDup = db.get('SELECT id FROM products WHERE barcode = ? AND id <> ?', [
      barcode,
      excludeId,
    ]);
    if (bcDup)
      throw new ConflictError(ErrorCodes.DUPLICATE_BARCODE, `Barcode "${barcode}" already exists`);
  }
}

function assertCategory(db: Database, categoryId: number | null | undefined): void {
  if (categoryId === null || categoryId === undefined) return;
  const c = db.get('SELECT id FROM categories WHERE id = ?', [categoryId]);
  if (!c) throw new NotFoundError('Category not found');
}

export function createProduct(db: Database, actor: AuthUser, input: unknown): Product {
  const data = parseBody(productInputSchema, input);
  return db.transaction(() => {
    assertUnique(db, data.sku, data.barcode);
    assertCategory(db, data.categoryId);
    assertPrinterExists(db, data.printerId);
    const r = db.run(
      `INSERT INTO products (sku, barcode, name, category_id, image_url, printer_id, cost_price_cents, price_cents, tax_rate_bp,
                             stock_qty, low_stock_threshold, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.sku,
        data.barcode ?? null,
        data.name,
        data.categoryId ?? null,
        data.imageUrl ?? null,
        data.printerId ?? null,
        toCents(data.costPrice ?? 0),
        toCents(data.price),
        percentToBasisPoints(data.taxRate ?? 0),
        data.stockQty ?? 0,
        data.lowStockThreshold ?? 0,
        data.active === false ? 0 : 1,
      ],
    );
    const id = r.lastInsertRowid;
    if ((data.stockQty ?? 0) > 0) {
      db.run(
        `INSERT INTO inventory_movements (product_id, type, quantity, stock_after, reference_type, note, user_id)
         VALUES (?, 'PURCHASE', ?, ?, 'PRODUCT_CREATE', 'Initial stock', ?)`,
        [id, data.stockQty ?? 0, data.stockQty ?? 0, actor.id],
      );
    }
    recordAudit(db, {
      userId: actor.id,
      action: 'PRODUCT_CREATE',
      entity: 'products',
      entityId: id,
      details: { sku: data.sku, price: data.price },
    });
    return getProduct(db, id);
  });
}

export function updateProduct(db: Database, actor: AuthUser, id: number, input: unknown): Product {
  const data = parseBody(productUpdateSchema, input);
  return db.transaction(() => {
    const before = getProduct(db, id);
    assertUnique(
      db,
      data.sku ?? before.sku,
      data.barcode === undefined ? before.barcode : data.barcode,
      id,
    );
    assertCategory(db, data.categoryId);

    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    const set = (col: string, value: string | number | null) => {
      sets.push(`${col} = ?`);
      params.push(value);
    };
    if (data.sku !== undefined) set('sku', data.sku);
    if (data.barcode !== undefined) set('barcode', data.barcode);
    if (data.name !== undefined) set('name', data.name);
    if (data.categoryId !== undefined) set('category_id', data.categoryId);
    if (data.imageUrl !== undefined) set('image_url', data.imageUrl);
    if (data.printerId !== undefined) {
      assertPrinterExists(db, data.printerId);
      set('printer_id', data.printerId);
    }
    if (data.costPrice !== undefined) set('cost_price_cents', toCents(data.costPrice));
    if (data.price !== undefined) set('price_cents', toCents(data.price));
    if (data.taxRate !== undefined) set('tax_rate_bp', percentToBasisPoints(data.taxRate));
    if (data.lowStockThreshold !== undefined) set('low_stock_threshold', data.lowStockThreshold);
    if (data.active !== undefined) set('active', data.active ? 1 : 0);
    if (sets.length > 0) {
      sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
      db.run(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    }
    const after = getProduct(db, id);
    if (after.price !== before.price) {
      recordAudit(db, {
        userId: actor.id,
        action: 'PRODUCT_PRICE_CHANGE',
        entity: 'products',
        entityId: id,
        details: { from: before.price, to: after.price },
      });
    }
    recordAudit(db, {
      userId: actor.id,
      action: 'PRODUCT_UPDATE',
      entity: 'products',
      entityId: id,
      details: { fields: Object.keys(data) },
    });
    return after;
  });
}

/**
 * Products referenced by sales are never physically deleted (history must be
 * preserved); they are deactivated instead. Unreferenced products are removed.
 */
export function deleteProduct(
  db: Database,
  actor: AuthUser,
  id: number,
): { deleted: boolean; deactivated: boolean } {
  return db.transaction(() => {
    getProduct(db, id);
    const referenced =
      db.get('SELECT 1 FROM sale_items WHERE product_id = ? LIMIT 1', [id]) ??
      db.get('SELECT 1 FROM inventory_movements WHERE product_id = ? LIMIT 1', [id]);
    if (referenced) {
      db.run(
        "UPDATE products SET active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
        [id],
      );
      recordAudit(db, {
        userId: actor.id,
        action: 'PRODUCT_DEACTIVATE',
        entity: 'products',
        entityId: id,
      });
      return { deleted: false, deactivated: true };
    }
    db.run('DELETE FROM products WHERE id = ?', [id]);
    recordAudit(db, {
      userId: actor.id,
      action: 'PRODUCT_DELETE',
      entity: 'products',
      entityId: id,
    });
    return { deleted: true, deactivated: false };
  });
}
