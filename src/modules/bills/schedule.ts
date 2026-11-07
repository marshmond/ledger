/**
 * Billing schedules and the expected-dates reader for Bills & Subscriptions (B1). PURE: no database, no clock, no time zone.
 *
 * ONE MODEL FOR EVERY PATTERN (B0 section 3.3):
 *   weeks         every 1 to 52 weeks on one weekday, counted from an anchor date that falls on that weekday
 *   months        one slot (a day, the last day, or the last business day) every 1 to 24 months from an anchor month
 *   twice-monthly two slots every month (Household Services' rule, shared through `lib/semimonthly`)
 *   null          on demand / irregular: nothing is expected
 *
 * `expectedDates` is a READER for previews and commitment figures. It creates no Task, no Calendar event, no cycle fact and stores nothing.
 * Every date it returns carries a PERIOD SLOT (the identity of that billing period) beside the nominal date:
 *   m<YYYY-MM>       the calendar month of the occurrence                      (months)
 *   s<YYYY-MM>a|b    the month plus the slot's canonical position (rank order) (twice-monthly)
 *   w<YYYY-MM-DD>    the Monday of the week that holds the occurrence           (weeks)
 *   x<id>            a bill no schedule produced (extra invoices, B2; never returned here)
 *
 * IDENTITY RULES (tested; see `schedule-identity.test.ts`):
 *  1. A slot is a PERIOD, not a date. A business-day adjustment, a changed day of the month or a changed weekday moves the nominal date
 *     but never the slot, because every adjustment is refused unless it stays inside its own month.
 *  2. An actual due date that moves (the provider says the 20th, not the 12th) is not a schedule fact at all: nothing here reads it, so it
 *     cannot change a slot. (B2 stores it as a separate `dueDate` fact.)
 *  3. Twice-monthly: `a` is the lower-ranked slot, `b` the other, by RANK (day number, then last business day, then last day), never by which
 *     date comes first in a given month, so a and b never swap.
 *  4. A schedule change ("from now on") keeps the old schedule in `scheduleHistory` with an `until` date. The two schedules must never both
 *     claim the same period: `scheduleChangeProblem` refuses a start date that would, with the concrete period, instead of choosing one.
 *  5. Nothing in this file moves a period to another period. That is B2's explicit "Move to another billing period" operation.
 */
import { generateDates } from '../../core/recurrence';
import { addDays, dayOfWeek, monthOf, nextMonth } from '../../lib/dates';
import { canonicalSemi, monthSlotDates, readSemi, readSlot, semiProblem, slotDate, slotProblem, slotWords, type Semimonthly, type Slot } from '../../lib/semimonthly';
import { isDate, isInt, isMonth, MONTH_NAMES, ord, WEEKDAY_NAMES } from './util';

export interface WeeksSchedule { kind: 'weeks'; every: number; weekday: number; anchorDate: string }
export interface MonthsSchedule { kind: 'months'; every: number; slot: Slot; anchorMonth: string }
export interface TwiceSchedule { kind: 'twice-monthly'; semi: Semimonthly; anchorMonth: string }
export type Schedule = WeeksSchedule | MonthsSchedule | TwiceSchedule;
export interface ScheduleRevision { until: string; schedule: Schedule }
export interface Pause { from: string; to: string | null }

/** Reads one stored schedule. Null when it is not a schedule this version understands (a newer kind, or damaged). Never throws. */
export function readSchedule(v: unknown): Schedule | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (o.kind === 'weeks') {
    if (!isInt(o.every) || o.every < 1 || o.every > 52 || !isInt(o.weekday) || o.weekday < 0 || o.weekday > 6 || !isDate(o.anchorDate)) return null;
    return { kind: 'weeks', every: o.every, weekday: o.weekday, anchorDate: o.anchorDate };
  }
  if (o.kind === 'months') {
    const slot = readSlot(o.slot);
    if (!isInt(o.every) || o.every < 1 || o.every > 24 || !slot || !isMonth(o.anchorMonth)) return null;
    return { kind: 'months', every: o.every, slot, anchorMonth: o.anchorMonth };
  }
  if (o.kind === 'twice-monthly') {
    const semi = readSemi(o.semi);
    return semi && isMonth(o.anchorMonth) ? { kind: 'twice-monthly', semi, anchorMonth: o.anchorMonth } : null;
  }
  return null;
}

/** A plain-words problem with a schedule, or null when it can be saved. Strict: runs on every save. */
export function scheduleProblem(s: Schedule): string | null {
  if (s.kind === 'weeks') {
    if (!isInt(s.every) || s.every < 1 || s.every > 52) return 'Pick every 1 to 52 weeks.';
    if (!isDate(s.anchorDate)) return 'Pick a real date for the next bill.';
    if (dayOfWeek(s.anchorDate) !== s.weekday) return 'The date does not fall on the chosen weekday.';
    return null;
  }
  if (!isMonth(s.anchorMonth)) return 'Pick a real month to start from.';
  if (s.kind === 'months') {
    if (!isInt(s.every) || s.every < 1 || s.every > 24) return 'Pick every 1 to 24 months.';
    if (!readSlot(s.slot)) return 'Pick a day of the month from 1 to 31, or the last day, or the last business day.';
    return slotProblem(s.slot);
  }
  const semi = readSemi(s.semi);
  if (!semi) return 'The twice-monthly schedule is not valid. Pick two days of the month.';
  return semiProblem(semi);
}

// ---- period slots ----

export const mondayOf = (iso: string) => addDays(iso, -((dayOfWeek(iso) + 6) % 7));
export const monthSlot = (month: string) => `m${month}`;
export const twiceSlot = (month: string, which: 'a' | 'b') => `s${month}${which}`;
export const weekSlot = (date: string) => `w${mondayOf(date)}`;

export type ParsedSlot = { kind: 'm'; month: string } | { kind: 's'; month: string; which: 'a' | 'b' } | { kind: 'w'; monday: string } | { kind: 'x'; id: string };
/** Reads a slot id. Null when it is none of the four shapes (a damaged or future id): such a record is shown as "Needs review", never dropped. */
export function parseSlot(v: unknown): ParsedSlot | null {
  if (typeof v !== 'string') return null;
  let m = /^m(\d{4}-\d{2})$/.exec(v);
  if (m && isMonth(m[1])) return { kind: 'm', month: m[1] };
  m = /^s(\d{4}-\d{2})([ab])$/.exec(v);
  if (m && isMonth(m[1])) return { kind: 's', month: m[1], which: m[2] as 'a' | 'b' };
  m = /^w(\d{4}-\d{2}-\d{2})$/.exec(v);
  if (m && isDate(m[1]) && dayOfWeek(m[1]) === 1) return { kind: 'w', monday: m[1] };
  m = /^x(\d+)$/.exec(v);
  return m ? { kind: 'x', id: m[1] } : null;
}

// ---- the expected-dates reader ----

export interface ExpectedDate { slot: string; nominal: string }

/** What `expectedDates` needs from an obligation (a subset, so tests and previews can build it by hand). */
export interface ScheduleSource {
  schedule: Schedule | null;
  scheduleHistory: ScheduleRevision[];
  trackingSince: string;
  pauses: Pause[];
  /** `unsupported` = a stored status this version does not know: nothing is expected (fail closed). */
  status: 'active' | 'paused' | 'ended' | 'unsupported';
  endedOn: string | null;
}

function generate(s: Schedule, lo: string, hi: string): ExpectedDate[] {
  if (lo > hi) return [];
  if (s.kind === 'weeks') {
    return generateDates(s.anchorDate, { freq: 'weekly', interval: s.every, byWeekday: [s.weekday], end: { type: 'never' } }, lo, hi).map((nominal) => ({ slot: weekSlot(nominal), nominal }));
  }
  if (s.kind === 'months') {
    return monthSlotDates(s.slot, s.every, s.anchorMonth, lo, hi).map(({ month, date }) => ({ slot: monthSlot(month), nominal: date }));
  }
  const { a, b } = canonicalSemi(s.semi);
  const out: ExpectedDate[] = [];
  let month = monthOf(lo) < s.anchorMonth ? s.anchorMonth : monthOf(lo);
  for (let i = 0; i < 1200 && month <= monthOf(hi); i++, month = nextMonth(month)) {
    for (const [slot, which] of [[a, 'a'], [b, 'b']] as const) {
      const nominal = slotDate(slot, month);
      if (nominal >= lo && nominal <= hi) out.push({ slot: twiceSlot(month, which), nominal });
    }
  }
  return out;
}

/** True when `date` falls inside a pause (`from` included, `to` excluded: `to` is the first day expected again). */
export const inPause = (date: string, pauses: Pause[]) => pauses.some((p) => date >= p.from && (p.to === null || date < p.to));

/**
 * The expected dates from `from` to `to` (both included), each with its period slot and nominal date, sorted by date.
 * Honours: tracking start (nothing before it), pauses, an end date, schedule history, and `unsupported` status (nothing). Stores nothing.
 */
export function expectedDates(ob: ScheduleSource, from: string, to: string): ExpectedDate[] {
  if (ob.status === 'unsupported' || from > to) return [];
  if (ob.status === 'ended' && !ob.endedOn) return [];
  const history = [...ob.scheduleHistory].sort((x, y) => x.until.localeCompare(y.until));
  const segments: { lo: string; hi: string; s: Schedule | null }[] = [];
  let lo = '0000-01-01';
  for (const h of history) { segments.push({ lo, hi: h.until, s: h.schedule }); lo = addDays(h.until, 1); }
  segments.push({ lo, hi: '9999-12-31', s: ob.schedule });

  const floor = from > ob.trackingSince ? from : ob.trackingSince;
  const ceil = ob.status === 'ended' && ob.endedOn && ob.endedOn < to ? ob.endedOn : to;
  const openPause = ob.pauses.some((p) => p.to === null);
  const out: ExpectedDate[] = [];
  const seen = new Set<string>();
  for (const seg of segments) {
    if (!seg.s) continue;
    const a = seg.lo > floor ? seg.lo : floor;
    const b = seg.hi < ceil ? seg.hi : ceil;
    for (const e of generate(seg.s, a, b)) {
      if (inPause(e.nominal, ob.pauses)) continue;
      if (ob.status === 'paused' && !openPause) continue; // a paused record with no open pause: fail closed
      const key = `${e.slot}|${e.nominal}`;
      if (!seen.has(key)) { seen.add(key); out.push(e); }
    }
  }
  return out.sort((x, y) => x.nominal.localeCompare(y.nominal) || x.slot.localeCompare(y.slot));
}

/** The next `n` expected dates on or after `from`. The window (about three years) covers the longest every-24-months schedule. */
export function nextExpected(ob: ScheduleSource, from: string, n = 3): ExpectedDate[] {
  return expectedDates(ob, from, addDays(from, 1100)).slice(0, n);
}

/** Slots claimed by more than one expected date. The reader does not hide them; callers show them for review. */
export function slotCollisions(list: ExpectedDate[]): { slot: string; dates: string[] }[] {
  const by = new Map<string, string[]>();
  for (const e of list) by.set(e.slot, [...(by.get(e.slot) ?? []), e.nominal]);
  return [...by].filter(([, d]) => d.length > 1).map(([slot, dates]) => ({ slot, dates }));
}

// ---- changing a schedule ----

export interface ScheduleChange {
  /** `replace`: the old schedule never produced a date, so it is simply replaced. `revise`: the old one is kept in the history until the day before. */
  mode: 'replace' | 'revise' | 'same';
  schedule: Schedule | null;
  history: ScheduleRevision[];
  problem: string | null;
}

const firstOfNextMonth = (d: string) => `${nextMonth(monthOf(d))}-01`;
const nextMonday = (d: string) => addDays(d, ((8 - dayOfWeek(d)) % 7) || 7);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The result of changing the schedule "from `effective`". Refuses (with a concrete example) a start date at which the old and new schedule
 * would both claim the same billing period, instead of silently picking one. The default advice is the first of the next month (or the next
 * Monday for weekly schedules).
 */
export function planScheduleChange(current: { schedule: Schedule | null; scheduleHistory: ScheduleRevision[]; trackingSince: string }, next: Schedule | null, effective: string): ScheduleChange {
  const keep = { schedule: current.schedule, history: current.scheduleHistory };
  if (same(current.schedule, next)) return { mode: 'same', ...keep, problem: null };
  if (next) { const p = scheduleProblem(next); if (p) return { mode: 'replace', ...keep, problem: p }; }
  if (!isDate(effective)) return { mode: 'replace', ...keep, problem: 'Pick a real date for the change.' };
  const lastUntil = [...current.scheduleHistory].map((h) => h.until).sort().pop() ?? null;
  if (lastUntil && effective <= lastUntil) return { mode: 'replace', ...keep, problem: `The schedule already changed on ${addDays(lastUntil, 1)}. Pick a later date.` };
  const old = current.schedule;
  const base: ScheduleSource = { schedule: old, scheduleHistory: [], trackingSince: current.trackingSince, pauses: [], status: 'active', endedOn: null };
  // Did the old schedule apply to anything before the change? (Its own segment only; earlier revisions are untouched.)
  const segStart = lastUntil ? addDays(lastUntil, 1) : '0000-01-01';
  const lo = segStart > current.trackingSince ? segStart : current.trackingSince;
  const applied = old ? expectedDates(base, lo, addDays(effective, -1)) : [];
  if (applied.length === 0) return { mode: 'replace', schedule: next, history: current.scheduleHistory, problem: null };
  const until = addDays(effective, -1);
  const history = [...current.scheduleHistory, { until, schedule: old! }];
  if (next) {
    const mine = expectedDates({ ...base, schedule: next }, effective, addDays(effective, 800));
    const claimed = new Map(applied.map((e) => [e.slot, e.nominal]));
    const clash = mine.find((e) => claimed.has(e.slot));
    if (clash) {
      // Advice: the nearest clean boundary (a Monday when a weekly schedule is involved, else the 1st of a month) at which the two schedules share no period.
      const weekly = old!.kind === 'weeks' || next.kind === 'weeks';
      const clashAt = (c: string) => {
        const oldClaims = new Set(expectedDates(base, lo, addDays(c, -1)).map((x) => x.slot));
        return expectedDates({ ...base, schedule: next }, c, addDays(c, 800)).some((x) => oldClaims.has(x.slot));
      };
      const advice = (weekly ? [nextMonday(effective), firstOfNextMonth(effective)] : [firstOfNextMonth(effective)]).find((c) => !clashAt(c));
      return {
        mode: 'revise', schedule: next, history,
        problem: `The old schedule already has a bill for ${slotWords2(clash.slot)} (${claimed.get(clash.slot)}) and the new one would put another in the same period (${clash.nominal}). ${advice ? `Start the new schedule on ${advice} or later.` : 'Pick a later start date.'}`,
      };
    }
  }
  return { mode: 'revise', schedule: next, history, problem: null };
}
/** "December 2026", "the week of 2026-12-07" for a slot id (used in messages). */
export function slotWords2(slot: string): string {
  const p = parseSlot(slot);
  if (!p) return 'that period';
  if (p.kind === 'm' || p.kind === 's') { const [y, m] = p.month.split('-').map(Number); return `${MONTH_NAMES[m - 1]} ${y}${p.kind === 's' ? ` (${p.which === 'a' ? 'first' : 'second'} bill)` : ''}`; }
  if (p.kind === 'w') return `the week of ${p.monday}`;
  return 'an extra bill';
}

// ---- words ----

const adjustNote = (s: Slot) => (s.kind !== 'day' || !s.adjust || s.adjust === 'none' ? '' : s.adjust === 'previous' ? ' (the business day before, if a weekend)' : ' (the business day after, if a weekend)');
/** "Monthly, on the 12th" / "Once a year, on the 15th of March" / "Every 2 weeks on Friday" / "On demand (no regular schedule)". */
export function describeSchedule(s: Schedule | null): string {
  if (!s) return 'On demand (no regular schedule)';
  if (s.kind === 'weeks') {
    const day = WEEKDAY_NAMES[s.weekday];
    return s.every === 1 ? `Every week on ${day}` : `Every ${s.every} weeks on ${day}`;
  }
  if (s.kind === 'twice-monthly') {
    const { a, b } = canonicalSemi(s.semi);
    return `Twice a month: ${slotWords(a)} and ${slotWords(b)}`;
  }
  if (s.every === 12) {
    const month = MONTH_NAMES[Number(s.anchorMonth.slice(5, 7)) - 1];
    if (s.slot.kind === 'day') return `Once a year, on the ${ord(s.slot.day ?? 1)} of ${month}${adjustNote(s.slot)}`;
    return `Once a year, on ${slotWords(s.slot).replace(' of the month', '')} of ${month}`;
  }
  const head = s.every === 1 ? 'Monthly' : s.every === 3 ? 'Every 3 months (quarterly)' : s.every === 6 ? 'Every 6 months' : `Every ${s.every} months`;
  return `${head}, on ${slotWords(s.slot)}`;
}
