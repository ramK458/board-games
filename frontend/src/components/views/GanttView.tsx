import { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { useTabStore } from '../../stores/tabStore';
import { taskApi, referenceApi } from '../../api/client';
import type { Task, CrossReference } from '../../types';

interface Props { nodeId: number }

const ROW_HEIGHT = 48;  // 32 for bar + 16 for arrow lane below
const LABEL_WIDTH = 200;
const HEADER_HEIGHT = 40;
const MIN_DAY_WIDTH = 12;
const MAX_DAY_WIDTH = 80;

const statusBarColors: Record<string, string> = {
  not_done: '#9ca3af',
  in_progress: '#3b82f6',
  complete: '#22c55e',
};

const refTypeColors: Record<string, string> = {
  blocks: '#ef4444',
  blocked_by: '#f97316',
  duplicates: '#a855f7',
  related_to: '#3b82f6',
  caused_by: '#eab308',
  subtask: '#22c55e',
};

export default function GanttView({ nodeId }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const openTab = useTabStore(s => s.openTab);

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
        const res = await taskApi.list({ scope: nodeId, sort: 'start_date:asc', per_page: 100 });

        // Only keep tasks with at least one date
        const dated = res.items.filter(t => t.start_date || t.end_date);

        // Fetch references for all tasks
        const allRefs: CrossReference[] = [];
        await Promise.allSettled(
          dated.map(t =>
            referenceApi.list(t.id).then(r => allRefs.push(...r)).catch(() => {})
          )
        );

        if (!cancelled) {
          setTasks(dated);
          setRefs(allRefs);
        }
      } catch { /* ignore */ }
      if (!cancelled) setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [nodeId]);

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
        if (t.start_date) allDates.push(new Date(t.start_date));
        if (t.end_date) allDates.push(new Date(t.end_date));
        if (t.deadline) allDates.push(new Date(t.deadline));
      });
      min = d3.min(allDates) || new Date();
      max = d3.max(allDates) || d3.timeDay.offset(new Date(), 14);
      min = d3.timeDay.offset(min, -3);
      max = d3.timeDay.offset(max, 7);
    }

    const msPerDay = 86400000;
    const totalDays = Math.ceil((max.getTime() - min.getTime()) / msPerDay);
    const totalPixels = totalDays * dayWidth;

    const scale = d3.scaleTime()
      .domain([min, max])
      .range([0, totalPixels]);

    return { xScale: scale, dateRange: { min, max } };
  }, [displayTasks, dayWidth, viewRange]);

  // Total pixel width of the timeline
  const timelineWidth = useMemo(() => {
    if (!dateRange || displayTasks.length === 0) return 800;
    const days = Math.ceil((dateRange.max.getTime() - dateRange.min.getTime()) / 86400000);
    return Math.max(days * dayWidth, 400);
  }, [displayTasks, dayWidth, dateRange, viewRange]);

  // Render D3 timeline only (labels are rendered in HTML left panel)
  useEffect(() => {
    if (!svgRef.current || !xScale || displayTasks.length === 0) return;

    const chartWidth = timelineWidth;
    const chartHeight = totalHeight;

    const svgEl = svgRef.current;
    d3.select(svgEl).selectAll('*').remove();

    const svg = d3.select(svgEl)
      .attr('width', chartWidth)
      .attr('height', chartHeight);

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
        .attr('width', (d, i, arr) => {
          const next = arr[i + 1] ? arr[i + 1] : dateRange.max;
          return Math.max(0, xScale(next) - xScale(d));
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
        gridG.append('rect')
          .attr('x', x0).attr('y', headerH)
          .attr('width', x1 - x0).attr('height', totalHeight - headerH)
          .attr('fill', '#f9fafb').attr('opacity', 0.5)
          .attr('class', 'dark:fill-gray-800');
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
      const y = headerH + (startIdx + i) * ROW_HEIGHT + 4;
      const barH = ROW_HEIGHT - 16;  // 32px bar, 16px arrow lane below

      if (task.start_date && task.end_date) {
        const x0 = xScale(new Date(task.start_date));
        const x1 = xScale(new Date(task.end_date));
        const w = Math.max(4, x1 - x0);

        gridG.append('rect')
          .attr('x', x0).attr('y', y)
          .attr('width', w).attr('height', barH)
          .attr('rx', 4).attr('ry', 4)
          .attr('fill', statusBarColors[task.status] || '#9ca3af')
          .attr('opacity', 0.85)
          .attr('cursor', 'pointer')
          .on('click', () => openTab({ id: `task-${task.id}`, type: 'task', title: task.title, taskId: task.id }));

        if (w > 40) {
          gridG.append('text')
            .text(task.title.length > Math.floor(w / 7) ? '' : task.title)
            .attr('x', x0 + 4).attr('y', y + barH / 2 + 4)
            .attr('font-size', 10).attr('fill', '#fff');
        }
      } else if (task.deadline) {
        const dx = xScale(new Date(task.deadline));
        gridG.append('polygon')
          .attr('points', `${dx - 4},${y} ${dx + 4},${y} ${dx},${y + barH}`)
          .attr('fill', '#f59e0b').attr('opacity', 0.8)
          .attr('cursor', 'pointer')
          .on('click', () => openTab({ id: `task-${task.id}`, type: 'task', title: task.title, taskId: task.id }));
      }
    });

    // ── Dependency arrows (orthogonal routing) ──
    // Only draw directional arrows (blocks, caused_by, subtask).
    // "blocked_by" is the reciprocal view — not drawn as an arrow.
    const directionalTypes = new Set(['blocks', 'caused_by', 'subtask']);
    const taskIdx = new Map(displayTasks.map((t, i) => [t.id, i]));

    refs.forEach(ref => {
      if (!directionalTypes.has(ref.ref_type)) return;

      const srcIdx = taskIdx.get(ref.source_task_id);
      const tgtIdx = taskIdx.get(ref.target_task_id);
      if (srcIdx === undefined || tgtIdx === undefined) return;

      const srcTask = displayTasks[srcIdx];
      const tgtTask = displayTasks[tgtIdx];
      if (!srcTask.end_date || !tgtTask.start_date) return;

      const srcVisible = srcIdx >= startIdx && srcIdx < startIdx + visibleTasks.length;
      if (!srcVisible) return;

      const BAR_HEIGHT = ROW_HEIGHT - 16;
      const LANE_OFFSET = 6;

      // Arrow: right edge of source bar → left edge of target bar
      const x_start = xScale(new Date(srcTask.end_date)) + LANE_OFFSET;
      const x_end = xScale(new Date(tgtTask.start_date)) - LANE_OFFSET;

      // Vertical center of each bar (top 32px of each 48px row)
      const y_src = headerH + srcIdx * ROW_HEIGHT + BAR_HEIGHT / 2;
      const y_tgt = headerH + tgtIdx * ROW_HEIGHT + BAR_HEIGHT / 2;

      // Arrow path: → then ↓/↑ then →
      // Use the arrow lane between the two rows (the gap row)
      let y_lane: number;
      if (tgtIdx > srcIdx) {
        // Target is below — arrow goes down into the gap before target's row
        y_lane = headerH + tgtIdx * ROW_HEIGHT;  // top edge of target row
      } else {
        // Target is above — arrow goes up into the gap after target's row
        y_lane = headerH + (tgtIdx + 1) * ROW_HEIGHT;  // bottom edge of target row
      }

      const path = `M${x_start},${y_src} L${x_start},${y_lane} L${x_end},${y_lane} L${x_end},${y_tgt}`;
      const color = refTypeColors[ref.ref_type] || '#6b7280';

      gridG.append('path')
        .attr('d', path)
        .attr('fill', 'none')
        .attr('stroke', color).attr('stroke-width', 2)
        .attr('opacity', 0.7)
        .attr('marker-end', `url(#gantt-arrow-${ref.ref_type})`);
    });

    // Arrow markers — one per relationship type (color-coded)
    const defs = svg.append('defs');
    Object.entries(refTypeColors).forEach(([type, color]) => {
      defs.append('marker')
        .attr('id', `gantt-arrow-${type}`)
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 10).attr('refY', 0)
        .attr('markerWidth', 8).attr('markerHeight', 8)
        .attr('orient', 'auto')
        .append('path').attr('d', 'M0,-5L10,0L0,5').attr('fill', color);
    });

  }, [displayTasks, refs, xScale, dateRange, visibleTasks, startIdx, totalHeight, openTab, dayWidth, containerWidth, timelineWidth]);

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
