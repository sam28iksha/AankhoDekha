"""
NAGARNETRA — Audit logging helper.
Called from routers at the point of a sensitive action — not a decorator
or middleware, so what gets logged and with what detail stays explicit
and readable at each call site.
"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from db.models import AuditLog, User


async def log_action(
    db: AsyncSession,
    user: User | None,
    action: str,
    target: str | None = None,
    details: str | None = None,
) -> None:
    """
    Does not commit — callers already commit alongside their own writes
    (matching the pattern used by check_speed_anomaly's db.flush()), except
    for read-only actions like a vehicle search, where this does need its
    own commit since there's no other write in that request to piggyback on.
    """
    entry = AuditLog(
        user_id=user.id if user else None,
        username=user.username if user else "unknown",
        action=action,
        target=target,
        details=details,
    )
    db.add(entry)
    await db.flush()
