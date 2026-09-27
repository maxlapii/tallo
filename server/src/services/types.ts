export const Roles = ['ADMIN', 'CASHIER', 'SALE'] as const;
export type Role = (typeof Roles)[number];

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  full_name: string;
  role: Role;
  active: number;
  created_at: string;
  updated_at: string;
}

/** Public shape of a user, safe to return from the API (no password hash). */
export interface PublicUser {
  id: number;
  username: string;
  fullName: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    active: row.active === 1,
    createdAt: row.created_at,
  };
}

/** Identity attached to authenticated requests (decoded from the JWT). */
export interface AuthUser {
  id: number;
  username: string;
  role: Role;
  /** Store code the token is bound to; `'default'` in single-store mode. */
  store: string;
}
