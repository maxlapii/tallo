export const PaymentMethods = ['CASH', 'CARD', 'QR'] as const;
export type PaymentMethod = (typeof PaymentMethods)[number];

export interface PaymentInput {
  method: PaymentMethod;
  amountCents: number;
  referenceNo?: string | null;
}

export interface PaymentResult {
  paidCents: number;
  changeCents: number;
  cashCents: number;
  nonCashCents: number;
}

export class PaymentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentValidationError';
  }
}

/**
 * Validates a set of payments against the amount due.
 *
 * - At least one payment; every amount is a positive integer number of cents.
 * - Card/QR payments can never exceed the total (no change is given on them).
 * - The sum of payments must cover the total. Any excess must come from cash
 *   and is returned as change.
 */
export function validatePayments(totalCents: number, payments: PaymentInput[]): PaymentResult {
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new PaymentValidationError('Total must be a non-negative integer (cents)');
  }
  if (payments.length === 0) {
    throw new PaymentValidationError('At least one payment is required');
  }
  let cashCents = 0;
  let nonCashCents = 0;
  for (const p of payments) {
    if (!PaymentMethods.includes(p.method)) {
      throw new PaymentValidationError(`Unsupported payment method: ${String(p.method)}`);
    }
    if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) {
      throw new PaymentValidationError('Payment amount must be a positive integer (cents)');
    }
    if (p.method === 'CASH') cashCents += p.amountCents;
    else nonCashCents += p.amountCents;
  }
  if (nonCashCents > totalCents) {
    throw new PaymentValidationError('Card/QR payments cannot exceed the amount due');
  }
  const paidCents = cashCents + nonCashCents;
  if (paidCents < totalCents) {
    throw new PaymentValidationError('Payment does not cover the total amount');
  }
  return { paidCents, changeCents: paidCents - totalCents, cashCents, nonCashCents };
}
