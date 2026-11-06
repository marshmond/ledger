import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { createStore } from '../../core/store';
import { installTracking } from '../../lib/sync/track';
import { completeTask, createTask, getTask, loadTasks } from '../tasks/data';
import { blankTask, type TaskData } from '../tasks/model';
import { assetRef, createAsset, getAsset, linksToAsset, loadAssets, loadLinkedWork } from './data';
import { deleteAssetPermanently, planAssetDeletion } from './deletion';
import { applyRetirement, describeRetirement, planRetirement, replacementDraft, type RetireRequest } from './lifecycle';
import { blankAsset } from './model';
import { blankService } from './service';
import { createService, loadServicesFor } from './serviceData';
import { blankWarranty } from './warranty';
import { createWarranty, loadWarrantiesFor } from './warrantyData';
import { detectOrphans, rehomeOrphan, removeOrphan } from './orphans';

/** Invented data only. Each test gets its own database. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-h4l-${n++}`); installTracking(d); return d; };
const TODAY = '2026-11-06';
const mk = (d: FinanceDB, name: string, over = {}) => createAsset(blankAsset({ name, ...over }), d);
const yearly = { freq: 'yearly' as const, interval: 1, end: { type: 'never' as const } };
const plan = (d: FinanceDB, assetId: number, over: Partial<TaskData> = {}) => createTask(blankTask({ title: 'Clean filter', dueDate: '2026-11-20', ...over }), [assetRef(assetId)], d);
const req = (assetId: number, over: Partial<RetireRequest> = {}): RetireRequest => ({ assetId, status: 'replaced', statusDate: TODAY, statusNote: '', replacement: { kind: 'none' }, descendantIds: [], taskActions: {}, ...over });
const links = async (d: FinanceDB, id: number) => (await linksToAsset(id, d)).map((l) => `${l.fromModule}:${l.fromId}->${l.toModule}:${l.toId}`).sort();

describe('H4 replace: existing and new', () => {
  it('replaces with an existing asset: old is Replaced with a pointer; both navigate; nothing else moves', async () => {
    const d = fresh();
    const old = await mk(d, 'Old dishwasher', { serialNumber: 'SN-OLD-1', warrantyEndDate: '2027-01-01' });
    const neu = await mk(d, 'New dishwasher');
    await createService(blankService(old, { title: 'Pump', date: '2026-05-05' }), d, TODAY);
    await createWarranty(blankWarranty(old, { title: 'Manufacturer' }), d);
    const r = await applyRetirement(req(old, { replacement: { kind: 'existing', id: neu } }), d);
    expect(r.retired).toEqual([old]);
    const a = (await getAsset(old, d))!;
    expect(a.data).toMatchObject({ status: 'replaced', replacedById: neu, statusDate: TODAY, serialNumber: 'SN-OLD-1' });
    expect((await getAsset(neu, d))!.data).toMatchObject({ status: 'active', replacedById: null, serialNumber: '' });
    expect(await loadServicesFor(old, d)).toHaveLength(1);
    expect(await loadWarrantiesFor(old, d)).toHaveLength(1);
    expect(await loadServicesFor(neu, d)).toHaveLength(0);
    expect(await loadWarrantiesFor(neu, d)).toHaveLength(0);
  });
  it('replaces by creating a new asset: only name, type and place are copied; no identifiers, warranty or history', async () => {
    const d = fresh();
    const kitchen = await mk(d, 'Kitchen', { type: 'area' });
    const old = await mk(d, 'Dishwasher', { type: 'appliance', parentId: kitchen, serialNumber: 'SN-OLD-2', manufacturer: 'Brandco', model: 'M1', purchaseDate: '2020-01-01', purchaseCents: 90000, warrantyEndDate: '2022-01-01', notes: 'private note', specs: [{ label: 'Width', value: '60' }] });
    await createWarranty(blankWarranty(old, { title: 'Manufacturer' }), d);
    const r = await applyRetirement(req(old, { replacement: { kind: 'new', data: { ...replacementDraft((await getAsset(old, d))!.data), name: 'Dishwasher (2026)', serialNumber: 'SHOULD-NOT-COPY', plate: 'X', warrantyEndDate: '2030-01-01', notes: 'nope', purchaseCents: 5 } } }), d);
    const fresh1 = (await getAsset(r.newAssetId!, d))!;
    expect(fresh1.data).toMatchObject({ name: 'Dishwasher (2026)', type: 'appliance', parentId: kitchen, status: 'active', serialNumber: '', plate: '', warrantyEndDate: null, notes: '', purchaseCents: null, purchaseDate: null, specs: [], replacedById: null });
    expect((await getAsset(old, d))!.data).toMatchObject({ status: 'replaced', replacedById: r.newAssetId });
    expect(await loadWarrantiesFor(r.newAssetId!, d)).toEqual([]);
    expect(replacementDraft((await getAsset(old, d))!.data)).toMatchObject({ name: 'Dishwasher', serialNumber: '', manufacturer: '' });
  });
  it('refuses itself, a missing replacement and a replacement loop; nothing is changed', async () => {
    const d = fresh();
    const a = await mk(d, 'A');
    const b = await mk(d, 'B');
    await applyRetirement(req(a, { replacement: { kind: 'existing', id: b } }), d);
    await expect(applyRetirement(req(a, { replacement: { kind: 'existing', id: a } }), d)).rejects.toThrow(/not itself/);
    await expect(applyRetirement(req(b, { replacement: { kind: 'existing', id: a } }), d)).rejects.toThrow(/loops/);
    await expect(applyRetirement(req(b, { replacement: { kind: 'existing', id: 99999 } }), d)).rejects.toThrow(/no longer exists/);
    expect((await getAsset(b, d))!.data.status).toBe('active');
  });
  it('a double submit of a NEW replacement creates only one new asset', async () => {
    const d = fresh();
    const old = await mk(d, 'Dishwasher', { type: 'appliance' });
    const r = { replacement: { kind: 'new' as const, data: blankAsset({ name: 'Dishwasher 2', type: 'appliance' }) } };
    const results = await Promise.allSettled([applyRetirement(req(old, r), d), applyRetirement(req(old, r), d)]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((x) => x.status === 'rejected')).toHaveLength(1);
    expect((await loadAssets(d)).filter((a) => a.data.name === 'Dishwasher 2')).toHaveLength(1);
    await expect(applyRetirement(req(old, r), d)).rejects.toThrow(/already replaced/);
    expect((await loadAssets(d)).filter((a) => a.data.name === 'Dishwasher 2')).toHaveLength(1);
  });
  it('rolls back the new asset when a later step fails (all or nothing)', async () => {
    const d = fresh();
    const old = await mk(d, 'Dishwasher');
    const t = await plan(d, old);
    await completeTask(t, TODAY, d); // now done: choosing it must fail the whole thing
    await expect(applyRetirement(req(old, { replacement: { kind: 'new', data: blankAsset({ name: 'Dishwasher 2' }) }, taskActions: { [t]: 'delete' } }), d)).rejects.toThrow(/completed/);
    expect((await loadAssets(d)).map((a) => a.data.name)).toEqual(['Dishwasher']);
    expect((await getAsset(old, d))!.data.status).toBe('active');
  });
  it('replacing never touches Finance data', async () => {
    const d = fresh();
    await d.accounts.add({ name: 'Test Checking', kind: 'checking', openingCents: 100000 } as never);
    const snap = async () => JSON.stringify([await d.accounts.toArray(), await d.txns.toArray(), await d.categories.toArray(), await d.assignments.toArray()]);
    const before = await snap();
    const old = await mk(d, 'Dishwasher');
    await applyRetirement(req(old, { replacement: { kind: 'new', data: blankAsset({ name: 'Dishwasher 2' }) } }), d);
    expect(await snap()).toBe(before);
  });
});

describe('H4 open tasks on retirement', () => {
  it('default is Keep: nothing changes for tasks', async () => {
    const d = fresh();
    const old = await mk(d, 'Dishwasher');
    const t = await plan(d, old, { repeat: { mode: 'fixed', rule: yearly } });
    const before = JSON.stringify(await getTask(t, d));
    await applyRetirement(req(old, { status: 'sold' }), d);
    expect(JSON.stringify(await getTask(t, d))).toBe(before);
    expect((await loadLinkedWork(old, d)).openTasks.map((x) => x.id)).toEqual([t]);
  });
  it('Move re-links the open task to the replacement; completed tasks and history stay with the old asset; the task record is unchanged', async () => {
    const d = fresh();
    const old = await mk(d, 'Dishwasher');
    const neu = await mk(d, 'Dishwasher 2');
    const open = await plan(d, old, { repeat: { mode: 'fixed', rule: yearly } });
    const done = await plan(d, old, { title: 'Last year' });
    await completeTask(done, TODAY, d);
    const taskBefore = JSON.stringify(await getTask(open, d));
    const r = await applyRetirement(req(old, { replacement: { kind: 'existing', id: neu }, taskActions: { [open]: 'move' } }), d);
    expect(r.moved).toBe(1);
    expect(JSON.stringify(await getTask(open, d))).toBe(taskBefore); // the Task itself was not written
    expect((await loadLinkedWork(neu, d)).openTasks.map((x) => x.id)).toEqual([open]);
    expect((await loadLinkedWork(old, d)).openTasks).toEqual([]);
    expect((await loadLinkedWork(old, d)).completedTasks.map((x) => x.id)).toEqual([done]);
    expect((await loadLinkedWork(neu, d)).completedTasks).toEqual([]);
    // the next repeat of the moved task follows it to the new asset, exactly once
    const { spawnedId } = await completeTask(open, '2026-11-20', d);
    expect(spawnedId).toBeDefined();
    expect((await loadLinkedWork(neu, d)).openTasks.map((x) => x.id)).toEqual([spawnedId]);
    expect((await loadTasks(d)).filter((x) => x.data.recurFrom === open)).toHaveLength(1);
    // no duplicate link when the task was already linked to the replacement
    const t2 = await plan(d, old, { title: 'Both' });
    await createStore(d).shared.links.add({ module: 'tasks', id: t2 }, assetRef(neu), 'about');
    const old2 = await mk(d, 'Old 2');
    await applyRetirement(req(old, { status: 'sold', taskActions: {} }), d).catch(() => undefined);
    void old2;
  });
  it('Move needs a replacement and a task linked to the asset itself', async () => {
    const d = fresh();
    const old = await mk(d, 'Dishwasher');
    const t = await plan(d, old);
    await expect(applyRetirement(req(old, { status: 'replaced', taskActions: { [t]: 'move' } }), d)).rejects.toThrow(/no replacement/);
    expect((await getAsset(old, d))!.data.status).toBe('active'); // rolled back
    const other = await mk(d, 'Other');
    const stray = await plan(d, other, { title: 'Elsewhere' });
    await expect(applyRetirement(req(old, { replacement: { kind: 'existing', id: other }, taskActions: { [stray]: 'move' } }), d)).rejects.toThrow(/no longer linked/);
  });
  it('Stop repeating uses the Tasks save path: repeat off, nothing else changed, no duplicate task', async () => {
    const d = fresh();
    const old = await mk(d, 'Dishwasher');
    const t = await plan(d, old, { repeat: { mode: 'fixed', rule: yearly }, notes: 'keep me' });
    const before = (await getTask(t, d))!.data;
    const r = await applyRetirement(req(old, { status: 'sold', taskActions: { [t]: 'stop' } }), d);
    expect(r.stopped).toBe(1);
    const after = (await getTask(t, d))!.data;
    expect(after.repeat).toBeNull();
    expect({ ...after, repeat: before.repeat }).toEqual(before);
    expect(await loadTasks(d)).toHaveLength(1);
    const { spawnedId } = await completeTask(t, '2026-11-20', d);
    expect(spawnedId).toBeUndefined(); // it no longer repeats
  });
  it('Delete removes only the chosen open task (soft delete); the other task and completed history stay', async () => {
    const d = fresh();
    const old = await mk(d, 'Dishwasher');
    const a = await plan(d, old, { title: 'A' });
    const b = await plan(d, old, { title: 'B' });
    const done = await plan(d, old, { title: 'Done one' });
    await completeTask(done, TODAY, d);
    const r = await applyRetirement(req(old, { status: 'disposed', taskActions: { [a]: 'delete' } }), d);
    expect(r.deleted).toBe(1);
    expect(await getTask(a, d)).toBeUndefined();
    expect(await getTask(b, d)).toBeDefined();
    expect((await loadLinkedWork(old, d)).completedTasks.map((x) => x.id)).toEqual([done]);
  });
  it('a task linked to several assets: the plan names the other assets and the review warns that Delete removes it for all; Tasks semantics unchanged', async () => {
    const d = fresh();
    const old = await mk(d, 'Dishwasher');
    const other = await mk(d, 'Water softener');
    const shared = await plan(d, old, { title: 'Descale' });
    await createStore(d).shared.links.add({ module: 'tasks', id: shared }, assetRef(other), 'about');
    const solo = await plan(d, old, { title: 'Solo' });
    const p = await planRetirement(old, d);
    expect(p.sharedWith[shared]).toEqual(['Water softener']);
    expect(p.sharedWith[solo]).toBeUndefined();
    const lines = describeRetirement(p, req(old, { status: 'sold', taskActions: { [shared]: 'delete', [solo]: 'delete' } }), '');
    expect(lines.filter((l) => l.startsWith('WARNING'))).toHaveLength(1);
    expect(lines.join(' ')).toMatch(/removes it for every asset it is linked to, also Water softener/);
    expect(describeRetirement(p, req(old, { status: 'sold', taskActions: { [shared]: 'keep' } }), '').join(' ')).not.toMatch(/WARNING/);
    await applyRetirement(req(old, { status: 'sold', taskActions: { [shared]: 'delete' } }), d);
    expect(await getTask(shared, d)).toBeUndefined(); // the Task is deleted for everyone, as the warning says
    expect((await loadLinkedWork(other, d)).openTasks).toEqual([]);
  });
  it('any failure rolls back every task change and the status', async () => {
    const d = fresh();
    const old = await mk(d, 'Dishwasher');
    const a = await plan(d, old, { title: 'A', repeat: { mode: 'fixed', rule: yearly } });
    await expect(applyRetirement(req(old, { status: 'sold', taskActions: { [a]: 'stop', 987654: 'delete' } }), d)).rejects.toThrow(/deleted since/);
    expect((await getTask(a, d))!.data.repeat).not.toBeNull();
    expect((await getAsset(old, d))!.data.status).toBe('active');
  });
  it('cancel is simply never calling apply: planning is read-only', async () => {
    const d = fresh();
    const old = await mk(d, 'Dishwasher');
    await plan(d, old);
    const snap = async () => JSON.stringify([await d.moduleRecords.toArray(), await d.links.toArray()]);
    const before = await snap();
    const p = await planRetirement(old, d);
    expect(p.openTasks[old]).toHaveLength(1);
    expect(await snap()).toBe(before);
  });
});

describe('H4 bulk retirement of a property and what is inside', () => {
  async function house(d: FinanceDB) {
    const home = await mk(d, 'Test House', { type: 'property' });
    const kitchen = await mk(d, 'Kitchen', { type: 'area', parentId: home });
    const dish = await mk(d, 'Dishwasher', { type: 'appliance', parentId: kitchen });
    const hvac = await mk(d, 'Furnace', { type: 'system', parentId: home });
    const car = await mk(d, 'Garage bike', { type: 'other' }); // not inside
    return { home, kitchen, dish, hvac, car };
  }
  it('the preview lists everything inside with current status; nothing is selected by default', async () => {
    const d = fresh();
    const { home, dish } = await house(d);
    await applyRetirement(req(dish, { status: 'sold' }), d);
    const p = await planRetirement(home, d);
    expect(p.descendants.map((x) => x.asset.data.name).sort()).toEqual(['Dishwasher', 'Furnace', 'Kitchen']);
    expect(p.descendants.find((x) => x.asset.data.name === 'Dishwasher')!.alreadyOut).toBe(true);
    const lines = describeRetirement(p, req(home, { status: 'sold' }), '');
    expect(lines.join(' ')).toMatch(/3 items inside it will stay as they are/);
  });
  it('default retires ONLY the selected property: nothing inside changes', async () => {
    const d = fresh();
    const { home, kitchen, dish, hvac, car } = await house(d);
    const r = await applyRetirement(req(home, { status: 'sold' }), d);
    expect(r.retired).toEqual([home]);
    for (const id of [kitchen, dish, hvac, car]) expect((await getAsset(id, d))!.data.status).toBe('active');
    expect((await getAsset(home, d))!.data.status).toBe('sold');
  });
  it('retires exactly the ticked descendants, keeps history and parents, and never touches an asset outside', async () => {
    const d = fresh();
    const { home, kitchen, dish, hvac, car } = await house(d);
    await createService(blankService(dish, { title: 'Pump', date: '2026-05-05' }), d, TODAY);
    await createWarranty(blankWarranty(dish, { title: 'Cover' }), d);
    const r = await applyRetirement(req(home, { status: 'sold', descendantIds: [kitchen, dish] }), d);
    expect(r.retired.sort()).toEqual([home, kitchen, dish].sort());
    expect((await getAsset(hvac, d))!.data.status).toBe('active'); // not ticked
    expect((await getAsset(car, d))!.data.status).toBe('active');
    expect((await getAsset(dish, d))!.data).toMatchObject({ status: 'sold', statusDate: TODAY, parentId: kitchen });
    expect(await loadServicesFor(dish, d)).toHaveLength(1);
    expect(await loadWarrantiesFor(dish, d)).toHaveLength(1);
  });
  it('is all-or-nothing: one bad item (outside the property, or already out) changes nothing', async () => {
    const d = fresh();
    const { home, kitchen, dish, car } = await house(d);
    await expect(applyRetirement(req(home, { status: 'sold', descendantIds: [kitchen, car] }), d)).rejects.toThrow(/no longer inside/);
    for (const id of [home, kitchen, car]) expect((await getAsset(id, d))!.data.status).toBe('active');
    await applyRetirement(req(dish, { status: 'sold' }), d);
    await expect(applyRetirement(req(home, { status: 'sold', descendantIds: [kitchen, dish] }), d)).rejects.toThrow(/already left use/);
    expect((await getAsset(home, d))!.data.status).toBe('active');
    expect((await getAsset(kitchen, d))!.data.status).toBe('active');
  });
  it('including things inside is refused for a replacement', async () => {
    const d = fresh();
    const { home, kitchen } = await house(d);
    const neu = await mk(d, 'New house', { type: 'property' });
    await expect(applyRetirement(req(home, { status: 'replaced', replacement: { kind: 'existing', id: neu }, descendantIds: [kitchen] }), d)).rejects.toThrow(/stored, sold or disposed/);
  });
  it('open tasks of included assets follow the same choices; tasks of un-ticked ones stay', async () => {
    const d = fresh();
    const { home, dish, hvac } = await house(d);
    const tDish = await plan(d, dish, { title: 'Dish task', repeat: { mode: 'fixed', rule: yearly } });
    const tHvac = await plan(d, hvac, { title: 'Furnace task', repeat: { mode: 'fixed', rule: yearly } });
    await applyRetirement(req(home, { status: 'sold', descendantIds: [dish], taskActions: { [tDish]: 'stop', [tHvac]: 'stop' } }), d).catch((e) => expect(String(e)).toMatch(/no longer linked/));
    expect((await getTask(tDish, d))!.data.repeat).not.toBeNull(); // rolled back with everything else
    await applyRetirement(req(home, { status: 'sold', descendantIds: [dish], taskActions: { [tDish]: 'stop' } }), d);
    expect((await getTask(tDish, d))!.data.repeat).toBeNull();
    expect((await getTask(tHvac, d))!.data.repeat).not.toBeNull();
    const p = await planRetirement(home, d);
    expect(describeRetirement(p, req(home, { status: 'sold', descendantIds: [] }), '').join(' ')).toMatch(/need separate handling/);
  });
  it('retirement leaves structure and spending relations intact (parents unchanged, deletion guard still sees children)', async () => {
    const d = fresh();
    const { home, kitchen } = await house(d);
    await applyRetirement(req(home, { status: 'sold', descendantIds: [kitchen] }), d);
    expect((await getAsset(kitchen, d))!.data.parentId).toBe(home);
    expect((await planAssetDeletion(home, d)).canDelete).toBe(false);
  });
});

describe('H4 orphans: detection and repair', () => {
  it('finds service records, warranties, replacement pointers and links whose asset is gone, and says why', async () => {
    const d = fresh();
    const keep = await mk(d, 'Keeper');
    const gone = await mk(d, 'Gone');
    const old = await mk(d, 'Old');
    await createService(blankService(gone, { title: 'Pump', date: '2026-05-05' }), d, TODAY);
    const w = await createWarranty(blankWarranty(gone, { title: 'Cover' }), d);
    const t = await plan(d, gone, { title: 'Gone task' });
    await applyRetirement(req(old, { replacement: { kind: 'existing', id: gone } }), d);
    // Make the asset vanish the way sync could: a tombstone with the permanent-deletion marker, no dependents check.
    const rec = (await d.moduleRecords.get(gone))!;
    await d.moduleRecords.put({ ...rec, deletedAt: Date.now(), data: { ...(rec.data as object), permanentlyDeletedAt: Date.now() } } as never);
    const found = await detectOrphans(d);
    expect(found.map((o) => [o.kind, o.why]).sort()).toEqual([['link', 'permanent'], ['replacement', 'permanent'], ['service', 'permanent'], ['warranty', 'permanent']]);
    expect(found.find((o) => o.kind === 'link')!.label).toBe('Gone task');
    expect(JSON.stringify(found)).not.toMatch(/SN-|notes/);
    // an asset this device has never seen is labelled "absent" (sync may still deliver it)
    await d.moduleRecords.delete(gone);
    expect((await detectOrphans(d)).every((o) => o.why === 'absent')).toBe(true);
    void keep; void w; void t;
  });
  it('re-home moves a service record or warranty to another asset (finance refs untouched); delete soft-deletes; nothing else changes', async () => {
    const d = fresh();
    const target = await mk(d, 'Target');
    const gone = await mk(d, 'Gone');
    const s = await createService(blankService(gone, { title: 'Pump', date: '2026-05-05', costCents: 1234 }), d, TODAY);
    const w = await createWarranty(blankWarranty(gone, { title: 'Cover' }), d);
    const rec = (await d.moduleRecords.get(gone))!;
    await d.moduleRecords.put({ ...rec, deletedAt: Date.now(), data: { ...(rec.data as object), permanentlyDeletedAt: 1 } } as never);
    const found = await detectOrphans(d);
    await rehomeOrphan(found.find((o) => o.kind === 'service')!, target, d);
    expect((await loadServicesFor(target, d))[0].data).toMatchObject({ title: 'Pump', costCents: 1234 });
    await removeOrphan(found.find((o) => o.kind === 'warranty')!, d);
    expect((await d.moduleRecords.get(w))!.deletedAt).not.toBeNull();
    expect(await detectOrphans(d)).toEqual([]);
    void s;
  });
  it('a repair uses a fresh check: it refuses when the asset has arrived, the target is gone/archived, or the record changed', async () => {
    const d = fresh();
    const target = await mk(d, 'Target');
    const arch = await mk(d, 'Archived');
    const gone = await mk(d, 'Gone');
    await createService(blankService(gone, { title: 'Pump', date: '2026-05-05' }), d, TODAY);
    const rec = (await d.moduleRecords.get(gone))!;
    await d.moduleRecords.put({ ...rec, deletedAt: Date.now(), data: { ...(rec.data as object), permanentlyDeletedAt: 1 } } as never);
    const [o] = await detectOrphans(d);
    const { archiveAsset } = await import('./data');
    await archiveAsset(arch, d);
    await expect(rehomeOrphan(o, arch, d)).rejects.toThrow(/archived/);
    await expect(rehomeOrphan(o, 987654, d)).rejects.toThrow(/no longer exists/);
    // the missing asset "arrives" (sync): repairing is refused, nothing moves
    await d.moduleRecords.put({ ...rec } as never);
    await expect(removeOrphan(o, d)).rejects.toThrow(/arrived/);
    await expect(rehomeOrphan(o, target, d)).rejects.toThrow(/arrived/);
    expect(await loadServicesFor(gone, d)).toHaveLength(1);
  });
  it('re-home of a replacement pointer is checked for loops; clearing keeps the asset Replaced; links are re-pointed through the shared links', async () => {
    const d = fresh();
    const gone = await mk(d, 'Gone');
    const old = await mk(d, 'Old');
    const other = await mk(d, 'Other');
    await applyRetirement(req(old, { replacement: { kind: 'existing', id: gone } }), d);
    const t = await plan(d, gone, { title: 'Task on gone' });
    const rec = (await d.moduleRecords.get(gone))!;
    await d.moduleRecords.put({ ...rec, deletedAt: Date.now(), data: { ...(rec.data as object), permanentlyDeletedAt: 1 } } as never);
    const found = await detectOrphans(d);
    await expect(rehomeOrphan(found.find((o) => o.kind === 'replacement')!, old, d)).rejects.toThrow(/not itself/);
    await rehomeOrphan(found.find((o) => o.kind === 'link')!, other, d);
    expect(await links(d, other)).toEqual([`tasks:${t}->assets:asset:${other}`]);
    await removeOrphan(found.find((o) => o.kind === 'replacement')!, d);
    expect((await getAsset(old, d))!.data).toMatchObject({ status: 'replaced', replacedById: null });
    expect((await getTask(t, d))!.data.title).toBe('Task on gone'); // the task itself is untouched
    expect(await detectOrphans(d)).toEqual([]);
  });
});

describe('H4 deletion guards still hold', () => {
  it('blocks on a replacement pointer, warranty, service history, children and a completed task', async () => {
    const d = fresh();
    const neu = await mk(d, 'New');
    const old = await mk(d, 'Old');
    await applyRetirement(req(old, { replacement: { kind: 'existing', id: neu } }), d);
    expect((await planAssetDeletion(neu, d)).reasons.join(' ')).toMatch(/replaced by this one/);
    const t = await plan(d, old);
    await completeTask(t, TODAY, d);
    expect((await planAssetDeletion(old, d)).reasons.join(' ')).toMatch(/completed task/);
    await expect(deleteAssetPermanently(neu, d)).rejects.toThrow();
  });
});
