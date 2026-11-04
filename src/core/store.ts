/**
 * The shared data layer. Every module reads and writes through this: get / put / query / delete, plus change subscriptions.
 *  - `shared`: entities every module can use (contacts, tags, attachments, links).
 *  - `moduleStore(id)`: a private namespace for one module's own records.
 * Ledger's original tables are not routed through here (that would risk its numbers); they sit in the same database, so
 * backup, restore and device sync cover them and everything below with the same code.
 * Deleting is "soft": the record gets a `deletedAt` time and disappears from normal reads, so the deletion can sync.
 */
import { liveQuery, type Table } from 'dexie';
import { db, type FinanceDB } from '../db';
import { newId } from '../lib/sync/track';
import type { Attachment, BaseRecord, Contact, Link, ModuleRecord, RecordId, RecordRef, Tag } from './entities';

export type Unsubscribe = () => void;

export interface Repo<T extends BaseRecord> {
  /** Creates the record (no id) or changes it (existing id). Returns the id. Unknown fields are kept. */
  put(rec: Omit<T, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'> & { id?: number }): Promise<number>;
  /** The live record, or undefined if missing or deleted. */
  get(id: number): Promise<T | undefined>;
  /** Live records (optionally only those passing `where`). */
  query(where?: (r: T) => boolean): Promise<T[]>;
  /** Soft delete. Deleting something already gone does nothing. */
  remove(id: number): Promise<void>;
  /** Undo a delete. */
  restore(id: number): Promise<void>;
  /** Calls `fn` now and again every time the result changes. */
  watch(fn: (rows: T[]) => void, where?: (r: T) => boolean): Unsubscribe;
}

export const isLive = (r: { deletedAt?: number | null }) => r.deletedAt == null;

export function repo<T extends BaseRecord>(table: Table<T, number>): Repo<T> {
  const live = async (where?: (r: T) => boolean) => (await table.toArray()).filter((r) => isLive(r) && (!where || where(r)));
  return {
    async put(rec) {
      const now = Date.now();
      const existing = rec.id !== undefined ? await table.get(rec.id) : undefined;
      if (existing) {
        await table.put({ ...existing, ...rec, id: existing.id, createdAt: existing.createdAt, updatedAt: now, deletedAt: existing.deletedAt } as T);
        return existing.id as number;
      }
      const id = rec.id ?? newId();
      await table.add({ ...rec, id, createdAt: now, updatedAt: now, deletedAt: null } as unknown as T);
      return id;
    },
    async get(id) {
      const r = await table.get(id);
      return r && isLive(r) ? r : undefined;
    },
    query: live,
    async remove(id) {
      const r = await table.get(id);
      if (!r || !isLive(r)) return;
      const now = Date.now();
      await table.put({ ...r, deletedAt: now, updatedAt: now });
    },
    async restore(id) {
      const r = await table.get(id);
      if (r && !isLive(r)) await table.put({ ...r, deletedAt: null, updatedAt: Date.now() });
    },
    watch(fn, where) {
      const sub = liveQuery(() => live(where)).subscribe({ next: fn, error: () => undefined });
      return () => sub.unsubscribe();
    },
  };
}

const sameRef = (m1: string, id1: RecordId, m2: string, id2: RecordId) => m1 === m2 && id1 === id2;

export function createStore(d: FinanceDB = db) {
  const contacts = repo<Contact>(d.contacts);
  const tags = repo<Tag>(d.tags);
  const attachments = repo<Attachment>(d.attachments);
  const linkRepo = repo<Link>(d.links);

  async function linkedTo(ref: RecordRef): Promise<Link[]> {
    const [out, inn] = await Promise.all([
      d.links.where('[fromModule+fromId]').equals([ref.module, ref.id]).toArray(),
      d.links.where('[toModule+toId]').equals([ref.module, ref.id]).toArray(),
    ]);
    const seen = new Set<number>();
    return [...out, ...inn].filter((l) => isLive(l) && !seen.has(l.id as number) && seen.add(l.id as number));
  }

  const links = {
    ...linkRepo,
    /** Connects two records. Doing it twice with the same ends and type returns the existing link. */
    async add(from: RecordRef, to: RecordRef, type: string): Promise<number> {
      const found = (await linkedTo(from)).find((l) => sameRef(from.module, from.id, l.fromModule, l.fromId) && sameRef(to.module, to.id, l.toModule, l.toId) && l.type === type);
      if (found) return found.id as number;
      return linkRepo.put({ fromModule: from.module, fromId: from.id, toModule: to.module, toId: to.id, type });
    },
    /** Everything connected to a record, in either direction. */
    linkedTo,
    watchLinkedTo(ref: RecordRef, fn: (rows: Link[]) => void): Unsubscribe {
      const sub = liveQuery(() => linkedTo(ref)).subscribe({ next: fn, error: () => undefined });
      return () => sub.unsubscribe();
    },
  };

  return { shared: { contacts, tags, attachments, links }, moduleStore: (moduleId: string) => moduleNamespace(d, moduleId) };
}

/** A module's private records: `put('note', {...})`, `query('note')`, and so on. Nothing here can see another module's records. */
function moduleNamespace(d: FinanceDB, moduleId: string) {
  const r = repo<ModuleRecord>(d.moduleRecords);
  const mine = (kind?: string) => (x: ModuleRecord) => x.module === moduleId && (kind === undefined || x.kind === kind);
  return {
    put: (kind: string, data: Record<string, unknown>, id?: number) => r.put({ module: moduleId, kind, data, id }),
    async get(id: number) {
      const x = await r.get(id);
      return x && x.module === moduleId ? x : undefined;
    },
    query: (kind?: string, where?: (x: ModuleRecord) => boolean) => r.query((x) => mine(kind)(x) && (!where || where(x))),
    async remove(id: number) {
      if (await this.get(id)) await r.remove(id);
    },
    watch: (kind: string | undefined, fn: (rows: ModuleRecord[]) => void) => r.watch(fn, mine(kind)),
  };
}

export const store = createStore();
