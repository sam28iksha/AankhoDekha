"""
NAGARNETRA — Detection Preview API
Processes a video frame-by-frame and saves annotated JPEG frames (bounding
box + live OCR text burned in, same visual style as a typical ANPR demo)
plus a manifest, so the frontend "OCR Preview" page can play it back as a
scrubbable frame sequence. Deliberately NOT a real video file: this container's
OpenCV build can only encode mp4v/XVID, which browsers won't play natively —
a JPEG-sequence player has zero codec risk and works everywhere.

Reuses the exact same temporal-clustering logic (anpr.pipeline._PlateCluster)
that live ingestion uses, so the "final recognized plates" list shown here
matches production output exactly — this is a visualization of the real
pipeline, not a separate approximation of it.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from pathlib import Path

import cv2
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File

from auth.dependencies import require_role
from config import settings
from db.models import User
from anpr.detector import plate_detector
from anpr.ocr import plate_ocr
from anpr.pipeline import _PlateCluster, _plate_similarity, _CLUSTER_GAP_SECONDS
from utils.metrics import metrics

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/preview", tags=["preview"])

_preview_status: dict[str, dict] = {}
PREVIEW_ROOT = Path(settings.SNAPSHOTS_DIR).parent / "previews"
_VIDEO_EXTS = {".mp4", ".avi", ".mov", ".mkv"}

_BOX_GREEN = (0, 200, 0)
_BOX_ORANGE = (0, 165, 255)
_TEXT_WHITE = (255, 255, 255)


def _draw_detections(frame, boxes: list[tuple]) -> None:
    """Burn bounding boxes + OCR text labels into the frame, in place."""
    for (x1, y1, x2, y2, plate_text, _ocr_conf) in boxes:
        is_valid = bool(plate_text)
        color = _BOX_GREEN if is_valid else _BOX_ORANGE
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 3)
        label = plate_text if is_valid else "reading..."
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 1.0, 3)
        label_y = max(0, y1 - th - 16)
        cv2.rectangle(frame, (x1, label_y), (x1 + tw + 14, y1), color, -1)
        cv2.putText(
            frame, label, (x1 + 7, y1 - 10),
            cv2.FONT_HERSHEY_SIMPLEX, 1.0, _TEXT_WHITE, 2, cv2.LINE_AA,
        )


async def _render_preview(camera_id: str, video_path: str) -> None:
    _preview_status[camera_id] = {"status": "processing", "progress": 0, "total": None}

    out_dir = PREVIEW_ROOT / camera_id
    out_dir.mkdir(parents=True, exist_ok=True)
    for f in out_dir.glob("*.jpg"):
        f.unlink()

    try:
        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        sample_rate = settings.FRAME_SAMPLE_RATE
        loop = asyncio.get_running_loop()

        frames_manifest: list[dict] = []
        active_clusters: list[_PlateCluster] = []
        finalized_plates: list[dict] = []
        frame_idx = 0
        saved_idx = 0

        while True:
            t_pipeline_start = time.perf_counter()
            ret, frame = await loop.run_in_executor(None, cap.read)
            if not ret:
                break
            frame_idx += 1
            if frame_idx % sample_rate != 0:
                continue

            t_seconds = frame_idx / fps
            
            t_det_start = time.perf_counter()
            detections = await loop.run_in_executor(None, plate_detector.detect, frame)
            det_ms = (time.perf_counter() - t_det_start) * 1000

            boxes_for_frame = []
            total_ocr_ms = 0.0
            ocr_count = 0

            for det in detections:
                t_ocr_start = time.perf_counter()
                plate_text, ocr_conf = await loop.run_in_executor(None, plate_ocr.read, det.crop)
                ocr_ms = (time.perf_counter() - t_ocr_start) * 1000
                total_ocr_ms += ocr_ms
                ocr_count += 1

                boxes_for_frame.append((det.x1, det.y1, det.x2, det.y2, plate_text, ocr_conf))

                # Track individual OCR success for live observability
                is_success = bool(plate_text and ocr_conf >= settings.OCR_CONFIDENCE_THRESHOLD)
                
                metrics.increment("ocr_attempts", 1)
                if is_success:
                    metrics.increment("ocr_success", 1)
                    metrics.increment("plates_detected", 1)
                    
                    combined_conf = (det.confidence * ocr_conf) ** 0.5
                    matched = None
                    for cluster in active_clusters:
                        if _plate_similarity(plate_text, cluster.representative) >= 0.72:
                            matched = cluster
                            break
                    if matched:
                        matched.add(plate_text, combined_conf, t_seconds, None)
                    else:
                        active_clusters.append(_PlateCluster(plate_text, combined_conf, t_seconds, None))

            # Close out clusters the vehicle has clearly left frame
            still_active = []
            for cluster in active_clusters:
                if t_seconds - cluster.last_seen > _CLUSTER_GAP_SECONDS:
                    plate, conf, ts, _ = cluster.resolve()
                    finalized_plates.append({"plate": plate, "confidence": round(conf, 3), "t": round(ts, 2)})
                else:
                    still_active.append(cluster)
            active_clusters = still_active

            _draw_detections(frame, boxes_for_frame)

            t_pipeline_end = time.perf_counter()
            pipeline_ms = (t_pipeline_end - t_pipeline_start) * 1000
            avg_ocr_ms = (total_ocr_ms / ocr_count) if ocr_count > 0 else 0.0

            # Feed the metrics registry using your defined registry methods
            metrics.increment("frames_processed", 1)
            metrics.mark_camera_active(camera_id)
            metrics.record_latency("detection", det_ms)
            metrics.record_latency("ocr", avg_ocr_ms)
            metrics.record_latency("pipeline", pipeline_ms)

            saved_idx += 1
            filename = f"frame_{saved_idx:05d}.jpg"
            await loop.run_in_executor(None, cv2.imwrite, str(out_dir / filename), frame)

            frames_manifest.append({
                "index": saved_idx,
                "t": round(t_seconds, 2),
                "url": f"/previews/{camera_id}/{filename}",
                "plates": [p for (_, _, _, _, p, _) in boxes_for_frame if p],
            })
            _preview_status[camera_id] = {"status": "processing", "progress": saved_idx, "total": None}

        cap.release()

        for cluster in active_clusters:
            plate, conf, ts, _ = cluster.resolve()
            finalized_plates.append({"plate": plate, "confidence": round(conf, 3), "t": round(ts, 2)})

        manifest = {
            "camera_id": camera_id,
            "playback_fps": 8,
            "frames": frames_manifest,
            "plates": finalized_plates,
        }
        (out_dir / "manifest.json").write_text(json.dumps(manifest))

        _preview_status[camera_id] = {
            "status": "done",
            "progress": saved_idx,
            "total": saved_idx,
            "manifest_url": f"/previews/{camera_id}/manifest.json",
        }
        logger.info(f"Preview render done for {camera_id}: {saved_idx} frames, {len(manifest['plates'])} plates")

    except Exception as e:
        logger.exception(f"Preview render failed for {camera_id}: {e}")
        _preview_status[camera_id] = {"status": "error", "error": str(e)}


@router.post("/upload")
async def start_preview_upload(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    _user: User = Depends(require_role("viewer")),
):
    """
    Render an annotated frame-by-frame preview for an arbitrary uploaded
    video — not tied to any registered camera. Reuses the exact same
    _render_preview pipeline as the camera-based flow, keyed by a
    generated ID instead of a camera_id, so the frontend polls/loads it
    identically either way.
    """
    ext = Path(file.filename or "").suffix.lower()
    if ext not in _VIDEO_EXTS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Use one of: {', '.join(sorted(_VIDEO_EXTS))}.",
        )

    preview_id = f"upload_{uuid.uuid4().hex[:10]}"
    uploads_dir = Path(settings.VIDEOS_DIR).parent / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    dest_path = uploads_dir / f"{preview_id}{ext}"
    dest_path.write_bytes(await file.read())

    background_tasks.add_task(_render_preview, preview_id, str(dest_path))
    return {"message": "Preview render started for uploaded video", "status": "started", "preview_id": preview_id}


@router.post("/{camera_id}")
async def start_preview(
    camera_id: str,
    background_tasks: BackgroundTasks,
    _user: User = Depends(require_role("viewer")),
):
    """Render an annotated frame-by-frame preview for a camera's video file."""
    videos_dir = Path(settings.VIDEOS_DIR)
    video_path = None
    for ext in (".mp4", ".avi", ".mov", ".mkv"):
        candidate = videos_dir / f"{camera_id}{ext}"
        if candidate.exists():
            video_path = str(candidate)
            break
    if video_path is None:
        raise HTTPException(status_code=404, detail=f"No video found for camera '{camera_id}'")

    if _preview_status.get(camera_id, {}).get("status") == "processing":
        return {"message": "Already processing", "status": "processing"}

    background_tasks.add_task(_render_preview, camera_id, video_path)
    return {"message": f"Preview render started for {camera_id}", "status": "started"}


@router.get("/status/{camera_id}")
async def preview_status(camera_id: str, _user: User = Depends(require_role("viewer"))):
    return _preview_status.get(camera_id, {"status": "idle"})