import { create } from 'zustand';

export interface Tab {
  id: string;
  type: 'task' | 'list' | 'kanban' | 'gantt' | 'graph' | 'charts' | 'settings',
  title: string;
  nodeId?: number;
  taskId?: number;
}

interface TabState {
  tabs: Tab[];
  activeTabId: string | null;

  openTab: (tab: Tab) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  reorderTabs: (from: number, to: number) => void;
}

export const useTabStore = create<TabState>((set, get) => ({
  tabs: [],
  activeTabId: null,

  openTab: (tab) => {
    const existing = get().tabs.find(t => t.id === tab.id);
    if (existing) {
      set({ activeTabId: tab.id });
      return;
    }
    set(state => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    }));
  },

  closeTab: (id) => {
    set(state => {
      const tabs = state.tabs.filter(t => t.id !== id);
      let activeTabId = state.activeTabId;
      if (activeTabId === id) {
        activeTabId = tabs.length > 0 ? tabs[tabs.length - 1].id : null;
      }
      return { tabs, activeTabId };
    });
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  reorderTabs: (from, to) => {
    set(state => {
      const tabs = [...state.tabs];
      const [moved] = tabs.splice(from, 1);
      tabs.splice(to, 0, moved);
      return { tabs };
    });
  },
}));
