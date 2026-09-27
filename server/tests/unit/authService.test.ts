import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/connection.js';
import { login, requireActiveUser, verifyToken } from '../../src/services/authService.js';
import { UnauthorizedError } from '../../src/utils/errors.js';
import { createTestDb, testConfig } from '../helpers.js';

const config = testConfig();

describe('authService', () => {
  let db: Database;
  beforeEach(() => {
    db = createTestDb();
  });
  afterEach(() => db.close());

  describe('login', () => {
    it('returns a token and public user for valid credentials', () => {
      const result = login(db, config, 'admin', 'test-password');
      expect(result.user).toMatchObject({ username: 'admin', role: 'ADMIN', active: true });
      expect(result.user).not.toHaveProperty('password_hash');
      expect(verifyToken(config, result.token)).toEqual({
        id: result.user.id,
        username: 'admin',
        role: 'ADMIN',
        store: 'default',
      });
    });

    it('rejects a wrong password', () => {
      expect(() => login(db, config, 'admin', 'nope')).toThrow(UnauthorizedError);
    });

    it('rejects an unknown user with the same message as a wrong password', () => {
      let a: Error | undefined;
      let b: Error | undefined;
      try {
        login(db, config, 'ghost', 'test-password');
      } catch (e) {
        a = e as Error;
      }
      try {
        login(db, config, 'admin', 'wrong');
      } catch (e) {
        b = e as Error;
      }
      expect(a?.message).toBe(b?.message);
    });

    it('rejects an inactive user', () => {
      db.run('UPDATE users SET active = 0 WHERE username = ?', ['cashier']);
      expect(() => login(db, config, 'cashier', 'test-password')).toThrow(UnauthorizedError);
    });
  });

  describe('verifyToken', () => {
    it('rejects garbage', () => {
      expect(() => verifyToken(config, 'not-a-token')).toThrow(/Invalid or expired/);
    });

    it('rejects a token signed with a different secret', () => {
      const token = jwt.sign({ sub: 1, username: 'admin', role: 'ADMIN' }, 'another-secret');
      expect(() => verifyToken(config, token)).toThrow(UnauthorizedError);
    });

    it('rejects an expired token', () => {
      const token = jwt.sign({ sub: 1, username: 'admin', role: 'ADMIN' }, config.jwtSecret, {
        expiresIn: -10,
      });
      expect(() => verifyToken(config, token)).toThrow(/Invalid or expired/);
    });

    it('rejects a well-signed token with an invalid payload', () => {
      const token = jwt.sign({ sub: 'abc', username: 'admin', role: 'GOD' }, config.jwtSecret);
      expect(() => verifyToken(config, token)).toThrow(/Invalid token payload/);
    });
  });

  describe('requireActiveUser', () => {
    it('returns the current identity from the database', () => {
      const { user } = login(db, config, 'cashier', 'test-password');
      expect(
        requireActiveUser(db, { id: user.id, username: 'x', role: 'ADMIN', store: 'default' }),
      ).toEqual({
        id: user.id,
        username: 'cashier',
        role: 'CASHIER',
        store: 'default',
      });
    });

    it('rejects a deactivated user', () => {
      const { user } = login(db, config, 'cashier', 'test-password');
      db.run('UPDATE users SET active = 0 WHERE id = ?', [user.id]);
      expect(() =>
        requireActiveUser(db, {
          id: user.id,
          username: 'cashier',
          role: 'CASHIER',
          store: 'default',
        }),
      ).toThrow(UnauthorizedError);
    });

    it('rejects a deleted user', () => {
      expect(() =>
        requireActiveUser(db, { id: 9999, username: 'x', role: 'CASHIER', store: 'default' }),
      ).toThrow(UnauthorizedError);
    });
  });
});
