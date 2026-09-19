"""
AANKHODEKHA — Shared time anchor for recent-window analytics.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from db.models import PlateEvent


async def data_now(db: AsyncSession) -> datetime:
    """
    Reference "now" for recent-window analytics (density, congestion, speed,
    OD matrix).

    Anchored to the most recent PlateEvent timestamp rather than the wall
    clock: on a live deployment ingestion is continuous, so this is
    effectively the same as datetime.now(). On a demo dataset ingested once
    and then viewed hours or days later, wall-clock "last N hours" windows
    silently go empty even though the data itself hasn't changed — anchoring
    to the latest event keeps "recent" meaningful regardless of when the
    dashboard is actually viewed.

    Excludes the synthetic upload camera: it's excluded from the camera
    lists these windows feed (congestion ranking, density), so it must also
    be excluded from setting the clock — otherwise an ad-hoc test upload
    (which can happen at any time, unrelated to real camera activity) pushes
    "now" forward past all the real cameras' actual recent activity, making
    every real camera read as having zero recent events.
    """
    result = await db.execute(
        select(func.max(PlateEvent.timestamp))
        .where(PlateEvent.camera_id != settings.UPLOAD_CAMERA_ID)
    )
    latest = result.scalar()
    if latest is None:
        return datetime.now(timezone.utc)
    return latest if latest.tzinfo else latest.replace(tzinfo=timezone.utc)
