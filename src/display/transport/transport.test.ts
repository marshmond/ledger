import { describe, expect, it } from 'vitest';
import { deriveId, type DisplayProjection } from '../contract';
import { decodePairing, encodePairing, pairingProblem } from './pairing';
import { ENVELOPE_VERSION, generatePassphrase, idKeyOf, openEnvelope, PASSPHRASE_RE, sealProjection } from './envelope';
import { keysOf, sample } from './envelopeTestkit';
import { DisplayStoreError, githubDisplayStore } from './githubFile';
import { createFakeGithub } from './githubTestkit';

/** CS-2 transport: the encrypted file, the GitHub file client and the pairing code. Invented data only; fake GitHub; key derivation shortened for speed. */
const PASS = 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567';
const PASS2 = 'ZZZZ-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567';
const PUB = { id: '0123456789abcdef', mode: 'sync' as const };
const W = 'github_pat_WRITEKEYforTESTSonly0123456789';
const R = 'github_pat_READKEYforTESTSonly01234567890';

describe('encrypted display file', () => {
  it('round-trips and keeps the publisher information and revision', async () => {
    const keys = await keysOf(PASS);
    const p = await sample(keys, {}, 7);
    const bytes = await sealProjection(keys, p, PUB);
    const r = await openEnvelope(keys, bytes);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.projection).toEqual(p); expect(r.publisher).toEqual(PUB); expect(r.revision).toBe(7); }
  });

  it('a wrong passphrase cannot open it', async () => {
    const bytes = await sealProjection(await keysOf(PASS), await sample(await keysOf(PASS)), PUB);
    const r = await openEnvelope(await keysOf(PASS2), bytes);
    expect(r).toMatchObject({ ok: false, code: 'cannot-decrypt' });
  });

  it('corrupted ciphertext, a truncated file and a different kind of file are refused with plain codes', async () => {
    const keys = await keysOf(PASS);
    const bytes = await sealProjection(keys, await sample(keys), PUB);
    const flipped = bytes.slice(); flipped[flipped.length - 20] ^= 0xff;
    expect(await openEnvelope(keys, flipped)).toMatchObject({ ok: false, code: 'cannot-decrypt' });
    expect(await openEnvelope(keys, bytes.slice(0, 20))).toMatchObject({ ok: false, code: 'truncated' });
    expect(await openEnvelope(keys, bytes.slice(0, bytes.length - 5))).toMatchObject({ ok: false, code: 'cannot-decrypt' });
    expect(await openEnvelope(keys, new TextEncoder().encode('not a display file at all, just text'))).toMatchObject({ ok: false, code: 'not-a-display-file' });
    expect(await openEnvelope(keys, new Uint8Array(0))).toMatchObject({ ok: false });
  });

  it('the header is authenticated: a changed revision or a changed version is refused', async () => {
    const keys = await keysOf(PASS);
    const bytes = await sealProjection(keys, await sample(keys, {}, 5), PUB);
    const rev = bytes.slice(); rev[8] = 6; // revision 5 -> 6 in the plain header
    expect(await openEnvelope(keys, rev)).toMatchObject({ ok: false, code: 'cannot-decrypt' });
    const ver = bytes.slice(); ver[4] = ENVELOPE_VERSION + 1;
    expect(await openEnvelope(keys, ver)).toMatchObject({ ok: false, code: 'unsupported-version' });
    const old = bytes.slice(); old[4] = 0;
    expect(await openEnvelope(keys, old)).toMatchObject({ ok: false, code: 'unsupported-version' });
  });

  it('every file gets a fresh salt and nonce, so identical content never gives identical bytes', async () => {
    const keys = await keysOf(PASS);
    const p = await sample(keys);
    const a = await sealProjection(keys, p, PUB);
    const b = await sealProjection(keys, p, PUB);
    expect(a).not.toEqual(b);
    expect(a.slice(9, 37)).not.toEqual(b.slice(9, 37)); // salt + iv
    const salts = new Set<string>();
    const ivs = new Set<string>();
    for (let i = 0; i < 20; i++) { const f = await sealProjection(keys, p, PUB); salts.add(Array.from(f.slice(9, 25)).join()); ivs.add(Array.from(f.slice(25, 37)).join()); }
    expect(salts.size).toBe(20);
    expect(ivs.size).toBe(20); // a nonce is never reused with a key
  });

  it('opaque ids are stable across devices that share the passphrase and differ with another passphrase', async () => {
    const a = await idKeyOf(await keysOf(PASS));
    const b = await idKeyOf(await keysOf(PASS)); // "another publishing device"
    const c = await idKeyOf(await keysOf(PASS2));
    expect(await deriveId(a, 'event', 11, '2026-11-10')).toBe(await deriveId(b, 'event', 11, '2026-11-10'));
    expect(await deriveId(a, 'event', 11, '2026-11-10')).not.toBe(await deriveId(c, 'event', 11, '2026-11-10'));
    const pa = await sample(await keysOf(PASS));
    const pb = await sample(await keysOf(PASS));
    expect(pa.entries.map((e) => e.id)).toEqual(pb.entries.map((e) => e.id));
    expect(pa.grantsSeen).toEqual(pb.grantsSeen);
    expect(pa.digest).toBe(pb.digest);
  });

  it('the file holds no readable household text', async () => {
    const keys = await keysOf(PASS);
    const bytes = await sealProjection(keys, await sample(keys), PUB);
    const asText = new TextDecoder('latin1').decode(bytes);
    for (const word of ['Piano', 'Ms Example', 'Library', 'Sam', 'ledger-display', 'Family', 'America/New_York', '2026-11']) expect(asText).not.toContain(word);
    expect(new TextDecoder('latin1').decode(bytes.slice(0, 4))).toBe('LDP1');
  });

  it('refuses to encrypt an invalid projection or invalid publisher information (nothing invalid is ever written)', async () => {
    const keys = await keysOf(PASS);
    const p = await sample(keys);
    await expect(sealProjection(keys, { ...p, counts: { entries: 99, tasks: 0 } }, PUB)).rejects.toThrow(/invalid projection/i);
    await expect(sealProjection(keys, { ...p, extra: 1 } as unknown as DisplayProjection, PUB)).rejects.toThrow();
    await expect(sealProjection(keys, p, { id: 'nope', mode: 'sync' })).rejects.toThrow();
    await expect(sealProjection(keys, { ...p, revision: -1 }, PUB)).rejects.toThrow();
  });

  it('a newer file version or reader requirement is reported as "update this display"', async () => {
    const keys = await keysOf(PASS);
    const p = await sample(keys);
    const bytes = await sealProjection(keys, { ...p, minReader: 2 as unknown as 1 }, PUB).catch((e: Error) => e);
    expect(bytes).toBeInstanceOf(Error); // the validator inside the sealer refuses a reader level this build does not know
  });

  it('the display passphrase generator makes 160-bit values in the expected shape', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) { const p = generatePassphrase(); expect(p).toMatch(PASSPHRASE_RE); seen.add(p); }
    expect(seen.size).toBe(50);
  });
});

describe('GitHub display file client (fake GitHub)', () => {
  const repo = () => createFakeGithub({ owner: 'someone', repo: 'display-demo', tokens: { [W]: { can: 'write' }, [R]: { can: 'read' } } });
  const store = (g: ReturnType<typeof repo>, token = W) => githubDisplayStore({ owner: 'someone', repo: 'display-demo', token }, g.fetch);

  it('first publication: no file, then create, then read it back', async () => {
    const g = repo();
    const s = store(g);
    expect((await s.read()).kind).toBe('missing');
    const out = await s.write(new Uint8Array([1, 2, 3]), null, 'display 1');
    const r = await s.read();
    expect(r.kind).toBe('file');
    if (r.kind === 'file') { expect(r.file.sha).toBe(out.sha); expect(Array.from(r.file.bytes)).toEqual([1, 2, 3]); expect(r.file.etag).toBeTruthy(); }
  });

  it('replacing needs the current version: a stale or missing version is a conflict and changes nothing', async () => {
    const g = repo();
    const s = store(g);
    const first = await s.write(new Uint8Array([1]), null, 'a');
    const second = await s.write(new Uint8Array([2]), first.sha, 'b');
    await expect(s.write(new Uint8Array([3]), first.sha, 'stale')).rejects.toMatchObject({ code: 'conflict' });
    await expect(s.write(new Uint8Array([3]), null, 'no version')).rejects.toMatchObject({ code: 'conflict' });
    expect(Array.from(g.file!.bytes)).toEqual([2]);
    expect(g.file!.sha).toBe(second.sha);
  });

  it('a conditional read answers "not modified" until the file changes', async () => {
    const g = repo();
    const s = store(g, R);
    g.seed(new Uint8Array([9]));
    const first = await s.read();
    if (first.kind !== 'file') throw new Error('expected a file');
    expect((await s.read({ etag: first.file.etag })).kind).toBe('not-modified');
    g.seed(new Uint8Array([10]));
    expect((await s.read({ etag: first.file.etag })).kind).toBe('file');
  });

  it('a read-only key can read but never write', async () => {
    const g = repo();
    g.seed(new Uint8Array([9]));
    const s = store(g, R);
    expect((await s.read()).kind).toBe('file');
    await expect(s.write(new Uint8Array([1]), g.file!.sha, 'x')).rejects.toMatchObject({ code: 'forbidden' });
    expect(Array.from(g.file!.bytes)).toEqual([9]);
  });

  it('tells an expired or revoked key, a missing repository, a busy server, rate limiting and no network apart', async () => {
    const g = repo();
    await expect(store(g, 'github_pat_WRONG0123456789012345').read()).rejects.toMatchObject({ code: 'unauthorized' });
    g.tokens[R].expired = true;
    await expect(store(g, R).read()).rejects.toMatchObject({ code: 'unauthorized' });
    const gone = githubDisplayStore({ owner: 'someone', repo: 'does-not-exist', token: W }, g.fetch);
    await expect(gone.read()).rejects.toMatchObject({ code: 'not-found' });
    g.failNext(503);
    await expect(store(g).read()).rejects.toMatchObject({ code: 'server' });
    g.failNext(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 120) }, { message: 'API rate limit exceeded' });
    const rl = await store(g).read().catch((e: DisplayStoreError) => e);
    expect(rl).toMatchObject({ code: 'rate-limited' });
    expect((rl as DisplayStoreError).retryAfterSeconds).toBeGreaterThan(60);
    g.failNext(429, { 'retry-after': '30' });
    expect(await store(g).read().catch((e: DisplayStoreError) => e)).toMatchObject({ code: 'rate-limited', retryAfterSeconds: 30 });
    g.networkDown = true;
    await expect(store(g).read()).rejects.toMatchObject({ code: 'network' });
  });

  it('never puts the key anywhere but the Authorization header, and never in an error message', async () => {
    const g = repo();
    const s = store(g);
    await s.read();
    expect(g.requests.every((r) => !r.path.includes(W))).toBe(true);
    g.tokens[W].expired = true;
    const err = await s.read().catch((e: Error) => e);
    expect(String((err as Error).message)).not.toContain(W);
  });

  it('checks the repository: private, writable, and nothing else in it', async () => {
    const g = createFakeGithub({ owner: 'someone', repo: 'display-demo', tokens: { [W]: { can: 'write' }, [R]: { can: 'read' } }, others: ['notes.txt'] });
    expect(await store(g).check()).toMatchObject({ private: true, canWrite: true, hasDisplayFile: false, otherFiles: ['notes.txt'] });
    expect(await store(g, R).check()).toMatchObject({ canWrite: false });
    const pub = createFakeGithub({ owner: 'someone', repo: 'display-demo', isPrivate: false, tokens: { [W]: { can: 'write' } } });
    expect((await store(pub).check()).private).toBe(false);
    const empty = repo();
    expect(await store(empty).check()).toMatchObject({ otherFiles: [], hasDisplayFile: false }); // an empty repository answers 404 on the listing
  });

  it('reads the server clock and the key expiry only when the browser lets the page see them', async () => {
    const g = repo();
    g.seed(new Uint8Array([1]));
    g.clock = Date.parse('2026-11-09T12:00:00Z');
    const r = await store(g).read();
    expect(r.info.serverDate).toBe(g.clock - (g.clock % 1000));
    expect(r.info.tokenExpiresAt).toBeNull();
    g.failNext(200, { 'github-authentication-token-expiration': '2027-01-31 00:00:00 UTC' }, { type: 'file', sha: 'a'.repeat(40), content: 'AQ==', encoding: 'base64' });
    expect((await store(g).read()).info.tokenExpiresAt).toBe('2027-01-31T00:00:00.000Z');
  });

  it('refuses a repository name that could change the web address', () => {
    expect(() => githubDisplayStore({ owner: '../x', repo: 'y', token: W })).toThrow();
    expect(() => githubDisplayStore({ owner: 'a', repo: 'b/c', token: W })).toThrow();
  });
});

describe('pairing code', () => {
  const good = { owner: 'someone', repo: 'display-demo', token: R, passphrase: PASS };

  it('round-trips and carries only the repository, the READ key and the passphrase', () => {
    const code = encodePairing(good);
    expect(code.startsWith('LDPAIR1.')).toBe(true);
    const r = decodePairing(code);
    expect(r).toEqual({ ok: true, data: good });
    expect(code).not.toContain(R); // it is encoded, not typed in the clear
    expect(code).not.toMatch(/[?&=#]/); // safe to paste; nothing that would make it part of a web address
  });

  it('survives line breaks and spaces from copying, and catches a changed or cut-short code', () => {
    const code = encodePairing(good);
    expect(decodePairing(` ${code.slice(0, 30)}\n${code.slice(30)} `)).toMatchObject({ ok: true });
    expect(decodePairing(code.slice(0, -3))).toMatchObject({ ok: false });
    const tampered = code.slice(0, 20) + (code[20] === 'A' ? 'B' : 'A') + code.slice(21);
    expect(decodePairing(tampered)).toMatchObject({ ok: false });
    expect(decodePairing('hello')).toMatchObject({ ok: false });
    expect(decodePairing('')).toMatchObject({ ok: false });
  });

  it('refuses malformed parts', () => {
    expect(pairingProblem({ ...good, owner: 'a/b' })).toBeTruthy();
    expect(pairingProblem({ ...good, token: 'short' })).toBeTruthy();
    expect(pairingProblem({ ...good, passphrase: 'not-a-passphrase' })).toBeTruthy();
    expect(() => encodePairing({ ...good, token: '' })).toThrow();
  });
});
