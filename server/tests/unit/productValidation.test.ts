import { describe, expect, it } from 'vitest';
import { productInputSchema, productUpdateSchema } from '../../src/services/productService.js';
import { adjustStockSchema } from '../../src/services/inventoryService.js';
import { moneySchema, taxRateSchema } from '../../src/utils/validation.js';

const valid = { sku: 'COKE-001', barcode: '0490000000019', name: 'Coca Cola', price: 2 };

describe('product validation', () => {
  it('accepts a minimal valid product', () => {
    expect(productInputSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ['empty sku', { ...valid, sku: '' }],
    ['sku with spaces', { ...valid, sku: 'BAD SKU' }],
    ['sku with symbols', { ...valid, sku: 'SKU#1' }],
    ['barcode with spaces', { ...valid, barcode: '12 34' }],
    ['empty name', { ...valid, name: '  ' }],
    ['negative price', { ...valid, price: -1 }],
    ['three-decimal price', { ...valid, price: 1.005 }],
    ['negative cost', { ...valid, costPrice: -0.01 }],
    ['tax above 100', { ...valid, taxRate: 101 }],
    ['negative tax', { ...valid, taxRate: -1 }],
    ['fractional stock', { ...valid, stockQty: 1.5 }],
    ['negative stock', { ...valid, stockQty: -1 }],
    ['negative threshold', { ...valid, lowStockThreshold: -1 }],
    ['invalid category', { ...valid, categoryId: 0 }],
    ['missing price', { sku: 'A', name: 'B' }],
  ])('rejects %s', (_label, input) => {
    expect(productInputSchema.safeParse(input).success).toBe(false);
  });

  it('allows null barcode and null category', () => {
    expect(
      productInputSchema.safeParse({ ...valid, barcode: null, categoryId: null }).success,
    ).toBe(true);
  });

  it('update schema is partial and disallows stockQty', () => {
    expect(productUpdateSchema.safeParse({ price: 3.5 }).success).toBe(true);
    const r = productUpdateSchema.safeParse({ stockQty: 5 });
    // unknown keys are stripped; stockQty must not survive
    expect(r.success && 'stockQty' in r.data).toBe(false);
  });
});

describe('money & tax schemas', () => {
  it.each([0, 0.01, 2, 9.35, 1234.56])('money accepts %s', (v) => {
    expect(moneySchema.safeParse(v).success).toBe(true);
  });
  it.each([-0.01, 1.005, Number.NaN, Number.POSITIVE_INFINITY])('money rejects %s', (v) => {
    expect(moneySchema.safeParse(v).success).toBe(false);
  });
  it.each([0, 7.5, 10, 100])('tax accepts %s', (v) => {
    expect(taxRateSchema.safeParse(v).success).toBe(true);
  });
  it.each([-1, 100.01, 7.555])('tax rejects %s', (v) => {
    expect(taxRateSchema.safeParse(v).success).toBe(false);
  });
});

describe('stock adjustment validation', () => {
  it('accepts a valid adjustment', () => {
    expect(
      adjustStockSchema.safeParse({ productId: 1, type: 'ADJUSTMENT', quantity: -3 }).success,
    ).toBe(true);
  });
  it.each([
    ['zero quantity', { productId: 1, type: 'ADJUSTMENT', quantity: 0 }],
    ['fractional quantity', { productId: 1, type: 'ADJUSTMENT', quantity: 1.5 }],
    ['SALE type not allowed manually', { productId: 1, type: 'SALE', quantity: -1 }],
    ['unknown type', { productId: 1, type: 'THEFT', quantity: -1 }],
    ['missing product', { type: 'ADJUSTMENT', quantity: -1 }],
  ])('rejects %s', (_label, input) => {
    expect(adjustStockSchema.safeParse(input).success).toBe(false);
  });
});
