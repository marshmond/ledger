/**
 * CAL-N1: how a notification leaves Ledger. A transport takes ONE request (one message to one address) and reports honestly what it knows.
 *
 * Architecture (CS-0 J.7, option E4, PROVISIONAL): Ledger writes one small request file to a dedicated PRIVATE outbox repository (never the sync
 * repository, never the display repository, never GitHub Pages). A workflow in that repository, holding a send-only email key as a repository
 * secret, sends it and writes a result file that Ledger reads back. No email key ever exists in the browser.
 *
 * What exists in this build:
 *  - the request and result file FORMATS (below), deterministic and tested;
 *  - `githubOutboxTransport`: the code that would write and read those files with the GitHub contents API (modelled on the verified CS-2 display
 *    client; UNVERIFIED against a live repository; used by no screen; nothing stores a token);
 *  - `fakeTransport`: an in-memory sender for tests (and a development-only switch) that sends nothing anywhere.
 * What does NOT exist: the outbox repository, the workflow, the email provider, a sender address, any credential.
 *
 * CAL-G1 (the sender that is actually offered): `getTransport()` returns the GMAIL sender (gmail/transport.ts), but ONLY while the owner has
 * authorised Gmail in this browser session and the authorisation has not run out. Otherwise it returns null, exactly as before, so every screen keeps
 * saying that sending is not connected and no question is asked after Save, Delete or Undo. The GitHub outbox writer above stays unused and unconfigured.
 */
import { canonicalJson } from '../../../display/contract';
import { toB64, utf8 } from '../../../display/transport/bytes';
import { gmailTransportIfConnected } from '../gmail/transport';
import type { NoticeKind, ReasonClass } from './types';

export interface OutboxRequest {
  format: 'ledger-notice';
  v: 1;
  /** The file name stem (see identity.ts). The same message always has the same id. */
  id: string;
  requestId: string;
  attempt: number;
  noticeKind: NoticeKind;
  /** Display name and reply address are the owner's own words; the sender ADDRESS is the sender service's own setting (nothing is hardcoded here). */
  from: { name: string; replyTo: string | null };
  to: { name: string; address: string };
  subject: string;
  text: string;
}

export const requestPath = (id: string) => `requests/${id}.json`;
export const resultPath = (id: string) => `results/${id}.json`;
const ID = /^[0-9a-f]{64}(\.a\d{1,3})?$/;
export const isTransportId = (s: string) => ID.test(s);

/** The exact bytes of a request file. Canonical (sorted keys), so the same request is byte-for-byte the same file. */
export const encodeRequest = (r: OutboxRequest): string => `${canonicalJson(r)}\n`;

export interface OutboxResult { v: 1; id: string; state: 'accepted' | 'failed'; reason?: ReasonClass; at?: string }
const REASONS: ReasonClass[] = ['address-rejected', 'service-refused', 'quota', 'unauthorized', 'stale', 'not-received', 'unknown'];
/** Reads a result file the sender wrote. Anything unreadable is null (never guessed). */
export function parseResult(text: string): OutboxResult | null {
  try {
    const o = JSON.parse(text) as Partial<OutboxResult> | null;
    if (!o || o.v !== 1 || typeof o.id !== 'string' || (o.state !== 'accepted' && o.state !== 'failed')) return null;
    const reason = REASONS.includes(o.reason as ReasonClass) ? (o.reason as ReasonClass) : o.state === 'failed' ? 'unknown' : undefined;
    return { v: 1, id: o.id, state: o.state, ...(reason ? { reason } : {}), ...(typeof o.at === 'string' ? { at: o.at } : {}) };
  } catch { return null; }
}

/** What happened when a request was handed over. */
export type SubmitOutcome =
  /** In the outbox, not yet reported on. */
  | { kind: 'queued' }
  /** The mail service already took it (a sender that answers at once). `ref` is the id the service gave it, when it gave one (Gmail's message id). */
  | { kind: 'accepted'; ref?: string }
  /** This exact request is already in the outbox (another press, another device, a reload). Nothing new was written. */
  | { kind: 'duplicate' }
  /** Definitely not sent. */
  | { kind: 'rejected'; reason: ReasonClass }
  /** Ledger cannot tell whether it arrived (a lost reply, a dropped connection). */
  | { kind: 'unknown' };

export type RemoteStatus =
  | { kind: 'not-in-outbox' }
  | { kind: 'pending' }
  | { kind: 'accepted' }
  | { kind: 'failed'; reason: ReasonClass };

export interface NoticeTransport {
  id: string;
  label: string;
  /** False for anything that does not really send mail (the test sender). The screens never call a non-live result "sent". */
  live: boolean;
  /**
   * True when the service itself refuses a repeat of the same request (a create-only outbox file). False for a service that cannot (Gmail): the sender
   * code then records a claim on the attempt before submitting, so another tab or press cannot send it twice.
   */
  serverDedupe: boolean;
  submit(req: OutboxRequest): Promise<SubmitOutcome>;
  /** Absent when the service offers no way to ask (Gmail, with only the send permission). The screens never offer "Check status" without it. */
  status?(id: string): Promise<RemoteStatus>;
}

// ---- the one place the app asks "can I send?" ----

let current: NoticeTransport | null = null;
/** The sender to use right now, or null when sending is not connected: Gmail while it is authorised, otherwise nothing (tests and the dev switch can install a stand-in). */
export const getTransport = (): NoticeTransport | null => current ?? gmailTransportIfConnected();
/** Tests and the development-only switch install a transport here. No screen does. */
export function setTransport(t: NoticeTransport | null): void { current = t; }

// ---- a sender that sends nothing (tests, and a development-only switch) ----

export type FakeMode = 'accept' | 'queue' | 'reject' | 'unreachable' | 'lost-reply' | 'quota';

export interface FakeTransport extends NoticeTransport {
  mode: FakeMode;
  /** Every request that reached the fake outbox, in order, once per id. */
  outbox: OutboxRequest[];
  /** How many times `submit` was called (including repeats). */
  calls: number;
  /** Marks a queued request accepted or failed, as the real sender's result file would. */
  settle(id: string, to: 'accepted' | { failed: ReasonClass }): void;
}

export function fakeTransport(mode: FakeMode = 'accept'): FakeTransport {
  const files = new Map<string, OutboxRequest>();
  const results = new Map<string, OutboxResult>();
  const t: FakeTransport = {
    id: 'fake', label: 'Test sender (nothing is really sent)', live: false, serverDedupe: true, mode, outbox: [], calls: 0,
    async submit(req) {
      t.calls++;
      if (t.mode === 'unreachable') return { kind: 'unknown' }; // could not even connect: the caller cannot tell either
      if (files.has(req.id)) return { kind: 'duplicate' };
      if (t.mode === 'reject') return { kind: 'rejected', reason: 'address-rejected' };
      if (t.mode === 'quota') return { kind: 'rejected', reason: 'quota' };
      files.set(req.id, req);
      t.outbox.push(req);
      if (t.mode === 'lost-reply') return { kind: 'unknown' }; // it arrived, but the answer was lost
      if (t.mode === 'accept') { results.set(req.id, { v: 1, id: req.id, state: 'accepted' }); return { kind: 'accepted' }; }
      return { kind: 'queued' };
    },
    async status(id) {
      const r = results.get(id);
      if (r) return r.state === 'accepted' ? { kind: 'accepted' } : { kind: 'failed', reason: r.reason ?? 'unknown' };
      return files.has(id) ? { kind: 'pending' } : { kind: 'not-in-outbox' };
    },
    settle(id, to) {
      results.set(id, to === 'accepted' ? { v: 1, id, state: 'accepted' } : { v: 1, id, state: 'failed', reason: to.failed });
    },
  };
  return t;
}

// ---- the real outbox writer (GitHub contents API). UNVERIFIED against a live repository; nothing uses it yet. ----

export interface OutboxRepoConfig { owner: string; repo: string; token: string; }
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Writes one request file and reads one result file through GitHub's contents API. Creating a file that already exists is refused by GitHub
 * (a missing `sha` is an error), which is what makes a repeat harmless. The token travels only in the Authorization header: never in a URL, a log
 * line or an error message, and this code never reads or stores it anywhere else. Verified against GitHub's documentation only.
 */
export function githubOutboxTransport(cfg: OutboxRepoConfig, f: typeof fetch = (...a) => fetch(...a)): NoticeTransport {
  if (!NAME.test(cfg.owner) || !NAME.test(cfg.repo)) throw new Error('The outbox repository name is not valid.');
  const base = `/repos/${cfg.owner}/${cfg.repo}/contents`;
  const call = (path: string, init: RequestInit = {}) =>
    f(`https://api.github.com${base}/${path}`, {
      ...init, cache: 'no-store', credentials: 'omit',
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    });
  const reasonFor = (status: number, limited: boolean): ReasonClass => (limited ? 'quota' : status === 401 ? 'unauthorized' : 'service-refused');
  return {
    id: 'github-outbox', label: 'Private outbox repository', live: true, serverDedupe: true,
    async submit(req) {
      if (!isTransportId(req.id)) return { kind: 'rejected', reason: 'unknown' };
      let res: Response;
      try {
        res = await call(requestPath(req.id), { method: 'PUT', body: JSON.stringify({ message: 'notice request', content: toB64(utf8(encodeRequest(req))) }) });
      } catch { return { kind: 'unknown' }; } // never reached GitHub, or the answer was lost: cannot tell
      if (res.status === 201 || res.status === 200) return { kind: 'queued' };
      if (res.status === 409 || res.status === 422) return { kind: 'duplicate' };
      if (res.status >= 500) return { kind: 'unknown' };
      const limited = res.status === 429 || (res.status === 403 && (res.headers.get('x-ratelimit-remaining') === '0' || !!res.headers.get('retry-after')));
      return { kind: 'rejected', reason: reasonFor(res.status, limited) };
    },
    async status(id) {
      if (!isTransportId(id)) return { kind: 'not-in-outbox' };
      let res: Response;
      try { res = await call(resultPath(id)); } catch { return { kind: 'pending' }; }
      if (res.status === 200) {
        try {
          const body = (await res.json()) as { content?: unknown; encoding?: unknown };
          if (body.encoding === 'base64' && typeof body.content === 'string') {
            const parsed = parseResult(new TextDecoder().decode(Uint8Array.from(atob(body.content.replace(/\s/g, '')), (c) => c.charCodeAt(0))));
            if (parsed) return parsed.state === 'accepted' ? { kind: 'accepted' } : { kind: 'failed', reason: parsed.reason ?? 'unknown' };
          }
        } catch { /* unreadable result: treated as still pending, never as sent */ }
        return { kind: 'pending' };
      }
      if (res.status !== 404) return { kind: 'pending' };
      try {
        const r = await call(requestPath(id));
        return r.status === 404 ? { kind: 'not-in-outbox' } : { kind: 'pending' };
      } catch { return { kind: 'pending' }; }
    },
  };
}
