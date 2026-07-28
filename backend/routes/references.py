"""Cross-reference CRUD routes with reciprocal link creation."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from backend.auth import get_current_user_dep
from backend.db import get_db

router = APIRouter(tags=["references"])


# ── Reciprocal mapping ────────────────────────

_RECIPROCAL: dict[str, str] = {
    "blocks": "blocked_by",
    "blocked_by": "blocks",
    "duplicates": "duplicates",
    "related_to": "related_to",
    "caused_by": "caused_by",
    "subtask": "subtask",
}


@router.get("/tasks/{task_id}/references")
async def list_references(
    task_id: int,
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """List cross-references for a task (both outgoing and incoming)."""
    db = get_db()

    task = db.fetch_one("SELECT id FROM tasks WHERE id = ?", (task_id,))
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    outgoing = db.fetch_all(
        "SELECT * FROM cross_references WHERE source_task_id = ?",
        (task_id,),
    )
    incoming = db.fetch_all(
        "SELECT * FROM cross_references WHERE target_task_id = ?",
        (task_id,),
    )

    return {
        "outgoing": outgoing,
        "incoming": incoming,
    }


@router.post("/tasks/{task_id}/references", status_code=201)
async def create_reference(
    task_id: int,
    body: dict[str, Any],
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Create a cross-reference from a task to another task.

    **Body:** ``target_task_id`` (required), ``ref_type`` (required),
    ``note`` (optional).

    **RULE:** A reciprocal reference is automatically inserted. For
    example, creating ``A blocks B`` also creates ``B blocked_by A``.

    **Circular prevention:** Returns 409 if the same pair already
    exists in either direction.
    """
    db = get_db()

    # Validate source task
    source = db.fetch_one("SELECT id FROM tasks WHERE id = ?", (task_id,))
    if source is None:
        raise HTTPException(status_code=404, detail="Source task not found")

    target_task_id = body.get("target_task_id")
    if target_task_id is None:
        raise HTTPException(status_code=422, detail="target_task_id is required")

    target = db.fetch_one("SELECT id FROM tasks WHERE id = ?", (target_task_id,))
    if target is None:
        raise HTTPException(status_code=404, detail="Target task not found")

    ref_type = body.get("ref_type")
    allowed_types = {
        "blocks", "blocked_by", "duplicates",
        "related_to", "caused_by", "subtask",
    }
    if ref_type not in allowed_types:
        raise HTTPException(
            status_code=422,
            detail=f"ref_type must be one of {allowed_types}",
        )

    note = body.get("note", "")

    # Circular / duplicate prevention: check if A→B or B→A already exists
    existing = db.fetch_one(
        "SELECT id FROM cross_references "
        "WHERE (source_task_id = ? AND target_task_id = ?) "
        "   OR (source_task_id = ? AND target_task_id = ?)",
        (task_id, target_task_id, target_task_id, task_id),
    )
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail="A cross-reference between these tasks already exists",
        )

    # Insert primary reference
    ref_id = db.insert("cross_references", {
        "source_task_id": task_id,
        "target_task_id": target_task_id,
        "ref_type": ref_type,
        "note": note,
    })

    # Insert reciprocal reference
    recip_type = _RECIPROCAL.get(ref_type, ref_type)
    db.insert("cross_references", {
        "source_task_id": target_task_id,
        "target_task_id": task_id,
        "ref_type": recip_type,
        "note": note,
    })

    ref = db.fetch_one(
        "SELECT * FROM cross_references WHERE id = ?", (ref_id,)
    )
    return ref


@router.delete("/references/{ref_id}")
async def delete_reference(
    ref_id: int,
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Delete a cross-reference and its reciprocal, if it exists."""
    db = get_db()

    existing = db.fetch_one(
        "SELECT * FROM cross_references WHERE id = ?", (ref_id,)
    )
    if existing is None:
        raise HTTPException(status_code=404, detail="Reference not found")

    # Delete reciprocal if one exists
    db.write(
        "DELETE FROM cross_references "
        "WHERE source_task_id = ? AND target_task_id = ?",
        (existing["target_task_id"], existing["source_task_id"]),
    )

    # Delete the primary reference
    db.write("DELETE FROM cross_references WHERE id = ?", (ref_id,))

    return {"detail": "Reference and reciprocal deleted"}

