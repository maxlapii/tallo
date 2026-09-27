import { api, getToken } from './client';
import type {
  Category,
  CheckoutInput,
  DailyReport,
  InventoryMovement,
  InventoryReport,
  PaymentMethod,
  PaymentReport,
  Printer,
  PrinterInput,
  PrintJob,
  Product,
  ProductInput,
  ProductReport,
  Receipt,
  RefundSummary,
  Register,
  Sale,
  SaleSummary,
  SellStatus,
  Store,
  User,
} from './types';

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
const put = (body: unknown): RequestInit => ({ method: 'PUT', body: JSON.stringify(body) });

export const AuthApi = {
  me: () => api<{ user: User }>('/api/auth/me'),
};

export const CategoriesApi = {
  list: (includeInactive = false) =>
    api<{ categories: Category[] }>(`/api/categories${qs({ includeInactive })}`),
  create: (body: { name: string; printerId?: number | null }) =>
    api<{ category: Category }>('/api/categories', json(body)),
  update: (
    id: number,
    body: {
      name?: string | undefined;
      active?: boolean | undefined;
      printerId?: number | null | undefined;
    },
  ) => api<{ category: Category }>(`/api/categories/${id}`, put(body)),
};

export const ProductsApi = {
  list: (
    params: {
      q?: string | undefined;
      categoryId?: number | undefined;
      active?: boolean | undefined;
      lowStock?: boolean | undefined;
      limit?: number | undefined;
      offset?: number | undefined;
    } = {},
  ) => api<{ products: Product[]; total: number }>(`/api/products${qs(params)}`),
  lookup: (code: string) => api<{ product: Product }>(`/api/products/lookup${qs({ code })}`),
  get: (id: number) => api<{ product: Product }>(`/api/products/${id}`),
  create: (body: ProductInput) => api<{ product: Product }>('/api/products', json(body)),
  update: (id: number, body: Partial<ProductInput>) =>
    api<{ product: Product }>(`/api/products/${id}`, put(body)),
  remove: (id: number) =>
    api<{ deleted: boolean; deactivated: boolean }>(`/api/products/${id}`, { method: 'DELETE' }),
};

export const InventoryApi = {
  list: (
    params: {
      q?: string | undefined;
      lowStock?: boolean | undefined;
      active?: boolean | undefined;
      limit?: number | undefined;
    } = {},
  ) =>
    api<{ products: Product[]; total: number; lowStockCount: number }>(
      `/api/inventory${qs(params)}`,
    ),
  movements: (
    params: {
      productId?: number | undefined;
      type?: string | undefined;
      limit?: number | undefined;
    } = {},
  ) => api<{ movements: InventoryMovement[] }>(`/api/inventory/movements${qs(params)}`),
  adjust: (body: {
    productId: number;
    type: string;
    quantity: number;
    note?: string | undefined;
  }) => api<{ movement: InventoryMovement }>('/api/inventory/adjust', json(body)),
};

export const SalesApi = {
  list: (
    params: {
      from?: string | undefined;
      to?: string | undefined;
      receiptNo?: string | undefined;
      cashierId?: number | undefined;
      paymentMethod?: PaymentMethod | '' | undefined;
      status?: string | undefined;
      limit?: number | undefined;
      offset?: number | undefined;
    } = {},
  ) => api<{ sales: SaleSummary[]; total: number }>(`/api/sales${qs(params)}`),
  get: (id: number) => api<{ sale: Sale }>(`/api/sales/${id}`),
  receipt: (id: number) => api<{ receipt: Receipt }>(`/api/sales/${id}/receipt`),
  checkout: (body: CheckoutInput) => api<{ sale: Sale }>('/api/sales', json(body)),
  refund: (
    id: number,
    body: {
      items: { saleItemId: number; quantity: number }[];
      refundMethod: PaymentMethod;
      reason?: string | undefined;
    },
  ) => api<{ refund: RefundSummary; sale: Sale }>(`/api/sales/${id}/refund`, json(body)),
};

export const RegistersApi = {
  status: () => api<{ status: SellStatus }>('/api/registers/status'),
  current: () => api<{ register: Register | null }>('/api/registers/current'),
  list: (params: { limit?: number | undefined } = {}) =>
    api<{ registers: Register[] }>(`/api/registers${qs(params)}`),
  open: (body: { openingCash: number; note?: string | undefined }) =>
    api<{ register: Register }>('/api/registers/open', json(body)),
  close: (body: { actualCash: number; note?: string | undefined }) =>
    api<{ register: Register }>('/api/registers/close', json(body)),
  cashIn: (body: { amount: number; note?: string | undefined }) =>
    api<{ register: Register }>('/api/registers/cash-in', json(body)),
  cashOut: (body: { amount: number; note?: string | undefined }) =>
    api<{ register: Register }>('/api/registers/cash-out', json(body)),
};

export const ReportsApi = {
  daily: (params: {
    from?: string | undefined;
    to?: string | undefined;
    date?: string | undefined;
  }) => api<{ report: DailyReport }>(`/api/reports/daily${qs(params)}`),
  payments: (params: {
    from?: string | undefined;
    to?: string | undefined;
    date?: string | undefined;
  }) => api<{ report: PaymentReport }>(`/api/reports/payments${qs(params)}`),
  products: (params: {
    from?: string | undefined;
    to?: string | undefined;
    date?: string | undefined;
  }) => api<{ report: ProductReport }>(`/api/reports/products${qs(params)}`),
  inventory: () => api<{ report: InventoryReport }>('/api/reports/inventory'),
};

export const UsersApi = {
  list: () => api<{ users: User[] }>('/api/users'),
  create: (body: { username: string; password: string; fullName: string; role: User['role'] }) =>
    api<{ user: User }>('/api/users', json(body)),
  update: (
    id: number,
    body: { fullName?: string; role?: User['role']; active?: boolean; password?: string },
  ) => api<{ user: User }>(`/api/users/${id}`, put(body)),
};

export const PrintersApi = {
  list: (includeInactive = false) =>
    api<{ printers: Printer[] }>(`/api/printers${qs({ includeInactive })}`),
  create: (body: PrinterInput) => api<{ printer: Printer }>('/api/printers', json(body)),
  update: (id: number, body: Partial<PrinterInput>) =>
    api<{ printer: Printer }>(`/api/printers/${id}`, put(body)),
  remove: (id: number) =>
    api<{ deleted: boolean; deactivated: boolean }>(`/api/printers/${id}`, { method: 'DELETE' }),
  test: (id: number) =>
    api<{ ok: boolean; message: string }>(`/api/printers/${id}/test`, { method: 'POST' }),
};

export const PrintJobsApi = {
  list: (
    params: {
      printerId?: number | undefined;
      status?: string | undefined;
      saleId?: number | undefined;
      limit?: number | undefined;
    } = {},
  ) => api<{ jobs: PrintJob[] }>(`/api/print-jobs${qs(params)}`),
  get: (id: number) => api<{ job: PrintJob }>(`/api/print-jobs/${id}`),
  printed: (id: number) =>
    api<{ job: PrintJob }>(`/api/print-jobs/${id}/printed`, { method: 'POST' }),
  retry: (id: number) => api<{ job: PrintJob }>(`/api/print-jobs/${id}/retry`, { method: 'POST' }),
  reprintSale: (saleId: number, kinds?: ('RECEIPT' | 'TICKET')[]) =>
    api<{ jobs: PrintJob[] }>(`/api/sales/${saleId}/print`, json({ kinds })),
};

export const StoresApi = {
  check: (code: string) =>
    api<{ code: string; available: boolean; reason?: string }>(`/api/stores/check${qs({ code })}`),
  signup: (body: {
    storeName: string;
    storeCode: string;
    adminUsername: string;
    adminPassword: string;
    adminFullName: string;
    demoData: boolean;
  }) =>
    api<{ token: string; user: User; store: string; storeName: string }>('/api/stores', json(body)),
  current: () => api<{ store: Store | null; signupEnabled: boolean }>('/api/stores/current'),
  rename: (name: string) => api<{ store: Store }>('/api/stores/current', put({ name })),
  remove: (password: string) =>
    api<{ deleted: boolean }>('/api/stores/current', {
      method: 'DELETE',
      body: JSON.stringify({ password }),
    }),
  /** Downloads the store's SQLite file with the session token attached. */
  export: async (): Promise<void> => {
    const token = getToken();
    const res = await fetch('/api/stores/current/export', {
      headers: { Authorization: `Bearer ${token ?? ''}` },
    });
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    const blob = await res.blob();
    const name =
      /filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') ?? '')?.[1] ??
      'store-export.db';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  },
};
