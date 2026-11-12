import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { createList, createTask, getTask, saveTask, updateTasks } from './data';
import { blankTask, type TaskData } from './model';
import { bulkListAction, bulkPriorityAction, bulkTagAction } from './viewModel';

/**
 * D11 final correction. The bulk Priority, List and Add tag dropdowns used to read the dropdown's value inside the change function, which runs after the
 * dropdown has reset itself to "". These tests drive the REAL data layer (a fresh database) the way the page does: pick a value, let the dropdown reset, run
 * the write, read the records back, then Undo the way the page does (save each record's earlier data again). Every task and name is invented.
 */
let n = 0;
const fresh = () => new FinanceDB(`test-bulk-${n++}`);

/** A stand-in for a <select> that resets itself right after the choice, exactly as the page's dropdowns do (value="" is controlled). */
const dropdown = (chosen: string) => { const el = { value: chosen }; return { el, reset: () => { el.value = ''; } }; };

async function setup() {
  const db = fresh();
  const a = await createTask(blankTask({ title: 'A', priority: 'medium', listId: null, tagIds: [] }), [], db);
  const b = await createTask(blankTask({ title: 'B', priority: 'high', listId: null, tagIds: [] }), [], db);
  const home = await createList('Home', db);
  return { db, ids: [a, b], home };
}
const read = async (db: FinanceDB, ids: number[]) => Promise.all(ids.map(async (i) => (await getTask(i, db))!.data));
const snapshot = async (db: FinanceDB, ids: number[]) => Promise.all(ids.map(async (id) => ({ id, data: (await getTask(id, db))!.data })));
const undo = async (db: FinanceDB, before: { id: number; data: TaskData }[]) => { for (const t of before) await saveTask(t.id, t.data, db); };

/** What the page does for one dropdown: read the value first, build the action, reset the control, then write. */
async function choose(db: FinanceDB, ids: number[], make: (v: string) => ReturnType<typeof bulkPriorityAction>, value: string) {
  const dd = dropdown(value);
  const action = make(dd.el.value); // captured synchronously, before anything else
  dd.reset();
  if (action) await updateTasks(ids, action.change, db);
  return action;
}

describe('the old pattern stored bad values (why this fix exists)', () => {
  it('reading the control inside the change function after it reset stored "", 0 and tag 0', async () => {
    const { db, ids } = await setup();
    const prio = dropdown('low'); const list = dropdown('none'); const tag = dropdown('7');
    const oldPriority = (d: TaskData) => ({ ...d, priority: prio.el.value as TaskData['priority'] });
    const oldList = (d: TaskData) => ({ ...d, listId: list.el.value === 'none' ? null : Number(list.el.value) });
    const oldTag = (d: TaskData) => ({ ...d, tagIds: [...new Set([...d.tagIds, Number(tag.el.value)])] });
    prio.reset(); list.reset(); tag.reset(); // the dropdown has reset by the time the transaction runs
    await updateTasks(ids, oldPriority, db);
    expect((await db.moduleRecords.get(ids[0]))!.data.priority).toBe('');
    await updateTasks(ids, oldList, db);
    expect((await getTask(ids[0], db))!.data.listId).toBe(0);
    await updateTasks(ids, oldTag, db);
    expect((await getTask(ids[0], db))!.data.tagIds).toEqual([0]);
  });
});

describe('bulk Priority', () => {
  for (const p of ['low', 'high', 'medium', 'reminder'] as const) {
    it(`${p}: stores exactly ${p}, says so, and Undo restores both tasks`, async () => {
      const { db, ids } = await setup();
      const before = await snapshot(db, ids);
      const action = await choose(db, ids, bulkPriorityAction, p);
      expect(action!.label).toBe(`Priority ${p}`);
      expect((await read(db, ids)).map((d) => d.priority)).toEqual([p, p]);
      await undo(db, before);
      expect((await read(db, ids)).map((d) => d.priority)).toEqual(['medium', 'high']);
    });
  }
  it('an empty or unknown value writes nothing and gives no label (so no success toast)', async () => {
    const { db, ids } = await setup();
    for (const v of ['', 'urgent', 'LOW', ' low']) expect(await choose(db, ids, bulkPriorityAction, v)).toBeNull();
    expect((await read(db, ids)).map((d) => d.priority)).toEqual(['medium', 'high']);
  });
});

describe('bulk List', () => {
  it('a specific list: stores that list id (never 0), and Undo restores no list', async () => {
    const { db, ids, home } = await setup();
    const before = await snapshot(db, ids);
    const action = await choose(db, ids, bulkListAction, String(home));
    expect(action!.label).toBe('List changed');
    expect((await read(db, ids)).map((d) => d.listId)).toEqual([home, home]);
    expect(home).toBeGreaterThan(0);
    await undo(db, before);
    expect((await read(db, ids)).map((d) => d.listId)).toEqual([null, null]);
  });
  it('No list: stores null (the existing no-list value), not 0, and Undo restores the list', async () => {
    const { db, ids, home } = await setup();
    await updateTasks(ids, (d) => ({ ...d, listId: home }), db);
    const before = await snapshot(db, ids);
    await choose(db, ids, bulkListAction, 'none');
    expect((await read(db, ids)).map((d) => d.listId)).toEqual([null, null]);
    await undo(db, before);
    expect((await read(db, ids)).map((d) => d.listId)).toEqual([home, home]);
  });
  it('an empty, zero, negative or non-numeric value writes nothing', async () => {
    const { db, ids } = await setup();
    for (const v of ['', '0', '-3', 'abc', '1.5']) expect(await choose(db, ids, bulkListAction, v)).toBeNull();
    expect((await read(db, ids)).map((d) => d.listId)).toEqual([null, null]);
  });
});

describe('bulk Add tag', () => {
  it('adds the chosen tag id once (no 0), keeps existing tags, and Undo restores them', async () => {
    const { db, ids } = await setup();
    await updateTasks([ids[1]], (d) => ({ ...d, tagIds: [4] }), db);
    const before = await snapshot(db, ids);
    const action = await choose(db, ids, bulkTagAction, '9');
    expect(action!.label).toBe('Tag added');
    expect((await read(db, ids)).map((d) => d.tagIds)).toEqual([[9], [4, 9]]);
    await choose(db, ids, bulkTagAction, '9'); // choosing it again does not duplicate it
    expect((await read(db, ids)).map((d) => d.tagIds)).toEqual([[9], [4, 9]]);
    await undo(db, before);
    expect((await read(db, ids)).map((d) => d.tagIds)).toEqual([[], [4]]);
  });
  it('an empty, zero or non-numeric value writes nothing', async () => {
    const { db, ids } = await setup();
    for (const v of ['', '0', 'x', '-1']) expect(await choose(db, ids, bulkTagAction, v)).toBeNull();
    expect((await read(db, ids)).map((d) => d.tagIds)).toEqual([[], []]);
  });
});

describe('no invalid value is ever persisted by these actions', () => {
  it('after every action the records hold only real priorities, null or positive list ids and positive tag ids', async () => {
    const { db, ids, home } = await setup();
    await choose(db, ids, bulkPriorityAction, 'low');
    await choose(db, ids, bulkListAction, String(home));
    await choose(db, ids, bulkListAction, 'none');
    await choose(db, ids, bulkTagAction, '3');
    for (const d of await read(db, ids)) {
      expect(['high', 'medium', 'low', 'reminder']).toContain(d.priority);
      expect(d.listId === null || d.listId > 0).toBe(true);
      expect(d.tagIds.every((t) => t > 0)).toBe(true);
    }
  });
});

describe('the page uses the helpers and reads each dropdown value once, up front', () => {
  const page = readFileSync('src/modules/tasks/TasksPage.tsx', 'utf8');
  it('each of the three handlers calls its helper with e.target.value directly', () => {
    expect(page).toContain('bulkPriorityAction(e.target.value)');
    expect(page).toContain('bulkListAction(e.target.value)');
    expect(page).toContain('bulkTagAction(e.target.value)');
  });
  it('no change function in the page reads e.target.value later (the old defect)', () => {
    expect(page).not.toMatch(/\(d\) => \(\{[^}]*e\.target\.value/);
  });
});
