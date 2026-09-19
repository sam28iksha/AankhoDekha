"""
AANKHODEKHA — Defensible System Metrics Registry
In-memory counters and latency trackers for system observability.
"""

import time
from typing import Dict, Any


class MetricsRegistry:
    def __init__(self):
        self.start_time = time.time()

        # System
        self.websocket_clients = 0

        # ANPR Pipeline
        self.frames_processed = 0
        self.plates_detected = 0   # YOLO hits
        self.ocr_attempts = 0      # Passed crop to OCR
        self.ocr_success = 0       # Valid plate returned
        self.ocr_confidence_sum = 0.0  # Sum of confidence of accepted OCR reads

        # Persistence & Alerts
        self.events_persisted = 0
        self.alerts_broadcast = 0

        # Camera Activity (camera_id -> last_frame_timestamp)
        self._camera_activity: Dict[str, float] = {}

        # Latency Tracking (count, total_ms)
        self._latencies: Dict[str, Dict[str, float]] = {
            "detection": {"count": 0, "total_ms": 0.0},
            "vehicle_detection": {"count": 0, "total_ms": 0.0},
            "ocr": {"count": 0, "total_ms": 0.0},
            "event_persistence": {"count": 0, "total_ms": 0.0},
            "pipeline": {"count": 0, "total_ms": 0.0},
        }

    @property
    def uptime_seconds(self) -> int:
        return int(time.time() - self.start_time)

    def increment(self, counter: str, amount: int = 1):
        """Safely increment a known counter. Fails loudly on typos."""
        if not hasattr(self, counter):
            raise ValueError(f"Unknown metrics counter: '{counter}'")

        setattr(
            self,
            counter,
            getattr(self, counter) + amount,
        )

    def record_ocr_success(self, confidence: float):
        """Record an accepted OCR read and its confidence."""
        self.ocr_success += 1
        self.ocr_confidence_sum += confidence
        print(
        f"OCR CONFIDENCE METRIC: "
        f"confidence={confidence}, "
        f"success={self.ocr_success}, "
        f"sum={self.ocr_confidence_sum}"
    )

    def mark_camera_active(self, camera_id: str):
        """Record the timestamp of the last successfully received frame for a camera."""
        self._camera_activity[camera_id] = time.time()

    def record_latency(self, stage: str, ms: float):
        """Record latency for a specific pipeline stage."""
        if stage not in self._latencies:
            raise ValueError(f"Unknown latency stage: '{stage}'")

        self._latencies[stage]["count"] += 1
        self._latencies[stage]["total_ms"] += ms

    def get_snapshot(self) -> Dict[str, Any]:
        """Return a defensible snapshot of system health."""

        # ---------------------------------------------------------------
        # OCR Success Rate
        # ---------------------------------------------------------------

        ocr_rate = 0.0

        if self.ocr_attempts > 0:
            ocr_rate = round(
                (self.ocr_success / self.ocr_attempts) * 100,
                2,
            )

        # ---------------------------------------------------------------
        # Accepted Read Confidence
        # ---------------------------------------------------------------

        accepted_read_confidence = 0.0

        if self.ocr_success > 0:
            accepted_read_confidence = round(
                (self.ocr_confidence_sum / self.ocr_success) * 100,
                2,
            )

        # ---------------------------------------------------------------
        # Active Cameras
        # ---------------------------------------------------------------

        now = time.time()

        active_cameras = sum(
            1
            for ts in self._camera_activity.values()
            if (now - ts) < 30
        )

        # ---------------------------------------------------------------
        # Average Latencies
        # ---------------------------------------------------------------

        avg_latencies = {}

        for stage, data in self._latencies.items():
            avg_latencies[f"{stage}_ms"] = (
                round(
                    data["total_ms"] / data["count"],
                    1,
                )
                if data["count"] > 0
                else 0.0
            )

        # ---------------------------------------------------------------
        # Snapshot
        # ---------------------------------------------------------------

        return {
            "uptime_seconds": self.uptime_seconds,

            "cameras": {
                "active_last_30s": active_cameras,
            },

            "anpr": {
                "frames_processed": self.frames_processed,
                "plates_detected": self.plates_detected,
                "ocr_attempts": self.ocr_attempts,
                "ocr_success": self.ocr_success,

                # Percentage of OCR attempts that produced
                # an accepted plate.
                "ocr_success_rate": ocr_rate,

                # Average PaddleOCR confidence among
                # accepted plate reads.
                "accepted_read_confidence": accepted_read_confidence,

                "events_persisted": self.events_persisted,
            },

            "alerts_broadcast": self.alerts_broadcast,
            "websocket_clients": self.websocket_clients,

            "latency": avg_latencies,
        }


# Global singleton
metrics = MetricsRegistry()