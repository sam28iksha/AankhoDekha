"""
NAGARNETRA — Alerts API
WS  /alerts        — live WebSocket alert feed
GET /alerts        — paginated historical alerts
PUT /alerts/{id}/resolve — mark alert resolved
"""
from __future__ import annotations

import asyncio
import logging
import random
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, Query
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from auth.audit import log_action
from auth.dependencies import require_role
from auth.security import decode_access_token
from db.base import get_db, AsyncSessionLocal
from db.models import Alert, Camera, User
from api.alert_manager import alert_manager

logger = logging.getLogger(__name__)
router = APIRouter(tags=["alerts"])

# ── Demo-only plate/message pools for /alerts/simulate ──────────────────────
_DEMO_PLATES = [
    "DL01AB2345", "MH12PA7890", "UP80AB9999", "KA05MN4521",
    "TN09BZ7788", "RJ14GT3456", "HR26QD1102", "GJ05CV9981",
]
_DEMO_MESSAGES = {
    "blacklist_hit": [
        "Blacklisted plate detected. Reason: Reported stolen.",
        "Blacklisted plate detected. Reason: Wanted for questioning.",
        "Blacklisted plate detected. Reason: Outstanding non-bailable warrant.",
        "Blacklisted plate detected. Reason: Flagged by traffic police.",
    ],
    "anomaly": [
        "Suspicious route pattern detected for this vehicle.",
        "Vehicle appeared at multiple checkpoints in an implausible time window.",
        "Unusual travel pattern flagged for manual review.",
    ],
}


@router.websocket("/alerts")
async def alerts_websocket(websocket: WebSocket, token: str | None = Query(None)):
    """
    WebSocket endpoint for live alert streaming.
    Connect at: ws://localhost:8000/alerts?token=<JWT>
    Every new blacklist hit or anomaly is pushed as JSON to all connected clients.

    Browsers' native WebSocket API can't set an Authorization header, so the
    token travels as a query param instead — same JWT, just a different
    transport. Rejected before accept() if missing/invalid, matching the
    same "must be logged in" floor as every REST read.

    Keep-alive: server sends a {type: "ping"} frame every 30 s so the connection
    never idles long enough to be killed by the kernel's TCP idle timeout
    (~120 s on Linux). If the client is gone, WebSocketDisconnect fires cleanly.
    """
    payload = decode_access_token(token) if token else None
    if payload is None:
        await websocket.close(code=4401, reason="Unauthorized")
        return

    await alert_manager.connect(websocket)
    await websocket.send_json({
        "type": "connected",
        "message": "NAGARNETRA alert feed connected. Listening for events...",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    try:
        while True:
            try:
                # Wait up to 30 s for a client message (e.g. "ping").
                # On timeout, send a server-side ping and loop — this prevents
                # the connection from idling for the full TCP keepalive period.
                data = await asyncio.wait_for(
                    websocket.receive_text(),
                    timeout=30.0,
                )
                if data == "ping":
                    await websocket.send_json({"type": "pong"})
            except asyncio.TimeoutError:
                # Nothing received in 30 s — nudge the connection to confirm
                # the client is still there. If it's gone, the next receive
                # or this send will raise WebSocketDisconnect.
                try:
                    await websocket.send_json({
                        "type": "ping",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    })
                except Exception:
                    break  # client gone — let the outer except clean up
    except WebSocketDisconnect:
        pass
    finally:
        await alert_manager.disconnect(websocket)



@router.get("/alerts")
async def list_alerts(
    db: AsyncSession = Depends(get_db),
    alert_type: str | None = Query(None),
    resolved: bool | None = Query(None),
    plate_number: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    _user: User = Depends(require_role("viewer")),
):
    """List historical alerts with optional filters."""
    query = select(Alert, Camera).join(Camera, Alert.camera_id == Camera.id)

    if alert_type:
        query = query.where(Alert.alert_type == alert_type)
    if resolved is not None:
        query = query.where(Alert.resolved == resolved)
    if plate_number:
        query = query.where(Alert.plate_number == plate_number.upper().strip())

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
            "source": alert.source,
        }
        for alert, cam in rows
    ]


@router.put("/alerts/{alert_id}/resolve")
async def resolve_alert(
    alert_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_role("investigator")),
):
    """Mark an alert as resolved."""
    alert = await db.get(Alert, alert_id)
    if alert is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.resolved = True
    await log_action(db, user, "alert_resolve", target=alert.plate_number, details=f"alert_id={alert_id}")
    await db.commit()

    # Notify WebSocket clients
    await alert_manager.broadcast({
        "type": "alert_resolved",
        "alert_id": alert_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

    return {"message": "Alert resolved", "alert_id": alert_id}


@router.post("/alerts/simulate")
async def simulate_alert(
    db: AsyncSession = Depends(get_db),
    alert_type: str = Query("blacklist_hit", pattern="^(blacklist_hit|anomaly)$"),
    plate_number: str | None = Query(None),
    camera_id: str | None = Query(None),
    user: User = Depends(require_role("investigator")),
):
    """
    Fire a synthetic alert for demo/recording purposes.
    Not tied to any real detection — picks a random plate/camera/message unless
    overridden by query params, writes a real Alert row (so it shows up in
    history too), and broadcasts it exactly like a real detection would.

    Example: curl -X POST "http://localhost:8000/alerts/simulate?alert_type=blacklist_hit"
    """
    cam_result = await db.execute(select(Camera))
    cameras = cam_result.scalars().all()
    if not cameras:
        raise HTTPException(status_code=400, detail="No cameras configured")

    camera = next((c for c in cameras if c.id == camera_id), None) if camera_id else random.choice(cameras)
    if camera is None:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' not found")

    plate = plate_number or random.choice(_DEMO_PLATES)
    message = random.choice(_DEMO_MESSAGES[alert_type])
    timestamp = datetime.now(timezone.utc)

    alert = Alert(
        plate_number=plate,
        camera_id=camera.id,
        timestamp=timestamp,
        alert_type=alert_type,
        resolved=False,
        details=message,
        source="simulated",
    )
    db.add(alert)
    await log_action(db, user, "alert_simulate", target=plate, details=f"alert_type={alert_type}")
    await db.commit()
    await db.refresh(alert)

    await alert_manager.broadcast_alert(
        alert_id=alert.id,
        plate_number=plate,
        camera_id=camera.id,
        camera_name=camera.name,
        alert_type=alert_type,
        timestamp=timestamp,
        details=message,
        source="simulated",
    )
    logger.info(f"Simulated alert fired: {plate} @ {camera.name} ({alert_type})")

    return {
        "message": "Simulated alert broadcast",
        "alert_id": alert.id,
        "plate_number": plate,
        "camera_id": camera.id,
        "camera_name": camera.name,
        "alert_type": alert_type,
        "details": message,
        "source": "simulated",
    }
