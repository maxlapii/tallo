import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { UsersApi } from '../api/endpoints';
import type { Role, User } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { Badge, EmptyState, ErrorBlock, LoadingBlock } from '../components/ui';
import { formatDate } from '../utils/format';

const ROLES: { id: Role; label: string; hint: string }[] = [
  { id: 'ADMIN', label: 'Admin', hint: 'Full access: products, stock, users, reports, refunds' },
  {
    id: 'CASHIER',
    label: 'Cashier',
    hint: 'Opens and closes shifts, sells, refunds, views reports',
  },
  {
    id: 'SALE',
    label: 'Sales',
    hint: 'Order-only: places orders from a handheld device and sees its own orders',
  },
];

const empty = { username: '', password: '', fullName: '', role: 'SALE' as Role };

export function UsersPage() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(empty);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUsers((await UsersApi.list()).users);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    setFieldErrors({});
    try {
      await UsersApi.create(form);
      toast.success(`User ${form.username} created`);
      setCreating(false);
      setForm(empty);
      void load();
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(err.message);
        if (err.details && typeof err.details === 'object')
          setFieldErrors(err.details as Record<string, string[]>);
      } else setFormError('Could not create user');
    } finally {
      setSaving(false);
    }
  }

  async function update(u: User, patch: { role?: Role; active?: boolean }) {
    try {
      await UsersApi.update(u.id, patch);
      toast.success('User updated');
      void load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Users & devices</h1>
          <p className="sub">
            Create a Sales account for each handheld device, or share one across devices.
          </p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setCreating(true)}
            data-testid="new-user"
          >
            <Icon name="plus" size={16} /> New user
          </button>
        </div>
      </div>

      {error && <ErrorBlock message={error} onRetry={() => void load()} />}
      <div className="card">
        {loading ? (
          <LoadingBlock />
        ) : users.length === 0 ? (
          <EmptyState icon="user" title="No users" />
        ) : (
          <div className="table-wrap">
            <table className="table stack" data-testid="users-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} data-testid={`user-row-${u.username}`}>
                    <td className="strong primary">{u.fullName}</td>
                    <td className="mono" data-label="Username">
                      {u.username}
                    </td>
                    <td data-label="Role">
                      <select
                        className="select"
                        style={{ height: 32, width: 130 }}
                        value={u.role}
                        disabled={u.id === me?.id}
                        onChange={(e) => void update(u, { role: e.target.value as Role })}
                        aria-label={`Role for ${u.username}`}
                      >
                        {ROLES.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td data-label="Status">
                      {u.active ? (
                        <Badge tone="success">Active</Badge>
                      ) : (
                        <Badge tone="dark">Inactive</Badge>
                      )}
                    </td>
                    <td className="muted" data-label="Created">
                      {formatDate(u.createdAt)}
                    </td>
                    <td className="actions">
                      {u.id !== me?.id && (
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          onClick={() => void update(u, { active: !u.active })}
                        >
                          {u.active ? 'Deactivate' : 'Activate'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={creating}
        title="New user"
        onClose={() => setCreating(false)}
        testId="user-modal"
      >
        <form onSubmit={create} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="field">
            <label htmlFor="u-fullName">Full name</label>
            <input
              id="u-fullName"
              className="input"
              required
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              data-testid="user-fullName"
              autoFocus
            />
            {fieldErrors.fullName && <span className="field-error">{fieldErrors.fullName[0]}</span>}
          </div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="u-username">Username</label>
              <input
                id="u-username"
                className="input"
                required
                autoComplete="off"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                data-testid="user-username"
              />
              {fieldErrors.username && (
                <span className="field-error">{fieldErrors.username[0]}</span>
              )}
            </div>
            <div className="field">
              <label htmlFor="u-password">Password</label>
              <input
                id="u-password"
                className="input"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                data-testid="user-password"
              />
              {fieldErrors.password && (
                <span className="field-error">{fieldErrors.password[0]}</span>
              )}
            </div>
          </div>
          <div className="field">
            <span className="label">Role</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {ROLES.map((r) => (
                <label key={r.id} className="checkbox" style={{ alignItems: 'flex-start' }}>
                  <input
                    type="radio"
                    name="role"
                    value={r.id}
                    checked={form.role === r.id}
                    onChange={() => setForm({ ...form, role: r.id })}
                    data-testid={`user-role-${r.id.toLowerCase()}`}
                  />
                  <span>
                    {r.label}
                    <div className="small muted" style={{ fontWeight: 400 }}>
                      {r.hint}
                    </div>
                  </span>
                </label>
              ))}
            </div>
          </div>
          {formError && (
            <div className="alert alert-error" role="alert">
              <Icon name="alert" /> {formError}
            </div>
          )}
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving}
              data-testid="save-user"
            >
              {saving ? 'Creating…' : 'Create user'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
