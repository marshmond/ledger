/**
 * CS-2: runs the publisher inside the app. It wires the pure protocol (`protocol.ts`) to this device's database, sync, settings and GitHub,
 * records what happened, and decides WHEN to try: after a relevant change (after a short wait), straight away after a hide, when Ledger is
 * opened or shown again, when the device comes back online, every ten minutes while open, and when the owner presses Publish now.
 *
 * Browsers do not reliably run a page that is closed, so a closed Ledger publishes nothing: "Waiting to publish" says so until a device is opened.
 */
import { db, type FinanceDB } from '../../db';
import { todayISO } from '../../lib/money';
import { meta as syncMeta, readConfig as readSyncConfig, syncForPublish, syncHeadSha } from '../../lib/sync/auto';
import { buildProjection, ProjectionLimitError } from '../build';
import { recordBaseline } from '../compat';
import type { DisplayProjection } from '../contract';
import { loadGrantRows } from '../grantStore';
import { readDisplayState, type DisplayState } from '../readState';
import { deriveDisplayKeys, generatePassphrase, idKeyOf, normalizePassphrase, openEnvelope, PASSPHRASE_RE, type DisplayKeys } from '../transport/envelope';
import { DisplayStoreError, githubDisplayStore, isRepoPart, type DisplayStore, type RepoCheck } from '../transport/githubFile';
import { clearPublisher, logAttempt, newPublisher, patchActivity, readActivity, readPublisher, updatePublisher, writePublisher, type PublisherConfig } from './config';
import { publishNow, type LocalRead, type PublishDeps, type PublishOptions, type PublishResult } from './protocol';
import { onHideDecision } from './signals';

export type Reason = 'change' | 'open' | 'online' | 'periodic' | 'manual' | 'revocation';

// ---------------- keys (derived once per passphrase; the derivation is deliberately slow) ----------------

const keyCache = new Map<string, Promise<DisplayKeys>>();
export const keysFor = (passphrase: string, iterations?: number) => {
  const k = `${passphrase}|${iterations ?? 0}`;
  if (!keyCache.has(k)) keyCache.set(k, deriveDisplayKeys(passphrase, iterations));
  return keyCache.get(k)!;
};

// ---------------- reading this device ----------------

const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

export async function readLocalFor(d: FinanceDB, keys: DisplayKeys, now = new Date()): Promise<LocalRead & { state: DisplayState }> {
  const state = await readDisplayState(d, { today: todayISO(), tz: zone(), nowMs: now.getTime(), idKey: await idKeyOf(keys), revision: 0, publishedAt: now.toISOString() });
  try {
    return { projection: await buildProjection(state.input), grantRecordIds: state.input.grantRecordIds, state };
  } catch (e) {
    if (e instanceof ProjectionLimitError) throw e;
    throw new Error('The display data could not be built.');
  }
}

export async function depsFor(cfg: PublisherConfig, d: FinanceDB = db, store?: DisplayStore): Promise<PublishDeps> {
  const keys = await keysFor(cfg.passphrase);
  const sync = readSyncConfig();
  return {
    publisherId: cfg.publisherId,
    reviewed: cfg.reviewedAt !== null,
    lastRevision: readActivity().lastRevision,
    store: store ?? githubDisplayStore({ owner: cfg.owner, repo: cfg.repo, token: cfg.token }),
    keys,
    now: () => new Date(),
    syncConfigured: sync !== null,
    runSync: syncForPublish,
    syncHeadSha,
    syncUpToDate: async () => (await syncHeadSha()) === ((await syncMeta.get<string>('remoteSha')) ?? null),
    readLocal: async () => { const { projection, grantRecordIds } = await readLocalFor(d, keys); return { projection, grantRecordIds }; },
    grantIds: async () => (await loadGrantRows(d)).map((r) => r.id as number),
  };
}

// ---------------- one publication, and what to remember about it ----------------

const REJECTED = new Set(['unauthorized', 'forbidden', 'not-found']);

/** Records a result in the activity record. Pure bookkeeping; exported for tests. */
export function recordResult(r: PublishResult, reason: Reason, at = Date.now()): void {
  const prev = readActivity();
  if (r.outcome === 'published') {
    logAttempt({ at, outcome: 'published', code: 'published', message: `Published revision ${r.revision} (${r.local.projection.counts.entries} calendar entries, ${r.local.projection.counts.tasks} Tasks).`, revision: r.revision }, {
      lastSuccessAt: at, lastRevision: r.revision, lastSha: r.sha, publishedGrantIds: r.local.grantRecordIds, publishedCounts: r.local.projection.counts, publishedDigest: r.local.projection.digest,
      pending: false, publishing: false, connection: 'ok', tokenExpiresAt: r.info.tokenExpiresAt ?? prev.tokenExpiresAt,
    });
    return;
  }
  if (r.outcome === 'unchanged') {
    const patch = { lastRevision: Math.max(prev.lastRevision, r.revision), lastSha: r.sha, publishedGrantIds: r.local.grantRecordIds, publishedCounts: r.local.projection.counts, publishedDigest: r.local.projection.digest, pending: false, publishing: false, connection: 'ok' as const, lastSuccessAt: prev.lastSuccessAt ?? at };
    // A quiet re-check is not worth a line in the log unless the owner asked for it.
    if (reason === 'manual') logAttempt({ at, outcome: 'unchanged', code: 'unchanged', message: 'Checked: the display file already matches. Nothing needed to be sent.', revision: r.revision }, patch);
    else patchActivity({ ...patch });
    return;
  }
  logAttempt({ at, outcome: r.outcome, code: r.code, message: r.message }, { publishing: false, connection: REJECTED.has(r.code) ? 'rejected' : r.code === 'network' ? prev.connection : prev.connection === 'rejected' ? 'unknown' : prev.connection });
}

let running: Promise<PublishResult | null> | null = null;
let again: { reason: Reason; opts: PublishOptions } | null = null;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let lastRunAt = 0;
const MIN_GAP_MS = 20_000;

/** Tries to publish. Several requests at once share one run (a request made during a run causes exactly one more afterwards). Never throws. */
export function requestPublish(reason: Reason, opts: PublishOptions = {}): Promise<PublishResult | null> {
  if (running) { again = { reason, opts }; return running; }
  const cfg = readPublisher();
  if (!cfg) return Promise.resolve(null);
  const quiet = reason !== 'manual' && reason !== 'revocation';
  if (quiet && (readActivity().connection === 'rejected' || Date.now() - lastRunAt < MIN_GAP_MS)) return Promise.resolve(null);
  running = (async () => {
    lastRunAt = Date.now();
    patchActivity({ publishing: true });
    let result: PublishResult;
    try {
      const deps = await depsFor(cfg);
      const flags: PublishOptions = { ...opts, startNewFile: opts.startNewFile || cfg.replaceExisting, takeOver: opts.takeOver || cfg.takeOver };
      if (quiet && cfg.reviewedAt !== null && (await nothingToDo(deps))) { patchActivity({ publishing: false }); return null; }
      result = await publishNow(deps, flags);
      if (result.outcome === 'published' && (cfg.replaceExisting || cfg.takeOver)) updatePublisher({ replaceExisting: false, takeOver: false });
    } catch (e) {
      result = { outcome: 'failed', code: 'internal', message: e instanceof Error ? e.message : 'Publishing failed.' };
    }
    recordResult(result, reason);
    scheduleRetry(result);
    return result;
  })().finally(() => {
    running = null;
    const next = again;
    again = null;
    if (next) setTimeout(() => void requestPublish(next.reason, next.opts), 1500);
  });
  return running;
}

/** Cheap early exit for the quiet triggers: nothing changed here since the last publication and the file in GitHub is still the one this device wrote. */
export async function nothingToDo(deps: PublishDeps): Promise<boolean> {
  const a = readActivity();
  if (a.pending || !a.lastSha || !a.publishedDigest) return false;
  try {
    // Another device may have synced a change (an edit or a revocation) that this device has not pulled yet, for example with automatic sync off.
    // This device's own data would look unchanged, so ask the sync file itself. Costs one small request.
    if (deps.syncConfigured && deps.syncUpToDate && !(await deps.syncUpToDate())) return false;
    const local = await deps.readLocal();
    if (local.projection.digest !== a.publishedDigest) return false;
    const have = new Set(a.publishedGrantIds);
    if (local.grantRecordIds.length !== have.size || local.grantRecordIds.some((x) => !have.has(x))) return false;
    const read = await deps.store.read();
    return read.kind === 'file' && read.file.sha === a.lastSha;
  } catch { return false; }
}

function scheduleRetry(r: PublishResult) {
  clearTimeout(retryTimer);
  if (r.outcome !== 'failed' || !['network', 'server', 'rate-limited', 'coordination-failed'].includes(r.code)) return;
  const wait = r.code === 'rate-limited' ? Math.min(3600, (r.retryAfterSeconds ?? 60) + 5) * 1000 : r.code === 'coordination-failed' ? 60_000 : 3 * 60_000;
  retryTimer = setTimeout(() => void requestPublish('periodic'), wait);
}

// ---------------- setup, review, recovery ----------------

export interface ConnectInput { repoText: string; token: string; passphrase: string; tokenExpiresOn?: string | null }
export type ConnectResult = { ok: true; check: RepoCheck; config: PublisherConfig; warnings: string[] } | { ok: false; message: string };

/** Checks a repository and key, and saves them on this device only if every safety condition holds. Sends nothing but the check requests. */
export async function connectPublisher(i: ConnectInput, store?: DisplayStore, d0: FinanceDB = db): Promise<ConnectResult> {
  const m = i.repoText.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/+$/, '').match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!m || !isRepoPart(m[1]) || !isRepoPart(m[2].replace(/\.git$/, ''))) return { ok: false, message: 'Type the repository as owner/name, for example myname/ledger-display.' };
  const owner = m[1];
  const repo = m[2].replace(/\.git$/, '');
  const pass = normalizePassphrase(i.passphrase);
  if (!PASSPHRASE_RE.test(pass)) return { ok: false, message: 'That is not a display passphrase. It looks like ABCD-EFGH-… (eight groups). Use the one Ledger made.' };
  if (!i.token.trim()) return { ok: false, message: 'Paste the publishing key (the one that can write to the display repository).' };
  const sync = readSyncConfig();
  if (sync) {
    if (sync.owner.toLowerCase() === owner.toLowerCase() && sync.repo.toLowerCase() === repo.toLowerCase()) return { ok: false, message: 'That is the repository Ledger uses for sync. The display needs its own separate private repository.' };
    if (sync.token === i.token.trim()) return { ok: false, message: 'That is the sync key. The display needs its own separate key that can reach only the display repository.' };
    if (sync.passphrase === i.passphrase.trim() || normalizePassphrase(sync.passphrase) === pass) return { ok: false, message: 'The display passphrase must be different from the sync passphrase.' };
  }
  const cfg = newPublisher({ owner, repo, token: i.token, passphrase: pass });
  const s = store ?? githubDisplayStore({ owner, repo, token: cfg.token });
  let check: RepoCheck;
  try { check = await s.check(); } catch (e) { return { ok: false, message: e instanceof DisplayStoreError ? e.message : 'The repository could not be checked.' }; }
  if (!check.private) return { ok: false, message: 'That repository is public. The display repository must be private. Nothing was saved.' };
  if (check.archived) return { ok: false, message: 'That repository is archived, so it cannot be written to.' };
  if (check.canWrite === false) return { ok: false, message: 'This key can only read the repository. Ledger needs a key with "Contents: read and write" for this one repository.' };
  const warnings: string[] = [];
  if (check.otherFiles.length) warnings.push(`The repository also holds other files (${check.otherFiles.slice(0, 3).join(', ')}). It should hold the display file and nothing else.`);
  if (check.canWrite === null) warnings.push('GitHub did not say whether this key can write. The first publication will show.');
  const existing = readPublisher();
  const keep = existing && existing.owner === owner && existing.repo === repo && existing.passphrase === pass ? existing.publisherId : cfg.publisherId;
  const config: PublisherConfig = { ...cfg, publisherId: keep, tokenExpiresOn: i.tokenExpiresOn ?? null };
  writePublisher(config);
  patchActivity({ connection: 'ok', publishing: false });
  startDisplayPublisher(d0);
  return { ok: true, check, config, warnings };
}

export interface FirstReview { projection: DisplayProjection; state: DisplayState; at: number; existing: 'none' | 'readable' | 'unreadable' }

/** Everything the display would show, for the owner's review before the first publication. Sends nothing except reading the display file to see whether one exists. */
export async function prepareReview(cfg: PublisherConfig, d: FinanceDB = db, store?: DisplayStore): Promise<FirstReview> {
  const keys = await keysFor(cfg.passphrase);
  const at = Date.now();
  const local = await readLocalFor(d, keys, new Date(at));
  let existing: FirstReview['existing'] = 'none';
  try {
    const read = await (store ?? githubDisplayStore({ owner: cfg.owner, repo: cfg.repo, token: cfg.token })).read();
    if (read.kind === 'file') existing = (await openEnvelope(keys, read.file.bytes)).ok ? 'readable' : 'unreadable';
  } catch { /* the review does not depend on it */ }
  return { projection: local.projection, state: local.state, at, existing };
}

/** The owner confirmed the review. Records the baseline (see compat.ts), allows publishing from this device, and publishes. */
export async function confirmFirstPublication(review: FirstReview, d: FinanceDB = db): Promise<PublishResult | null> {
  await recordBaseline(d, review.at);
  updatePublisher({ reviewedAt: Date.now() });
  patchActivity({ pending: true });
  return requestPublish('manual');
}

/** A new random display passphrase for this device: the next publication starts a new file and the tablet must be paired again. */
export function changePassphrase(): string {
  const p = generatePassphrase();
  updatePublisher({ passphrase: p, replaceExisting: true });
  patchActivity({ pending: true });
  return p;
}

export const disconnectPublisher = () => { clearTimeout(retryTimer); clearPublisher(); };

// ---------------- when to try ----------------

const RELEVANT = new Set(['calendar', 'tasks', 'family', 'display', 'services', 'assets']);
let started = false;
let debounce: ReturnType<typeof setTimeout> | undefined;
export const DEBOUNCE_MS = 10_000;

/** Wires the automatic triggers once, when the app starts. Does nothing until the owner has set up publishing on this device. */
export function startDisplayPublisher(d: FinanceDB = db): void {
  if (started || typeof document === 'undefined') return;
  started = true;
  const active = () => readPublisher()?.reviewedAt != null;
  const poke = () => {
    if (!active()) return;
    if (!readActivity().pending) patchActivity({ pending: true });
    clearTimeout(debounce);
    debounce = setTimeout(() => void requestPublish('change'), DEBOUNCE_MS);
  };
  for (const name of ['moduleRecords', 'contacts'] as const) {
    const t = d.table(name);
    const relevant = (o: unknown) => name === 'contacts' || RELEVANT.has((o as { module?: string } | null)?.module ?? '');
    t.hook('creating', (_k, obj) => { if (relevant(obj)) poke(); return undefined; });
    t.hook('updating', (_m, _k, obj) => { if (relevant(obj)) poke(); return undefined; });
    t.hook('deleting', (_k, obj) => { if (relevant(obj)) poke(); });
  }
  onHideDecision(() => { if (active()) { clearTimeout(debounce); void requestPublish('revocation'); } });
  const go = (r: Reason) => () => { if (active() && navigator.onLine !== false) void requestPublish(r); };
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && go('open')());
  window.addEventListener('online', go('online'));
  setInterval(() => document.visibilityState === 'visible' && go('periodic')(), 10 * 60 * 1000);
  setTimeout(go('open'), 4000);
}
