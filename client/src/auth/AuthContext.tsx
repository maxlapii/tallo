import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError, getToken, setStoreCode, setToken } from '../api/client';
import type { LoginResponse, User } from '../api/types';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string, store?: string) => Promise<void>;
  /** Sign in with a session obtained elsewhere (e.g. store signup). */
  adopt: (session: { token: string; user: User; store: string }) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(() => getToken() !== null);

  // Restore the session on page load if a token is stored.
  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;
    api<{ user: User }>('/api/auth/me')
      .then((res) => {
        if (!cancelled) setUser(res.user);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) setToken(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username: string, password: string, store?: string) => {
    const res = await api<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, ...(store ? { store } : {}) }),
    });
    setToken(res.token);
    setStoreCode(res.store);
    setUser(res.user);
  }, []);

  const adopt = useCallback((session: { token: string; user: User; store: string }) => {
    setToken(session.token);
    setStoreCode(session.store);
    setUser(session.user);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, adopt, logout }),
    [user, loading, login, adopt, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
