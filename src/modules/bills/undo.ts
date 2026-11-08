/**
 * A small LOCAL Undo guard for Bills (B1). Not a framework, and it does not touch or import Household Services' `undo.ts` (B0 10.5).
 * It covers the B1 actions (add, edit, review-list change, pause, resume, end, reopen, delete) and, in B2, billing-period facts, the Tasks a Bills
 * action makes or finishes (Tasks are ordinary rows in the same table) and the shared links those new Tasks carry.
 *
 *  - Before a write, `Recorder.capture` keeps the WHOLE stored row (as it was) of every record the action will touch.
 *  - When the write finishes, `Recorder.seal` (the last step, inside the same transaction) records how each row looks NOW, as
 *    order-independent text (the shared `stable()` from the sync merge code).
 *  - `applyUndo` re-reads the rows inside one transaction and REFUSES, writing nothing, if any row differs (another device or another
 *    action changed it, even in the same millisecond), otherwise it restores the captured rows. All or nothing.
 *  - A shared Contact made while adding is NEVER deleted by Undo (a Contact can be used by anything; leaving it is always safe).
 */
import { db, type FinanceDB } from '../../db';
import type { Link, ModuleRecord } from '../../core/entities';
import { repo } from '../../core/store';
import { stable } from '../../lib/sync/merge';

export const UNDO_REFUSED = 'This action can no longer be undone because something it changed has been updated. No changes were made. Open the record to see how it is now, and edit it yourself if you still want the old version.';
export const UNDO_UNVERIFIED = 'This action can no longer be undone safely, because it was not recorded in enough detail to check. No changes were made.';
export const UNDO_FAILED = 'Could not undo that. No changes were made.';

/** Thrown when Undo is refused on purpose. Nothing was written. */
export class UndoRefused extends Error {
  constructor(message = UNDO_REFUSED) { super(message); this.name = 'UndoRefused'; }
}
export const isUndoRefused = (e: unknown): e is UndoRefused => e instanceof Error && e.name === 'UndoRefused';

/** The whole stored row as text that does not depend on property order. A missing `deletedAt` equals null. Includes `updatedAt`. */
export function fingerprint(row: unknown): string {
  if (row === undefined || row === null) return 'absent';
  const r = structuredClone(row) as Record<string, unknown>;
  if (r.deletedAt === undefined) r.deletedAt = null;
  return stable(r);
}

export interface Undo {
  /** Each touched row as it was before the action (null = it did not exist, so Undo removes it). */
  rows: { id: number; before: ModuleRecord | null }[];
  /** How each touched row looked right after the action. WITHOUT it Undo is refused. */
  sealed?: Record<number, string>;
  /** B2: shared links this action added (a new Task's link to its bill). Undo removes exactly these, after the rows above checked out. */
  linksAdded?: number[];
  /** B4: shared links this action took away (a soft delete). Undo restores exactly these, after checking each is still as the action left it. */
  linksRemoved?: number[];
  sealedLinks?: Record<number, string>;
}

export class Recorder {
  readonly undo: Undo = { rows: [] };
  /** Call BEFORE writing the row. For a row about to be created pass its id after creating it with `made`. */
  async capture(id: number, d: FinanceDB): Promise<void> {
    if (this.undo.rows.some((r) => r.id === id)) return;
    const row = await d.moduleRecords.get(id);
    this.undo.rows.push({ id, before: row ? structuredClone(row) : null });
  }
  /** A row this action created. */
  made(id: number) { if (!this.undo.rows.some((r) => r.id === id)) this.undo.rows.push({ id, before: null }); }
  /** B2: links this action added. */
  linkAdded(ids: number[]) { this.undo.linksAdded = [...(this.undo.linksAdded ?? []), ...ids]; }
  /** B4: links this action removed. */
  linkRemoved(ids: number[]) { this.undo.linksRemoved = [...(this.undo.linksRemoved ?? []), ...ids]; }
  /** Call LAST, inside the same transaction as the change. */
  async seal(d: FinanceDB): Promise<Undo> {
    const sealed: Record<number, string> = {};
    for (const { id } of this.undo.rows) sealed[id] = fingerprint(await d.moduleRecords.get(id));
    this.undo.sealed = sealed;
    if (this.undo.linksRemoved?.length) {
      const sl: Record<number, string> = {};
      for (const id of this.undo.linksRemoved) sl[id] = fingerprint(await d.links.get(id));
      this.undo.sealedLinks = sl;
    }
    return this.undo;
  }
}

/** Takes the action back, or refuses without writing anything (one transaction: the checks come first). */
export function applyUndo(u: Undo, d: FinanceDB = db): Promise<void> {
  return d.transaction('rw', [d.moduleRecords, d.links], async () => {
    if (!u.sealed) throw new UndoRefused(UNDO_UNVERIFIED);
    for (const { id } of u.rows) {
      if (fingerprint(await d.moduleRecords.get(id)) !== u.sealed[id]) throw new UndoRefused();
    }
    for (const id of u.linksRemoved ?? []) {
      const row = await d.links.get(id);
      if (fingerprint(row) !== u.sealedLinks?.[id]) throw new UndoRefused();
      // restoring must never create a DUPLICATE: if someone linked the same two records again since, the relationship exists and Undo refuses
      if (row && (await d.links.where('[fromModule+fromId]').equals([row.fromModule, row.fromId]).toArray()).some((l) => l.id !== id && l.deletedAt == null && l.toModule === row.toModule && l.toId === row.toId && l.type === row.type)) throw new UndoRefused();
    }
    const rows = repo<ModuleRecord>(d.moduleRecords);
    for (const { id, before } of u.rows) {
      if (before === null) { await rows.remove(id); continue; }
      const now = await d.moduleRecords.get(id);
      if (now && now.deletedAt != null && before.deletedAt == null) await rows.restore(id);
      await rows.put({ id, module: before.module, kind: before.kind, data: structuredClone(before.data) as never });
    }
    const links = repo<Link>(d.links);
    for (const id of u.linksAdded ?? []) await links.remove(id);
    for (const id of u.linksRemoved ?? []) await links.restore(id);
  });
}

/** The Undo button's action: runs the guarded Undo and says in plain words if it was refused. Never retries, never forces. */
export async function runUndo(undo: Undo, say: (text: string) => void, d: FinanceDB = db): Promise<boolean> {
  try { await applyUndo(undo, d); return true; } catch (e) { say(isUndoRefused(e) ? e.message : UNDO_FAILED); return false; }
}
