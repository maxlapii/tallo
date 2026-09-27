import { describe, expect, it } from 'vitest';
import {
  AppError,
  ConflictError,
  ErrorCodes,
  ForbiddenError,
  InvalidRequestError,
  NotFoundError,
  RateLimitedError,
  UnauthorizedError,
} from '../../src/utils/errors.js';

describe('errors', () => {
  it.each([
    [new InvalidRequestError(), 400, ErrorCodes.INVALID_REQUEST],
    [new UnauthorizedError(), 401, ErrorCodes.UNAUTHORIZED],
    [new ForbiddenError(), 403, ErrorCodes.FORBIDDEN],
    [new NotFoundError(), 404, ErrorCodes.NOT_FOUND],
    [new NotFoundError('Sale missing', ErrorCodes.SALE_NOT_FOUND), 404, ErrorCodes.SALE_NOT_FOUND],
    [new ConflictError(ErrorCodes.DUPLICATE_SKU, 'dup'), 409, ErrorCodes.DUPLICATE_SKU],
    [new RateLimitedError(), 429, ErrorCodes.RATE_LIMITED],
  ])('%s maps to status %i and code %s', (err, status, code) => {
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(status);
    expect(err.code).toBe(code);
    expect(err.message.length).toBeGreaterThan(0);
  });

  it('carries optional details', () => {
    const err = new InvalidRequestError('bad', { field: ['required'] });
    expect(err.details).toEqual({ field: ['required'] });
  });
});
