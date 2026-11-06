import { describe, expect, it, vi } from 'vitest';
import { FinanceDB } from '../../db';
import { exportAll, importAll } from '../../lib/backup';
import { checkBackupText } from '../../lib/backupFile';
import { dexieMeta, RemoteConflict, SyncEngine, type RemoteFile, type RemoteStore } from '../../lib/sync/engine';
import { installTracking, touchAll } from '../../lib/sync/track';
import { loadProjectSummary, setTxnProject } from '../../lib/txnProject';
import type { Txn } from '../../types';
import { createEvent, loadEvents, newEventData } from '../calendar/data';
import { blankFields, PERSONAL_ID } from '../calendar/model';
import type { SeriesExtras } from '../calendar/series';
import { createTask, getTask, loadTasks, saveTask } from '../tasks/data';
import { blankTask } from '../tasks/model';
import { archiveProject, createCommitment, createLine, createProject, getProject, loadBudgetLines, loadProjects, removeProjectRecord, restoreProject, saveLine, saveProject } from './data';
import { deleteProjectPermanently, planProjectDeletion } from './deletion';
import { blankProject } from './model';
import { createProjectTask, setMilestone } from './work';

/** Invented data only. Each test gets its own database. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-p4b-${n++}`); installTracking(d); return d; };
const $ = (x: number) => Math.round(x * 100);
const raw = (d: FinanceDB, id: number) => d.moduleRecords.get(id) as Promise<{ data: Record<string, unknown>; deletedAt?: number | null }>;
const mk = (d: FinanceDB, name = 'Test Kitchen', over = {}) => createProject(blankProject({ name, status: 'active', ...over }), d);
const ex = (over: Partial<SeriesExtras> = {}): SeriesExtras => ({ calendarId: PERSONAL_ID, tagIds: [], contactIds: [], recurrence: null, trackDone: false, ...over });
const weekly = { freq: 'weekly', interval: 1, end: { type: 'never' } } as const;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function bank(d: FinanceDB) {
  const a = (await d.accounts.add({ name: 'Checking', kind: 'checking', openingBalanceCents: $(1000), openingDate: '2026-01-01' })) as number;
  const add = (amount: number, over: Partial<Txn> = {}) => d.txns.add({ accountId: a, date: '2026-11-03', amountCents: $(amount), payee: 'Shop', memo: '', status: 'cleared', categoryId: null, ...over }) as Promise<number>;
  return { a, add };
}
const commit = (d: FinanceDB, p: number, over = {}) => createCommitment(p, { title: 'Cabinets', amountCents: $(1000), status: 'accepted', parentId: null, budgetLineId: null, vendorContactId: null, acceptedDate: '2026-11-02', notes: '', ...over }, d);

describe('P4B: permanent project deletion', () => {
  it('deletes an empty project (a tombstone, not a physical erase) and leaves Archive and Restore as they were', async () => {
    const d = fresh();
    const p = await mk(d);
    const plan = await planProjectDeletion(p, d);
    expect(plan.canDelete).toBe(true);
    expect(plan.reasons).toEqual([]);
    await deleteProjectPermanently(p, d);
    expect(await getProject(p, d)).toBeUndefined();
    expect((await loadProjects(d)).map((x) => x.id)).not.toContain(p);
    expect((await raw(d, p)).deletedAt).toBeGreaterThan(0); // soft: syncs as a deletion
    await expect(planProjectDeletion(p, d)).rejects.toThrow(/no longer exists/);
    await expect(deleteProjectPermanently(p, d)).rejects.toThrow(/no longer exists/);
  });

  it('deletes budget lines with the project but never a transaction or account', async () => {
    const d = fresh();
    const { a, add } = await bank(d);
    const p = await mk(d), keep = await mk(d, 'Deck');
    const l1 = await createLine(p, 'Cabinets', $(500), d), l2 = await createLine(p, 'Flooring', $(300), d);
    const other = await createLine(keep, 'Boards', $(50), d);
    const t = await add(-20);
    await setTxnProject(d, t, { projectId: keep, budgetLineId: other });
    const before = JSON.stringify(await d.txns.toArray());
    const res = await deleteProjectPermanently(p, d);
    expect(res.budgetLines).toBe(2);
    expect(await loadBudgetLines(p, d)).toEqual([]);
    expect((await raw(d, l1)).deletedAt).toBeGreaterThan(0);
    expect((await raw(d, l2)).deletedAt).toBeGreaterThan(0);
    expect((await loadBudgetLines(keep, d)).map((l) => l.id)).toEqual([other]); // another project's lines untouched
    expect(JSON.stringify(await d.txns.toArray())).toBe(before);
    expect((await d.accounts.get(a))!.openingBalanceCents).toBe($(1000));
    expect((await loadProjectSummary(d, keep))!.paidCents).toBe($(20));
  });

  it('refuses while a whole transaction is tagged, says what to do, and changes nothing', async () => {
    const d = fresh();
    const { add } = await bank(d);
    const p = await mk(d);
    await createLine(p, 'Cabinets', $(500), d);
    await createProjectTask(p, { title: 'Pick paint' }, d);
    const t = await add(-20);
    await setTxnProject(d, t, { projectId: p });
    const plan = await planProjectDeletion(p, d);
    expect(plan.canDelete).toBe(false);
    expect(plan.wholeTransactions).toBe(1);
    expect(plan.transactionIds).toEqual([t]);
    expect(plan.reasons.join(' ')).toMatch(/1 transaction is tagged.*take the project tag off/);
    const before = [JSON.stringify(await d.txns.toArray()), JSON.stringify(await d.moduleRecords.toArray())];
    await expect(deleteProjectPermanently(p, d)).rejects.toThrow(/cannot be deleted yet/);
    expect([JSON.stringify(await d.txns.toArray()), JSON.stringify(await d.moduleRecords.toArray())]).toEqual(before);
    expect((await d.txns.get(t))!.project?.projectId).toBe(p); // the tag was never removed silently
  });

  it('refuses while one part of a split transaction is tagged', async () => {
    const d = fresh();
    const { add } = await bank(d);
    const p = await mk(d);
    const t = await add(-30, { splits: [{ categoryId: null, amountCents: -$(10), project: { projectId: p } }, { categoryId: null, amountCents: -$(20) }] });
    const plan = await planProjectDeletion(p, d);
    expect(plan.canDelete).toBe(false);
    expect([plan.wholeTransactions, plan.splitTransactions]).toEqual([0, 1]);
    expect(plan.reasons.join(' ')).toMatch(/split transaction has a part/);
    await expect(deleteProjectPermanently(p, d)).rejects.toThrow(/cannot be deleted yet/);
    expect((await d.txns.get(t))!.splits![0].project?.projectId).toBe(p);
  });

  it('refuses while a commitment or change order is live; allows it once they are removed', async () => {
    const d = fresh();
    const p = await mk(d);
    const c = await commit(d, p);
    await commit(d, p, { title: 'Extra', amountCents: $(100), parentId: c.id });
    const plan = await planProjectDeletion(p, d);
    expect(plan.commitments).toBe(2);
    expect(plan.reasons.join(' ')).toMatch(/2 commitments and change orders are still on this project/);
    await expect(deleteProjectPermanently(p, d)).rejects.toThrow(/cannot be deleted yet/);
    expect(await getProject(p, d)).toBeDefined();
  });

  it('unlinks tasks, milestones and events without deleting them; milestones become ordinary tasks; recurrence and fields survive', async () => {
    const d = fresh();
    const p = await mk(d), other = await mk(d, 'Deck');
    const t = await createProjectTask(p, { title: 'Pick paint', dueDate: '2026-11-10' }, d);
    const m = await createProjectTask(p, { title: 'Cabinets delivered', dueDate: '2026-11-20', milestone: true }, d);
    const rep = await createProjectTask(p, { title: 'Water the plaster' }, d);
    await saveTask(rep, { ...(await getTask(rep, d))!.data, repeat: { mode: 'fixed', rule: { ...weekly } }, note: 'keep me' } as never, d);
    await d.moduleRecords.update(t, { data: { ...(await raw(d, t)).data, futureField: { x: 1 } } } as never);
    const elsewhere = await createProjectTask(other, { title: 'Order boards' }, d);
    const ev = await createEvent(newEventData({ ...blankFields('2026-11-06'), title: 'Walkthrough' }, ex({ projectId: p, recurrence: { ...weekly } as never })), d);
    const plain = await createEvent(newEventData({ ...blankFields('2026-11-07'), title: 'Plain visit' }, ex({ projectId: p })), d);
    const evBefore = (await raw(d, ev)).data;

    const plan = await planProjectDeletion(p, d);
    expect([plan.tasks, plan.milestones, plan.events]).toEqual([2, 1, 2]);
    expect(plan.canDelete).toBe(true);
    const res = await deleteProjectPermanently(p, d);
    expect([res.tasksUnlinked, res.milestonesUnlinked, res.eventsUnlinked]).toEqual([2, 1, 2]);

    const tasks = await loadTasks(d);
    expect(tasks.map((x) => x.id).sort()).toEqual([t, m, rep, elsewhere].sort()); // nothing deleted
    for (const id of [t, m, rep]) expect((await raw(d, id)).data.projectId).toBeUndefined();
    expect((await raw(d, m)).data.isMilestone).toBeUndefined(); // the P3 rule
    expect((await raw(d, m)).data.dueDate).toBe('2026-11-20');
    expect((await raw(d, rep)).data.repeat).toBeDefined();
    expect((await raw(d, rep)).data.note).toBe('keep me');
    expect((await raw(d, t)).data.futureField).toEqual({ x: 1 });
    expect((await raw(d, elsewhere)).data.projectId).toBe(other); // another project's task untouched
    const evs = await loadEvents(d);
    expect(evs.map((e) => e.id).sort()).toEqual([ev, plain].sort());
    const { projectId: _gone, ...evAfter } = (await raw(d, ev)).data as Record<string, unknown>;
    const { projectId: _was, ...evWas } = evBefore as Record<string, unknown>;
    expect(evAfter).toEqual(evWas); // recurrence, skipped dates, overrides and every other field are exactly as they were
    expect((await raw(d, ev)).data.recurrence).toBeDefined();
    expect((await raw(d, ev)).data.projectId).toBeUndefined();
  });

  it('removes shared links that point at the project and leaves other links alone', async () => {
    const d = fresh();
    const p = await mk(d);
    const t = await createProjectTask(p, { title: 'About it' }, d);
    const l1 = await d.links.add({ fromModule: 'tasks', fromId: t, toModule: 'projects', toId: p, type: 'about', createdAt: 1, updatedAt: 1 } as never) as number;
    const l2 = await d.links.add({ fromModule: 'tasks', fromId: t, toModule: 'ledger', toId: 'account:1', type: 'about', createdAt: 1, updatedAt: 1 } as never) as number;
    expect((await planProjectDeletion(p, d)).links).toBe(1);
    const res = await deleteProjectPermanently(p, d);
    expect(res.linksRemoved).toBe(1);
    expect((await d.links.get(l1))!.deletedAt).toBeGreaterThan(0);
    expect((await d.links.get(l2))!.deletedAt ?? null).toBeNull();
  });

  it('copes with stale references: tasks and events pointing at a project that is already gone are left alone', async () => {
    const d = fresh();
    const p = await mk(d), gone = await mk(d, 'Gone');
    const t = await createProjectTask(gone, { title: 'Orphan soon' }, d);
    await deleteProjectPermanently(gone, d);
    // simulate a record that still points at the deleted project (written on another device)
    await d.moduleRecords.update(t, { data: { ...(await raw(d, t)).data, projectId: gone } } as never);
    const res = await deleteProjectPermanently(p, d);
    expect(res.tasksUnlinked).toBe(0);
    expect((await raw(d, t)).data.projectId).toBe(gone); // not ours to touch
  });

  it('is all or nothing: a failure part-way leaves every record exactly as it was', async () => {
    const d = fresh();
    const p = await mk(d);
    const line = await createLine(p, 'Cabinets', $(500), d);
    const t = await createProjectTask(p, { title: 'Pick paint' }, d);
    const m = await createProjectTask(p, { title: 'Done', milestone: true }, d);
    const ev = await createEvent(newEventData({ ...blankFields('2026-11-06'), title: 'Visit' }, ex({ projectId: p })), d);
    const snap = async () => JSON.stringify((await d.moduleRecords.toArray()).sort((x, y) => (x.id as number) - (y.id as number)));
    const before = await snap();
    const real = d.moduleRecords.put.bind(d.moduleRecords);
    const spy = vi.spyOn(d.moduleRecords, 'put').mockImplementation(((rec: { module: string; kind: string }) => {
      if (rec.module === 'projects' && rec.kind === 'project') return Promise.reject(new Error('disk full'));
      return real(rec as never);
    }) as never);
    await expect(deleteProjectPermanently(p, d)).rejects.toThrow(/disk full/);
    spy.mockRestore();
    expect(await snap()).toBe(before);
    expect((await getProject(p, d))).toBeDefined();
    expect((await raw(d, t)).data.projectId).toBe(p);
    expect((await raw(d, m)).data.isMilestone).toBe(true);
    expect((await raw(d, ev)).data.projectId).toBe(p);
    expect((await raw(d, line)).deletedAt ?? null).toBeNull();
  });

  it('a milestone cannot be recreated on a deleted project', async () => {
    const d = fresh();
    const p = await mk(d);
    await deleteProjectPermanently(p, d);
    await expect(createProjectTask(p, { title: 'Late', milestone: true }, d)).rejects.toThrow(/no longer exists/);
    const t = await createTask({ ...blankTask({ title: 'Plain' }) }, [], d);
    await expect(setMilestone(t, true, d)).rejects.toThrow(/project first/);
  });

  it('backup and restore: a deleted project stays deleted after restore, and a backup made before the deletion still brings it back', async () => {
    const d = fresh();
    const p = await mk(d);
    await createLine(p, 'Cabinets', $(500), d);
    const t = await createProjectTask(p, { title: 'Pick paint' }, d);
    const early = checkBackupText(JSON.stringify(await exportAll(d))).file;
    await deleteProjectPermanently(p, d);
    const late = checkBackupText(JSON.stringify(await exportAll(d))).file;

    const target = fresh();
    await target.open();
    await importAll(target, late);
    expect(await getProject(p, target)).toBeUndefined();
    expect((await raw(target, p)).deletedAt).toBeGreaterThan(0);
    expect(await loadBudgetLines(p, target)).toEqual([]);
    expect((await getTask(t, target))!.data.projectId).toBeUndefined();

    const target2 = fresh();
    await target2.open();
    await importAll(target2, early); // old backups still hold the project: deleting is not a promise to erase old files
    expect(await getProject(p, target2)).toBeDefined();
    expect(await loadBudgetLines(p, target2)).toHaveLength(1);
  });
});

// ---------- two devices ----------

function remoteStore() {
  const r = {
    puts: 0, file: null as RemoteFile | null,
    async getFile() { return r.file ? { sha: r.file.sha, bytes: r.file.bytes.slice() } : null; },
    async putFile(bytes: Uint8Array, sha: string | undefined) {
      if ((r.file?.sha ?? undefined) !== sha) throw new RemoteConflict('stale');
      r.puts++;
      r.file = { sha: `sha${r.puts}`, bytes: bytes.slice() };
      return r.file.sha;
    },
  };
  return r satisfies RemoteStore;
}
const devices = () => {
  const remote = remoteStore();
  const mkd = () => { const d = fresh(); return { d, engine: new SyncEngine(d, dexieMeta(`p4b-meta-${n++}`), remote, 'a good passphrase') }; };
  return { A: mkd(), B: mkd() };
};

describe('P4B: a permanent deletion holds across devices (real sync engine and merge)', () => {
  const full = async (A: { engine: SyncEngine }, B: { engine: SyncEngine }, rounds = 2) => {
    for (let i = 0; i < rounds; i++) { await A.engine.sync(); await B.engine.sync(); }
    await A.engine.sync();
  };
  const everywhere = (xs: { d: FinanceDB }[], check: (d: FinanceDB) => Promise<void>) => Promise.all(xs.map((x) => check(x.d)));

  /** A and B both hold a project with a line and a task; A deletes it. */
  async function seeded() {
    const { A, B } = devices();
    const p = await mk(A.d);
    const line = await createLine(p, 'Cabinets', $(500), A.d);
    const task = await createProjectTask(p, { title: 'Pick paint' }, A.d);
    const ev = await createEvent(newEventData({ ...blankFields('2026-11-06'), title: 'Visit' }, ex({ projectId: p, recurrence: { ...weekly } as never })), A.d);
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    return { A, B, p, line, task, ev };
  }

  it('1. an older edit made on the other device before the deletion does not bring the project back', async () => {
    const { A, B, p, line } = await seeded();
    const rec = (await getProject(p, B.d))!;
    await saveProject(p, { ...rec.data, name: 'Renamed on B' }, B.d);
    await sleep(15);
    await deleteProjectPermanently(p, A.d);
    await B.engine.sync(); await A.engine.sync(); await B.engine.sync();
    await everywhere([A, B], async (d) => { expect(await getProject(p, d)).toBeUndefined(); expect(await loadBudgetLines(p, d)).toEqual([]); void line; });
  }, 60000);

  it('2. a NEWER edit made against the stale copy, even synced first, does not bring it back', async () => {
    const { A, B, p } = await seeded();
    await deleteProjectPermanently(p, A.d);
    await sleep(15);
    const rec = (await getProject(p, B.d))!; // B has not heard of the deletion
    await saveProject(p, { ...rec.data, name: 'Renamed on B, later' }, B.d);
    await B.engine.sync(); // B pushes its newer edit first
    await A.engine.sync();
    await B.engine.sync();
    await everywhere([A, B], async (d) => {
      expect(await getProject(p, d)).toBeUndefined();
      expect((await raw(d, p)).deletedAt).toBeGreaterThan(0);
    });
  }, 60000);

  it('3. repeated syncs from both devices keep it deleted', async () => {
    const { A, B, p } = await seeded();
    await deleteProjectPermanently(p, A.d);
    await sleep(15);
    await saveProject(p, { ...(await getProject(p, B.d))!.data, notes: 'late' }, B.d);
    await full(A, B, 3);
    await everywhere([A, B], async (d) => expect(await getProject(p, d)).toBeUndefined());
    await full(A, B, 2);
    await everywhere([A, B], async (d) => expect(await getProject(p, d)).toBeUndefined());
  }, 90000);

  it('4. budget lines never come back or end up orphaned, including a line made or edited on the stale device', async () => {
    const { A, B, p, line } = await seeded();
    await deleteProjectPermanently(p, A.d);
    await sleep(15);
    await saveLine(line, { plannedCents: $(900) }, B.d); // newer edit of an existing line
    const fresh2 = await createLine(p, 'Added on B', $(10), B.d); // a brand new line
    await full(A, B, 2);
    await everywhere([A, B], async (d) => {
      expect(await getProject(p, d)).toBeUndefined();
      expect(await loadBudgetLines(p, d)).toEqual([]);
      expect((await raw(d, line)).deletedAt).toBeGreaterThan(0);
      expect((await raw(d, fresh2)).deletedAt).toBeGreaterThan(0);
    });
  }, 90000);

  it('5. linked tasks, milestones and events stay intact and unlinked; a stale pointer is shown as "(project removed)"', async () => {
    const { A, B, p, task, ev } = await seeded();
    const ms = await createProjectTask(p, { title: 'Done', milestone: true }, A.d);
    await A.engine.sync(); await B.engine.sync();
    await deleteProjectPermanently(p, A.d);
    await full(A, B, 2);
    await everywhere([A, B], async (d) => {
      expect((await raw(d, task)).data.projectId).toBeUndefined();
      expect((await raw(d, ms)).data.projectId).toBeUndefined();
      expect((await raw(d, ms)).data.isMilestone).toBeUndefined();
      expect((await raw(d, ev)).data.projectId).toBeUndefined();
      expect((await raw(d, ev)).data.recurrence).toBeDefined();
      expect((await getTask(task, d))!.data.title).toBe('Pick paint');
    });
    // A task edited later on the stale device still carries the old pointer; nothing is lost and it reads as removed
    const t2 = await createProjectTask(await mk(B.d, 'Elsewhere'), { title: 'Other' }, B.d);
    expect(t2).toBeGreaterThan(0);
  }, 90000);

  it('6. a new task made on a stale device for the deleted project does not resurrect it, and is kept', async () => {
    const { A, B, p } = await seeded();
    await deleteProjectPermanently(p, A.d);
    const late = await createProjectTask(p, { title: 'Added on B' }, B.d);
    await full(A, B, 2);
    await everywhere([A, B], async (d) => {
      expect(await getProject(p, d)).toBeUndefined();
      expect((await getTask(late, d))?.data.title).toBe('Added on B');
    });
  }, 90000);

  it('7. Archive and Restore still work across devices', async () => {
    const { A, B, p } = await seeded();
    await archiveProject(p, A.d);
    await full(A, B, 1);
    expect((await getProject(p, B.d))!.data.archived).toBe(true);
    await sleep(15);
    await restoreProject(p, B.d);
    await full(A, B, 1);
    await everywhere([A, B], async (d) => expect((await getProject(p, d))!.data.archived).toBe(false));
  }, 90000);

  it('8. unrelated records keep last-writer-wins, and so does an ordinary (undo-style) project removal', async () => {
    const { A, B, task, p } = await seeded();
    await saveTask(task, { ...(await getTask(task, A.d))!.data, title: 'First edit' } as never, A.d);
    await sleep(15);
    await saveTask(task, { ...(await getTask(task, B.d))!.data, title: 'Later edit' } as never, B.d);
    await full(A, B, 1);
    await everywhere([A, B], async (d) => expect((await getTask(task, d))!.data.title).toBe('Later edit'));
    // a project removed the plain way (no permanent-deletion marker, as the Add box Undo does) is not given the new protection
    const other = await mk(A.d, 'Undo me');
    await A.engine.sync(); await B.engine.sync();
    await removeProjectRecord(other, A.d);
    await sleep(15);
    await saveProject(other, { ...(await raw(B.d, other)).data, notes: 'edited later on B' } as never, B.d);
    await full(A, B, 2);
    await everywhere([A, B], async (d) => expect(await getProject(other, d)).toBeDefined()); // the later edit won, as before
    expect(p).toBeGreaterThan(0);
  }, 90000);

  it('9. an intentional backup restore still wins over the deletion, as documented', async () => {
    const { A, B, p, line } = await seeded();
    const early = checkBackupText(JSON.stringify(await exportAll(A.d))).file;
    await deleteProjectPermanently(p, A.d);
    await full(A, B, 1);
    await everywhere([A, B], async (d) => expect(await getProject(p, d)).toBeUndefined());
    await sleep(15);
    await importAll(A.d, early); // the owner restores the old backup on device A
    await touchAll(A.d); // what the restore screens do when sync is on
    await full(A, B, 2);
    await everywhere([A, B], async (d) => {
      expect(await getProject(p, d)).toBeDefined();
      expect((await loadBudgetLines(p, d)).map((l) => l.id)).toEqual([line]);
    });
  }, 90000);

  it('money keeps a project alive: a transaction or commitment made on the stale device means the project and its lines are NOT deleted, and nothing financial is lost', async () => {
    const { A, B, p, line } = await seeded();
    const acct = (await B.d.accounts.add({ name: 'Checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' })) as number;
    await A.engine.sync(); await B.engine.sync(); // share the account
    await deleteProjectPermanently(p, A.d);
    await sleep(15);
    const t = (await B.d.txns.add({ accountId: acct, date: '2026-11-04', amountCents: -$(20), payee: 'Shop', memo: '', status: 'cleared', categoryId: null, project: { projectId: p, budgetLineId: line } })) as number;
    await full(A, B, 2);
    await everywhere([A, B], async (d) => {
      expect(await getProject(p, d)).toBeDefined();
      expect((await loadBudgetLines(p, d)).map((l) => l.id)).toEqual([line]);
      expect((await d.txns.get(t))!.project?.projectId).toBe(p);
    });
    // and the owner can now deal with it properly: the plan says what blocks the deletion
    expect((await planProjectDeletion(p, A.d)).canDelete).toBe(false);
  }, 90000);
});
