"""
NAGARNETRA — Defensible System Metrics Registry
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
        
        # Persistence & Alerts
        self.events_persisted = 0
        self.alerts_broadcast = 0
        
        # Camera Activity (camera_id -> last_frame_timestamp)
        self._camera_activity: Dict[str, float] = {}
        
        # Latency Tracking (count, total_ms)
        self._latencies: Dict[str, Dict[str, float]] = {
            "detection": {"count": 0, "total_ms": 0.0},
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
        setattr(self, counter, getattr(self, counter) + amount)

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
        # Defensible OCR Success Rate
        ocr_rate = 0.0
        if self.ocr_attempts > 0:
            ocr_rate = round((self.ocr_success / self.ocr_attempts) * 100, 2)
            
        # Calculate true active cameras (processed a frame in last 30s)
        now = time.time()
        active_cameras = sum(1 for ts in self._camera_activity.values() if (now - ts) < 30)

        # Calculate average latencies
        avg_latencies = {}
        for stage, data in self._latencies.items():
            avg_latencies[f"{stage}_ms"] = (
                round(data["total_ms"] / data["count"], 1) if data["count"] > 0 else 0.0
            )

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
                "ocr_success_rate": ocr_rate,
                "events_persisted": self.events_persisted,
            },
            "alerts_broadcast": self.alerts_broadcast,
            "websocket_clients": self.websocket_clients,
            "latency": avg_latencies,
        }

# Global singleton
metrics = MetricsRegistry()