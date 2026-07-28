# Board Games

A database-centric project management tool with a customizable hierarchy tree, Kanban boards, Gantt charts, dependency graphs, and external provider integration.

**Stack:** Python FastAPI (backend) · React + TypeScript + Vite (frontend) · SQLite (database)

---

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 20+ and npm
- SQLite 3 (comes with macOS)

### 1. Clone and install

```bash
cd board-games

# Backend dependencies
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt

# Frontend dependencies
cd frontend && npm install && cd ..
```

### 2. Start the backend

```bash
source .venv/bin/activate
make dev-backend
# Starts on http://localhost:8000
```

On first start, the database is automatically created at `_db/pmtool.db` and seeded with data from the config files in `config/`.

### 3. Start the frontend

In a separate terminal:

```bash
cd board-games/frontend
npm run dev
# Opens on http://localhost:5173
```

### 4. Open the app

Navigate to **http://localhost:5173** in your browser.

---

## Configuration Files

All configuration lives in `config/`. These files define your workspace structure before you create a single task. The backend reads them on startup and seeds the database.

### `config/hierarchy.config.json` — Required

Defines the levels of your project hierarchy. You choose the names, count, and nesting. Tasks live at the bottom level.

**Example — 3-level hierarchy (Project → Module → Feature):**

```json
{
  "workspace": "Acme Corp",
  "levels": [
    {"name": "Project",  "sort_order": 1, "parent": null},
    {"name": "Module",   "sort_order": 2, "parent": "Project"},
    {"name": "Feature",  "sort_order": 3, "parent": "Module"}
  ],
  "task_level": "Feature"
}
```

**Example — 4-level hierarchy (Area → Project → Module → Feature):**

```json
{
  "workspace": "Enterprise",
  "levels": [
    {"name": "Area",     "sort_order": 1, "parent": null},
    {"name": "Project",  "sort_order": 2, "parent": "Area"},
    {"name": "Module",   "sort_order": 3, "parent": "Project"},
    {"name": "Feature",  "sort_order": 4, "parent": "Module"}
  ],
  "task_level": "Feature"
}
```

**Example — Simple 2-level (Project → Task):**

```json
{
  "workspace": "Personal",
  "levels": [
    {"name": "Project",  "sort_order": 1, "parent": null},
    {"name": "Task",     "sort_order": 2, "parent": "Project"}
  ],
  "task_level": "Task"
}
```

| Field | Required | Description |
|---|---|---|
| `workspace` | Yes | Display name for the root workspace node |
| `levels` | Yes | Array of hierarchy levels (at least 1) |
| `levels[].name` | Yes | Label for this level (shown in sidebar) |
| `levels[].sort_order` | Yes | Display order (1 = top) |
| `levels[].parent` | No | Name of the parent level. `null` (or omit) for root |
| `task_level` | Yes | Which level name contains tasks. Must match one of the level names |

**If invalid or missing:** The backend logs an error on startup. The sidebar shows "No projects yet" and no levels are available. Fix the JSON and restart the backend.

---

### `config/users.config.json` — Required

Defines who can use the system and their roles.

```json
{
  "users": [
    {"id": "u1", "name": "Alice",   "email": "alice@acme.com",  "role": "admin",       "config": {}},
    {"id": "u2", "name": "Bob",     "email": "bob@acme.com",    "role": "super_user",  "config": {}},
    {"id": "u3", "name": "Carol",   "email": "carol@acme.com",  "role": "user",        "config": {}},
    {"id": "u4", "name": "Dave",    "email": "dave@acme.com",   "role": "user",        "config": {}}
  ]
}
```

**Roles:**

| Role | Permissions | Who should use this |
|---|---|---|
| `admin` | Full access. Bypasses all permission checks. Can create/edit/delete levels, nodes, and any task. | Project leads, workspace owners |
| `super_user` | Can create/edit/delete children within nodes they are assigned to as SU. Can approve approval-required tasks. | Team leads, module owners |
| `user` | Can create/edit tasks at the Feature level (or whichever level is configured as `task_level`). Can comment. | Individual contributors |

**Important:** The `"id"` field is a logical identifier used in `permissions.config.json` and `hierarchy.config.json`. The actual database ID is auto-assigned sequentially (u1 → 1, u2 → 2, etc.). **The frontend authenticates via `X-User-Id` header** — to switch users, change the value in `localStorage`:

```javascript
// In browser dev console:
localStorage.setItem('board-games-user-id', '2'); // switch to Bob
// Then reload the page
```

**If missing or invalid:** The backend logs an error. API calls return `401 Unauthorized` with the message "Missing X-User-Id header" or "User not found" in the browser console. The sidebar will be empty.

---

### `config/permissions.config.json` — Required

Controls who can see and edit each hierarchy level.

```json
{
  "level_permissions": {
    "Project": {
      "view": ["admin", "super_user"],
      "edit": ["admin", "super_user"]
    },
    "Module": {
      "view": ["admin", "super_user", "user"],
      "edit": ["admin", "super_user"]
    },
    "Feature": {
      "view": ["admin", "super_user", "user"],
      "edit": ["admin", "super_user", "user"]
    }
  },
  "assignee_pools": {
    "Project": ["u1", "u2"],
    "Module":  ["u1", "u2", "u3"],
    "Feature": ["u1", "u2", "u3", "u4"]
  }
}
```

| Section | Description |
|---|---|
| `level_permissions` | Map of level name → permissions. `view` lists which roles can see nodes at this level. `edit` lists which roles can create/update/delete them. |
| `assignee_pools` | Map of level name → list of user IDs who can be assigned to tasks at that level. The task assignee dropdown only shows users from this pool. |

**Key rule:** If a user's role isn't listed in `view`, they won't even see that level in the sidebar. For example, a regular `user` can't see "Project" or "Module" nodes — only "Feature" nodes.

**If missing or invalid:** All API calls requiring permission checks return `403 Forbidden`. The sidebar will be empty or partially visible depending on which level permissions are broken.

---

### `config/stages.config.json` — Optional (has defaults)

Defines the default Kanban pipeline stages for new projects. Stages control the columns on the Kanban board.

```json
{
  "default_stages": [
    {"stage_name": "Backlog",     "sort_order": 0, "color_hex": "#6b7280"},
    {"stage_name": "Not Started", "sort_order": 1, "color_hex": "#9ca3af"},
    {"stage_name": "In Progress", "sort_order": 2, "color_hex": "#3b82f6"},
    {"stage_name": "In Review",   "sort_order": 3, "color_hex": "#f59e0b"},
    {"stage_name": "Delayed",     "sort_order": 4, "color_hex": "#ef4444"},
    {"stage_name": "Completed",   "sort_order": 5, "color_hex": "#10b981"}
  ]
}
```

| Field | Required | Description |
|---|---|---|
| `stage_name` | Yes | Label shown as the Kanban column header |
| `sort_order` | Yes | Column order left-to-right |
| `color_hex` | Yes | Hex color for the column header stripe |

**If missing:** The Kanban view won't render columns. You'll need to create stages via the API or frontend (once implemented).

---

### `config/providers.config.json` — Optional (for integration)

Configures external provider connections (GitHub, GitLab). Can be left disabled.

```json
{
  "providers": [
    {
      "provider": "github",
      "api_base_url": "https://api.github.com",
      "rate_limit_rph": 5000,
      "enabled": false
    },
    {
      "provider": "gitlab",
      "api_base_url": "https://gitlab.com/api/v4",
      "rate_limit_rph": 2000,
      "enabled": false
    }
  ]
}
```

**If missing or disabled:** Integration features are simply not available. The app works normally for local-only usage.

---

## Configuration Validation Rules

When the backend starts, it runs `seed.py` which reads all 5 config files. Here's what happens if things are wrong:

| Problem | Symptom | Resolution |
|---|---|---|
| Config file missing or invalid JSON | Backend logs a `JSONDecodeError`. Database is not seeded. | Fix the JSON syntax. Delete `_db/pmtool.db` and restart the backend. |
| `hierarchy.config.json` has no levels | No sidebar tree. Frontend shows "No projects yet" | Add at least one level to the `levels` array. Restart. |
| `users.config.json` has no users | All API calls return `401 Unauthorized` | Add at least one user with role `admin`. Restart. |
| `permissions.config.json` missing a level name | Users may get `403 Forbidden` when clicking that level | Add the missing level entry. Restart. |
| User ID not found in DB | API returns `401 Unauthorized`. Check `X-User-Id` header. | Use `localStorage.setItem('board-games-user-id', '1')` in the browser console to switch to the first user. |

### Reset the database

If you change the config files after the first run, you need to reset the database:

```bash
rm -f _db/pmtool.db   # Deletes all data
make dev-backend       # Re-creates and re-seeds on startup
```

⚠️ This deletes all tasks, comments, and cross-references too.

---

## First-Time User Walkthrough

After starting the backend and frontend, here's what you'll see:

### Step 1: The empty state

The sidebar shows a tree with your seeded hierarchy (e.g., "My Workspace → Default Project"). The main area shows: *"Select a project or task from the sidebar to get started."*

### Step 2: Create hierarchy nodes

Click on a node in the sidebar to see its task list (empty). The "New Task" button is visible. But first, you might want to create more structure:

- **Admin users:** Use the API to create more hierarchy nodes:
  ```bash
  curl -X POST http://localhost:8000/api/hierarchy/nodes \
    -H "Content-Type: application/json" \
    -H "X-User-Id: 1" \
    -d '{"name": "Sprint 1", "level_id": 3, "parent_node_id": 2}'
  ```
  (Find the correct `level_id` and `parent_node_id` by calling `GET /api/hierarchy/levels` and `GET /api/hierarchy/nodes`)

- **Frontend:** Currently, node creation is API-only. The sidebar shows the seeded structure.

### Step 3: Create your first task

1. Click a Feature-level node in the sidebar
2. Click **"New Task"** button
3. Fill in the title and click **"Create Task"**
4. The task appears in the list
5. Click it to open the detail view and edit all 11 fields

### Step 4: Try different views

Use the view switcher in the top bar:
- **Table** — Sortable, filterable task list (default)
- **Kanban** — Drag-and-drop columns (stages)
- **Gantt** — Timeline chart with dependency arrows
- **Graph** — Force-directed dependency graph
- **Charts** — Burndown, velocity, cumulative flow (requires task data)

---

## Switching Users (Development)

Since there's no login screen yet, you authenticate by setting your user ID:

```javascript
// In browser dev console (F12 → Console tab):
localStorage.setItem('board-games-user-id', '1'); // Alice (admin)
// or
localStorage.setItem('board-games-user-id', '2'); // Bob (super_user)
// or
localStorage.setItem('board-games-user-id', '3'); // Carol (user)

// Then reload the page
location.reload();
```

| ID | Name | Role | Sees |
|---|---|---|---|
| 1 | Alice | admin | Everything |
| 2 | Bob | super_user | His assigned nodes + tasks |
| 3 | Carol | user | Feature-level tasks assigned to her |

---

## Makefile Commands

| Command | Description |
|---|---|
| `make init` | Create `_db/` directory |
| `make install` | pip install from `requirements.txt` |
| `make seed` | Re-run the seed script (idempotent) |
| `make dev-backend` | Start FastAPI on `:8000` with hot reload |
| `make dev-frontend` | Start Vite on `:5173` with HMR |
| `make frontend-install` | npm install frontend deps |

---

## Troubleshooting

### "Can't connect to backend"
Make sure the backend is running on `:8000`. Check with:
```bash
curl http://localhost:8000/api/health
```

### "401 Unauthorized" in browser console
You need to set the user ID:
```javascript
localStorage.setItem('board-games-user-id', '1');
```

### "403 Forbidden" when clicking sidebar items
Your user role doesn't have permission for that level. Either:
- Switch to an admin user (`localStorage.setItem('board-games-user-id', '1')`)
- Or update `permissions.config.json` to include your role, then reset the DB

### "New Task" button does nothing
This was fixed — it should now open a modal. If not, clear your browser cache and reload.

### "No projects yet" in sidebar
The hierarchy either isn't seeded or all nodes are filtered by permissions. Check:
1. The backend console for JSON parse errors
2. `config/hierarchy.config.json` for valid JSON
3. `config/permissions.config.json` for matching level names

### WebSocket not connecting
Open the browser console (F12). You should see `[WS] Connecting...` logs. If not:
1. Verify the backend is running
2. Check the Vite proxy config in `frontend/vite.config.ts`
3. Try connecting directly: `wscat -c 'ws://localhost:8000/ws/updates?user_id=1'`

---

## Architecture Reference

For the full design documents, see:
- `architecture/design-docs/board-games-design.md` — System architecture, rationale, component tree
- `architecture/design-docs/board-games-db-mapping.md` — Complete database schema (14 tables)
- `architecture/design-docs/board-games-implementation-plan.md` — 21-task implementation plan
