"""
AANKHODEKHA — Health & Observability API
GET /health (Public Readiness)
GET /health/metrics (Protected Observability)
"""
from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import require_role
from db.base import get_db
from db.models import Camera, PlateEvent, Alert, User
from utils.metrics import metrics

router = APIRouter(prefix="/health", tags=["health"])

@router.get("")
async def liveness_check():
    """Public readiness endpoint for basic load-balancer pings."""
    return {"status": "ok", "uptime_seconds": metrics.uptime_seconds}


@router.get("/metrics")
async def get_system_metrics(
    db: AsyncSession = Depends(get_db)
):
    """
    Live system telemetry for the SIH observability dashboard.
    Protected endpoint: requires authenticated access.
    """
    # Lightweight database state queries
    try:
        registered_cameras = await db.scalar(select(func.count(Camera.id))) or 0
        event_count = await db.scalar(select(func.count(PlateEvent.id))) or 0
        active_alerts = await db.scalar(select(func.count(Alert.id)).where(Alert.resolved == False)) or 0
        db_status = "healthy"
    except Exception:
        db_status = "degraded"
        registered_cameras = event_count = active_alerts = 0

    snapshot = metrics.get_snapshot()

    return {
        "status": "healthy" if db_status == "healthy" else "degraded",
        "uptime_seconds": snapshot["uptime_seconds"],
        "database": {
            "status": db_status,
            "events_total": event_count,
        },
        "cameras": {
            "registered": registered_cameras,
            "active_now": snapshot["cameras"]["active_last_30s"],
        },
        "anpr": snapshot["anpr"],
        "alerts": {
            "active_unresolved": active_alerts,
            "broadcast_this_session": snapshot["alerts_broadcast"],
        },
        "websocket_clients": snapshot["websocket_clients"],
        "latency": snapshot["latency"],
    }