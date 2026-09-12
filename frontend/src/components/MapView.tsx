import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { getCameras, getDensity, getLegRoute, type Camera, type CongestionEntry, type TrajectoryLeg, type LegRoute } from '../lib/api'
import { useCachedFetch } from '../lib/cache'
import TrafficSimulation, { type SimStats, type SelectedVehicleInfo } from './TrafficSimulation'

// ── Mapbox GL JS migration ───────────────────────────────────────────────────
// This file used to be react-leaflet (declarative JSX components diffed by
// React). Mapbox GL JS has no such component layer here (we use raw
// `mapbox-gl`, not react-map-gl) — the map, every marker, and every
// source/layer is created and torn down imperatively in useEffects instead.
// Leaflet's [lat, lng] coordinate order is kept in every prop for backwards
// compatibility with callers (VehicleHistory.trajectory, TrajectoryLeg, etc.
// all come from the backend in [lat, lng] form) — it's flipped to Mapbox's
// [lng, lat] only at the point of each Mapbox API call.

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined
if (MAPBOX_TOKEN) {
  mapboxgl.accessToken = MAPBOX_TOKEN
}

interface HeatmapOptions {
  radius?: number
  blur?: number
  max?: number
  gradient?: Record<number, string>
}

interface MapViewProps {
  trajectory?: [number, number][]
  trajectoryLabel?: string
  stopLabels?: { name: string; time: string; cameraId: string }[]  // one per trajectory point, for persistent on-map labels
  legs?: TrajectoryLeg[]           // direction/timing between trajectory waypoints
  highlightAlerts?: string[]       // camera_ids with active alerts
  onCameraClick?: (cam: Camera) => void
  congestion?: CongestionEntry[]   // when provided, color camera markers by congestion status
  showHeatmap?: boolean            // default true
  heatmapOptions?: HeatmapOptions  // override radius/blur/gradient for a more vivid look
  lightBasemap?: boolean           // use a normal-brightness basemap instead of the dark theme
  // Legacy per-provider tile styling from the pre-Mapbox era. Mapbox's
  // single "Standard" style (below) replaces all of these now — the prop is
  // kept only so existing callers (Dashboard passes basemapStyle="satellite-green")
  // don't need to change; it's accepted but no longer read.
  basemapStyle?: 'default' | 'satellite' | 'satellite-cyan' | 'satellite-amber' | 'satellite-green' | 'natgeo'
  showRoutedPaths?: boolean        // road-snapped routes + alternates vs a straight camera-to-camera line
  legStatuses?: LegStatus[]        // per-leg real status (from actual alerts), colors the segmented line
  stopStatuses?: LegStatus[]       // per-stop status, colors the camera marker at each trajectory point
  showTrajectoryLegend?: boolean   // legend box (Normal / Suspicious / Blacklisted / Camera / Direction)

  // ── Traffic simulation (client-side "digital twin", see TrafficSimulation.tsx) ──
  simulationActive?: boolean
  simulationBlacklistPlates?: string[]
  onSimulationStats?: (stats: SimStats) => void
  simSelectedVehicleId?: number | null
  onSimSelectVehicle?: (info: SelectedVehicleInfo | null, id: number | null) => void
  onSimSelectedVehicleTick?: (info: SelectedVehicleInfo) => void
  simFollowing?: boolean
}

const CONGESTION_COLOR: Record<string, string> = {
  heavy: '#ef4444',
  moderate: '#fbbf24',
  normal: '#22c55e',
}

export type LegStatus = 'normal' | 'suspicious' | 'blacklisted'

export const LEG_STATUS_COLOR: Record<LegStatus, string> = {
  normal: '#00d9ff',
  suspicious: '#fbbf24',
  blacklisted: '#ef4444',
}

export const ROUTE_COLORS = ['#ffaa4c', '#38bdf8', '#c084fc', '#4ade80']

// Delhi center, Mapbox [lng, lat] order.
const CENTER: [number, number] = [77.2090, 28.6139]

function elFromHTML(html: string): HTMLElement {
  const wrap = document.createElement('div')
  wrap.innerHTML = html.trim()
  return wrap.firstElementChild as HTMLElement
}

// ── Camera marker DOM builders (ported from the old L.divIcon functions) ────
function plainCameraMarkerEl(color: string, radius: number): HTMLElement {
  return elFromHTML(`
    <div style="width:${radius * 2}px;height:${radius * 2}px;border-radius:50%;background:${color};border:1.5px solid rgba(255,255,255,0.5);cursor:pointer;"></div>
  `)
}

function glowCameraMarkerEl(): HTMLElement {
  return elFromHTML(`<div class="camera-marker-dot glow" style="cursor:pointer;"></div>`)
}

function alertMarkerEl(): HTMLElement {
  return elFromHTML(`
    <div class="camera-marker-dot alert" style="position:relative;cursor:pointer;">
      <div class="camera-marker-ripple"></div>
      <div class="camera-marker-ripple" style="animation-delay:0.6s"></div>
    </div>
  `)
}

function cameraPopupHTML(
  cam: Camera, count: number, camCongestion: CongestionEntry | undefined, isAlert: boolean,
): string {
  return `
    <div style="font-family: Inter, sans-serif; min-width: 180px;">
      <div style="font-weight: 700; margin-bottom: 4px;">${cam.name}</div>
      <div style="color: #64748b; font-size: 12px; margin-bottom: 4px;">${cam.road_segment ?? ''}</div>
      <div style="font-size: 12px;">
        <span style="color: #0099ba; font-weight: 600;">${count}</span> events (24h)
      </div>
      ${camCongestion ? `
        <div style="font-size: 12px; margin-top: 2px;">
          Congestion: <span style="color: ${CONGESTION_COLOR[camCongestion.status]}; font-weight: 600;">
            ${camCongestion.status.toUpperCase()} (${camCongestion.congestion_score.toFixed(2)}x)
          </span>
        </div>` : ''}
      <div style="font-size: 11px; color: #94a3b8; margin-top: 4px;">
        📍 ${cam.lat.toFixed(4)}, ${cam.lng.toFixed(4)}
      </div>
      ${isAlert ? `
        <div style="margin-top: 6px; padding: 4px 8px; background: rgba(239,68,68,0.15); border-radius: 4px; color: #ef4444; font-size: 12px; font-weight: 600;">
          ⚠ ACTIVE ALERT
        </div>` : ''}
    </div>
  `
}

export default function MapView({
  trajectory,
  trajectoryLabel,
  stopLabels,
  legs,
  highlightAlerts = [],
  onCameraClick,
  congestion,
  showHeatmap = true,
  heatmapOptions,
  lightBasemap = false,
  basemapStyle: _basemapStyle = 'default',
  showRoutedPaths = false,
  legStatuses = [],
  stopStatuses = [],
  showTrajectoryLegend = false,
  simulationActive = false,
  simulationBlacklistPlates = [],
  onSimulationStats,
  simSelectedVehicleId = null,
  onSimSelectVehicle,
  onSimSelectedVehicleTick,
  simFollowing = false,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markersRef = useRef<mapboxgl.Marker[]>([])
  const [mapInstance, setMapInstance] = useState<mapboxgl.Map | null>(null)

  // Tracks the most routes seen across all legs of the current trajectory,
  // so the legend can say e.g. "3 possible routes estimated" when at least
  // one leg has genuine alternates — reset whenever the trajectory or mode
  // changes so a stale count from a previous search doesn't linger.
  const [maxRouteOptions, setMaxRouteOptions] = useState(1)
  useEffect(() => {
    setMaxRouteOptions(1)
  }, [trajectory, showRoutedPaths])

  // Cached so switching pages and back doesn't re-fetch + re-render from an
  // empty map every time — this data changes slowly relative to a 20s TTL.
  const { data: cameras } = useCachedFetch('map:cameras', getCameras, 30000)
  const { data: density } = useCachedFetch('map:density24h', () => getDensity(24), 20000)

  const camerasList = cameras ?? []
  const densityList = density ?? []

  // Build density lookup by camera_id
  const densityMap: Record<string, number> = {}
  densityList.forEach(d => { densityMap[d.camera_id] = d.event_count })

  // Build congestion lookup by camera_id, if provided (Analytics "GIS" panel)
  const congestionMap: Record<string, CongestionEntry> = {}
  congestion?.forEach(c => { congestionMap[c.camera_id] = c })

  // ── Map init (once) ──────────────────────────────────────────────────
  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current || mapRef.current) return

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/standard',
      config: {
        basemap: {
          lightPreset: lightBasemap ? 'day' : 'night',
          show3dBuildings: true,
          show3dLandmarks: true,
          show3dTrees: true,
        },
      },
      center: CENTER,
      zoom: 12,
    })
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-left')

    mapRef.current = map
    map.on('load', () => setMapInstance(map))

    return () => {
      map.remove()
      mapRef.current = null
      setMapInstance(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Camera markers ───────────────────────────────────────────────────
  // Simplest-correct approach: clear and rebuild all camera markers whenever
  // anything that affects their appearance changes. There are only ~15
  // cameras, so the cost of a full rebuild is trivial — far simpler and less
  // error-prone than diffing marker-by-marker against Mapbox's imperative API.
  useEffect(() => {
    const map = mapInstance
    if (!map) return

    markersRef.current.forEach(m => m.remove())
    markersRef.current = []

    camerasList.forEach(cam => {
      const count = densityMap[cam.camera_id] || 0
      const isAlert = highlightAlerts.includes(cam.camera_id)
      const camCongestion = congestionMap[cam.camera_id]

      let el: HTMLElement
      if (isAlert) {
        el = alertMarkerEl()
      } else if (simulationActive && !camCongestion) {
        el = glowCameraMarkerEl()
      } else {
        const color = camCongestion ? (CONGESTION_COLOR[camCongestion.status] || '#00d9ff') : '#00d9ff'
        const radius = camCongestion?.status === 'heavy' ? 9 : 7
        el = plainCameraMarkerEl(color, radius)
      }

      const popup = new mapboxgl.Popup({ offset: 12 }).setHTML(cameraPopupHTML(cam, count, camCongestion, isAlert))
      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([cam.lng, cam.lat])
        .setPopup(popup)
        .addTo(map)

      el.addEventListener('click', () => onCameraClick?.(cam))
      markersRef.current.push(marker)
    })

    return () => {
      markersRef.current.forEach(m => m.remove())
      markersRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapInstance, camerasList, highlightAlerts, congestion, simulationActive])

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      {!MAPBOX_TOKEN ? (
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '100%', width: '100%', background: 'var(--bg-secondary, #0a111c)',
            color: 'var(--text-secondary, #94a9c4)', flexDirection: 'column', gap: 8,
            textAlign: 'center', padding: 24,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 600 }}>Map unavailable</div>
          <div style={{ fontSize: 13, maxWidth: 360 }}>
            VITE_MAPBOX_TOKEN is not set. Add a Mapbox access token to your .env file to load the map.
          </div>
        </div>
      ) : (
        <div ref={containerRef} style={{ height: '100%', width: '100%' }} />
      )}
    </div>
  )
}
