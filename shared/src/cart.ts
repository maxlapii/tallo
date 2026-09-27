import { allocateProportionally, roundHalfUp } from './money.js';

export interface CartLineInput {
  /** Any identifier the caller wants echoed back (product id, temp id, ...). */
  productId: number;
  unitPriceCents: number;
  quantity: number;
  /** Tax rate in basis points (1000 = 10%). */
  taxRateBp: number;
}

export interface CartLineResult {
  productId: number;
  unitPriceCents: number;
  quantity: number;
  taxRateBp: number;
  /** unitPrice * quantity, before discount. */
  subtotalCents: number;
  /** Share of the order discount allocated to this line. */
  discountCents: number;
  /** Tax on (subtotal - discount). */
  taxCents: number;
  /** subtotal - discount + tax. */
  totalCents: number;
}

export interface CartTotals {
  lines: CartLineResult[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  itemCount: number;
}

export class CartCalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CartCalculationError';
  }
}

/**
 * Calculates all totals for a cart.
 *
 * Rules:
 * - Quantities must be positive integers; prices/tax rates non-negative integers.
 * - The order-level discount (in cents) cannot exceed the subtotal.
 * - The discount is allocated across lines proportionally to their subtotal.
 * - Tax is calculated per line on the discounted amount and rounded half-up
 *   to the nearest cent.
 */
export function calculateCart(lines: CartLineInput[], discountCents = 0): CartTotals {
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new CartCalculationError('Quantity must be a positive integer');
    }
    if (!Number.isInteger(line.unitPriceCents) || line.unitPriceCents < 0) {
      throw new CartCalculationError('Unit price must be a non-negative integer (cents)');
    }
    if (!Number.isInteger(line.taxRateBp) || line.taxRateBp < 0) {
      throw new CartCalculationError('Tax rate must be a non-negative integer (basis points)');
    }
  }
  if (!Number.isInteger(discountCents) || discountCents < 0) {
    throw new CartCalculationError('Discount must be a non-negative integer (cents)');
  }

  const subtotals = lines.map((l) => l.unitPriceCents * l.quantity);
  const subtotalCents = subtotals.reduce((a, b) => a + b, 0);
  if (discountCents > subtotalCents) {
    throw new CartCalculationError('Discount cannot exceed the subtotal');
  }

  const allocations = allocateProportionally(discountCents, subtotals);
  const results: CartLineResult[] = lines.map((l, i) => {
    const subtotal = subtotals[i] ?? 0;
    const discount = allocations[i] ?? 0;
    const taxable = subtotal - discount;
    const tax = roundHalfUp((taxable * l.taxRateBp) / 10_000);
    return {
      productId: l.productId,
      unitPriceCents: l.unitPriceCents,
      quantity: l.quantity,
      taxRateBp: l.taxRateBp,
      subtotalCents: subtotal,
      discountCents: discount,
      taxCents: tax,
      totalCents: taxable + tax,
    };
  });

  const taxCents = results.reduce((a, r) => a + r.taxCents, 0);
  return {
    lines: results,
    subtotalCents,
    discountCents,
    taxCents,
    totalCents: subtotalCents - discountCents + taxCents,
    itemCount: lines.reduce((a, l) => a + l.quantity, 0),
  };
}

/* ------------------------------------------------------------------ */
/* Cart state helpers (pure, used by the POS UI)                        */
/* ------------------------------------------------------------------ */

export interface CartItem {
  productId: number;
  name: string;
  sku: string;
  unitPriceCents: number;
  taxRateBp: number;
  quantity: number;
  /** Stock available at the time the product was added; used for UI guards. */
  stockQty: number;
  /** Optional display hints for the UI (tile colour, thumbnail). */
  categoryName?: string | null;
  imageUrl?: string | null;
}

export function addToCart(
  items: CartItem[],
  item: Omit<CartItem, 'quantity'>,
  qty = 1,
): CartItem[] {
  const existing = items.find((i) => i.productId === item.productId);
  if (existing) {
    return items.map((i) =>
      i.productId === item.productId ? { ...i, quantity: i.quantity + qty } : i,
    );
  }
  return [...items, { ...item, quantity: qty }];
}

export function removeFromCart(items: CartItem[], productId: number): CartItem[] {
  return items.filter((i) => i.productId !== productId);
}

/** Sets a quantity; a quantity of 0 or less removes the line. */
export function setCartQuantity(
  items: CartItem[],
  productId: number,
  quantity: number,
): CartItem[] {
  if (!Number.isInteger(quantity)) return items;
  if (quantity <= 0) return removeFromCart(items, productId);
  return items.map((i) => (i.productId === productId ? { ...i, quantity } : i));
}

export function cartTotals(items: CartItem[], discountCents = 0): CartTotals {
  return calculateCart(
    items.map((i) => ({
      productId: i.productId,
      unitPriceCents: i.unitPriceCents,
      quantity: i.quantity,
      taxRateBp: i.taxRateBp,
    })),
    discountCents,
  );
}
