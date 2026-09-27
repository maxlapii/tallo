import { z } from 'zod';
import { isValidMoney } from '@tallo/shared';
import { InvalidRequestError } from './errors.js';

/** Decimal money amount with at most two decimal places (e.g. 9.35). */
export const moneySchema = z
  .number()
  .finite()
  .nonnegative()
  .refine(isValidMoney, { message: 'Amount must have at most two decimal places' });

/** Tax rate as a percentage 0-100 with at most two decimals (e.g. 7.5). */
export const taxRateSchema = z
  .number()
  .finite()
  .min(0)
  .max(100)
  .refine(isValidMoney, { message: 'Tax rate must have at most two decimal places' });

export const positiveIntSchema = z.number().int().positive();
export const nonNegativeIntSchema = z.number().int().nonnegative();

/** Parses a positive integer route/query parameter or throws INVALID_REQUEST. */
export function parseId(value: unknown, label = 'id'): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new InvalidRequestError(`Invalid ${label}`);
  return n;
}

export function parseOptionalInt(value: unknown, label: string): number | undefined {
  if (value === undefined || value === '' || value === null) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n)) throw new InvalidRequestError(`Invalid ${label}`);
  return n;
}

export function parseOptionalBool(value: unknown): boolean | undefined {
  if (value === undefined || value === '' || value === null) return undefined;
  if (value === 'true' || value === '1' || value === true) return true;
  if (value === 'false' || value === '0' || value === false) return false;
  throw new InvalidRequestError('Invalid boolean value');
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/** Accepts YYYY-MM-DD and returns it, or throws. */
export function parseOptionalDate(value: unknown, label: string): string | undefined {
  if (value === undefined || value === '' || value === null) return undefined;
  if (typeof value !== 'string' || !isoDate.test(value) || Number.isNaN(Date.parse(value))) {
    throw new InvalidRequestError(`Invalid ${label}, expected YYYY-MM-DD`);
  }
  return value;
}

export function parseOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new InvalidRequestError('Invalid text parameter');
  const t = value.trim();
  return t === '' ? undefined : t;
}

/** Validates a body with a schema; throws INVALID_REQUEST with field details. */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new InvalidRequestError('Invalid request body', result.error.flatten().fieldErrors);
  }
  return result.data;
}
