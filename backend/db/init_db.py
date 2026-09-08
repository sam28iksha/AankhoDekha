"""
NAGARNETRA — DB Initializer
Creates all tables and seeds cameras from cameras.json + blacklist from blacklist.json.
Called on application startup.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from db.base import Base, engine, AsyncSessionLocal
from db.models import Camera, Blacklist, User
from config import settings
from auth.security import hash_password

logger = logging.getLogger(__name__)


async def create_tables() -> None:
    """Create all ORM tables (idempotent)."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables created / verified.")


async def migrate_schema() -> None:
    """
    Add columns to already-existing tables that create_tables() can't touch
    (Base.metadata.create_all only creates missing TABLES, never adds a
    missing column to a table that already exists) — so a schema change
    against a populated demo DB needs an explicit, idempotent ALTER here.

    SQLite-only: production Postgres deployments should use a real migration
    tool (Alembic) instead of this ad-hoc check.
    """
    if settings.DB_MODE != "sqlite":
        return

    async with engine.begin() as conn:
        result = await conn.execute(text("PRAGMA table_info(alerts)"))
        columns = {row[1] for row in result.fetchall()}
        if "source" not in columns:
            await conn.execute(
                text("ALTER TABLE alerts ADD COLUMN source TEXT NOT NULL DEFAULT 'detection'")
            )
            logger.info("Migrated: added alerts.source column.")


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


async def seed_admin_user() -> None:
    """
    Seed exactly one bootstrap admin account if the users table is empty —
    solves "how do I log in the first time" without shipping a fixed
    account that would exist in every deployment forever. Only fires when
    NO users exist yet, so it never resets a password an admin has changed.
    """
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).limit(1))
        if result.scalar_one_or_none() is not None:
            return

        session.add(User(
            username=settings.INITIAL_ADMIN_USERNAME,
            password_hash=hash_password(settings.INITIAL_ADMIN_PASSWORD),
            role="admin",
            full_name="Bootstrap Admin",
        ))
        await session.commit()
    logger.warning(
        f"No users existed — seeded bootstrap admin '{settings.INITIAL_ADMIN_USERNAME}'. "
        "Log in and change this password, or set INITIAL_ADMIN_USERNAME/"
        "INITIAL_ADMIN_PASSWORD in .env before first startup in a real deployment."
    )


async def init_db() -> None:
    """Full DB initialization — tables + migrations + seeds."""
    await create_tables()
    await migrate_schema()
    await seed_cameras()
    await seed_blacklist()
    await seed_admin_user()
