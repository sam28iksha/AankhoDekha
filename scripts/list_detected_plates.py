#!/usr/bin/env python3
"""
NAGARNETRA — Detected Plates Lister
======================================
After running ingest_videos.py, use this script to see which plates were
detected with highest confidence and frequency.

Pick 3-4 of these plates to add to data/blacklist.json so the live alert
demo fires on real, reproducible detections.

Usage:
  python scripts/list_detected_plates.py
  python scripts/list_detected_plates.py --top 20  (show top N plates)
  python scripts/list_detected_plates.py --min-sightings 2  (filter by min sightings)
  python scripts/list_detected_plates.py --export blacklist_picks.txt
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

# Path resolution — two-runtime design:
#   Local: inserts NAGARNETRA/backend/ so backend modules resolve.
#   Docker: PYTHONPATH=/app (docker-compose.yml) handles it; insert is a no-op.
_backend_path = Path(__file__).parent.parent / "backend"
if _backend_path.exists():
    sys.path.insert(0, str(_backend_path))

from db.init_db import init_db
from db.base import AsyncSessionLocal
from db.models import PlateEvent
from sqlalchemy import select, func


async def list_plates(top: int = 30, min_sightings: int = 1, export: str | None = None) -> None:
    await init_db()

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(
                PlateEvent.plate_number,
                func.count(PlateEvent.id).label("sightings"),
                func.max(PlateEvent.confidence).label("max_conf"),
                func.count(PlateEvent.camera_id.distinct()).label("cameras"),
                func.min(PlateEvent.timestamp).label("first_seen"),
                func.max(PlateEvent.timestamp).label("last_seen"),
            )
            .group_by(PlateEvent.plate_number)
            .having(func.count(PlateEvent.id) >= min_sightings)
            .order_by(func.count(PlateEvent.id).desc(), func.max(PlateEvent.confidence).desc())
            .limit(top)
        )
        rows = result.fetchall()

    if not rows:
        print("No plates detected yet. Run 'python scripts/ingest_videos.py' first.")
        return

    print()
    print("=" * 70)
    print("  NAGARNETRA — Detected Plates (sorted by sighting count)")
    print("=" * 70)
    print(f"  {'Rank':<5} {'Plate':<15} {'Sightings':>9} {'Cameras':>8} {'MaxConf':>8} {'Last Seen':<22}")
    print("-" * 70)

    lines = []
    for i, row in enumerate(rows, 1):
        last = row.last_seen.strftime('%Y-%m-%d %H:%M:%S') if row.last_seen else '—'
        # ★ Mark multi-camera plates (best for trajectory demo)
        star = "★" if row.cameras > 1 else " "
        line = f"  {star}{i:<4} {row.plate_number:<15} {row.sightings:>9} {row.cameras:>8} {row.max_conf:>7.1%} {last:<22}"
        print(line)
        lines.append(row.plate_number)

    print("-" * 70)
    print(f"  ★ = plate seen at >1 camera — ideal for trajectory demo + blacklist alert")
    print()
    print("  Next step: Pick 3-4 plate numbers from above.")
    print("  Open data/blacklist.json and replace the placeholder entries.")
    print()
    print("  Example entry to add:")
    print('  { "plate_number": "DL01AB1234", "reason": "Stolen vehicle", "added_at": "2026-08-31T00:00:00Z" }')
    print()

    if export:
        Path(export).write_text("\n".join(lines))
        print(f"  Exported plate list to: {export}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="List top detected plates for blacklist selection")
    parser.add_argument("--top", type=int, default=30, help="Show top N plates")
    parser.add_argument("--min-sightings", type=int, default=1, help="Minimum sightings to include")
    parser.add_argument("--export", type=str, default=None, help="Export plate list to file")
    args = parser.parse_args()

    asyncio.run(list_plates(args.top, args.min_sightings, args.export))
