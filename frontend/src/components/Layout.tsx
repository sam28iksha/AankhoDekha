import { NavLink, Outlet, useLocation, Link } from 'react-router-dom'
import { useState, useCallback, useEffect } from 'react'
import {
  Map, Search, BarChart3, Bell, Eye, Ban, ScanLine,
  Wifi, WifiOff, ClipboardList, UserCog, LogOut,
} from 'lucide-react'
import { useAlertWebSocket, WSMessage } from '../lib/ws'
import { useAuth, hasRole } from '../lib/auth'
import Toast from './Toast'
import ErrorBoundary from './ErrorBoundary'

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Live Map', icon: Map, id: 'nav-dashboard' },
  { to: '/vehicle', label: 'Vehicle Search', icon: Search, id: 'nav-vehicle' },
  { to: '/analytics', label: 'Analytics', icon: BarChart3, id: 'nav-analytics' },
  { to: '/alerts', label: 'Alerts', icon: Bell, id: 'nav-alerts' },
  { to: '/blacklist', label: 'Blacklist', icon: Ban, id: 'nav-blacklist' },
  { to: '/ocr-preview', label: 'OCR Preview', icon: ScanLine, id: 'nav-ocr-preview' },
]

const ADMIN_NAV_ITEMS = [
  { to: '/audit-log', label: 'Audit Log', icon: ClipboardList, id: 'nav-audit-log' },
  { to: '/users', label: 'Users', icon: UserCog, id: 'nav-users' },
]

export default function Layout() {
  const [unseenAlerts, setUnseenAlerts] = useState(0)
  const location = useLocation()
  const { user, logout } = useAuth()

  const handleWSMessage = useCallback((msg: WSMessage) => {
    if (msg.type === 'alert') {
      setUnseenAlerts(n => n + 1)
    }
  }, [])

  const { connected } = useAlertWebSocket(handleWSMessage)

  useEffect(() => {
    if (location.pathname === '/alerts') setUnseenAlerts(0)
  }, [location.pathname])

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      {/* ── Top nav bar ──────────────────────────────────────── */}
      <header
        className="flex items-center gap-4 px-4 flex-shrink-0"
        style={{ background: 'var(--bg-secondary)', height: '56px' }}
      >
        {/* Logo — links back to the public landing page. Passes
            skipAutoEnter so Landing's scroll-past-hero listener doesn't
            immediately bounce a signed-in visitor straight back here. */}
        <Link
          to="/home"
          state={{ skipAutoEnter: true }}
          className="flex items-center gap-2.5 flex-shrink-0"
          title="Back to landing page"
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #023047 0%, #00b4d8 55%, #ffaa4c 100%)', boxShadow: '0 0 14px rgba(0,180,216,0.45)' }}
          >
            <Eye size={16} color="white" />
          </div>
          <div className="hidden sm:block leading-tight">
            <div className="font-bold text-sm" style={{ color: 'var(--text-primary)', letterSpacing: '0.05em' }}>
              AankhoDekha
            </div>
            <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>The Eye of the City</div>
          </div>
        </Link>

        <div style={{ width: 1, height: 28, background: 'var(--border)' }} />

        {/* Nav pills */}
        <nav className="flex items-center gap-1 flex-1 overflow-x-auto">
          {NAV_ITEMS.map(({ to, label, icon: Icon, id }) => (
            <NavLink
              key={to}
              to={to}
              id={id}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Icon size={15} />
              <span>{label}</span>
              {to === '/alerts' && unseenAlerts > 0 && (
                <span className="nav-badge">{unseenAlerts > 99 ? '99+' : unseenAlerts}</span>
              )}
            </NavLink>
          ))}
          {hasRole(user, 'admin') && ADMIN_NAV_ITEMS.map(({ to, label, icon: Icon, id }) => (
            <NavLink
              key={to}
              to={to}
              id={id}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Icon size={15} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* WS status + user + logout */}
        <div className="flex items-center gap-4 flex-shrink-0">
          <div className="flex items-center gap-2">
            {connected
              ? <><Wifi size={14} style={{ color: 'var(--accent-green)' }} /><span className="text-xs hidden md:inline" style={{ color: 'var(--accent-green)' }}>Live</span></>
              : <><WifiOff size={14} style={{ color: 'var(--accent-amber)' }} /><span className="text-xs hidden md:inline" style={{ color: 'var(--accent-amber)' }}>Reconnecting…</span></>
            }
          </div>
          <div className="hidden lg:block text-right leading-tight">
            <div className="text-[11px]" style={{ color: 'var(--text-primary)' }}>{user?.username}</div>
            <div className="text-[11px] capitalize" style={{ color: 'var(--text-muted)' }}>{user?.role}</div>
          </div>
          <button
            id="logout-btn"
            onClick={logout}
            className="flex items-center gap-1.5 text-xs px-2 py-1.5 rounded transition-colors hover:bg-white/5"
            style={{ color: 'var(--text-muted)' }}
            title="Log out"
          >
            <LogOut size={14} />
          </button>
        </div>
      </header>

      {/* Signature gradient accent — navy -> cyan -> amber, drifts slowly */}
      <div className="gradient-bar" />

      {/* ── Page content ─────────────────────────────────────── */}
      <main className="flex-1 overflow-hidden page-fade-in" key={location.pathname}>
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>

      <Toast />
    </div>
  )
}
