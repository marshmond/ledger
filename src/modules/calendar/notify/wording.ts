/**
 * CAL-N1: the words of a notification. Pure and deterministic: the same subject and options always give the same text, on every device.
 *
 * The message is built ONLY from `EventFacts`, which has no field for notes, tags, priority, reminders, project, amounts or other events, so none of
 * those can appear. Location and the names of people involved appear only when the owner left them on for this message. Every recipient gets their
 * own message (a greeting with their own first name); no message mentions another recipient or any address.
 *
 * Wording follows the seven recurring-event cases of CS-0 J.5, using the event's real repeat rule and real dates (never the title).
 */
import { dayOfWeek } from '../../../lib/dates';
import { describeRule, type Recurrence } from '../../../core/recurrence';
import { WEEKDAYS_LONG, WEEKDAYS_SHORT } from '../time';
import { isSeriesMode } from './facts';
import type { BuiltMessage, EventFacts, MessageOptions, NoticeSubject } from './types';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Wednesday, November 18" (a year is added when it is not this year). */
export function longDate(iso: string, today: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${WEEKDAYS_LONG[dayOfWeek(iso)]}, ${MONTHS[m - 1]} ${d}${y !== Number(today.slice(0, 4)) ? `, ${y}` : ''}`;
}
/** "Wed, Nov 18" */
export function shortDate(iso: string, today: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${WEEKDAYS_SHORT[dayOfWeek(iso)]}, ${MONTHS[m - 1].slice(0, 3)} ${d}${y !== Number(today.slice(0, 4)) ? `, ${y}` : ''}`;
}
/** "November 18" */
const monthDay = (iso: string, today: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}${y !== Number(today.slice(0, 4)) ? `, ${y}` : ''}`;
};

/** "5:00 PM", from the device's local clock (the same clock the Calendar uses). */
export function clock(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours(), m = d.getMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function plural(n: number, one: string, many: string) { return `${n} ${n === 1 ? one : many}`; }

/** "1 hour 30 minutes", "45 minutes", "3 days" (all-day). */
export function lengthText(f: EventFacts): string {
  if (f.allDay) {
    const days = Math.round((Date.parse(`${f.lastDay}T00:00:00Z`) - Date.parse(`${f.firstDay}T00:00:00Z`)) / 86_400_000) + 1;
    return days <= 1 ? 'All day' : plural(days, 'day', 'days');
  }
  const mins = Math.max(0, Math.round((f.endMs - f.startMs) / 60_000));
  if (mins === 0) return 'No set length';
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h >= 24 && m === 0 && h % 24 === 0) return plural(h / 24, 'day', 'days');
  return [h ? plural(h, 'hour', 'hours') : '', m ? plural(m, 'minute', 'minutes') : ''].filter(Boolean).join(' ');
}

/** The date and time of an event or occurrence in words. */
export function whenText(f: EventFacts, o: Pick<MessageOptions, 'today' | 'zoneLabel'>): string {
  if (f.allDay) {
    return f.lastDay === f.firstDay
      ? `${longDate(f.firstDay, o.today)} (all day, no time zone)`
      : `${longDate(f.firstDay, o.today)} to ${longDate(f.lastDay, o.today)} (all day, no time zone)`;
  }
  const same = f.lastDay === f.firstDay;
  return same
    ? `${longDate(f.firstDay, o.today)}, ${clock(f.startMs)} to ${clock(f.endMs)} (${o.zoneLabel})`
    : `${longDate(f.firstDay, o.today)}, ${clock(f.startMs)} to ${longDate(f.lastDay, o.today)}, ${clock(f.endMs)} (${o.zoneLabel})`;
}

/** Only the clock part, for "the time changed" lines. */
const timeOnly = (f: EventFacts) => (f.allDay ? 'all day' : `${clock(f.startMs)} to ${clock(f.endMs)}`);

/** "Every week on Wednesday" in full words, with the end spelled out. */
export function repeatText(r: Recurrence, start: string, today: string): string {
  const n = Math.max(1, r.interval || 1);
  let s: string;
  if (r.freq === 'weekly') {
    const days = (r.byWeekday?.length ? [...r.byWeekday].sort((a, b) => a - b) : [dayOfWeek(start)]).map((d) => WEEKDAYS_LONG[d]);
    const list = days.length <= 1 ? days.join('') : `${days.slice(0, -1).join(', ')} and ${days[days.length - 1]}`;
    s = `${n === 1 ? 'Every week' : `Every ${n} weeks`} on ${list}`;
  } else {
    s = describeRule({ ...r, end: { type: 'never' } }, start);
  }
  if (r.end.type === 'until') s += `, until ${longDate(r.end.date, today)}`;
  else if (r.end.type === 'count') s += `, ${plural(r.end.count, 'time', 'times')} in all`;
  return s;
}

const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\r\n?/g, '\n').trim();
export const PERSONAL_MAX = 500;
/** The owner's own note, tidied: no control characters, at most 500 characters. */
export const tidyPersonal = (s: string) => clean(s).slice(0, PERSONAL_MAX);

const titleOf = (f: EventFacts) => f.title.trim() || '(untitled event)';

/** A short line for lists ("Updated: this date only (Wed, Nov 18): the time"). Contains no times or places. */
export function summaryOf(s: NoticeSubject, today: string): string {
  const day = s.affectedDate ? shortDate(s.affectedDate, today) : '';
  const what: Record<string, string> = { title: 'the name', date: 'the date', time: 'the time', allDay: 'all-day setting', location: 'the place', recurrence: 'the repeat', people: 'the people' };
  const changed = s.changes.map((c) => what[c]).join(', ');
  switch (s.kind) {
    case 'created': return `New: ${titleOf(s.facts)}`;
    case 'updated':
      return s.scope === 'one' ? `Updated ${day} only${changed ? `: ${changed}` : ''}`
        : s.scope === 'following' ? `Updated from ${day} on${changed ? `: ${changed}` : ''}`
        : `Updated${s.scope === 'all' ? ' (whole series)' : ''}${changed ? `: ${changed}` : ''}`;
    case 'cancelled':
      return s.scope === 'one' ? `Cancelled ${day} only` : s.scope === 'following' ? `Cancelled from ${day} on` : s.scope === 'all' ? 'Cancelled: the whole series' : `Cancelled: ${titleOf(s.facts)}`;
    case 'restored':
      return s.scope === 'one' ? `Correction: back on ${day}` : s.scope === 'following' ? `Correction: back on from ${day} on` : 'Correction: back on';
    case 'details': return 'Current details';
  }
}

/** What is different, line by line (the "was" values are shown only for things the owner chose to disclose). */
function changeLines(s: NoticeSubject, o: MessageOptions): string[] {
  const b = s.before;
  const a = s.facts;
  const lines: string[] = [];
  for (const c of s.changes) {
    switch (c) {
      case 'title': lines.push(`Name: now "${titleOf(a)}"${b ? ` (was "${titleOf(b)}")` : ''}`); break;
      case 'allDay': lines.push(a.allDay ? 'Now an all-day event' : `No longer all day: now ${timeOnly(a)}`); break;
      case 'date':
        lines.push(`Date: now ${a.lastDay === a.firstDay || !a.allDay ? longDate(a.firstDay, o.today) : `${longDate(a.firstDay, o.today)} to ${longDate(a.lastDay, o.today)}`}${b ? ` (was ${b.lastDay === b.firstDay || !b.allDay ? longDate(b.firstDay, o.today) : `${longDate(b.firstDay, o.today)} to ${longDate(b.lastDay, o.today)}`})` : ''}`);
        break;
      case 'time': lines.push(`Time: now ${timeOnly(a)}${b ? ` (was ${timeOnly(b)})` : ''}`); break;
      case 'location':
        if (o.includeLocation) lines.push(a.location.trim() ? `Place: now ${a.location.trim()}${b && b.location.trim() ? ` (was ${b.location.trim()})` : ''}` : 'Place: removed');
        else lines.push('The place has changed.');
        break;
      case 'recurrence':
        lines.push(a.recurrence ? `Repeats: now ${repeatText(a.recurrence, a.seriesStart, o.today)}${b ? ` (was ${b.recurrence ? repeatText(b.recurrence, b.seriesStart, o.today) : 'it did not repeat'})` : ''}` : `It no longer repeats${b?.recurrence ? ` (it was: ${repeatText(b.recurrence, b.seriesStart, o.today)})` : ''}.`);
        break;
      case 'people':
        if (o.includePeople) lines.push(a.people.length ? `People involved: now ${a.people.join(', ')}` : 'People involved: none listed now');
        else lines.push('The people involved have changed.');
        break;
    }
  }
  return lines;
}

/** One sentence about which dates the notice covers. */
function scopeSentence(s: NoticeSubject, o: MessageOptions): string {
  const t = titleOf(s.facts);
  const day = s.affectedDate ? longDate(s.affectedDate, o.today) : '';
  const from = s.affectedDate ? monthDay(s.affectedDate, o.today) : '';
  const rule = s.facts.recurrence ? repeatText(s.facts.recurrence, s.facts.seriesStart, o.today) : '';
  switch (s.kind) {
    case 'created':
      return s.facts.recurrence ? `New repeating event: ${t}. ${rule}, starting ${longDate(s.facts.seriesStart, o.today)}.` : `New event: ${t}.`;
    case 'updated':
      if (s.scope === 'one') return `${t} has changed for ${day} only. The other dates are unchanged.`;
      if (s.scope === 'following') return `${t} changes from ${from} onward. Dates before ${from} are unchanged.`;
      if (s.scope === 'all') return `${t} has changed for the whole series${rule ? ` (${rule})` : ''}.`;
      return `${t} has changed.`;
    case 'cancelled':
      if (s.scope === 'one') return `Cancelled: ${t} on ${day} only. The other dates are unchanged.`;
      if (s.scope === 'following') return `Cancelled from ${from} onward: ${t}. Dates before ${from} are unchanged.`;
      if (s.scope === 'all') return `Cancelled: the whole series of ${t}${rule ? ` (${rule})` : ''}.`;
      return `Cancelled: ${t}${s.facts.firstDay ? ` on ${longDate(s.facts.firstDay, o.today)}` : ''}.`;
    case 'restored':
      if (s.scope === 'one') return `Correction: ${t} on ${day} is on again. The earlier cancellation no longer applies to that date.`;
      if (s.scope === 'following') return `Correction: ${t} is on again from ${from} onward. The earlier cancellation no longer applies.`;
      if (s.scope === 'all') return `Correction: the series of ${t} is on again. The earlier cancellation no longer applies.`;
      return `Correction: ${t} is on again. The earlier cancellation no longer applies.`;
    case 'details':
      return `Here are the details for ${t}${s.scope === 'one' && day ? ` on ${day}` : ''}.`;
  }
}

/** The subject line. */
export function subjectLine(s: NoticeSubject, today: string): string {
  const t = titleOf(s.facts);
  const day = s.affectedDate ? shortDate(s.affectedDate, today) : shortDate(s.facts.firstDay, today);
  switch (s.kind) {
    case 'created': return `New: ${t}, ${shortDate(s.facts.firstDay, today)}${s.facts.recurrence ? ' (repeats)' : ''}`;
    case 'updated': return s.scope === 'one' ? `Updated: ${t}, ${day} only` : s.scope === 'following' ? `Updated: ${t}, from ${day}` : `Updated: ${t}`;
    case 'cancelled': return s.scope === 'all' ? `Cancelled: ${t} (whole series)` : s.scope === 'following' ? `Cancelled: ${t}, from ${day}` : `Cancelled: ${t}, ${day}`;
    case 'restored': return `Correction: ${t} is on again`;
    case 'details': return `Details: ${t}`;
  }
}

/** The full message for one person. `recipientName` is that person's own name (used only for the greeting). */
export function buildMessage(s: NoticeSubject, o: MessageOptions, recipientName: string): BuiltMessage {
  const f = s.facts;
  const first = clean(recipientName).split(/\s+/)[0] || '';
  const L: string[] = [];
  L.push(first ? `Hi ${first},` : 'Hi,', '');
  L.push(scopeSentence(s, o));
  const changes = s.kind === 'updated' ? changeLines(s, o) : [];
  if (changes.length) L.push('', 'What changed:', ...changes.map((x) => `  - ${x}`));
  L.push('', s.kind === 'cancelled' ? 'What was cancelled:' : 'Details:');
  L.push(`  What: ${titleOf(f)}`);
  const series = isSeriesMode(s);
  // A whole series is described by its time of day and repeat, not by the one date that happened to be open.
  L.push(`  When: ${series ? (f.allDay ? 'All day (no time zone)' : `${timeOnly(f)} (${o.zoneLabel})`) : whenText(f, o)}`);
  if (!f.allDay) L.push(`  Length: ${lengthText(f)}`);
  if (f.recurrence && (series || s.kind === 'details')) {
    const starts = s.kind === 'created' || s.scope === 'following' || f.seriesStart >= o.today ? `, starting ${longDate(f.seriesStart, o.today)}` : '';
    L.push(`  Repeats: ${repeatText(f.recurrence, f.seriesStart, o.today)}${starts}`);
  }
  if (o.includeLocation && f.location.trim()) L.push(`  Where: ${f.location.trim()}`);
  if (o.includePeople && f.people.length) L.push(`  Who: ${f.people.join(', ')}`);
  const note = tidyPersonal(o.personalMessage);
  if (note) L.push('', note);
  const name = clean(o.senderName) || 'the household';
  L.push('', `Sent from Ledger by ${name}.`);
  if (clean(o.replyTo)) L.push(`Reply to this message to reach ${name}.`);
  return { subject: subjectLine(s, o.today), text: L.join('\n') };
}
