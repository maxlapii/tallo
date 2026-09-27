import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { StoresApi } from '../api/endpoints';
import type { Store } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { ErrorBlock, LoadingBlock } from '../components/ui';
import { formatDate } from '../utils/format';

/** Store settings for admins: name, data export, and permanent deletion. */
export function StorePage() {
  const toast = useToast();
  const { logout } = useAuth();
  const [store, setStore] = useState<Store | null>(null);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await StoresApi.current();
      setStore(r.store);
      setName(r.store?.name ?? '');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function rename(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await StoresApi.rename(name.trim());
      setStore(r.store);
      toast.success('Store renamed');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function exportData() {
    setExporting(true);
    try {
      await StoresApi.export();
      toast.success('Export downloaded');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setExporting(false);
    }
  }

  async function remove(e: FormEvent) {
    e.preventDefault();
    setDeleteError(null);
    try {
      await StoresApi.remove(password);
      toast.success('Store deleted');
      logout();
      // Full navigation to a public page so no store-bound state survives.
      window.location.assign('/signup');
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'Could not delete the store');
    }
  }

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBlock message={error} onRetry={() => void load()} />;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Store</h1>
          <p className="sub">
            Your store's data lives in its own private database. Only your team can access it.
          </p>
        </div>
      </div>

      <div className="grid-main-side">
        <section className="card">
          <div className="card-header">
            <h2>Details</h2>
          </div>
          <form
            className="card-body"
            onSubmit={rename}
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            <dl className="kv">
              <dt>Store code</dt>
              <dd className="mono" data-testid="store-code">
                {store?.slug ?? '—'}
              </dd>
              <dt>Created</dt>
              <dd>{store?.createdAt ? formatDate(store.createdAt) : '—'}</dd>
            </dl>
            <div className="field">
              <label htmlFor="store-name">Store name</label>
              <input
                id="store-name"
                className="input"
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                data-testid="store-name"
              />
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={saving || !store}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <section className="card">
            <div className="card-header">
              <h2>Your data</h2>
            </div>
            <div
              className="card-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
            >
              <p className="muted small">
                Download a complete copy of this store (a standard SQLite file) at any time.
              </p>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void exportData()}
                disabled={exporting || !store}
                data-testid="store-export"
              >
                <Icon name="layers" size={16} /> {exporting ? 'Preparing…' : 'Export all data'}
              </button>
            </div>
          </section>
          <section className="card" style={{ borderColor: '#fecdd3' }}>
            <div className="card-header">
              <h2 style={{ color: 'var(--danger)' }}>Danger zone</h2>
            </div>
            <div
              className="card-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
            >
              <p className="muted small">
                Permanently deletes this store: every user, product, sale, and receipt. This cannot
                be undone.
              </p>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => setDeleting(true)}
                disabled={!store}
                data-testid="store-delete"
              >
                <Icon name="trash" size={16} /> Delete store
              </button>
            </div>
          </section>
        </div>
      </div>

      <Modal
        open={deleting}
        title="Delete this store?"
        onClose={() => setDeleting(false)}
        testId="delete-store-modal"
      >
        <form onSubmit={remove} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="alert alert-error">
            <Icon name="alert" /> All data for <strong>{store?.name}</strong> will be erased
            immediately and permanently.
          </div>
          <div className="field">
            <label htmlFor="del-confirm">Type the store code to confirm</label>
            <input
              id="del-confirm"
              className="input mono"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              data-testid="delete-confirm-code"
            />
          </div>
          <div className="field">
            <label htmlFor="del-password">Your password</label>
            <input
              id="del-password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="delete-password"
            />
          </div>
          {deleteError && (
            <div className="alert alert-error" role="alert">
              <Icon name="alert" /> {deleteError}
            </div>
          )}
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setDeleting(false)}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-danger"
              disabled={confirmText !== store?.slug || !password}
              data-testid="delete-store-submit"
            >
              Delete permanently
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
