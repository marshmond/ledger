import { db } from '../../db';
import type { RecordChoice, RecordSource } from '../../core/registry';
import { goTo } from '../../core/dueProvider';
import { getProject, loadProjects } from './data';

/**
 * Lets other modules link to a project and show it by name. Project ids are plain numbers, like Tasks and Calendar events. An archived
 * project can still be linked to and opened (its name says so); only a project that does not exist gives "(no longer exists)".
 */
const num = (id: string | number) => (typeof id === 'number' ? id : /^\d+$/.test(id) ? Number(id) : NaN);

export const projectRecords: RecordSource = {
  async search(text) {
    const q = text.trim().toLowerCase();
    const rows = (await loadProjects(db)).filter((p) => !q || p.data.name.toLowerCase().includes(q));
    rows.sort((a, b) => Number(a.data.archived) - Number(b.data.archived) || a.data.name.localeCompare(b.data.name));
    return rows.slice(0, 30).map<RecordChoice>((p) => ({ id: p.id, label: p.data.archived ? `${p.data.name} (archived)` : p.data.name, kind: 'Project' }));
  },
  async describe(id) {
    const n = num(id);
    if (Number.isNaN(n)) return null;
    const p = await getProject(n, db);
    return p ? { label: p.data.archived ? `${p.data.name} (archived)` : p.data.name, kind: 'Project', path: `/projects/${p.id}` } : null;
  },
  async openSource(id) {
    const info = await projectRecords.describe(id);
    if (!info) return false;
    goTo(info.path);
    return true;
  },
};
