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

export interface TrajectoryLeg {
  from_camera_id: string
  to_camera_id: string
  from_camera_name: string
  to_camera_name: string
  duration_seconds: number
  duration_label: string
  distance_km: number
  avg_speed_kmh: number | null
  bearing_deg: number | null
  direction: string | null
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
  legs: TrajectoryLeg[]
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

export interface BlacklistEntry {
  plate_number: string
  reason?: string | null
  added_at: string
}

export interface TimeseriesPoint {
  hour: string
  count: number
}

export interface AnalyticsOverview {
  busiest_camera: { camera_id: string; camera_name: string; event_count: number } | null
  most_congested: {
    camera_id: string; camera_name: string; road_segment?: string
    status: string; congestion_score: number
  } | null
  citywide_avg_speed_kmh: number | null
  active_routes: number
}

export interface UploadDetection {
  event_id: number
  plate_number: string
  confidence: number
  blacklisted: boolean
  reason?: string | null
}

export interface UploadResult {
  status: 'done' | 'started' | 'running'
  type?: 'image' | 'video'
  camera_id: string
  detections?: UploadDetection[]
  message?: string
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

export const getIngestionStatusFor = (camera_id: string) =>
  api.get(`/ingest/status/${camera_id}`).then(r => r.data)

export const uploadDetection = (file: File, cameraId?: string): Promise<UploadResult> => {
  const form = new FormData()
  form.append('file', file)
  if (cameraId) form.append('camera_id', cameraId)
  return api.post('/ingest/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  }).then(r => r.data)
}

export const getTimeseries = (hours = 24): Promise<TimeseriesPoint[]> =>
  api.get('/analytics/timeseries', { params: { hours } }).then(r => r.data)

export const getAnalyticsOverview = (): Promise<AnalyticsOverview> =>
  api.get('/analytics/overview').then(r => r.data)

export const getBlacklist = (): Promise<BlacklistEntry[]> =>
  api.get('/blacklist').then(r => r.data)

export const addToBlacklist = (plate_number: string, reason?: string) =>
  api.post('/blacklist', { plate_number, reason }).then(r => r.data)

export const removeFromBlacklist = (plate_number: string) =>
  api.delete(`/blacklist/${encodeURIComponent(plate_number)}`).then(r => r.data)

// ── Detection preview (frame-by-frame OCR visualization) ───────────────────

export interface PreviewFrame {
  index: number
  t: number
  url: string
  plates: string[]
}

export interface PreviewPlate {
  plate: string
  confidence: number
  t: number
}

export interface PreviewManifest {
  camera_id: string
  playback_fps: number
  frames: PreviewFrame[]
  plates: PreviewPlate[]
}

export interface PreviewStatus {
  status: 'idle' | 'processing' | 'done' | 'error'
  progress?: number
  total?: number | null
  manifest_url?: string
  error?: string
}

export const startPreview = (cameraId: string): Promise<{ status: string; message: string }> =>
  api.post(`/preview/${cameraId}`).then(r => r.data)

export const getPreviewStatus = (cameraId: string): Promise<PreviewStatus> =>
  api.get(`/preview/status/${cameraId}`).then(r => r.data)

export const getPreviewManifest = (manifestUrl: string): Promise<PreviewManifest> =>
  api.get(manifestUrl).then(r => r.data)

export const previewAssetUrl = (path: string) => `${BASE_URL}${path}`
