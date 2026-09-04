import { useEffect, useState, useCallback } from 'react'
import { AlertTriangle, Car, Activity, Zap, RefreshCw } from 'lucide-react'
import MapView from '../components/MapView'
import StatCard from '../components/StatCard'
import { useAlertWebSocket, WSMessage } from '../lib/ws'
import {
  getSummary, getDensity, getAlerts,
  type Summary, type DensityEntry, type AlertEntry
} from '../lib/api'
import { formatDistanceToNow } from 'date-fns'

function LiveAlertItem({ alert }: { alert: WSMessage }) {
  return (
    <div className="alert-row animate-fade-in">
      <div className="mt-0.5">
        <AlertTriangle size={14} style={{ color: 'var(--accent-red)' }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="plate-badge blacklisted text-xs">{alert.plate_number}</span>
          <span className="tag tag-red">{alert.alert_type?.replace('_', ' ')}</span>
        </div>
        <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{alert.camera_name}</div>
        <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {alert.timestamp ? formatDistanceToNow(new Date(alert.timestamp), { addSuffix: true }) : ''}
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [density, setDensity] = useState<DensityEntry[]>([])
  const [pastAlerts, setPastAlerts] = useState<AlertEntry[]>([])
  const [liveAlerts, setLiveAlerts] = useState<WSMessage[]>([])
  const [alertCameras, setAlertCameras] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const [sum, dens, alerts] = await Promise.all([
        getSummary(),
        getDensity(24),
        getAlerts({ resolved: false, limit: 20 }),
      ])
      setSummary(sum)
      setDensity(dens)
      setPastAlerts(alerts)
      setAlertCameras(alerts.map(a => a.camera_id))
    } catch (err) {
      console.error('Dashboard fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 30000) // refresh every 30s
    return () => clearInterval(interval)
  }, [fetchData])

  const handleWSMessage = useCallback((msg: WSMessage) => {
    if (msg.type === 'alert') {
      setLiveAlerts(prev => [msg, ...prev].slice(0, 30))
      if (msg.camera_id) {
        setAlertCameras(prev => [...new Set([...prev, msg.camera_id!])])
      }
      // Refresh summary
      getSummary().then(setSummary).catch(() => {})
    }
  }, [])

  useAlertWebSocket(handleWSMessage)

  const allAlerts: WSMessage[] = [
    ...liveAlerts,
    ...pastAlerts.map(a => ({
      type: 'alert' as const,
      alert_id: a.id,
      plate_number: a.plate_number,
      camera_id: a.camera_id,
      camera_name: a.camera_name,
      alert_type: a.alert_type,
      timestamp: a.timestamp,
      details: a.details,
    }))
  ].slice(0, 30)

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Map (main) ───────────────────────────────────────── */}
      <div className="flex-1 relative">
        <MapView highlightAlerts={alertCameras} />

        {/* Overlay stats bar at top */}
        <div
          className="absolute top-3 left-3 right-3 z-[1000] grid grid-cols-4 gap-3 pointer-events-none"
          id="dashboard-stats"
        >
          <StatCard
            id="stat-vehicles-today"
            label="Vehicles Today"
            value={loading ? '…' : (summary?.vehicles_seen_today ?? 0).toLocaleString()}
            icon={Car}
            color="var(--accent-blue-light)"
          />
          <StatCard
            id="stat-active-alerts"
            label="Active Alerts"
            value={loading ? '…' : (summary?.active_alerts ?? 0)}
            icon={AlertTriangle}
            color="var(--accent-red)"
          />
          <StatCard
            id="stat-total-events"
            label="Total Events"
            value={loading ? '…' : (summary?.total_events ?? 0).toLocaleString()}
            icon={Activity}
            color="var(--accent-green)"
          />
          <StatCard
            id="stat-distinct-plates"
            label="Distinct Plates"
            value={loading ? '…' : (summary?.distinct_plates_total ?? 0).toLocaleString()}
            icon={Zap}
            color="var(--accent-amber)"
          />
        </div>
      </div>

      {/* ── Alert feed panel ──────────────────────────────────── */}
      <div
        className="w-80 flex flex-col flex-shrink-0"
        style={{ background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border)' }}
      >
        <div
          className="flex items-center justify-between px-4 py-3 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-2">
            <span className="status-dot alert" />
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Live Alert Feed</span>
          </div>
          <button
            id="refresh-alerts"
            onClick={fetchData}
            className="p-1.5 rounded hover:bg-white/5 transition-colors"
            style={{ color: 'var(--text-muted)' }}
          >
            <RefreshCw size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
          {allAlerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center" style={{ color: 'var(--text-muted)' }}>
              <Activity size={28} className="mb-3 opacity-30" />
              <div className="text-sm font-medium">No alerts yet</div>
              <div className="text-xs mt-1">System is monitoring all cameras</div>
            </div>
          ) : (
            allAlerts.map((alert, i) => (
              <LiveAlertItem key={`${alert.alert_id}-${i}`} alert={alert} />
            ))
          )}
        </div>

        {/* Camera density legend */}
        <div className="p-3" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>TRAFFIC DENSITY</div>
          <div className="flex flex-col gap-1.5 max-h-44 overflow-y-auto">
            {density.slice(0, 10).map(d => (
              <div key={d.camera_id} className="flex items-center justify-between text-xs">
                <span style={{ color: 'var(--text-secondary)' }} className="truncate mr-2">{d.camera_name}</span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div
                    style={{
                      width: `${Math.max(20, (d.event_count / Math.max(...density.map(x => x.event_count), 1)) * 60)}px`,
                      height: '4px',
                      borderRadius: '2px',
                      background: d.event_count > 100 ? 'var(--accent-red)' : d.event_count > 50 ? 'var(--accent-amber)' : 'var(--accent-blue-light)',
                    }}
                  />
                  <span className="font-mono" style={{ color: 'var(--text-muted)' }}>{d.event_count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
