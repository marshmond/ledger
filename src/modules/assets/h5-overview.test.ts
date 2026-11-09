import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { queryProviders } from '../../core/dueProvider';
import { allTodayCards } from '../../core/registry';
import { exportAll, importAll } from '../../lib/backup';
import { checkBackupText } from '../../lib/backupFile';
import { dexieMeta, RemoteConflict, SyncEngine, type RemoteFile, type RemoteStore } from '../../lib/sync/engine';
import { installTracking } from '../../lib/sync/track';
import { createStore } from '../../core/store';
import { completeTask, createTask } from '../tasks/data';
import { blankTask } from '../tasks/model';
import type { Txn } from '../../types';
import { assetRef, createAsset, setAssetStatus, updateAsset, archiveAsset } from './data';
import { assetsModule } from './index';
import { blankAsset } from './model';
import { buildSpending, rootOf, taskAssetMap } from './overview';
import { loadAssetLinks, loadOverview } from './overviewData';
import { attentionRows } from './overviewText';
import { blankService } from './service';
import { createService, logTaskService } from './serviceData';
import { searchAssetsData } from './searchSource';
import { costRecords } from './spending';
import { ASSETS_TODAY_CARDS } from './todayCards';
import { makeTxnRef } from './txnRef';
import { blankWarranty } from './warranty';
import { createWarranty } from './warrantyData';
import { assetDueItems } from './dueProvider';

/** Invented data only. Each test gets its own database. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-h5-${n++}`); installTracking(d); return d; };
const TODAY = '2026-11-06';
const mk = (d: FinanceDB, name: string, over = {}) => createAsset(blankAsset({ name, ...over }), d);
const task = (d: FinanceDB, title: string, due: string | null, assetIds: number[]) => createTask(blankTask({ title, dueDate: due }), assetIds.map(assetRef), d);
const addTxn = (d: FinanceDB, amountCents: number, over: Partial<Txn> = {}) =>
  d.txns.add({ accountId: 1, date: '2026-03-02', amountCents, payee: 'Hardware Co', memo: '', status: 'cleared', categoryId: 5, ...over } as Txn);
const live = async (d: FinanceDB, id: number) => (await d.txns.get(id))!;
const svc = (assetId: number, over = {}) => blankService(assetId, { title: 'Replaced pump', date: '2026-10-01', kind: 'repair', ...over });
const ov = (d: FinanceDB, period = 'all', today = TODAY) => loadOverview(period, today, d);

describe('H5 overview: needs attention, upcoming maintenance', () => {
  it('lists a task linked to several assets once, overdue first by date, with all asset ids', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace'), b = await mk(d, 'Boiler'), c = await mk(d, 'Roof');
    await task(d, 'Replace filters', '2026-11-01', [a, b]);
    await task(d, 'Gutters', '2026-12-15', [c]);
    await task(d, 'Undated chore', null, [c]);
    const o = await ov(d);
    expect(o.upcoming.map((m) => m.title)).toEqual(['Replace filters', 'Gutters']);
    expect(o.upcoming[0]).toMatchObject({ overdue: true, assetIds: [a, b] });
    expect(o.upcoming[1].overdue).toBe(false);
    expect(o.attention.overdueTasks).toHaveLength(1); // the task, not one per asset
    expect(o.attention.overdueAssetIds).toEqual([a, b]);
    expect(o.upcomingTotal).toBe(2);
  });
  it('uses Tasks\' rule: due today is not overdue, done tasks are not upcoming', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace');
    await task(d, 'Due today', TODAY, [a]);
    const done = await task(d, 'Finished', '2026-10-01', [a]);
    await completeTask(done, TODAY, d);
    const o = await ov(d);
    expect(o.attention.overdueTasks).toHaveLength(0);
    expect(o.upcoming.map((m) => m.title)).toEqual(['Due today']);
  });
  it('shows nothing alarming for archived, sold, disposed or replaced assets', async () => {
    const d = fresh();
    const arch = await mk(d, 'Old Fan'), sold = await mk(d, 'Old Car', { warrantyEndDate: '2026-11-20' }), stored = await mk(d, 'Spare Heater', { warrantyEndDate: '2026-11-20' });
    await task(d, 'Fan oiling', '2026-10-01', [arch]);
    await task(d, 'Car service', '2026-10-01', [sold]);
    await archiveAsset(arch, d);
    await setAssetStatus(sold, { status: 'sold', statusDate: TODAY, statusNote: '', replacedById: null }, d);
    await setAssetStatus(stored, { status: 'stored', statusDate: TODAY, statusNote: '', replacedById: null }, d);
    const o = await ov(d);
    expect(o.attention.overdueTasks).toHaveLength(0);
    expect(o.upcoming).toHaveLength(0);
    expect(o.attention.expiringWarranties.map((w) => w.assetId)).toEqual([stored]); // stored still counts, as on the Calendar
  });
  it('a task linked to a retired AND an in-use asset still counts, for the in-use one', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace'), b = await mk(d, 'Old Furnace');
    await task(d, 'Filter', '2026-10-01', [a, b]);
    await setAssetStatus(b, { status: 'disposed', statusDate: TODAY, statusNote: '', replacedById: null }, d);
    const o = await ov(d);
    expect(o.upcoming[0].assetIds).toEqual([a]);
  });
  it('ignores links to a missing asset, and empty data gives an empty, safe overview', async () => {
    const d = fresh();
    const o = await ov(d);
    expect(o.counts).toEqual({ inUse: 0, total: 0 });
    expect(attentionRows(o.attention)).toEqual([]);
    expect(o.upcoming).toEqual([]);
    expect(o.recent).toEqual([]);
    expect(o.spending.household.totalCents).toBe(0);
    expect(taskAssetMap([{ id: 1, fromModule: 'tasks', fromId: 5, toModule: 'assets', toId: 'asset:99', type: 'about' } as never], new Set([1])).size).toBe(0);
  });
  it('reads links with one range query and finds both directions', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace');
    await task(d, 'Filter', '2026-12-01', [a]);
    const links = await loadAssetLinks(d);
    expect(links).toHaveLength(1);
    expect(links[0].fromModule === 'assets' || links[0].toModule === 'assets').toBe(true);
  });
});

describe('H5 overview: warranties', () => {
  it('uses H4\'s 60-day window with the end day included, the implicit warranty once, and ignores expired ones', async () => {
    const d = fresh();
    const edge = await mk(d, 'Edge', { warrantyEndDate: '2027-01-05' }); // exactly 60 days after 2026-11-06
    await mk(d, 'Far', { warrantyEndDate: '2027-01-06' });
    await mk(d, 'Gone', { warrantyEndDate: '2026-11-05' });
    const today = await mk(d, 'Today', { warrantyEndDate: TODAY });
    const both = await mk(d, 'Both', { warrantyEndDate: '2026-11-10' }); // implicit, hidden once a real one exists
    await createWarranty(blankWarranty(both, { title: 'Extended', endDate: '2026-12-01' }), d);
    const o = await ov(d);
    expect(o.attention.expiringWarranties.map((w) => [w.assetId, w.endDate, w.title])).toEqual([
      [today, TODAY, 'Warranty'], [both, '2026-12-01', 'Extended'], [edge, '2027-01-05', 'Warranty'],
    ]);
    expect(o.attention.expiringWarranties[0].daysLeft).toBe(0);
  });
  it('agrees with the Calendar provider: same assets and dates, no second calculation', async () => {
    const d = fresh();
    const a = await mk(d, 'Dishwasher'), b = await mk(d, 'Oven');
    await createWarranty(blankWarranty(a, { title: 'Parts', endDate: '2026-12-20' }), d);
    await createWarranty(blankWarranty(a, { title: 'Labour', endDate: '2026-11-30' }), d);
    await createWarranty(blankWarranty(b, { title: 'Parts', endDate: '2030-01-01' }), d);
    const o = await ov(d);
    const cal = await assetDueItems(d, { from: TODAY, to: '2027-01-05', today: TODAY, overdueDays: 0 });
    expect(o.attention.expiringWarranties.map((w) => w.endDate)).toEqual(cal.map((c) => c.date));
    expect(o.attention.expiringWarranties).toHaveLength(2);
  });
  it('does not show a warranty of a retired or archived asset', async () => {
    const d = fresh();
    const a = await mk(d, 'Old TV', { warrantyEndDate: '2026-11-20' });
    await setAssetStatus(a, { status: 'replaced', statusDate: TODAY, statusNote: '', replacedById: null }, d);
    expect((await ov(d)).warranties).toHaveLength(0);
  });
});

describe('H5 overview: service history', () => {
  it('lists recent work newest first, with cost shown as amount / not recorded / needs review, never $0 for unknown', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace');
    const t = await addTxn(d, -4500);
    await createService(svc(a, { title: 'Typed', date: '2026-10-01', costCents: 2500 }), d, TODAY);
    await createService(svc(a, { title: 'From Finance', date: '2026-10-05', txnRefs: [makeTxnRef(await live(d, t))] }), d, TODAY);
    await createService(svc(a, { title: 'Unknown cost', date: '2026-10-09' }), d, TODAY);
    await createService(svc(a, { title: 'Free', date: '2026-10-03', costCents: 0 }), d, TODAY);
    await d.txns.update(t, { splits: undefined });
    const o = await ov(d);
    expect(o.recent.map((r) => r.service.data.title)).toEqual(['Unknown cost', 'From Finance', 'Free', 'Typed']);
    expect(o.recent.map((r) => r.cost)).toEqual([{ kind: 'none' }, { kind: 'amount', cents: 4500 }, { kind: 'amount', cents: 0 }, { kind: 'amount', cents: 2500 }]);
  });
  it('a job logged from a task appears once (the service record), and the finished task is not also "unsaved"', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace');
    const t = await task(d, 'Replace filter', '2026-11-01', [a]);
    await logTaskService({ taskId: t, complete: true, today: TODAY, data: svc(a, { title: 'Replace filter', date: TODAY }) }, d);
    const o = await ov(d);
    expect(o.recent).toHaveLength(1);
    expect(o.attention.unsaved).toHaveLength(0);
  });
  it('a task completed elsewhere is one "unsaved" row even on two assets; saving it on one clears it for that asset only', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace'), b = await mk(d, 'Boiler');
    const t = await task(d, 'Service both', '2026-11-01', [a, b]);
    await completeTask(t, TODAY, d);
    let o = await ov(d);
    expect(o.attention.unsaved).toEqual([{ taskId: t, title: 'Service both', assetIds: [a, b] }]);
    await createService(svc(a, { taskId: t, title: 'Service both', date: TODAY }), d, TODAY);
    o = await ov(d);
    expect(o.attention.unsaved).toEqual([{ taskId: t, title: 'Service both', assetIds: [b] }]); // H2's per-asset rule, counted once per task
  });
  it('flags two records for one task as a possible duplicate (H2 rule)', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace');
    const t = await task(d, 'Filter', '2026-11-01', [a]);
    await completeTask(t, TODAY, d);
    await d.moduleRecords.bulkAdd([2, 3].map((i) => ({ module: 'assets', kind: 'service', createdAt: i, updatedAt: i, data: { ...svc(a, { taskId: t, date: TODAY }) } as never })));
    expect((await ov(d)).attention.duplicateJobs).toBe(1);
  });
});

describe('H5 overview: spending', () => {
  it('counts a payment once across assets and across a property and what is inside it', async () => {
    const d = fresh();
    const home = await mk(d, 'Home', { type: 'property' }), fur = await mk(d, 'Furnace', { parentId: home }), car = await mk(d, 'Car', { type: 'vehicle' });
    const t = await addTxn(d, -10000);
    const ref = makeTxnRef(await live(d, t));
    await createService(svc(home, { title: 'Whole-house job', txnRefs: [ref] }), d, TODAY);
    await createService(svc(fur, { title: 'Furnace part', txnRefs: [ref] }), d, TODAY); // same payment, linked twice
    await createService(svc(car, { title: 'Tyres', costCents: 6000, date: '2026-10-02' }), d, TODAY);
    const s = (await ov(d)).spending;
    expect(s.household.totalCents).toBe(16000);
    expect(s.household.financeCents).toBe(10000);
    expect(s.household.manualCents).toBe(6000);
    expect(s.household.sharedPieces).toHaveLength(1);
    expect(s.places.map((p) => [p.name, p.summary.totalCents])).toEqual([['Home', 10000], ['Car', 6000]]);
    expect(s.places.find((p) => p.name === 'Home')!.summary.pieces).toHaveLength(1);
    expect(s.placesSumCents).toBe(16000);
  });
  it('places can add up to more than the household when one payment is linked from two properties; the household counts it once', async () => {
    const d = fresh();
    const h1 = await mk(d, 'House', { type: 'property' }), h2 = await mk(d, 'Cabin', { type: 'property' });
    const t = await addTxn(d, -8000);
    const ref = makeTxnRef(await live(d, t));
    await createService(svc(h1, { txnRefs: [ref] }), d, TODAY);
    await createService(svc(h2, { title: 'Other', txnRefs: [ref] }), d, TODAY);
    const s = (await ov(d)).spending;
    expect(s.household.totalCents).toBe(8000);
    expect(s.placesSumCents).toBe(16000);
  });
  it('a year narrows by each piece\'s OWN date: transaction date for Finance links, service date for typed costs', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace', { purchaseDate: '2025-06-01', purchaseCents: 90000 });
    const t25 = await addTxn(d, -3000, { date: '2025-12-30' }), t26 = await addTxn(d, -4000, { date: '2026-01-02' });
    // one record paid across the new year: split by reference, not by the record's date
    await createService(svc(a, { title: 'Two payments', date: '2026-01-10', txnRefs: [makeTxnRef(await live(d, t25)), makeTxnRef(await live(d, t26))] }), d, TODAY);
    await createService(svc(a, { title: 'Typed 2026', date: '2026-05-01', costCents: 500 }), d, TODAY);
    await createService(svc(a, { title: 'Typed 2025', date: '2025-05-01', costCents: 700 }), d, TODAY);
    const o25 = (await ov(d, '2025')).spending.household, o26 = (await ov(d, '2026')).spending.household, all = (await ov(d, 'all')).spending.household;
    expect(o25.totalCents).toBe(90000 + 3000 + 700);
    expect(o26.totalCents).toBe(4000 + 500);
    expect(all.totalCents).toBe(o25.totalCents + o26.totalCents);
    expect((await ov(d, '2026')).spending.years).toEqual(['2026', '2025']);
    // boundaries are whole calendar years
    const edge = fresh();
    const e = await mk(edge, 'Edge');
    await createService(svc(e, { title: 'Dec 31', date: '2026-12-31', costCents: 100 }), edge, '2026-12-31');
    await createService(svc(e, { title: 'Jan 1', date: '2027-01-01', costCents: 200 }), edge, '2027-01-01');
    expect((await ov(edge, '2026')).spending.household.totalCents).toBe(100);
    expect((await ov(edge, '2027')).spending.household.totalCents).toBe(200);
  });
  it('a typed purchase cost with no date is never put in a year; it is reported and appears under All time', async () => {
    const d = fresh();
    await mk(d, 'Old Fridge', { purchaseCents: 50000 });
    const y = (await ov(d, '2026')).spending, all = (await ov(d, 'all')).spending;
    expect(y.household.totalCents).toBe(0);
    expect(y.undatedTyped).toBe(1);
    expect(all.household.totalCents).toBe(50000);
    expect(all.undatedTyped).toBe(0);
  });
  it('unknown cost is reported, not $0; project money is never part of it', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace');
    await createService(svc(a, { title: 'No cost known', date: '2026-10-01' }), d, TODAY);
    const s = (await ov(d, '2026')).spending.household;
    expect(s.totalCents).toBe(0);
    expect(s.unknown).toHaveLength(1);
    expect(JSON.stringify(Object.keys(s))).not.toMatch(/project/i);
  });
  it('a stale reference (split changed, transaction deleted, turned into a transfer) is left out and counted for review, in a year and for all time', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace');
    const sp = await addTxn(d, -3000, { categoryId: null, splits: [{ categoryId: 5, amountCents: -1000 }, { categoryId: 6, amountCents: -2000 }] });
    const gone = await addTxn(d, -700), tr = await addTxn(d, -900), ok = await addTxn(d, -1200);
    const refs = [makeTxnRef(await live(d, sp), 1), makeTxnRef(await live(d, gone)), makeTxnRef(await live(d, tr)), makeTxnRef(await live(d, ok))];
    await createService(svc(a, { title: 'Big job', date: '2026-10-01', txnRefs: refs }), d, TODAY);
    expect((await ov(d)).spending.household.totalCents).toBe(2000 + 700 + 900 + 1200);
    await d.txns.update(sp, { splits: [{ categoryId: 5, amountCents: -1500 }, { categoryId: 6, amountCents: -1500 }] }); // part moved
    await d.txns.delete(gone);
    await d.txns.update(tr, { transferTxnId: 77 });
    const o = await ov(d, '2026');
    expect(o.spending.household.totalCents).toBe(1200);
    expect(o.spending.household.review).toHaveLength(3);
    expect(o.attention.reviewRefs).toBe(3);
    expect(attentionRows(o.attention).find((r) => r.id === 'review')!.text).toMatch(/^3 linked payments need a second look/);
  });
  it('shows the lifetime review count in attention even while a different year is selected', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace');
    const t = await addTxn(d, -700, { date: '2024-02-02' });
    await createService(svc(a, { date: '2024-02-02', txnRefs: [makeTxnRef(await live(d, t))] }), d, '2026-11-06');
    await d.txns.delete(t);
    const o = await ov(d, '2026');
    expect(o.spending.household.review).toHaveLength(0);
    expect(o.attention.reviewRefs).toBe(1);
  });
  it('rootOf is cycle-proof and stops at the top of the chain', async () => {
    const d = fresh();
    const home = await mk(d, 'Home', { type: 'property' }), room = await mk(d, 'Kitchen', { type: 'area', parentId: home }), fur = await mk(d, 'Oven', { parentId: room });
    const { loadAssets } = await import('./data');
    const all = await loadAssets(d);
    expect(rootOf(all, fur)).toBe(home);
    const loop = all.map((x) => (x.id === home ? { ...x, data: { ...x.data, parentId: fur } } : x));
    expect(() => rootOf(loop, fur)).not.toThrow();
  });
  it('does not alter the engine\'s own numbers: the household figure equals spend() over every record', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace', { purchaseCents: 1000 });
    await createService(svc(a, { costCents: 250 }), d, TODAY);
    const { loadAssets } = await import('./data');
    const { loadServices } = await import('./serviceData');
    const { spend } = await import('./spending');
    const assets = await loadAssets(d), services = await loadServices(d);
    expect(buildSpending(assets, services, () => undefined, 'all').household).toEqual(spend(costRecords(assets, services), () => undefined));
  });
});

describe('H5 orphans, Today card, privacy', () => {
  it('counts orphans through the existing H4 detector', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace');
    await createService(svc(a, { costCents: 100 }), d, TODAY);
    await d.moduleRecords.where('[module+kind]').equals(['assets', 'asset']).modify({ deletedAt: 1 } as never);
    const o = await ov(d);
    expect(o.attention.orphans).toBeGreaterThan(0);
    expect(attentionRows(o.attention).some((r) => r.id === 'orphans')).toBe(true);
  });
  it('registers one hidden-when-empty, half-width card with an id starting "assets."', () => {
    expect(ASSETS_TODAY_CARDS).toHaveLength(1);
    expect(ASSETS_TODAY_CARDS[0]).toMatchObject({ id: 'assets.attention', title: 'Home & Assets', defaultWidth: 'half', hideWhenEmpty: true });
    expect(allTodayCards([assetsModule]).map((c) => c.id)).toEqual(['assets.attention']);
  });
  it('card text is counts only: no asset names, task titles, amounts or private fields; links go only into Home & Assets', async () => {
    const d = fresh();
    const a = await mk(d, 'Secret Boiler', { serialNumber: 'SN-ABC-1234', warrantyEndDate: '2026-11-20' });
    const p = await mk(d, 'Beach House', { type: 'property', address: '12 Imaginary Lane' });
    await task(d, 'Bleed radiators Q', '2026-10-01', [a, p]);
    const t = await addTxn(d, -123456);
    await createService(svc(a, { title: 'Pump swap', txnRefs: [makeTxnRef(await live(d, t))] }), d, TODAY);
    await d.txns.delete(t);
    const rows = attentionRows((await ov(d)).attention);
    const text = JSON.stringify(rows);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const bad of ['Secret Boiler', 'Beach House', 'SN-ABC', 'Imaginary', 'Bleed', 'Pump swap', '1,234', '123456', '$']) expect(text).not.toContain(bad);
    expect(rows.every((r) => r.href.startsWith('#/assets'))).toBe(true);
    expect(rows.find((r) => r.id === 'overdue')!.text).toBe('Maintenance is overdue on 2 assets'); // the task itself stays in Tasks' own cards
  });
  it('no row repeats an overdue task title, so Today does not list one task twice', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace');
    await task(d, 'Change filter', '2026-10-01', [a]);
    expect(JSON.stringify(attentionRows((await ov(d)).attention))).not.toContain('Change filter');
  });
  it('the card hides when nothing needs attention (no rows), and warranty dates are not turned into Calendar or Task items', async () => {
    const d = fresh();
    await mk(d, 'Furnace', { warrantyEndDate: '2030-01-01' });
    expect(attentionRows((await ov(d)).attention)).toEqual([]);
    const before = await d.moduleRecords.count();
    await ov(d); await ov(d, '2026');
    expect(await d.moduleRecords.count()).toBe(before); // reading writes nothing
    expect(await d.links.count()).toBe(0);
    const items = await queryProviders({ from: '2026-01-01', to: '2030-12-31', today: TODAY, overdueDays: 0 }, [{ id: 'assets', layerName: 'x', color: '#000', getDueItems: (q) => assetDueItems(d, q) }]);
    expect(items.assets).toHaveLength(1); // the Calendar's own marker is the only date item; this card adds none
  });
  it('searching is unchanged and shows no private field', async () => {
    const d = fresh();
    await mk(d, 'Dishwasher', { serialNumber: 'SN-777-XYZ-99' });
    const { loadAssets } = await import('./data');
    const hits = searchAssetsData('dishwasher', await loadAssets(d));
    expect(JSON.stringify(hits)).not.toContain('SN-777');
    expect(hits.length).toBeGreaterThan(0);
  });
});

describe('H5 backup, restore and the real sync engine', () => {
  it('a restored backup gives the same overview', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace', { warrantyEndDate: '2026-11-20' });
    await task(d, 'Filter', '2026-10-01', [a]);
    await createService(svc(a, { costCents: 900 }), d, TODAY);
    const text = JSON.stringify(await exportAll(d));
    const target = new FinanceDB(`test-h5-restore-${n++}`);
    await target.open();
    await importAll(target, checkBackupText(text).file);
    expect(await ov(target)).toEqual(await ov(d));
  });
  it('a service record and a warranty created on device A show up in device B\'s overview after a sync, and the two overviews agree', async () => {
    let puts = 0;
    let file: RemoteFile | null = null;
    const remote: RemoteStore = {
      async getFile() { return file ? { sha: file.sha, bytes: file.bytes.slice() } : null; },
      async putFile(bytes, sha) { if ((file?.sha ?? undefined) !== sha) throw new RemoteConflict('stale'); puts++; file = { sha: `sha${puts}`, bytes: bytes.slice() }; return file.sha; },
    };
    const mkd = () => { const d = fresh(); return { d, engine: new SyncEngine(d, dexieMeta(`h5-meta-${n++}`), remote, 'a good passphrase') }; };
    const A = mkd(), B = mkd();
    const a = await mk(A.d, 'Furnace');
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    await createService(svc(a, { costCents: 1500 }), A.d, TODAY);
    await createWarranty(blankWarranty(a, { title: 'Parts', endDate: '2026-12-01' }), A.d);
    for (let i = 0; i < 2; i++) { await A.engine.sync(); await B.engine.sync(); }
    await A.engine.sync();
    const oa = await ov(A.d), ob = await ov(B.d);
    expect(ob.recent).toHaveLength(1);
    expect(ob.warranties).toHaveLength(1);
    expect(ob.spending.household.totalCents).toBe(1500);
    expect({ ...ob, recent: ob.recent.map((r) => r.cost) }).toEqual({ ...oa, recent: oa.recent.map((r) => r.cost) });
  });
  it('reading the overview changes no table and needs no schema change', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace', { purchaseCents: 100 });
    await updateAsset(a, { ...(await (await import('./data')).getAsset(a, d))!.data }, d);
    const snap = async () => JSON.stringify([await d.moduleRecords.toArray(), await d.links.toArray(), await d.txns.toArray()]);
    const before = await snap();
    await ov(d); await ov(d, '2026');
    expect(await snap()).toBe(before);
    expect(createStore(d)).toBeTruthy();
    expect(d.verno).toBe(15);
  });
});

describe('H5 overview performance (invented dataset)', () => {
  it('reads a large household in one pass, quickly, and gives plausible counts', async () => {
    const d = fresh();
    const home = await mk(d, 'Big House', { type: 'property' });
    const ids: number[] = [];
    for (let i = 0; i < 300; i++) ids.push(await mk(d, `Item ${i}`, { parentId: i % 10 === 0 ? home : ids[i - 1] ?? home, warrantyEndDate: i % 7 === 0 ? '2026-12-01' : null }));
    const txns: number[] = [];
    for (let i = 0; i < 100; i++) txns.push(await addTxn(d, -1000 - i, { date: '2026-05-05' }));
    for (let i = 0; i < 300; i++) await createService(svc(ids[i], { title: `Job ${i}`, date: '2026-0' + (1 + (i % 9)) + '-10', ...(i < 100 ? { txnRefs: [makeTxnRef(await live(d, txns[i]))] } : { costCents: 500 }) }), d, TODAY);
    for (let i = 0; i < 400; i++) await task(d, `Task ${i}`, i % 3 === 0 ? '2026-10-01' : '2027-01-01', [ids[i % 300], ids[(i + 1) % 300]]);
    for (let i = 0; i < 100; i++) await createWarranty(blankWarranty(ids[i], { title: 'W', endDate: '2026-12-15' }), d);
    const t0 = performance.now();
    const o = await ov(d, '2026');
    const ms = performance.now() - t0;
    expect(o.counts.total).toBe(301);
    expect(o.upcoming).toHaveLength(6);
    expect(o.upcomingTotal).toBe(400);
    expect(o.attention.overdueTasks.length).toBe(134);
    expect(o.spending.household.totalCents).toBe(o.spending.household.financeCents + o.spending.household.manualCents);
    expect(ms).toBeLessThan(5000); // generous: this is a regression tripwire, not a benchmark
    console.log(`H5 overview, 301 assets / 400 tasks / 300 services / 100 warranties: ${Math.round(ms)} ms`);
  });
});
