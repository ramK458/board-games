import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { useTabStore } from '../../stores/tabStore';
import { useHierarchyStore } from '../../stores/hierarchyStore';
import { useUiStore } from '../../stores/uiStore';
import { taskApi, referenceApi } from '../../api/client';
import type { Task, CrossReference } from '../../types';

interface Props { nodeId: number }

interface GraphNode extends d3.SimulationNodeDatum {
  id: number;
  title: string;
  type: 'hierarchy' | 'task';
  status: string;
  priority: string;
  refCount: number;
  groupLabel: string;  // e.g. "Feature: Homepage"
  levelName?: string;  // e.g. "Project", "Module", "Feature"
  parentHierarchyId?: number;
  childCount?: number;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  ref_type: string;
}

// ── Base sizing — derived from a single constant so changes propagate everywhere
const NODE_BASE_RADIUS = 6;

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
  const filterUserId = useUiStore(s => s.filterUserId);
  const [depth, setDepth] = useState(2);
  const [loading, setLoading] = useState(true);
  const [taskMap, setTaskMap] = useState<Map<number, Task>>(new Map());
  const [links, setLinks] = useState<CrossReference[]>([]);
  const [hierarchyCount, setHierarchyCount] = useState(0);

  // Fetch data at configured depth — tasks + hierarchy nodes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load() {
      const allTasks = new Map<number, Task>();
      const allRefs: CrossReference[] = [];
      const seenTasks = new Set<number>();
      seenTasks.add(nodeId);

      // Hierarchy node info: id → { name, levelName, parentId }
      const hierarchyInfo = new Map<number, { name: string; levelName: string; parentId: number | null }>();
      const seenHierarchyIds = new Set<number>();

      // Helper: fetch hierarchy node details
      async function fetchHierarchyNode(hid: number) {
        if (seenHierarchyIds.has(hid)) return;
        seenHierarchyIds.add(hid);
        try {
          const res = await fetch(`/api/hierarchy/nodes/${hid}`, {
            headers: { 'X-User-Id': '1' }
          });
          const node = await res.json();
          // Fetch level name
          let lvlName = '';
          try {
            const lvlRes = await fetch(`/api/hierarchy/levels`, {
              headers: { 'X-User-Id': '1' }
            });
            const levels = await lvlRes.json();
            const level = levels.find((l: any) => l.id === node.level_id);
            lvlName = level?.name || '';
          } catch {}
          hierarchyInfo.set(hid, {
            name: node.name,
            levelName: lvlName,
            parentId: node.parent_id || null,
          });
          // Fetch ancestor chain
          if (node.parent_id) await fetchHierarchyNode(node.parent_id);
        } catch {}
      }

      // BFS traversal — collect tasks + their parent hierarchy nodes
      let frontier: { id: number; depth: number }[] = [{ id: nodeId, depth: 0 }];

      try {
        // Level 0: root tasks for this node
        const rootRes = await taskApi.list({ scope: nodeId, per_page: 100, ...(filterUserId ? { assignee_id: filterUserId } : {}) });
        for (const t of rootRes.items) {
          allTasks.set(t.id, t);
          seenTasks.add(t.id);
          frontier.push({ id: t.id, depth: 1 });
          if (t.parent_node_id) await fetchHierarchyNode(t.parent_node_id);
        }
        // Also fetch the hierarchy node itself as a cluster center
        await fetchHierarchyNode(nodeId);

        for (let d = 1; d < depth; d++) {
          const next: { id: number; depth: number }[] = [];
          for (const entry of frontier) {
            if (entry.depth !== d) continue;
            try {
              const refs = await referenceApi.list(entry.id);
              for (const ref of refs) {
                allRefs.push(ref);
                const tid = ref.target_task_id;
                if (!seenTasks.has(tid)) {
                  seenTasks.add(tid);
                  try {
                    const t = await taskApi.get(tid);
                    allTasks.set(t.id, t);
                    next.push({ id: t.id, depth: d + 1 });
                    if (t.parent_node_id) await fetchHierarchyNode(t.parent_node_id);
                  } catch {}
                }
              }
            } catch {}
          }
          frontier = next;
        }
      } catch {}

      if (!cancelled) {
        setTaskMap(allTasks);
        setLinks(allRefs);
        (window as any).__hierarchyInfo = hierarchyInfo;
        setHierarchyCount(hierarchyInfo.size);
        setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [nodeId, depth, filterUserId]);

  // Render D3 force graph
  useEffect(() => {
    if (!svgRef.current) return;
    const hierarchyInfo: Map<number, { name: string; levelName: string; parentId: number | null }> =
      (window as any).__hierarchyInfo || new Map();
    if (taskMap.size === 0 && hierarchyInfo.size === 0) return;

    const container = containerRef.current;
    if (!container) return;
    const width = container.clientWidth;
    const height = container.clientHeight || 600;

    // Build hierarchy nodes (bigger circles for level clusters)
    const hierarchyNodes: GraphNode[] = [];
    const hierarchyIdSet = new Set<number>();
    hierarchyInfo.forEach((info, hid) => {
      if (hierarchyIdSet.has(hid)) return;
      hierarchyIdSet.add(hid);
      hierarchyNodes.push({
        id: -hid,  // negative to avoid collision with task IDs
        title: info.name,
        type: 'hierarchy',
        status: '',
        priority: '',
        refCount: 0,
        groupLabel: info.levelName,
        levelName: info.levelName,
        parentHierarchyId: info.parentId ? -info.parentId : undefined,
        childCount: 0,
      });
    });

    // Build task nodes
    const taskNodes: GraphNode[] = Array.from(taskMap.values()).map(t => {
      const parentHid = t.parent_node_id ? -t.parent_node_id : undefined;
      return {
        id: t.id,
        title: t.title,
        type: 'task' as const,
        status: t.status,
        priority: t.priority,
        refCount: 0,
        groupLabel: '',
        parentHierarchyId: parentHid,
      };
    });

    // Count hierarchy children
    for (const tn of taskNodes) {
      if (tn.parentHierarchyId) {
        const parent = hierarchyNodes.find(h => h.id === tn.parentHierarchyId);
        if (parent) parent.childCount = (parent.childCount || 0) + 1;
      }
    }

    const allNodes: GraphNode[] = [...hierarchyNodes, ...taskNodes];
    const nodeIdSet = new Set(allNodes.map(n => n.id));

    // Compute refCounts for task nodes from dependency links
    const refCounts = new Map<number, number>();
    for (const link of links) {
      refCounts.set(link.source_task_id, (refCounts.get(link.source_task_id) || 0) + 1);
      refCounts.set(link.target_task_id, (refCounts.get(link.target_task_id) || 0) + 1);
    }
    for (const n of taskNodes) n.refCount = refCounts.get(n.id) || 0;
    // Hierarchy nodes get refCount from child count
    for (const n of hierarchyNodes) n.refCount = n.childCount || 0;

    // Build links: hierarchy parent→child (thin, no arrow)
    const hierarchyLinks: GraphLink[] = [];
    for (const hn of hierarchyNodes) {
      if (hn.parentHierarchyId && nodeIdSet.has(hn.parentHierarchyId)) {
        hierarchyLinks.push({ source: hn.parentHierarchyId, target: hn.id, ref_type: 'hierarchy' });
      }
    }
    for (const tn of taskNodes) {
      if (tn.parentHierarchyId && nodeIdSet.has(tn.parentHierarchyId)) {
        hierarchyLinks.push({ source: tn.parentHierarchyId, target: tn.id, ref_type: 'hierarchy' });
      }
    }

    // Build links: task→task dependencies (colored arrows)
    const taskLinks: GraphLink[] = links
      .filter(l => nodeIdSet.has(l.source_task_id) && nodeIdSet.has(l.target_task_id))
      .filter(l => l.ref_type !== 'blocked_by' && l.ref_type !== 'caused_by')
      .map(l => ({ source: l.source_task_id, target: l.target_task_id, ref_type: l.ref_type }));

    const allLinks: GraphLink[] = [...hierarchyLinks, ...taskLinks];

    // Compute max refCount for proportional sizing
    const maxRefCount = Math.max(...allNodes.map(n => n.refCount), 1);

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

    // ── Arrow markers for task dependency links ──
    const defs = svg.append('defs');
    Object.entries(refTypeColors).forEach(([type, color]) => {
      defs.append('marker')
        .attr('id', `arrow-${type}`)
        .attr('viewBox', '0 -4 8 8')
        .attr('refX', 12).attr('refY', 0)
        .attr('markerWidth', 8).attr('markerHeight', 8)
        .attr('orient', 'auto')
        .append('path').attr('d', 'M0,-4L8,0L0,4').attr('fill', color);
    });

    // ── Hierarchy parent-child links (thin gray, no arrow) ──
    const hierLinkEls = g.append('g')
      .selectAll('line').data(hierarchyLinks).join('line')
      .attr('stroke', '#d1d5db').attr('stroke-width', 1).attr('stroke-opacity', 0.5);

    // ── Task dependency links (curved paths with arrows) ──
    const linkEls = g.append('g')
      .selectAll('path').data(taskLinks).join('path')
      .attr('fill', 'none')
      .attr('stroke', '#94a3b8')
      .attr('stroke-width', 1.5).attr('stroke-opacity', 0.6)
      .attr('marker-end', d => `url(#arrow-${d.ref_type})`);

    // ── Nodes ──
    const nodeEls = g.append('g')
      .selectAll('g').data(allNodes).join('g')
      .attr('cursor', 'pointer')
      .call(d3.drag<SVGGElement, GraphNode>()
        .on('start', (ev, d) => { if (!ev.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
        .on('end', (ev, d) => { if (!ev.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }));

    // Hierarchy node color palette by level
    const levelPalette: Record<string, string> = {
      Project: '#6366f1',
      Module: '#8b5cf6',
      Feature: '#a855f7',
    };

    nodeEls.append('circle')
      .attr('r', d => {
        const r = d.type === 'hierarchy'
          ? NODE_BASE_RADIUS * 2.5 + 4 * ((d.childCount || 0) / Math.max(maxRefCount, 1))
          : NODE_BASE_RADIUS * 0.5 + 3 * (d.refCount / maxRefCount);
        return r;
      })
      .attr('fill', d => {
        if (d.type === 'hierarchy') return levelPalette[d.levelName || ''] || '#6366f1';
        return statusColors[d.status] || '#9ca3af';
      })
      .attr('stroke', d => {
        if (d.type === 'hierarchy') return '#fff';
        return statusColors[d.status] || '#9ca3af';
      })
      .attr('stroke-width', d => d.type === 'hierarchy' ? 3 : 1.5)
      .attr('opacity', 0.9);

    // Labels: hierarchy level name above, task title to the right
    nodeEls.append('text')
      .text(d => d.type === 'hierarchy' ? d.title : (d.title.length > 24 ? d.title.slice(0, 22) + '\u2026' : d.title))
      .attr('dx', d => {
        const r = d.type === 'hierarchy'
          ? NODE_BASE_RADIUS * 2.5 + 4 * ((d.childCount || 0) / Math.max(maxRefCount, 1))
          : NODE_BASE_RADIUS * 0.5 + 3 * (d.refCount / maxRefCount);
        return r + (d.type === 'hierarchy' ? 8 : 4);
      })
      .attr('dy', d => d.type === 'hierarchy' ? -2 : -2)
      .attr('font-size', d => d.type === 'hierarchy' ? 14 : 12)
      .attr('font-weight', d => d.type === 'hierarchy' ? 700 : 500)
      .attr('fill', d => d.type === 'hierarchy' ? '#4f46e5' : '#6b7280')
      .attr('class', 'dark:fill-gray-400')
      .attr('opacity', d => d.type === 'task' && d.refCount < maxRefCount * 0.15 ? 0 : 1);

    // ── Interactions ──
    nodeEls
      .on('mouseenter', (_ev, d) => {
        const connected = new Set<number>([d.id]);
        allLinks.forEach(l => {
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
        linkEls.attr('stroke-opacity', 0.6);
      })
      .on('click', (_ev, d) => {
        if (d.type === 'task') {
          openTab({ id: `task-${d.id}`, type: 'task', title: d.title, taskId: d.id });
        } else {
          // For hierarchy nodes, select it in the sidebar
          useHierarchyStore.getState().setActiveNode(Math.abs(d.id));
        }
      });

    // ── Force simulation ──
    const simulation = d3.forceSimulation<GraphNode>(allNodes)
      .force('link', d3.forceLink<GraphNode, GraphLink>(allLinks).id(d => d.id)
        .distance(l => l.ref_type === 'hierarchy' ? 80 : 120))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(d => d.type === 'hierarchy' ? NODE_BASE_RADIUS * 10 : NODE_BASE_RADIUS * 5));

    simulation.on('tick', () => {
      // Hierarchy links (straight lines)
      hierLinkEls
        .attr('x1', d => (d.source as GraphNode).x!)
        .attr('y1', d => (d.source as GraphNode).y!)
        .attr('x2', d => (d.target as GraphNode).x!)
        .attr('y2', d => (d.target as GraphNode).y!);

      // Task dependency links (curved paths)
      linkEls.attr('d', d => {
        const sx = (d.source as GraphNode).x!;
        const sy = (d.source as GraphNode).y!;
        const tx = (d.target as GraphNode).x!;
        const ty = (d.target as GraphNode).y!;
        const dx = tx - sx;
        const dy = ty - sy;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const curvature = 0.25;
        const mx = (sx + tx) / 2;
        const my = (sy + ty) / 2;
        const nx = -dy / dist;
        const ny = dx / dist;
        const cpx = mx + nx * dist * curvature;
        const cpy = my + ny * dist * curvature;
        return `M${sx},${sy} Q${cpx},${cpy} ${tx},${ty}`;
      });
      nodeEls.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    simulation.on('end', () => { simulation.stop(); });

    return () => { simulation.stop(); };
  }, [taskMap, links, openTab]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (taskMap.size === 0 && hierarchyCount === 0) {
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
          {hierarchyCount} levels · {taskMap.size} tasks · {links.length} refs
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
