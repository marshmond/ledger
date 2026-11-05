/**
 * Light shorthand for adding an event from the Add box, e.g. "lunch with sam fri 12-1pm !high #work @family every week".
 *   date words:  the same as the Tasks bar (today, tomorrow, fri, next mon, in 3 days, nov 12, 11/12, 2026-11-12)
 *   time:        at 3pm, 3:30pm, 15:00 (one hour long), or a range: 3-4pm, 3pm-4:30pm, from 3 to 4pm
 *   priority:    !high !medium !low !reminder        tag: #work        calendar: @family
 *   repeat:      every day / every 2 weeks / every two weeks / every other week / biweekly / every monday / monthly / yearly
 * No date means today. No time means an all-day event. The screen always shows what was understood before saving, and a plain
 * title is always possible. Date, repeat and tag words are read by the Tasks parser (`parseQuickAdd`), so both bars agree. Pure.
 */
import type { Priority } from '../../core/entities';
import { parseQuickAdd } from '../tasks/quickAdd';
import { blankFields, type EventFields } from './model';
import type { Recurrence } from './recurrence';

export interface ParsedEvent {
  title: string;
  /** First day, 'YYYY-MM-DD'. */
  date: string;
  allDay: boolean;
  /** 'HH:MM' (24-hour), for timed events. */
  startTime?: string;
  /** 'HH:MM'. Only when a range was typed; otherwise the event is one hour long. */
  endTime?: string;
  priority?: Priority;
  tags: string[];
  /** The `@name` typed, if any. */
  calendar?: string;
  recurrence: Recurrence | null;
}

const p2 = (n: number) => String(n).padStart(2, '0');
/** 12-hour clock to 24-hour. */
function to24(h: number, ap: 'am' | 'pm'): number {
  if (ap === 'pm') return h < 12 ? h + 12 : h;
  return h === 12 ? 0 : h;
}

// "3-4pm", "3pm-4:30pm", "from 3 to 4pm", "11 - 1pm". The end must say am or pm so a plain "2026-11-12" or "5-10" is never read as a time.
const RANGE = /(?<![\w:/.-])(?:(?:from|at)\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?![\w])/i;

/** Finds a time range in the text. Returns the 24-hour start and end and the text without it, or null. */
export function extractRange(input: string): { start: string; end: string; rest: string } | null {
  const m = RANGE.exec(input);
  if (!m) return null;
  const h1 = Number(m[1]), h2 = Number(m[4]);
  const min1 = m[2] ? Number(m[2]) : 0, min2 = m[5] ? Number(m[5]) : 0;
  const endAp = m[6].toLowerCase() as 'am' | 'pm';
  if (h1 < 1 || h1 > 12 || h2 < 1 || h2 > 12 || min1 > 59 || min2 > 59) return null;
  const end = to24(h2, endAp) * 60 + min2;
  // "3-4pm" means 3pm; "11-1pm" means 11am (3pm-1pm would run backwards, so the start takes the other half of the day).
  let startAp = (m[3]?.toLowerCase() as 'am' | 'pm' | undefined) ?? endAp;
  let start = to24(h1, startAp) * 60 + min1;
  if (!m[3] && start >= end) { startAp = endAp === 'pm' ? 'am' : 'pm'; start = to24(h1, startAp) * 60 + min1; }
  if (start >= end) return null;
  const fmt = (t: number) => `${p2(Math.floor(t / 60))}:${p2(t % 60)}`;
  return { start: fmt(start), end: fmt(end), rest: `${input.slice(0, m.index)} ${input.slice(m.index + m[0].length)}`.replace(/\s+/g, ' ').trim() };
}

export function parseQuickEvent(input: string, today: string, opts: { plain?: boolean } = {}): ParsedEvent {
  const text = input.trim();
  if (opts.plain) return { title: text, date: today, allDay: true, tags: [], recurrence: null };
  const range = extractRange(text);
  const p = parseQuickAdd(range ? `${range.rest} at ${range.start}` : text, today);
  const timed = !!(range || p.dueTime);
  // When every word was shorthand the Tasks parser falls back to the whole line, which here includes the " at HH:MM" we added: use the typed text instead.
  const fellBack = !!range && p.title === `${range.rest} at ${range.start}`.trim();
  const title = fellBack ? text : p.title;
  return {
    title: title.trim() || text,
    date: p.dueDate ?? today,
    allDay: !timed,
    ...(timed ? { startTime: range?.start ?? p.dueTime! } : {}),
    ...(range ? { endTime: range.end } : {}),
    ...(p.priority ? { priority: p.priority } : {}),
    tags: p.tags,
    ...(p.list ? { calendar: p.list } : {}),
    recurrence: p.repeat ? p.repeat.rule : null,
  };
}

const at = (date: string, hhmm: string) => {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  return new Date(y, mo - 1, d, h, mi).getTime();
};

/** The event's fields, ready to save. Timed events with no end are one hour long; an all-day event covers its one day. */
export function eventFieldsFor(p: ParsedEvent, title = p.title): EventFields {
  if (p.allDay || !p.startTime) return { ...blankFields(p.date), title, priority: p.priority ?? 'medium' };
  const startAt = at(p.date, p.startTime);
  const endAt = p.endTime ? at(p.date, p.endTime) : startAt + 3600_000;
  return { ...blankFields(p.date, startAt), title, allDay: false, endAt, priority: p.priority ?? 'medium' };
}
