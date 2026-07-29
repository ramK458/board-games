import { create } from 'zustand';

interface SettingsState {
  activeSubTab: 'tags' | 'stages' | 'hierarchy';
  selectedProjectId: number | null;
  projectName: string;

  setActiveSubTab: (tab: SettingsState['activeSubTab']) => void;
  setSelectedProject: (id: number | null, name?: string) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  activeSubTab: 'tags',
  selectedProjectId: null,
  projectName: '',

  setActiveSubTab: (tab) => set({ activeSubTab: tab }),
  setSelectedProject: (id, name) => set({ selectedProjectId: id, projectName: name || '' }),
}));
