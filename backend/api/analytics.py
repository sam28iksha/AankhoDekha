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

from config import settings
from db.base import get_db
from db.models import PlateEvent, Camera, Alert
from analytics.density import get_density, get_citywide_timeseries
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


@router.get("/timeseries")
async def timeseries_endpoint(
    hours: int = Query(24, ge=1, le=168),
    db: AsyncSession = Depends(get_db),
):
    """City-wide hourly traffic volume — feeds the Analytics 'Traffic Flow Trend' chart."""
    return await get_citywide_timeseries(db, hours=hours)


@router.get("/overview")
async def overview_endpoint(db: AsyncSession = Depends(get_db)):
    """
    Hero-card numbers for the Analytics page: busiest corridor, most congested
    area, city-wide average speed, and count of active OD routes — computed
    from the same queries the rest of the page already uses, in one round trip.
    """
    density = await get_density(db, hours=24)
    congestion = await get_congestion(db)
    speeds = await get_speed_estimates(db)
    od = await get_od_matrix(db, hours=24)

    busiest = density[0] if density else None
    most_congested = congestion[0] if congestion and congestion[0]["congestion_score"] > 0 else None
    avg_speed = round(sum(s["avg_speed_kmh"] for s in speeds) / len(speeds), 1) if speeds else None

    return {
        "busiest_camera": {
            "camera_id": busiest["camera_id"],
            "camera_name": busiest["camera_name"],
            "event_count": busiest["event_count"],
        } if busiest else None,
        "most_congested": {
            "camera_id": most_congested["camera_id"],
            "camera_name": most_congested["camera_name"],
            "road_segment": most_congested["road_segment"],
            "status": most_congested["status"],
            "congestion_score": most_congested["congestion_score"],
        } if most_congested else None,
        "citywide_avg_speed_kmh": avg_speed,
        "active_routes": len(od["flows"]),
    }


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
    hours: int = Query(24, ge=1, le=24),
    db: AsyncSession = Depends(get_db),
):
    """Average speed estimates between camera pairs."""
    return await get_speed_estimates(db, hours=hours)


@router.get("/cameras")
async def get_cameras(db: AsyncSession = Depends(get_db)):
    """
    Return all registered cameras with their metadata. Excludes the
    synthetic upload camera — not a real installation, so it shouldn't
    appear in camera-selection UI (OCR Preview's picker, map markers).
    """
    result = await db.execute(select(Camera).where(Camera.id != settings.UPLOAD_CAMERA_ID))
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
