#!/usr/bin/env python3
"""
NAGARNETRA — Load blacklist.json into DB
Convenience helper: after you update blacklist.json with real plate picks,
run this to load them into the running database without restarting the server.

Usage:
  python scripts/load_blacklist.py
"""
import asyncio, json, sys
from pathlib import Path
from datetime import datetime, timezone

# Path resolution — two-runtime design:
#   Local: inserts NAGARNETRA/backend/ so backend modules resolve.
#   Docker: PYTHONPATH=/app (docker-compose.yml) handles it; insert is a no-op.
_backend_path = Path(__file__).parent.parent / "backend"
if _backend_path.exists():
    sys.path.insert(0, str(_backend_path))

from db.init_db import init_db
from db.base import AsyncSessionLocal
from db.models import Blacklist

async def main():
    await init_db()
    bl_path = Path(__file__).parent.parent / "data" / "blacklist.json"
    with bl_path.open() as f:
        data = json.load(f)

    plates = [p for p in data.get("plates", []) if not p.get("_placeholder")]
    if not plates:
        print("No real plates in blacklist.json yet. Replace the placeholders first.")
        return

    async with AsyncSessionLocal() as db:
        count = 0
        for p in plates:
            existing = await db.get(Blacklist, p["plate_number"])
            if not existing:
                db.add(Blacklist(
                    plate_number=p["plate_number"].upper().strip(),
                    reason=p.get("reason"),
                    added_at=datetime.fromisoformat(p["added_at"].replace("Z", "+00:00")) if p.get("added_at") else datetime.now(timezone.utc),
                ))
                count += 1
        await db.commit()
    print(f"✅ Loaded {count} new blacklist entries into DB.")
    print("   Re-run ingest_videos.py to retroactively fire alerts for any matching past events.")

asyncio.run(main())
