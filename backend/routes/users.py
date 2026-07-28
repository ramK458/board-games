"""User lookup routes."""

from fastapi import APIRouter, Depends

from backend.auth import get_current_user_dep
from backend.db import get_db

router = APIRouter(tags=["users"])


@router.get("/users")
async def list_users(user: dict = Depends(get_current_user_dep)):
    """List all users.  Any authenticated user can list users."""
    db = get_db()
    return db.fetch_all("SELECT id, name, email, role, config FROM users ORDER BY id")
