import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/connection.js';
import {
  adjustStock,
  applyStockChange,
  InsufficientStockError,
  listMovements,
} from '../../src/services/inventoryService.js';
import { getProduct } from '../../src/services/productService.js';
import type { AuthUser } from '../../src/services/types.js';
import { createTestDb } from '../helpers.js';

const admin: AuthUser = { id: 1, username: 'admin', role: 'ADMIN', store: 'default' };

describe('inventoryService', () => {
  let db: Database;
  let cokeId: number;
  beforeEach(() => {
    db = createTestDb();
    cokeId = db.get<{ id: number }>("SELECT id FROM products WHERE sku = 'COKE-001'")!.id;
    db.run('UPDATE products SET stock_qty = 10 WHERE id = ?', [cokeId]);
  });
  afterEach(() => db.close());

  it('critical: stock 10, adjustment -3 => stock 7 and movement -3', () => {
    const movement = adjustStock(db, admin, {
      productId: cokeId,
      type: 'ADJUSTMENT',
      quantity: -3,
      note: 'count',
    });
    expect(getProduct(db, cokeId).stockQty).toBe(7);
    expect(movement).toMatchObject({
      type: 'ADJUSTMENT',
      quantity: -3,
      stockAfter: 7,
      note: 'count',
      userId: 1,
    });
    const last = listMovements(db, { productId: cokeId, limit: 1 })[0];
    expect(last?.quantity).toBe(-3);
  });

  it('positive adjustment increases stock', () => {
    adjustStock(db, admin, { productId: cokeId, type: 'PURCHASE', quantity: 25 });
    expect(getProduct(db, cokeId).stockQty).toBe(35);
  });

  it('rejects an adjustment that would make stock negative, leaving stock and movements unchanged', () => {
    const before = listMovements(db, { productId: cokeId }).length;
    expect(() =>
      adjustStock(db, admin, { productId: cokeId, type: 'DAMAGE', quantity: -11 }),
    ).toThrow(InsufficientStockError);
    expect(getProduct(db, cokeId).stockQty).toBe(10);
    expect(listMovements(db, { productId: cokeId })).toHaveLength(before);
  });

  it('rejects PURCHASE with negative quantity and DAMAGE with positive quantity', () => {
    expect(() =>
      adjustStock(db, admin, { productId: cokeId, type: 'PURCHASE', quantity: -1 }),
    ).toThrow(/PURCHASE/);
    expect(() =>
      adjustStock(db, admin, { productId: cokeId, type: 'DAMAGE', quantity: 1 }),
    ).toThrow(/DAMAGE/);
  });

  it('rejects unknown products', () => {
    expect(() =>
      adjustStock(db, admin, { productId: 9999, type: 'ADJUSTMENT', quantity: 1 }),
    ).toThrow(/not found/);
  });

  it('applyStockChange refuses to run outside a transaction', () => {
    expect(() =>
      applyStockChange(db, { productId: cokeId, type: 'SALE', quantity: -1, userId: null }),
    ).toThrow(/inside a transaction/);
  });

  it('applyStockChange rejects zero quantity', () => {
    expect(() =>
      db.transaction(() =>
        applyStockChange(db, { productId: cokeId, type: 'SALE', quantity: 0, userId: null }),
      ),
    ).toThrow(/non-zero/);
  });

  it('transaction rollback leaves stock and movements unchanged', () => {
    const before = listMovements(db, { productId: cokeId }).length;
    expect(() =>
      db.transaction(() => {
        applyStockChange(db, { productId: cokeId, type: 'SALE', quantity: -4, userId: null });
        throw new Error('simulated failure after stock update');
      }),
    ).toThrow('simulated failure');
    expect(getProduct(db, cokeId).stockQty).toBe(10);
    expect(listMovements(db, { productId: cokeId })).toHaveLength(before);
  });
});
