import { scanText } from '../../lib/leakTestkit';
import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { createStore } from '../../core/store';
import { installTracking } from '../../lib/sync/track';
import { createAsset, linksToAsset, loadAssets, setAssetStatus } from '../assets/data';
import { blankAsset } from '../assets/model';
import { deleteAssetPermanently, planAssetDeletion } from '../assets/deletion';
import { addVendor, createProject, projectsUsingContact } from '../projects/data';
import { deleteProjectPermanently } from '../projects/deletion';
import { blankProject } from '../projects/model';
import { loadProjectSummary } from '../../lib/txnProject';
import { applyLifecycle, planLifecycle } from './changes';
import { applyMoveToReplacement, loadAssetServices, MOVE_STALE, planMoveToReplacement } from './assetLinks';
import { createArrangement, getArrangement, linkedAssetIds, syncAssetLinks } from './data';
import { blankArrangement } from './model';
import { explicitProjectIds, linkProject, projectLinksOf, servicesOfProject, unlinkProject } from './projectLinks';
import { applyUndo, isUndoRefused } from './undo';
import { assetViews, loadSnapshot } from './views';
import { loadVisits, logStandaloneVisit, visitAssetIds } from './visits';
import { providerNamed } from '../../core/contactTestkit';

/** Invented data only. Real Dexie, real shared links. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-s4a-${n++}`); installTracking(d); return d; };
const TODAY = '2026-11-06';
const asset = (d: FinanceDB, name: string, over = {}) => createAsset(blankAsset({ name, type: 'system', ...over }), d);
const arr = async (d: FinanceDB, assetIds: number[], title = 'Furnace plan', provider = 'Pat Heating', data = {}) =>
  createArrangement({ data: blankArrangement({ title, ...data }), provider: await providerNamed(d, provider), assetIds, today: TODAY }, d);
const visitOf = async (d: FinanceDB, arrangementId: number | null, assetIds?: number[]) =>
  (await logStandaloneVisit({ arrangementId, provider: arrangementId ? undefined : { name: 'Pat Heating' }, assetIds, input: { status: 'completed', cancelledBy: null, date: '2026-11-03', title: 'Inspection', chargedCents: null, chargeKind: null }, today: TODAY }, d)).visitId;
const replaced = async (d: FinanceDB, oldId: number, newId: number | null) => setAssetStatus(oldId, { status: 'replaced', statusDate: '2026-10-01', statusNote: '', replacedById: newId }, d);
const serves = async (d: FinanceDB, id: number) => (await linkedAssetIds(id, d)).sort((a, b) => a - b);

describe('S4-A1 the asset page lists the arrangements that serve it', () => {
  it('15. several arrangements on one asset, one arrangement on several assets, ended ones, replaced providers and a missing Contact', async () => {
    const d = fresh();
    const furnace = await asset(d, 'Furnace'), boiler = await asset(d, 'Boiler');
    const plan = await arr(d, [furnace, boiler], 'Heating plan', 'Pat Heating');
    const filters = await arr(d, [furnace], 'Filter delivery', 'Fresh Air Co');
    const old = await arr(d, [furnace], 'Old tune-up', 'Gone Ltd');
    await applyLifecycle({ action: 'end', arrangementId: old.id, expect: (await planLifecycle(old.id, 'end', TODAY, d)).expect, today: TODAY, endReason: 'cancelled' }, d);
    const rep = await applyLifecycle({ action: 'replace', arrangementId: plan.id, expect: (await planLifecycle(plan.id, 'replace', TODAY, d)).expect, today: TODAY, replace: { provider: { name: 'New Heat' } } }, d);
    await d.contacts.toCollection().modify((c: { name: string; deletedAt?: number | null }) => { if (c.name === 'Fresh Air Co') c.deletedAt = Date.now(); });
    const view = await loadAssetServices(furnace, d);
    expect(view.rows.map((r) => r.title).sort()).toEqual(['Filter delivery', 'Heating plan', 'Heating plan', 'Old tune-up']);
    expect(view.rows.map((r) => r.status)).toEqual(['active', 'active', 'ended', 'ended']); // active first
    expect(view.rows.find((r) => r.arrangementId === filters.id)).toMatchObject({ contactGone: true, providerName: 'Fresh Air Co' });
    expect(view.rows.find((r) => r.arrangementId === rep.successorId)).toMatchObject({ providerName: 'New Heat', status: 'active' });
    expect((await loadAssetServices(boiler, d)).rows.map((r) => r.arrangementId).sort()).toEqual([plan.id, rep.successorId!].sort((a, b) => a - b));
  });
  it('shows no private data: the row holds a title, a provider name, a status and a schedule only', async () => {
    const d = fresh();
    const a = await asset(d, 'Furnace');
    await createArrangement({ data: blankArrangement({ title: 'Plan', notes: 'code 4455', expected: { basis: 'perMonth', cents: 9999 }, refs: [{ label: 'C', url: 'https://example.com/secret' }] }), provider: { name: 'Pat', phone: '555-0100' }, assetIds: [a], today: TODAY }, d);
    expect(scanText(await loadAssetServices(a, d))).not.toMatch(/4455|9999|secret|555-0100/);
  });
  it('a soft-deleted arrangement is skipped and counted, never a crash; links received before their record are tolerated', async () => {
    const d = fresh();
    const a = await asset(d, 'Furnace');
    const r = await arr(d, [a]);
    await createStore(d).shared.links.add({ module: 'services', id: 'arrangement:424242' }, { module: 'assets', id: `asset:${a}` }, 'serves');
    await d.moduleRecords.update(r.id, { deletedAt: Date.now() } as never);
    expect(await loadAssetServices(a, d)).toEqual({ rows: [], unavailable: 2 });
  });
  it('a status change of the asset shows up with no copy stored on it', async () => {
    const d = fresh();
    const a = await asset(d, 'Furnace');
    await arr(d, [a]);
    const before = JSON.stringify((await loadAssets(d)).map((x) => x.data));
    await replaced(d, a, null);
    expect((await loadAssetServices(a, d)).rows).toHaveLength(1);
    expect(JSON.stringify((await loadAssets(d)).map((x) => ({ ...x.data, status: 'active', statusDate: null, statusNote: '', replacedById: null })))).toBe(before);
  });
});

describe('S4-A4 replaced assets: Move to replacement', () => {
  async function setup() {
    const d = fresh();
    const oldA = await asset(d, 'Old furnace'), newA = await asset(d, 'New furnace');
    const r = await arr(d, [oldA]);
    const v = await visitOf(d, r.id);
    await replaced(d, oldA, newA);
    return { d, oldA, newA, r, v };
  }
  it('16. a replaced asset is flagged on the arrangement; the preview names both assets and says history is kept', async () => {
    const { d, oldA, newA, r } = await setup();
    const row = assetViews(await serves(d, r.id), await loadAssets(d))[0];
    expect(row).toMatchObject({ id: oldA, status: 'replaced', replacementId: newA });
    const plan = await planMoveToReplacement(r.id, oldA, d);
    expect(plan.problem).toBeNull();
    expect(plan.lines.join(' ')).toMatch(/New furnace instead of Old furnace/);
    expect(plan.lines.join(' ')).toMatch(/Past visits keep their own links.*not rewritten/);
    expect(await serves(d, r.id)).toEqual([oldA]); // a preview changes nothing
  });
  it('17. Move: the current link changes; the visit keeps its link to the old asset; provider, cadence and visits are untouched', async () => {
    const { d, oldA, newA, r, v } = await setup();
    const before = (await getArrangement(r.id, d))!.data;
    const plan = await planMoveToReplacement(r.id, oldA, d);
    await applyMoveToReplacement({ arrangementId: r.id, expect: plan.expect! }, d);
    expect(await serves(d, r.id)).toEqual([newA]);
    expect(await visitAssetIds(v, d)).toEqual([oldA]);                                  // history is NOT rewritten
    expect((await getArrangement(r.id, d))!.data).toEqual(before);                        // nothing else about the arrangement changed
    expect((await loadVisits(d)).map((x) => x.data.providerNameSnapshot)).toEqual(['Pat Heating']);
    expect((await loadAssetServices(newA, d)).rows).toHaveLength(1);
    expect((await loadAssetServices(oldA, d)).rows).toHaveLength(0);
  });
  it('a later visit logged after the move points at the replacement; the earlier one still points at the old asset', async () => {
    const { d, oldA, newA, r, v } = await setup();
    await applyMoveToReplacement({ arrangementId: r.id, expect: (await planMoveToReplacement(r.id, oldA, d)).expect! }, d);
    const v2 = await logStandaloneVisit({ arrangementId: r.id, input: { status: 'completed', cancelledBy: null, date: '2026-11-05', title: 'Later visit', chargedCents: null, chargeKind: null }, today: TODAY }, d);
    expect(await visitAssetIds(v2.visitId, d)).toEqual([newA]);
    expect(await visitAssetIds(v, d)).toEqual([oldA]);
  });
  it('when the arrangement already serves the replacement only the old link goes', async () => {
    const { d, oldA, newA, r } = await setup();
    await syncAssetLinks(r.id, [oldA, newA], d);
    const plan = await planMoveToReplacement(r.id, oldA, d);
    expect(plan.alreadyServesReplacement).toBe(true);
    await applyMoveToReplacement({ arrangementId: r.id, expect: plan.expect! }, d);
    expect(await serves(d, r.id)).toEqual([newA]);
  });
  it('an invalid, archived or missing replacement is never invented: a clear review state and no write', async () => {
    const d = fresh();
    const oldA = await asset(d, 'Old furnace');
    const r = await arr(d, [oldA]);
    await replaced(d, oldA, null);
    expect((await planMoveToReplacement(r.id, oldA, d)).problem).toMatch(/will not invent one/);
    const ghost = await asset(d, 'Ghost');
    await replaced(d, oldA, ghost);
    await d.moduleRecords.update(ghost, { deletedAt: Date.now() } as never);
    expect((await planMoveToReplacement(r.id, oldA, d)).problem).toMatch(/not a live asset/);
    expect(assetViews([oldA], await loadAssets(d))[0].replacementId).toBeNull();
    const arch = await asset(d, 'Archived new', { archived: true });
    await replaced(d, oldA, arch);
    expect((await planMoveToReplacement(r.id, oldA, d)).problem).toMatch(/archived/);
    expect(await serves(d, r.id)).toEqual([oldA]);
  });
  it('18. a stale preview is refused with no partial change: the replacement changed, the links changed, or the arrangement was edited', async () => {
    const { d, oldA, newA, r } = await setup();
    const plan = await planMoveToReplacement(r.id, oldA, d);
    const third = await asset(d, 'Third furnace');
    await replaced(d, oldA, third); // the choice of replacement changed after the preview
    await expect(applyMoveToReplacement({ arrangementId: r.id, expect: plan.expect! }, d)).rejects.toThrow(MOVE_STALE);
    expect(await serves(d, r.id)).toEqual([oldA]);
    await replaced(d, oldA, newA);
    const plan2 = await planMoveToReplacement(r.id, oldA, d);
    await syncAssetLinks(r.id, [oldA, third], d); // someone linked another asset
    await expect(applyMoveToReplacement({ arrangementId: r.id, expect: plan2.expect! }, d)).rejects.toThrow(MOVE_STALE);
    expect(await serves(d, r.id)).toEqual([oldA, third].sort((a, b) => a - b));
    const plan3 = await planMoveToReplacement(r.id, oldA, d);
    await d.moduleRecords.update(r.id, { 'data.notes': 'edited', updatedAt: Date.now() + 5 } as never);
    await expect(applyMoveToReplacement({ arrangementId: r.id, expect: plan3.expect! }, d)).rejects.toThrow(MOVE_STALE);
  });
  it('an injected failure midway leaves the links exactly as they were', async () => {
    const { d, oldA, r } = await setup();
    const plan = await planMoveToReplacement(r.id, oldA, d);
    const before = JSON.stringify(await d.links.toArray());
    const real = d.links.add.bind(d.links);
    const { vi } = await import('vitest');
    const spy = vi.spyOn(d.links, 'add').mockImplementation(((l: { toId?: unknown }) => (String(l?.toId).startsWith('asset:') ? Promise.reject(new Error('boom')) : real(l as never))) as never);
    await expect(applyMoveToReplacement({ arrangementId: r.id, expect: plan.expect! }, d)).rejects.toThrow(/boom/);
    spy.mockRestore();
    expect(JSON.stringify(await d.links.toArray())).toBe(before);
  });
  it('Undo puts the old link back and removes the new one; it refuses (changing nothing) once another link changed', async () => {
    const { d, oldA, newA, r } = await setup();
    const moved = await applyMoveToReplacement({ arrangementId: r.id, expect: (await planMoveToReplacement(r.id, oldA, d)).expect! }, d);
    await applyUndo(moved.undo, d);
    expect(await serves(d, r.id)).toEqual([oldA]);
    // again, then another device changes a link before Undo
    const moved2 = await applyMoveToReplacement({ arrangementId: r.id, expect: (await planMoveToReplacement(r.id, oldA, d)).expect! }, d);
    const extra = await asset(d, 'Water softener');
    await createStore(d).shared.links.add({ module: 'services', id: `arrangement:${r.id}` }, { module: 'assets', id: `asset:${extra}` }, 'serves');
    const err = await applyUndo(moved2.undo, d).catch((e) => e);
    expect(isUndoRefused(err)).toBe(true);
    expect(await serves(d, r.id)).toEqual([newA, extra].sort((a, b) => a - b)); // nothing restored over the other change
  });
  it('Undo is refused when the old asset no longer exists, before anything is written', async () => {
    const { d, oldA, newA, r } = await setup();
    const moved = await applyMoveToReplacement({ arrangementId: r.id, expect: (await planMoveToReplacement(r.id, oldA, d)).expect! }, d);
    await d.moduleRecords.update(oldA, { deletedAt: Date.now() } as never);
    expect(isUndoRefused(await applyUndo(moved.undo, d).catch((e) => e))).toBe(true);
    expect(await serves(d, r.id)).toEqual([newA]);
  });
  it('nothing moves or ends by itself when an asset is replaced', async () => {
    const { d, oldA, r } = await setup();
    expect(await serves(d, r.id)).toEqual([oldA]);
    expect((await getArrangement(r.id, d))!.data.status).toBe('active');
    const snap = await loadSnapshot(d);
    expect(snap.assetIdsBy.get(r.id)).toEqual([oldA]);
  });
  it('an ended arrangement offers no move', async () => {
    const { d, oldA, r } = await setup();
    await applyLifecycle({ action: 'end', arrangementId: r.id, expect: (await planLifecycle(r.id, 'end', TODAY, d)).expect, today: TODAY }, d);
    expect((await planMoveToReplacement(r.id, oldA, d)).problem).toMatch(/has ended/);
  });
});

describe('S4-A5 asset deletion messaging', () => {
  it('20. the delete preview counts the live arrangements and visits that mention the asset, and the deletion removes exactly those links and keeps their history', async () => {
    const d = fresh();
    const a = await asset(d, 'Spare freezer');
    const other = await asset(d, 'Garage door');
    const r1 = await arr(d, [a], 'Plan one'), r2 = await arr(d, [a, other], 'Plan two'), r3 = await arr(d, [a], 'Plan three');
    await d.moduleRecords.update(r3.id, { deletedAt: Date.now() } as never); // soft-deleted: not counted
    const v = await visitOf(d, r1.id);
    await arr(d, [other], 'Unrelated');
    const plan = await planAssetDeletion(a, d);
    expect(plan.canDelete).toBe(true);
    expect([plan.serviceArrangements, plan.serviceVisits]).toEqual([2, 1]);
    const linksBefore = (await linksToAsset(a, d)).length;
    const res = await deleteAssetPermanently(a, d);
    expect(res.linksRemoved).toBe(linksBefore);
    expect(await linkedAssetIds(r1.id, d)).toEqual([]);
    expect(await linkedAssetIds(r2.id, d)).toEqual([other]);
    expect(await visitAssetIds(v, d)).toEqual([]);
    expect(await getArrangement(r1.id, d)).toBeDefined();           // history stays
    expect((await loadVisits(d)).map((x) => x.id)).toEqual([v]);
    expect((await loadVisits(d))[0].data.providerNameSnapshot).toBe('Pat Heating');
  });
  it('an asset nothing mentions shows zero (no sentence), and the existing deletion rules are unchanged', async () => {
    const d = fresh();
    const a = await asset(d, 'Lamp');
    const p = await planAssetDeletion(a, d);
    expect([p.serviceArrangements, p.serviceVisits, p.canDelete]).toEqual([0, 0, true]);
  });
});

describe('S4-B Projects', () => {
  async function setup() {
    const d = fresh();
    const r = await arr(d, [], 'Roof upkeep', 'Pat Roofs');
    const v = await visitOf(d, r.id);
    const p = await createProject(blankProject({ name: 'Roof replacement', budgetCents: 900000 }), d);
    return { d, r, v, p };
  }
  it('21/22. an explicit link from an arrangement and from a visit appears on both sides; linking twice is harmless', async () => {
    const { d, r, v, p } = await setup();
    const a = await linkProject({ kind: 'arrangement', id: r.id }, p, d);
    const again = await linkProject({ kind: 'arrangement', id: r.id }, p, d);
    await linkProject({ kind: 'visit', id: v }, p, d);
    expect(a.created).toBe(true);
    expect(again.created).toBe(false);
    expect((await projectLinksOf({ kind: 'arrangement', id: r.id }, d)).map((l) => l.projectId)).toEqual([p]);
    expect((await projectLinksOf({ kind: 'visit', id: v }, d)).map((l) => l.projectId)).toEqual([p]);
    expect(await servicesOfProject(p, d)).toEqual({ arrangementIds: [r.id], visitIds: [v] });
    expect(await explicitProjectIds([{ kind: 'arrangement', id: r.id }, { kind: 'visit', id: v }], d)).toEqual([p]);
    expect((await d.links.toArray()).filter((l) => l.type === 'involves')).toHaveLength(2);
  });
  it('23. a provider who is a Project vendor creates no implicit link', async () => {
    const { d, r, p } = await setup();
    const contact = (await getArrangement(r.id, d))!.data.providerContactId!;
    await addVendor(p, contact, d);
    expect((await projectsUsingContact(contact, d)).map((x) => x.id)).toEqual([p]);   // the vendor relationship exists
    expect(await servicesOfProject(p, d)).toEqual({ arrangementIds: [], visitIds: [] }); // and is NOT a services link
    expect(await projectLinksOf({ kind: 'arrangement', id: r.id }, d)).toEqual([]);
  });
  it('unlink removes the relationship only and Undo brings it back; Undo is refused after another change', async () => {
    const { d, r, p } = await setup();
    await linkProject({ kind: 'arrangement', id: r.id }, p, d);
    const un = await unlinkProject({ kind: 'arrangement', id: r.id }, p, d);
    expect(un.removed).toBe(1);
    expect(await projectLinksOf({ kind: 'arrangement', id: r.id }, d)).toEqual([]);
    await applyUndo(un.undo, d);
    expect((await projectLinksOf({ kind: 'arrangement', id: r.id }, d)).map((l) => l.projectId)).toEqual([p]);
    const p2 = await createProject(blankProject({ name: 'Gutters' }), d);
    const un2 = await unlinkProject({ kind: 'arrangement', id: r.id }, p, d);
    await linkProject({ kind: 'arrangement', id: r.id }, p2, d); // another change to the same record's links
    expect(isUndoRefused(await applyUndo(un2.undo, d).catch((e) => e))).toBe(true);
    expect((await projectLinksOf({ kind: 'arrangement', id: r.id }, d)).map((l) => l.projectId)).toEqual([p2]);
  });
  it('24. a deleted or missing Project is handled safely: linking it is refused, a stale link is listed but resolves to nothing, permanent deletion cleans up', async () => {
    const { d, r, v, p } = await setup();
    await expect(linkProject({ kind: 'arrangement', id: r.id }, 99999999, d)).rejects.toThrow(/no longer exists/);
    await expect(linkProject({ kind: 'visit', id: 88888888 }, p, d)).rejects.toThrow(/no longer exists/);
    await linkProject({ kind: 'arrangement', id: r.id }, p, d);
    await linkProject({ kind: 'visit', id: v }, p, d);
    await d.moduleRecords.update(p, { deletedAt: Date.now() } as never);              // the Project vanished (e.g. a device that deleted it)
    expect((await projectLinksOf({ kind: 'arrangement', id: r.id }, d)).map((l) => l.projectId)).toEqual([p]); // the link is still there for the page to explain
    const { getProject } = await import('../projects/data');
    expect(await getProject(p, d)).toBeUndefined();
    await d.moduleRecords.update(p, { deletedAt: null } as never);
    await deleteProjectPermanently(p, d);
    expect(await servicesOfProject(p, d)).toEqual({ arrangementIds: [], visitIds: [] });
    expect(await getArrangement(r.id, d)).toBeDefined();                              // the service records are untouched
    expect((await loadVisits(d)).map((x) => x.id)).toEqual([v]);
  });
  it('25/40. linking and unlinking leave the Project, its budget, commitments and paid-to-date, and every Finance row exactly as they were', async () => {
    const { d, r, v, p } = await setup();
    await d.txns.add({ accountId: 1, date: '2026-10-20', amountCents: -45000, payee: 'Roof Co', project: { projectId: p } } as never);
    const snap = async () => JSON.stringify([await d.txns.toArray(), await d.moduleRecords.filter((x) => x.module === 'projects').toArray(), await loadProjectSummary(d, p)]);
    const before = await snap();
    await linkProject({ kind: 'arrangement', id: r.id }, p, d);
    await linkProject({ kind: 'visit', id: v }, p, d);
    expect(await snap()).toBe(before);
    await unlinkProject({ kind: 'visit', id: v }, p, d);
    expect(await snap()).toBe(before);
  });
  it('keeping a historical visit link when the provider changes: replacing the provider does not drop the visit\'s or the old arrangement\'s Project link', async () => {
    const { d, r, v, p } = await setup();
    await linkProject({ kind: 'visit', id: v }, p, d);
    await linkProject({ kind: 'arrangement', id: r.id }, p, d);
    const res = await applyLifecycle({ action: 'replace', arrangementId: r.id, expect: (await planLifecycle(r.id, 'replace', TODAY, d)).expect, today: TODAY, replace: { provider: { name: 'New Roofs' } } }, d);
    expect((await projectLinksOf({ kind: 'visit', id: v }, d)).map((l) => l.projectId)).toEqual([p]);
    expect((await projectLinksOf({ kind: 'arrangement', id: r.id }, d)).map((l) => l.projectId)).toEqual([p]);
    expect(await projectLinksOf({ kind: 'arrangement', id: res.successorId! }, d)).toEqual([]); // the successor is not silently linked
  });
});
