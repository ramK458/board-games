import { useEffect, useState } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen, Plus, Trash2 } from 'lucide-react';
import { useHierarchyStore } from '../../stores/hierarchyStore';
import { useTabStore } from '../../stores/tabStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { hierarchyApi } from '../../api/client';
import CreateNodeModal from '../hierarchy/CreateNodeModal';

export default function SidebarTree() {
  const tree = useHierarchyStore(s => s.tree);
  const loading = useHierarchyStore(s => s.loading);
  const loadTree = useHierarchyStore(s => s.loadTree);
  const expandedIds = useHierarchyStore(s => s.expandedIds);
  const toggleExpanded = useHierarchyStore(s => s.toggleExpanded);
  const activeNodeId = useHierarchyStore(s => s.activeNodeId);
  const setActiveNode = useHierarchyStore(s => s.setActiveNode);
  const openTab = useTabStore(s => s.openTab);
  const addToast = useNotificationStore(s => s.addToast);
  const [createTarget, setCreateTarget] = useState<{ id: number; name: string; level: string; level_id: number } | null>(null);

  useEffect(() => {
    loadTree();
  }, []);

  const handleNodeClick = (node: any) => {
    setActiveNode(node.id, node.name);
    openTab({ id: `list-${node.id}`, type: 'list', title: node.name, nodeId: node.id });
  };

  const handleDelete = async (e: React.MouseEvent, nodeId: number, nodeName: string) => {
    e.stopPropagation();
    // Try a dry-run delete first to get the count of what would be affected
    try {
      const res = await fetch(`/api/hierarchy/nodes/${nodeId}`, {
        headers: { 'X-User-Id': String(localStorage.getItem('board-games-user-id') || '1') }
      });
      const node = await res.json();

      // Count children and tasks recursively
      let childCount = 0;
      let taskCount = 0;
      
      const countChildren = async (parentId: number) => {
        const r = await fetch(`/api/hierarchy/nodes?parent_id=${parentId}`, {
          headers: { 'X-User-Id': '1' }
        });
        const kids = await r.json();
        for (const kid of kids) {
          childCount++;
          const tr = await fetch(`/api/tasks?parent_id=${kid.id}&per_page=1`, {
            headers: { 'X-User-Id': '1' }
          });
          const tData = await tr.json();
          taskCount += tData.total || 0;
          await countChildren(kid.id);
        }
      };
      await countChildren(nodeId);

      let msg = `Delete "${nodeName}"?`;
      const parts: string[] = [];
      if (childCount > 0) parts.push(`${childCount} child nodes`);
      if (taskCount > 0) parts.push(`${taskCount} tasks`);
      if (parts.length > 0) msg += `\n\nThis will also delete ${parts.join(' and ')}.`;
      msg += '\n\nThis cannot be undone.';

      if (!window.confirm(msg)) return;
    } catch {
      // Fallback simple confirm
      if (!window.confirm(`Delete "${nodeName}"? This cannot be undone.`)) return;
    }

    try {
      await hierarchyApi.deleteNode(nodeId, true);
      addToast('success', `Deleted "${nodeName}"`);
      loadTree();
    } catch (err: any) {
      addToast('error', err.message || 'Failed to delete');
    }
  };

  const renderTree = (items: any[], depth = 0) => {
    return items.map(item => {
      const isExpanded = expandedIds.has(item.id);
      const isActive = activeNodeId === item.id;
      const hasChildren = item.children && item.children.length > 0;

      return (
        <div key={item.id}>
          <div
            className={`flex items-center gap-1 px-2 py-1.5 text-sm cursor-pointer rounded hover:bg-gray-100 dark:hover:bg-gray-700 group ${
              isActive ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : ''
            }`}
            style={{ paddingLeft: `${8 + depth * 16}px` }}
            onClick={() => handleNodeClick(item)}
          >
            {/* Expand/collapse */}
            {hasChildren ? (
              <button
                onClick={e => { e.stopPropagation(); toggleExpanded(item.id); }}
                className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
              >
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            ) : (
              <span className="w-5" />
            )}

            {/* Icon */}
            {isExpanded ? <FolderOpen size={14} className="shrink-0 text-yellow-500" /> : <Folder size={14} className="shrink-0 text-yellow-500" />}

            {/* Name */}
            <span className="truncate flex-1">{item.name}</span>

            {/* Add child button */}
            <button
              onClick={e => { e.stopPropagation(); setCreateTarget({ id: item.id, name: item.name, level: item.level_name || '', level_id: item.level_id }); }}
              className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
              title={`Add child under ${item.name}`}
            >
              <Plus size={12} />
            </button>

            {/* Delete button */}
            <button
              onClick={e => handleDelete(e, item.id, item.name)}
              className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded text-gray-400 hover:text-red-600"
              title={`Delete ${item.name}`}
            >
              <Trash2 size={12} />
            </button>
          </div>

          {/* Children */}
          {hasChildren && isExpanded && renderTree(item.children, depth + 1)}
        </div>
      );
    });
  };

  if (loading) {
    return <div className="p-3 text-sm text-gray-400">Loading...</div>;
  }

  return (
    <div className="py-2">
      <div className="px-3 mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Projects</span>
        <button
          onClick={() => setCreateTarget(null)}
          className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded opacity-60 hover:opacity-100"
          title="Create root node"
        >
          <Plus size={14} />
        </button>
      </div>
      {tree.length === 0 ? (
        <div className="px-3 text-sm text-gray-400">No projects yet</div>
      ) : (
        renderTree(tree)
      )}

      {createTarget && (
        <CreateNodeModal
          parentNode={createTarget}
          onClose={() => setCreateTarget(null)}
        />
      )}
    </div>
  );
}
