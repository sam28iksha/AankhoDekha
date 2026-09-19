"""
AANKHODEKHA — Route Anomaly Detection
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
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from db.models import PlateEvent, Camera, Alert
from utils.geo import haversine_km
from api.alert_manager import alert_manager

logger = logging.getLogger(__name__)

def _normalize_to_utc(dt: datetime) -> datetime:
    """Ensure a datetime is timezone-aware and set to UTC."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)

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
    different camera within the configured lookback window.
    """

    # Normalize once so all timestamp calculations use the same timezone.
    timestamp = _normalize_to_utc(timestamp)

    window_start = timestamp - timedelta(
        hours=settings.ANOMALY_LOOKBACK_HOURS
    )

    # 1. FIND PREVIOUS SIGHTING
    result = await db.execute(
        select(PlateEvent, Camera)
        .join(Camera, PlateEvent.camera_id == Camera.id)
        .where(
            PlateEvent.plate_number == plate_number,
            PlateEvent.camera_id != camera_id,
            PlateEvent.timestamp < timestamp,
            PlateEvent.timestamp >= window_start,
        )
        .order_by(
            PlateEvent.timestamp.desc(),
            PlateEvent.id.desc(),
        )
        .limit(1)
    )

    row = result.first()

    if row is None:
        return

    prev_event, prev_cam = row

    # 2. CALCULATE TIME DELTA
    ts_prev = _normalize_to_utc(prev_event.timestamp)

    delta_seconds = (timestamp - ts_prev).total_seconds()

    if delta_seconds <= 0:
        return

    # 3. CALCULATE DISTANCE
    dist_km = haversine_km(
        prev_cam.lat,
        prev_cam.lng,
        camera_lat,
        camera_lng,
    )

    # Ignore very small movements that may be caused by GPS drift,
    # camera proximity, or timestamp synchronization issues.
    if dist_km < settings.ANOMALY_MIN_DISTANCE_KM:
        return

    speed_kmh = dist_km / (delta_seconds / 3600)

    if speed_kmh <= settings.ANOMALY_SPEED_THRESHOLD_KMH:
        return

    # 4. ANTI-SPAM GUARD
    cooldown_start = timestamp - timedelta(minutes=15)

    recent_alert = await db.execute(
        select(Alert.id)
        .where(
            Alert.plate_number == plate_number,
            Alert.alert_type == "anomaly",
            Alert.timestamp >= cooldown_start,
            Alert.timestamp <= timestamp,
        )
        .limit(1)
    )

    if recent_alert.first() is not None:
        logger.info(
            f"Suppressed duplicate anomaly alert for {plate_number}"
        )
        return

    # 5. GENERATE ALERT
    details = (
        f"Implausible transit: {dist_km:.1f} km between "
        f"{prev_cam.name} and {camera_name} "
        f"in {delta_seconds:.0f}s — implied speed "
        f"{speed_kmh:,.0f} km/h exceeds "
        f"{settings.ANOMALY_SPEED_THRESHOLD_KMH:.0f} km/h threshold."
    )

    alert = Alert(
        plate_number=plate_number,
        camera_id=camera_id,
        timestamp=timestamp,
        alert_type="anomaly",
        resolved=False,
        details=details,
        source="detection",
    )

    db.add(alert)

    # Generate the database ID before broadcasting.
    await db.flush()

    await alert_manager.broadcast_alert(
        alert_id=alert.id,
        plate_number=plate_number,
        camera_id=camera_id,
        camera_name=camera_name,
        alert_type="anomaly",
        timestamp=timestamp,
        details=details,
        source="detection",
    )

    logger.warning(
        f"🚧 ROUTE ANOMALY: {plate_number} — {details}"
    )