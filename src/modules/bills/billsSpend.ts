/**
 * BILLS-ONLY RECORDED PAYMENTS (B3). PURE: no database, no clock, nothing stored. A clean cost-record reader that B5 can consume so that no module ever
 * recalculates Finance money a second way.
 *
 * It is NOT a financial engine and NOT the household total. It turns every billing period that holds payment evidence into ONE cost record and hands them
 * to Home & Assets' `spend()` (unchanged), so the rules are the shared ones:
 *   - each Finance transaction piece (`pieceKey`) counts ONCE across all periods and all bills (a payment linked to two periods is counted once and flagged);
 *   - a whole transaction that counts covers its parts; a missing, split-changed or no-longer-spending reference counts 0 and is listed;
 *   - a refund (money back) lowers the total; transfers and setup entries never count; the snapshot is never an amount;
 *   - a typed outside-Finance amount counts only for a period with no Finance link, and is never matched to a Finance piece by value;
 *   - Finance's pending, cleared and reconciled words never change a number.
 * Expected amounts, invoices, credits, Finance scheduled estimates and Projects money are never in it ("recorded payments, each counted once").
 *
 * B5 note: do NOT widen Household Services' `householdSpend`. B5 builds a separate union over these records behind its golden-master gate; this module only
 * guarantees the Bills side of that union is explainable piece by piece (`explain`).
 */
import { spend, type CostRecord, type SpendSummary } from '../assets/spending';
import type { TxnLookup, TxnRef } from '../../lib/txnRef';
import { pieceKey } from '../../lib/txnRef';
import { isEffective, type CycleRecord, type FactBody } from './cycleModel';
import { isLoanExcluded, type BillType, type ObligationRecord } from './model';

/** The groups the Bills figure is split by: the kind of bill the owner chose (utility, housing, subscription ...). */
export type BillGroup = BillType;

export interface BillCostRecord extends CostRecord<BillGroup> {
  obligationId: number;
  slot: string;
}

type Eff = CycleRecord & { body: FactBody; obligationId: number; slot: string };
const byAge = (a: Eff, b: Eff) => a.createdAt - b.createdAt || a.id - b.id;

/**
 * One cost record per billing period that holds payment evidence, in a fixed order (bill id, then period, so a piece shared by several periods is always
 * credited to the same one). The record's source follows the ONE-source rule: Finance links when any exist (a typed amount is then left out), else the single
 * typed amount, else nothing. Bills with no readable record, loan-tracked bills, and records of a bill that is not here contribute nothing.
 */
export function billsCostRecords(obligations: ObligationRecord[], cycles: CycleRecord[]): BillCostRecord[] {
  const obs = new Map(obligations.map((o) => [o.id, o]));
  const by = new Map<string, Eff[]>();
  for (const c of cycles) if (isEffective(c) && obs.has(c.obligationId) && !isLoanExcluded(obs.get(c.obligationId)!.data)) by.set(`${c.obligationId}|${c.slot}`, [...(by.get(`${c.obligationId}|${c.slot}`) ?? []), c as Eff]);
  const out: BillCostRecord[] = [];
  const keys = [...by.keys()].sort((a, b) => Number(a.slice(0, a.indexOf('|'))) - Number(b.slice(0, b.indexOf('|'))) || a.slice(a.indexOf('|') + 1).localeCompare(b.slice(b.indexOf('|') + 1)));
  for (const k of keys) {
    const facts = by.get(k)!.sort(byAge);
    const refs: TxnRef[] = facts.flatMap((f) => (f.body.fact === 'payment-link' ? [f.body.ref] : []));
    const typed = [...new Set(facts.flatMap((f) => (f.body.fact === 'paid-outside' && f.body.cents !== null && f.body.cents > 0 ? [f.body.cents] : [])))];
    // two DIFFERENT typed amounts count as nothing (they are listed for review elsewhere); identical ones count once
    const manualCents = refs.length === 0 && typed.length === 1 ? typed[0] : null;
    if (refs.length === 0 && manualCents === null) continue; // no payment evidence with an amount: nothing to count
    const obligationId = facts[0].obligationId, slot = facts[0].slot;
    out.push({ id: `bill:${obligationId}:${slot}`, assetId: obligationId, group: obs.get(obligationId)!.data.type, title: obs.get(obligationId)!.data.title, manualCents, refs, obligationId, slot });
  }
  return out;
}

const GROUPS = ['utility', 'housing', 'insurance', 'telecom', 'childcare', 'subscription', 'membership', 'tax', 'loan', 'other'] as const;

export interface BillsRecordedPayments {
  /** Net recorded payments (typed + from Finance), each Finance piece once, refunds subtracted. May be negative when money back exceeds payments. */
  totalCents: number;
  financeCents: number;
  typedCents: number;
  byType: Record<BillGroup, number>;
  summary: SpendSummary<BillGroup>;
  /** Every counted piece with the periods that reach it (more than one period = a possible duplicate attribution). */
  sharedPieces: { key: string; periods: string[] }[];
  /** Finance pieces left out of the totals because they need review (missing, split changed, no longer spending). */
  review: { recordId: string; key: string; state: string }[];
  /** Records that carry a typed amount AND Finance links (the links are used). Always empty from `billsCostRecords`; kept so a hand-built record is still checked. */
  both: string[];
}

/** The Bills-only figure through the shared `spend()`. `lookup` reads the live Finance transactions (one bulk read, done by the caller). */
export function billsRecordedPayments(records: BillCostRecord[], lookup: TxnLookup): BillsRecordedPayments {
  const s = spend<BillGroup>(records, lookup, GROUPS);
  return {
    totalCents: s.totalCents, financeCents: s.financeCents, typedCents: s.manualCents, byType: s.byGroup, summary: s,
    sharedPieces: s.sharedPieces.map((p) => ({ key: p.key, periods: p.recordIds })),
    review: s.review.map((r) => ({ recordId: r.recordId, key: r.resolved.key, state: r.resolved.state })),
    both: s.both,
  };
}

/** Every counted piece, in words and numbers: where it came from and what it contributed. Nothing counted is unexplained. */
export function explain(records: BillCostRecord[], lookup: TxnLookup): { key: string; recordIds: string[]; spendCents: number; state: string }[] {
  return billsRecordedPayments(records, lookup).summary.pieces.map((p) => ({ key: p.key, recordIds: p.recordIds, spendCents: p.spendCents, state: p.resolved.state }));
}

export { pieceKey };
