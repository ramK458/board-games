"""Pydantic v2 models for the Board Games project manager."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator, computed_field


# ── Hierarchy ──────────────────────────────────


class HierarchyLevel(BaseModel):
    id: Optional[int] = None
    name: str
    parent_level_id: Optional[int] = None
    sort_order: int = 0
    config: dict[str, Any] = Field(default_factory=dict)


class HierarchyNode(BaseModel):
    id: Optional[int] = None
    level_id: int
    parent_node_id: Optional[int] = None
    name: str
    description: str = ""
    super_user_id: Optional[int] = None
    config: dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class HierarchyTreeResponse(BaseModel):
    id: int
    name: str
    children: list[HierarchyTreeResponse] = Field(default_factory=list)


# ── Tasks ──────────────────────────────────────


class TaskCreate(BaseModel):
    title: str = Field(..., min_length=1)
    description: str = ""
    status: str = "not_done"
    priority: str = "medium"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    deadline: Optional[str] = None
    parent_node_id: int
    assignee_id: Optional[int] = None
    task_type: str = "open_closure"
    stage_id: Optional[int] = None

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        allowed = {"not_done", "in_progress", "complete"}
        if v not in allowed:
            raise ValueError(f"status must be one of {allowed}")
        return v

    @field_validator("priority")
    @classmethod
    def validate_priority(cls, v: str) -> str:
        allowed = {"low", "medium", "high", "critical"}
        if v not in allowed:
            raise ValueError(f"priority must be one of {allowed}")
        return v

    @field_validator("task_type")
    @classmethod
    def validate_task_type(cls, v: str) -> str:
        allowed = {"open_closure", "approval_required"}
        if v not in allowed:
            raise ValueError(f"task_type must be one of {allowed}")
        return v


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    deadline: Optional[str] = None
    parent_node_id: Optional[int] = None
    assignee_id: Optional[int] = None
    task_type: Optional[str] = None
    stage_id: Optional[int] = None

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        allowed = {"not_done", "in_progress", "complete"}
        if v not in allowed:
            raise ValueError(f"status must be one of {allowed}")
        return v

    @field_validator("priority")
    @classmethod
    def validate_priority(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        allowed = {"low", "medium", "high", "critical"}
        if v not in allowed:
            raise ValueError(f"priority must be one of {allowed}")
        return v

    @field_validator("task_type")
    @classmethod
    def validate_task_type(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        allowed = {"open_closure", "approval_required"}
        if v not in allowed:
            raise ValueError(f"task_type must be one of {allowed}")
        return v


class TaskResponse(BaseModel):
    id: int
    title: str
    description: str
    status: str
    priority: str
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    deadline: Optional[str] = None
    parent_node_id: int
    assignee_id: Optional[int] = None
    task_type: str
    stage_id: Optional[int] = None
    creator_id: int
    created_at: str
    updated_at: str
    tags: list[dict[str, Any]] = Field(default_factory=list)
    comments_count: int = 0

    @computed_field
    @property
    def is_overdue(self) -> bool:
        if self.deadline is None or self.status == "complete":
            return False
        try:
            deadline_date = date.fromisoformat(self.deadline)
            return deadline_date < date.today()
        except (ValueError, TypeError):
            return False


# ── Comments ───────────────────────────────────


class CommentCreate(BaseModel):
    task_id: int
    body: str = Field(..., min_length=1)


class CommentResponse(BaseModel):
    id: int
    task_id: int
    user_id: int
    body: str
    created_at: str
    edited_at: Optional[str] = None


# ── Cross References ───────────────────────────


class CrossReferenceCreate(BaseModel):
    source_task_id: int
    target_task_id: int
    ref_type: str
    note: str = ""

    @field_validator("ref_type")
    @classmethod
    def validate_ref_type(cls, v: str) -> str:
        allowed = {
            "blocks", "blocked_by", "duplicates",
            "related_to", "caused_by", "subtask",
        }
        if v not in allowed:
            raise ValueError(f"ref_type must be one of {allowed}")
        return v


class CrossReferenceResponse(BaseModel):
    id: int
    source_task_id: int
    target_task_id: int
    ref_type: str
    note: str
    created_at: str


# ── Stages ─────────────────────────────────────


class StageCreate(BaseModel):
    project_id: int
    stage_name: str = Field(..., min_length=1)
    sort_order: int = 0
    color_hex: str = "#6366f1"


class StageUpdate(BaseModel):
    stage_name: Optional[str] = None
    sort_order: Optional[int] = None
    color_hex: Optional[str] = None


class StageReorderItem(BaseModel):
    id: int
    sort_order: int


class StageResponse(BaseModel):
    id: int
    project_id: int
    stage_name: str
    sort_order: int
    color_hex: str


# ── Task Tags ──────────────────────────────────


class TaskTagCreate(BaseModel):
    tag_name: str
    color_hex: str = "#6366f1"


# ── Stages ─────────────────────────────────────


class TaskStage(BaseModel):
    id: Optional[int] = None
    project_id: int
    stage_name: str
    sort_order: int = 0
    color_hex: str = "#6366f1"


# ── Charts ─────────────────────────────────────


class ChartDataResponse(BaseModel):
    labels: list[str] = Field(default_factory=list)
    datasets: list[dict[str, Any]] = Field(default_factory=list)


# ── Users ──────────────────────────────────────


class UserResponse(BaseModel):
    id: int
    name: str
    email: Optional[str] = None
    role: str
    config: dict[str, Any] = Field(default_factory=dict)


# ── Integration / Provider Config ──────────────


class IntegrationProvider(BaseModel):
    id: Optional[int] = None
    provider: str = Field(..., min_length=1)
    api_base_url: str
    auth_token: Optional[str] = None
    webhook_secret: Optional[str] = None
    rate_limit_rph: int = 5000
    enabled: bool = True


class IntegrationProviderUpdate(BaseModel):
    provider: Optional[str] = None
    api_base_url: Optional[str] = None
    auth_token: Optional[str] = None
    webhook_secret: Optional[str] = None
    rate_limit_rph: Optional[int] = None
    enabled: Optional[bool] = None


class FieldMapping(BaseModel):
    id: Optional[int] = None
    provider: str
    internal_field: str
    external_path: str
    direction: str = "bidir"
    value_map: Optional[dict[str, str]] = None
    transform_fn: Optional[str] = None

    @field_validator("direction")
    @classmethod
    def validate_direction(cls, v: str) -> str:
        allowed = {"inbound", "outbound", "bidir"}
        if v not in allowed:
            raise ValueError(f"direction must be one of {allowed}")
        return v


class FieldMappingUpdate(BaseModel):
    provider: Optional[str] = None
    internal_field: Optional[str] = None
    external_path: Optional[str] = None
    direction: Optional[str] = None
    value_map: Optional[dict[str, str]] = None
    transform_fn: Optional[str] = None


class ExternalLinkCreate(BaseModel):
    internal_type: str
    internal_id: int
    provider: str
    external_id: str
    external_url: Optional[str] = None


class ExternalLinkResponse(BaseModel):
    id: int
    internal_type: str
    internal_id: int
    provider: str
    external_id: str
    external_url: Optional[str] = None
    raw_payload: dict[str, Any] = Field(default_factory=dict)
    last_synced_at: Optional[str] = None


class WebhookPayload(BaseModel):
    event_type: str
    payload: dict[str, Any] = Field(default_factory=dict)
