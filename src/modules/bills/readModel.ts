/**
 * The ONE read model behind the Bills Overview, Upcoming, Needs-review pages, the Today card and the Calendar layer (B2). PURE over a snapshot.
 * Every count shown anywhere is the length of a list built here, so the Overview and Today can never disagree.
 *
 * Nothing here is stored, written or read from Finance. A "bill due" is a billing period (see periods.ts); a Task is only ever read.
 *
 * WINDOWS. Counts and lists look at periods dated from 45 days ago (`ATTENTION_LOOKBACK_DAYS`, so one forgotten month never becomes a growing
 * pile) to 90 days ahead. Older periods stay on the bill's own page and are never lost.
 * CASH TIMING. Expected cash needed in the next 7, 30 and 90 days: a period due today through that many days ahead counts if it is still open,
 * using what REMAINS to be paid (a partial payment lowers it). Known = a billed or fixed amount, Estimated = a "varies" amount, Unknown =
 * counted but never added as zero. It is NOT money paid, bank-cleared, or fed to the Finance cash forecast.
 */
import { db, type FinanceDB } from '../../db';
import { isLive } from '../../core/store';
import { addDays } from '../../lib/dates';
import { loadTasks } from '../tasks/data';
import type { TaskRecord } from '../tasks/model';
import { findConflicts, type Conflict } from './cycleConflicts';
import { CYCLE_KIND, readCycle, type CycleRecord } from './cycleModel';
import { asObligation, isLoanExcluded, KIND, MODULE, scheduleSource, type ObligationRecord } from './model';
import { localISO } from '../../core/time';
import { derivePeriod, periodsOf, type Period } from './periods';
import { SETTLED_LABELS } from './labels';
import { scheduleProduces } from './slots';
import { slotWords2 } from './schedule';
import { markersOf, planBillTasks, planningPeriods, taskAckKey } from './tasks';
import { deadlinesOf, DEADLINE_LABEL, readTerms, relativeDay, type DeadlineKind } from './terms';
import { daysUntil } from './timing';
import { loadTxnMap, lookupOfMap } from '../../lib/txnLookup';
import type { TxnLookup } from '../../lib/txnRef';
import type { Txn } from '../../types';

export const ATTENTION_LOOKBACK_DAYS = 45;
export const AHEAD_DAYS = 90;
export const CASH_WINDOWS = [7, 30, 90] as const;

export interface BillsSnapshot {
  obligations: ObligationRecord[]; cycles: CycleRecord[]; /** Bills Tasks only (any status). */ tasks: TaskRecord[];
  /** B3: the live Finance transactions the payment links point at, read ONCE in bulk (read only). Empty when there are no links. */
  financeTxns: Map<number, Txn>;
}

export async function loadBillsSnapshot(d: FinanceDB = db): Promise<BillsSnapshot> {
  const [obRows, cyRows, tasks] = await Promise.all([
    d.moduleRecords.where('[module+kind]').equals([MODULE, KIND]).toArray(),
    d.moduleRecords.where('[module+kind]').equals([MODULE, CYCLE_KIND]).toArray(),
    loadTasks(d),
  ]);
  const cycles = cyRows.filter(isLive).map(readCycle);
  // one bulk read for every transaction any payment link points at (a link that was set aside is history, shown from its snapshot, and is not looked up)
  const financeTxns = await loadTxnMap(cycles.flatMap((c) => (c.body?.fact === 'payment-link' && c.supersededBy === null ? [c.body.ref] : [])), d);
  return {
    obligations: obRows.filter(isLive).map(asObligation).sort((a, b) => a.data.title.localeCompare(b.data.title) || a.id - b.id),
    cycles,
    tasks: tasks.filter((t) => markersOf(t) !== null),
    financeTxns,
  };
}

export interface Derived {
  today: string;
  snap: BillsSnapshot;
  /** Periods inside the attention window, by bill. */
  periods: Map<number, Period[]>;
  /** B3: EVERY period that holds a record, whatever its date, by bill (payment problems are never aged out of sight). */
  recorded: Map<number, Period[]>;
  /** The live Finance transactions, as the shared lookup. */
  lookup: TxnLookup;
  conflicts: Conflict[];
}

export function derive(snap: BillsSnapshot, today: string): Derived {
  const win = { from: addDays(today, -ATTENTION_LOOKBACK_DAYS), to: addDays(today, AHEAD_DAYS) };
  const lookup = lookupOfMap(snap.financeTxns);
  const periods = new Map<number, Period[]>();
  const recorded = new Map<number, Period[]>();
  for (const ob of snap.obligations) {
    // one derivation per bill: the windowed list is the same periods `periodsOf` returns without `allRecorded`
    const all = periodsOf(ob, snap.cycles, today, win, { allRecorded: true, lookup });
    recorded.set(ob.id, all.filter((p) => p.records.length > 0));
    periods.set(ob.id, all.filter((p) => p.timing.date !== null && p.timing.date >= win.from && p.timing.date <= win.to));
  }
  return { today, snap, periods, recorded, lookup, conflicts: findConflicts(snap.obligations, snap.cycles) };
}

const obOf = (x: Derived, id: number) => x.snap.obligations.find((o) => o.id === id);

// ---- attention ----

export type AttentionCategory = 'dueSoon' | 'notConfirmed' | 'autopayCheck' | 'unconfirmedTasks' | 'conflicts' | 'records' | 'passedDates' | 'taskProblems' | 'trials' | 'notices' | 'renewals'
  /** B3: a linked Finance payment is missing, changed in structure, no longer spending, or was reversed or refunded. */
  | 'paymentReview'
  /** B3: a linked payment changed in Finance since it was linked (its live amount is used). */
  | 'paymentChanged'
  /** B3: part of a bill is paid and the rest is due or late. */
  | 'partlyPaid'
  /** B3: a typed outside-Finance payment and a Finance payment are both recorded for one period. */
  | 'typedFinance'
  /** B3: one Finance payment piece is linked more than once (in a period, whole beside its part, or on several periods). */
  | 'duplicatePieces'
  /** B3 follow-up: the owner declared a period paid in full, and the Finance payments linked to it show less than the bill. The declaration is kept; the difference is listed. */
  | 'declaredShort';
export interface AttentionItem {
  id: string;
  category: AttentionCategory;
  obligationId: number | null;
  slot?: string | null;
  /** Plain words. No amounts. May contain the bill's title (Today shows counts only and never these). */
  text: string;
  /** The conflict this item stands for, when it is one. */
  conflict?: Conflict;
  taskId?: number;
  date?: string;
}
export type Attention = Record<AttentionCategory, number> & { total: number; items: AttentionItem[] };

const CATEGORIES: AttentionCategory[] = ['dueSoon', 'notConfirmed', 'autopayCheck', 'paymentReview', 'paymentChanged', 'partlyPaid', 'typedFinance', 'duplicatePieces', 'declaredShort', 'unconfirmedTasks', 'conflicts', 'records', 'passedDates', 'taskProblems', 'trials', 'notices', 'renewals'];
const settledByRecord = (p: Period) => SETTLED_LABELS.has(p.label) || p.label === 'partly-paid' || p.amounts.paid > 0 || p.declared || p.skipped;

const PASSED_DAYS = 60;

export function attention(x: Derived): Attention {
  const items: AttentionItem[] = [];
  const { today } = x;
  for (const ob of x.snap.obligations) {
    const t = ob.data.title;
    const loan = isLoanExcluded(ob.data);
    if (!loan) {
      for (const p of x.periods.get(ob.id) ?? []) {
        const base = { obligationId: ob.id, slot: p.slot, date: p.timing.date ?? undefined };
        const manual = ob.data.payment.how !== 'auto';
        if (manual && (p.label === 'due-soon' || p.label === 'due-today')) items.push({ ...base, id: `due-${ob.id}-${p.slot}`, category: 'dueSoon', text: `${t}: ${p.label === 'due-today' ? 'due today' : `due ${relativeDay(p.timing.date!, today)}`}` });
        else if (p.label === 'overdue' || p.label === 'not-confirmed') items.push({ ...base, id: `late-${ob.id}-${p.slot}`, category: 'notConfirmed', text: `${t}: ${p.label === 'overdue' ? 'billed, no payment recorded' : 'no payment recorded'} (was due ${p.timing.date})` });
        else if (p.label === 'autopay-check') items.push({ ...base, id: `auto-${ob.id}-${p.slot}`, category: 'autopayCheck', text: `${t}: automatic payment not yet seen in Finance (was due ${p.timing.date})` });
      }
    }
    // B3: what Finance says about the linked payments, for EVERY recorded period (a stale link is never aged out of sight). Words only, never an amount.
    if (!loan) for (const p of x.recorded.get(ob.id) ?? []) {
      const f = p.amounts.finance;
      if (!f) continue;
      const base = { obligationId: ob.id, slot: p.slot, date: p.timing.date ?? undefined };
      const when = slotWords2(p.slot);
      if (f.counts.review > 0 || f.reversed || p.label === 'needs-review') items.push({ ...base, id: `pay-review-${ob.id}-${p.slot}`, category: 'paymentReview', text: `${t}, ${when}: ${f.reversed ? 'a payment was reversed or refunded in Finance' : 'a linked Finance payment needs review (it is missing, changed in structure or no longer spending)'}` });
      if (p.label === 'marked-paid-short') items.push({ ...base, id: `short-${ob.id}-${p.slot}`, category: 'declaredShort', text: `${t}, ${when}: you marked it paid in full, but the Finance payments linked to it show less than the bill. Your declaration is kept and nothing was added` });
      if (f.counts.changed > 0) items.push({ ...base, id: `pay-changed-${ob.id}-${p.slot}`, category: 'paymentChanged', text: `${t}, ${when}: a linked payment changed in Finance since you linked it. The current amount is used` });
    }
    for (const p of x.periods.get(ob.id) ?? []) {
      if (loan || p.label !== 'partly-paid' || p.timing.class === 'upcoming') continue;
      items.push({ obligationId: ob.id, slot: p.slot, date: p.timing.date ?? undefined, id: `part-${ob.id}-${p.slot}`, category: 'partlyPaid', text: `${t}: partly paid, an amount is still owed` });
    }
    // deadlines (dates only; nothing is done when one passes)
    const terms = readTerms(ob.data.terms);
    if (ob.data.status === 'active') for (const dl of deadlinesOf(terms)) {
      const days = daysUntil(dl.date, today);
      const mk = (category: AttentionCategory, text: string) => items.push({ id: `${category}-${ob.id}-${dl.date}`, category, obligationId: ob.id, date: dl.date, text });
      if (dl.kind === 'trial' && days >= 0 && days <= 7) mk('trials', `${t}: the trial ends ${relativeDay(dl.date, today)}`);
      if (dl.kind === 'notice' && days >= 0 && days <= 14) mk('notices', `${t}: the last day to cancel or give notice is ${relativeDay(dl.date, today)}`);
      if (dl.kind === 'renewal' && days >= 0 && days <= 30) mk('renewals', `${t}: renews ${relativeDay(dl.date, today)}`);
      if (days < 0 && days >= -PASSED_DAYS && dl.kind !== 'notice') mk('passedDates', `${t}: the ${DEADLINE_LABEL[dl.kind as DeadlineKind].toLowerCase()} date passed ${relativeDay(dl.date, today)}. Ledger did not ${dl.kind === 'renewal' ? 'renew' : 'convert'} anything; check and update the date if it is out of date`);
    }
    // Task health
    const myTasks = x.snap.tasks.filter((k) => markersOf(k)?.obligation === ob.id);
    const plan = planBillTasks(ob, planningPeriods(ob, x.snap.cycles, today, x.lookup), myTasks, today);
    if (plan.duplicates.length + plan.stale.length + plan.retire.length > 0) items.push({ id: `tasks-${ob.id}`, category: 'taskProblems', obligationId: ob.id, text: `${t}: ${plan.duplicates.length ? 'more than one open reminder Task for the same period' : ob.data.status === 'paused' || ob.data.status === 'ended' ? `a reminder Task is still open although the bill is ${ob.data.status}${plan.retire.length ? ' (Update reminders removes the ones Bills made and you have not changed)' : ''}` : 'a reminder Task refers to a period or date that has since changed'}. Nothing was deleted.` });
    // finished pay Tasks whose period has no payment, declaration or skip
    for (const k of myTasks) {
      const m = markersOf(k)!;
      if (m.purpose !== 'pay' || k.data.status !== 'done' || !m.cycle) continue;
      if (k.data.completedAt !== null && daysUntil(localISO(k.data.completedAt), today) < -90) continue;
      if (ob.data.acknowledged.includes(taskAckKey(k))) continue;
      const p = derivePeriod(ob, m.cycle, m.cycle.startsWith('x') ? null : scheduleProduces(scheduleSource(ob.data), m.cycle), false, x.snap.cycles.filter((c) => c.obligationId === ob.id && c.slot === m.cycle), today, x.lookup);
      if (!settledByRecord(p)) items.push({ id: `fin-${k.id}`, category: 'unconfirmedTasks', obligationId: ob.id, slot: m.cycle, taskId: k.id, text: `${t}: the reminder Task was finished, but no payment is recorded` });
    }
  }
  for (const c of x.conflicts) {
    if (c.acknowledged) continue;
    const ob = c.obligationId === null ? undefined : obOf(x, c.obligationId);
    const category: AttentionCategory = c.kind === 'typed-and-finance' ? 'typedFinance' : c.kind === 'payment-duplicate' || c.kind === 'payment-overlap' || c.kind === 'payment-shared' ? 'duplicatePieces' : c.severity === 'review' ? 'records' : 'conflicts';
    items.push({ id: `c-${c.key}`, category, obligationId: c.obligationId, slot: c.slot, conflict: c, text: `${ob ? `${ob.data.title}: ` : ''}${c.text}` });
  }
  const out = Object.fromEntries(CATEGORIES.map((c) => [c, items.filter((i) => i.category === c).length])) as Record<AttentionCategory, number>;
  const total = CATEGORIES.reduce((n, c) => n + out[c], 0);
  return { ...out, total, items: items.sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || (a.date ?? '').localeCompare(b.date ?? '') || a.id.localeCompare(b.id)) };
}

/** Lines for the Today card: counts and words only, never a title or an amount. Same numbers the Overview shows. */
export function attentionLines(a: Attention): { id: AttentionCategory; text: string }[] {
  const n = (c: number, one: string, many: string) => `${c} ${c === 1 ? one : many}`;
  const rows: { id: AttentionCategory; text: string }[] = [];
  if (a.dueSoon) rows.push({ id: 'dueSoon', text: `${n(a.dueSoon, 'bill', 'bills')} due in the next 7 days` });
  if (a.notConfirmed) rows.push({ id: 'notConfirmed', text: `${n(a.notConfirmed, 'bill', 'bills')} not confirmed paid` });
  if (a.autopayCheck) rows.push({ id: 'autopayCheck', text: `${n(a.autopayCheck, 'automatic payment', 'automatic payments')} not yet seen in Finance` });
  if (a.paymentReview) rows.push({ id: 'paymentReview', text: `${n(a.paymentReview, 'linked payment needs', 'linked payments need')} review` });
  if (a.paymentChanged) rows.push({ id: 'paymentChanged', text: `${n(a.paymentChanged, 'linked payment', 'linked payments')} changed in Finance` });
  if (a.partlyPaid) rows.push({ id: 'partlyPaid', text: `${n(a.partlyPaid, 'bill is', 'bills are')} partly paid` });
  if (a.typedFinance) rows.push({ id: 'typedFinance', text: `${n(a.typedFinance, 'bill has', 'bills have')} a typed payment and a Finance payment` });
  if (a.declaredShort) rows.push({ id: 'declaredShort', text: `${n(a.declaredShort, 'bill marked paid in full shows', 'bills marked paid in full show')} less in Finance` });
  if (a.duplicatePieces) rows.push({ id: 'duplicatePieces', text: `${n(a.duplicatePieces, 'payment is', 'payments are')} linked more than once` });
  if (a.unconfirmedTasks) rows.push({ id: 'unconfirmedTasks', text: `${n(a.unconfirmedTasks, 'finished reminder Task', 'finished reminder Tasks')} not yet confirmed` });
  if (a.conflicts) rows.push({ id: 'conflicts', text: `${n(a.conflicts, 'billing record disagrees', 'billing records disagree')} with another` });
  if (a.records) rows.push({ id: 'records', text: `${n(a.records, 'billing record needs', 'billing records need')} a look` });
  if (a.passedDates) rows.push({ id: 'passedDates', text: `${n(a.passedDates, 'contract date has', 'contract dates have')} passed` });
  if (a.taskProblems) rows.push({ id: 'taskProblems', text: `${n(a.taskProblems, 'bill has', 'bills have')} a reminder Task to check` });
  if (a.trials) rows.push({ id: 'trials', text: `${n(a.trials, 'trial ends', 'trials end')} in 7 days` });
  if (a.notices) rows.push({ id: 'notices', text: `${n(a.notices, 'cancel-by deadline', 'cancel-by deadlines')} in 14 days` });
  if (a.renewals) rows.push({ id: 'renewals', text: `${n(a.renewals, 'renewal', 'renewals')} in 30 days` });
  return rows;
}

// ---- cash timing ----

export interface CashWindow {
  days: number;
  known: { cents: number; count: number };
  estimated: { cents: number; count: number };
  /** Periods whose amount is not known (or whose records disagree): counted, never added as zero. */
  unknown: { count: number };
}
export function cashTiming(x: Derived): CashWindow[] {
  const wins: CashWindow[] = CASH_WINDOWS.map((days) => ({ days, known: { cents: 0, count: 0 }, estimated: { cents: 0, count: 0 }, unknown: { count: 0 } }));
  for (const ob of x.snap.obligations) {
    if (isLoanExcluded(ob.data)) continue;
    for (const p of x.periods.get(ob.id) ?? []) {
      if (!p.open || p.timing.date === null) continue;
      const days = daysUntil(p.timing.date, x.today);
      if (days < 0) continue;
      for (const w of wins) {
        if (days > w.days) continue;
        if (p.amounts.remaining === null) { w.unknown.count++; continue; }
        if (p.amounts.remaining === 0) continue;
        const bucket = p.amounts.basis === 'estimate' ? w.estimated : w.known;
        bucket.cents += p.amounts.remaining; bucket.count++;
      }
    }
  }
  return wins;
}

// ---- upcoming ----

export interface UpcomingEntry { ob: ObligationRecord; period: Period }
/** Periods dated today through 90 days ahead (every label, so skipped and settled ones show with their label), soonest first, loans left out. */
export function upcoming(x: Derived): { pastDue: UpcomingEntry[]; ahead: UpcomingEntry[] } {
  const pastDue: UpcomingEntry[] = [], ahead: UpcomingEntry[] = [];
  for (const ob of x.snap.obligations) {
    if (isLoanExcluded(ob.data)) continue;
    for (const p of x.periods.get(ob.id) ?? []) {
      if (p.timing.date === null) continue;
      const days = daysUntil(p.timing.date, x.today);
      if (days < 0) { if (p.open) pastDue.push({ ob, period: p }); } else ahead.push({ ob, period: p });
    }
  }
  const by = (a: UpcomingEntry, b: UpcomingEntry) => a.period.timing.date!.localeCompare(b.period.timing.date!) || a.ob.data.title.localeCompare(b.ob.data.title) || a.period.slot.localeCompare(b.period.slot);
  return { pastDue: pastDue.sort(by), ahead: ahead.sort(by) };
}

/** Contract dates in the next `days` days (and not passed), soonest first. */
export function upcomingDeadlines(x: Derived, days = AHEAD_DAYS): { ob: ObligationRecord; kind: DeadlineKind; date: string }[] {
  const out: { ob: ObligationRecord; kind: DeadlineKind; date: string }[] = [];
  for (const ob of x.snap.obligations) {
    if (ob.data.status !== 'active') continue;
    for (const dl of deadlinesOf(readTerms(ob.data.terms))) { const d = daysUntil(dl.date, x.today); if (d >= 0 && d <= days) out.push({ ob, kind: dl.kind, date: dl.date }); }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.ob.data.title.localeCompare(b.ob.data.title) || a.kind.localeCompare(b.kind));
}
