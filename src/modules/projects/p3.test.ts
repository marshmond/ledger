import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { allTodayCards, getModule } from '../../core/registry';
import { loadProjectChoices, projectLabel, readProjectId, selectableProjects } from '../../core/projectLink';
import { exportAll, importAll } from '../../lib/backup';
import { checkBackupText } from '../../lib/backupFile';
import { snapshotOf } from '../../lib/sync/engine';
import { installTracking } from '../../lib/sync/track';
import { applyFilter, activeFilterCount, buildRows, EMPTY_FILTER, touchesProject } from '../../lib/txnQuery';
import { loadProjectSummary, setTxnProject } from '../../lib/txnProject';
import type { Txn } from '../../types';
import { registerModules } from '../index';
import { createEvent, loadEvents, loadProjectEvents, newEventData, removeOccurrence, saveEdit, setEventProject } from '../calendar/data';
import { asEvent, blankFields, PERSONAL_ID } from '../calendar/model';
import { occurrencesOf } from '../calendar/occurrences';
import { pathFor as eventPath } from '../calendar/records';
import type { SeriesExtras } from '../calendar/series';
import { completeTask, createTask, getTask, loadTasks, removeTasks, reopenTask, saveTask } from '../tasks/data';
import { taskDueItems } from '../tasks/dueProvider';
import { asTask, blankTask } from '../tasks/model';
import { searchTasksData } from '../tasks/searchSource';
import { NO_FILTER, matches } from '../tasks/views';
import { archiveProject, createLine, createProject, loadProjects, restoreProject, setProjectStatus } from './data';
import { projectDueItems } from './dueProvider';
import { blankProject } from './model';
import { attentionPhrases, projectAttention } from './todayLogic';
import { createProjectTask, groupOf, loadProjectTasks, setMilestone, setTaskProject, summarizeWork, tally, upcomingActivity, workOf } from './work';

/** Invented data only. Each test gets its own database. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-p3-${n++}`); installTracking(d); return d; };
const TODAY = '2026-11-05';
const raw = (d: FinanceDB, id: number) => d.moduleRecords.get(id) as Promise<{ data: Record<string, unknown>; deletedAt?: number | null }>;
const mkProject = (d: FinanceDB, name = 'Test Kitchen', over = {}) => createProject(blankProject({ name, status: 'active', ...over }), d);
const ex = (over: Partial<SeriesExtras> = {}): SeriesExtras => ({ calendarId: PERSONAL_ID, tagIds: [], contactIds: [], recurrence: null, trackDone: false, ...over });
const weekly = { freq: 'weekly', interval: 1, end: { type: 'never' } } as const;

describe('project-linked tasks', () => {
  it('creates a task directly on a project through the normal Tasks command', async () => {
    const d = fresh();
    const p = await mkProject(d);
    const id = await createProjectTask(p, { title: '  Choose cabinet hardware ', dueDate: '2026-11-20' }, d);
    const t = (await getTask(id, d))!;
    expect(t.data).toMatchObject({ title: 'Choose cabinet hardware', projectId: p, dueDate: '2026-11-20', status: 'todo' });
    expect(t.data.isMilestone).toBeUndefined();
    expect((await loadProjectTasks(p, d)).map((x) => x.id)).toEqual([id]);
  });

  it('refuses an empty title and a project that does not exist', async () => {
    const d = fresh();
    const p = await mkProject(d);
    await expect(createProjectTask(p, { title: '  ' }, d)).rejects.toThrow('title');
    await expect(createProjectTask(99999, { title: 'Orphan' }, d)).rejects.toThrow('no longer exists');
    expect(await loadTasks(d)).toHaveLength(0);
  });

  it('an existing task can be put on a project and taken off again without being deleted', async () => {
    const d = fresh();
    const p = await mkProject(d);
    const id = await createTask(blankTask({ title: 'Get three quotes', notes: 'ask Sam', tagIds: [4] }), [], d);
    expect((await getTask(id, d))!.data.projectId).toBeUndefined();
    await setTaskProject(id, p, d);
    expect((await getTask(id, d))!.data).toMatchObject({ projectId: p, title: 'Get three quotes', notes: 'ask Sam', tagIds: [4] });
    await setTaskProject(id, null, d);
    const after = (await getTask(id, d))!;
    expect(after.data.projectId).toBeUndefined();
    expect(after.data.title).toBe('Get three quotes');
    expect((await raw(d, id)).deletedAt ?? null).toBeNull();
    expect('projectId' in (await raw(d, id)).data).toBe(false);
  });

  it('keeps a task on one project at a time: moving it replaces the old one', async () => {
    const d = fresh();
    const a = await mkProject(d, 'Test Kitchen');
    const b = await mkProject(d, 'Test Bathroom');
    const id = await createProjectTask(a, { title: 'Order tile' }, d);
    await setTaskProject(id, b, d);
    expect((await loadProjectTasks(a, d))).toHaveLength(0);
    expect((await loadProjectTasks(b, d)).map((t) => t.id)).toEqual([id]);
  });

  it('editing, completing and reopening keep the project and every unknown field', async () => {
    const d = fresh();
    const p = await mkProject(d);
    const id = await createProjectTask(p, { title: 'Schedule electrical inspection', dueDate: '2026-11-10' }, d);
    await d.moduleRecords.update(id, { data: { ...(await raw(d, id)).data, futureThing: { a: 1 } } } as never);
    const t = (await getTask(id, d))!;
    await saveTask(id, { ...t.data, notes: 'call Monday' }, d);
    expect((await raw(d, id)).data).toMatchObject({ projectId: p, notes: 'call Monday', futureThing: { a: 1 } });
    await completeTask(id, TODAY, d);
    expect((await getTask(id, d))!.data).toMatchObject({ projectId: p, status: 'done' });
    await reopenTask(id, d);
    expect((await raw(d, id)).data).toMatchObject({ projectId: p, status: 'todo', futureThing: { a: 1 } });
  });

  it('assigning and removing a project keeps fields it does not know', async () => {
    const d = fresh();
    const p = await mkProject(d);
    const id = await createTask(blankTask({ title: 'Probe' }), [], d);
    await d.moduleRecords.update(id, { data: { ...(await raw(d, id)).data, futureThing: 7 } } as never);
    await setTaskProject(id, p, d);
    expect((await raw(d, id)).data.futureThing).toBe(7);
    await setTaskProject(id, null, d);
    expect((await raw(d, id)).data.futureThing).toBe(7);
  });

  it('a repeating task keeps its project on the next one', async () => {
    const d = fresh();
    const p = await mkProject(d);
    const id = await createProjectTask(p, { title: 'Water the new sod', dueDate: '2026-11-06' }, d);
    const t = (await getTask(id, d))!;
    await saveTask(id, { ...t.data, repeat: { mode: 'fixed', rule: { ...weekly } } }, d);
    const { spawnedId } = await completeTask(id, TODAY, d);
    expect(spawnedId).toBeDefined();
    expect((await getTask(spawnedId!, d))!.data.projectId).toBe(p);
  });

  it('works with archived, cancelled and missing projects without losing anything', async () => {
    const d = fresh();
    const p = await mkProject(d);
    const id = await createProjectTask(p, { title: 'Keep me' }, d);
    await archiveProject(p, d);
    expect((await getTask(id, d))!.data.projectId).toBe(p);
    const choices = await loadProjectChoices(d);
    expect(projectLabel(choices, p)).toBe('Test Kitchen (archived)');
    await restoreProject(p, d);
    await setProjectStatus(p, 'cancelled', d);
    expect(projectLabel(await loadProjectChoices(d), p)).toBe('Test Kitchen (cancelled)');
    // The id of a project that is gone: the task stays a normal task and the label says so.
    await d.moduleRecords.update(id, { data: { ...(await raw(d, id)).data, projectId: 424242 } } as never);
    const t = (await getTask(id, d))!;
    expect(t.data.projectId).toBe(424242);
    expect(projectLabel(await loadProjectChoices(d), 424242)).toBe('(project removed)');
    expect(projectLabel(choices, undefined)).toBe('');
    // ...and can be cleared, or moved onto a real project
    await setTaskProject(id, null, d);
    expect((await getTask(id, d))!.data.projectId).toBeUndefined();
    await expect(setTaskProject(id, 424242, d)).rejects.toThrow('no longer exists');
  });

  it('the project picker hides archived and finished projects but keeps the one already chosen', async () => {
    const d = fresh();
    const open = await mkProject(d, 'Open one');
    const arch = await mkProject(d, 'Archived one');
    const done = await mkProject(d, 'Done one', { status: 'completed' });
    await archiveProject(arch, d);
    const choices = await loadProjectChoices(d);
    expect(selectableProjects(choices).map((c) => c.id)).toEqual([open]);
    expect(selectableProjects(choices, arch).map((c) => c.id).sort()).toEqual([open, arch].sort());
    expect(selectableProjects(choices, done).map((c) => c.id)).toContain(done);
  });

  it('deleting a task is different from taking it off a project', async () => {
    const d = fresh();
    const p = await mkProject(d);
    const id = await createProjectTask(p, { title: 'Temporary' }, d);
    await removeTasks([id], d);
    expect(await getTask(id, d)).toBeUndefined();
    expect((await loadProjectTasks(p, d))).toHaveLength(0);
  });

  it('reads a bad projectId defensively', () => {
    expect(readProjectId({ projectId: 'x' })).toBeUndefined();
    expect(readProjectId({ projectId: NaN })).toBeUndefined();
    expect(readProjectId(null)).toBeUndefined();
    expect(readProjectId({ projectId: 7 })).toBe(7);
    const t = asTask({ id: 1, module: 'tasks', kind: 'task', data: { title: 'x', projectId: 'oops', isMilestone: true }, createdAt: 0, updatedAt: 0 } as never);
    expect(t.data.projectId).toBeUndefined();
    expect(t.data.isMilestone).toBeUndefined();
  });

  it('the Tasks module can filter by project or by no project', async () => {
    const d = fresh();
    const p = await mkProject(d);
    await createProjectTask(p, { title: 'In project' }, d);
    await createTask(blankTask({ title: 'Loose' }), [], d);
    const all = await loadTasks(d);
    const titles = (f: object) => all.filter((t) => matches(t, { ...NO_FILTER, ...f } as never)).map((t) => t.data.title);
    expect(titles({ projectId: p })).toEqual(['In project']);
    expect(titles({ projectId: 'none' })).toEqual(['Loose']);
    expect(titles({ projectId: '' }).sort()).toEqual(['In project', 'Loose']);
    expect(titles({})).toHaveLength(2);
  });
});

describe('milestones', () => {
  it('a milestone is a project task with isMilestone and uses the normal due date and completion', async () => {
    const d = fresh();
    const p = await mkProject(d);
    const id = await createProjectTask(p, { title: 'Permit approved', dueDate: '2026-11-12', milestone: true }, d);
    const t = (await getTask(id, d))!;
    expect(t.data).toMatchObject({ isMilestone: true, projectId: p, dueDate: '2026-11-12', status: 'todo' });
    await completeTask(id, TODAY, d);
    expect((await getTask(id, d))!.data).toMatchObject({ status: 'done', isMilestone: true });
    expect((await getTask(id, d))!.data.completedAt).not.toBeNull();
    await reopenTask(id, d);
    expect((await getTask(id, d))!.data).toMatchObject({ status: 'todo', completedAt: null, isMilestone: true, projectId: p });
  });

  it('no table of its own: nothing is stored besides the task record', async () => {
    const d = fresh();
    const p = await mkProject(d);
    await createProjectTask(p, { title: 'Cabinets delivered', milestone: true }, d);
    const kinds = (await d.moduleRecords.toArray()).map((r) => `${r.module}/${r.kind}`).sort();
    expect(kinds).toEqual(['projects/project', 'tasks/task']);
  });

  it('is counted once: milestones and ordinary tasks are separate in every total', async () => {
    const d = fresh();
    const p = await mkProject(d);
    const m1 = await createProjectTask(p, { title: 'Rough plumbing done', dueDate: '2026-11-01', milestone: true }, d);
    await createProjectTask(p, { title: 'Final inspection passed', dueDate: '2026-12-01', milestone: true }, d);
    const t1 = await createProjectTask(p, { title: 'Pick paint', dueDate: '2026-11-03' }, d);
    await createProjectTask(p, { title: 'Pick faucet' }, d);
    await completeTask(t1, TODAY, d);
    const all = await loadTasks(d);
    const w = workOf(all, p);
    expect(w.tasks.map((t) => t.data.title).sort()).toEqual(['Pick faucet', 'Pick paint']);
    expect(w.milestones.map((t) => t.data.title).sort()).toEqual(['Final inspection passed', 'Rough plumbing done']);
    const s = summarizeWork(all, p, TODAY);
    expect(s.tasks).toMatchObject({ total: 2, done: 1, open: 1, overdue: 0, percent: 50 });
    expect(s.milestones).toMatchObject({ total: 2, done: 0, open: 2, overdue: 1, percent: 0 });
    expect(s.nextMilestone?.id).toBe(m1);
    expect(s.tasks.total + s.milestones.total).toBe((await loadProjectTasks(p, d)).length);
  });

  it('overdue only when open and before today (due today is not overdue)', () => {
    const mk = (id: number, due: string | null, status = 'todo') => asTask({ id, module: 'tasks', kind: 'task', data: { title: `t${id}`, dueDate: due, status, projectId: 1, isMilestone: true }, createdAt: 0, updatedAt: 0 } as never);
    const list = [mk(1, '2026-11-04'), mk(2, TODAY), mk(3, '2026-11-06'), mk(4, null), mk(5, '2026-10-01', 'done')];
    expect(tally(list, TODAY)).toMatchObject({ total: 5, done: 1, open: 4, overdue: 1 });
    expect(list.map((t) => groupOf(t, TODAY))).toEqual(['overdue', 'open', 'open', 'open', 'done']);
    expect(tally([], TODAY)).toMatchObject({ total: 0, percent: 0 });
  });

  it('shows on the Calendar through the Tasks provider, once, marked as a milestone and tied to its project', async () => {
    const d = fresh();
    const p = await mkProject(d);
    await createProjectTask(p, { title: 'Final inspection passed', dueDate: '2026-11-12', milestone: true }, d);
    await createProjectTask(p, { title: 'Pick paint', dueDate: '2026-11-12' }, d);
    const items = await taskDueItems(d, { from: '2026-11-01', to: '2026-11-30', today: TODAY, overdueDays: 0 });
    expect(items.map((i) => i.title).sort()).toEqual(['Pick paint', '◆ Final inspection passed']);
    expect(items.every((i) => i.projectId === p && i.sourceModule === 'tasks')).toBe(true);
    // No separate calendar event is made for a milestone.
    expect(await loadEvents(d)).toHaveLength(0);
  });

  it('taking a milestone off its project makes it an ordinary task; it needs a project and cannot repeat', async () => {
    const d = fresh();
    const p = await mkProject(d);
    const id = await createProjectTask(p, { title: 'Cabinets delivered', milestone: true }, d);
    await setTaskProject(id, null, d);
    expect((await raw(d, id)).data).not.toHaveProperty('isMilestone');
    await expect(setMilestone(id, true, d)).rejects.toThrow('project first');
    await setTaskProject(id, p, d);
    await setMilestone(id, true, d);
    expect((await getTask(id, d))!.data.isMilestone).toBe(true);
    const t = (await getTask(id, d))!;
    await saveTask(id, { ...t.data, repeat: { mode: 'fixed', rule: { ...weekly } } }, d);
    await setMilestone(id, false, d);
    await saveTask(id, { ...(await getTask(id, d))!.data, repeat: { mode: 'fixed', rule: { ...weekly } } }, d);
    await expect(setMilestone(id, true, d)).rejects.toThrow('cannot be a milestone');
  });

  it('an older or foreign task with both a milestone flag and a repeat stays predictable', async () => {
    const d = fresh();
    const p = await mkProject(d);
    const id = await createProjectTask(p, { title: 'Quarterly inspection', dueDate: '2026-11-10', milestone: true }, d);
    const plain = await createProjectTask(p, { title: 'Pick paint', dueDate: '2026-11-11' }, d);
    // The legacy shape: the flag, a repeat rule and a field this version does not know, all on one record.
    await d.moduleRecords.update(id, { data: { ...(await raw(d, id)).data, repeat: { mode: 'fixed', rule: { ...weekly } }, futureThing: 'kept' } } as never);
    // An ordinary editor save changes nothing about the flag, the repeat or the unknown field.
    const t0 = (await getTask(id, d))!;
    await saveTask(id, { ...t0.data, notes: 'edited' }, d);
    expect((await raw(d, id)).data).toMatchObject({ isMilestone: true, projectId: p, repeat: { mode: 'fixed' }, futureThing: 'kept', notes: 'edited' });
    // Completing makes the next one exactly as for any repeating task; it is still this project's milestone, still not a task.
    const { spawnedId } = await completeTask(id, TODAY, d);
    expect(spawnedId).toBeDefined();
    expect((await raw(d, spawnedId!)).data).toMatchObject({ isMilestone: true, projectId: p, status: 'todo', futureThing: 'kept' });
    const all = await loadTasks(d);
    const s = summarizeWork(all, p, TODAY);
    // Each stored record counts once, in milestones only: the finished one and the new open one. Ordinary tasks are untouched.
    expect(s.milestones).toMatchObject({ total: 2, done: 1, open: 1 });
    expect(s.tasks).toMatchObject({ total: 1, done: 0, open: 1 });
    expect(workOf(all, p).tasks.map((x) => x.id)).toEqual([plain]);
    expect(s.nextMilestone?.id).toBe(spawnedId);
    // The Calendar shows the open one once, marked as a milestone; the finished one is gone from it.
    const items = await taskDueItems(d, { from: '2026-11-01', to: '2026-12-31', today: TODAY, overdueDays: 0 });
    expect(items.filter((i) => i.title.includes('Quarterly inspection')).map((i) => i.title)).toEqual(['◆ Quarterly inspection']);
    // The editor refuses to switch the flag ON for a repeating task (it never creates the combination itself).
    await expect(setMilestone(plain, true, d)).resolves.toBeUndefined();
    await saveTask(plain, { ...(await getTask(plain, d))!.data, repeat: { mode: 'fixed', rule: { ...weekly } } }, d);
    await setMilestone(plain, false, d);
    await expect(setMilestone(plain, true, d)).rejects.toThrow('cannot be a milestone');
  });

  it('moving a milestone to another project keeps it a milestone', async () => {
    const d = fresh();
    const a = await mkProject(d);
    const b = await mkProject(d, 'Test Bathroom');
    const id = await createProjectTask(a, { title: 'Permit approved', milestone: true }, d);
    await setTaskProject(id, b, d);
    expect((await getTask(id, d))!.data).toMatchObject({ projectId: b, isMilestone: true });
  });
});

describe('project-linked events', () => {
  const makeEvent = async (d: FinanceDB, over: Partial<SeriesExtras> = {}, title = 'Contractor walkthrough', date = '2026-11-10') =>
    createEvent(newEventData({ ...blankFields(date), title }, ex(over)), d);
  const firstOcc = async (d: FinanceDB, id: number, from = '2026-11-01', to = '2026-12-31') => {
    const ev = (await loadEvents(d)).find((e) => e.id === id)!;
    return occurrencesOf(ev, from, to)[0];
  };

  it('creates an event on a project and reads it back', async () => {
    const d = fresh();
    const p = await mkProject(d);
    const id = await makeEvent(d, { projectId: p });
    expect((await loadProjectEvents(p, d)).map((e) => e.id)).toEqual([id]);
    expect((await loadEvents(d))[0].data.projectId).toBe(p);
  });

  it('events without a project are unchanged', async () => {
    const d = fresh();
    const id = await makeEvent(d);
    expect((await raw(d, id)).data).not.toHaveProperty('projectId');
    const occ = await firstOcc(d, id);
    await saveEdit(occ, { ...blankFields('2026-11-10'), title: 'Renamed' }, ex(), 'all', d);
    expect((await raw(d, id)).data).not.toHaveProperty('projectId');
  });

  it('an ordinary edit (no project key) keeps the project', async () => {
    const d = fresh();
    const p = await mkProject(d);
    const id = await makeEvent(d, { projectId: p });
    const occ = await firstOcc(d, id);
    await saveEdit(occ, { ...blankFields('2026-11-10'), title: 'Moved walkthrough', location: 'Site' }, ex(), 'all', d);
    expect((await raw(d, id)).data).toMatchObject({ projectId: p, title: 'Moved walkthrough', location: 'Site' });
  });

  it('the editor can change the project and remove it', async () => {
    const d = fresh();
    const a = await mkProject(d);
    const b = await mkProject(d, 'Test Bathroom');
    const id = await makeEvent(d, { projectId: a });
    const occ = await firstOcc(d, id);
    await saveEdit(occ, { ...blankFields('2026-11-10'), title: 'Contractor walkthrough' }, ex({ projectId: b }), 'all', d);
    expect((await raw(d, id)).data.projectId).toBe(b);
    await saveEdit(await firstOcc(d, id), { ...blankFields('2026-11-10'), title: 'Contractor walkthrough' }, ex({ projectId: undefined }), 'all', d);
    expect((await loadEvents(d))[0].data.projectId).toBeUndefined();
  });

  it('setEventProject links and unlinks without touching anything else, and keeps unknown fields', async () => {
    const d = fresh();
    const p = await mkProject(d);
    const id = await makeEvent(d, { tagIds: [3] }, 'Appliance delivery');
    await d.moduleRecords.update(id, { data: { ...(await raw(d, id)).data, futureThing: 'kept' } } as never);
    await setEventProject(id, p, d);
    expect((await raw(d, id)).data).toMatchObject({ projectId: p, title: 'Appliance delivery', tagIds: [3], futureThing: 'kept' });
    await setEventProject(id, null, d);
    const after = (await raw(d, id)).data;
    expect(after).not.toHaveProperty('projectId');
    expect(after).toMatchObject({ title: 'Appliance delivery', futureThing: 'kept' });
    expect((await raw(d, id)).deletedAt ?? null).toBeNull();
    await expect(setEventProject(id, 424242, d)).rejects.toThrow('no longer exists');
    await expect(setEventProject(777777, p, d)).rejects.toThrow('no longer exists');
  });

  it('a repeating event keeps its project through edits to one date, to following dates and when a date is deleted', async () => {
    const d = fresh();
    const p = await mkProject(d);
    const id = await makeEvent(d, { projectId: p, recurrence: { ...weekly } }, 'Weekly site meeting', '2026-11-02');
    const second = (await firstOcc(d, id, '2026-11-09', '2026-11-16'));
    await saveEdit(second, { ...blankFields('2026-11-09'), title: 'Special meeting' }, ex({ recurrence: { ...weekly } }), 'one', d);
    expect((await raw(d, id)).data.projectId).toBe(p);
    const third = await firstOcc(d, id, '2026-11-16', '2026-11-23');
    const nextId = await saveEdit(third, { ...blankFields('2026-11-16'), title: 'Later meeting' }, ex({ recurrence: { ...weekly } }), 'following', d);
    expect(nextId).not.toBe(id);
    expect((await raw(d, nextId)).data.projectId).toBe(p);
    expect((await raw(d, id)).data.projectId).toBe(p);
    await removeOccurrence(await firstOcc(d, id, '2026-11-02', '2026-11-02'), 'one', d);
    expect((await raw(d, id)).data.projectId).toBe(p);
  });

  it('putting a repeating event on a project covers the whole series, and one project at a time', async () => {
    const d = fresh();
    const a = await mkProject(d);
    const id = await makeEvent(d, { recurrence: { ...weekly } }, 'Weekly inspection', '2026-11-02');
    await setEventProject(id, a, d);
    const ev = (await loadEvents(d))[0];
    expect(occurrencesOf(ev, '2026-11-01', '2026-11-30').length).toBeGreaterThan(3);
    expect(ev.data.projectId).toBe(a);
  });

  it('works with an archived project, and a stale id is just ignored', async () => {
    const d = fresh();
    const p = await mkProject(d);
    const id = await makeEvent(d, { projectId: p });
    await archiveProject(p, d);
    expect((await loadProjectEvents(p, d))).toHaveLength(1);
    await d.moduleRecords.update(id, { data: { ...(await raw(d, id)).data, projectId: 'bad' } } as never);
    expect((await loadEvents(d))[0].data.projectId).toBeUndefined();
    expect(asEvent({ id: 1, module: 'calendar', kind: 'event', data: { title: 'x', projectId: 99 }, createdAt: 0, updatedAt: 0 } as never).data.projectId).toBe(99);
  });

  it('a retired event is not offered as a project event', async () => {
    const d = fresh();
    const p = await mkProject(d);
    const id = await makeEvent(d, { projectId: p });
    await d.moduleRecords.update(id, { data: { ...(await raw(d, id)).data, retired: { module: 'ledger', recordId: 1, note: 'x' } } } as never);
    expect(await loadProjectEvents(p, d)).toHaveLength(0);
  });
});

describe('project dates on the Calendar', () => {
  const q = { from: '2026-11-01', to: '2026-12-31', today: TODAY, overdueDays: 0 };

  it('start and target dates appear as informational markers; the past ones are handled, never overdue', async () => {
    const d = fresh();
    const p = await mkProject(d, 'Test Kitchen', { startDate: '2026-11-01', targetDate: '2026-12-15' });
    const items = await projectDueItems(d, q);
    expect(items.map((i) => [i.title, i.date, i.status])).toEqual([['Start: Test Kitchen', '2026-11-01', 'handled'], ['Target: Test Kitchen', '2026-12-15', 'open']]);
    expect(items.every((i) => i.projectId === p && !i.actions && i.sourceModule === 'projects')).toBe(true);
  });

  it('archived, cancelled and completed projects show no markers', async () => {
    const d = fresh();
    const a = await mkProject(d, 'A', { targetDate: '2026-12-01' });
    await mkProject(d, 'B', { targetDate: '2026-12-02', status: 'cancelled' });
    await mkProject(d, 'C', { targetDate: '2026-12-03', status: 'completed' });
    await mkProject(d, 'D', { targetDate: '2026-12-04', status: 'on_hold' });
    await archiveProject(a, d);
    expect((await projectDueItems(d, q)).map((i) => i.title)).toEqual(['Target: D']);
  });

  it('a target date that is also a milestone day shows both entries, each once, and changes no record', async () => {
    const d = fresh();
    const p = await mkProject(d, 'Test Kitchen', { targetDate: '2026-12-15' });
    const ms = await createProjectTask(p, { title: 'Final inspection passed', dueDate: '2026-12-15', milestone: true }, d);
    const before = JSON.stringify(await d.moduleRecords.toArray());
    expect((await projectDueItems(d, q)).map((i) => i.title)).toEqual(['Target: Test Kitchen']);
    const tasks = await taskDueItems(d, q);
    expect(tasks.filter((i) => i.date === '2026-12-15').map((i) => i.title)).toEqual(['◆ Final inspection passed']);
    expect(JSON.stringify(await d.moduleRecords.toArray())).toBe(before);
    // Completing the milestone leaves the target marker alone.
    await completeTask(ms, TODAY, d);
    expect((await projectDueItems(d, q)).map((i) => i.title)).toEqual(['Target: Test Kitchen']);
  });

  it('is registered with the Projects module and has its own built-in calendar', () => {
    registerModules();
    expect(getModule('projects')?.contributes?.dueProvider?.id).toBe('projects');
  });
});

describe('the project page: upcoming activity and navigation', () => {
  it('combines tasks, milestones and events once each, soonest first, with overdue marked', async () => {
    const d = fresh();
    const p = await mkProject(d);
    const other = await mkProject(d, 'Test Bathroom');
    await createProjectTask(p, { title: 'Late milestone', dueDate: '2026-11-01', milestone: true }, d);
    await createProjectTask(p, { title: 'Pick paint', dueDate: '2026-11-08' }, d);
    await createProjectTask(p, { title: 'Far away', dueDate: '2027-03-01' }, d);
    const done = await createProjectTask(p, { title: 'Already done', dueDate: '2026-11-07' }, d);
    await completeTask(done, TODAY, d);
    await createProjectTask(other, { title: 'Someone else', dueDate: '2026-11-08' }, d);
    await createEvent(newEventData({ ...blankFields('2026-11-06'), title: 'Walkthrough' }, ex({ projectId: p })), d);
    await createEvent(newEventData({ ...blankFields('2026-11-02'), title: 'Past visit' }, ex({ projectId: p })), d);
    const list = upcomingActivity(await loadTasks(d), await loadEvents(d), p, TODAY, 30);
    expect(list.map((a) => [a.kind, a.title, a.overdue])).toEqual([['milestone', 'Late milestone', true], ['event', 'Walkthrough', false], ['task', 'Pick paint', false]]);
    expect(new Set(list.map((a) => a.key)).size).toBe(list.length);
  });

  it('a repeating project event lists its next dates, not the whole series', async () => {
    const d = fresh();
    const p = await mkProject(d);
    await createEvent(newEventData({ ...blankFields('2026-11-02'), title: 'Weekly meeting' }, ex({ projectId: p, recurrence: { ...weekly } })), d);
    const list = upcomingActivity([], await loadEvents(d), p, TODAY, 14);
    expect(list.map((a) => a.date)).toEqual(['2026-11-09', '2026-11-16']);
  });

  it('every record opens at a real address: task, event, project and transaction', async () => {
    const d = fresh();
    const p = await mkProject(d);
    const t = await createProjectTask(p, { title: 'Pick paint', dueDate: '2026-11-08' }, d);
    const e = await createEvent(newEventData({ ...blankFields('2026-11-10'), title: 'Walkthrough' }, ex({ projectId: p })), d);
    const act = upcomingActivity(await loadTasks(d), await loadEvents(d), p, TODAY).map((a) => a.path);
    expect(act).toContain(`/tasks?task=${t}`);
    const ev = (await loadEvents(d)).find((x) => x.id === e)!;
    expect(eventPath(ev)).toMatch(new RegExp(`^/calendar\\?v=agenda&d=2026-11-10&open=e%3A${e}%3A`));
    expect(act.some((x) => x.startsWith('/calendar?'))).toBe(true);
  });
});

describe("Today's Projects card", () => {
  const proj = (id: number, over = {}) => ({ id, createdAt: 0, updatedAt: 0, data: { ...blankProject({ name: `P${id}`, status: 'active' }), ...over } });
  const task = (id: number, projectId: number, due: string | null, extra = {}) => asTask({ id, module: 'tasks', kind: 'task', data: { title: `Secret task ${id}`, dueDate: due, projectId, ...extra }, createdAt: 0, updatedAt: 0 } as never);

  it('lists active projects with overdue milestones or tasks, or a target that is past or within 14 days', () => {
    const projects = [proj(1), proj(2), proj(3, { targetDate: '2026-11-10' }), proj(4, { targetDate: '2026-10-01' }), proj(5, { targetDate: '2027-06-01' })];
    const tasks = [task(1, 1, '2026-11-01', { isMilestone: true }), task(2, 2, '2026-11-02'), task(3, 5, '2026-12-01')];
    const out = projectAttention(projects as never, tasks, TODAY);
    expect(out.map((a) => a.project.id)).toEqual([1, 4, 2, 3]);
    expect(attentionPhrases(out[0])).toEqual(['1 milestone overdue']);
    expect(attentionPhrases(out[1])).toEqual(['35 days past target']);
    expect(attentionPhrases(out[2])).toEqual(['1 task overdue']);
    expect(attentionPhrases(out[3])).toEqual(['Target in 5 days']);
  });

  it('never lists archived, cancelled, completed or on-hold projects', () => {
    const late = { targetDate: '2026-10-01' };
    const projects = [proj(1, { ...late, archived: true }), proj(2, { ...late, status: 'cancelled' }), proj(3, { ...late, status: 'completed' }), proj(4, { ...late, status: 'on_hold' }), proj(5, { ...late, status: 'planning' })];
    expect(projectAttention(projects as never, [task(1, 1, '2026-10-01', { isMilestone: true })], TODAY).map((a) => a.project.id)).toEqual([5]);
  });

  it('is quiet when nothing is late, and a done milestone is not overdue', () => {
    const projects = [proj(1, { targetDate: '2027-06-01' })];
    expect(projectAttention(projects as never, [task(1, 1, '2026-11-01', { isMilestone: true, status: 'done' })], TODAY)).toEqual([]);
    expect(projectAttention([], [], TODAY)).toEqual([]);
  });

  it('is one row per project and carries only counts, so no task or event is shown twice on Today', () => {
    const projects = [proj(1)];
    const tasks = [task(1, 1, '2026-11-01'), task(2, 1, '2026-11-02'), task(3, 1, '2026-11-03', { isMilestone: true })];
    const out = projectAttention(projects as never, tasks, TODAY);
    expect(out).toHaveLength(1);
    expect(attentionPhrases(out[0])).toEqual(['1 milestone overdue', '2 tasks overdue']);
    expect(JSON.stringify(attentionPhrases(out[0]))).not.toContain('Secret task');
  });

  it('is offered by the Projects module as a hide-when-empty Today card', () => {
    registerModules();
    const card = allTodayCards().find((c) => c.id === 'projects.attention');
    expect(card).toMatchObject({ moduleId: 'projects', hideWhenEmpty: true });
  });
});

describe('Finance: project filter and transaction navigation', () => {
  const txn = (id: number, over: Partial<Txn> = {}): Txn => ({ id, accountId: 1, date: '2026-11-01', amountCents: -1000, payee: `Payee ${id}`, memo: '', status: 'cleared', categoryId: null, ...over });
  const rows = (ts: Txn[]) => buildRows(ts, [{ id: 1, name: 'Checking' } as never], []);

  it('filters to a project: whole-transaction tags and split pieces both count, others do not', () => {
    const ts = [
      txn(1, { project: { projectId: 7 } }),
      txn(2, { categoryId: null, amountCents: -3000, splits: [{ categoryId: null, amountCents: -1000, project: { projectId: 7 } }, { categoryId: null, amountCents: -2000 }] as never }),
      txn(3, { project: { projectId: 8 } }),
      txn(4),
    ];
    expect(applyFilter(rows(ts), { ...EMPTY_FILTER, projectId: 7 }).map((r) => r.txn.id)).toEqual([1, 2]);
    expect(applyFilter(rows(ts), EMPTY_FILTER)).toHaveLength(4);
    expect(touchesProject(ts[2], 7)).toBe(false);
    expect(activeFilterCount({ ...EMPTY_FILTER, projectId: 7 })).toBe(1);
    expect(activeFilterCount(EMPTY_FILTER)).toBe(0);
    // An old saved filter has no projectId at all and still works.
    const old = { ...EMPTY_FILTER } as Record<string, unknown>;
    delete old.projectId;
    expect(applyFilter(rows(ts), old as never)).toHaveLength(4);
  });

  it('project totals are unchanged by anything P3 added', async () => {
    const d = fresh();
    const p = await mkProject(d);
    await createLine(p, 'Tile', 500000, d);
    const aid = await d.accounts.add({ name: 'Checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' } as never);
    const tid = await d.txns.add({ accountId: aid, date: '2026-11-02', amountCents: -25000, payee: 'Tile Co', memo: '', status: 'cleared', categoryId: null } as never);
    await setTxnProject(d, tid as number, { projectId: p });
    const before = await loadProjectSummary(d, p);
    await createProjectTask(p, { title: 'A task', dueDate: '2026-11-08' }, d);
    await createProjectTask(p, { title: 'A milestone', milestone: true }, d);
    await createEvent(newEventData({ ...blankFields('2026-11-10'), title: 'Walkthrough' }, ex({ projectId: p })), d);
    expect(await loadProjectSummary(d, p)).toEqual(before);
    expect(before?.paidCents).toBe(25000);
  });
});

describe('search, links, backup and sync', () => {
  it('a project task is found once by search, with the same address as before', async () => {
    const d = fresh();
    const p = await mkProject(d);
    await createProjectTask(p, { title: 'Choose cabinet hardware' }, d);
    await createTask(blankTask({ title: 'Choose a plumber' }), [], d);
    const hits = searchTasksData('cabinet', await loadTasks(d), [], []).filter((h) => h.kind === 'Task');
    expect(hits).toHaveLength(1);
    expect(hits[0].path).toMatch(/^\/tasks\?task=\d+$/);
  });

  it('record links to and from a project task still work', async () => {
    const d = fresh();
    const p = await mkProject(d);
    const id = await createTask({ ...blankTask({ title: 'Review final invoice' }), projectId: p }, [{ module: 'projects', id: p }], d);
    const links = await d.links.toArray();
    expect(links.filter((l) => l.fromModule === 'tasks' && l.fromId === id && l.toModule === 'projects' && l.toId === p)).toHaveLength(1);
    await setTaskProject(id, null, d);
    expect((await d.links.toArray()).filter((l) => l.fromId === id)).toHaveLength(1); // the link is its own record; untouched
  });

  it('survive a backup and restore: project ids, milestone flags and unknown fields', async () => {
    const d = fresh();
    const p = await mkProject(d);
    const t = await createProjectTask(p, { title: 'Permit approved', dueDate: '2026-11-12', milestone: true }, d);
    const e = await createEvent(newEventData({ ...blankFields('2026-11-10'), title: 'Walkthrough' }, ex({ projectId: p })), d);
    await d.moduleRecords.update(t, { data: { ...(await raw(d, t)).data, futureThing: 'x' } } as never);
    const file = checkBackupText(JSON.stringify(await exportAll(d))).file;
    const target = fresh();
    await target.open();
    await importAll(target, file);
    expect((await raw(target, t)).data).toMatchObject({ projectId: p, isMilestone: true, futureThing: 'x', dueDate: '2026-11-12' });
    expect((await raw(target, e)).data.projectId).toBe(p);
    expect((await loadProjects(target)).map((x) => x.id)).toEqual([p]);
  });

  it('are in the sync snapshot, so another device receives the association', async () => {
    const d = fresh();
    const p = await mkProject(d);
    const t = await createProjectTask(p, { title: 'Cabinets delivered', milestone: true }, d);
    const e = await createEvent(newEventData({ ...blankFields('2026-11-10'), title: 'Delivery' }, ex({ projectId: p })), d);
    const snap = await snapshotOf(d);
    const rec = snap.tables.moduleRecords as Record<string, { data: Record<string, unknown> }>;
    expect(rec[String(t)].data).toMatchObject({ projectId: p, isMilestone: true });
    expect(rec[String(e)].data.projectId).toBe(p);
  });

  it('no database change: the schema is the same as before P3', () => {
    expect(new FinanceDB('test-p3-schema').verno).toBe(15);
  });
});
