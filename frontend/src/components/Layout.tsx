import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useState, useCallback, useEffect } from 'react'
import {
  Map, Search, BarChart3, Bell, Ban, ScanLine,
  Wifi, WifiOff, ClipboardList, UserCog, LogOut,
} from 'lucide-react'
import { useAlertWebSocket, WSMessage } from '../lib/ws'
import { useAuth, hasRole } from '../lib/auth'
import Toast from './Toast'
import ErrorBoundary from './ErrorBoundary'
import Logomark from './Logomark'

// Command-center touch — a live clock reinforces "this is a monitoring
// system watching in real time" the moment the header loads, before any
// data has even arrived.
function LiveClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <span className="nav-clock" id="nav-live-clock">
      {now.toLocaleTimeString('en-GB', { hour12: false })}
    </span>
  )
}

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
      <header className="command-header flex items-center gap-4 px-4 flex-shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <div className="command-logo-badge">
            <Logomark size={16} color="white" />
          </div>
          <div className="hidden sm:block leading-tight">
            <div className="command-wordmark">NAGARNETRA</div>
            <div className="text-[10px]" style={{ color: 'var(--text-muted)', letterSpacing: '0.04em' }}>THE EYE OF THE CITY</div>
          </div>
        </div>

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

        {/* Live clock + WS status + user + logout */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <LiveClock />
          <div className={`nav-status-pill ${connected ? 'online' : 'offline'}`}>
            {connected
              ? <><Wifi size={13} /><span className="hidden md:inline">LIVE</span></>
              : <><WifiOff size={13} /><span className="hidden md:inline">RECONNECTING</span></>
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
