"""
NAGARNETRA — Audit Log API (admin only)
GET /audit-log
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import require_role
from db.base import get_db
from db.models import AuditLog, User

router = APIRouter(tags=["audit"])


@router.get("/audit-log")
async def list_audit_log(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_role("admin")),
    username: str | None = Query(None),
    action: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    query = select(AuditLog)
    if username:
        query = query.where(AuditLog.username == username)
    if action:
        query = query.where(AuditLog.action == action)
    query = query.order_by(desc(AuditLog.timestamp)).limit(limit).offset(offset)

    result = await db.execute(query)
    rows = result.scalars().all()
    return [
        {
            "id": r.id,
            "username": r.username,
            "action": r.action,
            "target": r.target,
            "details": r.details,
            "timestamp": r.timestamp.isoformat(),
        }
        for r in rows
    ]
