"""
NAGARNETRA — Ingestion API
POST /ingest/{camera_id} — start processing a video file for a camera as a background task.
GET  /ingest/status/{camera_id} — check ingestion progress.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from config import settings
from db.base import get_db, AsyncSessionLocal
from db.models import Camera, PlateEvent, Blacklist, Alert
from anpr.frame_source import VideoFileSource
from anpr.pipeline import ANPRPipeline
from api.alert_manager import alert_manager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ingest", tags=["ingestion"])

# Track per-camera ingestion state
_ingestion_status: dict[str, dict] = {}


async def _run_ingestion(camera_id: str, video_path: str) -> None:
    """Background coroutine: run full ANPR pipeline for one camera."""
    _ingestion_status[camera_id] = {
        "status": "running",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "events_written": 0,
        "errors": [],
    }

    # Load camera metadata from DB
    async with AsyncSessionLocal() as db:
        cam = await db.get(Camera, camera_id)
        if cam is None:
            _ingestion_status[camera_id]["status"] = "error"
            _ingestion_status[camera_id]["errors"].append(f"Camera {camera_id} not found in DB")
            return

    try:
        source = VideoFileSource(video_path)
        pipeline = ANPRPipeline(
            source=source,
            camera_id=camera_id,
            camera_lat=cam.lat,
            camera_lng=cam.lng,
            video_start_time=datetime.now(timezone.utc),
            save_snapshots=False,
        )

        events_written = 0
        async with AsyncSessionLocal() as db:
            async for plate_event in pipeline.run():
                # Write event to DB
                db_event = PlateEvent(
                    plate_number=plate_event.plate_number,
                    camera_id=plate_event.camera_id,
                    timestamp=plate_event.timestamp,
                    confidence=plate_event.confidence,
                    frame_snapshot_path=plate_event.frame_snapshot_path,
                )
                db.add(db_event)
                await db.flush()  # get event ID

                # Blacklist check
                bl_entry = await db.get(Blacklist, plate_event.plate_number)
                if bl_entry:
                    alert = Alert(
                        plate_number=plate_event.plate_number,
                        camera_id=plate_event.camera_id,
                        timestamp=plate_event.timestamp,
                        alert_type="blacklist_hit",
                        resolved=False,
                        details=f"Blacklisted: {bl_entry.reason}",
                    )
                    db.add(alert)
                    await db.flush()

                    # Push live alert via WebSocket
                    await alert_manager.broadcast_alert(
                        alert_id=alert.id,
                        plate_number=plate_event.plate_number,
                        camera_id=plate_event.camera_id,
                        camera_name=cam.name,
                        alert_type="blacklist_hit",
                        timestamp=plate_event.timestamp,
                        details=f"Blacklisted plate detected at {cam.name}. Reason: {bl_entry.reason}",
                    )
                    logger.warning(
                        f"🚨 BLACKLIST HIT: {plate_event.plate_number} at {cam.name}"
                    )

                events_written += 1
                _ingestion_status[camera_id]["events_written"] = events_written

                await db.commit()

        _ingestion_status[camera_id]["status"] = "done"
        _ingestion_status[camera_id]["completed_at"] = datetime.now(timezone.utc).isoformat()
        logger.info(f"Ingestion complete for {camera_id}: {events_written} events written.")

    except Exception as e:
        logger.exception(f"Ingestion failed for {camera_id}: {e}")
        _ingestion_status[camera_id]["status"] = "error"
        _ingestion_status[camera_id]["errors"].append(str(e))


@router.post("/{camera_id}")
async def start_ingestion(
    camera_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """
    Start ingesting a video file for the given camera_id.
    Expects the video at: VIDEOS_DIR/{camera_id}.mp4
    Runs as a FastAPI BackgroundTask (non-blocking).
    """
    cam = await db.get(Camera, camera_id)
    if cam is None:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' not found")

    # Find video file
    videos_dir = Path(settings.VIDEOS_DIR)
    video_path = None
    for ext in (".mp4", ".avi", ".mov", ".mkv"):
        candidate = videos_dir / f"{camera_id}{ext}"
        if candidate.exists():
            video_path = str(candidate)
            break

    if video_path is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No video file found for camera '{camera_id}'. "
                f"Expected: {videos_dir}/{camera_id}.mp4 (or .avi/.mov/.mkv)"
            ),
        )

    if _ingestion_status.get(camera_id, {}).get("status") == "running":
        return {"message": f"Ingestion already running for {camera_id}", "status": "running"}

    background_tasks.add_task(_run_ingestion, camera_id, video_path)
    return {
        "message": f"Ingestion started for camera '{camera_id}' ({cam.name})",
        "video": video_path,
        "status": "started",
    }


@router.get("/status/{camera_id}")
async def get_ingestion_status(camera_id: str):
    """Get the current ingestion status for a camera."""
    status = _ingestion_status.get(camera_id)
    if status is None:
        return {"camera_id": camera_id, "status": "idle"}
    return {"camera_id": camera_id, **status}


@router.get("/status")
async def get_all_ingestion_status():
    """Get ingestion status for all cameras."""
    return _ingestion_status
