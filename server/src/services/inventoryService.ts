import { z } from 'zod';
import type { Database } from '../db/connection.js';
import { AppError, ErrorCodes, InvalidRequestError, NotFoundError } from '../utils/errors.js';
import { parseBody } from '../utils/validation.js';
import { eventBus } from '../realtime/eventBus.js';
import { recordAudit } from './auditService.js';
import { listProducts, type Product, type ProductFilter } from './productService.js';
import type { AuthUser } from './types.js';

export const MovementTypes = ['PURCHASE', 'SALE', 'RETURN', 'DAMAGE', 'ADJUSTMENT'] as const;
export type MovementType = (typeof MovementTypes)[number];

/** Types a user may create manually; SALE/RETURN via sale are system-generated. */
export const ManualMovementTypes = ['PURCHASE', 'RETURN', 'DAMAGE', 'ADJUSTMENT'] as const;

export interface InventoryMovementRow {
  id: number;
  product_id: number;
  product_name?: string;
  product_sku?: string;
  type: MovementType;
  quantity: number;
  stock_after: number;
  reference_type: string | null;
  reference_id: number | null;
  note: string | null;
  user_id: number | null;
  user_name?: string | null;
  created_at: string;
}

export interface InventoryMovement {
  id: number;
  productId: number;
  productName: string;
  productSku: string;
  type: MovementType;
  quantity: number;
  stockAfter: number;
  referenceType: string | null;
  referenceId: number | null;
  note: string | null;
  userId: number | null;
  userName: string | null;
  createdAt: string;
}

export function toMovement(row: InventoryMovementRow): InventoryMovement {
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name ?? '',
    productSku: row.product_sku ?? '',
    type: row.type,
    quantity: row.quantity,
    stockAfter: row.stock_after,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    note: row.note,
    userId: row.user_id,
    userName: row.user_name ?? null,
    createdAt: row.created_at,
  };
}

export class InsufficientStockError extends AppError {
  constructor(productName: string, available: number, requested: number) {
    super(
      ErrorCodes.INSUFFICIENT_STOCK,
      `Insufficient stock for product "${productName}" (available ${available}, requested ${requested})`,
      409,
      { available, requested },
    );
  }
}

export interface StockChange {
  productId: number;
  type: MovementType;
  /** Signed quantity: negative removes stock, positive adds. Never zero. */
  quantity: number;
  referenceType?: string | null;
  referenceId?: number | null;
  note?: string | null;
  userId: number | null;
}

/**
 * The single place where product stock changes. Updates `products.stock_qty`
 * and records an `inventory_movements` row in the same transaction. Throws
 * INSUFFICIENT_STOCK if the change would make stock negative.
 *
 * Must be called inside a transaction (asserted) so callers never leave a
 * stock change without its movement or vice-versa.
 */
export function applyStockChange(db: Database, change: StockChange): InventoryMovement {
  if (!db.inTransaction) throw new Error('applyStockChange must run inside a transaction');
  if (!Number.isInteger(change.quantity) || change.quantity === 0) {
    throw new InvalidRequestError('Stock change quantity must be a non-zero integer');
  }
  const product = db.get<{ id: number; name: string; stock_qty: number }>(
    'SELECT id, name, stock_qty FROM products WHERE id = ?',
    [change.productId],
  );
  if (!product) throw new NotFoundError('Product not found');
  const after = product.stock_qty + change.quantity;
  if (after < 0) {
    throw new InsufficientStockError(product.name, product.stock_qty, -change.quantity);
  }
  db.run(
    "UPDATE products SET stock_qty = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
    [after, change.productId],
  );
  const r = db.run(
    `INSERT INTO inventory_movements (product_id, type, quantity, stock_after, reference_type, reference_id, note, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      change.productId,
      change.type,
      change.quantity,
      after,
      change.referenceType ?? null,
      change.referenceId ?? null,
      change.note ?? null,
      change.userId,
    ],
  );
  return getMovement(db, r.lastInsertRowid);
}

export const adjustStockSchema = z.object({
  productId: z.number().int().positive(),
  type: z.enum(ManualMovementTypes),
  quantity: z
    .number()
    .int()
    .refine((q) => q !== 0, 'Quantity cannot be zero'),
  note: z.string().trim().max(200).optional(),
});
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;

/** Manual stock adjustment by a user; audited. */
export function adjustStock(db: Database, actor: AuthUser, input: unknown): InventoryMovement {
  const data = parseBody(adjustStockSchema, input);
  if (data.type === 'PURCHASE' && data.quantity < 0) {
    throw new InvalidRequestError('PURCHASE must add stock');
  }
  if (data.type === 'DAMAGE' && data.quantity > 0) {
    throw new InvalidRequestError('DAMAGE must remove stock');
  }
  const movement = db.transaction(() => {
    const movement = applyStockChange(db, {
      productId: data.productId,
      type: data.type,
      quantity: data.quantity,
      referenceType: 'MANUAL',
      note: data.note ?? null,
      userId: actor.id,
    });
    recordAudit(db, {
      userId: actor.id,
      action: 'INVENTORY_ADJUST',
      entity: 'products',
      entityId: data.productId,
      details: {
        type: data.type,
        quantity: data.quantity,
        stockAfter: movement.stockAfter,
        note: data.note,
      },
    });
    return movement;
  });
  eventBus.broadcast({
    type: 'stock.changed',
    payload: {
      products: [
        { productId: movement.productId, sku: movement.productSku, stockQty: movement.stockAfter },
      ],
    },
  });
  return movement;
}

const MOVEMENT_SELECT = `SELECT m.*, p.name AS product_name, p.sku AS product_sku, u.full_name AS user_name
                         FROM inventory_movements m
                         JOIN products p ON p.id = m.product_id
                         LEFT JOIN users u ON u.id = m.user_id`;

export function getMovement(db: Database, id: number): InventoryMovement {
  const row = db.get<InventoryMovementRow>(`${MOVEMENT_SELECT} WHERE m.id = ?`, [id]);
  if (!row) throw new NotFoundError('Movement not found');
  return toMovement(row);
}

export interface MovementFilter {
  productId?: number | undefined;
  type?: MovementType | undefined;
  referenceType?: string | undefined;
  referenceId?: number | undefined;
  limit?: number | undefined;
}

export function listMovements(db: Database, filter: MovementFilter = {}): InventoryMovement[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.productId !== undefined) {
    where.push('m.product_id = ?');
    params.push(filter.productId);
  }
  if (filter.type !== undefined) {
    where.push('m.type = ?');
    params.push(filter.type);
  }
  if (filter.referenceType !== undefined) {
    where.push('m.reference_type = ?');
    params.push(filter.referenceType);
  }
  if (filter.referenceId !== undefined) {
    where.push('m.reference_id = ?');
    params.push(filter.referenceId);
  }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 1000);
  return db
    .all<InventoryMovementRow>(`${MOVEMENT_SELECT}${whereSql} ORDER BY m.id DESC LIMIT ?`, [
      ...params,
      limit,
    ])
    .map(toMovement);
}

export interface InventorySummary {
  products: Product[];
  total: number;
  lowStockCount: number;
}

export function getInventory(db: Database, filter: ProductFilter = {}): InventorySummary {
  const { products, total } = listProducts(db, filter);
  const lowStockCount =
    db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM products WHERE active = 1 AND stock_qty <= low_stock_threshold',
    )?.n ?? 0;
  return { products, total, lowStockCount };
}
