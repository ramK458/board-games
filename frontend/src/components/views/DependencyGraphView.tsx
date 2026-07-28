import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { useTabStore } from '../../stores/tabStore';
import { taskApi, referenceApi } from '../../api/client';
import type { Task, CrossReference } from '../../types';

interface Props { nodeId: number }

interface GraphNode extends d3.SimulationNodeDatum {
  id: number;
  title: string;
  status: string;
  priority: string;
  refCount: number;
  groupLabel: string;  // e.g. "Feature: Homepage"
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  ref_type: string;
}

const statusColors: Record<string, string> = {
  not_done: '#9ca3af',
  in_progress: '#3b82f6',
  complete: '#22c55e',
};

const statusBorderColors: Record<string, string> = {
  not_done: '#6b7280',
  in_progress: '#2563eb',
  complete: '#16a34a',
};

const refTypeColors: Record<string, string> = {
  blocks: '#ef4444',
  blocked_by: '#f97316',
  duplicates: '#a855f7',
  related_to: '#3b82f6',
  caused_by: '#eab308',
  subtask: '#22c55e',
};

const refTypeLabels: Record<string, string> = {
  blocks: 'Blocks',
  blocked_by: 'Blocked By',
  duplicates: 'Duplicates',
  related_to: 'Related To',
  caused_by: 'Caused By',
  subtask: 'Subtask',
};

export default function DependencyGraphView({ nodeId }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const openTab = useTabStore(s => s.openTab);
  const [depth, setDepth] = useState(2);
  const [loading, setLoading] = useState(true);
  const [taskMap, setTaskMap] = useState<Map<number, Task>>(new Map());
  const [links, setLinks] = useState<CrossReference[]>([]);

  // Fetch data at configured depth, including parent node info for level labels
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load() {
      const allTasks = new Map<number, Task>();
      const allRefs: CrossReference[] = [];
      const seenNodes = new Set<number>();
      seenNodes.add(nodeId);

      // Map task_id → parent node name + level name
      const parentInfo = new Map<number, string>();

      // Fetch hierarchy levels for group labels
      let levelNameMap: Record<number, string> = {};
      try {
        const levelsRes = await fetch('/api/hierarchy/levels', {
          headers: { 'X-User-Id': '1' }
        });
        const levels = await levelsRes.json();
        for (const l of levels) levelNameMap[l.id] = l.name;
      } catch {}

      // BFS traversal up to depth
      let frontier: { id: number; depth: number }[] = [{ id: nodeId, depth: 0 }];

      try {
        // Level 0: root tasks for this node
        const rootRes = await taskApi.list({ scope: nodeId, per_page: 100 });
        for (const t of rootRes.items) {
          allTasks.set(t.id, t);
          seenNodes.add(t.id);
          frontier.push({ id: t.id, depth: 1 });
          // Get parent node info for level label
          try {
            const nodeRes = await fetch(`/api/hierarchy/nodes/${t.parent_node_id}`, {
              headers: { 'X-User-Id': '1' }
            });
            const node = await nodeRes.json();
            const lvlName = levelNameMap[node.level_id] || '';
            parentInfo.set(t.id, lvlName ? `${lvlName}: ${node.name}` : node.name);
          } catch {}
        }

        for (let d = 1; d < depth; d++) {
          const next: { id: number; depth: number }[] = [];
          for (const entry of frontier) {
            if (entry.depth !== d) continue;
            try {
              const refs = await referenceApi.list(entry.id);
              for (const ref of refs) {
                allRefs.push(ref);
                const tid = ref.target_task_id;
                if (!seenNodes.has(tid)) {
                  seenNodes.add(tid);
                  try {
                    const t = await taskApi.get(tid);
                    allTasks.set(t.id, t);
                    next.push({ id: t.id, depth: d + 1 });
                    try {
                      const nodeRes = await fetch(`/api/hierarchy/nodes/${t.parent_node_id}`, {
                        headers: { 'X-User-Id': '1' }
                      });
                      const node = await nodeRes.json();
                      const lvlName = levelNameMap[node.level_id] || '';
                      parentInfo.set(t.id, lvlName ? `${lvlName}: ${node.name}` : node.name);
                    } catch {}
                  } catch { /* skip inaccessible */ }
                }
              }
            } catch { /* skip */ }
          }
          frontier = next;
        }
      } catch { /* ignore */ }

      if (!cancelled) {
        setTaskMap(allTasks);
        setLinks(allRefs);
        // Store parentInfo in a ref or state for rendering
        (window as any).__graphParentInfo = parentInfo;
        setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [nodeId, depth]);

  // Render D3 force graph
  useEffect(() => {
    if (!svgRef.current || taskMap.size === 0) return;

    const container = containerRef.current;
    if (!container) return;
    const width = container.clientWidth;
    const height = container.clientHeight || 600;

    const parentInfo: Map<number, string> = (window as any).__graphParentInfo || new Map();

    // Build nodes with group labels
    const nodes: GraphNode[] = Array.from(taskMap.values()).map(t => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      refCount: 0,
      groupLabel: parentInfo.get(t.id) || '',
    }));

    const refCounts = new Map<number, number>();
    for (const link of links) {
      refCounts.set(link.source_task_id, (refCounts.get(link.source_task_id) || 0) + 1);
      refCounts.set(link.target_task_id, (refCounts.get(link.target_task_id) || 0) + 1);
    }
    for (const n of nodes) n.refCount = refCounts.get(n.id) || 0;

    const nodeIds = new Set(nodes.map(n => n.id));
    const graphLinks: GraphLink[] = links
      .filter(l => nodeIds.has(l.source_task_id) && nodeIds.has(l.target_task_id))
      .map(l => ({ source: l.source_task_id, target: l.target_task_id, ref_type: l.ref_type }));

    const svgEl = svgRef.current;
    d3.select(svgEl).selectAll('*').remove();

    const svg = d3.select(svgEl)
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`);

    // ── Background for zoom ──
    const g = svg.append('g');
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => { g.attr('transform', event.transform); });
    svg.call(zoom);

    // ── Arrow markers (larger, more prominent) ──
    const defs = svg.append('defs');
    Object.entries(refTypeColors).forEach(([type, color]) => {
      defs.append('marker')
        .attr('id', `arrow-${type}`)
        .attr('viewBox', '0 -6 12 12')
        .attr('refX', 16).attr('refY', 0)
        .attr('markerWidth', 10).attr('markerHeight', 10)
        .attr('orient', 'auto')
        .append('path').attr('d', 'M0,-6L12,0L0,6').attr('fill', color);
    });

    // ── Links (thicker, more opaque) ──
    const linkEls = g.append('g')
      .selectAll('line').data(graphLinks).join('line')
      .attr('stroke', d => refTypeColors[d.ref_type] || '#6b7280')
      .attr('stroke-width', 2.5).attr('stroke-opacity', 0.8)
      .attr('marker-end', d => `url(#arrow-${d.ref_type})`);

    // ── Nodes (circles + title + status badge) ──
    const nodeEls = g.append('g')
      .selectAll('g').data(nodes).join('g')
      .attr('cursor', 'pointer')
      .call(d3.drag<SVGGElement, GraphNode>()
        .on('start', (ev, d) => { if (!ev.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
        .on('end', (ev, d) => { if (!ev.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }));

    nodeEls.append('circle')
      .attr('r', d => Math.max(5, Math.min(12, 5 + d.refCount * 1.5)))
      .attr('fill', d => statusColors[d.status] || '#9ca3af')
      .attr('stroke', d => statusBorderColors[d.status] || '#6b7280')
      .attr('stroke-width', 2).attr('opacity', 0.9);

    // Task title
    nodeEls.append('text')
      .text(d => d.title.length > 24 ? d.title.slice(0, 22) + '\u2026' : d.title)
      .attr('dx', d => Math.max(5, Math.min(12, 5 + d.refCount * 1.5)) + 6)
      .attr('dy', -2)
      .attr('font-size', 13).attr('font-weight', 500)
      .attr('fill', '#6b7280').attr('class', 'dark:fill-gray-400');

    // Status badge
    nodeEls.append('text')
      .text(d => d.status.replace('_', ' '))
      .attr('dx', d => {
        const r = Math.max(5, Math.min(12, 5 + d.refCount * 1.5));
        const titleLen = Math.min(d.title.length, 24);
        return r + 6 + titleLen * 7 + 6;
      })
      .attr('dy', -2)
      .attr('font-size', 9).attr('fill', d => statusColors[d.status] || '#9ca3af');

    // ── Interactions ──
    nodeEls
      .on('mouseenter', (_ev, d) => {
        const connected = new Set<number>([d.id]);
        graphLinks.forEach(l => {
          const sid = typeof l.source === 'object' ? l.source.id : l.source;
          const tid = typeof l.target === 'object' ? l.target.id : l.target;
          if (sid === d.id) connected.add(tid);
          if (tid === d.id) connected.add(sid);
        });
        nodeEls.attr('opacity', n => connected.has(n.id) ? 1 : 0.15);
        linkEls.attr('stroke-opacity', l => {
          const sid = typeof l.source === 'object' ? l.source.id : l.source;
          const tid = typeof l.target === 'object' ? l.target.id : l.target;
          return sid === d.id || tid === d.id ? 1 : 0.05;
        });
      })
      .on('mouseleave', () => {
        nodeEls.attr('opacity', 0.9);
        linkEls.attr('stroke-opacity', 0.8);
      })
      .on('click', (_ev, d) => {
        openTab({ id: `task-${d.id}`, type: 'task', title: d.title, taskId: d.id });
      });

    // ── Group labels (one per group, at centroid) ──
    const labelGroup = g.insert('g', ':first-child');

    // ── Force simulation ──
    const simulation = d3.forceSimulation<GraphNode>(nodes)
      .force('link', d3.forceLink<GraphNode, GraphLink>(graphLinks).id(d => d.id).distance(100))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(30));

    simulation.on('tick', () => {
      // Update links
      linkEls
        .attr('x1', d => (d.source as GraphNode).x!)
        .attr('y1', d => (d.source as GraphNode).y!)
        .attr('x2', d => (d.target as GraphNode).x!)
        .attr('y2', d => (d.target as GraphNode).y!);
      nodeEls.attr('transform', d => `translate(${d.x},${d.y})`);

      // One group label per cluster at its centroid
      labelGroup.selectAll('*').remove();
      const groups = d3.group(nodes, d => d.groupLabel);
      groups.forEach((groupNodes, label) => {
        if (!label || groupNodes.length === 0) return;
        const cx = d3.mean(groupNodes, d => d.x!)!;
        const cy = d3.mean(groupNodes, d => d.y!)!;
        labelGroup.append('text')
          .text(label)
          .attr('x', cx).attr('y', cy - 4)
          .attr('text-anchor', 'middle').attr('font-size', 12)
          .attr('font-weight', 700).attr('fill', '#475569')
          .attr('class', 'dark:fill-gray-300');
      });
    });

    // Double-click reset
    svg.on('dblclick', () => {
      svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity);
    });

    return () => { simulation.stop(); };
  }, [taskMap, links, openTab]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (taskMap.size === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <div className="text-center">
          <div className="text-3xl mb-2">🔗</div>
          <p className="text-sm">No dependencies found</p>
          <p className="text-xs text-gray-500 mt-1">Add cross-references between tasks to see the graph</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Controls bar */}
      <div className="flex items-center justify-between mb-2 shrink-0">
        <div className="flex items-center gap-3">
          <label className="text-xs text-gray-500">Depth:</label>
          <input
            type="range"
            min={1} max={5} value={depth}
            onChange={e => setDepth(Number(e.target.value))}
            className="w-24"
          />
          <span className="text-xs text-gray-500 w-4">{depth}</span>
        </div>
        <div className="text-xs text-gray-400">
          {taskMap.size} nodes · {links.length} edges
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mb-2 shrink-0 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-500">Status:</span>
          {Object.entries(statusColors).map(([s, c]) => (
            <span key={s} className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c }} />
              {s.replace('_', ' ')}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-500">Edges:</span>
          {Object.entries(refTypeLabels).map(([t, l]) => (
            <span key={t} className="flex items-center gap-1">
              <span className="inline-block w-3 h-0.5" style={{ backgroundColor: refTypeColors[t] }} />
              {l}
            </span>
          ))}
        </div>
      </div>

      {/* SVG container */}
      <div ref={containerRef} className="flex-1 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-900">
        <svg ref={svgRef} className="w-full h-full" />
      </div>

      <div className="text-xs text-gray-400 mt-1 shrink-0">
        Drag nodes · Scroll to zoom · Double-click to reset · Click node to open task
      </div>
    </div>
  );
}
