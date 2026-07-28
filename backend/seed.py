"""Seed the database with initial config data and rich demo workspace.

Reads all 5 config files from board-games/config/ and populates the
database with a fully functional demo workspace including sample
projects, modules, features, tasks, tags, comments, and references.
"""

import json
import os
from datetime import datetime, timedelta

from backend.db import get_db

# ── Paths ──────────────────────────────────────

_CONFIG_DIR = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "config")
)

_CONFIG_FILES = {
    "hierarchy": os.path.join(_CONFIG_DIR, "hierarchy.config.json"),
    "users": os.path.join(_CONFIG_DIR, "users.config.json"),
    "permissions": os.path.join(_CONFIG_DIR, "permissions.config.json"),
    "stages": os.path.join(_CONFIG_DIR, "stages.config.json"),
    "providers": os.path.join(_CONFIG_DIR, "providers.config.json"),
    "tags": os.path.join(_CONFIG_DIR, "tag-library.config.json"),
}


def _load_config(name: str) -> dict:
    with open(_CONFIG_FILES[name], "r") as f:
        return json.load(f)


def _insert(db, table: str, data: dict) -> int:
    return db.insert(table, data)


def seed() -> None:
    db = get_db()

    now = datetime.now()
    today = now.strftime("%Y-%m-%d")

    # ═══════════════════════════════════════════
    #  1. Hierarchy levels (from config)
    # ═══════════════════════════════════════════
    hier = _load_config("hierarchy")
    level_map: dict[str, int] = {}
    for lvl in hier["levels"]:
        parent_id = level_map.get(lvl["parent"]) if lvl.get("parent") else None
        lid = _insert(db, "hierarchy_levels", {
            "name": lvl["name"],
            "parent_level_id": parent_id,
            "sort_order": lvl["sort_order"],
        })
        level_map[lvl["name"]] = lid

    proj_lid = level_map["Project"]
    mod_lid = level_map["Module"]
    feat_lid = level_map["Feature"]

    # ═══════════════════════════════════════════
    #  2. Users (from config)
    # ═══════════════════════════════════════════
    users_data = _load_config("users")
    user_ids: dict[str, int] = {}
    for u in users_data["users"]:
        uid = _insert(db, "users", {
            "name": u["name"],
            "email": u.get("email"),
            "role": u.get("role", "user"),
            "config": json.dumps(u.get("config", {})),
        })
        user_ids[u["id"]] = uid

    alice_id = user_ids["u1"]
    bob_id = user_ids["u2"]
    carol_id = user_ids["u3"]

    # ═══════════════════════════════════════════
    #  3. Access control (from config)
    # ═══════════════════════════════════════════
    perms = _load_config("permissions")
    _PERM_MAP = {"view": "read", "edit": "write", "admin": "admin"}
    for level_name, roles in perms.get("level_permissions", {}).items():
        lid = level_map.get(level_name)
        if lid is None:
            continue
        for perm_role, roles_list in roles.items():
            db_perm = _PERM_MAP.get(perm_role)
            if db_perm is None:
                continue
            for role_name in roles_list:
                for u in users_data["users"]:
                    if u["role"] == role_name:
                        _insert(db, "access_control", {
                            "user_id": user_ids[u["id"]],
                            "resource_type": "level",
                            "resource_id": lid,
                            "permission": db_perm,
                        })

    # ═══════════════════════════════════════════
    #  4. Hierarchy nodes — Projects
    # ═══════════════════════════════════════════
    # Create two projects
    proj1_id = _insert(db, "hierarchy_nodes", {
        "level_id": proj_lid, "parent_node_id": None,
        "name": "Website Redesign", "description": "Complete overhaul of the company website",
        "super_user_id": bob_id,
    })
    proj2_id = _insert(db, "hierarchy_nodes", {
        "level_id": proj_lid, "parent_node_id": None,
        "name": "Mobile App v2", "description": "Next version of the mobile application",
        "super_user_id": bob_id,
    })

    # ═══════════════════════════════════════════
    #  5. Task stages (per project)
    # ═══════════════════════════════════════════
    stages_data = _load_config("stages")
    stage_ids: dict[str, dict[int, int]] = {}  # project_id -> {stage_name -> id}
    for pid in (proj1_id, proj2_id):
        stage_ids[pid] = {}
        for stg in stages_data["default_stages"]:
            sid = _insert(db, "task_stages", {
                "project_id": pid,
                "stage_name": stg["stage_name"],
                "sort_order": stg["sort_order"],
                "color_hex": stg["color_hex"],
            })
            stage_ids[pid][stg["stage_name"]] = sid

    s1 = stage_ids[proj1_id]

    # ═══════════════════════════════════════════
    #  6. Modules under each project
    # ═══════════════════════════════════════════
    mod_ids: dict[str, int] = {}

    # Website Redesign modules
    mod_ids["frontend"] = _insert(db, "hierarchy_nodes", {
        "level_id": mod_lid, "parent_node_id": proj1_id,
        "name": "Frontend", "description": "Frontend components and pages",
        "super_user_id": alice_id,
    })
    mod_ids["backend"] = _insert(db, "hierarchy_nodes", {
        "level_id": mod_lid, "parent_node_id": proj1_id,
        "name": "Backend API", "description": "API endpoints and business logic",
        "super_user_id": alice_id,
    })
    mod_ids["design"] = _insert(db, "hierarchy_nodes", {
        "level_id": mod_lid, "parent_node_id": proj1_id,
        "name": "Design System", "description": "UI components, styles, and branding",
        "super_user_id": bob_id,
    })

    # Mobile App modules
    mod_ids["auth"] = _insert(db, "hierarchy_nodes", {
        "level_id": mod_lid, "parent_node_id": proj2_id,
        "name": "Authentication", "description": "Login, signup, OAuth flows",
        "super_user_id": bob_id,
    })
    mod_ids["payments"] = _insert(db, "hierarchy_nodes", {
        "level_id": mod_lid, "parent_node_id": proj2_id,
        "name": "Payments", "description": "In-app purchases and subscriptions",
        "super_user_id": alice_id,
    })

    # ═══════════════════════════════════════════
    #  7. Features under each module
    # ═══════════════════════════════════════════
    feat_ids: dict[str, int] = {}

    # Frontend features
    feat_ids["homepage"] = _insert(db, "hierarchy_nodes", {
        "level_id": feat_lid, "parent_node_id": mod_ids["frontend"],
        "name": "Homepage", "description": "Landing page redesign",
    })
    feat_ids["nav"] = _insert(db, "hierarchy_nodes", {
        "level_id": feat_lid, "parent_node_id": mod_ids["frontend"],
        "name": "Navigation", "description": "Header, footer, mobile menu",
    })
    feat_ids["search"] = _insert(db, "hierarchy_nodes", {
        "level_id": feat_lid, "parent_node_id": mod_ids["frontend"],
        "name": "Search", "description": "Full-text search with filters",
    })

    # Backend features
    feat_ids["api_auth"] = _insert(db, "hierarchy_nodes", {
        "level_id": feat_lid, "parent_node_id": mod_ids["backend"],
        "name": "Auth API", "description": "Login/register endpoints",
    })
    feat_ids["cms_api"] = _insert(db, "hierarchy_nodes", {
        "level_id": feat_lid, "parent_node_id": mod_ids["backend"],
        "name": "CMS API", "description": "Content management endpoints",
    })

    # Design features
    feat_ids["colors"] = _insert(db, "hierarchy_nodes", {
        "level_id": feat_lid, "parent_node_id": mod_ids["design"],
        "name": "Color Palette", "description": "Brand colors and tokens",
    })
    feat_ids["components"] = _insert(db, "hierarchy_nodes", {
        "level_id": feat_lid, "parent_node_id": mod_ids["design"],
        "name": "UI Components", "description": "Button, card, modal, form components",
    })

    # Auth module features
    feat_ids["login"] = _insert(db, "hierarchy_nodes", {
        "level_id": feat_lid, "parent_node_id": mod_ids["auth"],
        "name": "Login Screen", "description": "Email/password and SSO login",
    })
    feat_ids["biometric"] = _insert(db, "hierarchy_nodes", {
        "level_id": feat_lid, "parent_node_id": mod_ids["auth"],
        "name": "Biometric Auth", "description": "Face ID and fingerprint support",
    })

    # Payments features
    feat_ids["checkout"] = _insert(db, "hierarchy_nodes", {
        "level_id": feat_lid, "parent_node_id": mod_ids["payments"],
        "name": "Checkout Flow", "description": "Purchase and payment confirmation",
    })
    feat_ids["subscriptions"] = _insert(db, "hierarchy_nodes", {
        "level_id": feat_lid, "parent_node_id": mod_ids["payments"],
        "name": "Subscriptions", "description": "Monthly/yearly subscription management",
    })

    # ═══════════════════════════════════════════
    #  8. Demo tasks
    # ═══════════════════════════════════════════
    last_week = (now - timedelta(days=7)).strftime("%Y-%m-%d")
    two_weeks = (now - timedelta(days=14)).strftime("%Y-%m-%d")
    three_weeks = (now - timedelta(days=21)).strftime("%Y-%m-%d")
    month_ago = (now - timedelta(days=30)).strftime("%Y-%m-%d")
    next_week = (now + timedelta(days=7)).strftime("%Y-%m-%d")
    two_weeks_fwd = (now + timedelta(days=14)).strftime("%Y-%m-%d")
    next_month = (now + timedelta(days=30)).strftime("%Y-%m-%d")
    two_months = (now + timedelta(days=60)).strftime("%Y-%m-%d")
    yesterday = (now - timedelta(days=1)).strftime("%Y-%m-%d")
    tomorrow = (now + timedelta(days=1)).strftime("%Y-%m-%d")

    tasks_data = [
        # (title, desc, status, priority, start, end, deadline, feature_key, assignee, stage_name, task_type)

        # ── Website Redesign / Frontend / Homepage ──
        ("Redesign hero section", "Create new hero with animated background and CTA", "in_progress", "high", last_week, next_week, next_week, "homepage", alice_id, "In Progress", "open_closure"),
        ("Implement testimonial carousel", "Customer testimonials with auto-rotation", "not_done", "medium", next_week, two_weeks_fwd, two_weeks_fwd, "homepage", carol_id, "Not Started", "open_closure"),
        ("Build footer with sitemap", "Multi-column footer with links and social icons", "not_done", "low", two_weeks_fwd, next_month, None, "homepage", None, "Backlog", "open_closure"),
        ("Fix hero mobile rendering", "Hero background breaks on Safari iOS", "in_progress", "high", yesterday, tomorrow, tomorrow, "homepage", carol_id, "Delayed", "open_closure"),

        # ── Website Redesign / Frontend / Navigation ──
        ("Build responsive nav bar", "Collapsible menu with dropdowns for mobile", "not_done", "medium", None, next_month, next_month, "nav", carol_id, "Not Started", "open_closure"),
        ("Add dark mode to nav", "Nav component dark variant with theme toggle", "not_done", "low", None, next_month, None, "nav", None, "Backlog", "open_closure"),
        ("Implement breadcrumb trail", "Auto-generated breadcrumb for deep pages", "not_done", "low", None, two_months, None, "nav", None, "Planning", "open_closure"),

        # ── Website Redesign / Frontend / Search ──
        ("Implement search autocomplete", "Debounced search with suggestions dropdown", "not_done", "low", None, next_month, None, "search", carol_id, "Backlog", "open_closure"),
        ("Build search results page", "Paginated results with facet filters", "not_done", "medium", next_month, two_months, two_months, "search", bob_id, "Planning", "open_closure"),
        ("Index all pages for search", "Background indexing job for all content", "not_done", "medium", None, two_months, None, "search", bob_id, "Planning", "open_closure"),
        ("Optimize search SQL queries", "Add FTS5 and proper indexing for search", "not_done", "medium", None, next_month, None, "search", bob_id, "Planning", "open_closure"),

        # ── Website Redesign / Backend / Auth API ──
        ("Build login API endpoint", "POST /api/auth/login with JWT tokens", "complete", "critical", month_ago, two_weeks, two_weeks, "api_auth", alice_id, "Completed", "open_closure"),
        ("Build register API endpoint", "POST /api/auth/register with email verification", "in_progress", "high", two_weeks, next_week, next_week, "api_auth", bob_id, "In Progress", "approval_required"),
        ("Add OAuth2 provider support", "Google and GitHub OAuth login flows", "not_done", "high", next_week, next_month, next_month, "api_auth", bob_id, "Not Started", "open_closure"),
        ("Implement JWT refresh tokens", "Refresh token rotation with blacklist", "not_done", "medium", next_month, two_months, None, "api_auth", alice_id, "Planning", "open_closure"),

        # ── Website Redesign / Backend / CMS API ──
        ("Create CMS CRUD endpoints", "GET/POST/PUT/DELETE for pages and articles", "not_done", "medium", None, next_month, next_month, "cms_api", bob_id, "Not Started", "open_closure"),
        ("Build CMS media upload", "Image/file upload with thumbnail generation", "not_done", "low", next_month, two_months, None, "cms_api", carol_id, "Backlog", "open_closure"),
        ("Add CMS version history", "Track page revisions with diff view", "not_done", "low", None, two_months, None, "cms_api", bob_id, "Backlog", "open_closure"),

        # ── Website Redesign / Design / Colors ──
        ("Define brand color tokens", "Primary, secondary, accent, neutral palette", "complete", "medium", month_ago, two_weeks, two_weeks, "colors", alice_id, "Completed", "open_closure"),
        ("Create typography scale", "Type ramp from caption to display sizes", "complete", "medium", three_weeks, last_week, last_week, "colors", alice_id, "Completed", "open_closure"),
        ("Build spacing system", "4px-grid-based spacing tokens for all components", "in_progress", "medium", last_week, next_week, next_week, "colors", alice_id, "In Review", "open_closure"),

        # ── Website Redesign / Design / Components ──
        ("Build Button component", "Primary, secondary, outline, ghost variants", "in_progress", "high", last_week, next_week, next_week, "components", carol_id, "In Review", "open_closure"),
        ("Build Card component", "Image card, text card, interactive card", "not_done", "medium", next_week, two_weeks_fwd, two_weeks_fwd, "components", carol_id, "Not Started", "open_closure"),
        ("Build Modal component", "Accessible modal with focus trap and animations", "not_done", "medium", two_weeks_fwd, next_month, None, "components", carol_id, "Planning", "open_closure"),
        ("Build Form input components", "Text input, select, checkbox, radio, datepicker", "not_done", "high", next_month, two_months, two_months, "components", bob_id, "Planning", "open_closure"),

        # ── Mobile App / Auth / Login ──
        ("Build login screen UI", "Email/password form with validation", "not_done", "critical", None, next_month, today, "login", bob_id, "In Progress", "open_closure"),
        ("Build signup screen UI", "Registration form with terms acceptance", "not_done", "high", next_week, next_month, next_month, "login", carol_id, "Not Started", "open_closure"),
        ("Add password reset flow", "Forgot password screen with email link", "not_done", "medium", next_month, two_months, None, "login", carol_id, "Backlog", "open_closure"),

        # ── Mobile App / Auth / Biometric ──
        ("Implement Face ID auth", "Biometric authentication for iOS/Android", "not_done", "high", None, next_month, None, "biometric", carol_id, "Backlog", "open_closure"),
        ("Build fingerprint login", "Touch ID / fingerprint sensor support", "not_done", "medium", None, two_months, None, "biometric", None, "Backlog", "open_closure"),
        ("Add biometric enrollment UI", "Onboarding screen to enroll biometrics", "not_done", "low", None, two_months, None, "biometric", None, "Backlog", "open_closure"),

        # ── Mobile App / Payments / Checkout ──
        ("Build checkout flow UI", "Multi-step purchase flow with payment form", "in_progress", "critical", last_week, next_week, yesterday, "checkout", alice_id, "Delayed", "approval_required"),
        ("Integrate Stripe payment", "Stripe SDK integration for card payments", "not_done", "critical", next_week, next_month, next_month, "checkout", bob_id, "Not Started", "open_closure"),
        ("Add Apple Pay support", "Apple Pay button and payment sheet", "not_done", "high", next_month, two_months, None, "checkout", bob_id, "Planning", "open_closure"),
        ("Build order confirmation screen", "Order summary with receipt download", "not_done", "medium", next_month, two_months, None, "checkout", carol_id, "Backlog", "open_closure"),

        # ── Mobile App / Payments / Subscriptions ──
        ("Subscription management screen", "View, upgrade, cancel subscription plans", "not_done", "medium", None, next_month, next_month, "subscriptions", carol_id, "Planning", "open_closure"),
        ("Build plan comparison table", "Feature comparison across pricing tiers", "not_done", "medium", next_month, two_months, None, "subscriptions", carol_id, "Planning", "open_closure"),
        ("Implement recurring billing", "Monthly/yearly auto-renewal logic", "not_done", "high", next_week, next_month, next_month, "subscriptions", bob_id, "Not Started", "open_closure"),
    ]

    task_ids: list[int] = []
    for title, desc, status, priority, start, end, deadline, feat_key, assignee, stage_name, task_type in tasks_data:
        feat_id = feat_ids.get(feat_key)
        if feat_id is None:
            continue
        stage_id = s1.get(stage_name)
        tid = _insert(db, "tasks", {
            "title": title,
            "description": desc,
            "status": status,
            "priority": priority,
            "start_date": start,
            "end_date": end,
            "deadline": deadline,
            "parent_node_id": feat_id,
            "assignee_id": assignee,
            "task_type": task_type,
            "stage_id": stage_id,
            "creator_id": alice_id,
        })
        task_ids.append(tid)

    # ═══════════════════════════════════════════
    #  9. Tags on tasks (using tag library for colors)
    # ═══════════════════════════════════════════
    tag_library = _load_config("tags")["tags"]
    tag_color_map = {t["name"]: t["color_hex"] for t in tag_library}

    def tag_color(name: str) -> str:
        return tag_color_map.get(name, "#6366f1")

    tag_data = [
        (task_ids[0], "frontend"),
        (task_ids[0], "animation"),
        (task_ids[1], "frontend"),
        (task_ids[3], "bug"),
        (task_ids[3], "mobile"),
        (task_ids[4], "frontend"),
        (task_ids[8], "search"),
        (task_ids[11], "search"),
        (task_ids[12], "backend"),
        (task_ids[13], "backend"),
        (task_ids[13], "auth"),
        (task_ids[14], "backend"),
        (task_ids[15], "backend"),
        (task_ids[16], "backend"),
        (task_ids[17], "backend"),
        (task_ids[18], "design"),
        (task_ids[19], "design"),
        (task_ids[20], "design"),
        (task_ids[21], "design"),
        (task_ids[21], "frontend"),
        (task_ids[22], "design"),
        (task_ids[23], "design"),
        (task_ids[24], "frontend"),
        (task_ids[25], "mobile"),
        (task_ids[26], "mobile"),
        (task_ids[27], "mobile"),
        (task_ids[28], "mobile"),
        (task_ids[28], "security"),
        (task_ids[29], "mobile"),
        (task_ids[31], "mobile"),
        (task_ids[32], "blocker"),
        (task_ids[32], "payment"),
        (task_ids[33], "payment"),
        (task_ids[33], "mobile"),
        (task_ids[34], "payment"),
        (task_ids[35], "payment"),
        (task_ids[36], "payment"),
        (task_ids[36], "mobile"),
    ]
    for tid, tag_name in tag_data:
        _insert(db, "task_tags", {"task_id": tid, "tag_name": tag_name, "color_hex": tag_color(tag_name)})

    # ═══════════════════════════════════════════
    #  10. Cross-references between tasks
    # ═══════════════════════════════════════════
    refs = [
        # Hero redesign (last_week→next_week) blocks testimonial (next_week→two_weeks_fwd)
        (0, 1, "blocks", "Nav must match hero style"),
        (1, 0, "blocked_by", ""),

        # Search: results page (next_month→two_months) blocks index (None→two_months)
        (8, 9, "blocks", "Results page API needed before indexing"),
        (9, 8, "blocked_by", ""),
        # Login API (month_ago→two_weeks) blocks search results (next_month→two_months)
        (11, 8, "blocks", "Login needed for search admin panel"),
        (8, 11, "blocked_by", ""),

        # Auth: login (month_ago→two_weeks) → register (two_weeks→next_week) → OAuth2 (next_week→next_month)
        (11, 12, "blocks", "Login before register"),
        (12, 11, "blocked_by", ""),
        (12, 13, "blocks", "Register before OAuth2"),
        (13, 12, "blocked_by", ""),

        # Design: colors (month_ago→two_weeks) → typography (three_weeks→last_week) → spacing (last_week→next_week)
        (18, 19, "blocks", "Colors before typography"),
        (19, 18, "blocked_by", ""),
        (19, 20, "blocks", "Typography before spacing"),
        (20, 19, "blocked_by", ""),
        # Spacing (last_week→next_week) → Button (last_week→next_week)
        (20, 21, "blocks", "Tokens before components"),
        (21, 20, "blocked_by", ""),
        # Button (last_week→next_week) → Card (next_week→two_weeks_fwd)
        (21, 22, "blocks", "Button before Card"),
        (22, 21, "blocked_by", ""),

        # Mobile: login screen (None→next_month) before signup (next_week→next_month)
        (25, 26, "blocks", "Login before signup"),
        (26, 25, "blocked_by", ""),

        # Payment: checkout (last_week→next_week) → Stripe (next_week→next_month) → Apple Pay (next_month→two_months)
        (31, 32, "blocks", "Checkout flow before Stripe integration"),
        (32, 31, "blocked_by", ""),
        (32, 33, "blocks", "Stripe before Apple Pay"),
        (33, 32, "blocked_by", ""),
        # Subscriptions (None→next_month) and recurring billing (next_week→next_month) - same timeframe
        (37, 35, "related_to", "Billing and subscriptions are related"),
        (35, 37, "related_to", ""),
    ]
    for src_idx, tgt_idx, rtype, note in refs:
        if src_idx < len(task_ids) and tgt_idx < len(task_ids):
            _insert(db, "cross_references", {
                "source_task_id": task_ids[src_idx],
                "target_task_id": task_ids[tgt_idx],
                "ref_type": rtype,
                "note": note,
            })

    # ═══════════════════════════════════════════
    #  11. Comments
    # ═══════════════════════════════════════════
    comments_data = [
        (task_ids[0], alice_id, "I've started working on the hero animation. Need feedback on the color scheme."),
        (task_ids[0], bob_id, "Looks good! Let's use the new brand colors from the design system."),
        (task_ids[12], alice_id, "Email verification needs to be tested with different providers."),
        (task_ids[21], bob_id, "Add loading state and disabled variant too."),
        (task_ids[31], alice_id, "The checkout flow is blocked pending payment gateway approval from the finance team."),
        (task_ids[15], alice_id, "CMS API endpoints should follow RESTful conventions."),
        (task_ids[25], bob_id, "Login screen needs to handle offline state gracefully."),
        (task_ids[32], bob_id, "Stripe integration requires a merchant account."),
    ]
    for tid, uid, body in comments_data:
        _insert(db, "comments", {"task_id": tid, "user_id": uid, "body": body})

    # ═══════════════════════════════════════════
    #  12. Provider configs (from config)
    # ═══════════════════════════════════════════
    providers_data = _load_config("providers")
    for prov in providers_data["providers"]:
        _insert(db, "provider_configs", {
            "provider": prov["provider"],
            "api_base_url": prov["api_base_url"],
            "rate_limit_rph": prov.get("rate_limit_rph", 5000),
            "enabled": 1 if prov.get("enabled", True) else 0,
        })

    print("✅ Demo workspace seeded with:")
    print(f"   - {len(level_map)} hierarchy levels")
    print(f"   - {len(feat_ids) + len(mod_ids) + 2} hierarchy nodes (2 projects, {len(mod_ids)} modules, {len(feat_ids)} features)")
    print(f"   - {len(task_ids)} tasks")
    print(f"   - {len(tag_data)} tags")
    print(f"   - {len(refs)} cross-references")
    print(f"   - {len(comments_data)} comments")


if __name__ == "__main__":
    seed()
