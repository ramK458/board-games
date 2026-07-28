"""Comment CRUD routes with ownership and permission checks."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from backend.auth import get_current_user_dep
from backend.db import get_db

router = APIRouter(tags=["comments"])


@router.get("/tasks/{task_id}/comments")
async def list_comments(
    task_id: int,
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """List all comments for a task, sorted by created_at ASC."""
    db = get_db()

    task = db.fetch_one("SELECT id FROM tasks WHERE id = ?", (task_id,))
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    rows = db.fetch_all(
        "SELECT * FROM comments WHERE task_id = ? ORDER BY created_at ASC",
        (task_id,),
    )
    return rows


@router.post("/tasks/{task_id}/comments", status_code=201)
async def create_comment(
    task_id: int,
    body: dict[str, Any],
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Create a comment on a task. Body: ``body`` (text).

    ``user_id`` is auto-set from the authenticated user.
    """
    db = get_db()

    task = db.fetch_one("SELECT id FROM tasks WHERE id = ?", (task_id,))
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    body_text = body.get("body")
    if not body_text or not isinstance(body_text, str) or not body_text.strip():
        raise HTTPException(status_code=422, detail="body is required")

    comment_id = db.insert("comments", {
        "task_id": task_id,
        "user_id": user["id"],
        "body": body_text.strip(),
    })

    comment = db.fetch_one("SELECT * FROM comments WHERE id = ?", (comment_id,))
    return comment


@router.put("/comments/{comment_id}")
async def update_comment(
    comment_id: int,
    body: dict[str, Any],
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Edit a comment. Only the comment author or an admin may edit."""
    db = get_db()

    existing = db.fetch_one(
        "SELECT * FROM comments WHERE id = ?", (comment_id,)
    )
    if existing is None:
        raise HTTPException(status_code=404, detail="Comment not found")

    # Ownership check: only own comment or admin/super_user
    if user["role"] != "admin" and existing["user_id"] != user["id"]:
        raise HTTPException(
            status_code=403,
            detail="You can only edit your own comments",
        )

    body_text = body.get("body")
    if not body_text or not isinstance(body_text, str) or not body_text.strip():
        raise HTTPException(status_code=422, detail="body is required")

    db.write(
        "UPDATE comments SET body = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ?",
        (body_text.strip(), comment_id),
    )

    updated = db.fetch_one(
        "SELECT * FROM comments WHERE id = ?", (comment_id,)
    )
    return updated


@router.delete("/comments/{comment_id}")
async def delete_comment(
    comment_id: int,
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Delete a comment. Only the comment author or an admin may delete."""
    db = get_db()

    existing = db.fetch_one(
        "SELECT * FROM comments WHERE id = ?", (comment_id,)
    )
    if existing is None:
        raise HTTPException(status_code=404, detail="Comment not found")

    # Ownership check
    if user["role"] != "admin" and existing["user_id"] != user["id"]:
        raise HTTPException(
            status_code=403,
            detail="You can only delete your own comments",
        )

    db.write("DELETE FROM comments WHERE id = ?", (comment_id,))
    return {"detail": "Comment deleted"}

