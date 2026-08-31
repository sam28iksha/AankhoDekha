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

from db.base import get_db
from db.models import PlateEvent, Camera, Blacklist

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/vehicle", tags=["vehicle"])


@router.get("/{plate_number}/history")
async def get_vehicle_history(
    plate_number: str,
    db: AsyncSession = Depends(get_db),
    limit: int = Query(500, ge=1, le=5000),
):
    """
    Return chronological sighting history for a plate number.
    Each sighting includes camera metadata (lat/lng) for map trajectory drawing.
    """
    normalized = plate_number.upper().strip()

    result = await db.execute(
        select(PlateEvent, Camera)
        .join(Camera, PlateEvent.camera_id == Camera.id)
        .where(PlateEvent.plate_number == normalized)
        .order_by(PlateEvent.timestamp.asc())
        .limit(limit)
    )
    rows = result.fetchall()

    if not rows:
        return {
            "plate_number": normalized,
            "total_sightings": 0,
            "sightings": [],
            "trajectory": [],
            "blacklisted": False,
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

    # Blacklist check
    bl = await db.get(Blacklist, normalized)
    blacklist_info = None
    if bl:
        blacklist_info = {
            "reason": bl.reason,
            "added_at": bl.added_at.isoformat(),
        }

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
    }


@router.get("/{plate_number}/blacklist-status")
async def get_blacklist_status(
    plate_number: str,
    db: AsyncSession = Depends(get_db),
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
):
    """Fuzzy plate search — returns distinct plate numbers matching partial query."""
    normalized = q.upper().strip()
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
