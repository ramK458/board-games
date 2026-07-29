"""Per-project settings routes — tag library, hierarchy labels."""

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.auth import get_current_user_dep
from backend.db import get_db

router = APIRouter(tags=["settings"])


# ═══════════════════════════════════════════════
#  Project Tags (per-project tag library)
# ═══════════════════════════════════════════════


class ProjectTagCreate(BaseModel):
    name: str
    color_hex: str = "#6366f1"


class ProjectTagUpdate(BaseModel):
    name: str
    color_hex: str


@router.get("/projects/{project_id}/tags")
async def list_project_tags(project_id: int, user: dict[str, Any] = Depends(get_current_user_dep)):
    """List all tags for a project."""
    db = get_db()
    return db.fetch_all("SELECT * FROM project_tags WHERE project_id = ? ORDER BY name", (project_id,))


@router.post("/projects/{project_id}/tags", status_code=201)
async def create_project_tag(project_id: int, body: ProjectTagCreate, user: dict[str, Any] = Depends(get_current_user_dep)):
    """Add a tag to a project."""
    db = get_db()
    existing = db.fetch_one("SELECT id FROM project_tags WHERE project_id = ? AND name = ?", (project_id, body.name))
    if existing:
        raise HTTPException(status_code=409, detail=f"Tag '{body.name}' already exists in this project")
    tid = db.insert("project_tags", {"project_id": project_id, "name": body.name, "color_hex": body.color_hex})
    return db.fetch_one("SELECT * FROM project_tags WHERE id = ?", (tid,))


@router.put("/projects/{project_id}/tags/{tag_name}")
async def update_project_tag(project_id: int, tag_name: str, body: ProjectTagUpdate, user: dict[str, Any] = Depends(get_current_user_dep)):
    """Update a project tag's name/color."""
    db = get_db()
    tag = db.fetch_one("SELECT * FROM project_tags WHERE project_id = ? AND name = ?", (project_id, tag_name))
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    db.update("project_tags", {"name": body.name, "color_hex": body.color_hex}, "id = ?", (tag["id"],))
    # Also update task_tags that use the old name in this project
    db.execute(
        "UPDATE task_tags SET tag_name = ?, color_hex = ? WHERE tag_name = ? AND task_id IN "
        "(SELECT id FROM tasks WHERE parent_node_id IN "
        "(WITH RECURSIVE subtree AS (SELECT id FROM hierarchy_nodes WHERE id = ? UNION ALL SELECT n.id FROM hierarchy_nodes n JOIN subtree s ON n.parent_node_id = s.id) SELECT id FROM subtree))",
        (body.name, body.color_hex, tag_name, project_id)
    )
    return db.fetch_one("SELECT * FROM project_tags WHERE id = ?", (tag["id"],))


@router.delete("/projects/{project_id}/tags/{tag_name}")
async def delete_project_tag(project_id: int, tag_name: str, user: dict[str, Any] = Depends(get_current_user_dep)):
    """Delete a project tag and remove it from all tasks in the project."""
    db = get_db()
    # Remove from all tasks under this project
    db.execute(
        "DELETE FROM task_tags WHERE tag_name = ? AND task_id IN "
        "(SELECT id FROM tasks WHERE parent_node_id IN "
        "(WITH RECURSIVE subtree AS (SELECT id FROM hierarchy_nodes WHERE id = ? UNION ALL SELECT n.id FROM hierarchy_nodes n JOIN subtree s ON n.parent_node_id = s.id) SELECT id FROM subtree))",
        (tag_name, project_id)
    )
    db.delete("project_tags", "project_id = ? AND name = ?", (project_id, tag_name))
    return {"deleted": tag_name}


# ═══════════════════════════════════════════════
#  Project Hierarchy Config
# ═══════════════════════════════════════════════


class HierarchyConfigUpdate(BaseModel):
    labels: list[str]


@router.get("/projects/{project_id}/hierarchy-config")
async def get_hierarchy_config(project_id: int, user: dict[str, Any] = Depends(get_current_user_dep)):
    """Get a project's hierarchy level labels. Falls back to global levels."""
    db = get_db()
    project = db.fetch_one("SELECT config FROM hierarchy_nodes WHERE id = ?", (project_id,))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    config = json.loads(project["config"]) if project["config"] else {}
    hierarchy = config.get("hierarchy", {})
    if hierarchy.get("labels"):
        return hierarchy
    levels = db.fetch_all("SELECT name FROM hierarchy_levels ORDER BY sort_order")
    return {"depth": len(levels), "labels": [l["name"] for l in levels]}


@router.put("/projects/{project_id}/hierarchy-config")
async def update_hierarchy_config(project_id: int, body: HierarchyConfigUpdate, user: dict[str, Any] = Depends(get_current_user_dep)):
    """Update a project's hierarchy level labels."""
    db = get_db()
    project = db.fetch_one("SELECT config FROM hierarchy_nodes WHERE id = ?", (project_id,))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    config = json.loads(project["config"]) if project["config"] else {}
    config["hierarchy"] = {"depth": len(body.labels), "labels": body.labels}
    db.update("hierarchy_nodes", {"config": json.dumps(config)}, "id = ?", (project_id,))
    return config["hierarchy"]
