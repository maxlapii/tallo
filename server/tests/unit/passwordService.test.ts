import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/services/passwordService.js';

describe('passwordService', () => {
  it('hashes and verifies a password', () => {
    const hash = hashPassword('secret-value');
    expect(hash).not.toBe('secret-value');
    expect(hash.startsWith('$2')).toBe(true);
    expect(verifyPassword('secret-value', hash)).toBe(true);
  });

  it('rejects a wrong password', () => {
    const hash = hashPassword('secret-value');
    expect(verifyPassword('other-value', hash)).toBe(false);
  });

  it('produces a different hash each time (salted)', () => {
    expect(hashPassword('x')).not.toBe(hashPassword('x'));
  });
});
