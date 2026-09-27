import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import type { Role } from '../api/types';
import { useAuth } from './AuthContext';

/** Redirects users whose role is not allowed to their home screen. */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return null;
  if (!roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  return <>{children}</>;
}

export function homeFor(role: Role): string {
  return role === 'SALE' ? '/pos' : '/';
}
