import { z } from 'zod';
import { fromCents, PaymentMethods, roundHalfUp } from '@tallo/shared';
import type { Database } from '../db/connection.js';
import { AppError, ErrorCodes, InvalidRequestError, NotFoundError } from '../utils/errors.js';
import { parseBody } from '../utils/validation.js';
import { eventBus } from '../realtime/eventBus.js';
import { recordAudit } from './auditService.js';
import { applyStockChange } from './inventoryService.js';
import { recordSaleCash, requireOpenRegisterId } from './registerService.js';
import { currentStock, getSale, type RefundSummary, type Sale } from './salesService.js';
import type { AuthUser } from './types.js';

export const refundSchema = z.object({
  items: z
    .array(
      z.object({ saleItemId: z.number().int().positive(), quantity: z.number().int().positive() }),
    )
    .min(1, 'Select at least one item to refund')
    .max(200),
  refundMethod: z.enum(PaymentMethods),
  reason: z.string().trim().max(200).optional(),
});
export type RefundInput = z.infer<typeof refundSchema>;

export class RefundExceedsQuantityError extends AppError {
  constructor(productName: string, refundable: number, requested: number) {
    super(
      ErrorCodes.REFUND_EXCEEDS_QUANTITY,
      `Cannot refund ${requested} x "${productName}": only ${refundable} refundable`,
      409,
      { refundable, requested },
    );
  }
}

interface ItemRow {
  id: number;
  sale_id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  unit_price_cents: number;
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
  refunded_quantity: number;
}

/**
 * Amount to refund for `qty` units of a sale item. Proportional to the line's
 * net amounts; when the last refundable units are returned, the remainder of
 * the line is refunded so rounding never leaves cents behind.
 */
export function computeRefundAmounts(
  item: {
    quantity: number;
    subtotal_cents: number;
    discount_cents: number;
    tax_cents: number;
    total_cents: number;
    refunded_quantity: number;
  },
  alreadyRefunded: { subtotal: number; tax: number; total: number },
  qty: number,
): { subtotalCents: number; taxCents: number; totalCents: number } {
  const netSubtotal = item.subtotal_cents - item.discount_cents;
  const remaining = item.quantity - item.refunded_quantity;
  if (qty === remaining) {
    return {
      subtotalCents: netSubtotal - alreadyRefunded.subtotal,
      taxCents: item.tax_cents - alreadyRefunded.tax,
      totalCents: item.total_cents - alreadyRefunded.total,
    };
  }
  const subtotalCents = roundHalfUp((netSubtotal * qty) / item.quantity);
  const taxCents = roundHalfUp((item.tax_cents * qty) / item.quantity);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

/**
 * Refund one or more items of a sale. Inside one transaction:
 *   validate quantities → create refund + refund items → return inventory
 *   (RETURN movements) → update refunded quantities and sale status →
 *   record cash out of the register for cash refunds → audit.
 */
export function refundSale(
  db: Database,
  actor: AuthUser,
  saleId: number,
  input: unknown,
): { refund: RefundSummary; sale: Sale } {
  const data = parseBody(refundSchema, input);
  const merged = new Map<number, number>();
  for (const i of data.items)
    merged.set(i.saleItemId, (merged.get(i.saleItemId) ?? 0) + i.quantity);

  const result = db.transaction(() => {
    const sale = db.get<{ id: number; status: string }>(
      'SELECT id, status FROM sales WHERE id = ?',
      [saleId],
    );
    if (!sale) throw new NotFoundError('Sale not found', ErrorCodes.SALE_NOT_FOUND);
    if (sale.status === 'REFUNDED')
      throw new InvalidRequestError('Sale has already been fully refunded');

    const registerId = data.refundMethod === 'CASH' ? requireOpenRegisterId(db, actor.id) : null;

    const lines = [...merged.entries()].map(([saleItemId, qty]) => {
      const item = db.get<ItemRow>('SELECT * FROM sale_items WHERE id = ? AND sale_id = ?', [
        saleItemId,
        saleId,
      ]);
      if (!item) throw new NotFoundError(`Sale item ${saleItemId} not found on this sale`);
      const refundable = item.quantity - item.refunded_quantity;
      if (qty > refundable)
        throw new RefundExceedsQuantityError(item.product_name, refundable, qty);
      const already = db.get<{ subtotal: number; tax: number; total: number }>(
        `SELECT COALESCE(SUM(subtotal_cents), 0) AS subtotal, COALESCE(SUM(tax_cents), 0) AS tax, COALESCE(SUM(total_cents), 0) AS total
         FROM refund_items WHERE sale_item_id = ?`,
        [saleItemId],
      )!;
      return { item, qty, amounts: computeRefundAmounts(item, already, qty) };
    });

    const subtotalCents = lines.reduce((a, l) => a + l.amounts.subtotalCents, 0);
    const taxCents = lines.reduce((a, l) => a + l.amounts.taxCents, 0);
    const totalCents = lines.reduce((a, l) => a + l.amounts.totalCents, 0);

    const refundId = db.run(
      `INSERT INTO refunds (sale_id, user_id, register_id, refund_method, reason, subtotal_cents, tax_cents, total_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        saleId,
        actor.id,
        registerId,
        data.refundMethod,
        data.reason ?? null,
        subtotalCents,
        taxCents,
        totalCents,
      ],
    ).lastInsertRowid;

    for (const { item, qty, amounts } of lines) {
      db.run(
        `INSERT INTO refund_items (refund_id, sale_item_id, product_id, quantity, unit_price_cents, subtotal_cents, tax_cents, total_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          refundId,
          item.id,
          item.product_id,
          qty,
          item.unit_price_cents,
          amounts.subtotalCents,
          amounts.taxCents,
          amounts.totalCents,
        ],
      );
      db.run('UPDATE sale_items SET refunded_quantity = refunded_quantity + ? WHERE id = ?', [
        qty,
        item.id,
      ]);
      applyStockChange(db, {
        productId: item.product_id,
        type: 'RETURN',
        quantity: qty,
        referenceType: 'REFUND',
        referenceId: refundId,
        userId: actor.id,
      });
    }

    const outstanding = db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM sale_items WHERE sale_id = ? AND refunded_quantity < quantity',
      [saleId],
    )!.n;
    db.run('UPDATE sales SET status = ? WHERE id = ?', [
      outstanding === 0 ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
      saleId,
    ]);

    if (registerId !== null)
      recordSaleCash(db, registerId, 'REFUND', totalCents, refundId, actor.id);

    recordAudit(db, {
      userId: actor.id,
      action: 'SALE_REFUND',
      entity: 'sales',
      entityId: saleId,
      details: {
        refundId,
        total: fromCents(totalCents),
        method: data.refundMethod,
        items: lines.map((l) => ({ saleItemId: l.item.id, quantity: l.qty })),
      },
    });

    const full = getSale(db, saleId);
    const refund = full.refunds.find((r) => r.id === refundId)!;
    return { refund, sale: full };
  });

  eventBus.broadcast({
    type: 'refund.created',
    payload: { saleId, refundId: result.refund.id, total: result.refund.total, userId: actor.id },
  });
  eventBus.broadcast({
    type: 'stock.changed',
    payload: {
      products: currentStock(
        db,
        result.refund.items.map((i) => i.productId),
      ),
    },
  });
  return result;
}
