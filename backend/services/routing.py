"""
NAGARNETRA — Road-Network Routing
Snaps a straight camera-to-camera leg onto real roads via OSRM, optionally
returning alternate paths — used so a Vehicle Search trajectory shows a
plausible road route between sightings instead of an "as the crow flies" line.

This is inherently an ESTIMATE: cameras only confirm a plate was at a given
point at a given time, not which road it took to the next one. When more
than one reasonably distinct route exists, all are returned so the frontend
can show them as alternatives rather than implying false certainty.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from config import settings

logger = logging.getLogger(__name__)

# In-process cache: road geometry between two fixed camera points never
# changes within a demo/deployment session, so cache by rounded coordinates
# to avoid re-hitting OSRM (and its fair-use rate limit) on every re-render.
_cache: dict[tuple[float, float, float, float], list[dict[str, Any]]] = {}


async def get_road_routes(
    from_lat: float,
    from_lng: float,
    to_lat: float,
    to_lng: float,
) -> list[dict[str, Any]]:
    """
    Return up to (1 + ROUTING_ALTERNATIVES) route options between two points.

    Each item: {"coords": [[lat, lng], ...], "distance_km": float,
    "duration_min": float, "is_primary": bool}.

    Returns [] on any failure (network down, rate-limited, malformed
    response) rather than raising — callers fall back to a straight line.
    """
    key = (round(from_lat, 5), round(from_lng, 5), round(to_lat, 5), round(to_lng, 5))
    if key in _cache:
        return _cache[key]

    url = (
        f"{settings.OSRM_BASE_URL}/route/v1/driving/"
        f"{from_lng},{from_lat};{to_lng},{to_lat}"
    )
    params = {
        "alternatives": "true" if settings.ROUTING_ALTERNATIVES > 0 else "false",
        "geometries": "geojson",
        "overview": "full",
        "steps": "false",
    }

    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        logger.warning(f"OSRM routing unavailable ({from_lat},{from_lng} -> {to_lat},{to_lng}): {e}")
        return []

    if data.get("code") != "Ok" or not data.get("routes"):
        return []

    routes_raw = data["routes"][: 1 + settings.ROUTING_ALTERNATIVES]
    routes = []
    for i, r in enumerate(routes_raw):
        coords_lnglat = r.get("geometry", {}).get("coordinates", [])
        if not coords_lnglat:
            continue
        routes.append({
            "coords": [[lat, lng] for lng, lat in coords_lnglat],
            "distance_km": round(r["distance"] / 1000, 2),
            "duration_min": round(r["duration"] / 60, 1),
            "is_primary": i == 0,
        })

    _cache[key] = routes
    return routes
