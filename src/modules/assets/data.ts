/**
 * Reading and writing assets. Writes go through the shared store's `repo` (id, createdAt, updatedAt, soft delete). Home & Assets is the
 * only writer of asset records. It never writes to Finance, Tasks, Calendar or Projects.
 */
import { db, type FinanceDB } from '../../db';
import type { Link, ModuleRecord } from '../../core/entities';
import { createStore, isLive, repo } from '../../core/store';
import { loadEvents } from '../calendar/data';
import { loadTasks } from '../tasks/data';
import type { TaskRecord } from '../tasks/model';
import type { EventRecord } from '../calendar/model';
import { asAsset, assetRefId, blankAsset, MODULE, tidy, PAST_STATUSES, type AssetData, type AssetRecord } from './model';
import { newRefsProblem } from './txnLookup';
import { validateAsset, type AssetLookup } from './validate';
import { effectiveWarranties, warrantyBadge, type WarrantyRecord } from './warranty';

const rows = (d: FinanceDB) => repo<ModuleRecord>(d.moduleRecords);

export async function loadAssets(d: FinanceDB = db): Promise<AssetRecord[]> {
  return (await d.moduleRecords.where('[module+kind]').equals([MODULE, 'asset']).toArray()).filter(isLive).map(asAsset)
    .sort((a, b) => a.data.name.localeCompare(b.data.name) || a.id - b.id);
}
export async function getAsset(id: number, d: FinanceDB = db): Promise<AssetRecord | undefined> {
  const r = await d.moduleRecords.get(id);
  return r && r.module === MODULE && r.kind === 'asset' && isLive(r) ? asAsset(r) : undefined;
}

export const lookupOf = (assets: AssetRecord[]): AssetLookup => {
  const m = new Map(assets.map((a) => [a.id, a]));
  return (id) => { const a = m.get(id); return a ? { parentId: a.data.parentId, replacedById: a.data.replacedById, type: a.data.type } : undefined; };
};

/** Tidies what was typed: collapsed names, trimmed text, blank spec rows dropped, an address only on a property and a plate only on a vehicle. */
export function normalizeAsset(d: AssetData): AssetData {
  return {
    ...d,
    name: tidy(d.name),
    manufacturer: tidy(d.manufacturer),
    model: tidy(d.model),
    serialNumber: d.serialNumber.trim(),
    plate: d.type === 'vehicle' ? d.plate.trim() : '',
    address: d.type === 'property' ? d.address.trim() : '',
    parentId: d.type === 'property' ? null : d.parentId,
    replacedById: d.status === 'replaced' ? d.replacedById : null,
    statusDate: d.status === 'active' ? null : d.statusDate,
    statusNote: d.status === 'active' ? '' : d.statusNote.trim(),
    contacts: d.contacts.map((c) => ({ contactId: c.contactId, role: tidy(c.role) })),
    specs: d.specs.map((s) => ({ label: tidy(s.label), value: s.value.trim() })).filter((s) => s.label || s.value),
    refs: d.refs.map((r) => ({ label: tidy(r.label), ...(r.url?.trim() ? { url: r.url.trim() } : {}), ...(r.note?.trim() ? { note: r.note.trim() } : {}) })).filter((r) => r.label || r.url || r.note),
  };
}

/** Creates an asset. Checks against the live assets inside the same transaction. Returns the new id. */
export async function createAsset(data: AssetData, d: FinanceDB = db): Promise<number> {
  const refProblem = await newRefsProblem(data.purchaseTxnRefs, [], d);
  if (refProblem) throw new Error(refProblem);
  return d.transaction('rw', d.moduleRecords, async () => {
    const clean = normalizeAsset(data);
    const problem = validateAsset(clean, undefined, lookupOf(await loadAssets(d)));
    if (problem) throw new Error(problem);
    return rows(d).put({ module: MODULE, kind: 'asset', data: { ...clean } });
  });
}

/** Saves a whole asset (pass what `getAsset` gave you, changed). Fields this code does not know travel inside `data` and are kept. */
export async function updateAsset(id: number, data: AssetData, d: FinanceDB = db): Promise<void> {
  const refProblem = await newRefsProblem(data.purchaseTxnRefs, (await getAsset(id, d))?.data.purchaseTxnRefs ?? [], d);
  if (refProblem) throw new Error(refProblem);
  await d.transaction('rw', d.moduleRecords, async () => {
    if (!(await getAsset(id, d))) throw new Error('That asset no longer exists.');
    const clean = normalizeAsset(data);
    const problem = validateAsset(clean, id, lookupOf(await loadAssets(d)));
    if (problem) throw new Error(problem);
    await rows(d).put({ id, module: MODULE, kind: 'asset', data: { ...clean } });
  });
}

async function change(id: number, patch: (a: AssetData) => AssetData, d: FinanceDB) {
  const a = await getAsset(id, d);
  if (!a) throw new Error('That asset no longer exists.');
  await updateAsset(id, patch(a.data), d);
}
export const archiveAsset = (id: number, d: FinanceDB = db) => change(id, (a) => ({ ...a, archived: true }), d);
export const restoreAsset = (id: number, d: FinanceDB = db) => change(id, (a) => ({ ...a, archived: false }), d);

export interface RetireInput { status: AssetData['status']; statusDate: string | null; statusNote: string; replacedById: number | null }
/** Sets how the asset left (or returns to) everyday use. Children, tasks and links are not touched. 'active' clears the status fields. */
export const setAssetStatus = (id: number, s: RetireInput, d: FinanceDB = db) =>
  change(id, (a) => ({ ...a, status: s.status, statusDate: s.status === 'active' ? null : s.statusDate, statusNote: s.status === 'active' ? '' : s.statusNote, replacedById: s.status === 'replaced' ? s.replacedById : null }), d);

/**
 * Takes away an asset record altogether. ONLY for undoing an asset the Add box just made. Refuses (returns the reason) when anything points
 * at it. This is an ordinary removal, not the "Delete permanently" protection.
 */
export async function removeNewAsset(id: number, d: FinanceDB = db): Promise<string | null> {
  return d.transaction('rw', d.moduleRecords, d.links, async () => {
    if (!(await getAsset(id, d))) return null;
    const all = await loadAssets(d);
    if (all.some((a) => a.data.parentId === id || a.data.replacedById === id)) return 'Something has been added inside it, so it was kept.';
    if ((await linksToAsset(id, d)).length) return 'Something is linked to it, so it was kept.';
    await rows(d).remove(id);
    return null;
  });
}

// ---- tree ----

export const childrenOf = (assets: AssetRecord[], id: number) => assets.filter((a) => a.data.parentId === id);

/** Names from the top down, ending with the asset itself. Cycle-proof. Never includes a sensitive field. */
export function breadcrumbNames(assets: AssetRecord[], id: number): string[] {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const names: string[] = [];
  const seen = new Set<number>();
  let cur = byId.get(id);
  while (cur && !seen.has(cur.id) && names.length <= 12) {
    seen.add(cur.id);
    names.unshift(cur.data.name);
    cur = cur.data.parentId === null ? undefined : byId.get(cur.data.parentId);
  }
  return names;
}
export const breadcrumb = (assets: AssetRecord[], id: number) => breadcrumbNames(assets, id).join(' > ');
/** The location without the asset's own name ("Home > Kitchen"), or '' at the top. */
export const whereIs = (assets: AssetRecord[], id: number) => breadcrumbNames(assets, id).slice(0, -1).join(' > ');
/** The one string allowed on lists, links, search lines, the Add box and toasts. Cannot read serial number, plate or address. */
export const publicLabel = (assets: AssetRecord[], id: number) => breadcrumb(assets, id);

export interface TreeRow { asset: AssetRecord; depth: number; /** its parent is gone */ orphan: boolean; /** a loop that arrived through sync was cut here */ cycle: boolean }

/** Depth-first rows. Children of a missing parent show at the top ("orphan"); loops are cut at the oldest-updated asset. Terminates always. */
export function buildTree(assets: AssetRecord[]): TreeRow[] {
  const ids = new Set(assets.map((a) => a.id));
  const kids = new Map<number | null, AssetRecord[]>();
  for (const a of assets) {
    const p = a.data.parentId !== null && ids.has(a.data.parentId) && a.data.parentId !== a.id ? a.data.parentId : null;
    kids.set(p, [...(kids.get(p) ?? []), a]);
  }
  const sort = (xs: AssetRecord[]) => [...xs].sort((a, b) => a.data.name.localeCompare(b.data.name) || a.id - b.id);
  const out: TreeRow[] = [];
  const seen = new Set<number>();
  const walk = (a: AssetRecord, depth: number, orphan: boolean, cycle: boolean) => {
    if (seen.has(a.id)) return;
    seen.add(a.id);
    out.push({ asset: a, depth, orphan, cycle });
    for (const c of sort(kids.get(a.id) ?? [])) walk(c, depth + 1, false, false);
  };
  for (const a of sort(kids.get(null) ?? [])) walk(a, 0, a.data.parentId !== null && !ids.has(a.data.parentId), false);
  // Anything not reached sits in a loop: start from the oldest-updated one of each.
  for (const a of [...assets].sort((x, y) => x.updatedAt - y.updatedAt || x.id - y.id)) walk(a, 0, false, true);
  return out;
}

/** Ids of an asset and everything inside it (for hiding them in the parent picker). */
export function descendantIds(assets: AssetRecord[], id: number): Set<number> {
  const out = new Set<number>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const a of assets) if (a.data.parentId !== null && out.has(a.data.parentId) && !out.has(a.id)) { out.add(a.id); grew = true; }
  }
  return out;
}

// ---- warranty badge ----

/** The badge for an asset: from its warranty records when it has live ones (pass them as "explicit"), otherwise from the H1 date. */
export function warrantyState(a: AssetData, today: string, explicit: WarrantyRecord[] = []): { label: string; tone: 'ok' | 'soon' | 'past' } | null {
  return warrantyBadge(a, effectiveWarranties(explicit[0]?.data.assetId ?? -1, a, explicit), today);
}

export const isPast = (a: AssetData) => PAST_STATUSES.includes(a.status);

// ---- links ----

export const assetRef = (id: number) => ({ module: MODULE, id: assetRefId(id) });

/** Every live shared link that has this asset at either end. */
export async function linksToAsset(id: number, d: FinanceDB = db): Promise<Link[]> {
  return createStore(d).shared.links.linkedTo(assetRef(id));
}

export interface LinkedWork { openTasks: TaskRecord[]; completedTasks: TaskRecord[]; events: EventRecord[] }

/** Tasks and Calendar events linked to the asset from their own editors. A link to something deleted is ignored. */
export async function loadLinkedWork(id: number, d: FinanceDB = db): Promise<LinkedWork> {
  const links = await linksToAsset(id, d);
  const other = (l: Link, mod: string) => (l.fromModule === mod ? l.fromId : l.toModule === mod ? l.toId : null);
  const taskIds = new Set(links.map((l) => other(l, 'tasks')).filter((x): x is string | number => x !== null).map(Number));
  const eventIds = new Set(links.map((l) => other(l, 'calendar')).filter((x): x is string | number => x !== null).map(Number));
  const [tasks, events] = await Promise.all([taskIds.size ? loadTasks(d) : Promise.resolve([]), eventIds.size ? loadEvents(d) : Promise.resolve([])]);
  const mine = tasks.filter((t) => taskIds.has(t.id));
  return {
    openTasks: mine.filter((t) => t.data.status !== 'done').sort((a, b) => (a.data.dueDate ?? '9999').localeCompare(b.data.dueDate ?? '9999')),
    completedTasks: mine.filter((t) => t.data.status === 'done').sort((a, b) => (b.data.completedAt ?? 0) - (a.data.completedAt ?? 0)),
    events: events.filter((e) => eventIds.has(e.id) && !e.data.retired).sort((a, b) => b.data.startDate.localeCompare(a.data.startDate)),
  };
}

export { blankAsset };
