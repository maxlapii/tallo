import type { NextFunction, Request, Response } from 'express';
import type { Database } from '../db/connection.js';
import { enterTenant } from '../tenancy/context.js';
import type { StoreRegistry } from '../tenancy/registry.js';
import { requireActiveUser, verifyToken, type AuthConfig } from '../services/authService.js';
import type { AuthUser, Role } from '../services/types.js';
import { ForbiddenError, UnauthorizedError } from '../utils/errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

/** Rejects requests without a valid `Authorization: Bearer <token>` header. */
export function authenticate(db: Database, config: AuthConfig) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const registry = req.app.get('registry') as StoreRegistry | undefined;
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing bearer token');
    }
    const token = header.slice('Bearer '.length).trim();
    const decoded = verifyToken(config, token);
    if (registry) enterTenant({ slug: decoded.store, db: registry.openStore(decoded.store) });
    req.user = requireActiveUser(db, decoded);
    next();
  };
}

/** Allows only users whose role is in `roles`. Must run after `authenticate`. */
export function authorize(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw new UnauthorizedError();
    if (!roles.includes(req.user.role)) {
      throw new ForbiddenError();
    }
    next();
  };
}
