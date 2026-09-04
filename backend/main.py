"""
NAGARNETRA — FastAPI Application Entry Point
Team: The Underthinker | Smart India Hackathon 2026
"""
from __future__ import annotations

import faulthandler
import logging
import sys
from contextlib import asynccontextmanager

# Enable faulthandler FIRST — prints a native C-level stack trace to stderr
# on SIGSEGV/SIGBUS/SIGABRT so we can see where a segfault actually happens
# instead of just getting 'exited with code 139'.
faulthandler.enable(file=sys.stderr, all_threads=True)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from config import settings

# Configure logging
logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan — startup and shutdown events."""
    logger.info("=" * 60)
    logger.info("  NAGARNETRA — The Eye of the City")
    logger.info("  Team: The Underthinker | SIH 2026")
    logger.info("=" * 60)

    # Initialize database
    from db.init_db import init_db
    await init_db()
    logger.info(f"Database mode: {settings.DB_MODE.upper()}")
    logger.info(f"API running at: http://0.0.0.0:{settings.BACKEND_PORT}")

    yield

    logger.info("NAGARNETRA shutting down.")


app = FastAPI(
    title="NAGARNETRA API",
    description=(
        "Multi-Camera ANPR & Traffic Intelligence Platform\n"
        "Smart India Hackathon 2026 · Team: The Underthinker"
    ),
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS — allow frontend dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount snapshot images for browser access
snapshots_dir = Path(settings.SNAPSHOTS_DIR)
snapshots_dir.mkdir(parents=True, exist_ok=True)
app.mount("/snapshots", StaticFiles(directory=str(snapshots_dir)), name="snapshots")

# Mount detection-preview frame sequences (annotated JPEGs + manifest.json)
previews_dir = snapshots_dir.parent / "previews"
previews_dir.mkdir(parents=True, exist_ok=True)
app.mount("/previews", StaticFiles(directory=str(previews_dir)), name="previews")

# Import and register routers
from api.ingest import router as ingest_router
from api.vehicle import router as vehicle_router
from api.analytics import router as analytics_router
from api.alerts import router as alerts_router
from api.blacklist import router as blacklist_router
from api.preview import router as preview_router

app.include_router(ingest_router)
app.include_router(vehicle_router)
app.include_router(analytics_router)
app.include_router(alerts_router)
app.include_router(blacklist_router)
app.include_router(preview_router)


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {
        "status": "ok",
        "service": "NAGARNETRA",
        "db_mode": settings.DB_MODE,
    }


@app.get("/")
async def root():
    return {
        "service": "NAGARNETRA — The Eye of the City",
        "team": "The Underthinker",
        "hackathon": "Smart India Hackathon 2026",
        "docs": "/docs",
        "health": "/health",
    }
