/**
 * Light shorthand for the quick-add bar, e.g. "pay contractor fri !high #renovation @home".
 *   date words:  today, tomorrow, mon..sun (the next one), next mon, next week, in 3 days, in 2 weeks, nov 12, 11/12, 2026-11-12
 *   time:        at 3pm, 3:30pm, 15:00
 *   priority:    !high !medium !low !reminder (or !h !m !l !r)
 *   tag:         #renovation        list: @home
 *   repeat:      every day / every 2 weeks / every monday / every month / every year (also daily, weekly, monthly, yearly)
 * The screen always shows what was understood before saving, and a plain title is always possible. Pure; nothing is stored.
 */
import { addDays, addMonths, dayOfWeek } from '../../lib/dates';
import type { Priority } from '../../core/entities';
import type { TaskRepeat } from './model';

export interface ParsedQuick {
  title: string;
  dueDate?: string;
  dueTime?: string;
  priority?: Priority;
  tags: string[];
  list?: string;
  repeat?: TaskRepeat;
}

const DAYS: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};
const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const PRIORITIES: Record<string, Priority> = { high: 'high', h: 'high', '1': 'high', medium: 'medium', med: 'medium', m: 'medium', '2': 'medium', low: 'low', l: 'low', '3': 'low', reminder: 'reminder', rem: 'reminder', r: 'reminder' };

const p2 = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${p2(m)}-${p2(d)}`;
const validDay = (y: number, m: number, d: number) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
/** The next date on or after `today` for a month and day (this year, or next year if already past). */
function monthDay(today: string, m: number, d: number): string | null {
  const y = Number(today.slice(0, 4));
  for (const yy of [y, y + 1]) if (validDay(yy, m, d) && iso(yy, m, d) >= today) return iso(yy, m, d);
  return null;
}
/** The next given weekday strictly after `today`. */
const nextWeekday = (today: string, wd: number) => addDays(today, ((wd - dayOfWeek(today) + 6) % 7) + 1);

const clean = (w: string) => w.toLowerCase().replace(/[.,;:]+$/, '');

function parseTime(word: string): string | null {
  const m = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(clean(word));
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    if (m[3] === 'pm' && h < 12) h += 12;
    if (m[3] === 'am' && h === 12) h = 0;
  } else if (!m[2] || h > 23) return null; // a bare number is not a time; "15:00" is
  return `${p2(h)}:${p2(min)}`;
}

export function parseQuickAdd(input: string, today: string): ParsedQuick {
  const words = input.trim().split(/\s+/).filter(Boolean);
  const used = words.map(() => false);
  const out: ParsedQuick = { title: '', tags: [] };
  const take = (i: number, n = 1) => { for (let k = 0; k < n; k++) used[i + k] = true; };
  const free = (i: number, n = 1) => { for (let k = 0; k < n; k++) if (i + k >= words.length || used[i + k]) return false; return true; };
  const w = (i: number) => clean(words[i] ?? '');

  // Pass 1: !priority, #tag, @list (these are unambiguous)
  words.forEach((word, i) => {
    if (word.startsWith('!') && PRIORITIES[clean(word.slice(1))] && !out.priority) { out.priority = PRIORITIES[clean(word.slice(1))]; take(i); }
    else if (/^#[\w-]+$/.test(word)) { out.tags.push(word.slice(1)); take(i); }
    else if (/^@[\w-]+$/.test(word) && !out.list) { out.list = word.slice(1); take(i); }
  });

  // Pass 2: repeat ("every ...", "daily"), then date, then time
  for (let i = 0; i < words.length && !out.repeat; i++) {
    if (used[i]) continue;
    const one = { daily: 'daily', weekly: 'weekly', monthly: 'monthly', yearly: 'yearly', annually: 'yearly' }[w(i)] as 'daily' | 'weekly' | 'monthly' | 'yearly' | undefined;
    if (one) { out.repeat = { mode: 'fixed', rule: { freq: one, interval: 1, end: { type: 'never' } } }; take(i); break; }
    if (w(i) !== 'every' || !free(i, 2)) continue;
    let n = 1, at = i + 1;
    if (/^\d+$/.test(w(at)) && free(at, 2)) { n = Math.max(1, Number(w(at))); at++; }
    const unit = w(at).replace(/s$/, '');
    const freq = ({ day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' } as const)[unit as 'day'];
    if (freq) { out.repeat = { mode: 'fixed', rule: { freq, interval: n, end: { type: 'never' } } }; take(i, at - i + 1); }
    else if (DAYS[unit] !== undefined || DAYS[w(at)] !== undefined) {
      const wd = DAYS[w(at)] ?? DAYS[unit];
      out.repeat = { mode: 'fixed', rule: { freq: 'weekly', interval: n, byWeekday: [wd], end: { type: 'never' } } };
      out.dueDate = nextWeekday(today, wd);
      take(i, at - i + 1);
    }
  }

  for (let i = 0; i < words.length && !out.dueDate; i++) {
    if (used[i]) continue;
    const a = w(i);
    const b = free(i, 2) ? w(i + 1) : '';
    const c = free(i, 3) ? w(i + 2) : '';
    let date: string | null = null, n = 1;
    if (a === 'today' || a === 'tod') date = today;
    else if (a === 'tomorrow' || a === 'tmrw' || a === 'tom') date = addDays(today, 1);
    else if (a === 'next' && b === 'week') { date = nextWeekday(today, 1); n = 2; }
    else if (a === 'next' && DAYS[b] !== undefined) { date = nextWeekday(today, DAYS[b]); n = 2; }
    else if (a === 'in' && /^\d+$/.test(b) && /^(day|days|week|weeks|month|months)$/.test(c)) {
      const k = Number(b);
      date = c.startsWith('day') ? addDays(today, k) : c.startsWith('week') ? addDays(today, 7 * k) : addMonths(today, k);
      n = 3;
    } else if (DAYS[a] !== undefined) date = nextWeekday(today, DAYS[a]);
    else if (MONTHS[a] !== undefined && /^\d{1,2}(st|nd|rd|th)?$/.test(b)) { date = monthDay(today, MONTHS[a], parseInt(b, 10)); n = 2; }
    else if (/^\d{4}-\d{2}-\d{2}$/.test(a) && validDay(+a.slice(0, 4), +a.slice(5, 7), +a.slice(8, 10))) date = a;
    else {
      const md = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(a);
      if (md) {
        const m = Number(md[1]), d = Number(md[2]);
        if (md[3]) { const y = md[3].length === 2 ? 2000 + Number(md[3]) : Number(md[3]); date = validDay(y, m, d) ? iso(y, m, d) : null; }
        else date = monthDay(today, m, d);
      }
    }
    if (date) { out.dueDate = date; take(i, n); }
  }

  for (let i = 0; i < words.length; i++) {
    if (used[i]) continue;
    if (w(i) === 'at' && free(i, 2) && parseTime(words[i + 1])) { out.dueTime = parseTime(words[i + 1])!; take(i, 2); break; }
    const t = /(am|pm|:)/i.test(words[i]) ? parseTime(words[i]) : null;
    if (t) { out.dueTime = t; take(i); break; }
  }
  if (out.dueTime && !out.dueDate) out.dueDate = today;

  out.title = words.filter((_, i) => !used[i]).join(' ').trim();
  if (!out.title) out.title = input.trim(); // never lose what was typed
  return out;
}

/** What was understood, in plain words, for the preview line. */
export function describeParsed(p: ParsedQuick, existingLists: string[], existingTags: string[]): string[] {
  const out: string[] = [];
  if (p.dueDate) out.push(`Due ${p.dueDate}${p.dueTime ? ` at ${p.dueTime}` : ''}`);
  if (p.priority) out.push(`Priority ${p.priority}`);
  for (const t of p.tags) out.push(`Tag #${t}${existingTags.some((x) => x.toLowerCase() === t.toLowerCase()) ? '' : ' (new)'}`);
  if (p.list) out.push(`List @${p.list}${existingLists.some((x) => x.toLowerCase() === p.list!.toLowerCase()) ? '' : ' (new)'}`);
  if (p.repeat) out.push(`Repeats ${p.repeat.rule.interval > 1 ? `every ${p.repeat.rule.interval} ` : ''}${{ daily: 'daily', weekly: 'weekly', monthly: 'monthly', yearly: 'yearly' }[p.repeat.rule.freq]}`);
  return out;
}
