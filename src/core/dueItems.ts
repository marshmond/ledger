/**
 * The due-item registry: modules publish dates they want on the shared calendar and retract them when they no longer apply.
 * Data only; nothing displays these yet (that is Phase 2).
 */
import { db, type FinanceDB } from '../db';
import { newId } from '../lib/sync/track';
import { isLive } from './store';
import type { DueItem, DueItemInput, RecordId } from './entities';

const key = (m: string, id: RecordId) => `${m}|${typeof id}|${id}`;

/** Adds or updates an item. The pair (sourceModule, sourceRecordId) identifies it, so publishing again changes it instead of doubling up. */
export async function publishDueItem(item: DueItemInput, d: FinanceDB = db): Promise<number> {
  if (!item.sourceModule || !item.title || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) throw new Error('A due item needs a source module, a title and a date like 2026-12-31.');
  return d.transaction('rw', d.dueItems, async () => {
    const now = Date.now();
    const existing = (await d.dueItems.where('[sourceModule+sourceRecordId]').equals([item.sourceModule, item.sourceRecordId]).toArray())[0];
    if (existing) {
      await d.dueItems.put({ ...existing, ...item, id: existing.id, createdAt: existing.createdAt, updatedAt: now, deletedAt: null });
      return existing.id as number;
    }
    const id = newId();
    await d.dueItems.add({ ...item, id, createdAt: now, updatedAt: now, deletedAt: null });
    return id;
  });
}

/** Removes an item a module published (it is marked deleted, so other devices drop it too). */
export async function retractDueItem(sourceModule: string, sourceRecordId: RecordId, d: FinanceDB = db): Promise<boolean> {
  return d.transaction('rw', d.dueItems, async () => {
    const found = (await d.dueItems.where('[sourceModule+sourceRecordId]').equals([sourceModule, sourceRecordId]).toArray()).filter(isLive);
    const now = Date.now();
    for (const f of found) await d.dueItems.put({ ...f, deletedAt: now, updatedAt: now });
    return found.length > 0;
  });
}

/** For a module that recomputes its whole list: publishes `items` and retracts anything it published earlier that is no longer in the list. */
export async function syncDueItems(sourceModule: string, items: DueItemInput[], d: FinanceDB = db): Promise<void> {
  if (items.some((i) => i.sourceModule !== sourceModule)) throw new Error('A module can only publish its own due items.');
  const keep = new Set(items.map((i) => key(i.sourceModule, i.sourceRecordId)));
  for (const i of items) await publishDueItem(i, d);
  for (const old of (await d.dueItems.where('sourceModule').equals(sourceModule).toArray()).filter(isLive)) {
    if (!keep.has(key(old.sourceModule, old.sourceRecordId))) await retractDueItem(old.sourceModule, old.sourceRecordId, d);
  }
}

export interface DueQuery {
  from?: string;
  to?: string;
  sourceModule?: string;
  status?: DueItem['status'];
}
/** Live items, soonest first. */
export async function listDueItems(q: DueQuery = {}, d: FinanceDB = db): Promise<DueItem[]> {
  return (await d.dueItems.toArray())
    .filter((i) => isLive(i) && (!q.from || i.date >= q.from) && (!q.to || i.date <= q.to) && (!q.sourceModule || i.sourceModule === q.sourceModule) && (!q.status || i.status === q.status))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '') || (a.id as number) - (b.id as number));
}
