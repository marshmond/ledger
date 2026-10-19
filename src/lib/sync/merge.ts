/**
 * Merging two copies of the data, record by record. Pure: no database, no network.
 *
 * Rules:
 *  - A record that exists on only one side is new there, and is added to the other side, unless the other side deleted it.
 *  - A record on both sides takes the newer `updatedAt` (the last edit wins). Ties go to the other device's copy so both converge.
 *  - A record deleted on either side stays deleted, unless it was edited again after the deletion.
 *  - Deletions are noticed by comparing against the ids that existed at the last sync (`base`).
 *  - A few tables hold one record per natural key (a budget line, a net worth month); duplicates made at the same time on two
 *    devices are collapsed to the newest.
 */

export type Rec = { updatedAt?: number; [k: string]: unknown };
export type TableData = Record<string, Rec>;
export interface Snapshot {
  tables: Record<string, TableData>;
  /** table -> record id -> when it was deleted. */
  tombstones: Record<string, Record<string, number>>;
}
export type BaseIds = Record<string, string[]>;

export interface Conflict {
  table: string;
  id: string;
  label: string;
  /** Which edit survived. `label` names the edit that was overwritten. */
  kept: 'this device' | 'other device';
  at: number;
}

export interface MergeResult {
  merged: Snapshot;
  /** Records to write locally, and ids to delete locally, by table. */
  put: Record<string, Rec[]>;
  del: Record<string, string[]>;
  remoteChanged: boolean;
  conflicts: Conflict[];
}

const DAY = 86400000;
/** Tombstones are kept this long; a device offline for longer than this could bring a deleted record back. */
const TOMBSTONE_KEEP_DAYS = 365;

const NATURAL_KEYS: Record<string, (r: Rec) => string> = {
  assignments: (r) => `${r.month}|${r.key}`,
  netWorthSnapshots: (r) => String(r.date),
  taxSettings: (r) => String(r.year),
  recurringLog: (r) => `${r.ruleId}|${r.date}`,
};

export const emptySnapshot = (): Snapshot => ({ tables: {}, tombstones: {} });

const stamp = (r?: Rec) => (r && typeof r.updatedAt === 'number' ? r.updatedAt : 0);

/** JSON with sorted keys, so two copies of a record compare equal whatever order their fields were written in. */
export function stable(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}';
  }
  return JSON.stringify(v) ?? 'null';
}

function labelOf(r: Rec, id: string): string {
  for (const k of ['name', 'payee', 'title', 'charity', 'memo', 'ticker', 'key']) if (typeof r[k] === 'string' && r[k]) return String(r[k]);
  if (typeof r.date === 'string') return r.date;
  return `#${id}`;
}

export function idsOf(s: Snapshot): BaseIds {
  return Object.fromEntries(Object.entries(s.tables).map(([t, rows]) => [t, Object.keys(rows)]));
}

export function mergeSnapshots(a: { local: Snapshot; remote: Snapshot; base: BaseIds; lastSync: number; now: number }): MergeResult {
  const { local, remote, base, lastSync, now } = a;
  const names = new Set([...Object.keys(local.tables), ...Object.keys(remote.tables), ...Object.keys(remote.tombstones), ...Object.keys(base)]);
  const merged = emptySnapshot();
  const put: Record<string, Rec[]> = {};
  const del: Record<string, string[]> = {};
  const conflicts: Conflict[] = [];
  let remoteChanged = false;

  for (const t of names) {
    const L = local.tables[t] ?? {};
    const R = remote.tables[t] ?? {};
    const tomb: Record<string, number> = {};
    for (const [id, at] of Object.entries(remote.tombstones[t] ?? {})) if (now - at < TOMBSTONE_KEEP_DAYS * DAY) tomb[id] = at;
    // Things that were here at the last sync and are gone now were deleted on this device.
    for (const id of base[t] ?? []) if (!(id in L) && tomb[id] === undefined) tomb[id] = now;

    const out: TableData = {};
    for (const id of new Set([...Object.keys(L), ...Object.keys(R)])) {
      const l = L[id];
      const r = R[id];
      let win: Rec | undefined;
      if (l && r) {
        if (stable(l) === stable(r)) win = r;
        else {
          win = stamp(l) > stamp(r) ? l : r;
          if (stamp(l) > lastSync && stamp(r) > lastSync) conflicts.push({ table: t, id, label: labelOf(win === l ? r : l, id), kept: win === l ? 'this device' : 'other device', at: now });
        }
      } else win = l ?? r;
      const tm = tomb[id];
      if (tm !== undefined) {
        if (tm >= stamp(win)) {
          if (l && !r && remote.tombstones[t]?.[id] !== undefined && stamp(l) > lastSync) conflicts.push({ table: t, id, label: labelOf(l, id), kept: 'other device', at: now });
          win = undefined;
        } else delete tomb[id];
      }
      if (win) out[id] = win;
    }

    const nk = NATURAL_KEYS[t];
    if (nk) {
      const keep = new Map<string, string>();
      for (const id of Object.keys(out).sort((x, y) => Number(x) - Number(y) || (x < y ? -1 : 1))) {
        const k = nk(out[id]);
        const prev = keep.get(k);
        if (prev === undefined) keep.set(k, id);
        else if (stamp(out[id]) > stamp(out[prev])) {
          delete out[prev];
          tomb[prev] = now;
          keep.set(k, id);
        } else {
          delete out[id];
          tomb[id] = now;
        }
      }
    }

    merged.tables[t] = out;
    merged.tombstones[t] = tomb;
    const p = Object.entries(out).filter(([id, rec]) => !L[id] || stable(L[id]) !== stable(rec)).map(([, rec]) => rec);
    if (p.length) put[t] = p;
    const d = Object.keys(L).filter((id) => !(id in out));
    if (d.length) del[t] = d;
    if (!remoteChanged) {
      remoteChanged =
        Object.keys(R).some((id) => !(id in out)) ||
        Object.entries(out).some(([id, rec]) => !R[id] || stable(R[id]) !== stable(rec)) ||
        stable(tomb) !== stable(remote.tombstones[t] ?? {});
    }
  }
  return { merged, put, del, remoteChanged, conflicts };
}
