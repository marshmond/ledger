import type { FinanceDB } from '../db';
import type { RecurringRule } from '../types';
import { addDays, addMonths, daysInMonth, monthOf, nextMonth } from './dates';
import { createTransfer } from './transfers';

const CAP = 2000;

/** All scheduled dates for a rule within [from, to] (inclusive), never before the rule's start or after its end. */
export function occurrencesBetween(rule: RecurringRule, from: string, to: string): string[] {
  const end = rule.endDate && rule.endDate < to ? rule.endDate : to;
  const lo = from > rule.startDate ? from : rule.startDate;
  const out: string[] = [];
  const push = (d: string) => {
    if (d >= lo && d <= end && d >= rule.startDate) out.push(d);
  };
  const startDay = Number(rule.startDate.slice(8, 10));

  switch (rule.frequency) {
    case 'weekly':
    case 'biweekly': {
      const step = rule.frequency === 'weekly' ? 7 : 14;
      for (let d = rule.startDate, i = 0; d <= end && i < CAP; d = addDays(d, step), i++) push(d);
      break;
    }
    case 'monthly':
    case 'quarterly':
    case 'yearly': {
      const step = rule.frequency === 'monthly' ? 1 : rule.frequency === 'quarterly' ? 3 : 12;
      for (let k = 0, d = rule.startDate; d <= end && k < CAP; k++, d = addMonths(rule.startDate, k * step, startDay)) push(d);
      break;
    }
    case 'semimonthly': {
      const days = [...(rule.semiDays ?? [1, 15])].sort((a, b) => a - b);
      for (let m = monthOf(rule.startDate), i = 0; `${m}-01` <= end && i < CAP; m = nextMonth(m), i++) {
        const [y, mo] = m.split('-').map(Number);
        for (const day of days) push(`${m}-${String(Math.min(day, daysInMonth(y, mo))).padStart(2, '0')}`);
      }
      break;
    }
  }
  return out;
}

export interface DueInstance {
  rule: RecurringRule;
  date: string;
}

/** Scheduled items on or before `today + lookaheadDays` that you have neither approved nor skipped. */
export async function dueInstances(d: FinanceDB, today: string, lookaheadDays = 7): Promise<DueInstance[]> {
  const rules = (await d.recurring.toArray()).filter((r) => r.active);
  const logs = await d.recurringLog.toArray();
  const handled = new Set(logs.map((l) => `${l.ruleId}|${l.date}`));
  const horizon = addDays(today, lookaheadDays);
  const out: DueInstance[] = [];
  for (const rule of rules) {
    for (const date of occurrencesBetween(rule, rule.startDate, horizon)) {
      if (!handled.has(`${rule.id}|${date}`)) out.push({ rule, date });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.rule.payee.localeCompare(b.rule.payee));
}

export interface PostOverrides {
  date?: string;
  amountCents?: number;
  payee?: string;
  categoryId?: number | null;
}

/** Approves a scheduled item: posts it as a pending transaction (or transfer) and remembers it was handled. */
export async function postInstance(d: FinanceDB, rule: RecurringRule, scheduledDate: string, o: PostOverrides = {}) {
  const date = o.date ?? scheduledDate;
  const amount = o.amountCents ?? rule.amountCents;
  const payee = o.payee ?? rule.payee;
  if (amount === 0) throw new Error('Amount cannot be zero');

  return d.transaction('rw', d.txns, d.accounts, d.recurringLog, async () => {
    let txnId: number;
    if (rule.transferAccountId) {
      const [from, to] = amount < 0 ? [rule.accountId, rule.transferAccountId] : [rule.transferAccountId, rule.accountId];
      const { fromTxnId, toTxnId } = await createTransfer(d, {
        fromAccountId: from,
        toAccountId: to,
        date,
        amountCents: Math.abs(amount),
        memo: rule.memo,
        status: 'pending',
      });
      await d.txns.update(fromTxnId, { recurringId: rule.id });
      await d.txns.update(toTxnId, { recurringId: rule.id });
      txnId = rule.accountId === from ? fromTxnId : toTxnId;
    } else {
      txnId = await d.txns.add({
        accountId: rule.accountId,
        date,
        amountCents: amount,
        payee,
        memo: rule.memo,
        status: 'pending',
        categoryId: o.categoryId === undefined ? rule.categoryId : o.categoryId,
        recurringId: rule.id,
      });
    }
    await d.recurringLog.add({ ruleId: rule.id!, date: scheduledDate, action: 'posted', txnId });
    return txnId;
  });
}

export async function skipInstance(d: FinanceDB, rule: RecurringRule, scheduledDate: string) {
  await d.recurringLog.add({ ruleId: rule.id!, date: scheduledDate, action: 'skipped' });
}

/** Deleting a rule keeps already-posted transactions; its handled-log is cleared. */
export async function deleteRule(d: FinanceDB, id: number) {
  await d.transaction('rw', d.recurring, d.recurringLog, async () => {
    await d.recurringLog.filter((l) => l.ruleId === id).delete();
    await d.recurring.delete(id);
  });
}
