"""Authentication and authorization helpers."""

from typing import Any

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPBearer

from backend.db import get_db

security = HTTPBearer(auto_error=False)


# ── Helpers ────────────────────────────────────


def get_current_user(request: Request) -> dict[str, Any]:
    """Extract the authenticated user from the X-User-Id header.

    In development mode, falls back to user id=1 (Alice, admin) when
    the header is missing or the user is not found.
    """
    db = get_db()
    user_id_str = request.headers.get("X-User-Id")

    if user_id_str:
        try:
            user_id = int(user_id_str)
            user = db.fetch_one("SELECT * FROM users WHERE id = ?", (user_id,))
            if user:
                return user
        except (ValueError, TypeError):
            pass

    # Fallback to default user (id=1)
    user = db.fetch_one("SELECT * FROM users WHERE id = 1")
    if user:
        return user

    # Last resort — return a synthetic admin user
    return {"id": 1, "name": "Dev User", "email": "dev@local", "role": "admin", "config": "{}"}


async def get_current_user_dep(request: Request) -> dict[str, Any]:
    """FastAPI dependency that injects the current authenticated user."""
    return get_current_user(request)


def require_permission(
    user_id: int,
    resource_type: str,
    resource_id: int | None,
    permission_level: str,
) -> bool:
    """Permission check — currently disabled (always returns True).

    Will be re-enabled with proper access-control enforcement later.
    """
    return True


def _require_admin(user: dict[str, Any]) -> None:
    """Admin check — currently disabled (no-op)."""
    pass
