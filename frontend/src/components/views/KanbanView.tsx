import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { stageApi, taskApi } from '../../api/client';
import type { TaskStage, Task } from '../../types';
import { useTabStore } from '../../stores/tabStore';

interface Props { nodeId: number }

export default function KanbanView({ nodeId }: Props) {
  const [stages, setStages] = useState<TaskStage[]>([]);
  const [tasks, setTasks] = useState<Record<number, Task[]>>({});
  const openTab = useTabStore(s => s.openTab);

  useEffect(() => {
    stageApi.list(nodeId).then(async (s) => {
      setStages(s);
      const taskMap: Record<number, Task[]> = {};
      for (const stage of s) {
        const res = await taskApi.list({ stage_id: stage.id, per_page: 50 });
        taskMap[stage.id] = res.items;
      }
      setTasks(taskMap);
    });
  }, [nodeId]);

  return (
    <div className="h-full flex gap-3 overflow-x-auto pb-4">
      {stages.map(stage => (
        <div key={stage.id} className="w-72 shrink-0 flex flex-col bg-gray-50 dark:bg-gray-800 rounded-lg">
          <div className="flex items-center justify-between px-3 py-2 font-medium text-sm border-b border-gray-200 dark:border-gray-700"
               style={{ borderLeftColor: stage.color_hex, borderLeftWidth: 3 }}>
            <span>{stage.stage_name}</span>
            <span className="text-xs text-gray-400">{(tasks[stage.id] || []).length}</span>
          </div>
          <div className="flex-1 p-2 space-y-2 overflow-y-auto">
            {(tasks[stage.id] || []).map(task => (
              <div
                key={task.id}
                onClick={() => openTab({ id: `task-${task.id}`, type: 'task', title: task.title, taskId: task.id })}
                className="p-2 bg-white dark:bg-gray-700 rounded shadow-sm text-sm cursor-pointer hover:shadow-md transition-shadow"
              >
                <div className="font-medium truncate">{task.title}</div>
                <div className="flex items-center gap-2 mt-1">
                  {task.tags?.slice(0, 3).map(tag => (
                    <span key={tag.id} className="text-xs px-1.5 py-0.5 rounded-full"
                      style={{ backgroundColor: tag.color_hex + '20', color: tag.color_hex }}>
                      {tag.tag_name}
                    </span>
                  ))}
                </div>
                <div className="flex items-center justify-between mt-2 text-xs text-gray-400">
                  <span className={task.priority === 'critical' ? 'text-red-500' : ''}>
                    {task.priority}
                  </span>
                  <span>{task.deadline ? new Date(task.deadline).toLocaleDateString() : ''}</span>
                </div>
              </div>
            ))}
            <button className="w-full py-2 text-xs text-gray-400 border border-dashed border-gray-300 dark:border-gray-600 rounded hover:text-gray-600 flex items-center justify-center gap-1">
              <Plus size={12} /> Add task
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
