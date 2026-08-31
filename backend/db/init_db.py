"""
NAGARNETRA — DB Initializer
Creates all tables and seeds cameras from cameras.json + blacklist from blacklist.json.
Called on application startup.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.base import Base, engine, AsyncSessionLocal
from db.models import Camera, Blacklist
from config import settings

logger = logging.getLogger(__name__)


async def create_tables() -> None:
    """Create all ORM tables (idempotent)."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables created / verified.")


async def seed_cameras() -> None:
    """Load cameras.json into the cameras table (upsert by camera_id)."""
    cameras_path = Path(settings.CAMERAS_JSON_PATH)
    if not cameras_path.exists():
        logger.warning(f"cameras.json not found at {cameras_path}")
        return

    with cameras_path.open() as f:
        camera_list = json.load(f)

    async with AsyncSessionLocal() as session:
        for cam_data in camera_list:
            existing = await session.get(Camera, cam_data["camera_id"])
            if existing is None:
                cam = Camera(
                    id=cam_data["camera_id"],
                    name=cam_data["name"],
                    lat=cam_data["lat"],
                    lng=cam_data["lng"],
                    road_segment=cam_data.get("road_segment"),
                )
                session.add(cam)
        await session.commit()
    logger.info(f"Seeded {len(camera_list)} cameras into DB.")


async def seed_blacklist() -> None:
    """Load blacklist.json into the blacklist table (skip placeholders)."""
    bl_path = Path(settings.BLACKLIST_JSON_PATH)
    if not bl_path.exists():
        logger.warning(f"blacklist.json not found at {bl_path}")
        return

    with bl_path.open() as f:
        data = json.load(f)

    plates = data.get("plates", [])
    real_plates = [p for p in plates if not p.get("_placeholder", False)]

    if not real_plates:
        logger.info("blacklist.json has no real plates yet (all placeholders). Skipping blacklist seed.")
        return

    from datetime import datetime, timezone

    async with AsyncSessionLocal() as session:
        count = 0
        for p in real_plates:
            existing = await session.get(Blacklist, p["plate_number"])
            if existing is None:
                bl = Blacklist(
                    plate_number=p["plate_number"].upper().strip(),
                    reason=p.get("reason"),
                    added_at=datetime.fromisoformat(p["added_at"].replace("Z", "+00:00"))
                    if p.get("added_at")
                    else datetime.now(timezone.utc),
                )
                session.add(bl)
                count += 1
        await session.commit()
    logger.info(f"Seeded {count} blacklist entries into DB.")


async def init_db() -> None:
    """Full DB initialization — tables + seeds."""
    await create_tables()
    await seed_cameras()
    await seed_blacklist()
