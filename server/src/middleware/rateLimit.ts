import type { NextFunction, Request, Response } from 'express';
import { RateLimitedError } from '../utils/errors.js';

export interface RateLimitOptions {
  max: number;
  windowMs: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

/**
 * Minimal fixed-window in-memory rate limiter keyed by client IP. Sufficient
 * for protecting the login endpoint of a single-instance POS server.
 */
export function rateLimit(options: RateLimitOptions) {
  const now = options.now ?? Date.now;
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, _res: Response, next: NextFunction): void => {
    const key = req.ip ?? 'unknown';
    const t = now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + options.windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > options.max) {
      throw new RateLimitedError();
    }
    next();
  };
}
