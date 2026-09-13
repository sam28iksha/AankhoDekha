"""
NAGARNETRA — Origin-Destination Matrix Analytics
Computes vehicle flows between camera pairs.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any, Dict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from analytics._time import data_now
from db.models import Camera, PlateEvent


async def get_od_matrix(
    db: AsyncSession,
    hours: int = 24,
    min_trips: int = 1,
) -> Dict[str, Any]:
    """
    Compute origin-destination flow between camera pairs.

    For each plate that appeared at >= 2 cameras within the requested
    time window, count consecutive camera transitions.

    Returns:
    {
        "nodes": [
            {
                "id": "cam_01",
                "name": "Connaught Place",
                "lat": ...,
                "lng": ...
            },
            ...
        ],
        "flows": [
            {
                "origin": "cam_01",
                "destination": "cam_02",
                "count": 42
            },
            ...
        ]
    }

    Event ordering is deterministic:
        plate_number ASC
        timestamp ASC
        id ASC

    PlateEvent.id acts as the tie-breaker when multiple events for the
    same plate have the exact same timestamp.
    """

    since = await data_now(db) - timedelta(hours=hours)

    # Fetch events sorted deterministically by:
    #
    #   1. plate number
    #   2. timestamp
    #   3. event ID
    #
    # The ID tie-breaker is important when simultaneous events have
    # identical timestamps. Without it, PostgreSQL is free to return
    # those rows in an unspecified order, which could change the
    # reconstructed camera transitions between requests.
    result = await db.execute(
        select(
            PlateEvent.plate_number,
            PlateEvent.camera_id,
            PlateEvent.timestamp,
        )
        .where(PlateEvent.timestamp >= since)
        .order_by(
            PlateEvent.plate_number.asc(),
            PlateEvent.timestamp.asc(),
            PlateEvent.id.asc(),
        )
    )

    rows = result.fetchall()

    # Build consecutive camera transitions.
    #
    # Maps:
    #   plate -> (last_camera_id, last_timestamp)
    #
    # Repeated sightings at the same camera do not create a transition.
    flow_counts: Dict[tuple[str, str], int] = {}
    prev_by_plate: Dict[str, tuple[str, Any]] = {}

    for row in rows:
        plate = row.plate_number
        cam = row.camera_id
        ts = row.timestamp

        if plate in prev_by_plate:
            prev_cam, prev_ts = prev_by_plate[plate]

            if prev_cam != cam:
                delta_seconds = (
                    ts - prev_ts
                ).total_seconds()

                # Only positive chronological transitions are valid.
                #
                # The SQL ordering should already guarantee this, but
                # keeping the invariant explicit prevents invalid data
                # from producing nonsensical transitions.
                if delta_seconds > 0:
                    key = (prev_cam, cam)
                    flow_counts[key] = flow_counts.get(key, 0) + 1

        # Always update to the latest sighting.
        prev_by_plate[plate] = (cam, ts)

    # Fetch all registered cameras.
    #
    # Explicit ordering makes the node list deterministic as well.
    cam_result = await db.execute(
        select(Camera).order_by(Camera.id.asc())
    )

    cameras = cam_result.scalars().all()

    nodes = [
        {
            "id": camera.id,
            "name": camera.name,
            "lat": camera.lat,
            "lng": camera.lng,
        }
        for camera in cameras
    ]

    # Apply the minimum-flow threshold after aggregation.
    flows = [
        {
            "origin": origin,
            "destination": destination,
            "count": count,
        }
        for (origin, destination), count in flow_counts.items()
        if count >= min_trips
    ]

    # Deterministic ranking:
    #
    #   1. highest flow count first
    #   2. origin camera ID alphabetically
    #   3. destination camera ID alphabetically
    #
    # The secondary keys ensure equal-count flows always appear in
    # the same order.
    flows.sort(
        key=lambda flow: (
            -flow["count"],
            flow["origin"],
            flow["destination"],
        )
    )

    return {
        "nodes": nodes,
        "flows": flows,
    }