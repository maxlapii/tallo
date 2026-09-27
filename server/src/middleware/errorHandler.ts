import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import type { Logger } from '../utils/logger.js';
import { AppError, ErrorCodes } from '../utils/errors.js';

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/**
 * Central error handler: every error becomes `{ error: { code, message } }`.
 * Unexpected errors are logged with their stack and reported as INTERNAL_ERROR
 * without leaking internals to the client.
 */
export function errorHandler(logger: Logger) {
  // Express identifies error middleware by arity, so `_next` must stay declared.
  return (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    if (err instanceof AppError) {
      const body: ErrorBody = { error: { code: err.code, message: err.message } };
      if (err.details !== undefined) body.error.details = err.details;
      res.status(err.status).json(body);
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({
        error: {
          code: ErrorCodes.INVALID_REQUEST,
          message: 'Invalid request',
          details: err.flatten().fieldErrors,
        },
      });
      return;
    }
    // body-parser JSON syntax errors
    if (
      typeof err === 'object' &&
      err !== null &&
      (err as { type?: string }).type === 'entity.parse.failed'
    ) {
      res.status(400).json({
        error: { code: ErrorCodes.INVALID_REQUEST, message: 'Malformed JSON body' },
      });
      return;
    }
    logger.error({ err, method: req.method, url: req.originalUrl }, 'Unhandled error');
    res.status(500).json({
      error: { code: ErrorCodes.INTERNAL_ERROR, message: 'An unexpected error occurred' },
    });
  };
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: ErrorCodes.NOT_FOUND, message: 'Route not found' } });
}
