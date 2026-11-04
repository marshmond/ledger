/**
 * "This record has N open tasks." One shared live query reads all task links once and every row on screen looks itself up in the
 * result, so a long list of transactions does not run a database query per row.
 */
import { useSyncExternalStore } from 'react';
import { liveQuery } from 'dexie';
import { db } from '../../db';
import type { RecordId } from '../../core/entities';
import { isLive } from '../../core/store';
import { loadTasks } from './data';
import { MODULE, type TaskRecord } from './model';

type Snapshot = ReadonlyMap<string, TaskRecord[]>;
const EMPTY: TaskRecord[] = [];
const key = (module: string, id: RecordId) => `${module}|${id}`;

async function build(): Promise<Snapshot> {
  const [links, tasks] = await Promise.all([db.links.toArray(), loadTasks(db)]);
  const open = new Map(tasks.filter((t) => t.data.status !== 'done').map((t) => [t.id, t]));
  const out = new Map<string, TaskRecord[]>();
  for (const l of links) {
    if (!isLive(l)) continue;
    const fromTask = l.fromModule === MODULE;
    if (fromTask === (l.toModule === MODULE)) continue; // neither end, or both ends, are tasks
    const task = open.get((fromTask ? l.fromId : l.toId) as number);
    if (!task) continue;
    const k = fromTask ? key(l.toModule, l.toId) : key(l.fromModule, l.fromId);
    const list = out.get(k) ?? [];
    if (!list.includes(task)) list.push(task);
    out.set(k, list);
  }
  return out;
}

let snapshot: Snapshot = new Map();
const listeners = new Set<() => void>();
let sub: { unsubscribe(): void } | null = null;

function subscribe(fn: () => void) {
  listeners.add(fn);
  if (!sub) sub = liveQuery(build).subscribe({ next: (m) => { snapshot = m; listeners.forEach((f) => f()); }, error: () => undefined });
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) { sub?.unsubscribe(); sub = null; }
  };
}

/** The open tasks linked to a record (either direction), newest data first. */
export function useLinkedTasks(module: string, id: RecordId): TaskRecord[] {
  const snap = useSyncExternalStore(subscribe, () => snapshot);
  return snap.get(key(module, id)) ?? EMPTY;
}
