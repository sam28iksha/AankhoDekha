"""
NAGARNETRA — Traffic Density Analytics
Counts plate events per camera/time bucket.
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any

from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import PlateEvent, Camera


async def get_density(
    db: AsyncSession,
    hours: int = 24,
    bucket_minutes: int = 60,
) -> List[Dict[str, Any]]:
    """
    Return event counts per camera over the last `hours` hours,
    bucketed into `bucket_minutes`-minute windows.
    """
    since = datetime.now(timezone.utc) - timedelta(hours=hours)

    # Aggregate by camera
    result = await db.execute(
        select(
            PlateEvent.camera_id,
            Camera.name,
            Camera.lat,
            Camera.lng,
            func.count(PlateEvent.id).label("event_count"),
        )
        .join(Camera, PlateEvent.camera_id == Camera.id)
        .where(PlateEvent.timestamp >= since)
        .group_by(PlateEvent.camera_id, Camera.name, Camera.lat, Camera.lng)
        .order_by(func.count(PlateEvent.id).desc())
    )
    rows = result.fetchall()

    return [
        {
            "camera_id": row.camera_id,
            "camera_name": row.name,
            "lat": row.lat,
            "lng": row.lng,
            "event_count": row.event_count,
        }
        for row in rows
    ]


async def get_citywide_timeseries(
    db: AsyncSession,
    hours: int = 24,
) -> List[Dict[str, Any]]:
    """
    Return city-wide hourly event counts across all cameras — backs the
    Analytics page's "Traffic Flow Trend" chart.
    """
    since = datetime.now(timezone.utc) - timedelta(hours=hours)

    result = await db.execute(
        select(
            func.strftime("%Y-%m-%dT%H:00:00", PlateEvent.timestamp).label("hour"),
            func.count(PlateEvent.id).label("count"),
        )
        .where(PlateEvent.timestamp >= since)
        .group_by(text("hour"))
        .order_by(text("hour"))
    )
    rows = result.fetchall()
    return [{"hour": row.hour, "count": row.count} for row in rows]


async def get_density_timeseries(
    db: AsyncSession,
    camera_id: str,
    hours: int = 24,
) -> List[Dict[str, Any]]:
    """
    Return hourly event counts for a specific camera.
    Used for per-camera sparkline charts.
    """
    since = datetime.now(timezone.utc) - timedelta(hours=hours)

    # SQLite-compatible: use strftime for bucketing
    result = await db.execute(
        select(
            func.strftime("%Y-%m-%dT%H:00:00", PlateEvent.timestamp).label("hour"),
            func.count(PlateEvent.id).label("count"),
        )
        .where(
            PlateEvent.camera_id == camera_id,
            PlateEvent.timestamp >= since,
        )
        .group_by(text("hour"))
        .order_by(text("hour"))
    )
    rows = result.fetchall()
    return [{"hour": row.hour, "count": row.count} for row in rows]
