/**
 * B3.1 RECURRING-EXPENSE DISCOVERY. PURE: no database, no clock, no network. It reads Finance transactions that were loaded in bulk and proposes
 * payees that look like a bill or subscription. It only SUGGESTS. It creates no bill, links no payment, writes nothing and never says a thing is
 * active, cancelled, renewed or settled: those are the owner's to say.
 *
 * WHAT THE EXISTING DETECTOR IS, AND WHAT THIS ADDS. Finance already has `detectRecurring` (lib/rules.ts), built for "Make this a scheduled payment".
 * Reused here unchanged, as the pattern engine, so Bills and Finance agree on what a pattern is:
 *   - it groups by account and normalised payee, keeps one transaction per day, and needs AT LEAST THREE occurrences;
 *   - it accepts weekly, biweekly, monthly, quarterly and yearly spacing only (a median gap within a tolerance, and 75% of gaps near it);
 *   - it needs same-direction amounts with at least 60% within 15% of the median, and it drops a pattern that stopped (next date more than two
 *     periods past);
 *   - it returns payee, account, median amount, frequency, last and next date, count, category and "amounts varied": NO list of dates, NO
 *     per-payment amounts, NO confidence number.
 * Its gaps for this use (all handled by a small pure ADAPTER around it, `cleaned`): it does not leave out income (positive amounts), it counts
 * each account separately (a subscription moved to another card would split in two), it ignores split transactions' setup parts, it does not
 * know loans, and it cannot show its evidence. So this file (1) feeds it only money-out, non-transfer, non-setup, de-duplicated transactions with
 * the accounts merged, (2) rebuilds each pattern's evidence from the same grouping, and (3) adds the relationships the detector never had: the
 * bill that already exists, the Finance Scheduled rule that may stand for it, and the owner's earlier decisions. It invents nothing the detector
 * could not substantiate.
 *
 * TIERS (never a percentage). Derived only from what can be seen in the data:
 *   strong       the detector accepts it and every gap is within its tolerance, with at least 4 payments of a steady amount, or at least 6 of a
 *                varying one (a utility)
 *   possible     the detector accepts it, but with fewer payments, a changing amount, or a gap or two outside the tolerance (a quarterly or yearly
 *                pattern with exactly three payments is always only "possible")
 *   more-info    only TWO payments of a nearly identical amount, spaced like a known interval: no cadence is claimed, the third payment decides
 * Anything that does not reach one of these (a handful of irregular payments, the same amount at different intervals) is not listed at all.
 *
 * LEFT OUT ON PURPOSE: income, transfers, setup entries, the interest-and-escrow expense Loans writes, any payee that reads as a mortgage or loan
 * (those are tracked on the Loans page), duplicated entries (the same payee on the same day, or the same bank id) which count once, and a payee
 * that matches a bill the owner has ENDED (counted, not suggested: old payments never make an ended bill "active" again). A payment history is
 * never taken as proof of cancellation, renewal or ownership of an account.
 */
import { addDays, addMonths, dayOfWeek } from '../../lib/dates';
import { detectRecurring, normPayee } from '../../lib/financeRead';
import { daysBetween } from '../../lib/money';
import { isSetupAlloc, isSetupTxn } from '../../lib/setupCategory';
import type { Frequency, RecurringLog, RecurringRule, Txn } from '../../types';
import { guessType, type AmountKind, type BillType, type ObligationRecord } from './model';
import { namesOfBill, payeeMatch, hintOf } from './payeeMatch';
import { frequencyWords, ruleKind, ruleLive, untrackedRules, type RuleKind } from './scheduledLink';
import { scheduleProblem, type Schedule } from './schedule';

// ---- decisions (stored in discoveryData.ts; the rules for them live here so they are testable) ----

export type DecisionKind = 'not-recurring' | 'dismissed' | 'tracked';
/** What the pattern looked like when the owner decided, so a materially different one can be told from the same one. */
export interface DecisionSnap { f: Frequency | null; n: number; last: string; cents: number }
export interface Decision { id: number; key: string; decision: DecisionKind; on: string; obligationId: number | null; snap: DecisionSnap }

/** "Dismiss for now" lasts this long, then the suggestion may return on its own. */
export const SNOOZE_DAYS = 60;
/** A typical amount that moved by more than this share counts as a materially different pattern. */
export const AMOUNT_SHIFT = 0.25;

// ---- candidates ----

export type CandidateTier = 'strong' | 'possible' | 'more-info';
export interface Occurrence { txnId: number; date: string; cents: number; accountId: number }
export type CandidateState = 'new' | 'tracked' | 'dismissed' | 'not-recurring';

export interface Candidate {
  /** Stable across scans: `p:` plus the normalised payee. */
  key: string;
  /** The payee as it reads on the latest transaction. */
  payee: string;
  tier: CandidateTier;
  /** Null for `more-info`: no cadence is claimed from two payments. */
  frequency: Frequency | null;
  occurrences: Occurrence[];
  count: number;
  firstDate: string;
  lastDate: string;
  /** The next date at the detected spacing; null for `more-info`. */
  nextDate: string | null;
  gaps: number[];
  amounts: { typical: number; min: number; max: number; fixed: boolean };
  categoryId: number | null;
  guessedType: BillType;
  /** Why Ledger thinks it may recur, in plain words (no amounts). */
  reasons: string[];
  /** What is not certain, in plain words. */
  uncertain: string[];
  /** The bill that already covers it (active or paused), when one does. */
  existing: ObligationRecord | null;
  /** Bills with a similar but not matching name: might be the same thing. */
  similar: ObligationRecord[];
  /** Finance Scheduled spending rules that may stand for it (a plan, never proof anything was paid). */
  rules: { rule: RecurringRule; kind: RuleKind; live: boolean; linkedTo: ObligationRecord | null }[];
  decision: Decision | null;
  state: CandidateState;
}

export interface DiscoveryInput {
  transactions: Txn[];
  rules: RecurringRule[];
  log?: RecurringLog[];
  obligations: ObligationRecord[];
  decisions: Decision[];
  today: string;
}
export interface DiscoveryResult {
  /** New, strong or possible. The list the owner sees first. */
  suggestions: Candidate[];
  /** New, only two payments so far. Collapsed by default. */
  moreInfo: Candidate[];
  /** Already covered by a bill (found by name, or because the owner said so). */
  tracked: Candidate[];
  /** Set aside by the owner (for now, or "not recurring") and not yet resurfaced. */
  hidden: Candidate[];
  /** Left out because they read as a loan payment (tracked on the Loans page). */
  loanLeftOut: number;
  /** Left out because the payee matches a bill the owner ended. */
  endedLeftOut: number;
  /** Scheduled spending rules no bill points at, not already covered by a bill or a listed suggestion. */
  rulesNotTracked: RecurringRule[];
  /** How much was looked at. */
  scanned: { transactions: number; payees: number };
}

const TOL: Record<Frequency, { days: number; tol: number }> = {
  weekly: { days: 7, tol: 1 }, biweekly: { days: 14, tol: 2 }, semimonthly: { days: 15.2, tol: 2 }, monthly: { days: 30.4, tol: 3.5 }, quarterly: { days: 91, tol: 6 }, yearly: { days: 365, tol: 8 },
};
const DETECTED: Frequency[] = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const LOAN_LIKE = /\b(mortgage|loan)\b|interest\s*&\s*escrow/i;

interface Cleaned { merged: Txn[]; byPayee: Map<string, Txn[]>; eligible: number; duplicates: Map<string, number> }

/**
 * THE ADAPTER. Money-out only, no transfers, no setup entries (a split with a setup part is left out whole), a payee that can be normalised, and
 * duplicates counted once (the same payee on the same day whatever the account, and the same bank id in one account). Accounts are merged (id 0)
 * so one provider paid from two cards is one pattern. Original transactions are kept in `byPayee` so evidence can name the real ones.
 */
export function cleaned(all: Txn[]): Cleaned {
  const seen = new Set<string>();
  const dayKey = new Set<string>();
  const byPayee = new Map<string, Txn[]>();
  const duplicates = new Map<string, number>();
  const out: Txn[] = [];
  let eligible = 0;
  for (const t of [...all].sort((a, b) => (a.id ?? 0) - (b.id ?? 0))) {
    if (t.id === undefined || t.transferTxnId || t.amountCents >= 0 || !t.payee.trim() || isSetupTxn(t) || t.splits?.some(isSetupAlloc)) continue;
    const norm = normPayee(t.payee);
    if (!norm) continue;
    eligible++;
    const ext = t.externalId ? `${t.accountId}|${t.externalId}` : null;
    const dk = `${norm}|${t.date}`;
    if ((ext && seen.has(ext)) || dayKey.has(dk)) { duplicates.set(norm, (duplicates.get(norm) ?? 0) + 1); continue; }
    if (ext) seen.add(ext);
    dayKey.add(dk);
    byPayee.set(norm, [...(byPayee.get(norm) ?? []), t]);
    out.push({ ...t, accountId: 0 });
  }
  return { merged: out, byPayee, eligible, duplicates };
}

const nextAfter = (last: string, f: Frequency) => (f === 'weekly' ? addDays(last, 7) : f === 'biweekly' ? addDays(last, 14) : f === 'monthly' ? addMonths(last, 1) : f === 'quarterly' ? addMonths(last, 3) : addMonths(last, 12));

/** Did the pattern change enough since the owner decided that it deserves a fresh look? Pure; used by the resurfacing rule. */
export function materialChange(snap: DecisionSnap, c: Pick<Candidate, 'frequency' | 'count' | 'amounts'>): boolean {
  if (snap.f !== c.frequency) return true; // a cadence appeared, changed or was lost
  if (c.count >= snap.n * 2 && c.count >= snap.n + 3) return true; // a lot more evidence than when it was set aside
  if (snap.cents > 0 && c.amounts.fixed && Math.abs(c.amounts.typical - snap.cents) > snap.cents * AMOUNT_SHIFT) return true;
  return false;
}

/** The decision that applies to a pattern: the newest one (by date, then id). Older decisions stay stored and are never rewritten. */
export const decisionFor = (key: string, decisions: Decision[]): Decision | null => decisions.filter((d) => d.key === key).sort((a, b) => b.on.localeCompare(a.on) || b.id - a.id)[0] ?? null;


export function discoverRecurring(input: DiscoveryInput): DiscoveryResult {
  const { today } = input;
  const c = cleaned(input.transactions);
  const guesses = detectRecurring(c.merged, [], today);
  const live = input.obligations;
  const inForce = live.filter((o) => o.data.status !== 'ended');
  const ended = live.filter((o) => o.data.status === 'ended');
  const linkedRule = (id: number | undefined) => inForce.find((o) => id !== undefined && o.data.scheduledRuleIds.includes(id)) ?? null;
  let loanLeftOut = 0, endedLeftOut = 0;
  const all: Candidate[] = [];

  const build = (norm: string, list: Txn[], tier: CandidateTier, frequency: Frequency | null, varies: boolean): Candidate | null => {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date) || (a.id ?? 0) - (b.id ?? 0));
    const last = sorted[sorted.length - 1];
    const payee = last.payee.trim();
    if (LOAN_LIKE.test(payee) || guessType(payee) === 'loan') { loanLeftOut++; return null; }
    const names = [{ text: payee, via: 'title' as const }];
    const matches = (o: ObligationRecord) => payeeMatch(payee, namesOfBill(o.data));
    const existing = inForce.filter((o) => matches(o).kind === 'exact').sort((a, b) => a.id - b.id)[0] ?? null;
    if (!existing && ended.some((o) => matches(o).kind === 'exact')) { endedLeftOut++; return null; }
    const similar = existing ? [] : inForce.filter((o) => matches(o).kind === 'partial');
    const occurrences: Occurrence[] = sorted.map((t) => ({ txnId: t.id as number, date: t.date, cents: -t.amountCents, accountId: t.accountId }));
    const cents = occurrences.map((o) => o.cents);
    const typical = Math.round(median(cents));
    const gaps = occurrences.slice(1).map((o, i) => daysBetween(o.date, occurrences[i].date));
    const cats = new Map<number, number>();
    for (const t of sorted) if (t.categoryId != null) cats.set(t.categoryId, (cats.get(t.categoryId) ?? 0) + 1);
    const categoryId = [...cats.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
    const rules = input.rules
      .filter((r) => r.id !== undefined && ruleKind(r) === 'spending' && payeeMatch(r.payee, names).kind === 'exact')
      .map((r) => ({ rule: r, kind: ruleKind(r), live: ruleLive(r, today), linkedTo: linkedRule(r.id) }));
    const reasons: string[] = [];
    const uncertain: string[] = [];
    const dups = c.duplicates.get(norm) ?? 0;
    if (frequency) {
      reasons.push(`${occurrences.length} payments to this payee, spaced ${frequencyWords(frequency)}${gaps.length ? ` (${gaps.slice(-4).join(', ')} days apart)` : ''}.`);
      reasons.push(varies ? 'The amount changes a little from payment to payment, as a utility bill does.' : 'The amount is about the same each time.');
      if (occurrences.length === 3) uncertain.push('Only three payments so far, the least Ledger needs to see a pattern.');
      if (gaps.some((g) => Math.abs(g - TOL[frequency].days) > TOL[frequency].tol)) uncertain.push('One or two payments came a little earlier or later than the pattern.');
      if (frequency === 'yearly' || frequency === 'quarterly') uncertain.push(`A ${frequency === 'yearly' ? 'yearly' : 'quarterly'} pattern is slow to confirm; make sure it is really one provider and one purpose.`);
    } else {
      reasons.push(`Two payments to this payee, ${gaps[0]} days apart, for nearly the same amount.`);
      uncertain.push('Two payments do not make a pattern. A third one at a similar spacing would.');
    }
    if (varies) uncertain.push('The amount varies, so the figure shown is a typical one, not a promise.');
    if (dups > 0) uncertain.push(`${dups} entr${dups === 1 ? 'y' : 'ies'} that looked like duplicates (same payee on the same day) counted once.`);
    if (new Set(occurrences.map((o) => o.accountId)).size > 1) uncertain.push('The payments came from more than one account.');
    if (similar.length > 0) uncertain.push(`A bill called "${similar[0].data.title}" has a similar name. It may be the same thing.`);
    if (rules.length > 0) uncertain.push('A Finance scheduled payment may stand for this. That is a plan; it does not show payments happened.');
    return {
      key: `p:${norm}`, payee, tier, frequency, occurrences, count: occurrences.length, firstDate: occurrences[0].date, lastDate: occurrences[occurrences.length - 1].date,
      nextDate: frequency ? nextAfter(occurrences[occurrences.length - 1].date, frequency) : null, gaps,
      amounts: { typical, min: Math.min(...cents), max: Math.max(...cents), fixed: !varies }, categoryId, guessedType: guessType(payee), reasons, uncertain,
      existing, similar, rules, decision: null, state: 'new',
    };
  };

  // 1. patterns the detector accepts
  const accepted = new Set<string>();
  for (const g of guesses) {
    const norm = normPayee(g.payee);
    const list = c.byPayee.get(norm);
    if (!list || !DETECTED.includes(g.frequency)) continue;
    accepted.add(norm);
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const gaps = sorted.slice(1).map((t, i) => daysBetween(t.date, sorted[i].date));
    const k = TOL[g.frequency];
    const allIn = gaps.every((x) => Math.abs(x - k.days) <= k.tol);
    const n = sorted.length;
    const tier: CandidateTier = allIn && ((!g.varies && n >= 4) || (g.varies && n >= 6)) ? 'strong' : 'possible';
    const cand = build(norm, list, tier, g.frequency, g.varies);
    if (cand) all.push(cand);
  }

  // 2. exactly two payments of nearly the same amount, spaced like a known interval, recent: "needs more information" (no cadence claimed)
  for (const [norm, list] of c.byPayee) {
    if (accepted.has(norm) || list.length !== 2) continue;
    const [a, b] = [...list].sort((x, y) => x.date.localeCompare(y.date));
    const gap = daysBetween(b.date, a.date);
    const kind = DETECTED.find((f) => Math.abs(gap - TOL[f].days) <= TOL[f].tol);
    if (!kind) continue;
    if (Math.abs(a.amountCents - b.amountCents) > Math.abs(Math.min(a.amountCents, b.amountCents)) * 0.05) continue;
    if (daysBetween(today, nextAfter(b.date, kind)) > TOL[kind].days * 2) continue; // it has probably stopped
    const cand = build(norm, list, 'more-info', null, false);
    if (cand) all.push(cand);
  }

  // 3. what the owner and the bills already say
  for (const cand of all) {
    const d = decisionFor(cand.key, input.decisions);
    cand.decision = d;
    if (cand.existing) { cand.state = 'tracked'; continue; }
    if (!d) continue;
    if (d.decision === 'tracked') {
      const ob = d.obligationId !== null ? inForce.find((o) => o.id === d.obligationId) ?? null : null;
      if (ob) { cand.existing = ob; cand.state = 'tracked'; }
      continue; // a "tracked" choice whose bill is gone or ended no longer hides anything
    }
    const resurfaced = materialChange(d.snap, cand) || (d.decision === 'dismissed' && addDays(d.on, SNOOZE_DAYS) <= today);
    if (!resurfaced) cand.state = d.decision;
  }

  const order = (x: Candidate, y: Candidate) => (x.tier === y.tier ? 0 : x.tier === 'strong' ? -1 : y.tier === 'strong' ? 1 : x.tier === 'possible' ? -1 : 1) || y.count - x.count || y.lastDate.localeCompare(x.lastDate) || x.payee.localeCompare(y.payee) || x.key.localeCompare(y.key);
  const fresh = all.filter((x) => x.state === 'new').sort(order);
  const suggestions = fresh.filter((x) => x.tier !== 'more-info');
  const moreInfo = fresh.filter((x) => x.tier === 'more-info');
  const covered = new Set<number>();
  for (const x of [...suggestions, ...moreInfo, ...all.filter((y) => y.state === 'tracked')]) for (const r of x.rules) if (r.rule.id !== undefined) covered.add(r.rule.id);
  const matchesBill = (payee: string) => inForce.some((o) => payeeMatch(payee, namesOfBill(o.data)).kind === 'exact') || ended.some((o) => payeeMatch(payee, namesOfBill(o.data)).kind === 'exact');
  return {
    suggestions, moreInfo,
    tracked: all.filter((x) => x.state === 'tracked').sort(order),
    hidden: all.filter((x) => x.state === 'dismissed' || x.state === 'not-recurring').sort(order),
    loanLeftOut, endedLeftOut,
    rulesNotTracked: untrackedRules(input.rules, live, matchesBill, today).filter((r) => r.id !== undefined && !covered.has(r.id)),
    scanned: { transactions: c.eligible, payees: c.byPayee.size },
  };
}

// ---- a bill from a suggestion ----

export interface CandidateSeed {
  title: string;
  providerName: string;
  type: BillType;
  amountKind: AmountKind;
  amountCents: number;
  /** Null when Ledger will not guess (two payments only, or a pattern it cannot place): the owner chooses. */
  schedule: Schedule | null;
  notes: string[];
  /** The words Ledger would remember to recognise this bill's payments, if the owner agrees. */
  payeeHint: string;
  fundingAccountId: number | null;
  categoryId: number | null;
  /** The Finance Scheduled rule the owner may also link (only when exactly one live spending rule matches). */
  ruleId: number | null;
}

const titleCase = (s: string) => s.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
/** A bank's payee text ("STREAMLY*PREMIUM 8841") as a readable name ("Streamly Premium"). A payee that already reads cleanly is kept exactly. Only a starting point: the form lets the owner change it. */
export function readableTitle(payee: string): string {
  const p = payee.trim();
  if (/^[A-Za-z][A-Za-z' ]*$/.test(p) && p !== p.toUpperCase()) return p;
  return titleCase(normPayee(p)) || p;
}

const modeOf = (xs: number[]) => { const m = new Map<number, number>(); for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]; };

/**
 * A PREFILL for the editable "Add a bill" form. The owner changes anything; nothing is saved until they confirm; no historical payment is linked.
 * A weekly or biweekly bill is placed on the weekday most payments fell on; a monthly, quarterly or yearly one on the typical day of the month, from
 * the month of the latest payment (so a quarterly or yearly bill keeps its real month).
 */
export function billSeedFromCandidate(c: Candidate): CandidateSeed {
  const notes: string[] = [];
  let schedule: Schedule | null = null;
  if (c.frequency === 'weekly' || c.frequency === 'biweekly') {
    const wd = modeOf(c.occurrences.map((o) => dayOfWeek(o.date)));
    const anchor = [...c.occurrences].reverse().find((o) => dayOfWeek(o.date) === wd)!.date;
    schedule = { kind: 'weeks', every: c.frequency === 'weekly' ? 1 : 2, weekday: wd, anchorDate: anchor };
  } else if (c.frequency === 'monthly' || c.frequency === 'quarterly' || c.frequency === 'yearly') {
    const days = c.occurrences.map((o) => Number(o.date.slice(8, 10)));
    const day = Math.round(median(days));
    if (Math.max(...days) - Math.min(...days) > 6) notes.push('The payment day moves around, so the day of the month shown is a typical one. Change it if the provider gives you a fixed due date.');
    schedule = { kind: 'months', every: c.frequency === 'monthly' ? 1 : c.frequency === 'quarterly' ? 3 : 12, slot: { kind: 'day', day, adjust: 'none' }, anchorMonth: c.lastDate.slice(0, 7) };
  } else notes.push('Ledger will not guess how often this repeats from two payments. Choose how often it is billed.');
  if (schedule && scheduleProblem(schedule)) { schedule = null; notes.push('Ledger could not place the schedule exactly. Choose how often it is billed.'); }
  const liveRules = c.rules.filter((r) => r.live && r.linkedTo === null);
  const accountId = c.occurrences[c.occurrences.length - 1].accountId;
  return {
    title: readableTitle(c.payee), providerName: readableTitle(c.payee), type: c.guessedType, amountKind: c.amounts.fixed ? 'fixed' : 'variable', amountCents: c.amounts.typical, schedule, notes,
    payeeHint: hintOf(c.payee), fundingAccountId: accountId > 0 ? accountId : null, categoryId: c.categoryId, ruleId: liveRules.length === 1 ? (liveRules[0].rule.id as number) : null,
  };
}

