import { z } from 'zod';
import type { Database } from '../db/connection.js';
import { ConflictError, ErrorCodes, NotFoundError } from '../utils/errors.js';
import { parseBody } from '../utils/validation.js';
import { assertPrinterExists } from './printService.js';

export interface CategoryRow {
  id: number;
  name: string;
  printer_id: number | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: number;
  name: string;
  printerId: number | null;
  active: boolean;
  productCount: number;
}

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  printerId: z.number().int().positive().nullable().optional(),
  active: z.boolean().optional(),
});
export type CategoryInput = z.infer<typeof categoryInputSchema>;

type CategoryWithCount = CategoryRow & { product_count: number };

function toCategory(row: CategoryWithCount): Category {
  return {
    id: row.id,
    name: row.name,
    printerId: row.printer_id,
    active: row.active === 1,
    productCount: row.product_count,
  };
}

const SELECT = `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
                FROM categories c`;

export function listCategories(db: Database, includeInactive = false): Category[] {
  const where = includeInactive ? '' : ' WHERE c.active = 1';
  return db
    .all<CategoryWithCount>(`${SELECT}${where} ORDER BY c.name COLLATE NOCASE`)
    .map(toCategory);
}

export function getCategory(db: Database, id: number): Category {
  const row = db.get<CategoryWithCount>(`${SELECT} WHERE c.id = ?`, [id]);
  if (!row) throw new NotFoundError('Category not found');
  return toCategory(row);
}

export function createCategory(db: Database, input: unknown): Category {
  const data = parseBody(categoryInputSchema, input);
  return db.transaction(() => {
    const dup = db.get('SELECT id FROM categories WHERE name = ?', [data.name]);
    if (dup) throw new ConflictError(ErrorCodes.INVALID_REQUEST, 'Category name already exists');
    assertPrinterExists(db, data.printerId);
    const r = db.run('INSERT INTO categories (name, printer_id, active) VALUES (?, ?, ?)', [
      data.name,
      data.printerId ?? null,
      data.active === false ? 0 : 1,
    ]);
    return getCategory(db, r.lastInsertRowid);
  });
}

export function updateCategory(db: Database, id: number, input: unknown): Category {
  const data = parseBody(categoryInputSchema.partial(), input);
  return db.transaction(() => {
    getCategory(db, id);
    if (data.name !== undefined) {
      const dup = db.get('SELECT id FROM categories WHERE name = ? AND id <> ?', [data.name, id]);
      if (dup) throw new ConflictError(ErrorCodes.INVALID_REQUEST, 'Category name already exists');
      db.run('UPDATE categories SET name = ? WHERE id = ?', [data.name, id]);
    }
    if (data.active !== undefined) {
      db.run('UPDATE categories SET active = ? WHERE id = ?', [data.active ? 1 : 0, id]);
    }
    if (data.printerId !== undefined) {
      assertPrinterExists(db, data.printerId);
      db.run('UPDATE categories SET printer_id = ? WHERE id = ?', [data.printerId, id]);
    }
    db.run(
      "UPDATE categories SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
      [id],
    );
    return getCategory(db, id);
  });
}
