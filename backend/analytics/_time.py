"""
NAGARNETRA — Shared time anchor for recent-window analytics.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

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
    """
    result = await db.execute(select(func.max(PlateEvent.timestamp)))
    latest = result.scalar()
    if latest is None:
        return datetime.now(timezone.utc)
    return latest if latest.tzinfo else latest.replace(tzinfo=timezone.utc)
