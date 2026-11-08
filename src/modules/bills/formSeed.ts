/**
 * The PREFILL handed to the existing "Add a bill or subscription" form when the owner chooses "Create a bill from this suggestion" or "Make a bill from this
 * scheduled payment" (B3.1). It is only starting text for editable fields: nothing is saved until the owner presses Add, no historical payment is linked
 * (those are linked afterwards, one by one, through the usual Link-a-payment steps), and nothing in Finance is created or changed.
 */
import type { RecurringRule } from '../../types';
import { billSeedFromCandidate, type Candidate, type DecisionSnap } from './discovery';
import { guessType, type AmountKind, type BillType } from './model';
import { hintOf } from './payeeMatch';
import { billSeedFromRule } from './scheduledLink';
import type { Schedule } from './schedule';

export interface FormSeed {
  source: 'suggestion' | 'rule';
  title: string;
  type: BillType;
  amountKind: AmountKind;
  amountCents: number | null;
  /** Null: the owner chooses how often (Ledger would not guess). */
  schedule: Schedule | null;
  providerName: string;
  fundingAccountId: number | null;
  /** The words Ledger would remember so this bill's payments can be suggested. Offered as a checkbox, default on. */
  payeeHint: string;
  /** A Finance Scheduled rule to also link. Offered as a checkbox, default on. */
  ruleId: number | null;
  /** Plain-words notes about what did not carry over. */
  notes: string[];
  /** The suggestion this came from (so it is recorded as tracked in the same step). */
  from: { key: string; snap: DecisionSnap } | null;
}

export function seedOfCandidate(c: Candidate): FormSeed {
  const s = billSeedFromCandidate(c);
  return {
    source: 'suggestion', title: s.title, type: s.type, amountKind: s.amountKind, amountCents: s.amountCents, schedule: s.schedule, providerName: s.providerName,
    fundingAccountId: s.fundingAccountId, payeeHint: s.payeeHint, ruleId: s.ruleId, notes: s.notes, from: { key: c.key, snap: { f: c.frequency, n: c.count, last: c.lastDate, cents: c.amounts.typical } },
  };
}

export function seedOfRule(r: RecurringRule): FormSeed {
  const s = billSeedFromRule(r);
  return {
    source: 'rule', title: s.title, type: guessType(s.title), amountKind: 'fixed', amountCents: s.amountCents, schedule: s.schedule, providerName: s.providerName,
    fundingAccountId: s.fundingAccountId, payeeHint: hintOf(s.title), ruleId: s.ruleId, notes: s.notes, from: null,
  };
}
