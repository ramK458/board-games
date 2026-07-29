import { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { useTabStore } from '../../stores/tabStore';
import { useUiStore } from '../../stores/uiStore';
import { taskApi, referenceApi } from '../../api/client';
import type { Task, CrossReference } from '../../types';

interface Props { nodeId: number }

const ROW_HEIGHT = 64;
const LABEL_WIDTH = 200;
const HEADER_HEIGHT = 40;
const MIN_DAY_WIDTH = 12;
const MAX_DAY_WIDTH = 80;

const statusBarColors: Record<string, string> = {
  not_done: '#9ca3af',
  in_progress: '#3b82f6',
  complete: '#22c55e',
};

export default function GanttView({ nodeId }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const openTab = useTabStore(s => s.openTab);
  const filterUserId = useUiStore(s => s.filterUserId);

  // Cached arrow paths — computed once, reused on every scroll
  const [arrowCache, setArrowCache] = useState<{ path: string; color: string; markerId: string }[]>([]);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [refs, setRefs] = useState<CrossReference[]>([]);
  const [loading, setLoading] = useState(true);
  const [dayWidth, setDayWidth] = useState(24);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerWidth, setContainerWidth] = useState(800);
  const [viewRange, setViewRange] = useState<{ min: Date; max: Date } | null>(null);

  // ResizeObserver — triggers re-render on container resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fetch tasks: use recursive scope to find tasks under any descendant node
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load() {
      try {
        const params: Record<string, string | number> = { scope: nodeId, sort: 'start_date:asc', per_page: 100 };
        if (filterUserId) params.assignee_id = filterUserId;
        const res = await taskApi.list(params);

        // Only keep tasks with at least one date
        const dated = res.items.filter(t => t.start_date || t.end_date);

        // Fetch references for all tasks — deduplicate by id to avoid
        // collecting the same ref both as outgoing (from source task) and
        // incoming (to target task) when iterating over every task.
        const allRefsMap = new Map<number, CrossReference>();
        await Promise.allSettled(
          dated.map(t =>
            referenceApi.list(t.id).then(r => r.forEach(ref => allRefsMap.set(ref.id, ref))).catch(() => {})
          )
        );
        const allRefs = Array.from(allRefsMap.values());

        if (!cancelled) {
          setTasks(dated);
          setRefs(allRefs);
        }
      } catch { /* ignore */ }
      if (!cancelled) setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [nodeId, filterUserId]);

  // Sort tasks by start_date ascending (earliest first) — industry standard
  const displayTasks = useMemo(() => {
    return [...tasks].sort((a, b) => {
      if (!a.start_date) return 1;
      if (!b.start_date) return -1;
      return a.start_date.localeCompare(b.start_date);
    });
  }, [tasks]);

  // Compute visible window (virtual scroll)
  const { visibleTasks, totalHeight, startIdx } = useMemo(() => {
    const viewportH = containerRef.current?.clientHeight || 600;
    const headerH = 40 + HEADER_HEIGHT;
    const rowH = ROW_HEIGHT;
    const total = displayTasks.length * rowH + headerH;
    const startIdx = Math.max(0, Math.floor((scrollTop - headerH) / rowH));
    const endIdx = Math.min(displayTasks.length, startIdx + Math.ceil((viewportH - headerH) / rowH) + 1);
    return {
      visibleTasks: displayTasks.slice(startIdx, endIdx),
      totalHeight: total,
      startIdx,
    };
  }, [displayTasks, scrollTop]);

  // Compute date domain: use viewRange if set, else compute from task dates
  const { xScale, dateRange } = useMemo(() => {
    if (displayTasks.length === 0) return { xScale: null, dateRange: { min: new Date(), max: new Date() } };

    let min: Date;
    let max: Date;

    if (viewRange) {
      min = viewRange.min;
      max = viewRange.max;
    } else {
      const allDates: Date[] = [];
      displayTasks.forEach(t => {
        if (t.start_date) { const d = new Date(t.start_date); if (!isNaN(+d)) allDates.push(d); }
        if (t.end_date) { const d = new Date(t.end_date); if (!isNaN(+d)) allDates.push(d); }
        if (t.deadline) { const d = new Date(t.deadline); if (!isNaN(+d)) allDates.push(d); }
      });
      min = allDates.length > 0 ? (d3.min(allDates) || new Date()) : new Date();
      max = allDates.length > 0 ? (d3.max(allDates) || d3.timeDay.offset(new Date(), 14)) : d3.timeDay.offset(new Date(), 14);
      min = d3.timeDay.offset(min, -3);
      max = d3.timeDay.offset(max, 7);
    }

    const msPerDay = 86400000;
    const minT = min.getTime();
    const maxT = max.getTime();
    if (isNaN(minT) || isNaN(maxT)) {
      const fallback = new Date();
      return { xScale: d3.scaleTime().domain([fallback, d3.timeDay.offset(fallback, 14)]).range([0, 800]), dateRange: { min: fallback, max: d3.timeDay.offset(fallback, 14) } };
    }
    const totalDays = Math.ceil((maxT - minT) / msPerDay);
    const totalPixels = totalDays * dayWidth;

    const scale = d3.scaleTime()
      .domain([min, max])
      .range([0, totalPixels]);

    return { xScale: scale, dateRange: { min, max } };
  }, [displayTasks, dayWidth, viewRange]);

  // Total pixel width of the timeline
  const timelineWidth = useMemo(() => {
    if (!dateRange || displayTasks.length === 0) return 800;
    const minT = dateRange.min.getTime();
    const maxT = dateRange.max.getTime();
    if (isNaN(minT) || isNaN(maxT)) return 800;
    const days = Math.ceil((maxT - minT) / 86400000);
    return Math.max(days * dayWidth, 400);
  }, [displayTasks, dayWidth, dateRange, viewRange]);

  // Render D3 timeline only (labels are rendered in HTML left panel)
  useEffect(() => {
    if (!svgRef.current || !xScale || displayTasks.length === 0) return;

    const chartWidth = timelineWidth;
    const chartHeight = totalHeight;

    const svgEl = svgRef.current;
    d3.select(svgEl).selectAll('*').remove();

    const safeW = isNaN(chartWidth) ? 800 : chartWidth;
    const safeH = isNaN(chartHeight) ? 600 : chartHeight;
    const svg = d3.select(svgEl)
      .attr('width', safeW)
      .attr('height', safeH);

    const headerH = HEADER_HEIGHT;
    const today = new Date();

    // Timeline grid group
    const gridG = svg.append('g');

    // Month/Week columns
    const ticks = dayWidth < 20
      ? d3.timeMonth.every(1)
      : dayWidth < 40
        ? d3.timeWeek.every(1)
        : d3.timeDay.every(1);

    if (ticks) {
      const tickValues = ticks.range(dateRange.min, dateRange.max);

      // Header
      gridG.append('g')
        .selectAll('rect')
        .data(tickValues)
        .join('rect')
        .attr('x', d => xScale(d))
        .attr('y', 0)
        .attr('width', (d: Date, i, arr) => {
          const next: Date = arr[i + 1] ? (arr[i + 1] as unknown as Date) : dateRange.max;
          const w = xScale(next) - xScale(d);
          return Math.max(0, isNaN(w) ? 0 : w);
        })
        .attr('height', headerH)
        .attr('fill', (d, i) => i % 2 === 0 ? '#f3f4f6' : '#e5e7eb')
        .attr('class', 'dark:fill-gray-800');

      // Header labels
      gridG.append('g')
        .selectAll('text')
        .data(tickValues)
        .join('text')
        .text(d => dayWidth < 20
          ? d3.timeFormat('%b %Y')(d)
          : dayWidth < 40
            ? d3.timeFormat('%b %d')(d)
            : d3.timeFormat('%d')(d))
        .attr('x', d => xScale(d) + 4)
        .attr('y', headerH / 2 + 4)
        .attr('font-size', 10).attr('fill', '#6b7280');

      // Vertical grid lines
      gridG.append('g')
        .selectAll('line')
        .data(tickValues)
        .join('line')
        .attr('x1', d => xScale(d)).attr('x2', d => xScale(d))
        .attr('y1', headerH).attr('y2', totalHeight)
        .attr('stroke', '#e5e7eb').attr('stroke-width', 0.5)
        .attr('class', 'dark:stroke-gray-700');
    }

    // Weekend shading
    let d = new Date(dateRange.min);
    while (d < dateRange.max) {
      const dow = d.getDay();
      if (dow === 0 || dow === 6) {
        const x0 = xScale(d);
        const x1 = xScale(d3.timeDay.offset(d, 1));
        if (!isNaN(x0) && !isNaN(x1)) {
          gridG.append('rect')
            .attr('x', x0).attr('y', headerH)
            .attr('width', x1 - x0).attr('height', totalHeight - headerH)
            .attr('fill', '#f9fafb').attr('opacity', 0.5)
            .attr('class', 'dark:fill-gray-800');
        }
      }
      d = d3.timeDay.offset(d, 1);
    }

    // Today line
    if (today >= dateRange.min && today <= dateRange.max) {
      const tx = xScale(today);
      gridG.append('line')
        .attr('x1', tx).attr('x2', tx)
        .attr('y1', headerH).attr('y2', totalHeight)
        .attr('stroke', '#ef4444').attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '6,3');
    }

    // ── Task bars ──
    visibleTasks.forEach((task, i) => {
      const y = headerH + (startIdx + i) * ROW_HEIGHT;
      const barH = ROW_HEIGHT * 0.3;  // bar height = 30% of row height
      const barY = y + (ROW_HEIGHT - barH) / 2;  // vertically centred
      const barColor = statusBarColors[task.status] || '#9ca3af';

      if (task.start_date) {
        const xStart = xScale(new Date(task.start_date));
        const xEnd = task.end_date ? xScale(new Date(task.end_date)) : xStart;
        const xDeadline = task.deadline ? xScale(new Date(task.deadline)) : xEnd;

        // Guard against NaN from invalid date strings
        if (isNaN(xStart) || isNaN(xEnd) || isNaN(xDeadline)) return;

        const fillW = Math.max(4, xEnd - xStart);
        const outlineW = Math.max(fillW, xDeadline - xStart);

        // Fill rect — runs from start to end (coloured)
        gridG.append('rect')
          .attr('x', xStart).attr('y', barY)
          .attr('width', fillW).attr('height', barH)
          .attr('rx', 4).attr('ry', 4)
          .attr('fill', barColor)
          .attr('stroke', 'red')
          .attr('stroke-width', 1)
          .attr('opacity', 0.85)
          .attr('cursor', 'pointer')
          .on('click', () => openTab({ id: `task-${task.id}`, type: 'task', title: task.title, taskId: task.id }));

        // Deadline extension — dashed outline from end → deadline (drawn on top)
        if (outlineW > fillW + 2) {
          const extX = xEnd;  // starts where fill ends
          const extW = outlineW - fillW;
          gridG.append('rect')
            .attr('x', extX).attr('y', barY)
            .attr('width', extW).attr('height', barH)
            .attr('rx', 0).attr('ry', 0)
            .attr('fill', 'none')
            .attr('stroke', barColor)
            .attr('stroke-width', 1.5)
            .attr('stroke-dasharray', '5,3')
            .attr('opacity', 0.5)
            .attr('pointer-events', 'none');
          // Right-end cap
          gridG.append('rect')
            .attr('x', xStart + outlineW - 4).attr('y', barY)
            .attr('width', 4).attr('height', barH)
            .attr('rx', 0).attr('ry', 4)
            .attr('fill', 'none')
            .attr('stroke', barColor)
            .attr('stroke-width', 1.5)
            .attr('opacity', 0.5)
            .attr('pointer-events', 'none');
        }

        // Title inside the filled portion (if wide enough)
        if (fillW > 40 && !isNaN(fillW)) {
          gridG.append('text')
            .text(task.title.length > Math.floor(fillW / 7) ? '' : task.title)
            .attr('x', xStart + 4).attr('y', barY + barH / 2 + 4)
            .attr('font-size', 10).attr('fill', '#fff');
        }
      } else if (task.end_date) {
        // No start date — draw a short bar marker at end_date (consistent with normal bars)
        const ex = xScale(new Date(task.end_date));
        if (isNaN(ex)) return;
        const barW = 8;
        gridG.append('rect')
          .attr('x', ex).attr('y', barY)
          .attr('width', barW).attr('height', barH)
          .attr('rx', 2).attr('ry', 2)
          .attr('fill', barColor).attr('opacity', 0.85)
          .attr('cursor', 'pointer')
          .on('click', () => openTab({ id: `task-${task.id}`, type: 'task', title: task.title, taskId: task.id }));
      } else if (task.deadline) {
        // Only deadline — draw a short amber bar marker at deadline
        const dx = xScale(new Date(task.deadline));
        if (isNaN(dx)) return;
        const barW = 8;
        gridG.append('rect')
          .attr('x', dx).attr('y', barY)
          .attr('width', barW).attr('height', barH)
          .attr('rx', 2).attr('ry', 2)
          .attr('fill', '#f59e0b').attr('opacity', 0.85)
          .attr('cursor', 'pointer')
          .on('click', () => openTab({ id: `task-${task.id}`, type: 'task', title: task.title, taskId: task.id }));
      }
    });

    // ── Arrow markers (defs) ──
    const defs = svg.append('defs');
    const arrowMarkerDefs = [
      { id: 'gantt-arrow-normal', color: '#6b7280' },
      { id: 'gantt-arrow-delayed', color: '#ef4444' },
    ];
    arrowMarkerDefs.forEach(({ id, color }) => {
      defs.append('marker')
        .attr('id', id)
        .attr('viewBox', '-6 -6 20 20')
        .attr('refX', 10).attr('refY', 0)
        .attr('markerWidth', 16).attr('markerHeight', 16)
        .attr('orient', 'auto')
        .attr('overflow', 'visible')
        .append('path').attr('d', 'M0,-6L10,0L0,6').attr('fill', 'none').attr('stroke', color).attr('stroke-width', 2).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round');
    });

    // ── Cached arrows (computed once, drawn from cache) ──
    const arrowG = svg.append('g').attr('class', 'gantt-arrows');
    arrowCache.forEach(a => {
      arrowG.append('path')
        .attr('d', a.path)
        .attr('fill', 'none')
        .attr('stroke', a.color).attr('stroke-width', 1.5)
        .attr('stroke-linejoin', 'round')
        .attr('stroke-linecap', 'round')
        .attr('opacity', 0.7)
        .attr('marker-end', a.markerId);
    });

  }, [displayTasks, refs, xScale, dateRange, visibleTasks, startIdx, totalHeight, openTab, dayWidth, containerWidth, timelineWidth, arrowCache]);

  // ── Arrow path cache (computed once, reused on every scroll) ──
  // This effect only runs when task data or references change — NOT on scroll.
  useEffect(() => {
    if (!xScale || displayTasks.length === 0) return;

    const directionalTypes = new Set(['blocks', 'subtask']);
    const taskIdx = new Map(displayTasks.map((t, i) => [t.id, i]));

    function isDelayed(task: Task): boolean {
      if (task.status === 'complete') return false;
      if (!task.deadline) return false;
      try { return new Date(task.deadline) < new Date(); } catch { return false; }
    }

    const results: { path: string; color: string; markerId: string; refType: string }[] = [];

    const GAP = 8;
    const BASE_GAP = 24;
    const SPINE_RANGE = 300;
    const MIN_APPROACH = 30;

    // Collect edge data
    const edgeData: { refId: number; srcIdx: number; tgtIdx: number; xStart: number; xEnd: number; ySrc: number; yTgt: number; delayed: boolean }[] = [];

    refs.forEach(ref => {
      if (!directionalTypes.has(ref.ref_type)) return;
      const srcIdx = taskIdx.get(ref.source_task_id);
      const tgtIdx = taskIdx.get(ref.target_task_id);
      if (srcIdx === undefined || tgtIdx === undefined) return;
      const srcTask = displayTasks[srcIdx];
      const tgtTask = displayTasks[tgtIdx];
      if (!srcTask.end_date || !tgtTask.start_date) return;

      edgeData.push({
        refId: ref.id, srcIdx, tgtIdx,
        xStart: xScale(new Date(srcTask.end_date)) + GAP,
        xEnd: xScale(new Date(tgtTask.start_date)) - GAP,
        ySrc: 0, yTgt: 0, // row-based, filled below
        delayed: isDelayed(srcTask),
      });
    });

    if (edgeData.length === 0) { setArrowCache([]); return; }

    const refIds = edgeData.map(e => e.refId);
    const minRef = Math.min(...refIds);
    const maxRef = Math.max(...refIds);
    const refSpan = Math.max(maxRef - minRef, 1);

    const headerH = HEADER_HEIGHT;

    for (const e of edgeData) {
      const ySrc = headerH + e.srcIdx * ROW_HEIGHT + ROW_HEIGHT / 2;
      const yTgt = headerH + e.tgtIdx * ROW_HEIGHT + ROW_HEIGHT / 2;

      const norm = (e.refId - minRef) / refSpan;
      const offset = (norm - 0.5) * SPINE_RANGE;

      const rightEdge = Math.max(e.xStart, e.xEnd) + BASE_GAP + offset;
      let leftEdge = Math.min(e.xStart, e.xEnd) - BASE_GAP + offset;
      if (e.xEnd - leftEdge < MIN_APPROACH) leftEdge = e.xEnd - MIN_APPROACH;

      const midRow = Math.floor((e.srcIdx + e.tgtIdx) / 2);
      const midY = (midRow + (e.srcIdx < e.tgtIdx ? 1 : 0)) * ROW_HEIGHT + headerH;

      // Per-segment deviations — unique offsets for each bend so lane shapes diverge
      const off1 = ((e.refId * 7 + 13) % 25) - 12;   // spine x offset:     -12..+12
      const off2 = ((e.refId * 3 + 7) % 25) - 12;    // mid-horizontal x:   -12..+12
      const off3 = ((e.refId * 5 + 11) % 25) - 12;   // connection y:       -12..+12

      const spineX = rightEdge + off1;
      const midSpanX = leftEdge + off2;
      const connY = yTgt + off3;

      const delayed = e.delayed;
      const path = `M${e.xStart},${ySrc} L${spineX},${ySrc} L${spineX},${midY} L${midSpanX},${midY} L${midSpanX},${connY} L${e.xEnd},${connY}`;

      results.push({
        path,
        color: delayed ? '#ef4444' : '#6b7280',
        markerId: delayed ? 'url(#gantt-arrow-delayed)' : 'url(#gantt-arrow-normal)',
        refType: '',
      });
    }

    setArrowCache(results);
  }, [refs, displayTasks, xScale]);

  // Sync vertical scroll between label panel and timeline panel
  const labelPanelRef = useRef<HTMLDivElement>(null);

  const handleTimelineScroll = () => {
    if (containerRef.current && labelPanelRef.current) {
      labelPanelRef.current.scrollTop = containerRef.current.scrollTop;
    }
    if (containerRef.current) {
      setScrollTop(containerRef.current.scrollTop);
    }
  };

  const handleLabelScroll = () => {
    if (containerRef.current && labelPanelRef.current) {
      containerRef.current.scrollTop = labelPanelRef.current.scrollTop;
    }
  };

  // Wheel zoom handler
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setDayWidth(dw => Math.max(MIN_DAY_WIDTH, Math.min(MAX_DAY_WIDTH, dw - Math.sign(e.deltaY) * 4)));
    }
  };

  const zoomPresets = [
    { label: 'Week', getRange: () => {
      const now = new Date();
      const start = d3.timeMonday.floor(now);
      const end = d3.timeMonday.offset(start, 1);
      return { min: start, max: end, dw: 48 };
    }},
    { label: 'Monthly', getRange: () => {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const end = d3.timeDay.offset(start, 30);
      return { min: start, max: end, dw: 24 };
    }},
    { label: '12 Months', getRange: () => {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const end = d3.timeMonth.offset(start, 12);
      return { min: start, max: end, dw: 6 };
    }},
    { label: 'Max', getRange: () => null },
  ];

  const [activeZoom, setActiveZoom] = useState('Max');

  const handleZoomPreset = (label: string) => {
    setActiveZoom(label);
    const preset = zoomPresets.find(p => p.label === label);
    if (preset) {
      const range = preset.getRange();
      if (range) {
        setViewRange(range);
        setDayWidth(range.dw);
      } else {
        setViewRange(null);
        setDayWidth(12);
      }
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (displayTasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <div className="text-center">
          <div className="text-3xl mb-2">📈</div>
          <p className="text-sm">No tasks with dates found</p>
          <p className="text-xs text-gray-500 mt-1">Set start/end dates on tasks to see them on the timeline</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar: zoom presets */}
      <div className="flex items-center justify-between mb-2 shrink-0">
        <div className="text-xs text-gray-400">
          {displayTasks.length} tasks · {refs.length} dependencies
        </div>
        <div className="flex items-center gap-2">
          <select
            value={activeZoom}
            onChange={e => handleZoomPreset(e.target.value)}
            className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
          >
            {zoomPresets.map(p => (
              <option key={p.label} value={p.label}>{p.label}</option>
            ))}
          </select>
          <span className="text-xs text-gray-500">Ctrl+Scroll to zoom</span>
        </div>
      </div>

      {/* Two-panel layout */}
      <div className="flex flex-1 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-900">
        {/* Left: fixed-width label panel */}
        <div
          ref={labelPanelRef}
          className="shrink-0 overflow-hidden border-r border-gray-200 dark:border-gray-700"
          style={{ width: LABEL_WIDTH, position: 'relative' }}
          onScroll={handleLabelScroll}
        >
          {/* Header spacer */}
          <div style={{ height: HEADER_HEIGHT }} className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800" />
          {/* Task labels — absolutely positioned */}
          {visibleTasks.map((task, i) => {
            const y = HEADER_HEIGHT + (startIdx + i) * ROW_HEIGHT;
            return (
              <div
                key={task.id}
                className="flex items-center px-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 truncate text-xs"
                style={{ height: ROW_HEIGHT, position: 'absolute', top: y, left: 0, right: 0 }}
                onClick={() => openTab({ id: `task-${task.id}`, type: 'task', title: task.title, taskId: task.id })}
                title={task.title}
              >
                {task.title}
              </div>
            );
          })}
          {/* Spacer for totalHeight to enable scrolling */}
          <div style={{ height: totalHeight }} />
        </div>

        {/* Right: scrollable timeline */}
        <div
          ref={containerRef}
          className="flex-1 overflow-auto"
          onScroll={handleTimelineScroll}
          onWheel={handleWheel}
        >
          <svg ref={svgRef} style={{ display: 'block' }} />
        </div>
      </div>

      <div className="text-xs text-gray-400 mt-1 shrink-0">
        Click a bar to open task · Scroll to pan vertically · Ctrl+scroll to zoom
      </div>
    </div>
  );
}
