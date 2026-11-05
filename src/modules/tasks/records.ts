import { db } from '../../db';
import type { RecordChoice, RecordSource } from '../../core/registry';
import { goTo } from '../../core/dueProvider';
import { getTask, loadTasks } from './data';

/**
 * Lets other modules link to a task and show it by name. Task ids are plain numbers (the same number the Links table already stores
 * for links made from a task), so nothing stored changes.
 */
const num = (id: string | number) => (typeof id === 'number' ? id : /^\d+$/.test(id) ? Number(id) : NaN);

export const taskRecords: RecordSource = {
  async search(text) {
    const q = text.trim().toLowerCase();
    const rows = (await loadTasks(db)).filter((t) => t.data.status !== 'done' && (!q || t.data.title.toLowerCase().includes(q)));
    rows.sort((a, b) => (a.data.dueDate ?? '9999').localeCompare(b.data.dueDate ?? '9999') || a.data.title.localeCompare(b.data.title));
    return rows.slice(0, 30).map<RecordChoice>((t) => ({ id: t.id, label: t.data.title, kind: 'Task' }));
  },
  async describe(id) {
    const n = num(id);
    if (Number.isNaN(n)) return null;
    const t = await getTask(n, db);
    return t ? { label: t.data.title, kind: 'Task', path: `/tasks?task=${t.id}` } : null;
  },
  async openSource(id) {
    const info = await taskRecords.describe(id);
    if (!info) return false;
    goTo(info.path);
    return true;
  },
};
