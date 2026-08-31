"""
NAGARNETRA — ANPR Pipeline Orchestrator
Connects: FrameSource → PlateDetector → PlateOCR → DB event write → Alert check
"""
from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import AsyncIterator, Callable, Optional

import cv2
import numpy as np

from config import settings
from anpr.frame_source import FrameSource, Frame
from anpr.detector import plate_detector, PlateDetection
from anpr.ocr import plate_ocr

logger = logging.getLogger(__name__)


@dataclass
class PlateEvent:
    """A fully resolved plate-read event ready for DB storage."""
    plate_number: str
    camera_id: str
    lat: float
    lng: float
    timestamp: datetime
    confidence: float
    frame_snapshot_path: Optional[str] = None


async def save_frame_snapshot(
    frame: np.ndarray,
    camera_id: str,
    plate: str,
    ts: datetime,
) -> str | None:
    """Save a debug JPEG of the frame; returns relative path or None."""
    try:
        snap_dir = Path(settings.SNAPSHOTS_DIR) / camera_id
        snap_dir.mkdir(parents=True, exist_ok=True)
        filename = f"{plate}_{ts.strftime('%Y%m%dT%H%M%S')}.jpg"
        path = snap_dir / filename
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, lambda: cv2.imwrite(str(path), frame))
        return str(path)
    except Exception as e:
        logger.warning(f"Could not save snapshot: {e}")
        return None


class ANPRPipeline:
    """
    Processes a FrameSource end-to-end and yields PlateEvent objects.
    Designed to be source-agnostic: pass any FrameSource subclass.

    Usage
    -----
    async for event in ANPRPipeline(source, camera).run():
        await write_to_db(event)
    """

    def __init__(
        self,
        source: FrameSource,
        camera_id: str,
        camera_lat: float,
        camera_lng: float,
        video_start_time: Optional[datetime] = None,
        save_snapshots: bool = False,
    ):
        self.source = source
        self.camera_id = camera_id
        self.camera_lat = camera_lat
        self.camera_lng = camera_lng
        self.video_start_time = video_start_time or datetime.now(timezone.utc)
        self.save_snapshots = save_snapshots

        # Dedup cache: avoid logging the same plate multiple times per N seconds
        self._recent: dict[str, datetime] = {}
        self._dedup_window = timedelta(seconds=10)

    def _is_duplicate(self, plate: str, ts: datetime) -> bool:
        last = self._recent.get(plate)
        if last and (ts - last) < self._dedup_window:
            return True
        self._recent[plate] = ts
        return False

    async def run(self) -> AsyncIterator[PlateEvent]:
        frame_count = 0
        event_count = 0
        async for frame in self.source:
            frame_count += 1
            # Compute real timestamp for this frame
            frame_ts = self.video_start_time + timedelta(
                milliseconds=frame.timestamp_ms
            )

            # --- Detection ---
            loop = asyncio.get_event_loop()
            detections: list[PlateDetection] = await loop.run_in_executor(
                None, plate_detector.detect, frame.image
            )

            for det in detections:
                # --- OCR ---
                plate_text, ocr_conf = await loop.run_in_executor(
                    None, plate_ocr.read, det.crop
                )

                if not plate_text:
                    continue
                if ocr_conf < settings.OCR_CONFIDENCE_THRESHOLD:
                    logger.debug(f"Low OCR conf {ocr_conf:.2f} for plate '{plate_text}', skipping.")
                    continue

                # Combined confidence (geometric mean of YOLO + OCR)
                combined_conf = (det.confidence * ocr_conf) ** 0.5

                if self._is_duplicate(plate_text, frame_ts):
                    continue

                # Optional snapshot
                snapshot_path = None
                if self.save_snapshots:
                    snapshot_path = await save_frame_snapshot(
                        frame.image, self.camera_id, plate_text, frame_ts
                    )

                event = PlateEvent(
                    plate_number=plate_text,
                    camera_id=self.camera_id,
                    lat=self.camera_lat,
                    lng=self.camera_lng,
                    timestamp=frame_ts,
                    confidence=round(combined_conf, 4),
                    frame_snapshot_path=snapshot_path,
                )
                event_count += 1
                logger.info(
                    f"[{self.camera_id}] Plate: {plate_text} | "
                    f"Conf: {combined_conf:.2f} | "
                    f"Time: {frame_ts.isoformat()}"
                )
                yield event

        logger.info(
            f"[{self.camera_id}] Pipeline complete: "
            f"{frame_count} frames processed, {event_count} events emitted."
        )
