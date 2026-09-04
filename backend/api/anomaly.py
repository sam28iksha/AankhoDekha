"""
NAGARNETRA — Route Anomaly Detection
Flags a "suspicious route anomaly" when a plate's newest sighting implies a
physically impossible transit speed from its most recent prior sighting at a
different camera. This is the real-world signal ANPR platforms use to catch
cloned/duplicated plates (the same plate number appearing on two different
physical vehicles) or serious data-integrity issues — not a general-purpose
"weird behavior" detector, but a concrete, checkable condition.

Shared by both ingestion paths (scripts/ingest_videos.py and
api/ingest.py's _write_event_and_maybe_alert) so a route anomaly is caught
regardless of which pipeline wrote the sighting.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from db.models import PlateEvent, Camera, Alert
from utils.geo import haversine_km
from api.alert_manager import alert_manager

logger = logging.getLogger(__name__)


async def check_speed_anomaly(
    db: AsyncSession,
    plate_number: str,
    camera_id: str,
    camera_name: str,
    camera_lat: float,
    camera_lng: float,
    timestamp: datetime,
) -> None:
    """
    Compare this sighting against the plate's most recent prior sighting at a
    DIFFERENT camera within the lookback window. If the implied average speed
    exceeds settings.ANOMALY_SPEED_THRESHOLD_KMH, write + broadcast an
    "anomaly" alert — same live-alert path used for blacklist hits.

    Does not commit — caller is expected to commit alongside its own writes.
    """
    window_start = timestamp - timedelta(hours=settings.ANOMALY_LOOKBACK_HOURS)
    result = await db.execute(
        select(PlateEvent, Camera)
        .join(Camera, PlateEvent.camera_id == Camera.id)
        .where(
            PlateEvent.plate_number == plate_number,
            PlateEvent.camera_id != camera_id,
            PlateEvent.timestamp < timestamp,
            PlateEvent.timestamp >= window_start,
        )
        .order_by(PlateEvent.timestamp.desc())
        .limit(1)
    )
    row = result.first()
    if row is None:
        return

    prev_event, prev_cam = row
    # SQLite doesn't round-trip tz-awareness — a value written as UTC-aware
    # can come back naive. Both sides are always UTC in practice, so compare
    # as naive to avoid "can't subtract offset-naive and offset-aware".
    delta_seconds = (timestamp.replace(tzinfo=None) - prev_event.timestamp.replace(tzinfo=None)).total_seconds()
    if delta_seconds <= 0:
        return

    dist_km = haversine_km(prev_cam.lat, prev_cam.lng, camera_lat, camera_lng)
    speed_kmh = dist_km / (delta_seconds / 3600)

    if speed_kmh <= settings.ANOMALY_SPEED_THRESHOLD_KMH:
        return

    details = (
        f"Implausible transit: {dist_km:.1f} km between {prev_cam.name} and {camera_name} "
        f"in {delta_seconds:.0f}s — implied speed {speed_kmh:,.0f} km/h exceeds "
        f"{settings.ANOMALY_SPEED_THRESHOLD_KMH:.0f} km/h threshold. Possible cloned "
        f"plate or data anomaly."
    )

    alert = Alert(
        plate_number=plate_number,
        camera_id=camera_id,
        timestamp=timestamp,
        alert_type="anomaly",
        resolved=False,
        details=details,
    )
    db.add(alert)
    await db.flush()

    await alert_manager.broadcast_alert(
        alert_id=alert.id,
        plate_number=plate_number,
        camera_id=camera_id,
        camera_name=camera_name,
        alert_type="anomaly",
        timestamp=timestamp,
        details=details,
    )
    logger.warning(f"🚧 ROUTE ANOMALY: {plate_number} — {details}")
