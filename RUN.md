# RUN.md — NAGARNETRA setup & demo walkthrough

## 1. Prerequisites

- Docker + Docker Compose
- That's it — no local Python/Node install needed, everything runs in containers.

## 2. First-time setup

```bash
cp .env.example .env
```

Defaults in `.env.example` work out of the box (SQLite, no external DB needed). Only change values if you know you need to (e.g. switching to PostgreSQL, changing ports).

Optional: drop a fine-tuned YOLOv8 checkpoint at `models/best.pt`. If absent, the detector falls back to a HuggingFace-hosted generic plate model, then to generic COCO weights (lower accuracy) — see `backend/anpr/detector.py` for the exact fallback order.

Camera video files go in `data/sample_videos/`, named to match each camera's ID in `data/cameras.json` (e.g. `cam_01.mp4`).

## 3. Start everything

```bash
docker compose build
docker compose up -d
```

- Backend: http://localhost:8000 (health check: `GET /health`)
- Frontend: http://localhost:5173

To use PostgreSQL instead of the SQLite default:
```bash
DB_MODE=postgres docker compose --profile postgres up -d
```

## 4. Rebuilding after changes

**Backend Python source** is baked into the image (`COPY . .` in the Dockerfile) — a code change needs a rebuild:
```bash
docker compose build backend && docker compose up -d backend
```

**`data/`, `models/`, `scripts/`** are volume-mounted (bind-mounted, not baked in) — editing a file there, or dropping in a new `models/best.pt`, just needs a restart, no rebuild:
```bash
docker compose restart backend
```
Note: `docker compose restart` reuses the existing container (keeps old env vars); if you changed `.env`, use `docker compose up -d` instead, which recreates the container and picks up the new values.

**Frontend** is a static build — any source change needs a rebuild:
```bash
docker compose build frontend && docker compose up -d frontend
```

## 5. Seeding demo data

```bash
docker compose exec backend python scripts/seed_demo.py
```

Or ingest real footage into a specific camera:
```bash
curl -X POST "http://localhost:8000/ingest/cam_01"
curl "http://localhost:8000/ingest/status/cam_01"   # poll for progress
```

Ingest one camera at a time — running many cameras' ingestion concurrently can overload the shared inference thread pool and cause requests to hang. Sequential is safe and each camera typically finishes in under a minute.

After ingesting, check what got detected before picking blacklist candidates:
```bash
docker compose exec backend python scripts/list_detected_plates.py --top 20
```

Add a plate to the blacklist via the API or the Blacklist page in the UI:
```bash
curl -X POST "http://localhost:8000/blacklist" \
  -H "Content-Type: application/json" \
  -d '{"plate_number":"MH02IA3852","reason":"Reported stolen"}'
```

## 6. Demo walkthrough

1. **Live Map** (`/dashboard`) — city-wide heatmap and camera network.
2. **OCR Preview** (`/ocr-preview`) — pick a camera, generate a preview, watch frame-by-frame detection + OCR text.
3. **Vehicle Search** (`/vehicle`) — search a plate with multiple sightings to see its trajectory; toggle **Trajectory** vs **Possible Routes** on the map.
4. **Real-time alert demo** — blacklist a plate that was genuinely detected from real footage, then re-run ingestion on that same camera:
   ```bash
   curl -X POST "http://localhost:8000/ingest/cam_04"
   ```
   Within ~1 minute, a real (not simulated) alert fires live as the pipeline re-detects the match.
5. **Fallback / instant alert** — if you need a notification on demand without waiting on real footage, use the **"Simulate sighting"** button next to a blacklist entry, or:
   ```bash
   curl -X POST "http://localhost:8000/alerts/simulate?alert_type=blacklist_hit"
   ```
   This is clearly tagged `source: "simulated"` everywhere it appears — it's an explicit demo aid, not disguised as a real detection.
6. **Analytics** (`/analytics`) — heatmap, congestion table, OD flows, average speed between camera pairs.

## 7. Comparing OCR accuracy on real footage

Standalone diagnostic — doesn't touch the live app or its config:
```bash
docker compose exec backend python scripts/compare_ocr.py --camera cam_06 --max-detections 20
```
Installs EasyOCR into the running container on first use (not part of the production image), runs both PaddleOCR and EasyOCR against the same real detections, and writes a side-by-side report plus saved crop images to `data/ocr_comparison/`.

## 8. Fine-tuning the YOLOv8 detector

See `training/train_colab.py` — designed to run as Colab cells against a Roboflow-hosted plate dataset. Checkpoints save to Google Drive every epoch (`save_period=1`), so an interrupted Colab session doesn't lose progress — resume from `last.pt` rather than restarting from scratch.

## 9. Troubleshooting

- **PaddleOCR build warning about `pyclipper`/`zlib`** during `docker compose build backend` — expected and harmless; it's a one-time warm-up step (`|| true`) that fails in the build environment but succeeds at actual runtime since PaddleOCR lazy-loads its model on first real use.
- **Analytics panels look empty or inconsistent** — these are windowed against your data's own most recent timestamp, not the wall clock, so they shouldn't go stale over time. If something still looks off, check `GET /analytics/overview` directly to see the raw numbers before assuming the UI is wrong.
- **A container won't pick up a code change** — see the rebuild-vs-restart distinction in section 4; this is the most common cause of "I changed the file but nothing happened."
