import { useEffect, useState } from 'react';
import { Plus, ArrowUpDown, Calendar, AlertCircle, User } from 'lucide-react';
import { useTaskStore } from '../../stores/taskStore';
import { useTabStore } from '../../stores/tabStore';
import { useUiStore } from '../../stores/uiStore';
import { hierarchyApi } from '../../api/client';
import TaskCreateModal from '../tasks/TaskCreateModal';

interface Props {
  nodeId: number;
}

const statusColors: Record<string, string> = {
  not_done: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  complete: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
};

const priorityColors: Record<string, string> = {
  low: 'border-l-gray-400',
  medium: 'border-l-yellow-500',
  high: 'border-l-orange-500',
  critical: 'border-l-red-600',
};

export default function TaskListView({ nodeId }: Props) {
  const tasks = useTaskStore(s => s.tasks);
  const loading = useTaskStore(s => s.loading);
  const loadTasks = useTaskStore(s => s.loadTasks);
  const openTab = useTabStore(s => s.openTab);
  const searchQuery = useUiStore(s => s.searchQuery);
  const [nodeName, setNodeName] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    loadTasks({ scope: nodeId, per_page: 100 });
    hierarchyApi.getNode(nodeId).then(n => setNodeName(n.name)).catch(() => {});
  }, [nodeId]);

  const handleTaskClick = (taskId: number, title: string) => {
    openTab({ id: `task-${taskId}`, type: 'task', title, taskId });
  };

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-12 bg-gray-100 dark:bg-gray-800 rounded" />
        ))}
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">{nodeName}</h2>
          <p className="text-sm text-gray-500">{tasks.length} tasks</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors"
        >
          <Plus size={14} />
          New Task
        </button>
      </div>

      {/* Filters summary */}
      <div className="flex gap-2 mb-3 text-xs">
        <input
          type="text"
          placeholder="Filter by title..."
          className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
        />
        <select className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800">
          <option value="">All Status</option>
          <option value="not_done">Not Done</option>
          <option value="in_progress">In Progress</option>
          <option value="complete">Complete</option>
        </select>
        <select className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800">
          <option value="">All Priority</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
      </div>

      {/* Table */}
      {tasks.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <div className="text-3xl mb-2">📝</div>
          <p className="text-sm">No tasks yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="space-y-1">
          {/* Header row */}
          <div className="flex items-center gap-3 px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">
            <span className="flex-1">Title</span>
            <span className="w-20">Status</span>
            <span className="w-20">Priority</span>
            <span className="w-24">Assignee</span>
            <span className="w-24">Deadline</span>
          </div>

          {/* Task rows */}
          {tasks.map(task => (
            <div
              key={task.id}
              onClick={() => handleTaskClick(task.id, task.title)}
              className={`flex items-center gap-3 px-3 py-2.5 text-sm cursor-pointer rounded border-l-2 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 ${priorityColors[task.priority] || 'border-l-transparent'}`}
            >
              <span className="flex-1 truncate font-medium">{task.title}</span>

              <span className={`w-20 text-center text-xs px-2 py-0.5 rounded-full ${statusColors[task.status] || ''}`}>
                {task.status.replace('_', ' ')}
              </span>

              <span className="w-20 text-center text-xs capitalize">
                {task.priority}
              </span>

              <span className="w-24 flex items-center gap-1 text-xs text-gray-500">
                <User size={12} />
                {task.assignee_id ? `User #${task.assignee_id}` : '—'}
              </span>

              <span className="w-24 flex items-center gap-1 text-xs">
                {task.deadline ? (
                  <>
                    <Calendar size={12} className="text-gray-400" />
                    <span className={new Date(task.deadline) < new Date() && task.status !== 'complete' ? 'text-red-600 font-medium' : ''}>
                      {task.deadline}
                    </span>
                  </>
                ) : (
                  <span className="text-gray-400">—</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreateModal && (
        <TaskCreateModal nodeId={nodeId} onClose={() => setShowCreateModal(false)} />
      )}
    </div>
  );
}
