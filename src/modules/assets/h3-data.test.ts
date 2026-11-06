import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { assetsOfProject, linkProjectToAsset, projectsOfAsset, unlinkProjectFromAsset } from '../../core/projectAssetLink';
import { exportAll, importAll } from '../../lib/backup';
import { checkBackupText } from '../../lib/backupFile';
import { loadProjectSummary } from '../../lib/txnProject';
import { installTracking } from '../../lib/sync/track';
import { deleteProjectPermanently } from '../projects/deletion';
import { archiveProject, createProject, getProject, loadProjects, setProjectStatus } from '../projects/data';
import { blankProject } from '../projects/model';
import { createAsset, getAsset, loadAssets, setAssetStatus, updateAsset } from './data';
import { deleteAssetPermanently, planAssetDeletion } from './deletion';
import { blankAsset } from './model';
import { blankService } from './service';
import { createService, getService, loadServices, updateService } from './serviceData';
import { assetSpend, costRecords } from './spending';
import { loadTxnMap, lookupOfMap } from './txnLookup';
import { makeTxnRef } from './txnRef';
import type { Txn } from '../../types';

/** Invented data only. Each test gets its own database. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-h3-${n++}`); installTracking(d); return d; };
const TODAY = '2026-11-06';
const svc = (assetId: number, over = {}) => blankService(assetId, { title: 'Replaced pump', date: '2026-11-01', kind: 'repair', ...over });
const addTxn = async (d: FinanceDB, amountCents: number, over: Partial<Txn> = {}) =>
  d.txns.add({ accountId: 1, date: '2026-03-02', amountCents, payee: 'Hardware Co', memo: '', status: 'cleared', categoryId: 5, ...over } as Txn);
const live = async (d: FinanceDB, id: number) => (await d.txns.get(id))!;
const spendOf = async (d: FinanceDB, assetId: number) => {
  const [assets, services] = await Promise.all([loadAssets(d), loadServices(d)]);
  const map = await loadTxnMap(costRecords(assets, services).flatMap((r) => r.refs), d);
  return assetSpend(assets, services, assetId, lookupOfMap(map));
};
const financeSnap = async (d: FinanceDB) => JSON.stringify([await d.accounts.toArray(), await d.txns.toArray(), await d.categories.toArray(), await d.assignments.toArray(), await d.recurring.toArray(), await d.goals.toArray(), await d.properties.toArray(), await d.propertyValues.toArray(), await d.moduleRecords.where('module').equals('projects').toArray()]);

describe('H3 saving references (real database)', () => {
  it('stores purchase and service references with their snapshot, and reads them back', async () => {
    const d = fresh();
    const t = await addTxn(d, -120000);
    const a = await createAsset(blankAsset({ name: 'Furnace', purchaseTxnRefs: [makeTxnRef(await live(d, t))] }), d);
    const s = await createService(svc(a, { txnRefs: [makeTxnRef(await live(d, t))] }), d, TODAY);
    expect((await getAsset(a, d))!.data.purchaseTxnRefs[0]).toEqual({ txnId: t, snapshot: { date: '2026-03-02', payee: 'Hardware Co', amountCents: -120000 } });
    expect((await getService(s, d))!.data.txnRefs).toHaveLength(1);
    expect((await spendOf(d, a)).own.totalCents).toBe(120000); // one payment, reached twice, counted once
  });
  it('refuses a typed amount together with references, a missing transaction, a transfer, and a changed part', async () => {
    const d = fresh();
    const t = await addTxn(d, -1000), tr = await addTxn(d, -5000, { transferTxnId: 99 });
    const sp = await addTxn(d, -3000, { categoryId: null, splits: [{ categoryId: 5, amountCents: -1000 }, { categoryId: 6, amountCents: -2000 }] });
    const a = await createAsset(blankAsset({ name: 'Boiler' }), d);
    await expect(createAsset(blankAsset({ name: 'X', purchaseCents: 5, purchaseTxnRefs: [makeTxnRef(await live(d, t))] }), d)).rejects.toThrow(/not both/);
    await expect(createService(svc(a, { costCents: 5, txnRefs: [makeTxnRef(await live(d, t))] }), d, TODAY)).rejects.toThrow(/not both/);
    await expect(createService(svc(a, { txnRefs: [{ txnId: 9999, snapshot: { date: '', payee: '', amountCents: 0 } }] }), d, TODAY)).rejects.toThrow(/no longer exists/);
    await expect(createService(svc(a, { txnRefs: [makeTxnRef(await live(d, tr))] }), d, TODAY)).rejects.toThrow(/transfer/);
    const stale = makeTxnRef(await live(d, sp), 0);
    await d.txns.update(sp, { splits: [{ categoryId: 5, amountCents: -1500 }, { categoryId: 6, amountCents: -1500 }] });
    await expect(createService(svc(a, { txnRefs: [stale] }), d, TODAY)).rejects.toThrow(/changed/);
    expect(await d.moduleRecords.where('[module+kind]').equals(['assets', 'service']).count()).toBe(0);
  });
  it('a record whose reference has gone stale can still be edited, keeps its history, and shows as needing review', async () => {
    const d = fresh();
    const t = await addTxn(d, -4000);
    const a = await createAsset(blankAsset({ name: 'Boiler' }), d);
    const s = await createService(svc(a, { txnRefs: [makeTxnRef(await live(d, t))] }), d, TODAY);
    await d.txns.delete(t);
    const cur = (await getService(s, d))!;
    await updateService(s, { ...cur.data, title: 'Replaced pump (renamed)' }, d, TODAY);
    const after = (await getService(s, d))!;
    expect(after.data.title).toBe('Replaced pump (renamed)');
    expect(after.data.txnRefs).toHaveLength(1); // the reference and its snapshot are kept
    const r = await spendOf(d, a);
    expect(r.own.totalCents).toBe(0);
    expect(r.own.review).toHaveLength(1);
    expect(await getService(s, d)).toBeTruthy(); // the history itself is intact
  });
  it('edits made in Finance show up on the next read; removing a reference changes no Finance figure', async () => {
    const d = fresh();
    await d.accounts.add({ name: 'Test Checking', kind: 'checking', openingBalanceCents: 100000 } as never);
    const t = await addTxn(d, -10000);
    const before = await financeSnap(d);
    const a = await createAsset(blankAsset({ name: 'Boiler' }), d);
    const s = await createService(svc(a, { txnRefs: [makeTxnRef(await live(d, t))] }), d, TODAY);
    expect(await financeSnap(d)).toBe(before);
    expect((await spendOf(d, a)).own.totalCents).toBe(10000);
    await d.txns.update(t, { amountCents: -12500, payee: 'Renamed Co' });
    const r = await spendOf(d, a);
    expect(r.own.totalCents).toBe(12500);
    expect(r.own.changed).toHaveLength(1);
    const cur = (await getService(s, d))!;
    await updateService(s, { ...cur.data, txnRefs: [] }, d, TODAY);
    expect((await spendOf(d, a)).own.unknown).toHaveLength(1); // unknown again, not $0
    const afterEdit = JSON.parse(await financeSnap(d));
    expect(afterEdit[1][0].amountCents).toBe(-12500); // only our own deliberate change to the test transaction
    expect(afterEdit[0]).toEqual(JSON.parse(before)[0]);
  });
  it('deleting a service record, retiring or archiving an asset keeps the references and the historical spending', async () => {
    const d = fresh();
    const t = await addTxn(d, -7000);
    const a = await createAsset(blankAsset({ name: 'Old boiler', purchaseTxnRefs: [makeTxnRef(await live(d, t))] }), d);
    await setAssetStatus(a, { status: 'sold', statusDate: '2026-10-01', statusNote: '', replacedById: null }, d);
    expect((await getAsset(a, d))!.data.purchaseTxnRefs).toHaveLength(1);
    expect((await spendOf(d, a)).own.totalCents).toBe(7000);
    const cur = (await getAsset(a, d))!;
    await updateAsset(a, { ...cur.data, archived: true }, d);
    expect((await spendOf(d, a)).own.totalCents).toBe(7000);
  });
  it('an asset with service history cannot be permanently deleted just because references were removed', async () => {
    const d = fresh();
    const a = await createAsset(blankAsset({ name: 'Pump' }), d);
    await createService(svc(a, { costCents: 100 }), d, TODAY);
    expect((await planAssetDeletion(a, d)).canDelete).toBe(false);
  });
  it('the net worth pointer is carried, and a removed net worth entry just reads as removed', async () => {
    const d = fresh();
    const p = await d.properties.add({ name: 'Home', kind: 'home', loanIds: [] });
    const a = await createAsset(blankAsset({ name: 'House', type: 'property', ledgerPropertyId: p }), d);
    expect((await getAsset(a, d))!.data.ledgerPropertyId).toBe(p);
    await d.properties.delete(p);
    expect((await getAsset(a, d))!.data.ledgerPropertyId).toBe(p);
    expect(await d.properties.get(p)).toBeUndefined();
  });
});

describe('H3 backup', () => {
  it('references and snapshots survive an export and restore unchanged, and an old backup without them restores', async () => {
    const d = fresh();
    const t = await addTxn(d, -4500);
    const a = await createAsset(blankAsset({ name: 'Heater', purchaseTxnRefs: [makeTxnRef(await live(d, t))], ledgerPropertyId: 3 }), d);
    const s = await createService(svc(a, { txnRefs: [makeTxnRef(await live(d, t))] }), d, TODAY);
    const text = JSON.stringify(await exportAll(d));
    const target = new FinanceDB(`test-h3-restore-${n++}`);
    await target.open();
    await importAll(target, checkBackupText(text).file);
    expect((await getAsset(a, target))!.data.purchaseTxnRefs).toEqual((await getAsset(a, d))!.data.purchaseTxnRefs);
    expect((await getAsset(a, target))!.data.ledgerPropertyId).toBe(3);
    expect((await getService(s, target))!.data.txnRefs).toEqual((await getService(s, d))!.data.txnRefs);
    const old = fresh();
    const plain = await createAsset(blankAsset({ name: 'Plain' }), old);
    await old.moduleRecords.update(plain, { data: { name: 'Plain', type: 'other' } }); // as stored before H3
    expect((await getAsset(plain, old))!.data.purchaseTxnRefs).toEqual([]);
  });
});

describe('H3 projects and assets', () => {
  const proj = (d: FinanceDB, name: string, over = {}) => createProject(blankProject({ name, ...over }), d);

  it('one asset can have several projects and one project several assets; linking twice makes one link', async () => {
    const d = fresh();
    const a1 = await createAsset(blankAsset({ name: 'House', type: 'property' }), d), a2 = await createAsset(blankAsset({ name: 'Dishwasher' }), d);
    const p1 = await proj(d, 'Kitchen remodel'), p2 = await proj(d, 'New roof');
    await linkProjectToAsset(p1, a1, d); await linkProjectToAsset(p2, a1, d); await linkProjectToAsset(p1, a2, d);
    const again = await linkProjectToAsset(p1, a1, d);
    expect((await projectsOfAsset(a1, d)).map((x) => x.projectId).sort()).toEqual([p1, p2].sort());
    expect((await assetsOfProject(p1, d)).map((x) => x.assetId).sort()).toEqual([a1, a2].sort());
    expect((await projectsOfAsset(a1, d)).filter((x) => x.projectId === p1)).toHaveLength(1);
    expect(again).toBe((await projectsOfAsset(a1, d)).find((x) => x.projectId === p1)!.linkId);
    expect((await d.links.toArray()).filter((l) => l.toId === `asset:${a1}`)).toHaveLength(2);
    const row = (await d.links.toArray())[0];
    expect(row).toMatchObject({ fromModule: 'projects', toModule: 'assets', type: 'involves' });
  });
  it('removing a relationship keeps both records, and Undo brings it back', async () => {
    const d = fresh();
    const a = await createAsset(blankAsset({ name: 'House' }), d);
    const p = await proj(d, 'Deck');
    await linkProjectToAsset(p, a, d);
    expect(await unlinkProjectFromAsset(p, a, d)).toBe(1);
    expect(await projectsOfAsset(a, d)).toEqual([]);
    expect(await getAsset(a, d)).toBeTruthy();
    expect(await getProject(p, d)).toBeTruthy();
    await linkProjectToAsset(p, a, d);
    expect(await projectsOfAsset(a, d)).toHaveLength(1);
  });
  it('an archived project still resolves; a deleted project unlinks itself and leaves the asset alone', async () => {
    const d = fresh();
    const a = await createAsset(blankAsset({ name: 'House' }), d);
    const p = await proj(d, 'Deck'), q = await proj(d, 'Fence');
    await linkProjectToAsset(p, a, d); await linkProjectToAsset(q, a, d);
    await archiveProject(p, d);
    expect((await getProject(p, d))!.data.archived).toBe(true);
    expect((await projectsOfAsset(a, d)).map((x) => x.projectId)).toContain(p);
    expect((await loadProjects(d)).map((x) => x.id)).toContain(p);
    await deleteProjectPermanently(q, d);
    expect(await getProject(q, d)).toBeUndefined();
    expect((await projectsOfAsset(a, d)).map((x) => x.projectId)).toEqual([p]);
    expect(await getAsset(a, d)).toBeTruthy();
  });
  it('a link whose project vanished some other way is still listed, so the page can offer to remove it', async () => {
    const d = fresh();
    const a = await createAsset(blankAsset({ name: 'House' }), d);
    await linkProjectToAsset(777, a, d);
    expect((await projectsOfAsset(a, d)).map((x) => x.projectId)).toEqual([777]);
    expect(await getProject(777, d)).toBeUndefined();
  });
  it('deleting an asset removes its project links and leaves every project alone', async () => {
    const d = fresh();
    const a = await createAsset(blankAsset({ name: 'Shed' }), d);
    const p = await proj(d, 'Deck');
    await linkProjectToAsset(p, a, d);
    await deleteAssetPermanently(a, d);
    expect(await getAsset(a, d)).toBeUndefined();
    expect(await getProject(p, d)).toBeTruthy();
    expect(await assetsOfProject(p, d)).toEqual([]);
  });
  it('project payments are read from the existing summary and are NEVER added to the asset spending', async () => {
    const d = fresh();
    const a = await createAsset(blankAsset({ name: 'House', type: 'property', purchaseCents: 80000 }), d);
    const p = await proj(d, 'Kitchen remodel', { budgetCents: 3000000 });
    await linkProjectToAsset(p, a, d);
    await addTxn(d, -2500000, { payee: 'Builder', project: { projectId: p } });
    const summary = (await loadProjectSummary(d, p))!;
    expect(summary.paidCents).toBe(2500000);
    expect((await spendOf(d, a)).own.totalCents).toBe(80000);
    expect((await spendOf(d, a)).combined.totalCents).toBe(80000);
  });
  it('if a service record deliberately links the same transaction a project uses, the asset counts it once and the project is unchanged', async () => {
    const d = fresh();
    const a = await createAsset(blankAsset({ name: 'House' }), d);
    const p = await proj(d, 'Roof');
    const t = await addTxn(d, -900000, { payee: 'Roofer', project: { projectId: p } });
    const before = JSON.stringify(await loadProjectSummary(d, p));
    await createService(svc(a, { kind: 'replacement', title: 'New roof', projectId: p, txnRefs: [makeTxnRef(await live(d, t))] }), d, TODAY);
    await createService(svc(a, { kind: 'improvement', title: 'Roof, final payment note', projectId: p, txnRefs: [makeTxnRef(await live(d, t))] }), d, TODAY);
    expect((await spendOf(d, a)).own.totalCents).toBe(900000);
    expect(JSON.stringify(await loadProjectSummary(d, p))).toBe(before);
  });
  it('completing a project creates no asset or service record by itself; only an explicit save does', async () => {
    const d = fresh();
    const a = await createAsset(blankAsset({ name: 'Roof' }), d);
    const p = await proj(d, 'Roof replacement');
    await linkProjectToAsset(p, a, d);
    await setProjectStatus(p, 'completed', d);
    expect(await loadServices(d)).toEqual([]);
    expect((await loadAssets(d)).map((x) => x.data)).toHaveLength(1);
    const s = await createService(svc(a, { title: 'Roof replacement', kind: 'improvement', projectId: p }), d, TODAY);
    const rec = (await getService(s, d))!;
    expect(rec.data.projectId).toBe(p);
    expect(rec.data.costCents).toBeNull(); // no cost was invented or copied from the project
    expect(rec.data.txnRefs).toEqual([]);
  });
  it('linking and unlinking never changes projects, commitments or Finance', async () => {
    const d = fresh();
    await d.accounts.add({ name: 'Test Checking', kind: 'checking', openingBalanceCents: 5 } as never);
    const a = await createAsset(blankAsset({ name: 'Deck' }), d);
    const p = await proj(d, 'Deck build');
    await addTxn(d, -1000, { project: { projectId: p } });
    const before = await financeSnap(d);
    await linkProjectToAsset(p, a, d);
    await unlinkProjectFromAsset(p, a, d);
    await linkProjectToAsset(p, a, d);
    expect(await financeSnap(d)).toBe(before);
  });
});
