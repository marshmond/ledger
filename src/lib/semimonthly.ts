/**
 * SHARED (Bills & Subscriptions B1.0): this file moved here from `modules/services/semimonthly.ts` so Household Services and Bills use ONE
 * month-slot date resolver. The old path re-exports everything (`export *`), the code below is unchanged except for the `dates` import path
 * and the additive single-slot section at the end (`slotProblem`, `monthSlotDates`), which no existing caller uses.
 *
 * "Twice monthly" (semimonthly) visit dates for Household Services (S3-A). PURE: no database, no clock, no time zone.
 *
 * WHY THIS EXISTS. The Tasks repeat rule can say "every month on one date" or "every 2 weeks", but not "on the 15th AND the last business
 * day of every month". Attaching a monthly repeat to such a Task would be untrue, so a twice-monthly arrangement keeps its two day-rules
 * HERE (inside the arrangement's cadence), its Task carries NO repeat, and the arrangement computes each next date from the rules below.
 * Twice-monthly is not "every 14 days": the gap between visits changes from month to month.
 *
 * It is a narrow date adapter, not a second scheduler: nothing runs by itself, nothing is pre-created, and it reuses the existing calendar
 * helpers in `lib/dates`. The Task lifecycle (one open Task, completed or logged through Services) is unchanged.
 *
 * RULES (all deterministic; every month gets exactly two dates):
 *  - A slot is a fixed day of the month (1 to 31), the last calendar day, or the last business day. A fixed day past the end of a short
 *    month means that month's last day (31 in April = 30 April; 30 in February = 28 or 29 February, following the real calendar).
 *  - A fixed day may be adjusted when it falls on a weekend: "previous business day" (Friday) or "next business day" (Monday).
 *    Business days are Monday to Friday. Public holidays are NOT considered (no holiday calendar is assumed).
 *  - The month is the unit: each month's two slots give that month's two dates. An adjustment is NEVER allowed to move a date into a
 *    different month (that would make a month have one or three visits). A rule that could do so is refused when saved, with an example.
 *  - Two slots must never give the same date in any month. A rule that could is refused when saved, with an example.
 *  - Because of the two checks above every date belongs to exactly one (month, slot), so the date itself is a stable identity: it is what the
 *    Task's occurrence marker stores.
 */
import { addDays, daysInMonth, dayOfWeek, endOfMonth, lastBusinessDay, monthLabel, monthOf, nextMonth, priorBusinessDay } from './dates';

export type SlotKind = 'day' | 'lastDay' | 'lastBusinessDay';
export type Adjust = 'none' | 'previous' | 'next';
export interface Slot { kind: SlotKind; /** 1 to 31, only for `day` */ day?: number; /** only for `day` */ adjust?: Adjust }
export interface Semimonthly { a: Slot; b: Slot }

export const SLOT_KINDS: SlotKind[] = ['day', 'lastDay', 'lastBusinessDay'];
export const ADJUSTS: Adjust[] = ['none', 'previous', 'next'];

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Reads one stored slot; null when it is not a valid slot. */
export function readSlot(v: unknown): Slot | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (o.kind === 'lastDay') return { kind: 'lastDay' };
  if (o.kind === 'lastBusinessDay') return { kind: 'lastBusinessDay' };
  if (o.kind !== 'day' || !isInt(o.day) || o.day < 1 || o.day > 31) return null;
  const adjust: Adjust = o.adjust === 'previous' || o.adjust === 'next' ? o.adjust : 'none';
  return { kind: 'day', day: o.day, adjust };
}

const rank = (s: Slot) => (s.kind === 'day' ? s.day! : s.kind === 'lastBusinessDay' ? 32 : 33);
/** The same two slots in a fixed order (by day, then last business day, then last day), so equal rules compare equal and read naturally. */
export const canonicalSemi = (s: Semimonthly): Semimonthly => (rank(s.b) < rank(s.a) || (rank(s.b) === rank(s.a) && adj(s.b) < adj(s.a)) ? { a: s.b, b: s.a } : s);
const adj = (s: Slot) => (s.adjust ?? 'none');

/** Reads a stored twice-monthly rule (two valid slots), in canonical order. Never throws. Null when it is not usable. */
export function readSemi(v: unknown): Semimonthly | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const a = readSlot(o.a);
  const b = readSlot(o.b);
  return a && b ? canonicalSemi({ a, b }) : null;
}

const nextBusinessDay = (iso: string) => { const d = dayOfWeek(iso); return d === 6 ? addDays(iso, 2) : d === 0 ? addDays(iso, 1) : iso; };

/** The date a slot gives in a month ('YYYY-MM'), before any check that it stayed inside the month. */
export function slotDate(s: Slot, month: string): string {
  if (s.kind === 'lastDay') return endOfMonth(month);
  if (s.kind === 'lastBusinessDay') return lastBusinessDay(month);
  const [y, m] = month.split('-').map(Number);
  const date = `${month}-${String(Math.min(Math.max(1, s.day ?? 1), daysInMonth(y, m))).padStart(2, '0')}`;
  return s.adjust === 'previous' ? priorBusinessDay(date) : s.adjust === 'next' ? nextBusinessDay(date) : date;
}

const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
export function slotWords(s: Slot): string {
  if (s.kind === 'lastDay') return 'the last day of the month';
  if (s.kind === 'lastBusinessDay') return 'the last business day of the month';
  const base = `the ${ord(s.day!)}`;
  return s.adjust === 'previous' ? `${base} (the business day before, if a weekend)` : s.adjust === 'next' ? `${base} (the business day after, if a weekend)` : base;
}
/** "Twice monthly: the 15th and the last business day of the month." */
export const describeSemi = (s: Semimonthly): string => `Twice monthly: ${slotWords(s.a)} and ${slotWords(s.b)}.`;

// ---- the save-time check: scan every month of a long span, so the answer does not depend on which year it is checked in ----

const SCAN_FROM = 2000;
const SCAN_TO = 2130; // covers several 28-year weekday cycles and the non-leap year 2100
const memo = new Map<string, string | null>();

/** A plain-words problem with a pair of slots, or null when every month gets two different dates inside that month. */
export function semiProblem(s: Semimonthly): string | null {
  const key = JSON.stringify(canonicalSemi(s));
  if (memo.has(key)) return memo.get(key)!;
  const r = scan(canonicalSemi(s));
  memo.set(key, r);
  return r;
}
function scan(s: Semimonthly): string | null {
  for (const slot of [s.a, s.b]) {
    if (slot.kind === 'day' && (!isInt(slot.day) || slot.day! < 1 || slot.day! > 31)) return 'Pick a day of the month from 1 to 31.';
  }
  // The span is checked starting from a recent year, so an example in the message is a date the owner will recognise.
  const years = [...Array.from({ length: SCAN_TO - 2026 + 1 }, (_, i) => 2026 + i), ...Array.from({ length: 2026 - SCAN_FROM }, (_, i) => SCAN_FROM + i)];
  for (const y of years) {
    for (let m = 1; m <= 12; m++) {
      const month = `${y}-${String(m).padStart(2, '0')}`;
      const da = slotDate(s.a, month);
      const db = slotDate(s.b, month);
      for (const [slot, d] of [[s.a, da], [s.b, db]] as const) {
        if (monthOf(d) !== month) {
          return `${slotWords(slot)} would land outside its own month in some years (for example ${monthLabel(month)}, where it would fall on ${d}). That would give a month one visit and the next month three. Choose "the business day ${slot.adjust === 'previous' ? 'after' : 'before'}" or no adjustment instead.`;
        }
      }
      if (da === db) return `The two days would land on the same date in some months (for example ${da}, in ${monthLabel(month)}), so that month would have only one visit. Choose two days that are always different.`;
    }
  }
  return null;
}

// ---- generating dates ----

/**
 * Every twice-monthly date from `from` to `to` (both included), in order. Nothing before `anchor`, nothing after `until`.
 * For rules that passed `semiProblem` each month's two dates stay inside the month, so only the months touching [from, to] are visited.
 * Bounded: at most 1,200 months per call, so damaged data cannot loop.
 */
export function semiDates(s: Semimonthly, anchor: string, from: string, to: string, until: string | null = null): string[] {
  const lo = from > anchor ? from : anchor;
  const hi = until && until < to ? until : to;
  if (lo > hi) return [];
  const out: string[] = [];
  let month = monthOf(lo);
  for (let i = 0; i < 1200 && month <= monthOf(hi); i++, month = nextMonth(month)) {
    for (const d of [slotDate(s.a, month), slotDate(s.b, month)]) if (d >= lo && d <= hi && !out.includes(d)) out.push(d);
  }
  return out.sort();
}

/** The first twice-monthly date on or after `from`, or null if it has ended. */
export function semiNext(s: Semimonthly, anchor: string, from: string, until: string | null = null): string | null {
  const lo = from > anchor ? from : anchor;
  return semiDates(s, anchor, lo, addDays(lo, 70), until)[0] ?? null;
}

// ---- ONE slot, stepped by whole months (Bills B1.0; additive, not used by Household Services) ----

/** The same scan as `semiProblem` for a single slot: a plain-words problem if the slot could land outside its own month, else null. */
const slotMemo = new Map<string, string | null>();
export function slotProblem(slot: Slot): string | null {
  const key = JSON.stringify(readSlot(slot) ?? slot);
  if (slotMemo.has(key)) return slotMemo.get(key)!;
  const r = scanSlot(slot);
  slotMemo.set(key, r);
  return r;
}
function scanSlot(slot: Slot): string | null {
  if (slot.kind === 'day' && (!isInt(slot.day) || slot.day! < 1 || slot.day! > 31)) return 'Pick a day of the month from 1 to 31.';
  const years = [...Array.from({ length: SCAN_TO - 2026 + 1 }, (_, i) => 2026 + i), ...Array.from({ length: 2026 - SCAN_FROM }, (_, i) => SCAN_FROM + i)];
  for (const y of years) {
    for (let m = 1; m <= 12; m++) {
      const month = `${y}-${String(m).padStart(2, '0')}`;
      const d = slotDate(slot, month);
      if (monthOf(d) !== month) {
        return `${slotWords(slot)} would land outside its own month in some years (for example ${monthLabel(month)}, where it would fall on ${d}). That would put one bill in the wrong month. Choose "the business day ${slot.adjust === 'previous' ? 'after' : 'before'}" or no adjustment instead.`;
      }
    }
  }
  return null;
}

/**
 * The dates one slot gives, stepping `every` whole months from `anchorMonth` ('YYYY-MM'), for every such month that touches [from, to]
 * (both included). Months before `anchorMonth` give nothing. Bounded: at most 1,200 months per call, so damaged data cannot loop.
 * Returns `{ month, date }` pairs so a caller can name the period (the month) separately from the nominal date.
 */
export function monthSlotDates(slot: Slot, every: number, anchorMonth: string, from: string, to: string): { month: string; date: string }[] {
  const step = Math.max(1, Math.floor(every) || 1);
  if (from > to) return [];
  const out: { month: string; date: string }[] = [];
  let month = anchorMonth;
  const last = monthOf(to);
  // jump close to `from` without visiting every month since the anchor
  const gap = (Number(monthOf(from).slice(0, 4)) - Number(anchorMonth.slice(0, 4))) * 12 + Number(monthOf(from).slice(5, 7)) - Number(anchorMonth.slice(5, 7));
  for (let i = Math.max(0, Math.floor(gap / step) - 1); i > 0; i--) for (let k = 0; k < step; k++) month = nextMonth(month);
  for (let i = 0; i < 1200 && month <= last; i++) {
    const date = slotDate(slot, month);
    if (date >= from && date <= to && month >= anchorMonth) out.push({ month, date });
    for (let k = 0; k < step; k++) month = nextMonth(month);
  }
  return out;
}
