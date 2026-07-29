import { useTabStore } from '../../stores/tabStore';
import ErrorBoundary from '../common/ErrorBoundary';
import TaskListView from '../views/TaskListView';
import TaskDetailView from '../views/TaskDetailView';
import KanbanView from '../views/KanbanView';
import GanttView from '../views/GanttView';
import DependencyGraphView from '../views/DependencyGraphView';
import ChartView from '../views/ChartView';
import SettingsView from '../views/SettingsView';

export default function TabContent() {
  const tabs = useTabStore(s => s.tabs);
  const activeTabId = useTabStore(s => s.activeTabId);
  const activeTab = tabs.find(t => t.id === activeTabId);

  if (!activeTab) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <div className="text-center">
          <div className="text-4xl mb-2">📋</div>
          <p className="text-sm">Select a project or task from the sidebar to get started.</p>
        </div>
      </div>
    );
  }

  const renderView = () => {
    switch (activeTab.type) {
      case 'list':
        return <TaskListView nodeId={activeTab.nodeId!} />;
      case 'task':
        return <TaskDetailView taskId={activeTab.taskId!} />;
      case 'kanban':
        return <KanbanView nodeId={activeTab.nodeId!} />;
      case 'gantt':
        return <GanttView nodeId={activeTab.nodeId!} />;
      case 'graph':
        return <DependencyGraphView nodeId={activeTab.nodeId!} />;
      case 'charts':
        return <ChartView nodeId={activeTab.nodeId!} />;
      case 'settings':
        return <SettingsView />;
      default:
        return <div className="text-gray-400">Unknown view type</div>;
    }
  };

  return <ErrorBoundary>{renderView()}</ErrorBoundary>;
}
