/**
 * Records that point at an asset which is not there (Home & Assets H4): service records, warranties, "replaced by" pointers, and shared links
 * from Tasks, Calendar events and Projects. Finding them changes nothing. Repairing is always the owner's explicit choice, one record at a time:
 *  - Re-home: point it at another asset (checked in the same transaction).
 *  - Remove: soft-delete the record (a link or replacement pointer is simply cleared; the Task, event or Project is never touched).
 *  - Leave it: do nothing; it stays listed.
 *
 * WHY the asset is missing matters, because sync may still deliver it:
 *  - 'permanent': this device holds the tombstone of an asset that was deleted permanently. Safe to repair.
 *  - 'removed': an ordinary removal (for example Undo of a just-made asset). Safe to repair.
 *  - 'absent': this device has no trace of it. It may simply not have arrived yet through sync, so the screen says so and asks for an extra tick.
 * Nothing is moved automatically, and money (Finance references inside service records) is never changed by moving a record.
 */
import { db, type FinanceDB } from '../../db';
import type { Link, ModuleRecord } from '../../core/entities';
import { createStore, isLive, repo } from '../../core/store';
import { PERMANENT_DELETE_KEY } from '../../lib/sync/projectDeletion';
import { loadEvents } from '../calendar/data';
import { loadTasks } from '../tasks/data';
import { getAsset, loadAssets, lookupOf, normalizeAsset } from './data';
import { MODULE, parseAssetRef } from './model';
import { asService, SERVICE_KIND } from './service';
import { validateAsset } from './validate';
import { asWarranty, WARRANTY_KIND } from './warranty';

export type OrphanKind = 'service' | 'warranty' | 'replacement' | 'link';
export type MissingWhy = 'permanent' | 'removed' | 'absent';
export interface Orphan {
  key: string;
  kind: OrphanKind;
  /** The service / warranty / asset record id, or the link id. */
  recordId: number;
  /** Plain words naming the record. Never contains a serial number, plate, address, cost or note. */
  label: string;
  /** What kind of thing it is, for the list ("Service record", "Task link" ...). */
  what: string;
  missingAssetId: number;
  why: MissingWhy;
}

export const WHY_TEXT: Record<MissingWhy, string> = {
  permanent: 'The asset was deleted permanently.',
  removed: 'The asset was removed.',
  absent: 'This device has no record of that asset. If you use Ledger on more than one device, it may still arrive when they sync. Wait for a sync before changing anything.',
};

const rows = (d: FinanceDB) => repo<ModuleRecord>(d.moduleRecords);

async function whyMissing(assetId: number, d: FinanceDB): Promise<MissingWhy | null> {
  const r = await d.moduleRecords.get(assetId);
  if (r && r.module === MODULE && r.kind === 'asset' && isLive(r)) return null;
  if (!r || r.module !== MODULE || r.kind !== 'asset') return 'absent';
  return typeof (r.data as Record<string, unknown> | null)?.[PERMANENT_DELETE_KEY] === 'number' ? 'permanent' : 'removed';
}

/** Read-only. Everything that points at an asset that is not live, with the reason it is missing. */
export async function detectOrphans(d: FinanceDB = db): Promise<Orphan[]> {
  const liveAssets = await loadAssets(d);
  const live = new Set(liveAssets.map((a) => a.id));
  const out: Orphan[] = [];
  const memo = new Map<number, MissingWhy>();
  const why = async (id: number) => { if (!memo.has(id)) memo.set(id, (await whyMissing(id, d)) ?? 'absent'); return memo.get(id) as MissingWhy; };
  const mod = (await d.moduleRecords.where('module').equals(MODULE).toArray()).filter(isLive);

  for (const r of mod) {
    if (r.kind === SERVICE_KIND) {
      const s = asService(r);
      if (!live.has(s.data.assetId)) out.push({ key: `service:${s.id}`, kind: 'service', recordId: s.id, label: `${s.data.title}${s.data.date ? ` (${s.data.date})` : ''}`, what: 'Service record', missingAssetId: s.data.assetId, why: await why(s.data.assetId) });
    } else if (r.kind === WARRANTY_KIND) {
      const w = asWarranty(r);
      if (!live.has(w.data.assetId)) out.push({ key: `warranty:${w.id}`, kind: 'warranty', recordId: w.id, label: w.data.title, what: 'Warranty', missingAssetId: w.data.assetId, why: await why(w.data.assetId) });
    }
  }
  for (const a of liveAssets) {
    if (a.data.status === 'replaced' && a.data.replacedById !== null && !live.has(a.data.replacedById)) {
      out.push({ key: `replacement:${a.id}`, kind: 'replacement', recordId: a.id, label: `${a.data.name}: replaced by an asset that is gone`, what: 'Replacement link', missingAssetId: a.data.replacedById, why: await why(a.data.replacedById) });
    }
  }

  const links = (await d.links.toArray()).filter(isLive);
  const dangling = links.filter((l) => (l.toModule === MODULE && isGone(l.toId, live)) || (l.fromModule === MODULE && isGone(l.fromId, live)));
  if (dangling.length) {
    const [tasks, events] = await Promise.all([loadTasks(d), loadEvents(d)]);
    const projects = await d.moduleRecords.where('[module+kind]').equals(['projects', 'project']).toArray();
    for (const l of dangling) {
      const assetEnd = l.toModule === MODULE && isGone(l.toId, live) ? l.toId : l.fromId;
      const other = l.toModule === MODULE && isGone(l.toId, live) ? { m: l.fromModule, id: l.fromId } : { m: l.toModule, id: l.toId };
      const n = parseAssetRef(assetEnd);
      if (n === null) continue;
      let label = '', what = 'Link';
      if (other.m === 'tasks') { what = 'Task link'; label = tasks.find((t) => t.id === Number(other.id))?.data.title ?? ''; }
      else if (other.m === 'calendar') { what = 'Event link'; label = events.find((e) => e.id === Number(other.id))?.data.title ?? ''; }
      else if (other.m === 'projects') { what = 'Project link'; label = String((projects.find((p) => p.id === Number(other.id) && isLive(p))?.data as { name?: unknown } | undefined)?.name ?? ''); }
      if (!label) continue; // the other end is gone too: nothing meaningful to repair
      out.push({ key: `link:${l.id}`, kind: 'link', recordId: l.id as number, label, what, missingAssetId: n, why: await why(n) });
    }
  }
  return out.sort((x, y) => x.what.localeCompare(y.what) || x.label.localeCompare(y.label) || x.recordId - y.recordId);
}

const isGone = (id: unknown, live: Set<number>) => { const n = parseAssetRef(id as string); return n !== null && !live.has(n); };

async function stillOrphan(o: Orphan, d: FinanceDB): Promise<void> {
  if ((await getAsset(o.missingAssetId, d)) !== undefined) throw new Error('That asset has arrived since you opened this list, so there is nothing to repair. Nothing was changed.');
}

/** Points the record at another asset. One transaction; changes nothing when the record was already resolved or the target is not usable. */
export async function rehomeOrphan(o: Orphan, newAssetId: number, d: FinanceDB = db): Promise<void> {
  await d.transaction('rw', d.moduleRecords, d.links, async () => {
    await stillOrphan(o, d);
    const target = await getAsset(newAssetId, d);
    if (!target) throw new Error('The asset you chose no longer exists. Nothing was changed.');
    if (o.kind === 'service' || o.kind === 'warranty') {
      if (target.data.archived) throw new Error('That asset is archived. Pick one that is not, or restore it first. Nothing was changed.');
      const r = await d.moduleRecords.get(o.recordId);
      if (!r || r.deletedAt != null || r.kind !== (o.kind === 'service' ? SERVICE_KIND : WARRANTY_KIND)) throw new Error('That record is already gone. Nothing was changed.');
      if (((r.data as { assetId?: unknown } | null)?.assetId) !== o.missingAssetId) throw new Error('That record has changed since you opened this list. Nothing was changed.');
      await rows(d).put({ id: r.id, module: MODULE, kind: r.kind, data: { ...(r.data as Record<string, unknown>), assetId: newAssetId } });
    } else if (o.kind === 'replacement') {
      const a = await getAsset(o.recordId, d);
      if (!a || a.data.replacedById !== o.missingAssetId) throw new Error('That asset has changed since you opened this list. Nothing was changed.');
      const next = normalizeAsset({ ...a.data, replacedById: newAssetId });
      const problem = validateAsset(next, a.id, lookupOf(await loadAssets(d)));
      if (problem) throw new Error(`${problem} Nothing was changed.`);
      await rows(d).put({ id: a.id, module: MODULE, kind: 'asset', data: { ...next } });
    } else {
      const l = await d.links.get(o.recordId);
      if (!l || !isLive(l)) throw new Error('That link is already gone. Nothing was changed.');
      const store = createStore(d).shared.links;
      const toEnd = l.toModule === MODULE && String(l.toId) === `asset:${o.missingAssetId}`;
      const fromEnd = l.fromModule === MODULE && String(l.fromId) === `asset:${o.missingAssetId}`;
      if (!toEnd && !fromEnd) throw new Error('That link has changed since you opened this list. Nothing was changed.');
      const mine = { module: MODULE, id: `asset:${newAssetId}` };
      if (toEnd) await store.add({ module: l.fromModule, id: l.fromId }, mine, l.type); else await store.add(mine, { module: l.toModule, id: l.toId }, l.type);
      await store.remove(l.id as number);
    }
  });
}

/** Removes the orphan: a service record or warranty is soft-deleted; a replacement pointer is cleared (the asset stays "Replaced"); a link is removed. */
export async function removeOrphan(o: Orphan, d: FinanceDB = db): Promise<void> {
  await d.transaction('rw', d.moduleRecords, d.links, async () => {
    await stillOrphan(o, d);
    if (o.kind === 'service' || o.kind === 'warranty') {
      const r = await d.moduleRecords.get(o.recordId);
      if (!r || r.deletedAt != null) throw new Error('That record is already gone. Nothing was changed.');
      if (((r.data as { assetId?: unknown } | null)?.assetId) !== o.missingAssetId) throw new Error('That record has changed since you opened this list. Nothing was changed.');
      await rows(d).remove(o.recordId);
    } else if (o.kind === 'replacement') {
      const a = await getAsset(o.recordId, d);
      if (!a || a.data.replacedById !== o.missingAssetId) throw new Error('That asset has changed since you opened this list. Nothing was changed.');
      await rows(d).put({ id: a.id, module: MODULE, kind: 'asset', data: { ...normalizeAsset({ ...a.data, replacedById: null }) } });
    } else {
      const l: Link | undefined = await d.links.get(o.recordId);
      if (!l || !isLive(l)) throw new Error('That link is already gone. Nothing was changed.');
      await createStore(d).shared.links.remove(o.recordId);
    }
  });
}
