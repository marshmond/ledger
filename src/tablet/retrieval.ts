/**
 * CS-2: the tablet's retrieval logic: pairing, polling, validation, the encrypted local copy, freshness and expiry. No screens here (CS-3).
 *
 * What it keeps, and what that means:
 *  - the pairing: the repository name, the READ-ONLY key (as text; GitHub needs it) and the display key (a non-extractable browser key; the
 *    passphrase itself is not kept);
 *  - the last good display FILE exactly as GitHub gave it (still encrypted). It is decrypted in memory only when something needs to show it,
 *    so the saved copy is unreadable without the stored key;
 *  - small facts (times, revision, counts) for the diagnostics page.
 * A new file replaces the saved copy only after it has been decrypted and fully validated, as one step; an invalid, older or unreadable file
 * leaves the saved copy untouched. It never shows part of a file.
 *
 * Limits, stated plainly: the saved copy cannot be erased from a tablet that is switched off or offline and never opened; it is deleted when the
 * app next starts or runs and finds it too old. That relies on the tablet's clock, which a person can change; the code uses the latest time it
 * has ever seen (and the server's time when the browser lets it read it) so a clock set back does not extend the life of a saved copy, and shows
 * a warning. Browser storage cleared by the user, or a replaced tablet, means pairing again.
 */
import type { DisplayProjection } from '../display/contract';
import { deriveDisplayKeys, openEnvelope, type DisplayKeys, type OpenCode } from '../display/transport/envelope';
import { DisplayStoreError, githubDisplayStore, type DisplayStore } from '../display/transport/githubFile';
import { decodePairing } from '../display/transport/pairing';
import { backoffMs, DEFAULT_RETENTION_MS, freshnessOf, RETENTION_CHOICES, REVOKED_AFTER_MS, type Freshness } from './freshness';
import type { KeyValue } from './storage';

interface PairingRecord { owner: string; repo: string; token: string; key: CryptoKey; pairedAt: number }
interface CacheRecord { bytes: Uint8Array; sha: string; etag: string | null; revision: number; publishedAt: string; version: number; minReader: number; counts: { entries: number; tasks: number }; storedAt: number }
interface StateRecord {
  lastCheckAt: number | null;
  lastSuccessAt: number | null;
  failures: number;
  backoffUntil: number;
  accessFailureSince: number | null;
  /** Latest time ever seen on this tablet's clock or reported by GitHub. Expiry never counts backwards from it. */
  highWater: number;
  clockNote: 'behind' | 'differs' | null;
  validation: 'none' | 'ok' | 'failed';
  problem: { code: Problem; message: string; at: number } | null;
  retentionMs: number;
}
export type Problem = 'network' | 'server' | 'rate-limited' | 'access-refused' | 'disconnected' | 'no-file' | 'mismatch' | 'invalid' | 'rollback' | 'needs-update' | 'bad-response';

const BLANK: StateRecord = { lastCheckAt: null, lastSuccessAt: null, failures: 0, backoffUntil: 0, accessFailureSince: null, highWater: 0, clockNote: null, validation: 'none', problem: null, retentionMs: DEFAULT_RETENTION_MS };
const CLOCK_TOLERANCE_MS = 5 * 60_000;

export interface TabletView {
  paired: boolean;
  repo: string | null;
  connection: 'connected' | 'disconnected' | 'never';
  lastCheckAt: number | null;
  lastSuccessAt: number | null;
  publishedAt: string | null;
  projectionVersion: number | null;
  revision: number | null;
  counts: { entries: number; tasks: number } | null;
  validation: 'none' | 'ok' | 'failed';
  hasCopy: boolean;
  freshness: Freshness;
  problem: { code: Problem; message: string } | null;
  clockWarning: string | null;
  retentionMs: number;
}

export interface TabletDeps {
  kv: KeyValue;
  now(): number;
  /** Builds the GitHub client for a pairing. Tests pass a fake. */
  storeFor?(p: { owner: string; repo: string; token: string }): DisplayStore;
  /** Key-derivation rounds (tests use fewer; the real value is the default). */
  iterations?: number;
}

const OPEN_PROBLEM: Partial<Record<OpenCode, Problem>> = { 'cannot-decrypt': 'mismatch', 'needs-newer-reader': 'needs-update', 'unsupported-version': 'needs-update' };

export class Tablet {
  private flight: Promise<TabletView> | null = null;
  constructor(private deps: TabletDeps) {}

  private get kv() { return this.deps.kv; }
  private pairing = () => this.kv.get<PairingRecord>('pairing');
  private cache = () => this.kv.get<CacheRecord>('cache');
  private async state(): Promise<StateRecord> { return { ...BLANK, ...(await this.kv.get<StateRecord>('state')) }; }
  private save = (s: StateRecord) => this.kv.set('state', s);

  /** Pairs with the code from Ledger. Replaces any earlier pairing and deletes any saved copy. Then checks once. */
  async pair(code: string): Promise<{ ok: true; view: TabletView } | { ok: false; message: string }> {
    const d = decodePairing(code);
    if (!d.ok) return d;
    let keys: DisplayKeys;
    try { keys = await deriveDisplayKeys(d.data.passphrase, this.deps.iterations); } catch { return { ok: false, message: 'This device cannot do the encryption this display needs.' }; }
    await this.kv.clear();
    await this.kv.set('pairing', { owner: d.data.owner, repo: d.data.repo, token: d.data.token, key: keys.master, pairedAt: this.deps.now() } satisfies PairingRecord);
    await this.save({ ...BLANK, highWater: this.deps.now() });
    return { ok: true, view: await this.checkNow(true) };
  }

  /** Forgets everything on this tablet: the key, the pairing and the saved copy. Nothing in GitHub or Ledger changes. */
  async forget(): Promise<TabletView> {
    await this.kv.clear();
    return this.view();
  }

  async setRetention(ms: number): Promise<TabletView> {
    if (!RETENTION_CHOICES.some((c) => c.ms === ms)) throw new Error('Choose 24 hours, 3 days or 7 days.');
    await this.save({ ...(await this.state()), retentionMs: ms });
    return this.tick();
  }

  /** Deletes the saved copy if it is older than the keep time, and answers with the current picture. No network. Safe to call often (every minute). */
  async tick(): Promise<TabletView> {
    const s = await this.state();
    this.observeClock(s, this.deps.now(), null);
    if (await this.expireIfNeeded(s)) { /* saved copy removed */ }
    await this.save(s);
    return this.view(s);
  }

  /** One check of GitHub. Several calls at once share one run. `force` ignores the back-off (the Check now button). Never throws. */
  checkNow(force = false): Promise<TabletView> {
    if (this.flight) return this.flight;
    this.flight = this.run(force).catch(() => this.view()).finally(() => { this.flight = null; });
    return this.flight;
  }

  private async run(force: boolean): Promise<TabletView> {
    const p = await this.pairing();
    if (!p) return this.view();
    const s = await this.state();
    const now = this.deps.now();
    this.observeClock(s, now, null);
    await this.expireIfNeeded(s);
    if (!force && s.backoffUntil > this.effectiveNow(s, now)) { await this.save(s); return this.view(s); }
    s.lastCheckAt = now;
    const cache = await this.cache();
    const store = (this.deps.storeFor ?? ((x) => githubDisplayStore(x)))({ owner: p.owner, repo: p.repo, token: p.token });
    try {
      const r = await store.read({ etag: cache?.etag ?? null });
      this.observeClock(s, now, r.info.serverDate);
      if (r.kind === 'not-modified' || (r.kind === 'file' && cache && r.file.sha === cache.sha)) {
        this.succeeded(s, now);
      } else if (r.kind === 'missing') {
        this.succeeded(s, now);
        s.problem = { code: 'no-file', message: 'Nothing has been published to this display yet.', at: now };
      } else if (r.kind === 'file') {
        const opened = await openEnvelope({ master: p.key }, r.file.bytes);
        if (!opened.ok) {
          s.validation = 'failed';
          s.problem = { code: OPEN_PROBLEM[opened.code] ?? 'invalid', message: opened.code === 'cannot-decrypt' ? 'The display code no longer matches. Pair this display again from Ledger.' : opened.message, at: now };
          // The connection worked, but the data did not: the saved copy is kept and the check does not count as an update.
        } else if (cache && opened.revision <= cache.revision) {
          s.validation = 'failed';
          s.problem = { code: 'rollback', message: `The published file is older than the one already saved (revision ${opened.revision} against ${cache.revision}). It was ignored.`, at: now };
        } else {
          const pr = opened.projection;
          await this.kv.set('cache', { bytes: r.file.bytes, sha: r.file.sha, etag: r.file.etag, revision: opened.revision, publishedAt: pr.publishedAt, version: pr.version, minReader: pr.minReader, counts: pr.counts, storedAt: now } satisfies CacheRecord);
          this.succeeded(s, now);
          s.validation = 'ok';
        }
      }
    } catch (e) {
      this.failed(s, now, e);
      await this.afterAccessFailure(s);
    }
    await this.save(s);
    return this.view(s);
  }

  private succeeded(s: StateRecord, now: number) {
    s.lastSuccessAt = now;
    s.failures = 0;
    s.backoffUntil = 0;
    s.accessFailureSince = null;
    s.problem = null;
    if (s.validation === 'none') s.validation = 'ok';
  }

  private failed(s: StateRecord, now: number, e: unknown) {
    const err = e instanceof DisplayStoreError ? e : null;
    const code = err?.code ?? 'network';
    if (code === 'unauthorized' || code === 'forbidden' || code === 'not-found') {
      s.accessFailureSince ??= now;
      s.problem = { code: 'access-refused', message: 'GitHub is not accepting this display’s key. If you did not expect this, check Ledger.', at: now };
      s.backoffUntil = now + backoffMs(1);
      return;
    }
    s.failures += 1;
    if (code === 'rate-limited') {
      s.backoffUntil = now + Math.max(60, err?.retryAfterSeconds ?? 60) * 1000;
      s.problem = { code: 'rate-limited', message: 'GitHub is limiting requests. The display will try again shortly.', at: now };
    } else {
      s.backoffUntil = now + backoffMs(s.failures);
      s.problem = { code: code === 'server' ? 'server' : code === 'network' ? 'network' : 'bad-response', message: code === 'server' ? 'GitHub had a problem. The display will try again.' : code === 'network' ? 'No connection. Showing the saved copy.' : 'GitHub sent an answer the display could not use.', at: now };
    }
  }

  /** Repeated refusals for ten minutes mean the key was revoked or has expired: the saved copy is deleted (design I.4). */
  private async afterAccessFailure(s: StateRecord) {
    if (s.accessFailureSince !== null && this.deps.now() - s.accessFailureSince >= REVOKED_AFTER_MS) {
      await this.kv.del('cache');
      s.validation = 'none';
      s.problem = { code: 'disconnected', message: 'This display was disconnected. Reconnect it from Ledger.', at: this.deps.now() };
    }
  }

  // ---------- clock and expiry ----------

  private effectiveNow(s: StateRecord, now: number) { return Math.max(now, s.highWater); }

  private observeClock(s: StateRecord, now: number, serverDate: number | null) {
    s.clockNote = null;
    if (s.highWater - now > CLOCK_TOLERANCE_MS) s.clockNote = 'behind';
    if (serverDate !== null && Math.abs(serverDate - now) > CLOCK_TOLERANCE_MS) s.clockNote = 'differs';
    s.highWater = Math.max(s.highWater, now, serverDate ?? 0);
  }

  private async expireIfNeeded(s: StateRecord): Promise<boolean> {
    if (s.lastSuccessAt === null) return false;
    if (this.effectiveNow(s, this.deps.now()) - s.lastSuccessAt < s.retentionMs) return false;
    if (!(await this.cache())) return false;
    await this.kv.del('cache');
    s.validation = 'none';
    s.problem = { code: 'disconnected', message: 'The saved schedule was deleted because this display could not refresh for too long. Reconnect to see it again.', at: this.deps.now() };
    return true;
  }

  // ---------- reading ----------

  /** The decrypted, validated projection for a screen to draw, or null (nothing saved, expired, or the copy does not open). Decrypts in memory only. */
  async projection(): Promise<DisplayProjection | null> {
    const p = await this.pairing();
    const c = await this.cache();
    if (!p || !c) return null;
    const s = await this.state();
    if (s.lastSuccessAt !== null && this.effectiveNow(s, this.deps.now()) - s.lastSuccessAt >= s.retentionMs) return null;
    const o = await openEnvelope({ master: p.key }, c.bytes);
    return o.ok ? o.projection : null;
  }

  async view(known?: StateRecord): Promise<TabletView> {
    const p = await this.pairing();
    const s = known ?? (await this.state());
    const c = p ? await this.cache() : undefined;
    const now = this.effectiveNow(s, this.deps.now());
    const refusing = s.problem?.code === 'access-refused' || s.problem?.code === 'disconnected';
    const failing = s.problem && ['network', 'server', 'rate-limited', 'bad-response'].includes(s.problem.code);
    return {
      paired: !!p,
      repo: p ? `${p.owner}/${p.repo}` : null,
      connection: !p || s.lastCheckAt === null ? 'never' : refusing || failing ? 'disconnected' : 'connected',
      lastCheckAt: s.lastCheckAt,
      lastSuccessAt: s.lastSuccessAt,
      publishedAt: c?.publishedAt ?? null,
      projectionVersion: c?.version ?? null,
      revision: c?.revision ?? null,
      counts: c?.counts ?? null,
      validation: c ? s.validation : s.validation === 'failed' ? 'failed' : 'none',
      hasCopy: !!c,
      freshness: freshnessOf(s.lastSuccessAt, now, s.retentionMs),
      problem: s.problem ? { code: s.problem.code, message: s.problem.message } : null,
      clockWarning: s.clockNote === 'behind' ? 'This display’s clock went backwards. The saved copy is timed from the latest time seen, so check the date and time.' : s.clockNote === 'differs' ? 'This display’s clock may be wrong: it differs from GitHub’s by more than five minutes.' : null,
      retentionMs: s.retentionMs,
    };
  }
}
