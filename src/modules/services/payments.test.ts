import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { installTracking } from '../../lib/sync/track';
import { loadTxnMap, lookupOfMap } from '../../lib/txnLookup';
import { makeTxnRef } from '../../lib/txnRef';
import { createAsset } from '../assets/data';
import { blankAsset } from '../assets/model';
import { assetSpend, costRecords } from '../assets/spending';
import { createService, loadServices } from '../assets/serviceData';
import { blankService } from '../assets/service';
import { loadAssets } from '../assets/data';
import { createArrangement, loadArrangements, tasksOfArrangement } from './data';
import { blankArrangement, type Cadence } from './model';
import { expectedWindow, scheduleStateOf, type ScheduleState } from './expectedCharges';
import { droppedBySwitch, setArrangementPayments, setVisitPayment } from './payments';
import { forArrangement, forProvider, payRecords, servicesSpend, typicalCost, visitPayment, visitReview, providerKeyOf } from './servicesSpend';
import { loadVisits, logStandaloneVisit, updateVisit, type VisitInput } from './visits';
import { visitStats, type VisitRecord } from './visitModel';
import type { Txn } from '../../types';

/** Invented data only. 2026-11-06 is a Friday. Each test gets its own database. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-pay-${n++}`); installTracking(d); return d; };
const TODAY = '2026-11-06';
const weekly: Cadence = { mode: 'fixed', rule: { freq: 'weekly', interval: 1, end: { type: 'never' } }, anchorDate: TODAY };
const addTxn = async (d: FinanceDB, amountCents: number, over: Partial<Txn> = {}) =>
  d.txns.add({ accountId: 1, date: '2026-11-01', amountCents, payee: 'Pat Pools', memo: '', status: 'cleared', categoryId: 5, ...over } as Txn);
const live = async (d: FinanceDB, id: number) => (await d.txns.get(id))!;
const ref = async (d: FinanceDB, id: number, split?: number) => makeTxnRef(await live(d, id), split);
const arr = async (d: FinanceDB, over = {}, name = 'Pat Pools') => (await createArrangement({ data: blankArrangement({ title: 'Pool service', cadence: null, ...over }), provider: { name }, today: TODAY }, d)).id;
async function visit(d: FinanceDB, arrangementId: number | null, over: Partial<VisitInput> = {}, name = 'Pat Pools') {
  const input: VisitInput = { status: 'completed', cancelledBy: null, date: '2026-11-01', title: 'Pool service', chargedCents: null, chargeKind: null, ...over };
  return (await logStandaloneVisit({ arrangementId, provider: arrangementId === null ? { name } : null, input, today: TODAY }, d)).visitId;
}
const pay = (d: FinanceDB, visitId: number, refs: Awaited<ReturnType<typeof ref>>[], over = {}) => setVisitPayment(visitId, { source: 'finance', refs, manualCents: null, confirmSwitch: true, ...over }, null, d);
const manual = (d: FinanceDB, visitId: number, cents: number) => setVisitPayment(visitId, { source: 'manual', refs: [], manualCents: cents, confirmSwitch: true }, null, d);
async function calc(d: FinanceDB) {
  const [arrangements, visits] = await Promise.all([loadArrangements(d), loadVisits(d)]);
  const all = payRecords(arrangements, visits);
  const map = await loadTxnMap(all.flatMap((r) => r.refs), d);
  const lookup = lookupOfMap(map);
  return { arrangements, visits, all, lookup, spend: (rs = all, period?: { from?: string; to?: string }) => servicesSpend(rs, lookup, period) };
}
const byId = (visits: VisitRecord[], id: number) => visits.find((v) => v.id === id)!;
const financeSnap = async (d: FinanceDB) => JSON.stringify([await d.accounts.toArray(), await d.txns.toArray(), await d.categories.toArray(), await d.assignments.toArray(), await d.recurring.toArray(), await d.goals.toArray(), await d.moduleRecords.where('module').equals('projects').toArray()]);

describe('S3-B matrix 1-4: one payment, Home & Assets, Projects, retainer', () => {
  it('1. a completed visit with one linked Finance transaction counts once, as paid for a completed visit', async () => {
    const d = fresh();
    const a = await arr(d), t = await addTxn(d, -15000);
    const v = await visit(d, a);
    await pay(d, v, [await ref(d, t)]);
    const c = await calc(d);
    const s = c.spend();
    expect(s.totalCents).toBe(15000);
    expect(s.byClass).toEqual({ completed: 15000, fees: 0, other: 0, shared: 0 });
    expect(visitPayment(byId(c.visits, v), c.all, c.lookup)).toMatchObject({ source: 'finance', paidCents: 15000, sharedWith: 0 });
  });
  it('2. the same Finance piece in a Home & Assets service record: each module counts it once; the two totals are never summed', async () => {
    const d = fresh();
    const a = await arr(d), t = await addTxn(d, -12000);
    const v = await visit(d, a);
    await pay(d, v, [await ref(d, t)]);
    const asset = await createAsset(blankAsset({ name: 'Pool pump' }), d);
    await createService(blankService(asset, { title: 'Service', date: '2026-11-01', kind: 'maintenance', txnRefs: [await ref(d, t)] }), d, TODAY);
    const [assets, services] = await Promise.all([loadAssets(d), loadServices(d)]);
    const lookup = lookupOfMap(await loadTxnMap(costRecords(assets, services).flatMap((r) => r.refs), d));
    expect(assetSpend(assets, services, asset, lookup).own.totalCents).toBe(12000);
    expect((await calc(d)).spend().totalCents).toBe(12000); // not 24000
  });
  it('3. a payment also attributed to a Project is explained, never added; Projects records are untouched', async () => {
    const d = fresh();
    const a = await arr(d), t = await addTxn(d, -9000, { project: { projectId: 77 } });
    const v = await visit(d, a);
    const before = await financeSnap(d);
    await pay(d, v, [await ref(d, t)]);
    const c = await calc(d);
    const notes = visitReview(byId(c.visits, v), c.all, c.lookup, undefined, (id) => (id === 77 ? 'Patio rebuild' : undefined));
    expect(notes.find((x) => x.kind === 'project')?.text).toMatch(/also attributed to the project "Patio rebuild".*not added/);
    expect(c.spend().totalCents).toBe(9000); // Services money only; no project money added
    expect(await financeSnap(d)).toBe(before);
  });
  it('4. a monthly retainer is linked on the arrangement, not divided among visits, and kept apart from visit payments', async () => {
    const d = fresh();
    const a = await arr(d, { cadence: weekly });
    const t1 = await addTxn(d, -20000, { date: '2026-10-01' }), t2 = await addTxn(d, -20000, { date: '2026-11-01' });
    const v = await visit(d, a);
    await setArrangementPayments(a, [await ref(d, t1), await ref(d, t2)], null, d);
    const c = await calc(d);
    const s = c.spend(forArrangement(c.all, a));
    expect(s.totalCents).toBe(40000);
    expect(s.byClass.other).toBe(40000);
    expect(visitPayment(byId(c.visits, v), c.all, c.lookup)).toMatchObject({ source: 'none', paidCents: null });
    expect(c.all.filter((r) => r.level === 'arrangement')).toHaveLength(1);
  });
  it('4b. one payment cannot sit on both the arrangement and one of its visits (either order)', async () => {
    const d = fresh();
    const a = await arr(d), t = await addTxn(d, -20000);
    const v = await visit(d, a);
    await setArrangementPayments(a, [await ref(d, t)], null, d);
    await expect(pay(d, v, [await ref(d, t)])).rejects.toThrow(/already linked on the arrangement/);
    await setArrangementPayments(a, [], null, d);
    await pay(d, v, [await ref(d, t)]);
    await expect(setArrangementPayments(a, [await ref(d, t)], null, d)).rejects.toThrow(/already linked on a visit/);
  });
});

describe('S3-B matrix 5-11: shared, deposits, refunds, providers, splits, fees, typed', () => {
  it('5. one invoice linked on three visits: counted once at arrangement, provider and module level; shown as shared on each visit; not divided', async () => {
    const d = fresh();
    const a = await arr(d), t = await addTxn(d, -30000);
    const vs = [await visit(d, a, { date: '2026-10-05' }), await visit(d, a, { date: '2026-10-12' }), await visit(d, a, { date: '2026-10-19' })];
    for (const v of vs) await pay(d, v, [await ref(d, t)]);
    const c = await calc(d);
    expect(c.spend().totalCents).toBe(30000);
    expect(c.spend(forArrangement(c.all, a)).totalCents).toBe(30000);
    expect(c.spend(forProvider(c.all, providerKeyOf(c.visits[0].data.providerContactId, ''))).totalCents).toBe(30000);
    expect(c.spend().summary.sharedPieces).toHaveLength(1);
    for (const v of vs) {
      const p = visitPayment(byId(c.visits, v), c.all, c.lookup);
      expect(p.sharedWith).toBe(2);
      expect(visitReview(byId(c.visits, v), c.all, c.lookup).map((x) => x.kind)).toContain('shared');
    }
  });
  it('6. deposit plus final payment on one visit: the two pieces add', async () => {
    const d = fresh();
    const a = await arr(d), t1 = await addTxn(d, -5000, { date: '2026-10-20' }), t2 = await addTxn(d, -7500);
    const v = await visit(d, a);
    await pay(d, v, [await ref(d, t1), await ref(d, t2)]);
    expect((await calc(d)).spend().totalCents).toBe(12500);
  });
  it('7. a refund lowers spending (and the sign is right); a refund on a cancellation fee lowers the fees line, not services', async () => {
    const d = fresh();
    const a = await arr(d), t = await addTxn(d, -10000), r = await addTxn(d, 3000, { payee: 'Pat Pools refund' });
    const v = await visit(d, a), f = await visit(d, a, { status: 'cancelled', cancelledBy: 'household', date: '2026-11-02', chargedCents: 4000, chargeKind: 'cancellationFee' });
    await pay(d, v, [await ref(d, t), await ref(d, r)]);
    const c = await calc(d);
    expect(c.spend().totalCents).toBe(7000);
    const tf = await addTxn(d, -4000, { date: '2026-11-03' }), rf = await addTxn(d, 1000, { date: '2026-11-04' });
    await pay(d, f, [await ref(d, tf), await ref(d, rf)]);
    const c2 = await calc(d);
    expect(c2.spend().byClass).toEqual({ completed: 7000, fees: 3000, other: 0, shared: 0 });
  });
  it('8. the same provider on several assets: the provider total sums its arrangements; a payment shared by both counts once', async () => {
    const d = fresh();
    const a1 = await arr(d, { title: 'Main house pool' }), a2 = await arr(d, { title: 'Cabin pool' });
    const c0 = await calc(d);
    expect(c0.arrangements).toHaveLength(2);
    const t1 = await addTxn(d, -10000), t2 = await addTxn(d, -6000), tShared = await addTxn(d, -4000);
    const v1 = await visit(d, a1), v2 = await visit(d, a2);
    await pay(d, v1, [await ref(d, t1), await ref(d, tShared)]);
    await pay(d, v2, [await ref(d, t2), await ref(d, tShared)]);
    const c = await calc(d);
    const key = c.all[0].providerKey;
    expect(c.arrangements.map((x) => x.data.providerContactId).filter((x, i, l) => l.indexOf(x) === i)).toHaveLength(1); // one contact, found not duplicated
    expect(c.spend(forProvider(c.all, key)).totalCents).toBe(20000); // 10000 + 6000 + 4000 once
    expect(c.spend(forArrangement(c.all, a1)).totalCents + c.spend(forArrangement(c.all, a2)).totalCents).toBe(24000); // per-record views may exceed: the shared piece shows in both
  });
  it('9. a split transaction covering different services: each visit uses only its own part', async () => {
    const d = fresh();
    const a = await arr(d);
    const t = await addTxn(d, -30000, { categoryId: null, splits: [{ categoryId: 5, amountCents: -12000 }, { categoryId: 6, amountCents: -18000 }] });
    const v1 = await visit(d, a, { date: '2026-10-20' }), v2 = await visit(d, a, { date: '2026-10-27' });
    await pay(d, v1, [await ref(d, t, 0)]);
    await pay(d, v2, [await ref(d, t, 1)]);
    const c = await calc(d);
    expect(visitPayment(byId(c.visits, v1), c.all, c.lookup).paidCents).toBe(12000);
    expect(visitPayment(byId(c.visits, v2), c.all, c.lookup).paidCents).toBe(18000);
    expect(c.spend().totalCents).toBe(30000);
    expect(visitPayment(byId(c.visits, v1), c.all, c.lookup).sharedWith).toBe(0); // different parts are not shared
  });
  it('10. a cancellation fee charged and later paid: counted once as a fee, never as service, never in the typical price', async () => {
    const d = fresh();
    const a = await arr(d), t = await addTxn(d, -4000);
    const f = await visit(d, a, { status: 'cancelled', cancelledBy: 'household', chargedCents: 4000, chargeKind: 'cancellationFee' });
    const before = await calc(d);
    expect(before.spend().totalCents).toBe(0); // charged is NOT paid
    await pay(d, f, [await ref(d, t)]);
    const c = await calc(d);
    expect(c.spend().byClass).toEqual({ completed: 0, fees: 4000, other: 0, shared: 0 });
    expect(byId(c.visits, f).data.status).toBe('cancelled'); // a payment never rewrites the status
    expect(visitStats(c.visits)).toMatchObject({ completed: 0, cancelled: 1, lastServiced: null });
    expect(typicalCost(c.visits, c.all, c.lookup).sample).toBe(0);
    expect(visitReview(byId(c.visits, f), c.all, c.lookup).map((x) => x.kind)).not.toContain('difference');
  });
  it('11. a payment outside Finance is typed cents, counted as typed, and never merged with a Finance piece of the same amount', async () => {
    const d = fresh();
    const a = await arr(d), t = await addTxn(d, -5000);
    const v1 = await visit(d, a, { date: '2026-10-05' }), v2 = await visit(d, a, { date: '2026-10-12' });
    await manual(d, v1, 5000);
    await pay(d, v2, [await ref(d, t)]);
    const s = (await calc(d)).spend();
    expect(s).toMatchObject({ totalCents: 10000, manualCents: 5000, financeCents: 5000 });
    // whole cents, no floating point: 1999 + 1 typed cents
    const v3 = await visit(d, a, { date: '2026-10-19' });
    await manual(d, v3, 1999);
    expect((await calc(d)).spend().manualCents).toBe(6999);
    await expect(manual(d, v3, 10.5)).rejects.toThrow(/whole number of cents/);
    await expect(manual(d, v3, -1)).rejects.toThrow(/cannot be negative/);
  });
});

describe('S3-B matrix 12-18: bad references, overlaps, transfers, skipped, no payment', () => {
  it('12. a Finance transaction that is later deleted needs review, counts 0 and is never replaced by another', async () => {
    const d = fresh();
    const a = await arr(d), t = await addTxn(d, -8000), other = await addTxn(d, -8000, { payee: 'Someone else' });
    const v = await visit(d, a);
    await pay(d, v, [await ref(d, t)]);
    await d.txns.delete(t);
    const c = await calc(d);
    expect(c.spend().totalCents).toBe(0);
    expect(c.spend().summary.review).toHaveLength(1);
    const p = visitPayment(byId(c.visits, v), c.all, c.lookup);
    expect(p.needsReview).toHaveLength(1);
    expect(p.paidCents).toBe(0);
    expect(visitReview(byId(c.visits, v), c.all, c.lookup).map((x) => x.kind)).toContain('missing');
    expect(other).toBeGreaterThan(0);
    expect(byId(c.visits, v).data.txnRefs.map((r) => r.txnId)).toEqual([t]); // not silently swapped
  });
  it('13/15. a changed split fingerprint, and a reordered split, count 0 and ask to be picked again', async () => {
    const d = fresh();
    const a = await arr(d);
    const t = await addTxn(d, -30000, { categoryId: null, splits: [{ categoryId: 5, amountCents: -12000 }, { categoryId: 6, amountCents: -18000 }] });
    const v = await visit(d, a);
    await pay(d, v, [await ref(d, t, 0)]);
    await d.txns.update(t, { splits: [{ categoryId: 6, amountCents: -18000 }, { categoryId: 5, amountCents: -12000 }] }); // reordered
    let c = await calc(d);
    expect(c.spend().totalCents).toBe(0);
    expect(visitReview(byId(c.visits, v), c.all, c.lookup).map((x) => x.kind)).toContain('split');
    await d.txns.update(t, { splits: [{ categoryId: 5, amountCents: -12000 }, { categoryId: 6, amountCents: -18000 }] }); // back
    expect((await calc(d)).spend().totalCents).toBe(12000);
    await d.txns.update(t, { splits: [{ categoryId: 5, amountCents: -11000 }, { categoryId: 6, amountCents: -19000 }] }); // changed amount
    c = await calc(d);
    expect(c.spend().totalCents).toBe(0);
  });
  it('14. a whole transaction and one of its parts on different visits: the whole counts, the part is covered, and it says so', async () => {
    const d = fresh();
    const a = await arr(d);
    const t = await addTxn(d, -30000, { categoryId: null, splits: [{ categoryId: 5, amountCents: -12000 }, { categoryId: 6, amountCents: -18000 }] });
    const v1 = await visit(d, a, { date: '2026-10-20' }), v2 = await visit(d, a, { date: '2026-10-27' });
    await pay(d, v1, [await ref(d, t, 0)]);
    await pay(d, v2, [await ref(d, t)]);
    const c = await calc(d);
    expect(c.spend().totalCents).toBe(30000);
    expect(c.spend().summary.coveredParts).toHaveLength(1);
    expect(visitReview(byId(c.visits, v1), c.all, c.lookup).map((x) => x.kind)).toContain('overlap');
    await expect(pay(d, v1, [await ref(d, t, 0), await ref(d, t)])).rejects.toThrow(/whole transaction and also one of its parts/);
  });
  it('16. a transfer or setup entry cannot be linked, and one that becomes a transfer later counts 0', async () => {
    const d = fresh();
    const a = await arr(d);
    const tr = await addTxn(d, -5000, { transferTxnId: 99 });
    const ok = await addTxn(d, -5000);
    const v = await visit(d, a);
    await expect(pay(d, v, [await ref(d, tr)])).rejects.toThrow(/transfer or setup/);
    await pay(d, v, [await ref(d, ok)]);
    await d.txns.update(ok, { transferTxnId: 98 });
    const c = await calc(d);
    expect(c.spend().totalCents).toBe(0);
    expect(c.spend().summary.review[0].resolved.state).toBe('not-spending');
  });
  it('17. a payment linked to a skipped visit is a fee-class payment and the visit stays skipped', async () => {
    const d = fresh();
    const a = await arr(d), t = await addTxn(d, -2000);
    const v = await visit(d, a, { status: 'skipped', date: '2026-11-03' });
    await pay(d, v, [await ref(d, t)]);
    const c = await calc(d);
    expect(c.spend().byClass.fees).toBe(2000);
    expect(byId(c.visits, v).data.status).toBe('skipped');
    expect(visitStats(c.visits).completed).toBe(0);
  });
  it('18. a completed visit with no payment says "no payment recorded" in data (source none), counts nothing, and is never "unpaid"', async () => {
    const d = fresh();
    const a = await arr(d);
    const v = await visit(d, a, { chargedCents: 15000, chargeKind: 'service' });
    const c = await calc(d);
    expect(visitPayment(byId(c.visits, v), c.all, c.lookup)).toMatchObject({ source: 'none', paidCents: null });
    expect(c.spend().totalCents).toBe(0);
    expect(visitReview(byId(c.visits, v), c.all, c.lookup)).toEqual([]);
    const raw = JSON.stringify((await d.moduleRecords.get(v))!.data);
    expect(raw).not.toMatch(/unpaid/i);
    expect(raw).not.toMatch(/txnRefs|paidManual/); // stored exactly as before S3
  });
});

describe('S3-B matrix 19-20 and the safeguards', () => {
  it('19. switching between Finance and outside-Finance needs confirmation naming what is removed; nothing is deleted silently; status and unknown fields stay', async () => {
    const d = fresh();
    const a = await arr(d), t = await addTxn(d, -5000);
    const v = await visit(d, a);
    await d.moduleRecords.update(v, { 'data.futureField': { keep: 1 } });
    await manual(d, v, 4500);
    await expect(setVisitPayment(v, { source: 'finance', refs: [await ref(d, t)], manualCents: null }, null, d)).rejects.toThrow(/removes the amount paid outside Finance \(\$45\.00\)/);
    expect(byId(await loadVisits(d), v).data.paidManualCents).toBe(4500); // untouched by the refusal
    await setVisitPayment(v, { source: 'finance', refs: [await ref(d, t)], manualCents: null, confirmSwitch: true }, null, d);
    let x = byId(await loadVisits(d), v);
    expect(x.data).toMatchObject({ payment: 'finance', paidManualCents: null });
    await expect(setVisitPayment(v, { source: 'manual', refs: [], manualCents: 5000 }, null, d)).rejects.toThrow(/removes the link to 1 Finance transaction/);
    await setVisitPayment(v, { source: 'manual', refs: [], manualCents: 5000, confirmSwitch: true }, null, d);
    x = byId(await loadVisits(d), v);
    expect(x.data).toMatchObject({ payment: 'manual', paidManualCents: 5000, txnRefs: [], status: 'completed' });
    await expect(setVisitPayment(v, { source: 'none', refs: [], manualCents: null }, null, d)).rejects.toThrow(/removes the amount paid outside Finance/);
    await setVisitPayment(v, { source: 'none', refs: [], manualCents: null, confirmSwitch: true }, null, d);
    expect((await d.moduleRecords.get(v))!.data).not.toHaveProperty('paidManualCents');
    expect((await d.moduleRecords.get(v))!.data).toMatchObject({ futureField: { keep: 1 } });
    expect(droppedBySwitch({ txnRefs: [], paidManualCents: null }, { source: 'manual' })).toBeNull();
  });
  it('19b. a record that arrives with both sources uses the references and is flagged; a stale save is refused', async () => {
    const d = fresh();
    const a = await arr(d), t = await addTxn(d, -5000);
    const v = await visit(d, a);
    await d.moduleRecords.update(v, { 'data.txnRefs': [await ref(d, t)], 'data.paidManualCents': 9999 });
    const c = await calc(d);
    expect(c.spend().totalCents).toBe(5000);
    expect(c.spend().conflicts).toEqual([`visit:${v}`]);
    expect(visitReview(byId(c.visits, v), c.all, c.lookup).map((x) => x.kind)).toContain('conflict');
    const v0 = byId(await loadVisits(d), v);
    await d.moduleRecords.update(v, { 'data.notes': 'changed elsewhere' });
    // the record changed after it was opened: the save is refused rather than overwriting
    await expect(setVisitPayment(v, { source: 'none', refs: [], manualCents: null, confirmSwitch: true }, v0.updatedAt, d)).rejects.toThrow(/was changed/);
    await setVisitPayment(v, { source: 'none', refs: [], manualCents: null, confirmSwitch: true }, byId(await loadVisits(d), v).updatedAt, d);
    expect(byId(await loadVisits(d), v).data.payment).toBe('none');
  });
  it('20. period boundaries: a piece counts by its own Finance date, a typed amount by the visit date; both ends are inclusive', async () => {
    const d = fresh();
    const a = await arr(d);
    const dates = ['2026-10-31', '2026-11-01', '2026-11-30', '2026-12-01'];
    for (const [i, date] of dates.entries()) { const t = await addTxn(d, -1000 * (i + 1), { date }); const v = await visit(d, a, { date: '2026-10-01' }); await pay(d, v, [await ref(d, t)]); }
    const vm = await visit(d, a, { status: 'skipped', date: '2026-11-30' }); await manual(d, vm, 500);
    const vm2 = await visit(d, a, { status: 'skipped', date: '2026-12-01' }); await manual(d, vm2, 700);
    const c = await calc(d);
    expect(c.spend(c.all, { from: '2026-11-01', to: '2026-11-30' }).totalCents).toBe(2000 + 3000 + 500);
    expect(c.spend(c.all, { from: '2026-12-01' }).totalCents).toBe(4000 + 700);
    expect(c.spend(c.all, { to: '2026-10-31' }).totalCents).toBe(1000);
    expect(c.spend().totalCents).toBe(1000 + 2000 + 3000 + 4000 + 500 + 700);
  });
  it('Finance tables are unchanged by linking, switching, reading and totals', async () => {
    const d = fresh();
    const a = await arr(d), t = await addTxn(d, -5000, { project: { projectId: 3 } });
    const before = await financeSnap(d);
    const v = await visit(d, a);
    await pay(d, v, [await ref(d, t)]);
    await setArrangementPayments(a, [], null, d);
    await manual(d, v, 100);
    const c = await calc(d); c.spend(); visitReview(byId(c.visits, v), c.all, c.lookup);
    expect(await financeSnap(d)).toBe(before);
  });
  it('payments on a visit that this version cannot read are refused; editing a visit never changes its payment', async () => {
    const d = fresh();
    const a = await arr(d), t = await addTxn(d, -5000);
    const v = await visit(d, a);
    await pay(d, v, [await ref(d, t)]);
    const v0 = byId(await loadVisits(d), v);
    await updateVisit(v, { title: 'Renamed', status: 'completed', cancelledBy: null, date: '2026-11-01', endDate: null, notes: 'x', chargedCents: 5000, chargeKind: 'service', refs: [], assetIds: [] }, TODAY, v0.updatedAt, d);
    expect(byId(await loadVisits(d), v).data.txnRefs).toHaveLength(1);
    await d.moduleRecords.update(v, { 'data.status': 'rescheduled' });
    await expect(manual(d, v, 100)).rejects.toThrow(/does not understand/);
  });
  it('a charge never counts as a payment and an expected amount never counts as spending', async () => {
    const d = fresh();
    const a = await arr(d, { expected: { basis: 'perVisit', cents: 9000 } });
    await visit(d, a, { chargedCents: 9000, chargeKind: 'service' });
    expect((await calc(d)).spend().totalCents).toBe(0);
  });
});

describe('S3-B typical cost, reconciliation wording, expected charges', () => {
  it('typical cost is the MEDIAN of reliable, unshared, completed-visit payments; the sample size is reported; shared, broken, refund-only and unpaid visits are left out', async () => {
    const d = fresh();
    const a = await arr(d);
    const amounts = [10000, 12000, 20000, 11000];
    for (const [i, cents] of amounts.entries()) { const t = await addTxn(d, -cents); const v = await visit(d, a, { date: `2026-10-0${i + 1}` }); await pay(d, v, [await ref(d, t)]); }
    const c = await calc(d);
    const k = typicalCost(c.visits, c.all, c.lookup);
    expect(k).toMatchObject({ medianCents: 11500, sample: 4, fromFinance: 4, enough: true }); // (11000 + 12000) / 2
    // more visits that must NOT count
    const sh = await addTxn(d, -99999); const s1 = await visit(d, a, { date: '2026-10-10' }), s2 = await visit(d, a, { date: '2026-10-11' }); await pay(d, s1, [await ref(d, sh)]); await pay(d, s2, [await ref(d, sh)]);
    const gone = await addTxn(d, -88888); const g = await visit(d, a, { date: '2026-10-12' }); await pay(d, g, [await ref(d, gone)]); await d.txns.delete(gone);
    await visit(d, a, { date: '2026-10-13' }); // no payment
    const fee = await addTxn(d, -4000); const f = await visit(d, a, { status: 'cancelled', cancelledBy: 'provider', date: '2026-10-14' }); await pay(d, f, [await ref(d, fee)]);
    const c2 = await calc(d);
    const k2 = typicalCost(c2.visits, c2.all, c2.lookup);
    expect(k2.medianCents).toBe(11500);
    expect(k2).toMatchObject({ sample: 4, excluded: { shared: 2, unreliable: 1, noPayment: 1, notPositive: 0 } });
  });
  it('fewer than three reliable visits gives no typical price (not presented as authoritative); an odd sample takes the middle value', async () => {
    const d = fresh();
    const a = await arr(d);
    for (const [i, cents] of [10000, 30000].entries()) { const t = await addTxn(d, -cents); await pay(d, await visit(d, a, { date: `2026-10-0${i + 1}` }), [await ref(d, t)]); }
    let c = await calc(d);
    expect(typicalCost(c.visits, c.all, c.lookup)).toMatchObject({ medianCents: null, sample: 2, enough: false });
    const t = await addTxn(d, -20000); await manual(d, await visit(d, a, { date: '2026-10-03' }), 20000);
    c = await calc(d);
    expect(typicalCost(c.visits, c.all, c.lookup)).toMatchObject({ medianCents: 20000, sample: 3, typed: 1, fromFinance: 2 });
    expect(t).toBeGreaterThan(0);
  });
  it('a charge that differs from the payment is information in neutral words; equal amounts give no note; never "unpaid" or "error"', async () => {
    const d = fresh();
    const a = await arr(d), t = await addTxn(d, -12500), t2 = await addTxn(d, -15000);
    const v = await visit(d, a, { chargedCents: 15000, chargeKind: 'service' }), w = await visit(d, a, { date: '2026-10-01', chargedCents: 15000, chargeKind: 'service' });
    await pay(d, v, [await ref(d, t)]); await pay(d, w, [await ref(d, t2)]);
    const c = await calc(d);
    const note = visitReview(byId(c.visits, v), c.all, c.lookup).find((x) => x.kind === 'difference')!;
    expect(note.text).toBe('Charged $150.00; linked payment $125.00. Review the difference. It may be perfectly fine.');
    expect(note.text).not.toMatch(/unpaid|error|fraud|overcharge/i);
    expect(visitReview(byId(c.visits, w), c.all, c.lookup)).toEqual([]);
  });
  it('expected charges: per-visit estimates use the real cadence dates (every 2 weeks, twice a month); other bases are NOT multiplied or prorated', async () => {
    const d = fresh();
    const biweekly: Cadence = { mode: 'fixed', rule: { freq: 'weekly', interval: 2, byWeekday: [5], end: { type: 'never' } }, anchorDate: TODAY };
    const semi: Cadence = { mode: 'fixed', rule: { freq: 'monthly', interval: 1, monthly: 'date', end: { type: 'never' } }, anchorDate: '2026-11-15', semi: { a: { kind: 'day', day: 15, adjust: 'none' }, b: { kind: 'lastBusinessDay' } } };
    const a1 = await arr(d, { title: 'Pool', cadence: biweekly, expected: { basis: 'perVisit', cents: 8000 } });
    const a2 = await arr(d, { title: 'Lawn', cadence: semi, expected: { basis: 'perVisit', cents: 5000 } });
    const a3 = await arr(d, { title: 'Cleaning', cadence: weekly, expected: { basis: 'perMonth', cents: 30000 } });
    const a4 = await arr(d, { title: 'Roof', cadence: null, expected: { basis: 'quote', cents: 900000 } });
    const a5 = await arr(d, { title: 'On demand', cadence: null, expected: { basis: 'perVisit', cents: 100 } });
    const arrangements = await loadArrangements(d);
    const openDue = new Map<number, ScheduleState>();
    for (const a of arrangements) openDue.set(a.id, scheduleStateOf(await tasksOfArrangement(a.id, d)));
    const w30 = expectedWindow(arrangements, openDue, TODAY, 30); // 6 Nov .. 6 Dec
    expect(w30.items.find((x) => x.arrangementId === a1)).toMatchObject({ visits: 3, cents: 24000 }); // 6 Nov, 20 Nov, 4 Dec
    expect(w30.items.find((x) => x.arrangementId === a2)).toMatchObject({ visits: 2, cents: 10000 }); // 15 Nov and 30 Nov; 15 Dec is outside the window (to 6 Dec)
    expect(w30.estimateCents).toBe(w30.items.reduce((t, x) => t + x.cents, 0));
    expect(w30.notConverted.map((x) => x.arrangementId).sort()).toEqual([a3, a4, a5].sort());
    expect(w30.notConverted.find((x) => x.arrangementId === a3)!.reason).toMatch(/not converted.*not multiplied/);
    const w90 = expectedWindow(arrangements, openDue, TODAY, 90);
    expect(w90.items.find((x) => x.arrangementId === a1)!.visits).toBe(7); // 6 Nov + 14 days x 6 = 29 Jan .. 6 Feb is day 92: 7 visits
    expect(w90.items.find((x) => x.arrangementId === a2)!.visits).toBeGreaterThanOrEqual(5);
  });
});
