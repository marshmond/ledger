import { describe, expect, it, vi } from 'vitest';
import { FinanceDB } from '../../db';
import { createStore } from '../../core/store';
import { buildBackup, checkBackupText, restoreChecked } from '../../lib/backupFile';
import { installTracking } from '../../lib/sync/track';
import { loadTxnMap, lookupOfMap } from '../../lib/txnLookup';
import { makeTxnRef } from '../../lib/txnRef';
import type { Txn } from '../../types';
import { createAsset } from '../assets/data';
import { blankAsset } from '../assets/model';
import { blankService } from '../assets/service';
import { costRecords, spend } from '../assets/spending';
import { createService, getService, loadServices } from '../assets/serviceData';
import { createProject } from '../projects/data';
import { blankProject } from '../projects/model';
import { createArrangement, loadArrangements } from './data';
import { blankArrangement } from './model';
import { setVisitPayment } from './payments';
import { payRecords, servicesSpend } from './servicesSpend';
import { buildPrefill, duplicateHandoffs, handoffDivergence, handoffEligibility, handoffsOfVisit, HandoffExistsError, handoffTargets, RECORDED_AS, saveHandoff, visitsOfServiceRecord } from './handoff';
import { loadAssets } from '../assets/data';
import { loadVisits, logStandaloneVisit } from './visits';
import { loadAssetServices } from './assetLinks';

/** Invented data only. Real Dexie, real shared links, real backup code. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-s4h-${n++}`); installTracking(d); return d; };
const TODAY = '2026-11-06';
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };

const asset = (d: FinanceDB, name = 'Furnace') => createAsset(blankAsset({ name, type: 'system' }), d);
async function visit(d: FinanceDB, over: { arrangementId?: number | null; assetIds?: number[]; status?: 'completed' | 'skipped' | 'cancelled'; charged?: number; notes?: string; title?: string; refs?: { label: string; url?: string }[] } = {}) {
  const status = over.status ?? 'completed';
  return (await logStandaloneVisit({
    arrangementId: over.arrangementId ?? null, provider: over.arrangementId ? undefined : { name: 'Pat Heating' }, assetIds: over.assetIds,
    input: {
      status, cancelledBy: status === 'cancelled' ? 'provider' : null, date: '2026-11-03', title: over.title ?? 'Annual furnace inspection', notes: over.notes ?? '',
      chargedCents: over.charged ?? null, chargeKind: over.charged ? (status === 'cancelled' ? 'cancellationFee' : 'service') : null, refs: over.refs,
    }, today: TODAY,
  }, d)).visitId;
}
const addTxn = (d: FinanceDB, amountCents: number, over: Partial<Txn> = {}) => d.txns.add({ accountId: 1, date: '2026-11-02', amountCents, payee: 'Pat Heating', memo: '', status: 'cleared', categoryId: 5, ...over } as Txn) as Promise<number>;
const ref = async (d: FinanceDB, id: number, split?: number) => makeTxnRef((await d.txns.get(id))!, split);
const svcData = (assetId: number, over = {}) => blankService(assetId, { title: 'Annual furnace inspection', date: '2026-11-03', kind: 'inspection', ...over });
const tables = async (d: FinanceDB) => JSON.stringify([await d.moduleRecords.toArray(), await d.links.toArray()]);
async function ready() {
  const d = fresh();
  const a = await asset(d);
  const v = await visit(d, { assetIds: [a] });
  return { d, a, v };
}

describe('S4-A2 completed visit -> Home & Assets maintenance (handoff)', () => {
  it('1. completed visit -> prefilled form data -> explicit Save -> a service record AND a recorded-as link', async () => {
    const { d, a, v } = await ready();
    const pre = buildPrefill((await loadVisits(d)).find((x) => x.id === v)!);
    expect(pre).toMatchObject({ title: 'Annual furnace inspection', date: '2026-11-03', kind: 'maintenance', visitId: v });
    const r = await saveHandoff({ visitId: v, assetId: a, data: svcData(a, { kind: 'inspection' }), today: TODAY }, d);
    const svc = (await getService(r.serviceId, d))!;
    expect(svc.data).toMatchObject({ assetId: a, title: 'Annual furnace inspection', date: '2026-11-03', kind: 'inspection', taskId: null, projectId: null });
    const links = (await d.links.toArray()).filter((l) => l.type === RECORDED_AS);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ fromModule: 'services', fromId: `visit:${v}`, toModule: 'assets', toId: `service:${r.serviceId}` });
  });
  it('2. cancelling the prefilled form writes nothing (building the prefill and the eligibility check are read-only)', async () => {
    const { d, v } = await ready();
    const before = await tables(d);
    const vis = (await loadVisits(d)).find((x) => x.id === v)!;
    buildPrefill(vis); handoffEligibility(vis); await handoffTargets(vis, d); await handoffsOfVisit(v, d);
    expect(await tables(d)).toBe(before);
    expect(await loadServices(d)).toHaveLength(0);
  });
  it('3. a skipped or cancelled visit is never maintenance, even with a fee charged and paid; the save is refused and writes nothing', async () => {
    const { d, a } = await ready();
    const t = await addTxn(d, -7500);
    const skipped = await visit(d, { assetIds: [a], status: 'skipped', title: 'Skipped service' });
    const cancelled = await visit(d, { assetIds: [a], status: 'cancelled', charged: 7500, title: 'Late cancel' });
    await setVisitPayment(cancelled, { source: 'finance', refs: [await ref(d, t)], manualCents: null }, null, d);
    for (const id of [skipped, cancelled]) {
      expect(handoffEligibility((await loadVisits(d)).find((x) => x.id === id)!).ok).toBe(false);
      const before = await tables(d);
      await expect(saveHandoff({ visitId: id, assetId: a, data: svcData(a), today: TODAY }, d)).rejects.toThrow(/Only a completed visit/);
      expect(await tables(d)).toBe(before);
    }
  });
  it('4. a completed one-off visit with no asset link: the owner explicitly selects an asset; none is guessed', async () => {
    const d = fresh();
    const a = await asset(d, 'Water heater');
    const v = await visit(d, { title: 'Water heater service' }); // a name that matches the asset, but nothing links them
    const vis = (await loadVisits(d)).find((x) => x.id === v)!;
    expect(await handoffTargets(vis, d)).toEqual([]);
    const r = await saveHandoff({ visitId: v, assetId: a, data: svcData(a, { title: 'Water heater service' }), today: TODAY }, d);
    expect((await handoffsOfVisit(v, d))[0].service?.data.assetId).toBe(a);
    expect(r.assetId).toBe(a);
  });
  it('5. a missing or archived asset is refused safely and nothing is written', async () => {
    const { d, v } = await ready();
    const before = await tables(d);
    await expect(saveHandoff({ visitId: v, assetId: 987654321, data: svcData(987654321), today: TODAY }, d)).rejects.toThrow(/no longer exists/);
    const b = await asset(d, 'Old boiler');
    await d.moduleRecords.update(b, { 'data.archived': true } as never);
    const mid = await tables(d);
    await expect(saveHandoff({ visitId: v, assetId: b, data: svcData(b), today: TODAY }, d)).rejects.toThrow(/archived/);
    expect(await tables(d)).toBe(mid);
    expect(before).not.toBe('');
    expect(await loadServices(d)).toHaveLength(0);
    await expect(saveHandoff({ visitId: 123456789, assetId: b, data: svcData(b), today: TODAY }, d)).rejects.toThrow(/visit no longer exists/);
  });
  it('6. an already-recorded visit cannot be recorded again for the same asset (the existing record is named); a different asset is allowed', async () => {
    const { d, a, v } = await ready();
    const first = await saveHandoff({ visitId: v, assetId: a, data: svcData(a), today: TODAY }, d);
    const err = await saveHandoff({ visitId: v, assetId: a, data: svcData(a), today: TODAY }, d).catch((e) => e);
    expect(err).toBeInstanceOf(HandoffExistsError);
    expect((err as HandoffExistsError).serviceId).toBe(first.serviceId);
    expect(await loadServices(d)).toHaveLength(1);
    const other = await asset(d, 'Air conditioner');
    await saveHandoff({ visitId: v, assetId: other, data: svcData(other), today: TODAY }, d);
    expect(await loadServices(d)).toHaveLength(2);
  });
  it('7. two overlapping Save presses make exactly one record and one link', async () => {
    const { d, a, v } = await ready();
    const results = await Promise.allSettled([
      saveHandoff({ visitId: v, assetId: a, data: svcData(a), today: TODAY }, d),
      saveHandoff({ visitId: v, assetId: a, data: svcData(a), today: TODAY }, d),
      saveHandoff({ visitId: v, assetId: a, data: svcData(a), today: TODAY }, d),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected').every((r) => (r as PromiseRejectedResult).reason instanceof HandoffExistsError)).toBe(true);
    expect(await loadServices(d)).toHaveLength(1);
    expect((await d.links.toArray()).filter((l) => l.type === RECORDED_AS)).toHaveLength(1);
  });
  it('8. an injected failure while writing the service record leaves no link and no record', async () => {
    const { d, a, v } = await ready();
    const real = d.moduleRecords.add.bind(d.moduleRecords);
    const spy = vi.spyOn(d.moduleRecords, 'add').mockImplementation(((rec: { kind?: string }) => (rec?.kind === 'service' ? Promise.reject(new Error('disk full')) : real(rec as never))) as never);
    await expect(saveHandoff({ visitId: v, assetId: a, data: svcData(a), today: TODAY }, d)).rejects.toThrow(/disk full/);
    spy.mockRestore();
    expect(await loadServices(d)).toHaveLength(0);
    expect((await d.links.toArray()).filter((l) => l.type === RECORDED_AS)).toHaveLength(0);
  });
  it('9. an injected failure while writing the link leaves no service record (the whole handoff rolls back)', async () => {
    const { d, a, v } = await ready();
    const real = d.links.add.bind(d.links);
    const spy = vi.spyOn(d.links, 'add').mockImplementation(((l: { type?: string }) => (l?.type === RECORDED_AS ? Promise.reject(new Error('link write failed')) : real(l as never))) as never);
    await expect(saveHandoff({ visitId: v, assetId: a, data: svcData(a), today: TODAY }, d)).rejects.toThrow(/link write failed/);
    spy.mockRestore();
    expect(await loadServices(d)).toHaveLength(0);
    expect((await d.links.toArray()).filter((l) => l.type === RECORDED_AS)).toHaveLength(0);
    // and a normal save afterwards works: nothing was left half-done
    await saveHandoff({ visitId: v, assetId: a, data: svcData(a), today: TODAY }, d);
    expect(await loadServices(d)).toHaveLength(1);
  });
  it('13. the link survives a real backup and restore, and both readers work on the restored database', async () => {
    const { d, a, v } = await ready();
    const r = await saveHandoff({ visitId: v, assetId: a, data: svcData(a), today: TODAY }, d);
    const dst = fresh();
    await dst.open();
    const { file } = checkBackupText(JSON.stringify(await buildBackup(d, mem())));
    await restoreChecked(dst, file, mem());
    const h = await handoffsOfVisit(v, dst);
    expect(h).toHaveLength(1);
    expect(h[0].service?.id).toBe(r.serviceId);
    expect((await loadServices(dst))).toHaveLength(1); // no duplicate made by the restore
    expect((await visitsOfServiceRecord(r.serviceId, dst))[0].visitId).toBe(v);
  });
  it('14. both sides show the relationship, and a deleted service record is shown as such (and does not block a new handoff)', async () => {
    const { d, a, v } = await ready();
    const r = await saveHandoff({ visitId: v, assetId: a, data: svcData(a), today: TODAY }, d);
    const from = await visitsOfServiceRecord(r.serviceId, d);
    expect(from.map((x) => x.visitId)).toEqual([v]);
    expect(from[0].visit?.data.title).toBe('Annual furnace inspection');
    expect((await handoffsOfVisit(v, d))[0].service?.data.title).toBe('Annual furnace inspection');
    // the owner deletes the Home & Assets entry: the visit reports it gone, and recording again is allowed and leaves ONE live link
    const { deleteService } = await import('../assets/serviceData');
    await deleteService(r.serviceId, d);
    expect((await handoffsOfVisit(v, d))[0].service).toBeNull();
    const again = await saveHandoff({ visitId: v, assetId: a, data: svcData(a), today: TODAY }, d);
    const live = await handoffsOfVisit(v, d);
    expect(live.map((h) => h.serviceId)).toEqual([again.serviceId]);
  });
  it('unsafe notes, links and over-long text are not copied into the prefill', () => {
    const base = { data: { notes: '', refs: [], txnRefs: [], paidManualCents: null, status: 'completed', title: 'x', date: '2026-11-03', providerContactId: null } };
    const mk = (over: object) => ({ id: 1, createdAt: 1, updatedAt: 1, data: { ...base.data, ...over } }) as never;
    expect(buildPrefill(mk({ notes: 'Gate code is 123456, door password: blue' })).notes).toBe('');
    expect(buildPrefill(mk({ notes: 'Gate code is 123456, door password: blue' })).notesNote).toMatch(/not copied/);
    expect(buildPrefill(mk({ notes: 'Replaced the filter, all fine.' })).notes).toBe('Replaced the filter, all fine.');
    const refs = buildPrefill(mk({ refs: [{ label: 'Invoice', url: 'https://example.com/i.pdf' }, { label: 'Bad', url: 'javascript:alert(1)' }, { label: 'x'.repeat(81) }] })).refs;
    expect(refs.map((r) => r.label)).toEqual(['Invoice']);
  });
  it('divergence is shown, never synchronized: editing the visit later does not change the Home & Assets record', async () => {
    const { d, a, v } = await ready();
    const t = await addTxn(d, -9000);
    const r = await saveHandoff({ visitId: v, assetId: a, data: svcData(a), today: TODAY }, d);
    await setVisitPayment(v, { source: 'finance', refs: [await ref(d, t)], manualCents: null }, null, d);
    const vis = (await loadVisits(d)).find((x) => x.id === v)!;
    const svc = (await getService(r.serviceId, d))!;
    expect(svc.data.txnRefs).toHaveLength(0); // the visit's later payment did not flow across
    expect(handoffDivergence(vis, svc)).toEqual(['The linked Finance payments differ.']);
  });
  it('a second device that records the same visit offline: both records are kept and a duplicate review is raised (nothing merged)', async () => {
    const { d, a, v } = await ready();
    const first = await saveHandoff({ visitId: v, assetId: a, data: svcData(a), today: TODAY }, d);
    // device B never saw A's link: simulate its independent record + link arriving
    const sid = await createService(svcData(a, { title: 'Annual furnace inspection (B)' }), d, TODAY);
    await createStore(d).shared.links.add({ module: 'services', id: `visit:${v}` }, { module: 'assets', id: `service:${sid}` }, RECORDED_AS);
    const h = await handoffsOfVisit(v, d);
    expect(h).toHaveLength(2);
    expect(duplicateHandoffs(h)).toEqual([{ assetId: a, serviceIds: [first.serviceId, sid].sort((x, y) => x - y) }]);
    expect(await loadServices(d)).toHaveLength(2);
  });
});

describe('S4-A3 financial rules of the handoff', () => {
  it('10. Finance references are carried over as the SAME payment (same piece key); no Finance transaction is created or changed', async () => {
    const { d, a, v } = await ready();
    const t = await addTxn(d, -15000);
    await setVisitPayment(v, { source: 'finance', refs: [await ref(d, t)], manualCents: null }, null, d);
    const txnsBefore = JSON.stringify(await d.txns.toArray());
    const vis = (await loadVisits(d)).find((x) => x.id === v)!;
    const pre = buildPrefill(vis);
    expect(pre.txnRefs).toHaveLength(1);
    const r = await saveHandoff({ visitId: v, assetId: a, data: svcData(a, { txnRefs: pre.txnRefs }), today: TODAY }, d);
    expect((await getService(r.serviceId, d))!.data.txnRefs.map((x) => x.txnId)).toEqual([t]);
    expect(JSON.stringify(await d.txns.toArray())).toBe(txnsBefore);
  });
  it('11. a typed amount on the visit is NOT copied by default (the prefill offers it as a separate choice and the cost stays blank)', async () => {
    const { d, a, v } = await ready();
    await setVisitPayment(v, { source: 'manual', refs: [], manualCents: 12000 }, null, d);
    const pre = buildPrefill((await loadVisits(d)).find((x) => x.id === v)!);
    expect(pre.manualCents).toBe(12000);
    const r = await saveHandoff({ visitId: v, assetId: a, data: svcData(a), today: TODAY }, d);
    expect((await getService(r.serviceId, d))!.data.costCents).toBeNull();
  });
  it('12. a typed amount is copied only after the explicit confirmation; without it the equal cost is refused and nothing is written', async () => {
    const { d, a, v } = await ready();
    await setVisitPayment(v, { source: 'manual', refs: [], manualCents: 12000 }, null, d);
    const before = await tables(d);
    await expect(saveHandoff({ visitId: v, assetId: a, data: svcData(a, { costCents: 12000 }), today: TODAY }, d)).rejects.toThrow(/not confirmed/);
    expect(await tables(d)).toBe(before);
    const r = await saveHandoff({ visitId: v, assetId: a, data: svcData(a, { costCents: 12000 }), today: TODAY, confirmManualCopy: true }, d);
    expect((await getService(r.serviceId, d))!.data.costCents).toBe(12000);
  });
  it('a visit with BOTH Finance links and a typed amount: references win, the typed amount is not offered, and it is flagged', async () => {
    const { d, v } = await ready();
    const t = await addTxn(d, -15000);
    await d.moduleRecords.update(v, { 'data.txnRefs': [await ref(d, t)], 'data.paidManualCents': 999 } as never);
    const pre = buildPrefill((await loadVisits(d)).find((x) => x.id === v)!);
    expect(pre.paymentConflict).toBe(true);
    expect(pre.manualCents).toBeNull();
    expect(pre.txnRefs).toHaveLength(1);
  });
  it('37. an invalid (deleted) Finance reference is refused at save, so a broken payment is not copied; the visit keeps showing it for review', async () => {
    const { d, a, v } = await ready();
    const t = await addTxn(d, -15000);
    await setVisitPayment(v, { source: 'finance', refs: [await ref(d, t)], manualCents: null }, null, d);
    const pre = buildPrefill((await loadVisits(d)).find((x) => x.id === v)!);
    await d.txns.delete(t);
    await expect(saveHandoff({ visitId: v, assetId: a, data: svcData(a, { txnRefs: pre.txnRefs }), today: TODAY }, d)).rejects.toThrow();
    expect(await loadServices(d)).toHaveLength(0);
    expect((await loadVisits(d)).find((x) => x.id === v)!.data.txnRefs).toHaveLength(1);
  });
  async function totals(d: FinanceDB) {
    const [assets, services, arrangements, visits] = await Promise.all([loadAssets(d), loadServices(d), loadArrangements(d), loadVisits(d)]);
    const sRecs = payRecords(arrangements, visits), aRecs = costRecords(assets, services);
    const lookup = lookupOfMap(await loadTxnMap([...sRecs.flatMap((r) => r.refs), ...aRecs.flatMap((r) => r.refs)], d));
    return { services: servicesSpend(sRecs, lookup), assets: spend(aRecs, lookup) };
  }
  it('34/41/42. the same Finance piece on the visit and on the linked record: each module counts it once for itself; the two totals are never added', async () => {
    const { d, a, v } = await ready();
    const t = await addTxn(d, -15000);
    await setVisitPayment(v, { source: 'finance', refs: [await ref(d, t)], manualCents: null }, null, d);
    const before = await totals(d);
    await saveHandoff({ visitId: v, assetId: a, data: svcData(a, { txnRefs: [await ref(d, t)] }), today: TODAY }, d);
    const after = await totals(d);
    expect(before.services.totalCents).toBe(15000);
    expect(after.services.totalCents).toBe(15000); // linking changed no Services figure
    expect(after.assets.totalCents).toBe(15000);   // and it is the Home & Assets figure for the same payment, NOT 30000
    const m = await import('./handoff');
    const exported = Object.keys(m).concat(Object.keys(await import('./assetLinks')), Object.keys(await import('./projectLinks')));
    expect(exported.filter((k) => /household.*(spend|total)|combined(spend|total)/i.test(k))).toEqual([]); // S5 owns the household total
  });
  it('35/36. a whole transaction overlapping a split reference, and a refund: each module keeps its own existing rules', async () => {
    const { d, a, v } = await ready();
    const split = await addTxn(d, -30000, { categoryId: null, splits: [{ categoryId: 5, amountCents: -12000 }, { categoryId: 6, amountCents: -18000 }] });
    const refund = await addTxn(d, 4000, { payee: 'Pat Heating refund' });
    await setVisitPayment(v, { source: 'finance', refs: [await ref(d, split), await ref(d, refund)], manualCents: null }, null, d);
    await saveHandoff({ visitId: v, assetId: a, data: svcData(a, { txnRefs: [await ref(d, split, 0), await ref(d, refund)] }), today: TODAY }, d);
    const t = await totals(d);
    expect(t.services.totalCents).toBe(30000 - 4000); // the whole counts, its part is covered; the refund lowers the total
    expect(t.assets.totalCents).toBe(12000 - 4000);   // Home & Assets holds only the part
  });
  it('38/39. a typed amount on one side only, and on both sides through the explicit opt-in: each module shows its own figure, nothing is merged', async () => {
    const { d, a, v } = await ready();
    await setVisitPayment(v, { source: 'manual', refs: [], manualCents: 8000 }, null, d);
    await saveHandoff({ visitId: v, assetId: a, data: svcData(a), today: TODAY }, d);
    let t = await totals(d);
    expect([t.services.totalCents, t.assets.totalCents]).toEqual([8000, 0]);
    const b = await asset(d, 'Air conditioner');
    await saveHandoff({ visitId: v, assetId: b, data: svcData(b, { costCents: 8000 }), today: TODAY, confirmManualCopy: true }, d);
    t = await totals(d);
    expect([t.services.totalCents, t.assets.totalCents]).toEqual([8000, 8000]); // two honest module totals for one payment; S5 pairs them by the link
  });
  it('40. a handoff writes nothing to Finance or Projects', async () => {
    const { d, a, v } = await ready();
    const p = await createProject(blankProject({ name: 'Basement refit', budgetCents: 100000 }), d);
    const snap = async () => JSON.stringify([await d.txns.toArray(), await d.moduleRecords.filter((r) => r.module === 'projects').toArray(), await d.accounts.toArray()]);
    const before = await snap();
    await saveHandoff({ visitId: v, assetId: a, data: svcData(a), today: TODAY }, d);
    expect(await snap()).toBe(before);
    expect(p).toBeGreaterThan(0);
  });
  it('the asset page reverse view lists the arrangement and never shows it as maintenance that happened', async () => {
    const d = fresh();
    const a = await asset(d);
    const r = await createArrangement({ data: blankArrangement({ title: 'Furnace plan' }), provider: { name: 'Pat Heating' }, assetIds: [a], today: TODAY }, d);
    const view = await loadAssetServices(a, d);
    expect(view.rows.map((x) => [x.arrangementId, x.status, x.providerName])).toEqual([[r.id, 'active', 'Pat Heating']]);
    expect(await loadServices(d)).toHaveLength(0);
  });
});
