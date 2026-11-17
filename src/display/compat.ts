/**
 * CS-2: the older-build safeguard.
 *
 * The risk (CS-1 report, section M.4): an OLDER Ledger build that splits a repeating event ("this and following") makes a new event but copies
 * no display decision, so a "keep this one private" is lost and the new event inherits its shared calendar. An older build also leaves no
 * pointer from the new event to the old one, so the continuation cannot be recognised afterwards.
 *
 * What cannot work: a version number stored in the data (an older build ignores it) or looking for a matching predecessor (no pointer exists).
 *
 * What does work, with no change to how the Calendar repeats events:
 *  1. Every event made by a current build (a new event, or the new half of a split) carries a small PROVENANCE STAMP bound to its own record id:
 *     `prov: { v: 1, id: <this event's id> }`.
 *  2. An older build that splits an event copies the whole old record, stamp included, so the new event carries a stamp with the OLD event's id.
 *     A stamp that does not name its own record is therefore not a valid stamp. An event made by an older build has no stamp at all.
 *  3. When the owner confirms the first publication, Ledger records a baseline time (synced, so every device agrees; the earliest wins).
 *     Everything that existed then was in the dataset the owner reviewed.
 *  4. An event that would be shown ONLY because its calendar is shared, that was created after the baseline, and that has no valid stamp is
 *     WITHHELD: it is not published until the owner looks at it and chooses Show or Keep private (an ordinary display decision).
 *
 * Limits, stated plainly: an event the owner approves one by one is never withheld (that approval is deliberate); the baseline relies on the
 * device clock that created the record; an older build that merely MOVES an existing event onto a shared calendar is by design eligible (as in
 * CS-1). Events made before the baseline by an older build are trusted because the owner reviewed them.
 */
import type { FinanceDB } from '../db';
import type { ModuleRecord } from '../core/entities';
import { repo } from '../core/store';
import { DISPLAY_MODULE } from './grants';

export const COMPAT_KIND = 'compat';
export interface Provenance { v: 1; id: number }
export const stampFor = (id: number): Provenance => ({ v: 1, id });

/** True when the stamp is present and names THIS record. A stamp copied from another record does not count. */
export function isStamped(recordId: number, data: unknown): boolean {
  const p = (data as { prov?: unknown } | null)?.prov;
  return typeof p === 'object' && p !== null && (p as Provenance).v === 1 && (p as Provenance).id === recordId;
}

/** When the owner confirmed the first publication (the earliest such record), or null if they have not. */
export async function loadBaseline(d: FinanceDB): Promise<number | null> {
  const rows = await d.moduleRecords.where('[module+kind]').equals([DISPLAY_MODULE, COMPAT_KIND]).toArray();
  let best: number | null = null;
  for (const r of rows) {
    if (r.deletedAt != null) continue;
    const from = (r.data as { from?: unknown } | null)?.from;
    if (typeof from === 'number' && Number.isFinite(from) && (best === null || from < best)) best = from;
  }
  return best;
}

/** Records the baseline unless an earlier one exists. One transaction, so a double click or two devices cannot disagree about it. */
export async function recordBaseline(d: FinanceDB, atMs: number): Promise<number> {
  return d.transaction('rw', d.moduleRecords, async () => {
    const have = await loadBaseline(d);
    if (have !== null && have <= atMs) return have;
    await repo<ModuleRecord>(d.moduleRecords).put({ module: DISPLAY_MODULE, kind: COMPAT_KIND, data: { v: 1, from: atMs } });
    return atMs;
  });
}

/** Should an event that is eligible only through its calendar be held back for the owner to review? */
export function needsReview(ev: { id: number; createdAt: number; data: unknown }, baseline: number | null): boolean {
  if (baseline === null) return false;
  if (isStamped(ev.id, ev.data)) return false;
  return ev.createdAt > baseline;
}
