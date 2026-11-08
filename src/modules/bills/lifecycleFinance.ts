/**
 * READ-ONLY Finance reads for the lifecycle checks (B4): "a charge after the cancellation date" and "a Finance Scheduled payment is still active for a
 * cancelled or ended bill". Like `financeRead.ts` this file only READS (one date-range read of transactions and one small read of the Scheduled
 * rules the bills point at), through the one read-only Finance loader. It posts, skips, edits and deletes nothing, creates no refund, no dispute and
 * no payment link, and writes nothing in Bills either: the owner reviews and decides.
 *
 * The read is independent of the clock (it reads the window after each cancellation date); the pure checks apply `today`.
 */
import { db, type FinanceDB } from '../../db';
import { addDays } from '../../lib/dates';
import { loadScheduled, loadTxnsBetween } from '../../lib/financeRead';
import type { RecurringRule, Txn } from '../../types';
import { chargesAfterCancellation, cancellationDate, AFTER_WINDOW_DAYS, type AfterCancel } from './lifecycleCharges';
import type { CycleRecord } from './cycleModel';
import type { ObligationRecord } from './model';
import { ruleKind, ruleLive } from './scheduledLink';

export interface ScheduledAfterEnd { obligationId: number; rule: RecurringRule; ackKey: string; acknowledged: boolean }
export interface LifecycleFinance {
  /** The transactions dated in the window after each cancellation date (read once). The pure checks apply `today` to them, so what is read never depends on the clock. */
  transactions: Txn[];
  /** Raw material for the "still active in Finance" check: the linked Finance rules, by rule id (read once). */
  rules: Map<number, RecurringRule>;
}
export const EMPTY_FINANCE: LifecycleFinance = { transactions: [], rules: new Map() };

/** What looks like a charge after the cancellation date, for one bill, as of `today`. Pure. */
export const afterFor = (fin: LifecycleFinance | undefined, ob: ObligationRecord, obligations: ObligationRecord[], cycles: CycleRecord[], today: string): AfterCancel | null =>
  fin && fin.transactions.length ? chargesAfterCancellation({ obligation: ob, obligations, cycles, transactions: fin.transactions, today }) : null;
export const scheduledAckKey = (obligationId: number, ruleId: number) => `sched|${obligationId}|${ruleId}`;

/** Bills that are cancelled for sure (effective date passed) or that the owner ended. */
export const isEnded = (ob: ObligationRecord, today: string) => ob.data.status === 'ended' || (ob.data.lc?.cutoffOn != null && ob.data.lc.cutoffOn < today);

/** Reads what the lifecycle checks need from Finance, in bulk, once. Reads only. */
export async function loadLifecycleFinance(obligations: ObligationRecord[], d: FinanceDB = db): Promise<LifecycleFinance> {
  const dated = obligations.flatMap((o) => { const c = cancellationDate(o); return c !== null ? [{ o, c }] : []; });
  let transactions: Txn[] = [];
  if (dated.length) {
    const from = addDays(dated.reduce((m, x) => (x.c < m ? x.c : m), dated[0].c), 1);
    const to = addDays(dated.reduce((m, x) => (x.c > m ? x.c : m), dated[0].c), AFTER_WINDOW_DAYS);
    transactions = await loadTxnsBetween(from, to, d);
  }
  // the rules of every bill that has been ended or has a confirmed cancellation date (whether the date has arrived is decided later, by comparing it with today)
  const ruleIds = obligations.filter((o) => o.data.status === 'ended' || o.data.lc?.cutoffOn != null).flatMap((o) => o.data.scheduledRuleIds);
  const rules = new Map<number, RecurringRule>();
  if (ruleIds.length) for (const r of (await loadScheduled(d, ruleIds)).rules) if (r.id !== undefined) rules.set(r.id, r);
  return { transactions, rules };
}

/** Finance Scheduled payments that are still live for a bill that was cancelled or ended. Pure. */
export function scheduledAfterEnd(obligations: ObligationRecord[], fin: LifecycleFinance, today: string): ScheduledAfterEnd[] {
  const out: ScheduledAfterEnd[] = [];
  for (const ob of obligations) {
    if (!isEnded(ob, today)) continue;
    for (const id of ob.data.scheduledRuleIds) {
      const rule = fin.rules.get(id);
      if (!rule || ruleKind(rule) !== 'spending' || !ruleLive(rule, today)) continue;
      const ackKey = scheduledAckKey(ob.id, id);
      out.push({ obligationId: ob.id, rule, ackKey, acknowledged: ob.data.lc?.acked.has(ackKey) ?? false });
    }
  }
  return out;
}
