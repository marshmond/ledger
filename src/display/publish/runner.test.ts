import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import { collectPreferences, PREFERENCE_KEYS } from '../../lib/backupFile';
import { ensureCalendarSeed } from '../../modules/calendar/data';
import { loadBaseline } from '../compat';
import { appendDecision } from '../grantStore';
import { subjectOf } from '../grants';
import { addEvent, stubStorage } from '../displayTestkit';
import { deriveDisplayKeys, generatePassphrase, openEnvelope } from '../transport/envelope';
import { githubDisplayStore } from '../transport/githubFile';
import { createFakeGithub } from '../transport/githubTestkit';
import {
  ACTIVITY_KEY, blankActivity, CONFIG_KEY, clearPublisher, expiryOf, logAttempt, LOG_KEEP, newPublisher, patchActivity, readActivity, readPublisher, updatePublisher, writePublisher,
} from './config';
import { changePassphrase, confirmFirstPublication, connectPublisher, prepareReview, recordResult, requestPublish } from './runner';
import { revocationOf, statusOf } from './status';

/** CS-2 publisher settings, status wording, credential handling and the owner's set-up flow (connect, review, first publication, rotation). Fake GitHub; invented data. */
const W = 'github_pat_WRITEKEYforTESTSonly0123456789';
const R = 'github_pat_READKEYforTESTSonly01234567890';
const PASS = 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567';
const gh = () => createFakeGithub({ owner: 'someone', repo: 'display-demo', tokens: { [W]: { can: 'write' }, [R]: { can: 'read' } } });
const storeOf = (g: ReturnType<typeof gh>, token = W) => githubDisplayStore({ owner: 'someone', repo: 'display-demo', token }, g.fetch);
const input = { repoText: 'someone/display-demo', token: W, passphrase: PASS };

beforeEach(async () => {
  stubStorage();
  await Promise.all([db.moduleRecords.clear(), db.contacts.clear()]);
  await ensureCalendarSeed(db);
});
afterEach(() => vi.unstubAllGlobals());

describe('connecting a repository', () => {
  it('saves nothing for a name that is not owner/name, a bad passphrase or an empty key', async () => {
    expect(await connectPublisher({ ...input, repoText: 'just-a-word' })).toMatchObject({ ok: false });
    expect(await connectPublisher({ ...input, passphrase: 'hunter2' })).toMatchObject({ ok: false });
    expect(await connectPublisher({ ...input, token: '  ' })).toMatchObject({ ok: false });
    expect(readPublisher()).toBeNull();
  });

  it('refuses a public repository, a read-only key and an archived repository, and saves nothing', async () => {
    const pub = createFakeGithub({ owner: 'someone', repo: 'display-demo', isPrivate: false, tokens: { [W]: { can: 'write' } } });
    expect(await connectPublisher(input, storeOf(pub))).toMatchObject({ ok: false, message: expect.stringContaining('public') });
    const g = gh();
    expect(await connectPublisher({ ...input, token: R }, storeOf(g, R))).toMatchObject({ ok: false, message: expect.stringContaining('only read') });
    expect(readPublisher()).toBeNull();
  });

  it('reports a rejected key or a missing repository in plain words', async () => {
    const g = gh();
    g.tokens[W].expired = true;
    expect(await connectPublisher(input, storeOf(g))).toMatchObject({ ok: false, message: expect.stringMatching(/did not accept the key/) });
    const none = githubDisplayStore({ owner: 'someone', repo: 'nope', token: W }, gh().fetch);
    expect(await connectPublisher({ ...input, repoText: 'someone/nope' }, none)).toMatchObject({ ok: false, message: expect.stringMatching(/could not find/) });
    expect(readPublisher()).toBeNull();
  });

  it('keeps the display separate from Ledger\'s sync: not the sync repository, not the sync key, not the sync passphrase', async () => {
    localStorage.setItem('ledger-sync-config', JSON.stringify({ owner: 'someone', repo: 'ledger-sync', token: 'github_pat_SYNCKEYforTESTSonly0123456789', passphrase: 'a good sync passphrase', auto: true }));
    const g = gh();
    expect(await connectPublisher({ ...input, repoText: 'Someone/Ledger-Sync' }, storeOf(g))).toMatchObject({ ok: false, message: expect.stringContaining('sync') });
    expect(await connectPublisher({ ...input, token: 'github_pat_SYNCKEYforTESTSonly0123456789' }, storeOf(g))).toMatchObject({ ok: false, message: expect.stringContaining('sync key') });
    localStorage.setItem('ledger-sync-config', JSON.stringify({ owner: 'someone', repo: 'ledger-sync', token: 'x'.repeat(30), passphrase: PASS, auto: true }));
    expect(await connectPublisher(input, storeOf(g))).toMatchObject({ ok: false, message: expect.stringContaining('different from the sync passphrase') });
    expect(readPublisher()).toBeNull();
  });

  it('a good connection is saved on this device only, not yet reviewed, with warnings for stray files', async () => {
    const g = createFakeGithub({ owner: 'someone', repo: 'display-demo', tokens: { [W]: { can: 'write' } }, others: ['README.md'] });
    const r = await connectPublisher({ ...input, tokenExpiresOn: '2027-03-01' }, storeOf(g));
    expect(r.ok && r.warnings.join(' ')).toContain('README.md');
    const c = readPublisher()!;
    expect(c).toMatchObject({ owner: 'someone', repo: 'display-demo', reviewedAt: null, tokenExpiresOn: '2027-03-01', replaceExisting: false, takeOver: false });
    expect(c.publisherId).toMatch(/^[0-9a-f]{16}$/);
    // connecting again with the same repository and passphrase keeps this device's identity
    const again = await connectPublisher(input, storeOf(g));
    expect(again.ok && again.config.publisherId).toBe(c.publisherId);
  });
});

describe('the whole first publication (owner flow)', () => {
  it('connect, review the whole dataset, confirm, publish; then pending, revocation and rotation behave', async () => {
    const g = gh();
    vi.stubGlobal('fetch', g.fetch);
    const swim = await addEvent(db, 'Swim meet', '2026-11-20', {}, 10 * 60);
    await appendDecision({ subject: subjectOf('event', swim), decision: 'show' }, db);

    const c = await connectPublisher(input);
    if (!c.ok) throw new Error(c.message);
    const review = await prepareReview(c.config, db);
    expect(review.projection.counts.entries).toBeGreaterThanOrEqual(0);
    expect(review.existing).toBe('none');
    expect(g.putCount).toBe(0); // reviewing writes nothing
    expect(await loadBaseline(db)).toBeNull();

    const r = await confirmFirstPublication(review, db);
    expect(r).toMatchObject({ outcome: 'published', revision: 1 });
    expect(await loadBaseline(db)).toBe(review.at);
    expect(readPublisher()!.reviewedAt).not.toBeNull();
    const keys = await deriveDisplayKeys(PASS); // the real key derivation: what the tablet will use
    const o = await openEnvelope(keys, g.file!.bytes);
    expect(o.ok && o.projection.entries.map((e) => e.title)).toEqual(['Swim meet'].filter(() => review.projection.entries.length > 0));
    const a = readActivity();
    expect(a).toMatchObject({ lastRevision: 1, connection: 'ok', pending: false, publishing: false });
    expect(statusOf(readPublisher(), a)).toMatchObject({ kind: 'published', label: 'Published' });
    expect(JSON.stringify(a)).not.toContain('Swim');
    expect(JSON.stringify(a)).not.toContain(W);

    // a hide that has been written but not yet published says so, in the required words
    const hideId = await appendDecision({ subject: subjectOf('event', swim), decision: 'hide' }, db);
    const rows = await db.moduleRecords.toArray();
    expect(revocationOf(rows, readActivity(), true)).toEqual({ waiting: true, message: 'Hidden in Ledger. The family display has not been updated yet.' });
    // ... and after the publish, the success wording appears, without claiming the tablet has it
    await requestPublish('revocation');
    const after = revocationOf(await db.moduleRecords.toArray(), readActivity(), true);
    expect(after.waiting).toBe(false);
    expect(after.message).toMatch(/in the published file/);
    expect(after.message).toMatch(/offline may still hold an older copy/);
    expect(hideId).toBeGreaterThan(0);

    // changing the passphrase makes a NEW file the old passphrase cannot read
    const before = g.file!.sha;
    const fresh = changePassphrase();
    expect(fresh).not.toBe(PASS);
    expect(readPublisher()).toMatchObject({ passphrase: fresh, replaceExisting: true });
    expect(await requestPublish('manual')).toMatchObject({ outcome: 'published' });
    expect(g.file!.sha).not.toBe(before);
    expect((await openEnvelope(keys, g.file!.bytes)).ok).toBe(false);
    expect((await openEnvelope(await deriveDisplayKeys(fresh), g.file!.bytes)).ok).toBe(true);
    expect(readPublisher()!.replaceExisting).toBe(false); // one-shot: consumed
  });

  it('quiet triggers do nothing when nothing changed, while an explicit Publish now still checks and logs it', async () => {
    const g = gh();
    vi.stubGlobal('fetch', g.fetch);
    const c = await connectPublisher(input);
    if (!c.ok) throw new Error(c.message);
    await confirmFirstPublication(await prepareReview(c.config, db), db);
    const puts = g.putCount;
    const logLen = readActivity().log.length;
    await new Promise((r) => setTimeout(r, 25));
    expect(await requestPublish('periodic')).toBeNull(); // the minimum gap between quiet attempts
    expect(g.putCount).toBe(puts);
    const r = await requestPublish('manual');
    expect(r).toMatchObject({ outcome: 'unchanged' });
    expect(readActivity().log.length).toBe(logLen + 1);
  });

  it('a key GitHub no longer accepts marks the device disconnected and stops automatic attempts', async () => {
    const g = gh();
    vi.stubGlobal('fetch', g.fetch);
    const c = await connectPublisher(input);
    if (!c.ok) throw new Error(c.message);
    await confirmFirstPublication(await prepareReview(c.config, db), db);
    g.tokens[W].expired = true;
    const r = await requestPublish('manual');
    expect(r).toMatchObject({ outcome: 'failed', code: 'unauthorized' });
    expect(readActivity().connection).toBe('rejected');
    expect(statusOf(readPublisher(), readActivity())).toMatchObject({ kind: 'disconnected', tone: 'bad' });
    const calls = g.requests.length;
    expect(await requestPublish('periodic')).toBeNull(); // no hammering a refused key
    expect(g.requests.length).toBe(calls);
  });
});

describe('status wording', () => {
  const cfg = () => ({ ...newPublisher({ owner: 'someone', repo: 'display-demo', token: W, passphrase: PASS }), reviewedAt: 1 });
  it('distinguishes every state the owner needs to tell apart', () => {
    const a = blankActivity();
    expect(statusOf(null, a).kind).toBe('not-configured');
    expect(statusOf({ ...cfg(), reviewedAt: null }, a).kind).toBe('configured');
    expect(statusOf(cfg(), { ...a, publishing: true }).kind).toBe('publishing');
    expect(statusOf(cfg(), { ...a, lastSuccessAt: 5 }).kind).toBe('published');
    expect(statusOf(cfg(), { ...a, lastSuccessAt: 5, pending: true }).kind).toBe('pending');
    expect(statusOf(cfg(), { ...a, lastSuccessAt: 5, lastAttempt: { at: 9, outcome: 'failed', code: 'network', message: 'x' } }).kind).toBe('failed');
    expect(statusOf(cfg(), { ...a, lastSuccessAt: 5, lastAttempt: { at: 9, outcome: 'blocked', code: 'behind-history', message: 'y' } })).toMatchObject({ kind: 'failed', label: 'Stopped' });
    expect(statusOf(cfg(), { ...a, connection: 'rejected' }).kind).toBe('disconnected');
    // an old failure followed by a later success is not shown as failed
    expect(statusOf(cfg(), { ...a, lastSuccessAt: 20, lastAttempt: { at: 9, outcome: 'failed', code: 'network', message: 'x' } }).kind).toBe('published');
  });

  it('never says "published" before there has been a confirmed write', () => {
    const a = blankActivity();
    expect(statusOf(cfg(), a).label).not.toMatch(/Published/);
    expect(statusOf(cfg(), { ...a, pending: true }).label).not.toMatch(/^Published/);
    expect(revocationOf([], a, true)).toEqual({ waiting: false, message: null });
  });
});

describe('credentials stay on this device', () => {
  it('the publisher settings and activity are in browser storage, never in a backup file', () => {
    expect(PREFERENCE_KEYS).not.toContain(CONFIG_KEY);
    expect(PREFERENCE_KEYS).not.toContain(ACTIVITY_KEY);
    writePublisher(newPublisher({ owner: 'someone', repo: 'display-demo', token: W, passphrase: PASS }));
    patchActivity({ lastRevision: 3 });
    expect(JSON.stringify(collectPreferences())).not.toMatch(/display-demo|WRITEKEY|ABCD-EFGH/);
    expect(JSON.stringify(collectPreferences())).not.toContain('ledger-display');
  });

  it('the database holds no key or passphrase, and no display setting is a synced record', async () => {
    writePublisher(newPublisher({ owner: 'someone', repo: 'display-demo', token: W, passphrase: PASS }));
    const all = JSON.stringify(await Promise.all(db.tables.map((t) => t.toArray())));
    expect(all).not.toContain(W);
    expect(all).not.toContain(PASS);
  });

  it('disconnecting forgets the key and the passphrase; garbage in storage reads as "not set up"', () => {
    writePublisher(newPublisher({ owner: 'someone', repo: 'display-demo', token: W, passphrase: PASS }));
    expect(readPublisher()).not.toBeNull();
    clearPublisher();
    expect(readPublisher()).toBeNull();
    expect(localStorage.getItem(CONFIG_KEY)).toBeNull();
    expect(localStorage.getItem(ACTIVITY_KEY)).toBeNull();
    localStorage.setItem(CONFIG_KEY, '{"v":1,"owner":"../x","repo":"y","token":"t"}');
    expect(readPublisher()).toBeNull();
    localStorage.setItem(CONFIG_KEY, 'not json');
    expect(readPublisher()).toBeNull();
  });

  it('error messages and the activity log never contain the key or the passphrase', async () => {
    const g = gh();
    vi.stubGlobal('fetch', g.fetch);
    const c = await connectPublisher(input);
    if (!c.ok) throw new Error(c.message);
    await confirmFirstPublication(await prepareReview(c.config, db), db);
    g.tokens[W].expired = true;
    await requestPublish('manual');
    g.networkDown = true;
    g.tokens[W].expired = false;
    await requestPublish('manual');
    const text = JSON.stringify(readActivity());
    expect(text).not.toContain(W);
    expect(text).not.toContain(PASS);
  });

  it('the activity log is capped', () => {
    for (let i = 0; i < LOG_KEEP + 25; i++) logAttempt({ at: i, outcome: 'unchanged', code: 'unchanged', message: 'ok' });
    expect(readActivity().log.length).toBe(LOG_KEEP);
    expect(readActivity().log.at(-1)?.at).toBe(LOG_KEEP + 24);
  });

  it('a result is recorded without leaking content: revisions, counts and numeric decision ids only', () => {
    recordResult({ outcome: 'failed', code: 'network', message: 'Could not reach GitHub.' }, 'change', 1000);
    expect(readActivity()).toMatchObject({ lastAttempt: { outcome: 'failed', code: 'network' }, publishing: false });
  });
});

describe('key expiry warnings', () => {
  const c = (tokenExpiresOn: string | null) => ({ ...newPublisher({ owner: 'a', repo: 'b', token: W, passphrase: PASS }), tokenExpiresOn });
  const now = Date.parse('2026-11-16T12:00:00Z');
  it('warns two weeks ahead and again once expired, from the owner\'s date or from GitHub\'s', () => {
    expect(expiryOf(c(null), blankActivity(), now)).toMatchObject({ level: 'none' });
    expect(expiryOf(c('2027-06-01'), blankActivity(), now)).toMatchObject({ level: 'none' });
    expect(expiryOf(c('2026-11-25'), blankActivity(), now)).toMatchObject({ level: 'soon', date: '2026-11-25' });
    expect(expiryOf(c('2026-11-10'), blankActivity(), now)).toMatchObject({ level: 'expired' });
    expect(expiryOf(c('2027-06-01'), { ...blankActivity(), tokenExpiresAt: '2026-11-20T00:00:00.000Z' }, now)).toMatchObject({ level: 'soon' }); // GitHub's date is nearer
    expect(expiryOf(null, blankActivity(), now)).toMatchObject({ level: 'none' });
  });
  it('updatePublisher keeps the rest of the settings', () => {
    writePublisher(c(null));
    updatePublisher({ tokenExpiresOn: '2027-01-01' });
    expect(readPublisher()).toMatchObject({ owner: 'a', repo: 'b', tokenExpiresOn: '2027-01-01' });
  });
  it('a generated passphrase is accepted by the connection check', () => {
    expect(() => newPublisher({ owner: 'a', repo: 'b', token: W, passphrase: generatePassphrase() })).not.toThrow();
  });
});
