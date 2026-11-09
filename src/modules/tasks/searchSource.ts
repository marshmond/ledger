import { db } from '../../db';
import type { SearchResult, SearchSource } from '../../core/registry';
import { createStore } from '../../core/store';
import { norm, score } from '../../lib/search';
import { loadProjectChoices, projectLabel, type ProjectChoice } from '../../core/projectLink';
import { loadTasks } from './data';
import type { TaskRecord } from './model';

const store = createStore(db);

/** The words a task is found by besides its title: notes and checklist items. */
export const taskExtra = (t: TaskRecord) => `${t.data.notes} ${t.data.checklist.map((c) => c.text).join(' ')}`;

/** Pure: the Tasks hits for a typed query, from already-loaded records. Open tasks rank above done ones; each group is capped. */
export function searchTasksData(
  raw: string,
  tasks: TaskRecord[],
  tags: { id: number; name: string }[],
  contacts: { id: number; name: string }[],
  caps = { tasks: 8, tags: 3, contacts: 3 },
  projects: ProjectChoice[] = [],
): SearchResult[] {
  const query = norm(raw).split(/\s+/).filter(Boolean);
  if (query.length === 0) return [];
  const out: SearchResult[] = [];

  const pages = [{ title: 'Tasks', words: 'tasks to do todo list checklist', path: '/tasks' }];
  for (const p of pages) {
    const s = score(query, p.title, p.words);
    if (s > 0) out.push({ id: `page:${p.path}`, title: p.title, subtitle: 'Go to this page', kind: 'Page', score: s, path: p.path });
  }

  const hits = tasks
    .map((t) => ({ t, s: score(query, t.data.title, taskExtra(t)) }))
    .filter((x) => x.s > 0)
    .map((x) => ({ ...x, s: x.t.data.status === 'done' ? x.s - 8 : x.s }))
    .sort((a, b) => b.s - a.s || a.t.data.title.localeCompare(b.t.data.title))
    .slice(0, caps.tasks);
  for (const { t, s } of hits) {
    const bits = [t.data.status === 'done' ? 'Done' : t.data.dueDate ? `Due ${t.data.dueDate}` : 'No due date'];
    if (t.data.checklist.length) bits.push(`${t.data.checklist.filter((c) => c.done).length}/${t.data.checklist.length} checked`);
    // Where it belongs: the project's name (with "archived" / "(project removed)" when that is the truth). One lookup list for all hits.
    if (typeof t.data.projectId === 'number') bits.push(`Project: ${projectLabel(projects, t.data.projectId)}`);
    out.push({ id: `task:${t.id}`, title: t.data.title, subtitle: bits.join(' · '), kind: t.data.isMilestone ? 'Milestone' : 'Task', score: s, path: `/tasks?task=${t.id}` });
  }

  const openCount = (pick: (t: TaskRecord) => boolean) => tasks.filter((t) => t.data.status !== 'done' && pick(t)).length;
  for (const tag of tags.map((x) => ({ x, s: score(query, x.name) })).filter((y) => y.s > 0).sort((a, b) => b.s - a.s).slice(0, caps.tags)) {
    const n = openCount((t) => t.data.tagIds.includes(tag.x.id));
    out.push({ id: `tag:${tag.x.id}`, title: `#${tag.x.name}`, subtitle: `${n} open ${n === 1 ? 'task' : 'tasks'}`, kind: 'Tag', score: tag.s - 2, path: `/tasks?v=all&tag=${tag.x.id}` });
  }
  for (const c of contacts.map((x) => ({ x, s: score(query, x.name) })).filter((y) => y.s > 0).sort((a, b) => b.s - a.s).slice(0, caps.contacts)) {
    const n = openCount((t) => t.data.contactIds.includes(c.x.id));
    out.push({ id: `contact:${c.x.id}`, title: c.x.name, subtitle: `${n} open ${n === 1 ? 'task' : 'tasks'}`, kind: 'Tasks for contact', score: c.s - 2, path: `/tasks?v=all&contact=${c.x.id}` });
  }
  return out;
}

/** What global search finds in Tasks: the page, tasks (title, notes, checklist), and the tags and contacts tasks use. */
export const tasksSearchSource: SearchSource = {
  group: 'Tasks',
  async search(query, limit) {
    const [tasks, tags, contacts, projects] = await Promise.all([loadTasks(db), store.shared.tags.query(), store.shared.contacts.query(), loadProjectChoices(db)]);
    return searchTasksData(query, tasks, tags.map((t) => ({ id: t.id as number, name: t.name })), contacts.map((c) => ({ id: c.id as number, name: c.name })), undefined, projects).slice(0, limit);
  },
};
