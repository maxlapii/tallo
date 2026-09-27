import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useRealtime } from '../realtime/RealtimeContext';
import type { Role } from '../api/types';
import { getStoreCode } from '../api/client';
import { initials } from '../utils/format';
import { Icon } from './Icon';

const ALL: Role[] = ['ADMIN', 'CASHIER', 'SALE'];
const STAFF: Role[] = ['ADMIN', 'CASHIER'];

const links: {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
  roles: Role[];
  saleLabel?: string;
  id?: string;
}[] = [
  { to: '/', label: 'Home', icon: 'dashboard', end: true, roles: STAFF },
  { to: '/pos', label: 'POS', icon: 'cart', roles: ALL },
  { to: '/products', label: 'Products', icon: 'box', roles: STAFF },
  { to: '/inventory', label: 'Stock', icon: 'layers', roles: STAFF },
  { to: '/sales', label: 'History', icon: 'history', roles: ALL, saleLabel: 'My orders' },
  { to: '/shift', label: 'Shift', icon: 'cash', roles: STAFF, id: 'register' },
  { to: '/reports', label: 'Reports', icon: 'chart', roles: STAFF },
  { to: '/print-station', label: 'Print', icon: 'print', roles: ALL },
  { to: '/printers', label: 'Printers', icon: 'grid', roles: ['ADMIN'] },
  { to: '/users', label: 'Users', icon: 'user', roles: ['ADMIN'] },
  { to: '/store', label: 'Store', icon: 'lock', roles: ['ADMIN'] },
];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function Layout() {
  const { user, logout } = useAuth();
  const { connected } = useRealtime();
  const navigate = useNavigate();
  const visible = links.filter((l) => user && l.roles.includes(user.role));
  const location = useLocation();
  const zone = location.pathname.startsWith('/pos') ? 'app-shell zone-cashier' : 'app-shell';
  const firstName = user?.fullName.split(' ')[0] ?? '';
  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className={zone}>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand-mark" title="Tallo">
          <Icon name="cart" size={20} />
        </div>
        <nav className="sidebar-nav">
          {visible.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end ?? false}
              className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
              data-testid={`nav-${l.id ?? l.label.toLowerCase()}`}
              title={l.label}
            >
              <Icon name={l.icon} />
              <span>{user?.role === 'SALE' && l.saleLabel ? l.saleLabel : l.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button
            type="button"
            className="nav-item btn-ghost"
            onClick={handleLogout}
            aria-label="Log out"
            title="Log out"
            style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}
          >
            <Icon name="logout" />
            <span className="logout-label">Log out</span>
          </button>
        </div>
      </aside>
      <div className="app-body">
        <header className="topbar">
          <div className="greeting">
            <h1>
              {greeting()}, {firstName}.<span className="tagline"> Let's make it a great day!</span>
            </h1>
            <div className="date">{today}</div>
          </div>
          <div className="topbar-right">
            <span
              className={connected ? 'live-dot on' : 'live-dot'}
              title={connected ? 'Live updates connected' : 'Live updates offline'}
              data-testid="live-indicator"
            >
              <span className="dot" /> {connected ? 'Live' : 'Offline'}
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-icon mobile-only"
              onClick={handleLogout}
              aria-label="Log out"
              title="Log out"
            >
              <Icon name="logout" />
            </button>
            <div className="user-chip" data-testid="current-user">
              <div className="avatar">{initials(user?.fullName ?? '?')}</div>
              <div className="name-block">
                <div className="hi">
                  {getStoreCode() ? `${getStoreCode()} · ` : ''}
                  {user?.role.toLowerCase()}
                </div>
                <div className="name">{user?.fullName}</div>
              </div>
            </div>
          </div>
        </header>
        <main className="app-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
