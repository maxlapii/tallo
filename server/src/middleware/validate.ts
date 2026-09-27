import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { InvalidRequestError } from '../utils/errors.js';

/** Validates `req.body` against a Zod schema and replaces it with the parsed value. */
export function validateBody<T>(schema: ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      throw new InvalidRequestError('Invalid request body', result.error.flatten().fieldErrors);
    }
    req.body = result.data;
    next();
  };
}
