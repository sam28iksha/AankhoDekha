import { useEffect, useState } from 'react'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import MapView from '../components/MapView'
import StatCard from '../components/StatCard'
import { getDensity, getODMatrix, getCongestion, getSpeedEstimates, getTimeseries, getAnalyticsOverview } from '../lib/api'
import type { DensityEntry, CongestionEntry, SpeedEstimate, ODMatrix, TimeseriesPoint, AnalyticsOverview } from '../lib/api'
import { ArrowRight, Signpost, AlertOctagon, Gauge as GaugeIcon, Route } from 'lucide-react'
import { format } from 'date-fns'

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = { normal: 'tag-green', moderate: 'tag-amber', heavy: 'tag-red' }
  return <span className={`tag ${map[status] || 'tag-gray'}`}>{status.toUpperCase()}</span>
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.min(score / 3, 1) * 100
  const color = score >= 2 ? 'var(--accent-red)' : score >= 1.5 ? 'var(--accent-amber)' : 'var(--accent-green)'
  return (
    <div className="w-24 h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-card)' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 999, transition: 'width 0.5s ease' }} />
    </div>
  )
}

export default function Analytics() {
  const [density, setDensity] = useState<DensityEntry[]>([])
  const [congestion, setCongestion] = useState<CongestionEntry[]>([])
  const [speeds, setSpeeds] = useState<SpeedEstimate[]>([])
  const [odMatrix, setODMatrix] = useState<ODMatrix | null>(null)
  const [timeseries, setTimeseries] = useState<TimeseriesPoint[]>([])
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      getDensity(24),
      getCongestion(),
      getSpeedEstimates(),
      getODMatrix(24),
      getTimeseries(24),
      getAnalyticsOverview(),
    ]).then(([d, c, s, od, ts, ov]) => {
      setDensity(d)
      setCongestion(c)
      setSpeeds(s)
      setODMatrix(od)
      setTimeseries(ts)
      setOverview(ov)
    }).catch(console.error).finally(() => setLoading(false))
  }, [])

  // Build camera name lookup from od nodes
  const cameraNames: Record<string, string> = {}
  odMatrix?.nodes.forEach(n => { cameraNames[n.id] = n.name })

  const topFlows = odMatrix?.flows.slice(0, 10) ?? []
  const topSpeeds = speeds.slice(0, 8)
  const trendData = timeseries.map(t => ({ ...t, label: format(new Date(t.hour), 'HH:mm') }))

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: 'var(--bg-primary)' }}>
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <div className="page-kicker">CITYWIDE INTELLIGENCE</div>
          <h1 className="page-title">Traffic Analytics</h1>
          <p className="text-sm mt-1.5" style={{ color: 'var(--text-muted)' }}>City-wide patterns · Last 24 hours</p>
        </div>

        {/* ── Hero stat cards ───────────────────────────────── */}
        <div className="grid grid-cols-4 gap-4" id="analytics-overview">
          <StatCard
            id="stat-busiest"
            label="Busiest Corridor"
            value={loading ? '…' : (overview?.busiest_camera?.camera_name ?? '—')}
            sublabel={overview?.busiest_camera ? `${overview.busiest_camera.event_count} events (24h)` : undefined}
            icon={Signpost}
            color="var(--accent-blue-light)"
          />
          <StatCard
            id="stat-congested"
            label="Most Congested Area"
            value={loading ? '…' : (overview?.most_congested?.camera_name ?? 'None')}
            sublabel={overview?.most_congested ? `${overview.most_congested.road_segment || ''} · ${overview.most_congested.status.toUpperCase()}` : 'All clear'}
            icon={AlertOctagon}
            color="var(--accent-red)"
          />
          <StatCard
            id="stat-avg-speed"
            label="Avg City Speed"
            value={loading ? '…' : (overview?.citywide_avg_speed_kmh != null ? `${overview.citywide_avg_speed_kmh} km/h` : '—')}
            icon={GaugeIcon}
            color="var(--accent-green)"
          />
          <StatCard
            id="stat-routes"
            label="Active Routes Tracked"
            value={loading ? '…' : (overview?.active_routes ?? 0)}
            icon={Route}
            color="var(--accent-amber)"
          />
        </div>

        {/* ── GIS congestion map ─────────────────────────────── */}
        <div className="glass-card p-5" id="analytics-map" style={{ height: 380 }}>
          <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
            🗺️ City Traffic Heatmap & Congestion Overlay
          </h2>
          <div className="map-frame" style={{ height: 'calc(100% - 32px)' }}>
            <MapView
              congestion={congestion}
              lightBasemap
              heatmapOptions={{
                radius: 55,
                blur: 40,
                max: 0.8,
                gradient: {
                  0.2: '#22c55e',
                  0.4: '#eab308',
                  0.6: '#f97316',
                  0.8: '#ef4444',
                  1.0: '#b91c1c',
                },
              }}
            />
          </div>
        </div>

        {/* ── Traffic flow trend ─────────────────────────────── */}
        <div className="glass-card p-5" id="trend-chart">
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            📈 Traffic Flow Trend (Last 24h)
          </h2>
          {trendData.length === 0 && !loading ? (
            <div className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>No data yet — run ingestion first.</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={trendData} margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8 }}
                  labelStyle={{ color: 'var(--text-primary)', fontWeight: 600 }}
                />
                <Line type="monotone" dataKey="count" stroke="#22c55e" strokeWidth={2} dot={false} name="Events" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* ── Density bar chart ─────────────────────────────── */}
        <div className="glass-card p-5" id="density-chart">
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            📊 Traffic Volume per Camera (24h)
          </h2>
          {density.length === 0 && !loading ? (
            <div className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>No data yet — run ingestion first.</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={density} margin={{ top: 0, right: 20, left: 0, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="camera_name"
                  tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                  angle={-35}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8 }}
                  labelStyle={{ color: 'var(--text-primary)', fontWeight: 600 }}
                  itemStyle={{ color: 'var(--accent-blue-light)' }}
                />
                <Bar dataKey="event_count" fill="#5b7fb5" radius={[4, 4, 0, 0]} name="Events" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* ── OD Flow table ─────────────────────────────── */}
          <div className="glass-card p-5" id="od-flows">
            <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
              🔀 Origin-Destination Flows (Top 10)
            </h2>
            {topFlows.length === 0 ? (
              <div className="text-center py-6 text-sm" style={{ color: 'var(--text-muted)' }}>
                Need multi-camera sightings to compute flows.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {topFlows.map((f, i) => (
                  <div key={i} className="flex items-center gap-3 p-2 rounded" style={{ background: 'rgba(20,28,46,0.55)' }}>
                    <span className="text-xs w-4 text-center font-bold" style={{ color: 'var(--text-muted)' }}>{i + 1}</span>
                    <div className="flex-1 min-w-0 flex items-center gap-2 text-xs">
                      <span className="truncate" style={{ color: 'var(--text-secondary)' }}>{cameraNames[f.origin] || f.origin}</span>
                      <ArrowRight size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                      <span className="truncate" style={{ color: 'var(--text-secondary)' }}>{cameraNames[f.destination] || f.destination}</span>
                    </div>
                    <span className="font-mono font-bold text-xs flex-shrink-0" style={{ color: 'var(--accent-blue-light)' }}>{f.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Speed estimates ───────────────────────────── */}
          <div className="glass-card p-5" id="speed-estimates">
            <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
              🚗 Avg Speed Between Camera Pairs
            </h2>
            {topSpeeds.length === 0 ? (
              <div className="text-center py-6 text-sm" style={{ color: 'var(--text-muted)' }}>
                Need multi-camera trajectories to estimate speed.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={topSpeeds.map(s => ({
                  name: `${s.origin_camera.replace('cam_','C')}→${s.destination_camera.replace('cam_','C')}`,
                  speed: s.avg_speed_kmh,
                  n: s.sample_count,
                }))} layout="vertical" margin={{ left: 0, right: 20, top: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} unit=" km/h" />
                  <YAxis type="category" dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} width={60} />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8 }}
                    labelStyle={{ color: 'var(--text-primary)' }}
                    formatter={(v: any) => [`${v} km/h`, 'Avg Speed']}
                  />
                  <Bar dataKey="speed" fill="#22c55e" radius={[0, 4, 4, 0]} name="Speed" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* ── Congestion table ──────────────────────────────── */}
        <div className="glass-card p-5" id="congestion-table">
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            🚦 Congestion & Bottleneck Status
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Camera', 'Road', 'Current Events', 'Baseline', 'Score', 'Status'].map(h => (
                    <th key={h} className="text-left pb-2 pr-4 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {congestion.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-6" style={{ color: 'var(--text-muted)' }}>No data yet.</td></tr>
                ) : congestion.map(c => (
                  <tr key={c.camera_id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td className="py-2 pr-4 font-medium text-xs" style={{ color: 'var(--text-primary)' }}>{c.camera_name}</td>
                    <td className="py-2 pr-4 text-xs" style={{ color: 'var(--text-muted)' }}>{c.road_segment || '—'}</td>
                    <td className="py-2 pr-4 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{c.current_events}</td>
                    <td className="py-2 pr-4 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{c.baseline_events_per_window.toFixed(1)}</td>
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-2">
                        <ScoreBar score={c.congestion_score} />
                        <span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{c.congestion_score.toFixed(2)}x</span>
                      </div>
                    </td>
                    <td className="py-2"><StatusBadge status={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
