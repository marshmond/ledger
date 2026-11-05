import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { createStore } from '../../core/store';
import { completeTask, createList, createTask, deleteList, getTask, loadTasks, removeTasks, reopenTask, restoreTasks, loadDeletedTasks, updateTasks } from './data';
import { taskDueItems } from './dueProvider';
import { blankTask, type TaskRecord } from './model';
import { parseQuickAdd } from './quickAdd';
import { nextDueDate, spawnNext } from './recur';
import { buildView, matches, NO_FILTER, sortTasks, type ViewContext } from './views';

let n = 0;
const fresh = () => new FinanceDB(`test-tasks-${n++}`);
const TODAY = '2026-11-04'; // a Wednesday

describe('quick-add shorthand', () => {
  it('understands the example from the brief', () => {
    expect(parseQuickAdd('pay contractor fri !high #renovation @home', TODAY)).toMatchObject({
      title: 'pay contractor', dueDate: '2026-11-06', priority: 'high', tags: ['renovation'], list: 'home',
    });
  });
  it('dates: tomorrow, next week, in N days, month and day, m/d, ISO, and the next such weekday', () => {
    expect(parseQuickAdd('a tomorrow', TODAY).dueDate).toBe('2026-11-05');
    expect(parseQuickAdd('a next week', TODAY).dueDate).toBe('2026-11-09');
    expect(parseQuickAdd('a next fri', TODAY).dueDate).toBe('2026-11-06');
    expect(parseQuickAdd('a in 3 days', TODAY).dueDate).toBe('2026-11-07');
    expect(parseQuickAdd('a in 2 weeks', TODAY).dueDate).toBe('2026-11-18');
    expect(parseQuickAdd('file taxes nov 12', TODAY)).toMatchObject({ title: 'file taxes', dueDate: '2026-11-12' });
    expect(parseQuickAdd('a jan 5', TODAY).dueDate).toBe('2027-01-05');
    expect(parseQuickAdd('a 12/25', TODAY).dueDate).toBe('2026-12-25');
    expect(parseQuickAdd('a 2026-12-01', TODAY).dueDate).toBe('2026-12-01');
    expect(parseQuickAdd('a wed', TODAY).dueDate).toBe('2026-11-11'); // today is Wednesday: the next one
    expect(parseQuickAdd('a 13/45', TODAY).dueDate).toBeUndefined();
  });
  it('times need "at", am/pm or a colon; a bare number is part of the title', () => {
    expect(parseQuickAdd('call mom tomorrow at 3pm', TODAY)).toMatchObject({ title: 'call mom', dueDate: '2026-11-05', dueTime: '15:00' });
    expect(parseQuickAdd('meet 9:30am', TODAY)).toMatchObject({ title: 'meet', dueTime: '09:30', dueDate: TODAY });
    expect(parseQuickAdd('meet at 15:00', TODAY).dueTime).toBe('15:00');
    expect(parseQuickAdd('buy 3 items', TODAY)).toMatchObject({ title: 'buy 3 items' });
    expect(parseQuickAdd('buy 3 items', TODAY).dueTime).toBeUndefined();
  });
  it('repeats, and a plain title is always possible', () => {
    expect(parseQuickAdd('water plants every 2 weeks', TODAY)).toMatchObject({ title: 'water plants', repeat: { mode: 'fixed', rule: { freq: 'weekly', interval: 2 } } });
    expect(parseQuickAdd('gym every monday', TODAY)).toMatchObject({ dueDate: '2026-11-09', repeat: { rule: { freq: 'weekly', byWeekday: [1] } } });
    expect(parseQuickAdd('rent monthly', TODAY).repeat?.rule.freq).toBe('monthly');
    const plain = parseQuickAdd('just a plain title', TODAY);
    expect(plain).toEqual({ title: 'just a plain title', tags: [] });
    expect(parseQuickAdd('!nope something', TODAY).title).toBe('!nope something');
    expect(parseQuickAdd('fri', TODAY).title).toBe('fri'); // never lose what was typed
  });
});

describe('quick-add repeat words', () => {
  it('understands number words, "every other", biweekly and fortnightly', () => {
    for (const s of ['water plants every two weeks', 'water plants every other week', 'water plants biweekly', 'water plants fortnightly', 'water plants every 2 weeks']) {
      expect(parseQuickAdd(s, TODAY)).toMatchObject({ title: 'water plants', repeat: { mode: 'fixed', rule: { freq: 'weekly', interval: 2 } } });
    }
    expect(parseQuickAdd('pay rent every three months', TODAY)).toMatchObject({ title: 'pay rent', repeat: { rule: { freq: 'monthly', interval: 3 } } });
    expect(parseQuickAdd('stretch every other day', TODAY)).toMatchObject({ title: 'stretch', repeat: { rule: { freq: 'daily', interval: 2 } } });
  });
});

describe('repeating tasks', () => {
  const weekly = (mode: 'fixed' | 'after') => ({ mode, rule: { freq: 'weekly' as const, interval: 1, byWeekday: [1], end: { type: 'never' as const } } });
  it('fixed schedule: the next one follows the schedule, after the later of due date and finish day', () => {
    expect(nextDueDate('2026-11-02', weekly('fixed'), '2026-11-04')).toBe('2026-11-09');
    expect(nextDueDate('2026-11-09', weekly('fixed'), '2026-11-04')).toBe('2026-11-16'); // finished early
    expect(nextDueDate('2026-11-02', weekly('fixed'), '2026-11-30')).toBe('2026-12-07'); // finished weeks late: no pile of missed ones
  });
  it('after completion: the finish day plus the interval', () => {
    expect(nextDueDate('2026-11-02', { mode: 'after', rule: { freq: 'monthly', interval: 1, end: { type: 'never' } } }, TODAY)).toBe('2026-12-04');
    expect(nextDueDate(null, { mode: 'after', rule: { freq: 'daily', interval: 10, end: { type: 'never' } } }, TODAY)).toBe('2026-11-14');
    expect(nextDueDate(null, { mode: 'after', rule: { freq: 'yearly', interval: 1, end: { type: 'never' } } }, TODAY)).toBe('2027-11-04');
  });
  it('ends: after N times and on a date', () => {
    const t = blankTask({ title: 'x', dueDate: '2026-11-02', repeat: { mode: 'fixed', rule: { freq: 'weekly', interval: 1, end: { type: 'count', count: 2 } } } });
    const second = spawnNext(t, TODAY)!;
    expect(second.repeat?.rule.end).toEqual({ type: 'count', count: 1 });
    expect(spawnNext(second, TODAY)).toBeNull();
    expect(nextDueDate('2026-11-02', { mode: 'fixed', rule: { freq: 'daily', interval: 1, end: { type: 'until', date: '2026-11-04' } } }, TODAY)).toBeNull();
  });
  it('the next task starts fresh: to do, unchecked, same "do on" gap', () => {
    const t = blankTask({ title: 'x', dueDate: '2026-11-02', startDate: '2026-11-01', status: 'waiting', checklist: [{ id: 1, text: 'a', done: true }], repeat: weekly('fixed') });
    expect(spawnNext(t, TODAY)).toMatchObject({ dueDate: '2026-11-09', startDate: '2026-11-08', status: 'todo', checklist: [{ done: false }] });
    expect(spawnNext({ ...t, repeat: null }, TODAY)).toBeNull();
  });
});

describe('completing, undoing and deleting', () => {
  it('completing a repeating task creates the next; undoing removes it again', async () => {
    const d = fresh();
    const id = await createTask(blankTask({ title: 'Test filter', dueDate: '2026-11-02', repeat: { mode: 'fixed', rule: { freq: 'weekly', interval: 1, end: { type: 'never' } } } }), [], d);
    const { spawnedId } = await completeTask(id, TODAY, d);
    expect(spawnedId).toBeDefined();
    expect((await loadTasks(d)).map((t) => [t.data.status, t.data.dueDate]).sort()).toEqual([['done', '2026-11-02'], ['todo', '2026-11-09']]);
    expect((await getTask(id, d))?.data.completedAt).toBeGreaterThan(0);
    await reopenTask(id, d);
    expect((await loadTasks(d)).map((t) => [t.data.status, t.data.dueDate])).toEqual([['todo', '2026-11-02']]);
  });
  it('a plain task completes and reopens; double completing does nothing', async () => {
    const d = fresh();
    const id = await createTask(blankTask({ title: 'Test' }), [], d);
    expect(await completeTask(id, TODAY, d)).toEqual({});
    await completeTask(id, TODAY, d);
    expect((await loadTasks(d))).toHaveLength(1);
    await reopenTask(id, d);
    expect((await getTask(id, d))?.data).toMatchObject({ status: 'todo', completedAt: null });
  });
  it('soft delete and restore', async () => {
    const d = fresh();
    const id = await createTask(blankTask({ title: 'Test' }), [], d);
    await removeTasks([id], d);
    expect(await loadTasks(d)).toEqual([]);
    expect((await loadDeletedTasks(d)).map((t) => t.id)).toEqual([id]);
    expect((await d.moduleRecords.get(id))?.deletedAt).toBeGreaterThan(0);
    await restoreTasks([id], d);
    expect(await loadTasks(d)).toHaveLength(1);
  });
  it('a task made from a record links back to it, and the link works from both ends', async () => {
    const d = fresh();
    const id = await createTask(blankTask({ title: 'Check this', createdFrom: { module: 'ledger', id: 'account:12', label: 'Test checking' } }), [], d);
    const s = createStore(d);
    expect((await s.shared.links.linkedTo({ module: 'ledger', id: 'account:12' })).map((l) => l.fromId)).toEqual([id]);
    expect((await s.shared.links.linkedTo({ module: 'tasks', id })).map((l) => l.toId)).toEqual(['account:12']);
  });
  it('bulk changes, and deleting a list keeps its tasks', async () => {
    const d = fresh();
    const list = await createList('Renovation', d);
    expect(await createList('renovation', d)).toBe(list); // same name, same list
    const a = await createTask(blankTask({ title: 'A', listId: list }), [], d);
    const b = await createTask(blankTask({ title: 'B', listId: list }), [], d);
    await updateTasks([a, b], (t) => ({ ...t, priority: 'high', dueDate: '2026-11-10' }), d);
    expect((await loadTasks(d)).every((t) => t.data.priority === 'high' && t.data.dueDate === '2026-11-10')).toBe(true);
    expect(await deleteList(list, d)).toBe(2);
    expect((await loadTasks(d)).every((t) => t.data.listId === null)).toBe(true);
  });
});

describe('views, filters and sorting', () => {
  const t = (id: number, data: Partial<ReturnType<typeof blankTask>>): TaskRecord => ({ id, createdAt: id, updatedAt: id, data: blankTask({ title: `T${id}`, ...data }) });
  const all = [
    t(1, { dueDate: '2026-11-01' }), // overdue
    t(2, { dueDate: TODAY, priority: 'high' }),
    t(3, { startDate: TODAY }), // scheduled for today
    t(4, { dueDate: '2026-11-06', tagIds: [7], listId: 5 }),
    t(5, { dueDate: '2026-12-25' }),
    t(6, { status: 'waiting', dueDate: '2026-11-20', notes: 'call the Test Plumber' }),
    t(7, { status: 'done', completedAt: Date.parse('2026-11-03T12:00:00Z'), dueDate: TODAY }),
    t(8, { status: 'done', completedAt: Date.parse('2026-08-01T12:00:00Z') }),
    t(9, {}),
  ];
  const ctx = (over: Partial<ViewContext> = {}): ViewContext => ({ today: TODAY, days: 7, sort: 'due', filter: NO_FILTER, lists: [{ id: 5, name: 'Renovation' }], tags: [{ id: 7, name: 'home' }], now: Date.parse('2026-11-04T12:00:00Z'), ...over });
  const ids = (v: ReturnType<typeof buildView>) => v.map((g) => [g.title, g.tasks.map((x) => x.id)]);

  it('Today: overdue, due today, scheduled for today (done tasks never)', () => {
    expect(ids(buildView('today', all, [], ctx()))).toEqual([['Overdue', [1]], ['Due today', [2]], ['Scheduled for today', [3]]]);
  });
  it('Upcoming groups by day within the range, and widens', () => {
    expect(ids(buildView('upcoming', all, [], ctx())).map((g) => g[0])).toEqual(['2026-11-06']);
    expect(ids(buildView('upcoming', all, [], ctx({ days: 30 }))).map((g) => g[0])).toEqual(['2026-11-06', '2026-11-20']);
  });
  it('Upcoming and Completed obey the sort choice', () => {
    const u = buildView('upcoming', all, [], ctx({ days: 30, sort: 'title' }));
    expect(u).toHaveLength(1);
    expect(u[0].tasks.map((x) => x.id)).toEqual([4, 6]);
    const u2 = buildView('upcoming', all, [], ctx({ days: 30, sort: 'priority' }));
    expect(u2[0].tasks.map((x) => x.id)).toEqual([4, 6]);
    expect(buildView('completed', all, [], ctx({ sort: 'completed' }))[0].tasks.map((x) => x.id)).toEqual([7]);
    const two = [t(10, { status: 'done', completedAt: 1000, title: 'B' }), t(11, { status: 'done', completedAt: 2000, title: 'A' })];
    expect(buildView('completed', two, [], ctx({ sort: 'completed', now: 3000 }))[0].tasks.map((x) => x.id)).toEqual([11, 10]);
    expect(buildView('completed', two, [], ctx({ sort: 'title', now: 3000 }))[0].tasks.map((x) => x.id)).toEqual([11, 10]);
    expect(buildView('completed', two, [], ctx({ sort: 'title', now: 3000 }))[0].tasks[0].data.title).toBe('A');
  });
  it('Overdue, Waiting, All, By list, By tag, By priority', () => {
    expect(ids(buildView('overdue', all, [], ctx()))).toEqual([['Overdue', [1]]]);
    expect(ids(buildView('waiting', all, [], ctx())).map((g) => g[1])).toEqual([[6]]);
    expect(buildView('all', all, [], ctx())[0].tasks).toHaveLength(7);
    expect(ids(buildView('lists', all, [], ctx())).map((g) => g[0])).toEqual(['Renovation', 'No list']);
    expect(ids(buildView('tags', all, [], ctx())).map((g) => g[0])).toEqual(['#home', 'No tag']);
    expect(ids(buildView('priority', all, [], ctx())).map((g) => g[0])).toEqual(['High', 'Medium']);
  });
  it('Completed shows only recent completions, newest first', () => {
    expect(ids(buildView('completed', all, [], ctx())).map((g) => g[1])).toEqual([[7]]);
    expect(buildView('completed', all, [], ctx({ completedDays: 365 }))[0].tasks.map((x) => x.id)).toEqual([7, 8]);
  });
  it('search looks in title, notes and checklist; filters combine; sorting works', () => {
    expect(all.filter((x) => matches(x, { ...NO_FILTER, text: 'plumber' })).map((x) => x.id)).toEqual([6]);
    expect(all.filter((x) => matches(x, { ...NO_FILTER, priority: 'high' })).map((x) => x.id)).toEqual([2]);
    expect(all.filter((x) => matches(x, { ...NO_FILTER, listId: 5, tagId: 7 })).map((x) => x.id)).toEqual([4]);
    expect(all.filter((x) => matches(x, { ...NO_FILTER, listId: 'none' })).length).toBe(8);
    expect(sortTasks(all.filter((x) => x.data.status !== 'done'), 'priority')[0].id).toBe(2);
    expect(sortTasks(all, 'title')[0].data.title).toBe('T1');
    expect(sortTasks(all.slice(0, 3), 'created')[0].id).toBe(3);
  });
});

describe('Tasks on the Calendar (provider)', () => {
  const Q = { from: '2026-11-01', to: '2026-11-30', today: TODAY, overdueDays: 0 };
  it('dated open tasks appear, computed at read time; undated and done ones do not; nothing is stored', async () => {
    const d = fresh();
    await createTask(blankTask({ title: 'Dated', dueDate: '2026-11-10', dueTime: '14:30' }), [], d);
    await createTask(blankTask({ title: 'No date' }), [], d);
    await createTask(blankTask({ title: 'Done', dueDate: '2026-11-10', status: 'done' }), [], d);
    await createTask(blankTask({ title: 'Plan', startDate: '2026-11-08', dueDate: '2026-11-12' }), [], d);
    const before = await d.moduleRecords.count();
    const got = await taskDueItems(d, Q);
    expect(got.map((i) => [i.title, i.date, i.allDay, i.time])).toEqual([
      ['Start: Plan', '2026-11-08', true, undefined], ['Dated', '2026-11-10', false, '14:30'], ['Plan', '2026-11-12', true, undefined],
    ]);
    expect(await d.moduleRecords.count()).toBe(before);
    expect(got.every((i) => i.id.startsWith('tasks:') && i.status === 'open')).toBe(true);
  });
  it('overdue tasks come back when asked, only within the window', async () => {
    const d = fresh();
    await createTask(blankTask({ title: 'Late', dueDate: '2026-10-20' }), [], d);
    await createTask(blankTask({ title: 'Very late', dueDate: '2026-08-01' }), [], d);
    const agenda = { from: '2026-11-04', to: '2026-11-30', today: TODAY, overdueDays: 30 };
    expect((await taskDueItems(d, agenda)).map((i) => i.title)).toEqual(['Late']);
    expect(await taskDueItems(d, { ...agenda, overdueDays: 0 })).toEqual([]);
  });
  it('completing or rescheduling from the Calendar edits the task itself', async () => {
    const d = fresh();
    const id = await createTask(blankTask({ title: 'Edit me', dueDate: '2026-11-10' }), [], d);
    const item = (await taskDueItems(d, Q))[0];
    await item.actions!.reschedule!('2026-11-15');
    expect((await getTask(id, d))?.data.dueDate).toBe('2026-11-15');
    await (await taskDueItems(d, Q))[0].actions!.complete!();
    expect((await getTask(id, d))?.data.status).toBe('done');
    expect(await taskDueItems(d, Q)).toEqual([]);
    await item.actions!.reopen!();
    expect((await getTask(id, d))?.data.status).toBe('todo');
  });
});

describe('tasks in backups', () => {
  it('tasks, lists, deleted markers and links survive export and restore', async () => {
    const { importAll } = await import('../../lib/backup');
    const { buildBackup, checkBackupText } = await import('../../lib/backupFile');
    const d = fresh();
    const list = await createList('Taxes', d);
    const keep = await createTask(blankTask({ title: 'Keep', listId: list, checklist: [{ id: 1, text: 'step', done: true }], createdFrom: { module: 'ledger', id: 'account:1', label: 'Test checking' } }), [], d);
    const gone = await createTask(blankTask({ title: 'Gone' }), [], d);
    await removeTasks([gone], d);
    const m = new Map<string, string>();
    const mem = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    const { file } = checkBackupText(JSON.stringify(await buildBackup(d, mem as never)));
    const d2 = fresh();
    await importAll(d2, file);
    expect((await loadTasks(d2)).map((t) => t.data.title)).toEqual(['Keep']);
    expect((await getTask(keep, d2))?.data.checklist).toEqual([{ id: 1, text: 'step', done: true }]);
    expect((await loadDeletedTasks(d2)).map((t) => t.data.title)).toEqual(['Gone']);
    expect(await d2.links.count()).toBe(1);
    expect((await d2.moduleRecords.toArray()).filter((r) => r.kind === 'list')).toHaveLength(1);
  });
});
