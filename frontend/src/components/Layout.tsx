import { NavLink, Outlet } from 'react-router-dom'
import { useState, useCallback } from 'react'
import {
  Map, Search, BarChart3, Bell, AlertTriangle, Eye,
  Wifi, WifiOff, Menu, X
} from 'lucide-react'
import { useAlertWebSocket, WSMessage } from '../lib/ws'

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Live Map', icon: Map, id: 'nav-dashboard' },
  { to: '/vehicle', label: 'Vehicle Search', icon: Search, id: 'nav-vehicle' },
  { to: '/analytics', label: 'Analytics', icon: BarChart3, id: 'nav-analytics' },
  { to: '/alerts', label: 'Alerts', icon: Bell, id: 'nav-alerts' },
]

export default function Layout() {
  const [liveAlerts, setLiveAlerts] = useState<WSMessage[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const handleWSMessage = useCallback((msg: WSMessage) => {
    if (msg.type === 'alert') {
      setLiveAlerts(prev => [msg, ...prev].slice(0, 5))
    }
  }, [])

  const { connected } = useAlertWebSocket(handleWSMessage)

  return (
    <div className="flex h-screen w-screen overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      {/* ── Sidebar ──────────────────────────────────────────── */}
      <aside
        className={`flex flex-col transition-all duration-300 ${sidebarOpen ? 'w-64' : 'w-0 overflow-hidden'}`}
        style={{ background: 'var(--bg-secondary)', borderRight: '1px solid var(--border)', flexShrink: 0 }}
      >
        {/* Logo */}
        <div className="p-5 flex items-center gap-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #0d8fe8, #0158a0)', boxShadow: '0 0 12px rgba(13,143,232,0.4)' }}
          >
            <Eye size={18} color="white" />
          </div>
          <div>
            <div className="font-bold text-sm leading-tight" style={{ color: 'var(--text-primary)', letterSpacing: '0.05em' }}>
              NAGARNETRA
            </div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>The Eye of the City</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 flex flex-col gap-1 overflow-y-auto">
          {NAV_ITEMS.map(({ to, label, icon: Icon, id }) => (
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
        </nav>

        {/* Live alert mini-feed */}
        {liveAlerts.length > 0 && (
          <div className="p-3" style={{ borderTop: '1px solid var(--border)' }}>
            <div className="text-xs font-semibold mb-2 flex items-center gap-2" style={{ color: 'var(--accent-red)' }}>
              <AlertTriangle size={12} />
              LIVE ALERTS
            </div>
            <div className="flex flex-col gap-1 max-h-36 overflow-y-auto">
              {liveAlerts.map((a, i) => (
                <div key={i} className="text-xs p-2 rounded" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  <span className="font-mono font-bold" style={{ color: 'var(--accent-red)' }}>{a.plate_number}</span>
                  <div style={{ color: 'var(--text-muted)' }}>{a.camera_name}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* WS status + team */}
        <div className="p-4" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-2">
            {connected ? (
              <><span className="status-dot online" /><span className="text-xs" style={{ color: 'var(--accent-green)' }}>Live Feed Connected</span></>
            ) : (
              <><span className="status-dot" style={{ background: 'var(--accent-amber)' }} /><span className="text-xs" style={{ color: 'var(--accent-amber)' }}>Reconnecting…</span></>
            )}
          </div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Team: The Underthinker</div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>SIH 2026</div>
        </div>
      </aside>

      {/* ── Main ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header
          className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
          style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', height: '52px' }}
        >
          <button
            id="toggle-sidebar"
            onClick={() => setSidebarOpen(s => !s)}
            className="p-1.5 rounded hover:bg-white/5 transition-colors"
            style={{ color: 'var(--text-secondary)' }}
          >
            {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            {connected
              ? <Wifi size={14} style={{ color: 'var(--accent-green)' }} />
              : <WifiOff size={14} style={{ color: 'var(--accent-amber)' }} />
            }
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {connected ? 'WebSocket active' : 'Connecting…'}
            </span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
