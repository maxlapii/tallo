import type { ReactNode } from 'react';
import { Icon } from './Icon';

export function Spinner({ small }: { small?: boolean }) {
  return <div className={small ? 'spinner sm' : 'spinner'} role="status" aria-label="Loading" />;
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading-block" role="status">
      <Spinner /> <span>{label}</span>
    </div>
  );
}

export function EmptyState({
  icon = 'box',
  title,
  hint,
  action,
}: {
  icon?: string;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty" data-testid="empty-state">
      <div className="empty-icon">
        <Icon name={icon} size={24} />
      </div>
      <div className="strong text-2">{title}</div>
      {hint && <div className="small">{hint}</div>}
      {action}
    </div>
  );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="alert alert-error" role="alert">
      <Icon name="alert" />
      <div style={{ flex: 1 }}>{message}</div>
      {onRetry && (
        <button type="button" className="btn btn-sm btn-secondary" onClick={onRetry}>
          <Icon name="refresh" size={14} /> Retry
        </button>
      )}
    </div>
  );
}

type BadgeTone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'dark';
export function Badge({ tone = 'default', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={tone === 'default' ? 'badge' : `badge badge-${tone}`}>{children}</span>;
}

export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = 'default',
  testId,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon: string;
  tone?: 'default' | 'warn' | 'info' | 'danger';
  testId?: string;
}) {
  return (
    <div className="card stat" data-testid={testId}>
      <div className="stat-row">
        <span className="label">{label}</span>
        <div className={tone === 'default' ? 'stat-icon' : `stat-icon ${tone}`}>
          <Icon name={icon} />
        </div>
      </div>
      <div className="value">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function statusTone(status: string): BadgeTone {
  switch (status) {
    case 'COMPLETED':
    case 'OPEN':
      return 'success';
    case 'PARTIALLY_REFUNDED':
      return 'warning';
    case 'REFUNDED':
      return 'danger';
    case 'CLOSED':
      return 'dark';
    default:
      return 'default';
  }
}

export function statusLabel(status: string): string {
  return status
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
