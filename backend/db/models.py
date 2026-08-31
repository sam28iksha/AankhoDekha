"""NAGARNETRA — ORM Models"""
from __future__ import annotations

from datetime import datetime, timezone
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime,
    ForeignKey, Text, Index,
)
from sqlalchemy.orm import relationship

from db.base import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Camera(Base):
    __tablename__ = "cameras"

    id = Column(String(20), primary_key=True)  # e.g. "cam_01"
    name = Column(String(100), nullable=False)
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    road_segment = Column(String(200), nullable=True)

    events = relationship("PlateEvent", back_populates="camera", lazy="selectin")


class PlateEvent(Base):
    __tablename__ = "plate_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    plate_number = Column(String(20), nullable=False, index=True)
    camera_id = Column(String(20), ForeignKey("cameras.id"), nullable=False, index=True)
    timestamp = Column(DateTime(timezone=True), nullable=False, default=_utcnow, index=True)
    confidence = Column(Float, nullable=False, default=0.0)
    frame_snapshot_path = Column(String(500), nullable=True)

    camera = relationship("Camera", back_populates="events", lazy="joined")

    __table_args__ = (
        Index("ix_plate_camera_ts", "plate_number", "camera_id", "timestamp"),
    )


class Blacklist(Base):
    __tablename__ = "blacklist"

    plate_number = Column(String(20), primary_key=True)
    reason = Column(Text, nullable=True)
    added_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    plate_number = Column(String(20), nullable=False, index=True)
    camera_id = Column(String(20), ForeignKey("cameras.id"), nullable=False)
    timestamp = Column(DateTime(timezone=True), nullable=False, default=_utcnow, index=True)
    alert_type = Column(String(50), nullable=False)  # "blacklist_hit" | "anomaly"
    resolved = Column(Boolean, nullable=False, default=False)
    details = Column(Text, nullable=True)
