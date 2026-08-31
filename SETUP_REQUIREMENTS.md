# NAGARNETRA — Setup Requirements
### What you need to provide before the demo is recordable

---

## What Antigravity/this repo already provides

- ✅ All backend code (FastAPI, ANPR pipeline, DB, analytics, WebSocket alerts)
- ✅ All frontend code (React dashboard, map, vehicle search, analytics, alerts view)
- ✅ 12 Delhi camera definitions in `data/cameras.json`
- ✅ Synthetic demo data seeder (`scripts/seed_demo.py`)
- ✅ One-command Docker startup
- ✅ Blacklist workflow scripts

---

## What YOU need to provide

### 1. Traffic Video Files

You need 12 video files (one per virtual camera), placed at:
```
data/sample_videos/
  cam_01.mp4
  cam_02.mp4
  ...
  cam_10.mp4
  cam_11.mp4
  cam_12.mp4
```

**Where to get them (all free, no account needed):**

| Source | URL | Best for |
|---|---|---|
| Pexels | https://www.pexels.com/search/videos/traffic/ | High-quality daylight traffic |
| Pixabay | https://pixabay.com/videos/search/traffic%20car/ | Various angles |
| Videvo | https://www.videvo.net | Street-level traffic |

**What to look for:**
- Footage showing vehicles from front/rear/side angle
- License plates visible (doesn't matter which country — ANPR will attempt to read them)
- 30–120 seconds per clip is fine (the frame sampler handles any length)

**Trajectory demo requirement (important!):**
- Pick 2–3 of your downloaded clips
- Using any video editor (or `ffmpeg`), take a 3–5 second segment of one clip that shows a clear plate, and append it to 2–3 different `cam_XX.mp4` files
- This causes that plate to be logged at multiple cameras — enabling the vehicle trajectory view

**Quick ffmpeg splice example:**
```bash
# Extract 5-second clip from video_a.mp4 starting at 10s
ffmpeg -ss 10 -t 5 -i video_a.mp4 -c copy plate_segment.mp4

# Append it to cam_02.mp4 and cam_05.mp4
ffmpeg -i cam_02.mp4 -i plate_segment.mp4 -filter_complex "[0:v][1:v]concat=n=2:v=1" cam_02_with_splice.mp4
mv cam_02_with_splice.mp4 cam_02.mp4

ffmpeg -i cam_05.mp4 -i plate_segment.mp4 -filter_complex "[0:v][1:v]concat=n=2:v=1" cam_05_with_splice.mp4
mv cam_05_with_splice.mp4 cam_05.mp4
```

### 2. YOLO Fine-Tuned Model Weights (Optional but Recommended)

For >90% accuracy on Indian license plates:

**Option A — Use pretrained ANPR weights (automatic):**
The system automatically downloads `keremberke/license-plate-detection` from Ultralytics Hub on first run. This works for most plates without any setup.

**Option B — Fine-tune your own (for Indian plates specifically):**
1. Download the [Indian License Plates with Labels dataset](https://universe.roboflow.com/sih-qqlqc/indian-license-plates-with-labels) from Roboflow (free account required)
2. Download in YOLO format
3. Open `notebooks/finetune_anpr.ipynb` and follow the instructions
4. Copy the output `runs/detect/train/weights/best.pt` to `models/best.pt`

**Option C — Use generic fallback (zero setup):**
Without any weights file, the system uses `yolov8n.pt` (COCO pretrained). Accuracy is lower but the pipeline still runs.

### 3. Blacklist Plate Picks (after first ingestion)

After running `python scripts/ingest_videos.py`, run:
```bash
python scripts/list_detected_plates.py
```

Pick 3–4 plate numbers from the output (prioritize ★ multi-camera plates) and add them to `data/blacklist.json`. See `RUN.md` for the exact workflow.

---

## System Requirements

| Requirement | Minimum | Recommended |
|---|---|---|
| RAM | 8 GB | 16 GB |
| Disk space | 10 GB free | 20 GB |
| CPU | 4 cores | 8+ cores |
| GPU | None (CPU inference) | CUDA GPU (speeds ingestion 5–10x) |
| OS | Linux / macOS / Windows + WSL2 | Ubuntu 22.04 |
| Docker | 24.x | Latest |
| Node.js (non-Docker) | 20.x | LTS |
| Python (non-Docker) | 3.10+ | 3.11 |

---

## First-Run Timeline (realistic estimate)

| Step | Time |
|---|---|
| `docker compose up --build` (first time) | 8–20 min |
| Subsequent `docker compose up` | 15–45 sec |
| `python scripts/seed_demo.py` | 10–30 sec |
| Ingesting one 60-second video (CPU) | 2–10 min |
| Ingesting one 60-second video (GPU) | 15–45 sec |

---

## Troubleshooting

**PaddleOCR download fails during build:**
The Dockerfile tries to pre-download models. If it fails (network issue), models will download on first API call instead. This is safe.

**YOLOv8 Hub download fails:**
Set `YOLO_WEIGHTS_PATH` to a local `.pt` file, or leave blank — the pipeline falls back to `yolov8n.pt` automatically.

**Frontend can't connect to backend:**
Check that `VITE_API_URL` and `VITE_WS_URL` in your `.env` match where the backend is running.

**Slow ingestion:**
Increase `FRAME_SAMPLE_RATE` in `.env` (e.g. `FRAME_SAMPLE_RATE=15`) to process fewer frames — faster but may miss some plates.

**No plates detected:**
The stock YOLO model may not recognize plates in all footage angles/lighting. Try:
1. Lower `DETECTION_CONFIDENCE_THRESHOLD=0.25` in `.env`
2. Use a fine-tuned ANPR model (see `notebooks/finetune_anpr.ipynb`)
3. Run the seed script for demo data while you source better footage
