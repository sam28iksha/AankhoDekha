import { useEffect, useState, useCallback } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline, useMap } from 'react-leaflet'
import { getCameras, getDensity, type Camera, type DensityEntry } from '../lib/api'
import 'leaflet/dist/leaflet.css'

interface MapViewProps {
  trajectory?: [number, number][]
  trajectoryLabel?: string
  highlightAlerts?: string[]  // camera_ids with active alerts
  onCameraClick?: (cam: Camera) => void
}

// Component to add heatmap overlay using leaflet.heat
function HeatmapLayer({ points }: { points: [number, number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (!points.length) return
    // Dynamic import for leaflet.heat
    import('leaflet' as any).then(() => {
      const L = (window as any).L
      if (!L || !L.heatLayer) return
      const layer = L.heatLayer(points, {
        radius: 35,
        blur: 20,
        maxZoom: 13,
        gradient: { 0.2: '#0d8fe8', 0.5: '#f59e0b', 0.8: '#ef4444' }
      }).addTo(map)
      return () => map.removeLayer(layer)
    }).catch(() => {})
  }, [map, points])
  return null
}

export default function MapView({
  trajectory,
  trajectoryLabel,
  highlightAlerts = [],
  onCameraClick,
}: MapViewProps) {
  const [cameras, setCameras] = useState<Camera[]>([])
  const [density, setDensity] = useState<DensityEntry[]>([])

  useEffect(() => {
    getCameras().then(setCameras).catch(console.error)
    getDensity(24).then(setDensity).catch(console.error)
  }, [])

  // Build density lookup by camera_id
  const densityMap: Record<string, number> = {}
  const maxCount = Math.max(...density.map(d => d.event_count), 1)
  density.forEach(d => { densityMap[d.camera_id] = d.event_count })

  // Delhi center
  const center: [number, number] = [28.6139, 77.2090]

  return (
    <MapContainer
      center={center}
      zoom={12}
      style={{ height: '100%', width: '100%' }}
      zoomControl={true}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>'
        maxZoom={19}
      />

      {/* Camera markers */}
      {cameras.map(cam => {
        const count = densityMap[cam.camera_id] || 0
        const isAlert = highlightAlerts.includes(cam.camera_id)
        const radius = 8 + (count / maxCount) * 14
        const color = isAlert ? '#ef4444' : count > maxCount * 0.7 ? '#f59e0b' : '#0d8fe8'

        return (
          <CircleMarker
            key={cam.camera_id}
            center={[cam.lat, cam.lng]}
            radius={radius}
            pathOptions={{
              color: color,
              fillColor: color,
              fillOpacity: 0.8,
              weight: 2,
            }}
            eventHandlers={{ click: () => onCameraClick?.(cam) }}
          >
            <Popup>
              <div style={{ fontFamily: 'Inter, sans-serif', minWidth: '180px' }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{cam.name}</div>
                <div style={{ color: '#64748b', fontSize: 12, marginBottom: 4 }}>{cam.road_segment}</div>
                <div style={{ fontSize: 12 }}>
                  <span style={{ color: '#0d8fe8', fontWeight: 600 }}>{count}</span> events (24h)
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                  📍 {cam.lat.toFixed(4)}, {cam.lng.toFixed(4)}
                </div>
                {isAlert && (
                  <div style={{ marginTop: 6, padding: '4px 8px', background: 'rgba(239,68,68,0.1)', borderRadius: 4, color: '#ef4444', fontSize: 12, fontWeight: 600 }}>
                    ⚠ ACTIVE ALERT
                  </div>
                )}
              </div>
            </Popup>
          </CircleMarker>
        )
      })}

      {/* Trajectory polyline */}
      {trajectory && trajectory.length >= 2 && (
        <>
          <Polyline
            positions={trajectory}
            pathOptions={{
              color: '#0d8fe8',
              weight: 3,
              opacity: 0.9,
              dashArray: '8 4',
            }}
          />
          {/* Waypoint markers */}
          {trajectory.map((pos, idx) => (
            <CircleMarker
              key={idx}
              center={pos}
              radius={5}
              pathOptions={{ color: '#0d8fe8', fillColor: '#fff', fillOpacity: 1, weight: 2 }}
            >
              <Popup>
                <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 12 }}>
                  <strong>Stop #{idx + 1}</strong><br />
                  {trajectoryLabel}
                </div>
              </Popup>
            </CircleMarker>
          ))}
        </>
      )}
    </MapContainer>
  )
}
