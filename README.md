# AankhoDekha — Multi-Camera ANPR & Traffic Intelligence Platform
### Smart India Hackathon 2026 · Team: The Underthinker

*Aankhon (eyes) + Dekha (seen) — "aankhon dekha," a Hindi idiom for an eyewitness account: seen firsthand, not told secondhand.*

---

## 1. What problem this solves

Cities run hundreds of CCTV/ANPR cameras, but today each camera works **solo** — it sees a plate, logs it, and forgets it. There is no system that stitches together sightings of the *same* vehicle across *different* cameras into one timeline. So when a vehicle is flagged (stolen, blacklisted, involved in a crime), there is no fast way to answer: *"Where has this vehicle been, and where is it likely headed?"*

AankhoDekha turns a city-wide network of cameras into one connected brain. It reads plates, remembers every sighting, reconstructs a vehicle's path across the whole city, flags blacklisted or physically-implausible (cloned-plate) vehicles in real time, and gives traffic planners a live picture of how the city moves as a whole.

---

## 2. Core capabilities

| Capability | How it works |
|---|---|
| **Plate detection & recognition** | YOLOv8 (fine-tuned) finds the plate bounding box; PaddleOCR reads the characters. A validation layer checks the read against real Indian plate formats (standard + BH-series) and real RTO state codes, with position-aware correction for common OCR confusions (`0`/`O`, `1`/`I`, `5`/`S`, `8`/`B`, `2`/`Z`). |
| **Noise-tolerant reads** | A single vehicle is sampled across many video frames; a temporal-clustering step groups near-duplicate reads and merges them via confidence-weighted, per-character majority vote into one clean sighting — not one row per frame. |
| **Cross-camera trajectory tracking** | Every clean reading is stored as `{plate, camera_id, lat, lng, timestamp, confidence}`. Vehicle Search reconstructs a plate's full journey — direction, inter-camera timing, and speed per leg — and can render either a direct camera-to-camera line or a road-network-snapped route (via OSRM) with alternates when more than one path is plausible. |
| **Real-time alerting** | A detected plate is checked against the blacklist at write-time; a match broadcasts an alert instantly over WebSocket, surfacing as an in-app toast (and a native browser notification, if permitted) on whatever page is open. Every alert is tagged `detection` (real) or `simulated` (an explicit, clearly-labeled demo/testing aid) — nothing is hidden. |
| **Anomaly / cloned-plate detection** | If the same plate is seen at two cameras with an implied travel speed that's physically impossible (default threshold 120 km/h, configurable), the system flags it as a likely cloned/duplicated plate — not just a static blacklist match. |
| **City-wide analytics** | Live density heatmap, congestion/bottleneck scoring per camera, origin-destination flow matrix, and average speed between camera pairs — all windowed against the data's own most recent timestamp (not the wall clock), so the numbers stay meaningful regardless of when the dashboard is viewed. |
| **OCR Preview** | Visualizes the detection pipeline frame-by-frame with bounding boxes and live OCR text burned in, for demoing/debugging without needing to interpret raw logs. |

---

## 3. How it works, end to end

```
[Camera feed / video file]
        │
        ▼
 ┌─────────────────────┐
 │  Ingestion Worker    │  reads a video file frame-by-frame
 └─────────┬────────────┘
           ▼
 ┌─────────────────────┐
 │  Plate Detector      │  YOLOv8 → finds plate bounding box
 └─────────┬────────────┘
           ▼
 ┌─────────────────────┐
 │  OCR + Validation    │  PaddleOCR reads characters; format/state-code
 │                      │  check + confusion correction filters garbage
 └─────────┬────────────┘
           ▼
 ┌─────────────────────┐
 │  Temporal Clustering │  merges multi-frame reads of one vehicle pass
 │                      │  into one confidence-weighted sighting
 └─────────┬────────────┘
           ▼
 ┌─────────────────────────────────────────────┐
 │  Event written to DB:                        │
 │  {plate, camera_id, lat, lng, ts, confidence} │
 └─────────┬─────────────────────────────────────┘
           ▼
   ┌───────┴────────────────┐
   ▼            ▼            ▼
Blacklist    Anomaly     Analytics
 check        check      aggregator
   │            │            │
   ▼            ▼            ▼
     Real-time WebSocket alert     Heatmap / OD matrix / congestion
   │            │            │
   └────────────┴────────────┘
                ▼
   ┌─────────────────────┐
   │  Web Dashboard (GIS) │  map, vehicle search + trajectory, alerts,
   │                      │  blacklist, analytics, OCR preview
   └─────────────────────┘
```

**The key idea that makes cameras stop working "solo":** every camera is registered with a fixed GPS coordinate. Every plate event is stamped with that camera's location + time. Reconstructing a vehicle's journey is: *fetch all events for plate X, sort by timestamp, connect the camera coordinates.* That's the Trajectory Reconstruction Engine — with an optional road-network layer on top that snaps the straight lines onto plausible actual roads.

---

## 4. What a working demo looks like (realistic scope for a hackathon)

You will not have access to a real city CCTV network, so the demo simulates it:
- **15 virtual cameras**, each pinned to a real, well-known Delhi traffic point (Connaught Place, ITO, AIIMS, Dhaula Kuan, Karol Bagh, Kashmere Gate ISBT, Nehru Place, Rajouri Garden, Akshardham, Rohini, India Gate, Lajpat Nagar, Vasant Vihar, Mayur Vihar, Saket).
- Each virtual camera is fed a pre-recorded traffic video instead of a live RTSP stream — the pipeline doesn't care where frames come from, but note: **live RTSP streaming is not implemented yet** (it's a scaffolded extension point, `RTSPSource`, that currently raises `NotImplementedError`). The working ingestion path is file-based.
- The rest of the system (detection → OCR → storage → dashboard → alerts → analytics) runs exactly as it would in production — same code path, real data.
- Some detections are genuinely read from real uploaded footage; some multi-camera trajectories are seeded with realistic timing/speed to demonstrate cross-camera tracking at hackathon scope, since a single real vehicle crossing five physical Delhi locations on camera wasn't obtainable. The reconstruction logic itself is real and works identically on real cross-camera data.

See `RUN.md` for exact setup and demo-walkthrough steps.

---

## 5. Repo structure

```
AankhoDekha/
├── backend/                    # FastAPI service
│   ├── anpr/                   # detection + OCR + pipeline
│   │   ├── frame_source.py     #   FrameSource (file works; RTSP stubbed)
│   │   ├── detector.py         #   YOLOv8 plate bounding-box detection
│   │   ├── ocr.py              #   PaddleOCR + format validation + confusion correction
│   │   └── pipeline.py         #   detector → OCR → temporal clustering → event
│   ├── api/                    # REST + WebSocket routes
│   │   ├── ingest.py           #   POST /ingest/{camera_id}, /ingest/upload
│   │   ├── vehicle.py          #   GET /vehicle/{plate}/history, /vehicles/search
│   │   ├── analytics.py        #   density, OD matrix, congestion, speed, summary
│   │   ├── alerts.py           #   WS /alerts, GET /alerts, /alerts/simulate
│   │   ├── alert_manager.py    #   WebSocket connection/broadcast manager
│   │   ├── blacklist.py        #   blacklist CRUD
│   │   ├── anomaly.py          #   route-anomaly (cloned-plate) detection
│   │   ├── preview.py          #   OCR Preview frame-by-frame rendering
│   │   └── routing.py          #   road-network routing (OSRM) for trajectory legs
│   ├── services/
│   │   └── routing.py          #   OSRM client + in-process route cache
│   ├── analytics/               # computation modules
│   │   ├── density.py
│   │   ├── od_matrix.py
│   │   ├── congestion.py
│   │   └── _time.py            #   shared "recent window" time anchor
│   ├── utils/
│   │   └── geo.py              #   haversine distance, bearing, compass label
│   └── db/
│       ├── base.py             #   async SQLAlchemy engine
│       ├── models.py           #   Camera, PlateEvent, Blacklist, Alert
│       └── init_db.py          #   create tables + migrations + seed from JSON
├── frontend/                    # React app
│   └── src/
│       ├── pages/               #   Dashboard, VehicleSearch, Analytics, AlertsView,
│       │                        #   BlacklistView, OCRPreview
│       ├── components/          #   Layout (top nav), MapView, Toast, RadarLoader,
│       │                        #   ErrorBoundary, StatCard
│       └── lib/                 #   api.ts, ws.tsx (WebSocket provider), cache.ts
├── scripts/
│   ├── ingest_videos.py         # CLI ingestion — processes all camera video files
│   ├── seed_demo.py             # seeds synthetic demo data
│   ├── list_detected_plates.py  # shows detected plates for blacklist selection
│   ├── load_blacklist.py        # loads blacklist.json into DB
│   └── compare_ocr.py           # standalone PaddleOCR vs EasyOCR accuracy comparison
├── training/
│   ├── merge_datasets.py        # merges Roboflow datasets for YOLOv8 fine-tuning
│   └── train_colab.py           # Colab fine-tuning script
├── data/
│   ├── cameras.json             # 15 Delhi camera definitions
│   ├── blacklist.json           # blacklisted plates
│   └── sample_videos/           # camera video files (cam_01.mp4 etc.)
├── models/                      # fine-tuned best.pt lives here
├── docker-compose.yml
├── .env.example
├── README.md
└── RUN.md
```

---

## 6. See also

- `RUN.md` — one-command startup, environment setup, and demo-walkthrough steps.

---

## 7. Tech stack

| Layer | Technology |
|---|---|
| Backend | FastAPI (Python 3.11, async), SQLAlchemy async, Uvicorn |
| Plate detection | YOLOv8 (Ultralytics), fine-tuned on Indian plate datasets |
| OCR | PaddleOCR |
| Database | SQLite (dev/demo) — PostgreSQL+PostGIS migration path built in for production |
| Real-time | Native FastAPI WebSocket, broadcast to all connected clients |
| Road-network routing | OSRM (public demo instance by default; swappable for self-hosted) |
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS |
| Maps | Leaflet.js + OpenStreetMap (no API key) |
| Charts | Recharts |
| Containers | Docker Compose |

**Offline status, precisely:** detection, OCR, alerting, blacklist matching, anomaly detection, and analytics are all fully offline with zero paid APIs. The one exception is the road-network route visualization (trajectory "Possible Routes" view), which calls a free public OSRM instance and therefore needs internet — this is called out explicitly rather than left as a hidden gap.

**Known, disclosed limitations:** no authentication/access-control layer yet (prototype stage); live RTSP camera streaming is scaffolded but not implemented (file-based ingestion works); two-wheeler and other small/angled-plate detection is a known weaker area under active improvement.

---

*Built with ❤️ for Smart India Hackathon 2026 by Team: The Underthinker*
