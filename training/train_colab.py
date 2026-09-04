"""
NAGARNETRA — Colab training cell: fresh YOLOv8 fine-tune on the 10k-image
Roboflow "license-plate-recognition" set, starting from generic COCO
pretrained weights rather than continuing the earlier 4-epoch best.pt (that
run was judged too undertrained to be worth building on).

In Colab:
  Runtime -> Change runtime type -> GPU (T4 is fine, free tier)

Paste these cells in order:

--- Cell 1: install deps ---
!pip install -q ultralytics roboflow

--- Cell 2: mount Drive (checkpoints must survive a disconnect — /content alone doesn't) ---
from google.colab import drive
drive.mount('/content/drive')

--- Cell 3: download the dataset ---
from roboflow import Roboflow
rf = Roboflow(api_key="YOUR_API_KEY")  # keep this out of any committed file
project = rf.workspace("roboflow-universe-projects").project("license-plate-recognition-rxg4e")
version = project.version(4)
dataset = version.download("yolov8")
print(dataset.location)  # confirm the actual path — folder casing can vary

--- Cell 4: paste this file's body (below) and run ---
"""
from __future__ import annotations

import subprocess
import sys

subprocess.run([sys.executable, "-m", "pip", "install", "-q", "ultralytics"])

from ultralytics import YOLO

# ── EDIT THESE ────────────────────────────────────────────────────────────
# Set to whatever Cell 3's print(dataset.location) actually printed.
DATA_YAML = "/content/License-Plate-Recognition-4/data.yaml"

# Fresh start from generic COCO pretrained weights — NOT the earlier best.pt
# (only 4 epochs in, not worth building on) and NOT the HF hub id
# ("keremberke/license-plate-detection"), which failed to resolve directly
# via YOLO() before.
START_WEIGHTS = "yolov8n.pt"

EPOCHS = 80           # generous ceiling — patience will stop it earlier if it plateaus
PATIENCE = 15         # stop if val mAP hasn't improved in this many epochs
IMG_SIZE = 640
BATCH = 16
RUN_NAME = "nagarnetra_10k_fresh"

# Save straight to Drive, not /content — save_period=1 checkpointing is
# useless if a Colab disconnect wipes the ephemeral local disk it's sitting on.
PROJECT_DIR = "/content/drive/MyDrive/nagarnetra_runs"
# ────────────────────────────────────────────────────────────────────────

model = YOLO(START_WEIGHTS)

model.train(
    data=DATA_YAML,
    epochs=EPOCHS,
    patience=PATIENCE,
    imgsz=IMG_SIZE,
    batch=BATCH,
    device=0,             # GPU — do not leave this as "cpu" in Colab
    project=PROJECT_DIR,
    name=RUN_NAME,
    exist_ok=True,
    save=True,
    save_period=1,        # checkpoint every epoch — safe to stop anytime
    # Augmentation tuned for the problem statement's stated real-world conditions:
    hsv_h=0.02,           # hue jitter — varying light sources
    hsv_s=0.6,            # saturation jitter
    hsv_v=0.5,            # brightness jitter — varying lighting
    degrees=8.0,          # small rotation — angled shots
    perspective=0.0008,   # perspective warp — angled shots
    translate=0.1,
    scale=0.4,
    fliplr=0.0,           # do NOT flip plates horizontally — text becomes unreadable/wrong
    mosaic=1.0,
    mixup=0.1,
)

print("\n✅ Training done (or stopped early). Best weights at:")
print(f"   {PROJECT_DIR}/{RUN_NAME}/weights/best.pt")
print("Download that file, A/B test it against your current models/best.pt on")
print("real footage BEFORE replacing anything — training-time metrics alone")
print("were misleading last time.")
