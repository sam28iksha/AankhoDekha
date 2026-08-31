# NAGARNETRA — models directory
# Drop your fine-tuned YOLO weights here as `best.pt`
# The pipeline will use this file automatically when YOLO_WEIGHTS_PATH=./models/best.pt
#
# To get fine-tuned ANPR weights:
#   1. Train using notebooks/finetune_anpr.ipynb
#   2. Output is at: runs/detect/train/weights/best.pt
#   3. Copy that file here as: models/best.pt
#
# If this file does not exist, the system falls back to:
#   - Ultralytics Hub: keremberke/license-plate-detection (auto-download)
#   - yolov8n.pt (generic COCO pretrained, last resort)
