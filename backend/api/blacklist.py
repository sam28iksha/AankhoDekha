"""
AANKHODEKHA — Blacklist Management API
GET    /blacklist              — list all blacklisted plates
POST   /blacklist               — add (or update the reason for) a plate
DELETE /blacklist/{plate_number} — remove a plate from the blacklist
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.audit import log_action
from auth.dependencies import require_role
from db.base import get_db
from db.models import Blacklist, User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/blacklist", tags=["blacklist"])


class BlacklistCreate(BaseModel):
    plate_number: str = Field(..., min_length=2, max_length=20)
    reason: str | None = None


@router.get("")
async def list_blacklist(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_role("viewer")),
):
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
async def add_to_blacklist(
    payload: BlacklistCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_role("investigator")),
):
    """
    Add a plate to the blacklist (or update its reason if already present).
    This only manages the watchlist — it does not, by itself, mean the
    vehicle has been spotted. Real alerts come from an actual detection
    matching this entry (see api/ingest.py), or, for demo purposes, an
    explicit call to POST /alerts/simulate.
    """
    normalized = payload.plate_number.upper().strip()
    existing = await db.get(Blacklist, normalized)
    if existing:
        existing.reason = payload.reason
        await log_action(db, user, "blacklist_update", target=normalized, details=payload.reason)
        await db.commit()
        return {"message": "Blacklist entry updated", "plate_number": normalized}

    db.add(Blacklist(plate_number=normalized, reason=payload.reason))
    await log_action(db, user, "blacklist_add", target=normalized, details=payload.reason)
    await db.commit()
    logger.info(f"Blacklist: added {normalized}")
    return {"message": "Plate added to blacklist", "plate_number": normalized}


@router.delete("/{plate_number}")
async def remove_from_blacklist(
    plate_number: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_role("investigator")),
):
    """Remove a plate from the blacklist."""
    normalized = plate_number.upper().strip()
    existing = await db.get(Blacklist, normalized)
    if existing is None:
        raise HTTPException(status_code=404, detail="Plate not found on blacklist")
    await db.delete(existing)
    await log_action(db, user, "blacklist_remove", target=normalized)
    await db.commit()
    logger.info(f"Blacklist: removed {normalized}")
    return {"message": "Plate removed from blacklist", "plate_number": normalized}
