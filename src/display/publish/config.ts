/**
 * CS-2: what this DEVICE knows about publishing. Kept in this browser only, exactly like the sync token and for the same reason: it holds
 * secrets (the publishing key and the display passphrase). It is not in the database, so it is never synced, never in a backup file and never
 * sent anywhere except to GitHub (the key) and into encryption (the passphrase). `PREFERENCE_KEYS` (what a backup carries) does not list it.
 *
 * The second key here, the activity record, holds NO secrets and no household content: times, outcomes, a revision number and the numeric ids of
 * the privacy decisions that were published (needed to say "hidden in Ledger, not yet published").
 */
import { localISO } from '../../core/time';
import { isRepoPart } from '../transport/githubFile';
import { newPublisherId, normalizePassphrase, PASSPHRASE_RE } from '../transport/envelope';

import { ACTIVITY_KEY, CONFIG_KEY } from './keys';
export { ACTIVITY_KEY, CONFIG_KEY };
export const LOG_KEEP = 60;

export interface PublisherConfig {
  v: 1;
  owner: string;
  repo: string;
  /** The WRITE key: Contents read and write, this one repository only. */
  token: string;
  /** The display passphrase (never the sync or backup passphrase). */
  passphrase: string;
  /** Random, per device. Written into the display file so a second, unsynced device can be refused. */
  publisherId: string;
  /** The date the owner says the write key expires (YYYY-MM-DD), for the reminder. GitHub's own date is used too when the browser can read it. */
  tokenExpiresOn: string | null;
  /** When the owner reviewed the full dataset and allowed the first publication from this device. */
  reviewedAt: number | null;
  /** One-shot: the next publication may replace a display file this device cannot read (set by "start a new display file" and by changing the passphrase). */
  replaceExisting: boolean;
  /** One-shot: the next publication may take over from another publishing device (an explicit owner action). */
  takeOver: boolean;
}

const store = (): Storage | null => { try { return localStorage; } catch { return null; } };

export function readPublisher(): PublisherConfig | null {
  try {
    const c = JSON.parse(store()?.getItem(CONFIG_KEY) ?? 'null') as PublisherConfig | null;
    if (!c || c.v !== 1 || !isRepoPart(c.owner ?? '') || !isRepoPart(c.repo ?? '') || !c.token || !PASSPHRASE_RE.test(normalizePassphrase(c.passphrase ?? '')) || !/^[0-9a-f]{16}$/.test(c.publisherId ?? '')) return null;
    return { ...c, passphrase: normalizePassphrase(c.passphrase), tokenExpiresOn: c.tokenExpiresOn ?? null, reviewedAt: c.reviewedAt ?? null, replaceExisting: !!c.replaceExisting, takeOver: !!c.takeOver };
  } catch { return null; }
}
export function writePublisher(c: PublisherConfig): void {
  store()?.setItem(CONFIG_KEY, JSON.stringify(c));
  changed();
}
export function updatePublisher(patch: Partial<PublisherConfig>): PublisherConfig | null {
  const c = readPublisher();
  if (!c) return null;
  const next = { ...c, ...patch };
  writePublisher(next);
  return next;
}
export function newPublisher(i: { owner: string; repo: string; token: string; passphrase: string }): PublisherConfig {
  return { v: 1, owner: i.owner, repo: i.repo, token: i.token.trim(), passphrase: normalizePassphrase(i.passphrase), publisherId: newPublisherId(), tokenExpiresOn: null, reviewedAt: null, replaceExisting: false, takeOver: false };
}
/** Forgets the keys on this device. The display file in GitHub and the tablet are untouched. */
export function clearPublisher(): void {
  store()?.removeItem(CONFIG_KEY);
  store()?.removeItem(ACTIVITY_KEY);
  changed();
}

// ---------------- activity ----------------

export type Outcome = 'published' | 'unchanged' | 'blocked' | 'failed';
export interface LogEntry { at: number; outcome: Outcome; code: string; message: string; revision?: number }
export interface Activity {
  v: 1;
  lastSuccessAt: number | null;
  lastRevision: number;
  lastSha: string | null;
  /** The numeric record ids of every privacy decision covered by the last successful publication. */
  publishedGrantIds: number[];
  publishedCounts: { entries: number; tasks: number } | null;
  /** The content digest of the last successful publication (no content; used only to skip needless work). */
  publishedDigest: string | null;
  /** True from a change until a publication has dealt with it. */
  pending: boolean;
  publishing: boolean;
  /** `rejected`: GitHub refused the key or cannot find the repository (revoked, expired or deleted). */
  connection: 'ok' | 'rejected' | 'unknown';
  tokenExpiresAt: string | null;
  lastAttempt: LogEntry | null;
  log: LogEntry[];
}
export const blankActivity = (): Activity => ({ v: 1, lastSuccessAt: null, lastRevision: 0, lastSha: null, publishedGrantIds: [], publishedCounts: null, publishedDigest: null, pending: false, publishing: false, connection: 'unknown', tokenExpiresAt: null, lastAttempt: null, log: [] });

export function readActivity(): Activity {
  try {
    const a = JSON.parse(store()?.getItem(ACTIVITY_KEY) ?? 'null') as Activity | null;
    return a && a.v === 1 ? { ...blankActivity(), ...a, publishing: false } : blankActivity(); // a stored "publishing" is from a closed page, so it is not true now
  } catch { return blankActivity(); }
}
export function writeActivity(a: Activity): void {
  store()?.setItem(ACTIVITY_KEY, JSON.stringify({ ...a, log: a.log.slice(-LOG_KEEP) }));
  changed();
}
export function patchActivity(patch: Partial<Activity>): Activity {
  const next = { ...readActivity(), ...patch };
  writeActivity(next);
  return next;
}
export function logAttempt(entry: LogEntry, patch: Partial<Activity> = {}): Activity {
  const a = readActivity();
  const next: Activity = { ...a, ...patch, lastAttempt: entry, log: [...a.log, entry].slice(-LOG_KEEP) };
  writeActivity(next);
  return next;
}

// ---------------- change notification (this tab) ----------------

const subs = new Set<() => void>();
let version = 0;
function changed() { version++; subs.forEach((f) => f()); }
export const subscribePublisher = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const publisherVersion = () => version;

// ---------------- expiry ----------------

export const EXPIRY_WARN_DAYS = 14;
export interface ExpiryState { level: 'none' | 'soon' | 'expired'; date: string | null; days: number | null }
/** The nearer of the owner's own date and the date GitHub reported. */
export function expiryOf(c: PublisherConfig | null, a: Activity, nowMs: number): ExpiryState {
  const dates: { at: number; text: string }[] = [];
  if (c?.tokenExpiresOn && /^\d{4}-\d{2}-\d{2}$/.test(c.tokenExpiresOn)) dates.push({ at: Date.parse(`${c.tokenExpiresOn}T23:59:59`), text: c.tokenExpiresOn }); // end of that day, local time
  if (a.tokenExpiresAt) { const t = Date.parse(a.tokenExpiresAt); if (Number.isFinite(t)) dates.push({ at: t, text: localISO(t) }); } // shown as the owner's local day
  const usable = dates.filter((d) => Number.isFinite(d.at));
  if (!usable.length) return { level: 'none', date: null, days: null };
  const near = usable.reduce((x, y) => (y.at < x.at ? y : x));
  const days = Math.floor((near.at - nowMs) / 86400_000);
  return { level: near.at <= nowMs ? 'expired' : days <= EXPIRY_WARN_DAYS ? 'soon' : 'none', date: near.text, days };
}
