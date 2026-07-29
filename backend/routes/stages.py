"""Stage / workflow CRUD routes."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from backend.auth import get_current_user_dep
from backend.db import get_db
from backend.models import StageCreate, StageReorderItem, StageUpdate

router = APIRouter(tags=["stages"])


# ⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐
#  List stages
# ⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐


@router.get("/stages")
async def list_stages(
    project_id: int,
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """List Kanban stages for a project, ordered by ``sort_order``."""
    db = get_db()

    rows = db.fetch_all(
        "SELECT * FROM task_stages WHERE project_id = ? ORDER BY sort_order ASC",
        (project_id,),
    )
    return rows


# ⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐
#  Create stage
# ⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐


@router.post("/stages", status_code=201)
async def create_stage(
    body: StageCreate,
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Create a new Kanban stage for a project."""
    db = get_db()

    # Verify project exists
    node = db.fetch_one(
        "SELECT id FROM hierarchy_nodes WHERE id = ?", (body.project_id,)
    )
    if node is None:
        raise HTTPException(status_code=404, detail="Project not found")

    stage_id = db.insert("task_stages", {
        "project_id": body.project_id,
        "stage_name": body.stage_name,
        "sort_order": body.sort_order,
        "color_hex": body.color_hex,
    })

    stage = db.fetch_one("SELECT * FROM task_stages WHERE id = ?", (stage_id,))
    return stage


# ⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐
#  Reorder stages  (MUST be before {stage_id} routes)
# ⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐


@router.put("/stages/reorder")
async def reorder_stages(
    body: list[StageReorderItem],
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Reorder stages by updating their ``sort_order`` values in bulk."""
    db = get_db()

    for item in body:
        db.update(
            "task_stages",
            {"sort_order": item.sort_order},
            "id = ?",
            (item.id,),
        )

    return {"detail": "Stages reordered"}


# ⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐
#  Update stage
# ⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐


@router.put("/stages/{stage_id}")
async def update_stage(
    stage_id: int,
    body: StageUpdate,
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Update a stage's name, sort order, or colour."""
    db = get_db()

    existing = db.fetch_one(
        "SELECT * FROM task_stages WHERE id = ?", (stage_id,)
    )
    if existing is None:
        raise HTTPException(status_code=404, detail="Stage not found")

    updates: dict[str, Any] = {}
    if body.stage_name is not None:
        updates["stage_name"] = body.stage_name
    if body.sort_order is not None:
        updates["sort_order"] = body.sort_order
    if body.color_hex is not None:
        updates["color_hex"] = body.color_hex
    if body.active is not None:
        updates["active"] = 1 if body.active else 0
        # If hiding, clear stage_id on affected tasks
        if not body.active:
            db.execute("UPDATE tasks SET stage_id = NULL WHERE stage_id = ?", (stage_id,))

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    db.update("task_stages", updates, "id = ?", (stage_id,))

    stage = db.fetch_one("SELECT * FROM task_stages WHERE id = ?", (stage_id,))
    return stage


# ⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐
#  Delete stage
# ⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐


@router.delete("/stages/{stage_id}")
async def delete_stage(
    stage_id: int,
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Delete a Kanban stage.

    Tasks assigned to this stage are reassigned to the first (default)
    stage of the same project.  Returns ``409`` if this is the only
    stage for the project.
    """
    db = get_db()

    stage = db.fetch_one(
        "SELECT * FROM task_stages WHERE id = ?", (stage_id,)
    )
    if stage is None:
        raise HTTPException(status_code=404, detail="Stage not found")

    project_id = stage["project_id"]

    # Count remaining stages for this project
    count_row = db.fetch_one(
        "SELECT COUNT(*) AS cnt FROM task_stages WHERE project_id = ?",
        (project_id,),
    )
    stage_count = count_row["cnt"] if count_row else 0

    if stage_count <= 1:
        raise HTTPException(
            status_code=409,
            detail="Cannot delete the only stage for this project",
        )

    # Find the first stage (lowest sort_order) as the default fallback
    default_stage = db.fetch_one(
        "SELECT id FROM task_stages WHERE project_id = ? ORDER BY sort_order ASC LIMIT 1",
        (project_id,),
    )
    default_id = default_stage["id"] if default_stage else None

    # Reassign tasks in the deleted stage to the default stage
    if default_id is not None:
        db.write(
            "UPDATE tasks SET stage_id = ? WHERE stage_id = ?",
            (default_id, stage_id),
        )

    db.write("DELETE FROM task_stages WHERE id = ?", (stage_id,))
    return {"detail": "Stage deleted", "reassigned_to_stage_id": default_id}
