"""
NAGARNETRA — Ingestion API
POST /ingest/{camera_id} — start processing a video file for a camera as a background task.
GET  /ingest/status/{camera_id} — check ingestion progress.
POST /ingest/upload — upload a video or image directly and process it (real-time detection test).
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

import cv2
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from auth.dependencies import require_role
from config import settings
from db.base import get_db, AsyncSessionLocal
from db.models import Camera, PlateEvent, Blacklist, Alert, User
from anpr.frame_source import VideoFileSource
from anpr.pipeline import ANPRPipeline, PlateEvent as PipelinePlateEvent
from anpr.detector import plate_detector
from anpr.ocr import plate_ocr
from api.alert_manager import alert_manager
from api.anomaly import check_speed_anomaly
from time import perf_counter
from utils.metrics import metrics

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ingest", tags=["ingestion"])

# Track per-camera ingestion state
_ingestion_status: dict[str, dict] = {}

_UPLOAD_CAMERA_ID = "cam_upload"
_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
_VIDEO_EXTS = {".mp4", ".avi", ".mov", ".mkv"}


async def _get_or_create_upload_camera(db: AsyncSession, camera_id: str, name: str = "Mobile ANPR Unit") -> Camera:
    """Return the given camera, auto-creating a synthetic 'upload' camera if needed."""
    cam = await db.get(Camera, camera_id)
    if cam is None:
        # Central Delhi fallback location for ad-hoc uploaded footage/images —
        # framed as a portable/vehicle-mounted ANPR unit rather than a fixed
        # installation, since that's what an arbitrary uploaded clip actually is.
        cam = Camera(id=camera_id, name=name, lat=28.6139, lng=77.2090, road_segment="Mobile Deployment")
        db.add(cam)
        await db.commit()
        await db.refresh(cam)
    return cam


async def _write_event_and_maybe_alert(
    db: AsyncSession,
    cam: Camera,
    plate_event: PipelinePlateEvent,
) -> dict:
    """
    Persist a single detected plate event, check it against the blacklist, and
    broadcast a live WebSocket alert if it's a hit. Shared by video-background
    ingestion and the synchronous image-upload path so the two never drift.
    """
    db_event = PlateEvent(
        plate_number=plate_event.plate_number,
        camera_id=plate_event.camera_id,
        timestamp=plate_event.timestamp,
        confidence=plate_event.confidence,
        frame_snapshot_path=plate_event.frame_snapshot_path,
    )
    db.add(db_event)
    await db.flush()  # get event ID

    bl_entry = await db.get(Blacklist, plate_event.plate_number)
    is_blacklisted = bl_entry is not None
    if bl_entry:
        alert = Alert(
            plate_number=plate_event.plate_number,
            camera_id=plate_event.camera_id,
            timestamp=plate_event.timestamp,
            alert_type="blacklist_hit",
            resolved=False,
            details=f"Blacklisted: {bl_entry.reason}",
            source="detection",
        )
        db.add(alert)
        await db.flush()

        await alert_manager.broadcast_alert(
            alert_id=alert.id,
            plate_number=plate_event.plate_number,
            camera_id=plate_event.camera_id,
            camera_name=cam.name,
            alert_type="blacklist_hit",
            timestamp=plate_event.timestamp,
            details=f"Blacklisted plate detected at {cam.name}. Reason: {bl_entry.reason}",
            source="detection",
        )
        logger.warning(f"🚨 BLACKLIST HIT: {plate_event.plate_number} at {cam.name}")

    await check_speed_anomaly(
        db,
        plate_number=plate_event.plate_number,
        camera_id=plate_event.camera_id,
        camera_name=cam.name,
        camera_lat=cam.lat,
        camera_lng=cam.lng,
        timestamp=plate_event.timestamp,
    )

    await db.commit()

    return {
        "event_id": db_event.id,
        "plate_number": plate_event.plate_number,
        "confidence": plate_event.confidence,
        "blacklisted": is_blacklisted,
        "reason": bl_entry.reason if bl_entry else None,
    }


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
                await _write_event_and_maybe_alert(db, cam, plate_event)
                events_written += 1
                _ingestion_status[camera_id]["events_written"] = events_written

        _ingestion_status[camera_id]["status"] = "done"
        _ingestion_status[camera_id]["completed_at"] = datetime.now(timezone.utc).isoformat()
        logger.info(f"Ingestion complete for {camera_id}: {events_written} events written.")

    except Exception as e:
        logger.exception(f"Ingestion failed for {camera_id}: {e}")
        _ingestion_status[camera_id]["status"] = "error"
        _ingestion_status[camera_id]["errors"].append(str(e))


async def _run_upload_video_ingestion(camera_id: str, video_path: str, cam_lat: float, cam_lng: float) -> None:
    """Background coroutine for an uploaded (not pre-registered) video file."""
    _ingestion_status[camera_id] = {
        "status": "running",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "events_written": 0,
        "errors": [],
    }
    try:
        source = VideoFileSource(video_path)
        pipeline = ANPRPipeline(
            source=source,
            camera_id=camera_id,
            camera_lat=cam_lat,
            camera_lng=cam_lng,
            video_start_time=datetime.now(timezone.utc),
            save_snapshots=False,
        )

        events_written = 0
        async with AsyncSessionLocal() as db:
            cam = await db.get(Camera, camera_id)
            async for plate_event in pipeline.run():
                await _write_event_and_maybe_alert(db, cam, plate_event)
                events_written += 1
                _ingestion_status[camera_id]["events_written"] = events_written

        _ingestion_status[camera_id]["status"] = "done"
        _ingestion_status[camera_id]["completed_at"] = datetime.now(timezone.utc).isoformat()
        logger.info(f"Upload ingestion complete for {camera_id}: {events_written} events written.")
    except Exception as e:
        logger.exception(f"Upload ingestion failed for {camera_id}: {e}")
        _ingestion_status[camera_id]["status"] = "error"
        _ingestion_status[camera_id]["errors"].append(str(e))


@router.post("/upload")
async def upload_and_detect(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    camera_id: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_role("investigator")),
):
    """
    Upload a video or image directly and run detection against it — used by the
    Blacklist page's "Test Detection" tool.

    Images are processed synchronously against a single frame: the response
    includes any detections (and whether each is a blacklist hit) immediately.
    Videos are queued as a background task, same pattern as camera-based
    ingestion — poll GET /ingest/status/{camera_id} for progress. Either way,
    a blacklist hit fires a live alert over the existing /alerts WebSocket.
    """
    ext = Path(file.filename or "").suffix.lower()
    if ext not in _IMAGE_EXTS and ext not in _VIDEO_EXTS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Use an image ({', '.join(sorted(_IMAGE_EXTS))}) "
                   f"or video ({', '.join(sorted(_VIDEO_EXTS))}).",
        )

    target_camera_id = camera_id or _UPLOAD_CAMERA_ID
    cam = await _get_or_create_upload_camera(db, target_camera_id)

    uploads_dir = Path(settings.VIDEOS_DIR).parent / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    dest_path = uploads_dir / f"{uuid.uuid4().hex}{ext}"
    dest_path.write_bytes(await file.read())

    if ext in _IMAGE_EXTS:
        frame = cv2.imread(str(dest_path))
        if frame is None:
            raise HTTPException(status_code=400, detail="Could not read uploaded image.")

        loop = asyncio.get_running_loop()
        detections = await loop.run_in_executor(None, plate_detector.detect, frame)

        now = datetime.now(timezone.utc)
        results = []
        for det in detections:
            plate_text, ocr_conf = await loop.run_in_executor(None, plate_ocr.read, det.crop)
            if not plate_text or ocr_conf < settings.OCR_CONFIDENCE_THRESHOLD:
                continue
            combined_conf = (det.confidence * ocr_conf) ** 0.5
            plate_event = PipelinePlateEvent(
                plate_number=plate_text,
                camera_id=target_camera_id,
                lat=cam.lat,
                lng=cam.lng,
                timestamp=now,
                confidence=round(combined_conf, 4),
            )
            results.append(await _write_event_and_maybe_alert(db, cam, plate_event))

        return {"status": "done", "type": "image", "camera_id": target_camera_id, "detections": results}

    # Video: same background-task pattern as camera-based ingestion.
    if _ingestion_status.get(target_camera_id, {}).get("status") == "running":
        return {"message": f"Ingestion already running for {target_camera_id}", "status": "running", "camera_id": target_camera_id}

    background_tasks.add_task(_run_upload_video_ingestion, target_camera_id, str(dest_path), cam.lat, cam.lng)
    return {
        "status": "started",
        "type": "video",
        "camera_id": target_camera_id,
        "message": f"Processing uploaded video for camera '{target_camera_id}'. Poll /ingest/status/{target_camera_id}.",
    }


@router.post("/{camera_id}")
async def start_ingestion(
    camera_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_role("investigator")),
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
async def get_ingestion_status(camera_id: str, _user: User = Depends(require_role("viewer"))):
    """Get the current ingestion status for a camera."""
    status = _ingestion_status.get(camera_id)
    if status is None:
        return {"camera_id": camera_id, "status": "idle"}
    return {"camera_id": camera_id, **status}


@router.get("/status")
async def get_all_ingestion_status(_user: User = Depends(require_role("viewer"))):
    """Get ingestion status for all cameras."""
    return _ingestion_status


async def _write_event_and_maybe_alert(
    db: AsyncSession,
    cam: Camera,
    plate_event: PipelinePlateEvent,
) -> dict:
    """
    Persist a single detected plate event, check it against the blacklist, and
    broadcast a live WebSocket alert if it's a hit.
    """
    db_t0 = perf_counter()
    
    db_event = PlateEvent(
        plate_number=plate_event.plate_number,
        camera_id=plate_event.camera_id,
        timestamp=plate_event.timestamp,
        confidence=plate_event.confidence,
        frame_snapshot_path=plate_event.frame_snapshot_path,
    )
    db.add(db_event)
    await db.flush()  # get event ID

    bl_entry = await db.get(Blacklist, plate_event.plate_number)
    is_blacklisted = bl_entry is not None
    if bl_entry:
        alert = Alert(
            plate_number=plate_event.plate_number,
            camera_id=plate_event.camera_id,
            timestamp=plate_event.timestamp,
            alert_type="blacklist_hit",
            resolved=False,
            details=f"Blacklisted: {bl_entry.reason}",
            source="detection",
        )
        db.add(alert)
        await db.flush()

        await alert_manager.broadcast_alert(
            alert_id=alert.id,
            plate_number=plate_event.plate_number,
            camera_id=plate_event.camera_id,
            camera_name=cam.name,
            alert_type="blacklist_hit",
            timestamp=plate_event.timestamp,
            details=f"Blacklisted plate detected at {cam.name}. Reason: {bl_entry.reason}",
            source="detection",
        )
        metrics.increment("alerts_broadcast")
        logger.warning(f"🚨 BLACKLIST HIT: {plate_event.plate_number} at {cam.name}")

    await check_speed_anomaly(
        db,
        plate_number=plate_event.plate_number,
        camera_id=plate_event.camera_id,
        camera_name=cam.name,
        camera_lat=cam.lat,
        camera_lng=cam.lng,
        timestamp=plate_event.timestamp,
    )

    await db.commit()
    
    metrics.record_latency("db_persistence", (perf_counter() - db_t0) * 1000)
    metrics.increment("events_persisted")

    return {
        "event_id": db_event.id,
        "plate_number": plate_event.plate_number,
        "confidence": plate_event.confidence,
        "blacklisted": is_blacklisted,
        "reason": bl_entry.reason if bl_entry else None,
    }