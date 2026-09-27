import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/index.js';

const base = { JWT_SECRET: 'a-sufficiently-long-secret' };

describe('loadConfig', () => {
  it('applies defaults for optional values', () => {
    const c = loadConfig(base);
    expect(c.port).toBe(3000);
    expect(c.nodeEnv).toBe('development');
    expect(c.dataDir).toBe('./data');
    expect(c.demoStore).toBe('demo');
    expect(c.allowSignup).toBe(true);
    expect(c.jwtExpiresIn).toBe('8h');
    expect(c.logLevel).toBe('info');
    expect(c.loginRateLimit).toEqual({ max: 10, windowMs: 60_000 });
  });

  it('coerces numeric strings', () => {
    const c = loadConfig({ ...base, PORT: '4100', LOGIN_RATE_LIMIT_MAX: '3' });
    expect(c.port).toBe(4100);
    expect(c.loginRateLimit.max).toBe(3);
  });

  it('rejects a missing JWT secret', () => {
    expect(() => loadConfig({})).toThrow(/JWT_SECRET/);
  });

  it('rejects a short JWT secret', () => {
    expect(() => loadConfig({ JWT_SECRET: 'short' })).toThrow(/at least 16/);
  });

  it('rejects an invalid NODE_ENV', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('rejects a non-numeric port', () => {
    expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow(/PORT/);
  });
});
