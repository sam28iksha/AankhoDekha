// Real data pulled once via a read-only query against the running demo
// database (backend untouched) — see plan sign-off. Every camera position
// below is projected from its actual lat/lng in data/cameras.json; the
// highlighted route is a plate genuinely read by the OCR pipeline at three
// different cameras during real ingestion runs (not the synthetic seed
// script's demo plates) — confidences and timestamps are the real,
// unedited values PaddleOCR/YOLOv8 produced.

export interface CameraNode {
  id: string
  name: string
  x: number
  y: number
}

// Projected from data/cameras.json (lat/lng) into an 800x560 viewBox via a
// simple equirectangular scaling — real positions, stylized layout.
export const CAMERA_NODES: CameraNode[] = [
  { id: 'cam_01', name: 'Connaught Place', x: 463, y: 238 },
  { id: 'cam_02', name: 'ITO', x: 556, y: 241 },
  { id: 'cam_03', name: 'AIIMS', x: 439, y: 395 },
  { id: 'cam_04', name: 'Dhaula Kuan', x: 271, y: 334 },
  { id: 'cam_05', name: 'Karol Bagh', x: 372, y: 188 },
  { id: 'cam_06', name: 'Kashmere Gate ISBT', x: 503, y: 151 },
  { id: 'cam_07', name: 'Nehru Place', x: 587, y: 441 },
  { id: 'cam_08', name: 'Rajouri Garden', x: 122, y: 210 },
  { id: 'cam_09', name: 'Akshardham', x: 677, y: 284 },
  { id: 'cam_10', name: 'Rohini', x: 60, y: 60 },
  { id: 'cam_11', name: 'India Gate', x: 508, y: 283 },
  { id: 'cam_12', name: 'Lajpat Nagar', x: 557, y: 394 },
  { id: 'cam_13', name: 'Vasant Vihar', x: 258, y: 394 },
  { id: 'cam_14', name: 'Mayur Vihar', x: 740, y: 292 },
  { id: 'cam_15', name: 'Saket', x: 427, y: 500 },
]

export const EXAMPLE_ROUTE = {
  plate: 'AR09AZ6596',
  stops: [
    { cameraId: 'cam_01', confidence: 0.9066 },
    { cameraId: 'cam_13', confidence: 0.6635 },
    { cameraId: 'cam_15', confidence: 0.6635 },
  ],
}
