import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { exportAll, importAll } from '../../lib/backup';
import { checkBackupText } from '../../lib/backupFile';
import { dexieMeta, RemoteConflict, SyncEngine, type RemoteFile, type RemoteStore } from '../../lib/sync/engine';
import { installTracking, touchAll } from '../../lib/sync/track';
import { loadTxnMap, lookupOfMap } from '../../lib/txnLookup';
import { makeTxnRef } from '../../lib/txnRef';
import type { Txn } from '../../types';
import { applyLifecycle, planLifecycle } from './changes';
import { createArrangement, loadArrangements } from './data';
import { blankArrangement } from './model';
import { setArrangementPayments, setVisitPayment } from './payments';
import { forProvider, payRecords, servicesSpend, visitPayment, visitReview } from './servicesSpend';
import { loadVisits, logStandaloneVisit } from './visits';

/** Real SyncEngine and backup with two devices. Invented data only. Whole-record last-writer-wins: nothing here promises a merge the engine cannot do. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-paysync-${n++}`); installTracking(d); return d; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TODAY = '2026-11-06';
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
  const mk = () => { const d = fresh(); return { d, engine: new SyncEngine(d, dexieMeta(`paysync-meta-${n++}`), remote, 'a good passphrase') }; };
  return { A: mk(), B: mk() };
};
type Dev = ReturnType<typeof devices>['A'];
const settle = async (A: Dev, B: Dev) => { for (let i = 0; i < 2; i++) { await A.engine.sync(); await B.engine.sync(); } await A.engine.sync(); };
const addTxn = (d: FinanceDB, amountCents: number, over: Partial<Txn> = {}) => d.txns.add({ accountId: 1, date: '2026-11-01', amountCents, payee: 'Pat Pools', memo: '', status: 'cleared', categoryId: 5, ...over } as Txn) as Promise<number>;
const ref = async (d: FinanceDB, id: number, split?: number) => makeTxnRef((await d.txns.get(id))!, split);
const visitOn = async (d: FinanceDB, arrangementId: number, date: string) =>
  (await logStandaloneVisit({ arrangementId, input: { status: 'completed', cancelledBy: null, date, title: 'Pool service', chargedCents: null, chargeKind: null }, today: TODAY }, d)).visitId;
async function totals(d: FinanceDB) {
  const [arrangements, visits] = await Promise.all([loadArrangements(d), loadVisits(d)]);
  const all = payRecords(arrangements, visits);
  const lookup = lookupOfMap(await loadTxnMap(all.flatMap((r) => r.refs), d));
  return { arrangements, visits, all, lookup, s: servicesSpend(all, lookup) };
}
async function seeded() {
  const { A, B } = devices();
  const r = await createArrangement({ data: blankArrangement({ title: 'Pool service' }), provider: { name: 'Pat Pools' }, today: TODAY }, A.d);
  const t = await addTxn(A.d, -15000);
  const split = await addTxn(A.d, -30000, { categoryId: null, splits: [{ categoryId: 5, amountCents: -12000 }, { categoryId: 6, amountCents: -18000 }] });
  const v1 = await visitOn(A.d, r.id, '2026-10-05'), v2 = await visitOn(A.d, r.id, '2026-10-12');
  await A.engine.initialUpload();
  await B.engine.replaceFromRemote();
  return { A, B, r, t, split, v1, v2 };
}

describe('S3-B two devices (real SyncEngine)', () => {
  it('1. A links a payment; B receives the reference and gets the same total', async () => {
    const { A, B, t, v1 } = await seeded();
    await setVisitPayment(v1, { source: 'finance', refs: [await ref(A.d, t)], manualCents: null }, null, A.d);
    await settle(A, B);
    for (const x of [A, B]) {
      const c = await totals(x.d);
      expect(c.visits.find((v) => v.id === v1)!.data.txnRefs).toHaveLength(1);
      expect(c.s.totalCents).toBe(15000);
    }
  });
  it('2. A edits the payment while B changes the Finance amount: the live Finance amount wins on both and nothing is lost', async () => {
    const { A, B, t, v1 } = await seeded();
    await setVisitPayment(v1, { source: 'finance', refs: [await ref(A.d, t)], manualCents: null }, null, A.d);
    await settle(A, B);
    await sleep(15);
    await setVisitPayment(v1, { source: 'manual', refs: [], manualCents: 100, confirmSwitch: true }, null, A.d);
    await B.d.txns.update(t, { amountCents: -16000 });
    await settle(A, B);
    for (const x of [A, B]) expect((await totals(x.d)).visits.find((v) => v.id === v1)!.data).toMatchObject({ payment: 'manual', paidManualCents: 100 });
    await setVisitPayment(v1, { source: 'finance', refs: [await ref(A.d, t)], manualCents: null, confirmSwitch: true }, null, A.d);
    await settle(A, B);
    for (const x of [A, B]) expect((await totals(x.d)).s.totalCents).toBe(16000);
  });
  it('3. a transaction deleted on B, or its split structure changed, needs review on both devices and counts 0', async () => {
    const { A, B, t, split, v1, v2 } = await seeded();
    await setVisitPayment(v1, { source: 'finance', refs: [await ref(A.d, t)], manualCents: null }, null, A.d);
    await setVisitPayment(v2, { source: 'finance', refs: [await ref(A.d, split, 0)], manualCents: null }, null, A.d);
    await settle(A, B);
    await B.d.txns.delete(t);
    await B.d.txns.update(split, { splits: [{ categoryId: 5, amountCents: -11000 }, { categoryId: 6, amountCents: -19000 }] });
    await settle(A, B);
    for (const x of [A, B]) {
      const c = await totals(x.d);
      expect(c.s.totalCents).toBe(0);
      expect(c.s.summary.review).toHaveLength(2);
      expect(c.visits.find((v) => v.id === v1)!.data.txnRefs).toHaveLength(1); // the reference itself is kept for the owner to fix
    }
  });
  it('4. both devices link the same Finance piece to different visits: both are kept, flagged as shared, counted once', async () => {
    const { A, B, t, v1, v2 } = await seeded();
    await setVisitPayment(v1, { source: 'finance', refs: [await ref(A.d, t)], manualCents: null }, null, A.d);
    await setVisitPayment(v2, { source: 'finance', refs: [await ref(B.d, t)], manualCents: null }, null, B.d);
    await settle(A, B);
    for (const x of [A, B]) {
      const c = await totals(x.d);
      expect(c.s.totalCents).toBe(15000);
      expect(visitPayment(c.visits.find((v) => v.id === v1)!, c.all, c.lookup).sharedWith).toBe(1);
      expect(visitReview(c.visits.find((v) => v.id === v2)!, c.all, c.lookup).map((k) => k.kind)).toContain('shared');
    }
  });
  it('5. a whole transaction on one device and a part of it on the other: the whole counts, the part is covered, on both', async () => {
    const { A, B, split, v1, v2 } = await seeded();
    await setVisitPayment(v1, { source: 'finance', refs: [await ref(A.d, split)], manualCents: null }, null, A.d);
    await setVisitPayment(v2, { source: 'finance', refs: [await ref(B.d, split, 0)], manualCents: null }, null, B.d);
    await settle(A, B);
    for (const x of [A, B]) {
      const c = await totals(x.d);
      expect(c.s.totalCents).toBe(30000);
      expect(c.s.summary.coveredParts).toHaveLength(1);
    }
  });
  it('9. a provider is replaced on A while an older B records a payment on a historical visit: the visit keeps the old provider and the payment', async () => {
    const { A, B, r, t, v1 } = await seeded();
    const p = await planLifecycle(r.id, 'replace', TODAY, A.d);
    await applyLifecycle({ action: 'replace', arrangementId: r.id, expect: p.expect, today: TODAY, replace: { provider: { name: 'Sam Pool Care' } } }, A.d);
    await setVisitPayment(v1, { source: 'finance', refs: [await ref(B.d, t)], manualCents: null }, null, B.d);
    await settle(A, B);
    for (const x of [A, B]) {
      const c = await totals(x.d);
      const v = c.visits.find((y) => y.id === v1)!;
      expect(v.data.providerNameSnapshot).toBe('Pat Pools');
      expect(v.data.txnRefs).toHaveLength(1);
      expect(c.arrangements).toHaveLength(2);
      expect(servicesSpend(forProvider(c.all, c.all[0].providerKey), c.lookup).totalCents).toBe(15000);
      expect(c.arrangements.find((a) => a.id !== r.id)!.data.txnRefs).toEqual([]); // payments never move to the successor
    }
  });
  it('unknown fields on a paid visit and an arrangement-level payment survive sync', async () => {
    const { A, B, r, t, v1 } = await seeded();
    await setVisitPayment(v1, { source: 'finance', refs: [await ref(A.d, t)], manualCents: null }, null, A.d);
    await A.d.moduleRecords.update(v1, { 'data.futureField': { keep: 1 } });
    const t2 = await addTxn(A.d, -20000, { date: '2026-10-01' });
    await setArrangementPayments(r.id, [await ref(A.d, t2)], null, A.d);
    await settle(A, B);
    expect((await B.d.moduleRecords.get(v1))!.data).toMatchObject({ futureField: { keep: 1 }, payment: 'finance' });
    expect((await totals(B.d)).s.totalCents).toBe(35000);
  });
});

describe('S3-B backup and restore (real export, checker and restore)', () => {
  it('10. payments, references, manual amounts, arrangement-level payments and unknown fields come back; nothing is lost, nothing doubled, restoring twice changes nothing', async () => {
    const { A, r, t, split, v1, v2 } = await seeded();
    const v3 = await visitOn(A.d, r.id, '2026-10-19');
    await setVisitPayment(v1, { source: 'finance', refs: [await ref(A.d, t)], manualCents: null }, null, A.d);
    await setVisitPayment(v2, { source: 'finance', refs: [await ref(A.d, split, 0)], manualCents: null }, null, A.d);
    await setVisitPayment(v3, { source: 'manual', refs: [], manualCents: 4250 }, null, A.d);
    const t3 = await addTxn(A.d, -20000, { date: '2026-10-01' });
    await setArrangementPayments(r.id, [await ref(A.d, t3)], null, A.d);
    await A.d.moduleRecords.update(v1, { 'data.futureField': { keep: 1 } });
    const before = await totals(A.d);
    const text = JSON.stringify(await exportAll(A.d));
    const C = fresh();
    await importAll(C, checkBackupText(text).file);
    await importAll(C, checkBackupText(text).file); // twice
    const after = await totals(C);
    expect(after.s.totalCents).toBe(before.s.totalCents);
    expect(after.s.totalCents).toBe(15000 + 12000 + 4250 + 20000);
    expect(after.s.manualCents).toBe(4250);
    expect(after.visits).toHaveLength(3);
    expect(after.visits.find((v) => v.id === v2)!.data.txnRefs).toEqual(before.visits.find((v) => v.id === v2)!.data.txnRefs);
    expect(after.arrangements[0].data.txnRefs).toHaveLength(1);
    expect((await C.moduleRecords.get(v1))!.data).toMatchObject({ futureField: { keep: 1 }, payment: 'finance' });
    for (const v of after.visits) expect(visitPayment(v, after.all, after.lookup).needsReview).toEqual([]); // no reference broken
    await touchAll(C);
    expect((await totals(C)).s.totalCents).toBe(before.s.totalCents);
    expect(await C.txns.count()).toBe(await A.d.txns.count());
  });
});
