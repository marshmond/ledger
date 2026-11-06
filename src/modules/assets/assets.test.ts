import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { exportAll, importAll } from '../../lib/backup';
import { checkBackupText } from '../../lib/backupFile';
import { registerModule, allQuickAdds, allSearchSources } from '../../core/registry';
import { repo } from '../../core/store';
import { createTask, completeTask, loadTasks } from '../tasks/data';
import { blankTask } from '../tasks/model';
import { createEvent, newEventData } from '../calendar/data';
import { blankFields, PERSONAL_ID } from '../calendar/model';
import { installTracking } from '../../lib/sync/track';
import {
  archiveAsset, breadcrumb, buildTree, createAsset, descendantIds, getAsset, linksToAsset, loadAssets, loadLinkedWork, lookupOf, publicLabel, removeNewAsset,
  restoreAsset, setAssetStatus, updateAsset, warrantyState, assetRef, whereIs,
} from './data';
import { asAsset, blankAsset, ASSET_DEPENDENT_KINDS, parseAssetRef, type AssetData } from './model';
import { assetRecords } from './records';
import { searchAssetsData } from './searchSource';
import { assetQuickAdd, parseAssetQuick } from './quickAddDef';
import { validateAsset, wouldCreateCycle } from './validate';
import { deleteAssetPermanently, planAssetDeletion } from './deletion';
import { assetsModule } from './index';
import type { ModuleRecord } from '../../core/entities';

/** Invented data only. Each test gets its own database. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-assets-${n++}`); installTracking(d); return d; };
const mk = (d: FinanceDB, name: string, over: Partial<AssetData> = {}) => createAsset(blankAsset({ name, ...over }), d);
const rec = (data: Record<string, unknown>): ModuleRecord => ({ id: 5, module: 'assets', kind: 'asset', createdAt: 1, updatedAt: 2, data });

const SENTINEL = { serial: 'SENTINEL-SERIAL-001', plate: 'ZZPLATE9', address: '99 Sentinel Test Lane' };

describe('H1 reader', () => {
  it('keeps unknown fields and never throws on junk', () => {
    const a = asAsset(rec({ name: 'Boiler', ledgerPropertyId: 7, txnRefs: [1], future: { x: 1 } }));
    expect(a.data).toMatchObject({ name: 'Boiler', ledgerPropertyId: 7, txnRefs: [1], future: { x: 1 } });
    expect(() => asAsset({ id: 1, module: 'assets', kind: 'asset', createdAt: 0, updatedAt: 0, data: null as never })).not.toThrow();
    expect(asAsset(rec({})).data.name).toBe('Unnamed asset');
  });
  it('falls back safely for a bad type, status, date, number and lists', () => {
    const a = asAsset(rec({ name: 'X', type: 'spaceship', status: 'lost', purchaseDate: '2026-02-30', purchaseCents: -5, contacts: 'no', specs: [null, 3, { label: 'A', value: 'B' }], refs: [{ url: 'x' }], parentId: 'abc', replacedById: 4 }));
    expect(a.data).toMatchObject({ type: 'other', status: 'active', purchaseDate: null, purchaseCents: null, contacts: [], parentId: null, replacedById: null });
    expect(a.data.specs).toEqual([{ label: 'A', value: 'B' }]);
    expect(a.data.refs).toEqual([]);
  });
});

describe('H1 validation', () => {
  const none = lookupOf([]);
  it('needs a name and limits lengths', () => {
    expect(validateAsset(blankAsset({ name: '  ' }), undefined, none)).toMatch(/name/);
    expect(validateAsset(blankAsset({ name: 'x'.repeat(121) }), undefined, none)).toMatch(/too long/);
    expect(validateAsset(blankAsset({ name: 'Ok' }), undefined, none)).toBeNull();
    expect(validateAsset(blankAsset({ name: 'Ok', serialNumber: 'x'.repeat(61) }), undefined, none)).toMatch(/serial/);
    expect(validateAsset(blankAsset({ name: 'Ok', notes: 'x'.repeat(5001) }), undefined, none)).toMatch(/notes/);
  });
  it('accepts only http and https links', () => {
    const v = (url: string) => validateAsset(blankAsset({ name: 'A', refs: [{ label: 'Receipt', url }] }), undefined, none);
    expect(v('https://example.com/r')).toBeNull();
    expect(v('http://example.com/r')).toBeNull();
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x.test/a', 'not a link', 'file:///c:/x']) expect(v(bad), bad).toMatch(/http/);
    expect(validateAsset(blankAsset({ name: 'A', refs: [{ label: '', url: 'https://example.com' }] }), undefined, none)).toMatch(/label/);
  });
  it('checks contacts, specs, dates and price', () => {
    expect(validateAsset(blankAsset({ name: 'A', contacts: [{ contactId: 1, role: 'x' }, { contactId: 1, role: 'X' }] }), undefined, none)).toMatch(/twice/);
    expect(validateAsset(blankAsset({ name: 'A', specs: [{ label: '', value: 'v' }] }), undefined, none)).toMatch(/label/);
    expect(validateAsset(blankAsset({ name: 'A', purchaseDate: '2026-13-01' }), undefined, none)).toMatch(/not a real date/);
    expect(validateAsset(blankAsset({ name: 'A', purchaseCents: -1 }), undefined, none)).toMatch(/negative/);
  });
  it('refuses a parent that is itself, missing, a cycle, too deep, or above a property', async () => {
    const d = fresh();
    const a = await mk(d, 'A'), b = await mk(d, 'B', { parentId: a }), c = await mk(d, 'C', { parentId: b });
    const look = lookupOf(await loadAssets(d));
    expect(validateAsset(blankAsset({ name: 'A', parentId: a }), a, look)).toMatch(/itself/);
    expect(validateAsset(blankAsset({ name: 'A', parentId: c }), a, look)).toMatch(/itself/); // indirect
    expect(validateAsset(blankAsset({ name: 'A', parentId: 999 }), a, look)).toMatch(/no longer exists/);
    expect(validateAsset(blankAsset({ name: 'H', type: 'property', parentId: a }), undefined, look)).toMatch(/top/);
    // a chain longer than the limit
    const chain: Record<number, { parentId: number | null; replacedById: number | null; type: string }> = {};
    for (let i = 1; i <= 20; i++) chain[i] = { parentId: i === 1 ? null : i - 1, replacedById: null, type: 'other' };
    expect(wouldCreateCycle(undefined, 20, (i) => chain[i])).toBe(true);
    expect(wouldCreateCycle(undefined, 5, (i) => chain[i])).toBe(false);
  });
  it('replaced-by must be another live asset and not loop', async () => {
    const d = fresh();
    const a = await mk(d, 'Old'), b = await mk(d, 'New');
    await setAssetStatus(a, { status: 'replaced', statusDate: '2026-11-01', statusNote: '', replacedById: b }, d);
    await expect(setAssetStatus(b, { status: 'replaced', statusDate: null, statusNote: '', replacedById: a }, d)).rejects.toThrow(/loops/);
    await expect(setAssetStatus(a, { status: 'replaced', statusDate: null, statusNote: '', replacedById: a }, d)).rejects.toThrow(/not itself/);
  });
});

describe('H1 data layer', () => {
  it('creates with only a name, keeps unknown fields on update, and tidies', async () => {
    const d = fresh();
    const id = await mk(d, '  Dish   washer ');
    expect((await getAsset(id, d))!.data.name).toBe('Dish washer');
    await d.moduleRecords.update(id, { data: { ...(await d.moduleRecords.get(id))!.data, ledgerPropertyId: 42 } });
    const cur = (await getAsset(id, d))!;
    await updateAsset(id, { ...cur.data, manufacturer: 'Acme', specs: [{ label: '', value: '' }, { label: 'Size', value: '1x1' }] }, d);
    const after = await d.moduleRecords.get(id);
    expect(after!.data).toMatchObject({ ledgerPropertyId: 42, manufacturer: 'Acme', specs: [{ label: 'Size', value: '1x1' }] });
  });
  it('a parent deleted meanwhile is refused, not stored', async () => {
    const d = fresh();
    const p = await mk(d, 'Home', { type: 'property' });
    await repo<ModuleRecord>(d.moduleRecords).remove(p);
    await expect(mk(d, 'Kitchen', { parentId: p })).rejects.toThrow(/no longer exists/);
    expect(await loadAssets(d)).toEqual([]);
  });
  it('an address only stays on a property and a plate on a vehicle', async () => {
    const d = fresh();
    const a = await mk(d, 'Car', { type: 'vehicle', plate: 'AB12', address: 'nope' });
    expect((await getAsset(a, d))!.data).toMatchObject({ plate: 'AB12', address: '' });
  });
  it('archive, restore, retire and set back to active round-trip; children and tasks are not touched', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace'), kid = await mk(d, 'Filter', { parentId: a });
    const t = await createTask(blankTask({ title: 'Change filter' }), [assetRef(a)], d);
    await archiveAsset(a, d);
    expect((await getAsset(a, d))!.data.archived).toBe(true);
    await restoreAsset(a, d);
    await setAssetStatus(a, { status: 'sold', statusDate: '2026-11-02', statusNote: 'to a neighbour', replacedById: null }, d);
    expect((await getAsset(a, d))!.data).toMatchObject({ status: 'sold', statusDate: '2026-11-02', statusNote: 'to a neighbour' });
    expect((await getAsset(kid, d))!.data.parentId).toBe(a);
    expect((await loadTasks(d)).find((x) => x.id === t)!.data.status).toBe('todo');
    expect((await linksToAsset(a, d)).length).toBe(1);
    await setAssetStatus(a, { status: 'active', statusDate: '2026-11-02', statusNote: 'x', replacedById: null }, d);
    expect((await getAsset(a, d))!.data).toMatchObject({ status: 'active', statusDate: null, statusNote: '' });
  });
  it('removeNewAsset (the Add box Undo) refuses when something points at it', async () => {
    const d = fresh();
    const a = await mk(d, 'Toaster');
    await mk(d, 'Lid', { parentId: a });
    expect(await removeNewAsset(a, d)).toMatch(/inside/);
    const b = await mk(d, 'Mixer');
    expect(await removeNewAsset(b, d)).toBeNull();
    expect(await getAsset(b, d)).toBeUndefined();
  });
  it('warranty state is relative to today and only for assets in use', () => {
    const base = blankAsset({ name: 'W', warrantyEndDate: '2026-12-01' });
    expect(warrantyState(base, '2026-11-05')).toMatchObject({ tone: 'soon' });
    expect(warrantyState({ ...base, warrantyEndDate: '2027-12-01' }, '2026-11-05')).toMatchObject({ tone: 'ok' });
    expect(warrantyState({ ...base, warrantyEndDate: '2026-01-01' }, '2026-11-05')).toMatchObject({ tone: 'past' });
    expect(warrantyState({ ...base, status: 'sold' }, '2026-11-05')).toBeNull();
    expect(warrantyState(blankAsset({ name: 'N' }), '2026-11-05')).toBeNull();
  });
});

describe('H1 tree', () => {
  it('breadcrumbs follow renames and descendants are found', async () => {
    const d = fresh();
    const h = await mk(d, 'Home', { type: 'property' }), k = await mk(d, 'Kitchen', { parentId: h }), w = await mk(d, 'Dishwasher', { parentId: k });
    let all = await loadAssets(d);
    expect(breadcrumb(all, w)).toBe('Home > Kitchen > Dishwasher');
    expect(whereIs(all, w)).toBe('Home > Kitchen');
    await updateAsset(k, { ...(await getAsset(k, d))!.data, name: 'Galley' }, d);
    all = await loadAssets(d);
    expect(breadcrumb(all, w)).toBe('Home > Galley > Dishwasher');
    expect([...descendantIds(all, h)].sort()).toEqual([h, k, w].sort());
  });
  it('a missing parent shows the child at the top as an orphan; a loop from sync is cut and terminates', () => {
    const mkr = (id: number, parentId: number | null, updatedAt: number) => asAsset({ id, module: 'assets', kind: 'asset', createdAt: 0, updatedAt, data: { name: `N${id}`, parentId } });
    const orphan = buildTree([mkr(1, 99, 1)]);
    expect(orphan).toHaveLength(1);
    expect(orphan[0]).toMatchObject({ depth: 0, orphan: true });
    const loop = buildTree([mkr(1, 2, 10), mkr(2, 1, 5), mkr(3, 3, 1)]);
    expect(loop.map((r) => r.asset.id).sort()).toEqual([1, 2, 3]);
    expect(loop.some((r) => r.cycle)).toBe(true);
    expect(breadcrumb([mkr(1, 2, 1), mkr(2, 1, 1)], 1).split(' > ').length).toBeLessThanOrEqual(2);
  });
});

describe('H1 records hook, linking and linked work', () => {
  it('searches, describes and says null for a missing asset', async () => {
    const d = fresh();
    // the hook reads the app database, so check the pure pieces here
    expect(parseAssetRef('asset:12')).toBe(12);
    expect(parseAssetRef('task:12')).toBeNull();
    expect(parseAssetRef('12')).toBeNull();
    expect(await assetRecords.describe('asset:999999')).toBeNull();
    expect(await assetRecords.describe('junk')).toBeNull();
    void d;
  });
  it('lists linked open and completed tasks and events, ignores deleted ones', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace');
    const t1 = await createTask(blankTask({ title: 'Replace filter', dueDate: '2026-12-01', repeat: { mode: 'after', rule: { freq: 'monthly', interval: 3, end: { type: 'never' } } as never } }), [assetRef(a)], d);
    const t2 = await createTask(blankTask({ title: 'Old job' }), [assetRef(a)], d);
    await completeTask(t2, '2026-11-05', d);
    const t3 = await createTask(blankTask({ title: 'Gone' }), [assetRef(a)], d);
    await repo<ModuleRecord>(d.moduleRecords).remove(t3);
    const ev = await createEvent(newEventData({ ...blankFields('2026-11-10'), title: 'Inspection' }, { calendarId: PERSONAL_ID, tagIds: [], contactIds: [], recurrence: null, trackDone: false }), d);
    await d.links.add({ fromModule: 'calendar', fromId: ev, toModule: 'assets', toId: `asset:${a}`, type: 'about', createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    const w = await loadLinkedWork(a, d);
    expect(w.openTasks.map((t) => t.id)).toEqual([t1]);
    expect(w.completedTasks.map((t) => t.id)).toEqual([t2]);
    expect(w.events.map((e) => e.id)).toEqual([ev]);
  });
  it('a repeating task keeps the asset link when it repeats (Tasks behaviour H2 relies on)', async () => {
    const d = fresh();
    const a = await mk(d, 'Boiler');
    const t = await createTask(blankTask({ title: 'Service', dueDate: '2026-11-01', repeat: { mode: 'fixed', rule: { freq: 'monthly', interval: 12, end: { type: 'never' } } as never } }), [assetRef(a)], d);
    const { spawnedId } = await completeTask(t, '2026-11-05', d);
    expect(spawnedId).toBeDefined();
    const w = await loadLinkedWork(a, d);
    expect(w.openTasks.map((x) => x.id)).toEqual([spawnedId]);
  });
});

describe('H1 search', () => {
  const build = (list: { id: number; data: Partial<AssetData> }[]) => list.map((x) => asAsset({ id: x.id, module: 'assets', kind: 'asset', createdAt: 0, updatedAt: x.id, data: { name: 'x', ...x.data } }));
  it('matches name, make, model, specs and shows the place; ranks archived and past last', () => {
    const all = build([
      { id: 1, data: { name: 'Home', type: 'property' } },
      { id: 2, data: { name: 'Dishwasher', parentId: 1, manufacturer: 'Acme', model: 'DW-100', specs: [{ label: 'Colour', value: 'Teal' }] } },
      { id: 3, data: { name: 'Dishwasher old', parentId: 1, status: 'replaced' } },
      { id: 4, data: { name: 'Dishwasher spare', archived: true } },
    ]);
    const r = searchAssetsData('dishwasher', all);
    expect(r.map((x) => x.title)).toEqual(['Dishwasher', 'Dishwasher old', 'Dishwasher spare']);
    expect(r[0].subtitle).toContain('Home');
    expect(searchAssetsData('acme', all)[0].title).toBe('Dishwasher');
    expect(searchAssetsData('teal', all)[0].title).toBe('Dishwasher');
    expect(searchAssetsData('dw-100', all)[0].title).toBe('Dishwasher');
    expect(searchAssetsData('', all)).toEqual([]);
    expect(searchAssetsData('home', all).some((x) => x.kind === 'Page')).toBe(true);
  });
  it('serial and plate: prefix match of 4+ characters, and the value is never shown', () => {
    const all = build([{ id: 1, data: { name: 'Mixer', serialNumber: SENTINEL.serial } }, { id: 2, data: { name: 'Car', type: 'vehicle', plate: SENTINEL.plate } }]);
    expect(searchAssetsData('sentinel-serial', all).map((x) => x.title)).toEqual(['Mixer']);
    expect(searchAssetsData('SENT', all).map((x) => x.title)).toEqual(['Mixer']);
    expect(searchAssetsData('sen', all)).toEqual([]);
    expect(searchAssetsData('zzplate', all).map((x) => x.title)).toEqual(['Car']);
    expect(searchAssetsData('99 sentinel', build([{ id: 1, data: { name: 'House', type: 'property', address: SENTINEL.address } }]))).toEqual([]); // address is not searchable
    for (const q of ['sentinel-serial', 'zzplate']) expect(JSON.stringify(searchAssetsData(q, all))).not.toMatch(/SENTINEL-SERIAL|ZZPLATE/i);
  });
});

describe('H1 Quick Add', () => {
  const mkAssets = (names: [number, string, (number | null)?, boolean?][]) => names.map(([id, name, parentId = null, archived = false]) => asAsset({ id, module: 'assets', kind: 'asset', createdAt: 0, updatedAt: id, data: { name, parentId, archived } }));
  it('an exact unique name after " in " becomes the parent; nothing fuzzy', () => {
    const all = mkAssets([[1, 'Home'], [2, 'Kitchen', 1]]);
    expect(parseAssetQuick('Dishwasher in Kitchen', all)).toMatchObject({ name: 'Dishwasher', parentId: 2, type: 'appliance', where: 'Home > Kitchen' });
    expect(parseAssetQuick('dishwasher IN  kítchen', all)).toMatchObject({ parentId: 2 });
    const typo = parseAssetQuick('Dishwasher in Kitchn', all)!;
    expect(typo).toMatchObject({ name: 'Dishwasher in Kitchn', parentId: null });
    expect(typo.note).toMatch(/stays in the name/);
    expect(parseAssetQuick('Dishwasher in Kit', all)!.parentId).toBeNull();
  });
  it('two assets with the same name, or an archived one, never become the parent', () => {
    expect(parseAssetQuick('Lamp in Den', mkAssets([[1, 'Den'], [2, 'Den']]))).toMatchObject({ parentId: null, note: expect.stringMatching(/Two assets/) });
    expect(parseAssetQuick('Lamp in Den', mkAssets([[1, 'Den', null, true]]))!.parentId).toBeNull();
  });
  it('plain mode, empty text and over-long names', () => {
    const all = mkAssets([[1, 'Kitchen']]);
    expect(parseAssetQuick('Dishwasher in Kitchen', all, true)).toMatchObject({ name: 'Dishwasher in Kitchen', parentId: null });
    expect(parseAssetQuick('   ', all)).toBeNull();
    expect(parseAssetQuick('x'.repeat(121), all)).toBeNull();
  });
  it('the preview never carries sensitive fields; commit creates and Undo removes only a clean asset', async () => {
    const p = assetQuickAdd.parse!('Toaster')!;
    expect(p.summary).toMatch(/^Toaster, Other/);
    const d = fresh();
    const made = await createAsset(blankAsset({ name: 'Toaster' }), d);
    expect(await removeNewAsset(made, d)).toBeNull();
  });
  it('is registered once, with free words', () => {
    expect(assetQuickAdd).toMatchObject({ prefix: 'a', aliases: ['asset', 'item'] });
    registerModule(assetsModule); // starts up without a clash
    expect(allQuickAdds().filter((q) => q.id === 'asset')).toHaveLength(1);
    expect(allSearchSources().some((s) => s.moduleId === 'assets')).toBe(true);
    expect(() => registerModule({ ...assetsModule, id: 'assets-test-dup' })).toThrow(/clashes/);
  });
});

describe('H1 sensitive values stay out of every outward string', () => {
  it('publicLabel, breadcrumb, records.search/describe labels, search results and the quick-add preview', async () => {
    const d = fresh();
    const h = await mk(d, 'Home', { type: 'property', address: SENTINEL.address, serialNumber: SENTINEL.serial });
    const c = await mk(d, 'Car', { type: 'vehicle', parentId: h, plate: SENTINEL.plate, serialNumber: SENTINEL.serial, notes: 'plain note' });
    const all = await loadAssets(d);
    const outward = [
      publicLabel(all, c), breadcrumb(all, c), whereIs(all, c),
      JSON.stringify(searchAssetsData('car', all)), JSON.stringify(searchAssetsData('SENTINEL-SERIAL', all)),
      JSON.stringify(parseAssetQuick('Car cover in Car', all)),
    ].join('\n');
    expect(outward).not.toMatch(/SENTINEL|ZZPLATE|Sentinel Test Lane/i);
  });
});

describe('H1 backup', () => {
  it('assets survive an export and restore, with every field; a backup made before H1 restores with none', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace', { manufacturer: 'Acme', serialNumber: 'S-1', contacts: [{ contactId: 7, role: 'installer' }], refs: [{ label: 'Receipt', url: 'https://example.com/r' }] });
    const text = JSON.stringify(await exportAll(d));
    const target = fresh();
    await target.open();
    await importAll(target, checkBackupText(text).file);
    expect((await getAsset(a, target))!.data).toMatchObject({ name: 'Furnace', manufacturer: 'Acme', serialNumber: 'S-1', contacts: [{ contactId: 7, role: 'installer' }] });
    const old = { ...(JSON.parse(text) as Record<string, unknown>), moduleRecords: [] };
    const empty = fresh();
    await empty.open();
    await importAll(empty, checkBackupText(JSON.stringify(old)).file);
    expect(await loadAssets(empty)).toEqual([]);
  });
});

describe('H1 deletion plan and execution', () => {
  it('is blocked by a child, a replaced-by pointer, a dependent record and a completed linked task', async () => {
    const d = fresh();
    const a = await mk(d, 'Parent');
    await mk(d, 'Child', { parentId: a });
    expect((await planAssetDeletion(a, d)).reasons.join(' ')).toMatch(/inside it/);
    const b = await mk(d, 'New'), o = await mk(d, 'Old');
    await setAssetStatus(o, { status: 'replaced', statusDate: null, statusNote: '', replacedById: b }, d);
    expect((await planAssetDeletion(b, d)).reasons.join(' ')).toMatch(/replaced by this one/);
    const s = await mk(d, 'Serviced');
    for (const kind of ASSET_DEPENDENT_KINDS) {
      const id = await repo<ModuleRecord>(d.moduleRecords).put({ module: 'assets', kind, data: { assetId: s } });
      expect((await planAssetDeletion(s, d)).reasons.join(' ')).toMatch(/history/);
      await repo<ModuleRecord>(d.moduleRecords).remove(id);
    }
    expect((await planAssetDeletion(s, d)).canDelete).toBe(true);
    const t = await createTask(blankTask({ title: 'Done job' }), [assetRef(s)], d);
    await completeTask(t, '2026-11-05', d);
    expect((await planAssetDeletion(s, d)).reasons.join(' ')).toMatch(/completed/);
    await expect(deleteAssetPermanently(s, d)).rejects.toThrow(/cannot be deleted yet/);
    expect(await getAsset(s, d)).toBeDefined();
  });
  it('deletes a clean asset with a marker, unlinks open tasks and events, keeps them', async () => {
    const d = fresh();
    const a = await mk(d, 'Mistake');
    const t = await createTask(blankTask({ title: 'Open job' }), [assetRef(a)], d);
    const res = await deleteAssetPermanently(a, d);
    expect(res.linksRemoved).toBe(1);
    expect(await getAsset(a, d)).toBeUndefined();
    const raw = (await d.moduleRecords.get(a))!;
    expect(raw.deletedAt).toBeGreaterThan(0);
    expect((raw.data as Record<string, unknown>).permanentlyDeletedAt).toBeGreaterThan(0);
    expect((await loadTasks(d)).map((x) => x.id)).toContain(t);
    expect(await linksToAsset(a, d)).toEqual([]);
    await expect(planAssetDeletion(a, d)).rejects.toThrow(/no longer exists/);
  });
  it('a failure part-way changes nothing', async () => {
    const d = fresh();
    const a = await mk(d, 'Atomic');
    await createTask(blankTask({ title: 'Open job' }), [assetRef(a)], d);
    const orig = d.links.put.bind(d.links);
    (d.links as unknown as { put: unknown }).put = () => { throw new Error('boom'); };
    await expect(deleteAssetPermanently(a, d)).rejects.toThrow(/boom/);
    (d.links as unknown as { put: unknown }).put = orig;
    expect(await getAsset(a, d)).toBeDefined();
    expect((await linksToAsset(a, d)).length).toBe(1);
  });
});
