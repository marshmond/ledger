import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelConnect, connectGmail, disconnectGmail, getGmailState, gmailAccessToken, loadGoogle, markGmailExpired, preloadGoogle, removeGmailClientId, resetGmailForTests,
  saveGmailClientId, subscribeGmail, type GoogleOauth2, type GoogleTokenResponse,
} from './auth';
import { GMAIL_SEND_SCOPE, GOOGLE_SCRIPT_URL, checkClientId } from './config';
import { GMAIL_CLIENT_ID_KEY, readClientId } from './clientId';
import { problemText, summaryOf } from './words';

const CLIENT = ['1234567890-abcdef123456', 'apps', ['googleusercontent', 'com'].join('.')].join('.');
const TOKEN = 'ya29.FAKE-TEST-TOKEN-not-real';

/** A recording storage, so a test can see everything that was ever written to it. */
function recorder() {
  const m = new Map<string, string>();
  const writes: string[] = [];
  return { m, writes, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { writes.push(`${k}=${v}`); m.set(k, v); }, removeItem: (k: string) => void m.delete(k), clear: () => m.clear() };
}

interface Rig { cfgs: Parameters<GoogleOauth2['initTokenClient']>[0][]; requested: number; revoked: string[]; codeClient: number }
/** A fake Google library. `answer` decides what Google says when the window is "used". */
function fakeGoogle(answer: (cfg: Rig['cfgs'][number]) => void | 'silent', over: Partial<GoogleOauth2> = {}): { g: GoogleOauth2; rig: Rig } {
  const rig: Rig = { cfgs: [], requested: 0, revoked: [], codeClient: 0 };
  const g: GoogleOauth2 & { initCodeClient?: () => void } = {
    initTokenClient(cfg) { rig.cfgs.push(cfg); return { requestAccessToken() { rig.requested++; answer(cfg); } }; },
    hasGrantedAllScopes: (r, ...scopes) => scopes.every((s) => (r.scope ?? '').split(' ').includes(s)),
    revoke: (t, done) => { rig.revoked.push(t); done?.({ successful: true }); },
    initCodeClient: () => { rig.codeClient++; },
    ...over,
  };
  return { g, rig };
}
const good = (extra: Partial<GoogleTokenResponse> = {}) => (cfg: Rig['cfgs'][number]) => cfg.callback({ access_token: TOKEN, expires_in: 3599, scope: GMAIL_SEND_SCOPE, token_type: 'Bearer', ...extra });

let ls: ReturnType<typeof recorder>;
let ss: ReturnType<typeof recorder>;
beforeEach(() => {
  ls = recorder(); ss = recorder();
  vi.stubGlobal('localStorage', ls);
  vi.stubGlobal('sessionStorage', ss);
  vi.stubGlobal('navigator', { onLine: true });
  resetGmailForTests();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); resetGmailForTests(); });

const install = (g: GoogleOauth2) => vi.stubGlobal('google', { accounts: { oauth2: g } });
const configure = () => { expect(saveGmailClientId(CLIENT)).toEqual({ ok: true }); };

describe('CAL-G1 client ID', () => {
  it('accepts a real-looking web client ID and nothing else', () => {
    expect(checkClientId(CLIENT)).toEqual({ ok: true, id: CLIENT });
    expect(checkClientId(`  ${CLIENT}\n`)).toEqual({ ok: true, id: CLIENT });
    for (const bad of ['', 'abc', 'hello.apps.googleusercontent.com', '1234567890-abc.example.com', `${CLIENT} extra`, 'https://example.test']) expect(checkClientId(bad).ok, bad).toBe(false);
  });
  it('refuses a client SECRET by name, in plain words, and never stores it', () => {
    const secret = ['GOCSPX', 'abcdefghijklmnopqrstuvwxyz12'].join('-');
    const r = checkClientId(secret);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.problem).toMatch(/client secret/i);
    expect(saveGmailClientId(secret).ok).toBe(false);
    expect(ls.writes).toEqual([]);
    expect(readClientId()).toBeNull();
  });
  it('saves only the ID, on this device (browser storage under one key), and can remove it', () => {
    configure();
    expect(ls.writes).toEqual([`${GMAIL_CLIENT_ID_KEY}=${CLIENT}`]);
    expect(getGmailState()).toMatchObject({ configured: true, phase: 'idle' });
    removeGmailClientId();
    expect(ls.m.size).toBe(0);
    expect(getGmailState().configured).toBe(false);
  });
  it('a stored value that is not a valid ID is ignored', () => {
    ls.m.set(GMAIL_CLIENT_ID_KEY, 'not an id');
    expect(readClientId()).toBeNull();
    expect(getGmailState().configured).toBe(false);
  });
});

describe('CAL-G1 not configured: Ledger never contacts Google', () => {
  it('connect says so, loads nothing, opens no window', async () => {
    const { g, rig } = fakeGoogle(good());
    install(g);
    expect(getGmailState()).toMatchObject({ configured: false, phase: 'idle', problem: null });
    expect(await connectGmail()).toEqual({ ok: false, problem: 'no-client-id' });
    expect(rig.cfgs).toHaveLength(0);
    expect(getGmailState().problem).toBe('no-client-id');
    expect(summaryOf({ configured: false, phase: 'idle', expiresAt: null, problem: null }).label).toBe('Not configured');
  });
  it('preloading the library does nothing until a client ID exists, and then adds Google\'s script from its one address', () => {
    const added: { src?: string; async?: boolean }[] = [];
    const doc = { createElement: () => { const s: { src?: string; async?: boolean; onload?: () => void; onerror?: () => void; remove: () => void } = { remove: () => undefined }; added.push(s); return s; }, head: { appendChild: () => undefined } } as unknown as Document;
    vi.stubGlobal('document', doc);
    preloadGoogle();
    expect(added).toHaveLength(0);
    configure();
    preloadGoogle();
    expect(added).toHaveLength(1);
    expect(added[0].src).toBe(GOOGLE_SCRIPT_URL);
    expect(GOOGLE_SCRIPT_URL).toBe('https://accounts.google.com/gsi/client');
  });
  it('a library that cannot load (offline, blocked) gives "script unavailable", and a later try loads again', async () => {
    configure();
    let n = 0;
    const doc = { createElement: () => { const s: { onerror?: () => void; remove: () => void } = { remove: () => undefined }; n++; setTimeout(() => s.onerror?.(), 0); return s; }, head: { appendChild: () => undefined } } as unknown as Document;
    vi.stubGlobal('document', doc);
    expect(await loadGoogle(doc)).toBeNull();
    expect(await loadGoogle(doc)).toBeNull();
    expect(n).toBe(2);
    expect(await connectGmail()).toEqual({ ok: false, problem: 'script-unavailable' });
    expect(getGmailState()).toMatchObject({ phase: 'idle', problem: 'script-unavailable' });
  });
});

describe('CAL-G1 connecting', () => {
  it('asks Google for the send permission and nothing else, in the token model, with no offline access', async () => {
    configure();
    const { g, rig } = fakeGoogle(good());
    install(g);
    expect(await connectGmail()).toEqual({ ok: true });
    expect(rig.cfgs).toHaveLength(1);
    const cfg = rig.cfgs[0];
    expect(cfg.scope).toBe('https://www.googleapis.com/auth/gmail.send');
    expect(cfg.scope).not.toMatch(/\s/); // one scope
    expect(cfg.client_id).toBe(CLIENT);
    expect(cfg.include_granted_scopes).toBe(false);
    expect(cfg.prompt).toBe('select_account');
    expect(Object.keys(cfg).sort()).toEqual(['callback', 'client_id', 'error_callback', 'include_granted_scopes', 'prompt', 'scope']); // no access_type, no redirect, no hosted-domain, no state
    expect(rig.codeClient).toBe(0); // the code model (which could yield a refresh token) is never used
    expect(rig.requested).toBe(1);
  });
  it('keeps the token in memory only, and the state says connected until just before Google\'s expiry', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date('2026-11-17T10:00:00Z'));
    configure();
    install(fakeGoogle(good()).g);
    const seen: string[] = [];
    const off = subscribeGmail(() => seen.push(getGmailState().phase));
    expect(await connectGmail()).toEqual({ ok: true });
    const s = getGmailState();
    expect(s).toMatchObject({ configured: true, phase: 'connected', problem: null });
    expect(s.expiresAt).toBe(Date.now() + 3599_000 - 30_000);
    expect(gmailAccessToken()).toBe(TOKEN);
    expect(getGmailState()).toBe(s); // the same object until something changes
    expect(summaryOf(s).label).toBe('Connected for this browser session');
    // it runs out by itself
    vi.advanceTimersByTime(3_600_000);
    expect(gmailAccessToken()).toBeNull();
    expect(getGmailState().phase).toBe('expired');
    expect(summaryOf(getGmailState()).label).toBe('Authorization expired');
    expect(seen).toEqual(['connecting', 'connected', 'expired']);
    off();
  });
  it('an expired token is not used even if no timer has fired yet (checked at the moment of use)', async () => {
    configure();
    install(fakeGoogle(good({ expires_in: 100 })).g);
    await connectGmail();
    expect(gmailAccessToken(Date.now() + 10_000)).toBe(TOKEN);
    expect(gmailAccessToken(Date.now() + 80_000)).toBeNull(); // 100 s minus the 30 s margin
    expect(getGmailState().phase).toBe('expired');
  });
  it('a missing lifetime is treated as short, not as forever', async () => {
    configure();
    install(fakeGoogle(good({ expires_in: undefined })).g);
    await connectGmail();
    expect(getGmailState().expiresAt! - Date.now()).toBeLessThanOrEqual(300_000);
  });
  it('Reconnecting after expiry works and Gmail saying "expired" (a 401) puts the state back to expired', async () => {
    configure();
    install(fakeGoogle(good()).g);
    await connectGmail();
    markGmailExpired();
    expect(getGmailState().phase).toBe('expired');
    expect(gmailAccessToken()).toBeNull();
    expect(await connectGmail()).toEqual({ ok: true });
    expect(getGmailState().phase).toBe('connected');
  });
  it('a second press while Google\'s window is open is ignored: one window, one request', async () => {
    configure();
    let finish: () => void = () => undefined;
    const { g, rig } = fakeGoogle((cfg) => { finish = () => good()(cfg); return 'silent'; });
    install(g);
    const first = connectGmail();
    const second = await connectGmail();
    const third = await connectGmail();
    expect(second).toEqual({ ok: false, problem: 'busy' });
    expect(third).toEqual({ ok: false, problem: 'busy' });
    expect(rig.requested).toBe(1);
    expect(getGmailState().phase).toBe('connecting');
    finish();
    expect(await first).toEqual({ ok: true });
  });
  it('already connected: pressing again opens nothing', async () => {
    configure();
    const { g, rig } = fakeGoogle(good());
    install(g);
    await connectGmail();
    expect(await connectGmail()).toEqual({ ok: true });
    expect(rig.requested).toBe(1);
  });
  it('the owner can cancel the wait; a late answer from the cancelled window is ignored', async () => {
    configure();
    let late: () => void = () => undefined;
    install(fakeGoogle((cfg) => { late = () => good()(cfg); return 'silent'; }).g);
    const p = connectGmail();
    cancelConnect();
    expect(await p).toEqual({ ok: false, problem: 'closed' });
    expect(getGmailState().phase).toBe('idle');
    late();
    expect(getGmailState().phase).toBe('idle');
    expect(gmailAccessToken()).toBeNull();
  });
  it('gives up waiting for a window that never answers after three minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    configure();
    install(fakeGoogle(() => 'silent').g);
    const p = connectGmail();
    vi.advanceTimersByTime(3 * 60_000 + 10);
    expect(await p).toEqual({ ok: false, problem: 'timeout' });
    expect(getGmailState()).toMatchObject({ phase: 'idle', problem: 'timeout' });
  });
  it('offline: says so and does not open Google\'s window', async () => {
    configure();
    const { g, rig } = fakeGoogle(good());
    install(g);
    vi.stubGlobal('navigator', { onLine: false });
    expect(await connectGmail()).toEqual({ ok: false, problem: 'offline' });
    expect(rig.requested).toBe(0);
  });
});

describe('CAL-G1 when authorization fails, it fails safely', () => {
  const cases: [string, (cfg: Rig['cfgs'][number]) => void, string][] = [
    ['the window is closed', (cfg) => cfg.error_callback?.({ type: 'popup_closed' }), 'closed'],
    ['the browser blocks the window', (cfg) => cfg.error_callback?.({ type: 'popup_failed_to_open' }), 'popup-blocked'],
    ['Google reports an unknown error', (cfg) => cfg.error_callback?.({ type: 'unknown' }), 'unknown'],
    ['the owner clicks Cancel in Google\'s window', (cfg) => cfg.callback({ error: 'access_denied' }), 'denied'],
    ['the client ID is wrong', (cfg) => cfg.callback({ error: 'invalid_client' }), 'invalid-client'],
    ['the request is rejected (origin mismatch)', (cfg) => cfg.callback({ error: 'invalid_request' }), 'invalid-request'],
    ['Google answers with some other error', (cfg) => cfg.callback({ error: 'something_new', error_description: TOKEN }), 'unknown'],
    ['the answer has no token', (cfg) => cfg.callback({ scope: GMAIL_SEND_SCOPE }), 'unknown'],
  ];
  for (const [name, act, problem] of cases) {
    it(`${name}: not connected, a plain problem, no token`, async () => {
      configure();
      install(fakeGoogle(act).g);
      expect(await connectGmail()).toEqual({ ok: false, problem });
      expect(getGmailState()).toMatchObject({ phase: 'idle', problem });
      expect(gmailAccessToken()).toBeNull();
      const text = problemText(problem as never);
      expect(text.length).toBeGreaterThan(20);
      expect(text).not.toContain(TOKEN);
    });
  }
  it('if the "send email" box was unticked, the token is thrown away and Google is asked to cancel it', async () => {
    configure();
    const { g, rig } = fakeGoogle(good({ scope: 'openid' }));
    install(g);
    expect(await connectGmail()).toEqual({ ok: false, problem: 'scope-missing' });
    expect(gmailAccessToken()).toBeNull();
    expect(rig.revoked).toEqual([TOKEN]);
  });
  it('a token with MORE permission than asked (for example read access left from an earlier grant) is refused and cancelled', async () => {
    configure();
    for (const extra of ['https://www.googleapis.com/auth/gmail.readonly', 'https://mail.google.com/', 'https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/gmail.modify']) {
      const { g, rig } = fakeGoogle(good({ scope: `${GMAIL_SEND_SCOPE} ${extra}` }));
      install(g);
      resetGmailForTests();
      expect(await connectGmail(), extra).toEqual({ ok: false, problem: 'too-broad' });
      expect(gmailAccessToken()).toBeNull();
      expect(rig.revoked).toEqual([TOKEN]);
    }
  });
  it('plain identity scopes alongside the send scope are tolerated (they grant no mailbox access)', async () => {
    configure();
    install(fakeGoogle(good({ scope: `${GMAIL_SEND_SCOPE} openid https://www.googleapis.com/auth/userinfo.email` })).g);
    expect(await connectGmail()).toEqual({ ok: true });
  });
  it('a library that throws while setting up is a plain failure, not a crash', async () => {
    configure();
    install({ initTokenClient: () => { throw new Error(`boom ${TOKEN}`); } });
    expect(await connectGmail()).toEqual({ ok: false, problem: 'unknown' });
    expect(getGmailState().phase).toBe('idle');
  });
  it('a failed second try keeps saying "expired", not "never connected"', async () => {
    configure();
    install(fakeGoogle(good()).g);
    await connectGmail();
    markGmailExpired();
    install(fakeGoogle((cfg) => cfg.error_callback?.({ type: 'popup_closed' })).g);
    await connectGmail();
    expect(getGmailState()).toMatchObject({ phase: 'expired', problem: 'closed' });
  });
});

describe('CAL-G1 disconnecting', () => {
  it('forgets the token at once and asks Google to cancel it', async () => {
    configure();
    const { g, rig } = fakeGoogle(good());
    install(g);
    await connectGmail();
    const r = await disconnectGmail();
    expect(r).toEqual({ revoked: true });
    expect(rig.revoked).toEqual([TOKEN]);
    expect(gmailAccessToken()).toBeNull();
    expect(getGmailState()).toMatchObject({ configured: true, phase: 'idle', problem: null });
  });
  it('still forgets it when Google cannot be asked, and says so', async () => {
    configure();
    const { g } = fakeGoogle(good(), { revoke: undefined });
    install(g);
    await connectGmail();
    expect(await disconnectGmail()).toEqual({ revoked: false });
    expect(gmailAccessToken()).toBeNull();
  });
  it('does not wait forever for Google to answer the cancel request', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    configure();
    const { g } = fakeGoogle(good(), { revoke: () => undefined });
    install(g);
    await connectGmail();
    const p = disconnectGmail();
    expect(gmailAccessToken()).toBeNull(); // already forgotten, before Google answers
    vi.advanceTimersByTime(5100);
    expect(await p).toEqual({ revoked: false });
  });
  it('with nothing connected there is nothing to cancel', async () => {
    configure();
    expect(await disconnectGmail()).toEqual({ revoked: null });
  });
  it('changing the client ID drops a token obtained with the old one; removing the ID drops it too', async () => {
    configure();
    install(fakeGoogle(good()).g);
    await connectGmail();
    expect(saveGmailClientId(['9876543210-zzzzzz999999', 'apps', ['googleusercontent', 'com'].join('.')].join('.'))).toEqual({ ok: true });
    expect(gmailAccessToken()).toBeNull();
    await connectGmail();
    expect(gmailAccessToken()).toBe(TOKEN);
    removeGmailClientId();
    expect(gmailAccessToken()).toBeNull();
    expect(getGmailState().configured).toBe(false);
  });
});

describe('CAL-G1 the token is never written anywhere that lasts', () => {
  it('after connecting, sending state changes and disconnecting, only the public client ID was ever written to browser storage', async () => {
    configure();
    install(fakeGoogle(good()).g);
    await connectGmail();
    markGmailExpired();
    await connectGmail();
    await disconnectGmail();
    expect(ls.writes).toEqual([`${GMAIL_CLIENT_ID_KEY}=${CLIENT}`]);
    expect(ss.writes).toEqual([]);
    expect(JSON.stringify([...ls.m.entries(), ...ss.m.entries()])).not.toContain(TOKEN);
  });
  it('the state objects the screens read hold no token', async () => {
    configure();
    install(fakeGoogle(good()).g);
    await connectGmail();
    expect(JSON.stringify(getGmailState())).not.toContain(TOKEN);
    expect(JSON.stringify(summaryOf(getGmailState()))).not.toContain(TOKEN);
  });
});
