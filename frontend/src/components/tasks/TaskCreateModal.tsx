import { useState, useEffect } from 'react';
import { X, Plus, Link, Search } from 'lucide-react';
import { taskApi, stageApi } from '../../api/client';
import type { TaskStage, User as AppUser, RefType } from '../../types';
import { useTaskStore } from '../../stores/taskStore';
import { useNotificationStore } from '../../stores/notificationStore';

interface Props {
  nodeId: number;
  onClose: () => void;
}

export default function TaskCreateModal({ nodeId, onClose }: Props) {
  const loadTasks = useTaskStore(s => s.loadTasks);
  const addToast = useNotificationStore(s => s.addToast);

  // Core fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('not_done');
  const [priority, setPriority] = useState('medium');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [deadline, setDeadline] = useState('');
  const [assigneeId, setAssigneeId] = useState<number | null>(null);
  const [taskType, setTaskType] = useState<'open_closure' | 'approval_required'>('open_closure');
  const [stageId, setStageId] = useState<number | null>(null);

  // Tags
  const [tagName, setTagName] = useState('');
  const [tagColor, setTagColor] = useState('#6366f1');
  const [tags, setTags] = useState<{ name: string; color: string }[]>([]);

  // Dependencies / relationships
  const [relationships, setRelationships] = useState<{ taskId: number; title: string; type: RefType }[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ id: number; title: string }[]>([]);
  const [showSearch, setShowSearch] = useState(false);

  // Data
  const [stages, setStages] = useState<TaskStage[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    stageApi.list(nodeId).then(setStages).catch(() => {});
    fetch('/api/users', {
      headers: { 'X-User-Id': String(localStorage.getItem('board-games-user-id') || '1') }
    }).then(r => r.json()).then(setUsers).catch(() => {});
  }, [nodeId]);

  // Search for existing tasks to link
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    const timer = setTimeout(async () => {
      try {
        const res = await taskApi.list({ search: searchQuery, per_page: 10 });
        setSearchResults(res.items.filter(t => !relationships.some(r => r.taskId === t.id)));
      } catch { setSearchResults([]); }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const addRelationship = (taskId: number, taskTitle: string, type: RefType) => {
    setRelationships(prev => [...prev, { taskId, title: taskTitle, type }]);
    setShowSearch(false);
    setSearchQuery('');
  };

  const removeRelationship = (taskId: number) => {
    setRelationships(prev => prev.filter(r => r.taskId !== taskId));
  };

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      // Create task
      const created = await taskApi.create({
        title: title.trim(),
        description,
        status: status as any,
        priority: priority as any,
        parent_node_id: nodeId,
        stage_id: stageId,
        assignee_id: assigneeId,
        start_date: startDate || null,
        end_date: endDate || null,
        deadline: deadline || null,
        task_type: taskType,
      });

      // Add tags via API
      for (const tag of tags) {
        await fetch(`/api/tasks/${created.id}/tags`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': String(localStorage.getItem('board-games-user-id') || '1'),
          },
          body: JSON.stringify({ tag_name: tag.name, color_hex: tag.color }),
        });
      }

      // Add relationships via API
      for (const rel of relationships) {
        await fetch(`/api/tasks/${created.id}/references`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': String(localStorage.getItem('board-games-user-id') || '1'),
          },
          body: JSON.stringify({ target_task_id: rel.taskId, ref_type: rel.type }),
        });
      }

      addToast('success', 'Task created');
      loadTasks({ scope: nodeId, per_page: 100 });
      onClose();
    } catch (err: any) {
      addToast('error', err.message || 'Failed to create task');
    } finally {
      setSaving(false);
    }
  };

  const addTag = () => {
    if (!tagName.trim()) return;
    setTags(prev => [...prev, { name: tagName.trim(), color: tagColor }]);
    setTagName('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <h3 className="font-medium">New Task</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
            <X size={16} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Title *</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              placeholder="Add details..."
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Row 1: Status | Priority | Stage */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
              <select value={status} onChange={e => setStatus(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700">
                <option value="not_done">Not Done</option>
                <option value="in_progress">In Progress</option>
                <option value="complete">Complete</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Stage</label>
              <select value={stageId ?? ''} onChange={e => setStageId(e.target.value ? Number(e.target.value) : null)}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700">
                <option value="">—</option>
                {stages.map(s => <option key={s.id} value={s.id}>{s.stage_name}</option>)}
              </select>
            </div>
          </div>

          {/* Row 2: Start Date | End Date | Deadline */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Start Date</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">End Date</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Deadline</label>
              <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700" />
            </div>
          </div>

          {/* Assignee */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Assignee</label>
            <select value={assigneeId ?? ''} onChange={e => setAssigneeId(e.target.value ? Number(e.target.value) : null)}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700">
              <option value="">Unassigned</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
            </select>
          </div>

          {/* Task Type */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Task Type</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" name="tt" checked={taskType === 'open_closure'}
                  onChange={() => setTaskType('open_closure')} className="accent-blue-600" />
                Open / Closure
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" name="tt" checked={taskType === 'approval_required'}
                  onChange={() => setTaskType('approval_required')} className="accent-blue-600" />
                Approval Required
              </label>
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Tags</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {tags.map((tag, i) => (
                <span key={i}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full"
                  style={{ backgroundColor: tag.color + '20', color: tag.color, border: `1px solid ${tag.color}40` }}>
                  {tag.name}
                  <X size={10} className="cursor-pointer hover:opacity-70"
                    onClick={() => setTags(prev => prev.filter((_, j) => j !== i))} />
                </span>
              ))}
              {tags.length === 0 && <span className="text-xs text-gray-400">No tags</span>}
            </div>
            <div className="flex gap-2">
              <input type="text" value={tagName} onChange={e => setTagName(e.target.value)}
                placeholder="Tag name"
                className="flex-1 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }} />
              <input type="color" value={tagColor} onChange={e => setTagColor(e.target.value)}
                className="w-8 h-7 p-0.5 border border-gray-300 dark:border-gray-600 rounded cursor-pointer" />
              <button onClick={addTag}
                className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600">
                Add
              </button>
            </div>
          </div>

          {/* Dependencies / Relationships */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-gray-500">Dependencies / Relationships</label>
              <button onClick={() => setShowSearch(!showSearch)}
                className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1">
                <Link size={12} /> {showSearch ? 'Cancel' : 'Link task'}
              </button>
            </div>

            {showSearch && (
              <div className="mb-2 p-2 border border-gray-200 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-800">
                <div className="flex gap-2 mb-2">
                  <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search tasks by title..."
                    className="flex-1 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                    autoFocus />
                  <select id="rel-type" defaultValue="related_to"
                    className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700">
                    <option value="blocks">blocks</option>
                    <option value="blocked_by">blocked by</option>
                    <option value="related_to">related to</option>
                    <option value="duplicates">duplicates</option>
                    <option value="caused_by">caused by</option>
                    <option value="subtask">subtask</option>
                  </select>
                </div>
                {searchResults.length > 0 ? (
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {searchResults.map(t => (
                      <div key={t.id}
                        className="flex items-center justify-between px-2 py-1 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer"
                        onClick={() => {
                          const sel = document.getElementById('rel-type') as HTMLSelectElement;
                          addRelationship(t.id, t.title, sel.value as RefType);
                        }}>
                        <span className="truncate">#{t.id} {t.title}</span>
                        <Plus size={10} className="shrink-0 text-gray-400" />
                      </div>
                    ))}
                  </div>
                ) : searchQuery.trim() ? (
                  <p className="text-xs text-gray-400">No matching tasks</p>
                ) : null}
              </div>
            )}

            {relationships.length > 0 && (
              <div className="space-y-1">
                {relationships.map(rel => (
                  <div key={rel.taskId}
                    className="flex items-center gap-2 px-2 py-1 text-xs bg-gray-50 dark:bg-gray-800 rounded">
                    <span className={`px-1 py-0.5 rounded text-[10px] font-medium ${
                      rel.type === 'blocks' ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' :
                      rel.type === 'blocked_by' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300' :
                      rel.type === 'subtask' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' :
                      rel.type === 'duplicates' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' :
                      'bg-gray-100 text-gray-600 dark:bg-gray-700'
                    }`}>
                      {rel.type}
                    </span>
                    <span className="flex-1 truncate">{rel.title}</span>
                    <X size={10} className="cursor-pointer text-gray-400 hover:text-red-500 shrink-0"
                      onClick={() => removeRelationship(rel.taskId)} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700 shrink-0">
          <button onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-md hover:bg-gray-100 dark:hover:bg-gray-700">
            Cancel
          </button>
          <button onClick={handleSubmit}
            disabled={!title.trim() || saving}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
            {saving ? 'Creating...' : 'Create Task'}
          </button>
        </div>
      </div>
    </div>
  );
}
