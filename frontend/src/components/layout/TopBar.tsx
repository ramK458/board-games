import { useState, useEffect, useRef } from 'react';
import {
  Search,
  PanelLeftClose,
  PanelLeft,
  Sun,
  Moon,
  Plus,
  Settings,
  Palette,
  Columns3,
  Shield,
  Layers,
} from 'lucide-react';
import { useUiStore } from '../../stores/uiStore';
import { useTabStore, type Tab } from '../../stores/tabStore';
import { useHierarchyStore } from '../../stores/hierarchyStore';
import { useNotificationStore } from '../../stores/notificationStore';
import TaskCreateModal from '../tasks/TaskCreateModal';
import type { User as AppUser } from '../../types';

const views = [
  { key: 'table' as const, label: 'Table', tabType: 'list' as Tab['type'] },
  { key: 'kanban' as const, label: 'Kanban', tabType: 'kanban' as Tab['type'] },
  { key: 'gantt' as const, label: 'Gantt', tabType: 'gantt' as Tab['type'] },
  { key: 'graph' as const, label: 'Graph', tabType: 'graph' as Tab['type'] },
  { key: 'charts' as const, label: 'Charts', tabType: 'charts' as Tab['type'] },
] as const;

export default function TopBar() {
  const sidebarOpen = useUiStore(s => s.sidebarOpen);
  const toggleSidebar = useUiStore(s => s.toggleSidebar);
  const currentView = useUiStore(s => s.currentView);
  const setView = useUiStore(s => s.setView);
  const theme = useUiStore(s => s.theme);
  const toggleTheme = useUiStore(s => s.toggleTheme);
  const searchQuery = useUiStore(s => s.searchQuery);
  const setSearchQuery = useUiStore(s => s.setSearchQuery);
  const filterUserId = useUiStore(s => s.filterUserId);
  const setFilterUser = useUiStore(s => s.setFilterUser);
  const activeNodeId = useHierarchyStore(s => s.activeNodeId);
  const openTab = useTabStore(s => s.openTab);

  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState<number>(() => {
    return Number(localStorage.getItem('board-games-user-id')) || 1;
  });
  const menuRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/users', {
      headers: { 'X-User-Id': String(localStorage.getItem('board-games-user-id') || '1') }
    })
      .then(r => r.json())
      .then(setUsers)
      .catch(() => {});
  }, []);

  // Close user menu and settings on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const currentUser = users.find(u => u.id === currentUserId);
  const initials = currentUser?.name?.split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase() || '?';

  const switchUser = (id: number) => {
    localStorage.setItem('board-games-user-id', String(id));
    setCurrentUserId(id);
    setShowUserMenu(false);
    window.location.reload();
  };

  const handleNewTask = () => {
    if (activeNodeId) {
      setShowTaskModal(true);
    } else {
      alert('Select a project or feature from the sidebar first.');
    }
  };

  const handleViewSwitch = (v: typeof views[number]) => {
    setView(v.key);
    if (!activeNodeId) return;
    const tabId = `${v.tabType}-${activeNodeId}`;
    const activeNodeName = useHierarchyStore.getState().activeNodeName;
    openTab({ id: tabId, type: v.tabType, title: `${activeNodeName || 'View'} — ${v.label}`, nodeId: activeNodeId });
  };

  const addToast = useNotificationStore(s => s.addToast);

  const handleConfigAction = (action: string) => {
    setShowSettings(false);
    openTab({ id: 'settings', type: 'settings', title: 'Settings' });
    import('../../stores/settingsStore').then(m => {
      if (action === 'stages') m.useSettingsStore.getState().setActiveSubTab('stages');
      else if (action === 'tags') m.useSettingsStore.getState().setActiveSubTab('tags');
      else if (action === 'hierarchy') m.useSettingsStore.getState().setActiveSubTab('hierarchy');
    });
  };

  return (
    <header className="h-12 border-b border-gray-200 dark:border-gray-700 flex items-center px-3 gap-3 bg-white dark:bg-gray-900 shrink-0">
      {/* Sidebar toggle */}
      <button onClick={toggleSidebar} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded" title="Toggle sidebar">
        {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
      </button>

      {/* App name */}
      <span className="font-bold text-sm mr-2">Board Games</span>

      {/* View switcher */}
      <div className="flex gap-1">
        {views.map(v => (
          <button
            key={v.key}
            onClick={() => handleViewSwitch(v)}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              currentView === v.key
                ? 'bg-blue-600 text-white'
                : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* User filter */}
      <div className="flex items-center gap-1">
        <select
          value={filterUserId ?? ''}
          onChange={e => setFilterUser(e.target.value ? Number(e.target.value) : null)}
          className="text-xs border border-gray-200 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400"
        >
          <option value="">All Users</option>
          {users.map(u => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
      </div>

      {/* Search */}
      <div className="flex-1 flex justify-center">
        <div className="relative max-w-md w-full">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search tasks... (Ctrl+K)"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-7 pr-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* New Task */}
      <button
        onClick={handleNewTask}
        className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
        title={activeNodeId ? 'New Task (Ctrl+N)' : 'Select a node first'}
      >
        <Plus size={18} />
      </button>

      {/* Theme toggle */}
      <button onClick={toggleTheme} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded" title="Toggle theme">
        {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
      </button>

      {/* Settings / Config */}
      <div className="relative" ref={settingsRef}>
        <button onClick={() => setShowSettings(!showSettings)}
          className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded" title="Configuration">
          <Settings size={18} />
        </button>

        {showSettings && (
          <div className="absolute right-0 top-full mt-1 w-52 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50">
            <div className="px-3 py-2 text-xs text-gray-500 border-b border-gray-200 dark:border-gray-700 font-medium">
              Configure
            </div>

            <button className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              onClick={() => handleConfigAction('stages')}>
              <Columns3 size={14} className="text-gray-400" />
              <span>Stages (Kanban columns)</span>
              <span className="ml-auto text-[10px] text-gray-400">Project level</span>
            </button>

            <button className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              onClick={() => handleConfigAction('tags')}>
              <Palette size={14} className="text-gray-400" />
              <span>Tags & Colors</span>
              <span className="ml-auto text-[10px] text-gray-400">Task level</span>
            </button>

            <button className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              onClick={() => handleConfigAction('hierarchy')}>
              <Layers size={14} className="text-gray-400" />
              <span>Hierarchy Levels</span>
              <span className="ml-auto text-[10px] text-gray-400">Config file</span>
            </button>

            <button className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              onClick={() => handleConfigAction('permissions')}>
              <Shield size={14} className="text-gray-400" />
              <span>Permissions</span>
              <span className="ml-auto text-[10px] text-gray-400">Config file</span>
            </button>
          </div>
        )}
      </div>

      {/* User avatar / switcher */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setShowUserMenu(!showUserMenu)}
          className="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold hover:bg-blue-700 transition-colors"
          title={`Logged in as ${currentUser?.name || 'Unknown'}`}
        >
          {initials}
        </button>

        {showUserMenu && (
          <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50">
            <div className="px-3 py-2 text-xs text-gray-500 border-b border-gray-200 dark:border-gray-700">
              Switch user
            </div>
            {users.map(u => (
              <button
                key={u.id}
                onClick={() => switchUser(u.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                  u.id === currentUserId ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : ''
                }`}
              >
                <div className="w-5 h-5 rounded-full bg-blue-500 text-white flex items-center justify-center text-[10px] font-bold">
                  {u.name.split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div className="text-left flex-1">
                  <div className="text-xs font-medium">{u.name}</div>
                  <div className="text-[10px] text-gray-400">{u.role}</div>
                </div>
                {u.id === currentUserId && <span className="text-xs">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Task create modal */}
      {showTaskModal && activeNodeId && (
        <TaskCreateModal nodeId={activeNodeId} onClose={() => setShowTaskModal(false)} />
      )}
    </header>
  );
}
