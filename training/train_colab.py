"""
NAGARNETRA — Colab training cell for the merged Indian plate dataset.
Run this AFTER merge_datasets.py has produced /content/combined_dataset.

In Colab:
  Runtime -> Change runtime type -> GPU (T4 is fine, free tier)
Then paste this whole file's body into a cell (or `!python train_colab.py`
after uploading it) and run.

Checkpoints save every epoch, so stopping early (Ctrl+C / interrupting the
cell) still leaves you a usable /content/runs/detect/nagarnetra_indian/weights/best.pt
— never wasted work.
"""
from __future__ import annotations

import subprocess
import sys

subprocess.run([sys.executable, "-m", "pip", "install", "-q", "ultralytics"])

from ultralytics import YOLO

# ── EDIT THESE ────────────────────────────────────────────────────────────
DATA_YAML = "/content/combined_dataset/data.yaml"
# Start from a plate-specialized checkpoint, not generic COCO weights —
# far fewer epochs needed to specialize into Indian plates from here.
# If you have your current best.pt from the 1-lakh-image run, you can also
# point this at that file instead — either is a reasonable starting point.
START_WEIGHTS = "keremberke/license-plate-detection"  # HF hub id, ultralytics resolves it
# Fallback if the HF id above doesn't resolve in your ultralytics version:
# START_WEIGHTS = "yolov8n.pt"

EPOCHS = 80          # generous ceiling — patience will stop it earlier if it plateaus
PATIENCE = 15         # stop if val mAP hasn't improved in this many epochs
IMG_SIZE = 640
BATCH = 16
RUN_NAME = "nagarnetra_indian"
# ────────────────────────────────────────────────────────────────────────

model = YOLO(START_WEIGHTS)

model.train(
    data=DATA_YAML,
    epochs=EPOCHS,
    patience=PATIENCE,
    imgsz=IMG_SIZE,
    batch=BATCH,
    device=0,             # GPU — do not leave this as "cpu" in Colab
    project="/content/runs/detect",
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
print(f"   /content/runs/detect/{RUN_NAME}/weights/best.pt")
print("Download that file and drop it into NAGARNETRA/models/best.pt")
