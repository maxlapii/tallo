import { fromCents, type PaymentMethod } from '@tallo/shared';
import type { Database } from '../db/connection.js';
import { getInventory } from './inventoryService.js';

export interface DateRange {
  from: string; // YYYY-MM-DD inclusive
  to: string; // YYYY-MM-DD inclusive
}

function bounds(range: DateRange): [string, string] {
  return [`${range.from}T00:00:00.000Z`, `${range.to}T23:59:59.999Z`];
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface DailySalesReport {
  from: string;
  to: string;
  transactions: number;
  grossSales: number;
  discounts: number;
  tax: number;
  netSales: number;
  refunds: number;
  refundCount: number;
  netAfterRefunds: number;
  averageSale: number;
  itemsSold: number;
}

export function dailySalesReport(db: Database, range: DateRange): DailySalesReport {
  const [start, end] = bounds(range);
  const s = db.get<{ n: number; gross: number; discount: number; tax: number; net: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(subtotal_cents), 0) AS gross, COALESCE(SUM(discount_cents), 0) AS discount,
            COALESCE(SUM(tax_cents), 0) AS tax, COALESCE(SUM(total_cents), 0) AS net
     FROM sales WHERE created_at BETWEEN ? AND ?`,
    [start, end],
  )!;
  const r = db.get<{ n: number; total: number }>(
    'SELECT COUNT(*) AS n, COALESCE(SUM(total_cents), 0) AS total FROM refunds WHERE created_at BETWEEN ? AND ?',
    [start, end],
  )!;
  const items = db.get<{ q: number }>(
    'SELECT COALESCE(SUM(si.quantity), 0) AS q FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.created_at BETWEEN ? AND ?',
    [start, end],
  )!;
  return {
    from: range.from,
    to: range.to,
    transactions: s.n,
    grossSales: fromCents(s.gross),
    discounts: fromCents(s.discount),
    tax: fromCents(s.tax),
    netSales: fromCents(s.net),
    refunds: fromCents(r.total),
    refundCount: r.n,
    netAfterRefunds: fromCents(s.net - r.total),
    averageSale: s.n === 0 ? 0 : fromCents(Math.round(s.net / s.n)),
    itemsSold: items.q,
  };
}

export interface PaymentSummaryReport {
  from: string;
  to: string;
  methods: {
    method: PaymentMethod;
    count: number;
    amount: number;
    refunded: number;
    net: number;
  }[];
  total: number;
  refunded: number;
  net: number;
}

export function paymentSummaryReport(db: Database, range: DateRange): PaymentSummaryReport {
  const [start, end] = bounds(range);
  const methods: PaymentMethod[] = ['CASH', 'CARD', 'QR'];
  const rows = methods.map((method) => {
    const p = db.get<{ n: number; amount: number }>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(p.amount_cents), 0) AS amount FROM payments p
       JOIN sales s ON s.id = p.sale_id WHERE p.payment_method = ? AND s.created_at BETWEEN ? AND ?`,
      [method, start, end],
    )!;
    const r = db.get<{ amount: number }>(
      'SELECT COALESCE(SUM(total_cents), 0) AS amount FROM refunds WHERE refund_method = ? AND created_at BETWEEN ? AND ?',
      [method, start, end],
    )!;
    // Cash change is given back, so net cash received = tendered - change.
    const change =
      method === 'CASH'
        ? db.get<{ c: number }>(
            'SELECT COALESCE(SUM(change_cents), 0) AS c FROM sales WHERE created_at BETWEEN ? AND ?',
            [start, end],
          )!.c
        : 0;
    const amount = p.amount - change;
    return {
      method,
      count: p.n,
      amount: fromCents(amount),
      refunded: fromCents(r.amount),
      net: fromCents(amount - r.amount),
    };
  });
  const total = rows.reduce((a, r) => a + r.amount, 0);
  const refunded = rows.reduce((a, r) => a + r.refunded, 0);
  return {
    from: range.from,
    to: range.to,
    methods: rows,
    total: Math.round(total * 100) / 100,
    refunded: Math.round(refunded * 100) / 100,
    net: Math.round((total - refunded) * 100) / 100,
  };
}

export interface ProductSalesRow {
  productId: number;
  name: string;
  sku: string;
  quantitySold: number;
  quantityRefunded: number;
  revenue: number;
  refunded: number;
  netRevenue: number;
}

export function productSalesReport(
  db: Database,
  range: DateRange,
): { from: string; to: string; products: ProductSalesRow[] } {
  const [start, end] = bounds(range);
  const rows = db.all<{
    product_id: number;
    name: string;
    sku: string;
    qty: number;
    refunded_qty: number;
    revenue: number;
    refunded: number;
  }>(
    `SELECT si.product_id, si.product_name AS name, si.product_sku AS sku,
            SUM(si.quantity) AS qty,
            COALESCE((SELECT SUM(ri.quantity) FROM refund_items ri JOIN refunds r ON r.id = ri.refund_id
                      WHERE ri.sale_item_id IN (SELECT id FROM sale_items WHERE product_id = si.product_id)
                        AND r.created_at BETWEEN ? AND ?), 0) AS refunded_qty,
            SUM(si.total_cents) AS revenue,
            COALESCE((SELECT SUM(ri.total_cents) FROM refund_items ri JOIN refunds r ON r.id = ri.refund_id
                      WHERE ri.sale_item_id IN (SELECT id FROM sale_items WHERE product_id = si.product_id)
                        AND r.created_at BETWEEN ? AND ?), 0) AS refunded
     FROM sale_items si JOIN sales s ON s.id = si.sale_id
     WHERE s.created_at BETWEEN ? AND ?
     GROUP BY si.product_id, si.product_name, si.product_sku
     ORDER BY qty DESC, name`,
    [start, end, start, end, start, end],
  );
  return {
    from: range.from,
    to: range.to,
    products: rows.map((r) => ({
      productId: r.product_id,
      name: r.name,
      sku: r.sku,
      quantitySold: r.qty,
      quantityRefunded: r.refunded_qty,
      revenue: fromCents(r.revenue),
      refunded: fromCents(r.refunded),
      netRevenue: fromCents(r.revenue - r.refunded),
    })),
  };
}

export interface InventoryReport {
  products: {
    productId: number;
    name: string;
    sku: string;
    categoryName: string | null;
    stockQty: number;
    lowStockThreshold: number;
    lowStock: boolean;
    stockValue: number;
    active: boolean;
  }[];
  totalUnits: number;
  totalStockValue: number;
  lowStockCount: number;
}

export function inventoryReport(db: Database): InventoryReport {
  const inv = getInventory(db, { limit: 500 });
  const products = inv.products.map((p) => ({
    productId: p.id,
    name: p.name,
    sku: p.sku,
    categoryName: p.categoryName,
    stockQty: p.stockQty,
    lowStockThreshold: p.lowStockThreshold,
    lowStock: p.lowStock,
    stockValue: Math.round(p.costPrice * p.stockQty * 100) / 100,
    active: p.active,
  }));
  return {
    products,
    totalUnits: products.reduce((a, p) => a + p.stockQty, 0),
    totalStockValue: Math.round(products.reduce((a, p) => a + p.stockValue, 0) * 100) / 100,
    lowStockCount: inv.lowStockCount,
  };
}
