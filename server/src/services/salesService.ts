import { z } from 'zod';
import {
  calculateCart,
  CartCalculationError,
  fromCents,
  PaymentMethods,
  PaymentValidationError,
  toCents,
  validatePayments,
  type PaymentMethod,
} from '@tallo/shared';
import type { Database } from '../db/connection.js';
import { AppError, ErrorCodes, InvalidRequestError, NotFoundError } from '../utils/errors.js';
import { moneySchema, parseBody } from '../utils/validation.js';
import { eventBus } from '../realtime/eventBus.js';
import { applyStockChange } from './inventoryService.js';
import { dispatchQueuedNetworkJobs, enqueueJobsForSale } from './printService.js';
import { recordSaleCash, resolveRegisterForSale } from './registerService.js';
import type { AuthUser } from './types.js';

export type SaleStatus = 'COMPLETED' | 'PARTIALLY_REFUNDED' | 'REFUNDED';

export const checkoutSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        quantity: z.number().int().positive().max(10_000),
      }),
    )
    .min(1, 'At least one item is required')
    .max(200),
  discount: moneySchema.optional(),
  payments: z
    .array(
      z.object({
        method: z.enum(PaymentMethods),
        amount: moneySchema,
        referenceNo: z.string().trim().max(64).optional(),
      }),
    )
    .min(1, 'At least one payment is required')
    .max(10),
  customerName: z.string().trim().max(100).optional(),
  note: z.string().trim().max(200).optional(),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

interface SaleRow {
  id: number;
  receipt_no: string;
  cashier_id: number;
  cashier_name?: string;
  register_id: number;
  customer_id: number | null;
  customer_name?: string | null;
  status: SaleStatus;
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
  paid_cents: number;
  change_cents: number;
  note: string | null;
  created_at: string;
  payment_methods?: string | null;
  refunded_cents?: number | null;
}

interface SaleItemRow {
  id: number;
  sale_id: number;
  product_id: number;
  product_name: string;
  product_sku: string;
  quantity: number;
  unit_price_cents: number;
  unit_cost_cents: number;
  tax_rate_bp: number;
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
  refunded_quantity: number;
}

interface PaymentRow {
  id: number;
  sale_id: number;
  payment_method: PaymentMethod;
  amount_cents: number;
  reference_no: string | null;
  created_at: string;
}

export interface SaleItem {
  id: number;
  productId: number;
  productName: string;
  productSku: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  refundedQuantity: number;
  refundableQuantity: number;
}

export interface Payment {
  id: number;
  method: PaymentMethod;
  amount: number;
  referenceNo: string | null;
  createdAt: string;
}

export interface SaleSummary {
  id: number;
  receiptNo: string;
  cashierId: number;
  cashierName: string;
  registerId: number;
  customerName: string | null;
  status: SaleStatus;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paid: number;
  change: number;
  refundedTotal: number;
  paymentMethods: PaymentMethod[];
  note: string | null;
  createdAt: string;
}

export interface Sale extends SaleSummary {
  items: SaleItem[];
  payments: Payment[];
  refunds: RefundSummary[];
}

export interface RefundSummary {
  id: number;
  saleId: number;
  userId: number;
  userName: string;
  refundMethod: PaymentMethod;
  reason: string | null;
  subtotal: number;
  tax: number;
  total: number;
  createdAt: string;
  items: {
    saleItemId: number;
    productId: number;
    productName: string;
    quantity: number;
    total: number;
  }[];
}

export class InvalidPaymentError extends AppError {
  constructor(message: string) {
    super(ErrorCodes.INVALID_PAYMENT, message, 400);
  }
}

const SALE_SELECT = `
  SELECT s.*, u.full_name AS cashier_name, c.name AS customer_name,
    (SELECT GROUP_CONCAT(DISTINCT payment_method) FROM payments p WHERE p.sale_id = s.id) AS payment_methods,
    (SELECT COALESCE(SUM(total_cents), 0) FROM refunds r WHERE r.sale_id = s.id) AS refunded_cents
  FROM sales s
  JOIN users u ON u.id = s.cashier_id
  LEFT JOIN customers c ON c.id = s.customer_id`;

function toSummary(row: SaleRow): SaleSummary {
  return {
    id: row.id,
    receiptNo: row.receipt_no,
    cashierId: row.cashier_id,
    cashierName: row.cashier_name ?? '',
    registerId: row.register_id,
    customerName: row.customer_name ?? null,
    status: row.status,
    subtotal: fromCents(row.subtotal_cents),
    discount: fromCents(row.discount_cents),
    tax: fromCents(row.tax_cents),
    total: fromCents(row.total_cents),
    paid: fromCents(row.paid_cents),
    change: fromCents(row.change_cents),
    refundedTotal: fromCents(row.refunded_cents ?? 0),
    paymentMethods: (row.payment_methods ?? '').split(',').filter(Boolean) as PaymentMethod[],
    note: row.note,
    createdAt: row.created_at,
  };
}

function toItem(row: SaleItemRow): SaleItem {
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    productSku: row.product_sku,
    quantity: row.quantity,
    unitPrice: fromCents(row.unit_price_cents),
    taxRate: row.tax_rate_bp / 100,
    subtotal: fromCents(row.subtotal_cents),
    discount: fromCents(row.discount_cents),
    tax: fromCents(row.tax_cents),
    total: fromCents(row.total_cents),
    refundedQuantity: row.refunded_quantity,
    refundableQuantity: row.quantity - row.refunded_quantity,
  };
}

function toPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    method: row.payment_method,
    amount: fromCents(row.amount_cents),
    referenceNo: row.reference_no,
    createdAt: row.created_at,
  };
}

export function listRefundsForSale(db: Database, saleId: number): RefundSummary[] {
  const refunds = db.all<{
    id: number;
    sale_id: number;
    user_id: number;
    user_name: string;
    refund_method: PaymentMethod;
    reason: string | null;
    subtotal_cents: number;
    tax_cents: number;
    total_cents: number;
    created_at: string;
  }>(
    `SELECT r.*, u.full_name AS user_name FROM refunds r JOIN users u ON u.id = r.user_id WHERE r.sale_id = ? ORDER BY r.id`,
    [saleId],
  );
  return refunds.map((r) => ({
    id: r.id,
    saleId: r.sale_id,
    userId: r.user_id,
    userName: r.user_name,
    refundMethod: r.refund_method,
    reason: r.reason,
    subtotal: fromCents(r.subtotal_cents),
    tax: fromCents(r.tax_cents),
    total: fromCents(r.total_cents),
    createdAt: r.created_at,
    items: db
      .all<{
        sale_item_id: number;
        product_id: number;
        product_name: string;
        quantity: number;
        total_cents: number;
      }>(
        `SELECT ri.sale_item_id, ri.product_id, si.product_name, ri.quantity, ri.total_cents
         FROM refund_items ri JOIN sale_items si ON si.id = ri.sale_item_id WHERE ri.refund_id = ? ORDER BY ri.id`,
        [r.id],
      )
      .map((i) => ({
        saleItemId: i.sale_item_id,
        productId: i.product_id,
        productName: i.product_name,
        quantity: i.quantity,
        total: fromCents(i.total_cents),
      })),
  }));
}

export function getSale(db: Database, id: number): Sale {
  const row = db.get<SaleRow>(`${SALE_SELECT} WHERE s.id = ?`, [id]);
  if (!row) throw new NotFoundError('Sale not found', ErrorCodes.SALE_NOT_FOUND);
  const items = db
    .all<SaleItemRow>('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id', [id])
    .map(toItem);
  const payments = db
    .all<PaymentRow>('SELECT * FROM payments WHERE sale_id = ? ORDER BY id', [id])
    .map(toPayment);
  return { ...toSummary(row), items, payments, refunds: listRefundsForSale(db, id) };
}

export interface SaleFilter {
  from?: string | undefined; // YYYY-MM-DD inclusive
  to?: string | undefined; // YYYY-MM-DD inclusive
  receiptNo?: string | undefined;
  cashierId?: number | undefined;
  paymentMethod?: PaymentMethod | undefined;
  status?: SaleStatus | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export function listSales(
  db: Database,
  filter: SaleFilter = {},
): { sales: SaleSummary[]; total: number } {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.from) {
    where.push('s.created_at >= ?');
    params.push(`${filter.from}T00:00:00.000Z`);
  }
  if (filter.to) {
    where.push('s.created_at <= ?');
    params.push(`${filter.to}T23:59:59.999Z`);
  }
  if (filter.receiptNo) {
    where.push('s.receipt_no LIKE ?');
    params.push(`%${filter.receiptNo}%`);
  }
  if (filter.cashierId !== undefined) {
    where.push('s.cashier_id = ?');
    params.push(filter.cashierId);
  }
  if (filter.paymentMethod) {
    where.push('EXISTS (SELECT 1 FROM payments p WHERE p.sale_id = s.id AND p.payment_method = ?)');
    params.push(filter.paymentMethod);
  }
  if (filter.status) {
    where.push('s.status = ?');
    params.push(filter.status);
  }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const total =
    db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM sales s${whereSql}`, params)?.n ?? 0;
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
  const offset = Math.max(filter.offset ?? 0, 0);
  const rows = db.all<SaleRow>(`${SALE_SELECT}${whereSql} ORDER BY s.id DESC LIMIT ? OFFSET ?`, [
    ...params,
    limit,
    offset,
  ]);
  return { sales: rows.map(toSummary), total };
}

export function formatReceiptNo(id: number): string {
  return String(id).padStart(6, '0');
}

/**
 * Checkout. Runs entirely inside one transaction:
 *   validate cashier register → validate products/status/stock → calculate
 *   totals server-side → create sale, items, payments → reduce inventory and
 *   record movements → record cash in the register.
 * Any failure rolls everything back.
 */
export function createSale(
  db: Database,
  actor: AuthUser,
  input: unknown,
  options: { storeName?: string; print?: boolean } = {},
): Sale {
  const data = parseBody(checkoutSchema, input);

  // Merge duplicate product lines so stock validation sees the full quantity.
  const merged = new Map<number, number>();
  for (const item of data.items)
    merged.set(item.productId, (merged.get(item.productId) ?? 0) + item.quantity);

  const sale = db.transaction(() => {
    const registerId = resolveRegisterForSale(db, actor);

    const products = [...merged.entries()].map(([productId, quantity]) => {
      const p = db.get<{
        id: number;
        name: string;
        sku: string;
        price_cents: number;
        cost_price_cents: number;
        tax_rate_bp: number;
        stock_qty: number;
        active: number;
      }>(
        'SELECT id, name, sku, price_cents, cost_price_cents, tax_rate_bp, stock_qty, active FROM products WHERE id = ?',
        [productId],
      );
      if (!p) throw new NotFoundError(`Product ${productId} not found`);
      if (p.active !== 1)
        throw new InvalidRequestError(`Product "${p.name}" is inactive and cannot be sold`);
      if (p.stock_qty < quantity) {
        throw new AppError(
          ErrorCodes.INSUFFICIENT_STOCK,
          `Insufficient stock for product "${p.name}" (available ${p.stock_qty}, requested ${quantity})`,
          409,
          { productId: p.id, available: p.stock_qty, requested: quantity },
        );
      }
      return { ...p, quantity };
    });

    let totals;
    try {
      totals = calculateCart(
        products.map((p) => ({
          productId: p.id,
          unitPriceCents: p.price_cents,
          quantity: p.quantity,
          taxRateBp: p.tax_rate_bp,
        })),
        toCents(data.discount ?? 0),
      );
    } catch (err) {
      if (err instanceof CartCalculationError) throw new InvalidRequestError(err.message);
      throw err;
    }

    let payment;
    try {
      payment = validatePayments(
        totals.totalCents,
        data.payments.map((p) => ({
          method: p.method,
          amountCents: toCents(p.amount),
          referenceNo: p.referenceNo ?? null,
        })),
      );
    } catch (err) {
      if (err instanceof PaymentValidationError) throw new InvalidPaymentError(err.message);
      throw err;
    }

    let customerId: number | null = null;
    if (data.customerName) {
      customerId = db.run('INSERT INTO customers (name) VALUES (?)', [
        data.customerName,
      ]).lastInsertRowid;
    }

    const saleResult = db.run(
      `INSERT INTO sales (receipt_no, cashier_id, register_id, customer_id, status, subtotal_cents, discount_cents, tax_cents,
                          total_cents, paid_cents, change_cents, note)
       VALUES (?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?, ?, ?, ?)`,
      [
        `PENDING-${Date.now()}-${Math.random()}`,
        actor.id,
        registerId,
        customerId,
        totals.subtotalCents,
        totals.discountCents,
        totals.taxCents,
        totals.totalCents,
        payment.paidCents,
        payment.changeCents,
        data.note ?? null,
      ],
    );
    const saleId = saleResult.lastInsertRowid;
    db.run('UPDATE sales SET receipt_no = ? WHERE id = ?', [formatReceiptNo(saleId), saleId]);

    totals.lines.forEach((line, i) => {
      const p = products[i]!;
      db.run(
        `INSERT INTO sale_items (sale_id, product_id, product_name, product_sku, quantity, unit_price_cents, unit_cost_cents,
                                 tax_rate_bp, subtotal_cents, discount_cents, tax_cents, total_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          saleId,
          p.id,
          p.name,
          p.sku,
          line.quantity,
          line.unitPriceCents,
          p.cost_price_cents,
          line.taxRateBp,
          line.subtotalCents,
          line.discountCents,
          line.taxCents,
          line.totalCents,
        ],
      );
    });

    for (const p of data.payments) {
      db.run(
        `INSERT INTO payments (sale_id, payment_method, amount_cents, reference_no) VALUES (?, ?, ?, ?)`,
        [saleId, p.method, toCents(p.amount), p.referenceNo ?? null],
      );
    }

    for (const p of products) {
      applyStockChange(db, {
        productId: p.id,
        type: 'SALE',
        quantity: -p.quantity,
        referenceType: 'SALE',
        referenceId: saleId,
        userId: actor.id,
      });
    }

    // Net cash into the drawer = cash tendered - change given.
    recordSaleCash(
      db,
      registerId,
      'SALE',
      payment.cashCents - payment.changeCents,
      saleId,
      actor.id,
    );

    return getSale(db, saleId);
  });

  // Committed: notify every connected device (order feed + live stock).
  eventBus.broadcast({
    type: 'sale.created',
    payload: {
      saleId: sale.id,
      receiptNo: sale.receiptNo,
      total: sale.total,
      cashierId: sale.cashierId,
      cashierName: sale.cashierName,
      itemCount: sale.items.reduce((a, i) => a + i.quantity, 0),
      createdAt: sale.createdAt,
    },
  });
  eventBus.broadcast({
    type: 'stock.changed',
    payload: {
      products: currentStock(
        db,
        sale.items.map((i) => i.productId),
      ),
    },
  });

  // Print routing (kitchen tickets per area + counter receipt). Never blocks or fails the sale.
  if (options.print !== false) {
    try {
      const jobs = enqueueJobsForSale(db, options.storeName ?? 'Tallo', sale.id);
      if (jobs.some((j) => j.printerType === 'NETWORK')) void dispatchQueuedNetworkJobs(db);
    } catch {
      // printing problems are visible in the print jobs list; the sale stands
    }
  }
  return sale;
}

/** Current stock for a set of products, for live updates. */
export function currentStock(
  db: Database,
  productIds: number[],
): { productId: number; sku: string; stockQty: number }[] {
  const unique = [...new Set(productIds)];
  if (unique.length === 0) return [];
  return db
    .all<{ id: number; sku: string; stock_qty: number }>(
      `SELECT id, sku, stock_qty FROM products WHERE id IN (${unique.map(() => '?').join(',')})`,
      unique,
    )
    .map((r) => ({ productId: r.id, sku: r.sku, stockQty: r.stock_qty }));
}

export interface Receipt {
  storeName: string;
  receiptNo: string;
  date: string;
  cashier: string;
  customerName: string | null;
  items: { name: string; sku: string; quantity: number; unitPrice: number; total: number }[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  payments: { method: PaymentMethod; amount: number; referenceNo: string | null }[];
  received: number;
  change: number;
  status: SaleStatus;
  refundedTotal: number;
}

export function getReceipt(db: Database, storeName: string, saleId: number): Receipt {
  const sale = getSale(db, saleId);
  return {
    storeName,
    receiptNo: sale.receiptNo,
    date: sale.createdAt,
    cashier: sale.cashierName,
    customerName: sale.customerName,
    items: sale.items.map((i) => ({
      name: i.productName,
      sku: i.productSku,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      total: i.subtotal,
    })),
    subtotal: sale.subtotal,
    discount: sale.discount,
    tax: sale.tax,
    total: sale.total,
    payments: sale.payments.map((p) => ({
      method: p.method,
      amount: p.amount,
      referenceNo: p.referenceNo,
    })),
    received: sale.paid,
    change: sale.change,
    status: sale.status,
    refundedTotal: sale.refundedTotal,
  };
}
