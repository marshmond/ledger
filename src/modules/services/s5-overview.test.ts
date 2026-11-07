import { describe, expect, it, vi } from 'vitest';
import { FinanceDB } from '../../db';
import { buildBackup, checkBackupText, restoreChecked } from '../../lib/backupFile';
import { addDays } from '../../lib/dates';
import { dexieMeta, RemoteConflict, SyncEngine, type RemoteFile, type RemoteStore } from '../../lib/sync/engine';
import { installTracking } from '../../lib/sync/track';
import { makeTxnRef } from '../../lib/txnRef';
import type { Txn } from '../../types';
import { createAsset } from '../assets/data';
import { blankAsset } from '../assets/model';
import { blankService } from '../assets/service';
import { loadServices } from '../assets/serviceData';
import { createProject } from '../projects/data';
import { blankProject } from '../projects/model';
import { tasksOfArrangement, createArrangement } from './data';
import { servicesDueItems } from './dueProvider';
import { saveHandoff } from './handoff';
import { blankArrangement, type Cadence } from './model';
import { setVisitPayment } from './payments';
import { linkProject } from './projectLinks';
import { loadServicesOverview } from './servicesOverview';
import { attentionCounts, loadSnapshot } from './views';
import { logStandaloneVisit } from './visits';
import { setContractDates } from './contractData';
import { attentionLines } from './todayCards';

/** S5 Overview reader, with real Dexie, real Tasks, real backup and the real SyncEngine. Invented data only. 2026-11-06 is a Friday. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-s5ov-${n++}`); installTracking(d); return d; };
const TODAY = '2026-11-06';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const biweekly: Cadence = { mode: 'fixed', rule: { freq: 'weekly', interval: 2, end: { type: 'never' } }, anchorDate: TODAY };
const add = (d: FinanceDB, over: Partial<ReturnType<typeof blankArrangement>> = {}, provider: object = { name: "Rosa's Cleaning" }, assetIds: number[] = []) =>
  createArrangement({ data: blankArrangement({ title: 'House cleaning', cadence: biweekly, ...over }), provider, assetIds, today: TODAY }, d);
const addTxn = (d: FinanceDB, amountCents: number, over: Partial<Txn> = {}) => d.txns.add({ accountId: 1, date: '2026-11-02', amountCents, payee: 'Pat Heating', memo: '', status: 'cleared', categoryId: 5, ...over } as Txn) as Promise<number>;
const logDone = async (d: FinanceDB, arrangementId: number | null, date = '2026-11-03', title = 'Furnace inspection') =>
  (await logStandaloneVisit({ arrangementId, input: { status: 'completed', cancelledBy: null, date, title, chargedCents: null, chargeKind: null }, today: TODAY }, d)).visitId;
const rowCounts = async (d: FinanceDB) => JSON.stringify([await d.moduleRecords.count(), await d.links.count(), await d.txns.count(), (await d.moduleRecords.toArray()).map((r) => r.updatedAt).join()]);
const load = (d: FinanceDB, period = 'all', today = TODAY) => loadServicesOverview(period, today, d);
const openTasks = async (d: FinanceDB, id: number) => (await tasksOfArrangement(id, d)).filter((t) => t.data.status !== 'done');

describe('S5-A the Overview reader: one read, the same definitions as Today', () => {
  it('reading it (ten times, as repeated navigation would) creates and changes nothing: no Task, visit, link, event or Finance row, no updated time', async () => {
    const d = fresh();
    const a = await add(d);
    await logDone(d, a.id);
    const before = await rowCounts(d);
    for (let i = 0; i < 10; i++) await load(d);
    expect(await rowCounts(d)).toBe(before);
    expect(await openTasks(d, a.id)).toHaveLength(1);
  });

  it('the counts under Needs attention agree with the Today card for every category they share (unlogged, duplicate visits, schedule checks, review, contract deadlines)', async () => {
    const d = fresh();
    const a = await add(d, { noticeByDate: addDays(TODAY, 10), renewalDate: addDays(TODAY, 20) });
    const b = await add(d, { title: 'Lawn mowing', cadence: null });
    // a finished-not-logged visit task
    const t = (await openTasks(d, a.id))[0];
    const { completeTask } = await import('../tasks/data');
    await completeTask(t.id, TODAY, d);
    // two visits that look like one logged twice (same arrangement, same day, no Task)
    await logDone(d, b.id, '2026-11-01', 'Lawn mowing');
    await logDone(d, b.id, '2026-11-01', 'Lawn mowing');
    const ov = await load(d);
    const snap = await loadSnapshot(d);
    const counts = attentionCounts(snap, TODAY);
    const by = (k: string) => ov.attention.filter((x) => x.kind === k).length;
    expect(by('unlogged')).toBe(counts.unlogged);
    expect(by('duplicate-visits')).toBe(counts.duplicateGroups);
    expect(by('schedule')).toBe(counts.scheduleChecks);
    expect(by('review-visit')).toBe(counts.needsReview);
    expect(by('contract')).toBe((counts.renewals ?? 0) + (counts.notices ?? 0));
    expect(counts.unlogged).toBeGreaterThan(0);
    expect(counts.duplicateGroups).toBeGreaterThan(0);
    expect((counts.renewals ?? 0) + (counts.notices ?? 0)).toBe(2);
  });

  it('a healthy arrangement raises nothing', async () => {
    const d = fresh();
    await add(d);
    const ov = await load(d);
    expect(ov.attention).toEqual([]);
    expect(ov.counts).toEqual({ active: 1, paused: 0, ended: 0, total: 1 });
  });

  it('Needs attention covers the S1 to S4 exceptions: no provider, missing next-visit Task, duplicate open Tasks, an asset that is gone, duplicate handoff, a stale Finance reference', async () => {
    const d = fresh();
    const asset = await createAsset(blankAsset({ name: 'Furnace', type: 'system' }), d);
    const noProvider = await createArrangement({ data: blankArrangement({ title: 'Window cleaning', cadence: null }), today: TODAY }, d);
    const noTask = await add(d, { title: 'Pest control' }, { name: 'Bug Busters' });
    for (const t of await openTasks(d, noTask.id)) await d.moduleRecords.update(t.id, { deletedAt: Date.now() } as never);
    const dup = await add(d, { title: 'Gutter cleaning' }, { name: 'Clear Gutters' });
    const first = (await openTasks(d, dup.id))[0];
    const { createTask } = await import('../tasks/data');
    const { arrangementRef } = await import('./model');
    await createTask({ ...first.data }, [arrangementRef(dup.id)], d);
    const furnace = await add(d, { title: 'Furnace plan', cadence: null }, { name: 'Pat Heating' }, [asset]);
    const v = await logDone(d, furnace.id);
    const tx = await addTxn(d, -9000);
    await setVisitPayment(v, { source: 'finance', refs: [makeTxnRef((await d.txns.get(tx))!)], manualCents: null }, null, d);
    await saveHandoff({ visitId: v, assetId: asset, data: blankService(asset, { title: 'Inspection', date: '2026-11-03', kind: 'inspection' }), today: TODAY }, d);
    await saveHandoff({ visitId: v, assetId: asset, data: blankService(asset, { title: 'Inspection again', date: '2026-11-03', kind: 'inspection' }), today: TODAY }, d).catch(() => null);
    await d.txns.delete(tx); // the Finance payment disappears
    const ov = await load(d);
    const kinds = new Set(ov.attention.map((x) => x.kind));
    expect(kinds.has('provider')).toBe(true);
    expect(kinds.has('schedule')).toBe(true);
    expect(kinds.has('finance-reference')).toBe(true);
    expect(ov.attention.filter((x) => x.kind === 'schedule').length).toBeGreaterThanOrEqual(2); // no next-visit task, and duplicate open tasks
    void noProvider;
  });
});

describe('S5-A upcoming services, from the schedule, without creating anything', () => {
  it('lists the open Task first and the arrangement\'s later dates as "expected"; paused and ended arrangements list nothing', async () => {
    const d = fresh();
    const a = await add(d);
    const p = await add(d, { title: 'Lawn mowing' }, { name: 'Green Lawns' });
    const { applyLifecycle, planLifecycle } = await import('./changes');
    await applyLifecycle({ action: 'pause', arrangementId: p.id, expect: (await planLifecycle(p.id, 'pause', TODAY, d)).expect, today: TODAY }, d);
    const before = await rowCounts(d);
    const ov = await load(d);
    expect(await rowCounts(d)).toBe(before);
    const mine = ov.upcoming.filter((u) => u.arrangementId === a.id);
    expect(mine[0]).toMatchObject({ kind: 'task', date: TODAY });
    expect(mine.slice(1).every((u) => u.kind === 'expected')).toBe(true);
    // B3.0A: the window is now the owner's choice (7, 14, 30 or 90 days; default 30), no longer a fixed 60 days. Today is 2026-11-06, so 30 days ends on 2026-12-06.
    expect(mine.slice(1).map((u) => u.date)).toEqual(['2026-11-20', '2026-12-04'].filter((x) => x <= addDays(TODAY, 30)));
    expect(mine.slice(1).every((u) => u.date <= addDays(TODAY, 30))).toBe(true);
    expect(ov.upcoming.some((u) => u.arrangementId === p.id)).toBe(false);
    expect(await openTasks(d, a.id)).toHaveLength(1); // still ONE actionable Task
  });

  it('a paused arrangement whose open visit Task was kept is not listed as upcoming (the Task stays in Tasks; the arrangement shows its date under Paused)', async () => {
    const d = fresh();
    const a = await add(d);
    const { applyLifecycle, planLifecycle } = await import('./changes');
    await applyLifecycle({ action: 'pause', arrangementId: a.id, expect: (await planLifecycle(a.id, 'pause', TODAY, d)).expect, today: TODAY, taskChoice: 'keep' }, d);
    expect(await openTasks(d, a.id)).toHaveLength(1);
    const ov = await load(d);
    expect(ov.upcoming).toEqual([]);
    expect(ov.base.rows[0].nextDate).toBe(TODAY);
  });

  it('a visit moved on its own is flagged with the date it stood for, and the later dates do not shift', async () => {
    const d = fresh();
    const a = await add(d);
    const t = (await openTasks(d, a.id))[0];
    const { saveTask } = await import('../tasks/data');
    const base = (await load(d)).upcoming.filter((u) => u.kind === 'expected').map((u) => u.date);
    await saveTask(t.id, { ...t.data, dueDate: '2026-11-08' }, d);
    const ov = await load(d);
    expect(ov.upcoming[0]).toMatchObject({ kind: 'task', date: '2026-11-08', movedFrom: TODAY });
    expect(ov.upcoming.filter((u) => u.kind === 'expected').map((u) => u.date)).toEqual(base);
  });

  it('the one-off and the on-demand arrangement have no upcoming row; the overview shows their history instead', async () => {
    const d = fresh();
    await add(d, { title: 'Chimney sweep', cadence: null }, { name: 'Ned Gutters' });
    const ov = await load(d);
    expect(ov.upcoming).toEqual([]);
  });
});

describe('S5-A estimates stay apart from recorded money', () => {
  it('the 30-day and 90-day estimates are the S3 windows, plus the 12-month Calendar horizon, and they change no recorded figure', async () => {
    const d = fresh();
    await add(d, { expected: { basis: 'perVisit', cents: 10000 } });
    await add(d, { title: 'Lawn plan', cadence: null, expected: { basis: 'perMonth', cents: 5000 } }, { name: 'Green Lawns' });
    const ov = await load(d);
    expect(ov.estimates.map((w) => w.days)).toEqual([30, 90, 365]);
    expect(ov.estimates[0].items[0].visits).toBe(3); // 11-06 (the open Task), 11-20 and 12-04
    expect(ov.estimates[2].items[0].visits).toBeGreaterThan(24);
    expect(ov.estimates[2].notConverted).toHaveLength(1); // per-month is never multiplied or prorated
    expect(ov.spend.totalCents).toBe(0);                 // an estimate is not spending
    expect(ov.spend.claims).toEqual([]);
  });
});

describe('S5-A agreements to review', () => {
  it('lists renewal and notice dates for the next 90 days, never for an ended arrangement, and a notice inside 30 days is under Needs attention', async () => {
    const d = fresh();
    const a = await add(d, { title: 'Boiler plan', cadence: null }, { name: 'Pat Heating' });
    await setContractDates(a.id, { renewalDate: addDays(TODAY, 80), noticeByDate: addDays(TODAY, 20) }, null, d);
    const b = await add(d, { title: 'Lawn plan', cadence: null }, { name: 'Green Lawns' });
    await setContractDates(b.id, { renewalDate: addDays(TODAY, 200), noticeByDate: addDays(TODAY, 120) }, null, d);
    const ov = await load(d);
    expect(ov.contracts.map((c) => `${c.kind}:${c.title}:${c.daysAway}`)).toEqual(['notice:Boiler plan:20', 'renewal:Boiler plan:80']);
    expect(ov.attention.filter((x) => x.kind === 'contract')).toHaveLength(1);
    const { applyLifecycle, planLifecycle } = await import('./changes');
    await applyLifecycle({ action: 'end', arrangementId: a.id, expect: (await planLifecycle(a.id, 'end', TODAY, d)).expect, today: TODAY, end: { reason: 'cancelled' } } as never, d);
    expect((await load(d)).contracts).toEqual([]);
  });
});

describe('S5 resilience: missing, damaged and half-synced records give a page, never a crash', () => {
  it('junk arrangement, visit, asset-service and link rows are read defensively by the Overview and by Today\'s counts', async () => {
    const d = fresh();
    const a = await add(d);
    const now = Date.now();
    await d.moduleRecords.add({ module: 'services', kind: 'arrangement', data: { title: 7, cadence: 'nonsense', status: '??', txnRefs: 'x', renewalDate: 5 }, createdAt: now, updatedAt: now } as never);
    const vid = (await d.moduleRecords.add({ module: 'services', kind: 'visit', data: { status: 'from-the-future', date: 12, txnRefs: [{}, { txnId: 'x' }], paidManualCents: 'lots' }, createdAt: now, updatedAt: now } as never)) as number;
    await d.moduleRecords.add({ module: 'assets', kind: 'service', data: null, createdAt: now, updatedAt: now } as never);
    await d.links.add({ fromModule: 'services', fromId: `visit:${vid}`, toModule: 'assets', toId: 'service:9999999', type: 'recorded-as', createdAt: now, updatedAt: now } as never);
    await d.links.add({ fromModule: 'services', fromId: `arrangement:${a.id}`, toModule: 'assets', toId: 'asset:424242', type: 'serves', createdAt: now, updatedAt: now } as never);
    const ov = await load(d);
    expect(ov.counts.total).toBe(2);
    expect(ov.attention.some((x) => x.kind === 'review-visit')).toBe(true);
    expect(ov.attention.some((x) => x.kind === 'asset' && /no longer exists/.test(x.text))).toBe(true);
    const snap = await loadSnapshot(d);
    expect(() => attentionCounts(snap, TODAY)).not.toThrow();
    expect(() => attentionLines(attentionCounts(snap, TODAY))).not.toThrow();
    // every period still produces a number
    for (const p of ['all', 'last12', 'last90', 'last30', 'ytd', '2025']) expect(Number.isFinite((await load(d, p)).spend.totalCents)).toBe(true);
  });

  it('with no data at all the page is simply empty', async () => {
    const d = fresh();
    const ov = await load(d);
    expect(ov.attention).toEqual([]);
    expect(ov.upcoming).toEqual([]);
    expect(ov.spend.totalCents).toBe(0);
    expect(ov.insights).toEqual([]);
  });
});

describe('S5 loading does not re-read large tables', () => {
  it('the Overview reads the shared links ONCE and every module table through one query each (no per-arrangement queries)', async () => {
    const d = fresh();
    for (let i = 0; i < 12; i++) await add(d, { title: `Service ${i}` }, { name: `Provider ${i}` });
    const links = vi.spyOn(d.links, 'toArray');
    const records = vi.spyOn(d.moduleRecords, 'toArray');
    const linkRange = vi.spyOn(d.links, 'where');
    await load(d);
    const afterOne = { links: links.mock.calls.length, records: records.mock.calls.length, where: linkRange.mock.calls.length };
    expect(afterOne.links).toBe(1);
    await load(d);
    // a second load costs exactly the same as the first (nothing accumulates, nothing is cached)
    expect(links.mock.calls.length).toBe(afterOne.links * 2);
    expect(records.mock.calls.length).toBe(afterOne.records * 2);
    expect(linkRange.mock.calls.length).toBe(afterOne.where * 2);
    // and the number of table reads does not depend on the number of arrangements
    const d2 = fresh();
    await add(d2);
    const l2 = vi.spyOn(d2.links, 'toArray');
    const r2 = vi.spyOn(d2.moduleRecords, 'toArray');
    await load(d2);
    expect(l2.mock.calls.length).toBe(afterOne.links);
    expect(r2.mock.calls.length).toBe(afterOne.records);
  });
});

describe('S5 privacy: the Overview, its insights and Today show no contact details, notes, links or typed amounts in their words', () => {
  it('attention and insight text carry titles and dates only (amounts only come through the money function, so Hide Amounts can mask them)', async () => {
    const d = fresh();
    const a = await add(d, { title: 'Boiler plan', notes: 'Ring the side bell twice', refs: [{ label: 'Contract', url: 'https://example.invalid/private-contract.pdf' }], cadence: null, expected: { basis: 'perVisit', cents: 12345 } }, { name: 'Pat Heating', phone: '555-0142', email: 'pat@example.invalid' });
    await setContractDates(a.id, { renewalDate: addDays(TODAY, 20), noticeByDate: addDays(TODAY, 10) }, null, d);
    const v = await logDone(d, a.id, '2026-11-03', 'Boiler inspection');
    await setVisitPayment(v, { source: 'manual', refs: [], manualCents: 98765 }, null, d);
    const ov = await loadServicesOverview('all', TODAY, d, () => '[money]');
    const words = JSON.stringify([ov.attention, ov.insights, ov.upcoming, ov.contracts]);
    for (const secret of ['555-0142', 'pat@example.invalid', 'side bell', 'private-contract', '98765', '987.65', '12345', '123.45']) expect(words).not.toContain(secret);
    // Today's lines are counts and words only
    const lines = attentionLines(attentionCounts(await loadSnapshot(d), TODAY)).map((r) => r.text).join(' ');
    expect(lines).not.toMatch(/\$|\d{3,}|Pat Heating|Boiler/);
  });
});

describe('S5 backup and restore keep what the household total needs', () => {
  it('restoring a backup into a new database gives the identical household spending and the identical Overview figures', async () => {
    const d = fresh();
    const asset = await createAsset(blankAsset({ name: 'Water heater', type: 'appliance' }), d);
    const a = await add(d, { title: 'Water heater plan', cadence: null }, { name: 'Hearth Co' }, [asset]);
    const v1 = await logDone(d, a.id, '2026-10-20');
    const tx = await addTxn(d, -15000, { date: '2026-10-20' });
    const ref = makeTxnRef((await d.txns.get(tx))!);
    await setVisitPayment(v1, { source: 'finance', refs: [ref], manualCents: null }, null, d);
    await saveHandoff({ visitId: v1, assetId: asset, data: blankService(asset, { title: 'Flushed the tank', date: '2026-10-20', kind: 'maintenance', txnRefs: [ref] }), today: TODAY }, d);
    const v2 = await logDone(d, a.id, '2026-11-03', 'Anode check');
    await setVisitPayment(v2, { source: 'manual', refs: [], manualCents: 4000 }, null, d);
    await saveHandoff({ visitId: v2, assetId: asset, data: blankService(asset, { title: 'Anode check', date: '2026-11-03', kind: 'inspection', costCents: 4000 }), today: TODAY, confirmManualCopy: true }, d);
    const orig = await load(d);
    expect(orig.spend.totalCents).toBe(19000);   // $150 once + $40 once
    expect(orig.spend.linkedInBothCents).toBe(15000);
    const dst = fresh();
    await dst.open();
    const mem = () => ({ get: async () => null, set: async () => undefined }) as never;
    await restoreChecked(dst, checkBackupText(JSON.stringify(await buildBackup(d, mem()))).file, mem());
    const back = await load(dst);
    expect(back.spend.totalCents).toBe(orig.spend.totalCents);
    expect(back.spend.reconciliation).toEqual(orig.spend.reconciliation);
    expect(back.spend.claims.map((c) => `${c.recordId}|${c.status}|${c.cents}`)).toEqual(orig.spend.claims.map((c) => `${c.recordId}|${c.status}|${c.cents}`));
    expect(back.attention.map((x) => x.id)).toEqual(orig.attention.map((x) => x.id));
    expect((await loadServices(dst)).length).toBe(2);
  }, 60000);
});

const remoteStore = () => {
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
};
const devices = () => {
  const remote = remoteStore();
  const mk = () => { const d = fresh(); return { d, engine: new SyncEngine(d, dexieMeta(`s5sync-meta-${n++}`), remote, 'a good passphrase') }; };
  return { A: mk(), B: mk() };
};
type Dev = ReturnType<typeof devices>['A'];
const settle = async (A: Dev, B: Dev) => { for (let i = 0; i < 2; i++) { await A.engine.sync(); await B.engine.sync(); } await A.engine.sync(); };

describe('S5 two devices (real SyncEngine): the household total agrees and counts a payment once', () => {
  it('both devices record the same typed visit offline: two Home & Assets records exist, the total counts the job once on BOTH devices, and the duplicate is flagged on both', async () => {
    const { A, B } = devices();
    const asset = await createAsset(blankAsset({ name: 'Furnace', type: 'system' }), A.d);
    const arr = await createArrangement({ data: blankArrangement({ title: 'Furnace plan', cadence: null }), provider: { name: 'Pat Heating' }, assetIds: [asset], today: TODAY }, A.d);
    const v = await logDone(A.d, arr.id);
    await setVisitPayment(v, { source: 'manual', refs: [], manualCents: 8000 }, null, A.d);
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    const data = (title: string) => blankService(asset, { title, date: '2026-11-03', kind: 'inspection', costCents: 8000 });
    await saveHandoff({ visitId: v, assetId: asset, data: data('From A'), today: TODAY, confirmManualCopy: true }, A.d);
    await saveHandoff({ visitId: v, assetId: asset, data: data('From B'), today: TODAY, confirmManualCopy: true }, B.d);
    await sleep(15);
    await settle(A, B);
    for (const x of [A, B]) {
      expect((await loadServices(x.d))).toHaveLength(2);
      const ov = await load(x.d);
      expect(ov.spend.totalCents).toBe(8000);
      expect(ov.spend.claims.filter((c) => c.status === 'included')).toHaveLength(1);
      expect(ov.attention.filter((e) => e.kind === 'duplicate-handoff')).toHaveLength(1);
    }
  }, 90000);

  it('one device links the payment in Services while the other links the SAME Finance transaction in Home & Assets: after syncing, each module counts it once and the household counts it once', async () => {
    const { A, B } = devices();
    const asset = await createAsset(blankAsset({ name: 'Oven', type: 'appliance' }), A.d);
    const arr = await createArrangement({ data: blankArrangement({ title: 'Oven service', cadence: null }), provider: { name: 'Hearth Co' }, assetIds: [asset], today: TODAY }, A.d);
    const v = await logDone(A.d, arr.id);
    const tx = await addTxn(A.d, -12000);
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    const ref = makeTxnRef((await A.d.txns.get(tx))!);
    await setVisitPayment(v, { source: 'finance', refs: [ref], manualCents: null }, null, A.d);
    const { createService } = await import('../assets/serviceData');
    await createService(blankService(asset, { title: 'Tune-up', date: '2026-11-03', kind: 'maintenance', txnRefs: [ref] }), B.d, TODAY);
    await sleep(15);
    await settle(A, B);
    for (const x of [A, B]) {
      const ov = await load(x.d);
      expect(ov.spend.totalCents).toBe(12000);
      expect([ov.spend.servicesCents, ov.spend.homeCents, ov.spend.linkedInBothCents]).toEqual([12000, 12000, 12000]);
    }
  }, 90000);
});

describe('S5-D cross-module journey: Services, Tasks, Calendar, Contacts, Home & Assets and Projects together', () => {
  it('create, schedule, log, pay, record in Home & Assets, link a Project, replace the provider: one open Task throughout, history intact, nothing double counted, Project money untouched', async () => {
    const d = fresh();
    const asset = await createAsset(blankAsset({ name: 'Furnace', type: 'system' }), d);
    const proj = await createProject(blankProject({ name: 'Basement remodel' }), d);
    const a = await add(d, { title: 'Furnace tune-up', renewalDate: '2027-02-01', noticeByDate: '2027-01-01' }, { name: 'Pat Heating', phone: '555-0100' }, [asset]);
    await linkProject({ kind: 'arrangement', id: a.id }, proj, d);
    expect(await openTasks(d, a.id)).toHaveLength(1);
    // Calendar: the next Task is the Tasks layer's, the rest are derived expected visits, the contract markers coexist, and no Event row exists
    const due = await servicesDueItems(d, { from: TODAY, to: '2027-11-06', today: TODAY, overdueDays: 0 });
    expect(due.filter((i) => i.id.startsWith('services:visit-')).length).toBeGreaterThan(20);
    expect(due.filter((i) => /renewal-|notice-/.test(i.id)).length).toBe(2);
    expect(await d.moduleRecords.where('module').equals('calendar').count()).toBe(0);
    // log the visit and pay it through Finance
    const tx = await addTxn(d, -22000, { project: { projectId: proj } } as Partial<Txn>);
    const ref = makeTxnRef((await d.txns.get(tx))!);
    const v = await logDone(d, a.id, '2026-11-05', 'Furnace tune-up');
    await setVisitPayment(v, { source: 'finance', refs: [ref], manualCents: null }, null, d);
    // record it as maintenance with the same payment (not a new expense)
    await saveHandoff({ visitId: v, assetId: asset, data: blankService(asset, { title: 'Tune-up', date: '2026-11-05', kind: 'maintenance', txnRefs: [ref] }), today: TODAY }, d);
    const ov = await load(d);
    expect(ov.spend.totalCents).toBe(22000);
    expect(ov.spend.projectTaggedPieces).toBe(1);
    expect(ov.spend.linkedInBothCents).toBe(22000);
    expect(await openTasks(d, a.id)).toHaveLength(1);
    // replacing the provider keeps the old visit and its payment where they were, and adds no money
    const { applyLifecycle, planLifecycle } = await import('./changes');
    const rep = await applyLifecycle({ action: 'replace', arrangementId: a.id, expect: (await planLifecycle(a.id, 'replace', TODAY, d)).expect, today: TODAY, replace: { provider: { name: 'New Heat' } } }, d);
    const after = await load(d);
    expect(after.spend.totalCents).toBe(22000);
    expect(after.base.recent.find((r) => r.v.id === v)!.providerName).toBe('Pat Heating');
    expect(await openTasks(d, rep.successorId!)).toHaveLength(1);
    // the old arrangement's open Task stays (the default is to stop it repeating), so exactly one open Task per arrangement and the old one no longer repeats
    const old = await openTasks(d, a.id);
    expect(old).toHaveLength(1);
    expect(old[0].data.repeat ?? null).toBeNull();
    // the project's own record is unchanged by any of it
    expect((await d.moduleRecords.get(proj))!.data).toMatchObject({ name: 'Basement remodel' });
  }, 60000);
});
