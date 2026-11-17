/**
 * CAL-N1: notification history. APPEND-ONLY records in the shared `moduleRecords` table (module `calendar`, kind `notice`), so backup, restore and
 * device sync already cover them and nothing about the database changes. A record is added and never edited; the current state of a message is
 * WORKED OUT here from the records, so two devices that each add a record never overwrite each other.
 *
 * Three record types:
 *   declined  the owner chose "Not now". Final: nothing is ever sent from it.
 *   send      the owner pressed Send. Written BEFORE anything is handed over, and holds the exact text approved for each recipient and the
 *             address that was used (so history stays right if a Contact changes later).
 *   progress  what the sender reported or what Ledger could tell, for one message and attempt: queued, accepted, failed or unknown.
 *
 * Reading is defensive: a record this version cannot read is listed as needing review and never counts as sent. The event stays the only authority
 * for the schedule; nothing here is read by the Calendar, Search, the display projection or any other module.
 */
import type { ModuleRecord } from '../../../core/entities';
import { isLive } from '../../../core/store';
import type { NoticeKind, NoticeScope, NoticeState, ReasonClass } from './types';

export const NOTICE_MODULE = 'calendar';
export const NOTICE_KIND = 'notice';

export interface SendRecipient {
  contactId: number;
  name: string;
  email: string;
  requestId: string;
  attempt: number;
  subject: string;
  text: string;
}
interface Common { v: 1; deviceId: string }
export interface DeclineData extends Common { t: 'declined'; noticeKey: string; eventIds: number[]; kind: NoticeKind; scope: NoticeScope; summary: string }
export interface SendData extends Common {
  t: 'send'; noticeKey: string; noticeId: string; eventIds: number[]; factsEventId: number; kind: NoticeKind; scope: NoticeScope; affectedDate: string; summary: string;
  /** What the message was checked against (a digest, or "cancelled"). Re-checked before anything is handed over. */
  expectedState: string;
  flags: { includeLocation: boolean; includePeople: boolean };
  previewDigest: string;
  transport: { id: string; label: string; live: boolean } | null;
  recipients: SendRecipient[];
  /** A manual retry of an earlier send. */
  retryOf?: string;
}
export type ProgressState = 'queued' | 'accepted' | 'failed' | 'unknown';
export interface TransportRef { id: string; label: string; live: boolean }
/** `transport` is the sender that produced this step (so a message approved with no sender and sent later by the test sender is never described as really sent). */
export interface ProgressData extends Common { t: 'progress'; requestId: string; attempt: number; state: ProgressState; reason?: ReasonClass; transport?: TransportRef }
export type NoticeData = DeclineData | SendData | ProgressData;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const KINDS: NoticeKind[] = ['created', 'updated', 'cancelled', 'restored', 'details'];
const SCOPES: NoticeScope[] = ['single', 'one', 'following', 'all'];
const REASONS: ReasonClass[] = ['address-rejected', 'service-refused', 'quota', 'unauthorized', 'stale', 'not-received', 'unknown'];
const ids = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []);

/** Reads one stored record; null when it is not a notice this version understands. Never throws. */
export function readNotice(r: ModuleRecord): NoticeData | null {
  try {
    const d = r.data;
    if (r.module !== NOTICE_MODULE || r.kind !== NOTICE_KIND || !isObj(d) || d.v !== 1) return null;
    const deviceId = str(d.deviceId);
    if (d.t === 'declined') {
      if (!KINDS.includes(d.kind as NoticeKind) || !SCOPES.includes(d.scope as NoticeScope) || !str(d.noticeKey)) return null;
      return { v: 1, deviceId, t: 'declined', noticeKey: str(d.noticeKey), eventIds: ids(d.eventIds), kind: d.kind as NoticeKind, scope: d.scope as NoticeScope, summary: str(d.summary) };
    }
    if (d.t === 'send') {
      if (!KINDS.includes(d.kind as NoticeKind) || !SCOPES.includes(d.scope as NoticeScope) || !str(d.noticeKey) || !Array.isArray(d.recipients)) return null;
      const recipients: SendRecipient[] = [];
      for (const x of d.recipients) {
        if (!isObj(x) || !str(x.requestId) || !str(x.email) || typeof x.attempt !== 'number' || typeof x.contactId !== 'number') return null;
        recipients.push({ contactId: x.contactId, name: str(x.name), email: str(x.email), requestId: str(x.requestId), attempt: x.attempt, subject: str(x.subject), text: str(x.text) });
      }
      const f = isObj(d.flags) ? d.flags : {};
      const tr = isObj(d.transport) && str(d.transport.id) ? { id: str(d.transport.id), label: str(d.transport.label), live: d.transport.live === true } : null;
      return {
        v: 1, deviceId, t: 'send', noticeKey: str(d.noticeKey), noticeId: str(d.noticeId), eventIds: ids(d.eventIds), factsEventId: typeof d.factsEventId === 'number' ? d.factsEventId : 0,
        kind: d.kind as NoticeKind, scope: d.scope as NoticeScope, affectedDate: str(d.affectedDate), summary: str(d.summary), expectedState: str(d.expectedState),
        flags: { includeLocation: f.includeLocation === true, includePeople: f.includePeople === true }, previewDigest: str(d.previewDigest), transport: tr, recipients,
        ...(str(d.retryOf) ? { retryOf: str(d.retryOf) } : {}),
      };
    }
    if (d.t === 'progress') {
      if (!str(d.requestId) || typeof d.attempt !== 'number' || !['queued', 'accepted', 'failed', 'unknown'].includes(str(d.state))) return null;
      const ptr = isObj(d.transport) && str(d.transport.id) ? { id: str(d.transport.id), label: str(d.transport.label), live: d.transport.live === true } : null;
      return { v: 1, deviceId, t: 'progress', requestId: str(d.requestId), attempt: d.attempt, state: str(d.state) as ProgressState, ...(REASONS.includes(d.reason as ReasonClass) ? { reason: d.reason as ReasonClass } : {}), ...(ptr ? { transport: ptr } : {}) };
    }
    return null;
  } catch { return null; }
}

/** How far along a message is. The best-informed record wins: "queued" explains an "unknown", a definite "failed" settles either, and "accepted" beats everything. */
const RANK: Record<LiveState, number> ={ confirmed: 1, unknown: 2, queued: 3, failed: 4, accepted: 5 };

export type LiveState = Exclude<NoticeState, 'declined' | 'drafted'>;
export interface AttemptView { attempt: number; state: LiveState; reason?: ReasonClass; at: number; sendRecordId: number; transport: TransportRef | null }

/** One message to one person about one change, with everything known about it. */
export interface RequestView {
  requestId: string;
  noticeKey: string;
  eventIds: number[];
  factsEventId: number;
  kind: NoticeKind;
  scope: NoticeScope;
  affectedDate: string;
  summary: string;
  recipient: { contactId: number; name: string; email: string };
  /** The overall state: accepted if any attempt was accepted, otherwise the state of the newest attempt. */
  state: LiveState;
  reason?: ReasonClass;
  /** The newest attempt number. */
  attempt: number;
  attempts: AttemptView[];
  subject: string;
  text: string;
  expectedState: string;
  flags: { includeLocation: boolean; includePeople: boolean };
  transport: { id: string; label: string; live: boolean } | null;
  /** When the owner first approved it, and when anything last happened. */
  at: number;
  lastAt: number;
  /** True when an earlier attempt may have gone out (queued, unknown or accepted): another send could be a second copy. */
  duplicateRisk: boolean;
}

export interface NoticeRow { id: number; createdAt: number; data: NoticeData }

export function readRows(rows: readonly ModuleRecord[]): { rows: NoticeRow[]; unreadable: number } {
  const out: NoticeRow[] = [];
  let unreadable = 0;
  for (const r of rows) {
    if (r.module !== NOTICE_MODULE || r.kind !== NOTICE_KIND || !isLive(r)) continue;
    const data = readNotice(r);
    if (data) out.push({ id: r.id as number, createdAt: r.createdAt, data });
    else unreadable++;
  }
  return { rows: out.sort((a, b) => a.createdAt - b.createdAt || a.id - b.id), unreadable };
}

/** Every message that has been approved, folded from the records. Newest first. */
export function foldRequests(rows: readonly NoticeRow[]): RequestView[] {
  const sends = rows.filter((r): r is NoticeRow & { data: SendData } => r.data.t === 'send');
  const progress = rows.filter((r): r is NoticeRow & { data: ProgressData } => r.data.t === 'progress');
  const byRequest = new Map<string, RequestView>();
  for (const s of sends) {
    for (const rc of s.data.recipients) {
      const mine = progress.filter((p) => p.data.requestId === rc.requestId && p.data.attempt === rc.attempt);
      let state: LiveState = 'confirmed';
      let reason: ReasonClass | undefined;
      let used: TransportRef | null = s.data.transport;
      let at = s.createdAt;
      for (const p of mine) {
        if (RANK[p.data.state] > RANK[state] || (RANK[p.data.state] === RANK[state] && p.createdAt > at)) { state = p.data.state; reason = p.data.reason; if (p.data.transport) used = p.data.transport; }
        at = Math.max(at, p.createdAt);
      }
      const attempt: AttemptView = { attempt: rc.attempt, state, ...(reason ? { reason } : {}), at, sendRecordId: s.id, transport: used };
      const prev = byRequest.get(rc.requestId);
      const view: RequestView = prev ?? {
        requestId: rc.requestId, noticeKey: s.data.noticeKey, eventIds: s.data.eventIds, factsEventId: s.data.factsEventId, kind: s.data.kind, scope: s.data.scope,
        affectedDate: s.data.affectedDate, summary: s.data.summary, recipient: { contactId: rc.contactId, name: rc.name, email: rc.email }, state: 'confirmed', attempt: rc.attempt,
        attempts: [], subject: rc.subject, text: rc.text, expectedState: s.data.expectedState, flags: s.data.flags, transport: s.data.transport, at: s.createdAt, lastAt: at, duplicateRisk: false,
      };
      // The same attempt can be written twice (two devices): keep the strongest evidence for it.
      const same = view.attempts.find((a) => a.attempt === rc.attempt);
      if (same) {
        if (RANK[attempt.state] > RANK[same.state]) Object.assign(same, attempt);
      } else view.attempts.push(attempt);
      if (rc.attempt >= view.attempt) {
        // The newest attempt supplies the text that would be sent again and the checks it was approved with.
        Object.assign(view, { attempt: rc.attempt, subject: rc.subject, text: rc.text, expectedState: s.data.expectedState, flags: s.data.flags, transport: s.data.transport, summary: s.data.summary });
      }
      view.at = Math.min(view.at, s.createdAt);
      view.lastAt = Math.max(view.lastAt, at);
      byRequest.set(rc.requestId, view);
    }
  }
  for (const v of byRequest.values()) {
    v.attempts.sort((a, b) => a.attempt - b.attempt);
    const accepted = v.attempts.find((a) => a.state === 'accepted');
    const newest = v.attempts[v.attempts.length - 1];
    const shown = accepted ?? newest;
    v.state = shown.state;
    v.reason = shown.reason;
    v.transport = shown.transport;
    v.duplicateRisk = v.attempts.slice(0, -1).some((a) => a.state === 'queued' || a.state === 'unknown' || a.state === 'accepted') || (v.state === 'unknown' && v.attempts.length > 0);
  }
  return [...byRequest.values()].sort((a, b) => b.at - a.at);
}

/** The noticeKeys the owner declined. */
export const declinedKeys = (rows: readonly NoticeRow[]): Set<string> => new Set(rows.flatMap((r) => (r.data.t === 'declined' ? [r.data.noticeKey] : [])));

/** A message that is on its way or already done: sending it again is not a retry, it is a duplicate. */
export const isInFlight = (v: Pick<RequestView, 'state'>) => v.state !== 'failed';

/** Messages the owner approved in the last 24 hours (the daily limit counts what was approved, not what arrived). */
export function approvedSince(rows: readonly NoticeRow[], since: number): number {
  return rows.reduce((n, r) => (r.data.t === 'send' && r.createdAt >= since ? n + r.data.recipients.length : n), 0);
}

/** Plain-words reason for a message that was not sent. */
export const REASON_WORDS: Record<ReasonClass, string> = {
  'address-rejected': 'The email address was refused.',
  'service-refused': 'The mail service refused the message.',
  quota: 'The daily sending limit was reached.',
  unauthorized: 'Ledger is not allowed to use the sender. The key may have expired.',
  stale: 'The event changed after you approved this message, so it was not sent. Review it again.',
  'not-received': 'The sender never received it.',
  unknown: 'The sender did not say why.',
};
