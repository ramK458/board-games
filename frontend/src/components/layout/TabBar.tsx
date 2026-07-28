import { X } from 'lucide-react';
import { useTabStore } from '../../stores/tabStore';

export default function TabBar() {
  const tabs = useTabStore(s => s.tabs);
  const activeTabId = useTabStore(s => s.activeTabId);
  const setActiveTab = useTabStore(s => s.setActiveTab);
  const closeTab = useTabStore(s => s.closeTab);

  if (tabs.length === 0) return null;

  return (
    <div className="flex items-center border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 overflow-x-auto shrink-0">
      {tabs.map(tab => (
        <div
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={`flex items-center gap-1 px-3 py-2 text-xs cursor-pointer border-r border-gray-200 dark:border-gray-700 whitespace-nowrap transition-colors ${
            activeTabId === tab.id
              ? 'bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 border-b-2 border-b-blue-600'
              : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400'
          }`}
        >
          {/* Icon per type */}
          <span className="shrink-0">
            {tab.type === 'task' ? '📋' : tab.type === 'list' ? '☰' : tab.type === 'kanban' ? '📊' : tab.type === 'gantt' ? '📈' : tab.type === 'graph' ? '🔗' : '📉'}
          </span>

          <span className="truncate max-w-32">{tab.title}</span>

          <button
            onClick={e => { e.stopPropagation(); closeTab(tab.id); }}
            className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded ml-1"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
