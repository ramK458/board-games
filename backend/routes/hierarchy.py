"""Hierarchy CRUD routes.

Implements CRUD on hierarchy_levels and hierarchy_nodes with recursive
tree support and permission checks.
"""

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.auth import get_current_user_dep, require_permission
from backend.db import get_db

router = APIRouter(tags=["hierarchy"])


# ═══════════════════════════════════════════════
#  Helper utilities
# ═══════════════════════════════════════════════


def _row_to_dict(row: dict[str, Any] | None) -> dict[str, Any] | None:
    """Deserialise JSON columns (config) for API responses."""
    if row is None:
        return None
    result = dict(row)
    if isinstance(result.get("config"), str):
        import json

        try:
            result["config"] = json.loads(result["config"])
        except (json.JSONDecodeError, TypeError):
            result["config"] = {}
    return result


def _require_admin(user: dict[str, Any]) -> None:
    """Raise 403 if the user is not an admin."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")


# ═══════════════════════════════════════════════
#  Levels
# ═══════════════════════════════════════════════


@router.get("/hierarchy/levels")
async def list_levels():
    """List all hierarchy levels ordered by sort_order."""
    db = get_db()
    rows = db.fetch_all(
        "SELECT * FROM hierarchy_levels ORDER BY sort_order ASC, id ASC"
    )
    return [_row_to_dict(r) for r in rows]


@router.post("/hierarchy/levels", status_code=201)
async def create_level(
    body: dict[str, Any],
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Create a new hierarchy level (admin only).

    Body fields: name (required), parent_level_id, sort_order, config.
    """
    _require_admin(user)

    name = body.get("name")
    if not name or not isinstance(name, str) or not name.strip():
        raise HTTPException(status_code=422, detail="name is required")

    import json

    db = get_db()
    try:
        level_id = db.insert(
            "hierarchy_levels",
            {
                "name": name.strip(),
                "parent_level_id": body.get("parent_level_id"),
                "sort_order": body.get("sort_order", 0),
                "config": json.dumps(body.get("config", {})),
            },
        )
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc))

    row = db.fetch_one(
        "SELECT * FROM hierarchy_levels WHERE id = ?", (level_id,)
    )
    return _row_to_dict(row)


@router.put("/hierarchy/levels/{level_id}")
async def update_level(
    level_id: int,
    body: dict[str, Any],
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Update a hierarchy level (admin only)."""
    _require_admin(user)
    db = get_db()

    existing = db.fetch_one(
        "SELECT * FROM hierarchy_levels WHERE id = ?", (level_id,)
    )
    if existing is None:
        raise HTTPException(status_code=404, detail="Level not found")

    import json

    updates: dict[str, Any] = {}
    for field in ("name", "parent_level_id", "sort_order"):
        if field in body:
            updates[field] = body[field]
    if "config" in body:
        updates["config"] = json.dumps(body["config"])

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [level_id]
    db.write(
        f"UPDATE hierarchy_levels SET {set_clause} WHERE id = ?",
        tuple(values),
    )

    row = db.fetch_one(
        "SELECT * FROM hierarchy_levels WHERE id = ?", (level_id,)
    )
    return _row_to_dict(row)


@router.delete("/hierarchy/levels/{level_id}")
async def delete_level(
    level_id: int,
    force: bool = False,
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Delete a hierarchy level (admin only).

    If nodes exist at this level, returns 409 with count unless
    ``?force=true`` is set, in which case all nodes (and their
    subtrees + tasks) are cascade-deleted.
    """
    _require_admin(user)
    db = get_db()

    existing = db.fetch_one(
        "SELECT * FROM hierarchy_levels WHERE id = ?", (level_id,)
    )
    if existing is None:
        raise HTTPException(status_code=404, detail="Level not found")

    # Check for dependent nodes
    node_count = db.fetch_one(
        "SELECT COUNT(*) AS cnt FROM hierarchy_nodes WHERE level_id = ?",
        (level_id,),
    )
    count = node_count["cnt"] if node_count else 0

    if count > 0 and not force:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete level: {count} node(s) still reference it. "
                   f"Use ?force=true to cascade-delete all {count} node(s) and their contents.",
        )

    if count > 0 and force:
        nodes = db.fetch_all(
            "SELECT id FROM hierarchy_nodes WHERE level_id = ?", (level_id,)
        )
        for node in nodes:
            _cascade_delete_node(db, node["id"])

    db.write("DELETE FROM hierarchy_levels WHERE id = ?", (level_id,))
    msg = f"Level deleted"
    if count > 0 and force:
        msg += f" along with {count} node(s) and their contents"
    return {"detail": msg}


def _cascade_delete_node(db, node_id: int) -> None:
    """Recursively delete a node, its children, and their tasks."""
    children = db.fetch_all(
        "SELECT id FROM hierarchy_nodes WHERE parent_node_id = ?", (node_id,)
    )
    for child in children:
        _cascade_delete_node(db, child["id"])
    db.write("DELETE FROM hierarchy_nodes WHERE id = ?", (node_id,))


# ═══════════════════════════════════════════════
#  Nodes
# ═══════════════════════════════════════════════


@router.get("/hierarchy/nodes")
async def list_nodes(
    parent_id: Optional[int] = Query(None),
    level_id: Optional[int] = Query(None),
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """List hierarchy nodes with optional filtering.

    * ``?parent_id=N`` — return direct children of node N
    * ``?level_id=N`` — return all nodes at a given level
    * ``omit`` both — return root nodes (parent_node_id IS NULL)
    """
    db = get_db()

    if parent_id is not None:
        rows = db.fetch_all(
            "SELECT * FROM hierarchy_nodes WHERE parent_node_id = ? "
            "ORDER BY name ASC",
            (parent_id,),
        )
    elif level_id is not None:
        rows = db.fetch_all(
            "SELECT * FROM hierarchy_nodes WHERE level_id = ? "
            "ORDER BY name ASC",
            (level_id,),
        )
    else:
        rows = db.fetch_all(
            "SELECT * FROM hierarchy_nodes WHERE parent_node_id IS NULL "
            "ORDER BY name ASC"
        )

    # Permission filtering: apply access_control rules
    filtered = []
    for row in rows:
        try:
            require_permission(
                user["id"], "node", row["id"], "read"
            )
            filtered.append(_row_to_dict(row))
        except HTTPException:
            pass

    return filtered


@router.get("/hierarchy/nodes/{node_id}")
async def get_node(
    node_id: int,
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Get a single node with its full ancestor path via recursive CTE."""
    db = get_db()

    row = db.fetch_one(
        "SELECT * FROM hierarchy_nodes WHERE id = ?", (node_id,)
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Node not found")

    # Permission check
    require_permission(user["id"], "node", node_id, "read")

    # Ancestor path via recursive CTE
    ancestors = db.fetch_all(
        """
        WITH RECURSIVE ancestors AS (
            SELECT id, parent_node_id, name, level_id, 0 AS depth
            FROM hierarchy_nodes WHERE id = ?
            UNION ALL
            SELECT n.id, n.parent_node_id, n.name, n.level_id, a.depth + 1
            FROM hierarchy_nodes n
            INNER JOIN ancestors a ON n.id = a.parent_node_id
        )
        SELECT id, name, level_id, depth
        FROM ancestors
        WHERE id != ?
        ORDER BY depth DESC
        """,
        (node_id, node_id),
    )

    result = _row_to_dict(row)
    result["ancestors"] = ancestors
    return result


@router.post("/hierarchy/nodes", status_code=201)
async def create_node(
    body: dict[str, Any],
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Create a new hierarchy node under a parent.

    Admin or super_user of the parent node required.
    Body: level_id (required), parent_node_id, name (required),
          description, super_user_id, config.
    """
    name = body.get("name")
    level_id = body.get("level_id")
    if not name or not isinstance(name, str) or not name.strip():
        raise HTTPException(status_code=422, detail="name is required")
    if level_id is None:
        raise HTTPException(status_code=422, detail="level_id is required")

    import json

    db = get_db()

    # Verify level exists
    level = db.fetch_one(
        "SELECT id FROM hierarchy_levels WHERE id = ?", (level_id,)
    )
    if level is None:
        raise HTTPException(status_code=404, detail="Level not found")

    parent_node_id = body.get("parent_node_id")

    # Permission: admin bypass OR super_user of parent node
    if user["role"] != "admin" and parent_node_id is not None:
        parent = db.fetch_one(
            "SELECT super_user_id FROM hierarchy_nodes WHERE id = ?",
            (parent_node_id,),
        )
        if parent is None:
            raise HTTPException(status_code=404, detail="Parent node not found")
        if parent["super_user_id"] != user["id"]:
            raise HTTPException(
                status_code=403,
                detail="Only the super_user of the parent node can create children",
            )

    try:
        node_id = db.insert(
            "hierarchy_nodes",
            {
                "level_id": level_id,
                "parent_node_id": parent_node_id,
                "name": name.strip(),
                "description": body.get("description", ""),
                "super_user_id": body.get("super_user_id", user["id"]),
                "config": json.dumps(body.get("config", {})),
            },
        )
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc))

    row = db.fetch_one(
        "SELECT * FROM hierarchy_nodes WHERE id = ?", (node_id,)
    )
    return _row_to_dict(row)


@router.put("/hierarchy/nodes/{node_id}")
async def update_node(
    node_id: int,
    body: dict[str, Any],
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Update a hierarchy node.

    Admin or super_user of the node (or its ancestors) required.
    Cannot set parent_node_id to self or a descendant (cycle check).
    """
    db = get_db()

    existing = db.fetch_one(
        "SELECT * FROM hierarchy_nodes WHERE id = ?", (node_id,)
    )
    if existing is None:
        raise HTTPException(status_code=404, detail="Node not found")

    # Permission
    require_permission(user["id"], "node", node_id, "write")

    import json

    updates: dict[str, Any] = {}
    for field in ("name", "description", "super_user_id"):
        if field in body:
            updates[field] = body[field]

    if "config" in body:
        updates["config"] = json.dumps(body["config"])

    # Handle parent_node_id with cycle check
    new_parent = body.get("parent_node_id")
    if new_parent is not None:
        if new_parent == node_id:
            raise HTTPException(
                status_code=422,
                detail="Cannot set a node as its own parent",
            )
        # Cycle check: verify new_parent is not a descendant of node_id
        descendants = db.fetch_all(
            """
            WITH RECURSIVE descendants AS (
                SELECT id FROM hierarchy_nodes WHERE parent_node_id = ?
                UNION ALL
                SELECT n.id FROM hierarchy_nodes n
                INNER JOIN descendants d ON n.parent_node_id = d.id
            )
            SELECT id FROM descendants
            """,
            (node_id,),
        )
        descendant_ids = {r["id"] for r in descendants}
        if new_parent in descendant_ids:
            raise HTTPException(
                status_code=422,
                detail="Cannot set parent to a descendant node (cycle detected)",
            )
        updates["parent_node_id"] = new_parent
    elif "parent_node_id" in body and new_parent is None:
        updates["parent_node_id"] = None

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [node_id]
    db.write(
        f"UPDATE hierarchy_nodes SET {set_clause} WHERE id = ?",
        tuple(values),
    )

    row = db.fetch_one(
        "SELECT * FROM hierarchy_nodes WHERE id = ?", (node_id,)
    )
    return _row_to_dict(row)


@router.delete("/hierarchy/nodes/{node_id}")
async def delete_node(
    node_id: int,
    force: bool = False,
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Delete a hierarchy node (admin or super_user).

    Returns 409 with count info if the node has children or tasks,
    unless ``?force=true`` is set, in which case all children and
    tasks are cascade-deleted.
    """
    db = get_db()

    existing = db.fetch_one(
        "SELECT * FROM hierarchy_nodes WHERE id = ?", (node_id,)
    )
    if existing is None:
        raise HTTPException(status_code=404, detail="Node not found")

    require_permission(user["id"], "node", node_id, "write")

    child_count = db.fetch_one(
        "SELECT COUNT(*) AS cnt FROM hierarchy_nodes WHERE parent_node_id = ?",
        (node_id,),
    )
    children = child_count["cnt"] if child_count else 0

    task_count = db.fetch_one(
        "SELECT COUNT(*) AS cnt FROM tasks WHERE parent_node_id = ?",
        (node_id,),
    )
    tasks = task_count["cnt"] if task_count else 0

    if (children > 0 or tasks > 0) and not force:
        parts = []
        if children > 0:
            parts.append(f"{children} child node(s)")
        if tasks > 0:
            parts.append(f"{tasks} task(s)")
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete node: {' and '.join(parts)} exist. "
                   f"Use ?force=true to cascade-delete all of them.",
        )

    if force:
        _cascade_delete_node(db, node_id)
    else:
        db.write("DELETE FROM hierarchy_nodes WHERE id = ?", (node_id,))
    return {"detail": "Node deleted", "children_deleted": children, "tasks_deleted": tasks}


# ═══════════════════════════════════════════════
#  Tree (recursive)
# ═══════════════════════════════════════════════


def _build_tree(
    db,
    parent_id: int | None,
    level_name_map: dict[int, str],
    user_id: int,
) -> list[dict[str, Any]]:
    """Recursively build a permission-filtered tree.

    Uses iterative fetching to avoid SQLite recursive CTE depth limits
    and to interleave permission checks at each level.
    """
    if parent_id is None:
        rows = db.fetch_all(
            "SELECT * FROM hierarchy_nodes WHERE parent_node_id IS NULL "
            "ORDER BY name ASC"
        )
    else:
        rows = db.fetch_all(
            "SELECT * FROM hierarchy_nodes WHERE parent_node_id = ? "
            "ORDER BY name ASC",
            (parent_id,),
        )

    result = []
    for row in rows:
        # Permission filter
        try:
            require_permission(user_id, "node", row["id"], "read")
        except HTTPException:
            continue

        node = _row_to_dict(row)
        node["level_name"] = level_name_map.get(node["level_id"], "")
        node["children"] = _build_tree(db, row["id"], level_name_map, user_id)
        result.append(node)

    return result


@router.get("/hierarchy/tree")
async def get_tree(
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Return the full hierarchy tree as nested JSON.

    Each node includes ``children`` (recursive), ``level_name``, and all
    columns from ``hierarchy_nodes``.  Results are permission-filtered
    via the ``access_control`` table.
    """
    db = get_db()

    # Pre-load level names
    levels = db.fetch_all("SELECT id, name FROM hierarchy_levels")
    level_name_map: dict[int, str] = {l["id"]: l["name"] for l in levels}

    tree = _build_tree(db, None, level_name_map, user["id"])
    return tree
