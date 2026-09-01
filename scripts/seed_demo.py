#!/usr/bin/env python3
"""
NAGARNETRA — Demo Seed Script
==============================
Populates the database with synthetic historical events so the dashboard
isn't empty before real video files are provided.

Creates:
  - Realistic plate events spread across all 12 Delhi cameras (past 48h)
  - 2 vehicles with multi-camera trajectories (for trajectory demo)
  - 3 blacklist alerts
  - Various traffic density patterns

Usage:
  python scripts/seed_demo.py
  python scripts/seed_demo.py --clear  (wipe existing synthetic data first)
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import random
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

# Path resolution — two-runtime design:
#   Local (python scripts/seed_demo.py): inserts NAGARNETRA/backend/ so
#     'from db.xxx import ...' resolves without installing the package.
#   Docker (docker compose exec backend python /app/scripts/seed_demo.py):
#     PYTHONPATH=/app is set in docker-compose.yml so /app/backend/ is never
#     needed — this insert is a no-op (non-existent path is silently ignored).
_backend_path = Path(__file__).parent.parent / "backend"
if _backend_path.exists():
    sys.path.insert(0, str(_backend_path))

from db.init_db import init_db
from db.base import AsyncSessionLocal
from db.models import Camera, PlateEvent, Blacklist, Alert

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(message)s")
logger = logging.getLogger("seed")

# ── Synthetic data config ────────────────────────────────────────

# Plates designed for multi-camera trajectory demos
TRAJECTORY_PLATES = [
    ("DL01AB2345", ["cam_01", "cam_02", "cam_09"]),  # CP → ITO → Akshardham
    ("HR26DK4321", ["cam_08", "cam_05", "cam_01", "cam_06"]),  # Rajouri → KB → CP → Kashmere
]

# Blacklist plates (must be real plates — will be injected into DB + blacklist table)
BLACKLIST_PLATES = [
    ("DL01AB2345", "Stolen vehicle — FIR #DL2024-00891"),
    ("UP80AB9999", "Suspected criminal activity — wanted for questioning"),
    ("MH12PA7890", "Outstanding warrant — non-bailable offence"),
]

# General traffic plates (simulating background traffic)
GENERAL_PLATES = [
    "DL01CA1111", "DL03XY4567", "DL05ZA8901", "DL07CB2234",
    "DL09DD6678", "UP14AR3345", "UP32BB5678", "HR29DD9012",
    "MH01PB3456", "RJ14BK7890", "DL01CD0001", "DL02EF0002",
    "DL04GH0003", "DL06IJ0004", "DL08KL0005", "UP16MN0006",
    "UP80OP0007", "HR26QR0008", "DL10ST0009", "DL12UV0010",
    "DL01AB1001", "DL02CD2002", "DL04EF3003", "DL07GH4004",
]

CAMERAS_JSON = Path(__file__).parent.parent / "data" / "cameras.json"


async def seed_demo(clear: bool = False) -> None:
    await init_db()

    # Load cameras
    with CAMERAS_JSON.open() as f:
        camera_list = json.load(f)
    cameras = {c["camera_id"]: c for c in camera_list}

    now = datetime.now(timezone.utc)
    base_time = now - timedelta(hours=48)

    async with AsyncSessionLocal() as db:
        if clear:
            from sqlalchemy import delete
            await db.execute(delete(Alert))
            await db.execute(delete(PlateEvent))
            await db.execute(delete(Blacklist))
            await db.commit()
            logger.info("Cleared existing data.")

        # ── Seed blacklist ────────────────────────────────────────
        for plate, reason in BLACKLIST_PLATES:
            existing = await db.get(Blacklist, plate)
            if not existing:
                db.add(Blacklist(plate_number=plate, reason=reason, added_at=base_time))
        await db.commit()
        logger.info(f"Seeded {len(BLACKLIST_PLATES)} blacklist plates.")

        # ── Seed trajectory plates (multi-camera) ─────────────────
        traj_events = 0
        for plate, cam_sequence in TRAJECTORY_PLATES:
            start = base_time + timedelta(hours=random.randint(2, 10))
            travel_time = timedelta(minutes=random.randint(12, 30))
            for i, cam_id in enumerate(cam_sequence):
                cam = cameras[cam_id]
                ts = start + travel_time * i + timedelta(seconds=random.randint(-30, 30))
                conf = round(random.uniform(0.78, 0.96), 3)
                db.add(PlateEvent(
                    plate_number=plate,
                    camera_id=cam_id,
                    timestamp=ts,
                    confidence=conf,
                ))
                traj_events += 1

                # Fire blacklist alert if this plate is blacklisted
                bl = await db.get(Blacklist, plate)
                if bl:
                    db.add(Alert(
                        plate_number=plate,
                        camera_id=cam_id,
                        timestamp=ts,
                        alert_type="blacklist_hit",
                        resolved=False,
                        details=f"Blacklisted plate '{plate}' detected at {cam['name']}. Reason: {bl.reason}",
                    ))
        await db.commit()
        logger.info(f"Seeded {traj_events} trajectory events.")

        # ── Seed background traffic (random density per camera/hour) ──
        bg_events = 0
        for cam_id, cam_meta in cameras.items():
            # More traffic at major junctions during peak hours
            is_busy = cam_id in ("cam_01", "cam_02", "cam_06")

            for hour_offset in range(48):
                t = base_time + timedelta(hours=hour_offset)
                hour = t.hour
                # Simulate peak hours (8-10am, 5-8pm)
                if 8 <= hour <= 10 or 17 <= hour <= 20:
                    n_events = random.randint(8, 20) if is_busy else random.randint(4, 12)
                elif 0 <= hour <= 5:
                    n_events = random.randint(0, 3)
                else:
                    n_events = random.randint(3, 10)

                for _ in range(n_events):
                    plate = random.choice(GENERAL_PLATES)
                    event_ts = t + timedelta(minutes=random.randint(0, 59), seconds=random.randint(0, 59))
                    conf = round(random.uniform(0.62, 0.95), 3)
                    db.add(PlateEvent(
                        plate_number=plate,
                        camera_id=cam_id,
                        timestamp=event_ts,
                        confidence=conf,
                    ))
                    bg_events += 1

                if bg_events % 500 == 0:
                    await db.commit()

        await db.commit()
        logger.info(f"Seeded {bg_events} background traffic events.")

        # ── Compute summary ───────────────────────────────────────
        from sqlalchemy import func, select
        total = (await db.execute(select(func.count(PlateEvent.id)))).scalar()
        alerts_count = (await db.execute(select(func.count(Alert.id)))).scalar()
        logger.info("")
        logger.info("=" * 50)
        logger.info(f"✅ Seed complete!")
        logger.info(f"   Total plate events: {total}")
        logger.info(f"   Total alerts:       {alerts_count}")
        logger.info(f"   Trajectory plates:  {[p for p, _ in TRAJECTORY_PLATES]}")
        logger.info(f"   Blacklist plates:   {[p for p, _ in BLACKLIST_PLATES]}")
        logger.info("")
        logger.info("   Open the dashboard at http://localhost:5173")
        logger.info("   Search for 'DL01AB2345' in Vehicle Search to see a trajectory demo.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed demo data into NAGARNETRA DB")
    parser.add_argument("--clear", action="store_true", help="Clear existing data before seeding")
    args = parser.parse_args()
    asyncio.run(seed_demo(clear=args.clear))
