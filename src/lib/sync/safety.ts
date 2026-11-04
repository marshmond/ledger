/**
 * Safety nets around sync: (1) automatic local snapshots taken before anything risky, and (2) putting back the version of a record
 * that lost a conflict. Both live in this browser only (the sync-meta database), never in the synced file.
 */
import type { FinanceDB } from '../../db';
import { exportAll } from '../backup';
import type { MetaStore } from './engine';
import type { Conflict } from './merge';

export interface Snapshot {
  key: string;
  at: number;
  /** Why it was taken, in plain words. */
  why: string;
  /** A plain Ledger backup file (same format as Export backup), as text. */
  text: string;
  /** Rough size for display. */
  records: number;
}

const KEYS = 'snapshot-keys';
const slot = (key: string) => `snapshot:${key}`;

async function keys(meta: MetaStore) {
  return (await meta.get<string[]>(KEYS)) ?? [];
}

/** Saves a snapshot of everything on this device. Replaces an earlier snapshot with the same key. */
export async function takeSnapshot(d: FinanceDB, meta: MetaStore, key: string, why: string): Promise<Snapshot> {
  const file = await exportAll(d);
  const records = Object.values(file).reduce<number>((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);
  const snap: Snapshot = { key, at: Date.now(), why, text: JSON.stringify(file), records };
  await meta.set(slot(key), snap);
  const k = await keys(meta);
  if (!k.includes(key)) await meta.set(KEYS, [...k, key]);
  return snap;
}

/** The one-time snapshot taken before the first sync after the shared-store update. Does nothing if it already exists. */
export const FIRST_SYNC_KEY = 'before-first-sync';
export async function ensureFirstSyncSnapshot(d: FinanceDB, meta: MetaStore): Promise<boolean> {
  if (await meta.get<Snapshot>(slot(FIRST_SYNC_KEY))) return false;
  await takeSnapshot(d, meta, FIRST_SYNC_KEY, 'Taken automatically before this device’s first sync after the update that added the shared data store.');
  return true;
}

export async function listSnapshots(meta: MetaStore): Promise<Omit<Snapshot, 'text'>[]> {
  const out: Omit<Snapshot, 'text'>[] = [];
  for (const k of await keys(meta)) {
    const s = await meta.get<Snapshot>(slot(k));
    if (s) out.push({ key: s.key, at: s.at, why: s.why, records: s.records });
  }
  return out.sort((a, b) => b.at - a.at);
}

export async function readSnapshot(meta: MetaStore, key: string): Promise<Snapshot | undefined> {
  return meta.get<Snapshot>(slot(key));
}

/**
 * Puts back the version of a record that lost a conflict. It is written like any edit made now, so it wins at the next sync and
 * reaches the other devices. If the winning version still exists it is replaced (that version is gone from this device afterwards).
 */
export async function restoreLostVersion(d: FinanceDB, c: Conflict): Promise<void> {
  if (!c.lost) throw new Error('This notice was saved by an older version of the app and has no copy to put back.');
  const table = d.table(c.table);
  await table.put({ ...c.lost });
}
