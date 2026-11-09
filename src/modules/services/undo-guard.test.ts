import { describe, expect, it, vi } from 'vitest';
import { FinanceDB } from '../../db';
import { createStore } from '../../core/store';
import { dexieMeta, RemoteConflict, SyncEngine, type RemoteFile, type RemoteStore } from '../../lib/sync/engine';
import { applying, installTracking } from '../../lib/sync/track';
import { createTask, getTask, removeTasks, saveTask } from '../tasks/data';
import { blankTask } from '../tasks/model';
import { createAsset } from '../assets/data';
import { blankAsset } from '../assets/model';
import { createArrangement, getArrangement, loadArrangements, tasksOfArrangement, writeArrangement } from './data';
import { applyLifecycle, applyRepair, applyScheduleChange, planLifecycle, planRepair, planScheduleChange, type LifecycleAction, type RepairKind } from './changes';
import { stable } from '../../lib/sync/merge';
import { applyUndo, contactIsReferenced, fingerprint, UNDO_REFUSED, UNDO_UNVERIFIED, type Undo } from './undo';
import { arrangementRef, blankArrangement, type Cadence } from './model';
import { openOf, withMarkers } from './schedule';
import { loadVisits, logStandaloneVisit } from './visits';

/**
 * S2.1: every lifecycle Undo is guarded by the state the action left (whole rows and link membership, not only `updatedAt`).
 * All names, places and amounts are invented. 2026-11-06 is a Friday.
 */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-undo-guard-${n++}`); installTracking(d); return d; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TODAY = '2026-11-06';
const biweekly: Cadence = { mode: 'fixed', rule: { freq: 'weekly', interval: 2, end: { type: 'never' } }, anchorDate: TODAY };
const monthly: Cadence = { mode: 'fixed', rule: { freq: 'monthly', interval: 1, end: { type: 'never' } }, anchorDate: TODAY };
const add = (d: FinanceDB, over = {}) => createArrangement({ data: blankArrangement({ title: 'Lawn care', cadence: biweekly, ...over }), provider: { name: 'Green Thumb Co' }, today: TODAY }, d);
const snapshot = async (d: FinanceDB) => JSON.stringify([await d.moduleRecords.toArray(), await d.links.toArray(), await d.contacts.toArray()]);
const openOfArr = async (d: FinanceDB, id: number) => openOf(await tasksOfArrangement(id, d));

// ---- the operations under test ----
const lifecycle = async (d: FinanceDB, id: number, action: LifecycleAction, over = {}) =>
  applyLifecycle({ action, arrangementId: id, expect: (await planLifecycle(id, action, TODAY, d)).expect, today: TODAY, ...over }, d);
const repair = async (d: FinanceDB, id: number, kind: RepairKind, taskId: number | null) =>
  applyRepair({ kind, arrangementId: id, taskId, expect: (await planRepair(kind, id, taskId, TODAY, d)).expect, today: TODAY }, d);

interface Ran { undo: Undo; arrId: number; taskId: number | null; successorId?: number }
interface Op { name: string; /** false: the action changes only Tasks, so the arrangement is not part of what Undo checks */ arr?: boolean; run: (d: FinanceDB, r: { id: number; taskId: number | null }) => Promise<Ran> }
const OPS: Op[] = [
  { name: 'Pause (remove the task)', run: async (d, r) => ({ ...(await lifecycle(d, r.id, 'pause', { taskChoice: 'remove' })), arrId: r.id, taskId: r.taskId }) },
  { name: 'Pause (keep the task)', run: async (d, r) => ({ ...(await lifecycle(d, r.id, 'pause', { taskChoice: 'keep' })), arrId: r.id, taskId: r.taskId }) },
  { name: 'Resume', run: async (d, r) => { await lifecycle(d, r.id, 'pause', { taskChoice: 'keep' }); return { ...(await lifecycle(d, r.id, 'resume')), arrId: r.id, taskId: r.taskId }; } },
  { name: 'End (remove the task)', run: async (d, r) => ({ ...(await lifecycle(d, r.id, 'end', { taskChoice: 'remove', endReason: 'cancelled' })), arrId: r.id, taskId: r.taskId }) },
  { name: 'End (keep the task)', run: async (d, r) => ({ ...(await lifecycle(d, r.id, 'end', { taskChoice: 'keep', endReason: 'cancelled' })), arrId: r.id, taskId: r.taskId }) },
  { name: 'Replace provider', run: async (d, r) => { const x = await lifecycle(d, r.id, 'replace', { replace: { provider: { name: 'Fresh Cuts Ltd' } } }); return { ...x, arrId: r.id, taskId: r.taskId, successorId: x.successorId! }; } },
  { name: 'Change schedule', run: async (d, r) => {
    const plan = await planScheduleChange(r.id, monthly, null, TODAY, d);
    return { ...(await applyScheduleChange({ arrangementId: r.id, expect: plan.expect, today: TODAY, cadence: monthly, visitTime: null, currentVisit: 'move' }, d)), arrId: r.id, taskId: r.taskId };
  } },
  { name: 'Repair: re-align', arr: false, run: async (d, r) => { const t = (await getTask(r.taskId!, d))!; await saveTask(t.id, { ...t.data, dueDate: '2026-11-10' }, d); return { ...(await repair(d, r.id, 'realign', t.id)), arrId: r.id, taskId: t.id }; } },
  { name: 'Repair: keep one', arr: false, run: async (d, r) => {
    const t = (await getTask(r.taskId!, d))!;
    await createTask(withMarkers(blankTask({ title: 'Lawn care: Green Thumb Co', dueDate: '2026-11-20' }), { arrangement: r.id }), [arrangementRef(r.id)], d);
    return { ...(await repair(d, r.id, 'keep-one', t.id)), arrId: r.id, taskId: t.id };
  } },
  { name: 'Repair: schedule next', run: async (d, r) => { await removeTasks([r.taskId!], d); const x = await repair(d, r.id, 'schedule-next', null); return { ...x, arrId: r.id, taskId: r.taskId }; } },
  { name: 'Repair: make the task follow', arr: false, run: async (d, r) => { const t = (await getTask(r.taskId!, d))!; await saveTask(t.id, { ...t.data, repeat: null }, d); return { ...(await repair(d, r.id, 'task-follows', t.id)), arrId: r.id, taskId: t.id }; } },
];

/** What the owner would call "the arrangement and its task" right now, minus time stamps. */
async function view(d: FinanceDB, arrId: number, taskId: number | null) {
  const a = await d.moduleRecords.get(arrId);
  const t = taskId !== null ? await d.moduleRecords.get(taskId) : undefined;
  const strip = (r?: { data: unknown; deletedAt?: number | null }) => (r ? { data: r.data, dead: r.deletedAt != null } : null);
  return stable({ a: strip(a), t: strip(t) });
}

describe('S2.1: a lifecycle Undo with nothing changed in between still works', () => {
  for (const op of OPS) {
    it(`${op.name}: Undo puts the arrangement and task back exactly`, async () => {
      const d = fresh();
      const r = await add(d);
      // for operations that start from a prepared state, take "before" after the preparation: run() prepares then acts, so capture inside
      let before = '';
      const wrapped = await (async () => {
        const prepared = op.name === 'Resume' || op.name.startsWith('Repair');
        if (!prepared) before = await view(d, r.id, r.taskId);
        const ran = await op.run(d, r);
        return ran;
      })();
      expect(wrapped.undo.sealed).toBeTruthy();
      if (op.name === 'Resume') {
        // the state before Resume is the paused one; undo must give a paused arrangement with the same task
        await applyUndo(wrapped.undo, d);
        expect((await getArrangement(r.id, d))!.data.status).toBe('paused');
        expect((await getTask(r.taskId!, d))!.data.status).toBe('todo');
        return;
      }
      await applyUndo(wrapped.undo, d);
      if (wrapped.successorId) {
        expect(await getArrangement(wrapped.successorId, d)).toBeUndefined();
        expect((await d.links.toArray()).filter((l) => l.deletedAt == null && (l.toId === `arrangement:${wrapped.successorId}` || l.fromId === `arrangement:${wrapped.successorId}`))).toEqual([]);
        expect((await getArrangement(r.id, d))!.data.status).toBe('active');
      }
      if (before) expect(await view(d, r.id, r.taskId)).toBe(before);
      else if (op.name === 'Repair: schedule next') expect((await openOfArr(d, r.id)).length).toBe(0); // the created task is gone
      else if (op.name === 'Repair: re-align') expect((await getTask(r.taskId!, d))!.data.dueDate).toBe('2026-11-10');
      else if (op.name === 'Repair: keep one') expect((await openOfArr(d, r.id)).length).toBe(2);
      else if (op.name === 'Repair: make the task follow') expect((await getTask(r.taskId!, d))!.data.repeat).toBeNull();
    });
  }
});

describe('S2.1: every lifecycle Undo refuses when anything it touched has changed, and writes nothing', () => {
  const meddles: [string, (d: FinanceDB, ran: Ran) => Promise<void>][] = [
    ['the arrangement was edited', async (d, ran) => { const a = (await getArrangement(ran.arrId, d))!; await writeArrangement(a.id, { ...a.data, notes: 'edited by someone else' }, d); }],
    ['the task was edited', async (d, ran) => { const t = (await d.moduleRecords.get(ran.taskId!))!; await saveTask(t.id as number, { ...(t.data as Record<string, unknown>), notes: 'edited by someone else' } as never, d); }],
    ['a link was added to the task', async (d, ran) => { await createStore(d).shared.links.add({ module: 'tasks', id: ran.taskId! }, { module: 'projects', id: 'project:42' }, 'about'); }],
    ['a link was added to the arrangement', async (d, ran) => { await createStore(d).shared.links.add({ module: 'tasks', id: 99 }, arrangementRef(ran.arrId), 'about'); }],
  ];
  for (const op of OPS) for (const [what, meddle] of meddles) {
    const guarded = op.arr !== false || what.includes('task');
    it(`${op.name}: ${guarded ? 'refused' : 'NOT blocked (it never touched the arrangement)'} after ${what}`, async () => {
      const d = fresh();
      const r = await add(d);
      const ran = await op.run(d, r);
      // The "keep" and "schedule next" cases need a task to edit: the created task for schedule-next
      if (op.name === 'Repair: schedule next' && what.includes('task')) ran.taskId = (await openOfArr(d, r.id))[0].id;
      await sleep(3);
      await meddle(d, ran);
      const snap = await snapshot(d);
      if (!guarded) { await applyUndo(ran.undo, d); return; }
      await expect(applyUndo(ran.undo, d)).rejects.toThrow(UNDO_REFUSED);
      expect(await snapshot(d)).toBe(snap);
    });
  }
});

describe('S2.1: Replace provider keeps work added to the successor, and never removes contacts', () => {
  it('a Task or asset link added to the successor afterwards stops the Undo and survives', async () => {
    const d = fresh();
    const house = await createAsset(blankAsset({ name: 'Back garden', type: 'property' }), d);
    const r = await createArrangement({ data: blankArrangement({ title: 'Lawn care', cadence: biweekly }), provider: { name: 'Green Thumb Co' }, assetIds: [house], today: TODAY }, d);
    const x = await lifecycle(d, r.id, 'replace', { replace: { provider: { name: 'Fresh Cuts Ltd' } } });
    const extra = await createTask(blankTask({ title: 'Buy mulch for the new gardeners' }), [arrangementRef(x.successorId!)], d);
    const snap = await snapshot(d);
    await expect(applyUndo(x.undo, d)).rejects.toThrow(UNDO_REFUSED);
    expect(await snapshot(d)).toBe(snap);
    expect(await getArrangement(x.successorId!, d)).toBeTruthy();
    expect((await tasksOfArrangement(x.successorId!, d)).map((t) => t.id)).toContain(extra);
    // and the asset link the change itself made is untouched
    expect((await createStore(d).shared.links.linkedTo(arrangementRef(x.successorId!))).length).toBeGreaterThanOrEqual(3);
  });
  it('the replacement contact is never removed by Undo, and a successful Undo removes only the links it made', async () => {
    const d = fresh();
    const house = await createAsset(blankAsset({ name: 'Back garden', type: 'property' }), d);
    const r = await createArrangement({ data: blankArrangement({ title: 'Lawn care', cadence: biweekly }), provider: { name: 'Green Thumb Co' }, assetIds: [house], today: TODAY }, d);
    const otherLink = await createStore(d).shared.links.add({ module: 'tasks', id: 5 }, { module: 'assets', id: `asset:${house}` }, 'about');
    const x = await lifecycle(d, r.id, 'replace', { replace: { provider: { name: 'Fresh Cuts Ltd' } } });
    expect(x.contactCreated).toBe(true);
    await applyUndo(x.undo, d);
    expect((await d.contacts.toArray()).filter((c) => c.deletedAt == null).map((c) => c.name).sort()).toEqual(['Fresh Cuts Ltd', 'Green Thumb Co']);
    expect((await d.links.get(otherLink))!.deletedAt ?? null).toBeNull(); // a link of the asset that is not the successor's survives
    expect((await createStore(d).shared.links.linkedTo({ module: 'assets', id: `asset:${house}` })).some((l) => l.fromId === `arrangement:${r.id}`)).toBe(true);
  });
  it('Quick Add style removal of a created contact: removed only if untouched and unused', async () => {
    const d = fresh();
    const make = async () => logStandaloneVisit({ provider: { name: `New Plumber ${n++}` }, input: { status: 'completed', cancelledBy: null, date: TODAY, notes: '', chargedCents: null, chargeKind: null, title: 'Tap' }, today: TODAY }, d);
    const live = async () => (await d.contacts.toArray()).filter((c) => c.deletedAt == null).length;
    const a = await make();
    await applyUndo(a.undo, d, { dropCreatedContact: true });
    expect(await live()).toBe(0);
    const b = await make();
    await createTask(blankTask({ title: 'Ring the plumber', contactIds: [b.contactId!] }), [], d); // another module now refers to the contact
    expect(await contactIsReferenced(b.contactId!, d)).toBe(true);
    await applyUndo(b.undo, d, { dropCreatedContact: true });
    expect(await live()).toBe(1);
    const c = await make();
    await sleep(3);
    await d.contacts.update(c.contactId!, { phone: '555-0100' });
    await expect(applyUndo(c.undo, d, { dropCreatedContact: true })).rejects.toThrow(UNDO_REFUSED); // edited since: the whole Undo is refused
    expect(await live()).toBe(2);
    expect(await loadVisits(d)).toHaveLength(1);
  });
});

describe('S2.1: an equal updatedAt does not hide a change (timestamp-collision investigation)', () => {
  /** Rewrites a row WITHOUT the usual re-stamping, so its updatedAt is exactly what it was. */
  async function silentEdit(d: FinanceDB, id: number, change: (data: Record<string, unknown>) => Record<string, unknown>) {
    const row = (await d.moduleRecords.get(id))!;
    const key = `moduleRecords|${id}`;
    applying.add(key);
    try { await d.moduleRecords.put({ ...row, data: change(row.data as Record<string, unknown>) } as never); } finally { applying.delete(key); }
    const after = (await d.moduleRecords.get(id))!;
    expect(after.updatedAt).toBe(row.updatedAt); // the premise: same stamp, different content
    expect(JSON.stringify(after.data)).not.toBe(JSON.stringify(row.data));
  }
  it('a changed arrangement with an identical updatedAt still refuses Undo', async () => {
    const d = fresh();
    const r = await add(d);
    const ran = await lifecycle(d, r.id, 'pause');
    const before = (await d.moduleRecords.get(r.id))!;
    await silentEdit(d, r.id, (x) => ({ ...x, notes: 'same millisecond, different words' }));
    // a timestamp-only comparison would have accepted this one:
    expect((await d.moduleRecords.get(r.id))!.updatedAt).toBe(before.updatedAt);
    const snap = await snapshot(d);
    await expect(applyUndo(ran.undo, d)).rejects.toThrow(UNDO_REFUSED);
    expect(await snapshot(d)).toBe(snap);
  });
  it('the same for a changed Task, and for an unknown field a newer version added', async () => {
    const d = fresh();
    const r = await add(d);
    await silentEdit(d, r.id, (x) => ({ ...x, futureField: { a: [1] } })); // an unknown field the app does not understand
    const ran = await lifecycle(d, r.id, 'end', { taskChoice: 'keep', endReason: 'cancelled' });
    await silentEdit(d, r.taskId!, (x) => ({ ...x, notes: 'tampered at the same instant' }));
    await expect(applyUndo(ran.undo, d)).rejects.toThrow(UNDO_REFUSED);
    // the unknown field alone also counts
    const ran2 = await (async () => { const d2 = fresh(); const r2 = await add(d2); const u = await lifecycle(d2, r2.id, 'pause', { taskChoice: 'keep' }); await silentEdit(d2, r2.id, (x) => ({ ...x, futureField: 'added by a newer version' })); return { d2, u }; })();
    await expect(applyUndo(ran2.u.undo, ran2.d2)).rejects.toThrow(UNDO_REFUSED);
  });
  it('unknown fields written before the action survive a successful Undo', async () => {
    const d = fresh();
    const r = await add(d);
    await silentEdit(d, r.id, (x) => ({ ...x, futureField: { keep: ['me'] } }));
    const ran = await lifecycle(d, r.id, 'pause');
    await applyUndo(ran.undo, d);
    expect(((await d.moduleRecords.get(r.id))!.data as Record<string, unknown>).futureField).toEqual({ keep: ['me'] });
  });
  it('a different property order or a different order of a SET field (contact ids) is not a change; an ordered list still is', () => {
    const a = { id: 1, updatedAt: 5, data: { title: 'x', extraContactIds: [3, 1, 2], acknowledged: ['b', 'a'], refs: [{ n: 1 }, { n: 2 }] } };
    const reordered = { data: { refs: [{ n: 1 }, { n: 2 }], acknowledged: ['a', 'b'], extraContactIds: [1, 2, 3], title: 'x' }, updatedAt: 5, id: 1, deletedAt: null };
    expect(fingerprint(reordered)).toBe(fingerprint(a));
    const orderedChanged = { ...a, data: { ...a.data, refs: [{ n: 2 }, { n: 1 }] } };
    expect(fingerprint(orderedChanged)).not.toBe(fingerprint(a));
    expect(fingerprint({ ...a, data: { ...a.data, extraContactIds: [3, 1] } })).not.toBe(fingerprint(a));
  });
});

describe('S2.1: an Undo that cannot be shown to be safe is refused', () => {
  it('a token without recorded state (old shape, or a hand-made one) is refused and removes nothing', async () => {
    const d = fresh();
    const r = await add(d);
    const snap = await snapshot(d);
    await expect(applyUndo({ arrangements: [], tasks: [], created: [r.id, r.taskId!] }, d)).rejects.toThrow(UNDO_UNVERIFIED);
    expect(await snapshot(d)).toBe(snap);
    expect((await loadArrangements(d)).map((a) => a.id)).toEqual([r.id]);
  });
  it('adding an arrangement is undone only while untouched', async () => {
    const d = fresh();
    const r = await add(d);
    await applyUndo(r.undo, d);
    expect(await loadArrangements(d)).toEqual([]);
    const s = await add(d, { title: 'Pest control' });
    await sleep(3);
    const task = (await getTask(s.taskId!, d))!;
    await saveTask(task.id, { ...task.data, notes: 'now has my notes' }, d);
    const snap = await snapshot(d);
    await expect(applyUndo(s.undo, d)).rejects.toThrow(UNDO_REFUSED);
    expect(await snapshot(d)).toBe(snap);
  });
  it('an unrelated record changing does not block an untouched operation', async () => {
    const d = fresh();
    const r = await add(d);
    const other = await add(d, { title: 'Pool service' });
    const ran = await lifecycle(d, r.id, 'pause');
    await sleep(3);
    const o = (await getArrangement(other.id, d))!;
    await writeArrangement(o.id, { ...o.data, notes: 'unrelated' }, d);
    await createStore(d).shared.links.add({ module: 'tasks', id: other.taskId! }, { module: 'projects', id: 'project:1' }, 'about');
    await applyUndo(ran.undo, d);
    expect((await getArrangement(r.id, d))!.data.status).toBe('active');
  });
});

describe('S2.1: a write that fails half way through Undo rolls everything back', () => {
  it('Replace provider: the second write fails, nothing at all is changed, and Undo then works', async () => {
    const d = fresh();
    const house = await createAsset(blankAsset({ name: 'Back garden', type: 'property' }), d);
    const r = await createArrangement({ data: blankArrangement({ title: 'Lawn care', cadence: biweekly }), provider: { name: 'Green Thumb Co' }, assetIds: [house], today: TODAY }, d);
    const x = await lifecycle(d, r.id, 'replace', { replace: { provider: { name: 'Fresh Cuts Ltd' } } });
    const snap = await snapshot(d);
    const real = d.moduleRecords.put.bind(d.moduleRecords);
    let calls = 0;
    const spy = vi.spyOn(d.moduleRecords, 'put').mockImplementation(((...a: Parameters<typeof real>) => { calls++; if (calls === 2) throw new Error('disk full (simulated)'); return real(...a); }) as never);
    await expect(applyUndo(x.undo, d)).rejects.toThrow(/simulated/);
    spy.mockRestore();
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(await snapshot(d)).toBe(snap);
    expect((await getArrangement(x.successorId!, d))).toBeTruthy();
    await applyUndo(x.undo, d); // the same Undo, after the fault is gone
    expect(await getArrangement(x.successorId!, d)).toBeUndefined();
    expect((await getArrangement(r.id, d))!.data.status).toBe('active');
  });
  it('Pause: a failure while restoring the arrangement leaves the restored task rolled back too', async () => {
    const d = fresh();
    const r = await add(d);
    const ran = await lifecycle(d, r.id, 'pause', { taskChoice: 'remove' });
    const snap = await snapshot(d);
    const real = d.moduleRecords.put.bind(d.moduleRecords);
    let calls = 0;
    const spy = vi.spyOn(d.moduleRecords, 'put').mockImplementation(((...a: Parameters<typeof real>) => { calls++; if (calls === 2) throw new Error('simulated'); return real(...a); }) as never);
    await expect(applyUndo(ran.undo, d)).rejects.toThrow(/simulated/);
    spy.mockRestore();
    expect(await snapshot(d)).toBe(snap);
  });
});

describe('S2.1: two real devices (SyncEngine): a lifecycle Undo is refused after the other device changed something it touched', () => {
  function remoteStore() {
    const r = {
      puts: 0, file: null as RemoteFile | null,
      async getFile() { return r.file ? { sha: r.file.sha, bytes: r.file.bytes.slice() } : null; },
      async putFile(bytes: Uint8Array, sha: string | undefined) {
        if ((r.file?.sha ?? undefined) !== sha) throw new RemoteConflict('stale');
        r.puts++; r.file = { sha: `sha${r.puts}`, bytes: bytes.slice() }; return r.file.sha;
      },
    };
    return r satisfies RemoteStore;
  }
  const devices = () => {
    const remote = remoteStore();
    const mk = () => { const d = fresh(); return { d, engine: new SyncEngine(d, dexieMeta(`undo-meta-${n++}`), remote, 'a good passphrase') }; };
    return { A: mk(), B: mk() };
  };
  type Dev = ReturnType<typeof devices>['A'];
  const settle = async (A: Dev, B: Dev) => { for (let i = 0; i < 2; i++) { await A.engine.sync(); await B.engine.sync(); } await A.engine.sync(); };
  async function seeded() {
    const { A, B } = devices();
    const r = await add(A.d);
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    return { A, B, r };
  }
  const bothRefuse = async (A: Dev, B: Dev, undo: Undo) => {
    for (const x of [A, B]) {
      const snap = await snapshot(x.d);
      await expect(applyUndo(undo, x.d)).rejects.toThrow(UNDO_REFUSED);
      expect(await snapshot(x.d)).toBe(snap);
    }
  };
  const editArr = async (d: FinanceDB, id: number, notes: string) => { const a = (await getArrangement(id, d))!; await writeArrangement(id, { ...a.data, notes }, d); };
  const editTask = async (d: FinanceDB, id: number, over: Record<string, unknown>) => { const t = (await getTask(id, d))!; await saveTask(id, { ...t.data, ...over } as never, d); };

  it('1. A pauses, B edits the arrangement: A\'s Undo is refused and B\'s edit survives on both', async () => {
    const { A, B, r } = await seeded();
    const ran = await lifecycle(A.d, r.id, 'pause', { taskChoice: 'remove' });
    await settle(A, B);
    await sleep(15);
    await editArr(B.d, r.id, 'B was here');
    await settle(A, B);
    await bothRefuse(A, B, ran.undo);
    for (const x of [A, B]) { const a = (await getArrangement(r.id, x.d))!; expect(a.data.notes).toBe('B was here'); expect(a.data.status).toBe('paused'); }
  });
  it('2. A resumes, B changes the task: refused', async () => {
    const { A, B, r } = await seeded();
    await lifecycle(A.d, r.id, 'pause', { taskChoice: 'keep' });
    await settle(A, B);
    const ran = await lifecycle(A.d, r.id, 'resume');
    await settle(A, B);
    await sleep(15);
    await editTask(B.d, r.taskId!, { notes: 'B moved the plan' });
    await settle(A, B);
    await bothRefuse(A, B, ran.undo);
    expect((await getTask(r.taskId!, A.d))!.data.notes).toBe('B moved the plan');
  });
  it('3. A ends the arrangement, B modifies a linked task: refused', async () => {
    const { A, B, r } = await seeded();
    const ran = await lifecycle(A.d, r.id, 'end', { taskChoice: 'keep', endReason: 'cancelled' });
    await settle(A, B);
    await sleep(15);
    await editTask(B.d, r.taskId!, { notes: 'still needed' });
    await settle(A, B);
    await bothRefuse(A, B, ran.undo);
    expect((await getArrangement(r.id, A.d))!.data.status).toBe('ended');
  });
  it('4. A replaces the provider, B edits the successor: refused, both records preserved', async () => {
    const { A, B, r } = await seeded();
    const x = await lifecycle(A.d, r.id, 'replace', { replace: { provider: { name: 'Fresh Cuts Ltd' } } });
    await settle(A, B);
    await sleep(15);
    await editArr(B.d, x.successorId!, 'B refined the successor');
    await settle(A, B);
    await bothRefuse(A, B, x.undo);
    for (const d of [A.d, B.d]) {
      expect((await getArrangement(x.successorId!, d))!.data.notes).toBe('B refined the successor');
      expect((await getArrangement(r.id, d))!.data.status).toBe('ended');
    }
  });
  it('5. A changes the cadence, B reschedules the current task: refused', async () => {
    const { A, B, r } = await seeded();
    const plan = await planScheduleChange(r.id, monthly, null, TODAY, A.d);
    const ran = await applyScheduleChange({ arrangementId: r.id, expect: plan.expect, today: TODAY, cadence: monthly, visitTime: null, currentVisit: 'move' }, A.d);
    await settle(A, B);
    await sleep(15);
    await editTask(B.d, r.taskId!, { dueDate: '2026-12-31' });
    await settle(A, B);
    await bothRefuse(A, B, ran.undo);
    expect((await getTask(r.taskId!, A.d))!.data.dueDate).toBe('2026-12-31');
  });
  it('6. A repairs the schedule, B modifies the repaired task: refused', async () => {
    const { A, B, r } = await seeded();
    await editTask(A.d, r.taskId!, { dueDate: '2026-11-10' });
    const ran = await repair(A.d, r.id, 'realign', r.taskId!);
    await settle(A, B);
    await sleep(15);
    await editTask(B.d, r.taskId!, { notes: 'B touched the repaired task' });
    await settle(A, B);
    await bothRefuse(A, B, ran.undo);
  });
  it('7. B adds a shared link to a record A\'s action touched: refused, the link stays', async () => {
    const { A, B, r } = await seeded();
    const ran = await lifecycle(A.d, r.id, 'pause', { taskChoice: 'remove' });
    await settle(A, B);
    await sleep(15);
    await createStore(B.d).shared.links.add({ module: 'tasks', id: r.taskId! }, { module: 'projects', id: 'project:7' }, 'about');
    await settle(A, B);
    await bothRefuse(A, B, ran.undo);
    for (const x of [A, B]) expect((await createStore(x.d).shared.links.linkedTo({ module: 'tasks', id: r.taskId! })).some((l) => l.toId === 'project:7')).toBe(true);
  });
  it('9. an unrelated change on B does not block A\'s Undo, and the Undo then reaches B', async () => {
    const { A, B, r } = await seeded();
    const ran = await lifecycle(A.d, r.id, 'pause', { taskChoice: 'remove' });
    await settle(A, B);
    await sleep(15);
    const other = await add(B.d, { title: 'Pool service' });
    await editTask(B.d, other.taskId!, { notes: 'unrelated' });
    await settle(A, B);
    await applyUndo(ran.undo, A.d);
    await sleep(15);
    await settle(A, B);
    for (const x of [A, B]) { expect((await getArrangement(r.id, x.d))!.data.status).toBe('active'); expect((await getTask(r.taskId!, x.d))!.data.status).toBe('todo'); }
  });
  it('10. with no change in between, A\'s Undo succeeds after both devices have synced', async () => {
    const { A, B, r } = await seeded();
    const x = await lifecycle(A.d, r.id, 'replace', { replace: { provider: { name: 'Fresh Cuts Ltd' } } });
    await settle(A, B);
    await applyUndo(x.undo, A.d);
    await sleep(15);
    await settle(A, B);
    for (const d of [A.d, B.d]) { expect(await getArrangement(x.successorId!, d)).toBeUndefined(); expect((await getArrangement(r.id, d))!.data.status).toBe('active'); }
  });
});
