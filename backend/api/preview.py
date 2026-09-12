"""
NAGARNETRA — Detection Preview API

Processes a video frame-by-frame and saves annotated JPEG frames
(plate bounding box + live OCR text + vehicle attributes burned in),
plus a manifest, so the frontend "OCR Preview" page can play it back
as a scrubbable frame sequence.

Deliberately NOT a real video file: this container's OpenCV build can
only encode mp4v/XVID, which browsers won't play natively — a
JPEG-sequence player has zero codec risk and works everywhere.

Reuses the exact same temporal-clustering and vehicle-association logic
used by live ingestion, so the "final recognized plates" list shown
here matches the production processing model.

This is a visualization of the real ANPR + vehicle intelligence
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
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    UploadFile,
)

from auth.dependencies import require_role
from config import settings
from db.models import User

from anpr.detector import plate_detector, vehicle_detector
from anpr.ocr import plate_ocr
from anpr.pipeline import (
    _CLUSTER_GAP_SECONDS,
    _PlateCluster,
    _associate_vehicle,
    _plate_similarity,
)

from utils.metrics import metrics


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/preview", tags=["preview"])


# ---------------------------------------------------------------------------
# Preview state / paths
# ---------------------------------------------------------------------------

_preview_status: dict[str, dict] = {}

PREVIEW_ROOT = Path(settings.SNAPSHOTS_DIR).parent / "previews"

_VIDEO_EXTS = {
    ".mp4",
    ".avi",
    ".mov",
    ".mkv",
}


# ---------------------------------------------------------------------------
# Drawing configuration
# ---------------------------------------------------------------------------

_BOX_GREEN = (0, 200, 0)
_BOX_ORANGE = (0, 165, 255)
_TEXT_WHITE = (255, 255, 255)


# ---------------------------------------------------------------------------
# Frame annotation
# ---------------------------------------------------------------------------

def _draw_detections(
    frame,
    boxes: list[tuple],
) -> None:
    """
    Burn plate bounding boxes, OCR text, and vehicle attributes
    into the frame.

    Expected tuple:

        (
            x1,
            y1,
            x2,
            y2,
            plate_text,
            ocr_conf,
            vehicle_type,
            color,
        )

    Vehicle bounding boxes are intentionally not drawn here to keep
    the preview visually clean. Vehicle type and color are shown as
    structured information alongside the recognized plate.
    """

    for (
        x1,
        y1,
        x2,
        y2,
        plate_text,
        _ocr_conf,
        vehicle_type,
        vehicle_color,
    ) in boxes:

        is_valid = bool(plate_text)

        box_color = (
            _BOX_GREEN
            if is_valid
            else _BOX_ORANGE
        )

        # ---------------------------------------------------------------
        # Plate bounding box
        # ---------------------------------------------------------------

        cv2.rectangle(
            frame,
            (x1, y1),
            (x2, y2),
            box_color,
            3,
        )

        # ---------------------------------------------------------------
        # Label
        # ---------------------------------------------------------------

        if is_valid:
            label = plate_text

            # Only display vehicle metadata when at least one attribute
            # is known.
            if (
                vehicle_type != "unknown"
                or vehicle_color != "unknown"
            ):
                description = (
                    f"{vehicle_color} {vehicle_type}"
                )

                # Avoid ugly partial-unknown labels.
                description = (
                    description
                    .replace("unknown ", "")
                    .replace(" unknown", "")
                    .strip()
                )

                if description:
                    label += f" [{description}]"

        else:
            label = "reading..."

        # ---------------------------------------------------------------
        # Label background
        # ---------------------------------------------------------------

        (
            text_width,
            text_height,
        ), _ = cv2.getTextSize(
            label,
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            2,
        )

        label_y = max(
            0,
            y1 - text_height - 16,
        )

        cv2.rectangle(
            frame,
            (x1, label_y),
            (
                x1 + text_width + 14,
                y1,
            ),
            box_color,
            -1,
        )

        # ---------------------------------------------------------------
        # Label text
        # ---------------------------------------------------------------

        cv2.putText(
            frame,
            label,
            (
                x1 + 7,
                y1 - 10,
            ),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            _TEXT_WHITE,
            2,
            cv2.LINE_AA,
        )


# ---------------------------------------------------------------------------
# Preview rendering
# ---------------------------------------------------------------------------

async def _render_preview(
    camera_id: str,
    video_path: str,
) -> None:
    """
    Process a video frame-by-frame and generate a JPEG preview sequence.

    Pipeline:

        frame
          |
          +--> plate detector
          |
          +--> vehicle detector
          |
          +--> spatial vehicle association
          |
          +--> OCR
          |
          +--> temporal plate clustering
          |
          +--> annotated JPEG + manifest
    """

    _preview_status[camera_id] = {
        "status": "processing",
        "progress": 0,
        "total": None,
    }

    out_dir = PREVIEW_ROOT / camera_id
    out_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    # Remove previous preview frames.
    for file in out_dir.glob("*.jpg"):
        file.unlink()

    try:
        # ---------------------------------------------------------------
        # Open video
        # ---------------------------------------------------------------

        cap = cv2.VideoCapture(video_path)

        if not cap.isOpened():
            raise RuntimeError(
                f"Could not open video: {video_path}"
            )

        fps = cap.get(
            cv2.CAP_PROP_FPS
        ) or 25.0

        sample_rate = settings.FRAME_SAMPLE_RATE

        loop = asyncio.get_running_loop()

        # ---------------------------------------------------------------
        # Temporal clustering state
        # ---------------------------------------------------------------

        frames_manifest: list[dict] = []

        active_clusters: list[_PlateCluster] = []

        finalized_plates: list[dict] = []

        frame_idx = 0
        saved_idx = 0

        # ---------------------------------------------------------------
        # Frame processing loop
        # ---------------------------------------------------------------

        while True:
            t_pipeline_start = time.perf_counter()

            # -----------------------------------------------------------
            # Read frame
            # -----------------------------------------------------------

            ret, frame = await loop.run_in_executor(
                None,
                cap.read,
            )

            if not ret:
                break

            frame_idx += 1

            # Sample every Nth frame.
            if frame_idx % sample_rate != 0:
                continue

            t_seconds = frame_idx / fps

            # -----------------------------------------------------------
            # 1. Plate Detection
            # -----------------------------------------------------------

            t_det_start = time.perf_counter()

            detections = await loop.run_in_executor(
                None,
                plate_detector.detect,
                frame,
            )

            det_ms = (
                time.perf_counter()
                - t_det_start
            ) * 1000

            # -----------------------------------------------------------
            # 2. Vehicle Detection
            # -----------------------------------------------------------
            #
            # Only run vehicle detection when at least one plate was
            # detected. There is no useful plate-to-vehicle association
            # to perform otherwise.
            # -----------------------------------------------------------

            vehicle_dets = []

            vehicle_det_ms = 0.0

            if detections:
                t_vehicle_start = time.perf_counter()

                vehicle_dets = await loop.run_in_executor(
                    None,
                    vehicle_detector.detect,
                    frame,
                )

                vehicle_det_ms = (
                    time.perf_counter()
                    - t_vehicle_start
                ) * 1000

            # -----------------------------------------------------------
            # Per-frame state
            # -----------------------------------------------------------

            boxes_for_frame = []

            total_ocr_ms = 0.0
            ocr_count = 0

            # -----------------------------------------------------------
            # 3. OCR + Vehicle Association
            # -----------------------------------------------------------

            for det in detections:

                # -------------------------------------------------------
                # Associate plate with vehicle
                # -------------------------------------------------------

                vehicle_type, vehicle_color = _associate_vehicle(
                        det,
                        vehicle_dets,
                )

                # -------------------------------------------------------
                # OCR
                # -------------------------------------------------------

                t_ocr_start = time.perf_counter()

                plate_text, ocr_conf = await loop.run_in_executor(
                    None,
                    plate_ocr.read,
                    det.crop,
                )

                ocr_ms = (
                    time.perf_counter()
                    - t_ocr_start
                ) * 1000

                total_ocr_ms += ocr_ms
                ocr_count += 1

                # -------------------------------------------------------
                # Store frame-level detection
                # -------------------------------------------------------

                boxes_for_frame.append(
                    (
                        det.x1,
                        det.y1,
                        det.x2,
                        det.y2,
                        plate_text,
                        ocr_conf,
                        vehicle_type,
                        vehicle_color,
                    )
                )

                # -------------------------------------------------------
                # OCR observability
                # -------------------------------------------------------

                is_success = bool(
                    plate_text
                    and ocr_conf
                    >= settings.OCR_CONFIDENCE_THRESHOLD
                )

                metrics.increment(
                    "ocr_attempts",
                    1,
                )

                if not is_success:
                    continue

                metrics.increment(
                    "ocr_success",
                    1,
                )

                metrics.increment(
                    "plates_detected",
                    1,
                )

                # -------------------------------------------------------
                # Combined detection + OCR confidence
                # -------------------------------------------------------

                combined_conf = (
                    det.confidence * ocr_conf
                ) ** 0.5

                # -------------------------------------------------------
                # Temporal cluster matching
                # -------------------------------------------------------

                matched = None

                for cluster in active_clusters:

                    if (
                        _plate_similarity(
                            plate_text,
                            cluster.representative,
                        )
                        >= 0.72
                    ):
                        matched = cluster
                        break

                # -------------------------------------------------------
                # Update or create cluster
                # -------------------------------------------------------

                if matched:

                    matched.add(
                        plate_text,
                        combined_conf,
                        t_seconds,
                        None,
                        vehicle_type,
                        vehicle_color,
                    )

                else:

                    active_clusters.append(
                        _PlateCluster(
                            plate_text,
                            combined_conf,
                            t_seconds,
                            None,
                            vehicle_type,
                            vehicle_color,
                        )
                    )

            # -----------------------------------------------------------
            # 4. Finalize stale temporal clusters
            # -----------------------------------------------------------

            still_active = []

            for cluster in active_clusters:

                if (
                    t_seconds - cluster.last_seen
                    > _CLUSTER_GAP_SECONDS
                ):
                    (
                        plate,
                        confidence,
                        timestamp,
                        _snapshot,
                        resolved_vehicle_type,
                        resolved_color,
                    ) = cluster.resolve()

                    finalized_plates.append(
                        {
                            "plate": plate,
                            "confidence": round(
                                confidence,
                                3,
                            ),
                            "t": round(
                                timestamp,
                                2,
                            ),
                            "type": resolved_vehicle_type,
                            "color": resolved_color,
                        }
                    )

                else:
                    still_active.append(cluster)

            active_clusters = still_active

            # -----------------------------------------------------------
            # 5. Draw annotations
            # -----------------------------------------------------------

            _draw_detections(
                frame,
                boxes_for_frame,
            )

            # -----------------------------------------------------------
            # 6. Metrics
            # -----------------------------------------------------------

            t_pipeline_end = time.perf_counter()

            pipeline_ms = (
                t_pipeline_end
                - t_pipeline_start
            ) * 1000

            avg_ocr_ms = (
                total_ocr_ms / ocr_count
                if ocr_count > 0
                else 0.0
            )

            metrics.increment(
                "frames_processed",
                1,
            )

            metrics.mark_camera_active(
                camera_id,
            )

            metrics.record_latency(
                "detection",
                det_ms,
            )

            if vehicle_det_ms > 0:
                metrics.record_latency(
                    "vehicle_detection",
                    vehicle_det_ms,
                )

            metrics.record_latency(
                "ocr",
                avg_ocr_ms,
            )

            metrics.record_latency(
                "pipeline",
                pipeline_ms,
            )

            # -----------------------------------------------------------
            # 7. Save annotated frame
            # -----------------------------------------------------------

            saved_idx += 1

            filename = (
                f"frame_{saved_idx:05d}.jpg"
            )

            output_path = (
                out_dir / filename
            )

            await loop.run_in_executor(
                None,
                cv2.imwrite,
                str(output_path),
                frame,
            )

            # -----------------------------------------------------------
            # 8. Build structured frame manifest
            # -----------------------------------------------------------

            frame_plates = []

            for (
                _x1,
                _y1,
                _x2,
                _y2,
                plate_text,
                _ocr_conf,
                vehicle_type,
                vehicle_color,
            ) in boxes_for_frame:

                if not plate_text:
                    continue

                frame_plates.append(
                    {
                        "plate": plate_text,
                        "vehicle_type": vehicle_type,
                        "color": vehicle_color,
                    }
                )

            frames_manifest.append(
                {
                    "index": saved_idx,
                    "t": round(
                        t_seconds,
                        2,
                    ),
                    "url": (
                        f"/previews/"
                        f"{camera_id}/"
                        f"{filename}"
                    ),
                    "plates": frame_plates,
                }
            )

            # -----------------------------------------------------------
            # 9. Update preview progress
            # -----------------------------------------------------------

            _preview_status[camera_id] = {
                "status": "processing",
                "progress": saved_idx,
                "total": None,
            }

        # ---------------------------------------------------------------
        # Release video
        # ---------------------------------------------------------------

        cap.release()

        # ---------------------------------------------------------------
        # Finalize remaining active clusters
        # ---------------------------------------------------------------

        for cluster in active_clusters:

            (
                plate,
                confidence,
                timestamp,
                _snapshot,
                resolved_vehicle_type,
                resolved_color,
            ) = cluster.resolve()

            finalized_plates.append(
                {
                    "plate": plate,
                    "confidence": round(
                        confidence,
                        3,
                    ),
                    "t": round(
                        timestamp,
                        2,
                    ),
                    "type": resolved_vehicle_type,
                    "color": resolved_color,
                }
            )

        # ---------------------------------------------------------------
        # Build final manifest
        # ---------------------------------------------------------------

        manifest = {
            "camera_id": camera_id,
            "playback_fps": 8,
            "frames": frames_manifest,
            "plates": finalized_plates,
        }

        # ---------------------------------------------------------------
        # Persist manifest
        # ---------------------------------------------------------------

        (
            out_dir / "manifest.json"
        ).write_text(
            json.dumps(
                manifest,
                indent=2,
            )
        )

        # ---------------------------------------------------------------
        # Mark complete
        # ---------------------------------------------------------------

        _preview_status[camera_id] = {
            "status": "done",
            "progress": saved_idx,
            "total": saved_idx,
            "manifest_url": (
                f"/previews/"
                f"{camera_id}/"
                f"manifest.json"
            ),
        }

        logger.info(
            "Preview render done for %s: "
            "%s frames, %s plates",
            camera_id,
            saved_idx,
            len(manifest["plates"]),
        )

    except Exception as e:

        logger.exception(
            "Preview render failed for %s: %s",
            camera_id,
            e,
        )

        _preview_status[camera_id] = {
            "status": "error",
            "error": str(e),
        }


# ---------------------------------------------------------------------------
# Upload preview
# ---------------------------------------------------------------------------

@router.post("/upload")
async def start_preview_upload(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    _user: User = Depends(
        require_role("viewer")
    ),
):
    """
    Render an annotated frame-by-frame preview
    for an arbitrary uploaded video.

    The uploaded video is processed through the
    same _render_preview pipeline as registered
    camera videos.
    """

    ext = Path(
        file.filename or ""
    ).suffix.lower()

    if ext not in _VIDEO_EXTS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported file type '{ext}'. "
                f"Use one of: "
                f"{', '.join(sorted(_VIDEO_EXTS))}."
            ),
        )

    preview_id = (
        f"upload_{uuid.uuid4().hex[:10]}"
    )

    uploads_dir = (
        Path(settings.VIDEOS_DIR).parent
        / "uploads"
    )

    uploads_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    dest_path = (
        uploads_dir
        / f"{preview_id}{ext}"
    )

    dest_path.write_bytes(
        await file.read()
    )

    background_tasks.add_task(
        _render_preview,
        preview_id,
        str(dest_path),
    )

    return {
        "message": (
            "Preview render started "
            "for uploaded video"
        ),
        "status": "started",
        "preview_id": preview_id,
    }


# ---------------------------------------------------------------------------
# Registered camera preview
# ---------------------------------------------------------------------------

@router.post("/{camera_id}")
async def start_preview(
    camera_id: str,
    background_tasks: BackgroundTasks,
    _user: User = Depends(
        require_role("viewer")
    ),
):
    """
    Render an annotated frame-by-frame preview
    for a registered camera's video file.
    """

    videos_dir = Path(
        settings.VIDEOS_DIR
    )

    video_path = None

    for ext in (
        ".mp4",
        ".avi",
        ".mov",
        ".mkv",
    ):
        candidate = (
            videos_dir
            / f"{camera_id}{ext}"
        )

        if candidate.exists():
            video_path = str(candidate)
            break

    if video_path is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No video found for "
                f"camera '{camera_id}'"
            ),
        )

    if (
        _preview_status
        .get(camera_id, {})
        .get("status")
        == "processing"
    ):
        return {
            "message": "Already processing",
            "status": "processing",
        }

    background_tasks.add_task(
        _render_preview,
        camera_id,
        video_path,
    )

    return {
        "message": (
            f"Preview render started "
            f"for {camera_id}"
        ),
        "status": "started",
    }


# ---------------------------------------------------------------------------
# Preview status
# ---------------------------------------------------------------------------

@router.get("/status/{camera_id}")
async def preview_status(
    camera_id: str,
    _user: User = Depends(
        require_role("viewer")
    ),
):
    return _preview_status.get(
        camera_id,
        {"status": "idle"},
    )