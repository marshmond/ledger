/**
 * CS-2: the publication protocol (CS-0.1 design, section H.5a). One function, `publishNow`, with every outside thing it needs passed in, so
 * the tests can run it against a fake GitHub and fake sync with failures injected.
 *
 * Every publication, in order. ANY failed check stops with a plain message and leaves the display file as it was:
 *   0. Publishing is set up on this device and the owner has reviewed the full dataset.
 *   1. (If Ledger sync is set up) a FULL sync round now. If it cannot finish, stop. Note the sync file's version S.
 *   2. Build the projection from one consistent local read, with the full list of privacy decisions (`grantsSeen`) and the content digest.
 *   3. Read the current display file. If it exists but cannot be decrypted or validated, stop: it is never overwritten unless the owner chose
 *      "start a new display file". If another device is the only publisher, or this device is not synced but the file expects synced
 *      devices, stop.
 *      If BOTH the content and the decision history equal the file's, nothing is written ("unchanged").
 *   4. CAUSAL CHECK: every decision the file's last publisher had seen must be one this device holds. If not, sync once more and re-check;
 *      if still missing, stop ("another device has newer privacy choices"). A restored older backup lands here.
 *   5. RE-CHECK: the sync file is still at S, and this device's decisions have not changed since step 2. If not, start again (at most three
 *      rounds).
 *   6. COMPARE-AND-SWAP: write with the file's version. If someone else wrote first (409 or 422), start again from step 1 with fresh state;
 *      the earlier payload is never retried.
 * Success is reported only after GitHub confirms the write.
 */
import { compareHistory } from '../grants';
import type { DisplayProjection } from '../contract';
import { openEnvelope, sealProjection, type DisplayKeys, type PublisherInfo } from '../transport/envelope';
import { DisplayStoreError, type DisplayStore, type ServerInfo } from '../transport/githubFile';

export const MAX_ROUNDS = 3;

export interface LocalRead { projection: DisplayProjection; grantRecordIds: number[] }
export type SyncResult = { ok: true; sha: string | null } | { ok: false; message: string };

export interface PublishDeps {
  publisherId: string;
  reviewed: boolean;
  lastRevision: number;
  store: DisplayStore;
  keys: DisplayKeys;
  now(): Date;
  syncConfigured: boolean;
  runSync(): Promise<SyncResult>;
  syncHeadSha(): Promise<string | null>;
  /** Cheap and optional: is the sync file still the version this device last merged? False means another device synced something this one has not seen. */
  syncUpToDate?(): Promise<boolean>;
  /** One consistent read of everything that goes into a projection. Throws a plain-message Error when a size limit is exceeded. */
  readLocal(): Promise<LocalRead>;
  /** A quick re-read of the ids of every privacy decision on this device. */
  grantIds(): Promise<number[]>;
}
export interface PublishOptions {
  /** Owner chose "start a new display file": a file that cannot be read may be replaced. */
  startNewFile?: boolean;
  /** Owner reviewed what differs after a restore and accepted this device's state: the causal check is skipped once. */
  acceptHistoryReset?: boolean;
  /** Owner made this device the publisher. */
  takeOver?: boolean;
}

export type PublishCode =
  | 'not-configured' | 'first-review-needed' | 'sync-failed' | 'too-large' | 'remote-unreadable' | 'remote-newer' | 'behind-history' | 'publisher-mismatch'
  | 'coordination-failed' | 'unauthorized' | 'forbidden' | 'not-found' | 'rate-limited' | 'network' | 'server' | 'bad-response' | 'internal';

export type PublishResult =
  | { outcome: 'published'; revision: number; sha: string; local: LocalRead; info: ServerInfo }
  | { outcome: 'unchanged'; revision: number; sha: string; local: LocalRead }
  | { outcome: 'blocked' | 'failed'; code: PublishCode; message: string; missingDecisions?: number; retryAfterSeconds?: number };

const stop = (outcome: 'blocked' | 'failed', code: PublishCode, message: string, extra: { missingDecisions?: number; retryAfterSeconds?: number } = {}): PublishResult => ({ outcome, code, message, ...extra });
const sameNumbers = (a: number[], b: number[]) => a.length === b.length && [...a].sort((x, y) => x - y).every((x, i) => x === [...b].sort((p, q) => p - q)[i]);
const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Everything about a projection that a tablet would show or a publisher must keep, except the counter and the timestamp. */
export const sameContent = (a: DisplayProjection, b: DisplayProjection) =>
  a.digest === b.digest && a.household.label === b.household.label && a.prefs.weekStart === b.prefs.weekStart && sameList(a.grantsSeen, b.grantsSeen);

export async function publishNow(deps: PublishDeps, opts: PublishOptions = {}): Promise<PublishResult> {
  if (!deps.reviewed) return stop('blocked', 'first-review-needed', 'Review what will be shown on the display first. Nothing has been published.');
  const mode: PublisherInfo['mode'] = deps.syncConfigured ? 'sync' : 'single';
  let askedForExtraSync = false;

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      // 1. fresh against the sync repository
      let syncSha: string | null = null;
      if (deps.syncConfigured) {
        const s = await deps.runSync();
        if (!s.ok) return stop('blocked', 'sync-failed', `Could not confirm this device is up to date, so nothing was published. ${s.message}`);
        syncSha = s.sha;
      }

      // 2. one consistent local read
      let local: LocalRead;
      try { local = await deps.readLocal(); } catch (e) {
        return stop('blocked', 'too-large', e instanceof Error ? e.message : 'The display data could not be built.');
      }

      // 3. the current display file
      const read = await deps.store.read();
      let remote: Extract<Awaited<ReturnType<typeof openEnvelope>>, { ok: true }> | null = null;
      let remoteSha: string | null = null;
      if (read.kind === 'file') {
        remoteSha = read.file.sha;
        const opened = await openEnvelope(deps.keys, read.file.bytes);
        if (opened.ok) remote = opened;
        else if (!opts.startNewFile) {
          return stop('blocked', opened.code === 'needs-newer-reader' || opened.code === 'unsupported-version' ? 'remote-newer' : 'remote-unreadable',
            `The file already in the display repository cannot be read with this passphrase (${opened.message}) Nothing was changed. If you want to replace it, choose "Start a new display file".`);
        }
      }
      if (remote && !opts.takeOver) {
        if (remote.publisher.mode === 'single' && remote.publisher.id !== deps.publisherId) {
          return stop('blocked', 'publisher-mismatch', 'Another device is set up as the publisher for this display. On this device, choose "Make this device the publisher" if you want to take over. Nothing was changed.');
        }
        if (remote.publisher.mode === 'sync' && !deps.syncConfigured) {
          return stop('blocked', 'publisher-mismatch', 'This display is kept up to date by devices that use Ledger sync, and this device does not. Set up sync on this device, or make it the publisher. Nothing was changed.');
        }
      }
      if (remote && remote.publisher.mode === mode && sameContent(remote.projection, local.projection) && (mode === 'sync' || remote.publisher.id === deps.publisherId)) {
        return { outcome: 'unchanged', revision: remote.revision, sha: remoteSha!, local };
      }

      // 4. causal check
      if (remote && !opts.acceptHistoryReset) {
        const { missing } = compareHistory(remote.projection.grantsSeen, local.projection.grantsSeen);
        if (missing.length) {
          if (deps.syncConfigured && !askedForExtraSync) { askedForExtraSync = true; continue; } // one more sync round, then look again
          return stop('blocked', 'behind-history', 'Another device has newer privacy choices than this one, so nothing was published. Let Ledger sync finish on this device and try again. If this device was restored from an older backup, review it under "Recovery".', { missingDecisions: missing.length });
        }
      }

      // 5. re-check
      if (deps.syncConfigured && (await deps.syncHeadSha()) !== syncSha) continue;
      if (!sameNumbers(await deps.grantIds(), local.grantRecordIds)) continue;

      // 6. compare-and-swap
      const revision = Math.max(remote?.revision ?? 0, deps.lastRevision) + 1;
      const projection: DisplayProjection = { ...local.projection, revision, publishedAt: deps.now().toISOString() };
      let bytes: Uint8Array;
      try { bytes = await sealProjection(deps.keys, projection, { id: deps.publisherId, mode }); } catch (e) {
        return stop('failed', 'internal', e instanceof Error ? e.message : 'The display file could not be prepared.');
      }
      try {
        const wrote = await deps.store.write(bytes, remoteSha, `display ${revision}`);
        return { outcome: 'published', revision, sha: wrote.sha, local: { ...local, projection }, info: wrote.info };
      } catch (e) {
        if (e instanceof DisplayStoreError && e.code === 'conflict') continue; // someone else wrote first: read their file and check everything again
        throw e;
      }
    }
    return stop('failed', 'coordination-failed', 'Another device kept changing the display at the same time, so this update was not published. Try Publish now again in a minute.');
  } catch (e) {
    if (e instanceof DisplayStoreError) {
      const code: PublishCode = e.code === 'conflict' ? 'coordination-failed' : e.code === 'too-large' ? 'too-large' : e.code;
      return stop('failed', code, e.message, { retryAfterSeconds: e.retryAfterSeconds });
    }
    return stop('failed', 'internal', e instanceof Error ? e.message : 'Publishing failed.');
  }
}

/** Plain-words differences between the published file and what this device would publish (used by the restore recovery review). */
export function diffProjections(published: DisplayProjection, local: DisplayProjection): { added: string[]; removed: string[] } {
  const label = (e: { id: string; title: string; start: { date: string } }) => `${e.title} (${e.start.date})`;
  const pub = new Map([...published.entries, ...published.tasks.map((t) => ({ ...t, start: { date: t.due?.date ?? 'no date' } }))].map((e) => [e.id, label(e)]));
  const loc = new Map([...local.entries, ...local.tasks.map((t) => ({ ...t, start: { date: t.due?.date ?? 'no date' } }))].map((e) => [e.id, label(e)]));
  return { added: [...loc].filter(([id]) => !pub.has(id)).map(([, l]) => l), removed: [...pub].filter(([id]) => !loc.has(id)).map(([, l]) => l) };
}
