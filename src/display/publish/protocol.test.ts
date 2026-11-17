import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinanceDB } from '../../db';
import { dexieMeta, RemoteConflict, SyncEngine, type RemoteFile, type RemoteStore } from '../../lib/sync/engine';
import { buildProjection, ProjectionLimitError } from '../build';
import { appendDecision, loadGrantRows, setKillSwitch } from '../grantStore';
import { subjectOf } from '../grants';
import { readDisplayState } from '../readState';
import { addEvent, fresh, household, stubStorage, TODAY, TZ } from '../displayTestkit';
import { deriveDisplayKeys, idKeyOf, newPublisherId, openEnvelope, sealProjection, type DisplayKeys } from '../transport/envelope';
import { githubDisplayStore, type DisplayStore } from '../transport/githubFile';
import { createFakeGithub } from '../transport/githubTestkit';
import { nothingToDo, recordResult } from './runner';
import { diffProjections, publishNow, type PublishDeps, type PublishOptions } from './protocol';

/**
 * CS-2 publication protocol (design H.5a). Real devices (databases and the real SyncEngine), a fake GitHub with failure injection, and the
 * real encryption (key derivation shortened). Invented data only.
 */
vi.mock('../../lib/download', () => ({ downloadText: () => undefined }));
beforeEach(() => stubStorage());

const W = 'github_pat_WRITEKEYforTESTSonly0123456789';
const PASS = 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567';
const NOW = Date.parse('2026-11-09T15:00:00Z');
let counter = 0;

interface Dev { d: FinanceDB; id: string; synced: boolean; engine: SyncEngine; meta: ReturnType<typeof dexieMeta>; lastRevision: number }
interface World {
  gh: ReturnType<typeof createFakeGithub>;
  syncRemote: RemoteStore & { file: RemoteFile | null; puts: number };
  keys: DisplayKeys;
  store: DisplayStore;
}

function syncRemoteStore() {
  const r = {
    puts: 0, file: null as RemoteFile | null,
    async getFile() { return r.file ? { sha: r.file.sha, bytes: r.file.bytes.slice() } : null; },
    async putFile(bytes: Uint8Array, sha: string | undefined) {
      if ((r.file?.sha ?? undefined) !== sha) throw new RemoteConflict('stale');
      r.puts++;
      r.file = { sha: `sha${r.puts}`, bytes: bytes.slice() };
      return r.file.sha;
    },
    async headSha() { return r.file?.sha ?? null; },
  };
  return r;
}

async function world(): Promise<World> {
  const gh = createFakeGithub({ owner: 'someone', repo: 'display-demo', tokens: { [W]: { can: 'write' } } });
  return { gh, syncRemote: syncRemoteStore(), keys: await deriveDisplayKeys(PASS, 1000), store: githubDisplayStore({ owner: 'someone', repo: 'display-demo', token: W }, gh.fetch) };
}
const mkDev = (w: World, d: FinanceDB, synced = true): Dev => { const meta = dexieMeta(`pub-meta-${counter++}`); return { d, id: newPublisherId(), synced, engine: new SyncEngine(d, meta, w.syncRemote, 'a good passphrase'), meta, lastRevision: 0 }; };

/** Two synced devices holding the same household, with one shared event approved on A. */
async function twoDevices() {
  const w = await world();
  const { d } = await household();
  const A = mkDev(w, d);
  const swim = await addEvent(A.d, 'Swim meet', '2026-11-11', {}, 10 * 60);
  await A.engine.initialUpload();
  const B = mkDev(w, fresh());
  await B.engine.replaceFromRemote();
  return { w, A, B, swim };
}

function depsOf(w: World, dev: Dev, over: Partial<PublishDeps> = {}): PublishDeps {
  return {
    publisherId: dev.id, reviewed: true, lastRevision: dev.lastRevision, store: w.store, keys: w.keys, now: () => new Date(NOW), syncConfigured: dev.synced,
    runSync: async () => { try { await dev.engine.sync(); return { ok: true, sha: w.syncRemote.file?.sha ?? null }; } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; } },
    syncHeadSha: async () => w.syncRemote.file?.sha ?? null,
    readLocal: async () => {
      const state = await readDisplayState(dev.d, { today: TODAY, tz: TZ, nowMs: NOW, idKey: await idKeyOf(w.keys), revision: 0 });
      return { projection: await buildProjection(state.input), grantRecordIds: state.input.grantRecordIds };
    },
    grantIds: async () => (await loadGrantRows(dev.d)).map((r) => r.id as number),
    ...over,
  };
}
const publish = (w: World, dev: Dev, opts: PublishOptions = {}, over: Partial<PublishDeps> = {}) => publishNow(depsOf(w, dev, over), opts);
const remoteOf = async (w: World) => { const o = await openEnvelope(w.keys, w.gh.file!.bytes); if (!o.ok) throw new Error(o.message); return o; };
const titles = async (w: World) => (await remoteOf(w)).projection.entries.map((e) => e.title);
const approve = (d: FinanceDB, id: number) => appendDecision({ subject: subjectOf('event', id), decision: 'show' }, d);

describe('first publication and the quiet case', () => {
  it('nothing is published until the owner has reviewed the dataset', async () => {
    const { w, A, swim } = await twoDevices();
    await approve(A.d, swim);
    const r = await publish(w, A, {}, { reviewed: false });
    expect(r).toMatchObject({ outcome: 'blocked', code: 'first-review-needed' });
    expect(w.gh.putCount).toBe(0);
    expect(w.gh.requests.length).toBe(0); // not even a read
  });

  it('first publish creates revision 1; the file decrypts to exactly the approved items', async () => {
    const { w, A, swim } = await twoDevices();
    await approve(A.d, swim);
    const r = await publish(w, A);
    expect(r).toMatchObject({ outcome: 'published', revision: 1 });
    expect(w.gh.putCount).toBe(1);
    expect(await titles(w)).toEqual(['Swim meet']);
  });

  it('with nothing approved, a first publish is an empty (private-by-default) display, not an error', async () => {
    const { w, A } = await twoDevices();
    expect(await publish(w, A)).toMatchObject({ outcome: 'published', revision: 1 });
    expect((await remoteOf(w)).projection.counts).toEqual({ entries: 0, tasks: 0 });
  });

  it('publishing again with nothing changed writes nothing (it still READS the display file first)', async () => {
    const { w, A, swim } = await twoDevices();
    await approve(A.d, swim);
    await publish(w, A);
    const reads = w.gh.readCount;
    const r = await publish(w, A);
    expect(r).toMatchObject({ outcome: 'unchanged', revision: 1 });
    expect(w.gh.putCount).toBe(1);
    expect(w.gh.readCount).toBeGreaterThan(reads);
  });

  it('a visible change publishes the next revision', async () => {
    const { w, A, swim } = await twoDevices();
    await approve(A.d, swim);
    await publish(w, A);
    const dentist = await addEvent(A.d, 'Dentist', '2026-11-13', {}, 9 * 60);
    await approve(A.d, dentist);
    expect(await publish(w, A)).toMatchObject({ outcome: 'published', revision: 2 });
    expect((await titles(w)).sort()).toEqual(['Dentist', 'Swim meet']);
  });
});

describe('privacy decisions advance the published history even when nothing visible changes', () => {
  it('approving, superseding and revoking an event OUTSIDE the window each publish, with an unchanged content digest', async () => {
    const { w, A } = await twoDevices();
    const far = await addEvent(A.d, 'Summer trip', '2027-06-01', {}, 9 * 60); // far outside the 120-day window
    await publish(w, A);
    const digest0 = (await remoteOf(w)).projection.digest;
    const seen0 = (await remoteOf(w)).projection.grantsSeen;
    await approve(A.d, far);
    expect(await publish(w, A)).toMatchObject({ outcome: 'published', revision: 2 });
    await appendDecision({ subject: subjectOf('event', far), decision: 'show', level: 'busy' }, A.d); // supersedes
    expect(await publish(w, A)).toMatchObject({ outcome: 'published', revision: 3 });
    await appendDecision({ subject: subjectOf('event', far), decision: 'hide' }, A.d); // revoke
    expect(await publish(w, A)).toMatchObject({ outcome: 'published', revision: 4 });
    const after = (await remoteOf(w)).projection;
    expect(after.digest).toBe(digest0); // the visible content never changed
    expect(after.grantsSeen.length).toBe(seen0.length + 3);
  });

  it('a stale device that lacks the revocation, with the SAME visible schedule, is refused by the causal check (comparing content alone cannot bypass it)', async () => {
    const { w, A, B } = await twoDevices();
    const far = await addEvent(A.d, 'Summer trip', '2027-06-01', {}, 9 * 60);
    await approve(A.d, far);
    await A.engine.sync(); await B.engine.sync();
    expect(await publish(w, A)).toMatchObject({ outcome: 'published' });
    await appendDecision({ subject: subjectOf('event', far), decision: 'hide' }, A.d);
    expect(await publish(w, A)).toMatchObject({ outcome: 'published', revision: 2 });
    // B never received the revocation (its sync claims success but brings nothing: the case sync alone cannot catch)
    const b = await publish(w, B, {}, { runSync: async () => ({ ok: true, sha: w.syncRemote.file?.sha ?? null }) });
    expect(b).toMatchObject({ outcome: 'blocked', code: 'behind-history', missingDecisions: 1 });
    expect(w.gh.putCount).toBe(2); // B wrote nothing
    expect((await remoteOf(w)).revision).toBe(2);
  });

  it('a device that is behind syncs once more and then publishes normally', async () => {
    const { w, A, B, swim } = await twoDevices();
    await approve(A.d, swim);
    await publish(w, A);
    await appendDecision({ subject: subjectOf('event', swim), decision: 'hide' }, A.d);
    expect(await publish(w, A)).toMatchObject({ outcome: 'published', revision: 2 });
    // B's own sync round brings the revocation (this is the normal path: sync first, then publish)
    expect(await publish(w, B)).toMatchObject({ outcome: 'unchanged' });
    expect(await titles(w)).toEqual([]);
  });

  it('the hide-everything switch publishes an empty display and is part of the history', async () => {
    const { w, A, B, swim } = await twoDevices();
    await approve(A.d, swim);
    await publish(w, A);
    await setKillSwitch(true, A.d);
    expect(await publish(w, A)).toMatchObject({ outcome: 'published', revision: 2 });
    expect((await remoteOf(w)).projection.counts).toEqual({ entries: 0, tasks: 0 });
    // a stale device cannot bring the schedule back
    const b = await publish(w, B, {}, { runSync: async () => ({ ok: true, sha: w.syncRemote.file?.sha ?? null }) });
    expect(b).toMatchObject({ outcome: 'blocked', code: 'behind-history' });
    expect((await remoteOf(w)).projection.counts.entries).toBe(0);
  });
});

describe('fresh sync, re-check and failure handling', () => {
  it('a failed sync stops everything: nothing is read from or written to the display repository', async () => {
    const { w, A, swim } = await twoDevices();
    await approve(A.d, swim);
    const r = await publish(w, A, {}, { runSync: async () => ({ ok: false, message: 'GitHub did not accept the token.' }) });
    expect(r).toMatchObject({ outcome: 'blocked', code: 'sync-failed' });
    expect(r.outcome === 'blocked' && r.message).toContain('nothing was published');
    expect(w.gh.requests.length).toBe(0);
  });

  it('if the sync file moves during the publish, it starts again; if it never settles it stops', async () => {
    const { w, A, swim } = await twoDevices();
    await approve(A.d, swim);
    let n = 0;
    const flaky = await publish(w, A, {}, { syncHeadSha: async () => (n++ < 1 ? 'moved' : w.syncRemote.file?.sha ?? null) });
    expect(flaky).toMatchObject({ outcome: 'published' });
    const { w: w2, A: A2, swim: s2 } = await twoDevices();
    await approve(A2.d, s2);
    const never = await publish(w2, A2, {}, { syncHeadSha: async () => `moved-${Math.random()}` });
    expect(never).toMatchObject({ outcome: 'failed', code: 'coordination-failed' });
    expect(w2.gh.putCount).toBe(0);
  });

  it('if a privacy decision is written on this device while publishing, it starts again with the new decision', async () => {
    const { w, A, swim } = await twoDevices();
    await approve(A.d, swim);
    let wrote = false;
    const r = await publish(w, A, {}, {
      grantIds: async () => {
        if (!wrote) { wrote = true; await appendDecision({ subject: subjectOf('event', swim), decision: 'hide' }, A.d); }
        return (await loadGrantRows(A.d)).map((x) => x.id as number);
      },
    });
    expect(r).toMatchObject({ outcome: 'published' });
    expect(await titles(w)).toEqual([]); // the file carries the revocation, never the earlier payload
  });

  it('a display that is too large is refused with the reason and nothing is written', async () => {
    const { w, A } = await twoDevices();
    const r = await publish(w, A, {}, { readLocal: async () => { throw new ProjectionLimitError('Too many items for the display: 2001 (the limit is 2000). Nothing was cut; hide some items or shrink what is shared.'); } });
    expect(r).toMatchObject({ outcome: 'blocked', code: 'too-large' });
    expect(w.gh.putCount).toBe(0);
  });

  it.each([
    [401, 'unauthorized'], [403, 'forbidden'], [500, 'server'], [429, 'rate-limited'],
  ] as const)('a GitHub %i answer is reported as "%s" and leaves the file alone', async (status, code) => {
    const { w, A, swim } = await twoDevices();
    await approve(A.d, swim);
    await publish(w, A);
    const before = w.gh.file!.sha;
    await approve(A.d, await addEvent(A.d, 'Dentist', '2026-11-13', {}, 9 * 60));
    w.gh.failNext(status, status === 429 ? { 'retry-after': '30' } : undefined);
    const r = await publish(w, A);
    expect(r).toMatchObject({ outcome: 'failed', code });
    expect(w.gh.file!.sha).toBe(before);
  });

  it('a repository that is gone (or that the key cannot see) is reported as "not found"; a missing FILE in an existing repository is just "no display yet"', async () => {
    const { w, A, swim } = await twoDevices();
    await approve(A.d, swim);
    const gone = githubDisplayStore({ owner: 'someone', repo: 'was-deleted', token: W }, w.gh.fetch);
    expect(await publish(w, A, {}, { store: gone })).toMatchObject({ outcome: 'failed', code: 'not-found' });
    expect(w.gh.putCount).toBe(0);
    expect(await publish(w, A)).toMatchObject({ outcome: 'published', revision: 1 });
  });

  it('no network: reported as such, nothing changes', async () => {
    const { w, A, swim } = await twoDevices();
    await approve(A.d, swim);
    w.gh.networkDown = true;
    expect(await publish(w, A)).toMatchObject({ outcome: 'failed', code: 'network' });
    expect(w.gh.file).toBeUndefined();
  });
});

describe('two devices publishing at once', () => {
  it('the loser rereads the winner\'s file and repeats every check; it never retries its earlier payload', async () => {
    const { w, A, B, swim } = await twoDevices();
    await approve(A.d, swim);
    await publish(w, A); // revision 1
    const dentist = await addEvent(B.d, 'Dentist', '2026-11-13', {}, 9 * 60);
    await approve(B.d, dentist);
    const park = await addEvent(A.d, 'Park day', '2026-11-14', {}, 11 * 60);
    await approve(A.d, park);
    // A is about to write revision 2 from its own state. Just before the write, B (a real device: it syncs, builds, writes) wins.
    let raced = false;
    const racing: DisplayStore = { ...w.store, write: async (bytes, sha, message) => { if (!raced) { raced = true; await publish(w, B); } return w.store.write(bytes, sha, message); } };
    const r = await publish(w, A, {}, { store: racing });
    // A's write was refused (the file moved). A re-synced, reread B's file and found nothing left to add: no blind retry, no needless write.
    expect(r).toMatchObject({ outcome: 'unchanged', revision: 2 });
    expect((await titles(w)).sort()).toEqual(['Dentist', 'Park day', 'Swim meet']);
    expect(w.gh.putCount).toBe(2);
  });

  it('and when the loser DOES still have something to add, it publishes a NEW payload built from fresh state, on top of the winning revision', async () => {
    const { w, A, B, swim } = await twoDevices();
    await approve(A.d, swim);
    await publish(w, A);
    const dentist = await addEvent(B.d, 'Dentist', '2026-11-13', {}, 9 * 60);
    await approve(B.d, dentist);
    await approve(A.d, await addEvent(A.d, 'Park day', '2026-11-14', {}, 11 * 60));
    let raced = false;
    const racing: DisplayStore = {
      ...w.store,
      write: async (bytes, sha, message) => {
        if (!raced) { raced = true; await publish(w, B); await approve(A.d, await addEvent(A.d, 'Late addition', '2026-11-15', {}, 8 * 60)); }
        return w.store.write(bytes, sha, message);
      },
    };
    const r = await publish(w, A, {}, { store: racing });
    expect(r).toMatchObject({ outcome: 'published', revision: 3 });
    expect((await titles(w)).sort()).toEqual(['Dentist', 'Late addition', 'Park day', 'Swim meet']); // the first payload (without Dentist or Late addition) was not what got written
    expect(w.gh.putCount).toBe(3);
  });

  it('after a conflict the loser checks the winner\'s history: if the winner knows a revocation the loser lacks, it does not publish over it', async () => {
    const { w, A, B, swim } = await twoDevices();
    await approve(A.d, swim);
    await publish(w, A);
    await B.engine.sync();
    await appendDecision({ subject: subjectOf('event', swim), decision: 'hide' }, B.d); // B revokes (not yet synced anywhere)
    let raced = false;
    // A's sync is stubbed as "claims fresh", so A cannot learn of B's revocation by itself
    const stale = { runSync: async () => ({ ok: true as const, sha: w.syncRemote.file?.sha ?? null }) };
    const racing: DisplayStore = { ...w.store, write: async (bytes, sha, message) => { if (!raced) { raced = true; await publish(w, B); } return w.store.write(bytes, sha, message); } };
    await addEvent(A.d, 'Park day', '2026-11-14', {}, 11 * 60).then((id) => approve(A.d, id));
    const r = await publish(w, A, {}, { ...stale, store: racing });
    expect(r).toMatchObject({ outcome: 'blocked', code: 'behind-history' });
    expect(await titles(w)).toEqual([]); // B's revocation stands
  });

  it('a coordination failure is bounded and clearly reported', async () => {
    const { w, A, swim } = await twoDevices();
    await approve(A.d, swim);
    for (let i = 0; i < 6; i++) w.gh.failNext(409);
    const r = await publish(w, A);
    expect(r).toMatchObject({ outcome: 'failed', code: 'coordination-failed' });
    expect(w.gh.putCount).toBe(0);
    expect(w.gh.requests.filter((q) => q.method === 'PUT').length).toBeLessThanOrEqual(3);
  });
});

describe('unknown, unreadable and foreign files are never overwritten', () => {
  it('a file that cannot be read with this passphrase blocks publishing until the owner chooses to start a new file', async () => {
    const { w, A, swim } = await twoDevices();
    await approve(A.d, swim);
    w.gh.seed(new TextEncoder().encode('somebody else wrote this file, it is not ours'));
    const sha = w.gh.file!.sha;
    expect(await publish(w, A)).toMatchObject({ outcome: 'blocked', code: 'remote-unreadable' });
    expect(w.gh.file!.sha).toBe(sha);
    expect(await publish(w, A, { startNewFile: true })).toMatchObject({ outcome: 'published', revision: 1 });
    expect(await titles(w)).toEqual(['Swim meet']);
  });

  it('a file made with a different passphrase (a rotated one) is treated the same way', async () => {
    const { w, A, swim } = await twoDevices();
    await approve(A.d, swim);
    const other = await deriveDisplayKeys('ZZZZ-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567', 1000);
    const state = await readDisplayState(A.d, { today: TODAY, tz: TZ, nowMs: NOW, idKey: await idKeyOf(other), revision: 4 });
    w.gh.seed(await sealProjection(other, await buildProjection(state.input), { id: newPublisherId(), mode: 'sync' }));
    expect(await publish(w, A)).toMatchObject({ outcome: 'blocked', code: 'remote-unreadable' });
  });

  it('only the device that is the publisher may write when no sync is used; another device is refused until the owner takes over', async () => {
    const w = await world();
    const { d } = await household();
    const A = mkDev(w, d, false);
    const swim = await addEvent(A.d, 'Swim meet', '2026-11-11', {}, 10 * 60);
    await approve(A.d, swim);
    expect(await publish(w, A)).toMatchObject({ outcome: 'published' });
    expect((await remoteOf(w)).publisher).toEqual({ id: A.id, mode: 'single' });
    // a second device with the same data but a different identity
    const B = mkDev(w, A.d, false);
    expect(await publish(w, B)).toMatchObject({ outcome: 'blocked', code: 'publisher-mismatch' });
    expect(await publish(w, B, { takeOver: true })).toMatchObject({ outcome: 'published' });
    expect((await remoteOf(w)).publisher.id).toBe(B.id);
    // and now the first device is the one refused
    expect(await publish(w, A)).toMatchObject({ outcome: 'blocked', code: 'publisher-mismatch' });
  });

  it('an unsynced device cannot publish into a display that synced devices keep up to date', async () => {
    const { w, A, swim } = await twoDevices();
    await approve(A.d, swim);
    await publish(w, A);
    const lone = mkDev(w, A.d, false);
    expect(await publish(w, lone)).toMatchObject({ outcome: 'blocked', code: 'publisher-mismatch' });
  });
});

describe('restoring an older backup', () => {
  it('a restored device that lost decisions cannot publish; it can only after the owner reviews and accepts, with the differences listed', async () => {
    const w = await world();
    const { d } = await household();
    const A = mkDev(w, d, false);
    const swim = await addEvent(A.d, 'Swim meet', '2026-11-11', {}, 10 * 60);
    await approve(A.d, swim);
    const dentist = await addEvent(A.d, 'Dentist', '2026-11-13', {}, 9 * 60);
    await approve(A.d, dentist);
    await publish(w, A);
    // The owner revokes the dentist visit and it is published.
    await appendDecision({ subject: subjectOf('event', dentist), decision: 'hide' }, A.d);
    expect(await publish(w, A)).toMatchObject({ outcome: 'published', revision: 2 });
    // "Restore" an older state: the same household, but without the revocation record.
    const restored = mkDev(w, fresh(), false);
    restored.id = A.id;
    const rows = await A.d.moduleRecords.toArray();
    const lastGrant = [...rows].filter((r) => r.module === 'display').sort((a, b) => (a.id as number) - (b.id as number)).pop()!;
    await restored.d.moduleRecords.bulkAdd(rows.filter((r) => r.id !== lastGrant.id));
    await restored.d.contacts.bulkAdd(await A.d.contacts.toArray());
    const blocked = await publish(w, restored);
    expect(blocked).toMatchObject({ outcome: 'blocked', code: 'behind-history', missingDecisions: 1 });
    expect(await titles(w)).toEqual(['Swim meet']);
    // The review: what this device WOULD publish differs from what is published, and the dentist visit would come back.
    const local = await depsOf(w, restored).readLocal();
    const diff = diffProjections((await remoteOf(w)).projection, local.projection);
    expect(diff.added).toEqual(['Dentist (2026-11-13)']);
    expect(diff.removed).toEqual([]);
    // Only an explicit acceptance publishes.
    expect(await publish(w, restored, { acceptHistoryReset: true })).toMatchObject({ outcome: 'published', revision: 3 });
    expect((await titles(w)).sort()).toEqual(['Dentist', 'Swim meet']);
  });
});

describe('revision counter', () => {
  it('never goes backwards: it follows the file and the highest revision this device knows', async () => {
    const { w, A, swim } = await twoDevices();
    await approve(A.d, swim);
    A.lastRevision = 41;
    expect(await publish(w, A)).toMatchObject({ outcome: 'published', revision: 42 });
    A.lastRevision = 3;
    await approve(A.d, await addEvent(A.d, 'Dentist', '2026-11-13', {}, 9 * 60));
    expect(await publish(w, A)).toMatchObject({ outcome: 'published', revision: 43 });
  });
});

describe('remote-only changes are noticed by the quiet re-check (Device A idle, Device B changes and syncs but does not publish)', () => {
  /** What the app's quiet trigger asks before skipping a run. A's sync metadata says which sync-file version it last merged. */
  const quiet = (w: World, A: Dev, over: Partial<PublishDeps> = {}) =>
    nothingToDo(depsOf(w, A, { syncUpToDate: async () => (w.syncRemote.file?.sha ?? null) === ((await A.meta.get<string>('remoteSha')) ?? null), ...over }));
  const published = async (w: World, A: Dev) => { const r = await publish(w, A); if (r.outcome !== 'published') throw new Error('setup'); recordResult(r, 'manual'); };

  it('nothing changed anywhere: the quiet check skips the run', async () => {
    const { w, A, swim } = await twoDevices();
    await approve(A.d, swim);
    await published(w, A);
    expect(await quiet(w, A)).toBe(true);
  });

  it('B edits an approved event and syncs: A (no local changes, automatic sync off) is told to do a full run, and then publishes the updated projection', async () => {
    const { w, A, B, swim } = await twoDevices();
    await approve(A.d, swim);
    await published(w, A);
    await B.engine.sync();
    const row = (await B.d.moduleRecords.get(swim))!;
    await B.d.moduleRecords.update(swim, { data: { ...row.data, title: 'Swim meet (moved)' } } as never);
    await B.engine.sync(); // B's change is in the sync repository; B never publishes
    expect(w.gh.putCount).toBe(1);
    expect(await quiet(w, A)).toBe(false); // the old shortcut said true here, forever
    const r = await publish(w, A); // the full protocol: fresh sync, causal check, write
    expect(r).toMatchObject({ outcome: 'published', revision: 2 });
    expect(await titles(w)).toEqual(['Swim meet (moved)']);
  });

  it('B revokes and syncs, without publishing: A notices and the revocation reaches the display file', async () => {
    const { w, A, B, swim } = await twoDevices();
    await approve(A.d, swim);
    await published(w, A);
    await B.engine.sync();
    await appendDecision({ subject: subjectOf('event', swim), decision: 'hide' }, B.d);
    await B.engine.sync();
    expect(await quiet(w, A)).toBe(false);
    expect(await publish(w, A)).toMatchObject({ outcome: 'published', revision: 2 });
    expect(await titles(w)).toEqual([]);
    // once A has caught up and published, the shortcut applies again
    await A.engine.sync();
    recordResult((await publish(w, A)) as never, 'manual');
    expect(await quiet(w, A)).toBe(true);
  });

  it('without a sync-state check the shortcut would miss it (the check is what matters)', async () => {
    const { w, A, B, swim } = await twoDevices();
    await approve(A.d, swim);
    await published(w, A);
    await B.engine.sync();
    await appendDecision({ subject: subjectOf('event', swim), decision: 'hide' }, B.d);
    await B.engine.sync();
    expect(await quiet(w, A, { syncUpToDate: undefined })).toBe(true);
  });
});
