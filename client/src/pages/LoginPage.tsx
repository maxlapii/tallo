import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError, getStoreCode } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { homeFor } from '../auth/RequireRole';
import { Icon } from '../components/Icon';

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [store, setStore] = useState(() => getStoreCode());
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to={homeFor(user.role)} replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username, password, store.trim().toLowerCase() || undefined);
      const from = (location.state as { from?: string } | null)?.from ?? '/';
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={handleSubmit} aria-labelledby="login-title">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="cart" size={18} />
          </span>
          <span>Tallo</span>
        </div>
        <div style={{ textAlign: 'center' }}>
          <h1 id="login-title">Welcome back</h1>
          <p className="muted">Sign in to open your shift</p>
        </div>
        <div className="field">
          <label htmlFor="store">Store code</label>
          <input
            id="store"
            name="store"
            className="input"
            autoComplete="organization"
            placeholder="e.g. demo"
            required
            value={store}
            onChange={(e) => setStore(e.target.value)}
            data-testid="login-store"
          />
        </div>
        <div className="field">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            name="username"
            className="input"
            autoComplete="username"
            autoFocus
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <div className="alert alert-error" role="alert">
            <Icon name="alert" /> {error}
          </div>
        )}
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="muted small" style={{ textAlign: 'center' }}>
          New here? <Link to="/signup">Create your own private store</Link>
        </p>
      </form>
    </div>
  );
}
