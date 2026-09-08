"""
NAGARNETRA — Vehicle Search & History API
GET /vehicle/{plate_number}/history
GET /vehicle/{plate_number}/blacklist-status
GET /vehicles/search?q=PARTIAL_PLATE
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from auth.audit import log_action
from auth.dependencies import require_role
from db.base import get_db
from db.models import PlateEvent, Camera, Blacklist, User
from utils.geo import haversine_km, bearing_deg, compass_label, duration_label

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/vehicle", tags=["vehicle"])


@router.get("/{plate_number}/history")
async def get_vehicle_history(
    plate_number: str,
    db: AsyncSession = Depends(get_db),
    limit: int = Query(500, ge=1, le=5000),
    user: User = Depends(require_role("viewer")),
):
    """
    Return chronological sighting history for a plate number.
    Each sighting includes camera metadata (lat/lng) for map trajectory drawing.

    This is the single most sensitive read in the system — it reconstructs
    a specific vehicle's movement history — so every call is audited with
    who searched, what plate, and when.
    """
    normalized = plate_number.upper().strip()
    await log_action(db, user, "vehicle_search", target=normalized)

    result = await db.execute(
        select(PlateEvent, Camera)
        .join(Camera, PlateEvent.camera_id == Camera.id)
        .where(PlateEvent.plate_number == normalized)
        .order_by(PlateEvent.timestamp.asc())
        .limit(limit)
    )
    rows = result.fetchall()

    # A plate can be blacklisted pre-emptively before ever being sighted, so
    # this check always runs — even with zero rows — and the response below
    # always carries the full shape (cameras_visited, blacklist_info, etc.)
    # regardless of whether there are any sightings. A previous version
    # short-circuited here with a partial object when rows was empty, which
    # omitted "cameras_visited" entirely and crashed the frontend (reading
    # .length on undefined) for any blacklisted-but-unsighted plate.
    bl = await db.get(Blacklist, normalized)
    blacklist_info = None
    if bl:
        blacklist_info = {
            "reason": bl.reason,
            "added_at": bl.added_at.isoformat(),
        }

    if not rows:
        return {
            "plate_number": normalized,
            "total_sightings": 0,
            "blacklisted": bl is not None,
            "blacklist_info": blacklist_info,
            "first_seen": None,
            "last_seen": None,
            "cameras_visited": [],
            "sightings": [],
            "trajectory": [],
            "legs": [],
        }

    sightings = []
    trajectory = []
    for event, cam in rows:
        sightings.append({
            "event_id": event.id,
            "camera_id": cam.id,
            "camera_name": cam.name,
            "lat": cam.lat,
            "lng": cam.lng,
            "road_segment": cam.road_segment,
            "timestamp": event.timestamp.isoformat(),
            "confidence": event.confidence,
            "snapshot_path": event.frame_snapshot_path,
        })
        trajectory.append([cam.lat, cam.lng])

    # Direction + timing between consecutive sightings ("legs" of the trip)
    legs = []
    for prev, curr in zip(sightings, sightings[1:]):
        prev_ts = datetime.fromisoformat(prev["timestamp"])
        curr_ts = datetime.fromisoformat(curr["timestamp"])
        seconds = (curr_ts - prev_ts).total_seconds()
        dist_km = haversine_km(prev["lat"], prev["lng"], curr["lat"], curr["lng"])
        has_movement = dist_km >= 0.01  # same-camera re-sightings have no meaningful direction
        deg = bearing_deg(prev["lat"], prev["lng"], curr["lat"], curr["lng"]) if has_movement else None
        avg_speed_kmh = round(dist_km / (seconds / 3600), 1) if seconds > 0 and has_movement else None
        legs.append({
            "from_camera_id": prev["camera_id"],
            "to_camera_id": curr["camera_id"],
            "from_camera_name": prev["camera_name"],
            "to_camera_name": curr["camera_name"],
            "duration_seconds": round(seconds, 1),
            "duration_label": duration_label(seconds),
            "distance_km": round(dist_km, 2),
            "avg_speed_kmh": avg_speed_kmh,
            "bearing_deg": round(deg, 1) if deg is not None else None,
            "direction": compass_label(deg) if deg is not None else None,
        })

    return {
        "plate_number": normalized,
        "total_sightings": len(sightings),
        "blacklisted": bl is not None,
        "blacklist_info": blacklist_info,
        "first_seen": sightings[0]["timestamp"] if sightings else None,
        "last_seen": sightings[-1]["timestamp"] if sightings else None,
        "cameras_visited": list({s["camera_id"] for s in sightings}),
        "sightings": sightings,
        "trajectory": trajectory,
        "legs": legs,
    }


@router.get("/{plate_number}/blacklist-status")
async def get_blacklist_status(
    plate_number: str,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_role("viewer")),
):
    """Check if a plate is on the blacklist."""
    normalized = plate_number.upper().strip()
    bl = await db.get(Blacklist, normalized)
    return {
        "plate_number": normalized,
        "blacklisted": bl is not None,
        "reason": bl.reason if bl else None,
        "added_at": bl.added_at.isoformat() if bl else None,
    }


@router.get("s/search")
async def search_plates(
    q: str = Query(..., min_length=2),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(20, ge=1, le=100),
    user: User = Depends(require_role("viewer")),
):
    """Fuzzy plate search — returns distinct plate numbers matching partial query."""
    normalized = q.upper().strip()
    await log_action(db, user, "vehicle_search_fuzzy", target=normalized)
    result = await db.execute(
        select(PlateEvent.plate_number, func.count(PlateEvent.id).label("hits"))
        .where(PlateEvent.plate_number.contains(normalized))
        .group_by(PlateEvent.plate_number)
        .order_by(func.count(PlateEvent.id).desc())
        .limit(limit)
    )
    rows = result.fetchall()
    return [{"plate_number": row.plate_number, "sighting_count": row.hits} for row in rows]


@router.get("s/top")
async def get_top_plates(
    db: AsyncSession = Depends(get_db),
    limit: int = Query(20, ge=1, le=200),
    _user: User = Depends(require_role("viewer")),
):
    """Return most-seen plates (useful for blacklist selection after first ingestion)."""
    result = await db.execute(
        select(
            PlateEvent.plate_number,
            func.count(PlateEvent.id).label("sighting_count"),
            func.max(PlateEvent.confidence).label("max_confidence"),
            func.max(PlateEvent.timestamp).label("last_seen"),
        )
        .group_by(PlateEvent.plate_number)
        .order_by(func.count(PlateEvent.id).desc())
        .limit(limit)
    )
    rows = result.fetchall()
    return [
        {
            "plate_number": row.plate_number,
            "sighting_count": row.sighting_count,
            "max_confidence": round(row.max_confidence, 3),
            "last_seen": row.last_seen.isoformat() if row.last_seen else None,
        }
        for row in rows
    ]
