import { describe, expect, it } from 'vitest';
import {
  addToCart,
  calculateCart,
  CartCalculationError,
  cartTotals,
  removeFromCart,
  setCartQuantity,
  type CartItem,
} from '../src/cart.js';

const line = (unitPriceCents: number, quantity: number, taxRateBp = 0, productId = 1) => ({
  productId,
  unitPriceCents,
  quantity,
  taxRateBp,
});

describe('calculateCart', () => {
  it.each([
    // label, lines, discount, subtotal, discountOut, tax, total
    ['1 x $10', [line(1000, 1)], 0, 1000, 0, 0, 1000],
    ['2 x $10', [line(1000, 2)], 0, 2000, 0, 0, 2000],
    ['$20 - $5 discount', [line(1000, 2)], 500, 2000, 500, 0, 1500],
    ['$15 + 10% tax', [line(1500, 1, 1000)], 0, 1500, 0, 150, 1650],
    ['($20 - $5) + 10% tax', [line(1000, 2, 1000)], 500, 2000, 500, 150, 1650],
    [
      'CLAUDE.md example: coke 2x2.00 + burger 1x5.00, -0.50, 10% tax',
      [line(200, 2, 1000, 1), line(500, 1, 1000, 2)],
      50,
      900,
      50,
      85,
      935,
    ],
    ['empty cart', [], 0, 0, 0, 0, 0],
    ['full discount', [line(1000, 1, 1000)], 1000, 1000, 1000, 0, 0],
    ['zero-priced item', [line(0, 3, 1000)], 0, 0, 0, 0, 0],
  ])('%s', (_label, lines, discount, subtotal, discountOut, tax, total) => {
    const r = calculateCart(lines, discount);
    expect(r.subtotalCents).toBe(subtotal);
    expect(r.discountCents).toBe(discountOut);
    expect(r.taxCents).toBe(tax);
    expect(r.totalCents).toBe(total);
    expect(r.lines.reduce((a, l) => a + l.totalCents, 0)).toBe(total);
  });

  describe('rounding', () => {
    it.each([
      // price, qty, taxBp, expectedTax
      [333, 1, 1000, 33], // 33.3 -> 33
      [335, 1, 1000, 34], // 33.5 -> 34 (half up)
      [999, 1, 725, 72], // 72.4275 -> 72
      [101, 3, 825, 25], // 303 * 8.25% = 24.9975 -> 25
      [1, 1, 5000, 1], // 0.5 -> 1
    ])('price %i x %i @ %i bp -> tax %i', (price, qty, bp, expectedTax) => {
      expect(calculateCart([line(price, qty, bp)]).taxCents).toBe(expectedTax);
    });

    it('rounds tax per line, not on the aggregate', () => {
      // Two lines of 0.05 tax each (0.5 cents rounds up per line) = 2 cents,
      // whereas aggregate rounding would give 1 cent.
      const r = calculateCart([line(5, 1, 1000, 1), line(5, 1, 1000, 2)]);
      expect(r.taxCents).toBe(2);
    });
  });

  describe('discount allocation with mixed tax rates', () => {
    it('allocates the discount proportionally and taxes the discounted amounts', () => {
      // Line A: 10.00 @ 10%, Line B: 30.00 @ 0%. Discount 4.00 -> A gets 1.00, B gets 3.00
      const r = calculateCart([line(1000, 1, 1000, 1), line(3000, 1, 0, 2)], 400);
      expect(r.lines[0]?.discountCents).toBe(100);
      expect(r.lines[1]?.discountCents).toBe(300);
      expect(r.lines[0]?.taxCents).toBe(90); // (1000 - 100) * 10%
      expect(r.taxCents).toBe(90);
      expect(r.totalCents).toBe(3690);
    });

    it('allocated discounts always sum to the requested discount', () => {
      const r = calculateCart([line(100, 1, 0, 1), line(100, 1, 0, 2), line(100, 1, 0, 3)], 100);
      expect(r.lines.map((l) => l.discountCents)).toEqual([34, 33, 33]);
      expect(r.discountCents).toBe(100);
    });
  });

  describe('validation', () => {
    it.each([
      ['zero quantity', [line(100, 0)], 0],
      ['negative quantity', [line(100, -1)], 0],
      ['fractional quantity', [line(100, 1.5)], 0],
      ['negative price', [line(-100, 1)], 0],
      ['fractional price', [line(10.5, 1)], 0],
      ['negative tax', [line(100, 1, -1)], 0],
      ['negative discount', [line(100, 1)], -1],
      ['discount above subtotal', [line(100, 1)], 101],
    ])('rejects %s', (_label, lines, discount) => {
      expect(() => calculateCart(lines, discount)).toThrow(CartCalculationError);
    });
  });

  it('reports item count', () => {
    expect(calculateCart([line(100, 2, 0, 1), line(100, 3, 0, 2)]).itemCount).toBe(5);
  });
});

describe('cart state helpers', () => {
  const coke: Omit<CartItem, 'quantity'> = {
    productId: 1,
    name: 'Coca Cola',
    sku: 'COKE-001',
    unitPriceCents: 200,
    taxRateBp: 1000,
    stockQty: 100,
  };
  const burger: Omit<CartItem, 'quantity'> = {
    productId: 2,
    name: 'Burger',
    sku: 'BURGER-001',
    unitPriceCents: 500,
    taxRateBp: 1000,
    stockQty: 50,
  };

  it('adds a new item and merges repeated adds', () => {
    let items = addToCart([], coke);
    items = addToCart(items, burger);
    items = addToCart(items, coke);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ productId: 1, quantity: 2 });
    expect(items[1]).toMatchObject({ productId: 2, quantity: 1 });
  });

  it('removes an item', () => {
    const items = addToCart(addToCart([], coke), burger);
    expect(removeFromCart(items, 1).map((i) => i.productId)).toEqual([2]);
  });

  it('changes quantity and removes on zero', () => {
    let items = addToCart([], coke);
    items = setCartQuantity(items, 1, 5);
    expect(items[0]?.quantity).toBe(5);
    items = setCartQuantity(items, 1, 0);
    expect(items).toHaveLength(0);
  });

  it('ignores non-integer quantities', () => {
    const items = addToCart([], coke);
    expect(setCartQuantity(items, 1, 1.5)).toBe(items);
  });

  it('does not mutate the input array', () => {
    const items = addToCart([], coke);
    const copy = [...items];
    addToCart(items, coke);
    setCartQuantity(items, 1, 3);
    removeFromCart(items, 1);
    expect(items).toEqual(copy);
  });

  it('computes totals for the CLAUDE.md example', () => {
    const items = addToCart(addToCart([], coke, 2), burger);
    const t = cartTotals(items, 50);
    expect(t).toMatchObject({
      subtotalCents: 900,
      discountCents: 50,
      taxCents: 85,
      totalCents: 935,
    });
  });
});
