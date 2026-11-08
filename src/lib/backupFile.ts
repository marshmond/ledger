import { localISO } from '../core/time';
import type { FinanceDB } from '../db';
import { decryptText, exportAll, importAll, type BackupFile } from './backup';
import { summarizeBackup, type SummaryGroup } from './backupSummary';
import { downloadText } from './download';

/**
 * Plain (unencrypted) backup files: naming, the "last backup" record, checking a file before it is restored, and the
 * on-screen preferences that live outside the database. The database itself is read and written by lib/backup.ts.
 */

/** The data layout version. It must equal the newest Dexie version in db.ts (a test checks this). Bump both together. */
export const CURRENT_SCHEMA_VERSION = 15;

/** Shown in the file so you can tell which build wrote it. */
export const APP_VERSION = '0.1.0';

/** A backup older than this many calendar days triggers the reminder banner. */
export const REMIND_AFTER_DAYS = 10;

// ---- device-local record of backups (NOT part of backups or sync) ----

const META_KEY = 'ledger-backup-meta';

export interface BackupMeta {
  /** ISO timestamp of the last successful export from this device. */
  lastBackupAt?: string;
  /** Local date (YYYY-MM-DD) the app first ran with the reminder in it; the 10-day clock starts here if there is no backup. */
  firstRun?: string;
  /** Local date the banner was dismissed on. */
  dismissedDay?: string;
  /** Files made today, per kind, so the second one is named "_2". */
  counts?: Partial<Record<FileKind, { day: string; n: number }>>;
}

export type FileKind = 'backup' | 'preimport';
type Store = Pick<Storage, 'getItem' | 'setItem'>;

const store = (s?: Store): Store | null => {
  try { return s ?? localStorage; } catch { return null; }
};

export function readMeta(storage?: Store): BackupMeta {
  try {
    const v = JSON.parse(store(storage)?.getItem(META_KEY) ?? '{}');
    return v && typeof v === 'object' ? (v as BackupMeta) : {};
  } catch { return {}; }
}

export function writeMeta(patch: Partial<BackupMeta>, storage?: Store): BackupMeta {
  const next = { ...readMeta(storage), ...patch };
  try { store(storage)?.setItem(META_KEY, JSON.stringify(next)); } catch { /* storage unavailable: the reminder just starts over */ }
  try { window.dispatchEvent(new Event('ledger-backup-changed')); } catch { /* not in a browser */ }
  return next;
}

/** Your own local date as YYYY-MM-DD (not UTC). */
export function localDay(d: Date = new Date()): string {
  return localISO(d.getTime());
}

/** Whole calendar days from one local date (YYYY-MM-DD) to another. */
export function daysBetween(fromDay: string, toDay: string): number {
  const t = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(toDay) - t(fromDay)) / 86400000);
}

// ---- file names ----

const LABEL: Record<FileKind, string> = { backup: 'Ledger Backup', preimport: 'Ledger Pre-Import' };

/** "Ledger Backup 11-04-26", with "_2", "_3"... for later files on the same day. */
export function fileName(kind: FileKind, day: string, n: number): string {
  const [y, m, d] = day.split('-');
  return `${LABEL[kind]} ${m}-${d}-${y.slice(2)}${n > 1 ? `_${n}` : ''}.json`;
}

/** The name for the next file of this kind today. Does not use up the number: call `useName` once the file is saved. */
export function nextFileName(kind: FileKind, now: Date = new Date(), storage?: Store): { name: string; day: string; n: number } {
  const day = localDay(now);
  const c = readMeta(storage).counts?.[kind];
  const n = c && c.day === day ? c.n + 1 : 1;
  return { name: fileName(kind, day, n), day, n };
}

function useName(kind: FileKind, day: string, n: number, storage?: Store) {
  writeMeta({ counts: { ...readMeta(storage).counts, [kind]: { day, n } } }, storage);
}

/** Notes a successful backup. The reminder banner reads this. */
export function recordBackup(now: Date = new Date(), storage?: Store) {
  writeMeta({ lastBackupAt: now.toISOString() }, storage);
}

// ---- the preferences kept in this browser (colours, layout, which panels are folded) ----

/** Screen preferences saved in localStorage. Sync settings and the weekly-backup passphrase are NOT here on purpose: they are secrets. */
export const PREFERENCE_KEYS = [
  'ledger-theme', 'ledger-palette', 'ledger-palette-vars', 'ledger-keypad-amounts', 'ledger.home.layout.v1', 'ledger-collapsed',
  'ledger-tabs', 'ledger-side-open', 'ledger-flow-last', 'ledger.onboarding.dismissed', 'ledger-sale-method', 'ledger-quick-account',
  // Today (per device): card order, widths and hidden cards; and the "Hide amounts" switch. Shared Today options live in the settings table instead.
  'today.layout.v1', 'today.hideAmounts.v1',
  // ST-S1 (BK-01): three more convenience choices kept on this device. Each is read defensively (a bad or missing value gives the default), so restoring one can never break a screen.
  'services-upcoming-days', 'tasks-last-view', 'ledger-last-module',
];

export function collectPreferences(storage?: Pick<Storage, 'getItem'>): Record<string, string> {
  const out: Record<string, string> = {};
  const s = store(storage as Store);
  if (!s) return out;
  for (const k of PREFERENCE_KEYS) {
    try { const v = s.getItem(k); if (v !== null) out[k] = v; } catch { /* skip */ }
  }
  return out;
}

export function applyPreferences(prefs: unknown, storage?: Store) {
  const s = store(storage);
  if (!s || !prefs || typeof prefs !== 'object') return;
  for (const k of PREFERENCE_KEYS) {
    const v = (prefs as Record<string, unknown>)[k];
    if (typeof v === 'string') { try { s.setItem(k, v); } catch { /* skip */ } }
  }
}

// ---- reading and checking a file ----

export class BackupFileError extends Error {}

const REQUIRED = ['accounts', 'categoryGroups', 'categories', 'txns', 'importBatches'] as const;
const OPTIONAL_LISTS = [
  'assignments', 'recurring', 'recurringLog', 'people', 'incomeProfiles', 'bonuses', 'taxSettings', 'invAccounts', 'assetClasses', 'securities',
  'holdings', 'settings', 'windfalls', 'goals', 'loans', 'loanRates', 'loanEvents', 'rsuVests', 'payScenarios', 'hsaWithdrawals', 'taxLots',
  'sales', 'properties', 'propertyValues', 'netWorthSnapshots', 'payeeRules', 'budgetTargets', 'donations', 'rsuGrants',
  'contacts', 'tags', 'attachments', 'links', 'dueItems', 'moduleRecords',
] as const;

/**
 * Upgrades an older backup to the current layout. Every version so far only ADDED tables, so the upgrade is "fill the
 * missing ones with empty lists". When a future version changes existing data, add a step to MIGRATIONS (keyed by the version it upgrades FROM).
 */
const MIGRATIONS: Record<number, (b: Record<string, unknown>) => void> = {};

export function migrateBackup(raw: Record<string, unknown>): BackupFile {
  const from = Number(raw.schemaVersion ?? raw.version);
  if (!Number.isInteger(from) || from < 1) throw new BackupFileError('This file has no readable version number, so it cannot be a Ledger backup.');
  if (from > CURRENT_SCHEMA_VERSION) {
    throw new BackupFileError(`This backup was made by a newer version of Ledger (data version ${from}; this copy understands up to ${CURRENT_SCHEMA_VERSION}). Nothing was changed. Update Ledger, then try again.`);
  }
  const b: Record<string, unknown> = { ...raw };
  for (const k of OPTIONAL_LISTS) if (b[k] === undefined) b[k] = [];
  for (let v = from; v < CURRENT_SCHEMA_VERSION; v++) MIGRATIONS[v]?.(b);
  b.version = CURRENT_SCHEMA_VERSION;
  b.schemaVersion = CURRENT_SCHEMA_VERSION;
  return b as unknown as BackupFile;
}

export interface BackupSummary {
  exportedAt: string | null;
  fromVersion: number;
  counts: { label: string; n: number }[];
  /** The same records grouped by area (presentation only, see backupSummary.ts). */
  groups: SummaryGroup[];
  /** Things worth knowing that do not stop a restore (for example a record pointing at something not in the file). */
  notes: string[];
}

/** Every list a file may hold. Anything else that is a list is a section this version cannot restore, so the file is refused rather than partly restored. */
const KNOWN_LISTS: readonly string[] = [...REQUIRED, ...OPTIONAL_LISTS];

type Rec = Record<string, unknown>;

/** Structure checks that work on any file: every list holds records, with usable ids, none repeated. Throws a plain-language error. */
function checkRecords(o: Rec) {
  for (const k of KNOWN_LISTS) {
    const list = o[k];
    if (!Array.isArray(list)) continue;
    const seen = new Set<unknown>();
    for (const [i, r] of list.entries()) {
      if (!r || typeof r !== 'object' || Array.isArray(r)) throw new BackupFileError(`The backup is damaged: entry ${i + 1} of "${k}" is not a record. Nothing was changed.`);
      const key = k === 'settings' ? (r as Rec).key : (r as Rec).id;
      const ok = k === 'settings' ? typeof key === 'string' && key !== '' : typeof key === 'number' && Number.isFinite(key);
      if (!ok) throw new BackupFileError(`The backup is damaged: entry ${i + 1} of "${k}" has no usable ${k === 'settings' ? 'key' : 'id'}. Nothing was changed.`);
      if (seen.has(key)) throw new BackupFileError(`The backup is damaged: "${k}" lists the same record (${String(key)}) twice. Nothing was changed.`);
      seen.add(key);
    }
  }
}

/** Files written since G1 say how many records each list held. A different count means the file was cut short or edited. */
function checkManifest(o: Rec) {
  const m = o.manifest;
  if (m === undefined) return; // older file: nothing to compare with
  const counts = m && typeof m === 'object' ? (m as Rec).counts : undefined;
  if (!m || typeof m !== 'object' || (m as Rec).format !== 'ledger-backup' || !counts || typeof counts !== 'object') {
    throw new BackupFileError('The contents list in this backup is unreadable, so the file may be damaged. Nothing was changed.');
  }
  for (const [k, n] of Object.entries(counts as Rec)) {
    const have = Array.isArray(o[k]) ? (o[k] as unknown[]).length : 0;
    if (typeof n !== 'number' || have !== n) {
      throw new BackupFileError(`This backup is incomplete or was changed after it was saved: "${k}" should hold ${String(n)} records but holds ${have}. Nothing was changed.`);
    }
  }
}

/** Gentle checks: points the owner at records that refer to something the file does not contain. They never block a restore. */
function integrityNotes(o: Rec): string[] {
  const ids = (k: string) => new Set(((o[k] as Rec[] | undefined) ?? []).map((r) => r.id));
  const notes: string[] = [];
  const accounts = ids('accounts');
  const orphanTxns = ((o.txns as Rec[]) ?? []).filter((t) => typeof t.accountId === 'number' && !accounts.has(t.accountId)).length;
  if (orphanTxns > 0) notes.push(`${orphanTxns} transaction(s) belong to an account that is not in this file. They are restored as they are.`);
  const groups = ids('categoryGroups');
  const orphanCats = ((o.categories as Rec[]) ?? []).filter((c) => typeof c.groupId === 'number' && !groups.has(c.groupId)).length;
  if (orphanCats > 0) notes.push(`${orphanCats} budget category(ies) belong to a group that is not in this file. They are restored as they are.`);
  return notes;
}

/** Checks the text of a chosen file and returns the upgraded backup plus a summary, or throws a BackupFileError saying why not. Touches no data. */
export function checkBackupText(text: string): { file: BackupFile; summary: BackupSummary } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new BackupFileError('This is not a readable backup: the file is not valid JSON, or it is damaged.'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BackupFileError('This file is not a Ledger backup.');
  const o = raw as Record<string, unknown>;
  if ('salt' in o && 'iv' in o && 'data' in o) {
    throw new BackupFileError('This is an ENCRYPTED backup (.ledgerbackup). Use "Restore an encrypted backup" further down this page, with its passphrase.');
  }
  const missing = REQUIRED.filter((k) => !Array.isArray(o[k]));
  if (missing.length > 0 || (o.schemaVersion === undefined && o.version === undefined)) {
    throw new BackupFileError(`This does not look like a Ledger backup${missing.length ? ` (missing: ${missing.join(', ')})` : ''}. Nothing was changed.`);
  }
  for (const k of OPTIONAL_LISTS) {
    if (o[k] !== undefined && !Array.isArray(o[k])) throw new BackupFileError(`The backup is damaged: "${k}" is not a list. Nothing was changed.`);
  }
  const fromVersion = Number(o.schemaVersion ?? o.version);
  const file = migrateBackup(o); // refuses a file from a newer version before anything else is trusted
  const unknown = Object.keys(o).filter((k) => Array.isArray(o[k]) && !KNOWN_LISTS.includes(k));
  if (unknown.length > 0) {
    throw new BackupFileError(`This backup holds data this copy of Ledger does not know how to restore (${unknown.join(', ')}). Restoring would silently drop it, so nothing was changed. Update Ledger, then try again.`);
  }
  checkManifest(o);
  checkRecords(o);
  const n = (k: keyof BackupFile) => ((file[k] as unknown[] | undefined) ?? []).length;
  return {
    file,
    summary: {
      exportedAt: typeof o.exportedAt === 'string' ? o.exportedAt : null,
      fromVersion,
      counts: [
        { label: 'Accounts', n: n('accounts') },
        { label: 'Transactions', n: n('txns') },
        { label: 'Budget categories', n: n('categories') },
        { label: 'Investment accounts', n: n('invAccounts') },
        { label: 'Holdings', n: n('holdings') },
        { label: 'Loans', n: n('loans') },
      ],
      groups: summarizeBackup(file),
      notes: integrityNotes(o),
    },
  };
}

// ---- making files ----

/** The whole database plus screen preferences, with the version fields the plain backup promises. */
export async function buildBackup(d: FinanceDB, storage?: Pick<Storage, 'getItem'>): Promise<BackupFile & { appVersion: string; app: string; preferences: Record<string, string> }> {
  const base = await exportAll(d);
  return { ...base, app: 'Ledger', schemaVersion: CURRENT_SCHEMA_VERSION, appVersion: APP_VERSION, preferences: collectPreferences(storage) };
}

/** Phones get the share sheet (save to Files / Drive); everything else downloads. Throws an AbortError if the sheet is closed. */
async function saveOrShare(name: string, text: string): Promise<'shared' | 'downloaded'> {
  const file = new File([text], name, { type: 'application/json' });
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Ledger backup' });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
    }
  }
  downloadText(name, 'application/json', text);
  return 'downloaded';
}

/** Saves a plain backup file and records it. Returns the file name, or null if the share sheet was closed. */
export async function exportBackupNow(d: FinanceDB, onBuilt?: (file: BackupFile) => void): Promise<string | null> {
  const { name, day, n } = nextFileName('backup');
  const built = await buildBackup(d);
  const text = JSON.stringify(built, null, 2);
  try { await saveOrShare(name, text); } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    throw e;
  }
  onBuilt?.(built);
  useName('backup', day, n);
  recordBackup();
  // Same note the older (encrypted) export makes, so the Home, More and Accounts reminders agree.
  await d.settings.put({ key: 'lastBackup', value: new Date().toISOString() });
  return name;
}

/** Always a real download (never the share sheet): a copy of the current data, made just before a restore replaces it. */
export async function savePreImportCopy(d: FinanceDB): Promise<string> {
  const { name, day, n } = nextFileName('preimport');
  downloadText(name, 'application/json', JSON.stringify(await buildBackup(d), null, 2));
  useName('preimport', day, n);
  return name;
}

/**
 * Step one of an encrypted restore: decrypt, then run exactly the same file checks as a plain restore. Touches no data. A wrong passphrase,
 * a damaged envelope, or content that fails the checks all throw here, before anything is confirmed or replaced.
 */
export async function prepareEncryptedRestore(text: string, passphrase: string): Promise<{ file: BackupFile; summary: BackupSummary }> {
  let envelope: unknown;
  try { envelope = JSON.parse(text); } catch { throw new BackupFileError('This is not a readable encrypted backup: the file is damaged or is not a .ledgerbackup file. Nothing was changed.'); }
  const e = envelope as Record<string, unknown> | null;
  if (!e || typeof e !== 'object' || typeof e.salt !== 'string' || typeof e.iv !== 'string' || typeof e.data !== 'string') {
    throw new BackupFileError('This is not an encrypted Ledger backup (.ledgerbackup). For a plain .json backup use "Restore Ledger data" above. Nothing was changed.');
  }
  let plain: string;
  try { plain = await decryptText(text, passphrase); } catch (err) {
    throw new BackupFileError(err instanceof Error ? `${err.message}. Nothing was changed.` : 'The backup could not be decrypted. Nothing was changed.');
  }
  return checkBackupText(plain);
}

/**
 * The ONE restore sequence both the plain and the encrypted restore use, after the file is checked and the owner has confirmed:
 * (1) save a copy of the CURRENT data through the normal download path; if that throws, stop here with nothing changed;
 * (2) replace the database in one transaction; (3) only then apply the screen preferences.
 * Limit: the browser reports that a download was STARTED, not that the file reached the disk, and cannot say more.
 */
export async function restoreWithSafetyCopy(
  d: FinanceDB, file: BackupFile,
  opts: { saveCopy?: (d: FinanceDB) => Promise<string>; afterCopy?: () => Promise<unknown>; storage?: Store } = {},
): Promise<string> {
  const saved = await (opts.saveCopy ?? savePreImportCopy)(d);
  await opts.afterCopy?.();
  await restoreChecked(d, file, opts.storage);
  return saved;
}

/** Replaces all data with a checked backup. All or nothing: the database part is one transaction, so a failure leaves the old data. */
export async function restoreChecked(d: FinanceDB, file: BackupFile, storage?: Store) {
  await importAll(d, file);
  applyPreferences((file as unknown as { preferences?: unknown }).preferences, storage);
}
