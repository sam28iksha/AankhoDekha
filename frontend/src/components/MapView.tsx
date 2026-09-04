import { useEffect } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
// leaflet.heat patches L.heatLayer onto the Leaflet namespace
import 'leaflet.heat'
import { getCameras, getDensity, type Camera, type CongestionEntry, type TrajectoryLeg } from '../lib/api'
import { useCachedFetch } from '../lib/cache'

interface HeatmapOptions {
  radius?: number
  blur?: number
  max?: number
  gradient?: Record<number, string>
}

interface MapViewProps {
  trajectory?: [number, number][]
  trajectoryLabel?: string
  legs?: TrajectoryLeg[]           // direction/timing between trajectory waypoints
  highlightAlerts?: string[]       // camera_ids with active alerts
  onCameraClick?: (cam: Camera) => void
  congestion?: CongestionEntry[]   // when provided, color camera markers by congestion status
  showHeatmap?: boolean            // default true
  heatmapOptions?: HeatmapOptions  // override radius/blur/gradient for a more vivid look
  lightBasemap?: boolean           // use a normal-brightness basemap instead of the dark theme
}

const CONGESTION_COLOR: Record<string, string> = {
  heavy: '#e63946',
  moderate: '#fbbf24',
  normal: '#22c55e',
}

// Pulsing marker pinpointing the exact camera location of a plate sighting.
function highlightIcon() {
  return L.divIcon({
    className: 'trajectory-highlight-icon',
    html: `<div style="position:relative;width:26px;height:26px;">
      <div class="trajectory-highlight-ring"></div>
      <div class="trajectory-highlight-dot"></div>
    </div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  })
}

// Rotated arrow div-icon showing direction of travel along a trajectory leg.
// Subtle, thin strokes — a dark outline keeps it legible without being bold/bright.
function directionIcon(bearingDeg: number) {
  return L.divIcon({
    className: 'direction-arrow-icon',
    html: `<div style="transform: rotate(${bearingDeg}deg); width: 26px; height: 26px; display:flex; align-items:center; justify-content:center; filter: drop-shadow(0 0 2px rgba(255,170,76,0.6));">
      <svg width="20" height="20" viewBox="0 0 24 24" style="position:absolute;">
        <path d="M12 2 L12 20 M12 2 L5 10 M12 2 L19 10" fill="none" stroke="#0c0d14" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffaa4c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2 L12 20 M12 2 L5 10 M12 2 L19 10" />
      </svg>
    </div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  })
}

// ── Real heatmap layer using leaflet.heat ────────────────────────────────────
// leaflet.heat is a side-effect import that extends L with L.heatLayer().
// We create the layer imperatively inside a useMap() hook so it is always
// added to and removed from the correct map instance.
const DEFAULT_HEATMAP_OPTIONS: Required<HeatmapOptions> = {
  radius: 35,
  blur: 25,
  max: 1.0,
  gradient: {
    0.0: '#313695',
    0.2: '#4575b4',
    0.4: '#74add1',
    0.6: '#fdae61',
    0.8: '#f46d43',
    1.0: '#d73027',
  },
}

function HeatmapLayer({ points, options }: { points: [number, number, number][]; options?: HeatmapOptions }) {
  const map = useMap()
  const merged = { ...DEFAULT_HEATMAP_OPTIONS, ...options }

  useEffect(() => {
    if (!points.length) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const heatLayer = (L as any).heatLayer(points, {
      radius: merged.radius,
      blur: merged.blur,
      maxZoom: 13,
      max: merged.max,
      gradient: merged.gradient,
    })

    heatLayer.addTo(map)
    return () => {
      map.removeLayer(heatLayer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, points, JSON.stringify(merged)])

  return null
}
// ─────────────────────────────────────────────────────────────────────────────

export default function MapView({
  trajectory,
  trajectoryLabel,
  legs,
  highlightAlerts = [],
  onCameraClick,
  congestion,
  showHeatmap = true,
  heatmapOptions,
  lightBasemap = false,
}: MapViewProps) {
  // Cached so switching pages and back doesn't re-fetch + re-render from an
  // empty map every time — this data changes slowly relative to a 20s TTL.
  const { data: cameras } = useCachedFetch('map:cameras', getCameras, 30000)
  const { data: density } = useCachedFetch('map:density24h', () => getDensity(24), 20000)

  const camerasList = cameras ?? []
  const densityList = density ?? []

  // Build density lookup by camera_id
  const densityMap: Record<string, number> = {}
  const maxCount = Math.max(...densityList.map(d => d.event_count), 1)
  densityList.forEach(d => { densityMap[d.camera_id] = d.event_count })

  // Build congestion lookup by camera_id, if provided (Analytics "GIS" panel)
  const congestionMap: Record<string, CongestionEntry> = {}
  congestion?.forEach(c => { congestionMap[c.camera_id] = c })

  // Midpoint + bearing for each trajectory leg, used to drop a direction arrow
  // (skip legs with no meaningful movement — bearing_deg is null there)
  const legMarkers = (legs && trajectory && trajectory.length >= 2)
    ? legs.slice(0, trajectory.length - 1).flatMap((leg, i) => {
        if (leg.bearing_deg == null) return []
        const [lat1, lng1] = trajectory[i]
        const [lat2, lng2] = trajectory[i + 1]
        return [{
          pos: [(lat1 + lat2) / 2, (lng1 + lng2) / 2] as [number, number],
          bearing: leg.bearing_deg,
        }]
      })
    : []

  // Build heatmap point array: [lat, lng, intensity 0-1]
  const heatPoints: [number, number, number][] = densityList.map(d => [
    d.lat,
    d.lng,
    Math.min(d.event_count / maxCount, 1),
  ])

  // Delhi center
  const center: [number, number] = [28.6139, 77.2090]

  return (
    <MapContainer
      center={center}
      zoom={12}
      style={{ height: '100%', width: '100%' }}
      zoomControl={true}
      className={lightBasemap ? 'map-light-theme' : undefined}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>'
        maxZoom={19}
      />

      {/* Smooth traffic-density heatmap overlay */}
      {showHeatmap && <HeatmapLayer points={heatPoints} options={heatmapOptions} />}

      {/* Camera markers — still visible on top of heatmap for clicking */}
      {camerasList.map(cam => {
        const count = densityMap[cam.camera_id] || 0
        const isAlert = highlightAlerts.includes(cam.camera_id)
        const camCongestion = congestionMap[cam.camera_id]

        let color = '#22d3ee'
        if (isAlert) color = '#e63946'
        else if (camCongestion) color = CONGESTION_COLOR[camCongestion.status] || color

        const radius = isAlert ? 10 : camCongestion?.status === 'heavy' ? 9 : 7

        return (
          <CircleMarker
            key={cam.camera_id}
            center={[cam.lat, cam.lng]}
            radius={radius}
            pathOptions={{
              color: color,
              fillColor: color,
              fillOpacity: isAlert ? 0.9 : 0.7,
              weight: isAlert ? 3 : 1.5,
            }}
            eventHandlers={{ click: () => onCameraClick?.(cam) }}
          >
            <Popup>
              <div style={{ fontFamily: 'Inter, sans-serif', minWidth: '180px' }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{cam.name}</div>
                <div style={{ color: '#64748b', fontSize: 12, marginBottom: 4 }}>{cam.road_segment}</div>
                <div style={{ fontSize: 12 }}>
                  <span style={{ color: '#0083a8', fontWeight: 600 }}>{count}</span> events (24h)
                </div>
                {camCongestion && (
                  <div style={{ fontSize: 12, marginTop: 2 }}>
                    Congestion: <span style={{ color: CONGESTION_COLOR[camCongestion.status], fontWeight: 600 }}>
                      {camCongestion.status.toUpperCase()} ({camCongestion.congestion_score.toFixed(2)}x)
                    </span>
                  </div>
                )}
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                  📍 {cam.lat.toFixed(4)}, {cam.lng.toFixed(4)}
                </div>
                {isAlert && (
                  <div style={{ marginTop: 6, padding: '4px 8px', background: 'rgba(230,57,70,0.15)', borderRadius: 4, color: '#e63946', fontSize: 12, fontWeight: 600 }}>
                    ⚠ ACTIVE ALERT
                  </div>
                )}
              </div>
            </Popup>
          </CircleMarker>
        )
      })}

      {/* Trajectory — highlight every sighted camera exactly, even a single one */}
      {trajectory && trajectory.length >= 1 && (
        <>
          {trajectory.length >= 2 && (
            <>
              {/* Faint glow layer underneath — subtle, not a bright halo */}
              <Polyline
                positions={trajectory}
                pathOptions={{ color: '#ffaa4c', weight: 7, opacity: 0.12, lineCap: 'round' }}
                interactive={false}
              />
              {/* Thin dark casing — guarantees the line reads against ANY background
                  underneath (heatmap reds, congestion markers, light basemap, etc.) */}
              <Polyline
                positions={trajectory}
                pathOptions={{ color: '#0c0d14', weight: 3.5, opacity: 0.7, lineCap: 'round' }}
                interactive={false}
              />
              <Polyline
                positions={trajectory}
                pathOptions={{
                  color: '#ffaa4c',
                  weight: 2,
                  opacity: 0.95,
                  dashArray: '8 5',
                }}
              />
            </>
          )}

          {/* Pulsing highlight marker pinpointing each sighted camera location */}
          {trajectory.map((pos, idx) => (
            <Marker key={idx} position={pos} icon={highlightIcon()} zIndexOffset={1000}>
              <Popup>
                <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 12 }}>
                  <strong>Stop #{idx + 1}</strong><br />
                  {trajectoryLabel}
                </div>
              </Popup>
            </Marker>
          ))}

          {/* Direction-of-travel arrows at each leg's midpoint */}
          {legMarkers.map((m, idx) => (
            <Marker key={idx} position={m.pos} icon={directionIcon(m.bearing)} interactive={false} />
          ))}
        </>
      )}
    </MapContainer>
  )
}
