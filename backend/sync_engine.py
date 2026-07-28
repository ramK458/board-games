"""Outbox relay engine, inbox processor, and cleanup tasks.

Background workers for external integration: polls the outbox table,
relays events to external providers, processes inbound webhook events
from the inbox table, and periodically cleans up stale records.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

from backend.db import get_db

logger = logging.getLogger("sync-engine")

# ── Constants ──────────────────────────────────

_OUTBOX_POLL_INTERVAL = 2  # seconds
_INBOX_POLL_INTERVAL = 5  # seconds
_CLEANUP_INTERVAL = 3600  # 1 hour
_OUTBOX_RETENTION_DAYS = 7
_MAX_RETRIES = 5

# ── Shared HTTP client ─────────────────────────

_client: Optional[httpx.AsyncClient] = None
_poll_task: Optional[asyncio.Task] = None
_inbox_task: Optional[asyncio.Task] = None
_cleanup_task: Optional[asyncio.Task] = None
_running = False


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=10.0)
    return _client


# ═══════════════════════════════════════════════
#  T17 — Outbox Relay Engine
# ═══════════════════════════════════════════════


async def poll_outbox() -> None:
    """Poll the outbox table every 2 s and push unprocessed events."""
    while _running:
        try:
            db = get_db()
            rows = db.fetch_all(
                """SELECT * FROM outbox
                   WHERE processed_at IS NULL
                   ORDER BY created_at ASC
                   LIMIT 50""",
            )
            for row in rows:
                await _process_outbox_row(row)
        except Exception:
            logger.exception("poll_outbox error")
        await asyncio.sleep(_OUTBOX_POLL_INTERVAL)


async def _process_outbox_row(row: dict[str, Any]) -> None:
    """Relay a single outbox row to all linked external providers."""
    db = get_db()
    oid = row["id"]
    aggregate_type = row["aggregate_type"]
    aggregate_id = row["aggregate_id"]
    payload: dict[str, Any] = _parse_json(row["payload"])

    # 1. Fetch external links for this aggregate
    links = db.fetch_all(
        "SELECT * FROM external_links WHERE internal_type = ? AND internal_id = ?",
        (aggregate_type, aggregate_id),
    )
    if not links:
        # No external links — nothing to push; mark as processed
        db.write(
            "UPDATE outbox SET processed_at = datetime('now'), retry_count = 0 WHERE id = ?",
            (oid,),
        )
        return

    # 2. For each link, fetch field mappings and push
    for link in links:
        provider = link["provider"]
        mappings = db.fetch_all(
            "SELECT * FROM field_mappings WHERE provider = ? AND direction IN ('outbound','bidir')",
            (provider,),
        )

        # 3. Build external payload via field mappings
        ext_payload = _apply_outbound_mappings(payload, mappings)

        # 4. Fetch provider config
        pconfig = db.fetch_one(
            "SELECT * FROM provider_configs WHERE provider = ? AND enabled = 1",
            (provider,),
        )
        if pconfig is None:
            logger.warning("Provider %s not found or disabled — skipping", provider)
            continue

        # 5. Push to provider API
        success = await _push_to_provider(
            provider=provider,
            api_base_url=pconfig["api_base_url"],
            auth_token=pconfig["auth_token"],
            event_type=row["event_type"],
            external_id=link["external_id"],
            payload=ext_payload,
        )

        if success:
            db.write(
                "UPDATE outbox SET processed_at = datetime('now'), retry_count = 0 WHERE id = ?",
                (oid,),
            )
            db.write(
                "UPDATE external_links SET last_synced_at = datetime('now') WHERE id = ?",
                (link["id"],),
            )
        else:
            retry_count = row["retry_count"] + 1
            db.write(
                "UPDATE outbox SET retry_count = ? WHERE id = ?",
                (retry_count, oid),
            )
            if retry_count >= _MAX_RETRIES:
                logger.warning(
                    "Outbox row %d exceeded max retries (%d) — giving up",
                    oid,
                    _MAX_RETRIES,
                )


def _apply_outbound_mappings(
    payload: dict[str, Any],
    mappings: list[dict[str, Any]],
) -> dict[str, Any]:
    """Transform an internal payload using outbound field mappings."""
    result: dict[str, Any] = {}
    for mapping in mappings:
        internal_field = mapping["internal_field"]
        external_path = mapping["external_path"]
        value_map_raw = mapping.get("value_map")
        value_map: dict[str, str] = {}
        if value_map_raw:
            try:
                value_map = (
                    json.loads(value_map_raw)
                    if isinstance(value_map_raw, str)
                    else value_map_raw
                )
            except (json.JSONDecodeError, TypeError):
                value_map = {}

        raw_value = payload.get(internal_field)
        # Apply value_map translation
        if raw_value is not None and value_map:
            mapped = value_map.get(str(raw_value), raw_value)
        else:
            mapped = raw_value

        # Set value on the external path (supports dot-notation and simple keys)
        _set_nested(result, external_path, mapped)

    return result


def _set_nested(d: dict[str, Any], path: str, value: Any) -> None:
    """Set a value in a nested dict using a dot-delimited path (e.g. 'fields.status')."""
    parts = path.split(".")
    current = d
    for i, part in enumerate(parts):
        if i == len(parts) - 1:
            current[part] = value
        else:
            if part not in current:
                current[part] = {}
            current = current[part]


async def _push_to_provider(
    provider: str,
    api_base_url: str,
    auth_token: str | None,
    event_type: str,
    external_id: str,
    payload: dict[str, Any],
) -> bool:
    """POST the payload to the provider's API endpoint.

    Returns ``True`` on 2xx, ``False`` otherwise.
    """
    client = _get_client()
    url = f"{api_base_url.rstrip('/')}/items/{external_id}/events"
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if auth_token:
        headers["Authorization"] = f"Bearer {auth_token}"

    body = {"event_type": event_type, "data": payload}

    try:
        resp = await client.post(url, json=body, headers=headers)
        if resp.is_success:
            return True
        logger.warning(
            "Push to %s returned %d: %s",
            provider,
            resp.status_code,
            resp.text[:200],
        )
        return False
    except httpx.RequestError as exc:
        logger.warning("Push to %s failed: %s", provider, exc)
        return False


# ═══════════════════════════════════════════════
#  T18 — Inbox Processor
# ═══════════════════════════════════════════════


async def process_inbox() -> None:
    """Poll the inbox table and process pending events."""
    while _running:
        try:
            db = get_db()
            rows = db.fetch_all(
                """SELECT * FROM inbox
                   WHERE processed_at IS NULL AND status = 'pending'
                   ORDER BY received_at ASC
                   LIMIT 20""",
            )
            for row in rows:
                await _process_inbox_row(row)
        except Exception:
            logger.exception("process_inbox error")
        await asyncio.sleep(_INBOX_POLL_INTERVAL)


async def _process_inbox_row(row: dict[str, Any]) -> None:
    """Process a single inbound webhook event."""
    db = get_db()
    iid = row["id"]
    provider = row["provider"]
    event_type = row["event_type"]
    raw_payload: dict[str, Any] = _parse_json(row["raw_payload"])

    # 1. Fetch inbound field mappings for this provider
    mappings = db.fetch_all(
        "SELECT * FROM field_mappings WHERE provider = ? AND direction IN ('inbound','bidir')",
        (provider,),
    )

    if not mappings:
        # No mappings → unknown event type
        db.write(
            "UPDATE inbox SET status = 'ignored', processed_at = datetime('now') WHERE id = ?",
            (iid,),
        )
        return

    try:
        # 2. Apply reverse mapping (external → internal)
        internal_data = _apply_inbound_mappings(raw_payload, mappings)

        # 3. Determine canonical table and UPSERT
        internal_type = _resolve_internal_type(event_type)
        if internal_type is None:
            db.write(
                "UPDATE inbox SET status = 'ignored', processed_at = datetime('now') WHERE id = ?",
                (iid,),
            )
            return

        internal_id = await _upsert_canonical(internal_type, internal_data)

        # 4. Create or update external_link
        existing = db.fetch_one(
            "SELECT id FROM external_links WHERE provider = ? AND external_id = ?",
            (provider, str(raw_payload.get("id", internal_id))),
        )
        if existing is None:
            db.insert("external_links", {
                "internal_type": internal_type,
                "internal_id": internal_id,
                "provider": provider,
                "external_id": str(raw_payload.get("id", internal_id)),
                "external_url": raw_payload.get("url", ""),
                "raw_payload": json.dumps(raw_payload),
                "last_synced_at": datetime.now(timezone.utc).isoformat(),
            })
        else:
            db.write(
                """UPDATE external_links
                   SET raw_payload = ?, last_synced_at = datetime('now')
                   WHERE id = ?""",
                (json.dumps(raw_payload), existing["id"]),
            )

        # 5. Mark inbox as processed
        db.write(
            "UPDATE inbox SET status = 'processed', processed_at = datetime('now') WHERE id = ?",
            (iid,),
        )
    except Exception as exc:
        logger.exception("Inbox row %d processing failed", iid)
        db.write(
            "UPDATE inbox SET status = 'failed', processed_at = datetime('now') WHERE id = ?",
            (iid,),
        )


def _apply_inbound_mappings(
    payload: dict[str, Any],
    mappings: list[dict[str, Any]],
) -> dict[str, Any]:
    """Transform an external payload into internal fields using inbound mappings."""
    result: dict[str, Any] = {}
    for mapping in mappings:
        external_path = mapping["external_path"]
        internal_field = mapping["internal_field"]
        value_map_raw = mapping.get("value_map")
        value_map: dict[str, str] = {}
        if value_map_raw:
            try:
                value_map = (
                    json.loads(value_map_raw)
                    if isinstance(value_map_raw, str)
                    else value_map_raw
                )
            except (json.JSONDecodeError, TypeError):
                value_map = {}

        raw_value = _get_nested(payload, external_path)
        # Apply reverse value_map
        if raw_value is not None and value_map:
            reverse_map = {v: k for k, v in value_map.items()}
            mapped = reverse_map.get(str(raw_value), raw_value)
        else:
            mapped = raw_value

        result[internal_field] = mapped

    return result


def _get_nested(d: dict[str, Any], path: str) -> Any:
    """Get a value from a nested dict using a dot-delimited path."""
    parts = path.split(".")
    current: Any = d
    for part in parts:
        if isinstance(current, dict):
            current = current.get(part)
        else:
            return None
    return current


def _resolve_internal_type(event_type: str) -> str | None:
    """Map an external event_type to an internal aggregate type name.

    Returns ``None`` if the event type is unrecognised.
    """
    mapping = {
        "issue.created": "task",
        "issue.updated": "task",
        "issue.closed": "task",
        "task.created": "task",
        "task.updated": "task",
        "task.completed": "task",
    }
    return mapping.get(event_type)


async def _upsert_canonical(internal_type: str, data: dict[str, Any]) -> int:
    """Insert or update a row in the canonical table; return the row id.

    Currently only supports ``"task"``.  Raises ValueError for unknown types.
    """
    db = get_db()

    if internal_type == "task":
        external_id = data.get("external_id") or data.get("id")
        if external_id:
            existing = db.fetch_one(
                """SELECT el.internal_id FROM external_links el
                   WHERE el.internal_type = 'task' AND el.external_id = ?""",
                (str(external_id),),
            )
            if existing:
                return existing["internal_id"]

        # Insert new task
        task_id = db.insert("tasks", {
            "title": data.get("title", "Imported task"),
            "description": data.get("description", ""),
            "status": data.get("status", "not_done"),
            "priority": data.get("priority", "medium"),
            "parent_node_id": data.get("parent_node_id", 1),
        })
        return task_id

    raise ValueError(f"Unknown internal_type: {internal_type}")


# ═══════════════════════════════════════════════
#  Cleanup
# ═══════════════════════════════════════════════


async def cleanup_old_outbox() -> None:
    """Delete outbox rows older than 7 days every hour."""
    while _running:
        try:
            db = get_db()
            db.write(
                "DELETE FROM outbox WHERE processed_at < datetime('now', ?)",
                (f"-{_OUTBOX_RETENTION_DAYS} days",),
            )
        except Exception:
            logger.exception("cleanup_old_outbox error")
        await asyncio.sleep(_CLEANUP_INTERVAL)


# ═══════════════════════════════════════════════
#  Lifecycle
# ═══════════════════════════════════════════════


def start_sync_engine() -> None:
    """Launch background tasks (called from application lifespan)."""
    global _running, _poll_task, _inbox_task, _cleanup_task
    _running = True
    _poll_task = asyncio.create_task(poll_outbox())
    _inbox_task = asyncio.create_task(process_inbox())
    _cleanup_task = asyncio.create_task(cleanup_old_outbox())
    logger.info("Sync engine started (outbox poller, inbox processor, cleanup)")


async def stop_sync_engine() -> None:
    """Cancel all background tasks (called from application lifespan)."""
    global _running
    _running = False
    tasks = [_poll_task, _inbox_task, _cleanup_task]
    for t in tasks:
        if t and not t.done():
            t.cancel()
            try:
                await t
            except asyncio.CancelledError:
                pass
    if _client:
        await _client.aclose()
    logger.info("Sync engine stopped")


# ── Helpers ────────────────────────────────────


def _parse_json(raw: str | None) -> dict[str, Any]:
    """Safely parse a JSON string, returning an empty dict on failure."""
    if not raw:
        return {}
    try:
        return json.loads(raw) if isinstance(raw, str) else raw
    except (json.JSONDecodeError, TypeError):
        return {}
