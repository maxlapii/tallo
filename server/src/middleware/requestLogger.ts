import type { NextFunction, Request, Response } from 'express';
import type { Logger } from '../utils/logger.js';

/** Logs one line per request with method, path, status, and duration. */
export function requestLogger(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1_000_000;
      logger.info(
        {
          method: req.method,
          url: req.originalUrl.replace(/([?&])token=[^&]*/i, '$1token=[REDACTED]'),
          status: res.statusCode,
          durationMs: Math.round(ms * 10) / 10,
          userId: req.user?.id,
        },
        'request',
      );
    });
    next();
  };
}
