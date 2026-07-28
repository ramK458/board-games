import { useEffect } from 'react';
import TopBar from './TopBar';
import SidebarTree from './SidebarTree';
import TabBar from './TabBar';
import TabContent from './TabContent';
import Toast from '../common/Toast';
import { useHierarchyStore } from '../../stores/hierarchyStore';
import { useUiStore } from '../../stores/uiStore';
import { useWsStore } from '../../stores/wsStore';
import { useTaskStore } from '../../stores/taskStore';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';

export default function AppShell() {
  const sidebarOpen = useUiStore(s => s.sidebarOpen);
  const theme = useUiStore(s => s.theme);
  const loadTree = useHierarchyStore(s => s.loadTree);
  const connect = useWsStore(s => s.connect);
  const applyUpdate = useTaskStore(s => s.applyUpdate);

  useKeyboardShortcuts();

  useEffect(() => {
    document.documentElement.className = theme;
  }, [theme]);

  useEffect(() => {
    loadTree();
    connect(1); // default user id for now
  }, []);

  useEffect(() => {
    const unsub = useWsStore.subscribe((state) => {
      if (state.onMessage) return;
      useWsStore.setState({
        onMessage: (msg) => {
          if (msg.type === 'task_updated') {
            applyUpdate(msg.task);
          }
        },
      });
    });
    return unsub;
  }, []);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        {sidebarOpen && (
          <aside className="w-64 border-r border-gray-200 dark:border-gray-700 overflow-y-auto bg-gray-50 dark:bg-gray-800 shrink-0">
            <SidebarTree />
          </aside>
        )}
        <main className="flex-1 flex flex-col overflow-hidden">
          <TabBar />
          <div className="flex-1 overflow-auto p-4">
            <TabContent />
          </div>
        </main>
      </div>
      <Toast />
    </div>
  );
}
