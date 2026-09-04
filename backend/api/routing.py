"""
NAGARNETRA — Trajectory Routing API
GET /routing/leg — road-network route(s) between two points
"""
from __future__ import annotations

from fastapi import APIRouter, Query

from services.routing import get_road_routes

router = APIRouter(prefix="/routing", tags=["routing"])


@router.get("/leg")
async def get_leg_route(
    from_lat: float = Query(...),
    from_lng: float = Query(...),
    to_lat: float = Query(...),
    to_lng: float = Query(...),
):
    """
    Road-snapped route(s) between two points, for drawing a single
    trajectory leg on the map. Empty "routes" means routing was
    unavailable — the caller should fall back to a straight line.
    """
    routes = await get_road_routes(from_lat, from_lng, to_lat, to_lng)
    return {"routes": routes}
