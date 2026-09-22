"""
AANKHODEKHA — Vehicle Search & History API

GET /vehicle/{plate_number}/history
GET /vehicle/{plate_number}/blacklist-status
GET /vehicle/entity/{vehicle_id}
GET /vehicle/search?q=PARTIAL_PLATE
GET /vehicle/top
"""

from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.audit import log_action
from auth.dependencies import require_role
from db.base import get_db
from db.models import Blacklist, Camera, PlateEvent, User, Vehicle
from utils.geo import (
    bearing_deg,
    compass_label,
    duration_label,
    haversine_km,
)

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

    Each sighting includes camera metadata (lat/lng) for map trajectory
    drawing. Consecutive sightings are also converted into trajectory legs
    containing distance, duration, direction, and average speed.

    This is the single most sensitive read in the system because it
    reconstructs a specific vehicle's movement history. Every search is
    therefore audited with the requesting user and searched plate.
    """

    normalized = plate_number.upper().strip()

    await log_action(
        db,
        user,
        "vehicle_search",
        target=normalized,
    )

    await db.commit()

    # Deterministic chronological ordering.
    #
    # timestamp is the primary ordering key.
    # PlateEvent.id is the deterministic tie-breaker when multiple events
    # have the exact same timestamp.
    result = await db.execute(
        select(PlateEvent, Camera)
        .join(Camera, PlateEvent.camera_id == Camera.id)
        .where(PlateEvent.plate_number == normalized)
        .order_by(
            PlateEvent.timestamp.asc(),
            PlateEvent.id.asc(),
        )
        .limit(limit)
    )

    rows = result.fetchall()

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

    sightings: list[dict] = []
    trajectory: list[list[float]] = []

    for event, cam in rows:
        sightings.append(
    {
        "event_id": event.id,
        "plate_number": event.plate_number,
        "vehicle_id": event.vehicle_id,
        "camera_id": cam.id,
        "camera_name": cam.name,
        "lat": cam.lat,
        "lng": cam.lng,
        "road_segment": cam.road_segment,
        "timestamp": event.timestamp.isoformat(),
        "confidence": event.confidence,
        "snapshot_path": event.frame_snapshot_path,
        "vehicle_type": event.vehicle_type,
        "color": event.color,
    }
)

        trajectory.append([cam.lat, cam.lng])

    legs: list[dict] = []

    for prev, curr in zip(sightings, sightings[1:]):
        prev_ts = datetime.fromisoformat(prev["timestamp"])
        curr_ts = datetime.fromisoformat(curr["timestamp"])

        seconds = (curr_ts - prev_ts).total_seconds()

        dist_km = haversine_km(
            prev["lat"],
            prev["lng"],
            curr["lat"],
            curr["lng"],
        )

        has_movement = dist_km >= 0.01

        deg = (
            bearing_deg(
                prev["lat"],
                prev["lng"],
                curr["lat"],
                curr["lng"],
            )
            if has_movement
            else None
        )

        avg_speed_kmh = (
            round(dist_km / (seconds / 3600), 1)
            if seconds > 0 and has_movement
            else None
        )

        legs.append(
            {
                "from_camera_id": prev["camera_id"],
                "to_camera_id": curr["camera_id"],
                "from_camera_name": prev["camera_name"],
                "to_camera_name": curr["camera_name"],
                "duration_seconds": round(seconds, 1),
                "duration_label": duration_label(seconds),
                "distance_km": round(dist_km, 2),
                "avg_speed_kmh": avg_speed_kmh,
                "bearing_deg": round(deg, 1) if deg is not None else None,
                "direction": (
                    compass_label(deg)
                    if deg is not None
                    else None
                ),
            }
        )

    cameras_visited = list(
        dict.fromkeys(
            sighting["camera_id"]
            for sighting in sightings
        )
    )

    vehicle_ids = list(
    dict.fromkeys(
        sighting["vehicle_id"]
        for sighting in sightings
        if sighting["vehicle_id"]
    )
)

    return {
    "plate_number": normalized,
    "vehicle_ids": vehicle_ids,
    "total_sightings": len(sightings),
    "blacklisted": bl is not None,
    "blacklist_info": blacklist_info,
    "first_seen": sightings[0]["timestamp"],
    "last_seen": sightings[-1]["timestamp"],
    "cameras_visited": cameras_visited,
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


@router.get("/entity/{vehicle_id}")
async def get_vehicle_entity_history(
    vehicle_id: str,
    db: AsyncSession = Depends(get_db),
    limit: int = Query(500, ge=1, le=5000),
    user: User = Depends(require_role("viewer")),
):
    """
    Return chronological sighting history for a specific physical Vehicle entity
    identified by its unique vehicle_id.
    
    Tracks vehicle-centric trajectory and exposes plates_observed to maintain
    full transparency in case of plate inconsistencies.
    """
    normalized_id = vehicle_id.upper().strip()

    await log_action(
        db,
        user,
        "vehicle_entity_search",
        target=normalized_id,
    )

    await db.commit()

    vehicle = await db.get(Vehicle, normalized_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail=f"Vehicle entity '{normalized_id}' not found")

    result = await db.execute(
        select(PlateEvent, Camera)
        .join(Camera, PlateEvent.camera_id == Camera.id)
        .where(PlateEvent.vehicle_id == normalized_id)
        .order_by(
            PlateEvent.timestamp.asc(),
            PlateEvent.id.asc(),
        )
        .limit(limit)
    )

    rows = result.fetchall()

    if not rows:
        return {
        "vehicle_id": vehicle.id,
        "plates_observed": [],
        "total_sightings": 0,
        "first_seen": vehicle.first_seen.isoformat() if vehicle.first_seen else None,
        "last_seen": vehicle.last_seen.isoformat() if vehicle.last_seen else None,
        "cameras_visited": [],
        "sightings": [],
        "trajectory": [],
        "legs": [],
    }

    sightings: list[dict] = []
    trajectory: list[list[float]] = []

    for event, cam in rows:
        sightings.append(
            {
                "event_id": event.id,
                "plate_number": event.plate_number,
                "vehicle_type": event.vehicle_type,
                "color": event.color,
                "camera_id": cam.id,
                "camera_name": cam.name,
                "lat": cam.lat,
                "lng": cam.lng,
                "road_segment": cam.road_segment,
                "timestamp": event.timestamp.isoformat(),
                "confidence": event.confidence,
                "snapshot_path": event.frame_snapshot_path,
            }
        )
        trajectory.append([cam.lat, cam.lng])

    legs: list[dict] = []
    for prev, curr in zip(sightings, sightings[1:]):
        prev_ts = datetime.fromisoformat(prev["timestamp"])
        curr_ts = datetime.fromisoformat(curr["timestamp"])

        seconds = (curr_ts - prev_ts).total_seconds()
        dist_km = haversine_km(prev["lat"], prev["lng"], curr["lat"], curr["lng"])
        has_movement = dist_km >= 0.01

        deg = bearing_deg(prev["lat"], prev["lng"], curr["lat"], curr["lng"]) if has_movement else None
        avg_speed_kmh = round(dist_km / (seconds / 3600), 1) if seconds > 0 and has_movement else None

        legs.append(
            {
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
            }
        )

    cameras_visited = list(dict.fromkeys(sighting["camera_id"] for sighting in sightings))
    plates_observed = list(dict.fromkeys(sighting["plate_number"] for sighting in sightings))

    return {
        "vehicle_id": vehicle.id,
        "plates_observed": plates_observed,
        "vehicle_type": rows[0][0].vehicle_type,
        "color": rows[0][0].color,
        "total_sightings": len(sightings),
        "first_seen": vehicle.first_seen.isoformat() if vehicle.first_seen else sightings[0]["timestamp"],
        "last_seen": vehicle.last_seen.isoformat() if vehicle.last_seen else sightings[-1]["timestamp"],
        "cameras_visited": cameras_visited,
        "sightings": sightings,
        "trajectory": trajectory,
        "legs": legs,
    }


@router.get("/search")
async def search_plates(
    q: str = Query(..., min_length=2),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(20, ge=1, le=100),
    user: User = Depends(require_role("viewer")),
):
    """
    Fuzzy plate search.

    Returns distinct plate numbers containing the supplied partial query,
    ordered by number of sightings.
    """

    normalized = q.upper().strip()

    await log_action(
        db,
        user,
        "vehicle_search_fuzzy",
        target=normalized,
    )
    await db.commit()

    result = await db.execute(
        select(
            PlateEvent.plate_number,
            func.count(PlateEvent.id).label("hits"),
        )
        .where(
            PlateEvent.plate_number.contains(normalized)
        )
        .group_by(PlateEvent.plate_number)
        .order_by(
            func.count(PlateEvent.id).desc(),
            PlateEvent.plate_number.asc(),
        )
        .limit(limit)
    )

    rows = result.fetchall()

    return [
        {
            "plate_number": row.plate_number,
            "sighting_count": row.hits,
        }
        for row in rows
    ]


@router.get("/top")
async def get_top_plates(
    db: AsyncSession = Depends(get_db),
    limit: int = Query(20, ge=1, le=200),
    _user: User = Depends(require_role("viewer")),
):
    """
    Return the most-seen plates.

    Useful for identifying frequently observed vehicles and for
    blacklist-management workflows after ingestion.
    """

    result = await db.execute(
        select(
            PlateEvent.plate_number,
            func.count(PlateEvent.id).label("sighting_count"),
            func.max(PlateEvent.confidence).label("max_confidence"),
            func.max(PlateEvent.timestamp).label("last_seen"),
        )
        .group_by(PlateEvent.plate_number)
        .order_by(
            func.count(PlateEvent.id).desc(),
            PlateEvent.plate_number.asc(),
        )
        .limit(limit)
    )

    rows = result.fetchall()

    return [
        {
            "plate_number": row.plate_number,
            "sighting_count": row.sighting_count,
            "max_confidence": round(row.max_confidence, 3),
            "last_seen": (
                row.last_seen.isoformat()
                if row.last_seen
                else None
            ),
        }
        for row in rows
    ]