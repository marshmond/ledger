/**
 * Bills & Subscriptions records (B1). They live in the shared `moduleRecords` table (module 'bills', kind 'obligation'), so backup, restore
 * and device sync already cover them. A provider is an ordinary shared Contact: the obligation stores the contact's id and a name snapshot so
 * history stays readable if the contact is removed.
 *
 * Money is whole cents; dates are 'YYYY-MM-DD' with no time zone. An EXPECTED amount is a plan, never a payment; an UNKNOWN amount is never
 * zero. NO account number, card number, password or access code is stored anywhere in this module.
 *
 * READING IS DEFENSIVE AND LOSSLESS. `asObligation` never throws. A field that is present but unreadable (a newer version's value, a damaged
 * value) is replaced by a safe placeholder for display and its exact raw value is kept in `rawKept`; an ordinary edit writes it back unchanged
 * unless the person changed that field on purpose (`applyEdit`). Fields this version does not know at all are carried through untouched.
 */
import type { ModuleRecord } from '../../core/entities';
import { localISO } from '../../core/time';
import { readSchedule, scheduleProblem, type Pause, type Schedule, type ScheduleRevision, type ScheduleSource } from './schedule';
import { finite, isCents, isDate, isInt, notesWarning, str, tidy, without, isSafeUrl } from './util';

export const MODULE = 'bills';
export const KIND = 'obligation';

export const obligationRefId = (id: number) => `obligation:${id}`;
export const parseObligationRef = (id: string | number): number | null => {
  const m = /^obligation:(\d+)$/.exec(String(id));
  return m ? Number(m[1]) : null;
};
export const obligationRef = (id: number) => ({ module: MODULE, id: obligationRefId(id) });

export const TYPES = ['utility', 'housing', 'insurance', 'telecom', 'childcare', 'subscription', 'membership', 'tax', 'loan', 'other'] as const;
export type BillType = (typeof TYPES)[number];
export const TYPE_LABEL: Record<BillType, string> = {
  utility: 'Utility', housing: 'Housing', insurance: 'Insurance', telecom: 'Phone and internet', childcare: 'Childcare', subscription: 'Subscription',
  membership: 'Membership', tax: 'Tax', loan: 'Loan', other: 'Other',
};
export const NEEDS = ['essential', 'flexible', 'unsure'] as const;
export type Need = (typeof NEEDS)[number];
export const NEED_LABEL: Record<Need, string> = { essential: 'Essential', flexible: 'Flexible', unsure: 'Not sure' };
export const AMOUNT_KINDS = ['fixed', 'variable', 'unknown'] as const;
export type AmountKind = (typeof AMOUNT_KINDS)[number];
export const AMOUNT_KIND_LABEL: Record<AmountKind, string> = { fixed: 'The same each time', variable: 'It varies', unknown: 'I do not know' };
export const HOWS = ['auto', 'manual', 'unknown'] as const;
export type How = (typeof HOWS)[number];
export const HOW_LABEL: Record<How, string> = { auto: 'Paid automatically', manual: 'I pay it by hand', unknown: 'Not sure' };
export const STATUSES = ['active', 'paused', 'ended'] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status | 'unsupported', string> = { active: 'Active', paused: 'Paused', ended: 'Ended', unsupported: 'Needs review' };
export const END_REASONS = ['cancelled', 'replaced', 'finished', 'other'] as const;
export type EndReason = (typeof END_REASONS)[number];
export const END_REASON_LABEL: Record<EndReason, string> = { cancelled: 'Cancelled', replaced: 'Replaced', finished: 'Finished', other: 'Other' };

/** Suggested label only: it never restricts anything (A-11). */
export const defaultNeed = (t: BillType): Need => (t === 'subscription' || t === 'membership' ? 'flexible' : t === 'other' ? 'unsure' : 'essential');
/** Guesses the type from words in the title. Only a label: it never changes behaviour and the form can change it. */
export function guessType(title: string): BillType {
  const t = title.toLowerCase();
  if (/\b(insurance|insure)\b/.test(t)) return 'insurance';
  if (/\b(electric|electricity|power|water|gas|sewer|trash|garbage|utility|utilities)\b/.test(t)) return 'utility';
  if (/\b(internet|phone|mobile|cell|broadband|wifi|fibre|fiber)\b/.test(t)) return 'telecom';
  if (/\b(rent|hoa)\b/.test(t)) return 'housing';
  if (/\b(daycare|childcare|nursery|tuition)\b/.test(t)) return 'childcare';
  if (/\b(gym|club|membership)\b/.test(t)) return 'membership';
  if (/\b(tax|taxes)\b/.test(t)) return 'tax';
  if (/\b(mortgage|loan)\b/.test(t)) return 'loan';
  if (/\b(premium|plus|prime|streaming|music|video|news|cloud|subscription)\b/.test(t)) return 'subscription';
  return 'other';
}

export const isSubscriptionType = (t: BillType) => t === 'subscription' || t === 'membership';

/** One price in force from a date (B0 3.2). B1 writes the first step only; the list shape is final so later phases add steps. `cents: null` = unknown. */
export interface PriceStep { from: string; cents: number | null; label: string }
export interface Payment { how: How; /** A Finance account, read live and never written. NOT proof of payment. */ fundingAccountId: number | null }
export interface Review { on: boolean; note: string; since: string | null }
/** B2: `payTask` = keep ONE open "pay" Task for the next unpaid period (off unless the owner turns it on); `leadDays` = how many days before the due date the Task is for. (The "no Tasks for cancel-by and trial-end dates" choice is the separate top-level field `noDeadlineTasks`, so an older build that rewrites `reminders` cannot drop it.) */
export interface Reminders { payTask: boolean; leadDays: number }
export interface LifecycleEntry { on: string; kind: string; note: string }
export interface DocRef { label: string; url?: string; note?: string }

export interface ObligationData {
  title: string;
  type: BillType;
  need: Need;
  providerContactId: number | null;
  providerNameSnapshot: string;
  amountKind: AmountKind;
  prices: PriceStep[];
  schedule: Schedule | null;
  scheduleHistory: ScheduleRevision[];
  trackingSince: string;
  pauses: Pause[];
  payment: Payment;
  /** Later phases (kept, never edited in B1). */
  scheduledRuleIds: number[];
  payeeHints: string[];
  categoryId: number | null;
  loanId: number | null;
  paidThroughLoan: boolean;
  reminders: Reminders | null;
  /** B2: the owner turned off Tasks for cancel-by and trial-end dates. A top-level field on purpose: the deployed B1 build keeps unknown top-level fields but rewrites `reminders`. */
  noDeadlineTasks: boolean;
  terms: Record<string, unknown> | null;
  cancellation: Record<string, unknown> | null;
  predecessorId: number | null;
  acknowledged: string[];
  status: Status | 'unsupported';
  endedOn: string | null;
  endReason: EndReason | null;
  /** A small log of what the owner did to it (paused, resumed, ended, reopened ...). Newest last; the reader keeps the last 200. */
  lifecycle: LifecycleEntry[];
  review: Review;
  refs: DocRef[];
  notes: string;
  /** Reader only, never stored: exact raw values of fields that were present but unreadable. Written back unchanged by an ordinary edit. */
  rawKept: Record<string, unknown>;
}
export interface ObligationRecord { id: number; createdAt: number; updatedAt: number; data: ObligationData }

const KNOWN = new Set(['title', 'type', 'need', 'providerContactId', 'providerNameSnapshot', 'amountKind', 'prices', 'schedule', 'scheduleHistory', 'trackingSince', 'pauses', 'payment', 'scheduledRuleIds', 'payeeHints', 'categoryId', 'loanId', 'paidThroughLoan', 'reminders', 'noDeadlineTasks', 'terms', 'cancellation', 'predecessorId', 'acknowledged', 'status', 'endedOn', 'endReason', 'lifecycle', 'review', 'refs', 'notes']);
const extras = (d: object) => Object.fromEntries(Object.entries(d).filter(([k, v]) => !KNOWN.has(k) && v !== undefined)) as object;
const present = (v: unknown) => v !== undefined && v !== null;
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const dayOf = (ms: number) => localISO(ms);
const ids = (v: unknown): number[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)))] : []);
const MAX_LIFECYCLE = 200;

/** Reads a stored record defensively. Never throws. */
export function asObligation(r: ModuleRecord): ObligationRecord {
  const d = (r.data ?? {}) as Record<string, unknown>;
  const raw: Record<string, unknown> = {};
  const bad = (k: string) => { raw[k] = d[k]; };

  let type: BillType = 'other';
  if (TYPES.includes(d.type as BillType)) type = d.type as BillType; else if (present(d.type)) bad('type');
  let need: Need = defaultNeed(type);
  if (NEEDS.includes(d.need as Need)) need = d.need as Need; else if (present(d.need)) bad('need');
  let amountKind: AmountKind = 'unknown';
  if (AMOUNT_KINDS.includes(d.amountKind as AmountKind)) amountKind = d.amountKind as AmountKind; else if (present(d.amountKind)) bad('amountKind');
  let status: Status | 'unsupported' = 'active';
  if (STATUSES.includes(d.status as Status)) status = d.status as Status; else if (present(d.status)) { status = 'unsupported'; bad('status'); }

  let prices: PriceStep[] = [];
  if (Array.isArray(d.prices)) {
    prices = d.prices.flatMap((p) => (plain(p) && isDate(p.from) && (p.cents === null || isCents(p.cents)) ? [{ from: p.from, cents: p.cents as number | null, label: str(p.label) }] : []));
    if (prices.length !== d.prices.length) bad('prices');
    prices.sort((a, b) => a.from.localeCompare(b.from));
  } else if (present(d.prices)) bad('prices');

  let schedule: Schedule | null = null;
  if (present(d.schedule)) { schedule = readSchedule(d.schedule); if (!schedule) bad('schedule'); }

  let scheduleHistory: ScheduleRevision[] = [];
  if (Array.isArray(d.scheduleHistory)) {
    scheduleHistory = d.scheduleHistory.flatMap((h) => { const s = plain(h) ? readSchedule(h.schedule) : null; return plain(h) && isDate(h.until) && s ? [{ until: h.until, schedule: s }] : []; });
    if (scheduleHistory.length !== d.scheduleHistory.length) bad('scheduleHistory');
    scheduleHistory.sort((a, b) => a.until.localeCompare(b.until));
  } else if (present(d.scheduleHistory)) bad('scheduleHistory');

  let trackingSince = dayOf(r.createdAt || 0);
  if (isDate(d.trackingSince)) trackingSince = d.trackingSince; else if (present(d.trackingSince)) bad('trackingSince');

  let pauses: Pause[] = [];
  if (Array.isArray(d.pauses)) {
    pauses = d.pauses.flatMap((p) => (plain(p) && isDate(p.from) && (p.to === null || (isDate(p.to) && p.to >= p.from)) ? [{ from: p.from, to: p.to as string | null }] : []));
    if (pauses.length !== d.pauses.length) bad('pauses');
  } else if (present(d.pauses)) bad('pauses');

  let payment: Payment = { how: 'unknown', fundingAccountId: null };
  if (plain(d.payment) && HOWS.includes(d.payment.how as How) && (d.payment.fundingAccountId === undefined || d.payment.fundingAccountId === null || (isInt(d.payment.fundingAccountId) && d.payment.fundingAccountId > 0))) {
    payment = { how: d.payment.how as How, fundingAccountId: (d.payment.fundingAccountId as number | null | undefined) ?? null };
  } else if (present(d.payment)) bad('payment');

  let reminders: Reminders | null = null;
  if (plain(d.reminders) && typeof d.reminders.payTask === 'boolean' && isInt(d.reminders.leadDays) && d.reminders.leadDays >= 0 && d.reminders.leadDays <= 60) reminders = { payTask: d.reminders.payTask, leadDays: d.reminders.leadDays };
  else if (present(d.reminders)) bad('reminders');

  if (present(d.noDeadlineTasks) && typeof d.noDeadlineTasks !== 'boolean') bad('noDeadlineTasks');
  let terms: Record<string, unknown> | null = null;
  if (plain(d.terms)) terms = d.terms; else if (present(d.terms)) bad('terms');
  let cancellation: Record<string, unknown> | null = null;
  if (plain(d.cancellation)) cancellation = d.cancellation; else if (present(d.cancellation)) bad('cancellation');

  let endedOn: string | null = null;
  if (isDate(d.endedOn)) endedOn = d.endedOn; else if (present(d.endedOn)) bad('endedOn');
  let endReason: EndReason | null = null;
  if (END_REASONS.includes(d.endReason as EndReason)) endReason = status === 'ended' ? (d.endReason as EndReason) : null; else if (present(d.endReason)) bad('endReason');

  let lifecycle: LifecycleEntry[] = [];
  if (Array.isArray(d.lifecycle)) {
    lifecycle = d.lifecycle.flatMap((e) => (plain(e) && isDate(e.on) && typeof e.kind === 'string' ? [{ on: e.on, kind: e.kind, note: str(e.note) }] : []));
    if (lifecycle.length !== d.lifecycle.length) bad('lifecycle');
    lifecycle = lifecycle.slice(-MAX_LIFECYCLE);
  } else if (present(d.lifecycle)) bad('lifecycle');

  let review: Review = { on: false, note: '', since: null };
  if (plain(d.review) && typeof d.review.on === 'boolean') review = { on: d.review.on, note: str(d.review.note), since: isDate(d.review.since) ? d.review.since : null };
  else if (present(d.review)) bad('review');

  let refs: DocRef[] = [];
  if (Array.isArray(d.refs)) {
    refs = d.refs.flatMap((x) => (plain(x) && typeof x.label === 'string' ? [{ label: x.label, ...(typeof x.url === 'string' && x.url ? { url: x.url } : {}), ...(typeof x.note === 'string' && x.note ? { note: x.note } : {}) }] : []));
    if (refs.length !== d.refs.length) bad('refs');
  } else if (present(d.refs)) bad('refs');

  if (present(d.providerContactId) && !finite(d.providerContactId)) bad('providerContactId');
  if (present(d.categoryId) && !finite(d.categoryId)) bad('categoryId');
  if (present(d.loanId) && !finite(d.loanId)) bad('loanId');
  if (present(d.predecessorId) && !finite(d.predecessorId)) bad('predecessorId');
  if (present(d.title) && typeof d.title !== 'string') bad('title');
  if (present(d.notes) && typeof d.notes !== 'string') bad('notes');

  return {
    id: r.id as number, createdAt: r.createdAt, updatedAt: r.updatedAt,
    data: {
      ...(extras(d) as object),
      title: str(d.title, '(no title)'), type, need,
      providerContactId: finite(d.providerContactId) ? d.providerContactId : null,
      providerNameSnapshot: str(d.providerNameSnapshot),
      amountKind, prices, schedule, scheduleHistory, trackingSince, pauses, payment,
      scheduledRuleIds: ids(d.scheduledRuleIds),
      payeeHints: Array.isArray(d.payeeHints) ? d.payeeHints.filter((x): x is string => typeof x === 'string') : [],
      categoryId: finite(d.categoryId) ? d.categoryId : null,
      loanId: finite(d.loanId) ? d.loanId : null,
      paidThroughLoan: d.paidThroughLoan === true,
      reminders, noDeadlineTasks: d.noDeadlineTasks === true, terms, cancellation,
      predecessorId: finite(d.predecessorId) ? d.predecessorId : null,
      acknowledged: Array.isArray(d.acknowledged) ? d.acknowledged.filter((x): x is string => typeof x === 'string') : [],
      status, endedOn, endReason, lifecycle, review, refs, notes: str(d.notes),
      rawKept: raw,
    },
  };
}

/** Names of the fields that were present but could not be read: shown as "Needs review", written back unchanged. */
export const needsReview = (d: ObligationData): string[] => Object.keys(d.rawKept);

/** An edit: the changed fields replace the old ones, and a raw value kept for a changed field is dropped (the person chose a new value). */
export function applyEdit(d: ObligationData, patch: Partial<ObligationData>): ObligationData {
  return { ...d, ...patch, rawKept: without(d.rawKept, Object.keys(patch)) };
}

export const blankObligation = (over: Partial<ObligationData> = {}, today = ''): ObligationData => ({
  title: '', type: 'other', need: 'unsure', providerContactId: null, providerNameSnapshot: '', amountKind: 'unknown', prices: [], schedule: null, scheduleHistory: [],
  trackingSince: today, pauses: [], payment: { how: 'unknown', fundingAccountId: null }, scheduledRuleIds: [], payeeHints: [], categoryId: null, loanId: null,
  paidThroughLoan: false, reminders: null, noDeadlineTasks: false, terms: null, cancellation: null, predecessorId: null, acknowledged: [], status: 'active', endedOn: null, endReason: null,
  lifecycle: [], review: { on: false, note: '', since: null }, refs: [], notes: '', rawKept: {}, ...over,
});

/**
 * The form written to the database. Every write of an obligation goes through this. Optional things are stored only when set, so an unused
 * feature leaves no trace; raw values kept by the reader are written back; unknown fields ride along inside `rest`.
 */
export function toStored(d: ObligationData): Record<string, unknown> {
  const { rawKept, providerContactId, providerNameSnapshot, prices, schedule, scheduleHistory, pauses, payment, scheduledRuleIds, payeeHints, categoryId, loanId, paidThroughLoan, reminders, noDeadlineTasks, terms, cancellation, predecessorId, acknowledged, endedOn, endReason, lifecycle, review, refs, notes, ...rest } = d;
  const out: Record<string, unknown> = {
    ...rest,
    payment: { how: payment.how, ...(payment.fundingAccountId !== null ? { fundingAccountId: payment.fundingAccountId } : {}) },
  };
  if (providerContactId !== null) { out.providerContactId = providerContactId; out.providerNameSnapshot = providerNameSnapshot; } else if (providerNameSnapshot) out.providerNameSnapshot = providerNameSnapshot;
  if (prices.length) out.prices = prices;
  if (schedule) out.schedule = schedule;
  if (scheduleHistory.length) out.scheduleHistory = scheduleHistory;
  if (pauses.length) out.pauses = pauses;
  if (scheduledRuleIds.length) out.scheduledRuleIds = scheduledRuleIds;
  if (payeeHints.length) out.payeeHints = payeeHints;
  if (categoryId !== null) out.categoryId = categoryId;
  if (loanId !== null) out.loanId = loanId;
  if (paidThroughLoan) out.paidThroughLoan = true;
  if (reminders) out.reminders = reminders;
  if (noDeadlineTasks) out.noDeadlineTasks = true;
  if (terms) out.terms = terms;
  if (cancellation) out.cancellation = cancellation;
  if (predecessorId !== null) out.predecessorId = predecessorId;
  if (acknowledged.length) out.acknowledged = acknowledged;
  if (endedOn) out.endedOn = endedOn;
  if (endReason) out.endReason = endReason;
  if (lifecycle.length) out.lifecycle = lifecycle.slice(-MAX_LIFECYCLE);
  if (review.on || review.note || review.since) out.review = { on: review.on, ...(review.note ? { note: review.note } : {}), ...(review.since ? { since: review.since } : {}) };
  if (refs.length) out.refs = refs;
  if (notes) out.notes = notes;
  for (const [k, v] of Object.entries(rawKept)) out[k] = v; // exactly as found
  return out;
}

/** Cleans a record before saving: trimmed text, whole-cent amounts, sorted lists. Does not decide whether it is valid. */
export function normalizeObligation(d: ObligationData): ObligationData {
  return {
    ...d,
    title: tidy(d.title),
    providerNameSnapshot: tidy(d.providerNameSnapshot),
    prices: d.prices.map((p) => ({ from: p.from, cents: p.cents === null ? null : Math.round(p.cents), label: tidy(p.label) })).sort((a, b) => a.from.localeCompare(b.from)),
    scheduleHistory: [...d.scheduleHistory].sort((a, b) => a.until.localeCompare(b.until)),
    review: { on: d.review.on, note: d.review.note.trim(), since: d.review.since },
    refs: d.refs.map((r) => ({ label: tidy(r.label), ...(r.url?.trim() ? { url: r.url.trim() } : {}), ...(r.note?.trim() ? { note: r.note.trim() } : {}) })),
    notes: d.notes.trim(),
    endReason: d.status === 'ended' ? d.endReason ?? 'other' : null,
    endedOn: d.status === 'active' ? null : d.endedOn,
  };
}

/** A plain-words problem with the record, or null when it can be saved. Strict: runs on every save. */
export function validateObligation(d: ObligationData): string | null {
  const kept = (k: string) => k in d.rawKept;
  if (!tidy(d.title)) return 'Enter what the bill or subscription is (for example "Streamly Premium").';
  if (tidy(d.title).length > 120) return 'The title is too long.';
  if (!TYPES.includes(d.type) && !kept('type')) return 'Pick a type.';
  if (!NEEDS.includes(d.need) && !kept('need')) return 'Pick essential, flexible or not sure.';
  if (d.providerNameSnapshot.length > 120) return 'The provider name is too long.';
  if (!AMOUNT_KINDS.includes(d.amountKind) && !kept('amountKind')) return 'Pick whether the amount is the same each time, varies, or is not known.';
  if (!isDate(d.trackingSince)) return 'The tracking start date is not a real date.';
  for (const p of d.prices) {
    if (!isDate(p.from)) return 'A price has a date that is not a real date.';
    if (p.cents !== null && !isCents(p.cents)) return 'The amount is not valid. Use whole cents between 0 and $1,000,000,000.';
    if (p.label.length > 60) return 'A price label is too long.';
  }
  if (d.amountKind === 'fixed' && !d.prices.some((p) => p.cents !== null) && !kept('prices')) return 'Enter the amount, or choose "It varies" or "I do not know".';
  if (d.schedule) { const p = scheduleProblem(d.schedule); if (p) return p; }
  for (const h of d.scheduleHistory) {
    if (!isDate(h.until)) return 'A schedule change has a date that is not a real date.';
    const p = scheduleProblem(h.schedule); if (p) return p;
  }
  for (const p of d.pauses) if (!isDate(p.from) || (p.to !== null && (!isDate(p.to) || p.to < p.from))) return 'A pause has dates that are not valid.';
  if (d.pauses.filter((p) => p.to === null).length > 1) return 'Only one pause can be open at a time.';
  if (!HOWS.includes(d.payment.how)) return 'Pick how it is paid.';
  const f = d.payment.fundingAccountId;
  if (f !== null && !(isInt(f) && f > 0)) return 'The funding account is not valid.';
  if (!STATUSES.includes(d.status as Status) && !(d.status === 'unsupported' && kept('status'))) return 'Pick a status.';
  if (d.status === 'ended') {
    if (!isDate(d.endedOn)) return 'Enter the date it ended.';
    if (d.endedOn < d.trackingSince) return 'The end date is before the tracking start date.';
    if (d.endReason !== null && !END_REASONS.includes(d.endReason)) return 'Pick why it ended.';
  }
  if (d.review.note.length > 500) return 'The review note is too long.';
  if (d.refs.length > 20) return 'At most 20 document links.';
  for (const r of d.refs) {
    if (!tidy(r.label)) return 'Give each document link a name.';
    if (r.label.length > 120 || (r.note?.length ?? 0) > 500) return 'A document link name or note is too long.';
    if (r.url && !isSafeUrl(r.url)) return 'Links must start with http:// or https://.';
  }
  if (d.notes.length > 4000) return 'The notes are too long.';
  return null;
}

/** Soft hint that does not block saving. */
export { notesWarning };

// ---- amounts and prices ----

/** The price step in force on `date`: the last whose `from` is on or before it. None in force = the amount is not known for that date. */
export function priceOn(prices: PriceStep[], date: string): PriceStep | null {
  let hit: PriceStep | null = null;
  for (const p of prices) if (p.from <= date) hit = p;
  return hit;
}
export interface ExpectedAmount { cents: number | null; basis: AmountKind }
/** What one expected date is expected to cost. `cents: null` = not known (never zero). Fixed amounts are KNOWN, variable ones are ESTIMATES. */
export function expectedAmountOn(d: Pick<ObligationData, 'amountKind' | 'prices'>, date: string): ExpectedAmount {
  if (d.amountKind === 'unknown') return { cents: null, basis: 'unknown' };
  return { cents: priceOn(d.prices, date)?.cents ?? null, basis: d.amountKind };
}
/** The first (or only) amount the owner entered, for the form. */
export const firstAmountCents = (d: Pick<ObligationData, 'prices'>): number | null => d.prices.find((p) => p.cents !== null)?.cents ?? null;

/** The slice of an obligation the date reader needs. */
export const scheduleSource = (d: ObligationData): ScheduleSource => ({
  schedule: d.schedule, scheduleHistory: d.scheduleHistory, trackingSince: d.trackingSince, pauses: d.pauses, status: d.status, endedOn: d.endedOn,
});

/** Loans own their payments (A-8): a loan-type obligation, one tracked in Loans, or one paid through the loan is left out of every total. */
export const isLoanExcluded = (d: ObligationData) => d.type === 'loan' || d.loanId !== null || d.paidThroughLoan;

/** The ordered label of a record in lists, search and links: title, provider name and status only. Never an amount, note or link. */
export const obligationLabel = (r: ObligationRecord) =>
  `${r.data.title}${r.data.providerNameSnapshot ? `, ${r.data.providerNameSnapshot}` : ''}${r.data.status !== 'active' ? ` (${STATUS_LABEL[r.data.status].toLowerCase()})` : ''}`;

/** Appends one entry to the lifecycle log. */
export const withLog = (d: ObligationData, on: string, kind: string, note = ''): ObligationData => ({ ...d, lifecycle: [...d.lifecycle, { on, kind, note }].slice(-MAX_LIFECYCLE) });

/** Does this record carry history that would be lost by permanently deleting it? (B1: any change to its life story, a successor link, or a Finance pointer.) */
export function historyReasons(d: ObligationData): string[] {
  const out: string[] = [];
  if (d.status !== 'active') out.push(d.status === 'ended' ? 'it has been ended' : 'it is paused');
  if (d.pauses.length) out.push('it has been paused before');
  if (d.scheduleHistory.length) out.push('its schedule has changed');
  if (d.lifecycle.length) out.push('its life story has entries');
  if (d.predecessorId !== null) out.push('it replaced another one');
  if (d.scheduledRuleIds.length) out.push('it points at a Finance scheduled item');
  if (d.loanId !== null) out.push('it points at a loan');
  return out;
}
