import { useEffect, useState, useCallback } from 'react';
import { Save, X, Clock, User, Calendar, Tag, Plus, Link, AlertCircle, ChevronDown } from 'lucide-react';
import { useTaskStore } from '../../stores/taskStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { commentApi, referenceApi, stageApi, hierarchyApi, taskApi } from '../../api/client';
import type { Task, Comment, CrossReference, TaskStage, TaskUpdate, User as AppUser } from '../../types';

interface Props {
  taskId: number;
}

export default function TaskDetailView({ taskId }: Props) {
  const task = useTaskStore(s => s.selectedTask);
  const loadTask = useTaskStore(s => s.loadTask);
  const updateTask = useTaskStore(s => s.updateTask);
  const addToast = useNotificationStore(s => s.addToast);

  // ── Local form state (initialised from task) ──
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<Task['status']>('not_done');
  const [priority, setPriority] = useState<Task['priority']>('medium');
  const [stageId, setStageId] = useState<number | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [deadline, setDeadline] = useState('');
  const [daysRequired, setDaysRequired] = useState<number | null>(null);
  const [assigneeId, setAssigneeId] = useState<number | null>(null);
  const [taskType, setTaskType] = useState<Task['task_type']>('open_closure');
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#6366f1');

  const [comments, setComments] = useState<Comment[]>([]);
  const [references, setReferences] = useState<CrossReference[]>([]);
  const [stages, setStages] = useState<TaskStage[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [newComment, setNewComment] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [projectTags, setProjectTags] = useState<{ name: string; color_hex: string }[]>([]);

  // Fetch change history when task changes or history is opened
  useEffect(() => {
    if (!task || !showHistory) return;
    taskApi.history(task.id).then(setHistory).catch(() => {});
  }, [task?.id, showHistory]);

  // Initialise local state when task loads
  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description);
    setStatus(task.status);
    setPriority(task.priority);
    setStageId(task.stage_id);
    setStartDate(task.start_date || '');
    setEndDate(task.end_date || '');
    setDeadline(task.deadline || '');
    setDaysRequired(task.days_to_complete);
    setAssigneeId(task.assignee_id);
    setTaskType(task.task_type);
  }, [task?.id, task?.updated_at]);

  useEffect(() => {
    loadTask(taskId);
    commentApi.list(taskId).then(setComments).catch(() => {});
    referenceApi.list(taskId).then(setReferences).catch(() => {});
  }, [taskId]);

  useEffect(() => {
    if (task?.parent_node_id) {
      stageApi.list(task.parent_node_id).then(setStages).catch(() => {});
      fetch(`/api/projects/${task.parent_node_id}/tags`, { headers: { 'X-User-Id': '1' } })
        .then(r => r.json()).then(setProjectTags).catch(() => {});
    }
  }, [task?.parent_node_id]);

  // Fetch all users for assignee dropdown
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/users', {
          headers: { 'X-User-Id': String(localStorage.getItem('board-games-user-id') || '1') }
        });
        if (res.ok) setUsers(await res.json());
      } catch { /* ignore */ }
    })();
  }, []);

  // ── Dirty tracking — mark dirty when any field changes ──
  const markDirty = useCallback(() => setDirty(true), []);

  // ── Save — only send changed fields ──
  const handleSave = async () => {
    if (!task || !dirty) return;
    setSaving(true);
    try {
      const updates: TaskUpdate = {};
      if (title !== task.title) updates.title = title;
      if (description !== task.description) updates.description = description;
      if (status !== task.status) updates.status = status;
      if (priority !== task.priority) updates.priority = priority;
      if (stageId !== task.stage_id) updates.stage_id = stageId;
      if (startDate !== (task.start_date || '')) updates.start_date = startDate || null;
      if (endDate !== (task.end_date || '')) updates.end_date = endDate || null;
      if (deadline !== (task.deadline || '')) updates.deadline = deadline || null;
      if (daysRequired !== task.days_to_complete) updates.days_to_complete = daysRequired;
      if (assigneeId !== task.assignee_id) updates.assignee_id = assigneeId;
      if (taskType !== task.task_type) updates.task_type = taskType;

      if (Object.keys(updates).length === 0) {
        setDirty(false);
        return;
      }

      await updateTask(task.id, updates);
      addToast('success', 'Task updated');
      setDirty(false);
    } catch (err: any) {
      addToast('error', err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    try {
      const c = await commentApi.create(taskId, { body: newComment });
      setComments([...comments, c]);
      setNewComment('');
    } catch (err: any) {
      addToast('error', err.message || 'Failed to add comment');
    }
  };

  if (!task) {
    return <div className="text-gray-400">Loading...</div>;
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header — Title + Save */}
      <div className="flex items-center justify-between mb-4">
        <input
          type="text"
          value={title}
          onChange={e => { setTitle(e.target.value); markDirty(); }}
          className="text-xl font-semibold bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none flex-1 px-1"
        />
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            taskType === 'approval_required'
              ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
              : 'bg-gray-100 text-gray-500 dark:bg-gray-700'
          }`}>
            {taskType === 'approval_required' ? 'Requires approval' : 'Open'}
          </span>
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded-md transition-colors ${
              dirty
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
            }`}
          >
            <Save size={14} />
            {saving ? 'Saving...' : dirty ? 'Save changes' : 'Saved'}
          </button>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="flex gap-6">
        {/* ─── Left: Form fields ─── */}
        <div className="flex-1 space-y-4">
          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Description</label>
            <textarea
              value={description}
              onChange={e => { setDescription(e.target.value); markDirty(); }}
              rows={4}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Add a description..."
            />
          </div>

          {/* Grid: Status | Priority | Stage */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
              <select
                value={status}
                onChange={e => { setStatus(e.target.value as Task['status']); markDirty(); }}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
              >
                <option value="not_done">Not Done</option>
                <option value="in_progress">In Progress</option>
                <option value="complete">Complete</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Priority</label>
              <select
                value={priority}
                onChange={e => { setPriority(e.target.value as Task['priority']); markDirty(); }}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Stage</label>
              <select
                value={stageId ?? ''}
                onChange={e => { setStageId(e.target.value ? Number(e.target.value) : null); markDirty(); }}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
              >
                <option value="">—</option>
                {stages.filter(s => s.active !== 0).map(s => (
                  <option key={s.id} value={s.id}>{s.stage_name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Grid: Dates */}
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={e => {
                  setStartDate(e.target.value);
                  // If days_required is set, auto-update end_date
                  if (daysRequired && e.target.value) {
                    const s = new Date(e.target.value);
                    s.setDate(s.getDate() + daysRequired - 1);
                    setEndDate(s.toISOString().split('T')[0]);
                  }
                  markDirty();
                }}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={e => {
                  setEndDate(e.target.value);
                  // Derive days_required from start → end
                  if (startDate && e.target.value) {
                    const s = new Date(startDate);
                    const e2 = new Date(e.target.value);
                    const diff = Math.round((e2.getTime() - s.getTime()) / 86400000) + 1;
                    setDaysRequired(diff > 0 ? diff : 1);
                  }
                  markDirty();
                }}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Days Required</label>
              <input
                type="number"
                min={1}
                value={daysRequired ?? ''}
                placeholder="—"
                onChange={e => {
                  const val = e.target.value ? parseInt(e.target.value, 10) : null;
                  setDaysRequired(val);
                  // Auto-update end_date from start_date + days_required
                  if (val && startDate) {
                    const s = new Date(startDate);
                    s.setDate(s.getDate() + val - 1);
                    setEndDate(s.toISOString().split('T')[0]);
                  }
                  markDirty();
                }}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Deadline</label>
              <input
                type="date"
                value={deadline}
                onChange={e => { setDeadline(e.target.value); markDirty(); }}
                className={`w-full px-2 py-1.5 text-sm border rounded bg-white dark:bg-gray-800 ${
                  deadline && new Date(deadline) < new Date() && status !== 'complete'
                    ? 'border-red-400 text-red-600'
                    : 'border-gray-300 dark:border-gray-600'
                }`}
              />
            </div>
          </div>

          {/* Assignee */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Assignee</label>
            <select
              value={assigneeId ?? ''}
              onChange={e => { setAssigneeId(e.target.value ? Number(e.target.value) : null); markDirty(); }}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
            >
              <option value="">Unassigned</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
              ))}
            </select>
          </div>

          {/* Task Type */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Task Type</label>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="task_type"
                  checked={taskType === 'open_closure'}
                  onChange={() => { setTaskType('open_closure'); markDirty(); }}
                  className="accent-blue-600"
                />
                Open / Closure
                <span className="text-xs text-gray-400">— anyone assigned can mark done</span>
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="task_type"
                  checked={taskType === 'approval_required'}
                  onChange={() => { setTaskType('approval_required'); markDirty(); }}
                  className="accent-blue-600"
                />
                Approval Required
                <span className="text-xs text-gray-400">— SU must approve completion</span>
              </label>
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Tags</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {task.tags?.map(tag => (
                <span
                  key={tag.id}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full"
                  style={{ backgroundColor: tag.color_hex + '20', color: tag.color_hex, border: `1px solid ${tag.color_hex}40` }}
                >
                  {tag.tag_name}
                  <span
                    onClick={async () => {
                      try {
                        await fetch(`/api/tasks/${taskId}/tags/${tag.id}`, { method: 'DELETE', headers: { 'X-User-Id': '1' } });
                        loadTask(taskId);
                      } catch {}
                    }}
                    className="cursor-pointer hover:opacity-70"
                  >
                    <X size={10} />
                  </span>
                </span>
              ))}
              {(!task.tags || task.tags.length === 0) && (
                <span className="text-xs text-gray-400">No tags</span>
              )}
            </div>
            <div className="flex gap-2">
              {/* Quick-add from project tags */}
              {projectTags.length > 0 && (
                <select
                  value=""
                  onChange={async e => {
                    const pt = projectTags.find(t => t.name === e.target.value);
                    if (!pt) return;
                    try {
                      await fetch(`/api/tasks/${taskId}/tags`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'X-User-Id': '1' },
                        body: JSON.stringify({ tag_name: pt.name, color_hex: pt.color_hex }),
                      });
                      loadTask(taskId);
                    } catch {}
                  }}
                  className="text-xs border rounded px-2 py-1 dark:bg-gray-800"
                >
                  <option value="">+ project tag...</option>
                  {projectTags.map(pt => (
                    <option key={pt.name} value={pt.name}>● {pt.name}</option>
                  ))}
                </select>
              )}
              <input
                type="text"
                value={newTagName}
                onChange={e => setNewTagName(e.target.value)}
                placeholder="New tag..."
                className="flex-1 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
              />
              <input
                type="color"
                value={newTagColor}
                onChange={e => setNewTagColor(e.target.value)}
                className="w-8 h-7 p-0.5 border border-gray-300 dark:border-gray-600 rounded cursor-pointer"
              />
              <button
                onClick={async () => {
                  if (!newTagName.trim()) return;
                  try {
                    await fetch(`/api/tasks/${taskId}/tags`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'X-User-Id': '1' },
                      body: JSON.stringify({ tag_name: newTagName.trim(), color_hex: newTagColor }),
                    });
                    setNewTagName('');
                    loadTask(taskId);
                  } catch {}
                }}
                className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Add
              </button>
            </div>
          </div>

          {/* Comments */}
          <div>
            <h3 className="text-sm font-medium mb-2">Comments ({comments.length})</h3>
            <div className="space-y-2 mb-3">
              {comments.map(c => (
                <div key={c.id} className="p-2 bg-gray-50 dark:bg-gray-800 rounded text-sm">
                  <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                    <User size={12} /> User #{c.user_id}
                    <span>{new Date(c.created_at).toLocaleString()}</span>
                  </div>
                  <p className="whitespace-pre-wrap">{c.body}</p>
                </div>
              ))}
              {comments.length === 0 && (
                <p className="text-xs text-gray-400">No comments yet.</p>
              )}
            </div>
            <div className="flex gap-2">
              <textarea
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                rows={2}
                className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Add a comment..."
              />
              <button
                onClick={handleAddComment}
                className="px-3 py-1 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 self-end"
              >
                Post
              </button>
            </div>
          </div>
        </div>

        {/* ─── Right: Metadata + References ─── */}
        <div className="w-56 shrink-0 space-y-3 text-sm">
          <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md space-y-2">
            <h4 className="text-xs font-medium text-gray-500 uppercase">Details</h4>
            <div className="flex items-center gap-2 text-xs">
              <User size={12} className="text-gray-400" />
              <span>Created by: User #{task.creator_id}</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Calendar size={12} className="text-gray-400" />
              <span>Created: {new Date(task.created_at).toLocaleDateString()}</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Clock size={12} className="text-gray-400" />
              <span>Updated: {new Date(task.updated_at).toLocaleDateString()}</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Link size={12} className="text-gray-400" />
              <span>{references.length} reference{references.length !== 1 ? 's' : ''}</span>
            </div>
          </div>

          {/* Subtasks (ref_type=subtask) */}
          {(() => {
            const subtasks = references.filter(r => r.ref_type === 'subtask');
            if (subtasks.length === 0) return null;
            return (
              <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">Subtasks</h4>
                <div className="space-y-1">
                  {subtasks.map(ref => (
                    <div key={ref.id} className="flex items-center gap-2 text-xs">
                      <input type="checkbox" className="accent-blue-600" readOnly />
                      <span>Task #{ref.target_task_id}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Cross-references */}
          <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
            <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">References</h4>
            {references.length === 0 ? (
              <p className="text-xs text-gray-400">No links</p>
            ) : (
              <div className="space-y-1">
                {references.filter(r => r.ref_type !== 'subtask').map(ref => (
                  <div key={ref.id} className="text-xs flex items-center gap-1 py-0.5">
                    <span className={`px-1 py-0.5 rounded ${
                      ref.ref_type === 'blocks' ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' :
                      ref.ref_type === 'blocked_by' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300' :
                      ref.ref_type === 'related_to' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' :
                      ref.ref_type === 'duplicates' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' :
                      ref.ref_type === 'caused_by' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {ref.ref_type}
                    </span>
                    <span className="text-gray-500">Task #{ref.target_task_id}</span>
                    {ref.note && <span className="text-gray-400 italic">— {ref.note}</span>}
                  </div>
                ))}
              </div>
            )}
            <button className="mt-2 text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1">
              <Plus size={10} /> Add reference
            </button>
          </div>

          {/* Change History */}
          <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center gap-2 text-xs font-medium text-gray-500 uppercase w-full text-left"
            >
              <ChevronDown size={12} className={`transition-transform ${showHistory ? 'rotate-0' : '-rotate-90'}`} />
              Change History
            </button>
            {showHistory && (
              <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                {history.length === 0 ? (
                  <p className="text-xs text-gray-400">No changes recorded yet</p>
                ) : (
                  history.map((entry) => (
                    <div key={entry.id} className="text-xs py-1 border-b border-gray-100 dark:border-gray-700 last:border-0">
                      <span className="font-medium">{entry.user_name || 'User #' + entry.changed_by}</span>
                      {' '}
                      changed <span className="font-mono text-blue-600">{entry.field_name}</span>
                      {' '}
                      {entry.old_value !== null ? (
                        <span>from <span className="line-through text-red-500">{entry.old_value}</span></span>
                      ) : 'set'}
                      {' '}to <span className="text-green-600">{entry.new_value}</span>
                      <span className="text-gray-400 ml-2">{new Date(entry.changed_at).toLocaleString()}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
