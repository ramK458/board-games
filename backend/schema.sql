-- Board Games — Complete SQLite Schema
-- 14 tables + indexes + triggers + CHECK constraints
-- Based on architecture/design-docs/board-games-db-mapping.md

PRAGMA foreign_keys = ON;

-- ── 1. Users ──────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    email       TEXT    UNIQUE,
    role        TEXT    CHECK(role IN ('admin','super_user','user')),
    config      TEXT    DEFAULT '{}'
);

-- ── 2. Hierarchy Levels ───────────────────────

CREATE TABLE IF NOT EXISTS hierarchy_levels (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT    NOT NULL UNIQUE,
    parent_level_id  INTEGER REFERENCES hierarchy_levels(id),
    sort_order       INTEGER NOT NULL DEFAULT 0,
    config           TEXT    DEFAULT '{}'
);

-- ── 3. Hierarchy Nodes ────────────────────────

CREATE TABLE IF NOT EXISTS hierarchy_nodes (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    level_id       INTEGER NOT NULL REFERENCES hierarchy_levels(id),
    parent_node_id INTEGER REFERENCES hierarchy_nodes(id),
    name           TEXT    NOT NULL,
    description    TEXT    DEFAULT '',
    super_user_id  INTEGER REFERENCES users(id),
    config         TEXT    DEFAULT '{}',
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hierarchy_nodes_level
    ON hierarchy_nodes(level_id);
CREATE INDEX IF NOT EXISTS idx_hierarchy_nodes_parent
    ON hierarchy_nodes(parent_node_id);
CREATE INDEX IF NOT EXISTS idx_hierarchy_nodes_super_user
    ON hierarchy_nodes(super_user_id);

-- ── 4. Task Stages ────────────────────────────

CREATE TABLE IF NOT EXISTS task_stages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES hierarchy_nodes(id),
    stage_name TEXT    NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    color_hex  TEXT    DEFAULT '#6366f1',
    active     INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_task_stages_project
    ON task_stages(project_id);

-- ── 5. Provider Configs ───────────────────────

CREATE TABLE IF NOT EXISTS provider_configs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    provider       TEXT    NOT NULL UNIQUE,
    api_base_url   TEXT    NOT NULL,
    auth_token     TEXT,
    webhook_secret TEXT,
    rate_limit_rph INTEGER DEFAULT 5000,
    enabled        INTEGER DEFAULT 1
);

-- ── 6. Tasks ──────────────────────────────────

CREATE TABLE IF NOT EXISTS tasks (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    title          TEXT    NOT NULL,
    description    TEXT    DEFAULT '',
    status         TEXT    NOT NULL DEFAULT 'not_done'
                           CHECK(status IN ('not_done','in_progress','complete')),
    priority       TEXT    DEFAULT 'medium'
                           CHECK(priority IN ('low','medium','high','critical')),
    start_date     TEXT,
    end_date       TEXT,
    deadline       TEXT,
    parent_node_id INTEGER NOT NULL REFERENCES hierarchy_nodes(id) ON DELETE CASCADE,
    assignee_id    INTEGER REFERENCES users(id),
    task_type      TEXT    DEFAULT 'open_closure'
                           CHECK(task_type IN ('open_closure','approval_required')),
    stage_id       INTEGER REFERENCES task_stages(id),
    creator_id     INTEGER REFERENCES users(id),
    days_to_complete INTEGER,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tasks_parent
    ON tasks(parent_node_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee
    ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status
    ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_stage
    ON tasks(stage_id);
CREATE INDEX IF NOT EXISTS idx_tasks_priority
    ON tasks(priority);
CREATE INDEX IF NOT EXISTS idx_tasks_deadline
    ON tasks(deadline);
CREATE INDEX IF NOT EXISTS idx_tasks_start_date
    ON tasks(start_date);
CREATE INDEX IF NOT EXISTS idx_tasks_end_date
    ON tasks(end_date);

-- ── 7. Task Tags ──────────────────────────────

CREATE TABLE IF NOT EXISTS task_tags (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id   INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    tag_name  TEXT    NOT NULL,
    color_hex TEXT    DEFAULT '#6366f1'
);

CREATE INDEX IF NOT EXISTS idx_task_tags_task
    ON task_tags(task_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_tags_unique
    ON task_tags(task_id, tag_name);

-- ── 8. Comments ───────────────────────────────

CREATE TABLE IF NOT EXISTS comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    body       TEXT    NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    edited_at  TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_comments_task
    ON comments(task_id);
CREATE INDEX IF NOT EXISTS idx_comments_created
    ON comments(task_id, created_at);

-- ── 9. Cross References ───────────────────────

CREATE TABLE IF NOT EXISTS cross_references (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    source_task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    target_task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    ref_type       TEXT    NOT NULL
                           CHECK(ref_type IN ('blocks','blocked_by','duplicates','related_to','caused_by','subtask')),
    note           TEXT    DEFAULT '',
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cross_refs_source
    ON cross_references(source_task_id);
CREATE INDEX IF NOT EXISTS idx_cross_refs_target
    ON cross_references(target_task_id);
CREATE INDEX IF NOT EXISTS idx_cross_refs_type
    ON cross_references(ref_type);

-- ── 10. Access Control ────────────────────────

CREATE TABLE IF NOT EXISTS access_control (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id),
    resource_type TEXT    NOT NULL,
    resource_id   INTEGER,
    permission    TEXT    NOT NULL CHECK(permission IN ('read','write','admin'))
);

CREATE INDEX IF NOT EXISTS idx_access_control_user
    ON access_control(user_id);
CREATE INDEX IF NOT EXISTS idx_access_control_resource
    ON access_control(resource_type, resource_id);

-- ── 11. External Links ────────────────────────

CREATE TABLE IF NOT EXISTS external_links (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    internal_type  TEXT    NOT NULL,
    internal_id    INTEGER NOT NULL,
    provider       TEXT    NOT NULL,
    external_id    TEXT    NOT NULL,
    external_url   TEXT,
    raw_payload    TEXT    DEFAULT '{}',
    last_synced_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_external_links_key
    ON external_links(internal_type, internal_id, provider);
CREATE INDEX IF NOT EXISTS idx_external_links_provider
    ON external_links(provider, external_id);

-- Generated column ext_state is added conditionally in db.py

-- ── 12. Field Mappings ────────────────────────

CREATE TABLE IF NOT EXISTS field_mappings (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    provider       TEXT    NOT NULL REFERENCES provider_configs(provider),
    internal_field TEXT    NOT NULL,
    external_path  TEXT    NOT NULL,
    direction      TEXT    DEFAULT 'bidir'
                           CHECK(direction IN ('inbound','outbound','bidir')),
    value_map      TEXT    DEFAULT NULL,
    transform_fn   TEXT    DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_field_mappings_provider
    ON field_mappings(provider);
CREATE INDEX IF NOT EXISTS idx_field_mappings_field
    ON field_mappings(provider, internal_field);

-- ── 13. Outbox ────────────────────────────────

CREATE TABLE IF NOT EXISTS outbox (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    aggregate_type TEXT    NOT NULL,
    aggregate_id   INTEGER NOT NULL,
    event_type     TEXT    NOT NULL,
    payload        TEXT    NOT NULL,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at   TIMESTAMP,
    retry_count    INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_outbox_unprocessed
    ON outbox(processed_at) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_outbox_aggregate
    ON outbox(aggregate_type, aggregate_id);

-- ── 14. Inbox ─────────────────────────────────

CREATE TABLE IF NOT EXISTS inbox (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    provider     TEXT    NOT NULL,
    event_type   TEXT    NOT NULL,
    raw_payload  TEXT    NOT NULL,
    received_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP,
    status       TEXT    DEFAULT 'pending'
);

-- ── 15. Project Tags (per-project tag library) ─

CREATE TABLE IF NOT EXISTS project_tags (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES hierarchy_nodes(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    color_hex  TEXT    DEFAULT '#6366f1',
    UNIQUE(project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_project_tags_project
    ON project_tags(project_id);

-- ── 16. Task Change Log ──────────────────────

CREATE TABLE IF NOT EXISTS task_change_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    field_name  TEXT    NOT NULL,
    old_value   TEXT,
    new_value   TEXT,
    changed_by  INTEGER REFERENCES users(id),
    changed_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_task_change_log_task
    ON task_change_log(task_id, changed_at);

-- ── Triggers ──────────────────────────────────

-- Auto-update tasks.updated_at on any change
CREATE TRIGGER IF NOT EXISTS trg_tasks_updated_at
    AFTER UPDATE ON tasks
    FOR EACH ROW
BEGIN
    UPDATE tasks SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- Outbox: task created
CREATE TRIGGER IF NOT EXISTS trg_tasks_outbox_insert
    AFTER INSERT ON tasks
    FOR EACH ROW
BEGIN
    INSERT INTO outbox (aggregate_type, aggregate_id, event_type, payload)
    VALUES (
        'task',
        NEW.id,
        'task.created',
        json_object('id', NEW.id, 'title', NEW.title)
    );
END;

-- Outbox: task updated
CREATE TRIGGER IF NOT EXISTS trg_tasks_outbox_update
    AFTER UPDATE ON tasks
    FOR EACH ROW
BEGIN
    INSERT INTO outbox (aggregate_type, aggregate_id, event_type, payload)
    VALUES (
        'task',
        NEW.id,
        'task.updated',
        json_object('id', NEW.id, 'status', NEW.status, 'stage_id', NEW.stage_id)
    );
END;

-- Auto-update hierarchy_nodes.updated_at on any change
CREATE TRIGGER IF NOT EXISTS trg_hierarchy_nodes_updated_at
    AFTER UPDATE ON hierarchy_nodes
    FOR EACH ROW
BEGIN
    UPDATE hierarchy_nodes SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
