/**
 * Weekly automatic backup: a dated, encrypted copy in the `backups` folder of the private repository sync already uses.
 * The passphrase is its own (not the sync passphrase) and, like the sync token, stays in this browser only.
 * The repository is the record of when the last copy was made, so several devices do not each add one.
 */
import { db, type FinanceDB } from '../db';
import { encryptText, exportAll } from './backup';
import { readConfig } from './sync/auto';
import { githubBackups, type BackupStore } from './sync/github';

export const AUTO_BACKUP_EVERY_DAYS = 7;
export const AUTO_BACKUP_KEEP = 8;
export const AUTO_BACKUP_MIN_PASSPHRASE = 8;

const KEY = 'ledger-autobackup';
export interface AutoBackupConfig {
  passphrase: string;
}
/** What the Backup tab shows: the day of the newest copy in the repository, and a plain-language reason the last try failed. */
export interface AutoBackupStatus {
  day?: string;
  error?: string;
}

export function readAutoBackup(): AutoBackupConfig | null {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? 'null') as AutoBackupConfig | null;
    return c && c.passphrase ? c : null;
  } catch {
    return null;
  }
}
export function saveAutoBackup(c: AutoBackupConfig) {
  localStorage.setItem(KEY, JSON.stringify(c));
}
export function clearAutoBackup() {
  localStorage.removeItem(KEY);
}
export function readAutoStatus(): AutoBackupStatus {
  try {
    return JSON.parse(localStorage.getItem(`${KEY}-status`) ?? '{}') as AutoBackupStatus;
  } catch {
    return {};
  }
}
function writeStatus(s: AutoBackupStatus) {
  try { localStorage.setItem(`${KEY}-status`, JSON.stringify(s)); } catch { /* storage full or blocked: the status is only a convenience */ }
}

export const backupFileName = (day: string) => `ledger-${day}.ledgerbackup`;
/** The day in a backup file's name, or null for any other file. */
export const backupFileDay = (name: string) => /^ledger-(\d{4}-\d{2}-\d{2})\.ledgerbackup$/.exec(name)?.[1] ?? null;

export interface AutoBackupResult {
  /** 'made' = a new copy was uploaded; 'not-due' = a recent copy exists already. */
  outcome: 'made' | 'not-due';
  /** The day of the newest copy in the repository after this run. */
  newestDay: string;
  deleted: string[];
}

/** Uploads a backup if the newest one in the repository is older than the interval (or `force`), then trims the oldest. Throws on failure. */
export async function runAutoBackup(
  d: FinanceDB,
  store: BackupStore,
  passphrase: string,
  now: Date = new Date(),
  opts: { force?: boolean } = {},
): Promise<AutoBackupResult> {
  const day = now.toISOString().slice(0, 10);
  const files = (await store.list()).filter((f) => backupFileDay(f.name));
  const newest = files.map((f) => backupFileDay(f.name)!).sort().pop();
  if (!opts.force && newest && (Date.parse(day) - Date.parse(newest)) / 86400000 < AUTO_BACKUP_EVERY_DAYS) return { outcome: 'not-due', newestDay: newest, deleted: [] };

  const text = await encryptText(JSON.stringify(await exportAll(d)), passphrase);
  // False means today's file is already there (an earlier "back up now" today): nothing more to add.
  await store.add(backupFileName(day), text, `Automatic backup ${day}`);

  const kept = files.filter((f) => f.name !== backupFileName(day)).sort((a, b) => backupFileDay(a.name)!.localeCompare(backupFileDay(b.name)!));
  const deleted: string[] = [];
  // Today's copy counts as one of the kept ones, so only the oldest of the others are removed.
  for (const old of kept.slice(0, Math.max(0, kept.length + 1 - AUTO_BACKUP_KEEP))) {
    await store.remove(old.name, old.sha, `Remove old automatic backup ${backupFileDay(old.name)}`);
    deleted.push(old.name);
  }
  return { outcome: 'made', newestDay: day, deleted };
}

let running = false;
/** Runs the backup for this device if it is set up and due. Never throws: the result is the status the Backup tab shows. */
export async function autoBackupNow(opts: { force?: boolean } = {}): Promise<AutoBackupStatus> {
  const cfg = readAutoBackup();
  const sync = readConfig();
  if (!cfg || !sync || running) return readAutoStatus();
  running = true;
  try {
    const r = await runAutoBackup(db, githubBackups(sync), cfg.passphrase, new Date(), opts);
    writeStatus({ day: r.newestDay });
  } catch (e) {
    writeStatus({ ...readAutoStatus(), error: e instanceof Error ? e.message : String(e) });
  } finally {
    running = false;
  }
  return readAutoStatus();
}

let started = false;
/** Checks shortly after the app opens (so sync has brought this device up to date) and every few hours while it stays open. */
export function startAutoBackup() {
  if (started) return;
  started = true;
  const go = () => {
    if (navigator.onLine !== false && document.visibilityState === 'visible') void autoBackupNow();
  };
  setTimeout(go, 30000);
  setInterval(go, 6 * 60 * 60 * 1000);
}
