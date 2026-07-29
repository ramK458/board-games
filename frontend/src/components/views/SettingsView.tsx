import { useEffect, useState } from 'react';
import { Plus, Trash2, Check, X, Edit2, Eye, EyeOff } from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { stageApi } from '../../api/client';
import type { TaskStage } from '../../types';

const SUB_TABS = [
  { key: 'tags' as const, label: 'Tags' },
  { key: 'stages' as const, label: 'Stages' },
  { key: 'hierarchy' as const, label: 'Hierarchy' },
];

// ── Shared project selector ───────────────────

function ProjectSelector({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const [projects, setProjects] = useState<{ id: number; name: string }[]>([]);

  useEffect(() => {
    fetch('/api/hierarchy/nodes', { headers: { 'X-User-Id': '1' } })
      .then(r => r.json())
      .then((nodes: any[]) => setProjects(nodes.filter((n: any) => !n.parent_node_id)))
      .catch(() => {});
  }, []);

  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}
      className="w-full text-xs border rounded px-2 py-1.5 mb-4 dark:bg-gray-700"
    >
      <option value="">Select a project...</option>
      {projects.map(p => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </select>
  );
}

// ═══════════════════════════════════════════════
//  Tags Sub-tab
// ═══════════════════════════════════════════════

function TagsSettings({ projectId }: { projectId: number }) {
  const addToast = useNotificationStore(s => s.addToast);
  const [tags, setTags] = useState<{ id: number; name: string; color_hex: string }[]>([]);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#6366f1');
  const [editing, setEditing] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');

  const load = async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/tags`, { headers: { 'X-User-Id': '1' } });
      setTags(await res.json());
    } catch {}
  };

  useEffect(() => { load(); }, [projectId]);

  const addTag = async () => {
    if (!newName.trim()) return;
    try {
      await fetch(`/api/projects/${projectId}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': '1' },
        body: JSON.stringify({ name: newName.trim(), color_hex: newColor }),
      });
      setNewName('');
      addToast('success', 'Tag added');
      load();
    } catch { addToast('error', 'Failed to add tag'); }
  };

  const updateTag = async (tagId: number, oldName: string) => {
    try {
      await fetch(`/api/projects/${projectId}/tags/${encodeURIComponent(oldName)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': '1' },
        body: JSON.stringify({ name: editName.trim(), color_hex: editColor }),
      });
      setEditing(null);
      addToast('success', 'Tag renamed');
      load();
    } catch { addToast('error', 'Failed to update tag'); }
  };

  const deleteTag = async (name: string) => {
    if (!window.confirm(`Delete tag "${name}"? It will be removed from all tasks in this project.`)) return;
    try {
      await fetch(`/api/projects/${projectId}/tags/${encodeURIComponent(name)}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': '1' },
      });
      addToast('success', `Tag "${name}" deleted`);
      load();
    } catch { addToast('error', 'Failed to delete tag'); }
  };

  return (
    <div>
      <div className="space-y-2 mb-4 max-h-64 overflow-y-auto">
        {tags.map(t => (
          <div key={t.id} className="flex items-center gap-3 text-sm bg-white dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-700">
            {editing === t.id ? (
              <>
                <input value={editName} onChange={e => setEditName(e.target.value)}
                  className="flex-1 text-xs border rounded px-2 py-1 dark:bg-gray-700" />
                <input type="color" value={editColor} onChange={e => setEditColor(e.target.value)}
                  className="w-8 h-8 rounded cursor-pointer" />
                <button onClick={() => updateTag(t.id, t.name)} className="text-green-600"><Check size={14} /></button>
                <button onClick={() => setEditing(null)} className="text-gray-400"><X size={14} /></button>
              </>
            ) : (
              <>
                <span className="inline-block w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: t.color_hex }} />
                <span className="flex-1">{t.name}</span>
                <button onClick={() => { setEditing(t.id); setEditName(t.name); setEditColor(t.color_hex); }}
                  className="text-xs text-blue-600 hover:text-blue-700"><Edit2 size={14} /></button>
                <button onClick={() => deleteTag(t.name)} className="text-xs text-red-500"><Trash2 size={14} /></button>
              </>
            )}
          </div>
        ))}
        {tags.length === 0 && <p className="text-xs text-gray-400">No tags for this project</p>}
      </div>
      <div className="flex items-center gap-2 p-2 border border-dashed border-gray-300 dark:border-gray-600 rounded">
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Tag name"
          className="flex-1 text-xs border rounded px-2 py-1 dark:bg-gray-700"
          onKeyDown={e => e.key === 'Enter' && addTag()} />
        <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)}
          className="w-8 h-8 rounded cursor-pointer" />
        <button onClick={addTag} className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 flex items-center gap-1">
          <Plus size={12} /> Add
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
//  Stages Sub-tab
// ═══════════════════════════════════════════════

function StagesSettings({ projectId }: { projectId: number }) {
  const addToast = useNotificationStore(s => s.addToast);
  const [stages, setStages] = useState<TaskStage[]>([]);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#6366f1');
  const [editing, setEditing] = useState<number | null>(null);
  const [editName, setEditName] = useState('');

  useEffect(() => {
    stageApi.list(projectId).then(setStages).catch(() => {});
  }, [projectId]);

  const addStage = async () => {
    if (!newName.trim()) return;
    try {
      await stageApi.create({ project_id: projectId, stage_name: newName.trim(), color_hex: newColor, sort_order: stages.length });
      setNewName('');
      addToast('success', 'Stage added');
      stageApi.list(projectId).then(setStages);
    } catch { addToast('error', 'Failed to add stage'); }
  };

  const updateStageName = async (id: number) => {
    if (!editName.trim()) return;
    try {
      await stageApi.update(id, { stage_name: editName.trim() });
      setEditing(null);
      addToast('success', 'Stage renamed');
      stageApi.list(projectId).then(setStages);
    } catch { addToast('error', 'Failed to rename stage'); }
  };

  const toggleVisibility = async (id: number, currentActive: number) => {
    const newActive = currentActive === 0 ? 1 : 0;
    try {
      await stageApi.update(id, { active: !!newActive });
      addToast('success', newActive ? 'Stage shown' : 'Stage hidden');
      stageApi.list(projectId).then(setStages);
    } catch { addToast('error', 'Failed to toggle stage visibility'); }
  };

  const deleteStage = async (id: number, stageName: string, isActive: boolean) => {
    if (isActive) {
      if (!window.confirm(`Hide stage "${stageName}"? Tasks in this stage will have their stage_id set to NULL. They must be reassigned manually.`)) return;
      try {
        // Backend nullifies stage_id on affected tasks when setting active=0
        await stageApi.update(id, { active: false });
        addToast('warning', `Stage "${stageName}" hidden. Affected tasks need stage reassignment.`);
        stageApi.list(projectId).then(setStages);
      } catch { addToast('error', 'Failed to hide stage'); }
    } else {
      // Re-show a hidden stage
      await toggleVisibility(id, 0);
    }
  };

  const moveStage = async (id: number, dir: number) => {
    const idx = stages.findIndex(s => s.id === id);
    if (idx === -1) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= stages.length) return;
    const items = stages.map((s, i) => ({ id: s.id, sort_order: i === idx ? newIdx : i === newIdx ? idx : s.sort_order }));
    try {
      await stageApi.reorder(items);
      stageApi.list(projectId).then(setStages);
    } catch {}
  };

  return (
    <div>
      <div className="space-y-2 mb-4 max-h-64 overflow-y-auto">
        {stages.map((s, i) => (
          <div key={s.id} className="flex items-center gap-3 text-sm bg-white dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-700">
            {editing === s.id ? (
              <>
                <input value={editName} onChange={e => setEditName(e.target.value)}
                  className="flex-1 text-xs border rounded px-2 py-1 dark:bg-gray-700"
                  onKeyDown={e => { if (e.key === 'Enter') updateStageName(s.id); if (e.key === 'Escape') setEditing(null); }} />
                <button onClick={() => updateStageName(s.id)} className="text-green-600"><Check size={14} /></button>
                <button onClick={() => setEditing(null)} className="text-gray-400"><X size={14} /></button>
              </>
            ) : (
              <>
                <span className="inline-block w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: s.color_hex }} />
                <span className="flex-1">{s.stage_name}</span>
                <button onClick={() => { setEditing(s.id); setEditName(s.stage_name); }}
                  className="text-xs text-blue-600 hover:text-blue-700"><Edit2 size={14} /></button>
                <div className="flex gap-1">
                  <button onClick={() => moveStage(s.id, -1)} disabled={i === 0} className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-30">↑</button>
                  <button onClick={() => moveStage(s.id, 1)} disabled={i === stages.length - 1} className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-30">↓</button>
                </div>
                <button onClick={() => toggleVisibility(s.id, s.active)}
                  className="text-xs text-gray-400 hover:text-gray-600" title={s.active ? 'Hide' : 'Show'}>
                  {s.active ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                <button onClick={() => deleteStage(s.id, s.stage_name, s.active === 1)} className="text-xs text-red-500"><Trash2 size={14} /></button>
              </>
            )}
          </div>
        ))}
        {stages.length === 0 && <p className="text-xs text-gray-400">No stages for this project</p>}
      </div>
      <div className="flex items-center gap-2 p-2 border border-dashed border-gray-300 dark:border-gray-600 rounded">
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Stage name"
          className="flex-1 text-xs border rounded px-2 py-1 dark:bg-gray-700"
          onKeyDown={e => e.key === 'Enter' && addStage()} />
        <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)}
          className="w-8 h-8 rounded cursor-pointer" />
        <button onClick={addStage} className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 flex items-center gap-1">
          <Plus size={12} /> Add
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
//  Hierarchy Sub-tab
// ═══════════════════════════════════════════════

function HierarchySettings({ projectId }: { projectId: number }) {
  const addToast = useNotificationStore(s => s.addToast);
  const [config, setConfig] = useState<{ depth: number; labels: string[] } | null>(null);
  const [editLabels, setEditLabels] = useState<string[]>([]);

  const load = async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/hierarchy-config`, { headers: { 'X-User-Id': '1' } });
      const data = await res.json();
      setConfig(data);
      setEditLabels([...data.labels]);
    } catch {}
  };

  useEffect(() => { load(); }, [projectId]);

  const saveLabels = async () => {
    try {
      await fetch(`/api/projects/${projectId}/hierarchy-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': '1' },
        body: JSON.stringify({ labels: editLabels }),
      });
      addToast('success', 'Labels updated');
      load();
    } catch { addToast('error', 'Failed to update labels'); }
  };

  if (!config) return <p className="text-xs text-gray-400">Loading...</p>;

  return (
    <div>
      <p className="text-xs text-gray-500 mb-3">Rename hierarchy level labels for this project. Changes apply across the entire project database.</p>
      <div className="space-y-2 mb-4">
        {editLabels.map((label, i) => (
          <div key={i} className="flex items-center gap-3 text-sm bg-white dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-700">
            <span className="w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-xs font-bold">{i + 1}</span>
            <input value={label} onChange={e => {
              const next = [...editLabels];
              next[i] = e.target.value;
              setEditLabels(next);
            }} className="flex-1 text-xs border rounded px-2 py-1 dark:bg-gray-700" />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={saveLabels}
          className="text-xs bg-blue-600 text-white px-4 py-1.5 rounded hover:bg-blue-700 flex items-center gap-1">
          Save Labels
        </button>
        <button onClick={load} className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5">Reset</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
//  Main Settings View
// ═══════════════════════════════════════════════

export default function SettingsView() {
  const activeSubTab = useSettingsStore(s => s.activeSubTab);
  const setActiveSubTab = useSettingsStore(s => s.setActiveSubTab);
  const [selectedProject, setSelectedProject] = useState<number | null>(null);

  return (
    <div className="h-full flex flex-col">
      <h2 className="text-lg font-bold text-gray-800 dark:text-gray-200 mb-3">Settings</h2>

      {/* Project filter — applies to all sub-tabs */}
      <ProjectSelector value={selectedProject} onChange={setSelectedProject} />

      {/* Sub-tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-gray-700">
        {SUB_TABS.map(t => (
          <button key={t.key} onClick={() => setActiveSubTab(t.key)}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
              activeSubTab === t.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto max-w-xl">
        {!selectedProject ? (
          <p className="text-sm text-gray-400">Select a project above to manage its settings.</p>
        ) : (
          <>
            {activeSubTab === 'tags' && <TagsSettings projectId={selectedProject} />}
            {activeSubTab === 'stages' && <StagesSettings projectId={selectedProject} />}
            {activeSubTab === 'hierarchy' && <HierarchySettings projectId={selectedProject} />}
          </>
        )}
      </div>
    </div>
  );
}
