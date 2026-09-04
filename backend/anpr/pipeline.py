"""
NAGARNETRA — ANPR Pipeline Orchestrator
Connects: FrameSource → PlateDetector → PlateOCR → temporal clustering → PlateEvent
"""
from __future__ import annotations

import asyncio
import difflib
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
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, lambda: cv2.imwrite(str(path), frame))
        return str(path)
    except Exception as e:
        logger.warning(f"Could not save snapshot: {e}")
        return None


# ── Temporal plate clustering ────────────────────────────────────────────────
# A single physical vehicle crossing a camera's field of view gets sampled
# across several consecutive frames, and OCR is noisy frame-to-frame (a single
# flipped character — e.g. "MH10Z0499" vs "MH1OZ0499" — is the common case,
# not the exception). Emitting one PlateEvent per raw OCR read turns one real
# sighting into several "different" plates, which both inflates event counts
# and breaks cross-camera trajectory matching (which relies on exact string
# equality). Instead, reads that are close in time AND text-similar are
# buffered into a cluster and collapsed into a single canonical reading via
# confidence-weighted, per-character majority vote once the vehicle leaves
# frame (no similar read for _CLUSTER_GAP_SECONDS).
_CLUSTER_GAP_SECONDS = 3.0
_SIMILARITY_THRESHOLD = 0.72  # difflib ratio; tolerant of 1-2 character OCR flips

_PlateRead = tuple  # (plate_text, confidence, timestamp, snapshot_path)


def _plate_similarity(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, a, b).ratio()


class _PlateCluster:
    """Buffers near-duplicate OCR reads believed to be the same vehicle sighting."""

    def __init__(self, plate: str, confidence: float, ts: datetime, snapshot_path: Optional[str]):
        self.reads: list[_PlateRead] = [(plate, confidence, ts, snapshot_path)]
        self.last_seen = ts

    @property
    def representative(self) -> str:
        # Matching anchors on the most recent read so a cluster can "drift"
        # across several frames of an improving/degrading OCR read.
        return self.reads[-1][0]

    def add(self, plate: str, confidence: float, ts: datetime, snapshot_path: Optional[str]) -> None:
        self.reads.append((plate, confidence, ts, snapshot_path))
        self.last_seen = ts

    def resolve(self) -> tuple[str, float, datetime, Optional[str]]:
        """
        Confidence-weighted majority vote across all reads in the cluster.
        Canonical length = the length with the highest total confidence weight;
        each character position within that length is then the highest-weighted
        character across contributing reads. Falls back cleanly to the single
        read's text when the cluster has only one member.
        """
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
        first_ts = self.reads[0][2]  # when the vehicle first entered frame
        return canonical_plate, best_conf, first_ts, best_snapshot
# ──────────────────────────────────────────────────────────────────────────────


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
            # Compute real timestamp for this frame
            frame_ts = self.video_start_time + timedelta(
                milliseconds=frame.timestamp_ms
            )

            # Close out clusters the vehicle has clearly left (no matching
            # read for a while) before considering this frame's detections.
            still_active = []
            for cluster in active_clusters:
                if (frame_ts - cluster.last_seen).total_seconds() > _CLUSTER_GAP_SECONDS:
                    event_count += 1
                    yield self._emit(cluster)
                else:
                    still_active.append(cluster)
            active_clusters = still_active

            # --- Detection ---
            loop = asyncio.get_running_loop()
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

                # Optional snapshot
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

        # Video ended — flush every cluster still open.
        for cluster in active_clusters:
            event_count += 1
            yield self._emit(cluster)

        logger.info(
            f"[{self.camera_id}] Pipeline complete: "
            f"{frame_count} frames processed, {event_count} events emitted."
        )
