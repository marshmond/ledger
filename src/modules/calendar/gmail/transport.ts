/**
 * CAL-G1: sends ONE notification message through Gmail. A `NoticeTransport` like the others, with three honest differences:
 *
 *  - Gmail has no "create only if new" rule, so Gmail cannot refuse a repeat. `serverDedupe` is false, and the sender code (notify/send.ts) therefore
 *    writes a claim on the attempt BEFORE this runs, so a second tab or a second press can never send the same attempt twice.
 *  - There is no way to ask Gmail what became of a message with only the send permission (that would need permission to read mail, which Ledger
 *    does not ask for), so this transport has no `status`, and the screens never offer "Check status" for it.
 *  - The strongest thing Gmail can tell Ledger is "accepted" with a message id. Delivery, opening and bounces are invisible to Ledger.
 *
 * The access token is read at the moment of sending (never kept here), travels only in the Authorization header, and appears in no URL, log line or
 * error text: every failure is turned into a fixed plain-words reason class.
 */
import type { NoticeTransport, OutboxRequest, SubmitOutcome } from '../notify/transport';
import type { ReasonClass } from '../notify/types';
import { GMAIL_SEND_URL } from './config';
import { gmailAccessToken, markGmailExpired } from './auth';
import { buildRaw } from './mime';

export const SEND_TIMEOUT_MS = 30_000;

export interface GmailDeps {
  fetch?: typeof fetch;
  token?: () => string | null;
  online?: () => boolean;
  /** Called when Gmail says the token is no good, so the screens ask to reconnect. */
  onUnauthorized?: () => void;
  timeoutMs?: number;
}

const rejected = (reason: ReasonClass): SubmitOutcome => ({ kind: 'rejected', reason });
const QUOTA_REASON = /^(rateLimitExceeded|userRateLimitExceeded|dailyLimitExceeded|quotaExceeded|sendLimitExceeded)$/i;

/**
 * What an error answer from Gmail means for Ledger. Pure. A server fault (5xx) or a timeout is "unknown", never "failed": Gmail may well have
 * accepted the message before the fault, and saying "not sent" could lead to a second copy.
 */
export function outcomeForError(status: number, reason: string, message: string): SubmitOutcome {
  if (status === 401) return rejected('unauthorized');
  if (status === 429) return rejected('quota');
  if (status === 403) {
    if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason) || /has not been used in project|is disabled|enable it by visiting/i.test(message)) return rejected('api-disabled');
    if (/insufficient|SCOPE_INSUFFICIENT/i.test(reason) || /insufficient (authentication )?scopes?/i.test(message)) return rejected('unauthorized');
    if (QUOTA_REASON.test(reason) || /rate limit|quota|limit exceeded/i.test(message)) return rejected('quota');
    return rejected('service-refused');
  }
  if (status === 400) return /invalid to header|recipient|address/i.test(message) ? rejected('address-rejected') : rejected('service-refused');
  if (status === 408 || status >= 500) return { kind: 'unknown' };
  if (status >= 400) return rejected('service-refused');
  return { kind: 'unknown' };
}

/** Pulls the machine-readable reason and the message out of Gmail's error body, if it has one. Used only to choose a reason class; never shown. */
function errorParts(body: unknown): { reason: string; message: string } {
  const e = (body && typeof body === 'object' ? (body as { error?: unknown }).error : null) as { message?: unknown; status?: unknown; errors?: unknown; details?: unknown } | null;
  if (!e || typeof e !== 'object') return { reason: '', message: '' };
  const first = Array.isArray(e.errors) ? (e.errors[0] as { reason?: unknown } | undefined) : undefined;
  const detail = Array.isArray(e.details) ? (e.details as { reason?: unknown }[]).find((d) => d && typeof d.reason === 'string') : undefined;
  const reason = typeof first?.reason === 'string' ? first.reason : typeof detail?.reason === 'string' ? detail.reason : typeof e.status === 'string' ? e.status : '';
  return { reason, message: typeof e.message === 'string' ? e.message : '' };
}

export function gmailTransport(deps: GmailDeps = {}): NoticeTransport {
  const f: typeof fetch = deps.fetch ?? ((...a) => fetch(...a));
  return {
    id: 'gmail', label: 'Gmail', live: true, serverDedupe: false,
    async submit(req: OutboxRequest): Promise<SubmitOutcome> {
      let raw: string;
      try { raw = buildRaw({ to: req.to, subject: req.subject, text: req.text, replyTo: req.from.replyTo }); } catch { return rejected('address-rejected'); } // never reached Gmail
      const token = (deps.token ?? gmailAccessToken)();
      if (!token) return rejected('unauthorized');
      if ((deps.online ? deps.online() : (globalThis as { navigator?: { onLine?: boolean } }).navigator?.onLine) === false) return rejected('offline');

      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), deps.timeoutMs ?? SEND_TIMEOUT_MS);
      // The time limit covers reading the answer too (a stalled body must not leave the screen waiting forever), whatever the browser does with the abort.
      const timedOut = new Promise<never>((_resolve, reject) => ctl.signal.addEventListener('abort', () => reject(new Error('timed out'))));
      timedOut.catch(() => undefined);
      const readJson = (r: Response): Promise<unknown> => Promise.race([r.json() as Promise<unknown>, timedOut]);
      try {
        let res: Response;
        try {
          res = await f(GMAIL_SEND_URL, {
            method: 'POST', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl.signal,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ raw }),
          });
        } catch { return { kind: 'unknown' }; } // the connection dropped or timed out: Gmail may or may not have it
        if (res.ok) {
          let id = '';
          try { const b = (await readJson(res)) as { id?: unknown } | null; id = typeof b?.id === 'string' ? b.id : ''; } catch { /* no readable answer */ }
          return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? { kind: 'accepted', ref: id } : { kind: 'unknown' }; // success without a message id is not a confirmation
        }
        let parts = { reason: '', message: '' };
        try { parts = errorParts(await readJson(res)); } catch { /* an error with no readable body is still an error */ }
        const out = outcomeForError(res.status, parts.reason, parts.message);
        if (out.kind === 'rejected' && out.reason === 'unauthorized') (deps.onUnauthorized ?? markGmailExpired)();
        return out;
      } catch { return { kind: 'unknown' }; } finally { clearTimeout(timer); }
    },
  };
}

const shared = gmailTransport();
/** The Gmail sender, but only while Gmail is authorised right now; null otherwise (so nothing offers to send). */
export const gmailTransportIfConnected = (): NoticeTransport | null => (gmailAccessToken() ? shared : null);
