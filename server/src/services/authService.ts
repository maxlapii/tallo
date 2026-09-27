import jwt from 'jsonwebtoken';
import type { Database } from '../db/connection.js';
import { UnauthorizedError } from '../utils/errors.js';
import { verifyPassword } from './passwordService.js';
import { Roles, toPublicUser, type AuthUser, type PublicUser, type UserRow } from './types.js';

export interface AuthConfig {
  jwtSecret: string;
  jwtExpiresIn: string;
}

export interface LoginResult {
  token: string;
  user: PublicUser;
  store: string;
}

interface TokenPayload {
  sub: number;
  username: string;
  role: string;
  store: string;
}

/**
 * Verifies credentials and issues a signed JWT. Inactive users and unknown
 * usernames fail with the same generic error so usernames cannot be probed.
 */
export function login(
  db: Database,
  config: AuthConfig,
  username: string,
  password: string,
  store = 'default',
): LoginResult {
  const row = db.get<UserRow>('SELECT * FROM users WHERE username = ?', [username]);
  if (!row || row.active !== 1 || !verifyPassword(password, row.password_hash)) {
    throw new UnauthorizedError('Invalid username or password');
  }
  const payload: TokenPayload = { sub: row.id, username: row.username, role: row.role, store };
  const token = jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as NonNullable<jwt.SignOptions['expiresIn']>,
  });
  return { token, user: toPublicUser(row), store };
}

/** Decodes and validates a bearer token, returning the authenticated identity. */
export function verifyToken(config: AuthConfig, token: string): AuthUser {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, config.jwtSecret);
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }
  if (
    typeof decoded !== 'object' ||
    decoded === null ||
    typeof (decoded as TokenPayload).sub !== 'number' ||
    typeof (decoded as TokenPayload).username !== 'string' ||
    !Roles.includes((decoded as TokenPayload).role as (typeof Roles)[number])
  ) {
    throw new UnauthorizedError('Invalid token payload');
  }
  const p = decoded as TokenPayload;
  return {
    id: p.sub,
    username: p.username,
    role: p.role as AuthUser['role'],
    store: typeof p.store === 'string' && p.store ? p.store : 'default',
  };
}

/**
 * Re-checks the token's user against the database so deactivated users lose
 * access immediately rather than at token expiry.
 */
export function requireActiveUser(db: Database, auth: AuthUser): AuthUser {
  const row = db.get<Pick<UserRow, 'id' | 'username' | 'role' | 'active'>>(
    'SELECT id, username, role, active FROM users WHERE id = ?',
    [auth.id],
  );
  if (!row || row.active !== 1) {
    throw new UnauthorizedError('User account is not active');
  }
  return { id: row.id, username: row.username, role: row.role, store: auth.store };
}
