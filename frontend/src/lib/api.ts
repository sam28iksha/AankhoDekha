import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

// ── Types ────────────────────────────────────────────────────────

export interface Camera {
  camera_id: string
  name: string
  lat: number
  lng: number
  road_segment?: string
}

export interface PlateEvent {
  event_id: number
  camera_id: string
  camera_name: string
  lat: number
  lng: number
  road_segment?: string
  timestamp: string
  confidence: number
  snapshot_path?: string
}

export interface VehicleHistory {
  plate_number: string
  total_sightings: number
  blacklisted: boolean
  blacklist_info?: { reason: string; added_at: string }
  first_seen?: string
  last_seen?: string
  cameras_visited: string[]
  sightings: PlateEvent[]
  trajectory: [number, number][]
}

export interface DensityEntry {
  camera_id: string
  camera_name: string
  lat: number
  lng: number
  event_count: number
}

export interface ODMatrix {
  nodes: { id: string; name: string; lat: number; lng: number }[]
  flows: { origin: string; destination: string; count: number }[]
}

export interface CongestionEntry {
  camera_id: string
  camera_name: string
  lat: number
  lng: number
  road_segment?: string
  current_events: number
  baseline_events_per_window: number
  congestion_score: number
  status: 'normal' | 'moderate' | 'heavy'
}

export interface AlertEntry {
  id: number
  plate_number: string
  camera_id: string
  camera_name: string
  lat: number
  lng: number
  timestamp: string
  alert_type: 'blacklist_hit' | 'anomaly'
  resolved: boolean
  details?: string
}

export interface Summary {
  vehicles_seen_today: number
  active_alerts: number
  total_events: number
  distinct_plates_total: number
  as_of: string
}

export interface PlateSearchResult {
  plate_number: string
  sighting_count: number
}

export interface SpeedEstimate {
  origin_camera: string
  destination_camera: string
  avg_speed_kmh: number
  sample_count: number
}

// ── API calls ────────────────────────────────────────────────────

export const getCameras = (): Promise<Camera[]> =>
  api.get('/analytics/cameras').then(r => r.data)

export const getSummary = (): Promise<Summary> =>
  api.get('/analytics/summary').then(r => r.data)

export const getDensity = (hours = 24): Promise<DensityEntry[]> =>
  api.get('/analytics/density', { params: { hours } }).then(r => r.data)

export const getODMatrix = (hours = 24): Promise<ODMatrix> =>
  api.get('/analytics/od-matrix', { params: { hours } }).then(r => r.data)

export const getCongestion = (): Promise<CongestionEntry[]> =>
  api.get('/analytics/congestion').then(r => r.data)

export const getSpeedEstimates = (): Promise<SpeedEstimate[]> =>
  api.get('/analytics/speed').then(r => r.data)

export const getVehicleHistory = (plate: string): Promise<VehicleHistory> =>
  api.get(`/vehicle/${encodeURIComponent(plate)}/history`).then(r => r.data)

export const getBlacklistStatus = (plate: string) =>
  api.get(`/vehicle/${encodeURIComponent(plate)}/blacklist-status`).then(r => r.data)

export const searchPlates = (q: string): Promise<PlateSearchResult[]> =>
  api.get('/vehicles/search', { params: { q } }).then(r => r.data)

export const getTopPlates = (limit = 20): Promise<PlateSearchResult[]> =>
  api.get('/vehicles/top', { params: { limit } }).then(r => r.data)

export const getAlerts = (params?: {
  alert_type?: string
  resolved?: boolean
  limit?: number
  offset?: number
}): Promise<AlertEntry[]> =>
  api.get('/alerts', { params }).then(r => r.data)

export const resolveAlert = (id: number) =>
  api.put(`/alerts/${id}/resolve`).then(r => r.data)

export const startIngestion = (camera_id: string) =>
  api.post(`/ingest/${camera_id}`).then(r => r.data)

export const getIngestionStatus = () =>
  api.get('/ingest/status').then(r => r.data)
