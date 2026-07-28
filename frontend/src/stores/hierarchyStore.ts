import { create } from 'zustand';
import type { HierarchyNode, HierarchyTreeItem } from '../types';
import { hierarchyApi } from '../api/client';

interface HierarchyState {
  tree: HierarchyTreeItem[];
  nodes: Record<number, HierarchyNode>;
  activeNodeId: number | null;
  activeNodeName: string;
  expandedIds: Set<number>;
  loading: boolean;

  loadTree: () => Promise<void>;
  setActiveNode: (id: number | null, name?: string) => void;
  toggleExpanded: (id: number) => void;
}

export const useHierarchyStore = create<HierarchyState>((set, get) => ({
  tree: [],
  nodes: {},
  activeNodeId: null,
  activeNodeName: '',
  expandedIds: new Set(),
  loading: false,

  loadTree: async () => {
    set({ loading: true });
    try {
      const tree = await hierarchyApi.getTree();
      set({ tree, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  setActiveNode: (id, name) => set({ activeNodeId: id, activeNodeName: name || '' }),

  toggleExpanded: (id) => {
    const expanded = new Set(get().expandedIds);
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    set({ expandedIds: expanded });
  },
}));
