"""
NAGARNETRA — Alerts API
WS  /alerts        — live WebSocket alert feed
GET /alerts        — paginated historical alerts
PUT /alerts/{id}/resolve — mark alert resolved
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, Query
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from db.base import get_db, AsyncSessionLocal
from db.models import Alert, Camera
from api.alert_manager import alert_manager

logger = logging.getLogger(__name__)
router = APIRouter(tags=["alerts"])


@router.websocket("/alerts")
async def alerts_websocket(websocket: WebSocket):
    """
    WebSocket endpoint for live alert streaming.
    Connect at: ws://localhost:8000/alerts
    Every new blacklist hit or anomaly is pushed as JSON to all connected clients.
    """
    await alert_manager.connect(websocket)
    # Send a connection confirmation
    await websocket.send_json({
        "type": "connected",
        "message": "NAGARNETRA alert feed connected. Listening for events...",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    try:
        while True:
            # Keep connection alive, wait for client ping or disconnect
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        await alert_manager.disconnect(websocket)


@router.get("/alerts")
async def list_alerts(
    db: AsyncSession = Depends(get_db),
    alert_type: str | None = Query(None),
    resolved: bool | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """List historical alerts with optional filters."""
    query = select(Alert, Camera).join(Camera, Alert.camera_id == Camera.id)

    if alert_type:
        query = query.where(Alert.alert_type == alert_type)
    if resolved is not None:
        query = query.where(Alert.resolved == resolved)

    query = query.order_by(desc(Alert.timestamp)).limit(limit).offset(offset)
    result = await db.execute(query)
    rows = result.fetchall()

    return [
        {
            "id": alert.id,
            "plate_number": alert.plate_number,
            "camera_id": alert.camera_id,
            "camera_name": cam.name,
            "lat": cam.lat,
            "lng": cam.lng,
            "timestamp": alert.timestamp.isoformat(),
            "alert_type": alert.alert_type,
            "resolved": alert.resolved,
            "details": alert.details,
        }
        for alert, cam in rows
    ]


@router.put("/alerts/{alert_id}/resolve")
async def resolve_alert(
    alert_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Mark an alert as resolved."""
    alert = await db.get(Alert, alert_id)
    if alert is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.resolved = True
    await db.commit()

    # Notify WebSocket clients
    await alert_manager.broadcast({
        "type": "alert_resolved",
        "alert_id": alert_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

    return {"message": "Alert resolved", "alert_id": alert_id}
