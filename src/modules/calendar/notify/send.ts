/**
 * CAL-N1: the only code that records an approval or hands a message to a transport. Every entry point here is called from a button the owner pressed
 * (Send, Send now, Try again, Check status, Not now): none runs from Save, Undo, sync or start-up, and there is no timer and no retry loop.
 *
 * Order of events for one Send press:
 *   1. work out each message and its deterministic id (async hashing, BEFORE any database transaction);
 *   2. in ONE transaction, re-read the history and refuse anything already on its way, then write the `send` record (the owner's approval and the
 *      exact text). A double press, a reopened dialog or a second tab finds that record and sends nothing new;
 *   3. only then hand each message to the transport, check once that the event still matches what was approved, and write what happened.
 * A failure at step 3 never changes the event, the Contact or any other record.
 */
import { db, type FinanceDB } from '../../../db';
import type { ModuleRecord } from '../../../core/entities';
import { isLive, repo } from '../../../core/store';
import { asEvent } from '../model';
import { factsOf } from './facts';
import { isSeriesMode, stateText } from './facts';
import { expectedState, noticeIdOf, noticeKeyOf, previewDigestOf, requestIdOf, transportIdOf, type DisclosureFlags } from './identity';
import { MAX_PER_DAY, MAX_RECIPIENTS, type RecipientRow } from './recipients';
import {
  approvedSince, declinedKeys, foldRequests, isInFlight, NOTICE_KIND, NOTICE_MODULE, readRows,
  type NoticeRow, type ProgressData, type ProgressState, type RequestView, type SendData, type SendRecipient,
} from './records';
import { namesOf } from './offers';
import { loadNoticeSettings } from './settings';
import { sha256Hex } from '../../../display/contract';
import type { NoticeTransport, OutboxRequest } from './transport';
import { summaryOf, buildMessage } from './wording';
import type { MessageOptions, NoticeSubject, ReasonClass } from './types';

/** Random per page load. Shown nowhere; an audit aid only. */
const DEVICE = Math.random().toString(36).slice(2, 10);
const DAY = 86_400_000;

export async function loadNoticeRows(d: FinanceDB = db) {
  return readRows(await d.moduleRecords.where('[module+kind]').equals([NOTICE_MODULE, NOTICE_KIND]).toArray());
}
export async function loadRequests(d: FinanceDB = db): Promise<RequestView[]> {
  return foldRequests((await loadNoticeRows(d)).rows);
}

async function add(d: FinanceDB, data: object): Promise<number> {
  return repo<ModuleRecord>(d.moduleRecords).put({ module: NOTICE_MODULE, kind: NOTICE_KIND, data: { v: 1, deviceId: DEVICE, ...data } });
}

// ---------- preparing the text ----------

export interface PreparedItem {
  row: RecipientRow;
  requestId: string;
  attempt: number;
  subject: string;
  text: string;
  /** `new`: not told yet. `retry`: an earlier attempt failed. `already`: on its way or done, so it is never sent again. */
  status: 'new' | 'retry' | 'already';
  existing?: RequestView;
}
export interface Prepared {
  noticeKey: string;
  expected: string;
  flags: DisclosureFlags;
  items: PreparedItem[];
  previewDigest: string;
  summary: string;
}

/** The exact message for each chosen person, and what is already known about it. Pure given the history. */
export async function prepare(subject: NoticeSubject, chosen: readonly RecipientRow[], options: MessageOptions, history: readonly RequestView[]): Promise<Prepared> {
  const flags = { includeLocation: options.includeLocation, includePeople: options.includePeople };
  const noticeKey = await noticeKeyOf(subject, flags);
  const expected = await expectedState(subject, flags);
  const byId = new Map(history.map((h) => [h.requestId, h]));
  const items: PreparedItem[] = [];
  for (const row of chosen) {
    const requestId = await requestIdOf(noticeKey, row.email);
    const m = buildMessage(subject, options, row.name);
    const existing = byId.get(requestId);
    const status: PreparedItem['status'] = existing ? (isInFlight(existing) ? 'already' : 'retry') : 'new';
    items.push({ row, requestId, attempt: existing && status === 'retry' ? existing.attempt + 1 : existing ? existing.attempt : 1, subject: m.subject, text: m.text, status, ...(existing ? { existing } : {}) });
  }
  return { noticeKey, expected, flags, items, previewDigest: await previewDigestOf(items.map((i) => ({ requestId: i.requestId, subject: i.subject, text: i.text }))), summary: summaryOf(subject, options.today) };
}

// ---------- Not now ----------

/** "Not now": recorded, final, sends nothing. A failure to record changes nothing for the owner. */
export async function declineOffer(subject: NoticeSubject, options: Pick<MessageOptions, 'today'>, d: FinanceDB = db): Promise<void> {
  const noticeKey = await noticeKeyOf(subject, { includeLocation: false, includePeople: true });
  await add(d, { t: 'declined', noticeKey, eventIds: subject.eventIds, kind: subject.kind, scope: subject.scope, summary: summaryOf(subject, options.today) });
}

// ---------- Send ----------

export type ConfirmResult =
  | { kind: 'recorded'; sendRecordId: number; delivered: boolean; skipped: number }
  | { kind: 'nothing-new' }
  | { kind: 'too-many' }
  | { kind: 'daily-limit'; left: number };

/**
 * The owner pressed Send. Writes the approval first; then (only if a transport exists) hands the messages over. Safe to call twice: the second call
 * finds the first one's record and sends nothing new.
 */
export async function confirmAndSend(
  a: { subject: NoticeSubject; prepared: Prepared; transport: NoticeTransport | null; now?: number }, d: FinanceDB = db,
): Promise<ConfirmResult> {
  const now = a.now ?? Date.now();
  const p = a.prepared;
  if (p.items.length > MAX_RECIPIENTS) return { kind: 'too-many' };
  for (let tries = 0; tries < 3; tries++) {
    const loaded = await loadNoticeRows(d);
    const views = foldRequests(loaded.rows);
    const byId = new Map(views.map((v) => [v.requestId, v]));
    const todo = p.items.flatMap((it) => {
      const v = byId.get(it.requestId);
      if (v && isInFlight(v)) return [];
      return [{ it, attempt: v ? v.attempt + 1 : 1 }];
    });
    if (!todo.length) return { kind: 'nothing-new' };
    const used = approvedSince(loaded.rows, now - DAY);
    if (used + todo.length > MAX_PER_DAY) return { kind: 'daily-limit', left: Math.max(0, MAX_PER_DAY - used) };
    const recipients: SendRecipient[] = todo.map(({ it, attempt }) => ({ contactId: it.row.contactId, name: it.row.name, email: it.row.email, requestId: it.requestId, attempt, subject: it.subject, text: it.text }));
    const noticeId = await noticeIdOf(p.noticeKey, recipients);
    const data: Omit<SendData, 'v' | 'deviceId'> = {
      t: 'send', noticeKey: p.noticeKey, noticeId, eventIds: a.subject.eventIds, factsEventId: a.subject.factsEventId, kind: a.subject.kind, scope: a.subject.scope,
      affectedDate: a.subject.affectedDate, summary: p.summary, expectedState: p.expected, flags: p.flags, previewDigest: p.previewDigest,
      transport: a.transport ? { id: a.transport.id, label: a.transport.label, live: a.transport.live } : null, recipients,
    };
    const planned = todo.map((t) => `${t.it.requestId}:${t.attempt}`).join(',');
    const id = await d.transaction('rw', d.moduleRecords, async () => {
      // Look again inside the transaction: nothing may have slipped in between (a second tab, a second press).
      const again = foldRequests(readRows(await d.moduleRecords.where('[module+kind]').equals([NOTICE_MODULE, NOTICE_KIND]).toArray()).rows);
      const byNow = new Map(again.map((v) => [v.requestId, v]));
      const now2 = p.items.flatMap((it) => { const v = byNow.get(it.requestId); return v && isInFlight(v) ? [] : [`${it.requestId}:${v ? v.attempt + 1 : 1}`]; }).join(',');
      if (now2 !== planned) return null;
      return add(d, data);
    });
    if (id === null) continue;
    let delivered = false;
    if (a.transport) {
      const row = (await loadNoticeRows(d)).rows.find((r) => r.id === id);
      if (row && row.data.t === 'send') { await deliver(d, { ...row, data: row.data }, a.transport); delivered = true; }
    }
    return { kind: 'recorded', sendRecordId: id, delivered, skipped: p.items.length - todo.length };
  }
  return { kind: 'nothing-new' };
}

// ---------- checking before anything leaves ----------

/** Does the event still say what the owner approved? A cancellation is checked the other way round: is it still cancelled? */
export async function stillMatches(send: SendData, d: FinanceDB = db): Promise<boolean> {
  const rec = await d.moduleRecords.get(send.factsEventId);
  const live = rec && rec.module === 'calendar' && rec.kind === 'event' && isLive(rec);
  if (send.kind === 'cancelled') {
    if (!live) return true; // the event is gone: still cancelled
    const data = asEvent(rec!).data;
    if (send.scope === 'one') return data.skipped.includes(send.affectedDate);
    if (send.scope === 'following') return !!data.recurrence && data.recurrence.end.type === 'until' && data.recurrence.end.date < send.affectedDate;
    return false; // single or whole series: the event is live again
  }
  if (!live) return false;
  const data = asEvent(rec!).data;
  const names = await namesOf(d, data.contactIds);
  const facts = send.scope === 'one' ? factsOf(data, send.affectedDate, names) : factsOf(data, null, names);
  const series = isSeriesMode({ kind: send.kind, scope: send.scope, facts });
  return (await sha256Hex(stateText(facts, send.flags, series))) === send.expectedState;
}

export function outboxRequestFor(rc: SendRecipient, send: Pick<SendData, 'kind'>, from: { name: string; replyTo: string }): OutboxRequest {
  return {
    format: 'ledger-notice', v: 1, id: transportIdOf(rc.requestId, rc.attempt), requestId: rc.requestId, attempt: rc.attempt, noticeKind: send.kind,
    from: { name: from.name, replyTo: from.replyTo || null }, to: { name: rc.name, address: rc.email }, subject: rc.subject, text: rc.text,
  };
}

async function progress(d: FinanceDB, rc: { requestId: string; attempt: number }, state: ProgressState, transport: NoticeTransport, reason?: ReasonClass) {
  await add(d, { t: 'progress', requestId: rc.requestId, attempt: rc.attempt, state, transport: { id: transport.id, label: transport.label, live: transport.live }, ...(reason ? { reason } : {}) } satisfies Omit<ProgressData, 'v' | 'deviceId'>);
}


/**
 * Hands the messages of one `send` record that nobody has acted on yet to the transport. If the event no longer matches what was approved, NOTHING
 * is handed over: each message is recorded as failed with the reason "stale", and the owner has to review the new content.
 */
export async function deliver(d: FinanceDB, send: NoticeRow & { data: SendData }, transport: NoticeTransport, only?: string): Promise<void> {
  const views = new Map((await loadRequests(d)).map((v) => [v.requestId, v]));
  const pending = send.data.recipients.filter((rc) => {
    if (only && rc.requestId !== only) return false;
    const v = views.get(rc.requestId);
    const att = v?.attempts.find((x) => x.attempt === rc.attempt);
    return !att || att.state === 'confirmed';
  });
  if (!pending.length) return;
  if (!(await stillMatches(send.data, d))) {
    for (const rc of pending) await progress(d, rc, 'failed', transport, 'stale');
    return;
  }
  const s = await loadNoticeSettings(d);
  const from = { name: s.senderName, replyTo: s.replyTo };
  for (const rc of pending) {
    let out;
    try { out = await transport.submit(outboxRequestFor(rc, send.data, from)); } catch { out = { kind: 'unknown' } as const; }
    if (out.kind === 'queued' || out.kind === 'duplicate') await progress(d, rc, 'queued', transport);
    else if (out.kind === 'accepted') await progress(d, rc, 'accepted', transport);
    else if (out.kind === 'rejected') await progress(d, rc, 'failed', transport, out.reason);
    else await progress(d, rc, 'unknown', transport);
  }
}

/** "Send now" for a message that was approved but not yet handed over (for example, sending was not connected then). The same checks apply. */
export async function sendApproved(requestId: string, transport: NoticeTransport, d: FinanceDB = db): Promise<void> {
  const rows = (await loadNoticeRows(d)).rows;
  const v = foldRequests(rows).find((x) => x.requestId === requestId);
  if (!v || v.state !== 'confirmed') return;
  const send = rows.find((r) => r.id === v.attempts[v.attempts.length - 1].sendRecordId);
  if (send && send.data.t === 'send') await deliver(d, { ...send, data: send.data }, transport, requestId);
}

/**
 * "Try again": a deliberate new attempt of one message with the SAME approved text. Allowed after a definite failure; after an unknown outcome only
 * when the owner has accepted that it may send a second copy. A message that failed because the event changed is never retried: it needs a new review.
 */
export async function retryRequest(a: { requestId: string; transport: NoticeTransport | null; acceptDuplicateRisk?: boolean }, d: FinanceDB = db): Promise<'started' | 'not-allowed' | 'changed'> {
  const loaded = await loadNoticeRows(d);
  const v = foldRequests(loaded.rows).find((x) => x.requestId === a.requestId);
  if (!v) return 'not-allowed';
  if (v.state === 'failed' ? v.reason === 'stale' : !(v.state === 'unknown' && a.acceptDuplicateRisk)) return 'not-allowed';
  const lastSend = loaded.rows.find((r) => r.id === v.attempts[v.attempts.length - 1].sendRecordId);
  if (!lastSend || lastSend.data.t !== 'send') return 'not-allowed';
  const src = lastSend.data;
  const rc = src.recipients.find((x) => x.requestId === v.requestId);
  if (!rc) return 'not-allowed';
  const next: SendRecipient = { ...rc, attempt: v.attempt + 1 };
  const noticeId = await noticeIdOf(src.noticeKey, [next]);
  const id = await d.transaction('rw', d.moduleRecords, async () => {
    const again = foldRequests(readRows(await d.moduleRecords.where('[module+kind]').equals([NOTICE_MODULE, NOTICE_KIND]).toArray()).rows).find((x) => x.requestId === v.requestId);
    if (!again || again.attempt !== v.attempt || again.state !== v.state) return null; // someone else got there first
    const { deviceId: _device, ...rest } = src;
    return add(d, { ...rest, noticeId, recipients: [next], retryOf: src.noticeId });
  });
  if (id === null) return 'changed';
  if (a.transport) {
    const row = (await loadNoticeRows(d)).rows.find((r) => r.id === id);
    if (row && row.data.t === 'send') await deliver(d, { ...row, data: row.data }, a.transport);
  }
  return 'started';
}

/** "Check status": asks the transport what became of messages that are waiting or uncertain. One pass, on request only. Returns how many changed. */
export async function refreshStatuses(transport: NoticeTransport, d: FinanceDB = db): Promise<number> {
  let changed = 0;
  for (const v of await loadRequests(d)) {
    if (v.state !== 'queued' && v.state !== 'unknown') continue;
    let s;
    try { s = await transport.status(transportIdOf(v.requestId, v.attempt)); } catch { continue; }
    const rc = { requestId: v.requestId, attempt: v.attempt };
    if (s.kind === 'accepted') { await progress(d, rc, 'accepted', transport); changed++; }
    else if (s.kind === 'failed') { await progress(d, rc, 'failed', transport, s.reason); changed++; }
    else if (s.kind === 'pending' && v.state === 'unknown') { await progress(d, rc, 'queued', transport); changed++; }
    else if (s.kind === 'not-in-outbox' && v.state === 'unknown') { await progress(d, rc, 'failed', transport, 'not-received'); changed++; }
  }
  return changed;
}

/** Everyone who was told (or may have been told) about this cancellation: used to offer a correction after Undo. */
export async function toldAboutCancellation(eventId: number, scope: string, affectedDate: string, d: FinanceDB = db): Promise<{ contactIds: number[]; names: string[] }> {
  const views = (await loadRequests(d)).filter((v) => v.kind === 'cancelled' && v.eventIds.includes(eventId) && v.scope === scope && v.affectedDate === affectedDate && (v.state === 'queued' || v.state === 'accepted' || v.state === 'unknown'));
  return { contactIds: [...new Set(views.map((v) => v.recipient.contactId))], names: views.map((v) => v.recipient.name) };
}

export { declinedKeys };
