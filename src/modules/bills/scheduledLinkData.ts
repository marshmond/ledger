/**
 * B3.1 FINANCE SCHEDULED LINK: reading and writing the pointer. A bill's `scheduledRuleIds` is the whole relationship, and it lives on the BILL: these
 * functions write only the Bills obligation record (and nothing else). The Finance Scheduled rule, its handled-log, its postings, the forecast and
 * the Calendar approval marker are only READ, through the shared read-only loader (`lib/financeRead`), before a write transaction opens: Finance
 * tables never join a Bills transaction.
 *
 * Every write is ONE transaction that re-reads the bill, refuses (writing nothing) if it changed since the owner opened the dialog, re-checks the rule
 * rules in the same step, and returns a guarded Undo that refuses if anything it touched changed. Linking never posts, skips, edits or deletes a rule,
 * never creates a Finance rule (it is a pointer to one that exists), and never changes a billing period's payment status.
 */
import { db, type FinanceDB } from '../../db';
import { loadScheduled, type ScheduledSnapshot } from '../../lib/financeRead';
import type { RecurringRule } from '../../types';
import { getObligation, loadObligations, tables, writeObligation } from './data';
import { applyEdit, isLoanExcluded, withLog, type ObligationRecord } from './model';
import { holdersOf, nextRuleDate, ruleKind, ruleLinkConflicts, ruleLinkProblem, scheduleDrift, type DriftNote, type RuleLinkCheck } from './scheduledLink';
import { Recorder, type Undo } from './undo';

const STALE = 'This bill was changed (maybe on another device) since you opened this. Close it, look again and redo your change. Nothing was changed.';

// ---- reading ----

export interface LinkedRuleView {
  ruleId: number;
  /** Undefined = not on this device, or deleted. */
  rule: RecurringRule | undefined;
  /** The next date Finance will offer (not yet approved or skipped). */
  next: string | null;
  notes: DriftNote[];
}

/** The rules a bill points at, as Finance has them right now, with the read-only drift notices. One small read; writes nothing. */
export async function loadLinkedRules(ob: ObligationRecord, today: string, d: FinanceDB = db): Promise<{ views: LinkedRuleView[]; snapshot: ScheduledSnapshot }> {
  const snapshot = await loadScheduled(d, ob.data.scheduledRuleIds);
  const views = ob.data.scheduledRuleIds.map((ruleId) => {
    const rule = snapshot.rules.find((r) => r.id === ruleId);
    return { ruleId, rule, next: rule ? nextRuleDate(rule, snapshot.log, today) : null, notes: scheduleDrift(ob.data, rule, snapshot.log, today) };
  });
  return { views, snapshot };
}

export interface RuleChoice { rule: RecurringRule; check: RuleLinkCheck }
export interface RuleChoices {
  /** Spending rules, each with whether it can be linked to this bill (and why not). */
  spending: RuleChoice[];
  /** Income and transfer rules: not shown, because they cannot be bills. Only counted, so the screen can say so. */
  notBills: number;
}

/** The Finance rules a bill could point at. Spending rules only are listed; the rest are counted. Reads only. */
export async function loadRuleChoices(ob: ObligationRecord, today: string, d: FinanceDB = db): Promise<RuleChoices> {
  const [{ rules }, obligations] = await Promise.all([loadScheduled(d), loadObligations(d)]);
  const spending = rules.filter((r) => r.id !== undefined && ruleKind(r) === 'spending')
    .sort((a, b) => a.payee.localeCompare(b.payee) || (a.id ?? 0) - (b.id ?? 0))
    .map((rule) => ({ rule, check: ruleLinkProblem({ ruleId: rule.id as number, rule, obligations, obligationId: ob.id, alreadyLinked: ob.data.scheduledRuleIds, today }) }));
  return { spending, notBills: rules.filter((r) => ruleKind(r) !== 'spending').length };
}

// ---- writing ----

export interface LinkRuleInput { obligationId: number; ruleId: number; /** The bill's `updatedAt` when the dialog opened. */ expect: number | null; today: string }

/** Why a bill cannot take a link at all, regardless of the rule. */
const billProblem = (ob: ObligationRecord): string | null =>
  ob.data.status === 'ended' ? 'An ended bill cannot be linked to a scheduled payment. Reopen it first. Nothing was linked.'
    : isLoanExcluded(ob.data) ? 'Loan payments are tracked on the Loans page, so this bill cannot be linked to a scheduled payment. Nothing was linked.' : null;

/** Points the bill at one existing Finance Scheduled spending rule. One transaction, only the bill record changes, guarded Undo. */
export async function linkRule(input: LinkRuleInput, d: FinanceDB = db): Promise<{ undo: Undo }> {
  const { rules } = await loadScheduled(d, [input.ruleId]); // read BEFORE the transaction opens
  const rule = rules[0];
  return d.transaction('rw', tables(d), async () => {
    const ob = await getObligation(input.obligationId, d);
    if (!ob) throw new Error('That bill no longer exists. Nothing was changed.');
    if (input.expect !== null && ob.updatedAt !== input.expect) throw new Error(STALE);
    const why = billProblem(ob);
    if (why) throw new Error(why);
    const check = ruleLinkProblem({ ruleId: input.ruleId, rule, obligations: await loadObligations(d), obligationId: ob.id, alreadyLinked: ob.data.scheduledRuleIds, today: input.today });
    if (check.problem) throw new Error(check.problem);
    const rec = new Recorder();
    await rec.capture(ob.id, d);
    await writeObligation(ob.id, withLog(applyEdit(ob.data, { scheduledRuleIds: [...ob.data.scheduledRuleIds, input.ruleId] }), input.today, 'linked a Finance scheduled payment'), d);
    return { undo: await rec.seal(d) };
  });
}

/** Removes the pointer. The Finance rule is untouched, and the bill's payment status never changes. One transaction, guarded Undo. */
export function unlinkRule(input: LinkRuleInput, d: FinanceDB = db): Promise<{ undo: Undo }> {
  return d.transaction('rw', tables(d), async () => {
    const ob = await getObligation(input.obligationId, d);
    if (!ob) throw new Error('That bill no longer exists. Nothing was changed.');
    if (input.expect !== null && ob.updatedAt !== input.expect) throw new Error(STALE);
    if (!ob.data.scheduledRuleIds.includes(input.ruleId)) throw new Error('That scheduled payment is not linked to this bill (it may already have been removed). Nothing was changed.');
    const rec = new Recorder();
    await rec.capture(ob.id, d);
    await writeObligation(ob.id, withLog(applyEdit(ob.data, { scheduledRuleIds: ob.data.scheduledRuleIds.filter((x) => x !== input.ruleId) }), input.today, 'unlinked a Finance scheduled payment'), d);
    return { undo: await rec.seal(d) };
  });
}

export interface KeepRuleInput {
  ruleId: number;
  /** The one bill that keeps the link. */
  keepId: number;
  /** Each holder's `updatedAt` when the owner looked, so a change on another device refuses the repair. */
  expect: Record<number, number>;
  today: string;
}

/** The sentences a "keep it on this bill" preview shows. Pure. */
export const keepRuleLines = (keepTitle: string, others: string[]): string[] => [
  `Keep this Finance scheduled payment linked to "${keepTitle}".`,
  `The link is removed from ${others.map((o) => `"${o}"`).join(' and ')}. Nothing else about those bills changes, and nothing in Finance is changed.`,
  'You can undo this.',
];

/** The explicit repair for two bills holding one rule (for example linked on two offline devices): the owner picks which bill keeps it. */
export function keepRuleOn(input: KeepRuleInput, d: FinanceDB = db): Promise<{ undo: Undo }> {
  return d.transaction('rw', tables(d), async () => {
    const obligations = await loadObligations(d);
    const holders = holdersOf(input.ruleId, obligations);
    if (!holders.some((h) => h.id === input.keepId)) throw new Error('That bill no longer holds this scheduled payment. Close this, look again and redo your change. Nothing was changed.');
    const others = holders.filter((h) => h.id !== input.keepId);
    if (others.length === 0) throw new Error('Only one bill holds this scheduled payment now, so there is nothing to repair. Nothing was changed.');
    for (const h of holders) if (input.expect[h.id] !== undefined && input.expect[h.id] !== h.updatedAt) throw new Error(STALE);
    const rec = new Recorder();
    for (const h of others) {
      await rec.capture(h.id, d);
      await writeObligation(h.id, withLog(applyEdit(h.data, { scheduledRuleIds: h.data.scheduledRuleIds.filter((x) => x !== input.ruleId) }), input.today, 'unlinked a Finance scheduled payment (kept on another bill)'), d);
    }
    return { undo: await rec.seal(d) };
  });
}

/** "Leave as is": remembers, on the lowest-numbered holder, that the owner looked at exactly this set of bills. A new holder is a new problem. */
export function acknowledgeRuleConflict(ruleId: number, d: FinanceDB = db): Promise<{ undo: Undo }> {
  return d.transaction('rw', tables(d), async () => {
    const c = ruleLinkConflicts(await loadObligations(d)).find((x) => x.ruleId === ruleId);
    if (!c) throw new Error('This is no longer a problem (the bills that held it changed). Nothing was changed.');
    const holder = c.holders[0];
    if (holder.data.acknowledged.includes(c.key)) return { undo: { rows: [], sealed: {} } };
    const rec = new Recorder();
    await rec.capture(holder.id, d);
    await writeObligation(holder.id, applyEdit(holder.data, { acknowledged: [...holder.data.acknowledged, c.key] }), d);
    return { undo: await rec.seal(d) };
  });
}
