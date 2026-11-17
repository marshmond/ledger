import { describe, expect, it } from 'vitest';
import { openEnvelope, sealProjection } from '../display/transport/envelope';
import { keysOf, sample } from '../display/transport/envelopeTestkit';
import { githubDisplayStore } from '../display/transport/githubFile';
import { createFakeGithub } from '../display/transport/githubTestkit';
import { encodePairing } from '../display/transport/pairing';
import { backoffMs, freshnessOf, HOUR, MINUTE, RETENTION_CHOICES } from './freshness';
import { idbKv, memoryKv } from './storage';
import { Tablet } from './retrieval';

/** CS-2 retrieval: the tablet's pairing, polling, validation, saved copy, freshness and expiry, against a fake GitHub with failures injected. Invented data only. */
const PASS = 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567';
const OTHER = 'ZZZZ-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567';
const R = 'github_pat_READKEYforTESTSonly01234567890';
const PUB = { id: '0123456789abcdef', mode: 'sync' as const };
const T0 = Date.parse('2026-11-09T15:00:00Z');
const DAY = 24 * HOUR;

async function setup(over: { pass?: string } = {}) {
  const gh = createFakeGithub({ owner: 'someone', repo: 'display-demo', tokens: { [R]: { can: 'read' } } });
  const publisherKeys = await keysOf(PASS);
  const clock = { t: T0 };
  // GitHub's clock follows the tablet's unless a test says otherwise (assign a number to set it, null to follow again)
  let override: number | null = null;
  Object.defineProperty(gh, 'clock', { get: () => override ?? clock.t, set: (v: number | null) => { override = v; }, configurable: true });
  const kv = memoryKv();
  const tablet = new Tablet({ kv, now: () => clock.t, iterations: 1000, storeFor: (p) => githubDisplayStore(p, gh.fetch) });
  const publish = async (revision: number, over2: Parameters<typeof sample>[1] = {}) => gh.seed(await sealProjection(publisherKeys, await sample(publisherKeys, over2, revision), PUB));
  const code = encodePairing({ owner: 'someone', repo: 'display-demo', token: R, passphrase: over.pass ?? PASS });
  return { gh, clock, kv, tablet, publish, code, publisherKeys };
}

describe('pairing and a valid snapshot', () => {
  it('pairs, fetches, decrypts, validates and reports the diagnostics (counts and times only)', async () => {
    const t = await setup();
    await t.publish(7);
    const r = await t.tablet.pair(t.code);
    expect(r.ok).toBe(true);
    const v = (r as { view: Awaited<ReturnType<Tablet['view']>> }).view;
    expect(v).toMatchObject({ paired: true, repo: 'someone/display-demo', connection: 'connected', validation: 'ok', hasCopy: true, revision: 7, projectionVersion: 1, counts: { entries: 1, tasks: 1 }, problem: null, clockWarning: null });
    expect(v.freshness.state).toBe('recent');
    expect(v.lastSuccessAt).toBe(T0);
    expect(JSON.stringify(v)).not.toMatch(/Piano|Library|Sam|Example/); // the diagnostics never carry a title or a name
    const p = await t.tablet.projection();
    expect(p?.entries.map((e) => e.title)).toEqual(['Piano with Ms Example']);
  });

  it('stores the display key as a non-extractable key and keeps the passphrase out of storage; the saved copy is still encrypted', async () => {
    const t = await setup();
    await t.publish(1);
    await t.tablet.pair(t.code);
    const pairing = await t.kv.get<{ key: CryptoKey; token: string }>('pairing');
    expect(pairing!.key.extractable).toBe(false);
    expect(pairing!.key.type).toBe('secret');
    expect(JSON.stringify(await t.kv.get('pairing'))).not.toContain(PASS);
    const cache = await t.kv.get<{ bytes: Uint8Array }>('cache');
    expect(new TextDecoder('latin1').decode(cache!.bytes)).not.toContain('Piano');
  });

  it('a bad pairing code stores nothing and leaves an earlier pairing alone', async () => {
    const t = await setup();
    await t.publish(1);
    await t.tablet.pair(t.code);
    const r = await t.tablet.pair('LDPAIR1.garbage.00000000');
    expect(r.ok).toBe(false);
    expect((await t.tablet.view()).paired).toBe(true);
  });

  it('before pairing it is simply "not paired" and asks GitHub nothing', async () => {
    const t = await setup();
    const v = await t.tablet.checkNow(true);
    expect(v).toMatchObject({ paired: false, connection: 'never', hasCopy: false });
    expect(t.gh.requests.length).toBe(0);
  });

  it('a repository with no file yet is "connected, nothing published"', async () => {
    const t = await setup();
    const r = await t.tablet.pair(t.code);
    expect(r.ok && r.view).toMatchObject({ connection: 'connected', hasCopy: false, problem: { code: 'no-file' } });
  });
});

describe('what it refuses, and what it keeps when it refuses', () => {
  it('a wrong passphrase: nothing saved, and the message says to pair again', async () => {
    const t = await setup({ pass: OTHER });
    await t.publish(1);
    const r = await t.tablet.pair(t.code);
    expect(r.ok && r.view).toMatchObject({ hasCopy: false, validation: 'failed', problem: { code: 'mismatch' } });
    expect(await t.tablet.projection()).toBeNull();
  });

  it('a file that stops matching later leaves the last good copy on screen and reports it', async () => {
    const t = await setup();
    await t.publish(1);
    await t.tablet.pair(t.code);
    const other = await keysOf(OTHER);
    t.gh.seed(await sealProjection(other, await sample(other, {}, 2), PUB));
    t.clock.t += 5 * MINUTE;
    const v = await t.tablet.checkNow(true);
    expect(v).toMatchObject({ hasCopy: true, revision: 1, validation: 'failed', problem: { code: 'mismatch' } });
    expect(await t.tablet.projection()).not.toBeNull();
    expect(v.lastSuccessAt).toBe(T0); // a refused file is not a successful refresh
  });

  it('a file that is not a display file at all is ignored', async () => {
    const t = await setup();
    await t.publish(1);
    await t.tablet.pair(t.code);
    t.gh.seed(new TextEncoder().encode('<html>an error page that was saved by mistake</html>'));
    const v = await t.tablet.checkNow(true);
    expect(v).toMatchObject({ revision: 1, validation: 'failed', problem: { code: 'invalid' } });
  });

  it('a file from a newer format asks for an update and changes nothing', async () => {
    const t = await setup();
    await t.publish(1);
    await t.tablet.pair(t.code);
    const bytes = await sealProjection(t.publisherKeys, await sample(t.publisherKeys, {}, 2), PUB);
    bytes[4] = 2; // a future envelope version
    t.gh.seed(bytes);
    const v = await t.tablet.checkNow(true);
    expect(v).toMatchObject({ revision: 1, problem: { code: 'needs-update' } });
  });

  it('rollback: an older revision, or the same revision with different bytes, is ignored', async () => {
    const t = await setup();
    await t.publish(5);
    await t.tablet.pair(t.code);
    await t.publish(3);
    expect(await t.tablet.checkNow(true)).toMatchObject({ revision: 5, validation: 'failed', problem: { code: 'rollback' } });
    await t.publish(5); // same revision number, different bytes
    expect(await t.tablet.checkNow(true)).toMatchObject({ revision: 5, problem: { code: 'rollback' } });
    await t.publish(6);
    expect(await t.tablet.checkNow(true)).toMatchObject({ revision: 6, validation: 'ok', problem: null });
  });
});

describe('polling, conditional requests and replacing the saved copy', () => {
  it('an unchanged file is answered "not modified" and the saved copy is not rewritten', async () => {
    const t = await setup();
    await t.publish(1);
    await t.tablet.pair(t.code);
    t.clock.t += 3 * MINUTE;
    const v = await t.tablet.checkNow();
    expect(v).toMatchObject({ connection: 'connected', revision: 1 });
    expect(v.lastSuccessAt).toBe(T0 + 3 * MINUTE);
    expect(t.gh.requests.at(-1)?.ifNoneMatch).toBeTruthy();
  });

  it('a new revision replaces the saved copy in one step', async () => {
    const t = await setup();
    await t.publish(1);
    await t.tablet.pair(t.code);
    const key = await keysOf(PASS);
    t.gh.seed(await sealProjection(key, await sample(key, { events: [] }, 2), PUB));
    t.clock.t += 3 * MINUTE;
    const v = await t.tablet.checkNow();
    expect(v).toMatchObject({ revision: 2, counts: { entries: 0, tasks: 1 }, validation: 'ok' });
    const o = await openEnvelope({ master: (await t.kv.get<{ key: CryptoKey }>('pairing'))!.key }, (await t.kv.get<{ bytes: Uint8Array }>('cache'))!.bytes);
    expect(o.ok && o.revision).toBe(2);
  });

  it('no network: the saved copy stays, the check backs off (3, 6, 12, 30 minutes), and Check now still tries', async () => {
    const t = await setup();
    await t.publish(1);
    await t.tablet.pair(t.code);
    t.gh.networkDown = true;
    t.clock.t += 3 * MINUTE;
    const v1 = await t.tablet.checkNow();
    expect(v1).toMatchObject({ connection: 'disconnected', hasCopy: true, problem: { code: 'network' } });
    const calls = t.gh.requests.length;
    t.clock.t += MINUTE; // inside the back-off
    await t.tablet.checkNow();
    expect(t.gh.requests.length).toBe(calls);
    await t.tablet.checkNow(true); // the button ignores the wait
    expect(t.gh.requests.length).toBe(calls + 1);
    expect([1, 2, 3, 4, 5].map(backoffMs)).toEqual([3, 6, 12, 30, 30].map((m) => m * MINUTE));
  });

  it('reconnecting recovers: the problem clears and a newer file is picked up', async () => {
    const t = await setup();
    await t.publish(1);
    await t.tablet.pair(t.code);
    t.gh.networkDown = true;
    t.clock.t += 10 * MINUTE;
    await t.tablet.checkNow(true);
    t.gh.networkDown = false;
    await t.publish(2);
    t.clock.t += MINUTE;
    const v = await t.tablet.checkNow(true);
    expect(v).toMatchObject({ connection: 'connected', revision: 2, problem: null });
    expect(v.freshness.state).toBe('recent');
  });

  it('rate limiting waits for the time GitHub gave', async () => {
    const t = await setup();
    await t.publish(1);
    await t.tablet.pair(t.code);
    t.gh.failNext(429, { 'retry-after': '600' });
    t.clock.t += 3 * MINUTE;
    expect((await t.tablet.checkNow()).problem?.code).toBe('rate-limited');
    const n = t.gh.requests.length;
    t.clock.t += 5 * MINUTE;
    await t.tablet.checkNow();
    expect(t.gh.requests.length).toBe(n); // still inside the 10 minutes
    t.clock.t += 6 * MINUTE;
    await t.tablet.checkNow();
    expect(t.gh.requests.length).toBe(n + 1);
  });
});

describe('expired and revoked keys', () => {
  it('a key that stops working keeps the saved copy at first, then (after ten minutes of refusals) deletes it and says it was disconnected', async () => {
    const t = await setup();
    await t.publish(1);
    await t.tablet.pair(t.code);
    t.gh.tokens[R].expired = true; // or the owner deleted it in GitHub
    t.clock.t += 3 * MINUTE;
    const first = await t.tablet.checkNow();
    expect(first).toMatchObject({ connection: 'disconnected', hasCopy: true, problem: { code: 'access-refused' } });
    t.clock.t += 6 * MINUTE;
    expect((await t.tablet.checkNow(true)).hasCopy).toBe(true); // 6 minutes: still inside the ten
    t.clock.t += 6 * MINUTE;
    const later = await t.tablet.checkNow(true);
    expect(later).toMatchObject({ hasCopy: false, problem: { code: 'disconnected' } });
    expect(await t.tablet.projection()).toBeNull();
  });

  it('one refusal followed by a good answer is not a revocation', async () => {
    const t = await setup();
    await t.publish(1);
    await t.tablet.pair(t.code);
    t.gh.failNext(401);
    t.clock.t += 3 * MINUTE;
    await t.tablet.checkNow();
    t.clock.t += 20 * MINUTE;
    const v = await t.tablet.checkNow(true);
    expect(v).toMatchObject({ hasCopy: true, connection: 'connected', problem: null });
  });

  it('a deleted repository is treated like a refusal', async () => {
    const t = await setup();
    await t.publish(1);
    await t.tablet.pair(t.code);
    const gone = new Tablet({ kv: t.kv, now: () => t.clock.t, iterations: 1000, storeFor: (p) => githubDisplayStore({ ...p, repo: 'was-deleted' }, t.gh.fetch) });
    t.clock.t += 3 * MINUTE;
    expect((await gone.checkNow()).problem?.code).toBe('access-refused');
  });
});

describe('offline expiry, freshness and the clock', () => {
  it('the five freshness states', () => {
    const keep = 72 * HOUR;
    const at = (age: number) => freshnessOf(T0, T0 + age, keep).state;
    expect(freshnessOf(null, T0, keep).state).toBe('never');
    expect([at(MINUTE), at(14 * MINUTE), at(16 * MINUTE), at(119 * MINUTE), at(3 * HOUR), at(23 * HOUR), at(25 * HOUR), at(71 * HOUR), at(72 * HOUR), at(100 * HOUR)])
      .toEqual(['recent', 'recent', 'delayed', 'delayed', 'stale', 'stale', 'extended-outage', 'extended-outage', 'expired', 'expired']);
  });

  it('offline for longer than the keep time deletes the saved copy before anything is drawn; the choices are 24 hours, 3 days and 7 days', async () => {
    expect(RETENTION_CHOICES.map((c) => c.ms)).toEqual([DAY, 3 * DAY, 7 * DAY]);
    const t = await setup();
    await t.publish(1);
    await t.tablet.pair(t.code);
    t.gh.networkDown = true;
    t.clock.t = T0 + 2 * DAY;
    const mid = await t.tablet.tick();
    expect(mid).toMatchObject({ hasCopy: true, freshness: { state: 'extended-outage' } });
    expect(await t.tablet.projection()).not.toBeNull();
    t.clock.t = T0 + 3 * DAY + MINUTE;
    const end = await t.tablet.tick();
    expect(end).toMatchObject({ hasCopy: false, freshness: { state: 'expired' }, problem: { code: 'disconnected' } });
    expect(await t.tablet.projection()).toBeNull();
    expect(await t.kv.get('cache')).toBeUndefined();
    expect((await t.tablet.view()).paired).toBe(true); // paired still: reconnecting restores it
  });

  it('even if the tick never runs, the saved copy is not handed out once it is too old', async () => {
    const t = await setup();
    await t.publish(1);
    await t.tablet.pair(t.code);
    t.clock.t = T0 + 4 * DAY;
    expect(await t.tablet.projection()).toBeNull();
  });

  it('the shorter and longer keep times are honoured', async () => {
    const t = await setup();
    await t.publish(1);
    await t.tablet.pair(t.code);
    await t.tablet.setRetention(DAY);
    t.clock.t = T0 + DAY + MINUTE;
    expect((await t.tablet.tick()).hasCopy).toBe(false);
    const u = await setup();
    await u.publish(1);
    await u.tablet.pair(u.code);
    await u.tablet.setRetention(7 * DAY);
    u.clock.t = T0 + 5 * DAY;
    expect((await u.tablet.tick()).hasCopy).toBe(true);
    await expect(u.tablet.setRetention(5 * DAY)).rejects.toThrow();
  });

  it('a clock set back does not give the saved copy a longer life, and a warning is shown', async () => {
    const t = await setup();
    await t.publish(1);
    await t.tablet.pair(t.code);
    await t.tablet.setRetention(DAY);
    t.gh.networkDown = true;
    t.clock.t = T0 + 20 * HOUR;
    await t.tablet.tick();
    t.clock.t = T0 + 2 * HOUR; // someone sets the clock back
    const v = await t.tablet.tick();
    expect(v.clockWarning).toMatch(/went backwards/);
    t.clock.t = T0 + 5 * HOUR; // real elapsed time 5 hours, but 20 hours were already seen
    expect((await t.tablet.tick()).freshness.ageMs).toBeGreaterThanOrEqual(20 * HOUR);
    t.clock.t = T0 + 20 * HOUR + 5 * MINUTE; // ... and the 24 hours run out from the latest time ever seen
    t.clock.t = T0 + 30 * HOUR;
    expect((await t.tablet.tick()).hasCopy).toBe(false);
  });

  it('a tablet clock that disagrees with GitHub by more than five minutes shows a warning (when the browser lets the page read the time)', async () => {
    const t = await setup();
    await t.publish(1);
    t.gh.clock = T0 + HOUR;
    const r = await t.tablet.pair(t.code);
    expect(r.ok && r.view.clockWarning).toMatch(/may be wrong/);
    const u = await setup();
    await u.publish(1);
    u.gh.clock = T0 + 2 * MINUTE; // within five minutes: no warning
    const ok = await u.tablet.pair(u.code);
    expect(ok.ok && ok.view.clockWarning).toBeNull();
  });
});

describe('forgetting a display', () => {
  it('deletes the key, the pairing, the saved copy and the history; nothing is left to read', async () => {
    const t = await setup();
    await t.publish(1);
    await t.tablet.pair(t.code);
    const v = await t.tablet.forget();
    expect(v).toMatchObject({ paired: false, hasCopy: false, repo: null, counts: null, lastSuccessAt: null });
    for (const k of ['pairing', 'cache', 'state']) expect(await t.kv.get(k)).toBeUndefined();
    expect(await t.tablet.projection()).toBeNull();
  });

  it('pairing again with a different code replaces the saved copy', async () => {
    const t = await setup();
    await t.publish(4);
    await t.tablet.pair(t.code);
    const b = await setup({ pass: OTHER });
    t.kv.set('x', 1);
    const r = await t.tablet.pair(b.code); // the same fake repository, but a code made with another passphrase
    expect(r.ok && r.view).toMatchObject({ hasCopy: false, validation: 'failed' });
    expect(await t.kv.get('x')).toBeUndefined();
  });
});

describe('the storage wrapper', () => {
  it('stores, reads, deletes and clears (IndexedDB)', async () => {
    const kv = idbKv(`tablet-test-${Math.random()}`);
    await kv.set('a', { n: 1 });
    await kv.set('b', new Uint8Array([1, 2]));
    expect(await kv.get('a')).toEqual({ n: 1 });
    expect(Array.from((await kv.get<Uint8Array>('b'))!)).toEqual([1, 2]);
    await kv.del('a');
    expect(await kv.get('a')).toBeUndefined();
    await kv.clear();
    expect(await kv.get('b')).toBeUndefined();
  });
});
