export type Role = 'ADMIN' | 'CASHIER' | 'SALE';

export interface SellStatus {
  canSell: boolean;
  reason: string | null;
  ownRegisterId: number | null;
  openRegisters: number;
}
export type PaymentMethod = 'CASH' | 'CARD' | 'QR';
export type SaleStatus = 'COMPLETED' | 'PARTIALLY_REFUNDED' | 'REFUNDED';
export type MovementType = 'PURCHASE' | 'SALE' | 'RETURN' | 'DAMAGE' | 'ADJUSTMENT';

export interface User {
  id: number;
  username: string;
  fullName: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

export interface LoginResponse {
  token: string;
  user: User;
  store: string;
}

export interface Store {
  slug: string;
  name: string;
  active: boolean;
  createdAt: string;
}

export interface Category {
  id: number;
  name: string;
  printerId: number | null;
  active: boolean;
  productCount: number;
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

export interface ProductInput {
  sku: string;
  barcode?: string | null;
  name: string;
  categoryId?: number | null;
  imageUrl?: string | null;
  printerId?: number | null;
  costPrice?: number;
  price: number;
  taxRate?: number;
  stockQty?: number;
  lowStockThreshold?: number;
  active?: boolean;
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

export interface CheckoutInput {
  items: { productId: number; quantity: number }[];
  discount?: number;
  payments: { method: PaymentMethod; amount: number; referenceNo?: string }[];
  customerName?: string;
  note?: string;
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

export interface CashMovement {
  id: number;
  registerId: number;
  type: 'OPENING' | 'SALE' | 'REFUND' | 'CASH_IN' | 'CASH_OUT';
  amount: number;
  referenceType: string | null;
  referenceId: number | null;
  note: string | null;
  userId: number | null;
  createdAt: string;
}

export interface RegisterSummary {
  openingCash: number;
  cashSales: number;
  cashRefunds: number;
  cashIn: number;
  cashOut: number;
  expectedCash: number;
  salesCount: number;
  totalSales: number;
}

export interface Register {
  id: number;
  userId: number;
  userName: string;
  status: 'OPEN' | 'CLOSED';
  openingCash: number;
  expectedCash: number | null;
  actualCash: number | null;
  difference: number | null;
  openedAt: string;
  closedAt: string | null;
  note: string | null;
  summary: RegisterSummary;
  movements: CashMovement[];
}

export interface DailyReport {
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

export interface PaymentReport {
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

export interface ProductReport {
  from: string;
  to: string;
  products: {
    productId: number;
    name: string;
    sku: string;
    quantitySold: number;
    quantityRefunded: number;
    revenue: number;
    refunded: number;
    netRevenue: number;
  }[];
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

export type PrinterType = 'BROWSER' | 'NETWORK';

export interface Printer {
  id: number;
  name: string;
  area: string;
  type: PrinterType;
  host: string | null;
  port: number | null;
  printsReceipts: boolean;
  printsTickets: boolean;
  active: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface PrinterInput {
  name: string;
  area: string;
  type: PrinterType;
  host?: string | null;
  port?: number | null;
  printsReceipts?: boolean;
  printsTickets?: boolean;
  active?: boolean;
  sortOrder?: number;
}

export type JobKind = 'RECEIPT' | 'TICKET';
export type JobStatus = 'QUEUED' | 'SENDING' | 'PRINTED' | 'FAILED';

export interface TicketPayload {
  kind: 'TICKET';
  area: string;
  storeName: string;
  receiptNo: string;
  createdAt: string;
  cashier: string;
  customerName: string | null;
  note: string | null;
  items: { name: string; quantity: number; sku: string }[];
  reprint: boolean;
}

export interface ReceiptPayload {
  kind: 'RECEIPT';
  storeName: string;
  receiptNo: string;
  createdAt: string;
  cashier: string;
  customerName: string | null;
  items: { name: string; quantity: number; unitPrice: number; total: number }[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  payments: { method: string; amount: number }[];
  received: number;
  change: number;
  reprint: boolean;
}

export interface PrintJob {
  id: number;
  saleId: number;
  printerId: number;
  printerName: string;
  printerArea: string;
  printerType: PrinterType;
  kind: JobKind;
  status: JobStatus;
  payload: TicketPayload | ReceiptPayload;
  error: string | null;
  attempts: number;
  createdAt: string;
  printedAt: string | null;
}
