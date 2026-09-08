"""
NAGARNETRA — Auth & User Management API
POST /auth/login          — obtain a JWT (OAuth2 password flow)
GET  /auth/me             — current user's identity
POST /auth/users          — create a user (admin only)
GET  /auth/users          — list users (admin only)
PATCH /auth/users/{id}    — change role / active status (admin only)
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.audit import log_action
from auth.dependencies import get_current_user, require_role
from auth.security import create_access_token, hash_password, verify_password
from db.base import get_db
from db.models import User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])

_VALID_ROLES = {"admin", "investigator", "viewer"}


class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6)
    role: str
    full_name: str | None = None


class UserUpdate(BaseModel):
    role: str | None = None
    is_active: bool | None = None


def _user_public(u: User) -> dict:
    return {
        "id": u.id,
        "username": u.username,
        "role": u.role,
        "full_name": u.full_name,
        "is_active": u.is_active,
        "created_at": u.created_at.isoformat(),
    }


@router.post("/login")
async def login(
    form: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.username == form.username))
    user = result.scalar_one_or_none()

    if user is None or not verify_password(form.password, user.password_hash):
        await log_action(db, None, "login_failed", target=form.username)
        await db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect username or password")

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account is deactivated")

    await log_action(db, user, "login")
    await db.commit()

    token = create_access_token(subject=user.username, role=user.role)
    return {"access_token": token, "token_type": "bearer", "role": user.role, "username": user.username}


@router.get("/me")
async def get_me(user: User = Depends(get_current_user)):
    return _user_public(user)


@router.post("/users")
async def create_user(
    payload: UserCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role("admin")),
):
    if payload.role not in _VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"role must be one of {sorted(_VALID_ROLES)}")

    existing = await db.execute(select(User).where(User.username == payload.username))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Username already exists")

    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        role=payload.role,
        full_name=payload.full_name,
    )
    db.add(user)
    await log_action(db, admin, "user_create", target=payload.username, details=f"role={payload.role}")
    await db.commit()
    await db.refresh(user)
    return _user_public(user)


@router.get("/users")
async def list_users(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role("admin")),
):
    result = await db.execute(select(User).order_by(User.created_at))
    return [_user_public(u) for u in result.scalars().all()]


@router.patch("/users/{user_id}")
async def update_user(
    user_id: int,
    payload: UserUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role("admin")),
):
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    changes = []
    if payload.role is not None:
        if payload.role not in _VALID_ROLES:
            raise HTTPException(status_code=400, detail=f"role must be one of {sorted(_VALID_ROLES)}")
        user.role = payload.role
        changes.append(f"role={payload.role}")
    if payload.is_active is not None:
        user.is_active = payload.is_active
        changes.append(f"is_active={payload.is_active}")

    await log_action(db, admin, "user_update", target=user.username, details=", ".join(changes) or None)
    await db.commit()
    await db.refresh(user)
    return _user_public(user)
