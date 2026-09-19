"""
AANKHODEKHA — FastAPI auth dependencies.
Every protected route depends on get_current_user (or require_role, which
wraps it) rather than reimplementing token parsing per-endpoint.
"""
from __future__ import annotations

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.security import decode_access_token
from db.base import get_db
from db.models import User

# tokenUrl is where Swagger's "Authorize" button will POST to — doesn't
# affect actual token validation, just API-docs UX.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

_ROLE_RANK = {"viewer": 0, "investigator": 1, "admin": 2}


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    payload = decode_access_token(token)
    if payload is None or "sub" not in payload:
        raise unauthorized

    result = await db.execute(select(User).where(User.username == payload["sub"]))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise unauthorized
    return user


def require_role(*allowed_roles: str):
    """
    Dependency factory: require_role("admin") or require_role("admin",
    "investigator"). Roles are also treated as a rank floor — e.g.
    require_role("investigator") lets "admin" through too, since admin is
    a superset of investigator's permissions here.
    """
    min_rank = min(_ROLE_RANK[r] for r in allowed_roles)

    async def _dependency(user: User = Depends(get_current_user)) -> User:
        if _ROLE_RANK.get(user.role, -1) < min_rank:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"This action requires one of: {', '.join(allowed_roles)}",
            )
        return user

    return _dependency
