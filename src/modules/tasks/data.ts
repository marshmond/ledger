/**
 * Reading and writing tasks and lists. Writes go through the shared store's `repo` (id, createdAt, updatedAt, soft delete), reads are
 * plain queries so screens can wrap them in `useLiveQuery`. Tasks are normal stored records owned by this module.
 */
import { db, type FinanceDB } from '../../db';
import type { ModuleRecord, RecordRef } from '../../core/entities';
import { createStore, isLive, repo } from '../../core/store';
import { asList, asTask, MODULE, type TaskData, type TaskList, type TaskRecord } from './model';
import { spawnNext } from './recur';

const rows = (d: FinanceDB) => repo<ModuleRecord>(d.moduleRecords);

export async function loadTasks(d: FinanceDB = db): Promise<TaskRecord[]> {
  return (await d.moduleRecords.where('[module+kind]').equals([MODULE, 'task']).toArray()).filter(isLive).map(asTask);
}
export async function loadDeletedTasks(d: FinanceDB = db): Promise<TaskRecord[]> {
  return (await d.moduleRecords.where('[module+kind]').equals([MODULE, 'task']).toArray()).filter((r) => !isLive(r)).map(asTask).sort((a, b) => (b.updatedAt - a.updatedAt));
}
export async function loadLists(d: FinanceDB = db): Promise<TaskList[]> {
  return (await d.moduleRecords.where('[module+kind]').equals([MODULE, 'list']).toArray()).filter(isLive).map(asList).sort((a, b) => a.name.localeCompare(b.name));
}
export async function getTask(id: number, d: FinanceDB = db): Promise<TaskRecord | undefined> {
  const r = await d.moduleRecords.get(id);
  return r && r.module === MODULE && r.kind === 'task' && isLive(r) ? asTask(r) : undefined;
}

/** Creates a task. If it was made from another record, a link back to that record is stored too. Returns the new id. */
export async function createTask(data: TaskData, refs: RecordRef[] = [], d: FinanceDB = db): Promise<number> {
  return d.transaction('rw', d.moduleRecords, d.links, async () => {
    const id = await rows(d).put({ module: MODULE, kind: 'task', data: { ...data } });
    const s = createStore(d);
    const all = data.createdFrom ? [{ module: data.createdFrom.module, id: data.createdFrom.id }, ...refs] : refs;
    for (const r of all) await s.shared.links.add({ module: MODULE, id }, r, 'about');
    return id;
  });
}

export async function saveTask(id: number, data: TaskData, d: FinanceDB = db): Promise<void> {
  await rows(d).put({ id, module: MODULE, kind: 'task', data: { ...data } });
}

/** Changes several tasks at once (bulk actions). */
export async function updateTasks(ids: number[], change: (t: TaskData) => TaskData, d: FinanceDB = db): Promise<void> {
  await d.transaction('rw', d.moduleRecords, async () => {
    for (const id of ids) {
      const t = await getTask(id, d);
      if (t) await saveTask(id, change(t.data), d);
    }
  });
}

/**
 * Marks a task done. A repeating task also creates its next one (see recur.ts). Returns the new task's id, if any,
 * so "Undo" can take it away again.
 */
export async function completeTask(id: number, today: string, d: FinanceDB = db): Promise<{ spawnedId?: number }> {
  return d.transaction('rw', d.moduleRecords, d.links, async () => {
    const t = await getTask(id, d);
    if (!t || t.data.status === 'done') return {};
    await saveTask(id, { ...t.data, status: 'done', completedAt: Date.now() }, d);
    const next = spawnNext(t.data, today);
    if (!next) return {};
    const spawnedId = await rows(d).put({ module: MODULE, kind: 'task', data: { ...next, recurFrom: id } });
    // the next one keeps the same links (the record it is about, etc.)
    const s = createStore(d);
    for (const l of await s.shared.links.linkedTo({ module: MODULE, id })) {
      if (l.fromModule === MODULE && l.fromId === id) await s.shared.links.add({ module: MODULE, id: spawnedId }, { module: l.toModule, id: l.toId }, l.type);
    }
    return { spawnedId };
  });
}

/** Puts a done task back to "To do". If completing it made a next one that nobody has touched yet, that one is removed. */
export async function reopenTask(id: number, d: FinanceDB = db): Promise<void> {
  await d.transaction('rw', d.moduleRecords, async () => {
    const t = await getTask(id, d);
    if (!t) return;
    await saveTask(id, { ...t.data, status: 'todo', completedAt: null }, d);
    for (const o of await loadTasks(d)) if (o.data.recurFrom === id && o.data.status === 'todo' && o.updatedAt - o.createdAt < 2000) await rows(d).remove(o.id);
  });
}

export async function removeTasks(ids: number[], d: FinanceDB = db): Promise<void> {
  for (const id of ids) await rows(d).remove(id);
}
export async function restoreTasks(ids: number[], d: FinanceDB = db): Promise<void> {
  for (const id of ids) await rows(d).restore(id);
}

// ---- lists ----

export async function createList(name: string, d: FinanceDB = db): Promise<number> {
  const clean = name.trim();
  const found = (await loadLists(d)).find((l) => l.name.toLowerCase() === clean.toLowerCase());
  return found ? found.id : rows(d).put({ module: MODULE, kind: 'list', data: { name: clean } });
}
export async function renameList(id: number, name: string, d: FinanceDB = db): Promise<void> {
  const r = await rows(d).get(id);
  if (r && name.trim()) await rows(d).put({ id, module: MODULE, kind: 'list', data: { ...r.data, name: name.trim() } });
}
/** Deletes a list. Its tasks are kept and simply have no list afterwards. */
export async function deleteList(id: number, d: FinanceDB = db): Promise<number> {
  return d.transaction('rw', d.moduleRecords, async () => {
    const mine = (await loadTasks(d)).filter((t) => t.data.listId === id);
    for (const t of mine) await saveTask(t.id, { ...t.data, listId: null }, d);
    await rows(d).remove(id);
    return mine.length;
  });
}
