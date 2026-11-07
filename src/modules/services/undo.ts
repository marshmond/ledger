/**
 * Undo for Household Services changes (S2.1). One recorder and one guarded `applyUndo` serve EVERY Services change that can be taken back:
 * Pause, Resume, End, Replace provider, Change schedule, schedule fixes, visit logging, adding an arrangement, Quick Add.
 *
 * How the guard works (no new table, no sync change, no dependency):
 *  - When a change finishes, `Recorder.seal` (called as the LAST step, inside the same transaction) writes down how every record the change
 *    touched looks NOW (its whole stored row, as order-independent text) and which links are attached to each of them.
 *  - `applyUndo` re-reads all of that, inside its own transaction and before it writes anything. If a single record or link set differs (another
 *    device edited it, a Task was moved or linked to a Project, a new link appeared), it refuses and writes nothing.
 *  - Only if everything matches does it reverse exactly what the change did, in the same transaction (all or nothing).
 * Comparing the whole row (not only `updatedAt`) means a change made in the SAME millisecond as the action is still seen.
 * An Undo that carries no sealed state (made by older code) is never trusted: it is refused.
 *
 * This file must not import `data.ts` (data.ts uses it).
 */
import { db, type FinanceDB } from '../../db';
import type { Link, ModuleRecord, RecordRef } from '../../core/entities';
import { createStore, isLive, repo } from '../../core/store';
import { stable } from '../../lib/sync/merge';
import { restoreTasks, saveTask } from '../tasks/data';
import type { TaskData } from '../tasks/model';
import { arrangementRef, KIND, MODULE, toStored, type ArrangementData, type ArrangementRecord } from './model';
import { visitRef, VISIT_KIND } from './visitModel';
import type { TaskRecord } from '../tasks/model';

const rows = (d: FinanceDB) => repo<ModuleRecord>(d.moduleRecords);

// ---- messages ----

export const UNDO_REFUSED = 'This action can no longer be undone because something it changed has been updated. No changes were made. Open the record to see how it is now, and edit it yourself if you still want the old version.';
export const UNDO_UNVERIFIED = 'This action can no longer be undone safely, because it was not recorded in enough detail to check. No changes were made. Open the record to see how it is now, and edit it yourself if you want to change it.';
export const UNDO_FAILED = 'Could not undo that. No changes were made.';

/** Thrown when Undo is refused on purpose (the data changed, or the Undo cannot be checked). Nothing was written. */
export class UndoRefused extends Error {
  constructor(message = UNDO_REFUSED) { super(message); this.name = 'UndoRefused'; }
}
export const isUndoRefused = (e: unknown): e is UndoRefused => e instanceof Error && e.name === 'UndoRefused';

// ---- how a record is compared ----

/**
 * Fields that are SETS: their order carries no meaning in this app (contact ids, acknowledged notices, tag ids), so a different order is not
 * a change. Every other array (document links, checklist, schedule weekdays) is ordered and compared in order.
 */
const SET_FIELDS = ['extraContactIds', 'acknowledged', 'tagIds', 'contactIds'];

/**
 * The whole stored row as text that does not depend on property order, keeps unknown fields, and treats a missing `deletedAt` like null.
 * Includes `updatedAt`, so any re-save is a change too (the conservative direction).
 */
export function fingerprint(row: unknown): string {
  if (row === undefined || row === null) return 'absent';
  const r = structuredClone(row) as Record<string, unknown>;
  if (r.deletedAt === undefined) r.deletedAt = null;
  const data = r.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const dd = data as Record<string, unknown>;
    for (const k of SET_FIELDS) {
      const v = dd[k];
      if (Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')) dd[k] = [...v].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0));
    }
  }
  return stable(r);
}

const linkSig = (l: Link) => `${l.id}|${l.fromModule}|${l.fromId}|${l.toModule}|${l.toId}|${l.type}`;
export async function linkSigs(ref: RecordRef, d: FinanceDB): Promise<string[]> {
  return (await createStore(d).shared.links.linkedTo(ref)).map(linkSig).sort();
}
/** The reference other records use to link to this row. */
export function refOfRow(r: ModuleRecord): RecordRef {
  if (r.module === MODULE && r.kind === KIND) return arrangementRef(r.id as number);
  if (r.module === MODULE && r.kind === VISIT_KIND) return visitRef(r.id as number);
  return { module: r.module, id: r.id as number };
}
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

// ---- the recorded state ----

/** How everything the change touched looked when it finished. */
export interface Sealed {
  /** record id -> fingerprint of its whole stored row ("absent" if it did not exist) */
  records: Record<number, string>;
  /** each touched record's reference with the links attached to it (sorted `id|from|to|type` lines) */
  links: { ref: RecordRef; sigs: string[] }[];
  /** A contact the change created (Quick Add may remove it again, but only if it is untouched and unused). */
  contact?: { id: number; print: string };
}

/** What to restore to take a change back. */
export interface Undo {
  arrangements: { id: number; data: ArrangementData }[];
  tasks: { id: number; data: TaskData; wasDeleted: boolean }[];
  /** Records this change created (tasks, arrangements, visits): removed again by Undo. */
  created: number[];
  /** Records this change did not reverse but that Undo must find unchanged (for example a visit Task the change left in place). */
  watched?: number[];
  /** The state the change left. WITHOUT it, Undo is refused: it cannot be shown to be safe. */
  sealed?: Sealed;
  /**
   * S4: shared links this change added (Undo removes exactly these) and links it removed (Undo adds exactly these back). Only ever used together
   * with `sealed`, which includes the links attached to the touched records, so a link someone else added or removed since makes Undo refuse.
   */
  linkOps?: { added: number[]; removed: LinkSnap[] };
}
/** The identity of a link, kept so Undo can bring back one it removed. */
export interface LinkSnap { fromModule: string; fromId: string | number; toModule: string; toId: string | number; type: string }

export class Recorder {
  undo: Undo = { arrangements: [], tasks: [], created: [] };
  /** Remember a link this change is about to remove (call BEFORE removing it). */
  linkRemoved(l: Link) { const o = (this.undo.linkOps ??= { added: [], removed: [] }); o.removed.push({ fromModule: l.fromModule, fromId: l.fromId, toModule: l.toModule, toId: l.toId, type: l.type }); }
  /** Remember a link this change added. */
  linkAdded(id: number) { const o = (this.undo.linkOps ??= { added: [], removed: [] }); if (!o.added.includes(id)) o.added.push(id); }
  arr(a: ArrangementRecord) { if (!this.undo.arrangements.some((x) => x.id === a.id)) this.undo.arrangements.push({ id: a.id, data: structuredClone(a.data) }); }
  task(t: TaskRecord) { if (!this.undo.tasks.some((x) => x.id === t.id)) this.undo.tasks.push({ id: t.id, data: structuredClone(t.data), wasDeleted: false }); }
  /** Guard-only: Undo will not touch this record, but refuses if it differs from how this change left it. */
  watch(t: { id: number }) { const w = (this.undo.watched ??= []); if (!w.includes(t.id)) w.push(t.id); }
  made(id: number | null | undefined) { if (id != null) this.undo.created.push(id); }
  /**
   * Call LAST, inside the same transaction as the change. Remembers how every record the change touched looks now, and the links attached to
   * each, so a later Undo can tell whether anything moved. `createdContactId`: a contact this change made (see `applyUndo`).
   */
  async seal(d: FinanceDB, createdContactId?: number | null): Promise<void> {
    const ids = [...new Set([...this.undo.created, ...this.undo.tasks.map((t) => t.id), ...this.undo.arrangements.map((a) => a.id), ...(this.undo.watched ?? [])])];
    const records: Record<number, string> = {};
    const links: Sealed['links'] = [];
    for (const id of ids) {
      const r = await d.moduleRecords.get(id);
      records[id] = fingerprint(r);
      if (r) links.push({ ref: refOfRow(r), sigs: await linkSigs(refOfRow(r), d) });
    }
    const sealed: Sealed = { records, links };
    if (createdContactId != null) {
      const c = await d.contacts.get(createdContactId);
      if (c) sealed.contact = { id: createdContactId, print: fingerprint(c) };
    }
    this.undo.sealed = sealed;
  }
}

// ---- contacts ----

/**
 * Is this contact referenced by ANYTHING live? Deliberately conservative: rather than know every module's field names and shapes (top-level
 * `providerContactId`, arrays `contactIds` / `vendorContactIds` / `extraContactIds`, nested role objects such as Home & Assets
 * `contacts: [{ contactId, role }]`, shapes a newer version may add), it looks for the contact's id as a whole number anywhere in the JSON of
 * every live module record's data, in either end of every live link, and in every live attachment and due item. Ids are time-based and unique,
 * so a false match is very unlikely, and a false match only means the contact is kept. Leaving an unused contact is always better than
 * deleting a referenced one.
 */
export async function contactIsReferenced(contactId: number, d: FinanceDB = db): Promise<boolean> {
  const re = new RegExp(`(?<![0-9])${contactId}(?![0-9])`);
  const hit = (v: unknown) => re.test(JSON.stringify(v ?? null));
  for (const r of await d.moduleRecords.toArray()) if (isLive(r) && hit(r.data)) return true;
  for (const l of await d.links.toArray()) if (isLive(l) && (hit(l.fromId) || hit(l.toId))) return true;
  for (const a of await d.attachments.toArray()) { const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = a as unknown as Record<string, unknown>; void _i; void _c; void _u; if (isLive(a as { deletedAt?: number | null }) && hit(rest)) return true; }
  for (const x of await d.dueItems.toArray()) { const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = x as unknown as Record<string, unknown>; void _i; void _c; void _u; if (isLive(x as { deletedAt?: number | null }) && hit(rest)) return true; }
  return false;
}

// ---- Undo ----

export interface UndoOptions {
  /** Also remove the contact the change created: refused if that contact was edited since; kept (Undo still done) if anything refers to it now. */
  dropCreatedContact?: boolean;
}

/**
 * Takes a change back, or refuses without writing anything. One transaction: the checks come first, then the reversal, and a write that
 * fails half way rolls everything back. Refuses (`UndoRefused`) if the Undo has no recorded state, or if any record the change touched, or
 * any link attached to one, is different now.
 */
export function applyUndo(u: Undo, d: FinanceDB = db, opts: UndoOptions = {}): Promise<void> {
  return d.transaction('rw', [d.moduleRecords, d.links, d.contacts, d.attachments, d.dueItems], async () => {
    const s = u.sealed;
    if (!s) throw new UndoRefused(UNDO_UNVERIFIED);
    for (const [id, print] of Object.entries(s.records)) {
      if (fingerprint(await d.moduleRecords.get(Number(id))) !== print) throw new UndoRefused();
    }
    for (const { ref, sigs } of s.links) {
      if (!sameList(await linkSigs(ref, d), [...sigs].sort())) throw new UndoRefused();
    }
    // A contact this change created and is now asked to remove: if it was edited since, that is a change too, so refuse (nothing is lost).
    if (opts.dropCreatedContact && s.contact) {
      const c = await d.contacts.get(s.contact.id);
      if (c && fingerprint(c) !== s.contact.print) throw new UndoRefused();
    }
    // A link this change removed can only come back if what it pointed at still exists (checked BEFORE anything is written).
    for (const l of u.linkOps?.removed ?? []) {
      if (l.toModule !== 'assets') continue;
      const m = /^asset:(\d+)$/.exec(String(l.toId));
      const r = m ? await d.moduleRecords.get(Number(m[1])) : undefined;
      if (!r || !isLive(r)) throw new UndoRefused();
    }
    // Everything checks out: reverse exactly what the change did.
    const store = createStore(d);
    for (const id of u.linkOps?.added ?? []) { const l = await d.links.get(id); if (l && isLive(l)) await store.shared.links.remove(id); }
    for (const l of u.linkOps?.removed ?? []) await store.shared.links.add({ module: l.fromModule, id: l.fromId }, { module: l.toModule, id: l.toId }, l.type);
    for (const id of u.created) {
      const r = await d.moduleRecords.get(id);
      if (!r) continue;
      await rows(d).remove(id);
      if (r.module === MODULE) {
        // only the links the change itself left on this record (verified above to be the whole current set)
        const mine = s.links.find((x) => x.ref.module === refOfRow(r).module && x.ref.id === refOfRow(r).id);
        for (const sig of mine?.sigs ?? []) await store.shared.links.remove(Number(sig.split('|')[0]));
      }
    }
    for (const t of u.tasks) {
      const r = await d.moduleRecords.get(t.id);
      if (!r) continue;
      if (r.deletedAt != null && !t.wasDeleted) await restoreTasks([t.id], d);
      await saveTask(t.id, t.data, d);
    }
    for (const a of u.arrangements) if (await d.moduleRecords.get(a.id)) await rows(d).put({ id: a.id, module: MODULE, kind: KIND, data: toStored(a.data) as never });
    if (opts.dropCreatedContact && s.contact) {
      const c = await d.contacts.get(s.contact.id);
      if (c && isLive(c) && !(await contactIsReferenced(s.contact.id, d))) await store.shared.contacts.remove(s.contact.id);
    }
  });
}

/**
 * The Undo button's action: runs the guarded Undo and tells the person in plain words if it was refused. Never shows a technical error, never
 * retries, never forces. `say` shows a message (a toast or an alert). Returns true if the change was taken back.
 */
export async function runUndo(undo: Undo, say: (text: string) => void, d: FinanceDB = db, opts: UndoOptions = {}): Promise<boolean> {
  try { await applyUndo(undo, d, opts); return true; } catch (e) { say(isUndoRefused(e) ? e.message : UNDO_FAILED); return false; }
}
