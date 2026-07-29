// ── Hierarchy ──────────────────────────────────

export interface Tag {
  name: string;
  color_hex: string;
}

export interface HierarchyLevel {
  id: number;
  name: string;
  parent_level_id: number | null;
  sort_order: number;
  config: Record<string, unknown>;
}

export interface HierarchyNode {
  id: number;
  level_id: number;
  parent_node_id: number | null;
  name: string;
  description: string;
  super_user_id: number | null;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface HierarchyTreeItem {
  id: number;
  name: string;
  level: string;
  children: HierarchyTreeItem[];
}

// ── Tasks ──────────────────────────────────────

export type TaskStatus = 'not_done' | 'in_progress' | 'complete';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';
export type TaskType = 'open_closure' | 'approval_required';

export interface TaskTag {
  id: number;
  tag_name: string;
  color_hex: string;
}

export interface Task {
  id: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  start_date: string | null;
  end_date: string | null;
  deadline: string | null;
  parent_node_id: number;
  assignee_id: number | null;
  task_type: TaskType;
  stage_id: number | null;
  days_to_complete: number | null;
  creator_id: number;
  created_at: string;
  updated_at: string;
  tags: TaskTag[];
  comments_count: number;
}

export interface TaskCreate {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  start_date?: string | null;
  end_date?: string | null;
  deadline?: string | null;
  parent_node_id: number;
  assignee_id?: number | null;
  task_type?: TaskType;
  stage_id?: number | null;
  days_to_complete?: number | null;
}

export interface TaskUpdate {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  start_date?: string | null;
  end_date?: string | null;
  deadline?: string | null;
  parent_node_id?: number;
  assignee_id?: number | null;
  task_type?: TaskType;
  stage_id?: number | null;
  days_to_complete?: number | null;
}

// ── Comments ──────────────────────────────────

export interface Comment {
  id: number;
  task_id: number;
  user_id: number;
  body: string;
  created_at: string;
  edited_at: string | null;
}

export interface CommentCreate {
  body: string;
}

// ── Cross-references ──────────────────────────

export type RefType = 'blocks' | 'blocked_by' | 'duplicates' | 'related_to' | 'caused_by' | 'subtask';

export interface CrossReference {
  id: number;
  source_task_id: number;
  target_task_id: number;
  ref_type: RefType;
  note: string;
  created_at: string;
}

export interface CrossReferenceCreate {
  target_task_id: number;
  ref_type: RefType;
  note?: string;
}

// ── Stages ────────────────────────────────────

export interface TaskStage {
  id: number;
  project_id: number;
  stage_name: string;
  sort_order: number;
  color_hex: string;
  active: number;
}

export interface StageCreate {
  project_id: number;
  stage_name: string;
  sort_order: number;
  color_hex: string;
}

// ── Users ─────────────────────────────────────

export type UserRole = 'admin' | 'super_user' | 'user';

export interface User {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  config: Record<string, unknown>;
}

// ── Charts ────────────────────────────────────

export interface ChartData {
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    backgroundColor?: string;
    borderColor?: string;
  }[];
}

// ── API Responses ─────────────────────────────

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pages: number;
}

// ── WebSocket ─────────────────────────────────

export interface WsLockTask {
  type: 'lock_task';
  task_id: number;
}

export interface WsUnlockTask {
  type: 'unlock_task';
  task_id: number;
}

export interface WsSubscribe {
  type: 'subscribe';
  scope: 'node';
  id: number;
}

export type WsClientMessage = WsLockTask | WsUnlockTask | WsSubscribe;

export interface WsTaskUpdated {
  type: 'task_updated';
  task: Task;
}

export interface WsTaskLocked {
  type: 'task_locked';
  task_id: number;
  locked_by: number;
}

export interface WsTaskUnlocked {
  type: 'task_unlocked';
  task_id: number;
}

export interface WsLockDenied {
  type: 'lock_denied';
  task_id: number;
  locked_by: number;
}

export type WsServerMessage = WsTaskUpdated | WsTaskLocked | WsTaskUnlocked | WsLockDenied;
