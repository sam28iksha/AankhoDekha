"""
NAGARNETRA — YOLOv8 Dual Detection System

1. PlateDetector:
   Custom ANPR weights (best.pt) for license plate detection.

2. VehicleDetector:
   COCO weights (yolov8n.pt) for broad vehicle type detection
   and lightweight HSV-based color estimation.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import List

import cv2
import numpy as np
import torch

from config import settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Detection data structures
# ---------------------------------------------------------------------------

@dataclass
class PlateDetection:
    """Bounding box + confidence for a single license plate."""

    x1: int
    y1: int
    x2: int
    y2: int
    confidence: float
    crop: np.ndarray  # Cropped plate image (BGR)


@dataclass
class VehicleDetection:
    """Bounding box + attributes for a physical vehicle."""

    x1: int
    y1: int
    x2: int
    y2: int
    confidence: float
    vehicle_type: str
    color: str
    crop: np.ndarray  # Cropped vehicle image (BGR)


# ---------------------------------------------------------------------------
# Vehicle color estimation
# ---------------------------------------------------------------------------

def extract_vehicle_color(crop: np.ndarray) -> str:
    """
    Estimate the dominant vehicle color using a lightweight HSV heuristic.

    The lower 25% of the vehicle crop is ignored to reduce interference
    from tires and road/asphalt.

    This is a heuristic baseline, not a dedicated vehicle-color ML model.
    """

    if crop is None or crop.size == 0:
        return "unknown"

    # Small fixed resolution keeps this operation cheap.
    small = cv2.resize(crop, (32, 32))

    # Ignore the lower part of the vehicle where tires/road are common.
    h, w = small.shape[:2]
    body = small[: int(h * 0.75), :]

    if body.size == 0:
        return "unknown"

    # BGR -> HSV
    hsv = cv2.cvtColor(body, cv2.COLOR_BGR2HSV)

    # Median is less sensitive to isolated bright/dark pixels.
    median_h, median_s, median_v = np.median(
        hsv.reshape(-1, 3),
        axis=0,
    )

    # -----------------------------------------------------------------------
    # Achromatic colors
    # -----------------------------------------------------------------------

    # Very dark pixels -> black
    if median_v < 60:
        return "black"

    # Low saturation + high brightness -> white
    if median_s < 50 and median_v > 190:
        return "white"

    # Low saturation + medium brightness -> silver/grey
    if median_s < 50 and 60 <= median_v <= 190:
        return "silver"

    # -----------------------------------------------------------------------
    # Chromatic colors
    # OpenCV Hue range: 0-179
    # -----------------------------------------------------------------------

    # Red wraps around the HSV hue boundary.
    if median_h < 15 or median_h > 165:
        return "red"

    if 15 <= median_h < 35:
        return "yellow"

    if 35 <= median_h < 85:
        return "green"

    if 85 <= median_h < 135:
        return "blue"

    return "unknown"


# ---------------------------------------------------------------------------
# Plate detector
# ---------------------------------------------------------------------------

class PlateDetector:
    """YOLOv8-based license plate detector using custom ANPR weights."""

    def __init__(self):
        self._model = None
        self._device = "cuda" if torch.cuda.is_available() else "cpu"

    def _load_model(self) -> None:
        """Load the custom ANPR model lazily."""

        from ultralytics import YOLO

        weights_path = Path(settings.YOLO_WEIGHTS_PATH)

        if not weights_path.exists():
            error_msg = (
                f"Custom ANPR weights not found at {weights_path}."
            )
            logger.error(error_msg)
            raise FileNotFoundError(error_msg)

        logger.info(
            "Loading custom ANPR weights: %s onto device: %s",
            weights_path,
            self._device,
        )

        self._model = YOLO(str(weights_path))

        logger.info("Plate detector ready.")

    def detect(
        self,
        frame: np.ndarray,
        conf_threshold: float | None = None,
    ) -> List[PlateDetection]:
        """
        Detect license plates in a frame.

        Returns detections sorted by confidence descending.
        """

        if self._model is None:
            self._load_model()

        threshold = (
            conf_threshold
            if conf_threshold is not None
            else settings.DETECTION_CONFIDENCE_THRESHOLD
        )

        results = self._model.predict(
            frame,
            conf=threshold,
            verbose=False,
            device=self._device,
        )

        detections: List[PlateDetection] = []

        h, w = frame.shape[:2]

        for result in results:
            if result.boxes is None:
                continue

            for box in result.boxes:
                conf = float(box.conf[0])

                x1, y1, x2, y2 = map(
                    int,
                    box.xyxy[0].tolist(),
                )

                # Clamp bounding box to frame boundaries.
                x1 = max(0, min(x1, w))
                y1 = max(0, min(y1, h))
                x2 = max(0, min(x2, w))
                y2 = max(0, min(y2, h))

                if x2 <= x1 or y2 <= y1:
                    continue

                crop = frame[y1:y2, x1:x2]

                if crop.size == 0:
                    continue

                detections.append(
                    PlateDetection(
                        x1=x1,
                        y1=y1,
                        x2=x2,
                        y2=y2,
                        confidence=conf,
                        crop=crop,
                    )
                )

        detections.sort(
            key=lambda detection: detection.confidence,
            reverse=True,
        )

        return detections


# ---------------------------------------------------------------------------
# Vehicle detector
# ---------------------------------------------------------------------------

class VehicleDetector:
    """
    YOLOv8 COCO-based vehicle detector.

    Supported COCO vehicle classes:
        2 -> car
        3 -> motorcycle
        5 -> bus
        7 -> truck

    Vehicle color is estimated using extract_vehicle_color().
    """

    def __init__(self):
        self._model = None
        self._device = "cuda" if torch.cuda.is_available() else "cpu"

        # COCO class IDs.
        self._allowed_classes = {
            2: "car",
            3: "motorcycle",
            5: "bus",
            7: "truck",
        }

        # Keep the weight path separate from the custom ANPR model.
        self._weights_path = Path("models/yolov8n.pt")

    def _load_model(self) -> None:
        """Load the generic vehicle model lazily."""

        from ultralytics import YOLO

        if not self._weights_path.exists():
            error_msg = (
                f"Vehicle detection weights not found at "
                f"{self._weights_path}."
            )
            logger.error(error_msg)
            raise FileNotFoundError(error_msg)

        logger.info(
            "Loading COCO vehicle weights: %s onto device: %s",
            self._weights_path,
            self._device,
        )

        self._model = YOLO(str(self._weights_path))

        logger.info("Vehicle detector ready.")

    def detect(
        self,
        frame: np.ndarray,
        conf_threshold: float | None = None,
    ) -> List[VehicleDetection]:
        """
        Detect vehicles in a frame.

        Returns detections sorted by confidence descending.
        """

        if self._model is None:
            self._load_model()

        threshold = (
            conf_threshold
            if conf_threshold is not None
            else settings.DETECTION_CONFIDENCE_THRESHOLD
        )

        results = self._model.predict(
            frame,
            conf=threshold,
            verbose=False,
            device=self._device,
        )

        detections: List[VehicleDetection] = []

        h, w = frame.shape[:2]

        for result in results:
            if result.boxes is None:
                continue

            for box in result.boxes:
                cls_id = int(box.cls[0])

                # Ignore all non-vehicle COCO classes.
                if cls_id not in self._allowed_classes:
                    continue

                vehicle_type = self._allowed_classes[cls_id]
                confidence = float(box.conf[0])

                x1, y1, x2, y2 = map(
                    int,
                    box.xyxy[0].tolist(),
                )

                # Clamp bounding box to frame boundaries.
                x1 = max(0, min(x1, w))
                y1 = max(0, min(y1, h))
                x2 = max(0, min(x2, w))
                y2 = max(0, min(y2, h))

                if x2 <= x1 or y2 <= y1:
                    continue

                crop = frame[y1:y2, x1:x2]

                if crop.size == 0:
                    continue

                color = extract_vehicle_color(crop)

                detections.append(
                    VehicleDetection(
                        x1=x1,
                        y1=y1,
                        x2=x2,
                        y2=y2,
                        confidence=confidence,
                        vehicle_type=vehicle_type,
                        color=color,
                        crop=crop,
                    )
                )

        detections.sort(
            key=lambda detection: detection.confidence,
            reverse=True,
        )

        return detections


# ---------------------------------------------------------------------------
# Shared detector instances
# ---------------------------------------------------------------------------

# Models are loaded lazily on first use.
# Keeping these as shared instances prevents repeatedly loading YOLO weights.
plate_detector = PlateDetector()
vehicle_detector = VehicleDetector()