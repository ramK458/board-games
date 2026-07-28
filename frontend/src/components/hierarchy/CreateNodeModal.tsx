import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { hierarchyApi } from '../../api/client';
import type { HierarchyLevel } from '../../types';
import { useHierarchyStore } from '../../stores/hierarchyStore';
import { useNotificationStore } from '../../stores/notificationStore';

interface Props {
  parentNode: { id: number; name: string; level: string } | null;
  onClose: () => void;
}

export default function CreateNodeModal({ parentNode, onClose }: Props) {
  const loadTree = useHierarchyStore(s => s.loadTree);
  const addToast = useNotificationStore(s => s.addToast);

  const [levels, setLevels] = useState<HierarchyLevel[]>([]);
  const [name, setName] = useState('');
  const [selectedLevelId, setSelectedLevelId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    hierarchyApi.getLevels().then(allLevels => {
      let availableLevels = allLevels;

      if (parentNode && parentNode.level_id) {
        // Only show levels whose parent_level_id matches this node's level
        availableLevels = allLevels.filter(l => l.parent_level_id === parentNode.level_id);
      } else if (!parentNode) {
        // Root level creation: only show levels with no parent
        availableLevels = allLevels.filter(l => l.parent_level_id === null);
      }

      setLevels(availableLevels);
      if (availableLevels.length > 0) {
        setSelectedLevelId(availableLevels[0].id);
      }
    });
  }, [parentNode]);

  const handleSubmit = async () => {
    if (!name.trim() || selectedLevelId == null) return;
    setSaving(true);
    try {
      await hierarchyApi.createNode({
        name: name.trim(),
        level_id: selectedLevelId,
        parent_node_id: parentNode?.id ?? null,
      });
      addToast('success', `Created "${name.trim()}"`);
      loadTree();
      onClose();
    } catch (err: any) {
      addToast('error', err.message || 'Failed to create node');
    } finally {
      setSaving(false);
    }
  };

  const selectedLevel = levels.find(l => l.id === selectedLevelId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h3 className="font-medium">
            {parentNode ? `Add child under "${parentNode.name}"` : 'Create root node'}
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          {parentNode && (
            <p className="text-xs text-gray-500">
              Parent: <strong>{parentNode.name}</strong> ({parentNode.level})
            </p>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Level</label>
            <select
              value={selectedLevelId ?? ''}
              onChange={e => setSelectedLevelId(Number(e.target.value))}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
            >
              <option value="">Select a level...</option>
              {levels.map(l => (
                <option key={l.id} value={l.id} disabled={parentNode ? l.parent_level_id === null : false}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={selectedLevel ? `New ${selectedLevel.name} name...` : 'Name...'}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md hover:bg-gray-100 dark:hover:bg-gray-700">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || selectedLevelId == null || saving}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Creating...' : `Create ${selectedLevel?.name || 'node'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
