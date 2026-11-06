import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { exportAll, importAll } from '../../lib/backup';
import { checkBackupText } from '../../lib/backupFile';
import { derivedId, queryProviders } from '../../core/dueProvider';
import { createStore } from '../../core/store';
import { installTracking } from '../../lib/sync/track';
import { ensureCalendarSeed, loadLayers } from '../calendar/data';
import { ASSETS_ID } from '../calendar/model';
import { createTask } from '../tasks/data';
import { blankTask } from '../tasks/model';
import { archiveAsset, assetRef, createAsset, getAsset, loadAssets, setAssetStatus, updateAsset, warrantyState } from './data';
import { deleteAssetPermanently, planAssetDeletion } from './deletion';
import { assetDueItems, assetsDueProvider, showsWarrantyMarkers } from './dueProvider';
import { blankAsset, ASSET_DEPENDENT_KINDS } from './model';
import { assetRecords, warrantyLabel } from './records';
import { searchAssetsData } from './searchSource';
import { asWarranty, blankWarranty, effectiveWarranties, normalizeWarranty, parseWarrantyRef, validateWarranty, warrantyBadge, warrantyRefId, warrantyStatus, type WarrantyData } from './warranty';
import { createWarranty, deleteWarranty, deleteWarrantyAndOldFields, getWarranty, loadWarranties, loadWarrantiesFor, restoreWarranty, updateWarranty } from './warrantyData';
import type { ModuleRecord } from '../../core/entities';

/** Invented data only. Each test gets its own database. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-h4w-${n++}`); installTracking(d); return d; };
const TODAY = '2026-11-06';
const mk = (d: FinanceDB, name: string, over = {}) => createAsset(blankAsset({ name, ...over }), d);
const war = (assetId: number, over: Partial<WarrantyData> = {}) => blankWarranty(assetId, { title: 'Manufacturer warranty', endDate: '2027-03-01', ...over });
const raw = (data: object): ModuleRecord => ({ id: 9, module: 'assets', kind: 'warranty', createdAt: 1, updatedAt: 2, data: data as Record<string, unknown> });
const Q = { from: '2026-01-01', to: '2030-12-31', today: TODAY, overdueDays: 0 };

describe('H4 warranty reader and validation', () => {
  it('keeps unknown fields, never throws, and falls back safely', () => {
    const w = asWarranty(raw({ assetId: 3, title: 'Extended', futureThing: { x: 1 }, startDate: '2026-02-30', endDate: 'x', providerContactId: 'q', refs: [null, { url: 'x' }, { label: 'Card', url: 'https://e.test/c' }] }));
    expect(w.data).toMatchObject({ assetId: 3, title: 'Extended', futureThing: { x: 1 }, startDate: null, endDate: null, providerContactId: null });
    expect(w.data.refs).toEqual([{ label: 'Card', url: 'https://e.test/c' }]);
    expect(() => asWarranty({ id: 1, module: 'assets', kind: 'warranty', createdAt: 0, updatedAt: 0, data: null as never })).not.toThrow();
    expect(asWarranty(raw({})).data).toMatchObject({ assetId: -1, title: 'Warranty', startDate: null, endDate: null });
  });
  it('ids look like warranty:<n> and never clash with asset or service ids', () => {
    expect(warrantyRefId(4)).toBe('warranty:4');
    expect(parseWarrantyRef('warranty:4')).toBe(4);
    expect(parseWarrantyRef('asset:4')).toBeNull();
    expect(parseWarrantyRef('service:4')).toBeNull();
    expect((ASSET_DEPENDENT_KINDS as readonly string[]).includes('warranty')).toBe(true);
  });
  it('validates name, real dates, order of dates, links, notes and the provider', () => {
    const ok = { contactExists: () => true };
    expect(validateWarranty(war(1), ok)).toBeNull();
    expect(validateWarranty(war(1, { title: '  ' }), ok)).toMatch(/name/);
    expect(validateWarranty(war(1, { endDate: '2026-02-30' }), ok)).toMatch(/not a real date/);
    expect(validateWarranty(war(1, { startDate: '2027-01-02', endDate: '2027-01-01' }), ok)).toMatch(/before the start/);
    expect(validateWarranty(war(1, { startDate: '2027-01-01', endDate: '2027-01-01' }), ok)).toBeNull();
    expect(validateWarranty(war(1, { endDate: null }), ok)).toBeNull(); // no end date is allowed
    expect(validateWarranty(war(1, { refs: [{ label: 'x', url: 'javascript:alert(1)' }] }), ok)).toMatch(/http/);
    expect(validateWarranty(war(1, { refs: [{ label: 'x', url: 'https://e.test/ok' }] }), ok)).toBeNull();
    expect(validateWarranty(war(1, { coverageNotes: 'x'.repeat(2001) }), ok)).toMatch(/too long/);
    expect(validateWarranty(war(1, { refs: Array.from({ length: 21 }, (_, i) => ({ label: `d${i}` })) }), ok)).toMatch(/too many/);
    expect(validateWarranty(war(1, { providerContactId: 5 }), { contactExists: () => false })).toMatch(/no longer exists/);
    expect(validateWarranty(war(1, { providerContactId: 5 }), { contactExists: () => false, keepContactId: 5 })).toBeNull();
  });
  it('status boundaries: the end day is still covered; 60 days is soon; 61 is active; no end date has no status', () => {
    expect(warrantyStatus('2026-11-05', TODAY)).toBe('expired');
    expect(warrantyStatus('2026-11-06', TODAY)).toBe('soon');
    expect(warrantyStatus('2027-01-05', TODAY)).toBe('soon'); // exactly 60 days
    expect(warrantyStatus('2027-01-06', TODAY)).toBe('active'); // 61
    expect(warrantyStatus(null, TODAY)).toBe('none');
  });
});

describe('H4 warranty records', () => {
  it('creates, edits, deletes and restores; unknown fields survive an edit; the asset cannot be changed by an edit', async () => {
    const d = fresh();
    const a = await mk(d, 'Dishwasher');
    const b = await mk(d, 'Oven');
    const id = await createWarranty(war(a), d);
    await d.moduleRecords.update(id, { data: { ...(await d.moduleRecords.get(id))!.data, futureField: [1, 2] } as never });
    await updateWarranty(id, { ...(await getWarranty(id, d))!.data, title: '  Extended   protection ', assetId: b }, d);
    const w = (await getWarranty(id, d))!;
    expect(w.data).toMatchObject({ title: 'Extended protection', assetId: a, futureField: [1, 2] });
    await deleteWarranty(id, d);
    expect(await getWarranty(id, d)).toBeUndefined();
    expect((await getAsset(a, d))).toBeDefined(); // the asset is untouched
    await restoreWarranty(id, d);
    expect((await getWarranty(id, d))!.data.title).toBe('Extended protection');
  });
  it('two warranties on one asset are both kept, ordered by end date', async () => {
    const d = fresh();
    const a = await mk(d, 'Dishwasher');
    await createWarranty(war(a, { title: 'Extended', endDate: '2029-01-01' }), d);
    await createWarranty(war(a, { title: 'Labour', endDate: '2026-12-01' }), d);
    expect((await loadWarrantiesFor(a, d)).map((w) => w.data.title)).toEqual(['Labour', 'Extended']);
  });
  it('refuses a missing, deleted or archived asset, a bad provider, and a 21st warranty', async () => {
    const d = fresh();
    const a = await mk(d, 'Dishwasher');
    await expect(createWarranty(war(999), d)).rejects.toThrow(/no longer exists/);
    await expect(createWarranty(war(a, { providerContactId: 12345 }), d)).rejects.toThrow(/contact/);
    for (let i = 0; i < 20; i++) await createWarranty(war(a, { title: `W${i}` }), d);
    await expect(createWarranty(war(a, { title: 'One too many' }), d)).rejects.toThrow(/20 warranties/);
    const b = await mk(d, 'Oven');
    await archiveAsset(b, d);
    await expect(createWarranty(war(b), d)).rejects.toThrow(/archived/);
  });
  it('a retired asset still accepts and keeps warranties (history)', async () => {
    const d = fresh();
    const a = await mk(d, 'Dishwasher');
    await createWarranty(war(a), d);
    await setAssetStatus(a, { status: 'sold', statusDate: '2026-10-01', statusNote: '', replacedById: null }, d);
    await expect(createWarranty(war(a, { title: 'Later' }), d)).resolves.toBeGreaterThan(0);
    expect(await loadWarrantiesFor(a, d)).toHaveLength(2);
  });
  it('restore refuses when the asset is gone (Undo cannot create an orphan)', async () => {
    const d = fresh();
    const a = await mk(d, 'Dishwasher');
    const id = await createWarranty(war(a), d);
    await deleteWarranty(id, d);
    await deleteAssetPermanently(a, d);
    await expect(restoreWarranty(id, d)).rejects.toThrow(/no longer exists/);
    expect(await getWarranty(id, d)).toBeUndefined();
  });
  it('survives a backup and restore', async () => {
    const d = fresh();
    const a = await mk(d, 'Dishwasher');
    const id = await createWarranty(war(a, { coverageNotes: 'parts', claimInfo: 'call the number on the card', refs: [{ label: 'Card', url: 'https://e.test/c' }] }), d);
    const text = JSON.stringify(await exportAll(d));
    const target = new FinanceDB(`test-h4w-restore-${n++}`);
    await target.open();
    await importAll(target, checkBackupText(text).file);
    expect((await getWarranty(id, target))!.data).toMatchObject({ title: 'Manufacturer warranty', coverageNotes: 'parts', claimInfo: 'call the number on the card', refs: [{ label: 'Card', url: 'https://e.test/c' }] });
  });
  it('writes only moduleRecords: no other table changes (no schema, Finance or Projects effect)', async () => {
    const d = fresh();
    await d.accounts.add({ name: 'Test Checking', kind: 'checking', openingCents: 100000 } as never);
    const a = await mk(d, 'Dishwasher');
    const snap = async () => JSON.stringify([await d.accounts.toArray(), await d.txns.toArray(), await d.categories.toArray(), await d.assignments.toArray(), await d.recurring.toArray(), await d.contacts.toArray()]);
    const before = await snap();
    const id = await createWarranty(war(a), d);
    await updateWarranty(id, war(a, { title: 'X' }), d);
    await deleteWarranty(id, d);
    expect(await snap()).toBe(before);
    expect(d.verno).toBe(15);
  });
});

describe('H4 implicit H1 warranty and precedence', () => {
  const a = { warrantyEndDate: '2027-01-01', warrantyNote: 'Parts only' };
  it('an asset with only H1 fields shows ONE implicit warranty with the same date and note', () => {
    const e = effectiveWarranties(7, a, []);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ id: null, implicit: true, endDate: '2027-01-01', coverageNotes: 'Parts only' });
  });
  it('a note without a date still reads as a warranty with no end date; neither field means none', () => {
    expect(effectiveWarranties(7, { warrantyEndDate: null, warrantyNote: 'x' }, [])[0]).toMatchObject({ implicit: true, endDate: null });
    expect(effectiveWarranties(7, { warrantyEndDate: null, warrantyNote: '  ' }, [])).toEqual([]);
  });
  it('explicit warranties replace the implicit one (never both), and other assets\' records are ignored', () => {
    const ex = asWarranty({ id: 1, module: 'assets', kind: 'warranty', createdAt: 1, updatedAt: 1, data: war(7) as unknown as Record<string, unknown> });
    const other = asWarranty({ id: 2, module: 'assets', kind: 'warranty', createdAt: 1, updatedAt: 1, data: war(8) as unknown as Record<string, unknown> });
    const e = effectiveWarranties(7, a, [ex, other]);
    expect(e.map((x) => [x.implicit, x.title])).toEqual([[false, 'Manufacturer warranty']]);
  });
  it('opening/reading never writes a record; the H1 fields are not erased by adding an explicit warranty', async () => {
    const d = fresh();
    const id = await mk(d, 'Dishwasher', a);
    expect(await loadWarranties(d)).toEqual([]);
    await createWarranty(war(id, { endDate: '2028-05-05' }), d);
    expect((await getAsset(id, d))!.data).toMatchObject(a);
  });
  it('deleting the last explicit warranty brings the old fields back as a fallback; ticking the box clears them first', async () => {
    const d = fresh();
    const id = await mk(d, 'Dishwasher', a);
    const w = await createWarranty(war(id), d);
    await deleteWarranty(w, d);
    const asset = (await getAsset(id, d))!;
    expect(effectiveWarranties(id, asset.data, await loadWarrantiesFor(id, d)).map((x) => x.implicit)).toEqual([true]);
    await restoreWarranty(w, d);
    const r = await deleteWarrantyAndOldFields(w, true, d);
    expect(r.clearedOld).toBe(true);
    const after = (await getAsset(id, d))!;
    expect(after.data).toMatchObject({ warrantyEndDate: null, warrantyNote: '' });
    expect(effectiveWarranties(id, after.data, await loadWarrantiesFor(id, d))).toEqual([]);
  });
  it('the badge agrees with the Warranties section: nearest upcoming end wins, then latest ended; only for assets in use', () => {
    const asset = blankAsset({ name: 'D' });
    const mkW = (end: string | null) => ({ id: 1, implicit: false, assetId: 1, title: 't', startDate: null, endDate: end, providerContactId: null, coverageNotes: '', claimInfo: '', refs: [] });
    expect(warrantyBadge(asset, [mkW('2029-01-01'), mkW('2026-12-01')], TODAY)).toEqual({ label: 'Warranty ends 2026-12-01', tone: 'soon' });
    expect(warrantyBadge(asset, [mkW('2026-01-01'), mkW('2026-06-01')], TODAY)).toEqual({ label: 'Warranty ended 2026-06-01', tone: 'past' });
    expect(warrantyBadge(asset, [mkW(null)], TODAY)).toBeNull();
    expect(warrantyBadge({ ...asset, status: 'sold' }, [mkW('2029-01-01')], TODAY)).toBeNull();
    // H1 behaviour is unchanged when there are no records
    expect(warrantyState({ ...asset, warrantyEndDate: '2026-11-20' }, '2026-11-05')).toMatchObject({ tone: 'soon' });
  });
});

describe('H4 Calendar: Home & Assets layer', () => {
  it('seeds one built-in layer with the reserved id, even run twice', async () => {
    const d = fresh();
    await Promise.all([ensureCalendarSeed(d), ensureCalendarSeed(d)]);
    const layers = (await loadLayers(d)).filter((l) => l.id === ASSETS_ID);
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({ name: 'Home & Assets', sourceType: 'derived', providerId: 'assets', builtin: true });
    expect(ASSETS_ID).toBe(9_000_000_000_000_105);
    expect(assetsDueProvider.id).toBe('assets');
  });
  it('one marker per warranty with stable ids, titles without identifiers, handled once past, nothing written', async () => {
    const d = fresh();
    const a = await mk(d, 'Dishwasher', { serialNumber: 'SN-SECRET-123', manufacturer: 'Brandco' });
    const w1 = await createWarranty(war(a, { title: 'Manufacturer warranty', endDate: '2027-03-01', coverageNotes: 'secret notes' }), d);
    const w2 = await createWarranty(war(a, { title: 'Extended', endDate: '2026-10-01' }), d);
    await createWarranty(war(a, { title: 'No end', endDate: null }), d);
    const before = JSON.stringify(await d.moduleRecords.toArray());
    const items = await assetDueItems(d, Q);
    expect(JSON.stringify(await d.moduleRecords.toArray())).toBe(before);
    expect(items.map((i) => i.title)).toEqual(['Warranty ends: Dishwasher — Extended', 'Warranty ends: Dishwasher — Manufacturer warranty']);
    expect(items.map((i) => i.id)).toEqual([derivedId('assets', `warranty-${w2}`, '2026-10-01'), derivedId('assets', `warranty-${w1}`, '2027-03-01')]);
    expect(items.map((i) => i.status)).toEqual(['handled', 'open']);
    expect(JSON.stringify(items.map((i) => [i.title, i.detail]))).not.toMatch(/SN-SECRET|secret notes|Brandco/);
    expect(JSON.stringify(await assetDueItems(d, Q)).length).toBe(JSON.stringify(items).length); // deterministic
    expect((await assetDueItems(d, { ...Q, from: '2027-01-01', to: '2027-12-31' })).map((i) => i.sourceRecordId)).toEqual([`warranty:${w1}`]);
  });
  it('the H1 simple warranty gives one marker; an explicit warranty replaces it (no duplicate)', async () => {
    const d = fresh();
    const a = await mk(d, 'Dishwasher', { warrantyEndDate: '2027-01-01' });
    let items = await assetDueItems(d, Q);
    expect(items.map((i) => [i.title, i.sourceRecordId])).toEqual([['Warranty ends: Dishwasher', `asset:${a}`]]);
    await createWarranty(war(a, { endDate: '2027-02-02' }), d);
    items = await assetDueItems(d, Q);
    expect(items.map((i) => i.date)).toEqual(['2027-02-02']);
  });
  it('archived, sold, disposed and replaced assets show no markers; stored and in-use assets do', async () => {
    const d = fresh();
    const ids: Record<string, number> = {};
    for (const s of ['active', 'stored', 'sold', 'disposed', 'replaced'] as const) {
      ids[s] = await mk(d, `Item ${s}`);
      await createWarranty(war(ids[s]), d);
      if (s !== 'active') await setAssetStatus(ids[s], { status: s, statusDate: '2026-10-01', statusNote: '', replacedById: null }, d);
    }
    const arch = await mk(d, 'Item archived');
    await createWarranty(war(arch), d);
    await archiveAsset(arch, d);
    const titles = (await assetDueItems(d, Q)).map((i) => i.title).sort();
    expect(titles).toEqual(['Warranty ends: Item active — Manufacturer warranty', 'Warranty ends: Item stored — Manufacturer warranty']);
    // the history is still there
    expect((await loadWarranties(d)).length).toBe(6);
    expect(showsWarrantyMarkers((await loadAssets(d)).find((x) => x.id === ids.sold)!)).toBe(false);
  });
  it('skips a deleted warranty and a deleted asset, and reaches the Calendar through the registered provider contract', async () => {
    const d = fresh();
    const a = await mk(d, 'Dishwasher');
    const w = await createWarranty(war(a), d);
    await deleteWarranty(w, d);
    expect(await assetDueItems(d, Q)).toEqual([]);
    const out = await queryProviders(Q, [{ ...assetsDueProvider, getDueItems: (q) => assetDueItems(d, q) }]);
    expect(out.assets).toEqual([]);
  });
  it('does not duplicate maintenance: tasks stay on the Tasks layer only', async () => {
    const d = fresh();
    const a = await mk(d, 'Dishwasher');
    await createTask(blankTask({ title: 'Clean filter', dueDate: '2027-02-02' }), [assetRef(a)], d);
    expect(await assetDueItems(d, Q)).toEqual([]);
  });
});

describe('H4 search, links and deletion guard', () => {
  it('finds warranties by title, notes and provider; shows the asset label and status, never notes or identifiers', async () => {
    const d = fresh();
    const a = await mk(d, 'Dishwasher', { serialNumber: 'SN-SECRET-123' });
    await createWarranty(war(a, { title: 'Extended protection', coverageNotes: 'pumps and motors', claimInfo: 'claim secret' }), d);
    const all = await loadAssets(d);
    const ws = await loadWarranties(d);
    const hit = (q: string) => searchAssetsData(q, all, 8, [], ws, () => 'Acme Repairs', TODAY).filter((r) => r.kind === 'Warranty');
    expect(hit('protection')).toHaveLength(1);
    expect(hit('motors')).toHaveLength(1);
    expect(hit('Acme')).toHaveLength(0); // provider only matches when it has been given a name via the provider id
    const withProvider = [{ ...ws[0], data: { ...ws[0].data, providerContactId: 3 } }];
    expect(searchAssetsData('Acme', all, 8, [], withProvider, () => 'Acme Repairs', TODAY).filter((r) => r.kind === 'Warranty')).toHaveLength(1);
    const r = hit('protection')[0];
    expect(r.path).toBe(`/assets/${a}?warranty=${ws[0].id}`);
    expect(JSON.stringify(r)).not.toMatch(/SN-SECRET|claim secret|pumps/);
    expect(hit('serial')).toHaveLength(0);
  });
  it('a warranty on a sold asset is labelled with its status and ranks below an in-use one', async () => {
    const d = fresh();
    const a = await mk(d, 'Old dishwasher');
    const b = await mk(d, 'New dishwasher');
    await createWarranty(war(a, { title: 'Dishwasher cover' }), d);
    await createWarranty(war(b, { title: 'Dishwasher cover' }), d);
    await setAssetStatus(a, { status: 'sold', statusDate: '2026-10-01', statusNote: '', replacedById: null }, d);
    const r = searchAssetsData('dishwasher cover', await loadAssets(d), 8, [], await loadWarranties(d), () => '', TODAY).filter((x) => x.kind === 'Warranty');
    expect(r[0].subtitle).toContain('New dishwasher');
    expect(r[1].subtitle).toContain('Sold');
  });
  it('the records hook lists, describes and opens warranties', async () => {
    const d = fresh();
    const a = await mk(d, 'Dishwasher');
    // the hook reads the app database, so seed it there
    const { db } = await import('../../db');
    const aid = await createAsset(blankAsset({ name: 'Furnace' }), db);
    const wid = await createWarranty(war(aid, { title: 'Heat exchanger' }), db);
    expect((await assetRecords.search!('heat exchanger')).map((x) => x.kind)).toContain('Warranty');
    const info = await assetRecords.describe(warrantyRefId(wid));
    expect(info).toMatchObject({ kind: 'Warranty', path: `/assets/${aid}?warranty=${wid}` });
    expect(info!.label).toBe(warrantyLabel(await loadAssets(db), (await getWarranty(wid, db))!));
    expect(await assetRecords.describe(warrantyRefId(999999))).toBeNull();
    await deleteWarranty(wid, db);
    await deleteAssetPermanently(aid, db);
    void a;
  });
  it('a live warranty blocks permanent deletion; deleting the warranty first unblocks it; the asset is kept', async () => {
    const d = fresh();
    const a = await mk(d, 'Dishwasher');
    const w = await createWarranty(war(a), d);
    const plan = await planAssetDeletion(a, d);
    expect(plan.canDelete).toBe(false);
    expect(plan.dependents).toBe(1);
    await expect(deleteAssetPermanently(a, d)).rejects.toThrow(/cannot be deleted/);
    expect(await getAsset(a, d)).toBeDefined();
    await deleteWarranty(w, d);
    expect((await planAssetDeletion(a, d)).canDelete).toBe(true);
  });
  it('contacts are untouched when a warranty is deleted', async () => {
    const d = fresh();
    const a = await mk(d, 'Dishwasher');
    const c = await createStore(d).shared.contacts.put({ name: 'Acme Repairs' } as never);
    const w = await createWarranty(war(a, { providerContactId: c as number }), d);
    await deleteWarranty(w, d);
    expect((await d.contacts.toArray()).filter((x) => x.deletedAt == null)).toHaveLength(1);
  });
});

describe('normalise', () => {
  it('collapses the title, trims notes and drops blank document rows', () => {
    const w = normalizeWarranty(war(1, { title: '  A   B ', coverageNotes: ' x ', refs: [{ label: ' ' }, { label: 'Card ', url: ' https://e.test ' }] }));
    expect(w).toMatchObject({ title: 'A B', coverageNotes: 'x' });
    expect(w.refs).toEqual([{ label: 'Card', url: 'https://e.test' }]);
  });
});

// keep the unused-import check honest
void updateAsset;
