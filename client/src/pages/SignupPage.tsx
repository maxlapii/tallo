import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { StoresApi } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icon';

function slugify(v: string): string {
  return v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

/**
 * Self-serve store creation. Every store gets its own private database with
 * its own admin account; nothing is shared with other stores.
 */
export function SignupPage() {
  const { user, adopt } = useAuth();
  const navigate = useNavigate();
  const [storeName, setStoreName] = useState('');
  const [storeCode, setStoreCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [availability, setAvailability] = useState<{ available: boolean; reason?: string } | null>(
    null,
  );
  const [adminFullName, setAdminFullName] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [demoData, setDemoData] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);

  const code = codeTouched ? storeCode : slugify(storeName);

  useEffect(() => {
    if (code.length < 3) {
      setAvailability(null);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      StoresApi.check(code)
        .then(
          (r) =>
            !cancelled &&
            setAvailability({ available: r.available, ...(r.reason ? { reason: r.reason } : {}) }),
        )
        .catch(() => !cancelled && setAvailability(null));
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [code]);

  if (user) return <Navigate to="/" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      const res = await StoresApi.signup({
        storeName: storeName.trim(),
        storeCode: code,
        adminUsername: adminUsername.trim(),
        adminPassword,
        adminFullName: adminFullName.trim(),
        demoData,
      });
      adopt({ token: res.token, user: res.user, store: res.store });
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.details && typeof err.details === 'object')
          setFieldErrors(err.details as Record<string, string[]>);
      } else setError('Could not create the store. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-wrap">
      <form
        className="card login-card"
        style={{ maxWidth: 480 }}
        onSubmit={handleSubmit}
        aria-labelledby="signup-title"
      >
        <div className="brand">
          <span className="brand-mark">
            <Icon name="cart" size={18} />
          </span>
          <span>Tallo</span>
        </div>
        <div style={{ textAlign: 'center' }}>
          <h1 id="signup-title">Create your store</h1>
          <p className="muted">
            Your store gets its own private database. Only your team can see its data.
          </p>
        </div>
        <div className="field">
          <label htmlFor="s-name">Store name</label>
          <input
            id="s-name"
            className="input"
            required
            maxLength={80}
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
            data-testid="signup-store-name"
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="s-code">Store code</label>
          <input
            id="s-code"
            className={
              fieldErrors.storeCode || availability?.available === false ? 'input error' : 'input'
            }
            required
            value={code}
            onChange={(e) => {
              setCodeTouched(true);
              setStoreCode(slugify(e.target.value));
            }}
            data-testid="signup-store-code"
          />
          <span
            className={availability?.available === false ? 'field-error' : 'small muted'}
            data-testid="signup-code-status"
          >
            {availability === null
              ? 'Your team signs in with this code. Lowercase letters, numbers, and hyphens.'
              : availability.available
                ? `"${code}" is available`
                : (availability.reason ?? `"${code}" is already taken`)}
          </span>
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="s-fullname">Your name</label>
            <input
              id="s-fullname"
              className="input"
              required
              value={adminFullName}
              onChange={(e) => setAdminFullName(e.target.value)}
              data-testid="signup-fullname"
            />
          </div>
          <div className="field">
            <label htmlFor="s-username">Admin username</label>
            <input
              id="s-username"
              className={fieldErrors.adminUsername ? 'input error' : 'input'}
              required
              autoComplete="username"
              value={adminUsername}
              onChange={(e) => setAdminUsername(e.target.value)}
              data-testid="signup-username"
            />
            {fieldErrors.adminUsername && (
              <span className="field-error">{fieldErrors.adminUsername[0]}</span>
            )}
          </div>
        </div>
        <div className="field">
          <label htmlFor="s-password">Admin password</label>
          <input
            id="s-password"
            className={fieldErrors.adminPassword ? 'input error' : 'input'}
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            data-testid="signup-password"
          />
          <span className="small muted">
            At least 8 characters. Passwords are stored only as bcrypt hashes.
          </span>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={demoData}
            onChange={(e) => setDemoData(e.target.checked)}
            data-testid="signup-demo"
          />{' '}
          Start with sample products, categories, and printers
        </label>
        {error && (
          <div className="alert alert-error" role="alert">
            <Icon name="alert" /> {error}
          </div>
        )}
        <button
          type="submit"
          className="btn btn-primary btn-lg btn-block"
          disabled={submitting || availability?.available === false}
          data-testid="signup-submit"
        >
          {submitting ? 'Creating…' : 'Create store'}
        </button>
        <p className="muted small" style={{ textAlign: 'center' }}>
          Already have a store? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
