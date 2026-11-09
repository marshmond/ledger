import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { createStore, repo } from '../../core/store';
import type { ModuleRecord } from '../../core/entities';
import { archiveProject, createProject, removeProjectRecord, setProjectStatus } from '../projects/data';
import { blankProject } from '../projects/model';
import { completeTask, createTask, reopenTask, saveTask } from '../tasks/data';
import { blankTask } from '../tasks/model';
import { createMember } from './data';
import { memberProjects, memberTasks, projectStatusText, readMemberProjects, readMemberTasks, taskWhen } from './memberWork';

/** F3 To do and Projects: read through Tasks' and Projects' own parsers and rules. Invented names and dates only. */
let n = 0;
const fresh = () => new FinanceDB(`test-family-f3-work-${n++}`);
const TODAY = '2026-11-09';
const kid = { role: 'child' as const, status: 'active' as const };
const weekly = { freq: 'weekly', interval: 1, end: { type: 'never' } } as const;
const addContact = (d: FinanceDB, name: string) => createStore(d).shared.contacts.put({ name } as never);
const snapshot = async (d: FinanceDB) => JSON.stringify(await Promise.all(d.tables.map(async (t) => [t.name, await t.toArray()])));
const task = (d: FinanceDB, title: string, contactIds: number[], over: Partial<ReturnType<typeof blankTask>> = {}) => createTask(blankTask({ title, contactIds, ...over }), [], d);
const titles = async (d: FinanceDB, cid: number) => (await readMemberTasks(cid, TODAY, d)).tasks.map((t) => t.data.title);

async function household() {
  const d = fresh();
  const sam = await addContact(d, 'Sam Example');
  const robin = await addContact(d, 'Robin Example');
  await createMember({ contact: { mode: 'existing', contactId: sam }, fields: kid }, d, 2026);
  await createMember({ contact: { mode: 'existing', contactId: robin }, fields: kid }, d, 2026);
  return { d, sam, robin };
}

describe('To do', () => {
  it('lists the open tasks that name the member, and no others (done, other people, nobody)', async () => {
    const { d, sam, robin } = await household();
    await task(d, 'Sign form', [sam]);
    await task(d, 'Robin form', [robin]);
    await task(d, 'Nobody form', []);
    const done = await task(d, 'Finished', [sam]);
    await completeTask(done, TODAY, d);
    expect(await titles(d, sam)).toEqual(['Sign form']);
    expect(await titles(d, robin)).toEqual(['Robin form']);
  });

  it('uses Tasks\' own order: overdue first, then soonest, undated last; ties by priority then title', async () => {
    const { d, sam } = await household();
    await task(d, 'Undated', [sam]);
    await task(d, 'Next week', [sam], { dueDate: '2026-11-16' });
    await task(d, 'B same day low', [sam], { dueDate: '2026-11-10', priority: 'low' });
    await task(d, 'A same day high', [sam], { dueDate: '2026-11-10', priority: 'high' });
    await task(d, 'Late', [sam], { dueDate: '2026-11-03' });
    await task(d, 'Planned only', [sam], { startDate: '2026-11-12' });
    const res = await readMemberTasks(sam, TODAY, d);
    expect(res.tasks.map((t) => t.data.title)).toEqual(['Late', 'A same day high', 'B same day low', 'Planned only', 'Next week', 'Undated']);
    expect(res.overdue).toBe(1);
  });

  it('a task with several members appears on each of their pages, as the same record (same id), not a copy', async () => {
    const { d, sam, robin } = await household();
    const id = await task(d, 'Pack bags', [sam, robin]);
    const a = (await readMemberTasks(sam, TODAY, d)).tasks;
    const b = (await readMemberTasks(robin, TODAY, d)).tasks;
    expect([a[0].id, b[0].id]).toEqual([id, id]);
    expect((await d.moduleRecords.where('[module+kind]').equals(['tasks', 'task']).toArray())).toHaveLength(1);
  });

  it('a repeating task is one record: completing it in Tasks moves the member to the next one; undoing brings the first back', async () => {
    const { d, sam } = await household();
    const id = await task(d, 'Pack soccer bag', [sam], { dueDate: '2026-11-10', repeat: { mode: 'fixed', rule: weekly } });
    expect((await readMemberTasks(sam, TODAY, d)).tasks.map((t) => [t.id, t.data.dueDate, !!t.data.repeat])).toEqual([[id, '2026-11-10', true]]);
    const { spawnedId } = await completeTask(id, TODAY, d);
    const after = (await readMemberTasks(sam, TODAY, d)).tasks;
    expect(after.map((t) => [t.id, t.data.dueDate])).toEqual([[spawnedId, '2026-11-17']]); // the finished one is gone; exactly one open
    await reopenTask(id, d);
    expect((await readMemberTasks(sam, TODAY, d)).tasks.map((t) => t.id)).toEqual([id]);
  });

  it('taking the member off a task in Tasks removes it from their list (and deleting the task does too); nothing is kept by Family', async () => {
    const { d, sam, robin } = await household();
    const id = await task(d, 'Form', [sam, robin]);
    const keep = await task(d, 'Other', [sam]);
    const cur = (await readMemberTasks(sam, TODAY, d)).tasks.find((t) => t.id === id)!;
    await saveTask(id, { ...cur.data, contactIds: [robin] }, d);
    expect(await titles(d, sam)).toEqual(['Other']);
    expect(await titles(d, robin)).toEqual(['Form']);
    await repo<ModuleRecord>(d.moduleRecords).remove(keep);
    expect(await titles(d, sam)).toEqual([]);
  });

  it('describes the date the way Tasks does: due (with time), else "do on", else none', async () => {
    const { d, sam } = await household();
    await task(d, 'A', [sam], { dueDate: '2026-11-12', dueTime: '16:30' });
    await task(d, 'B', [sam], { startDate: '2026-11-13' });
    await task(d, 'C', [sam]);
    const by = Object.fromEntries((await readMemberTasks(sam, TODAY, d)).tasks.map((t) => [t.data.title, taskWhen(t)]));
    expect(by.A).toEqual({ label: 'Due', date: '2026-11-12', time: '16:30' });
    expect(by.B).toEqual({ label: 'Do on', date: '2026-11-13', time: null });
    expect(by.C).toBeNull();
  });

  it('a damaged task row (null, wrong types, a contact list that is not a list) is skipped or ignored, never an error', async () => {
    const { d, sam } = await household();
    const row = (data: unknown) => d.moduleRecords.add({ module: 'tasks', kind: 'task', createdAt: 1, updatedAt: 1, deletedAt: null, data } as never);
    await row(null);
    await row({ title: 7, contactIds: 'sam', dueDate: 99 });
    await row({ title: 'Odd but fine', contactIds: [sam, 'x', null], status: 'someday', priority: 'urgent', repeat: { mode: 'fixed', rule: 'weekly' } });
    expect(await titles(d, sam)).toEqual(['Odd but fine']);
  });

  it('memberTasks is pure: the same input gives the same answer and the input list is not reordered', () => {
    const t = (id: number, over: object) => ({ id, createdAt: id, updatedAt: id, data: { ...blankTask({ contactIds: [1] }), title: `t${id}`, ...over } });
    const input = [t(3, { dueDate: '2026-11-20' }), t(1, { dueDate: '2026-11-01' }), t(2, { status: 'done' })];
    const copy = JSON.stringify(input);
    const out = memberTasks(input, 1, TODAY);
    expect(out.tasks.map((x) => x.id)).toEqual([1, 3]);
    expect(JSON.stringify(input)).toBe(copy);
  });
});

describe('Projects', () => {
  const project = (d: FinanceDB, name: string, vendorContactIds: number[], over: object = {}) => createProject(blankProject({ name, vendorContactIds, ...over }), d);

  it('lists a project only when its "Vendors and people" names the member; a name in the title, or a task\'s project, is never enough', async () => {
    const { d, sam, robin } = await household();
    const linked = await project(d, 'Backyard fort', [sam, 999]);
    await project(d, 'Sam Example\'s room', []); // the title names Sam, the link does not
    const viaTask = await project(d, 'Garage', [robin]);
    await task(d, 'Paint', [sam], { projectId: viaTask }); // a task for Sam on a project that does not list Sam
    const p = await readMemberProjects(sam, d);
    expect(p.open.map((x) => x.id)).toEqual([linked]);
    expect([p.finished, p.archived]).toEqual([[], []]);
    expect((await readMemberProjects(robin, d)).open.map((x) => x.id)).toEqual([viaTask]);
  });

  it('a project with two members is listed on both, as the same record', async () => {
    const { d, sam, robin } = await household();
    const id = await project(d, 'Camping trip', [sam, robin]);
    expect((await readMemberProjects(sam, d)).open[0].id).toBe(id);
    expect((await readMemberProjects(robin, d)).open[0].id).toBe(id);
    expect((await d.moduleRecords.where('[module+kind]').equals(['projects', 'project']).toArray())).toHaveLength(1);
  });

  it('groups by Projects\' own status and archive flag, in name order, with the status in words', async () => {
    const { d, sam } = await household();
    const a = await project(d, 'B active', [sam], { status: 'active' });
    const hold = await project(d, 'A on hold', [sam], { status: 'on_hold' });
    const done = await project(d, 'C done', [sam]);
    await setProjectStatus(done, 'completed', d);
    const old = await project(d, 'D old', [sam]);
    await archiveProject(old, d);
    const p = await readMemberProjects(sam, d);
    expect(p.open.map((x) => x.id)).toEqual([hold, a]);
    expect(p.finished.map((x) => x.id)).toEqual([done]);
    expect(p.archived.map((x) => x.id)).toEqual([old]);
    expect([projectStatusText(p.open[0]), projectStatusText(p.finished[0]), projectStatusText(p.archived[0])]).toEqual(['On hold', 'Completed', 'Planning · Archived']);
  });

  it('a deleted project simply leaves the list; a missing or damaged project row is not an error', async () => {
    const { d, sam } = await household();
    const gone = await project(d, 'Gone', [sam]);
    await project(d, 'Stays', [sam]);
    await removeProjectRecord(gone, d);
    await d.moduleRecords.add({ module: 'projects', kind: 'project', createdAt: 1, updatedAt: 1, deletedAt: null, data: null } as never);
    await d.moduleRecords.add({ module: 'projects', kind: 'project', createdAt: 1, updatedAt: 1, deletedAt: null, data: { name: 5, vendorContactIds: 'sam', status: 'weird' } } as never);
    expect((await readMemberProjects(sam, d)).open.map((x) => x.data.name)).toEqual(['Stays']);
  });

  it('memberProjects keeps fields it does not know and does not reorder its input', () => {
    const rec = (id: number, name: string) => ({ id, createdAt: 0, updatedAt: 0, data: { ...blankProject({ name, vendorContactIds: [5] }), futureField: { a: 1 } } });
    const input = [rec(2, 'Zed'), rec(1, 'Abe')];
    const out = memberProjects(input, 5);
    expect(out.open.map((p) => p.data.name)).toEqual(['Abe', 'Zed']);
    expect(input.map((p) => p.id)).toEqual([2, 1]);
    expect((out.open[0].data as unknown as Record<string, unknown>).futureField).toEqual({ a: 1 });
  });
});

describe('no writes, no Finance', () => {
  it('reading tasks and projects changes no row in any table, and Family adds nothing to Finance tables', async () => {
    const { d, sam } = await household();
    const proj = await createProject(blankProject({ name: 'Fort', vendorContactIds: [sam] }), d);
    await task(d, 'Paint', [sam], { projectId: proj, dueDate: '2026-11-10' });
    const acct = (await d.accounts.add({ name: 'Test checking', kind: 'checking', openingBalanceCents: 100000, openingDate: '2026-01-01' } as never)) as number;
    await d.txns.add({ accountId: acct, date: '2026-11-02', amountCents: -1800, payee: 'Paint store', memo: '', status: 'cleared', categoryId: null } as never);
    const before = await snapshot(d);
    await readMemberTasks(sam, TODAY, d);
    await readMemberProjects(sam, d);
    expect(await snapshot(d)).toBe(before); // every table, Finance included
    expect([await d.accounts.count(), await d.txns.count()]).toEqual([1, 1]);
  });
});
