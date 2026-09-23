import { NavLink, Outlet, useLocation, Link } from 'react-router-dom'
import { useState, useCallback, useEffect } from 'react'
import {
  Map, Search, BarChart3, Bell, Ban, ScanLine,
  Wifi, WifiOff, ClipboardList, UserCog, LogOut,
} from 'lucide-react'
import { useAlertWebSocket, WSMessage } from '../lib/ws'
import { useAuth, hasRole } from '../lib/auth'
import Toast from './Toast'
import ErrorBoundary from './ErrorBoundary'
import CitySkylinePanel from './CitySkylinePanel'
import brandLogo from '../assets/aankhodekha-logo.png'

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
        {/* Logo — links back to the public landing page. Passes
            skipAutoEnter so Landing's scroll-past-hero listener doesn't
            immediately bounce a signed-in visitor straight back here. */}
        <Link to="/home" state={{ skipAutoEnter: true }} className="command-sidebar-logo" title="Back to landing page">
          <img src={brandLogo} alt="AankhoDekha" className="brand-logo-img" />
          <div className="command-sidebar-brandtext">
            <div className="brand-wordmark">
              <span className="brand-wordmark-cap">A</span>ankho<span className="brand-wordmark-cap">D</span>ekhà
            </div>
            <div className="command-sidebar-tagline">The Eye of the City</div>
          </div>
        </Link>

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

          {/* Smart-city branding — every page. `.command-sidebar-nav` is the
              flex:1 element that actually owns the empty space below the
              nav items, so this has to be its last child (with
              margin-top: auto) to land there — a sibling after </nav> would
              just render with no space to fill. */}
          <div className="command-sidebar-skyline">
            <CitySkylinePanel compact />
          </div>
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
              <div className="text-[13px] truncate" style={{ color: '#FFFFFF', fontWeight: 600 }}>{user?.username}</div>
              <div className="text-[12px] capitalize" style={{ color: 'rgba(234, 242, 236, 0.55)', fontWeight: 500 }}>{user?.role}</div>
            </div>
            <button
              id="logout-btn"
              onClick={logout}
              className="flex items-center gap-1.5 text-[13px] font-semibold p-1.5 rounded transition-colors hover:bg-white/10 flex-shrink-0"
              style={{ color: 'rgba(234, 242, 236, 0.7)' }}
              title="Log out"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main column: page content ────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
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