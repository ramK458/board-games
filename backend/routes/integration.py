"""External integration routes — webhooks, external links, provider config,
and field mapping CRUD."""

from __future__ import annotations

import hashlib
import hmac
import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from backend.auth import get_current_user_dep
from backend.db import get_db
from backend.models import (
    ExternalLinkCreate,
    FieldMapping,
    FieldMappingUpdate,
    IntegrationProvider,
    IntegrationProviderUpdate,
    WebhookPayload,
)

router = APIRouter(tags=["integration"])


# ── Helpers ────────────────────────────────────


def _require_admin(user: dict[str, Any]) -> None:
    """Raise 403 if the user is not an admin."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")


def _safe_json(val: Any) -> str:
    """Convert a value to a JSON string, handling dicts and strings."""
    if isinstance(val, str):
        return val
    return json.dumps(val) if val is not None else "{}"


# ═══════════════════════════════════════════════
#  T18 — Webhook Receiver
# ═══════════════════════════════════════════════


@router.post("/webhook/{provider}")
async def receive_webhook(
    provider: str,
    request: Request,
    payload: WebhookPayload,
):
    """Receive an incoming webhook from an external provider.

    Verifies the webhook signature (if the provider has a ``webhook_secret``),
    inserts the event into the inbox table, and returns 200 immediately.
    """
    db = get_db()

    # 1. Fetch provider config
    pconfig = db.fetch_one(
        "SELECT * FROM provider_configs WHERE provider = ? AND enabled = 1",
        (provider,),
    )
    if pconfig is None:
        raise HTTPException(
            status_code=404,
            detail=f"Provider '{provider}' not found or disabled",
        )

    # 2. Verify signature (if secret is configured)
    secret = pconfig.get("webhook_secret")
    if secret:
        signature_header = request.headers.get("X-Hub-Signature-256") or ""
        raw_body = await request.body()
        expected = "sha256=" + hmac.new(
            secret.encode(),
            raw_body,
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(signature_header, expected):
            raise HTTPException(status_code=401, detail="Invalid webhook signature")

    # 3. Insert into inbox
    db.insert("inbox", {
        "provider": provider,
        "event_type": payload.event_type,
        "raw_payload": _safe_json(payload.payload),
    })

    return {"status": "accepted"}


# ═══════════════════════════════════════════════
#  T18 — External Links
# ═══════════════════════════════════════════════


@router.get("/integrations/links")
async def list_links(
    internal_type: str | None = None,
    internal_id: int | None = None,
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """List external links, optionally filtered by internal_type / internal_id."""
    db = get_db()
    if internal_type and internal_id is not None:
        rows = db.fetch_all(
            "SELECT * FROM external_links WHERE internal_type = ? AND internal_id = ?",
            (internal_type, internal_id),
        )
    elif internal_type:
        rows = db.fetch_all(
            "SELECT * FROM external_links WHERE internal_type = ?",
            (internal_type,),
        )
    else:
        rows = db.fetch_all("SELECT * FROM external_links ORDER BY id")

    results = []
    for r in rows:
        entry = dict(r)
        entry["raw_payload"] = _parse_json(entry.get("raw_payload"))
        results.append(entry)
    return results


@router.post("/integrations/links")
async def create_link(
    link: ExternalLinkCreate,
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Create a new external link between an internal entity and an external resource."""
    db = get_db()
    try:
        lid = db.insert("external_links", {
            "internal_type": link.internal_type,
            "internal_id": link.internal_id,
            "provider": link.provider,
            "external_id": link.external_id,
            "external_url": link.external_url or "",
        })
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    return {"id": lid, "status": "created"}


@router.delete("/integrations/links/{link_id}")
async def delete_link(
    link_id: int,
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Delete an external link."""
    db = get_db()
    affected = db.delete("external_links", "id = ?", (link_id,))
    if affected == 0:
        raise HTTPException(status_code=404, detail="Link not found")
    return {"status": "deleted"}


# ═══════════════════════════════════════════════
#  T19 — Provider Config CRUD
# ═══════════════════════════════════════════════


@router.get("/integrations/providers")
async def list_providers(
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """List all configured integration providers."""
    _require_admin(user)
    db = get_db()
    rows = db.fetch_all("SELECT * FROM provider_configs ORDER BY provider")
    # Mask auth_token in responses
    safe = []
    for r in rows:
        entry = dict(r)
        if entry.get("auth_token"):
            entry["auth_token"] = "***"
        safe.append(entry)
    return safe


@router.post("/integrations/providers")
async def create_provider(
    provider: IntegrationProvider,
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Add a new integration provider configuration."""
    _require_admin(user)
    db = get_db()
    existing = db.fetch_one(
        "SELECT id FROM provider_configs WHERE provider = ?",
        (provider.provider,),
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Provider '{provider.provider}' already exists",
        )

    pid = db.insert("provider_configs", {
        "provider": provider.provider,
        "api_base_url": provider.api_base_url,
        "auth_token": provider.auth_token or "",
        "webhook_secret": provider.webhook_secret or "",
        "rate_limit_rph": provider.rate_limit_rph,
        "enabled": 1 if provider.enabled else 0,
    })
    return {"id": pid, "status": "created"}


@router.put("/integrations/providers/{provider_id}")
async def update_provider(
    provider_id: int,
    update: IntegrationProviderUpdate,
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Update an existing provider configuration."""
    _require_admin(user)
    db = get_db()
    existing = db.fetch_one(
        "SELECT * FROM provider_configs WHERE id = ?", (provider_id,),
    )
    if existing is None:
        raise HTTPException(status_code=404, detail="Provider not found")

    fields: dict[str, Any] = {}
    if update.provider is not None:
        fields["provider"] = update.provider
    if update.api_base_url is not None:
        fields["api_base_url"] = update.api_base_url
    if update.auth_token is not None:
        fields["auth_token"] = update.auth_token
    if update.webhook_secret is not None:
        fields["webhook_secret"] = update.webhook_secret
    if update.rate_limit_rph is not None:
        fields["rate_limit_rph"] = update.rate_limit_rph
    if update.enabled is not None:
        fields["enabled"] = 1 if update.enabled else 0

    if fields:
        db.update("provider_configs", fields, "id = ?", (provider_id,))

    return {"status": "updated"}


@router.delete("/integrations/providers/{provider_id}")
async def delete_provider(
    provider_id: int,
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Delete a provider configuration."""
    _require_admin(user)
    db = get_db()
    affected = db.delete("provider_configs", "id = ?", (provider_id,))
    if affected == 0:
        raise HTTPException(status_code=404, detail="Provider not found")
    return {"status": "deleted"}


# ═══════════════════════════════════════════════
#  T19 — Field Mapping CRUD
# ═══════════════════════════════════════════════


@router.get("/integrations/mappings")
async def list_mappings(
    provider: str | None = None,
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """List field mappings, optionally filtered by provider."""
    _require_admin(user)
    db = get_db()
    if provider:
        rows = db.fetch_all(
            "SELECT * FROM field_mappings WHERE provider = ? ORDER BY internal_field",
            (provider,),
        )
    else:
        rows = db.fetch_all(
            "SELECT * FROM field_mappings ORDER BY provider, internal_field",
        )
    results = []
    for r in rows:
        entry = dict(r)
        vm = entry.get("value_map")
        if vm and isinstance(vm, str):
            try:
                entry["value_map"] = json.loads(vm)
            except (json.JSONDecodeError, TypeError):
                entry["value_map"] = None
        results.append(entry)
    return results


@router.post("/integrations/mappings")
async def create_mapping(
    mapping: FieldMapping,
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Create a new field mapping for a provider."""
    _require_admin(user)
    db = get_db()

    # Validate provider exists
    pconfig = db.fetch_one(
        "SELECT id FROM provider_configs WHERE provider = ?",
        (mapping.provider,),
    )
    if pconfig is None:
        raise HTTPException(
            status_code=404,
            detail=f"Provider '{mapping.provider}' not found. Create it first.",
        )

    mid = db.insert("field_mappings", {
        "provider": mapping.provider,
        "internal_field": mapping.internal_field,
        "external_path": mapping.external_path,
        "direction": mapping.direction,
        "value_map": _safe_json(mapping.value_map) if mapping.value_map else None,
        "transform_fn": mapping.transform_fn,
    })
    return {"id": mid, "status": "created"}


@router.put("/integrations/mappings/{mapping_id}")
async def update_mapping(
    mapping_id: int,
    update: FieldMappingUpdate,
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Update an existing field mapping."""
    _require_admin(user)
    db = get_db()
    existing = db.fetch_one(
        "SELECT * FROM field_mappings WHERE id = ?", (mapping_id,),
    )
    if existing is None:
        raise HTTPException(status_code=404, detail="Mapping not found")

    fields: dict[str, Any] = {}
    if update.provider is not None:
        fields["provider"] = update.provider
    if update.internal_field is not None:
        fields["internal_field"] = update.internal_field
    if update.external_path is not None:
        fields["external_path"] = update.external_path
    if update.direction is not None:
        fields["direction"] = update.direction
    if update.value_map is not None:
        fields["value_map"] = _safe_json(update.value_map)
    if update.transform_fn is not None:
        fields["transform_fn"] = update.transform_fn

    if fields:
        db.update("field_mappings", fields, "id = ?", (mapping_id,))

    return {"status": "updated"}


@router.delete("/integrations/mappings/{mapping_id}")
async def delete_mapping(
    mapping_id: int,
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Delete a field mapping."""
    _require_admin(user)
    db = get_db()
    affected = db.delete("field_mappings", "id = ?", (mapping_id,))
    if affected == 0:
        raise HTTPException(status_code=404, detail="Mapping not found")
    return {"status": "deleted"}


# ── Helpers ────────────────────────────────────


def _parse_json(raw: str | None) -> Any:
    if not raw:
        return {}
    try:
        return json.loads(raw) if isinstance(raw, str) else raw
    except (json.JSONDecodeError, TypeError):
        return {}
