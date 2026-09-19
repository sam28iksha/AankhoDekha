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
import CitySkylinePanel from './CitySkylinePanel'

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
    <div className="flex h-screen w-screen overflow-hidden">
      {/* ── Sidebar (dark forest-green brand rail) ──────────────────────── */}
      <aside className="command-sidebar flex-shrink-0">
        <div className="command-sidebar-logo">
          <div className="command-logo-badge">
            <Logomark size={16} color="white" />
          </div>
          <div className="leading-tight">
            <div className="command-wordmark" style={{ color: '#FFFFFF' }}>NAGARNETRA</div>
            <div className="text-[10px]" style={{ color: 'rgba(234, 242, 236, 0.55)', letterSpacing: '0.04em' }}>THE EYE OF THE CITY</div>
          </div>
        </div>

        <nav className="command-sidebar-nav">
          <div className="command-sidebar-section">MONITORING</div>
          {NAV_ITEMS.map(({ to, label, icon: Icon, id }) => (
            <NavLink
              key={to}
              to={to}
              id={id}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Icon size={16} />
              <span>{label}</span>
              {to === '/alerts' && unseenAlerts > 0 && (
                <span className="nav-badge">{unseenAlerts > 99 ? '99+' : unseenAlerts}</span>
              )}
            </NavLink>
          ))}
          {hasRole(user, 'admin') && (
            <>
              <div className="command-sidebar-section">ADMINISTRATION</div>
              {ADMIN_NAV_ITEMS.map(({ to, label, icon: Icon, id }) => (
                <NavLink
                  key={to}
                  to={to}
                  id={id}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                >
                  <Icon size={16} />
                  <span>{label}</span>
                </NavLink>
              ))}
            </>
          )}

          {/* Smart-city branding — Dashboard/Live Map only. `.command-sidebar-nav`
              is the flex:1 element that actually owns the empty space below
              the nav items, so this has to be its last child (with
              margin-top: auto) to land there — a sibling after </nav> would
              just render with no space to fill. */}
          {location.pathname === '/dashboard' && (
            <div className="command-sidebar-skyline">
              <CitySkylinePanel compact />
            </div>
          )}
        </nav>

        <div className="command-sidebar-footer">
          <div className={`nav-status-pill ${connected ? 'online' : 'offline'}`} style={{ marginBottom: 10 }}>
            {connected
              ? <><Wifi size={13} /><span>LIVE</span></>
              : <><WifiOff size={13} /><span>RECONNECTING</span></>
            }
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="leading-tight min-w-0">
              <div className="text-[11px] truncate" style={{ color: '#FFFFFF' }}>{user?.username}</div>
              <div className="text-[11px] capitalize" style={{ color: 'rgba(234, 242, 236, 0.55)' }}>{user?.role}</div>
            </div>
            <button
              id="logout-btn"
              onClick={logout}
              className="flex items-center gap-1.5 text-xs p-1.5 rounded transition-colors hover:bg-white/10 flex-shrink-0"
              style={{ color: 'rgba(234, 242, 236, 0.7)' }}
              title="Log out"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main column: white header + page content ────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="command-header flex items-center justify-end gap-4 px-6 flex-shrink-0">
          <LiveClock />
        </header>

        <main className="flex-1 overflow-hidden page-fade-in" key={location.pathname}>
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      <Toast />
    </div>
  )
}
