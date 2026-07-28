import type { Task, TaskCreate, TaskUpdate, PaginatedResponse, TaskTag, Comment, CommentCreate, CrossReference, CrossReferenceCreate, TaskStage, StageCreate, ChartData, HierarchyNode, HierarchyLevel, HierarchyTreeItem } from '../types';

const BASE = '/api';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const userId = localStorage.getItem('board-games-user-id') || '1';
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': userId,
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Hierarchy ─────────────────────────────────

export const hierarchyApi = {
  getLevels: () => request<HierarchyLevel[]>('/hierarchy/levels'),
  getNodes: (parentId?: number) =>
    request<HierarchyNode[]>(`/hierarchy/nodes${parentId ? `?parent_id=${parentId}` : ''}`),
  getNode: (id: number) => request<HierarchyNode>(`/hierarchy/nodes/${id}`),
  getTree: () => request<HierarchyTreeItem[]>('/hierarchy/tree'),
  createNode: (data: Partial<HierarchyNode>) =>
    request<HierarchyNode>('/hierarchy/nodes', { method: 'POST', body: JSON.stringify(data) }),
  updateNode: (id: number, data: Partial<HierarchyNode>) =>
    request<HierarchyNode>(`/hierarchy/nodes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteNode: (id: number, force?: boolean) =>
    request<void>(`/hierarchy/nodes/${id}${force ? '?force=true' : ''}`, { method: 'DELETE' }),
};

// ── Tasks ─────────────────────────────────────

export const taskApi = {
  list: (params: Record<string, string | number> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => qs.set(k, String(v)));
    return request<PaginatedResponse<Task>>(`/tasks?${qs.toString()}`);
  },
  get: (id: number) => request<Task>(`/tasks/${id}`),
  create: (data: TaskCreate) => request<Task>('/tasks', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: TaskUpdate) =>
    request<Task>(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) => request<void>(`/tasks/${id}`, { method: 'DELETE' }),
  approve: (id: number) => request<Task>(`/tasks/${id}/approve`, { method: 'POST' }),
  reject: (id: number) => request<Task>(`/tasks/${id}/reject`, { method: 'POST' }),
};

// ── Comments ──────────────────────────────────

export const commentApi = {
  list: (taskId: number) => request<Comment[]>(`/tasks/${taskId}/comments`),
  create: (taskId: number, data: CommentCreate) =>
    request<Comment>(`/tasks/${taskId}/comments`, { method: 'POST', body: JSON.stringify(data) }),
  update: (taskId: number, commentId: number, data: CommentCreate) =>
    request<Comment>(`/tasks/${taskId}/comments/${commentId}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (taskId: number, commentId: number) =>
    request<void>(`/tasks/${taskId}/comments/${commentId}`, { method: 'DELETE' }),
};

// ── Cross-references ──────────────────────────

export const referenceApi = {
  list: async (taskId: number) => {
    const res = await request<{ outgoing: CrossReference[]; incoming: CrossReference[] }>(`/tasks/${taskId}/references`);
    return [...(res.outgoing || []), ...(res.incoming || [])];
  },
  create: (taskId: number, data: CrossReferenceCreate) =>
    request<CrossReference>(`/tasks/${taskId}/references`, { method: 'POST', body: JSON.stringify(data) }),
  delete: (id: number) => request<void>(`/references/${id}`, { method: 'DELETE' }),
};

// ── Stages ────────────────────────────────────

export const stageApi = {
  list: (projectId: number) => request<TaskStage[]>(`/stages?project_id=${projectId}`),
  create: (data: StageCreate) => request<TaskStage>('/stages', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: Partial<TaskStage>) =>
    request<TaskStage>(`/stages/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) => request<void>(`/stages/${id}`, { method: 'DELETE' }),
  reorder: (items: { id: number; sort_order: number }[]) =>
    request<void>('/stages/reorder', { method: 'PUT', body: JSON.stringify(items) }),
};

// ── Charts ────────────────────────────────────

export const chartApi = {
  burndown: (scope: number) => request<ChartData>(`/charts/burndown?scope=${scope}`),
  velocity: (scope: number, periods = 12) => request<ChartData>(`/charts/velocity?scope=${scope}&periods=${periods}`),
  cumulativeFlow: (scope: number) => request<ChartData>(`/charts/cumulative-flow?scope=${scope}`),
};
