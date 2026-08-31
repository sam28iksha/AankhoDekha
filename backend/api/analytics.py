"""
NAGARNETRA — Analytics API
GET /analytics/density
GET /analytics/od-matrix
GET /analytics/congestion
GET /analytics/speed
GET /analytics/summary
GET /analytics/cameras
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from db.base import get_db
from db.models import PlateEvent, Camera, Alert
from analytics.density import get_density
from analytics.od_matrix import get_od_matrix
from analytics.congestion import get_congestion, get_speed_estimates

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/density")
async def density_endpoint(
    hours: int = Query(24, ge=1, le=168),
    db: AsyncSession = Depends(get_db),
):
    """Traffic density per camera over the last N hours."""
    return await get_density(db, hours=hours)


@router.get("/od-matrix")
async def od_matrix_endpoint(
    hours: int = Query(24, ge=1, le=168),
    min_trips: int = Query(1, ge=1),
    db: AsyncSession = Depends(get_db),
):
    """Origin-destination flow matrix between camera pairs."""
    return await get_od_matrix(db, hours=hours, min_trips=min_trips)


@router.get("/congestion")
async def congestion_endpoint(
    window_minutes: int = Query(15, ge=5, le=60),
    baseline_hours: int = Query(4, ge=1, le=24),
    db: AsyncSession = Depends(get_db),
):
    """Congestion / bottleneck scores per camera."""
    return await get_congestion(db, window_minutes=window_minutes, baseline_hours=baseline_hours)


@router.get("/speed")
async def speed_endpoint(
    hours: int = Query(4, ge=1, le=24),
    db: AsyncSession = Depends(get_db),
):
    """Average speed estimates between camera pairs."""
    return await get_speed_estimates(db, hours=hours)


@router.get("/cameras")
async def get_cameras(db: AsyncSession = Depends(get_db)):
    """Return all registered cameras with their metadata."""
    result = await db.execute(select(Camera))
    cameras = result.scalars().all()
    return [
        {
            "camera_id": c.id,
            "name": c.name,
            "lat": c.lat,
            "lng": c.lng,
            "road_segment": c.road_segment,
        }
        for c in cameras
    ]


@router.get("/summary")
async def get_summary(db: AsyncSession = Depends(get_db)):
    """
    Dashboard summary stats:
    - Total vehicles seen today
    - Active (unresolved) alerts
    - Total events ever
    - Distinct plates ever seen
    """
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    # Today's distinct plates
    today_plates_result = await db.execute(
        select(func.count(PlateEvent.plate_number.distinct()))
        .where(PlateEvent.timestamp >= today)
    )
    today_vehicles = today_plates_result.scalar() or 0

    # Active alerts
    active_alerts_result = await db.execute(
        select(func.count(Alert.id)).where(Alert.resolved == False)
    )
    active_alerts = active_alerts_result.scalar() or 0

    # Total events
    total_events_result = await db.execute(select(func.count(PlateEvent.id)))
    total_events = total_events_result.scalar() or 0

    # Total distinct plates
    distinct_plates_result = await db.execute(
        select(func.count(PlateEvent.plate_number.distinct()))
    )
    distinct_plates = distinct_plates_result.scalar() or 0

    return {
        "vehicles_seen_today": today_vehicles,
        "active_alerts": active_alerts,
        "total_events": total_events,
        "distinct_plates_total": distinct_plates,
        "as_of": datetime.now(timezone.utc).isoformat(),
    }
