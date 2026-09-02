"""
NAGARNETRA — YOLOv8 License Plate Detector
Wraps Ultralytics YOLOv8 for plate bounding-box detection.

Model resolution order:
  1. YOLO_WEIGHTS_PATH (custom/fine-tuned ANPR model)  <-- drop best.pt here
  2. HuggingFace Hub: keremberke/license-plate-detection (auto-download, ~50 MB)
  3. yolov8n.pt (generic COCO pretrained, last resort — lower accuracy)

To use your own fine-tuned model, set YOLO_WEIGHTS_PATH in .env.

Note: requires ultralytics>=8.3.0 for PyTorch 2.6 compatibility
(torch.load weights_only=False is handled internally by ultralytics 8.3.0+).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import List

import numpy as np

from config import settings

logger = logging.getLogger(__name__)


@dataclass
class PlateDetection:
    """Bounding box + confidence for a single plate detection."""
    x1: int
    y1: int
    x2: int
    y2: int
    confidence: float
    crop: np.ndarray  # cropped plate image (BGR)


class PlateDetector:
    """
    YOLOv8-based license plate detector.
    Lazy-initializes the model on first call to avoid import-time overhead.
    """

    def __init__(self):
        self._model = None

    def _load_model(self):
        """Load model — called once on first detection."""
        from ultralytics import YOLO

        weights_path = Path(settings.YOLO_WEIGHTS_PATH)

        if weights_path.exists():
            logger.info(f"Loading custom ANPR weights: {weights_path}")
            model = YOLO(str(weights_path))
        else:
            # Tier 2: download plate-specific model from HuggingFace Hub.
            # keremberke/license-plate-detection is a YOLOv8m fine-tuned on
            # ~25 k license plate images — meaningfully better than generic COCO.
            # huggingface_hub is already a transitive dep of ultralytics.
            try:
                from huggingface_hub import hf_hub_download
                logger.info(
                    "Custom weights not found. Downloading from HuggingFace Hub: "
                    "keremberke/license-plate-detection / yolov8m-license-plate.pt"
                )
                local_path = hf_hub_download(
                    repo_id="keremberke/license-plate-detection",
                    filename="yolov8m-license-plate.pt",
                )
                model = YOLO(local_path)
                logger.info("HuggingFace Hub ANPR model loaded successfully.")
            except Exception as hub_err:
                logger.warning(
                    f"Hub model unavailable ({hub_err}). "
                    "Falling back to yolov8n.pt (generic COCO). "
                    "Accuracy will be lower — drop a fine-tuned ANPR best.pt for production."
                )
                model = YOLO("yolov8n.pt")

        self._model = model
        logger.info("Plate detector ready.")

    def detect(
        self,
        frame: np.ndarray,
        conf_threshold: float | None = None,
    ) -> List[PlateDetection]:
        """
        Run detection on a BGR frame.

        Returns a list of PlateDetection objects sorted by confidence desc.
        """
        if self._model is None:
            self._load_model()

        threshold = conf_threshold or settings.DETECTION_CONFIDENCE_THRESHOLD

        results = self._model.predict(
            frame,
            conf=threshold,
            verbose=False,
            device="cpu",  # explicit CPU for portability; change to "cuda" for GPU
        )

        detections: List[PlateDetection] = []
        for result in results:
            if result.boxes is None:
                continue
            for box in result.boxes:
                conf = float(box.conf[0])
                x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
                # Clamp to frame bounds
                h, w = frame.shape[:2]
                x1, y1 = max(0, x1), max(0, y1)
                x2, y2 = min(w, x2), min(h, y2)
                crop = frame[y1:y2, x1:x2]
                if crop.size == 0:
                    continue
                detections.append(
                    PlateDetection(
                        x1=x1, y1=y1, x2=x2, y2=y2,
                        confidence=conf,
                        crop=crop,
                    )
                )

        # Sort highest confidence first
        detections.sort(key=lambda d: d.confidence, reverse=True)
        return detections


# Singleton instance — shared across the app
plate_detector = PlateDetector()
