import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { createStore } from '../../core/store';
import { buildBackup, checkBackupText, restoreChecked } from '../../lib/backupFile';
import { dexieMeta, RemoteConflict, SyncEngine, type RemoteFile, type RemoteStore } from '../../lib/sync/engine';
import { installTracking, touchAll } from '../../lib/sync/track';
import { loadTxnMap, lookupOfMap } from '../../lib/txnLookup';
import { makeTxnRef } from '../../lib/txnRef';
import type { Txn } from '../../types';
import { createAsset, loadAssets, setAssetStatus } from '../assets/data';
import { blankAsset } from '../assets/model';
import { deleteAssetPermanently } from '../assets/deletion';
import { blankService } from '../assets/service';
import { costRecords, spend } from '../assets/spending';
import { getService, loadServices } from '../assets/serviceData';
import { createProject } from '../projects/data';
import { blankProject } from '../projects/model';
import { applyLifecycle, planLifecycle } from './changes';
import { applyMoveToReplacement, planMoveToReplacement } from './assetLinks';
import { setContractDates } from './contractData';
import { createArrangement, getArrangement, linkedAssetIds, loadArrangements, updateArrangement } from './data';
import { duplicateHandoffs, handoffsOfVisit, saveHandoff } from './handoff';
import { blankArrangement } from './model';
import { setVisitPayment } from './payments';
import { explicitProjectIds, linkProject, projectLinksOf, unlinkProject } from './projectLinks';
import { payRecords, servicesSpend } from './servicesSpend';
import { applyUndo, isUndoRefused } from './undo';
import { assetViews } from './views';
import { loadVisits, logStandaloneVisit, updateVisit, visitAssetIds } from './visits';
import { servicesDueItems } from './dueProvider';

/** Real SyncEngine with two simulated devices. Invented data only. Whole-record last-writer-wins is relied on, never promised to merge. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-s4sync-${n++}`); installTracking(d); return d; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TODAY = '2026-11-06';
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
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
  const mk = () => { const d = fresh(); return { d, engine: new SyncEngine(d, dexieMeta(`s4sync-meta-${n++}`), remote, 'a good passphrase') }; };
  return { A: mk(), B: mk() };
};
type Dev = ReturnType<typeof devices>['A'];
const settle = async (A: Dev, B: Dev) => { for (let i = 0; i < 2; i++) { await A.engine.sync(); await B.engine.sync(); } await A.engine.sync(); };
const addTxn = (d: FinanceDB, amountCents: number, over: Partial<Txn> = {}) => d.txns.add({ accountId: 1, date: '2026-11-02', amountCents, payee: 'Pat Heating', memo: '', status: 'cleared', categoryId: 5, ...over } as Txn) as Promise<number>;
const logDone = async (d: FinanceDB, arrangementId: number, title = 'Furnace inspection') =>
  (await logStandaloneVisit({ arrangementId, input: { status: 'completed', cancelledBy: null, date: '2026-11-03', title, chargedCents: null, chargeKind: null }, today: TODAY }, d)).visitId;
const svc = (assetId: number, over = {}) => blankService(assetId, { title: 'Furnace inspection', date: '2026-11-03', kind: 'inspection', ...over });
const serves = async (d: FinanceDB, id: number) => (await linkedAssetIds(id, d)).sort((a, b) => a - b);
async function seeded() {
  const { A, B } = devices();
  const furnace = await createAsset(blankAsset({ name: 'Furnace', type: 'system' }), A.d);
  const r = await createArrangement({ data: blankArrangement({ title: 'Furnace plan', renewalDate: '2027-01-01', noticeByDate: '2026-12-01' }), provider: { name: 'Pat Heating' }, assetIds: [furnace], today: TODAY }, A.d);
  const v = await logDone(A.d, r.id);
  await A.engine.initialUpload();
  await B.engine.replaceFromRemote();
  return { A, B, furnace, r, v };
}
const linksOf = async (d: FinanceDB, type: string) => (await d.links.toArray()).filter((l) => l.type === type && l.deletedAt == null).map((l) => `${l.fromId}>${l.toId}`).sort();

describe('S4 two devices (real SyncEngine)', () => {
  it('1. A records a visit in Home & Assets while B edits the visit: the service record, the link and B\'s edit all survive on both devices', async () => {
    const { A, B, furnace, v } = await seeded();
    const r = await saveHandoff({ visitId: v, assetId: furnace, data: svc(furnace), today: TODAY }, A.d);
    await sleep(15);
    const vis = (await loadVisits(B.d)).find((x) => x.id === v)!;
    await updateVisit(v, { title: 'Furnace inspection (edited on B)', status: 'completed', cancelledBy: null, date: '2026-11-03', endDate: null, notes: 'B note', chargedCents: null, chargeKind: null, refs: [], assetIds: [furnace] }, TODAY, vis.updatedAt, B.d);
    await settle(A, B);
    for (const x of [A, B]) {
      expect((await loadVisits(x.d)).find((q) => q.id === v)!.data.title).toBe('Furnace inspection (edited on B)');
      const h = await handoffsOfVisit(v, x.d);
      expect(h.map((q) => q.serviceId)).toEqual([r.serviceId]);
      expect(h[0].service?.data.title).toBe('Furnace inspection'); // the two records are independent: B's edit did not rewrite the Home & Assets entry
    }
  });
  it('2. both devices record the same visit offline: both records are kept, both links are kept, and the duplicate review fires on both', async () => {
    const { A, B, furnace, v } = await seeded();
    const ra = await saveHandoff({ visitId: v, assetId: furnace, data: svc(furnace, { title: 'From A' }), today: TODAY }, A.d);
    const rb = await saveHandoff({ visitId: v, assetId: furnace, data: svc(furnace, { title: 'From B' }), today: TODAY }, B.d); // B never saw A's link
    await settle(A, B);
    for (const x of [A, B]) {
      expect((await loadServices(x.d)).map((s) => s.id).sort()).toEqual([ra.serviceId, rb.serviceId].sort());
      const h = await handoffsOfVisit(v, x.d);
      expect(h).toHaveLength(2);
      expect(duplicateHandoffs(h)).toEqual([{ assetId: furnace, serviceIds: [ra.serviceId, rb.serviceId].sort((p, q) => p - q) }]);
    }
  });
  it('3. A moves the arrangement to the replacement while B edits it: both devices converge on a valid state and the history link stays', async () => {
    const { A, B, furnace, r, v } = await seeded();
    const newer = await createAsset(blankAsset({ name: 'New furnace', type: 'system' }), A.d);
    await setAssetStatus(furnace, { status: 'replaced', statusDate: '2026-10-01', statusNote: '', replacedById: newer }, A.d);
    await settle(A, B);
    await applyMoveToReplacement({ arrangementId: r.id, expect: (await planMoveToReplacement(r.id, furnace, A.d)).expect! }, A.d);
    await sleep(15);
    const a = (await getArrangement(r.id, B.d))!;
    await updateArrangement(r.id, { title: 'Furnace plan (B)', startDate: null, extraContactIds: [], expected: null, refs: [], notes: 'B edit', assetIds: [furnace] }, a.updatedAt, B.d);
    await settle(A, B);
    const sa = await serves(A.d, r.id), sb = await serves(B.d, r.id);
    expect(sa).toEqual(sb);                                   // the devices agree
    expect(sa.length).toBeGreaterThan(0);                     // and the arrangement still serves something valid
    expect(await visitAssetIds(v, A.d)).toEqual([furnace]);   // history is untouched on both
    expect(await visitAssetIds(v, B.d)).toEqual([furnace]);
    expect((await getArrangement(r.id, A.d))!.data.title).toBe((await getArrangement(r.id, B.d))!.data.title);
  });
  it('4. B changes a shared link before A\'s Undo: the Undo is refused on A and nothing is restored over B\'s change', async () => {
    const { A, B, furnace, r } = await seeded();
    const newer = await createAsset(blankAsset({ name: 'New furnace', type: 'system' }), A.d);
    await setAssetStatus(furnace, { status: 'replaced', statusDate: '2026-10-01', statusNote: '', replacedById: newer }, A.d);
    await settle(A, B);
    const moved = await applyMoveToReplacement({ arrangementId: r.id, expect: (await planMoveToReplacement(r.id, furnace, A.d)).expect! }, A.d);
    await settle(A, B);
    const p = await createProject(blankProject({ name: 'Furnace swap' }), B.d);
    await linkProject({ kind: 'arrangement', id: r.id }, p, B.d);
    await settle(A, B);
    expect(isUndoRefused(await applyUndo(moved.undo, A.d).catch((e) => e))).toBe(true);
    expect(await serves(A.d, r.id)).toEqual([newer]);
    expect((await projectLinksOf({ kind: 'arrangement', id: r.id }, A.d)).map((l) => l.projectId)).toEqual([p]);
  });
  it('5. a Project link added on one device and removed or changed on the other: the devices end up identical, with nothing duplicated', async () => {
    const { A, B, r } = await seeded();
    const p1 = await createProject(blankProject({ name: 'Roof' }), A.d), p2 = await createProject(blankProject({ name: 'Gutters' }), A.d);
    await linkProject({ kind: 'arrangement', id: r.id }, p1, A.d);
    await settle(A, B);
    await unlinkProject({ kind: 'arrangement', id: r.id }, p1, B.d);   // B removes it
    await linkProject({ kind: 'arrangement', id: r.id }, p2, A.d);     // A adds another at the same time
    await linkProject({ kind: 'arrangement', id: r.id }, p1, A.d);     // and re-links the first (a fresh link row on A)
    await settle(A, B);
    const ea = await explicitProjectIds([{ kind: 'arrangement', id: r.id }], A.d), eb = await explicitProjectIds([{ kind: 'arrangement', id: r.id }], B.d);
    expect(ea).toEqual(eb);
    expect(await linksOf(A.d, 'involves')).toEqual(await linksOf(B.d, 'involves'));
    expect(new Set(await linksOf(A.d, 'involves')).size).toBe((await linksOf(A.d, 'involves')).length);
  });
  it('6. A edits the renewal dates while B pauses the arrangement: whole-record last-writer-wins gives ONE valid state on both devices (one of the two edits may be superseded)', async () => {
    for (const bLater of [true, false]) {
      const { A, B, r } = await seeded();
      const a = (await getArrangement(r.id, A.d))!;
      if (bLater) {
        await setContractDates(r.id, { renewalDate: '2028-01-01', noticeByDate: '2027-12-01' }, a.updatedAt, A.d);
        await sleep(15);
        await applyLifecycle({ action: 'pause', arrangementId: r.id, expect: (await planLifecycle(r.id, 'pause', TODAY, B.d)).expect, today: TODAY }, B.d);
      } else {
        await applyLifecycle({ action: 'pause', arrangementId: r.id, expect: (await planLifecycle(r.id, 'pause', TODAY, B.d)).expect, today: TODAY }, B.d);
        await sleep(15);
        await setContractDates(r.id, { renewalDate: '2028-01-01', noticeByDate: '2027-12-01' }, a.updatedAt, A.d);
      }
      await settle(A, B);
      const x = (await getArrangement(r.id, A.d))!.data, y = (await getArrangement(r.id, B.d))!.data;
      expect(x).toEqual(y);
      expect(['active', 'paused']).toContain(x.status);
      expect(['2027-01-01', '2028-01-01']).toContain(x.renewalDate);
      expect((await servicesDueItems(A.d, { from: '2026-01-01', to: '2029-12-31', today: TODAY, overdueDays: 0 })).length).toBe(2);
    }
  });
  it('7. A replaces the provider while B (not yet synced) reads the predecessor\'s dates: B still sees them; after sync the dates stay on the ended predecessor and the successor has none', async () => {
    const { A, B, r } = await seeded();
    const res = await applyLifecycle({ action: 'replace', arrangementId: r.id, expect: (await planLifecycle(r.id, 'replace', TODAY, A.d)).expect, today: TODAY, replace: { provider: { name: 'New Heat' } } }, A.d);
    expect((await getArrangement(r.id, B.d))!.data).toMatchObject({ status: 'active', renewalDate: '2027-01-01' }); // B has not synced yet
    await settle(A, B);
    for (const x of [A, B]) {
      expect((await getArrangement(r.id, x.d))!.data).toMatchObject({ status: 'ended', endReason: 'replaced', renewalDate: '2027-01-01', noticeByDate: '2026-12-01' });
      expect((await getArrangement(res.successorId!, x.d))!.data).toMatchObject({ renewalDate: null, noticeByDate: null, predecessorId: r.id });
      expect(await servicesDueItems(x.d, { from: '2026-01-01', to: '2029-12-31', today: TODAY, overdueDays: 0 })).toEqual([]);
    }
  });
  it('8. one device deletes an asset while the other keeps an arrangement link and logs a visit against it: the deletion holds, history is kept, and the dangling link reads as a missing asset', async () => {
    const { A, B, furnace, r } = await seeded();
    const spare = await createAsset(blankAsset({ name: 'Spare heater', type: 'appliance' }), A.d);
    await createStore(A.d).shared.links.add({ module: 'services', id: `arrangement:${r.id}` }, { module: 'assets', id: `asset:${spare}` }, 'serves');
    await settle(A, B);
    await deleteAssetPermanently(spare, A.d);
    const vB = await logDone(B.d, r.id, 'Visit logged on B'); // B still thinks the arrangement serves the spare heater
    expect(await visitAssetIds(vB, B.d)).toContain(spare);
    await settle(A, B);
    for (const x of [A, B]) {
      expect((await loadAssets(x.d)).map((q) => q.id)).not.toContain(spare);
      expect((await loadVisits(x.d)).map((q) => q.id)).toContain(vB);
      expect(await getArrangement(r.id, x.d)).toBeDefined();
      const views = assetViews(await serves(x.d, r.id), await loadAssets(x.d));
      expect(views.find((q) => q.id === furnace)?.missing).toBe(false);
      expect(views.filter((q) => q.missing).every((q) => q.id === spare)).toBe(true);
    }
  });
  it('9. a Finance transaction referenced on both sides changes on the other device: both modules use the new live amount, each counts it once, and the two are not added', async () => {
    const { A, B, furnace, v } = await seeded();
    const t = await addTxn(A.d, -15000);
    const ref = makeTxnRef((await A.d.txns.get(t))!);
    await setVisitPayment(v, { source: 'finance', refs: [ref], manualCents: null }, null, A.d);
    await saveHandoff({ visitId: v, assetId: furnace, data: svc(furnace, { txnRefs: [ref] }), today: TODAY }, A.d);
    await settle(A, B);
    await B.d.txns.update(t, { amountCents: -16000 });
    await settle(A, B);
    for (const x of [A, B]) {
      const [assets, services, arrangements, visits] = await Promise.all([loadAssets(x.d), loadServices(x.d), loadArrangements(x.d), loadVisits(x.d)]);
      const sr = payRecords(arrangements, visits), ar = costRecords(assets, services);
      const lookup = lookupOfMap(await loadTxnMap([...sr.flatMap((q) => q.refs), ...ar.flatMap((q) => q.refs)], x.d));
      expect(servicesSpend(sr, lookup).totalCents).toBe(16000);
      expect(spend(ar, lookup).totalCents).toBe(16000);
    }
  });
});

describe('S4 backup and restore (real G1 export, checker and restore into a separate database)', () => {
  it('10. the arrangement-asset, project and recorded-as links, replacement relationships, contract dates, payments and unknown fields all come back; restoring twice changes nothing', async () => {
    const d = fresh();
    const oldA = await createAsset(blankAsset({ name: 'Old furnace', type: 'system' }), d), newA = await createAsset(blankAsset({ name: 'New furnace', type: 'system' }), d);
    await setAssetStatus(oldA, { status: 'replaced', statusDate: '2026-10-01', statusNote: '', replacedById: newA }, d);
    const r = await createArrangement({ data: blankArrangement({ title: 'Furnace plan', renewalDate: '2027-01-01', noticeByDate: '2026-12-01' }), provider: { name: 'Pat Heating' }, assetIds: [oldA], today: TODAY }, d);
    const v = await logDone(d, r.id);
    const t = await addTxn(d, -15000);
    await setVisitPayment(v, { source: 'finance', refs: [makeTxnRef((await d.txns.get(t))!)], manualCents: null }, null, d);
    const h = await saveHandoff({ visitId: v, assetId: oldA, data: svc(oldA, { txnRefs: [makeTxnRef((await d.txns.get(t))!)] }), today: TODAY }, d);
    const p = await createProject(blankProject({ name: 'Furnace swap' }), d);
    await linkProject({ kind: 'arrangement', id: r.id }, p, d);
    await linkProject({ kind: 'visit', id: v }, p, d);
    const v2 = await logDone(d, r.id, 'Cash visit');
    await setVisitPayment(v2, { source: 'manual', refs: [], manualCents: 4200 }, null, d);
    const rep = await applyLifecycle({ action: 'replace', arrangementId: r.id, expect: (await planLifecycle(r.id, 'replace', TODAY, d)).expect, today: TODAY, replace: { provider: { name: 'New Heat' } } }, d);
    await d.moduleRecords.update(r.id, { 'data.futureField': { keep: [1, 2] } } as never);
    const snap = async (x: FinanceDB) => { const out: Record<string, unknown[]> = {}; for (const tb of x.tables) out[tb.name] = (await tb.toArray()).map((q) => { const { updatedAt: _u, ...rest } = q as Record<string, unknown>; return rest; }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))); return out; };

    const dst = fresh();
    await dst.open();
    const text = JSON.stringify(await buildBackup(d, mem()));
    for (let pass = 0; pass < 2; pass++) {
      await restoreChecked(dst, checkBackupText(text).file, mem());
      expect(await snap(dst)).toEqual({ ...(await snap(d)), settings: (await snap(dst)).settings });
    }
    // the restored readers work, and nothing was duplicated
    expect(await serves(dst, r.id)).toEqual([oldA]);
    expect(await serves(dst, rep.successorId!)).toEqual([oldA]);
    expect((await handoffsOfVisit(v, dst)).map((x) => x.serviceId)).toEqual([h.serviceId]);
    expect((await getService(h.serviceId, dst))!.data.txnRefs).toHaveLength(1);
    expect(await explicitProjectIds([{ kind: 'arrangement', id: r.id }, { kind: 'visit', id: v }], dst)).toEqual([p]);
    const old = (await getArrangement(r.id, dst))!.data as unknown as Record<string, unknown>;
    expect(old).toMatchObject({ status: 'ended', endReason: 'replaced', renewalDate: '2027-01-01', noticeByDate: '2026-12-01', futureField: { keep: [1, 2] } });
    expect((await getArrangement(rep.successorId!, dst))!.data).toMatchObject({ predecessorId: r.id, renewalDate: null });
    expect((await loadVisits(dst)).find((x) => x.id === v2)!.data.paidManualCents).toBe(4200);
    expect(assetViews([oldA], await loadAssets(dst))[0]).toMatchObject({ status: 'replaced', replacementId: newA });
    expect((await loadServices(dst))).toHaveLength(1);
    await touchAll(dst); // a second look changes no relationship
    expect((await d.links.toArray()).filter((l) => l.deletedAt == null).length).toBe((await dst.links.toArray()).filter((l) => l.deletedAt == null).length);
  });
});
