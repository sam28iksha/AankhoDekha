# NAGARNETRA — Run Guide
### Smart India Hackathon 2026 · Team: The Underthinker

---

## Prerequisites

- Docker Desktop (any recent version) with Compose V2 (`docker compose` not `docker-compose`)
- At least 8 GB RAM (PaddleOCR + YOLOv8 are memory-hungry at first load)
- Internet access for the first build (downloads Python packages + Paddle/YOLO model weights)
- Video files in `data/sample_videos/` (see "Providing Video Files" below)

---

## Quick Start (Recommended)

### 1. Clone & configure

```bash
git clone <your-repo-url>
cd NAGARNETRA
cp .env.example .env
# No edits required for local demo — defaults use SQLite, port 8000/5173
```

### 2. Drop in your video files

```
data/sample_videos/
  cam_01.mp4    ← Connaught Place footage
  cam_02.mp4    ← ITO footage
  cam_03.mp4    ← AIIMS footage
  cam_04.mp4    ← Dhaula Kuan footage
  cam_05.mp4    ← Karol Bagh footage
  cam_06.mp4    ← Kashmere Gate ISBT footage
  cam_07.mp4    ← Nehru Place footage
  cam_08.mp4    ← Rajouri Garden footage
  cam_09.mp4    ← Akshardham footage
  cam_10.mp4    ← Rohini footage
  cam_11.mp4    ← India Gate footage
  cam_12.mp4    ← Lajpat Nagar footage
```

> **Filename convention is the only convention.** Camera identity comes purely from the filename. `cam_03.mp4` → Camera cam_03 → "AIIMS" coordinates. You do not need real footage from AIIMS — any traffic video renamed `cam_03.mp4` works. See `SETUP_REQUIREMENTS.md` for where to download free traffic footage.

> **Trajectory demo requirement:** splice a few seconds of footage containing the *same license plate* into at least 2–3 different `cam_XX.mp4` files. This makes that plate appear at multiple cameras, enabling the full trajectory reconstruction demo. `DL01AB2345` is pre-seeded as a demo trajectory plate.

### 3. Seed demo data (run before first demo recording)

```bash
# Even without video files, this populates the DB with synthetic data
# so the dashboard shows traffic, analytics, and alerts immediately.
cd NAGARNETRA
pip install -r backend/requirements.txt  # if running seed script locally
python scripts/seed_demo.py
```

Or inside Docker after Step 4:

```bash
docker compose exec backend python /app/../scripts/seed_demo.py
```

### 4. Start everything

```bash
docker compose up --build
```

**First build takes 5–15 minutes** (downloading Python packages, YOLO weights, PaddleOCR models).
Subsequent starts: under 30 seconds.

### 5. Open the dashboard

| Service | URL |
|---|---|
| **Frontend (dashboard)** | http://localhost:5173 |
| **Backend API** | http://localhost:8000 |
| **API Docs (Swagger)** | http://localhost:8000/docs |

---

## Running Ingestion (Video → DB)

Once your video files are in `data/sample_videos/`, trigger ingestion:

**Option A — via API (any camera):**
```bash
curl -X POST http://localhost:8000/ingest/cam_01
curl -X POST http://localhost:8000/ingest/cam_02
# ... repeat for each camera
```

**Option B — CLI script (all cameras at once):**
```bash
# Run from project root with backend environment active
python scripts/ingest_videos.py

# Or with Docker:
docker compose exec backend python scripts/ingest_videos.py
```

**Option C — specific camera + debug options:**
```bash
python scripts/ingest_videos.py --camera cam_01 --sample-rate 3 --save-snapshots
```

Check ingestion progress:
```bash
curl http://localhost:8000/ingest/status
```

---

## Blacklist Workflow (Required for Live Alert Demo)

Run this workflow **after first ingestion** to set up reproducible live alerts:

### Step 1 — List what the system detected
```bash
python scripts/list_detected_plates.py
```

Output:
```
═══════════════════════════════════════════════════════════════════════
  NAGARNETRA — Detected Plates (sorted by sighting count)
═══════════════════════════════════════════════════════════════════════
  Rank  Plate          Sightings  Cameras  MaxConf  Last Seen
-----------------------------------------------------------------------
  ★1    DL01AB2345          12       3     94.2%   2026-08-31 14:23:11
   2    HR26DK4321           8       1     88.7%   2026-08-31 14:21:05
  ...
  ★ = plate seen at >1 camera — ideal for trajectory demo + blacklist alert
```

### Step 2 — Pick 3–4 plates

Recommended picks:
- **Pick ★ multi-camera plates** — these will fire alerts AND show trajectory
- **Pick the plate you spliced across multiple cam files** — so the blacklist alert fires while the vehicle is "moving" across Delhi

### Step 3 — Edit `data/blacklist.json`

Replace the placeholder entries with your real picks:

```json
{
  "plates": [
    {
      "plate_number": "DL01AB2345",
      "reason": "Stolen vehicle — FIR #DL2026-00891",
      "added_at": "2026-08-31T00:00:00Z"
    },
    {
      "plate_number": "HR26DK4321",
      "reason": "Suspected criminal activity",
      "added_at": "2026-08-31T00:00:00Z"
    }
  ]
}
```

### Step 4 — Load into DB

```bash
python scripts/load_blacklist.py
# or:
docker compose exec backend python scripts/load_blacklist.py
```

### Step 5 — Re-run ingestion

```bash
python scripts/ingest_videos.py
# Blacklist hits will now fire alerts in real-time and appear in the dashboard
```

---

## Manual (Non-Docker) Setup

If Docker is unavailable:

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Copy and configure env
cp ../.env.example ../.env

# Start backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend

```bash
cd frontend
npm install --legacy-peer-deps

# Set API URL
echo "VITE_API_URL=http://localhost:8000" > .env
echo "VITE_WS_URL=ws://localhost:8000" >> .env

npm run dev
```

### Seed data (non-Docker)

```bash
cd NAGARNETRA   # project root
python scripts/seed_demo.py
```

---

## Using PostgreSQL Instead of SQLite

If you want to run with PostgreSQL + PostGIS:

```bash
# Start the db profile in Docker Compose
docker compose --profile postgres up --build

# In .env, change:
DB_MODE=postgres
DATABASE_URL=postgresql+asyncpg://nagarnetra:nagarnetra_pass@localhost:5432/nagarnetra
```

---

## Demo Recording Checklist

- [ ] `docker compose up --build` completed without errors
- [ ] Dashboard opens at http://localhost:5173
- [ ] 12 camera markers visible on Delhi map
- [ ] `python scripts/seed_demo.py` run — stats show traffic data
- [ ] Video files in `data/sample_videos/`, ingestion run
- [ ] Blacklist workflow complete — test plate fires alert in dashboard
- [ ] Vehicle Search → search `DL01AB2345` → trajectory polyline appears on map
- [ ] Analytics tab — density chart, OD flows, congestion table populated
- [ ] Alerts tab — blacklist hits visible with camera name and timestamp

---

*Good luck with the demo! 🚀*
