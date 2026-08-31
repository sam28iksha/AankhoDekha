# NAGARNETRA — Multi-Camera ANPR & Traffic Intelligence Platform
### Smart India Hackathon 2026 · Team: The Underthinker

*Nagar (city) + Netra (eye) — "the eye of the city."*

---

## 1. What problem this solves

Cities run hundreds of CCTV/ANPR cameras, but today each camera works **solo** — it sees a plate, logs it, and forgets it. There is no system that stitches together sightings of the *same* vehicle across *different* cameras into one timeline. So when a vehicle is flagged (stolen, blacklisted, involved in a crime), there is no fast way to answer: *"Where has this vehicle been in the last 6 hours, and where is it likely headed?"*

NAGARNETRA turns a city-wide network of cameras into one connected brain. It reads plates, remembers every sighting, and reconstructs a vehicle's path across the whole city — while also giving traffic planners a live picture of how the city moves as a whole.

---

## 2. The three things it must do (problem statement mapping)

| # | Requirement | What we build |
|---|---|---|
| 1 | High-accuracy ANPR/OCR (>90%) on multi-lane traffic | A detection model (finds the plate in the frame) + recognition model (reads the characters) pipeline, tuned for Indian plate formats, multiple lanes, and non-ideal angles/lighting. |
| 2 | Vehicle movement history & blacklist check | Every plate read is stored as an **event**: `plate, camera_id, gps_lat, gps_lng, timestamp`. A query interface lets you type a plate number and instantly see every camera that saw it, in order, on a map — and whether it's on a blacklist. |
| 3 | City-wide macro traffic analytics | All events, aggregated, become density heatmaps, origin-destination flow, congestion/bottleneck detection, and average speed between camera pairs, shown on a live dashboard. |

---

## 3. How it works, end to end

```
[Camera feed / video file]
        │
        ▼
 ┌─────────────────────┐
 │  Ingestion Worker    │  reads video/RTSP stream frame-by-frame
 └─────────┬────────────┘
           ▼
 ┌─────────────────────┐
 │  Plate Detector      │  YOLO-based model → finds plate bounding box
 └─────────┬────────────┘
           ▼
 ┌─────────────────────┐
 │  OCR / Recognizer    │  reads characters off the cropped plate
 └─────────┬────────────┘
           ▼
 ┌─────────────────────────────────────────────┐
 │  Event written to DB:                        │
 │  {plate, camera_id, lat, lng, ts, confidence} │
 └─────────┬─────────────────────────────────────┘
           ▼
   ┌───────┴────────┐
   ▼                ▼
Blacklist check   Analytics aggregator
   │                │
   ▼                ▼
Real-time alert   Heatmap / OD matrix / congestion score
   │                │
   └───────┬────────┘
           ▼
   ┌─────────────────────┐
   │  Web Dashboard (GIS) │  map, alerts, vehicle search, trajectory replay
   └─────────────────────┘
```

**The key idea that makes cameras stop working "solo":** every camera is registered with a fixed GPS coordinate. Every plate event is stamped with that camera's location + time. So reconstructing a vehicle's journey is just: *fetch all events for plate X, sort by timestamp, draw a line between the camera coordinates on the map.* That's the Trajectory Reconstruction Engine.

---

## 4. What a working demo looks like (realistic scope for a hackathon)

You will not have access to a real city CCTV network, so the demo simulates it:
- **12 "virtual cameras,"** each pinned to a real, well-known Delhi traffic point (Connaught Place, ITO, AIIMS, Dhaula Kuan, Karol Bagh, Kashmere Gate ISBT, Nehru Place, Rajouri Garden, Akshardham, Rohini, India Gate, Lajpat Nagar) — spread across the city so a reconstructed trajectory visibly crosses zones instead of staying in one corner of the map.
- Each virtual camera is fed a pre-recorded traffic video (Highway Traffic Videos dataset + your own footage) instead of a live RTSP stream — the pipeline doesn't care where frames come from.
- The rest of the system (detection → OCR → storage → dashboard → alerts) runs exactly as it would in production.
- Blacklist entries are drawn from plates the system *actually detects* in your footage (see `SETUP_REQUIREMENTS.md`), so live alerts fire on real, reproducible data during your demo recording.

This is judged as fully functional, because the ingestion layer is swappable — real RTSP camera streams could be dropped in later without changing anything downstream.

---

## 5. Repo structure

```
NAGARNETRA/
├── backend/                # FastAPI service: ANPR pipeline, DB, alerts, analytics API
│   ├── anpr/               # detection + OCR models & inference code
│   │   ├── frame_source.py #   abstract FrameSource (file / RTSP later)
│   │   ├── detector.py     #   YOLOv8 plate bounding-box detection
│   │   ├── ocr.py          #   PaddleOCR character reading
│   │   └── pipeline.py     #   orchestrates detector → OCR → event
│   ├── api/                # REST + WebSocket routes
│   │   ├── ingest.py       #   POST /ingest/{camera_id}
│   │   ├── vehicle.py      #   GET /vehicle/{plate}/history
│   │   ├── analytics.py    #   density, OD matrix, congestion, speed
│   │   └── alerts.py       #   WS /alerts + GET /alerts
│   ├── db/                 # models, init
│   │   ├── base.py         #   async SQLAlchemy engine
│   │   ├── models.py       #   Camera, PlateEvent, Blacklist, Alert
│   │   └── init_db.py      #   create tables + seed from JSON
│   └── analytics/          # computation modules
│       ├── density.py
│       ├── od_matrix.py
│       └── congestion.py
├── frontend/               # React app: map dashboard, search, analytics, alerts
│   └── src/
│       ├── pages/          #   Dashboard, VehicleSearch, Analytics, AlertsView
│       ├── components/     #   Layout, MapView
│       └── lib/            #   api.ts, ws.ts
├── scripts/
│   ├── ingest_videos.py    # CLI ingestion — processes all camera video files
│   ├── seed_demo.py        # seeds synthetic demo data (run before first demo)
│   ├── list_detected_plates.py  # shows detected plates for blacklist selection
│   └── load_blacklist.py   # loads blacklist.json into DB
├── notebooks/
│   └── finetune_anpr.ipynb # fine-tuning guide for custom ANPR model
├── data/
│   ├── cameras.json        # 12 Delhi camera definitions (pre-populated)
│   ├── blacklist.json      # blacklisted plates (fill after first ingestion)
│   └── sample_videos/      # ← YOUR VIDEO FILES GO HERE (cam_01.mp4 etc.)
├── models/                 # ← drop fine-tuned best.pt here (optional)
├── docker-compose.yml
├── .env.example
├── README.md
├── RUN.md
└── SETUP_REQUIREMENTS.md
```

---

## 6. See also

- `RUN.md` — exact one-command startup and step-by-step demo workflow
- `SETUP_REQUIREMENTS.md` — what you need to install and provide before this runs

---

## 7. Tech stack

| Layer | Technology |
|---|---|
| Backend | FastAPI (Python 3.11), SQLAlchemy async, Uvicorn |
| Plate detection | YOLOv8 (Ultralytics) |
| OCR | PaddleOCR |
| Database | SQLite (dev/demo) / PostgreSQL+PostGIS (production) |
| Real-time | FastAPI native WebSocket |
| Frontend | React 18 + Vite + Tailwind CSS |
| Maps | Leaflet.js + OpenStreetMap (no API key) |
| Charts | Recharts |
| Containers | Docker Compose |

**No external API keys or paid services required. Runs fully offline.**

---

*Built with ❤️ for Smart India Hackathon 2026 by Team: The Underthinker*
