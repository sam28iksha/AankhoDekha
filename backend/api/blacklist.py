"""
NAGARNETRA — Blacklist Management API
GET    /blacklist              — list all blacklisted plates
POST   /blacklist               — add (or update the reason for) a plate
DELETE /blacklist/{plate_number} — remove a plate from the blacklist
"""
from __future__ import annotations

import logging
import random
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.base import get_db
from db.models import Alert, Blacklist, Camera
from api.alert_manager import alert_manager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/blacklist", tags=["blacklist"])


async def _fire_spotted_alert(db: AsyncSession, plate_number: str, reason: str | None) -> None:
    """
    As soon as a plate is blacklisted, immediately simulate it being "spotted"
    at a random camera — for demo purposes, so the notification appears
    without needing a real detection to happen first.
    """
    cam_result = await db.execute(select(Camera))
    cameras = cam_result.scalars().all()
    if not cameras:
        return
    camera = random.choice(cameras)
    timestamp = datetime.now(timezone.utc)
    details = f"Blacklisted vehicle spotted. Reason: {reason}" if reason else "Blacklisted vehicle spotted."

    alert = Alert(
        plate_number=plate_number,
        camera_id=camera.id,
        timestamp=timestamp,
        alert_type="blacklist_hit",
        resolved=False,
        details=details,
    )
    db.add(alert)
    await db.commit()
    await db.refresh(alert)

    await alert_manager.broadcast_alert(
        alert_id=alert.id,
        plate_number=plate_number,
        camera_id=camera.id,
        camera_name=camera.name,
        alert_type="blacklist_hit",
        timestamp=timestamp,
        details=details,
    )
    logger.info(f"Blacklist: simulated spotted-alert for {plate_number} @ {camera.name}")


class BlacklistCreate(BaseModel):
    plate_number: str = Field(..., min_length=2, max_length=20)
    reason: str | None = None


@router.get("")
async def list_blacklist(db: AsyncSession = Depends(get_db)):
    """List all blacklisted plates, most recently added first."""
    result = await db.execute(select(Blacklist).order_by(Blacklist.added_at.desc()))
    entries = result.scalars().all()
    return [
        {
            "plate_number": e.plate_number,
            "reason": e.reason,
            "added_at": e.added_at.isoformat(),
        }
        for e in entries
    ]


@router.post("")
async def add_to_blacklist(payload: BlacklistCreate, db: AsyncSession = Depends(get_db)):
    """Add a plate to the blacklist (or update its reason if already present)."""
    normalized = payload.plate_number.upper().strip()
    existing = await db.get(Blacklist, normalized)
    if existing:
        existing.reason = payload.reason
        await db.commit()
        await _fire_spotted_alert(db, normalized, payload.reason)
        return {"message": "Blacklist entry updated", "plate_number": normalized}

    db.add(Blacklist(plate_number=normalized, reason=payload.reason))
    await db.commit()
    logger.info(f"Blacklist: added {normalized}")
    await _fire_spotted_alert(db, normalized, payload.reason)
    return {"message": "Plate added to blacklist", "plate_number": normalized}


@router.delete("/{plate_number}")
async def remove_from_blacklist(plate_number: str, db: AsyncSession = Depends(get_db)):
    """Remove a plate from the blacklist."""
    normalized = plate_number.upper().strip()
    existing = await db.get(Blacklist, normalized)
    if existing is None:
        raise HTTPException(status_code=404, detail="Plate not found on blacklist")
    await db.delete(existing)
    await db.commit()
    logger.info(f"Blacklist: removed {normalized}")
    return {"message": "Plate removed from blacklist", "plate_number": normalized}
