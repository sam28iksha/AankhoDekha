import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Filter, RefreshCw, Bell, X } from 'lucide-react'
import RadarLoader from '../components/RadarLoader'
import { getAlerts, resolveAlert, type AlertEntry } from '../lib/api'
import { useAlertWebSocket, WSMessage } from '../lib/ws'
import { useAuth, hasRole } from '../lib/auth'
import { format, formatDistanceToNow } from 'date-fns'

function AlertTypeBadge({ type }: { type: string }) {
  return type === 'blacklist_hit'
    ? <span className="tag tag-red">🚨 Blacklist Hit</span>
    : <span className="tag tag-amber">⚠ Anomaly</span>
}

function SourceBadge({ source }: { source: string }) {
  return source === 'simulated'
    ? <span className="tag" style={{ background: 'rgba(148,163,184,0.15)', color: '#94a3b8' }}>🎬 Simulated</span>
    : <span className="tag tag-green">🎥 Live Detection</span>
}

export default function AlertsView() {
  const { user } = useAuth()
  const canResolve = hasRole(user, 'investigator')
  const [searchParams, setSearchParams] = useSearchParams()
  const plateFilter = searchParams.get('plate')

  const [alerts, setAlerts] = useState<AlertEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [resolving, setResolving] = useState<number | null>(null)
  const [filterType, setFilterType] = useState<string>('all')
  const [filterResolved, setFilterResolved] = useState<string>('all')
  const [liveCount, setLiveCount] = useState(0)

  const fetchAlerts = useCallback(async () => {
    setLoading(true)
    try {
      const params: any = { limit: 200 }
      if (filterType !== 'all') params.alert_type = filterType
      if (filterResolved === 'unresolved') params.resolved = false
      if (filterResolved === 'resolved') params.resolved = true
      if (plateFilter) params.plate_number = plateFilter
      const data = await getAlerts(params)
      setAlerts(data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [filterType, filterResolved, plateFilter])

  useEffect(() => { fetchAlerts() }, [fetchAlerts])

  // WebSocket live updates
  const handleWS = useCallback((msg: WSMessage) => {
    if (msg.type === 'alert') {
      setLiveCount(c => c + 1)
      const newAlert: AlertEntry = {
        id: msg.alert_id || Date.now(),
        plate_number: msg.plate_number || '',
        camera_id: msg.camera_id || '',
        camera_name: msg.camera_name || '',
        lat: 0,
        lng: 0,
        timestamp: msg.timestamp || new Date().toISOString(),
        alert_type: (msg.alert_type as any) || 'blacklist_hit',
        resolved: false,
        details: msg.details,
        source: (msg.source as any) || 'detection',
      }
      setAlerts(prev => [newAlert, ...prev])
    }
    if (msg.type === 'alert_resolved') {
      setAlerts(prev => prev.map(a => a.id === msg.alert_id ? { ...a, resolved: true } : a))
    }
  }, [])

  const { connected } = useAlertWebSocket(handleWS)

  const handleResolve = async (id: number) => {
    setResolving(id)
    try {
      await resolveAlert(id)
      setAlerts(prev => prev.map(a => a.id === id ? { ...a, resolved: true } : a))
    } catch (err) {
      console.error(err)
    } finally {
      setResolving(null)
    }
  }

  const unresolvedCount = alerts.filter(a => !a.resolved).length

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      {/* Header */}
      <div
        className="px-6 py-4 flex items-center gap-4 flex-shrink-0"
        style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-3 flex-1">
          <Bell size={18} style={{ color: 'var(--accent-blue-light)' }} />
          <h1 className="page-title-sm">Alerts Center</h1>
          {unresolvedCount > 0 && (
            <span
              className="px-2 py-0.5 rounded-full text-xs font-bold alert-pulse"
              style={{ background: 'var(--accent-red)', color: 'white' }}
            >
              {unresolvedCount} ACTIVE
            </span>
          )}
          {liveCount > 0 && (
            <span className="tag tag-blue">{liveCount} live today</span>
          )}
          {plateFilter && (
            <span className="tag tag-blue flex items-center gap-1">
              Plate: {plateFilter}
              <X size={11} className="cursor-pointer" onClick={() => setSearchParams({})} />
            </span>
          )}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <Filter size={12} style={{ color: 'var(--text-muted)' }} />
            <select
              id="filter-type"
              value={filterType}
              onChange={e => setFilterType(e.target.value)}
              className="text-xs rounded px-2 py-1.5 outline-none"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
            >
              <option value="all">All Types</option>
              <option value="blacklist_hit">Blacklist Hit</option>
              <option value="anomaly">Anomaly</option>
            </select>
          </div>
          <select
            id="filter-resolved"
            value={filterResolved}
            onChange={e => setFilterResolved(e.target.value)}
            className="text-xs rounded px-2 py-1.5 outline-none"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
          >
            <option value="all">All Status</option>
            <option value="unresolved">Unresolved</option>
            <option value="resolved">Resolved</option>
          </select>
          <button id="refresh-alerts-btn" onClick={fetchAlerts} className="btn-secondary flex items-center gap-2 py-1.5 px-3 text-xs">
            <RefreshCw size={12} />
            Refresh
          </button>
        </div>

        {/* WS status */}
        <div className="flex items-center gap-2">
          <span className={`status-dot ${connected ? 'online' : 'warning'}`} />
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {connected ? 'Live' : 'Reconnecting'}
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-full gap-3" style={{ color: 'var(--text-muted)' }}>
            <RadarLoader size={20} />
            <span>Loading alerts…</span>
          </div>
        ) : alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full" style={{ color: 'var(--text-muted)' }}>
            <CheckCircle2 size={36} className="mb-3 opacity-20" />
            <div className="text-sm">No alerts match your filters.</div>
          </div>
        ) : (
          <div className="glass-card overflow-hidden" id="alerts-table">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'rgba(6,9,15,0.6)' }}>
                  {['#', 'Plate', 'Camera', 'Type', 'Source', 'Time', 'Details', 'Status', 'Action'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {alerts.map((alert, i) => (
                  <tr
                    key={alert.id}
                    className={`transition-colors ${alert.resolved ? '' : 'hover:bg-white/3'}`}
                    style={{
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                      opacity: alert.resolved ? 0.55 : 1,
                    }}
                  >
                    <td className="px-4 py-3 text-xs font-mono" style={{ color: 'var(--text-muted)' }}>#{alert.id}</td>
                    <td className="px-4 py-3">
                      <span className={`plate-badge ${!alert.resolved ? 'blacklisted' : ''}`} style={{ fontSize: '0.75rem' }}>
                        {alert.plate_number}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{alert.camera_name}</td>
                    <td className="px-4 py-3"><AlertTypeBadge type={alert.alert_type} /></td>
                    <td className="px-4 py-3"><SourceBadge source={alert.source} /></td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      <div>{format(new Date(alert.timestamp), 'dd MMM HH:mm:ss')}</div>
                      <div style={{ color: 'var(--text-muted)' }}>
                        {formatDistanceToNow(new Date(alert.timestamp), { addSuffix: true })}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs max-w-xs truncate" style={{ color: 'var(--text-muted)' }}>
                      {alert.details || '—'}
                    </td>
                    <td className="px-4 py-3">
                      {alert.resolved
                        ? <span className="tag tag-green flex items-center gap-1"><CheckCircle2 size={10} />Resolved</span>
                        : <span className="tag tag-red flex items-center gap-1"><AlertTriangle size={10} />Active</span>
                      }
                    </td>
                    <td className="px-4 py-3">
                      {!alert.resolved && canResolve && (
                        <button
                          id={`resolve-btn-${alert.id}`}
                          onClick={() => handleResolve(alert.id)}
                          disabled={resolving === alert.id}
                          className="btn-secondary py-1 px-3 text-xs flex items-center gap-1"
                        >
                          {resolving === alert.id
                            ? <RadarLoader size={11} />
                            : <CheckCircle2 size={11} />
                          }
                          Resolve
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
    </div>
  )
}
