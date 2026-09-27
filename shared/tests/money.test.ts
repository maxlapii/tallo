import { describe, expect, it } from 'vitest';
import {
  allocateProportionally,
  basisPointsToPercent,
  formatCents,
  fromCents,
  isValidMoney,
  percentToBasisPoints,
  roundHalfUp,
  toCents,
} from '../src/money.js';

describe('money', () => {
  it.each([
    [0.5, 1],
    [1.5, 2],
    [2.5, 3],
    [-0.5, -1],
    [-1.5, -2],
    [1.4999, 1],
    [0, 0],
  ])('roundHalfUp(%f) = %i', (input, expected) => {
    expect(roundHalfUp(input)).toBe(expected);
  });

  it.each([
    [9.35, 935],
    [0.1, 10],
    [0.2, 20],
    [1.005, 100], // float artefact: 1.005 * 100 = 100.49999
    [2, 200],
    [1234.56, 123456],
  ])('toCents(%f) = %i', (amount, cents) => {
    expect(toCents(amount)).toBe(cents);
  });

  it('toCents rejects non-finite input', () => {
    expect(() => toCents(Number.NaN)).toThrow();
    expect(() => toCents(Number.POSITIVE_INFINITY)).toThrow();
  });

  it('fromCents inverts toCents', () => {
    for (const v of [0, 0.01, 0.99, 9.35, 100, 12345.67]) {
      expect(fromCents(toCents(v))).toBe(v);
    }
  });

  it.each([
    [9.35, true],
    [9.355, false],
    [0.1 + 0.2, true], // float artefact within tolerance
    [0.3, true],
    [Number.NaN, false],
  ])('isValidMoney(%s) = %s', (v, ok) => {
    expect(isValidMoney(v)).toBe(ok);
  });

  it.each([
    [0, '0.00'],
    [5, '0.05'],
    [935, '9.35'],
    [123456, '1,234.56'],
    [-250, '-2.50'],
  ])('formatCents(%i) = %s', (cents, str) => {
    expect(formatCents(cents)).toBe(str);
  });

  it('formatCents supports a currency prefix', () => {
    expect(formatCents(935, '$')).toBe('$9.35');
    expect(formatCents(-935, '$')).toBe('-$9.35');
  });

  it('converts between percent and basis points', () => {
    expect(percentToBasisPoints(10)).toBe(1000);
    expect(percentToBasisPoints(7.5)).toBe(750);
    expect(basisPointsToPercent(750)).toBe(7.5);
  });

  describe('allocateProportionally', () => {
    it('splits exactly with no remainder', () => {
      expect(allocateProportionally(100, [50, 50])).toEqual([50, 50]);
    });

    it('assigns remainders to the largest fractional parts and sums to total', () => {
      const parts = allocateProportionally(100, [1, 1, 1]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
      expect(parts).toEqual([34, 33, 33]);
    });

    it('handles zero weights and zero totals', () => {
      expect(allocateProportionally(0, [1, 2])).toEqual([0, 0]);
      expect(allocateProportionally(50, [0, 0])).toEqual([0, 0]);
      expect(allocateProportionally(50, [])).toEqual([]);
    });

    it('never gives a share to a zero-weight line', () => {
      expect(allocateProportionally(7, [0, 10])).toEqual([0, 7]);
    });
  });
});
