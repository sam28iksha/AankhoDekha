import { useEffect, useState, useCallback } from 'react'
import { AlertTriangle, Car, Activity, Zap, RefreshCw, Cpu, Server } from 'lucide-react'
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
  const [metrics, setMetrics] = useState<any>(null) // System metrics state
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

  // Fetch lightweight system metrics separately (every 5 seconds for real-time telemetry)
  const fetchMetrics = useCallback(async () => {
    try {
      // Clean, public fetch. No token needed!
      const res = await fetch('http://localhost:8000/health/metrics')
      if (res.ok) {
        const data = await res.json()
        setMetrics(data)
      }
    } catch (err) {
      console.error("Telemetry fetch error:", err)
    }
  }, [])

  useEffect(() => {
    fetchData()
    fetchMetrics()
    const interval = setInterval(fetchData, 30000) // refresh summary/density every 30s
    const metricsInterval = setInterval(fetchMetrics, 5000) // refresh telemetry every 5s
    return () => {
      clearInterval(interval)
      clearInterval(metricsInterval)
    }
  }, [fetchData, fetchMetrics])

  const handleWSMessage = useCallback((msg: WSMessage) => {
    if (msg.type === 'alert') {
      setLiveAlerts(prev => [msg, ...prev].slice(0, 30))
      if (msg.camera_id) {
        setAlertCameras(prev => [...new Set([...prev, msg.camera_id!])])
      }
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

      {/* ── Right Sidebar (Alert feed + Density + Telemetry) ──── */}
      <div
        className="w-80 flex flex-col flex-shrink-0 overflow-y-auto"
        style={{ background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border)' }}
      >
        <div
          className="flex items-center justify-between px-4 py-3 flex-shrink-0 sticky top-0 z-10"
          style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-2">
            <span className="status-dot alert" />
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Live Alert Feed</span>
          </div>
          <button
            id="refresh-alerts"
            onClick={() => { fetchData(); fetchMetrics(); }}
            className="p-1.5 rounded hover:bg-white/5 transition-colors"
            style={{ color: 'var(--text-muted)' }}
          >
            <RefreshCw size={14} />
          </button>
        </div>

        <div className="p-3 flex flex-col gap-2 flex-shrink-0 max-h-64 overflow-y-auto">
          {allAlerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center" style={{ color: 'var(--text-muted)' }}>
              <Activity size={28} className="mb-2 opacity-30" />
              <div className="text-xs font-medium">No alerts yet</div>
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
          <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto">
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

        {/* ── System Observability Telemetry Widget ────────────── */}
        <div className="p-3 mt-auto" style={{ borderTop: '1px solid var(--border)', background: 'rgba(0,0,0,0.2)' }}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
              <Server size={12} className="text-cyan-400" />
              SYSTEM TELEMETRY
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono">
              {metrics ? 'ONLINE' : 'CONNECTING'}
            </span>
          </div>

          {metrics ? (
            <div className="flex flex-col gap-2 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2 rounded bg-white/5 border border-white/5">
                  <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Frames Proc.</div>
                  <div className="font-mono font-bold text-cyan-400">{metrics.anpr.frames_processed}</div>
                </div>
                <div className="p-2 rounded bg-white/5 border border-white/5">
                  <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>OCR Success</div>
                  <div className="font-mono font-bold text-emerald-400">{metrics.anpr.ocr_success_rate}%</div>
                </div>
              </div>

              <div className="flex justify-between items-center px-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                <span>Active Cameras (30s):</span>
                <span className="font-mono font-semibold text-amber-400">
                  {metrics.cameras.active_now} / {metrics.cameras.registered}
                </span>
              </div>

              <div className="pt-2 border-t border-white/5 grid grid-cols-3 gap-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                <div className="bg-white/5 p-1 rounded text-center">
                  <div className="text-[9px]">YOLO</div>
                  <span className="font-mono text-cyan-300">{metrics.latency.detection_ms}ms</span>
                </div>
                <div className="bg-white/5 p-1 rounded text-center">
                  <div className="text-[9px]">OCR</div>
                  <span className="font-mono text-cyan-300">{metrics.latency.ocr_ms}ms</span>
                </div>
                <div className="bg-white/5 p-1 rounded text-center">
                  <div className="text-[9px]">Pipeline</div>
                  <span className="font-mono text-cyan-300">{metrics.latency.pipeline_ms}ms</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-xs text-center py-2" style={{ color: 'var(--text-muted)' }}>
              Loading telemetry feed...
            </div>
          )}
        </div>
      </div>
    </div>
  )
}