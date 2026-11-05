import { liveQuery } from 'dexie';
import type { QuickAddDef } from '../../core/registry';
import { store } from '../../core/store';
import { todayISO } from '../../lib/money';
import { createList, createTask, loadLists, removeTasks } from './data';
import { blankTask } from './model';
import { describeParsed, parseQuickAdd, type ParsedQuick } from './quickAdd';

/**
 * The Add box's Task destination. The words are read by the Tasks bar's own parser (`parseQuickAdd`, unchanged), and the task is
 * saved the same way the bar saves it. `start` keeps the names of existing lists and tags so the preview can say "(new)".
 */
let listNames: string[] = [];
let tagNames: string[] = [];

export const taskQuickAdd: QuickAddDef = {
  id: 'task',
  label: 'Task',
  prefix: 't',
  aliases: ['task'],
  start() {
    const a = liveQuery(async () => (await loadLists()).map((l) => l.name)).subscribe({ next: (v) => { listNames = v; }, error: () => undefined });
    const b = liveQuery(async () => (await store.shared.tags.query()).map((t) => t.name)).subscribe({ next: (v) => { tagNames = v; }, error: () => undefined });
    return () => { a.unsubscribe(); b.unsubscribe(); };
  },
  parse(text, opts) {
    const p: ParsedQuick = opts?.plain ? { title: text.trim(), tags: [] } : parseQuickAdd(text, todayISO());
    if (!p.title.trim()) return null;
    const lines = opts?.plain ? [] : describeParsed(p, listNames, tagNames);
    return {
      summary: [p.title, ...lines].join(', '),
      fields: [{ label: 'Task', value: p.title }, ...lines.map((l) => ({ label: '', value: l }))],
      payload: p,
    };
  },
  async commit(preview) {
    const p = preview.payload as ParsedQuick;
    const listId = p.list ? await createList(p.list) : null;
    const tagIds: number[] = [];
    const known = await store.shared.tags.query();
    for (const name of p.tags) {
      const found = known.find((t) => t.name.toLowerCase() === name.toLowerCase());
      tagIds.push(found?.id ?? (await store.shared.tags.put({ name })));
    }
    const id = await createTask(blankTask({
      title: p.title, notes: '', priority: p.priority ?? 'medium', dueDate: p.dueDate ?? null, dueTime: p.dueDate ? p.dueTime ?? null : null,
      repeat: p.repeat ?? null, tagIds, listId,
    }));
    return async () => { await removeTasks([id]); };
  },
};
