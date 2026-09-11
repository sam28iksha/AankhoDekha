"""
NAGARNETRA — ANPR Pipeline Orchestrator
Connects: FrameSource → PlateDetector → PlateOCR → temporal clustering → PlateEvent
"""
from __future__ import annotations

import asyncio
import difflib
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import AsyncIterator, Optional

import cv2
import numpy as np

from config import settings
from anpr.frame_source import FrameSource
from anpr.detector import plate_detector, PlateDetection
from anpr.ocr import plate_ocr
from time import perf_counter
from utils.metrics import metrics

logger = logging.getLogger(__name__)

# --- UPGRADE 2: Concurrency Control ---
# Limits max concurrent ML tasks so YOLO/OCR don't crash the FastAPI thread pool.
_ML_SEMAPHORE = asyncio.Semaphore(4) 

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
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, lambda: cv2.imwrite(str(path), frame))
        return str(path)
    except Exception as e:
        logger.warning(f"Could not save snapshot: {e}")
        return None

# --- UPGRADE 1: Plate Normalization ---
def _normalize_plate(text: str) -> str:
    """Strip all non-alphanumeric characters and force uppercase."""
    if not text:
        return ""
    # Remove everything except A-Z and 0-9
    return re.sub(r'[^A-Z0-9]', '', text.upper())


_CLUSTER_GAP_SECONDS = 3.0
_SIMILARITY_THRESHOLD = 0.72  

_PlateRead = tuple  

def _plate_similarity(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, a, b).ratio()


class _PlateCluster:
    """Buffers near-duplicate OCR reads believed to be the same vehicle sighting."""

    def __init__(self, plate: str, confidence: float, ts: datetime, snapshot_path: Optional[str]):
        self.reads: list[_PlateRead] = [(plate, confidence, ts, snapshot_path)]
        self.last_seen = ts

    @property
    def representative(self) -> str:
        return self.reads[-1][0]

    def add(self, plate: str, confidence: float, ts: datetime, snapshot_path: Optional[str]) -> None:
        self.reads.append((plate, confidence, ts, snapshot_path))
        self.last_seen = ts

    def resolve(self) -> tuple[str, float, datetime, Optional[str]]:
        if len(self.reads) == 1:
            plate, conf, ts, snap = self.reads[0]
            return plate, conf, ts, snap

        length_weight: dict[int, float] = {}
        for plate, conf, _, _ in self.reads:
            length_weight[len(plate)] = length_weight.get(len(plate), 0.0) + conf
        canonical_len = max(length_weight, key=lambda l: length_weight[l])

        candidates = [r for r in self.reads if len(r[0]) == canonical_len]
        chars = []
        for i in range(canonical_len):
            tally: dict[str, float] = {}
            for plate, conf, _, _ in candidates:
                tally[plate[i]] = tally.get(plate[i], 0.0) + conf
            chars.append(max(tally, key=lambda ch: tally[ch]))
        canonical_plate = "".join(chars)

        best_read = max(self.reads, key=lambda r: r[1])
        best_conf = best_read[1]
        best_snapshot = best_read[3]
        first_ts = self.reads[0][2]  
        return canonical_plate, best_conf, first_ts, best_snapshot


class ANPRPipeline:
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

    def _emit(self, cluster: _PlateCluster) -> PlateEvent:
        plate, conf, ts, snapshot_path = cluster.resolve()
        logger.info(
            f"[{self.camera_id}] Plate: {plate} | Conf: {conf:.2f} | "
            f"Time: {ts.isoformat()} | merged from {len(cluster.reads)} read(s)"
        )
        return PlateEvent(
            plate_number=plate,
            camera_id=self.camera_id,
            lat=self.camera_lat,
            lng=self.camera_lng,
            timestamp=ts,
            confidence=round(conf, 4),
            frame_snapshot_path=snapshot_path,
        )

    async def run(self) -> AsyncIterator[PlateEvent]:
        frame_count = 0
        event_count = 0
        active_clusters: list[_PlateCluster] = []

        async for frame in self.source:
            frame_count += 1
            frame_ts = self.video_start_time + timedelta(
                milliseconds=frame.timestamp_ms
            )

            still_active = []
            for cluster in active_clusters:
                if (frame_ts - cluster.last_seen).total_seconds() > _CLUSTER_GAP_SECONDS:
                    event_count += 1
                    yield self._emit(cluster)
                else:
                    still_active.append(cluster)
            active_clusters = still_active

            # --- Protected YOLO Detection ---
            loop = asyncio.get_running_loop()
            async with _ML_SEMAPHORE:
                detections: list[PlateDetection] = await loop.run_in_executor(
                    None, plate_detector.detect, frame.image
                )

            for det in detections:
                # --- Protected PaddleOCR Read ---
                async with _ML_SEMAPHORE:
                    raw_plate_text, ocr_conf = await loop.run_in_executor(
                        None, plate_ocr.read, det.crop
                    )

                # Apply Normalization immediately!
                plate_text = _normalize_plate(raw_plate_text)

                if not plate_text:
                    continue
                if ocr_conf < settings.OCR_CONFIDENCE_THRESHOLD:
                    logger.debug(f"Low OCR conf {ocr_conf:.2f} for plate '{plate_text}', skipping.")
                    continue

                combined_conf = (det.confidence * ocr_conf) ** 0.5

                snapshot_path = None
                if self.save_snapshots:
                    snapshot_path = await save_frame_snapshot(
                        frame.image, self.camera_id, plate_text, frame_ts
                    )

                matched = None
                for cluster in active_clusters:
                    if _plate_similarity(plate_text, cluster.representative) >= _SIMILARITY_THRESHOLD:
                        matched = cluster
                        break

                if matched:
                    matched.add(plate_text, combined_conf, frame_ts, snapshot_path)
                else:
                    active_clusters.append(
                        _PlateCluster(plate_text, combined_conf, frame_ts, snapshot_path)
                    )

        for cluster in active_clusters:
            event_count += 1
            yield self._emit(cluster)

        logger.info(
            f"[{self.camera_id}] Pipeline complete: "
            f"{frame_count} frames processed, {event_count} events emitted."
        )


    async def run(self) -> AsyncIterator[PlateEvent]:
        frame_count = 0
        event_count = 0
        active_clusters: list[_PlateCluster] = []

        async for frame in self.source:
            pipeline_start = perf_counter()
            metrics.increment("frames_processed")
            metrics.mark_camera_active(self.camera_id)

            frame_count += 1
            frame_ts = self.video_start_time + timedelta(
                milliseconds=frame.timestamp_ms
            )

            still_active = []
            for cluster in active_clusters:
                if (frame_ts - cluster.last_seen).total_seconds() > _CLUSTER_GAP_SECONDS:
                    event_count += 1
                    yield self._emit(cluster)
                else:
                    still_active.append(cluster)
            active_clusters = still_active

            # --- Protected YOLO Detection ---
            loop = asyncio.get_running_loop()
            async with _ML_SEMAPHORE:
                det_start = perf_counter()
                detections: list[PlateDetection] = await loop.run_in_executor(
                    None, plate_detector.detect, frame.image
                )
                metrics.record_latency("detection", (perf_counter() - det_start) * 1000)
                metrics.increment("plates_detected", len(detections))

            for det in detections:
                metrics.increment("ocr_attempts")
                
                # --- Protected PaddleOCR Read ---
                async with _ML_SEMAPHORE:
                    ocr_start = perf_counter()
                    raw_plate_text, ocr_conf = await loop.run_in_executor(
                        None, plate_ocr.read, det.crop
                    )
                    metrics.record_latency("ocr", (perf_counter() - ocr_start) * 1000)

                # Apply Normalization immediately!
                plate_text = _normalize_plate(raw_plate_text)

                if not plate_text:
                    continue
                if ocr_conf < settings.OCR_CONFIDENCE_THRESHOLD:
                    logger.debug(f"Low OCR conf {ocr_conf:.2f} for plate '{plate_text}', skipping.")
                    continue

                metrics.increment("ocr_success")
                combined_conf = (det.confidence * ocr_conf) ** 0.5

                snapshot_path = None
                if self.save_snapshots:
                    snapshot_path = await save_frame_snapshot(
                        frame.image, self.camera_id, plate_text, frame_ts
                    )

                matched = None
                for cluster in active_clusters:
                    if _plate_similarity(plate_text, cluster.representative) >= _SIMILARITY_THRESHOLD:
                        matched = cluster
                        break

                if matched:
                    matched.add(plate_text, combined_conf, frame_ts, snapshot_path)
                else:
                    active_clusters.append(
                        _PlateCluster(plate_text, combined_conf, frame_ts, snapshot_path)
                    )

            # Record total pipeline latency for this frame (YOLO + OCR + Clustering)
            metrics.record_latency("pipeline", (perf_counter() - pipeline_start) * 1000)

        for cluster in active_clusters:
            event_count += 1
            yield self._emit(cluster)

        logger.info(
            f"[{self.camera_id}] Pipeline complete: "
            f"{frame_count} frames processed, {event_count} events emitted."
        )

        