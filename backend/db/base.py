"""
AANKHODEKHA — Database Engine & Session Management
Configured for high-concurrency async ingestion via PostgreSQL.
"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from config import settings

DATABASE_URL = settings.get_database_url()

# Dynamic engine configuration based on the environment
if settings.DB_MODE == "postgres":
    engine = create_async_engine(
        DATABASE_URL,
        echo=False,
        # ── Enterprise Pooling Parameters ──
        pool_size=20,           # Base persistent connections for camera streams
        max_overflow=10,        # Burst buffer for heavy API traffic
        pool_timeout=30.0,      # Don't hang indefinitely if pool is full
        pool_recycle=1800,      # Recycle connections every 30 mins to prevent drops
        pool_pre_ping=True,     # Liveness check before using a connection
    )
else:
    # Fallback for local SQLite testing
    engine = create_async_engine(
        DATABASE_URL,
        echo=False,
        connect_args={"check_same_thread": False},
    )

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

class Base(DeclarativeBase):
    """Shared declarative base for all ORM models."""
    pass

async def get_db() -> AsyncSession:
    """
    FastAPI dependency — yields an async DB session.
    
    TRANSACTION POLICY:
    This dependency does NOT auto-commit. The caller (API endpoint or ingestion worker)
    must explicitly call `await db.commit()` to persist changes. If an error occurs,
    closing the session automatically discards uncommitted changes safely.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()