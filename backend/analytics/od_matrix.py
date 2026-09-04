"""
NAGARNETRA — Origin-Destination Matrix Analytics
Computes vehicle flows between camera pairs.
"""
from __future__ import annotations

from datetime import timedelta
from typing import List, Dict, Any

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import PlateEvent, Camera
from analytics._time import data_now


async def get_od_matrix(
    db: AsyncSession,
    hours: int = 24,
    min_trips: int = 1,
) -> Dict[str, Any]:
    """
    Compute origin-destination flow between camera pairs.

    For each plate that appeared at >= 2 cameras, count transitions
    (origin_camera → destination_camera). Returns:
    {
      "nodes": [{"id": "cam_01", "name": "Connaught Place", "lat":..., "lng":...}, ...],
      "flows": [{"origin": "cam_01", "destination": "cam_02", "count": 42}, ...]
    }
    """
    since = await data_now(db) - timedelta(hours=hours)

    # Fetch all events sorted by plate + time
    result = await db.execute(
        select(
            PlateEvent.plate_number,
            PlateEvent.camera_id,
            PlateEvent.timestamp,
        )
        .where(PlateEvent.timestamp >= since)
        .order_by(PlateEvent.plate_number, PlateEvent.timestamp)
    )
    rows = result.fetchall()

    # Build transitions
    flow_counts: Dict[tuple, int] = {}
    prev_by_plate: Dict[str, str] = {}

    for row in rows:
        plate = row.plate_number
        cam = row.camera_id
        if plate in prev_by_plate and prev_by_plate[plate] != cam:
            key = (prev_by_plate[plate], cam)
            flow_counts[key] = flow_counts.get(key, 0) + 1
        prev_by_plate[plate] = cam

    # Fetch all cameras for node list
    cam_result = await db.execute(select(Camera))
    cameras = cam_result.scalars().all()
    nodes = [
        {"id": c.id, "name": c.name, "lat": c.lat, "lng": c.lng}
        for c in cameras
    ]

    flows = [
        {"origin": origin, "destination": dest, "count": count}
        for (origin, dest), count in flow_counts.items()
        if count >= min_trips
    ]
    flows.sort(key=lambda f: f["count"], reverse=True)

    return {"nodes": nodes, "flows": flows}
