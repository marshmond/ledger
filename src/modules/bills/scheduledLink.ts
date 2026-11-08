/**
 * B3.1 FINANCE SCHEDULED LINK. PURE: no database, no clock. A bill may POINT at an existing Finance Scheduled spending rule through its own
 * `scheduledRuleIds` field. That is the whole relationship: Finance still owns the rule, its postings, the forecast and the Calendar approval marker,
 * and a link never changes any of them. Everything here only reads rule rows that the caller loaded, and answers four questions in plain words:
 *
 *   1. Can this rule be linked to this bill?            `ruleLinkProblem`   (spending only; one bill per rule; the rule must exist)
 *   2. Did two devices link one rule to two bills?      `ruleLinkConflicts` (both pointers are kept; nothing is picked for the owner)
 *   3. Do the bill and its rule disagree?               `scheduleDrift`     (a read-only notice, never a fix, never an alarm for explained differences)
 *   4. What bill would this rule make?                  `billSeedFromRule`  (a PREFILL the owner edits; an unfaithful recurrence is explained, never silently substituted)
 *
 * A Scheduled item is a plan the owner approves. An approved (posted) item is not proof the provider was paid, a rule that has passed its date is not
 * proof it was paid, and a missing rule is "not on this device or deleted", never "paid" or "unpaid".
 */
import { addDays, dayOfWeek, monthOf } from '../../lib/dates';
import { occurrencesBetween } from '../../lib/financeRead';
import type { Frequency, RecurringLog, RecurringRule } from '../../types';
import { expectedAmountOn, scheduleSource, type ObligationData, type ObligationRecord, type PriceStep } from './model';
import { expectedDates, scheduleProblem, type Schedule } from './schedule';

export const MAX_RULES_PER_BILL = 5;

// ---- 1. can it be linked ----

export type RuleKind = 'spending' | 'income' | 'transfer';
/** A scheduled transfer moves money between the owner's own accounts; money coming in is income; money going out is spending. */
export const ruleKind = (r: RecurringRule): RuleKind => (r.transferAccountId ? 'transfer' : r.amountCents >= 0 ? 'income' : 'spending');
export const RULE_KIND_WORDS: Record<RuleKind, string> = { spending: 'scheduled payment', income: 'scheduled income', transfer: 'scheduled transfer' };

/** A rule that ended on a date before `today` (Finance stops posting it). */
export const ruleEnded = (r: RecurringRule, today: string) => !!r.endDate && r.endDate < today;
/** Finance is still expected to offer this rule's postings. */
export const ruleLive = (r: RecurringRule, today: string) => r.active && !ruleEnded(r, today);

/** Bills that hold a rule in force (not ended). An ended bill keeps its pointer as history and does not count as holding it. */
export const holdersOf = (ruleId: number, obligations: ObligationRecord[], exceptId?: number) =>
  obligations.filter((o) => o.id !== exceptId && o.data.status !== 'ended' && o.data.scheduledRuleIds.includes(ruleId));

export interface RuleLinkCheck { problem: string | null; /** Allowed, but worth saying. */ warnings: string[] }

/** Why this rule cannot be linked to this bill (or null), and anything worth saying when it can. Pure. */
export function ruleLinkProblem(o: { ruleId: number; rule: RecurringRule | undefined; obligations: ObligationRecord[]; obligationId?: number; alreadyLinked?: number[]; today: string }): RuleLinkCheck {
  const none = (problem: string): RuleLinkCheck => ({ problem, warnings: [] });
  const { rule } = o;
  if (!rule) return none('That Finance scheduled payment is not on this device, or it was deleted. Nothing was linked.');
  if (o.alreadyLinked?.includes(o.ruleId)) return none('That scheduled payment is already linked to this bill.');
  const kind = ruleKind(rule);
  if (kind === 'transfer') return none('That is a scheduled transfer between your own accounts, not a bill, so it cannot be linked. Nothing was linked.');
  if (kind === 'income') return none('That is scheduled income, not a payment you owe, so it cannot be linked to a bill. Nothing was linked.');
  const holders = holdersOf(o.ruleId, o.obligations, o.obligationId);
  if (holders.length > 0) return none(`That scheduled payment is already linked to ${holders.map((h) => `"${h.data.title}"`).join(' and ')}. One Finance scheduled payment can feed only one bill. Remove it there first if it belongs here. Nothing was linked.`);
  if ((o.alreadyLinked?.length ?? 0) >= MAX_RULES_PER_BILL) return none(`A bill can point at ${MAX_RULES_PER_BILL} scheduled payments at most.`);
  const warnings: string[] = [];
  if (!rule.active) warnings.push('This scheduled payment is switched off in Finance, so it is not posting anything. You can still link it; Bills will say it is inactive.');
  else if (ruleEnded(rule, o.today)) warnings.push(`This scheduled payment ended on ${rule.endDate}. You can still link it; Bills will say it is inactive.`);
  return { problem: null, warnings };
}

// ---- 2. two bills, one rule ----

export interface RuleConflict {
  key: string;
  ruleId: number;
  holders: ObligationRecord[];
  /** The owner chose "Leave as is" and the set of bills is unchanged. */
  acknowledged: boolean;
}

/** The key an acknowledgement is remembered by: the rule and the exact set of bills that hold it. A new holder is a new problem. */
export const ruleConflictKey = (ruleId: number, holderIds: number[]) => `rl|${ruleId}|${[...holderIds].sort((a, b) => a - b).join(',')}`;

/** Rules held by more than one bill in force. Detected, never resolved: the owner decides which bill keeps it. */
export function ruleLinkConflicts(obligations: ObligationRecord[]): RuleConflict[] {
  const byRule = new Map<number, ObligationRecord[]>();
  for (const o of obligations) {
    if (o.data.status === 'ended') continue;
    for (const id of o.data.scheduledRuleIds) byRule.set(id, [...(byRule.get(id) ?? []), o]);
  }
  const out: RuleConflict[] = [];
  for (const [ruleId, holders] of byRule) {
    if (holders.length < 2) continue;
    const sorted = [...holders].sort((a, b) => a.id - b.id);
    const key = ruleConflictKey(ruleId, sorted.map((h) => h.id));
    out.push({ key, ruleId, holders: sorted, acknowledged: sorted.some((h) => h.data.acknowledged.includes(key)) });
  }
  return out.sort((a, b) => a.ruleId - b.ruleId);
}

// ---- 3. drift ----

export type DriftKind = 'missing' | 'inactive' | 'bill-ended' | 'bill-paused' | 'cadence' | 'schedule-history' | 'no-schedule' | 'amount' | 'amount-varies' | 'amount-later-price' | 'dates';
export interface DriftNote {
  kind: DriftKind;
  /** `check`: worth a look. `info`: an explained difference, said once and calmly. */
  level: 'info' | 'check';
  /** The amounts involved (whole cents), for the wording. */
  bill?: number | null;
  finance?: number;
  /** A date or a plain word the wording needs. */
  on?: string;
  label?: string;
  frequencyBill?: string;
  frequencyFinance?: string;
}

const FREQ_WORDS: Record<Frequency | 'other', string> = { weekly: 'every week', biweekly: 'every 2 weeks', semimonthly: 'twice a month', monthly: 'every month', quarterly: 'every 3 months', yearly: 'every year', other: 'on another pattern' };
export const frequencyWords = (f: Frequency | 'other') => FREQ_WORDS[f];

/** The Finance frequency a Bills schedule corresponds to, or `other` when Finance has no word for it (every 2 months, 4-weekly, last business day...). */
export function frequencyOf(s: Schedule | null): Frequency | 'other' | null {
  if (!s) return null;
  if (s.kind === 'weeks') return s.every === 1 ? 'weekly' : s.every === 2 ? 'biweekly' : 'other';
  if (s.kind === 'months') return s.every === 1 ? 'monthly' : s.every === 3 ? 'quarterly' : s.every === 12 ? 'yearly' : 'other';
  return 'semimonthly';
}

/** The next date Finance will offer for a rule (not yet approved or skipped), on or after `today`. Null when none in the next 400 days. */
export function nextRuleDate(rule: RecurringRule, log: RecurringLog[], today: string): string | null {
  const handled = new Set(log.filter((l) => l.ruleId === rule.id).map((l) => l.date));
  return occurrencesBetween(rule, today, addDays(today, 400)).find((d) => !handled.has(d)) ?? null;
}

const daysApart = (a: string, b: string) => Math.abs(Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000));

/**
 * How a bill and its linked rule disagree, if they do. Read-only and calm: a difference the data itself explains (an introductory price, a varying
 * bill, a payment date a few days from the due date, a bill that ended or is paused) is `info`; only a disagreement nobody has explained is `check`.
 * It never changes either side, never posts or skips anything and never touches the bill's payment status.
 */
export function scheduleDrift(ob: ObligationData, rule: RecurringRule | undefined, log: RecurringLog[], today: string): DriftNote[] {
  const notes: DriftNote[] = [];
  if (!rule) return [{ kind: 'missing', level: 'check' }];
  const live = ruleLive(rule, today);
  if (ob.status === 'ended') {
    if (live) notes.push({ kind: 'bill-ended', level: 'check' });
    return notes; // nothing else is worth saying about an ended bill
  }
  if (!live) { notes.push({ kind: 'inactive', level: ob.status === 'active' ? 'check' : 'info', on: rule.endDate && ruleEnded(rule, today) ? rule.endDate : undefined }); return notes; }
  if (ob.status === 'paused') notes.push({ kind: 'bill-paused', level: 'info' });

  const fBill = frequencyOf(ob.schedule), fRule = rule.frequency;
  const ruleCents = Math.abs(rule.amountCents);
  const ruleNext = nextRuleDate(rule, log, today);
  const billNext = expectedDates(scheduleSource(ob), today, addDays(today, 400))[0]?.nominal ?? null;

  // cadence
  if (fBill === null) notes.push({ kind: 'no-schedule', level: 'info', frequencyFinance: FREQ_WORDS[fRule] });
  else if (fBill !== fRule) {
    const earlier = ob.scheduleHistory.length > 0 ? frequencyOf(ob.scheduleHistory[ob.scheduleHistory.length - 1].schedule) : null;
    notes.push(earlier === fRule
      ? { kind: 'schedule-history', level: 'check', on: ob.scheduleHistory[ob.scheduleHistory.length - 1].until, frequencyBill: FREQ_WORDS[fBill], frequencyFinance: FREQ_WORDS[fRule] }
      : { kind: 'cadence', level: 'check', frequencyBill: FREQ_WORDS[fBill], frequencyFinance: FREQ_WORDS[fRule] });
  }

  // amount
  if (ob.amountKind === 'variable') {
    const typical = expectedAmountOn(ob, ruleNext ?? today).cents;
    if (typical === null || typical !== ruleCents) notes.push({ kind: 'amount-varies', level: 'info', finance: ruleCents, bill: typical });
  } else if (ob.amountKind === 'fixed') {
    const date = ruleNext ?? billNext ?? today;
    const billCents = expectedAmountOn(ob, date).cents;
    if (billCents !== null && billCents !== ruleCents) {
      const steps: PriceStep[] = ob.prices.filter((p) => p.cents === ruleCents);
      const later = steps.find((p) => p.from > date);
      const earlier = [...steps].reverse().find((p) => p.from <= date);
      if (later) notes.push({ kind: 'amount-later-price', level: 'info', bill: billCents, finance: ruleCents, on: later.from, label: later.label });
      else notes.push({ kind: 'amount', level: 'check', bill: billCents, finance: ruleCents, on: earlier?.from, label: earlier?.label });
    }
  }

  // dates (only when both say the same cadence, so one date is comparable with the other). The bill's next date is compared with the rule's occurrence
  // NEAREST to it, whether or not Finance has already approved or skipped that item: approving an item moves "Finance's next unapproved date" a period on,
  // but not the plan, and must never read as a month of disagreement.
  if (fBill === fRule && billNext) {
    const near = occurrencesBetween(rule, addDays(billNext, -31), addDays(billNext, 31)).map((d) => ({ d, apart: daysApart(d, billNext) })).sort((a, b) => a.apart - b.apart || a.d.localeCompare(b.d))[0];
    // a few days is normal: the Scheduled date is when the owner plans to pay, the bill's date is when the provider says it is due
    if (near && near.apart > 0) notes.push({ kind: 'dates', level: near.apart <= 5 ? 'info' : 'check', on: near.d, label: billNext, finance: near.apart });
  }
  return notes.sort((a, b) => (a.level === b.level ? 0 : a.level === 'check' ? -1 : 1));
}

/** Any disagreement still worth a look. The Calendar never hides a marker while this is true. */
export const driftUnresolved = (notes: DriftNote[]) => notes.some((n) => n.level === 'check');

/** One note in plain words. Amounts go through `money`, so Hide Amounts applies. */
export function driftWords(n: DriftNote, money: (c: number) => string): string {
  switch (n.kind) {
    case 'missing': return 'The linked Finance scheduled payment is not on this device, or it was deleted. The bill is unchanged, and nothing is assumed paid or unpaid.';
    case 'inactive': return n.on ? `The linked scheduled payment in Finance ended on ${n.on}, so Finance is not posting it. The bill is unchanged.` : 'The linked scheduled payment is switched off in Finance, so Finance is not posting it. The bill is unchanged.';
    case 'bill-ended': return 'This bill has ended, but its scheduled payment in Finance is still active. Ledger changes neither; switch the Finance one off yourself if it should stop.';
    case 'bill-paused': return 'This bill is paused, and its scheduled payment in Finance is still active. Ledger changes neither.';
    case 'no-schedule': return `This bill has no schedule here, and Finance schedules it ${n.frequencyFinance}.`;
    case 'cadence': return `This bill is ${n.frequencyBill}, but its scheduled payment in Finance runs ${n.frequencyFinance}.`;
    case 'schedule-history': return `You changed this bill to ${n.frequencyBill} from ${n.on}, but its scheduled payment in Finance still runs ${n.frequencyFinance}, the earlier pattern.`;
    case 'amount-varies': return `This bill's amount varies. Finance schedules ${money(n.finance ?? 0)} as a plan${n.bill !== null && n.bill !== undefined ? `; the typical amount here is ${money(n.bill)}` : ''}.`;
    case 'amount-later-price': return `Finance schedules ${money(n.finance ?? 0)}, which is the price${n.label ? ` ("${n.label}")` : ''} that starts here on ${n.on}. Until then this bill expects ${money(n.bill ?? 0)}.`;
    case 'amount': return `This bill expects ${money(n.bill ?? 0)} each time, but Finance schedules ${money(n.finance ?? 0)}${n.on ? `, which matches the price${n.label ? ` ("${n.label}")` : ''} in force from ${n.on}` : ''}.`;
    case 'dates': return n.level === 'info'
      ? `Finance schedules this payment on ${n.on} and this bill is expected on ${n.label}. A few days apart is normal: the Scheduled date is when you plan to pay, the bill's date is when it is due.`
      : `Finance schedules this payment on ${n.on}, but this bill is expected on ${n.label}, ${n.finance} days apart.`;
  }
}

// ---- 4. a bill from a rule ----

export interface RuleSeed {
  ruleId: number;
  title: string;
  providerName: string;
  amountCents: number;
  /** Null when Bills cannot represent the rule's recurrence faithfully: the owner chooses one. */
  schedule: Schedule | null;
  /** The schedule says exactly what the rule says. */
  scheduleExact: boolean;
  /** What does not carry over, in plain words. */
  notes: string[];
  fundingAccountId: number;
  endDate: string | null;
}

const slotOf = (day: number) => (day >= 31 ? ({ kind: 'lastDay' } as const) : ({ kind: 'day', day, adjust: 'none' } as const));

/** The Bills schedule that says what a Finance rule says, or null with the reason. The B0 mapping; the rule is untouched. */
export function scheduleFromRule(r: RecurringRule): { schedule: Schedule | null; note: string | null } {
  const startDay = Number(r.startDate.slice(8, 10));
  let s: Schedule;
  switch (r.frequency) {
    case 'weekly': s = { kind: 'weeks', every: 1, weekday: dayOfWeek(r.startDate), anchorDate: r.startDate }; break;
    case 'biweekly': s = { kind: 'weeks', every: 2, weekday: dayOfWeek(r.startDate), anchorDate: r.startDate }; break;
    case 'monthly': case 'quarterly': case 'yearly':
      s = { kind: 'months', every: r.frequency === 'monthly' ? 1 : r.frequency === 'quarterly' ? 3 : 12, slot: { kind: 'day', day: startDay, adjust: 'none' }, anchorMonth: monthOf(r.startDate) }; break;
    case 'semimonthly': {
      const days = [...(r.semiDays ?? [1, 15])].sort((a, b) => a - b);
      s = { kind: 'twice-monthly', semi: { a: slotOf(days[0]), b: slotOf(days[1]) }, anchorMonth: monthOf(r.startDate) };
      break;
    }
    default: return { schedule: null, note: 'Bills has no schedule that matches how often this payment repeats in Finance. Choose one.' };
  }
  const why = scheduleProblem(s);
  return why ? { schedule: null, note: `Bills cannot hold this recurrence exactly (${why.replace(/\.$/, '')}). Choose a schedule that suits the bill.` } : { schedule: s, note: null };
}

/** A prefill for a new bill made from a Finance rule. Nothing is saved; every field stays editable; no historical payment is copied. */
export function billSeedFromRule(r: RecurringRule): RuleSeed {
  const { schedule, note } = scheduleFromRule(r);
  const notes: string[] = [];
  if (note) notes.push(note);
  if (r.endDate) notes.push(`Finance stops this payment on ${r.endDate}. A bill's schedule has no end date here; you can end the bill then.`);
  if (!r.active) notes.push('This scheduled payment is switched off in Finance.');
  return { ruleId: r.id as number, title: r.payee.trim(), providerName: r.payee.trim(), amountCents: Math.abs(r.amountCents), schedule, scheduleExact: schedule !== null, notes, fundingAccountId: r.accountId, endDate: r.endDate ?? null };
}

/** Finance rules that no bill in force points at, are switched on, spend money and are not already a bill by name: "Scheduled payments you may not be tracking". */
export function untrackedRules(rules: RecurringRule[], obligations: ObligationRecord[], matchesBill: (payee: string) => boolean, today: string): RecurringRule[] {
  return rules
    .filter((r) => r.id !== undefined && ruleKind(r) === 'spending' && ruleLive(r, today) && holdersOf(r.id, obligations).length === 0 && !matchesBill(r.payee))
    .sort((a, b) => a.payee.localeCompare(b.payee) || (a.id ?? 0) - (b.id ?? 0));
}
