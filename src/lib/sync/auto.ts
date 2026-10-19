/**
 * Runs sync for the app: this device's settings, the status the UI shows, and when to sync (on open, when you come back to the app,
 * when you go online, a few seconds after you change something, and every few minutes while it is open).
 */
import { useSyncExternalStore } from 'react';
import { db } from '../../db';
import { dexieMeta, SyncEngine, type SyncSummary } from './engine';
import { githubRemote, SYNC_FILE } from './github';
import { setChangeListener } from './track';

/** Kept in this browser only. The token and passphrase never leave the device except to talk to GitHub / to encrypt. */
export interface SyncConfig {
  owner: string;
  repo: string;
  token: string;
  passphrase: string;
  auto: boolean;
}
const CONFIG_KEY = 'ledger-sync-config';

export function readConfig(): SyncConfig | null {
  try {
    const c = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? 'null') as SyncConfig | null;
    return c && c.owner && c.repo && c.token && c.passphrase ? c : null;
  } catch {
    return null;
  }
}
export function saveConfig(c: SyncConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
  emit();
}
export function clearConfig() {
  localStorage.removeItem(CONFIG_KEY);
  emit();
}

export const meta = dexieMeta();
export const engineFor = (c: SyncConfig) => new SyncEngine(db, meta, githubRemote(c), c.passphrase);

export interface SyncStatus {
  configured: boolean;
  auto: boolean;
  repo?: string;
  state: 'idle' | 'syncing' | 'error';
  lastSyncedAt?: number;
  error?: string;
  last?: SyncSummary;
}
let status: SyncStatus = { configured: false, auto: false, state: 'idle' };
const subs = new Set<() => void>();
function emit(patch: Partial<SyncStatus> = {}) {
  const c = readConfig();
  status = { ...status, ...patch, configured: !!c, auto: !!c?.auto, repo: c ? `${c.owner}/${c.repo}` : undefined };
  subs.forEach((f) => f());
}
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => status,
  );
}

let running: Promise<void> | null = null;
/** Syncs now. Never throws: problems show up as the status error. Several calls at once share one run. */
export function syncNow(): Promise<void> {
  if (running) return running;
  const c = readConfig();
  if (!c) return Promise.resolve();
  running = (async () => {
    emit({ state: 'syncing', error: undefined });
    try {
      const e = engineFor(c);
      if (!(await e.isSetUp())) throw new Error('This device is not set up for sync yet.');
      const last = await e.sync();
      emit({ state: 'idle', last, lastSyncedAt: await e.lastSyncedAt(), error: undefined });
    } catch (err) {
      emit({ state: 'error', error: err instanceof Error ? err.message : String(err) });
    } finally {
      running = null;
    }
  })();
  return running;
}

export async function loadLastSynced() {
  emit({ lastSyncedAt: await meta.get<number>('lastSyncedAt') });
}

let started = false;
/** Wires up the automatic triggers once, when the app starts. */
export function startAutoSync() {
  if (started) return;
  started = true;
  emit();
  loadLastSynced();
  const go = () => {
    if (readConfig()?.auto && navigator.onLine !== false) syncNow();
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  setChangeListener(() => {
    if (!readConfig()?.auto) return;
    clearTimeout(timer);
    timer = setTimeout(go, 8000);
  });
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && go());
  window.addEventListener('online', go);
  setInterval(() => document.visibilityState === 'visible' && go(), 5 * 60 * 1000);
  setTimeout(go, 1500);
}

export { SYNC_FILE };
