"""Chart / visualisation routes."""

from typing import Any

from fastapi import APIRouter, Depends, Query

from backend.auth import get_current_user_dep
from backend.db import get_db

router = APIRouter(tags=["charts"])

# ── Recursive subtree CTE (shared across chart endpoints) ──────────

_SUBTREE_CTE = """
WITH RECURSIVE subtree AS (
    SELECT id FROM hierarchy_nodes WHERE id = ?
    UNION ALL
    SELECT n.id FROM hierarchy_nodes n
    JOIN subtree s ON n.parent_node_id = s.id
)
"""


# ⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐
#  Burndown chart
# ⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐


@router.get("/charts/burndown")
async def burndown_chart(
    scope: int,
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Return burndown chart data for all tasks under *scope*.

    Returns ``{labels: [dates], datasets: [{label, data}, ...]}``.
    """
    db = get_db()

    # Count total tasks under scope
    total_row = db.fetch_one(
        f"{_SUBTREE_CTE}"
        "SELECT COUNT(*) AS cnt FROM tasks "
        "WHERE parent_node_id IN (SELECT id FROM subtree)",
        (scope,),
    )
    total = total_row["cnt"] if total_row else 0

    if total == 0:
        return {"labels": [], "datasets": [
            {"label": "Expected", "data": []},
            {"label": "Actual", "data": []},
        ]}

    # Get the date range
    range_row = db.fetch_one(
        f"{_SUBTREE_CTE}"
        "SELECT MIN(date(created_at)) AS start_date, "
        "       MAX(date(COALESCE(updated_at, created_at))) AS end_date "
        "FROM tasks "
        "WHERE parent_node_id IN (SELECT id FROM subtree)",
        (scope,),
    )
    if range_row is None or range_row["start_date"] is None:
        return {"labels": [], "datasets": [
            {"label": "Expected", "data": []},
            {"label": "Actual", "data": []},
        ]}

    start_date = range_row["start_date"]
    end_date = range_row["end_date"]

    # Actual remaining per day: count tasks NOT complete on each date
    rows = db.fetch_all(
        f"{_SUBTREE_CTE}"
        "SELECT date(created_at) AS day, "
        "       SUM(CASE WHEN status != 'complete' THEN 1 ELSE 0 END) AS remaining "
        "FROM tasks "
        "WHERE parent_node_id IN (SELECT id FROM subtree) "
        "GROUP BY date(created_at) "
        "ORDER BY day",
        (scope,),
    )
    actual_map: dict[str, int] = {}
    for r in rows:
        actual_map[r["day"]] = r["remaining"]

    # Build date labels and data series
    from datetime import datetime, timedelta

    start = datetime.strptime(start_date, "%Y-%m-%d")
    end = datetime.strptime(end_date, "%Y-%m-%d")
    total_days = (end - start).days + 1

    labels: list[str] = []
    expected_data: list[int] = []
    actual_data: list[int] = []

    for offset in range(total_days):
        day = start + timedelta(days=offset)
        day_str = day.strftime("%Y-%m-%d")
        labels.append(day_str)

        # Expected: linear decline from total to 0
        expected = round(total * (1 - offset / max(total_days - 1, 1)))
        expected_data.append(expected)

        # Actual: use the last known value, or total if before first data point
        actual = actual_map.get(day_str, total)
        actual_data.append(actual)

    return {
        "labels": labels,
        "datasets": [
            {"label": "Expected", "data": expected_data},
            {"label": "Actual", "data": actual_data},
        ],
    }


# ⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐
#  Velocity chart
# ⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐


@router.get("/charts/velocity")
async def velocity_chart(
    scope: int,
    periods: int = Query(12, ge=1, le=52),
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Return velocity chart data for all tasks under *scope*.

    Groups completed tasks by ISO week.  Returns the last *periods*
    weeks.

    Returns ``{labels: [period names], datasets: [{label, data}]}``.
    """
    db = get_db()

    rows = db.fetch_all(
        f"{_SUBTREE_CTE}"
        "SELECT strftime('%Y-W%W', created_at) AS week, "
        "       COUNT(*) AS completed "
        "FROM tasks "
        "WHERE parent_node_id IN (SELECT id FROM subtree) "
        "  AND status = 'complete' "
        "GROUP BY week "
        "ORDER BY week DESC "
        "LIMIT ?",
        (scope, periods),
    )

    # Reverse so chart shows oldest -> newest left -> right
    rows.reverse()

    labels = [r["week"] for r in rows]
    data = [r["completed"] for r in rows]

    return {
        "labels": labels,
        "datasets": [
            {"label": "Completed", "data": data},
        ],
    }


# ⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐
#  Cumulative flow chart
# ⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐⹐


@router.get("/charts/cumulative-flow")
async def cumulative_flow_chart(
    scope: int,
    user: dict[str, Any] = Depends(get_current_user_dep),
):
    """Return cumulative flow chart data for all tasks under *scope*.

    Returns ``{labels: [dates], datasets: [{label: stage_name, data: [...]}, ...]}``
    with one dataset per stage, stacked.
    """
    db = get_db()

    # Find all distinct stages used by tasks under this scope
    stages = db.fetch_all(
        f"{_SUBTREE_CTE}"
        "SELECT DISTINCT ts.id, ts.stage_name, ts.sort_order, ts.color_hex "
        "FROM tasks t "
        "JOIN task_stages ts ON t.stage_id = ts.id "
        "WHERE t.parent_node_id IN (SELECT id FROM subtree) "
        "ORDER BY ts.sort_order",
        (scope,),
    )

    if not stages:
        return {"labels": [], "datasets": []}

    # Get date range for tasks under scope
    range_row = db.fetch_one(
        f"{_SUBTREE_CTE}"
        "SELECT MIN(date(created_at)) AS start_date, "
        "       MAX(date(COALESCE(updated_at, created_at))) AS end_date "
        "FROM tasks "
        "WHERE parent_node_id IN (SELECT id FROM subtree)",
        (scope,),
    )

    if range_row is None or range_row["start_date"] is None:
        return {"labels": [], "datasets": []}

    start_date = range_row["start_date"]
    end_date = range_row["end_date"]

    from datetime import datetime, timedelta

    start = datetime.strptime(start_date, "%Y-%m-%d")
    end = datetime.strptime(end_date, "%Y-%m-%d")
    total_days = (end - start).days + 1

    labels: list[str] = []
    stage_datasets: list[dict[str, Any]] = [
        {"label": s["stage_name"], "data": [0] * total_days}
        for s in stages
    ]

    for offset in range(total_days):
        day = start + timedelta(days=offset)
        day_str = day.strftime("%Y-%m-%d")
        labels.append(day_str)

        # Count tasks whose stage_id matches per stage on this date.
        # Simplified: uses date(created_at) <= day as proxy.
        for idx, stage in enumerate(stages):
            count_row = db.fetch_one(
                f"{_SUBTREE_CTE}"
                "SELECT COUNT(*) AS cnt FROM tasks "
                "WHERE parent_node_id IN (SELECT id FROM subtree) "
                "  AND stage_id = ? "
                "  AND date(created_at) <= ?",
                (scope, stage["id"], day_str),
            )
            stage_datasets[idx]["data"][offset] = count_row["cnt"] if count_row else 0

    return {
        "labels": labels,
        "datasets": stage_datasets,
    }
