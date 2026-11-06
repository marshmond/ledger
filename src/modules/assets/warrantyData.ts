/**
 * Reading and writing warranty records. Writes go through the shared store's `repo` (id, createdAt, updatedAt, soft delete). Home & Assets is
 * the only writer of warranty records; this file never writes to Finance, Tasks, Calendar, Projects or Contacts.
 */
import { db, type FinanceDB } from '../../db';
import type { ModuleRecord } from '../../core/entities';
import { isLive, repo } from '../../core/store';
import { getAsset, updateAsset } from './data';
import { MODULE } from './model';
import { asWarranty, MAX_WARRANTIES, normalizeWarranty, validateWarranty, WARRANTY_KIND, type WarrantyData, type WarrantyRecord } from './warranty';

const rows = (d: FinanceDB) => repo<ModuleRecord>(d.moduleRecords);

const byEnd = (a: WarrantyRecord, b: WarrantyRecord) => (a.data.endDate ?? '9999-99-99').localeCompare(b.data.endDate ?? '9999-99-99') || a.id - b.id;

export async function loadWarranties(d: FinanceDB = db): Promise<WarrantyRecord[]> {
  return (await d.moduleRecords.where('[module+kind]').equals([MODULE, WARRANTY_KIND]).toArray()).filter(isLive).map(asWarranty).sort(byEnd);
}
export async function loadWarrantiesFor(assetId: number, d: FinanceDB = db): Promise<WarrantyRecord[]> {
  return (await loadWarranties(d)).filter((w) => w.data.assetId === assetId);
}
export async function getWarranty(id: number, d: FinanceDB = db): Promise<WarrantyRecord | undefined> {
  const r = await d.moduleRecords.get(id);
  return r && r.module === MODULE && r.kind === WARRANTY_KIND && isLive(r) ? asWarranty(r) : undefined;
}

async function liveContactIds(d: FinanceDB): Promise<Set<number>> {
  return new Set((await d.contacts.toArray()).filter(isLive).map((c) => c.id as number));
}

/** Checks and stores a new warranty. The asset must be live and not archived (a retired asset is fine: its history stays editable). */
export async function createWarranty(input: WarrantyData, d: FinanceDB = db): Promise<number> {
  return d.transaction('rw', d.moduleRecords, d.contacts, async () => {
    const asset = await getAsset(input.assetId, d);
    if (!asset) throw new Error('That asset no longer exists.');
    if (asset.data.archived) throw new Error('That asset is archived. Restore it from the Archived tab before adding a warranty.');
    const data = normalizeWarranty(input);
    const contacts = await liveContactIds(d);
    const problem = validateWarranty(data, { contactExists: (id) => contacts.has(id) });
    if (problem) throw new Error(problem);
    if ((await loadWarrantiesFor(input.assetId, d)).length >= MAX_WARRANTIES) throw new Error(`That asset already has ${MAX_WARRANTIES} warranties, which is the most Ledger keeps for one asset.`);
    return rows(d).put({ module: MODULE, kind: WARRANTY_KIND, data: { ...data } });
  });
}

/** Saves changes. The asset cannot be changed here (only orphan repair re-homes a record). Unknown fields are kept. */
export async function updateWarranty(id: number, input: WarrantyData, d: FinanceDB = db): Promise<void> {
  await d.transaction('rw', d.moduleRecords, d.contacts, async () => {
    const cur = await getWarranty(id, d);
    if (!cur) throw new Error('That warranty no longer exists.');
    const next = normalizeWarranty({ ...input, assetId: cur.data.assetId });
    const contacts = await liveContactIds(d);
    const problem = validateWarranty(next, { contactExists: (c) => contacts.has(c), keepContactId: cur.data.providerContactId });
    if (problem) throw new Error(problem);
    await rows(d).put({ id, module: MODULE, kind: WARRANTY_KIND, data: { ...next } });
  });
}

/** Soft delete (the toast's Undo uses `restoreWarranty`). The asset, its service history and the provider contact are untouched. */
export async function deleteWarranty(id: number, d: FinanceDB = db): Promise<void> { await rows(d).remove(id); }

/** Brings a deleted warranty back. Refuses when its asset is no longer there, so Undo can never create an orphan. */
export async function restoreWarranty(id: number, d: FinanceDB = db): Promise<void> {
  await d.transaction('rw', d.moduleRecords, async () => {
    const r = await d.moduleRecords.get(id);
    if (!r || r.module !== MODULE || r.kind !== WARRANTY_KIND) return;
    const a = asWarranty(r).data.assetId;
    if (!(await getAsset(a, d))) throw new Error('The asset this covered no longer exists, so the warranty was not brought back.');
    await rows(d).restore(id);
  });
}

/**
 * Deletes the LAST warranty record of an asset and, only when the owner ticked the box, clears the asset's old simple warranty fields too
 * (so the older coverage does not come back as a fallback). One transaction. Never touches anything else on the asset.
 */
export async function deleteWarrantyAndOldFields(id: number, clearOld: boolean, d: FinanceDB = db): Promise<{ clearedOld: boolean }> {
  return d.transaction('rw', d.moduleRecords, async () => {
    const w = await getWarranty(id, d);
    if (!w) throw new Error('That warranty no longer exists.');
    await rows(d).remove(id);
    if (!clearOld) return { clearedOld: false };
    const a = await getAsset(w.data.assetId, d);
    if (!a || (!a.data.warrantyEndDate && !a.data.warrantyNote)) return { clearedOld: false };
    await updateAsset(a.id, { ...a.data, warrantyEndDate: null, warrantyNote: '' }, d);
    return { clearedOld: true };
  });
}
