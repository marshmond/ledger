/**
 * CAL-N1: deterministic identities, so the same notification can never be sent twice by accident.
 *
 *   noticeKey   one CHANGE to one event (which event, which part of it, what it looked like before and after, what the owner chose to disclose).
 *               The same change always gives the same key on every device. The owner's personal note is NOT part of it, so retyping the note and
 *               pressing Send again is still "the same notification".
 *   requestId   one message to one address about one change: SHA-256(noticeKey | address). This is the unit that is sent at most once. The same
 *               person is never emailed twice about the same change, even if the owner picks a different group the second time.
 *   transportId what the outbox file is called. The first attempt uses the requestId; a deliberate manual retry adds ".a2", ".a3". Pressing Send
 *               twice, reopening a dialog, a second device and a reload all derive the SAME id, so the outbox refuses the copy.
 *   noticeId    one Send press: the key plus its (requestId, attempt) pairs.
 */
import { canonicalJson, sha256Hex } from '../../../display/contract';
import { isSeriesMode, stateText } from './facts';
import type { NoticeSubject } from './types';

export interface DisclosureFlags { includeLocation: boolean; includePeople: boolean }

/** The thing a message is checked against before it is sent: a digest of what it says, or "cancelled" for a cancellation. */
export async function expectedState(s: NoticeSubject, flags: DisclosureFlags): Promise<string> {
  return s.kind === 'cancelled' ? 'cancelled' : sha256Hex(stateText(s.facts, flags, isSeriesMode(s)));
}

export async function noticeKeyOf(s: NoticeSubject, flags: DisclosureFlags): Promise<string> {
  const series = isSeriesMode(s);
  return sha256Hex(canonicalJson({
    v: 1, eventIds: [...s.eventIds].sort((a, b) => a - b), kind: s.kind, scope: s.scope, affected: s.affectedDate, changes: [...s.changes].sort(),
    after: stateText(s.facts, flags, series), before: s.before ? stateText(s.before, flags, series) : null,
  }));
}

export const requestIdOf = (key: string, email: string) => sha256Hex(`${key}|${email.trim().toLowerCase()}`);
/** The outbox file name stem for an attempt. */
export const transportIdOf = (requestId: string, attempt: number) => (attempt <= 1 ? requestId : `${requestId}.a${attempt}`);

export const noticeIdOf = (key: string, sends: readonly { requestId: string; attempt: number }[]) =>
  sha256Hex(canonicalJson({ key, sends: sends.map((x) => `${x.requestId}:${x.attempt}`).sort() }));

/** A digest of the exact text the owner approved for every recipient. */
export const previewDigestOf = (msgs: readonly { requestId: string; subject: string; text: string }[]) =>
  sha256Hex(canonicalJson(msgs.map((m) => [m.requestId, m.subject, m.text]).sort((a, b) => a[0].localeCompare(b[0]))));
