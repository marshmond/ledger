/**
 * CAL-N1: what each state is called on screen. One place, so the composer, the Messages list and the tests all say the same thing, and nothing ever
 * claims more than is known: the strongest word is "accepted by the mail service", never "delivered" or "read".
 */
import { REASON_WORDS, type RequestView } from './records';

/** A short label for a badge. */
export function statusLabel(v: Pick<RequestView, 'state' | 'transport'>, connected: boolean): string {
  switch (v.state) {
    case 'confirmed': return connected ? 'Approved' : 'Approved, not sent';
    case 'queued': return 'Waiting';
    case 'accepted': return v.transport?.live === true ? 'Accepted by mail service' : v.transport ? 'Accepted by test sender' : 'Accepted (sender unknown)';
    case 'failed': return 'Not sent';
    case 'unknown': return 'Outcome unknown';
  }
}

/** One plain sentence about where a message stands. */
export function statusWords(v: Pick<RequestView, 'state' | 'transport' | 'reason' | 'duplicateRisk'>, connected: boolean): string {
  switch (v.state) {
    case 'confirmed': return connected ? 'Approved. It has not been handed to the sender yet.' : 'Approved. Email sending is not connected yet, so nothing has been sent.';
    case 'queued': return 'Handed to the sender. The mail service has not confirmed it yet.';
    case 'accepted': return v.transport?.live === true
      ? 'Accepted by the mail service. Ledger cannot tell whether it reached an inbox.'
      : v.transport ? 'Accepted by the test sender. Nothing was really sent.'
      : 'Marked accepted, but Ledger did not record which sender handled it, so nothing shows it was really sent.';
    case 'failed': return `Not sent. ${REASON_WORDS[v.reason ?? 'unknown']}`;
    case 'unknown': return 'Ledger cannot tell whether this was sent. Sending it again could send a second copy.';
  }
}

export const RETRY_WARNING = 'This may send a second copy. The first attempt might already have reached the mail service.';

/** "Mon, Nov 16, 2:05 PM" in the device's own style (display only). */
export const whenSent = (ms: number) => new Date(ms).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** The device's time zone in words for a given moment ("Eastern Standard Time"), so a message says which zone its times are in. */
export function zoneLabelFor(ms: number): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZoneName: 'long' }).formatToParts(new Date(Number.isFinite(ms) && ms > 0 ? ms : Date.now())).find((p) => p.type === 'timeZoneName');
    return part?.value || 'your local time';
  } catch { return 'your local time'; }
}
