/**
 * Subscription LIFECYCLE FACT records (B4). Each `lifecycle` record in the shared `moduleRecords` table (module 'bills', kind 'lifecycle') is ONE
 * thing the owner recorded about ONE obligation: a trial, a trial extension, a price step, a renewal term, a cancellation request, a provider's
 * confirmation, a withdrawal, a reactivation, an acknowledgement. They are ADDED, never edited and never merged: two devices that each record
 * something add two records, and neither overwrites the other (B0 10.4 "escalation path": append-only records of the same shape as cycle facts, so
 * no sync rule changes). Backup, restore and sync carry them like any module record.
 *
 * Common fields (all optional but `obligationId` and `fact`):
 *   replaces   ids of earlier lifecycle records this one CORRECTS. A replaced record stays visible as history and is excluded from every
 *              figure. Replacing is itself an added record, so it never edits another device's work. A replacement only counts when its id is
 *              LATER than the record it replaces (ids are time-based), so two records can never replace each other.
 *   targets    ids of cancellation records a withdrawal or reactivation NEGATES (the same visible-history rule).
 *   seen       ids of the lifecycle records this device could see when the record was written. It is how two OFFLINE devices that did not see
 *              each other are told apart from one owner correcting themselves (concurrent evidence is flagged, never silently resolved).
 *   op         an id made when a form opened, so a double press saves once.
 *
 * READING IS DEFENSIVE AND LOSSLESS. `readLifecycle` never throws and never invents. A record whose fact type this version does not know, or whose
 * fields are damaged, comes back with `body: null` and a plain reason: it is listed as "needs review", counts for nothing and is never rewritten.
 * Unknown fields are carried through every write.
 *
 * MONEY: whole cents. `cents: null` / an absent amount is UNKNOWN and is never zero; `0` is a confirmed zero price. Nothing here is a payment.
 */
import type { ModuleRecord } from '../../core/entities';
import { MODULE } from './model';
import { isCents, isDate, isInt, str, tidy } from './util';

export const LC_KIND = 'lifecycle';
export const lcRefId = (id: number) => `lifecycle:${id}`;
export const MAX_SEEN = 100;

export const LC_FACTS = ['trial', 'trial-extend', 'trial-outcome', 'price-step', 'renewal', 'renewal-outcome', 'cancel-plan', 'cancel-request', 'cancel-confirm', 'cancel-withdraw', 'reactivate', 'service-link', 'ack'] as const;
export type LcFactType = (typeof LC_FACTS)[number];
export const LC_LABEL: Record<LcFactType, string> = {
  trial: 'Trial', 'trial-extend': 'Trial extended', 'trial-outcome': 'Trial outcome', 'price-step': 'Price', renewal: 'Renewal terms', 'renewal-outcome': 'Renewal outcome',
  'cancel-plan': 'Cancellation planned', 'cancel-request': 'Cancellation requested', 'cancel-confirm': 'Cancellation confirmed', 'cancel-withdraw': 'Cancellation withdrawn',
  reactivate: 'Reactivated', 'service-link': 'Household Services link', ack: 'Left as is',
};

export const YESNO = ['yes', 'no', 'unknown'] as const;
export type YesNo = (typeof YESNO)[number];
export const CONVERSIONS = ['auto', 'manual', 'unknown'] as const;
export type Conversion = (typeof CONVERSIONS)[number];
export const CADENCES = ['weekly', 'monthly', 'quarterly', 'annual', 'other', 'unknown'] as const;
export type Cadence = (typeof CADENCES)[number];
export const CADENCE_LABEL: Record<Cadence, string> = { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Every 3 months', annual: 'Yearly', other: 'Other', unknown: 'Not sure' };
export const TRIAL_OUTCOMES = ['converted', 'ended-no-charge', 'cancelled'] as const;
export type TrialOutcome = (typeof TRIAL_OUTCOMES)[number];
export const PRICE_STATUSES = ['fixed', 'estimated', 'unknown'] as const;
export type PriceStatus = (typeof PRICE_STATUSES)[number];
export const PRICE_SOURCES = ['provider-notice', 'invoice', 'owner', 'finance', 'other'] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];
export const PRICE_SOURCE_LABEL: Record<PriceSource, string> = { 'provider-notice': 'The provider told me', invoice: 'A bill showed it', owner: 'My own note', finance: 'A payment in Finance', other: 'Other' };
export const RENEWAL_CHANGES = ['price', 'terms', 'both', 'none', 'unknown'] as const;
export type RenewalChanges = (typeof RENEWAL_CHANGES)[number];
export const RENEWAL_OUTCOMES = ['renewed', 'not-renewed', 'unsure'] as const;
export type RenewalOutcome = (typeof RENEWAL_OUTCOMES)[number];
export const METHODS = ['website', 'phone', 'email', 'mail', 'other'] as const;
export type Method = (typeof METHODS)[number];
export const METHOD_LABEL: Record<Method, string> = { website: 'Website or app', phone: 'Phone', email: 'Email', mail: 'Letter', other: 'Other' };
export const FINAL_CHARGES = ['none', 'expected', 'unknown'] as const;
export type FinalCharge = (typeof FINAL_CHARGES)[number];
export const WITHDRAW_KINDS = ['owner-retracted', 'provider-rejected', 'provider-withdrew'] as const;
export type WithdrawKind = (typeof WITHDRAW_KINDS)[number];
export const WITHDRAW_LABEL: Record<WithdrawKind, string> = { 'owner-retracted': 'I changed my mind', 'provider-rejected': 'The provider did not accept it', 'provider-withdrew': 'The provider withdrew its confirmation' };

export type LcBody =
  | { fact: 'trial'; startsOn: string | null; endsOn: string; paymentOnFile: YesNo; conversion: Conversion; convertsToCents: number | null; cadence: Cadence; mustCancel: boolean; noticeBy: string | null; note: string }
  | { fact: 'trial-extend'; endsOn: string; note: string }
  | { fact: 'trial-outcome'; outcome: TrialOutcome; on: string; note: string }
  | { fact: 'price-step'; from: string; until: string | null; cents: number | null; status: PriceStatus; label: string; source: PriceSource; note: string }
  | { fact: 'renewal'; renewalDate: string; cadence: Cadence; auto: boolean | null; noticeDays: number | null; noticeByDate: string | null; changes: RenewalChanges; confirmed: boolean; note: string }
  | { fact: 'renewal-outcome'; forDate: string; outcome: RenewalOutcome; on: string; note: string }
  | { fact: 'cancel-plan'; plannedOn: string | null; note: string }
  | { fact: 'cancel-request'; requestedOn: string; requestedEffectiveOn: string | null; method: Method; ref: string; awaiting: boolean; note: string }
  | { fact: 'cancel-confirm'; confirmedOn: string; effectiveOn: string; providerRef: string; finalCharge: FinalCharge; finalChargeCents: number | null; refundCents: number | null; accessUntil: string | null; note: string }
  | { fact: 'cancel-withdraw'; on: string; kind: WithdrawKind; note: string }
  | { fact: 'reactivate'; on: string; note: string }
  | { fact: 'service-link'; arrangementId: number; action: 'linked' | 'unlinked'; on: string }
  /** "Leave as is" on a review item. `key` names the exact evidence; new or changed evidence has a different key, so it is raised again. */
  | { fact: 'ack'; key: string; on: string };

export interface LcRecord {
  id: number;
  createdAt: number;
  updatedAt: number;
  obligationId: number | null;
  factName: string;
  body: LcBody | null;
  op: string | null;
  replaces: number[];
  targets: number[];
  seen: number[];
  problem: string | null;
  /** Everything stored, exactly as found (unknown fields included). */
  raw: Record<string, unknown>;
}
export type LcEff = LcRecord & { body: LcBody; obligationId: number };
export type LcOf<F extends LcFactType> = LcEff & { body: Extract<LcBody, { fact: F }> };

const COMMON = new Set(['obligationId', 'fact', 'op', 'replaces', 'targets', 'seen']);
const present = (v: unknown) => v !== undefined && v !== null;
const optDate = (v: unknown): string | null | 'bad' => (!present(v) ? null : isDate(v) ? v : 'bad');
const pick = <T extends string>(list: readonly T[], v: unknown, d: T): T | 'bad' => (!present(v) ? d : list.includes(v as T) ? (v as T) : 'bad');
const idList = (v: unknown): number[] | 'bad' => (!present(v) ? [] : Array.isArray(v) && v.every((x) => isInt(x) && x > 0) ? (v as number[]) : 'bad');

/** Reads one stored lifecycle record. Never throws. */
export function readLifecycle(r: ModuleRecord): LcRecord {
  const d = (r.data ?? {}) as Record<string, unknown>;
  const base = { id: r.id as number, createdAt: r.createdAt, updatedAt: r.updatedAt, raw: d, factName: typeof d.fact === 'string' ? d.fact : '' };
  const none = { op: typeof d.op === 'string' ? d.op : null, replaces: [] as number[], targets: [] as number[], seen: [] as number[] };
  const fail = (problem: string): LcRecord => ({ ...base, ...none, obligationId: isInt(d.obligationId) && d.obligationId > 0 ? d.obligationId : null, body: null, problem });
  if (!isInt(d.obligationId) || d.obligationId <= 0) return fail('It does not say which bill it belongs to.');
  const replaces = idList(d.replaces), targets = idList(d.targets), seen = idList(d.seen);
  if (replaces === 'bad' || targets === 'bad' || seen === 'bad') return fail('A correction mark on it cannot be read.');
  if (present(d.op) && typeof d.op !== 'string') return fail('An internal mark on it cannot be read.');
  const common = { ...base, obligationId: d.obligationId, op: typeof d.op === 'string' ? d.op : null, replaces, targets, seen: seen.slice(-MAX_SEEN), problem: null };
  const ok = (body: LcBody): LcRecord => ({ ...common, body });
  const bad = (what: string) => fail(`${what} cannot be read, so this record is not counted.`);
  const note = () => (present(d.note) && typeof d.note !== 'string' ? null : str(d.note));
  const n = note();
  if (n === null) return bad('The note');
  switch (d.fact) {
    case 'trial': {
      const startsOn = optDate(d.startsOn), noticeBy = optDate(d.noticeBy);
      if (!isDate(d.endsOn) || startsOn === 'bad' || noticeBy === 'bad') return bad('A trial date');
      const pay = pick(YESNO, d.paymentOnFile, 'unknown'), conv = pick(CONVERSIONS, d.conversion, 'unknown'), cad = pick(CADENCES, d.cadence, 'unknown');
      if (pay === 'bad' || conv === 'bad' || cad === 'bad') return bad('A trial setting');
      if (present(d.convertsToCents) && !isCents(d.convertsToCents)) return bad('The price after the trial');
      if (present(d.mustCancel) && typeof d.mustCancel !== 'boolean') return bad('A trial setting');
      return ok({ fact: 'trial', startsOn, endsOn: d.endsOn, paymentOnFile: pay, conversion: conv, convertsToCents: present(d.convertsToCents) ? (d.convertsToCents as number) : null, cadence: cad, mustCancel: d.mustCancel === true, noticeBy, note: n });
    }
    case 'trial-extend':
      return isDate(d.endsOn) ? ok({ fact: 'trial-extend', endsOn: d.endsOn, note: n }) : bad('The new trial end date');
    case 'trial-outcome': {
      const o = pick(TRIAL_OUTCOMES, d.outcome, 'converted');
      return !present(d.outcome) || o === 'bad' || !isDate(d.on) ? bad('The trial outcome') : ok({ fact: 'trial-outcome', outcome: o, on: d.on, note: n });
    }
    case 'price-step': {
      const until = optDate(d.until);
      if (!isDate(d.from) || until === 'bad') return bad('A price date');
      if (present(d.cents) && !isCents(d.cents)) return bad('The price');
      const status = pick(PRICE_STATUSES, d.status, 'fixed'), source = pick(PRICE_SOURCES, d.source, 'owner');
      if (status === 'bad' || source === 'bad') return bad('A price setting');
      if (present(d.label) && typeof d.label !== 'string') return bad('The price label');
      return ok({ fact: 'price-step', from: d.from, until, cents: present(d.cents) ? (d.cents as number) : null, status, label: str(d.label), source, note: n });
    }
    case 'renewal': {
      const nb = optDate(d.noticeByDate);
      if (!isDate(d.renewalDate) || nb === 'bad') return bad('A renewal date');
      const cad = pick(CADENCES, d.cadence, 'unknown'), ch = pick(RENEWAL_CHANGES, d.changes, 'unknown');
      if (cad === 'bad' || ch === 'bad') return bad('A renewal setting');
      if (present(d.auto) && typeof d.auto !== 'boolean') return bad('A renewal setting');
      if (present(d.noticeDays) && !(isInt(d.noticeDays) && d.noticeDays >= 0 && d.noticeDays <= 365)) return bad('The notice days');
      return ok({ fact: 'renewal', renewalDate: d.renewalDate, cadence: cad, auto: typeof d.auto === 'boolean' ? d.auto : null, noticeDays: present(d.noticeDays) ? (d.noticeDays as number) : null, noticeByDate: nb, changes: ch, confirmed: d.confirmed === true, note: n });
    }
    case 'renewal-outcome': {
      const o = pick(RENEWAL_OUTCOMES, d.outcome, 'unsure');
      return !present(d.outcome) || o === 'bad' || !isDate(d.forDate) || !isDate(d.on) ? bad('The renewal outcome') : ok({ fact: 'renewal-outcome', forDate: d.forDate, outcome: o, on: d.on, note: n });
    }
    case 'cancel-plan': {
      const p = optDate(d.plannedOn);
      return p === 'bad' ? bad('The planned date') : ok({ fact: 'cancel-plan', plannedOn: p, note: n });
    }
    case 'cancel-request': {
      const eff = optDate(d.requestedEffectiveOn), m = pick(METHODS, d.method, 'other');
      if (!isDate(d.requestedOn) || eff === 'bad' || m === 'bad') return bad('A request detail');
      if (present(d.ref) && typeof d.ref !== 'string') return bad('The reference');
      return ok({ fact: 'cancel-request', requestedOn: d.requestedOn, requestedEffectiveOn: eff, method: m, ref: str(d.ref), awaiting: d.awaiting !== false, note: n });
    }
    case 'cancel-confirm': {
      const acc = optDate(d.accessUntil), fc = pick(FINAL_CHARGES, d.finalCharge, 'unknown');
      if (!isDate(d.confirmedOn) || !isDate(d.effectiveOn) || acc === 'bad' || fc === 'bad') return bad('A confirmation detail');
      if (present(d.providerRef) && typeof d.providerRef !== 'string') return bad('The provider reference');
      for (const k of ['finalChargeCents', 'refundCents']) if (present(d[k]) && !isCents(d[k])) return bad('An expected final amount');
      return ok({ fact: 'cancel-confirm', confirmedOn: d.confirmedOn, effectiveOn: d.effectiveOn, providerRef: str(d.providerRef), finalCharge: fc, finalChargeCents: present(d.finalChargeCents) ? (d.finalChargeCents as number) : null, refundCents: present(d.refundCents) ? (d.refundCents as number) : null, accessUntil: acc, note: n });
    }
    case 'cancel-withdraw': {
      const k = pick(WITHDRAW_KINDS, d.kind, 'owner-retracted');
      return !isDate(d.on) || k === 'bad' ? bad('The withdrawal') : ok({ fact: 'cancel-withdraw', on: d.on, kind: k, note: n });
    }
    case 'reactivate':
      return isDate(d.on) ? ok({ fact: 'reactivate', on: d.on, note: n }) : bad('The reactivation date');
    case 'service-link': {
      const a = d.arrangementId;
      return isInt(a) && a > 0 && (d.action === 'linked' || d.action === 'unlinked') && isDate(d.on) ? ok({ fact: 'service-link', arrangementId: a, action: d.action, on: d.on }) : bad('The Household Services link note');
    }
    case 'ack':
      return typeof d.key === 'string' && d.key && d.key.length <= 300 && isDate(d.on) ? ok({ fact: 'ack', key: d.key, on: d.on }) : bad('The acknowledgement');
    default:
      return fail(typeof d.fact === 'string' && d.fact ? `Its type ("${d.fact}") is not one this version of Ledger understands. It is kept exactly as saved.` : 'Its type is missing.');
  }
}

export const isLcReadable = (c: LcRecord): c is LcEff => c.body !== null && c.obligationId !== null;

/** The stored fields of a body (what a form writes). Optional things are stored only when set. */
export function lcFields(b: LcBody): Record<string, unknown> {
  const nt = (x: { note: string }) => (x.note ? { note: x.note } : {});
  switch (b.fact) {
    case 'trial': return { fact: 'trial', ...(b.startsOn ? { startsOn: b.startsOn } : {}), endsOn: b.endsOn, paymentOnFile: b.paymentOnFile, conversion: b.conversion, ...(b.convertsToCents !== null ? { convertsToCents: b.convertsToCents } : {}), cadence: b.cadence, ...(b.mustCancel ? { mustCancel: true } : {}), ...(b.noticeBy ? { noticeBy: b.noticeBy } : {}), ...nt(b) };
    case 'trial-extend': return { fact: 'trial-extend', endsOn: b.endsOn, ...nt(b) };
    case 'trial-outcome': return { fact: 'trial-outcome', outcome: b.outcome, on: b.on, ...nt(b) };
    case 'price-step': return { fact: 'price-step', from: b.from, ...(b.until ? { until: b.until } : {}), ...(b.cents !== null ? { cents: b.cents } : {}), status: b.status, ...(b.label ? { label: b.label } : {}), source: b.source, ...nt(b) };
    case 'renewal': return { fact: 'renewal', renewalDate: b.renewalDate, cadence: b.cadence, ...(b.auto !== null ? { auto: b.auto } : {}), ...(b.noticeDays !== null ? { noticeDays: b.noticeDays } : {}), ...(b.noticeByDate ? { noticeByDate: b.noticeByDate } : {}), changes: b.changes, confirmed: b.confirmed, ...nt(b) };
    case 'renewal-outcome': return { fact: 'renewal-outcome', forDate: b.forDate, outcome: b.outcome, on: b.on, ...nt(b) };
    case 'cancel-plan': return { fact: 'cancel-plan', ...(b.plannedOn ? { plannedOn: b.plannedOn } : {}), ...nt(b) };
    case 'cancel-request': return { fact: 'cancel-request', requestedOn: b.requestedOn, ...(b.requestedEffectiveOn ? { requestedEffectiveOn: b.requestedEffectiveOn } : {}), method: b.method, ...(b.ref ? { ref: b.ref } : {}), awaiting: b.awaiting, ...nt(b) };
    case 'cancel-confirm': return { fact: 'cancel-confirm', confirmedOn: b.confirmedOn, effectiveOn: b.effectiveOn, ...(b.providerRef ? { providerRef: b.providerRef } : {}), finalCharge: b.finalCharge, ...(b.finalChargeCents !== null ? { finalChargeCents: b.finalChargeCents } : {}), ...(b.refundCents !== null ? { refundCents: b.refundCents } : {}), ...(b.accessUntil ? { accessUntil: b.accessUntil } : {}), ...nt(b) };
    case 'cancel-withdraw': return { fact: 'cancel-withdraw', on: b.on, kind: b.kind, ...nt(b) };
    case 'reactivate': return { fact: 'reactivate', on: b.on, ...nt(b) };
    case 'service-link': return { fact: 'service-link', arrangementId: b.arrangementId, action: b.action, on: b.on };
    case 'ack': return { fact: 'ack', key: b.key, on: b.on };
  }
}

/** The whole row data of a NEW record: the body, the links to other records, and nothing else. */
export function newLcData(obligationId: number, body: LcBody, link: { op?: string | null; replaces?: number[]; targets?: number[]; seen?: number[] } = {}): Record<string, unknown> {
  return {
    obligationId, ...lcFields(body),
    ...(link.op ? { op: link.op } : {}),
    ...(link.replaces?.length ? { replaces: [...new Set(link.replaces)].sort((a, b) => a - b) } : {}),
    ...(link.targets?.length ? { targets: [...new Set(link.targets)].sort((a, b) => a - b) } : {}),
    ...(link.seen?.length ? { seen: [...new Set(link.seen)].sort((a, b) => a - b).slice(-MAX_SEEN) } : {}),
  };
}

/** Fields on a record this version does not know (carried through if a record is ever rewritten). */
export const unknownLcFields = (raw: Record<string, unknown>) => Object.fromEntries(Object.entries(raw).filter(([k, v]) => !COMMON.has(k) && v !== undefined && !KNOWN_BODY.has(k)));
const KNOWN_BODY = new Set(['startsOn', 'endsOn', 'paymentOnFile', 'conversion', 'convertsToCents', 'cadence', 'mustCancel', 'noticeBy', 'note', 'outcome', 'on', 'from', 'until', 'cents', 'status', 'label', 'source', 'renewalDate', 'auto', 'noticeDays', 'noticeByDate', 'changes', 'confirmed', 'forDate', 'plannedOn', 'requestedOn', 'requestedEffectiveOn', 'method', 'ref', 'awaiting', 'confirmedOn', 'effectiveOn', 'providerRef', 'finalCharge', 'finalChargeCents', 'refundCents', 'accessUntil', 'kind', 'arrangementId', 'action', 'key']);

/** Owner-typed text, cleaned and bounded. */
export const lcText = (s: string, max = 200) => tidy(s).slice(0, max);

/** A plain-words problem with a body about to be saved, or null. Strict: runs on every write. */
export function validateLc(b: LcBody): string | null {
  const d = (v: string | null, what: string) => (v !== null && !isDate(v) ? `The ${what} is not a real date.` : null);
  const long = (s: string, max: number, what: string) => (s.length > max ? `The ${what} is too long.` : null);
  switch (b.fact) {
    case 'trial':
      return d(b.startsOn, 'trial start date') ?? d(b.endsOn, 'trial end date') ?? d(b.noticeBy, 'cancel-by date')
        ?? (b.startsOn && b.endsOn < b.startsOn ? 'The trial ends before it starts.' : null)
        ?? (b.convertsToCents !== null && !isCents(b.convertsToCents) ? 'The price after the trial is not valid. Use whole cents.' : null)
        ?? long(b.note, 200, 'note');
    case 'trial-extend': return d(b.endsOn, 'new trial end date') ?? long(b.note, 200, 'note');
    case 'trial-outcome': return d(b.on, 'date') ?? long(b.note, 200, 'note');
    case 'price-step':
      if (b.cents !== null && !isCents(b.cents)) return 'The price is not valid. Use whole cents; $0.00 is allowed when it really is free.';
      if (b.status === 'unknown' && b.cents !== null) return 'A price marked "not known" cannot also have an amount.';
      if (b.status !== 'unknown' && b.cents === null) return 'Enter the amount, or mark the price as not known. An unknown price is never treated as zero.';
      return d(b.from, 'price start date') ?? d(b.until, 'price end date') ?? (b.until && b.until < b.from ? 'The price ends before it starts.' : null) ?? long(b.label, 60, 'label') ?? long(b.note, 200, 'note');
    case 'renewal':
      return d(b.renewalDate, 'renewal date') ?? d(b.noticeByDate, 'notice-by date') ?? (b.noticeByDate && b.noticeByDate > b.renewalDate ? 'The notice-by date is after the renewal date.' : null) ?? long(b.note, 200, 'note');
    case 'renewal-outcome': return d(b.forDate, 'renewal date') ?? d(b.on, 'date') ?? long(b.note, 200, 'note');
    case 'cancel-plan': return d(b.plannedOn, 'planned date') ?? long(b.note, 200, 'note');
    case 'cancel-request':
      return d(b.requestedOn, 'request date') ?? d(b.requestedEffectiveOn, 'requested effective date') ?? long(b.ref, 40, 'reference (at most 40 characters; do not enter an account number)') ?? long(b.note, 200, 'note');
    case 'cancel-confirm':
      return d(b.confirmedOn, 'confirmation date') ?? d(b.effectiveOn, 'effective date') ?? d(b.accessUntil, 'access date')
        ?? (b.finalCharge === 'expected' && b.finalChargeCents === null ? 'Enter the expected final charge, or choose "I do not know".' : null)
        ?? long(b.providerRef, 40, 'provider reference (at most 40 characters; do not enter an account number)') ?? long(b.note, 200, 'note');
    case 'cancel-withdraw': return d(b.on, 'date') ?? long(b.note, 200, 'note');
    case 'reactivate': return d(b.on, 'date') ?? long(b.note, 200, 'note');
    case 'service-link': return isInt(b.arrangementId) && b.arrangementId > 0 ? null : 'Pick a Household Services arrangement.';
    case 'ack': return b.key && b.key.length <= 300 ? null : 'Nothing to leave as is.';
  }
}

export { MODULE };
