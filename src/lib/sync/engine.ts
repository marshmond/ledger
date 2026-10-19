/**
 * Sync between devices through one encrypted file in a private GitHub repo. This module knows nothing about GitHub: it talks to a
 * `RemoteStore`, so tests can use an in-memory one. It reads this device's data, merges it with the remote copy, writes the
 * result back to both, and remembers what existed afterwards (to notice deletions next time).
 */
import Dexie from 'dexie';
import type { FinanceDB } from '../../db';
import { decodeSnapshot, encodeSnapshot } from './codec';
import { emptySnapshot, idsOf, mergeSnapshots, stable, type BaseIds, type Conflict, type Rec, type Snapshot } from './merge';
import { applying } from './track';

export interface RemoteFile {
  sha: string;
  bytes: Uint8Array;
}
export interface RemoteStore {
  getFile(): Promise<RemoteFile | null>;
  /** Writes the file; `sha` is the version being replaced (none for the first write). Returns the new version. */
  putFile(bytes: Uint8Array, sha: string | undefined, message: string): Promise<string>;
}
/** The remote changed since we read it (another device synced at the same moment). */
export class RemoteConflict extends Error {}

export interface MetaStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

export function dexieMeta(name = 'ledger-sync-meta'): MetaStore {
  const m = new Dexie(name);
  m.version(1).stores({ kv: 'key' });
  const kv = m.table<{ key: string; value: unknown }, string>('kv');
  return {
    get: async <T,>(key: string) => (await kv.get(key))?.value as T | undefined,
    set: async (key, value) => void (await kv.put({ key, value })),
  };
}

/** Settings that stay on each device. */
const LOCAL_ONLY_SETTINGS = new Set(['priceApiKey']);
const keyField = (table: string) => (table === 'settings' ? 'key' : 'id');
const toKey = (table: string, id: string): string | number => (table === 'settings' ? id : Number(id));

export async function snapshotOf(d: FinanceDB): Promise<Snapshot> {
  const s = emptySnapshot();
  for (const t of d.tables) {
    const rows: Record<string, Rec> = {};
    for (const r of (await t.toArray()) as Rec[]) {
      if (t.name === 'settings' && LOCAL_ONLY_SETTINGS.has(String(r.key))) continue;
      rows[String(r[keyField(t.name)])] = r;
    }
    s.tables[t.name] = rows;
  }
  return s;
}

export interface SyncSummary {
  /** Records changed on this device by the sync, and records sent. */
  pulled: number;
  removedHere: number;
  pushed: boolean;
  conflicts: Conflict[];
}

const MAX_CONFLICTS = 50;

export class SyncEngine {
  constructor(private d: FinanceDB, private meta: MetaStore, private remote: RemoteStore, private pass: string) {}

  async isSetUp() {
    return (await this.meta.get<BaseIds>('base')) !== undefined;
  }
  async lastSyncedAt() {
    return this.meta.get<number>('lastSyncedAt');
  }
  async conflicts() {
    return (await this.meta.get<Conflict[]>('conflicts')) ?? [];
  }
  async forget() {
    for (const k of ['base', 'lastSync', 'lastSyncedAt', 'conflicts']) await this.meta.set(k, undefined);
  }

  /** Does the remote already hold a synced copy? */
  async remoteExists() {
    return (await this.remote.getFile()) !== null;
  }

  /** First device: sends this device's data as the starting copy. Refuses if a copy already exists. */
  async initialUpload() {
    if (await this.remoteExists()) throw new Error('A synced copy already exists. Use it to replace this device instead.');
    await this.meta.set('base', {});
    await this.meta.set('lastSync', 0);
    return this.sync();
  }

  /** Another device: replaces everything here with the synced copy. */
  async replaceFromRemote() {
    const file = await this.remote.getFile();
    if (!file) throw new Error('There is no synced copy yet. Set up sync on your main device first.');
    const remote = await decodeSnapshot(file.bytes, this.pass);
    await this.d.transaction('rw', this.d.tables, async () => {
      const keep = await this.d.settings.get('priceApiKey');
      for (const t of this.d.tables) await t.clear();
      for (const t of this.d.tables) {
        const rows = Object.values(remote.tables[t.name] ?? {});
        for (const r of rows) applying.add(`${t.name}|${r[keyField(t.name)]}`);
        try {
          await t.bulkAdd(rows as never[]);
        } finally {
          applying.clear();
        }
      }
      if (keep) await this.d.settings.put(keep);
    });
    await this.meta.set('base', idsOf(remote));
    await this.meta.set('lastSync', Date.now());
    await this.meta.set('lastSyncedAt', Date.now());
    await this.meta.set('conflicts', []);
  }

  async sync(): Promise<SyncSummary> {
    const base = await this.meta.get<BaseIds>('base');
    if (!base) throw new Error('This device is not set up for sync yet.');
    const lastSync = (await this.meta.get<number>('lastSync')) ?? 0;
    for (let attempt = 0; ; attempt++) {
      const now = Date.now();
      const local = await snapshotOf(this.d);
      const file = await this.remote.getFile();
      const remote = file ? await decodeSnapshot(file.bytes, this.pass) : emptySnapshot();
      const m = mergeSnapshots({ local, remote, base, lastSync, now });
      const { pulled, removedHere } = await this.applyLocal(local, m.put, m.del);
      let pushed = false;
      if (m.remoteChanged || !file) {
        try {
          await this.remote.putFile(await encodeSnapshot(m.merged, this.pass), file?.sha, `sync ${new Date(now).toISOString()}`);
          pushed = true;
        } catch (e) {
          if (e instanceof RemoteConflict && attempt < 2) continue; // someone synced meanwhile; merge again with theirs
          throw e;
        }
      }
      await this.meta.set('base', idsOf(m.merged));
      await this.meta.set('lastSync', now);
      await this.meta.set('lastSyncedAt', Date.now());
      if (m.conflicts.length) await this.meta.set('conflicts', [...m.conflicts, ...(await this.conflicts())].slice(0, MAX_CONFLICTS));
      return { pulled, removedHere, pushed, conflicts: m.conflicts };
    }
  }

  /**
   * Writes the merge result here. A record you changed while the sync was running is left alone (it will merge next time).
   */
  private async applyLocal(before: Snapshot, put: Record<string, Rec[]>, del: Record<string, string[]>) {
    let pulled = 0;
    let removedHere = 0;
    await this.d.transaction('rw', this.d.tables, async () => {
      for (const t of this.d.tables) {
        const rows = put[t.name] ?? [];
        const gone = del[t.name] ?? [];
        if (!rows.length && !gone.length) continue;
        const same = async (keys: (string | number)[], ids: string[]) => {
          const now = await t.bulkGet(keys as never[]);
          return now.map((r, i) => stable(r) === stable(before.tables[t.name]?.[ids[i]]));
        };
        const putIds = rows.map((r) => String(r[keyField(t.name)]));
        const putOk = await same(putIds.map((id) => toKey(t.name, id)), putIds);
        const delOk = await same(gone.map((id) => toKey(t.name, id)), gone);
        const writes = rows.filter((_, i) => putOk[i]);
        const kills = gone.filter((_, i) => delOk[i]);
        for (const r of writes) applying.add(`${t.name}|${r[keyField(t.name)]}`);
        for (const id of kills) applying.add(`${t.name}|${id}`);
        try {
          if (writes.length) await t.bulkPut(writes as never[]);
          if (kills.length) await t.bulkDelete(kills.map((id) => toKey(t.name, id)) as never[]);
        } finally {
          applying.clear();
        }
        pulled += writes.length;
        removedHere += kills.length;
      }
    });
    return { pulled, removedHere };
  }
}
