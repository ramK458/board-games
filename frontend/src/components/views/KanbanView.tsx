import { useEffect, useState } from 'react';
import { Trash2, GripVertical } from 'lucide-react';
import { DndContext, useDraggable, useDroppable, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { stageApi, taskApi } from '../../api/client';
import type { TaskStage, Task } from '../../types';
import { useTabStore } from '../../stores/tabStore';
import { useUiStore } from '../../stores/uiStore';
import { useNotificationStore } from '../../stores/notificationStore';

interface Props { nodeId: number }

function DraggableTask({ task, stageId }: { task: Task; stageId: number }) {
  const openTab = useTabStore(s => s.openTab);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `task-${task.id}`,
    data: { type: 'task', task, stageId },
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
  const { isOver, setNodeRef } = useDroppable({ id: `stage-${stage.id}`, data: { stageId: stage.id } });

  return (
    <div
      ref={setNodeRef}
      className={`w-72 shrink-0 flex flex-col bg-gray-50 dark:bg-gray-800 rounded-lg transition-colors ${isOver ? 'ring-2 ring-blue-400' : ''}`}
    >
      {/* Stage header — also draggable for column reorder */}
      <DraggableStageHeader stage={stage} tasks={tasks} onDelete={onDelete} />
      {/* Task cards */}
      <div className="flex-1 p-2 space-y-2 overflow-y-auto">
        {tasks.map(task => (
          <DraggableTask key={task.id} task={task} stageId={stage.id} />
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

export default function KanbanView({ nodeId }: Props) {
  const [stages, setStages] = useState<TaskStage[]>([]);
  const [tasks, setTasks] = useState<Record<number, Task[]>>({});
  const filterUserId = useUiStore(s => s.filterUserId);
  const addToast = useNotificationStore(s => s.addToast);

  const load = async () => {
    try {
      let s = await stageApi.list(nodeId);
      // Auto-populate default stages if none exist
      if (s.length === 0) {
        // Label 0 = "Not Started" by default; rest are numbered 1..N
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
  };

  useEffect(() => { load(); }, [nodeId, filterUserId]);

  const deleteStage = async (id: number) => {
    try {
      await stageApi.update(id, { active: false });
      addToast('success', 'Stage hidden from view');
      load();
    } catch { addToast('error', 'Failed to hide stage'); }
  };

  const visibleStages = stages.filter(s => s.active !== 0);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = async (event: any) => {
    const { active, over } = event;
    if (!over) return;

    const dragType = active.data.current?.type;

    if (dragType === 'stage') {
      // ── Stage column reorder ──
      const fromStageId = active.data.current?.stageId;
      const toStageId = over.data.current?.stageId;
      if (!fromStageId || !toStageId || fromStageId === toStageId) return;

      const fromIdx = visibleStages.findIndex(s => s.id === fromStageId);
      const toIdx = visibleStages.findIndex(s => s.id === toStageId);
      if (fromIdx === -1 || toIdx === -1) return;

      // Compute new sort_orders
      const reordered = [...visibleStages];
      const [moved] = reordered.splice(fromIdx, 1);
      reordered.splice(toIdx, 0, moved);
      const items = reordered.map((s, i) => ({ id: s.id, sort_order: i }));

      try {
        await stageApi.reorder(items);
        addToast('success', 'Stages reordered');
        load();
      } catch { addToast('error', 'Failed to reorder stages'); }
      return;
    }

    // ── Task card move between stages ──
    const fromStageId = active.data.current?.stageId;
    const toStageId = over.data.current?.stageId;
    if (!fromStageId || !toStageId || fromStageId === toStageId) return;
    const task = active.data.current?.task as Task;
    if (!task) return;
    try {
      // PUT /api/tasks/{id}?stage_id=newStage — query param for stage reassignment
      await taskApi.update(task.id, {}, { stage_id: toStageId });
      // Optimistic update: move task in local state
      setTasks(prev => {
        const next = { ...prev };
        next[fromStageId] = (next[fromStageId] || []).filter(t => t.id !== task.id);
        next[toStageId] = [task, ...(next[toStageId] || [])];
        return next;
      });
      addToast('success', `Task moved to ${stages.find(s => s.id === toStageId)?.stage_name || ''}`);
    } catch { addToast('error', 'Failed to move task'); }
  };

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="h-full flex flex-col">
        {/* Kanban columns */}
        <div className="flex-1 flex gap-3 overflow-x-auto pb-4">
          {visibleStages.map(stage => (
            <KanbanColumn
              key={stage.id}
              stage={stage}
              tasks={tasks[stage.id] || []}
              onDelete={deleteStage}
            />
          ))}
        </div>
      </div>
    </DndContext>
  );
}
