"""Task CRUD routes with search, pagination, approval flow, and tag management."""

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.auth import get_current_user_dep
from backend.db import get_db
from backend.models import TaskCreate, TaskResponse, TaskUpdate
from backend.ws import broadcast_to_subscribers

router = APIRouter(tags=["tasks"])

# ── Helpers ────────────────────────────────────


def _task_to_response(task: dict[str, Any]) -> dict[str, Any]:
    """Convert a raw task row to a TaskResponse-like dict with tags + comments_count."""
    task_id = task["id"]
    db = get_db()

    tags = db.fetch_all(
        "SELECT id, tag_name, color_hex FROM task_tags WHERE task_id = ? ORDER BY id",
        (task_id,),
    )
    tag_list = [
        {"id": t["id"], "tag_name": t["tag_name"], "color_hex": t["color_hex"]}
        for t in tags
    ]

    cc = db.fetch_one(
        "SELECT COUNT(*) AS cnt FROM comments WHERE task_id = ?", (task_id,)
    )
    comments_count = cc["cnt"] if cc else 0

    result = dict(task)
    result["tags"] = tag_list
    result["comments_count"] = comments_count
    return result


def _get_super_user_of_node(node_id: int) -> Optional[int]:
    """Walk up the hierarchy to find the nearest super_user_id."""
    db = get_db()
    current_id: Optional[int] = node_id
    while current_id is not None:
        node = db.fetch_one(
            "SELECT parent_node_id, super_user_id FROM hierarchy_nodes WHERE id = ?",
            (current_id,),
        )
        if node is None:
            break
        if node["super_user_id"] is not None:
            return node["super_user_id"]
        current_id = node["parent_node_id"]
    return None


# ═══════════════════════════════════════════════
#  Task CRUD
# ═══════════════════════════════════════════════


@router.get("/tasks")
async def list_tasks(
    parent_id: Optional[int] = Query(None),
    scope: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    stage_id: Optional[int] = Query(None),
    assignee_id: Optional[int] = Query(None),
    priority: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    tags: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
    sort: Optional[str] = Query(None),
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """List tasks with optional filtering, search, tag filtering, and pagination.

    * ``?scope=42`` — recursive: find tasks under node 42 AND all its descendants
    * ``?parent_id=42`` — direct: only tasks whose parent_node_id = 42
    * ``?tags=bug,urgent`` — tasks with ALL specified tags (AND logic)
    * ``?sort=deadline:asc,priority:desc`` — multi-field sort
    * Pagination via ``?page=1&per_page=50`` (max 100)

    ``scope`` and ``parent_id`` are mutually exclusive. If both are given,
    ``scope`` takes precedence.
    """
    db = get_db()

    where_clauses: list[str] = []
    params: list[Any] = []

    if scope is not None:
        # Recursive CTE: find all descendant nodes, then match tasks
        where_clauses.append(
            "t.parent_node_id IN ("
            "  WITH RECURSIVE subtree AS ("
            "    SELECT id FROM hierarchy_nodes WHERE id = ?"
            "    UNION ALL"
            "    SELECT n.id FROM hierarchy_nodes n"
            "    INNER JOIN subtree s ON n.parent_node_id = s.id"
            "  )"
            "  SELECT id FROM subtree"
            ")"
        )
        params.append(scope)
    elif parent_id is not None:
        where_clauses.append("t.parent_node_id = ?")
        params.append(parent_id)

    if status is not None:
        statuses = [s.strip() for s in status.split(",")]
        placeholders = ", ".join(["?"] * len(statuses))
        where_clauses.append(f"t.status IN ({placeholders})")
        params.extend(statuses)

    if stage_id is not None:
        where_clauses.append("t.stage_id = ?")
        params.append(stage_id)

    if assignee_id is not None:
        where_clauses.append("t.assignee_id = ?")
        params.append(assignee_id)

    if priority is not None:
        where_clauses.append("t.priority = ?")
        params.append(priority)

    if search:
        where_clauses.append("(t.title LIKE ? OR t.description LIKE ?)")
        like_term = f"%{search}%"
        params.append(like_term)
        params.append(like_term)

    # Tag filtering (AND logic — tasks must have ALL specified tags)
    if tags:
        tag_list = [t.strip() for t in tags.split(",") if t.strip()]
        if tag_list:
            tag_placeholders = ", ".join(["?"] * len(tag_list))
            where_clauses.append(
                f"t.id IN ("
                f"  SELECT tt.task_id FROM task_tags tt"
                f"  WHERE tt.tag_name IN ({tag_placeholders})"
                f"  GROUP BY tt.task_id"
                f"  HAVING COUNT(DISTINCT tt.tag_name) = ?"
                f")"
            )
            params.extend(tag_list)
            params.append(len(tag_list))

    # Build WHERE
    where_sql = " AND ".join(where_clauses) if where_clauses else "1=1"

    # Count total
    count_row = db.fetch_one(
        f"SELECT COUNT(*) AS cnt FROM tasks t WHERE {where_sql}",
        tuple(params),
    )
    total = count_row["cnt"] if count_row else 0
    pages = max(1, (total + per_page - 1) // per_page)

    # Sort
    order_parts: list[str] = []
    if sort:
        for part in sort.split(","):
            part = part.strip()
            if ":" in part:
                field, direction = part.split(":", 1)
                field = field.strip()
                direction = direction.strip().lower()
                allowed_fields = {
                    "title", "status", "priority", "deadline",
                    "start_date", "end_date", "created_at", "updated_at",
                    "stage_id", "assignee_id",
                }
                if field in allowed_fields:
                    dir_sql = "DESC" if direction == "desc" else "ASC"
                    order_parts.append(f"t.{field} {dir_sql}")
    if not order_parts:
        order_parts.append("t.created_at DESC")

    order_sql = ", ".join(order_parts)
    offset = (page - 1) * per_page

    rows = db.fetch_all(
        f"SELECT t.* FROM tasks t WHERE {where_sql} ORDER BY {order_sql} "
        f"LIMIT ? OFFSET ?",
        tuple(params) + (per_page, offset),
    )

    items = [_task_to_response(r) for r in rows]

    return {"items": items, "total": total, "page": page, "pages": pages}


@router.post("/tasks", status_code=201)
async def create_task(
    body: TaskCreate,
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Create a new task. ``creator_id`` is auto-set from the authenticated user."""
    db = get_db()

    # Verify parent node exists
    node = db.fetch_one(
        "SELECT id FROM hierarchy_nodes WHERE id = ?", (body.parent_node_id,)
    )
    if node is None:
        raise HTTPException(status_code=404, detail="Parent node not found")

    if body.stage_id is not None:
        stage = db.fetch_one(
            "SELECT id FROM task_stages WHERE id = ?", (body.stage_id,)
        )
        if stage is None:
            raise HTTPException(status_code=404, detail="Stage not found")

    task_id = db.insert("tasks", {
        "title": body.title,
        "description": body.description,
        "status": body.status,
        "priority": body.priority,
        "start_date": body.start_date,
        "end_date": body.end_date,
        "deadline": body.deadline,
        "parent_node_id": body.parent_node_id,
        "assignee_id": body.assignee_id,
        "task_type": body.task_type,
        "stage_id": body.stage_id,
        "creator_id": user["id"],
    })

    task = db.fetch_one("SELECT * FROM tasks WHERE id = ?", (task_id,))
    resp = _task_to_response(task)
    await broadcast_to_subscribers(resp["parent_node_id"], {
        "type": "task_updated",
        "task": resp,
    })
    return resp


@router.get("/tasks/{task_id}")
async def get_task(
    task_id: int,
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Get a single task with tags, comments_count, and cross-references."""
    db = get_db()

    task = db.fetch_one("SELECT * FROM tasks WHERE id = ?", (task_id,))
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    result = _task_to_response(task)

    # Include cross-references (both outgoing and incoming)
    outgoing = db.fetch_all(
        "SELECT * FROM cross_references WHERE source_task_id = ?", (task_id,)
    )
    incoming = db.fetch_all(
        "SELECT * FROM cross_references WHERE target_task_id = ?", (task_id,)
    )
    result["references"] = {
        "outgoing": outgoing,
        "incoming": incoming,
    }

    return result


@router.put("/tasks/{task_id}")
async def update_task(
    task_id: int,
    body: TaskUpdate,
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Update a task. Partial update — only send changed fields.

    Approval flow: if ``task_type=approval_required`` and the assignee
    tries to set ``status=complete``, the endpoint sets ``pending_approval=1``
    and returns a prompt for the parent node's super_user to approve.
    """
    db = get_db()

    existing = db.fetch_one("SELECT * FROM tasks WHERE id = ?", (task_id,))
    if existing is None:
        raise HTTPException(status_code=404, detail="Task not found")

    # Build updates dict from non-None fields
    updates: dict[str, Any] = {}
    for field in (
        "title", "description", "priority", "start_date", "end_date",
        "deadline", "parent_node_id", "assignee_id", "task_type", "stage_id",
    ):
        val = getattr(body, field, None)
        if val is not None:
            updates[field] = val

    # Status change with approval flow
    if body.status is not None:
        current_type = existing["task_type"]
        if body.status == "complete" and current_type == "approval_required":
            # Check if the requesting user is the assignee (or admin)
            if user["role"] != "admin" and user["id"] != existing["assignee_id"]:
                raise HTTPException(
                    status_code=403,
                    detail="Only the assignee or an admin can mark a task complete",
                )

            # Find the super_user of the parent node
            approver_id = _get_super_user_of_node(existing["parent_node_id"])
            if approver_id is None:
                raise HTTPException(
                    status_code=400,
                    detail="No super_user found for the parent node — cannot process approval",
                )

            # Set pending approval instead of completing
            updates["status"] = "not_done"  # keep unchanged
            updates["pending_approval"] = 1
            updates["previous_status"] = existing["status"]
            updates["last_edited_by"] = user["id"]

            db.update("tasks", updates, "id = ?", (task_id,))

            task = db.fetch_one("SELECT * FROM tasks WHERE id = ?", (task_id,))
            resp = _task_to_response(task)
            await broadcast_to_subscribers(resp["parent_node_id"], {
                "type": "task_updated",
                "task": resp,
            })
            return {
                "needs_approval": True,
                "approver_id": approver_id,
                "task": resp,
            }

        updates["status"] = body.status

    # If setting status to complete on a non-approval task, clear any pending flag
    if body.status == "complete":
        updates["pending_approval"] = 0
        updates["previous_status"] = None

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    # Track who last edited this task
    updates["last_edited_by"] = user["id"]

    db.update("tasks", updates, "id = ?", (task_id,))

    task = db.fetch_one("SELECT * FROM tasks WHERE id = ?", (task_id,))
    resp = _task_to_response(task)
    await broadcast_to_subscribers(resp["parent_node_id"], {
        "type": "task_updated",
        "task": resp,
    })
    return resp


@router.delete("/tasks/{task_id}")
async def delete_task(
    task_id: int,
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Delete a task. CASCADE removes associated tags, comments, and refs."""
    db = get_db()

    existing = db.fetch_one("SELECT * FROM tasks WHERE id = ?", (task_id,))
    if existing is None:
        raise HTTPException(status_code=404, detail="Task not found")

    parent_node_id = existing["parent_node_id"]
    db.write("DELETE FROM tasks WHERE id = ?", (task_id,))
    await broadcast_to_subscribers(parent_node_id, {
        "type": "task_deleted",
        "task_id": task_id,
    })
    return {"detail": "Task deleted"}


# ═══════════════════════════════════════════════
#  Tags
# ═══════════════════════════════════════════════


@router.post("/tasks/{task_id}/tags", status_code=201)
async def add_tag(
    task_id: int,
    body: dict[str, Any],
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Add a tag to a task. Body: ``tag_name`` (required), ``color_hex``.

    Duplicate ``(task_id, tag_name)`` pairs are rejected by the UNIQUE
    constraint.
    """
    db = get_db()

    task = db.fetch_one("SELECT id FROM tasks WHERE id = ?", (task_id,))
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    tag_name = body.get("tag_name")
    if not tag_name or not isinstance(tag_name, str) or not tag_name.strip():
        raise HTTPException(status_code=422, detail="tag_name is required")

    color_hex = body.get("color_hex", "#6366f1")

    try:
        tag_id = db.insert("task_tags", {
            "task_id": task_id,
            "tag_name": tag_name.strip(),
            "color_hex": color_hex,
        })
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc))

    return {"id": tag_id, "tag_name": tag_name.strip(), "color_hex": color_hex}


@router.delete("/tasks/{task_id}/tags/{tag_id}")
async def remove_tag(
    task_id: int,
    tag_id: int,
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Remove a tag from a task."""
    db = get_db()

    existing = db.fetch_one(
        "SELECT id FROM task_tags WHERE id = ? AND task_id = ?",
        (tag_id, task_id),
    )
    if existing is None:
        raise HTTPException(status_code=404, detail="Tag not found")

    db.write("DELETE FROM task_tags WHERE id = ?", (tag_id,))
    return {"detail": "Tag removed"}


# ═══════════════════════════════════════════════
#  Approval flow
# ═══════════════════════════════════════════════


@router.post("/tasks/{task_id}/approve")
async def approve_task(
    task_id: int,
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Approve a task awaiting approval. Only the super_user of the
    parent node (or an admin) may approve. Sets status=complete."""
    db = get_db()

    task = db.fetch_one("SELECT * FROM tasks WHERE id = ?", (task_id,))
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    if not task.get("pending_approval"):
        raise HTTPException(
            status_code=400,
            detail="Task is not awaiting approval",
        )

    # Find the super_user of the parent node
    approver_id = _get_super_user_of_node(task["parent_node_id"])
    if user["role"] != "admin" and user["id"] != approver_id:
        raise HTTPException(
            status_code=403,
            detail="Only the super_user of the parent node can approve",
        )

    db.update(
        "tasks",
        {"status": "complete", "pending_approval": 0, "previous_status": None},
        "id = ?",
        (task_id,),
    )

    updated = db.fetch_one("SELECT * FROM tasks WHERE id = ?", (task_id,))
    resp = _task_to_response(updated)
    await broadcast_to_subscribers(resp["parent_node_id"], {
        "type": "task_updated",
        "task": resp,
    })
    return {"detail": "Task approved", "task": resp}


@router.post("/tasks/{task_id}/reject")
async def reject_task(
    task_id: int,
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Reject an approval request. Resets the task to its previous status."""
    db = get_db()

    task = db.fetch_one("SELECT * FROM tasks WHERE id = ?", (task_id,))
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    if not task.get("pending_approval"):
        raise HTTPException(
            status_code=400,
            detail="Task is not awaiting approval",
        )

    # Find the super_user of the parent node
    approver_id = _get_super_user_of_node(task["parent_node_id"])
    if user["role"] != "admin" and user["id"] != approver_id:
        raise HTTPException(
            status_code=403,
            detail="Only the super_user of the parent node can reject",
        )

    previous = task.get("previous_status", "not_done") or "not_done"

    db.update(
        "tasks",
        {"status": previous, "pending_approval": 0, "previous_status": None},
        "id = ?",
        (task_id,),
    )

    updated = db.fetch_one("SELECT * FROM tasks WHERE id = ?", (task_id,))
    resp = _task_to_response(updated)
    await broadcast_to_subscribers(resp["parent_node_id"], {
        "type": "task_updated",
        "task": resp,
    })
    return {"detail": "Task rejected, status reset", "task": resp}

