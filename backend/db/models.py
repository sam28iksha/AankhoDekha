"""
NAGARNETRA — ORM Models

Production-ready schema for:
- High-concurrency ANPR ingestion
- Vehicle-centric identity resolution
- Vehicle trajectory tracking
- PostgreSQL/PostGIS spatial queries
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship
from geoalchemy2 import Geometry

from config import settings
from db.base import Base


def _utcnow() -> datetime:
    """Return the current UTC timestamp."""
    return datetime.now(timezone.utc)


# ============================================================
# Vehicle
# ============================================================

class Vehicle(Base):
    """
    Inferred physical vehicle entity.

    A Vehicle represents the system's best-known identity for a
    physical vehicle across multiple camera observations.

    Important:
    - A vehicle is NOT identified solely by its license plate.
    - Vehicle type/color are stored on PlateEvent because they
      are observation-level evidence and may vary between frames.
    """

    __tablename__ = "vehicles"

    id = Column(
        String(36),
        primary_key=True,
    )

    first_seen = Column(
        DateTime(timezone=True),
        nullable=False,
        default=_utcnow,
    )

    last_seen = Column(
        DateTime(timezone=True),
        nullable=False,
        default=_utcnow,
    )

    observations = relationship(
        "PlateEvent",
        back_populates="vehicle",
        cascade="all, delete-orphan",
        lazy="select",
    )


# ============================================================
# Camera
# ============================================================

class Camera(Base):
    __tablename__ = "cameras"

    id = Column(
        String(20),
        primary_key=True,
    )

    name = Column(
        String(100),
        nullable=False,
    )

    lat = Column(
        Float,
        nullable=False,
    )

    lng = Column(
        Float,
        nullable=False,
    )

    road_segment = Column(
        String(200),
        nullable=True,
    )

    # --------------------------------------------------------
    # PostGIS spatial point
    # SRID 4326 = WGS 84 latitude/longitude
    # Only defined under Postgres — GeoAlchemy2's Geometry type generates
    # PostGIS/Spatialite-only SQL (e.g. AsEWKB), which plain SQLite has no
    # equivalent for. Skipping the column entirely under SQLite means it's
    # never part of the mapped columns, so no query ever selects it.
    # --------------------------------------------------------

    if settings.DB_MODE == "postgres":
        geom = Column(
            Geometry(
                geometry_type="POINT",
                srid=4326,
            ),
            nullable=True,
        )

    events = relationship(
        "PlateEvent",
        back_populates="camera",
        lazy="selectin",
    )

    # No manual __table_args__ index here: GeoAlchemy2's Geometry type
    # already auto-creates its own GIST index on this column by default
    # (named identically, idx_cameras_geom) — an explicit duplicate here
    # collides with it (DuplicateTableError) on every fresh create_all().


# ============================================================
# Plate Event / Vehicle Observation
# ============================================================

class PlateEvent(Base):
    """
    Individual ANPR observation produced by a camera.

    This is the high-frequency event table.

    Each event records:
    - Which vehicle entity it was associated with
    - What plate was observed
    - Where and when it was observed
    - ANPR confidence
    - Broad vehicle type
    - Observed vehicle color
    - Optional evidence snapshot
    """

    __tablename__ = "plate_events"

    id = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )

    # --------------------------------------------------------
    # Vehicle-centric identity
    # --------------------------------------------------------

    vehicle_id = Column(
        String(36),
        ForeignKey("vehicles.id"),
        nullable=True,
        index=True,
    )

    # --------------------------------------------------------
    # Observed vehicle attributes
    # --------------------------------------------------------

    vehicle_type = Column(
        String(30),
        nullable=False,
        default="unknown",
    )
    # Expected values:
    # car | motorcycle | bus | truck | unknown

    color = Column(
        String(20),
        nullable=False,
        default="unknown",
    )
    # Expected values:
    # white | black | silver | red | yellow |
    # green | blue | unknown

    # --------------------------------------------------------
    # ANPR information
    # --------------------------------------------------------

    plate_number = Column(
        String(20),
        nullable=False,
        index=True,
    )

    camera_id = Column(
        String(20),
        ForeignKey("cameras.id"),
        nullable=False,
        index=True,
    )

    timestamp = Column(
        DateTime(timezone=True),
        nullable=False,
        default=_utcnow,
        index=True,
    )

    confidence = Column(
        Float,
        nullable=False,
        default=0.0,
    )

    # Path to the image/frame used as evidence.
    frame_snapshot_path = Column(
        String(500),
        nullable=True,
    )

    # --------------------------------------------------------
    # Relationships
    # --------------------------------------------------------

    camera = relationship(
        "Camera",
        back_populates="events",
        lazy="select",
    )

    vehicle = relationship(
        "Vehicle",
        back_populates="observations",
        lazy="select",
    )

    # --------------------------------------------------------
    # Query indexes
    # --------------------------------------------------------

    __table_args__ = (
        # Existing plate trajectory queries
        Index(
            "ix_plate_camera_ts",
            "plate_number",
            "camera_id",
            "timestamp",
        ),

        # Vehicle trajectory queries
        Index(
            "ix_vehicle_ts",
            "vehicle_id",
            "timestamp",
        ),
    )


# ============================================================
# Blacklist
# ============================================================

class Blacklist(Base):
    """
    Independent reference table for blacklisted vehicles.

    Kept separate from PlateEvent because a plate can be
    blacklisted before it is ever detected by a camera.
    """

    __tablename__ = "blacklist"

    plate_number = Column(
        String(20),
        primary_key=True,
    )

    reason = Column(
        Text,
        nullable=True,
    )

    added_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=_utcnow,
    )


# ============================================================
# Alert
# ============================================================

class Alert(Base):
    __tablename__ = "alerts"

    id = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )

    plate_number = Column(
        String(20),
        nullable=False,
        index=True,
    )

    camera_id = Column(
        String(20),
        ForeignKey("cameras.id"),
        nullable=False,
    )

    timestamp = Column(
        DateTime(timezone=True),
        nullable=False,
        default=_utcnow,
        index=True,
    )

    alert_type = Column(
        String(50),
        nullable=False,
    )
    # Expected values:
    # blacklist_hit
    # anomaly
    # plate_cloning

    resolved = Column(
        Boolean,
        nullable=False,
        default=False,
    )

    details = Column(
        Text,
        nullable=True,
    )

    source = Column(
        String(30),
        nullable=False,
        default="detection",
    )


# ============================================================
# User
# ============================================================

class User(Base):
    __tablename__ = "users"

    id = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )

    username = Column(
        String(50),
        unique=True,
        nullable=False,
        index=True,
    )

    password_hash = Column(
        String(255),
        nullable=False,
    )

    role = Column(
        String(20),
        nullable=False,
    )
    # Expected values:
    # admin | investigator | viewer

    full_name = Column(
        String(100),
        nullable=True,
    )

    is_active = Column(
        Boolean,
        nullable=False,
        default=True,
    )

    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=_utcnow,
    )


# ============================================================
# Audit Log
# ============================================================

class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )

    user_id = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=True,
    )

    username = Column(
        String(50),
        nullable=False,
    )

    action = Column(
        String(50),
        nullable=False,
        index=True,
    )

    target = Column(
        String(200),
        nullable=True,
    )

    details = Column(
        Text,
        nullable=True,
    )

    timestamp = Column(
        DateTime(timezone=True),
        nullable=False,
        default=_utcnow,
        index=True,
    )