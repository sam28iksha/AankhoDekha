"""
NAGARNETRA — Application Configuration
Reads values from environment variables / .env file.
"""
from __future__ import annotations

import os
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── Database ──────────────────────────────────────────────────
    DB_MODE: str = "sqlite"  # "sqlite" | "postgres"
    SQLITE_PATH: str = "./data/nagarnetra.db"
    DATABASE_URL: str = ""  # only needed for postgres

    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str = "nagarnetra"
    POSTGRES_PASSWORD: str = "nagarnetra_pass"
    POSTGRES_DB: str = "nagarnetra"

    # ── ANPR Pipeline ─────────────────────────────────────────────
    YOLO_WEIGHTS_PATH: str = "./models/best.pt"
    FRAME_SAMPLE_RATE: int = 5
    DETECTION_CONFIDENCE_THRESHOLD: float = 0.4
    OCR_CONFIDENCE_THRESHOLD: float = 0.6

    # Synthetic camera auto-created for ad-hoc Test Detection Upload footage
    # (not a real fixed installation) — excluded from camera-selection and
    # ranking displays (Analytics congestion/busiest, OCR Preview's camera
    # picker, map markers) so it doesn't read as part of the real camera
    # network, while still working correctly as an upload destination and
    # still showing up honestly on any sighting/alert that came through it.
    UPLOAD_CAMERA_ID: str = "cam_upload"

    # ── Road-Network Routing (trajectory map legs) ───────────────────
    # Snaps straight-line camera-to-camera legs onto real roads and offers
    # alternate paths. Points at the free public OSRM demo server by default
    # (no API key, but internet-dependent and best-effort/rate-limited) —
    # swap to a self-hosted OSRM instance URL here for fully offline use.
    OSRM_BASE_URL: str = "https://router.project-osrm.org"
    ROUTING_ALTERNATIVES: int = 2

    # ── Route Anomaly Detection ─────────────────────────────────────
    # A plate seen at two cameras implying an average speed above this is
    # physically implausible for one vehicle — flagged as a route anomaly
    # (likely a cloned/duplicated plate rather than a real fast trip).
    ANOMALY_SPEED_THRESHOLD_KMH: float = 120.0
    ANOMALY_LOOKBACK_HOURS: int = 6

    # ── Paths ──────────────────────────────────────────────────────
    VIDEOS_DIR: str = "./data/sample_videos"
    CAMERAS_JSON_PATH: str = "./data/cameras.json"
    BLACKLIST_JSON_PATH: str = "./data/blacklist.json"
    SNAPSHOTS_DIR: str = "./data/snapshots"

    # ── API ────────────────────────────────────────────────────────
    BACKEND_PORT: int = 8000
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"
    LOG_LEVEL: str = "INFO"

    def get_database_url(self) -> str:
        """Return the correct async database URL based on DB_MODE."""
        if self.DB_MODE == "postgres":
            if self.DATABASE_URL:
                return self.DATABASE_URL
            return (
                f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
                f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
            )
        # SQLite
        db_path = Path(self.SQLITE_PATH)
        db_path.parent.mkdir(parents=True, exist_ok=True)
        return f"sqlite+aiosqlite:///{db_path.resolve()}"

    def get_cors_origins(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


settings = Settings()
