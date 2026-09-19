"""
AANKHODEKHA — Ingestion API

POST /ingest/{camera_id}
    Start processing a registered camera video as a background task.

GET /ingest/status/{camera_id}
    Check ingestion progress.

POST /ingest/upload
    Upload an image or video directly and process it.

Vehicle-centric identity resolution:
    Plate + vehicle type + vehicle color are treated as combined
    evidence when associating observations with a Vehicle entity.

A strong vehicle-type contradiction across recent, spatially related
observations can create a possible plate-cloning alert and a new
Vehicle entity so the two trajectories do not get merged.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import cv2
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
)
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import require_role
from config import settings
from db.base import AsyncSessionLocal, get_db
from db.models import (
    Alert,
    Blacklist,
    Camera,
    PlateEvent,
    User,
    Vehicle,
)
from anpr.detector import plate_detector, vehicle_detector
from anpr.frame_source import VideoFileSource
from anpr.ocr import plate_ocr
from anpr.pipeline import (
    ANPRPipeline,
    PlateEvent as PipelinePlateEvent,
    _associate_vehicle,
)
from api.alert_manager import alert_manager
from api.anomaly import check_speed_anomaly
from time import perf_counter
from utils.metrics import metrics


logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/ingest",
    tags=["ingestion"],
)


# ============================================================================
# Runtime state
# ============================================================================

_ingestion_status: dict[str, dict] = {}


# ============================================================================
# Upload configuration
# ============================================================================

_UPLOAD_CAMERA_ID = "cam_upload"

_IMAGE_EXTS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".bmp",
    ".webp",
}

_VIDEO_EXTS = {
    ".mp4",
    ".avi",
    ".mov",
    ".mkv",
}


# ============================================================================
# Vehicle identity configuration
# ============================================================================

# Only observations this recent participate in identity-conflict detection.
# This prevents an observation from several hours/days ago from being
# treated as evidence of simultaneous plate cloning.
IDENTITY_LOOKBACK_MINUTES = 30


# A strong spatial contradiction should involve observations that are
# sufficiently separated geographically.
#
# Example:
#
#   CAM_01 -> white car
#   CAM_02 -> black motorcycle
#
# 5 seconds apart and 5 km apart is suspicious.
#
# Two different classifications at the exact same camera are much more
# likely to be detector noise or changing visibility conditions.
CLONING_MIN_DISTANCE_KM = 1.0


# A vehicle cannot realistically move between widely separated cameras
# within an extremely short period.
#
# This is intentionally conservative. The speed-anomaly system remains
# responsible for actual speed calculations.
CLONING_MAX_TIME_MINUTES = 15


# ============================================================================
# Utility helpers
# ============================================================================

def _haversine_km(
    lat1: float,
    lng1: float,
    lat2: float,
    lng2: float,
) -> float:
    """
    Calculate great-circle distance between two GPS coordinates.

    Used only as a lightweight identity-resolution heuristic.
    PostGIS remains the correct place for large-scale spatial queries.
    """

    from math import asin, cos, radians, sin, sqrt

    earth_radius_km = 6371.0

    lat1_rad = radians(lat1)
    lat2_rad = radians(lat2)

    delta_lat = radians(lat2 - lat1)
    delta_lng = radians(lng2 - lng1)

    a = (
        sin(delta_lat / 2) ** 2
        + cos(lat1_rad)
        * cos(lat2_rad)
        * sin(delta_lng / 2) ** 2
    )

    c = 2 * asin(sqrt(a))

    return earth_radius_km * c


def _known(value: str | None) -> bool:
    """Return True when a vehicle attribute contains useful information."""

    return bool(
        value
        and value.lower() != "unknown"
    )


def _attribute_mismatch(
    previous: PlateEvent,
    current: PipelinePlateEvent,
) -> tuple[bool, bool]:
    """
    Compare vehicle attributes.

    Returns:

        (type_clash, color_clash)

    Unknown values never create a contradiction.
    """

    previous_type = (
        previous.vehicle_type
        or "unknown"
    )

    previous_color = (
        previous.color
        or "unknown"
    )

    current_type = (
        current.vehicle_type
        or "unknown"
    )

    current_color = (
        current.color
        or "unknown"
    )

    type_clash = (
        _known(previous_type)
        and _known(current_type)
        and previous_type != current_type
    )

    color_clash = (
        _known(previous_color)
        and _known(current_color)
        and previous_color != current_color
    )

    return type_clash, color_clash


# ============================================================================
# Upload camera
# ============================================================================

async def _get_or_create_upload_camera(
    db: AsyncSession,
    camera_id: str,
    name: str = "Mobile ANPR Unit",
) -> Camera:
    """
    Return the requested camera.

    For arbitrary uploaded media, create a synthetic mobile camera
    when one does not already exist.
    """

    cam = await db.get(
        Camera,
        camera_id,
    )

    if cam is None:
        cam = Camera(
            id=camera_id,
            name=name,
            lat=28.6139,
            lng=77.2090,
            road_segment="Mobile Deployment",
        )

        db.add(cam)

        await db.commit()
        await db.refresh(cam)

    return cam


# ============================================================================
# Vehicle identity resolution
# ============================================================================

async def resolve_vehicle_identity(
    db: AsyncSession,
    current_event: PipelinePlateEvent,
) -> tuple[str, bool, PlateEvent | None]:
    """
    Resolve the Vehicle entity for a newly detected observation.

    Returns:

        vehicle_id
            Vehicle entity to which the observation belongs.

        is_clash
            True when there is strong evidence that the same plate is
            being observed on an incompatible vehicle.

        previous_event
            The recent event used for comparison, if one exists.

    Identity strategy:

        1. Find recent observations carrying the same plate.
        2. If this is the first observation, create a Vehicle.
        3. If attributes are compatible, continue the existing Vehicle.
        4. If there is a strong type contradiction AND the observations
           are temporally/spatially plausible as separate vehicles,
           create a new Vehicle and flag a possible plate cloning event.
        5. Color is supporting evidence, not by itself proof of cloning.
        6. Unknown attributes never create a contradiction.
    """

    current_timestamp = current_event.timestamp

    lookback_start = (
        current_timestamp
        - timedelta(minutes=IDENTITY_LOOKBACK_MINUTES)
    )

    # ------------------------------------------------------------------
    # Find recent observations of this plate.
    #
    # We retrieve a small number rather than only blindly trusting the
    # latest event. This gives us a little resilience against a single
    # noisy observation.
    # ------------------------------------------------------------------

    stmt = (
        select(PlateEvent)
        .where(
            PlateEvent.plate_number
            == current_event.plate_number,
            PlateEvent.timestamp
            >= lookback_start,
            PlateEvent.timestamp
            <= current_timestamp,
        )
        .order_by(
            desc(PlateEvent.timestamp),
            desc(PlateEvent.id),
        )
        .limit(10)
    )

    result = await db.execute(stmt)

    previous_events = (
        result.scalars().all()
    )

    # ------------------------------------------------------------------
    # First sighting of this plate.
    # ------------------------------------------------------------------

    if not previous_events:

        vehicle_id = (
            f"V_{uuid.uuid4().hex[:8].upper()}"
        )

        vehicle = Vehicle(
            id=vehicle_id,
            first_seen=current_timestamp,
            last_seen=current_timestamp,
        )

        db.add(vehicle)

        return (
            vehicle_id,
            False,
            None,
        )

    # ------------------------------------------------------------------
    # Evaluate recent observations.
    #
    # We prefer the newest observation because it represents the most
    # recent identity state, but we also stop at the first strong
    # contradiction that satisfies our temporal/spatial constraints.
    # ------------------------------------------------------------------

    latest_event = previous_events[0]

    for previous_event in previous_events:

        time_delta = (
            current_timestamp
            - previous_event.timestamp
        )

        time_delta_minutes = (
            time_delta.total_seconds()
            / 60.0
        )

        if time_delta_minutes < 0:
            continue

        if (
            time_delta_minutes
            > CLONING_MAX_TIME_MINUTES
        ):
            continue

        type_clash, color_clash = (
            _attribute_mismatch(
                previous_event,
                current_event,
            )
        )

        # Nothing contradictory about this observation.
        if not type_clash and not color_clash:
            continue

                # --------------------------------------------------------------
        # Spatial relationship
        # --------------------------------------------------------------

        previous_camera = await db.get(
            Camera,
            previous_event.camera_id,
        )

        if previous_camera is None:
            continue

        distance_km = _haversine_km(
            previous_camera.lat,
            previous_camera.lng,
            current_event.lat,
            current_event.lng,
        )

        # Same/very-near camera:
        if (
            distance_km
            < CLONING_MIN_DISTANCE_KM
        ):
            continue

        # Same/very-near camera:
        #
        # Different detector classifications at the same location are
        # more likely to be perception noise than simultaneous cloning.
        if (
            distance_km
            < CLONING_MIN_DISTANCE_KM
        ):
            continue

        # --------------------------------------------------------------
        # Strong contradiction
        # --------------------------------------------------------------
        #
        # Vehicle TYPE mismatch is the primary signal.
        #
        # Color mismatch alone is deliberately NOT enough because the
        # current color detector is heuristic and lighting can change
        # apparent color.
        # --------------------------------------------------------------

        if type_clash:

            previous_vehicle_type = (
                previous_event.vehicle_type
                or "unknown"
            )

            current_vehicle_type = (
                current_event.vehicle_type
                or "unknown"
            )

            previous_color = (
                previous_event.color
                or "unknown"
            )

            current_color = (
                current_event.color
                or "unknown"
            )

            logger.warning(
                "Possible plate cloning: plate=%s "
                "previous=[%s %s] current=[%s %s] "
                "distance=%.2fkm time_delta=%.2fmin",
                current_event.plate_number,
                previous_color,
                previous_vehicle_type,
                current_color,
                current_vehicle_type,
                distance_km,
                time_delta_minutes,
            )

            # Create a separate Vehicle so the two trajectories don't
            # become one logical entity.
            cloned_vehicle_id = (
                f"V_{uuid.uuid4().hex[:8].upper()}"
            )

            cloned_vehicle = Vehicle(
                id=cloned_vehicle_id,
                first_seen=current_timestamp,
                last_seen=current_timestamp,
            )

            db.add(cloned_vehicle)

            return (
                cloned_vehicle_id,
                True,
                previous_event,
            )

    # ------------------------------------------------------------------
    # No strong contradiction.
    #
    # Continue the latest known vehicle if possible.
    # ------------------------------------------------------------------

    if latest_event.vehicle_id:

        vehicle = await db.get(
            Vehicle,
            latest_event.vehicle_id,
        )

        if vehicle:

            vehicle.last_seen = (
                current_timestamp
            )

            return (
                vehicle.id,
                False,
                latest_event,
            )

    # ------------------------------------------------------------------
    # Legacy/fallback path.
    #
    # Existing events created before Vehicle support may have no
    # vehicle_id. Rather than modifying historical data here, create
    # a new Vehicle for this observation.
    # ------------------------------------------------------------------

    vehicle_id = (
        f"V_{uuid.uuid4().hex[:8].upper()}"
    )

    vehicle = Vehicle(
        id=vehicle_id,
        first_seen=current_timestamp,
        last_seen=current_timestamp,
    )

    db.add(vehicle)

    return (
        vehicle_id,
        False,
        latest_event,
    )


# ============================================================================
# Event persistence + alert handling
# ============================================================================

async def _write_event_and_maybe_alert(
    db: AsyncSession,
    cam: Camera,
    plate_event: PipelinePlateEvent,
) -> dict:
    """
    Persist one detected observation.

    Processing order:

        1. Resolve vehicle identity.
        2. Persist PlateEvent.
        3. Trigger possible plate-cloning alert.
        4. Check blacklist.
        5. Check speed anomaly.
        6. Commit the complete transaction.
    """

    db_t0 = perf_counter()

    # ------------------------------------------------------------------
    # 1. Vehicle identity
    # ------------------------------------------------------------------

    (
        vehicle_id,
        is_clash,
        previous_event,
    ) = await resolve_vehicle_identity(
        db,
        plate_event,
    )

    # ------------------------------------------------------------------
    # 2. Persist observation
    # ------------------------------------------------------------------

    db_event = PlateEvent(
        vehicle_id=vehicle_id,
        plate_number=plate_event.plate_number,
        camera_id=plate_event.camera_id,
        timestamp=plate_event.timestamp,
        confidence=plate_event.confidence,
        vehicle_type=(
            plate_event.vehicle_type
            or "unknown"
        ),
        color=(
            plate_event.color
            or "unknown"
        ),
        frame_snapshot_path=(
            plate_event.frame_snapshot_path
        ),
    )

    db.add(db_event)

    await db.flush()

    # ------------------------------------------------------------------
    # Update Vehicle last_seen.
    #
    # For newly-created vehicles this may be a pending INSERT, but
    # SQLAlchemy's identity map lets us retrieve/update it safely.
    # ------------------------------------------------------------------

    vehicle = await db.get(
        Vehicle,
        vehicle_id,
    )

    if vehicle:
        vehicle.last_seen = (
            plate_event.timestamp
        )

    # ------------------------------------------------------------------
    # 3. Possible plate cloning alert
    # ------------------------------------------------------------------

    if (
        is_clash
        and previous_event is not None
    ):

        previous_type = (
            previous_event.vehicle_type
            or "unknown"
        )

        previous_color = (
            previous_event.color
            or "unknown"
        )

        current_type = (
            plate_event.vehicle_type
            or "unknown"
        )

        current_color = (
            plate_event.color
            or "unknown"
        )

        details = (
            "Possible plate inconsistency: "
            f"plate {plate_event.plate_number} "
            f"was previously observed on a "
            f"{previous_color} {previous_type}, "
            f"but is now observed on a "
            f"{current_color} {current_type}."
        )

        alert = Alert(
            plate_number=(
                plate_event.plate_number
            ),
            camera_id=(
                plate_event.camera_id
            ),
            timestamp=(
                plate_event.timestamp
            ),
            alert_type="plate_cloning",
            resolved=False,
            details=details,
            source="identity_resolution",
        )

        db.add(alert)

        await db.flush()

        await alert_manager.broadcast_alert(
            alert_id=alert.id,
            plate_number=(
                plate_event.plate_number
            ),
            camera_id=(
                plate_event.camera_id
            ),
            camera_name=cam.name,
            alert_type="plate_cloning",
            timestamp=(
                plate_event.timestamp
            ),
            details=details,
            source="identity_resolution",
        )

        metrics.increment(
            "alerts_broadcast"
        )

        logger.warning(
            "🚨 POSSIBLE PLATE CLONING: "
            "%s at %s — %s",
            plate_event.plate_number,
            cam.name,
            details,
        )

    # ------------------------------------------------------------------
    # 4. Blacklist check
    # ------------------------------------------------------------------

    bl_entry = await db.get(
        Blacklist,
        plate_event.plate_number,
    )

    is_blacklisted = (
        bl_entry is not None
    )

    if bl_entry:

        alert = Alert(
            plate_number=(
                plate_event.plate_number
            ),
            camera_id=(
                plate_event.camera_id
            ),
            timestamp=(
                plate_event.timestamp
            ),
            alert_type="blacklist_hit",
            resolved=False,
            details=(
                f"Blacklisted: "
                f"{bl_entry.reason}"
            ),
            source="detection",
        )

        db.add(alert)

        await db.flush()

        await alert_manager.broadcast_alert(
            alert_id=alert.id,
            plate_number=(
                plate_event.plate_number
            ),
            camera_id=(
                plate_event.camera_id
            ),
            camera_name=cam.name,
            alert_type="blacklist_hit",
            timestamp=(
                plate_event.timestamp
            ),
            details=(
                "Blacklisted plate detected "
                f"at {cam.name}. "
                f"Reason: {bl_entry.reason}"
            ),
            source="detection",
        )

        metrics.increment(
            "alerts_broadcast"
        )

        logger.warning(
            "🚨 BLACKLIST HIT: %s at %s",
            plate_event.plate_number,
            cam.name,
        )

    # ------------------------------------------------------------------
    # 5. Speed anomaly
    # ------------------------------------------------------------------

    await check_speed_anomaly(
        db,
        plate_number=(
            plate_event.plate_number
        ),
        camera_id=(
            plate_event.camera_id
        ),
        camera_name=cam.name,
        camera_lat=cam.lat,
        camera_lng=cam.lng,
        timestamp=(
            plate_event.timestamp
        ),
    )

    # ------------------------------------------------------------------
    # 6. Commit entire observation transaction
    # ------------------------------------------------------------------

    await db.commit()

    metrics.record_latency(
        "event_persistence",
        (perf_counter() - db_t0) * 1000,
    )

    metrics.increment(
        "events_persisted"
    )

    return {
        "event_id": db_event.id,
        "vehicle_id": vehicle_id,
        "plate_number": (
            plate_event.plate_number
        ),
        "vehicle_type": (
            plate_event.vehicle_type
            or "unknown"
        ),
        "color": (
            plate_event.color
            or "unknown"
        ),
        "confidence": (
            plate_event.confidence
        ),
        "possible_plate_cloning": (
            is_clash
        ),
        "blacklisted": (
            is_blacklisted
        ),
        "reason": (
            bl_entry.reason
            if bl_entry
            else None
        ),
    }


# ============================================================================
# Registered camera video ingestion
# ============================================================================

async def _run_ingestion(
    camera_id: str,
    video_path: str,
) -> None:
    """
    Background coroutine:
    run the full ANPR + vehicle intelligence pipeline
    for one registered camera.
    """

    _ingestion_status[camera_id] = {
        "status": "running",
        "started_at": (
            datetime.now(
                timezone.utc
            ).isoformat()
        ),
        "events_written": 0,
        "errors": [],
    }

    # ------------------------------------------------------------------
    # Load camera metadata.
    # ------------------------------------------------------------------

    async with AsyncSessionLocal() as db:

        cam = await db.get(
            Camera,
            camera_id,
        )

        if cam is None:

            _ingestion_status[camera_id][
                "status"
            ] = "error"

            _ingestion_status[camera_id][
                "errors"
            ].append(
                f"Camera {camera_id} "
                "not found in DB"
            )

            return

    try:

        # --------------------------------------------------------------
        # Build source
        # --------------------------------------------------------------

        source = VideoFileSource(
            video_path
        )

        # --------------------------------------------------------------
        # Build ANPR pipeline.
        #
        # The pipeline now emits:
        #
        #   plate_number
        #   camera_id
        #   lat/lng
        #   timestamp
        #   confidence
        #   vehicle_type
        #   color
        # --------------------------------------------------------------

        pipeline = ANPRPipeline(
            source=source,
            camera_id=camera_id,
            camera_lat=cam.lat,
            camera_lng=cam.lng,
            video_start_time=(
                datetime.now(
                    timezone.utc
                )
            ),
            save_snapshots=False,
        )

        events_written = 0

        # --------------------------------------------------------------
        # Persist pipeline events.
        # --------------------------------------------------------------

        async with AsyncSessionLocal() as db:

            async for plate_event in pipeline.run():

                await _write_event_and_maybe_alert(
                    db,
                    cam,
                    plate_event,
                )

                events_written += 1

                _ingestion_status[camera_id][
                    "events_written"
                ] = events_written

        # --------------------------------------------------------------
        # Complete
        # --------------------------------------------------------------

        _ingestion_status[camera_id][
            "status"
        ] = "done"

        _ingestion_status[camera_id][
            "completed_at"
        ] = (
            datetime.now(
                timezone.utc
            ).isoformat()
        )

        logger.info(
            "Ingestion complete for %s: "
            "%s events written.",
            camera_id,
            events_written,
        )

    except Exception as e:

        logger.exception(
            "Ingestion failed for %s: %s",
            camera_id,
            e,
        )

        _ingestion_status[camera_id][
            "status"
        ] = "error"

        _ingestion_status[camera_id][
            "errors"
        ].append(
            str(e)
        )


# ============================================================================
# Uploaded video ingestion
# ============================================================================

async def _run_upload_video_ingestion(
    camera_id: str,
    video_path: str,
    cam_lat: float,
    cam_lng: float,
) -> None:
    """
    Background coroutine for an uploaded video.

    Uses the exact same ANPRPipeline and persistence path as registered
    camera ingestion.
    """

    _ingestion_status[camera_id] = {
        "status": "running",
        "started_at": (
            datetime.now(
                timezone.utc
            ).isoformat()
        ),
        "events_written": 0,
        "errors": [],
    }

    try:

        source = VideoFileSource(
            video_path
        )

        pipeline = ANPRPipeline(
            source=source,
            camera_id=camera_id,
            camera_lat=cam_lat,
            camera_lng=cam_lng,
            video_start_time=(
                datetime.now(
                    timezone.utc
                )
            ),
            save_snapshots=False,
        )

        events_written = 0

        async with AsyncSessionLocal() as db:

            cam = await db.get(
                Camera,
                camera_id,
            )

            if cam is None:

                cam = await _get_or_create_upload_camera(
                    db,
                    camera_id,
                )

            async for plate_event in pipeline.run():

                await _write_event_and_maybe_alert(
                    db,
                    cam,
                    plate_event,
                )

                events_written += 1

                _ingestion_status[camera_id][
                    "events_written"
                ] = events_written

        _ingestion_status[camera_id][
            "status"
        ] = "done"

        _ingestion_status[camera_id][
            "completed_at"
        ] = (
            datetime.now(
                timezone.utc
            ).isoformat()
        )

        logger.info(
            "Upload ingestion complete "
            "for %s: %s events written.",
            camera_id,
            events_written,
        )

    except Exception as e:

        logger.exception(
            "Upload ingestion failed for %s: %s",
            camera_id,
            e,
        )

        _ingestion_status[camera_id][
            "status"
        ] = "error"

        _ingestion_status[camera_id][
            "errors"
        ].append(
            str(e)
        )


# ============================================================================
# Upload image/video
# ============================================================================

@router.post("/upload")
async def upload_and_detect(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    camera_id: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(
        require_role("investigator")
    ),
):
    """
    Upload an image or video and run detection.

    Images are processed synchronously.

    Videos are queued as background ingestion jobs.

    Image processing intentionally uses the same:
        plate detector
        vehicle detector
        vehicle association
        OCR
        identity resolution
        blacklist
        anomaly

    path as normal ingestion as closely as possible.
    """

    ext = Path(
        file.filename or ""
    ).suffix.lower()

    if (
        ext not in _IMAGE_EXTS
        and ext not in _VIDEO_EXTS
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported file type "
                f"'{ext}'. "
                f"Use an image "
                f"({', '.join(sorted(_IMAGE_EXTS))}) "
                f"or video "
                f"({', '.join(sorted(_VIDEO_EXTS))})."
            ),
        )

    target_camera_id = (
        camera_id
        or _UPLOAD_CAMERA_ID
    )

    cam = await _get_or_create_upload_camera(
        db,
        target_camera_id,
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
        / f"{uuid.uuid4().hex}{ext}"
    )

    dest_path.write_bytes(
        await file.read()
    )

    # ==================================================================
    # IMAGE
    # ==================================================================

    if ext in _IMAGE_EXTS:

        frame = cv2.imread(
            str(dest_path)
        )

        if frame is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Could not read "
                    "uploaded image."
                ),
            )

        loop = (
            asyncio.get_running_loop()
        )

        # --------------------------------------------------------------
        # Plate detection
        # --------------------------------------------------------------

        detections = (
            await loop.run_in_executor(
                None,
                plate_detector.detect,
                frame,
            )
        )

        # --------------------------------------------------------------
        # Vehicle detection
        #
        # Same rule as Preview:
        # only run vehicle detection if plates exist.
        # --------------------------------------------------------------

        vehicle_dets = []

        if detections:

            vehicle_dets = (
                await loop.run_in_executor(
                    None,
                    vehicle_detector.detect,
                    frame,
                )
            )

        # --------------------------------------------------------------
        # Process detections
        # --------------------------------------------------------------

        now = datetime.now(
            timezone.utc
        )

        results = []

        for det in detections:

            # ----------------------------------------------------------
            # Vehicle association
            # ----------------------------------------------------------

            vehicle = _associate_vehicle(
                det,
                vehicle_dets,
            )

            if vehicle is not None:

                vehicle_type = (
                    vehicle.vehicle_type
                )

                vehicle_color = (
                    vehicle.color
                )

            else:

                vehicle_type = "unknown"
                vehicle_color = "unknown"

            # ----------------------------------------------------------
            # OCR
            # ----------------------------------------------------------

            plate_text, ocr_conf = (
                await loop.run_in_executor(
                    None,
                    plate_ocr.read,
                    det.crop,
                )
            )

            if (
                not plate_text
                or ocr_conf
                < settings.OCR_CONFIDENCE_THRESHOLD
            ):
                continue

            # ----------------------------------------------------------
            # Combined confidence
            # ----------------------------------------------------------

            combined_conf = (
                det.confidence
                * ocr_conf
            ) ** 0.5

            # ----------------------------------------------------------
            # Build the same PipelinePlateEvent emitted by the normal
            # ANPR pipeline.
            # ----------------------------------------------------------

            plate_event = PipelinePlateEvent(
                plate_number=plate_text,
                camera_id=target_camera_id,
                lat=cam.lat,
                lng=cam.lng,
                timestamp=now,
                confidence=round(
                    combined_conf,
                    4,
                ),
                vehicle_type=vehicle_type,
                color=vehicle_color,
                frame_snapshot_path=None,
            )

            # ----------------------------------------------------------
            # Persist through the exact same identity/alert path.
            # ----------------------------------------------------------

            result = (
                await _write_event_and_maybe_alert(
                    db,
                    cam,
                    plate_event,
                )
            )

            results.append(result)

        return {
            "status": "done",
            "type": "image",
            "camera_id": target_camera_id,
            "detections": results,
        }

    # ==================================================================
    # VIDEO
    # ==================================================================

    if (
        _ingestion_status
        .get(target_camera_id, {})
        .get("status")
        == "running"
    ):
        return {
            "message": (
                f"Ingestion already running "
                f"for {target_camera_id}"
            ),
            "status": "running",
            "camera_id": target_camera_id,
        }

    background_tasks.add_task(
        _run_upload_video_ingestion,
        target_camera_id,
        str(dest_path),
        cam.lat,
        cam.lng,
    )

    return {
        "status": "started",
        "type": "video",
        "camera_id": target_camera_id,
        "message": (
            "Processing uploaded video "
            f"for camera '{target_camera_id}'. "
            "Poll "
            f"/ingest/status/{target_camera_id}."
        ),
    }


# ============================================================================
# Start registered-camera ingestion
# ============================================================================

@router.post("/{camera_id}")
async def start_ingestion(
    camera_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(
        require_role("investigator")
    ),
):
    """
    Start ingesting a video file for a registered camera.

    Expected location:

        VIDEOS_DIR/{camera_id}.mp4

    Also supports:
        .avi
        .mov
        .mkv
    """

    cam = await db.get(
        Camera,
        camera_id,
    )

    if cam is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Camera '{camera_id}' "
                "not found"
            ),
        )

    # ------------------------------------------------------------------
    # Locate video
    # ------------------------------------------------------------------

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

            video_path = str(
                candidate
            )

            break

    if video_path is None:

        raise HTTPException(
            status_code=404,
            detail=(
                f"No video file found "
                f"for camera '{camera_id}'. "
                f"Expected: "
                f"{videos_dir}/"
                f"{camera_id}.mp4 "
                "(or .avi/.mov/.mkv)"
            ),
        )

    # ------------------------------------------------------------------
    # Prevent duplicate ingestion
    # ------------------------------------------------------------------

    if (
        _ingestion_status
        .get(camera_id, {})
        .get("status")
        == "running"
    ):

        return {
            "message": (
                f"Ingestion already "
                f"running for {camera_id}"
            ),
            "status": "running",
        }

    # ------------------------------------------------------------------
    # Start background task
    # ------------------------------------------------------------------

    background_tasks.add_task(
        _run_ingestion,
        camera_id,
        video_path,
    )

    return {
        "message": (
            f"Ingestion started for "
            f"camera '{camera_id}' "
            f"({cam.name})"
        ),
        "video": video_path,
        "status": "started",
    }


# ============================================================================
# Ingestion status
# ============================================================================

@router.get(
    "/status/{camera_id}"
)
async def get_ingestion_status(
    camera_id: str,
    _user: User = Depends(
        require_role("viewer")
    ),
):
    """Get the current ingestion status."""

    status = _ingestion_status.get(
        camera_id
    )

    if status is None:
        return {
            "camera_id": camera_id,
            "status": "idle",
        }

    return {
        "camera_id": camera_id,
        **status,
    }


@router.get("/status")
async def get_all_ingestion_status(
    _user: User = Depends(
        require_role("viewer")
    ),
):
    """Get ingestion status for all cameras."""

    return _ingestion_status