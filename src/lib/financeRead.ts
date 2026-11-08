/**
 * READ-ONLY Finance loader for Bills & Subscriptions B3.1 (recurring-expense discovery, payment-match suggestions, the Finance Scheduled link).
 *
 * This file follows the rule B3 set for `txnLookup.ts`: Bills never opens a Finance table of its own. Everything Bills needs to LOOK AT in Finance
 * comes through here, in bulk, before any Bills write transaction opens (Finance tables never join a Bills transaction). Nothing in this file
 * writes: every call is a plain read (`toArray`, `bulkGet`, `where(...).between`), and a source guard test (`financeRead.test.ts`) fails the build
 * if a write call, a posting function or a forecast import ever appears here.
 *
 * It also re-exports the three PURE helpers Bills reuses so that Bills code never imports the Finance files that contain writers:
 *   - `normPayee` and `detectRecurring` (lib/rules.ts): the same payee normalisation and the same repeating-charge detector Finance already uses;
 *   - `occurrencesBetween` (lib/schedule.ts): the same date generator the Scheduled page and the Calendar use, so a "next scheduled date" is never
 *     worked out a second way.
 */
import { db, type FinanceDB } from '../db';
import type { RecurringLog, RecurringRule, Txn } from '../types';

export { normPayee, detectRecurring } from './rules';
export { occurrencesBetween } from './schedule';

/** Every transaction (discovery needs the whole history). Read once, in bulk. */
export async function loadAllTxns(d: FinanceDB = db): Promise<Txn[]> {
  return d.txns.toArray();
}

/** Transactions dated from `from` to `to`, both included (match suggestions look at a window around a due date). Uses the date index. */
export async function loadTxnsBetween(from: string, to: string, d: FinanceDB = db): Promise<Txn[]> {
  return d.txns.where('date').between(from, to, true, true).toArray();
}

export interface ScheduledSnapshot {
  rules: RecurringRule[];
  /** The "posted" and "skipped" entries of the rules asked for (or of every rule). */
  log: RecurringLog[];
}

/**
 * Finance Scheduled rules and their handled-log. With `ruleIds` only those rules (and their log entries) are read, which is what a bill that links
 * one rule needs; without it every rule is read (the "not tracked as a bill" list). A rule id that no longer exists is simply absent from `rules`.
 */
export async function loadScheduled(d: FinanceDB = db, ruleIds?: number[]): Promise<ScheduledSnapshot> {
  if (ruleIds) {
    const ids = [...new Set(ruleIds.filter((x) => Number.isInteger(x)))];
    if (ids.length === 0) return { rules: [], log: [] };
    const rules = (await d.recurring.bulkGet(ids)).filter((r): r is RecurringRule => !!r && r.id !== undefined);
    const logs = await Promise.all(ids.map((id) => d.recurringLog.where('[ruleId+date]').between([id, ''], [id, '￿'], true, true).toArray()));
    return { rules, log: logs.flat() };
  }
  const [rules, log] = await Promise.all([d.recurring.toArray(), d.recurringLog.toArray()]);
  return { rules, log };
}
