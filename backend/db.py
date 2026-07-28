"""Database connection and session management.

Wraps src/libs/SQL_handler.py for the board-games PM tool.
Provides a singleton connection via get_db(), schema/seed init via init_db().
"""

import os
import sys
from functools import lru_cache

# Ensure workspace root is on sys.path so src.libs.SQL_handler is importable
_workspace_root = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
)
if _workspace_root not in sys.path:
    sys.path.insert(0, _workspace_root)

from src.libs.SQL_handler import SQLHandler

# ── Paths ──────────────────────────────────────

_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
_DB_DIR = os.path.join(_BACKEND_DIR, "..", "_db")
_DB_PATH = os.path.join(_DB_DIR, "pmtool.db")
_SCHEMA_PATH = os.path.join(_BACKEND_DIR, "schema.sql")


# ── Singleton connection ───────────────────────


@lru_cache(maxsize=1)
def get_db() -> SQLHandler:
    """Return a singleton read-write database connection.

    The underlying SQLite file is created on first connect if it does
    not already exist.
    """
    os.makedirs(_DB_DIR, exist_ok=True)
    # Touch the DB file so SQLHandler.connect() doesn't raise FileNotFoundError
    if not os.path.exists(_DB_PATH):
        open(_DB_PATH, "a").close()

    db = SQLHandler(mode="read_write")
    db.connect(_DB_PATH, mode="read_write")
    return db


# ── Initialisation ─────────────────────────────


def init_db() -> None:
    """Delete the database, run schema DDL, then seed fresh data.

    The database is completely reset on every application start — all
    existing data is wiped and re-initialised from the JSON config files.
    """
    db = get_db()

    # ── Wipe all tables ──────────────────────
    # Disable FK checks temporarily so we can drop in any order
    db._connection.executescript("PRAGMA foreign_keys = OFF;")
    tables = db.fetch_column(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    )
    for t in tables:
        db.write(f"DELETE FROM {t}")
    db._connection.executescript("PRAGMA foreign_keys = ON;")

    # Run schema.sql via executescript (handles multi-statement DDL including triggers)
    with open(_SCHEMA_PATH, "r") as f:
        schema_sql = f.read()
    db._connection.executescript(schema_sql)
    db._connection.commit()

    # Conditionally add generated column (no IF NOT EXISTS in ALTER TABLE in SQLite)
    try:
        db._connection.executescript(
            "ALTER TABLE external_links ADD COLUMN ext_state TEXT "
            "GENERATED ALWAYS AS (json_extract(raw_payload, '$.state')) STORED;"
        )
        db._connection.executescript(
            "CREATE INDEX IF NOT EXISTS idx_external_links_state "
            "ON external_links(ext_state);"
        )
    except Exception:
        pass  # column or index already exists — idempotent

    # Approval-flow columns for tasks
    try:
        db._connection.executescript(
            "ALTER TABLE tasks ADD COLUMN pending_approval INTEGER DEFAULT 0;"
        )
    except Exception:
        pass
    try:
        db._connection.executescript(
            "ALTER TABLE tasks ADD COLUMN previous_status TEXT;"
        )
    except Exception:
        pass
    try:
        db._connection.executescript(
            "ALTER TABLE tasks ADD COLUMN last_edited_by INTEGER REFERENCES users(id);"
        )
    except Exception:
        pass

    # Seed
    from backend.seed import seed  # noqa: PLC0415

    seed()


def close_db() -> None:
    """Close the singleton connection."""
    db = get_db()
    db.disconnect()
