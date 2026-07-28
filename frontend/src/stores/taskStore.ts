import { create } from 'zustand';
import type { Task, TaskUpdate } from '../types';
import { taskApi } from '../api/client';

interface TaskState {
  tasks: Task[];
  total: number;
  page: number;
  loading: boolean;
  selectedTask: Task | null;

  loadTasks: (params?: Record<string, string | number>) => Promise<void>;
  loadTask: (id: number) => Promise<void>;
  updateTask: (id: number, data: TaskUpdate) => Promise<Task>;
  setSelectedTask: (task: Task | null) => void;
  applyUpdate: (task: Task) => void;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  total: 0,
  page: 1,
  loading: false,
  selectedTask: null,

  loadTasks: async (params = {}) => {
    set({ loading: true });
    try {
      const res = await taskApi.list(params);
      set({ tasks: res.items, total: res.total, page: res.page, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  loadTask: async (id) => {
    try {
      const task = await taskApi.get(id);
      set({ selectedTask: task });
    } catch { /* ignore */ }
  },

  updateTask: async (id, data) => {
    const updated = await taskApi.update(id, data);
    const tasks = get().tasks.map(t => t.id === id ? updated : t);
    set({ tasks, selectedTask: updated });
    return updated;
  },

  setSelectedTask: (task) => set({ selectedTask: task }),

  applyUpdate: (task) => {
    const tasks = get().tasks.map(t => t.id === task.id ? task : t);
    set({ tasks, selectedTask: task });
  },
}));
