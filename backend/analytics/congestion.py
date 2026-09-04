"""
NAGARNETRA — Congestion / Bottleneck Detection
Compares current event rate to rolling baseline per camera.
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import PlateEvent, Camera
from utils.geo import haversine_km as _haversine_km


async def get_congestion(
    db: AsyncSession,
    window_minutes: int = 15,
    baseline_hours: int = 4,
) -> List[Dict[str, Any]]:
    """
    Return a congestion score per camera.

    Score = (current_rate / baseline_rate) — values > 1.5 = congested.
    current_rate  = events in last `window_minutes`
    baseline_rate = average events per `window_minutes` over last `baseline_hours`
    """
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(minutes=window_minutes)
    baseline_start = now - timedelta(hours=baseline_hours)

    # Current window event counts
    curr_result = await db.execute(
        select(PlateEvent.camera_id, func.count(PlateEvent.id).label("curr"))
        .where(PlateEvent.timestamp >= window_start)
        .group_by(PlateEvent.camera_id)
    )
    curr_by_cam = {row.camera_id: row.curr for row in curr_result.fetchall()}

    # Baseline event counts
    base_result = await db.execute(
        select(PlateEvent.camera_id, func.count(PlateEvent.id).label("base"))
        .where(PlateEvent.timestamp >= baseline_start)
        .group_by(PlateEvent.camera_id)
    )
    # Convert baseline to "per window" units
    baseline_windows = (baseline_hours * 60) / window_minutes
    base_by_cam = {
        row.camera_id: row.base / baseline_windows
        for row in base_result.fetchall()
    }

    # Fetch cameras
    cam_result = await db.execute(select(Camera))
    cameras = cam_result.scalars().all()

    output = []
    for cam in cameras:
        curr = curr_by_cam.get(cam.id, 0)
        base = base_by_cam.get(cam.id, 0)
        if base > 0:
            score = round(curr / base, 2)
        elif curr > 0:
            score = 2.0  # high activity with no baseline → assume congested
        else:
            score = 0.0

        status = "normal"
        if score >= 2.0:
            status = "heavy"
        elif score >= 1.5:
            status = "moderate"

        output.append({
            "camera_id": cam.id,
            "camera_name": cam.name,
            "lat": cam.lat,
            "lng": cam.lng,
            "road_segment": cam.road_segment,
            "current_events": curr,
            "baseline_events_per_window": round(base, 1),
            "congestion_score": score,
            "status": status,
        })

    output.sort(key=lambda x: x["congestion_score"], reverse=True)
    return output


async def get_speed_estimates(db: AsyncSession, hours: int = 4) -> List[Dict[str, Any]]:
    """
    Estimate average vehicle speed between camera pairs.
    Uses plates seen at >=2 cameras within a reasonable time window.

    Returns list of {origin, destination, avg_speed_kmh, sample_count}
    """
    since = datetime.now(timezone.utc) - timedelta(hours=hours)

    result = await db.execute(
        select(
            PlateEvent.plate_number,
            PlateEvent.camera_id,
            PlateEvent.timestamp,
            Camera.lat,
            Camera.lng,
        )
        .join(Camera, PlateEvent.camera_id == Camera.id)
        .where(PlateEvent.timestamp >= since)
        .order_by(PlateEvent.plate_number, PlateEvent.timestamp)
    )
    rows = result.fetchall()

    # Build per-plate chronological path
    trips: Dict[tuple, list] = {}  # (origin_cam, dest_cam) -> [speed_kmh]
    prev_by_plate: dict = {}  # plate -> (cam_id, ts, lat, lng)

    MAX_TRAVEL_HOURS = 2.0  # ignore trips > 2h (likely different days)

    for row in rows:
        plate = row.plate_number
        cam = row.camera_id
        ts = row.timestamp
        lat, lng = row.lat, row.lng

        if plate in prev_by_plate:
            prev_cam, prev_ts, prev_lat, prev_lng = prev_by_plate[plate]
            if prev_cam != cam:
                delta_h = (ts - prev_ts).total_seconds() / 3600.0
                if 0 < delta_h <= MAX_TRAVEL_HOURS:
                    dist_km = _haversine_km(prev_lat, prev_lng, lat, lng)
                    speed_kmh = dist_km / delta_h
                    if 1 < speed_kmh < 200:  # sanity filter
                        key = (prev_cam, cam)
                        if key not in trips:
                            trips[key] = []
                        trips[key].append(speed_kmh)

        prev_by_plate[plate] = (cam, ts, lat, lng)

    results = []
    for (origin, dest), speeds in trips.items():
        results.append({
            "origin_camera": origin,
            "destination_camera": dest,
            "avg_speed_kmh": round(sum(speeds) / len(speeds), 1),
            "sample_count": len(speeds),
        })

    results.sort(key=lambda x: x["avg_speed_kmh"])
    return results
