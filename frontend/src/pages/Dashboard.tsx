import { useEffect, useState, useCallback } from 'react'
import { AlertTriangle, Car, Activity, Zap, RefreshCw, Radar, Crosshair, X, ShieldAlert, Eye } from 'lucide-react'
import MapView from '../components/MapView'
import StatCard from '../components/StatCard'
import { useAlertWebSocket, WSMessage } from '../lib/ws'
import type { SimStats, SelectedVehicleInfo } from '../components/TrafficSimulation'
import { useCachedFetch } from '../lib/cache'
import {
  getSummary, getDensity, getAlerts, getBlacklist, getCameras,
  type Summary, type DensityEntry, type AlertEntry
} from '../lib/api'
import { formatDistanceToNow } from 'date-fns'

const VEHICLE_KIND_LABEL: Record<SelectedVehicleInfo['kind'], string> = {
  normal: 'Normal traffic',
  blacklisted: 'Blacklisted vehicle',
  suspicious: 'Suspicious pattern',
}
// 'normal' matches the vehicle marker's own muted-green fill on the map
// (#3F7050) rather than the old cyan — cyan is reserved for camera/AI
// infrastructure, not vehicles.
const VEHICLE_KIND_COLOR: Record<SelectedVehicleInfo['kind'], string> = {
  normal: '#3F7050',
  blacklisted: 'var(--accent-red)',
  suspicious: 'var(--accent-amber)',
}

// Color-coded by real alert type — a blacklist hit is genuinely critical
// (red), a route anomaly is a lower-severity heads-up (amber); showing
// every event as red would make the feed cry wolf and bury the actual
// blacklist hits among routine anomaly flags.
function LiveAlertItem({ alert, isNew }: { alert: WSMessage; isNew?: boolean }) {
  const isBlacklist = alert.alert_type === 'blacklist_hit'
  const color = isBlacklist ? 'var(--accent-red)' : 'var(--accent-amber)'
  const arriveClass = isNew ? (isBlacklist ? ' alert-row-new' : ' alert-row-new-amber') : ''
  return (
    <div
      className={`alert-row animate-fade-in${arriveClass}`}
      style={isBlacklist ? undefined : { background: 'rgba(255, 176, 32, 0.06)', borderColor: 'rgba(255, 176, 32, 0.22)' }}
    >
      <div className="mt-0.5">
        <AlertTriangle size={14} style={{ color }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`plate-badge text-xs${isBlacklist ? ' blacklisted' : ''}`}>{alert.plate_number}</span>
          <span className={`tag ${isBlacklist ? 'tag-red' : 'tag-amber'}`}>{alert.alert_type?.replace('_', ' ')}</span>
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
  // Shares MapView's own 'map:cameras' cache entry (same key, same TTL) —
  // just reads the camera count for the live-simulation stat card, no
  // extra network request in practice.
  const { data: cameras } = useCachedFetch('map:cameras', getCameras, 30000)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [density, setDensity] = useState<DensityEntry[]>([])
  const [pastAlerts, setPastAlerts] = useState<AlertEntry[]>([])
  const [liveAlerts, setLiveAlerts] = useState<WSMessage[]>([])
  const [alertCameras, setAlertCameras] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  // Alert ids that arrived over the WebSocket in this session, still within
  // their "just happened" highlight window — cleared a few seconds after
  // arrival so the emphasis fades and the row settles into the normal list.
  const [freshAlertIds, setFreshAlertIds] = useState<Set<string | number>>(new Set())

  // ── Traffic simulation — 2D canvas overlay (TrafficSimulation.tsx). ────
  const [simActive, setSimActive] = useState(false)
  const [simStats, setSimStats] = useState<SimStats | null>(null)
  const [simSelected, setSimSelected] = useState<SelectedVehicleInfo | null>(null)
  const [simFollowing, setSimFollowing] = useState(false)
  const [blacklistPlates, setBlacklistPlates] = useState<string[]>([])

  useEffect(() => {
    if (simActive && blacklistPlates.length === 0) {
      getBlacklist().then(entries => setBlacklistPlates(entries.map(e => e.plate_number))).catch(() => {})
    }
  }, [simActive, blacklistPlates.length])

  const handleSimSelectVehicle = useCallback((info: SelectedVehicleInfo | null) => {
    setSimSelected(info)
    setSimFollowing(info != null)
  }, [])

  // Keeps the tracking card's progress/leg text live as the vehicle moves,
  // rather than frozen at the moment it was clicked.
  const handleSimSelectedVehicleTick = useCallback((info: SelectedVehicleInfo) => {
    setSimSelected(info)
  }, [])

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
      if (msg.alert_id != null) {
        const id = msg.alert_id
        setFreshAlertIds(prev => new Set(prev).add(id))
        setTimeout(() => {
          setFreshAlertIds(prev => {
            const next = new Set(prev)
            next.delete(id)
            return next
          })
        }, 4000)
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
        <MapView
          highlightAlerts={alertCameras}
          simulationActive={simActive}
          simulationBlacklistPlates={blacklistPlates}
          onSimulationStats={setSimStats}
          simSelectedVehicleId={simSelected?.id ?? null}
          onSimSelectVehicle={handleSimSelectVehicle}
          onSimSelectedVehicleTick={handleSimSelectedVehicleTick}
          simFollowing={simFollowing}
          basemapStyle="default"
          lightBasemap
        />

        {/* Simulation toggle — bottom-left, out of the way of stat cards
            and the zoom control. */}
        <div className="sim-toggle-row">
          <button
            id="sim-toggle-btn"
            onClick={() => {
              const turningOn = !simActive
              setSimActive(turningOn)
              if (!turningOn) { setSimSelected(null); setSimFollowing(false) }
            }}
            className="sim-toggle-btn"
            data-active={simActive}
          >
            <Radar size={14} className={simActive ? 'animate-spin-slow' : undefined} />
            {simActive ? 'Simulation: ON' : 'Start Traffic Simulation'}
          </button>
        </div>

        {/* Overlay stats bar at top */}
        <div
          className="absolute top-3 left-3 right-3 z-[1000] grid grid-cols-4 gap-3 pointer-events-none"
          id="dashboard-stats"
        >
          <StatCard
            id="stat-vehicles-today"
            label="Vehicles Today"
            value={summary?.vehicles_seen_today ?? 0}
            loading={loading}
            icon={Car}
            color="var(--accent-blue-light)"
          />
          <StatCard
            id="stat-active-alerts"
            label="Active Alerts"
            value={summary?.active_alerts ?? 0}
            loading={loading}
            icon={AlertTriangle}
            color="var(--accent-red)"
          />
          <StatCard
            id="stat-total-events"
            label="Total Events"
            value={summary?.total_events ?? 0}
            loading={loading}
            icon={Activity}
            color="var(--accent-green)"
          />
          <StatCard
            id="stat-distinct-plates"
            label="Distinct Plates"
            value={summary?.distinct_plates_total ?? 0}
            loading={loading}
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
            className="p-1.5 rounded hover:bg-[var(--bg-card-hover)] transition-colors"
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
              <LiveAlertItem
                key={`${alert.alert_id}-${i}`}
                alert={alert}
                isNew={alert.alert_id != null && freshAlertIds.has(alert.alert_id)}
              />
            ))
          )}
        </div>

        {/* Traffic simulation panel — live vehicle count + whichever one is
            currently selected/tracked, only shown while the simulation is
            actually running so it doesn't clutter the normal dashboard. */}
        {simActive && (
          <div className="p-3 flex flex-col gap-3" style={{ borderTop: '1px solid var(--border)' }}>
            <div className="flex items-center gap-2">
              <Radar size={13} style={{ color: 'var(--brand)' }} className="animate-spin-slow" />
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>LIVE SIMULATION</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="sim-stat-card">
                <div className="sim-stat-value">{simStats?.active ?? 0}</div>
                <div className="sim-stat-label">Vehicles</div>
              </div>
              <div className="sim-stat-card">
                <div className="sim-stat-value">{cameras?.length ?? 0}</div>
                <div className="sim-stat-label">Active Cameras</div>
              </div>
              <div className="sim-stat-card">
                <div className="sim-stat-value" style={{ color: '#FFB020' }}>{simStats?.suspicious ?? 0}</div>
                <div className="sim-stat-label">Suspicious</div>
              </div>
              <div className="sim-stat-card">
                <div className="sim-stat-value" style={{ color: '#E63946' }}>{simStats?.blacklisted ?? 0}</div>
                <div className="sim-stat-label">Blacklisted</div>
              </div>
            </div>

            {simSelected ? (
              <div className="glass-card p-3" style={{ borderColor: VEHICLE_KIND_COLOR[simSelected.kind] }}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    {simSelected.kind === 'blacklisted' ? <ShieldAlert size={13} color={VEHICLE_KIND_COLOR[simSelected.kind]} /> : <Eye size={13} color={VEHICLE_KIND_COLOR[simSelected.kind]} />}
                    <span className="text-xs font-semibold" style={{ color: VEHICLE_KIND_COLOR[simSelected.kind] }}>Tracking</span>
                  </div>
                  <button
                    id="sim-stop-tracking-btn"
                    onClick={() => { setSimSelected(null); setSimFollowing(false) }}
                    className="p-0.5 rounded hover:bg-[var(--bg-card-hover)] transition-colors"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <X size={13} />
                  </button>
                </div>
                <div className="plate-badge text-xs mb-2" style={simSelected.kind === 'blacklisted' ? undefined : {}}>{simSelected.plate}</div>
                <div className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>{VEHICLE_KIND_LABEL[simSelected.kind]}</div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {simSelected.fromCamera} → {simSelected.toCamera}
                </div>
                <div className="mt-2" style={{ height: 3, borderRadius: 2, background: 'var(--bg-secondary)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${simSelected.progressPct}%`, background: VEHICLE_KIND_COLOR[simSelected.kind], transition: 'width 0.2s linear' }} />
                </div>
                <button
                  id="sim-follow-toggle-btn"
                  onClick={() => setSimFollowing(f => !f)}
                  className="btn-secondary w-full flex items-center justify-center gap-1.5 mt-3 py-1.5 text-xs"
                >
                  <Crosshair size={12} />
                  {simFollowing ? 'Following — click to stop' : 'Follow on map'}
                </button>
              </div>
            ) : (
              <div className="text-xs text-center py-2" style={{ color: 'var(--text-muted)' }}>
                Click any vehicle on the map to track it
              </div>
            )}
          </div>
        )}

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
