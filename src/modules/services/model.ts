/**
 * Household Services records. They live in the shared `moduleRecords` table (module 'services', kind 'arrangement'), so backup, restore and
 * device sync already cover them. A provider is an ordinary shared Contact (no provider record); the arrangement stores the contact's id
 * and a public-name snapshot so history stays readable if the contact is removed.
 *
 * Money is whole cents; dates are 'YYYY-MM-DD' with no time zone. Fields this reader does not know are carried through untouched.
 * NO account number, password, access code or bank detail is stored anywhere in this module. Phone and email are read live from the
 * Contact and shown only on the provider page.
 */
import type { ModuleRecord } from '../../core/entities';
import { describeRule, generateDates, normalizeRule, type Recurrence } from '../../core/recurrence';
import { addDays, dayOfWeek } from '../../lib/dates';
import { readTxnRefs, validateTxnRefs, type TxnRef } from '../../lib/txnRef';
import { describeSemi, readSemi, semiDates, semiNext, semiProblem, type Semimonthly } from './semimonthly';

export const MODULE = 'services';
export const KIND = 'arrangement';

export const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
/** A real calendar date written YYYY-MM-DD (so 2026-02-30 is not one). */
export const isDate = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
export const isTime = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const tidy = (s: string) => s.trim().replace(/\s+/g, ' ');

/** Link / record-source ids look like `arrangement:1234`, so a later `visit:` kind can never clash. */
export const arrangementRefId = (id: number) => `arrangement:${id}`;
export const parseArrangementRef = (id: string | number): number | null => {
  const m = /^arrangement:(\d+)$/.exec(String(id));
  return m ? Number(m[1]) : null;
};
export const arrangementRef = (id: number) => ({ module: MODULE, id: arrangementRefId(id) });
/** Shared-link types this module uses. */
export const TASK_LINK = 'about'; // task -> arrangement (the one "next visit")
export const ASSET_LINK = 'serves'; // arrangement -> assets:asset:<n>

export const STATUSES = ['active', 'paused', 'ended'] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status, string> = { active: 'Active', paused: 'Paused', ended: 'Ended' };
export const END_REASONS = ['cancelled', 'replaced', 'finished', 'other'] as const;
export type EndReason = (typeof END_REASONS)[number];
export const END_REASON_LABEL: Record<EndReason, string> = { cancelled: 'Cancelled', replaced: 'Replaced by another provider', finished: 'Finished', other: 'Other' };

/** The INTENDED schedule. `anchorDate` is the first intended occurrence; a one-time move of a visit never changes it. */
export interface Cadence {
  mode: 'fixed' | 'after'; rule: Recurrence; anchorDate: string;
  /**
   * Present only for a TWICE-MONTHLY schedule (S3-A): two day-rules that the Tasks repeat model cannot express. Then `rule` is only a
   * placeholder (monthly, every 1) that carries the end date, and the visit Task has NO repeat. Absent on every earlier arrangement.
   */
  semi?: Semimonthly;
}
export const EXPECTED_BASES = ['perVisit', 'perMonth', 'perSeason', 'perYear', 'quote'] as const;
export type ExpectedBasis = (typeof EXPECTED_BASES)[number];
export const BASIS_LABEL: Record<ExpectedBasis, string> = { perVisit: 'per visit', perMonth: 'per month', perSeason: 'per season', perYear: 'per year', quote: 'quoted for the job' };
/** Informational only. Never counted as money spent. */
export interface Expected { basis: ExpectedBasis; cents: number }
export interface DocRef { label: string; url?: string; note?: string }

export interface ArrangementData {
  title: string;
  providerContactId: number | null;
  providerNameSnapshot: string;
  extraContactIds: number[];
  status: Status;
  endReason: EndReason | null;
  startDate: string | null;
  endDate: string | null;
  cadence: Cadence | null;
  /** Local clock time of a visit ("09:00"); written to the Task's due time. */
  visitTime: string | null;
  expected: Expected | null;
  refs: DocRef[];
  notes: string;
  /** The arrangement this one replaced (set on the successor only). */
  predecessorId: number | null;
  /** A convenience pointer to the open Task. NEVER the truth: the shared link is. Re-derived when it disagrees. */
  openTaskId: number | null;
  /** Schedule notices the owner chose to leave as they are (see scheduleHealth). */
  acknowledged: string[];
  /**
   * Finance payment pieces that belong to the arrangement as a whole, not to one visit (a monthly retainer). Same reference rules as a visit's.
   * Never divided among visits. A piece linked here is refused on this arrangement's visits (and the other way round) so it cannot be counted twice.
   * There is no arrangement-level typed amount: S0 does not specify one, and a general manual ledger is out of scope.
   */
  txnRefs: TxnRef[];
  /**
   * S4: the date the service AGREEMENT renews, and the date by which the household must act or give notice to change or cancel it. Plain calendar
   * dates with no time. They are different dates and neither is a visit date. Nothing renews or cancels by itself, and nothing repeats them
   * yearly: the owner types the dates for each agreement period. Kept (never erased) when the arrangement is paused, ended or replaced.
   * Stored only when set, so an arrangement without them is stored exactly as before S4.
   */
  renewalDate: string | null;
  noticeByDate: string | null;
}
export interface ArrangementRecord { id: number; createdAt: number; updatedAt: number; data: ArrangementData }

const KNOWN = new Set(['title', 'providerContactId', 'providerNameSnapshot', 'extraContactIds', 'status', 'endReason', 'startDate', 'endDate', 'cadence', 'visitTime', 'expected', 'refs', 'notes', 'predecessorId', 'openTaskId', 'acknowledged', 'txnRefs', 'semiCadence', 'renewalDate', 'noticeByDate']);
const extras = (d: object) => Object.fromEntries(Object.entries(d).filter(([k, v]) => !KNOWN.has(k) && v !== undefined)) as object;
const ids = (v: unknown): number[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)))] : []);

/** Writes a weekly rule's weekday out in full ("every other Friday" must name Friday), so a moved visit can never shift later ones. */
export function withExplicitWeekday(rule: Recurrence, anchor: string): Recurrence {
  if (rule.freq !== 'weekly') return rule;
  const days = rule.byWeekday?.length ? rule.byWeekday : [dayOfWeek(anchor)];
  return { ...rule, byWeekday: [...new Set(days)].sort((a, b) => a - b) };
}

function readCadence(v: unknown): Cadence | null {
  const c = v as Partial<Cadence> | null | undefined;
  if (!c || !isDate(c.anchorDate)) return null;
  const rule = normalizeRule(c.rule);
  if (c.semi !== undefined && c.semi !== null) {
    // A twice-monthly schedule is always on fixed dates. If its two rules cannot be read the schedule is treated as missing (never as monthly).
    const semi = readSemi(c.semi);
    return semi ? { mode: 'fixed', rule: { freq: 'monthly', interval: 1, monthly: 'date', end: rule?.end ?? { type: 'never' } }, anchorDate: c.anchorDate, semi } : null;
  }
  return rule ? { mode: c.mode === 'after' ? 'after' : 'fixed', rule: withExplicitWeekday(rule, c.anchorDate), anchorDate: c.anchorDate } : null;
}

/**
 * HOW A TWICE-MONTHLY SCHEDULE IS STORED (fail closed for older builds). The pre-S3 reader knows `cadence` and would read a twice-monthly rule as an
 * ordinary monthly one, schedule wrong dates, and (because it rewrites `cadence` from what it understood) drop the rule on its next save. So the rule is
 * NOT stored in `cadence`. It is stored in its own top-level field `semiCadence`, which an older build does not know and therefore carries through every
 * read and write untouched, while `cadence` is null: an older build sees "no regular schedule" and creates no visit and no date.
 * This build reads `semiCadence` only while `cadence` is null, so a schedule an older build set on purpose still wins.
 */
export interface StoredSemi { anchorDate: string; end: Recurrence['end']; semi: Semimonthly }
function readStoredSemi(v: unknown): Cadence | null {
  const o = v as Partial<StoredSemi> | null | undefined;
  if (!o || typeof o !== 'object' || !isDate(o.anchorDate)) return null;
  const semi = readSemi(o.semi);
  const rule = normalizeRule({ freq: 'monthly', interval: 1, monthly: 'date', end: o.end });
  return semi && rule ? { mode: 'fixed', rule, anchorDate: o.anchorDate, semi } : null;
}
/** The form written to the database for an arrangement. Every write of an arrangement goes through this. */
export function toStored(d: ArrangementData): Record<string, unknown> {
  const { cadence, renewalDate, noticeByDate, ...rest } = d as ArrangementData & Record<string, unknown>;
  // contract dates are stored only when set (an arrangement without them looks exactly as it did before S4)
  const dates = { ...(renewalDate ? { renewalDate } : {}), ...(noticeByDate ? { noticeByDate } : {}) };
  if (cadence?.semi) {
    const stored: StoredSemi = { anchorDate: cadence.anchorDate, end: cadence.rule.end, semi: cadence.semi };
    return { ...rest, ...dates, cadence: null, semiCadence: stored };
  }
  const { semiCadence: _drop, ...clean } = rest as Record<string, unknown>;
  void _drop;
  return { ...clean, ...dates, cadence };
}

/** Reads a stored record defensively, so a record from another device or version can never crash a screen. Never throws. */
export function asArrangement(r: ModuleRecord): ArrangementRecord {
  const d = (r.data ?? {}) as Partial<ArrangementData>;
  const status: Status = STATUSES.includes(d.status as Status) ? (d.status as Status) : 'active';
  const ex = d.expected as Partial<Expected> | null | undefined;
  return {
    id: r.id as number,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    data: {
      ...extras(d),
      title: str(d.title, '(no title)'),
      providerContactId: finite(d.providerContactId) ? d.providerContactId : null,
      providerNameSnapshot: str(d.providerNameSnapshot),
      extraContactIds: ids(d.extraContactIds),
      status,
      endReason: status === 'ended' && END_REASONS.includes(d.endReason as EndReason) ? (d.endReason as EndReason) : null,
      startDate: isDate(d.startDate) ? d.startDate : null,
      endDate: isDate(d.endDate) ? d.endDate : null,
      // `cadence` wins when it is set (an older build that changed the schedule on purpose); a twice-monthly schedule is stored beside it, see `toStored`
      cadence: readCadence(d.cadence) ?? readStoredSemi((d as Record<string, unknown>).semiCadence),
      visitTime: isTime(d.visitTime) ? d.visitTime : null,
      expected: ex && EXPECTED_BASES.includes(ex.basis as ExpectedBasis) && finite(ex.cents) && ex.cents >= 0 ? { basis: ex.basis as ExpectedBasis, cents: Math.round(ex.cents) } : null,
      refs: Array.isArray(d.refs) ? d.refs.filter((x) => x && typeof x.label === 'string').map((x) => ({ label: x.label, ...(typeof x.url === 'string' && x.url ? { url: x.url } : {}), ...(typeof x.note === 'string' && x.note ? { note: x.note } : {}) })) : [],
      notes: str(d.notes),
      predecessorId: finite(d.predecessorId) ? d.predecessorId : null,
      openTaskId: finite(d.openTaskId) ? d.openTaskId : null,
      acknowledged: Array.isArray(d.acknowledged) ? d.acknowledged.filter((x): x is string => typeof x === 'string') : [],
      txnRefs: readTxnRefs(d.txnRefs),
      renewalDate: isDate((d as Record<string, unknown>).renewalDate) ? ((d as Record<string, unknown>).renewalDate as string) : null,
      noticeByDate: isDate((d as Record<string, unknown>).noticeByDate) ? ((d as Record<string, unknown>).noticeByDate as string) : null,
    },
  };
}

export const blankArrangement = (over: Partial<ArrangementData> = {}): ArrangementData => ({
  title: '', providerContactId: null, providerNameSnapshot: '', extraContactIds: [], status: 'active', endReason: null, startDate: null, endDate: null,
  cadence: null, visitTime: null, expected: null, refs: [], notes: '', predecessorId: null, openTaskId: null, acknowledged: [], txnRefs: [], renewalDate: null, noticeByDate: null, ...over,
});

import { isSafeUrl } from '../../lib/safeUrl';
/** One shared check (lib/safeUrl.ts); still exported here so existing imports keep working. */
export { isSafeUrl };

/** Is `date` one of the cadence's own dates? (A fixed cadence only; a repeat-after-visit cadence has no fixed dates.) */
export function isCadenceDate(c: Cadence, date: string): boolean {
  if (c.mode === 'after') return true;
  return cadenceBetween(c, date, date)[0] === date;
}

/**
 * The cadence's own dates from `from` to `to`, both included (a fixed cadence only; a repeat-after cadence has none). Every-N-weeks and the
 * other repeats come from the existing `generateDates`; a twice-monthly cadence comes from the small pure adapter in `semimonthly.ts`.
 */
export function cadenceBetween(c: Cadence, from: string, to: string): string[] {
  if (c.mode === 'after') return [];
  if (c.semi) return semiDates(c.semi, c.anchorDate, from, to, c.rule.end.type === 'until' ? c.rule.end.date : null);
  return generateDates(c.anchorDate, c.rule, from, to);
}

/** The first cadence date on or after `from`, or null when the cadence has run out. */
export function nextCadenceDate(c: Cadence, from: string): string | null {
  if (c.mode === 'after') return from <= c.anchorDate ? c.anchorDate : from;
  if (c.semi) return semiNext(c.semi, c.anchorDate, from, c.rule.end.type === 'until' ? c.rule.end.date : null);
  return generateDates(c.anchorDate, c.rule, from, addDays(from, 1500))[0] ?? null;
}

/** Cleans a record before saving: trimmed text, whole-cent amounts, explicit weekday. Does not decide whether it is valid. */
export function normalizeArrangement(d: ArrangementData): ArrangementData {
  const cadence = d.cadence ? readCadence(d.cadence) ?? d.cadence : null;
  return {
    ...d,
    title: tidy(d.title),
    providerNameSnapshot: tidy(d.providerNameSnapshot),
    extraContactIds: ids(d.extraContactIds).filter((x) => x !== d.providerContactId),
    cadence,
    visitTime: d.visitTime ? d.visitTime : null,
    expected: d.expected ? { basis: d.expected.basis, cents: Math.round(d.expected.cents) } : null,
    refs: d.refs.map((r) => ({ label: tidy(r.label), ...(r.url?.trim() ? { url: r.url.trim() } : {}), ...(r.note?.trim() ? { note: r.note.trim() } : {}) })),
    notes: d.notes.trim(),
    endReason: d.status === 'ended' ? d.endReason ?? 'other' : null,
  };
}

/** A plain-words problem with the record, or null when it can be saved. Strict: runs on every save. */
export function validateArrangement(d: ArrangementData): string | null {
  if (!tidy(d.title)) return 'Enter what the service is (for example "House cleaning").';
  if (tidy(d.title).length > 120) return 'The title is too long.';
  if (!STATUSES.includes(d.status)) return 'Pick a status.';
  if (d.providerNameSnapshot.length > 120) return 'The provider name is too long.';
  if (d.startDate !== null && !isDate(d.startDate)) return 'The start date is not a real date.';
  if (d.endDate !== null && !isDate(d.endDate)) return 'The end date is not a real date.';
  if (d.renewalDate !== null && d.renewalDate !== undefined && !isDate(d.renewalDate)) return 'The renewal date is not a real date.';
  if (d.noticeByDate !== null && d.noticeByDate !== undefined && !isDate(d.noticeByDate)) return 'The notice-by date is not a real date.';
  if (d.startDate && d.endDate && d.endDate < d.startDate) return 'The end date is before the start date.';
  if (d.status === 'ended' && d.endReason !== null && !END_REASONS.includes(d.endReason)) return 'Pick why it ended.';
  if (d.visitTime !== null && !isTime(d.visitTime)) return 'The visit time must look like 09:30.';
  if (d.visitTime && !d.cadence) { /* a time with no schedule is allowed: it applies to a one-off visit */ }
  if (d.cadence) {
    const c = d.cadence;
    if (!isDate(c.anchorDate)) return 'Pick a first date for the schedule.';
    const rule = normalizeRule(c.rule);
    if (!rule) return 'The schedule is not valid.';
    if (c.semi !== undefined && c.semi !== null) {
      const semi = readSemi(c.semi);
      if (!semi) return 'The twice-monthly schedule is not valid. Pick two days of the month.';
      if (c.mode !== 'fixed') return 'A twice-monthly schedule is on fixed dates, not "after each visit".';
      const bad = semiProblem(semi);
      if (bad) return bad;
    }
    if (rule.end.type === 'count') return 'Use an end date instead of a number of times. A count would shrink every time a visit is finished.';
    if (c.mode === 'fixed' && !isCadenceDate({ ...c, rule }, c.anchorDate)) return 'The first date does not fall on the chosen day(s). Pick a first date that matches the schedule.';
  }
  if (d.expected) {
    if (!EXPECTED_BASES.includes(d.expected.basis)) return 'Pick what the cost estimate is for.';
    if (!finite(d.expected.cents) || d.expected.cents < 0 || d.expected.cents > 1e11) return 'The cost estimate is not a valid amount.';
  }
  if (d.refs.length > 20) return 'At most 20 document links.';
  for (const r of d.refs) {
    if (!tidy(r.label)) return 'Give each document link a name.';
    if (r.label.length > 120 || (r.note?.length ?? 0) > 500) return 'A document link name or note is too long.';
    if (r.url && !isSafeUrl(r.url)) return 'Links must start with http:// or https://.';
  }
  if (d.notes.length > 4000) return 'The notes are too long.';
  const refsProblem = validateTxnRefs(d.txnRefs);
  if (refsProblem) return refsProblem;
  if (d.providerContactId === null && d.extraContactIds.length > 0) return 'Pick the main provider before adding other contacts.';
  return null;
}

/** "Every 2 weeks on Fri" / "3 months after each visit" / "On demand". */
export function cadenceText(c: Cadence | null): string {
  if (!c) return 'On demand (no regular schedule)';
  if (c.mode === 'after') {
    const n = c.rule.interval;
    const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[c.rule.freq];
    return `${n} ${unit}${n === 1 ? '' : 's'} after each visit`;
  }
  if (c.semi) return `${describeSemi(c.semi).replace(/\.$/, '')}${c.rule.end.type === 'until' ? `, until ${c.rule.end.date}` : ''}`;
  return describeRule(c.rule, c.anchorDate);
}

/** Soft hints that do not block saving: a nudge only, never a security control. */
export function notesWarning(notes: string): string | null {
  return /\b(password|passcode|pin|code|combination|account\s*(number|no)|iban|routing)\b/i.test(notes) || /\d{6,}/.test(notes.replace(/[\s-]/g, ''))
    ? 'This looks like it may contain a code, password or account number. Plain backups and exports are not encrypted, so keep those in a password manager instead.'
    : null;
}
