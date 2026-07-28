import { create } from 'zustand';

type ViewType = 'table' | 'kanban' | 'gantt' | 'graph' | 'charts';

interface UiState {
  sidebarOpen: boolean;
  currentView: ViewType;
  theme: 'light' | 'dark';
  searchQuery: string;
  filterStatus: string[];
  filterPriority: string[];

  toggleSidebar: () => void;
  setView: (view: ViewType) => void;
  toggleTheme: () => void;
  setSearchQuery: (q: string) => void;
  setFilterStatus: (s: string[]) => void;
  setFilterPriority: (p: string[]) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: true,
  currentView: 'table',
  theme: (localStorage.getItem('board-games-theme') as 'light' | 'dark') || 'light',
  searchQuery: '',
  filterStatus: [],
  filterPriority: [],

  toggleSidebar: () => set(s => ({ sidebarOpen: !s.sidebarOpen })),
  setView: (view) => set({ currentView: view }),
  toggleTheme: () => set(s => {
    const theme = s.theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('board-games-theme', theme);
    return { theme };
  }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setFilterStatus: (s) => set({ filterStatus: s }),
  setFilterPriority: (p) => set({ filterPriority: p }),
}));
