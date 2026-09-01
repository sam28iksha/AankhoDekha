#!/usr/bin/env python3
"""
NAGARNETRA — Video Ingestion Script
====================================
Processes all video files in data/sample_videos/ through the ANPR pipeline
and writes plate events to the database.

Convention: filename must match camera_id.
  data/sample_videos/cam_01.mp4  →  camera cam_01 (Connaught Place)
  data/sample_videos/cam_03.avi  →  camera cam_03 (AIIMS)

Usage:
  # Process all cameras found in the videos directory:
  python scripts/ingest_videos.py

  # Process a specific camera only:
  python scripts/ingest_videos.py --camera cam_01

  # Adjust frame sample rate (process every Nth frame):
  python scripts/ingest_videos.py --sample-rate 10

  # Save debug frame snapshots:
  python scripts/ingest_videos.py --save-snapshots

Run from the project root (the directory containing backend/ and data/).
Requires backend Python environment to be active.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

# Add backend to Python path
# Path resolution — two-runtime design:
#   Local: inserts NAGARNETRA/backend/ so backend modules resolve.
#   Docker: PYTHONPATH=/app (docker-compose.yml) handles it; insert is a no-op.
_backend_path = Path(__file__).parent.parent / "backend"
if _backend_path.exists():
    sys.path.insert(0, str(_backend_path))

from config import settings
from db.init_db import init_db
from db.base import AsyncSessionLocal
from db.models import Camera, PlateEvent, Blacklist, Alert
from anpr.frame_source import VideoFileSource
from anpr.pipeline import ANPRPipeline
from api.alert_manager import alert_manager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("ingest")

VIDEO_EXTENSIONS = (".mp4", ".avi", ".mov", ".mkv", ".webm")


async def load_cameras() -> dict[str, dict]:
    """Load camera registry from cameras.json."""
    cameras_path = Path(settings.CAMERAS_JSON_PATH)
    with cameras_path.open() as f:
        camera_list = json.load(f)
    return {c["camera_id"]: c for c in camera_list}


async def ingest_camera(
    camera_id: str,
    video_path: Path,
    camera_meta: dict,
    sample_rate: int,
    save_snapshots: bool,
) -> int:
    """Process one camera video. Returns number of events written."""
    logger.info(f"═══ Starting ingestion: {camera_id} ({camera_meta['name']}) ═══")
    logger.info(f"    Video: {video_path}")

    try:
        source = VideoFileSource(video_path, sample_rate=sample_rate)
        logger.info(f"    Frames: {source.total_frames} total, sampling every {sample_rate}th ({source.fps:.1f} fps)")
    except FileNotFoundError as e:
        logger.error(str(e))
        return 0

    pipeline = ANPRPipeline(
        source=source,
        camera_id=camera_id,
        camera_lat=camera_meta["lat"],
        camera_lng=camera_meta["lng"],
        video_start_time=datetime.now(timezone.utc),
        save_snapshots=save_snapshots,
    )

    events_written = 0
    alerts_fired = 0

    async with AsyncSessionLocal() as db:
        async for plate_event in pipeline.run():
            # Write plate event
            db_event = PlateEvent(
                plate_number=plate_event.plate_number,
                camera_id=plate_event.camera_id,
                timestamp=plate_event.timestamp,
                confidence=plate_event.confidence,
                frame_snapshot_path=plate_event.frame_snapshot_path,
            )
            db.add(db_event)
            await db.flush()

            # Blacklist check
            bl_entry = await db.get(Blacklist, plate_event.plate_number)
            if bl_entry:
                alert = Alert(
                    plate_number=plate_event.plate_number,
                    camera_id=plate_event.camera_id,
                    timestamp=plate_event.timestamp,
                    alert_type="blacklist_hit",
                    resolved=False,
                    details=f"Blacklisted plate detected at {camera_meta['name']}. Reason: {bl_entry.reason}",
                )
                db.add(alert)
                alerts_fired += 1
                logger.warning(
                    f"🚨 BLACKLIST HIT: {plate_event.plate_number} "
                    f"at {camera_meta['name']} ({plate_event.timestamp.strftime('%H:%M:%S')})"
                )

            await db.commit()
            events_written += 1

    logger.info(f"    ✓ {events_written} events written, {alerts_fired} alerts fired for {camera_id}")
    return events_written


async def main(args: argparse.Namespace) -> None:
    logger.info("NAGARNETRA Ingestion Script")
    logger.info("=" * 50)

    # Init DB
    await init_db()

    # Load camera registry
    cameras = await load_cameras()
    logger.info(f"Loaded {len(cameras)} cameras from cameras.json")

    # Find video files
    videos_dir = Path(settings.VIDEOS_DIR)
    if not videos_dir.exists():
        logger.error(f"Videos directory not found: {videos_dir}")
        logger.error("Create it and drop in video files named cam_01.mp4, cam_02.mp4, etc.")
        sys.exit(1)

    found_videos: list[tuple[str, Path]] = []
    for ext in VIDEO_EXTENSIONS:
        for vp in videos_dir.glob(f"*{ext}"):
            cam_id = vp.stem  # filename without extension
            if cam_id in cameras:
                found_videos.append((cam_id, vp))
            else:
                logger.warning(f"Video '{vp.name}' has no matching camera_id '{cam_id}' — skipping.")

    if not found_videos:
        logger.warning("No matching video files found in " + str(videos_dir))
        logger.warning("Expected filenames: cam_01.mp4, cam_02.mp4, ..., cam_12.mp4")
        return

    # Filter by camera if requested
    if args.camera:
        found_videos = [(cid, vp) for cid, vp in found_videos if cid == args.camera]
        if not found_videos:
            logger.error(f"No video file found for camera '{args.camera}'")
            sys.exit(1)

    logger.info(f"Found {len(found_videos)} video(s) to process: {[cid for cid, _ in found_videos]}")
    logger.info("")

    total_events = 0
    for cam_id, video_path in sorted(found_videos):
        cam_meta = cameras[cam_id]
        n = await ingest_camera(
            camera_id=cam_id,
            video_path=video_path,
            camera_meta=cam_meta,
            sample_rate=args.sample_rate,
            save_snapshots=args.save_snapshots,
        )
        total_events += n
        logger.info("")

    logger.info("=" * 50)
    logger.info(f"✅ Ingestion complete: {total_events} events written across {len(found_videos)} camera(s).")
    logger.info("")
    logger.info("Next step: run 'python scripts/list_detected_plates.py' to see detected plates")
    logger.info("and pick 3-4 to add to data/blacklist.json for the blacklist demo.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="NAGARNETRA video ingestion script")
    parser.add_argument("--camera", type=str, default=None, help="Process only this camera_id (e.g. cam_01)")
    parser.add_argument("--sample-rate", type=int, default=settings.FRAME_SAMPLE_RATE, help="Process every Nth frame")
    parser.add_argument("--save-snapshots", action="store_true", help="Save JPEG snapshots for each detected plate")
    args = parser.parse_args()

    asyncio.run(main(args))
