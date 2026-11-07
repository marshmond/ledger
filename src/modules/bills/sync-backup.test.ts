import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { exportAll, importAll } from '../../lib/backup';
import { buildBackup, checkBackupText, restoreChecked } from '../../lib/backupFile';
import { summarizeBackup } from '../../lib/backupSummary';
import { createStore } from '../../core/store';
import { stable } from '../../lib/sync/merge';
import { applyLifecycle, createObligation, deleteObligation, editObligation, getObligation, loadObligations, planLifecycle, setReview, type ObligationEdit } from './data';
import { MODULE, type ObligationData } from './model';
import { applyUndo, UNDO_REFUSED } from './undo';
import { devices, fresh, financeSnapshot, monthly, ob, settle, sleep, type Dev } from './billsTestkit';

/** Real SyncEngine with two devices, and the real backup export, file checker and restore. Invented data only. 2026-11-07 is a Saturday. */
const TODAY = '2026-11-07';
const FUTURE_CYCLE = { obligationId: 0, slot: 'm2026-12', fact: 'time-travel-invoice', somethingNew: { a: [1, 2, 3] } }; // a record kind of a later phase, with a fact this build has never heard of
const edit = (cur: ObligationData): ObligationEdit => ({
  title: cur.title, type: cur.type, need: cur.need, amountKind: cur.amountKind, amountCents: cur.prices[0]?.cents ?? null, trackingSince: cur.trackingSince, schedule: cur.schedule,
  payment: cur.payment, paidThroughLoan: cur.paidThroughLoan, review: { on: cur.review.on, note: cur.review.note }, refs: cur.refs, notes: cur.notes,
});
const bills = async (d: FinanceDB) => (await d.moduleRecords.toArray()).filter((r) => r.module === MODULE).sort((a, b) => (a.id as number) - (b.id as number));
const same = async (a: FinanceDB, b: FinanceDB) => { expect(stable(await bills(a))).toBe(stable(await bills(b))); };
const lc = async (d: FinanceDB, id: number, action: 'pause' | 'resume' | 'end' | 'reopen', date?: string) => {
  const plan = await planLifecycle(id, action, { today: TODAY, date }, d);
  return applyLifecycle({ id, action, expect: plan.expect, today: TODAY, date }, d);
};

async function seeded() {
  const { A, B } = devices();
  const r = await createObligation({ data: ob({ title: 'Streamly Premium', type: 'subscription', schedule: monthly(12, '2026-11'), prices: [{ from: TODAY, cents: 1549, label: '' }] }, TODAY), provider: { name: 'Streamly' } }, A.d);
  await A.engine.initialUpload();
  await B.engine.replaceFromRemote();
  return { A, B, id: r.id, contactId: r.contactId! };
}

describe('B1: two devices (real sync engine)', () => {
  it('schema is still Dexie v15 and no table was added for Bills', () => {
    const d = fresh();
    expect(d.verno).toBe(15);
    const names = d.tables.map((t) => t.name);
    expect(names.filter((x) => /bill|obligation|cycle/i.test(x))).toEqual([]);
  });
  it('a bill added on A reaches B with its provider Contact; nothing doubled', async () => {
    const { A, B, id, contactId } = await seeded();
    expect((await getObligation(id, B.d))!.data.title).toBe('Streamly Premium');
    expect((await B.d.contacts.get(contactId))!.name).toBe('Streamly');
    expect(await B.d.contacts.count()).toBe(1);
    await same(A.d, B.d);
  });
  it('each device adds a different bill offline: both have both after syncing (nothing lost)', async () => {
    const { A, B } = await seeded();
    await createObligation({ data: ob({ title: 'Bill from A' }, TODAY), provider: null }, A.d);
    await createObligation({ data: ob({ title: 'Bill from B' }, TODAY), provider: null }, B.d);
    await settle(A, B);
    for (const d of [A.d, B.d]) expect((await loadObligations(d)).map((r) => r.data.title).sort()).toEqual(['Bill from A', 'Bill from B', 'Streamly Premium']);
    await same(A.d, B.d);
  });
  it('unknown future fields and an unreadable status travel through sync and an edit on the other device', async () => {
    const { A, B, id } = await seeded();
    const raw = (await A.d.moduleRecords.get(id))!;
    await sleep(3);
    await A.d.moduleRecords.put({ ...raw, data: { ...(raw.data as object), futureField: { nested: [1, 2, { z: 'kept' }] }, status: 'snoozed' } as never, updatedAt: Date.now() });
    await settle(A, B);
    expect(((await B.d.moduleRecords.get(id))!.data as Record<string, unknown>).futureField).toEqual({ nested: [1, 2, { z: 'kept' }] });
    const onB = (await getObligation(id, B.d))!;
    expect(onB.data.status).toBe('unsupported');
    await sleep(3);
    await editObligation(id, { ...edit(onB.data), title: 'Edited on B' }, onB.updatedAt, TODAY, B.d);
    await settle(A, B);
    const back = (await A.d.moduleRecords.get(id))!.data as Record<string, unknown>;
    expect(back.title).toBe('Edited on B');
    expect(back.status).toBe('snoozed');
    expect(back.futureField).toEqual({ nested: [1, 2, { z: 'kept' }] });
    await same(A.d, B.d);
  });
  it('test 40: both devices change the same bill: the later write wins on both, and the other version is saved and restorable', async () => {
    const { A, B, id } = await seeded();
    await sleep(10); // real edits never land in the same millisecond as a sync
    const a = (await getObligation(id, A.d))!;
    const b = (await getObligation(id, B.d))!;
    await editObligation(id, { ...edit(a.data), title: 'A says Streamly One' }, a.updatedAt, TODAY, A.d);
    await sleep(15);
    await editObligation(id, { ...edit(b.data), title: 'B says Streamly Two' }, b.updatedAt, TODAY, B.d);
    await A.engine.sync();
    await B.engine.sync();
    await A.engine.sync();
    const winner = (await getObligation(id, A.d))!.data.title;
    expect(winner).toBe('B says Streamly Two');
    await same(A.d, B.d);
    const lost = [...(await A.engine.conflicts()), ...(await B.engine.conflicts())].filter((c) => c.lost);
    expect(lost.length).toBeGreaterThan(0);
    expect(JSON.stringify(lost)).toContain('A says Streamly One');
  });
  it('test 38: Undo, then a change by another device: Undo is refused and nothing is written', async () => {
    const { A, B, id } = await seeded();
    const { undo } = await lc(A.d, id, 'pause', '2026-12-01');
    await settle(A, B);
    expect((await getObligation(id, B.d))!.data.status).toBe('paused');
    const b = (await getObligation(id, B.d))!;
    await sleep(5);
    await setReview(id, true, 'from B', b.updatedAt, TODAY, B.d);
    await settle(A, B);
    const before = JSON.stringify(await bills(A.d));
    await expect(applyUndo(undo, A.d)).rejects.toThrow(UNDO_REFUSED);
    expect(JSON.stringify(await bills(A.d))).toBe(before);
    expect((await getObligation(id, A.d))!.data.review.on).toBe(true);
  });
  it('a bill ended on A while B changes its review note: both converge to the same valid record and neither loses a Bills record', async () => {
    const { A, B, id } = await seeded();
    await B.d.moduleRecords.add({ id: id + 1, module: MODULE, kind: 'cycle', data: { ...FUTURE_CYCLE, obligationId: id }, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    await settle(A, B);
    await lc(A.d, id, 'end', TODAY);
    await sleep(8);
    const b = (await getObligation(id, B.d))!;
    await setReview(id, true, 'check', b.updatedAt, TODAY, B.d);
    await settle(A, B);
    await same(A.d, B.d);
    const final = (await getObligation(id, A.d))!;
    expect(['ended', 'active']).toContain(final.data.status);
    for (const d of [A.d, B.d]) expect((await d.moduleRecords.get(id + 1))!.data).toMatchObject({ obligationId: id, fact: 'time-travel-invoice', somethingNew: { a: [1, 2, 3] } });
  });
  it('a schedule change on A and a different bill record on B do not interfere', async () => {
    const { A, B, id } = await seeded();
    const a = (await getObligation(id, A.d))!;
    await editObligation(id, { ...edit(a.data), schedule: monthly(20, '2026-11') }, a.updatedAt, TODAY, A.d);
    await createObligation({ data: ob({ title: 'Other bill' }, TODAY), provider: null }, B.d);
    await settle(A, B);
    await same(A.d, B.d);
    expect((await getObligation(id, B.d))!.data.schedule).toEqual(monthly(20, '2026-11'));
    expect(await loadObligations(B.d)).toHaveLength(2);
  });
  it('deleting an empty bill on A removes it on B; a billing-period record of a later phase added on B is NOT lost (orphan, kept for review)', async () => {
    const { A, B, id } = await seeded();
    await B.d.moduleRecords.add({ id: id + 5, module: MODULE, kind: 'cycle', data: { ...FUTURE_CYCLE, obligationId: id }, createdAt: 1, updatedAt: Date.now(), deletedAt: null } as never);
    await deleteObligation(id, null, A.d);
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      expect(await getObligation(id, d)).toBeUndefined();
      expect((await d.moduleRecords.get(id + 5))!.deletedAt ?? null).toBeNull(); // the orphan is still there
    }
    await same(A.d, B.d);
  });
  it('a record kind and fact this build does not know are synced untouched (older-build carry-through)', async () => {
    const { A, B, id } = await seeded();
    await A.d.moduleRecords.add({ id: id + 9, module: MODULE, kind: 'cycle', data: { ...FUTURE_CYCLE, obligationId: id }, createdAt: 1, updatedAt: Date.now(), deletedAt: null } as never);
    await A.d.moduleRecords.add({ id: id + 10, module: MODULE, kind: 'quantum', data: { x: 1 }, createdAt: 1, updatedAt: Date.now(), deletedAt: null } as never);
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      expect((await d.moduleRecords.get(id + 9))!.data).toEqual({ ...FUTURE_CYCLE, obligationId: id });
      expect((await d.moduleRecords.get(id + 10))!.kind).toBe('quantum');
    }
    expect((await loadObligations(B.d)).map((r) => r.id)).toEqual([id]); // the reader ignores kinds it does not read
  });
  it('Bills changes and their sync do not touch any Finance table on either device', async () => {
    const { A, B } = devices();
    await A.d.accounts.add({ name: 'Example Checking', kind: 'checking', openingBalanceCents: 100, openingDate: '2026-01-01' } as never);
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    const fin = await financeSnapshot(A.d);
    expect(await financeSnapshot(B.d)).toBe(fin);
    const r = await createObligation({ data: ob({ title: 'X' }, TODAY), provider: { name: 'Y Co' } }, A.d);
    await lc(A.d, r.id, 'pause', '2026-12-01');
    await settle(A, B);
    expect(await financeSnapshot(A.d)).toBe(fin);
    expect(await financeSnapshot(B.d)).toBe(fin);
    expect((await loadObligations(B.d)).map((x) => x.data.status)).toEqual(['paused']);
  });
});

describe('B1: backup and restore (test 42, 43)', () => {
  async function household(d: FinanceDB) {
    const a = await createObligation({ data: ob({ title: 'Streamly Premium', type: 'subscription', review: { on: true, note: 'check use', since: TODAY }, refs: [{ label: 'Statement', url: 'https://example.com/s' }], notes: 'n' }, TODAY), provider: { name: 'Streamly' } }, d);
    const b = await createObligation({ data: ob({ title: 'Example Power Co', amountKind: 'variable', prices: [{ from: TODAY, cents: 9000, label: '' }], schedule: monthly(18, '2026-11') }, TODAY), provider: { name: 'Example Power' } }, d);
    await lc(d, b.id, 'pause', '2026-12-01');
    const c = await createObligation({ data: ob({ title: 'Old gym' }, TODAY), provider: null }, d);
    await sleep(2);
    await lc(d, c.id, 'end', TODAY);
    // a future field, an unreadable status, and a record kind of a later phase
    const raw = (await d.moduleRecords.get(a.id))!;
    await d.moduleRecords.put({ ...raw, data: { ...(raw.data as object), futureField: { deep: [1, { two: 2 }] }, schedule: { kind: 'lunar', every: 2 } } as never });
    await d.moduleRecords.add({ id: a.id + 1, module: MODULE, kind: 'cycle', data: { ...FUTURE_CYCLE, obligationId: a.id }, createdAt: 5, updatedAt: 5, deletedAt: null } as never);
    await d.accounts.add({ name: 'Example Checking', kind: 'checking', openingBalanceCents: 5000, openingDate: '2026-01-01' } as never);
    return { a: a.id, b: b.id, c: c.id };
  }
  const strip = (rows: unknown[]) => rows.map((r) => { const { updatedAt: _u, ...rest } = r as Record<string, unknown>; return rest; }).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));

  it('every Bills record, including future fields, an unreadable value and a later-phase record, comes back exactly; Finance is untouched', async () => {
    const src = fresh();
    await household(src);
    const dst = fresh();
    await dst.open();
    const file = checkBackupText(JSON.stringify(await buildBackup(src))).file;
    await restoreChecked(dst, file, { getItem: () => null, setItem: () => undefined, removeItem: () => undefined } as never);
    expect(strip(await bills(dst))).toEqual(strip(await bills(src)));
    expect(strip(await dst.contacts.toArray())).toEqual(strip(await src.contacts.toArray()));
    expect(await financeSnapshot(dst, false)).toBe(await financeSnapshot(src, false)); // a restore re-stamps rows as changed now; every other field is identical
    const back = (await loadObligations(dst)).find((r) => r.data.title === 'Streamly Premium')!;
    expect(back.data.review).toEqual({ on: true, note: 'check use', since: TODAY });
    expect(Object.keys(back.data.rawKept)).toEqual(['schedule']);
    expect(((await dst.moduleRecords.get(back.id))!.data as Record<string, unknown>).futureField).toEqual({ deep: [1, { two: 2 }] });
  });
  it('restoring twice changes nothing the second time', async () => {
    const src = fresh();
    await household(src);
    const dst = fresh();
    await dst.open();
    const file = checkBackupText(JSON.stringify(await buildBackup(src))).file;
    const mem = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined } as never;
    await restoreChecked(dst, file, mem);
    const once = strip(await bills(dst));
    await restoreChecked(dst, file, mem);
    expect(strip(await bills(dst))).toEqual(once);
  });
  it('the plain export/import functions round trip too, and a restore replaces (it does not add to) what was there', async () => {
    const src = fresh();
    await household(src);
    const dst = fresh();
    await dst.open();
    await createObligation({ data: ob({ title: 'Will be replaced' }, TODAY), provider: null }, dst);
    await importAll(dst, await exportAll(src));
    expect((await loadObligations(dst)).map((r) => r.data.title).sort()).toEqual(['Example Power Co', 'Old gym', 'Streamly Premium']);
  });
  it('the backup summary names Bills records and counts them; nothing falls into the catch-all; no names or amounts appear', async () => {
    const src = fresh();
    await household(src);
    const groups = summarizeBackup(await exportAll(src));
    const g = groups.find((x) => x.id === 'bills')!;
    expect(g.label).toBe('Bills & Subscriptions');
    expect(g.items).toEqual([{ label: 'Bills and subscriptions', n: 3 }, { label: 'Billing-period records', n: 1 }]);
    expect(groups.find((x) => x.id === 'other')).toBeUndefined();
    const json = JSON.stringify(groups);
    for (const secret of ['Streamly', 'Example Power', '1549', '9000', 'check use']) expect(json).not.toContain(secret);
  });
  it('a module this version does not name still travels and is counted under "other application data" (what an older build shows for bills rows)', async () => {
    const src = fresh();
    await src.moduleRecords.add({ id: 1, module: 'bills-from-the-future', kind: 'obligation', data: { title: 'x' }, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    const file = await exportAll(src);
    expect(summarizeBackup(file).find((x) => x.id === 'other')!.items[0]).toEqual({ label: 'bills-from-the-future records', n: 1 });
    const dst = fresh();
    await dst.open();
    await importAll(dst, file);
    expect(strip(await dst.moduleRecords.toArray())).toEqual(strip(await src.moduleRecords.toArray()));
  });
  it('a restored bill keeps its provider Contact link, and its dates are identical before and after', async () => {
    const src = fresh();
    const ids = await household(src);
    const dst = fresh();
    await dst.open();
    await importAll(dst, await exportAll(src));
    const a = (await getObligation(ids.b, src))!; const b = (await getObligation(ids.b, dst))!;
    expect(b.data.providerContactId).toBe(a.data.providerContactId);
    expect((await createStore(dst).shared.contacts.get(b.data.providerContactId!))!.name).toBe('Example Power');
    expect(b.data.pauses).toEqual(a.data.pauses);
  });
});

export type { Dev };
