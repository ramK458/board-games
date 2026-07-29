"""FastAPI application entry point for the Board Games project manager."""

import asyncio
import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from backend.db import init_db, close_db, get_db
from backend.ws import websocket_handler, start_lock_cleanup


# ── Lifespan ───────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialise the database, start background workers, clean up on shutdown."""
    init_db()
    cleanup_task = asyncio.create_task(start_lock_cleanup())
    from backend.sync_engine import start_sync_engine, stop_sync_engine

    start_sync_engine()
    yield
    await stop_sync_engine()
    cleanup_task.cancel()
    close_db()


# ── Application ────────────────────────────────

app = FastAPI(
    title="Board Games API",
    version="0.1.0",
    description="A hierarchical project management system.",
    lifespan=lifespan,
)

# ── CORS ───────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Auth middleware ────────────────────────────


@app.middleware("http")
async def attach_user_id(request: Request, call_next):
    """Extract ``X-User-Id`` header and attach it to ``request.state``."""
    user_id = request.headers.get("X-User-Id")
    try:
        request.state.user_id = int(user_id) if user_id else None
    except (ValueError, TypeError):
        request.state.user_id = None
    response = await call_next(request)
    return response


# ── Routers (stubs for now) ────────────────────

from backend.routes import (  # noqa: E402
    charts,
    comments,
    hierarchy,
    integration,
    references,
    settings,
    stages,
    tasks,
    users,
)

app.include_router(charts.router, prefix="/api")
app.include_router(comments.router, prefix="/api")
app.include_router(hierarchy.router, prefix="/api")
app.include_router(integration.router, prefix="/api")
app.include_router(references.router, prefix="/api")
app.include_router(settings.router, prefix="/api")
app.include_router(stages.router, prefix="/api")
app.include_router(tasks.router, prefix="/api")
app.include_router(users.router, prefix="/api")


# ── Health ─────────────────────────────────────


@app.get("/api/health")
async def health_check():
    db = get_db()
    return {"status": "ok", "db_path": db.db_path}


# ── WebSocket ──────────────────────────────────


@app.websocket("/ws/updates")
async def ws_endpoint(websocket):
    await websocket_handler(websocket)


# ── Entry point ────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
