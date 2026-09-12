"""
NAGARNETRA — YOLOv8 License Plate Detector
Wraps Ultralytics YOLOv8 for plate bounding-box detection.

Requires custom fine-tuned weights (best.pt) to be present at settings.YOLO_WEIGHTS_PATH.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import List

import numpy as np
import torch

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
        # Dynamically detect if a GPU is available for faster inference
        self._device = "cuda" if torch.cuda.is_available() else "cpu"

    def _load_model(self):
        """Load model — called once on first detection."""
        from ultralytics import YOLO

        weights_path = Path(settings.YOLO_WEIGHTS_PATH)

        if not weights_path.exists():
            error_msg = (
                f"Custom ANPR weights not found at {weights_path}. "
                "The license-plate detector requires best.pt."
            )
            logger.error(error_msg)
            raise FileNotFoundError(error_msg)

        logger.info(
            f"Loading custom ANPR weights: {weights_path} "
            f"onto device: {self._device}"
        )

        self._model = YOLO(str(weights_path))
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
            device=self._device, 
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