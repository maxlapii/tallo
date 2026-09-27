import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { rateLimit } from '../../src/middleware/rateLimit.js';
import { RateLimitedError } from '../../src/utils/errors.js';

function call(mw: ReturnType<typeof rateLimit>, ip: string): void {
  let called = false;
  mw(
    { ip } as Request,
    {} as Response,
    (() => {
      called = true;
    }) as NextFunction,
  );
  expect(called).toBe(true);
}

describe('rateLimit', () => {
  it('allows up to max requests within the window and then blocks', () => {
    let t = 0;
    const mw = rateLimit({ max: 3, windowMs: 1000, now: () => t });
    call(mw, '1.1.1.1');
    call(mw, '1.1.1.1');
    call(mw, '1.1.1.1');
    expect(() => call(mw, '1.1.1.1')).toThrow(RateLimitedError);
    // Another client is unaffected.
    call(mw, '2.2.2.2');
    // After the window resets, the client is allowed again.
    t = 1001;
    call(mw, '1.1.1.1');
  });
});
