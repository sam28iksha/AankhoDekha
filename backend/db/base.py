"""
NAGARNETRA — Database Engine & Session Management
Supports both SQLite (dev/demo) and PostgreSQL+PostGIS (production).
"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from config import settings


DATABASE_URL = settings.get_database_url()

# Connection args differ by driver
connect_args = {}
if settings.DB_MODE == "sqlite":
    connect_args = {"check_same_thread": False}

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    connect_args=connect_args,
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
    """FastAPI dependency — yields an async DB session."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
