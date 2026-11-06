import { describe, expect, it } from 'vitest';
import { db as appDb, FinanceDB } from '../../db';
import { loadProjectChoices, projectLabel, type ProjectChoice } from '../../core/projectLink';
import { spendingMatrix, topPayees } from '../../lib/reports';
import { installTracking } from '../../lib/sync/track';
import { loadProjectSummary, projectOnlyTxns } from '../../lib/txnProject';
import type { Txn } from '../../types';
import { createEvent, loadEvents, newEventData } from '../calendar/data';
import { blankFields, PERSONAL_ID } from '../calendar/model';
import { searchEventsData } from '../calendar/searchSource';
import type { SeriesExtras } from '../calendar/series';
import { assignTasksToProject, completeTask, createTask, getTask, loadTasks, planTaskProject, removeTasks, restoreTaskData, saveTask } from '../tasks/data';
import { blankTask } from '../tasks/model';
import { parseQuickAdd } from '../tasks/quickAdd';
import { taskQuickAdd } from '../tasks/quickAddDef';
import { searchTasksData } from '../tasks/searchSource';
import { archiveProject, createProject, setProjectStatus } from './data';
import { deleteProjectPermanently } from './deletion';
import { blankProject } from './model';
import { createProjectTask, progressChips, summarizeWork, workOf } from './work';

/** Invented data only. Each test gets its own database (except the Add-box test, which uses the app database like the Add box does). */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-p4b-int-${n++}`); installTracking(d); return d; };
const $ = (x: number) => Math.round(x * 100);
const raw = (d: FinanceDB, id: number) => d.moduleRecords.get(id) as Promise<{ data: Record<string, unknown>; deletedAt?: number | null }>;
const mk = (d: FinanceDB, name = 'Test Kitchen', over = {}) => createProject(blankProject({ name, status: 'active', ...over }), d);
const ex = (over: Partial<SeriesExtras> = {}): SeriesExtras => ({ calendarId: PERSONAL_ID, tagIds: [], contactIds: [], recurrence: null, trackDone: false, ...over });
const weekly = { freq: 'weekly', interval: 1, end: { type: 'never' } } as const;
const TODAY = '2026-11-05';
const choice = (id: number, name: string, over: Partial<ProjectChoice> = {}): ProjectChoice => ({ id, name, status: 'active', archived: false, ...over });

// ---------- WS2: project-aware Quick Add ----------

describe('P4B: Quick Add can name a project', () => {
  it('+word picks an open project by its whole name and leaves the rest of the shorthand alone', () => {
    const p = parseQuickAdd('pick paint fri !high +kitchen', TODAY, [choice(1, 'Kitchen'), choice(2, 'Deck')]);
    expect(p.project).toEqual({ id: 1, name: 'Kitchen' });
    expect([p.title, p.priority, p.dueDate]).toEqual(['pick paint', 'high', '2026-11-06']);
    expect(parseQuickAdd('order tile +test-kitchen', TODAY, [choice(9, 'Test Kitchen')]).project?.id).toBe(9);
  });

  it('never matches a similarly named project: no prefixes, no guessing', () => {
    const list = [choice(1, 'Kitchen Remodel'), choice(2, 'Kitchen Deck')];
    const p = parseQuickAdd('buy screws +kitchen', TODAY, list);
    expect(p.project).toBeUndefined();
    expect(p.title).toBe('buy screws +kitchen'); // the word stays, nothing is lost
    expect(p.projectNote).toMatch(/No project is named \+kitchen/);
    expect(parseQuickAdd('x +kitchen-remodel', TODAY, list).project?.id).toBe(1);
  });

  it('two projects with the same name are refused as ambiguous', () => {
    const p = parseQuickAdd('call +kitchen', TODAY, [choice(1, 'Kitchen'), choice(2, 'kitchen')]);
    expect(p.project).toBeUndefined();
    expect(p.projectNote).toMatch(/More than one project/);
  });

  it('archived, completed and cancelled projects are not offered new tasks, and the task is not silently put there', () => {
    for (const [over, word] of [[{ archived: true }, 'archived'], [{ status: 'completed' }, 'completed'], [{ status: 'cancelled' }, 'cancelled']] as const) {
      const p = parseQuickAdd('tidy up +kitchen', TODAY, [choice(1, 'Kitchen', over)]);
      expect(p.project).toBeUndefined();
      expect(p.projectNote).toContain(word);
    }
  });

  it('without a project list, or without a +word, nothing changes from before', () => {
    const text = 'pay contractor fri !high #renovation @home +kitchen every week';
    const old = parseQuickAdd(text, TODAY);
    expect(old.project).toBeUndefined();
    expect(old.projectNote).toBeUndefined();
    expect(old.title).toContain('+kitchen'); // still plain text, as before
    expect(parseQuickAdd('plain title', TODAY, [choice(1, 'Kitchen')])).toEqual({ title: 'plain title', tags: [] });
    expect(parseQuickAdd('pay fri !high', TODAY, [choice(1, 'Kitchen')])).toEqual(parseQuickAdd('pay fri !high', TODAY));
  });

  it('commit makes the task through the normal task command with the project; Undo removes it; a project closed meanwhile adds nothing', async () => {
    const p = await createProject(blankProject({ name: 'Quick Deck', status: 'active' }), appDb);
    const preview = { summary: 'x', fields: [], payload: parseQuickAdd('stain boards +quick-deck', TODAY, [choice(p, 'Quick Deck')]) };
    const undo = await taskQuickAdd.commit!(preview);
    const t = (await loadTasks(appDb)).find((x) => x.data.title === 'stain boards')!;
    expect(t.data.projectId).toBe(p);
    expect(typeof undo).toBe('function');
    await (undo as () => Promise<void>)();
    expect((await loadTasks(appDb)).some((x) => x.data.title === 'stain boards')).toBe(false);
    await archiveProject(p, appDb);
    await expect(taskQuickAdd.commit!(preview)).rejects.toThrow(/no longer open/);
    expect((await loadTasks(appDb)).some((x) => x.data.title === 'stain boards')).toBe(false);
  });
});

// ---------- WS3: bulk project assignment ----------

describe('P4B: bulk project assignment in Tasks', () => {
  async function setup() {
    const d = fresh();
    const a = await mk(d, 'Kitchen'), b = await mk(d, 'Deck');
    const t1 = await createProjectTask(a, { title: 'Pick paint', dueDate: '2026-11-10' }, d);
    const t2 = await createProjectTask(a, { title: 'Delivered', dueDate: '2026-11-20', milestone: true }, d);
    const t3 = await createTask(blankTask({ title: 'Loose task', priority: 'high' }), [], d);
    const t4 = await createProjectTask(b, { title: 'Order boards' }, d);
    return { d, a, b, t1, t2, t3, t4 };
  }

  it('assigns and moves with a plan that says what is replaced; other fields, dates, status and unknown fields are untouched', async () => {
    const { d, a, b, t1, t2, t3, t4 } = await setup();
    await d.moduleRecords.update(t3, { data: { ...(await raw(d, t3)).data, futureField: 7 } } as never);
    await completeTask(t3, TODAY, d);
    const before = JSON.stringify((await loadTasks(d)).map((t) => t.data));
    const plan = await planTaskProject([t1, t2, t3, t4], b, d);
    expect(plan).toMatchObject({ total: 4, adding: 1, replacing: 2, unchanged: 1, missing: 0 });
    expect(plan.replacedFrom).toEqual([a]);
    expect(JSON.stringify((await loadTasks(d)).map((t) => t.data))).toBe(before); // planning changes nothing
    const res = await assignTasksToProject([t1, t2, t3, t4], b, d);
    expect(res.changed).toBe(3);
    for (const id of [t1, t2, t3, t4]) expect((await raw(d, id)).data.projectId).toBe(b);
    expect((await raw(d, t2)).data.isMilestone).toBe(true); // a milestone moved to another project stays a milestone
    expect((await raw(d, t1)).data.dueDate).toBe('2026-11-10');
    expect((await raw(d, t3)).data).toMatchObject({ status: 'done', priority: 'high', futureField: 7 });
    expect(workOf(await loadTasks(d), b).milestones.map((t) => t.id)).toEqual([t2]);
  });

  it('taking tasks off makes milestones ordinary tasks, keeps repeats, and skips those already on none', async () => {
    const { d, t1, t2, t3 } = await setup();
    await saveTask(t1, { ...(await getTask(t1, d))!.data, repeat: { mode: 'fixed', rule: { ...weekly } } } as never, d);
    const plan = await planTaskProject([t1, t2, t3], null, d);
    expect(plan).toMatchObject({ replacing: 2, unchanged: 1, milestonesLeaving: 1 });
    const res = await assignTasksToProject([t1, t2, t3], null, d);
    expect(res.changed).toBe(2);
    for (const id of [t1, t2, t3]) expect((await raw(d, id)).data.projectId).toBeUndefined();
    expect((await raw(d, t2)).data.isMilestone).toBeUndefined();
    expect((await raw(d, t1)).data.repeat).toBeDefined();
    expect((await raw(d, t2)).data.dueDate).toBe('2026-11-20');
  });

  it('is all or nothing: a task that no longer exists, or a closed or missing project, changes nothing', async () => {
    const { d, a, b, t1, t3 } = await setup();
    await removeTasks([t3], d);
    expect((await planTaskProject([t1, t3], b, d)).missing).toBe(1);
    const snap = async () => JSON.stringify((await loadTasks(d)).map((t) => [t.id, t.data]).sort());
    const before = await snap();
    await expect(assignTasksToProject([t1, t3], b, d)).rejects.toThrow(/no longer exist.*nothing was changed/i);
    await archiveProject(b, d);
    await expect(assignTasksToProject([t1], b, d)).rejects.toThrow(/not open for new tasks/);
    await setProjectStatus(a, 'cancelled', d);
    await expect(assignTasksToProject([t1], a, d)).rejects.toThrow(/not open for new tasks/);
    await expect(assignTasksToProject([t1], 424242, d)).rejects.toThrow(/not open for new tasks/);
    expect(await snap()).toBe(before);
  });

  it('Undo puts every changed task back exactly, including the milestone flag', async () => {
    const { d, t1, t2, t3 } = await setup();
    const snap = async () => JSON.stringify((await loadTasks(d)).map((t) => [t.id, t.data]).sort());
    const before = await snap();
    const { before: undo } = await assignTasksToProject([t1, t2, t3], null, d);
    expect(await snap()).not.toBe(before);
    await restoreTaskData(undo, d);
    expect(await snap()).toBe(before);
  });
});

// ---------- WS4: progress on the Projects list ----------

describe('P4B: Projects list progress', () => {
  it('counts tasks and milestones apart, from the same summary the project page uses, and ignores other projects', async () => {
    const d = fresh();
    const a = await mk(d, 'Kitchen'), b = await mk(d, 'Deck');
    const t1 = await createProjectTask(a, { title: 'One', dueDate: '2026-11-01' }, d);
    await createProjectTask(a, { title: 'Two' }, d);
    const m1 = await createProjectTask(a, { title: 'Ms', dueDate: '2026-11-02', milestone: true }, d);
    await createProjectTask(b, { title: 'Other project' }, d);
    await createTask(blankTask({ title: 'No project' }), [], d);
    await completeTask(t1, TODAY, d);
    const w = summarizeWork(await loadTasks(d), a, TODAY);
    expect([w.tasks.done, w.tasks.total, w.milestones.done, w.milestones.total]).toEqual([1, 2, 0, 1]);
    expect(progressChips(w, true).map((c) => c.text)).toEqual(['Tasks 1/2', 'Milestones 0/1', '1 overdue']);
    await completeTask(m1, TODAY, d);
    expect(progressChips(summarizeWork(await loadTasks(d), a, TODAY), true).map((c) => c.text)).toEqual(['Tasks 1/2', 'Milestones 1/1']);
  });

  it('a project with nothing yet says so (no 0%), and a finished or archived one does not shout "overdue"', async () => {
    const d = fresh();
    const a = await mk(d, 'Empty'), b = await mk(d, 'Old');
    await createProjectTask(b, { title: 'Late', dueDate: '2026-10-01' }, d);
    const all = await loadTasks(d);
    expect(progressChips(summarizeWork(all, a, TODAY), true)).toEqual([{ text: 'No tasks yet', tone: 'muted' }]);
    expect(progressChips(summarizeWork(all, b, TODAY), true).map((c) => c.text)).toContain('1 overdue');
    expect(progressChips(summarizeWork(all, b, TODAY), false).map((c) => c.text)).toEqual(['Tasks 0/1']);
  });
});

// ---------- WS5: project context in global search ----------

describe('P4B: global search shows the project', () => {
  it('tasks, milestones and events carry the project name; archived and removed projects say so; ids stay unique', async () => {
    const d = fresh();
    const live = await mk(d, 'Kitchen'), old = await mk(d, 'Old Deck'), gone = await mk(d, 'Gone');
    await archiveProject(old, d);
    const t = await createProjectTask(live, { title: 'Paint walls' }, d);
    const m = await createProjectTask(live, { title: 'Paint milestone', milestone: true }, d);
    const o = await createProjectTask(old, { title: 'Paint boards' }, d);
    const g = await createProjectTask(gone, { title: 'Paint ghost' }, d);
    const plain = await createTask(blankTask({ title: 'Paint nothing' }), [], d);
    await createEvent(newEventData({ ...blankFields('2026-11-09'), title: 'Paint meeting' }, ex({ projectId: live })), d);
    await deleteProjectPermanently(gone, d);
    await d.moduleRecords.update(g, { data: { ...(await raw(d, g)).data, projectId: gone } } as never); // a stale pointer written elsewhere
    const projects = await loadProjectChoices(d);
    const tasks = searchTasksData('paint', await loadTasks(d), [], [], undefined, projects);
    const by = (id: number) => tasks.find((r) => r.id === `task:${id}`)!;
    expect(by(t).subtitle).toContain('Project: Kitchen');
    expect(by(m).kind).toBe('Milestone');
    expect(by(m).subtitle).toContain('Project: Kitchen');
    expect(by(o).subtitle).toContain('Project: Old Deck (archived)');
    expect(by(g).subtitle).toContain('(project removed)');
    expect(by(plain).subtitle).not.toContain('Project');
    const ids = tasks.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const evs = searchEventsData('paint', await loadEvents(d), TODAY, undefined, projects);
    expect(evs.find((r) => r.kind === 'Event')!.subtitle).toContain('Project: Kitchen');
    expect(by(t).path).toBe(`/tasks?task=${t}`); // navigation unchanged
    expect(projectLabel(projects, live)).toBe('Kitchen');
  });

  it('a stale project pointer is never silent, and a task with no project has the same line as before', () => {
    const rec = (id: number, extra: object) => ({ id, createdAt: 0, updatedAt: 0, data: { ...blankTask({ title: 'Paint walls' }), ...extra } }) as never;
    expect(searchTasksData('paint', [rec(1, { projectId: 5 })], [], []).find((r) => r.kind === 'Task')!.subtitle).toContain('(project removed)');
    expect(searchTasksData('paint', [rec(2, {})], [], []).find((r) => r.kind === 'Task')!.subtitle).toBe('No due date');
  });
});

// ---------- WS6: project filter in Reports ----------

describe('P4B: project filter in Reports', () => {
  const cats = [
    { id: 1, groupId: 1, name: 'Materials', kind: 'expense' as const },
    { id: 2, groupId: 1, name: 'Labor', kind: 'expense' as const },
    { id: 3, groupId: 1, name: 'Paycheck', kind: 'income' as const },
  ];
  const months = ['2026-09', '2026-10', '2026-11'];
  const txn = (id: number, date: string, amount: number, over: Partial<Txn> = {}): Txn => ({ id, accountId: 1, date, amountCents: $(amount), payee: 'Shop', memo: '', status: 'cleared', categoryId: 1, ...over });

  it('counts each project piece once and the months add up to the project\'s paid figure', async () => {
    const d = fresh();
    const p = await mk(d), other = await mk(d, 'Deck');
    const a = (await d.accounts.add({ name: 'Checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' })) as number;
    const txns: Txn[] = [
      txn(1, '2026-10-02', -100, { accountId: a, project: { projectId: p } }),
      txn(2, '2026-10-05', -300, { accountId: a, categoryId: null, splits: [
        { categoryId: 1, amountCents: -$(200), project: { projectId: p } },
        { categoryId: 2, amountCents: -$(100), project: { projectId: other } },
      ] }),
      txn(3, '2026-11-01', -50, { accountId: a, categoryId: null, project: { projectId: p } }),
      txn(4, '2026-11-03', 30, { accountId: a, categoryId: null, project: { projectId: p, effect: 'reversal' } }), // uncategorised money back
      txn(5, '2026-11-04', -999, { accountId: a }), // no project
      txn(7, '2026-11-04', -10, { accountId: a, project: { projectId: other } }),
    ];
    const mine = projectOnlyTxns(txns, p);
    expect(mine.map((t) => t.id)).toEqual([1, 2, 3, 4]);
    expect(mine.find((t) => t.id === 2)!.splits).toHaveLength(1);
    expect(mine.find((t) => t.id === 2)!.amountCents).toBe(-$(200));
    const m = spendingMatrix(mine, cats, months, { net: true });
    expect(m.spent).toEqual([0, $(300), $(20)]); // 100 + 200, then 50 - 30
    expect(m.income).toEqual([0, 0, 0]);
    expect(m.cats.map((c) => [c.name, c.total])).toEqual([['Materials', $(300)], ['Uncategorized', $(20)]]);
    for (const t of txns) await d.txns.add({ ...t, id: undefined } as never);
    const paid = (await loadProjectSummary(d, p))!.paidCents;
    expect(m.spent.reduce((x, y) => x + y, 0)).toBe(paid);
  });

  it('transfers and setup entries never belong to a project view', () => {
    const t = [txn(1, '2026-11-01', -500, { transferTxnId: 77, project: { projectId: 1 } }), txn(2, '2026-11-02', -5, { project: { projectId: 1 } })];
    expect(projectOnlyTxns(t, 1).map((x) => x.id)).toEqual([2]);
  });

  it('a refund with no category lowers a project month; the unfiltered report is unchanged (there the same refund is income)', () => {
    const t = [txn(1, '2026-11-01', -100, { project: { projectId: 1 } }), txn(2, '2026-11-02', 40, { categoryId: null, project: { projectId: 1 } })];
    const unfiltered = spendingMatrix(t, cats, months);
    expect(unfiltered.spent[2]).toBe($(100));
    expect(unfiltered.income[2]).toBe($(40));
    expect(spendingMatrix(t, cats, months, {})).toEqual(unfiltered);
    expect(spendingMatrix(projectOnlyTxns(t, 1), cats, months, { net: true }).spent[2]).toBe($(60));
  });

  it('existing unfiltered reports are exactly what they were, whatever the project tags say', () => {
    const base = [txn(1, '2026-10-02', -100), txn(2, '2026-10-03', 2000, { categoryId: 3 }), txn(3, '2026-11-01', -40, { categoryId: 2 })];
    const tagged = base.map((t, i) => (i === 0 ? { ...t, project: { projectId: 9 } } : t));
    expect(spendingMatrix(tagged, cats, months)).toEqual(spendingMatrix(base, cats, months));
    expect(topPayees(tagged, cats, '2026-10-01', '2026-11-30')).toEqual(topPayees(base, cats, '2026-10-01', '2026-11-30'));
  });

  it('top payees in a project view net out money back; a stale or removed project gives an empty view, not an error', () => {
    const t = [
      txn(1, '2026-11-01', -100, { payee: 'Acme', project: { projectId: 1 } }),
      txn(2, '2026-11-02', 30, { payee: 'Acme', categoryId: null, project: { projectId: 1 } }),
      txn(3, '2026-11-02', -20, { payee: 'Zed', project: { projectId: 1 } }),
    ];
    expect(topPayees(projectOnlyTxns(t, 1), cats, '2026-11-01', '2026-11-30', 10, { net: true }).map((x) => [x.payee, x.cents])).toEqual([['Acme', $(70)], ['Zed', $(20)]]);
    expect(projectOnlyTxns(t, 999)).toEqual([]);
    expect(spendingMatrix(projectOnlyTxns(t, 999), cats, months, { net: true }).spent).toEqual([0, 0, 0]);
  });
});
