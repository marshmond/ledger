/**
 * CAL-G1: Ledger's Gmail authorization. Uses Google's own sign-in library (Google Identity Services) in its browser-only "token model".
 *
 * What lives where:
 *  - The access token lives ONLY in this module's memory (`token` below). It is never written to browser storage, the database, a backup, sync, a
 *    URL, a log line or an error message. Closing or reloading the page forgets it, on purpose: the owner presses Connect Gmail again.
 *  - Google gives no refresh token in this model and Ledger asks for no offline access. When the token runs out, the state becomes "expired" and the
 *    owner presses Connect Gmail again (a button press is required: a popup opened without one would be blocked and would be a surprise).
 *  - The only thing kept on the device is the public client ID (clientId.ts).
 *
 * Connecting never sends anything. It only fills `token`; sending is a separate act that the owner starts with the Send button.
 *
 * Browser-only code, and unattended on purpose: the only timers are the two housekeeping ones below (flip to "expired", give up waiting for
 * Google). Neither calls Gmail.
 */
import { checkClientId, GMAIL_SEND_SCOPE, GOOGLE_SCRIPT_URL, TOLERATED_SCOPES } from './config';
import { readClientId, removeClientId, writeClientId } from './clientId';

// ---------- the small part of Google's library Ledger uses ----------

export interface GoogleTokenResponse { access_token?: string; expires_in?: number | string; scope?: string; token_type?: string; error?: string; error_description?: string }
export interface GoogleTokenClient { requestAccessToken(overrideConfig?: { prompt?: string }): void }
export interface GoogleOauth2 {
  initTokenClient(cfg: {
    client_id: string; scope: string; include_granted_scopes?: boolean; prompt?: string;
    callback: (r: GoogleTokenResponse) => void; error_callback?: (e: { type?: string }) => void;
  }): GoogleTokenClient;
  hasGrantedAllScopes?(r: GoogleTokenResponse, ...scopes: string[]): boolean;
  revoke?(token: string, done?: (r: { successful?: boolean }) => void): void;
}
interface GoogleHost { google?: { accounts?: { oauth2?: GoogleOauth2 } }; document?: Document; navigator?: { onLine?: boolean } }
const host = (): GoogleHost => globalThis as unknown as GoogleHost;
const googleNow = (): GoogleOauth2 | null => host().google?.accounts?.oauth2 ?? null;
const offline = () => host().navigator?.onLine === false;

let loading: Promise<GoogleOauth2 | null> | null = null;
/** Loads Google's script once (or uses it if the page already has it). Resolves null when it cannot be loaded. */
export function loadGoogle(doc: Document | undefined = host().document): Promise<GoogleOauth2 | null> {
  const ready = googleNow();
  if (ready) return Promise.resolve(ready);
  if (!doc) return Promise.resolve(null);
  if (!loading) {
    loading = new Promise<GoogleOauth2 | null>((resolve) => {
      try {
        const s = doc.createElement('script');
        s.src = GOOGLE_SCRIPT_URL;
        s.async = true;
        s.onload = () => resolve(googleNow());
        s.onerror = () => { s.remove(); resolve(null); };
        doc.head.appendChild(s);
      } catch { resolve(null); }
    }).then((g) => { if (!g) loading = null; return g; });
  }
  return loading;
}
/** Warms the library up so that pressing Connect can open Google's window straight away (browsers block windows opened late). Does nothing unless a client ID is set. */
export function preloadGoogle(): void {
  if (readClientId() && !googleNow()) void loadGoogle().catch(() => undefined);
}

// ---------- what the screens can see ----------

export type GmailPhase = 'idle' | 'connecting' | 'connected' | 'expired';
export type GmailProblem =
  | 'no-client-id' | 'offline' | 'script-unavailable' | 'popup-blocked' | 'closed' | 'denied' | 'scope-missing' | 'too-broad'
  | 'invalid-client' | 'invalid-request' | 'timeout' | 'unknown';
export interface GmailState {
  /** A client ID has been entered on this device. */
  configured: boolean;
  phase: GmailPhase;
  /** When Ledger will stop using the token (a little before Google does). Only while connected. */
  expiresAt: number | null;
  /** Why the last attempt to connect failed; cleared by the next attempt or a successful connect. */
  problem: GmailProblem | null;
}

// The access token. Module memory only: see the file comment. Nothing exports it except `gmailAccessToken`, which the sender uses at the moment of sending.
let token: string | null = null;
let expiresAt = 0;
let phase: GmailPhase = 'idle';
let problem: GmailProblem | null = null;
let priorPhase: GmailPhase = 'idle';
let attempt = 0;
let pending: ((r: ConnectResult) => void) | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
let waitTimer: ReturnType<typeof setTimeout> | undefined;
const subs = new Set<() => void>();

const compute = (): GmailState => ({ configured: readClientId() !== null, phase, expiresAt: phase === 'connected' ? expiresAt : null, problem });
const sameState = (a: GmailState, b: GmailState) => a.configured === b.configured && a.phase === b.phase && a.expiresAt === b.expiresAt && a.problem === b.problem;
let snapshot: GmailState = compute();

/** A token that has run out is dropped here, wherever it is noticed. */
function tick(now = Date.now()): void {
  if (token && now >= expiresAt) { token = null; expiresAt = 0; if (phase === 'connected') phase = 'expired'; }
}
function publish(): void {
  const next = compute();
  if (sameState(next, snapshot)) return;
  snapshot = next;
  subs.forEach((f) => f());
}
/** The current state. Returns the SAME object until something changes (so React can compare it). */
export function getGmailState(): GmailState {
  tick();
  const next = compute();
  if (!sameState(next, snapshot)) snapshot = next; // quiet refresh (the client ID can change in another tab); listeners hear about real changes through `publish`
  return snapshot;
}
export function subscribeGmail(f: () => void): () => void { subs.add(f); return () => { subs.delete(f); }; }

/**
 * The token, only while it is valid; null otherwise. The one place the sender gets it from, at the moment of a send. Never stored by the caller.
 */
export function gmailAccessToken(now = Date.now()): string | null {
  tick(now); // never notifies: this is called while screens render
  return token;
}

function setExpiryTimer(): void {
  clearTimeout(expiryTimer);
  const wait = Math.min(Math.max(expiresAt - Date.now(), 0) + 50, 2_147_000_000);
  expiryTimer = setTimeout(() => { tick(); publish(); }, wait);
}

/** Called when Gmail itself says the token is no good (HTTP 401 or "insufficient permission"): the state becomes "expired" so the screens ask to reconnect. */
export function markGmailExpired(): void {
  token = null; expiresAt = 0; clearTimeout(expiryTimer);
  if (phase === 'connected') phase = 'expired';
  publish();
}

// ---------- connecting ----------

export type ConnectResult = { ok: true } | { ok: false; problem: GmailProblem | 'busy' };
/** How long Ledger waits for Google's window before giving up (the owner can also cancel at any time). */
const WAIT_MS = 3 * 60_000;
/** Take a little off Google's stated lifetime so a send never starts with a token that is about to stop working. */
const MARGIN_MS = 30_000;

function problemFor(code: string | undefined): GmailProblem {
  if (code === 'access_denied') return 'denied';
  if (code === 'invalid_client' || code === 'unauthorized_client') return 'invalid-client';
  if (code === 'invalid_request' || code === 'redirect_uri_mismatch' || code === 'origin_mismatch') return 'invalid-request';
  return 'unknown';
}

function settle(r: ConnectResult): void {
  clearTimeout(waitTimer);
  const f = pending;
  pending = null;
  f?.(r);
}
function failWith(p: GmailProblem): ConnectResult {
  if (phase === 'connecting') phase = priorPhase === 'expired' ? 'expired' : 'idle'; // a failed second try still says "expired", not "never connected"
  problem = p;
  publish();
  return { ok: false, problem: p };
}

function revokeQuietly(g: GoogleOauth2 | null, t: string): void {
  try { g?.revoke?.(t, () => undefined); } catch { /* best effort: the token is dropped from memory either way */ }
}

/**
 * Opens Google's own authorization window and, if the owner agrees, keeps the token in memory. Call it ONLY from a button press. Returns after Google
 * answers, the window closes, or the owner cancels. A second press while one is open is ignored (no second window).
 */
export async function connectGmail(): Promise<ConnectResult> {
  tick();
  if (phase === 'connecting') return { ok: false, problem: 'busy' };
  if (phase === 'connected' && token) return { ok: true };
  const clientId = readClientId();
  if (!clientId) return failWith('no-client-id');
  if (offline()) return failWith('offline');
  const my = ++attempt;
  priorPhase = phase;
  phase = 'connecting';
  problem = null;
  publish();

  // If the library is already on the page, ask for the window in the same breath as the button press, so no browser takes it for a pop-up nobody asked for.
  const g = googleNow() ?? (await loadGoogle());
  if (my !== attempt) return { ok: false, problem: 'closed' }; // cancelled while the library was loading
  if (!g) return failWith('script-unavailable');

  return new Promise<ConnectResult>((resolve) => {
    pending = resolve;
    waitTimer = setTimeout(() => { if (my === attempt) { attempt++; settle(failWith('timeout')); } }, WAIT_MS);
    try {
      const client = g.initTokenClient({
        client_id: clientId,
        scope: GMAIL_SEND_SCOPE,
        include_granted_scopes: false, // never pile earlier permissions onto this one
        prompt: 'select_account', // the owner picks the Google account in Google's own window every time
        callback: (resp) => {
          if (my !== attempt) return; // a late answer from a window the owner cancelled
          if (resp.error) { settle(failWith(problemFor(resp.error))); return; }
          const t = typeof resp.access_token === 'string' ? resp.access_token : '';
          if (!t) { settle(failWith('unknown')); return; }
          const granted = (typeof resp.scope === 'string' ? resp.scope : '').split(/\s+/).filter(Boolean);
          const hasSend = typeof g.hasGrantedAllScopes === 'function' ? g.hasGrantedAllScopes(resp, GMAIL_SEND_SCOPE) : granted.includes(GMAIL_SEND_SCOPE);
          if (!hasSend) { revokeQuietly(g, t); settle(failWith('scope-missing')); return; }
          if (granted.some((s) => !TOLERATED_SCOPES.includes(s))) { revokeQuietly(g, t); settle(failWith('too-broad')); return; }
          const secs = Number(resp.expires_in);
          const life = Number.isFinite(secs) && secs > 0 ? Math.min(secs, 86_400) : 300; // an unstated lifetime is treated as short
          token = t;
          expiresAt = Date.now() + life * 1000 - MARGIN_MS;
          phase = 'connected';
          problem = null;
          setExpiryTimer();
          publish();
          settle({ ok: true });
        },
        error_callback: (e) => {
          if (my !== attempt) return;
          settle(failWith(e?.type === 'popup_failed_to_open' ? 'popup-blocked' : e?.type === 'popup_closed' ? 'closed' : 'unknown'));
        },
      });
      client.requestAccessToken();
    } catch { settle(failWith('unknown')); }
  });
}

/** The owner gave up waiting for Google's window. Anything Google says later is ignored. */
export function cancelConnect(): void {
  if (phase !== 'connecting') return;
  attempt++;
  phase = priorPhase === 'expired' ? 'expired' : 'idle';
  problem = null;
  settle({ ok: false, problem: 'closed' });
  publish();
}

/**
 * Forgets the token at once, then asks Google to cancel it (best effort: if that fails the token still runs out by itself within the hour, and the
 * owner can remove Ledger's access under their Google Account's security page).
 */
export async function disconnectGmail(): Promise<{ revoked: boolean | null }> {
  attempt++;
  const t = token;
  token = null; expiresAt = 0;
  clearTimeout(expiryTimer);
  phase = 'idle'; problem = null;
  settle({ ok: false, problem: 'closed' });
  publish();
  if (!t) return { revoked: null };
  const g = googleNow();
  if (!g?.revoke) return { revoked: false };
  return new Promise((resolve) => {
    const limit = setTimeout(() => resolve({ revoked: false }), 5000);
    try { g.revoke!(t, (r) => { clearTimeout(limit); resolve({ revoked: r?.successful === true }); }); } catch { clearTimeout(limit); resolve({ revoked: false }); }
  });
}

// ---------- the client ID ----------

/** Saves the owner's client ID on this device. A different ID drops any token obtained with the old one. */
export function saveGmailClientId(raw: string): { ok: true } | { ok: false; problem: string } {
  const c = checkClientId(raw);
  if (!c.ok) return c;
  const was = readClientId();
  if (!writeClientId(c.id)) return { ok: false, problem: 'This browser would not save the client ID (private browsing or blocked storage).' };
  if (was && was !== c.id) void disconnectGmail();
  publish();
  return { ok: true };
}
export function removeGmailClientId(): void {
  void disconnectGmail();
  removeClientId();
  publish();
}

/** Test helper: back to a fresh page load (no token, nothing pending). Not used by the app. */
export function resetGmailForTests(): void {
  attempt++; token = null; expiresAt = 0; phase = 'idle'; problem = null; pending = null; loading = null;
  clearTimeout(expiryTimer); clearTimeout(waitTimer);
  snapshot = compute();
}
