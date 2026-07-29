import { useEffect, useState, useCallback } from 'react';
import { Trash2, GripVertical, Users, Columns3 } from 'lucide-react';
import { DndContext, useDraggable, useDroppable, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { stageApi, taskApi } from '../../api/client';
import type { TaskStage, Task, User } from '../../types';
import { useTabStore } from '../../stores/tabStore';
import { useUiStore } from '../../stores/uiStore';
import { useNotificationStore } from '../../stores/notificationStore';

type KanbanMode = 'stage' | 'user';

interface Props { nodeId: number }

function DraggableTask({ task, groupId }: { task: Task; groupId: string }) {
  const openTab = useTabStore(s => s.openTab);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `task-${task.id}`,
    data: { type: 'task', task, groupId },
  });
  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    opacity: isDragging ? 0.5 : 1,
  } : undefined;

  return (
    <div
      ref={setNodeRef} {...listeners} {...attributes}
      style={style}
      onClick={() => openTab({ id: `task-${task.id}`, type: 'task', title: task.title, taskId: task.id })}
      className="p-2 bg-white dark:bg-gray-700 rounded shadow-sm text-sm cursor-grab hover:shadow-md transition-shadow"
    >
      <div className="font-medium truncate">{task.title}</div>
      <div className="flex items-center gap-2 mt-1">
        {task.tags?.slice(0, 3).map(tag => (
          <span key={tag.id} className="text-xs px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: tag.color_hex + '20', color: tag.color_hex }}>{tag.tag_name}</span>
        ))}
      </div>
      {task.priority && task.priority !== 'medium' && (
        <div className="mt-1 text-xs">
          <span className={`px-1 py-0.5 rounded ${
            task.priority === 'high' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300' :
            task.priority === 'critical' ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' :
            'bg-green-100 text-green-700'
          }`}>{task.priority}</span>
        </div>
      )}
    </div>
  );
}

function KanbanColumn({ stage, tasks, onDelete }: { stage: TaskStage; tasks: Task[]; onDelete: (id: number) => void }) {
  const { isOver, setNodeRef } = useDroppable({ id: `stage-${stage.id}`, data: { groupType: 'stage', stageId: stage.id } });

  return (
    <div
      ref={setNodeRef}
      className={`w-72 shrink-0 flex flex-col bg-gray-50 dark:bg-gray-800 rounded-lg transition-colors ${isOver ? 'ring-2 ring-blue-400' : ''}`}
    >
      <DraggableStageHeader stage={stage} tasks={tasks} onDelete={onDelete} />
      <div className="flex-1 p-2 space-y-2 overflow-y-auto">
        {tasks.map(task => (
          <DraggableTask key={task.id} task={task} groupId={`stage-${stage.id}`} />
        ))}
        {tasks.length === 0 && (
          <div className="text-xs text-gray-400 text-center py-8 border border-dashed border-gray-300 dark:border-gray-600 rounded">
            Drop task here
          </div>
        )}
      </div>
    </div>
  );
}

function DraggableStageHeader({ stage, tasks, onDelete }: { stage: TaskStage; tasks: Task[]; onDelete: (id: number) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `stage-header-${stage.id}`,
    data: { type: 'stage', stageId: stage.id, sortOrder: stage.sort_order },
  });
  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : undefined,
  } : undefined;

  return (
    <div
      ref={setNodeRef}
      className={`flex items-center justify-between px-3 py-2 font-medium text-sm border-b border-gray-200 dark:border-gray-700 ${
        isDragging ? 'shadow-lg bg-white dark:bg-gray-700' : ''
      }`}
      style={{ ...(style || {}), borderLeftColor: stage.color_hex, borderLeftWidth: 3 }}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <button {...listeners} {...attributes}
          className="text-gray-400 hover:text-gray-600 cursor-grab shrink-0" title="Drag to reorder stage">
          <GripVertical size={14} />
        </button>
        <span className="truncate">{stage.stage_name}</span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-xs text-gray-400">{tasks.length}</span>
        <button onClick={() => onDelete(stage.id)}
          className="text-gray-400 hover:text-red-500" title="Hide stage">
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

function UserColumn({ user, tasks, allUsers }: { user: User | null; tasks: Task[]; allUsers: User[] }) {
  const groupId = user ? `user-${user.id}` : 'user-unassigned';
  const { isOver, setNodeRef } = useDroppable({
    id: groupId,
    data: { groupType: 'user', userId: user?.id ?? null },
  });

  const initials = user
    ? user.name.split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase()
    : '?';
  const assignedUser = user;
  const bgColor = assignedUser ? 'bg-blue-500' : 'bg-gray-400';

  return (
    <div
      ref={setNodeRef}
      className={`w-72 shrink-0 flex flex-col bg-gray-50 dark:bg-gray-800 rounded-lg transition-colors ${isOver ? 'ring-2 ring-blue-400' : ''}`}
    >
      {/* User header */}
      <div className="flex items-center justify-between px-3 py-2 font-medium text-sm border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-6 h-6 rounded-full ${bgColor} text-white flex items-center justify-center text-[10px] font-bold shrink-0`}>
            {initials}
          </div>
          <span className="truncate">{user ? user.name : 'Unassigned'}</span>
        </div>
        <span className="text-xs text-gray-400 shrink-0">{tasks.length}</span>
      </div>
      {/* Task cards */}
      <div className="flex-1 p-2 space-y-2 overflow-y-auto">
        {tasks.map(task => (
          <DraggableTask key={task.id} task={task} groupId={groupId} />
        ))}
        {tasks.length === 0 && (
          <div className="text-xs text-gray-400 text-center py-8 border border-dashed border-gray-300 dark:border-gray-600 rounded">
            Drop task here
          </div>
        )}
      </div>
    </div>
  );
}

export default function KanbanView({ nodeId }: Props) {
  const [kanbanMode, setKanbanMode] = useState<KanbanMode>('stage');
  const [stages, setStages] = useState<TaskStage[]>([]);
  const [tasks, setTasks] = useState<Record<number, Task[]>>({});
  const [users, setUsers] = useState<User[]>([]);
  const [userTasks, setUserTasks] = useState<Record<string, Task[]>>({});
  const filterUserId = useUiStore(s => s.filterUserId);
  const addToast = useNotificationStore(s => s.addToast);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/users', {
        headers: { 'X-User-Id': String(localStorage.getItem('board-games-user-id') || '1') }
      });
      setUsers(await res.json());
    } catch { /* ignore */ }
  }, []);

  const loadStageMode = useCallback(async () => {
    try {
      let s = await stageApi.list(nodeId);
      if (s.length === 0) {
        for (let i = 0; i < 5; i++) {
          const name = i === 0 ? 'Not Started' : String(i);
          const colors = ['#9ca3af', '#6b7280', '#3b82f6', '#f59e0b', '#22c55e'];
          await stageApi.create({
            project_id: nodeId,
            stage_name: name,
            color_hex: colors[i] ?? '#6366f1',
            sort_order: i,
          });
        }
        s = await stageApi.list(nodeId);
      }
      setStages(s);
      const taskMap: Record<number, Task[]> = {};
      for (const stage of s) {
        const params: Record<string, number> = { stage_id: stage.id, per_page: 100 };
        if (filterUserId) params.assignee_id = filterUserId;
        const res = await taskApi.list(params);
        taskMap[stage.id] = res.items;
      }
      setTasks(taskMap);
    } catch {}
  }, [nodeId, filterUserId]);

  const loadUserMode = useCallback(async () => {
    try {
      const res = await taskApi.list({ scope: nodeId, per_page: 100 });
      const allTasks = res.items;

      // Group tasks by assignee_id
      const grouped: Record<string, Task[]> = {};
      for (const task of allTasks) {
        const key = task.assignee_id ? `user-${task.assignee_id}` : 'user-unassigned';
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(task);
      }
      setUserTasks(grouped);
    } catch {}
  }, [nodeId]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    if (kanbanMode === 'stage') {
      loadStageMode();
    } else {
      loadUserMode();
    }
  }, [kanbanMode, loadStageMode, loadUserMode]);

  const deleteStage = async (id: number) => {
    try {
      await stageApi.update(id, { active: false });
      addToast('success', 'Stage hidden from view');
      loadStageMode();
    } catch { addToast('error', 'Failed to hide stage'); }
  };

  const visibleStages = stages.filter(s => s.active !== 0);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = async (event: any) => {
    const { active, over } = event;
    if (!over) return;

    const dragType = active.data.current?.type;

    // ── Stage mode: handle stage column reorder ──
    if (kanbanMode === 'stage' && dragType === 'stage') {
      const fromStageId = active.data.current?.stageId;
      const toStageId = over.data.current?.stageId;
      if (!fromStageId || !toStageId || fromStageId === toStageId) return;

      const fromIdx = visibleStages.findIndex(s => s.id === fromStageId);
      const toIdx = visibleStages.findIndex(s => s.id === toStageId);
      if (fromIdx === -1 || toIdx === -1) return;

      const reordered = [...visibleStages];
      const [moved] = reordered.splice(fromIdx, 1);
      reordered.splice(toIdx, 0, moved);
      const items = reordered.map((s, i) => ({ id: s.id, sort_order: i }));

      try {
        await stageApi.reorder(items);
        addToast('success', 'Stages reordered');
        loadStageMode();
      } catch { addToast('error', 'Failed to reorder stages'); }
      return;
    }

    // ── Task card move ──
    if (dragType !== 'task') return;
    const task = active.data.current?.task as Task;
    if (!task) return;

    if (kanbanMode === 'stage') {
      // Move task between stages
      const fromStageId = active.data.current?.groupId?.replace('stage-', '');
      const toStageId = over.data.current?.stageId;
      if (!fromStageId || !toStageId || Number(fromStageId) === toStageId) return;

      try {
        await taskApi.update(task.id, {}, { stage_id: toStageId });
        setTasks(prev => {
          const next = { ...prev };
          next[Number(fromStageId)] = (next[Number(fromStageId)] || []).filter(t => t.id !== task.id);
          next[toStageId] = [task, ...(next[toStageId] || [])];
          return next;
        });
        addToast('success', `Task moved to ${stages.find(s => s.id === toStageId)?.stage_name || ''}`);
      } catch { addToast('error', 'Failed to move task'); }
    } else {
      // Move task between users (reassign)
      const toUserId = over.data.current?.userId;
      // If same user, no-op
      if (toUserId === task.assignee_id) return;

      try {
        await taskApi.update(task.id, { assignee_id: toUserId ?? null });
        // Optimistic update
        setUserTasks(prev => {
          const next = { ...prev };
          const fromKey = task.assignee_id ? `user-${task.assignee_id}` : 'user-unassigned';
          const toKey = toUserId !== undefined && toUserId !== null ? `user-${toUserId}` : 'user-unassigned';
          next[fromKey] = (next[fromKey] || []).filter(t => t.id !== task.id);
          next[toKey] = [task, ...(next[toKey] || [])];
          return next;
        });
        const targetUser = users.find(u => u.id === toUserId);
        addToast('success', `Task assigned to ${targetUser?.name || 'Unassigned'}`);
      } catch { addToast('error', 'Failed to reassign task'); }
    }
  };

  // ── User mode: build ordered columns ──
  const userColumns = users.map(u => ({
    user: u,
    tasks: userTasks[`user-${u.id}`] || [],
  }));
  // Unassigned column at the end
  const unassignedTasks = userTasks['user-unassigned'] || [];

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="h-full flex flex-col">
        {/* Mode toggle */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <span className="text-xs text-gray-500 font-medium">Group by:</span>
          <div className="flex rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden">
            <button
              onClick={() => setKanbanMode('stage')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                kanbanMode === 'stage'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              <Columns3 size={14} />
              <span>Stages</span>
            </button>
            <button
              onClick={() => setKanbanMode('user')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                kanbanMode === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              <Users size={14} />
              <span>Users</span>
            </button>
          </div>
        </div>

        {/* Kanban columns */}
        <div className="flex-1 flex gap-3 overflow-x-auto pb-4 px-3 pt-3">
          {kanbanMode === 'stage' ? (
            visibleStages.map(stage => (
              <KanbanColumn
                key={stage.id}
                stage={stage}
                tasks={tasks[stage.id] || []}
                onDelete={deleteStage}
              />
            ))
          ) : (
            <>
              {userColumns.map(({ user, tasks: userTaskList }) => (
                <UserColumn
                  key={user.id}
                  user={user}
                  tasks={userTaskList}
                  allUsers={users}
                />
              ))}
              {unassignedTasks.length > 0 || userColumns.length === 0 ? (
                <UserColumn
                  key="unassigned"
                  user={null}
                  tasks={unassignedTasks}
                  allUsers={users}
                />
              ) : null}
            </>
          )}
        </div>
      </div>
    </DndContext>
  );
}
