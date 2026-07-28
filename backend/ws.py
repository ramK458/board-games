"""WebSocket server for real-time updates and mutex-based task locking.

Provides:
- ``/ws/updates?user_id={id}`` — WebSocket endpoint for subscribing to
  node updates, locking/unlocking tasks, and receiving task change events.
- ``broadcast_to_subscribers(node_id, message)`` — broadcast a message to
  all users subscribed to *node_id* or any ancestor node.
- ``start_lock_cleanup()`` — background task that releases expired task locks.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from backend.db import get_db

logger = logging.getLogger(__name__)


# ── In-memory state ────────────────────────────

# user_id -> list of active WebSocket connections
connections: dict[int, list[WebSocket]] = {}

# task_id -> user_id (who holds the lock)
task_locks: dict[int, int] = {}

# user_id -> set of node_ids they are subscribed to
subscriptions: dict[int, set[int]] = {}

# task_id -> expiry timestamp (time.monotonic + 300)
lock_timeouts: dict[int, float] = {}

_LOCK_DURATION: float = 300.0  # 5 minutes
_CLEANUP_INTERVAL: float = 30.0  # check every 30 seconds


# ── Helpers ────────────────────────────────────


def _get_ancestor_ids(node_id: int) -> list[int]:
    """Walk the hierarchy from *node_id* up to root and return all node IDs."""
    db = get_db()
    ancestors: list[int] = [node_id]
    current_id: int | None = node_id
    while current_id is not None:
        row = db.fetch_one(
            "SELECT parent_node_id FROM hierarchy_nodes WHERE id = ?",
            (current_id,),
        )
        if row is None or row["parent_node_id"] is None:
            break
        parent_id: int = row["parent_node_id"]
        ancestors.append(parent_id)
        current_id = parent_id
    return ancestors


async def _send_json(ws: WebSocket, data: dict[str, Any]) -> None:
    """Send a JSON message if the WebSocket is still connected."""
    try:
        if ws.client_state != WebSocketState.DISCONNECTED:
            await ws.send_json(data)
    except Exception:
        pass


# ── Broadcast ──────────────────────────────────


async def broadcast_to_subscribers(node_id: int, message: dict[str, Any]) -> None:
    """Send *message* to all users subscribed to *node_id* or any ancestor.

    This function is designed to be called from API route handlers after
    task create / update / delete operations.
    """
    ancestors = _get_ancestor_ids(node_id)
    sent_to: set[int] = set()

    for uid, subbed_nodes in list(subscriptions.items()):
        if subbed_nodes & set(ancestors):
            sent_to.add(uid)

    for uid in sent_to:
        for ws in connections.get(uid, []):
            await _send_json(ws, message)


# ── WebSocket handler ──────────────────────────


async def websocket_handler(websocket: WebSocket) -> None:
    """Accept a WebSocket connection and manage its lifecycle.

    Expects ``user_id`` as a query parameter: ``/ws/updates?user_id=42``.
    """
    # Extract user_id from query params
    user_id_str = websocket.query_params.get("user_id")
    if not user_id_str:
        await websocket.close(code=4000, reason="Missing user_id query parameter")
        return

    try:
        user_id = int(user_id_str)
    except (ValueError, TypeError):
        await websocket.close(code=4000, reason="Invalid user_id")
        return

    await websocket.accept()
    logger.info("WebSocket connected: user_id=%d", user_id)

    # Register connection
    if user_id not in connections:
        connections[user_id] = []
    connections[user_id].append(websocket)

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await _send_json(websocket, {"type": "error", "detail": "Invalid JSON"})
                continue

            msg_type = data.get("type")
            if msg_type == "lock_task":
                await _handle_lock_task(websocket, user_id, data)
            elif msg_type == "unlock_task":
                await _handle_unlock_task(websocket, user_id, data)
            elif msg_type == "subscribe":
                await _handle_subscribe(websocket, user_id, data)
            else:
                await _send_json(
                    websocket, {"type": "error", "detail": f"Unknown message type: {msg_type}"}
                )
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.exception("WebSocket error for user_id=%d: %s", user_id, exc)
    finally:
        # Clean up on disconnect
        await _handle_disconnect(user_id, websocket)


# ── Message handlers ───────────────────────────


async def _handle_lock_task(ws: WebSocket, user_id: int, data: dict[str, Any]) -> None:
    """Attempt to acquire a mutex lock on a task.

    Rules:
    - If task_id not in task_locks, assign lock with 5-minute timeout.
    - Broadcast ``task_locked`` to all subscribers of the task's node.
    - If already locked, send ``lock_denied`` only to the requester.
    """
    task_id = data.get("task_id")
    if not isinstance(task_id, int):
        await _send_json(ws, {"type": "error", "detail": "task_id must be an integer"})
        return

    if task_id in task_locks:
        locked_by = task_locks[task_id]
        # Check if lock has expired
        if task_id in lock_timeouts and time.monotonic() >= lock_timeouts[task_id]:
            # Lock expired — release it silently and re-acquire
            del task_locks[task_id]
            lock_timeouts.pop(task_id, None)
        else:
            await _send_json(ws, {
                "type": "lock_denied",
                "task_id": task_id,
                "locked_by": locked_by,
            })
            return

    # Acquire lock
    task_locks[task_id] = user_id
    lock_timeouts[task_id] = time.monotonic() + _LOCK_DURATION
    logger.info("Task %d locked by user %d", task_id, user_id)

    # Broadcast to subscribers of the task's node
    task_row = _get_task_node(task_id)
    if task_row:
        await broadcast_to_subscribers(task_row["parent_node_id"], {
            "type": "task_locked",
            "task_id": task_id,
            "locked_by": user_id,
        })


async def _handle_unlock_task(ws: WebSocket, user_id: int, data: dict[str, Any]) -> None:
    """Release a mutex lock on a task.

    Only the lock holder (or an admin) can release the lock.
    Broadcasts ``task_unlocked`` to all subscribers.
    """
    task_id = data.get("task_id")
    if not isinstance(task_id, int):
        await _send_json(ws, {"type": "error", "detail": "task_id must be an integer"})
        return

    current_holder = task_locks.get(task_id)
    if current_holder is None:
        await _send_json(ws, {"type": "error", "detail": "Task is not locked"})
        return

    # Check if the requesting user holds the lock
    # (In a real system you might also allow admins to force-unlock)
    if current_holder != user_id:
        await _send_json(ws, {
            "type": "error",
            "detail": f"Task {task_id} is locked by user {current_holder}",
        })
        return

    # Release lock
    task_locks.pop(task_id, None)
    lock_timeouts.pop(task_id, None)
    logger.info("Task %d unlocked by user %d", task_id, user_id)

    # Broadcast
    task_row = _get_task_node(task_id)
    if task_row:
        await broadcast_to_subscribers(task_row["parent_node_id"], {
            "type": "task_unlocked",
            "task_id": task_id,
        })


async def _handle_subscribe(ws: WebSocket, user_id: int, data: dict[str, Any]) -> None:
    """Subscribe the user to updates for a specific scope.

    Currently supports: ``{"type": "subscribe", "scope": "node", "id": 10}``
    """
    scope = data.get("scope")
    scope_id = data.get("id")

    if scope != "node" or not isinstance(scope_id, int):
        await _send_json(ws, {
            "type": "error",
            "detail": "Only 'node' scope with an integer 'id' is supported",
        })
        return

    if user_id not in subscriptions:
        subscriptions[user_id] = set()
    subscriptions[user_id].add(scope_id)
    logger.info("User %d subscribed to node %d", user_id, scope_id)

    await _send_json(ws, {
        "type": "subscribed",
        "scope": scope,
        "id": scope_id,
    })


# ── Disconnect handling ────────────────────────


async def _handle_disconnect(user_id: int, websocket: WebSocket) -> None:
    """Remove the WebSocket connection and release any locks held by this user."""
    # Remove the connection
    if user_id in connections:
        conns = connections[user_id]
        if websocket in conns:
            conns.remove(websocket)
        if not conns:
            del connections[user_id]

    # Release any task locks held by this user
    released: list[int] = []
    for task_id, holder in list(task_locks.items()):
        if holder == user_id:
            del task_locks[task_id]
            lock_timeouts.pop(task_id, None)
            released.append(task_id)

    # Broadcast unlock for released locks
    for task_id in released:
        task_row = _get_task_node(task_id)
        if task_row:
            await broadcast_to_subscribers(task_row["parent_node_id"], {
                "type": "task_unlocked",
                "task_id": task_id,
            })

    logger.info(
        "WebSocket disconnected: user_id=%d, released %d locks",
        user_id,
        len(released),
    )


# ── Lock cleanup background task ───────────────


async def start_lock_cleanup() -> None:
    """Periodically check for expired locks and release them.

    Runs every ``_CLEANUP_INTERVAL`` seconds. Intended to be started as
    an ``asyncio.create_task`` during the application lifespan.
    """
    while True:
        try:
            now = time.monotonic()
            expired = [tid for tid, expiry in lock_timeouts.items() if now >= expiry]

            for task_id in expired:
                holder = task_locks.pop(task_id, None)
                lock_timeouts.pop(task_id, None)
                if holder is not None:
                    logger.info("Lock expired for task %d (holder=%d)", task_id, holder)
                    task_row = _get_task_node(task_id)
                    if task_row:
                        await broadcast_to_subscribers(task_row["parent_node_id"], {
                            "type": "task_unlocked",
                            "task_id": task_id,
                        })
        except Exception as exc:
            logger.exception("Error in lock cleanup: %s", exc)

        await asyncio.sleep(_CLEANUP_INTERVAL)


# ── Internal helpers ───────────────────────────


def _get_task_node(task_id: int) -> dict[str, Any] | None:
    """Fetch the parent_node_id for a task. Returns None if not found."""
    try:
        db = get_db()
        return db.fetch_one(
            "SELECT id, parent_node_id FROM tasks WHERE id = ?",
            (task_id,),
        )
    except Exception:
        return None
