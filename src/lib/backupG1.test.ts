import { describe, expect, it, vi } from 'vitest';
import { FinanceDB } from '../db';
import { createStore } from '../core/store';
import { exportAll, importAll } from './backup';
import { applyPreferences, buildBackup, checkBackupText, collectPreferences, PREFERENCE_KEYS, restoreChecked, BackupFileError, CURRENT_SCHEMA_VERSION } from './backupFile';
import { summarizeBackup } from './backupSummary';
import { dexieMeta, SyncEngine, type RemoteFile, type RemoteStore, RemoteConflict } from './sync/engine';
import { installTracking, touchAll } from './sync/track';
import { createTask, completeTask, getTask, loadTasks, removeTasks } from '../modules/tasks/data';
import { blankTask } from '../modules/tasks/model';
import { createProject, loadProjects } from '../modules/projects/data';
import { blankProject } from '../modules/projects/model';
import { projectAllocations } from './txnProject';
import { createAsset, loadAssets } from '../modules/assets/data';
import { blankAsset } from '../modules/assets/model';
import { createService, loadServices } from '../modules/assets/serviceData';
import { blankService } from '../modules/assets/service';
import { createArrangement, loadArrangements, tasksOfArrangement } from '../modules/services/data';
import { blankArrangement, type Cadence } from '../modules/services/model';
import { loadVisits, logVisitFromTask, planLogVisit } from '../modules/services/visits';
import { markersOf } from '../modules/services/schedule';
import { createEvent, loadEvents, newEventData } from '../modules/calendar/data';
import { blankFields } from '../modules/calendar/model';
import { makeTxnRef } from '../modules/assets/txnRef';
import { publishDueItem } from '../core/dueItems';

/**
 * G1: whole-application backup and restore, through the REAL export, file checker and restore code, into a separate database.
 * Every name, place and amount is invented. 2026-11-06 is a Friday.
 */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-g1-${n++}`); installTracking(d); return d; };
const TODAY = '2026-11-06';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const biweekly: Cadence = { mode: 'fixed', rule: { freq: 'weekly', interval: 2, end: { type: 'never' } }, anchorDate: TODAY };
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };

/**
 * Everything in the database, table by table, in a stable order. `updatedAt` is left out: when change tracking is on (it always is in the app), a restore
 * re-stamps each record as changed now, which is what lets a restored record beat older copies on other devices. Every other field must match exactly.
 */
async function all(d: FinanceDB) {
  const out: Record<string, unknown[]> = {};
  for (const t of d.tables) out[t.name] = (await t.toArray()).map((r) => { const { updatedAt: _u, ...rest } = r as Record<string, unknown>; return rest; }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return out;
}
const total = async (d: FinanceDB) => (await Promise.all(d.tables.map((t) => t.count()))).reduce((a, b) => a + b, 0);

interface Ids { acct: number; txnPlain: number; txnSplit: number; project: number; task: number; recurringTask: number; event: number; asset: number; service: number; arrangement: number; arrTask: number; visit: number; contact: number; tag: number; }

/** A fictional household that touches every module and the links between them. */
async function household(d: FinanceDB): Promise<Ids> {
  const store = createStore(d);
  const acct = (await d.accounts.add({ name: 'Joint checking', kind: 'checking' } as never)) as number;
  const project = await createProject(blankProject({ name: 'Kitchen refresh', budgetCents: 800000 }), d);
  const txnPlain = (await d.txns.add({ accountId: acct, date: '2026-10-20', amountCents: -45000, payee: 'Tile Depot', project: { projectId: project } } as never)) as number;
  const txnSplit = (await d.txns.add({
    accountId: acct, date: '2026-10-22', amountCents: -30000, payee: 'Hardware Hub',
    splits: [{ categoryId: null, amountCents: -20000, project: { projectId: project } }, { categoryId: null, amountCents: -10000 }],
  } as never)) as number;

  const contact = await store.shared.contacts.put({ name: 'Green Thumb Co', relationship: 'lawn care', phone: '555-0100' } as never);
  const tag = await store.shared.tags.put({ name: 'seasonal' } as never);

  const task = await createTask(blankTask({ title: 'Call the plumber', dueDate: '2026-11-10', tagIds: [tag], contactIds: [contact] }), [{ module: 'projects', id: project }], d);
  const recurringTask = await createTask(blankTask({ title: 'Change furnace filter', dueDate: '2026-11-08', repeat: { mode: 'fixed', rule: { freq: 'monthly', interval: 3, end: { type: 'never' } } } }), [], d);
  const event = await createEvent(newEventData({ ...blankFields('2026-11-12'), title: 'School concert' }, { calendarId: 1, tagIds: [tag], contactIds: [], recurrence: { freq: 'yearly', interval: 1, end: { type: 'never' } }, trackDone: false }), d);

  const asset = await createAsset(blankAsset({ name: 'Dishwasher', type: 'appliance', manufacturer: 'Acme', purchaseTxnRefs: [makeTxnRef((await d.txns.get(txnPlain))!)] }), d);
  const service = await createService(blankService(asset, { date: '2026-09-15', title: 'Descale and clean filter', providerContactId: contact, txnRefs: [makeTxnRef((await d.txns.get(txnSplit))!, 0)] }), d, TODAY);

  const made = await createArrangement({ data: blankArrangement({ title: 'Lawn care', cadence: biweekly }), provider: { contactId: contact }, assetIds: [asset], scheduleFirstVisit: true, today: TODAY }, d);
  const arrangement = made.id;
  const arrTask = (await tasksOfArrangement(arrangement, d))[0].id;
  const inp = { status: 'completed' as const, cancelledBy: null, date: TODAY, notes: 'Front and back', chargedCents: 6500, chargeKind: 'service' as const };
  const plan = await planLogVisit(arrangement, arrTask, inp, TODAY, d);
  const logged = await logVisitFromTask({ arrangementId: arrangement, taskId: arrTask, input: inp, today: TODAY, expect: plan.expect }, d);
  const visit = logged.visitId;

  await publishDueItem({ sourceModule: 'tasks', sourceRecordId: task, title: 'Call the plumber', date: '2026-11-10' } as never, d);
  await d.attachments.add({ ownerModule: 'assets', ownerId: asset, fileName: 'manual.pdf', storage: 'none' } as never);
  await d.settings.put({ key: 'savedThemes', value: JSON.stringify([{ id: 't1', name: 'Mine' }]) });
  await d.settings.put({ key: 'priceApiKey', value: 'DEVICE-ONLY-KEY' });
  // A field this version of Ledger knows nothing about, on a shared record and inside a module record.
  await d.contacts.update(contact, { futureField: { nested: [1, 2, 3] } } as never);
  const mr = (await d.moduleRecords.toArray()).find((r) => r.module === 'projects' && r.kind === 'project')!;
  await d.moduleRecords.update(mr.id!, { futureTopLevel: 'kept', data: { ...mr.data, futureData: { a: 1 } } } as never);
  return { acct, txnPlain, txnSplit, project, task, recurringTask, event, asset, service, arrangement, arrTask, visit, contact, tag };
}

/** Real export -> text -> real file checker -> real restore. */
async function roundTrip(src: FinanceDB, dst: FinanceDB, prefs?: ReturnType<typeof mem>) {
  const text = JSON.stringify(await buildBackup(src, prefs));
  const { file } = checkBackupText(text);
  const store = mem();
  await restoreChecked(dst, file, store);
  return { text, file, store };
}

describe('G1 full household round trip', () => {
  it('every record in every table comes back exactly, and the restored app can read it', async () => {
    const src = fresh();
    const ids = await household(src);
    const prefs = mem();
    prefs.setItem('ledger-theme', 'dark');
    prefs.setItem('ledger-palette', JSON.stringify({ id: 'teal' }));
    prefs.setItem('ledger-sync-config', 'SECRET-TOKEN'); // must never travel
    const dst = fresh();
    await dst.open();
    const { text, store } = await roundTrip(src, dst, prefs);

    // 1, 2, 10: all expected records, same ids, nothing doubled (the price-lookup key is the one deliberate exception)
    const a = await all(src); const b = await all(dst);
    const keyless = (x: Record<string, unknown[]>) => ({ ...x, settings: x.settings.filter((s) => (s as { key: string }).key !== 'priceApiKey') });
    expect(b).toEqual(keyless(a));
    expect(await total(dst)).toBe((await total(src)) - 1);

    // 3, 4, 5, 6: relationships, recurrence, occurrence markers and money references still resolve
    const tasks = await loadTasks(dst);
    const repeat = tasks.find((t) => t.id === ids.recurringTask)!.data.repeat;
    expect(repeat).toEqual((await getTask(ids.recurringTask, src))!.data.repeat);
    expect(repeat).toMatchObject({ mode: 'fixed', rule: { freq: 'monthly', interval: 3 } });
    expect((await getTask(ids.task, dst))!.data).toMatchObject({ tagIds: [ids.tag], contactIds: [ids.contact] });
    expect(await dst.links.where('[toModule+toId]').equals(['projects', ids.project]).count()).toBeGreaterThan(0);
    const arrTasks = await tasksOfArrangement(ids.arrangement, dst);
    expect(arrTasks.map((t) => markersOf(t))).toEqual((await tasksOfArrangement(ids.arrangement, src)).map((t) => markersOf(t)));
    const visits = await loadVisits(dst);
    expect(visits.map((v) => v.id)).toEqual([ids.visit]);
    expect(visits[0].data.arrangementId).toBe(ids.arrangement);
    expect((await loadServices(dst)).map((s) => s.id)).toEqual([ids.service]);
    expect((await loadAssets(dst))[0].data.purchaseTxnRefs).toEqual([makeTxnRef((await src.txns.get(ids.txnPlain))!)]);
    expect(await dst.txns.get(ids.txnPlain)).toBeTruthy();
    expect((await loadEvents(dst)).map((e) => e.id)).toEqual([ids.event]);
    expect((await loadArrangements(dst)).map((r) => r.id)).toEqual([ids.arrangement]);
    expect((await loadProjects(dst)).map((p) => p.id)).toEqual([ids.project]);

    // Finance and Project spending is counted once: 45,000 whole + 20,000 of the split
    const pieces = (await dst.txns.toArray()).flatMap((t) => projectAllocations(t));
    expect(pieces.reduce((s, p) => s - p.amountCents, 0)).toBe(65000);

    // 7: unknown fields survive
    expect((await dst.contacts.get(ids.contact)) as unknown).toMatchObject({ futureField: { nested: [1, 2, 3] } });
    const pr = (await dst.moduleRecords.toArray()).find((r) => r.module === 'projects' && r.kind === 'project')! as unknown as { futureTopLevel: string; data: { futureData: unknown } };
    expect(pr.futureTopLevel).toBe('kept');
    expect(pr.data.futureData).toEqual({ a: 1 });

    // 8: preferences travel; sync and backup secrets and the price key do not
    expect(store.getItem('ledger-theme')).toBe('dark');
    expect(JSON.parse(store.getItem('ledger-palette')!)).toEqual({ id: 'teal' });
    expect(text).not.toContain('SECRET-TOKEN');
    expect(text).not.toContain('DEVICE-ONLY-KEY');
    expect(text).not.toContain('priceApiKey');
    expect(PREFERENCE_KEYS.some((k) => /sync|passphrase|autobackup|token/i.test(k))).toBe(false);
    expect(collectPreferences(prefs)).not.toHaveProperty('ledger-sync-config');
  });

  it('restoring the same backup twice changes nothing the second time (no doubled records or spending)', async () => {
    const src = fresh();
    await household(src);
    const dst = fresh();
    await dst.open();
    const { file } = await roundTrip(src, dst);
    const once = await all(dst);
    await restoreChecked(dst, file, mem());
    expect(await all(dst)).toEqual(once);
  });

  it('keeps the on-screen summary honest: counts by area, and no names or amounts', async () => {
    const src = fresh();
    await household(src);
    const file = (await exportAll(src));
    const groups = summarizeBackup(file);
    const get = (id: string, label: RegExp) => groups.find((g) => g.id === id)?.items.find((i) => label.test(i.label))?.n;
    expect(get('tasks-calendar', /^Tasks$/)).toBeGreaterThanOrEqual(2);
    expect(get('tasks-calendar', /events/)).toBe(1);
    expect(get('projects', /^Projects$/)).toBe(1);
    expect(get('assets', /Items/)).toBe(1);
    expect(get('services', /Visits/)).toBe(1);
    expect(get('shared', /^Contacts$/)).toBe(1);
    expect(get('finance', /Transactions/)).toBe(2);
    const json = JSON.stringify(groups);
    for (const secret of ['Green Thumb', 'Tile Depot', 'Dishwasher', '45000']) expect(json).not.toContain(secret);
  });

  it('every kind of module record is named in the summary (nothing falls into a catch-all)', async () => {
    const src = fresh();
    await household(src);
    const groups = summarizeBackup(await exportAll(src));
    expect(groups.find((g) => g.id === 'other')).toBeUndefined();
    const unnamed = groups.flatMap((g) => g.items).filter((i) => /^[a-z]+ records \(/.test(i.label));
    expect(unnamed.map((i) => i.label)).toEqual([]);
  });
});

describe('G1 destructive scenarios', () => {
  it('export, delete a Task, restore: the Task is back (the owner’s manual test)', async () => {
    const d = fresh();
    const ids = await household(d);
    const { file } = checkBackupText(JSON.stringify(await buildBackup(d)));
    await removeTasks([ids.task], d);
    expect(await getTask(ids.task, d)).toBeUndefined();
    await restoreChecked(d, file, mem());
    expect((await getTask(ids.task, d))!.data.title).toBe('Call the plumber');
  });

  it('replacement, not merge: a changed record goes back to the backup’s version and a record made later is gone', async () => {
    const d = fresh();
    const ids = await household(d);
    const { file } = checkBackupText(JSON.stringify(await buildBackup(d)));
    await d.accounts.update(ids.acct, { name: 'Renamed later' });
    const later = await createTask(blankTask({ title: 'Made after the backup' }), [], d);
    await restoreChecked(d, file, mem());
    expect((await d.accounts.get(ids.acct))!.name).toBe('Joint checking');
    expect(await getTask(later, d)).toBeUndefined();
  });

  it('a removed cross-module link and a deleted service visit both come back', async () => {
    const d = fresh();
    const ids = await household(d);
    const { file } = checkBackupText(JSON.stringify(await buildBackup(d)));
    const linksBefore = await d.links.count();
    await d.links.clear();
    await d.moduleRecords.delete(ids.visit);
    await restoreChecked(d, file, mem());
    expect(await d.links.count()).toBe(linksBefore);
    expect((await loadVisits(d)).map((v) => v.id)).toEqual([ids.visit]);
  });

  it('deleted (hidden) records stay deleted after a restore, and a record restored before the backup stays restorable', async () => {
    const d = fresh();
    const ids = await household(d);
    await removeTasks([ids.task], d); // soft delete: kept as a marker so the deletion can sync
    const { file } = checkBackupText(JSON.stringify(await buildBackup(d)));
    expect((file.moduleRecords as { id: number; deletedAt?: number | null }[]).find((r) => r.id === ids.task)!.deletedAt).toBeTruthy();
    const dst = fresh();
    await dst.open();
    await restoreChecked(dst, file, mem());
    expect(await getTask(ids.task, dst)).toBeUndefined();
    expect(await dst.moduleRecords.get(ids.task)).toBeTruthy();
    // and a completed recurring task's follow-up is not doubled
    const dst2 = fresh();
    await dst2.open();
    await completeTask(ids.recurringTask, TODAY, d);
    const f2 = checkBackupText(JSON.stringify(await buildBackup(d))).file;
    await restoreChecked(dst2, f2, mem());
    const titles = (await loadTasks(dst2)).filter((t) => t.data.title === 'Change furnace filter');
    expect(titles.length).toBe((await loadTasks(d)).filter((t) => t.data.title === 'Change furnace filter').length);
  });

  it('a backup made before newer modules existed restores on the current version, and invents nothing', async () => {
    const d = fresh();
    await household(d);
    const text = JSON.stringify(await buildBackup(d));
    const old = JSON.parse(text) as Record<string, unknown>;
    old.version = 14; old.schemaVersion = 14;
    for (const k of ['contacts', 'tags', 'attachments', 'links', 'dueItems', 'moduleRecords']) delete old[k];
    delete old.manifest; delete old.preferences;
    const dst = fresh();
    await dst.open();
    await dst.moduleRecords.add({ id: 1, module: 'tasks', kind: 'task', data: {} } as never);
    const { file, summary } = checkBackupText(JSON.stringify(old));
    expect(summary.fromVersion).toBe(14);
    await restoreChecked(dst, file, mem());
    expect(await dst.moduleRecords.count()).toBe(0);
    expect(await dst.contacts.count()).toBe(0);
    expect(await dst.accounts.count()).toBe(1);
  });
});

describe('G1 bad files are refused with a plain message and change nothing', () => {
  const good = async () => { const d = fresh(); await household(d); return JSON.stringify(await buildBackup(d)); };

  it('not JSON, truncated, not a backup', async () => {
    const text = await good();
    expect(() => checkBackupText('not json at all')).toThrow(/not valid JSON/);
    expect(() => checkBackupText(text.slice(0, Math.floor(text.length / 2)))).toThrow(/not valid JSON|damaged/);
    expect(() => checkBackupText('[]')).toThrow(/not a Ledger backup/);
    expect(() => checkBackupText('{"hello":1}')).toThrow(/does not look like a Ledger backup/);
  });

  it('a file cut short but still valid JSON is caught by its contents list', async () => {
    const o = JSON.parse(await good()) as Record<string, unknown[]>;
    o.txns = o.txns.slice(0, 1);
    expect(() => checkBackupText(JSON.stringify(o))).toThrow(/incomplete or was changed.*"txns"/);
    const p = JSON.parse(await good()) as Record<string, unknown>;
    delete p.moduleRecords;
    expect(() => checkBackupText(JSON.stringify(p))).toThrow(/"moduleRecords" should hold/);
  });

  it('a newer data version is refused, whatever else it contains', async () => {
    const o = JSON.parse(await good()) as Record<string, unknown>;
    o.version = CURRENT_SCHEMA_VERSION + 1; o.schemaVersion = CURRENT_SCHEMA_VERSION + 1; o.petRecords = [{ id: 1 }];
    expect(() => checkBackupText(JSON.stringify(o))).toThrow(/newer version of Ledger/);
  });

  it('a list this version cannot restore is refused rather than silently dropped', async () => {
    const o = JSON.parse(await good()) as Record<string, unknown>;
    o.petRecords = [{ id: 1 }];
    expect(() => checkBackupText(JSON.stringify(o))).toThrow(/does not know how to restore \(petRecords\)/);
  });

  it('records that are not records, lack ids or repeat an id', async () => {
    const o = () => JSON.parse(JSON.stringify({ version: 15, exportedAt: 'x', accounts: [], categoryGroups: [], categories: [], txns: [], importBatches: [] })) as Record<string, unknown[]>;
    const a = o(); a.accounts = ['oops'];
    expect(() => checkBackupText(JSON.stringify(a))).toThrow(/not a record/);
    const b = o(); b.accounts = [{ name: 'no id' }];
    expect(() => checkBackupText(JSON.stringify(b))).toThrow(/no usable id/);
    const c = o(); c.settings = [{ value: 'no key' }];
    expect(() => checkBackupText(JSON.stringify(c))).toThrow(/no usable key/);
    const e = o(); e.accounts = [{ id: 1 }, { id: 1 }];
    expect(() => checkBackupText(JSON.stringify(e))).toThrow(/twice/);
  });

  it('a record pointing at a missing account is noted, not blocked', () => {
    const o = { version: 15, exportedAt: 'x', accounts: [], categoryGroups: [], categories: [], txns: [{ id: 1, accountId: 99 }], importBatches: [] };
    const { summary } = checkBackupText(JSON.stringify(o));
    expect(summary.notes.join(' ')).toMatch(/1 transaction/);
  });

  it('a damaged file is refused up front, and a failure halfway through the restore rolls everything back', async () => {
    const d = fresh();
    const ids = await household(d);
    const before = await all(d);
    const text = JSON.stringify(await buildBackup(d));
    const o = JSON.parse(text) as Record<string, unknown[]>;
    // inject a failure in the LAST table written, after almost everything has already been replaced
    const spy = vi.spyOn(d.moduleRecords, 'bulkAdd').mockRejectedValueOnce(new Error('disk full (injected)'));
    await expect(restoreChecked(d, checkBackupText(text).file, mem())).rejects.toThrow(/injected/);
    spy.mockRestore();
    expect(await all(d)).toEqual(before);
    expect(await getTask(ids.task, d)).toBeTruthy();
    // a real database-level failure (a repeated id the checker was not asked to look at) also rolls back
    o.moduleRecords.push({ ...(o.moduleRecords[0] as object) });
    await expect(importAll(d, o as never)).rejects.toThrow();
    expect(await all(d)).toEqual(before);
  });

  it('preferences are not touched when the database restore fails', async () => {
    const d = fresh();
    await household(d);
    const text = JSON.stringify(await buildBackup(d, (() => { const m = mem(); m.setItem('ledger-theme', 'dark'); return m; })()));
    const prefs = mem(); prefs.setItem('ledger-theme', 'light');
    vi.spyOn(d.txns, 'bulkAdd').mockRejectedValueOnce(new Error('injected'));
    await expect(restoreChecked(d, checkBackupText(text).file, prefs)).rejects.toThrow();
    expect(prefs.getItem('ledger-theme')).toBe('light');
    vi.restoreAllMocks();
  });
});

describe('G1 manifest and consistency', () => {
  it('lists a count for every table in the database', async () => {
    const d = fresh();
    await household(d);
    const file = await exportAll(d);
    expect(Object.keys(file.manifest!.counts).sort()).toEqual(d.tables.map((t) => t.name).sort());
  });

  it('the export is one consistent snapshot: a write that lands mid-export is not half in the file', async () => {
    const d = fresh();
    const acct = (await d.accounts.add({ name: 'A', kind: 'checking' } as never)) as number;
    const reading = exportAll(d);
    await d.txns.add({ accountId: acct, date: '2026-11-01', amountCents: -1 } as never); // lands while the export's read is open or after it
    const f = await reading;
    // whichever side of the snapshot the write fell on, the file agrees with its own contents list
    expect(f.txns!.length).toBe(f.manifest!.counts.txns);
    expect(() => checkBackupText(JSON.stringify(f))).not.toThrow();
  });

  it('an old-style file with neither a contents list nor preferences still restores', async () => {
    const d = fresh();
    await household(d);
    const o = JSON.parse(JSON.stringify(await exportAll(d))) as Record<string, unknown>;
    delete o.manifest;
    expect(() => checkBackupText(JSON.stringify(o))).not.toThrow();
  });

  it('applyPreferences ignores keys that are not on the allowed list', () => {
    const s = mem();
    applyPreferences({ 'ledger-theme': 'dark', 'ledger-sync-config': 'x', evil: 'y' }, s);
    expect(s.m.get('ledger-theme')).toBe('dark');
    expect(s.m.has('ledger-sync-config')).toBe(false);
    expect(s.m.has('evil')).toBe(false);
  });
});

// ---- restore while synchronization is on: the real SyncEngine, two devices ----
function memoryRemote(): RemoteStore & { puts: number; file: RemoteFile | null } {
  const r = {
    puts: 0, file: null as RemoteFile | null,
    async getFile() { return r.file ? { sha: r.file.sha, bytes: r.file.bytes.slice() } : null; },
    async putFile(bytes: Uint8Array, sha: string | undefined) {
      if ((r.file?.sha ?? undefined) !== sha) throw new RemoteConflict('stale');
      r.puts++; r.file = { sha: `sha${r.puts}`, bytes: bytes.slice() }; return r.file.sha;
    },
  };
  return r;
}
const device = (remote: RemoteStore) => { const d = fresh(); return { d, engine: new SyncEngine(d, dexieMeta(`g1-meta-${n++}`), remote, 'a good passphrase') }; };

describe('G1 restore with sync on', () => {
  it('a restored Task and Services visit reach the other device, and nothing is doubled', async () => {
    const remote = memoryRemote();
    const A = device(remote); const B = device(remote);
    const ids = await household(A.d);
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    const { file } = checkBackupText(JSON.stringify(await buildBackup(A.d)));
    await sleep(5);
    await removeTasks([ids.task], A.d);
    await A.d.moduleRecords.delete(ids.visit);
    await A.engine.sync(); await B.engine.sync();
    expect(await getTask(ids.task, B.d)).toBeUndefined();
    await sleep(5);
    await restoreChecked(A.d, file, mem());
    await touchAll(A.d); // what the Restore button does when sync is on
    await A.engine.sync(); await B.engine.sync(); await A.engine.sync();
    for (const x of [A, B]) {
      expect((await getTask(ids.task, x.d))!.data.title).toBe('Call the plumber');
      expect((await loadVisits(x.d)).map((v) => v.id)).toEqual([ids.visit]);
      expect(await x.d.txns.count()).toBe(2);
    }
    // the price-lookup key is device-only: A keeps it through the restore, B never receives it
    expect(await A.d.settings.get('priceApiKey')).toBeTruthy();
    expect(await B.d.settings.get('priceApiKey')).toBeUndefined();
    await A.d.settings.delete('priceApiKey');
    const aTables = await all(A.d); const bTables = await all(B.d);
    expect(Object.fromEntries(Object.entries(aTables).map(([k, v]) => [k, v.length]))).toEqual(Object.fromEntries(Object.entries(bTables).map(([k, v]) => [k, v.length])));
  });

  it('the sync token and device state are not in the database, so a backup cannot carry them', async () => {
    const d = fresh();
    await household(d);
    const text = JSON.stringify(await buildBackup(d));
    expect(text).not.toMatch(/ledger-sync-config|ledger-autobackup|"token"|passphrase/i);
  });
});

describe('G1 coverage guard for future modules', () => {
  it('every table in the database is exported, listed in the contents list and restored (a new table without backup support fails here)', async () => {
    const d = fresh();
    await d.open();
    for (const [i, t] of d.tables.entries()) await t.add((t.name === 'settings' ? { key: 'k', value: 'v' } : { id: 7000 + i, updatedAt: 1, probe: t.name }) as never);
    const file = await exportAll(d);
    for (const t of d.tables) {
      expect(Array.isArray((file as unknown as Record<string, unknown>)[t.name]), `exportAll misses "${t.name}"`).toBe(true);
      expect(file.manifest!.counts[t.name], `contents list misses "${t.name}"`).toBe(1);
    }
    const dst = new FinanceDB(`test-g1-plain-${n++}`); // no change tracking here, so even updatedAt must match exactly
    await dst.open();
    await restoreChecked(dst, checkBackupText(JSON.stringify(file)).file, mem());
    for (const t of dst.tables) expect(await t.toArray(), `"${t.name}" did not restore`).toEqual(await d.table(t.name).toArray());
  });

  it('a module’s records ride the shared moduleRecords table, so a new module needs no new backup code', async () => {
    const d = fresh();
    await d.moduleRecords.add({ id: 5, module: 'pets', kind: 'pet', data: { name: 'Biscuit' }, updatedAt: 1, createdAt: 1, deletedAt: null } as never);
    const dst = fresh();
    await dst.open();
    await restoreChecked(dst, checkBackupText(JSON.stringify(await exportAll(d))).file, mem());
    expect((await dst.moduleRecords.get(5))!.data).toEqual({ name: 'Biscuit' });
    const groups = summarizeBackup(await exportAll(d));
    expect(groups.find((g) => g.id === 'other')!.items[0]).toEqual({ label: 'pets records', n: 1 }); // counted, never dropped
  });

  it('BackupFileError is what the screen shows for a bad file', () => {
    expect(() => checkBackupText('x')).toThrow(BackupFileError);
  });
});
