import { describe, expect, it } from 'vitest';
import { PaymentValidationError, validatePayments } from '../src/payment.js';

describe('validatePayments', () => {
  it('exact cash payment has no change', () => {
    expect(validatePayments(2000, [{ method: 'CASH', amountCents: 2000 }])).toEqual({
      paidCents: 2000,
      changeCents: 0,
      cashCents: 2000,
      nonCashCents: 0,
    });
  });

  it('cash overpayment returns change', () => {
    expect(validatePayments(2000, [{ method: 'CASH', amountCents: 2500 }]).changeCents).toBe(500);
  });

  it('rejects underpayment', () => {
    expect(() => validatePayments(2000, [{ method: 'CASH', amountCents: 1500 }])).toThrow(
      /does not cover/,
    );
  });

  it.each(['CARD', 'QR'] as const)('rejects %s overpayment', (method) => {
    expect(() => validatePayments(2000, [{ method, amountCents: 2500 }])).toThrow(/cannot exceed/);
  });

  it.each(['CARD', 'QR'] as const)('accepts exact %s payment', (method) => {
    expect(validatePayments(2000, [{ method, amountCents: 2000 }]).changeCents).toBe(0);
  });

  it('supports split payments (cash + card)', () => {
    const r = validatePayments(10000, [
      { method: 'CASH', amountCents: 4000 },
      { method: 'CARD', amountCents: 6000 },
    ]);
    expect(r).toEqual({ paidCents: 10000, changeCents: 0, cashCents: 4000, nonCashCents: 6000 });
  });

  it('split payment with cash overpayment returns change from cash only', () => {
    const r = validatePayments(10000, [
      { method: 'CARD', amountCents: 6000 },
      { method: 'CASH', amountCents: 5000 },
    ]);
    expect(r.changeCents).toBe(1000);
  });

  it('rejects split payments where card exceeds the total even if cash is present', () => {
    expect(() =>
      validatePayments(10000, [
        { method: 'CARD', amountCents: 10500 },
        { method: 'CASH', amountCents: 100 },
      ]),
    ).toThrow(/cannot exceed/);
  });

  it('rejects split underpayment', () => {
    expect(() =>
      validatePayments(10000, [
        { method: 'CARD', amountCents: 5000 },
        { method: 'CASH', amountCents: 4000 },
      ]),
    ).toThrow(/does not cover/);
  });

  it('rejects empty payment list', () => {
    expect(() => validatePayments(100, [])).toThrow(PaymentValidationError);
  });

  it.each([0, -5, 1.5])('rejects non-positive or fractional amount %s', (amount) => {
    expect(() => validatePayments(100, [{ method: 'CASH', amountCents: amount }])).toThrow(
      PaymentValidationError,
    );
  });

  it('rejects unsupported methods', () => {
    expect(() => validatePayments(100, [{ method: 'CHEQUE' as never, amountCents: 100 }])).toThrow(
      /Unsupported/,
    );
  });

  it('rejects invalid totals', () => {
    expect(() => validatePayments(-1, [{ method: 'CASH', amountCents: 1 }])).toThrow();
  });

  it('allows a zero total paid with any positive amount as full change', () => {
    expect(validatePayments(0, [{ method: 'CASH', amountCents: 100 }]).changeCents).toBe(100);
  });
});
