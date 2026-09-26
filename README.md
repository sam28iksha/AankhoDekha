# AankhoDekha — Multi-Camera ANPR & Traffic Intelligence Platform

### Smart India Hackathon 2026 · Team: The Underthinker

*Aankhon (eyes) + Dekha (seen) — "aankhon dekha," a Hindi idiom for an eyewitness account: seen firsthand, not told secondhand.*

> **AankhoDekha** is a multi-camera Automatic Number Plate Recognition (ANPR) and traffic intelligence platform that transforms independent camera observations into a unified, searchable view of vehicle movement across a city.

---

## 🚀 Live Prototype

*🎥 Demo Video:* [Watch the AankhoDekha Demo on YouTube]https://youtu.be/wvSjrwR0wNw?si=nLNq-PNcOxDCLl3P

**Live Demo:** http://54.146.92.165


The application is deployed on **AWS EC2** using Docker Compose.

> The EC2 instance must be running for the live demo to be accessible.

---

# 1. What Problem This Solves

Cities operate large networks of CCTV and ANPR cameras, but individual cameras typically observe vehicles independently.

A camera may detect a vehicle and record its number plate, but by itself it cannot answer questions such as:

- Where was this vehicle seen previously?
- Which cameras detected it?
- How long did it take to travel between cameras?
- What route could it have taken?
- Is the same plate appearing at physically impossible locations?
- Where are traffic bottlenecks forming?
- How are vehicles flowing between different parts of the city?

AankhoDekha connects these independent observations into a unified vehicle intelligence system.

The platform:

- Detects Indian vehicle number plates.
- Performs OCR on detected plates.
- Validates OCR results against Indian plate formats and RTO state codes.
- Consolidates repeated detections from consecutive video frames.
- Stores vehicle sightings with camera location and timestamp.
- Reconstructs cross-camera vehicle trajectories.
- Detects potentially cloned/duplicated plates using physically impossible travel speeds.
- Generates real-time blacklist and anomaly alerts.
- Provides city-wide traffic analytics.
- Visualizes vehicle movement through a GIS dashboard.

---

# 2. Core Capabilities

| Capability | Implementation |
|---|---|
| **License Plate Detection** | Fine-tuned YOLOv8 model detects vehicle number plate bounding boxes. |
| **License Plate OCR** | PaddleOCR extracts characters from detected plate regions. |
| **Indian Plate Validation** | Validates recognized plates against Indian registration formats, including standard and BH-series formats. |
| **OCR Error Correction** | Position-aware correction handles common OCR confusions such as `0/O`, `1/I`, `5/S`, `8/B`, and `2/Z`. |
| **Temporal Clustering** | Multiple detections of the same vehicle across nearby frames are grouped into a single vehicle sighting. |
| **Confidence-Weighted Recognition** | Repeated OCR results are merged using confidence-weighted, per-character voting. |
| **Cross-Camera Tracking** | Vehicle sightings are reconstructed using plate number, camera ID, GPS coordinates, and timestamps. |
| **Trajectory Reconstruction** | Calculates camera-to-camera movement, direction, inter-camera timing, and speed per leg. |
| **Road-Network Routing** | Optional OSRM-based routing maps possible vehicle movement onto plausible road networks. |
| **Blacklist Detection** | Every persisted plate event is checked against the blacklist. |
| **Real-Time Alerts** | WebSocket-based alerts are pushed to connected dashboards. |
| **Cloned-Plate Detection** | Flags plates whose implied travel speed between cameras exceeds a configurable physical threshold. |
| **Traffic Density** | Computes camera-level traffic density over recent data windows. |
| **Congestion Analysis** | Identifies potential traffic bottlenecks using camera-level traffic metrics. |
| **Origin-Destination Analysis** | Builds vehicle flow relationships between camera locations. |
| **Average Speed Analysis** | Calculates average vehicle speed between camera pairs. |
| **OCR Preview** | Provides frame-by-frame visualization of plate detection and OCR results, synced to playback position. |
| **RBAC** | JWT authentication with `admin`, `investigator`, and `viewer` roles. |
| **Audit Logging** | Sensitive actions such as blacklist and user-management operations are recorded. |
| **Pipeline Telemetry** | Tracks processing metrics such as frames processed, OCR attempts, successful reads, events persisted, alerts, and processing latency. |

---

# 3. System Architecture

```text
                         ┌─────────────────────┐
                         │ Camera Feed / Video │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │  Ingestion Worker   │
                         │ Frame-by-frame read │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │    YOLOv8 Detector  │
                         │ Plate Bounding Box  │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │   PaddleOCR +       │
                         │   Validation        │
                         │                     │
                         │ Format validation   │
                         │ State-code checks   │
                         │ OCR correction      │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │ Temporal Clustering │
                         │                     │
                         │ Multi-frame reads   │
                         │ → One clean event   │
                         └──────────┬──────────┘
                                    │
                                    ▼
                  ┌──────────────────────────────────┐
                  │          PostgreSQL + PostGIS    │
                  │                                  │
                  │ plate                            │
                  │ camera_id                        │
                  │ GPS coordinates                  │
                  │ timestamp                        │
                  │ confidence                        │
                  └───────────────┬──────────────────┘
                                  │
                 ┌────────────────┼────────────────┐
                 │                │                │
                 ▼                ▼                ▼
          ┌────────────┐   ┌────────────┐   ┌────────────┐
          │ Blacklist  │   │  Anomaly   │   │ Analytics  │
          │   Check    │   │ Detection  │   │  Engine    │
          └─────┬──────┘   └─────┬──────┘   └─────┬──────┘
                │                │                │
                └────────────────┼────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
             WebSocket Alerts          Traffic Analytics
                    │                  Heatmap / OD /
                    │                  Congestion / Speed
                    │                         │
                    └────────────┬────────────┘
                                 ▼
                    ┌─────────────────────────┐
                    │    React GIS Dashboard  │
                    │                         │
                    │ Vehicle Search          │
                    │ Trajectories            │
                    │ Alerts                  │
                    │ Blacklist               │
                    │ Analytics               │
                    │ OCR Preview             │
                    │ Audit Logs              │
                    └─────────────────────────┘
```

### Key architectural idea

Every camera is registered with a fixed GPS coordinate.

Every accepted plate event contains:

```text
{
    plate,
    camera_id,
    latitude,
    longitude,
    timestamp,
    confidence
}
```

A vehicle's journey can therefore be reconstructed by:

1. Fetching all events associated with a plate.
2. Ordering them chronologically.
3. Connecting the corresponding camera locations.
4. Calculating inter-camera distance and time.
5. Deriving direction and estimated travel speed.
6. Optionally mapping the movement onto a road network using OSRM.

This transforms independent camera detections into a city-wide vehicle trajectory.

---

# 4. ANPR Pipeline

```text
Video Frame
     │
     ▼
YOLOv8 Plate Detection
     │
     ▼
Crop Detected Plate
     │
     ▼
PaddleOCR
     │
     ▼
Indian Plate Format Validation
     │
     ├── Invalid → Discard
     │
     └── Valid
           │
           ▼
     OCR Correction
           │
           ▼
    Temporal Clustering
           │
           ▼
 Confidence-Weighted Merge
           │
           ▼
      Plate Event
           │
           ▼
 PostgreSQL/PostGIS
```

The system intentionally avoids treating every video frame as an independent vehicle sighting.

A single vehicle may appear across dozens of consecutive frames. Temporal clustering groups these repeated observations and produces a consolidated event.

---

# 5. GPU / CUDA Acceleration

The ANPR pipeline is computationally expensive because object detection and OCR inference operate on every sampled video frame.

The detector selects its execution device at runtime (`"cuda" if torch.cuda.is_available() else "cpu"`), so the same code path runs on either — no separate GPU/CPU build.

### Development environment

Development and local testing were done on a machine with:

* **NVIDIA GeForce RTX 4060 Laptop GPU**
* **8 GB VRAM**
* **3,072 CUDA cores**

with CUDA-accelerated PyTorch/Ultralytics inference.

### Production deployment (AWS EC2)

The live prototype above runs on a `t3.large` EC2 instance, which has **no attached GPU** — it runs the identical pipeline on CPU. This is a deliberate, disclosed tradeoff rather than an oversight: hackathon-budget cloud GPU instances are significantly more expensive, and CPU inference is correct, just slower per frame than on the RTX 4060 used during development. Detection accuracy and OCR results are identical either way — only throughput differs.

### Engineering considerations

Supporting both paths (not just flipping a device flag) required attention to:

* CUDA availability detection.
* Model/device placement.
* GPU memory usage.
* CPU ↔ GPU data movement.
* Multiple-video processing behavior.
* Native ML library (PyTorch, PaddlePaddle) stability across both environments.
* Resource contention during concurrent inference.

> **Wording note:** CUDA cores are a hardware resource provided by the NVIDIA GPU itself. What was built here is CUDA-*accelerated inference* — device-aware model execution using CUDA-enabled libraries — not "CUDA cores" as a piece of software.

---

# 6. Cross-Camera Trajectory Reconstruction

For every accepted detection, the system stores:

```text
plate
camera_id
latitude
longitude
timestamp
confidence
```

For a searched vehicle:

```text
Camera A
   │
   │ timestamp + GPS
   ▼
Camera B
   │
   │ timestamp + GPS
   ▼
Camera C
   │
   ▼
Camera D
```

The system derives:

* Detection sequence
* Direction of movement
* Distance between cameras
* Time between sightings
* Estimated speed
* Possible route between cameras

Two visualization modes are supported:

### Direct trajectory

Connects camera coordinates directly.

### Road-network trajectory

Uses OSRM to map the movement onto plausible roads and display alternate routes where applicable.

---

# 7. Cloned / Duplicated Plate Detection

AankhoDekha uses spatial and temporal information to identify suspicious plate movement.

If the same plate is detected at two cameras:

```text
Camera A
   │
   │ distance = X km
   │ time = Y seconds
   ▼
Camera B
```

The system calculates the implied travel speed.

If:

```text
implied_speed > configured_threshold
```

the event is flagged as a potential cloned/duplicated plate.

The default threshold is:

```text
120 km/h
```

and is configurable.

This is different from a conventional blacklist check: the plate does not need to be blacklisted to trigger the anomaly detector.

---

# 8. Real-Time Alerting

Plate events are evaluated when they are persisted.

If a detected plate matches the blacklist:

```text
Plate Detection
      │
      ▼
Blacklist Check
      │
      ├── No Match → Normal Event
      │
      └── Match
           │
           ▼
      Alert Manager
           │
           ▼
       WebSocket
           │
           ▼
   Connected Dashboards
           │
           ▼
    Real-Time Alert
```

Alerts are explicitly classified as:

* `detection` — generated from an actual detection event
* `simulated` — explicitly triggered for demonstration/testing

This distinction is maintained so that demo-generated alerts are not presented as real detections.

---

# 9. City-Wide Traffic Analytics

The platform provides:

### Traffic Density

Visualizes vehicle activity around camera locations.

### Congestion / Bottleneck Analysis

Identifies camera locations experiencing elevated traffic activity.

### Origin-Destination Matrix

Shows vehicle movement between camera locations.

### Average Speed

Calculates average travel speed between camera pairs using detection timestamps and geographic distance.

### Time Windowing

Analytics are anchored against the most recent timestamp available in the dataset rather than blindly relying on the current wall-clock time.

This allows historical/demo datasets to remain meaningful when the dashboard is viewed later.

---

# 10. Demo Environment

A real city-wide CCTV network is not available for the hackathon demonstration, so the system uses a controlled simulation.

### 15 Virtual Cameras

The demo contains 15 virtual cameras mapped to real Delhi traffic locations:

1. Connaught Place
2. ITO
3. AIIMS
4. Dhaula Kuan
5. Karol Bagh
6. Kashmere Gate ISBT
7. Nehru Place
8. Rajouri Garden
9. Akshardham
10. Rohini
11. India Gate
12. Lajpat Nagar
13. Vasant Vihar
14. Mayur Vihar
15. Saket

Each virtual camera is associated with:

* Camera ID
* GPS coordinates
* Traffic video source

### Current Ingestion Mode

The working ingestion path is:

```text
Video File
    ↓
Frame Extraction
    ↓
ANPR Pipeline
```

Live RTSP ingestion is scaffolded through `RTSPSource`, but live RTSP streaming is **not currently implemented**.

Some multi-camera trajectories are seeded with realistic timing/speed for demonstration purposes because a single real vehicle physically crossing multiple Delhi locations was not available.

The underlying trajectory reconstruction logic operates on the same camera-event structure used for real cross-camera data.

---

# 11. Demo Flow

A typical demonstration can follow this sequence:

```text
Landing Page
     ↓
Authentication
     ↓
Dashboard
     ↓
Camera / Vehicle Activity
     ↓
Vehicle Search
     ↓
Cross-Camera Trajectory
     ↓
Blacklist / Anomaly Alert
     ↓
Traffic Analytics
     ↓
OCR Preview
```

### Suggested demonstration sequence

1. Open the live prototype.
2. Authenticate using a demo account.
3. Open the dashboard.
4. Inspect camera activity.
5. Search for a detected vehicle.
6. View its historical sightings.
7. Inspect the reconstructed trajectory.
8. Demonstrate blacklist/anomaly alerting.
9. Open the analytics dashboard.
10. Inspect OCR Preview to show the underlying detection pipeline.

See [`RUN.md`](RUN.md) for complete setup and demonstration instructions.

---

# 12. Role-Based Access Control

AankhoDekha uses JWT-based authentication and role-based authorization.

### Roles

| Role           | Purpose                                                              |
| -------------- | -------------------------------------------------------------------- |
| `admin`        | Full administrative access, user management and sensitive operations |
| `investigator` | Vehicle investigation, search, blacklist and investigation workflows |
| `viewer`       | Read-only access to supported dashboard functionality                |

Sensitive actions are recorded in the audit log.

Examples include:

* Blacklist modifications
* User management
* Other protected administrative operations

---

# 13. Pipeline Telemetry

The backend exposes live pipeline telemetry through:

```text
GET /health/metrics
```

Tracked metrics include:

* Frames processed
* Plates detected
* OCR attempts
* OCR successes / success rate
* Accepted read confidence
* Events persisted
* Active/unresolved alerts
* Connected WebSocket clients
* Per-stage latency (detection, OCR, event persistence, full pipeline)

These metrics help distinguish:

```text
Detection
   ↓
OCR
   ↓
Validation
   ↓
Persistence
   ↓
Alerting
```

and make it possible to inspect where processing time or failures occur.

---

# 14. Repository Structure

```text
AankhoDekha/
│
├── backend/
│   ├── anpr/
│   │   ├── frame_source.py       # FrameSource abstraction; file ingestion
│   │   ├── detector.py           # YOLOv8 plate + vehicle detection (CUDA/CPU)
│   │   ├── ocr.py                # PaddleOCR + validation + correction
│   │   └── pipeline.py           # Detection → OCR → clustering → event
│   │
│   ├── api/
│   │   ├── ingest.py             # Video ingestion endpoints
│   │   ├── vehicle.py            # Vehicle search/history
│   │   ├── analytics.py          # Density, OD, congestion, speed
│   │   ├── alerts.py             # Alerts + WebSocket endpoints
│   │   ├── alert_manager.py      # WebSocket connection/broadcast manager
│   │   ├── blacklist.py          # Blacklist CRUD
│   │   ├── anomaly.py            # Cloned-plate anomaly detection
│   │   ├── preview.py            # OCR preview frame rendering
│   │   ├── routing.py            # OSRM route generation
│   │   ├── auth.py               # POST /auth/login (JWT issuance)
│   │   ├── audit.py              # Audit log listing
│   │   └── health.py             # Health + pipeline telemetry
│   │
│   ├── auth/
│   │   ├── security.py           # bcrypt password hashing + JWT encode/decode
│   │   ├── dependencies.py       # get_current_user / require_role(...) guards
│   │   └── audit.py              # log_action() — audit logging helper
│   │
│   ├── alembic/                  # PostgreSQL schema migrations
│   │
│   ├── services/
│   │   └── routing.py            # OSRM client + in-process route cache
│   │
│   ├── analytics/
│   │   ├── density.py            # Traffic density
│   │   ├── od_matrix.py          # Origin-destination analysis
│   │   ├── congestion.py         # Congestion/bottleneck analysis
│   │   └── _time.py              # Shared recent-window time anchor
│   │
│   ├── utils/
│   │   ├── geo.py                # Distance, bearing, compass direction
│   │   └── metrics.py            # In-process pipeline telemetry
│   │
│   ├── db/
│   │   ├── base.py               # Async SQLAlchemy engine
│   │   ├── models.py             # Camera, PlateEvent, Blacklist, Alert, User, AuditLog
│   │   └── init_db.py            # DB init + migrations + camera/admin seeding
│   │
│   ├── Dockerfile
│   ├── main.py
│   └── requirements.txt
│
├── frontend/
│   └── src/
│       ├── pages/
│       │   ├── Landing              # Public entry point (embeds login)
│       │   ├── Dashboard
│       │   ├── VehicleSearch
│       │   ├── Analytics
│       │   ├── AlertsView
│       │   ├── BlacklistView
│       │   ├── OCRPreview
│       │   ├── AuditLog
│       │   ├── UserManagement
│       │   └── NotFound
│       │
│       ├── components/
│       │   ├── Layout               # Sidebar navigation shell
│       │   ├── MapView               # Leaflet/MapLibre GIS map
│       │   ├── Toast
│       │   ├── RadarLoader
│       │   ├── ErrorBoundary
│       │   ├── StatCard
│       │   ├── TrafficSimulation     # Client-side live-traffic canvas layer
│       │   ├── CitySkylinePanel
│       │   └── Logomark
│       │
│       ├── components/landing/
│       │   ├── LandingHero
│       │   ├── LandingLoginPanel
│       │   ├── LandingNav
│       │   ├── PipelineDiagram
│       │   ├── ProblemGrid
│       │   └── TrajectoryVisualization
│       │
│       └── lib/
│           ├── api.ts
│           ├── auth.tsx
│           ├── ws.tsx
│           └── cache.ts
│
├── scripts/
│   ├── ingest_videos.py           # CLI ingestion — processes camera videos
│   ├── seed_demo.py               # Seeds synthetic demo data
│   ├── list_detected_plates.py    # Lists detected plates for blacklist selection
│   ├── load_blacklist.py          # Loads blacklist.json into DB
│   └── compare_ocr.py             # PaddleOCR vs EasyOCR accuracy comparison
│
├── training/
│   ├── merge_datasets.py          # Merges Roboflow datasets for fine-tuning
│   └── train_colab.py             # Colab / CUDA fine-tuning script
│
├── data/
│   ├── cameras.json               # 15 Delhi camera definitions
│   ├── blacklist.json             # Blacklisted plates
│   └── sample_videos/             # Camera video files (cam_01.mp4, cam_02.mp4, ...)
│
├── models/
│   ├── best.pt                    # Fine-tuned plate detector
│   └── yolov8n.pt                 # Generic COCO vehicle-type detector
│
├── docker-compose.yml
├── .env.example
├── README.md
└── RUN.md
```

---

# 15. Technology Stack

| Layer                          | Technology                                              |
| ------------------------------ | ------------------------------------------------------- |
| **Backend**                    | FastAPI, Python 3.11, Uvicorn                            |
| **Async Database Access**      | SQLAlchemy Async                                         |
| **Database**                   | PostgreSQL (default) / SQLite (zero-setup local demo)    |
| **Geospatial Database**        | PostGIS + GeoAlchemy2                                    |
| **Migrations**                 | Alembic                                                  |
| **Plate Detection**            | YOLOv8 / Ultralytics (fine-tuned) + generic COCO vehicle model |
| **OCR**                        | PaddleOCR                                                |
| **GPU Acceleration**           | CUDA-accelerated inference (device-aware; CPU fallback)  |
| **Development GPU**            | NVIDIA RTX 4060 Laptop GPU, 8 GB VRAM, 3,072 CUDA cores   |
| **Production deployment GPU**  | None — AWS EC2 `t3.large` runs the same pipeline on CPU  |
| **Authentication**             | JWT                                                      |
| **Password Hashing**           | bcrypt                                                   |
| **Authorization**              | Role-Based Access Control (`admin`/`investigator`/`viewer`) |
| **Real-Time Communication**    | FastAPI WebSockets                                       |
| **Road Routing**               | OSRM (public instance by default)                        |
| **Frontend**                   | React 18 + TypeScript                                    |
| **Build Tool**                 | Vite                                                      |
| **Styling**                    | Tailwind CSS                                              |
| **Maps**                       | Leaflet + MapLibre GL                                    |
| **Map Tiles**                  | MapTiler (vector tiles, India-compliant boundary data)   |
| **Charts**                     | Recharts                                                  |
| **Containerization**           | Docker Compose                                            |
| **Cloud Deployment**           | AWS EC2                                                   |
| **Web Server / Reverse Proxy** | Nginx                                                     |

---

# 16. Database Model

The core PostgreSQL/PostGIS data model includes:

```text
Camera
   │
   └── GPS location (PostGIS Geometry)

PlateEvent
   ├── plate
   ├── camera_id
   ├── timestamp
   ├── confidence
   └── geographic information

Blacklist
   └── plate

Alert
   ├── event
   ├── type
   └── timestamp

User
   ├── username
   ├── password_hash (bcrypt)
   ├── role (admin | investigator | viewer)
   └── is_active

AuditLog
   ├── user_id / username
   ├── action
   └── timestamp
```

PostGIS is used for geographic data and spatial operations rather than treating location exclusively as ordinary latitude/longitude fields.

SQLite mode is also supported for a zero-setup local demonstration environment.

---

# 17. Deployment

The application is containerized using Docker Compose, with three services: frontend, backend, and database.

```text
                          AWS EC2
                             │
                             ▼
                  ┌────────────────────┐
                  │  Nginx (frontend    │
                  │  container)         │
                  │                     │
                  │  serves the built   │
                  │  React app, and     │
                  │  reverse-proxies:   │
                  │   /api/*  → backend │
                  │   /alerts → backend │
                  │            (WS)     │
                  └──────────┬──────────┘
                             │
                             ▼
                  ┌────────────────────┐
                  │  FastAPI Backend    │
                  │  (Uvicorn)          │
                  │                     │
                  │  ANPR pipeline      │
                  │  (YOLOv8+PaddleOCR) │
                  └──────────┬──────────┘
                             │
                             ▼
                  ┌────────────────────┐
                  │ PostgreSQL/PostGIS │
                  └────────────────────┘
```

The deployment uses:

* AWS EC2 (`t3.large`, CPU-only) with a static Elastic IP
* Docker Compose (three containers: nginx+frontend, backend, PostGIS database)
* GPU-accelerated ML inference in development; CPU inference in this cloud deployment (see [Section 5](#5-gpu--cuda-acceleration))

---

# 18. Offline / External Service Status

The core ANPR and analytics pipeline is designed to operate without paid AI APIs.

### Works offline

* Plate detection
* OCR
* OCR validation
* OCR correction
* Temporal clustering
* Blacklist matching
* Anomaly detection
* Traffic analytics
* Database operations
* Alert generation

### Requires Internet

Two components currently depend on external services:

1. **OSRM**

   * Used for road-network route visualization.
   * Uses a free public OSRM instance by default.
   * Can be replaced with a self-hosted OSRM deployment.

2. **MapTiler**

   * Used for map tile/vector map visualization.
   * Uses the configured free tier.

The core ML pipeline does not depend on a paid cloud AI API.

---

# 19. Known Limitations

The project deliberately documents its current boundaries.

### Live RTSP Camera Streaming

RTSP ingestion is scaffolded but not currently implemented.

The working ingestion path is file-based.

```text
Video File → FrameSource → ANPR Pipeline
```

rather than:

```text
RTSP Camera → RTSPSource → ANPR Pipeline
```

### Two-Wheeler / Difficult Plates

Two-wheelers and small, heavily angled, occluded, or low-resolution plates remain a weaker detection scenario and are an area for future improvement.

### No GPU in the cloud deployment

The live AWS demo runs CPU-only (see [Section 5](#5-gpu--cuda-acceleration)) — inference is correct but slower per frame than the RTX 4060 used in development.

### Hackathon Simulation

The demo uses 15 virtual cameras and prerecorded videos rather than a real city CCTV network.

Some cross-camera trajectories are seeded with realistic timing/speed for demonstration because the required real-world multi-camera footage was unavailable.

---

# 20. Future Extensions

Potential extensions include:

* Live RTSP camera ingestion
* GPU-backed cloud deployment for faster processing
* Multi-GPU inference
* More robust multi-camera vehicle re-identification
* Improved two-wheeler plate detection
* Distributed ingestion workers
* Kubernetes-based deployment
* Horizontal inference scaling
* Centralized observability
* Self-hosted OSRM
* Larger city-scale camera networks
* Long-term traffic forecasting
* More advanced anomaly detection

---

# 21. Engineering Focus

AankhoDekha was developed around several engineering principles:

### Correctness over demo-only behavior

The system distinguishes real detections from simulated demonstration data.

### Explainable pipeline

Every stage of the pipeline can be inspected:

```text
Frame
 ↓
Detection
 ↓
OCR
 ↓
Validation
 ↓
Temporal Clustering
 ↓
Database Event
 ↓
Alert / Analytics
```

### Failure awareness

The system exposes processing telemetry and documents known limitations rather than hiding them.

### Reproducible deployment

The application is containerized with Docker Compose and deployed on AWS EC2.

### Device-aware inference

Model execution is written to use NVIDIA CUDA acceleration where available (development), and falls back correctly to CPU where it isn't (this cloud deployment) — same code, same results, different speed.

---

# 22. See Also

* [`RUN.md`](RUN.md) — environment setup, startup instructions and demo walkthrough.
* `docker-compose.yml` — container orchestration.
* `training/` — dataset preparation and model fine-tuning.
* `scripts/` — ingestion, demo seeding and utility scripts.

---

# 23. Team

**Team: The Underthinker**

Built for:

**Smart India Hackathon 2026**

---

*Built with ❤️ for Smart India Hackathon 2026 by Team: The Underthinker.*
