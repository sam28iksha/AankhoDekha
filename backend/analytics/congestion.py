"""
NAGARNETRA — Congestion / Bottleneck Detection
Compares current event rate to rolling baseline per camera.
"""
from __future__ import annotations

from datetime import timedelta
from typing import List, Dict, Any

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from db.models import PlateEvent, Camera
from utils.geo import haversine_km as _haversine_km
from analytics._time import data_now as _data_now


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
    now = await _data_now(db)
    window_start = now - timedelta(minutes=window_minutes)
    baseline_start = now - timedelta(hours=baseline_hours)

    # Current window event counts
    curr_result = await db.execute(
        select(PlateEvent.camera_id, func.count(PlateEvent.id).label("curr"))
        .where(PlateEvent.timestamp >= window_start)
        .group_by(PlateEvent.camera_id)
    )
    curr_by_cam = {row.camera_id: row.curr for row in curr_result.fetchall()}

    # Baseline event counts — strictly BEFORE the current window, so a spike
    # can't count itself as part of its own "normal" baseline. Without the
    # upper bound here, current-window events were also included in the
    # baseline sum, which forces curr/base to a fixed constant (exactly
    # baseline_windows) for every camera that has any events at all whenever
    # the whole dataset is a single recent burst — the "every camera reads
    # an identical 16.00x" artifact seen on a batch-ingested demo dataset.
    base_result = await db.execute(
        select(PlateEvent.camera_id, func.count(PlateEvent.id).label("base"))
        .where(PlateEvent.timestamp >= baseline_start, PlateEvent.timestamp < window_start)
        .group_by(PlateEvent.camera_id)
    )
    # Convert baseline to "per window" units
    baseline_windows = (baseline_hours * 60) / window_minutes
    base_by_cam = {
        row.camera_id: row.base / baseline_windows
        for row in base_result.fetchall()
    }

    # Fetch cameras — excludes the synthetic upload camera, which shouldn't
    # rank as "most congested" or appear in the congestion table since it's
    # not a real installation.
    cam_result = await db.execute(select(Camera).where(Camera.id != settings.UPLOAD_CAMERA_ID))
    cameras = cam_result.scalars().all()

    # When there's no prior baseline at all (e.g. a freshly ingested demo
    # dataset with no history yet), fall back to relative volume across
    # cameras in the current window rather than a flat constant — so busier
    # cameras still read as more congested than quiet ones instead of every
    # active camera reporting an identical score.
    max_curr = max(curr_by_cam.values(), default=0)

    output = []
    for cam in cameras:
        curr = curr_by_cam.get(cam.id, 0)
        base = base_by_cam.get(cam.id, 0)
        if base > 0:
            score = round(curr / base, 2)
        elif curr > 0:
            score = round(1.5 + (curr / max_curr) * 1.5, 2) if max_curr > 0 else 0.0
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


async def get_speed_estimates(db: AsyncSession, hours: int = 24) -> List[Dict[str, Any]]:
    """
    Estimate average vehicle speed between camera pairs.
    Uses plates seen at >=2 cameras within a reasonable time window.

    Returns list of {origin, destination, avg_speed_kmh, sample_count}
    """
    since = await _data_now(db) - timedelta(hours=hours)

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
