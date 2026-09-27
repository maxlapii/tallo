import { z } from 'zod';
import type { Database } from '../db/connection.js';
import { ConflictError, ErrorCodes, InvalidRequestError, NotFoundError } from '../utils/errors.js';
import { recordAudit } from './auditService.js';
import { hashPassword } from './passwordService.js';
import { Roles, toPublicUser, type AuthUser, type PublicUser, type UserRow } from './types.js';

export const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(
      /^[a-zA-Z0-9._-]+$/,
      'Username may only contain letters, numbers, dots, underscores, and hyphens',
    ),
  password: z.string().min(8).max(128),
  fullName: z.string().trim().min(1).max(100),
  role: z.enum(Roles),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  fullName: z.string().trim().min(1).max(100).optional(),
  role: z.enum(Roles).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).max(128).optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export function listUsers(db: Database): PublicUser[] {
  return db.all<UserRow>('SELECT * FROM users ORDER BY id').map(toPublicUser);
}

export function getUser(db: Database, id: number): PublicUser {
  const row = db.get<UserRow>('SELECT * FROM users WHERE id = ?', [id]);
  if (!row) throw new NotFoundError('User not found');
  return toPublicUser(row);
}

/** Admin update of name, role, active flag, or password. Role/active changes are audited. */
export function updateUser(db: Database, actor: AuthUser, id: number, input: unknown): PublicUser {
  const parsed = updateUserSchema.safeParse(input);
  if (!parsed.success)
    throw new InvalidRequestError('Invalid user data', parsed.error.flatten().fieldErrors);
  const data = parsed.data;
  return db.transaction(() => {
    const before = getUser(db, id);
    if (actor.id === id && (data.active === false || (data.role && data.role !== before.role))) {
      throw new InvalidRequestError('You cannot change your own role or deactivate yourself');
    }
    const sets: string[] = [];
    const params: (string | number)[] = [];
    if (data.fullName !== undefined) {
      sets.push('full_name = ?');
      params.push(data.fullName);
    }
    if (data.role !== undefined) {
      sets.push('role = ?');
      params.push(data.role);
    }
    if (data.active !== undefined) {
      sets.push('active = ?');
      params.push(data.active ? 1 : 0);
    }
    if (data.password !== undefined) {
      sets.push('password_hash = ?');
      params.push(hashPassword(data.password));
    }
    if (sets.length > 0) {
      sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
      db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    }
    const after = getUser(db, id);
    if (after.role !== before.role || after.active !== before.active) {
      recordAudit(db, {
        userId: actor.id,
        action: 'USER_UPDATE',
        entity: 'users',
        entityId: id,
        details: { role: [before.role, after.role], active: [before.active, after.active] },
      });
    }
    return after;
  });
}

export function createUser(db: Database, actor: AuthUser, input: CreateUserInput): PublicUser {
  const parsed = createUserSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvalidRequestError('Invalid user data', parsed.error.flatten().fieldErrors);
  }
  const data = parsed.data;
  return db.transaction(() => {
    const existing = db.get<{ id: number }>('SELECT id FROM users WHERE username = ?', [
      data.username,
    ]);
    if (existing) {
      throw new ConflictError(ErrorCodes.DUPLICATE_USERNAME, 'Username is already taken');
    }
    const result = db.run(
      'INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)',
      [data.username, hashPassword(data.password), data.fullName, data.role],
    );
    recordAudit(db, {
      userId: actor.id,
      action: 'USER_CREATE',
      entity: 'users',
      entityId: result.lastInsertRowid,
      details: { username: data.username, role: data.role },
    });
    return getUser(db, result.lastInsertRowid);
  });
}
