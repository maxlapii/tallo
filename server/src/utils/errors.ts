/**
 * Application error codes. Every API error response uses one of these codes
 * so clients can react programmatically.
 */
export const ErrorCodes = {
  INVALID_REQUEST: 'INVALID_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  DUPLICATE_SKU: 'DUPLICATE_SKU',
  DUPLICATE_BARCODE: 'DUPLICATE_BARCODE',
  DUPLICATE_USERNAME: 'DUPLICATE_USERNAME',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  INVALID_PAYMENT: 'INVALID_PAYMENT',
  SALE_NOT_FOUND: 'SALE_NOT_FOUND',
  REFUND_EXCEEDS_QUANTITY: 'REFUND_EXCEEDS_QUANTITY',
  REGISTER_NOT_OPEN: 'REGISTER_NOT_OPEN',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Base class for expected, user-facing errors. Anything else that reaches the
 * error handler is treated as an INTERNAL_ERROR and logged with its stack.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class InvalidRequestError extends AppError {
  constructor(message = 'Invalid request', details?: unknown) {
    super(ErrorCodes.INVALID_REQUEST, message, 400, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(ErrorCodes.UNAUTHORIZED, message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(ErrorCodes.FORBIDDEN, message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', code: ErrorCode = ErrorCodes.NOT_FOUND) {
    super(code, message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(code: ErrorCode, message: string) {
    super(code, message, 409);
  }
}

export class RateLimitedError extends AppError {
  constructor(message = 'Too many attempts, please try again later') {
    super(ErrorCodes.RATE_LIMITED, message, 429);
  }
}
