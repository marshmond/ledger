/**
 * B3.1 DISCOVERY: reading what Finance shows, remembering what the owner decided, and the explicit "make this a bill" step. Nothing here is automatic:
 * a suggestion becomes a bill only when the owner confirms an editable form, and a bill never carries payments with it.
 *
 * STORAGE (decided after reading the existing patterns). The owner's choices about suggestions are tiny, durable and must travel between devices, so
 * they are ordinary `bills` module records (kind `discovery`), exactly like billing-period facts: backup, restore and sync already carry them and no
 * schema, table or merge rule is added. A device-local preference was rejected (it would not sync, so a dismissal on the phone would return on the
 * laptop). Each choice is ITS OWN record, added and never merged, so two devices deciding differently keep both; the newest decides and the older ones
 * stay as history. A record holds only what is needed to recognise the pattern again: the normalised payee, the choice, the day, the bill (for
 * "already tracked") and a small snapshot (cadence, count, last date, typical amount) so a materially different pattern can be told from the same one.
 * No transaction id, no payee list, no per-payment amount.
 *
 * Finance is only READ, in bulk, through the shared read-only loader, before any write transaction opens. Every write is one transaction with a guarded
 * Undo, and writes only Bills records (plus the shared provider Contact, through the existing `findOrCreateContact`).
 */
import { db, type FinanceDB } from '../../db';
import type { ModuleRecord } from '../../core/entities';
import { isLive } from '../../core/store';
import { loadAllTxns, loadScheduled } from '../../lib/financeRead';
import { createObligation, getObligation, loadObligations, rows, tables, writeObligation, type Created, type ProviderInput } from './data';
import { discoverRecurring, type Candidate, type Decision, type DecisionKind, type DecisionSnap, type DiscoveryResult } from './discovery';
import { applyEdit, MODULE, withLog, type ObligationData } from './model';
import { ruleLinkProblem } from './scheduledLink';
import { Recorder, type Undo } from './undo';
import { isDate, isInt } from './util';

export const DISCOVERY_KIND = 'discovery';
export const MAX_PAYEE_HINTS = 10;
const STALE = 'This bill was changed (maybe on another device) since you opened this. Close it, look again and redo your change. Nothing was changed.';
const KINDS: DecisionKind[] = ['not-recurring', 'dismissed', 'tracked'];

// ---- reading ----

/** Reads one stored choice defensively. A damaged one is ignored (and never rewritten); it can only fail to hide a suggestion, never hide one wrongly. */
export function readDecision(r: ModuleRecord): Decision | null {
  const d = (r.data ?? {}) as Record<string, unknown>;
  const snap = (d.snap && typeof d.snap === 'object' ? d.snap : {}) as Record<string, unknown>;
  if (typeof d.key !== 'string' || !d.key.startsWith('p:') || !KINDS.includes(d.decision as DecisionKind) || !isDate(d.on)) return null;
  if (!isInt(snap.n) || !isDate(snap.last) || !isInt(snap.cents)) return null;
  const f = snap.f === null || snap.f === undefined ? null : (['weekly', 'biweekly', 'semimonthly', 'monthly', 'quarterly', 'yearly'] as const).find((x) => x === snap.f) ?? 'bad';
  if (f === 'bad') return null;
  return { id: r.id as number, key: d.key, decision: d.decision as DecisionKind, on: d.on, obligationId: isInt(d.obligationId) && d.obligationId > 0 ? d.obligationId : null, snap: { f, n: snap.n, last: snap.last, cents: snap.cents } };
}

export async function loadDecisions(d: FinanceDB = db): Promise<Decision[]> {
  return (await d.moduleRecords.where('[module+kind]').equals([MODULE, DISCOVERY_KIND]).toArray()).filter(isLive).flatMap((r) => { const x = readDecision(r); return x ? [x] : []; });
}

/** What Finance shows, read once in bulk and handed to the pure reader. Writes nothing. */
export async function loadDiscovery(today: string, d: FinanceDB = db): Promise<DiscoveryResult> {
  const [txns, sched, obligations, decisions] = await Promise.all([loadAllTxns(d), loadScheduled(d), loadObligations(d), loadDecisions(d)]);
  return discoverRecurring({ transactions: txns, rules: sched.rules, log: sched.log, obligations, decisions, today });
}

export const snapOf = (c: Pick<Candidate, 'frequency' | 'count' | 'lastDate' | 'amounts'>): DecisionSnap => ({ f: c.frequency, n: c.count, last: c.lastDate, cents: c.amounts.typical });

// ---- writing the owner's choices ----

export interface DecisionInput { key: string; decision: DecisionKind; snap: DecisionSnap; obligationId?: number | null; today: string; /** One per press. */ op: string }
export interface DecisionResult { id: number; reused: boolean; undo: Undo }

const storedDecision = (i: DecisionInput) => ({
  key: i.key, decision: i.decision, on: i.today, op: i.op,
  snap: { ...(i.snap.f ? { f: i.snap.f } : {}), n: i.snap.n, last: i.snap.last, cents: i.snap.cents },
  ...(i.obligationId ? { obligationId: i.obligationId } : {}),
});

function decisionProblem(i: DecisionInput): string | null {
  if (!i.key.startsWith('p:') || i.key.length > 90) return 'That suggestion could not be identified.';
  if (!KINDS.includes(i.decision)) return 'That is not a choice Ledger knows.';
  if (!isDate(i.today) || !isInt(i.snap.n) || i.snap.n < 0 || !isDate(i.snap.last) || !isInt(i.snap.cents)) return 'That suggestion could not be recorded.';
  if (i.decision === 'tracked' && !i.obligationId) return 'Pick the bill that already covers it.';
  return null;
}

async function writeDecisionIn(i: DecisionInput, d: FinanceDB, rec: Recorder): Promise<DecisionResult> {
  const bad = decisionProblem(i);
  if (bad) throw new Error(bad);
  const mine = (await d.moduleRecords.where('[module+kind]').equals([MODULE, DISCOVERY_KIND]).toArray()).filter(isLive);
  const again = mine.find((r) => (r.data as { op?: unknown } | undefined)?.op === i.op);
  if (again) return { id: again.id as number, reused: true, undo: { rows: [], sealed: {} } };
  const id = await rows(d).put({ module: MODULE, kind: DISCOVERY_KIND, data: storedDecision(i) });
  rec.made(id);
  return { id, reused: false, undo: rec.undo };
}

/**
 * "Not a recurring expense" and "Dismiss for now": remembers the choice. It creates no bill, links no payment and changes no Finance record. Repeating the
 * same press (same operation id) records once. One transaction; guarded Undo.
 */
export function recordDecision(i: DecisionInput, d: FinanceDB = db): Promise<DecisionResult> {
  return d.transaction('rw', tables(d), async () => {
    const rec = new Recorder();
    const r = await writeDecisionIn(i, d, rec);
    return r.reused ? r : { ...r, undo: await rec.seal(d) };
  });
}

/** "Look at this again": takes the choice back (a soft delete: the record stays as history, and Undo can restore it). */
export function removeDecision(id: number, expectUpdatedAt: number, d: FinanceDB = db): Promise<{ undo: Undo }> {
  return d.transaction('rw', tables(d), async () => {
    const r = await d.moduleRecords.get(id);
    if (!r || r.module !== MODULE || r.kind !== DISCOVERY_KIND || !isLive(r)) throw new Error('That choice can no longer be changed here. Nothing was changed.');
    if (r.updatedAt !== expectUpdatedAt) throw new Error('That choice was changed (maybe on another device) since you opened this. Look again. Nothing was changed.');
    const rec = new Recorder();
    await rec.capture(id, d);
    await rows(d).remove(id);
    return { undo: await rec.seal(d) };
  });
}

/** The stored row of a decision (to know its `updatedAt` for a guarded reconsider). */
export async function decisionRow(id: number, d: FinanceDB = db): Promise<ModuleRecord | undefined> {
  const r = await d.moduleRecords.get(id);
  return r && r.module === MODULE && r.kind === DISCOVERY_KIND && isLive(r) ? r : undefined;
}

// ---- "Create a bill from this" ----

export interface SeedSave {
  /** The bill exactly as the owner left the form. */
  data: ObligationData;
  provider?: ProviderInput | null;
  today: string;
  /** The suggestion this bill came from: recorded as "already tracked" in the SAME step, so it is not suggested again. One `op` per open form. */
  from?: { key: string; snap: DecisionSnap; op: string } | null;
  /** An existing Finance Scheduled rule to point the new bill at, checked in the same step. The rule itself is never changed. */
  ruleId?: number | null;
}

/**
 * Saves a bill the owner confirmed from a suggestion or a Scheduled item. ONE transaction: the bill, its provider Contact, the "already tracked" record
 * and the validated Scheduled link all commit together or not at all. It copies no historical payment (link those yourself afterwards, one by one, through
 * the usual Link-a-payment steps), creates nothing in Finance, and a repeated press with the same operation id reuses the first bill.
 */
export async function createFromSeed(input: SeedSave, d: FinanceDB = db): Promise<Created & { reused: boolean }> {
  const sched = input.ruleId != null ? await loadScheduled(d, [input.ruleId]) : null; // read BEFORE the transaction opens
  let reused = false;
  const data: ObligationData = { ...input.data, scheduledRuleIds: input.ruleId != null ? [input.ruleId] : input.data.scheduledRuleIds };
  const created = await createObligation({
    data, provider: input.provider, today: input.today,
    before: async (tx) => {
      if (!input.from) return null;
      const earlier = (await tx.moduleRecords.where('[module+kind]').equals([MODULE, DISCOVERY_KIND]).toArray()).filter(isLive).find((r) => (r.data as { op?: unknown } | undefined)?.op === input.from!.op);
      const ob = earlier ? readDecision(earlier)?.obligationId : null;
      if (!ob || !(await getObligation(ob, tx))) return null;
      reused = true;
      return { id: ob, contactCreated: false, contactId: null, taskIds: [], undo: { rows: [], sealed: {} } };
    },
    also: async ({ d: tx, id, rec }) => {
      if (input.ruleId != null) {
        const check = ruleLinkProblem({ ruleId: input.ruleId, rule: sched?.rules[0], obligations: await loadObligations(tx), obligationId: id, alreadyLinked: [], today: input.today });
        if (check.problem) throw new Error(check.problem);
      }
      if (input.from) await writeDecisionIn({ key: input.from.key, decision: 'tracked', snap: input.from.snap, obligationId: id, today: input.today, op: input.from.op }, tx, rec);
    },
  }, d);
  return { ...created, reused };
}

// ---- "Link to an existing bill" ----

export interface RememberInput {
  obligationId: number;
  expect: number | null;
  /** The suggestion being attached to this bill. */
  from: { key: string; snap: DecisionSnap; op: string };
  /** The normalised payee words to remember on the bill so its payments can be suggested later. Only when the owner agreed. */
  hint: string | null;
  today: string;
}

/**
 * "This is already tracked as that bill": the owner names the bill, and (only if they agree) Ledger remembers the payee on it for future suggestions. It
 * records the choice and edits nothing else: no payment is linked, no period changes, no Finance record is touched. One transaction; guarded Undo.
 */
export function rememberOnBill(i: RememberInput, d: FinanceDB = db): Promise<{ undo: Undo; reused: boolean }> {
  return d.transaction('rw', tables(d), async () => {
    const ob = await getObligation(i.obligationId, d);
    if (!ob) throw new Error('That bill no longer exists. Nothing was changed.');
    if (i.expect !== null && ob.updatedAt !== i.expect) throw new Error(STALE);
    const rec = new Recorder();
    const hint = i.hint?.trim() ?? '';
    const already = (await d.moduleRecords.where('[module+kind]').equals([MODULE, DISCOVERY_KIND]).toArray()).filter(isLive).some((r) => (r.data as { op?: unknown } | undefined)?.op === i.from.op);
    if (already) return { undo: { rows: [], sealed: {} } as Undo, reused: true };
    if (hint && !ob.data.payeeHints.includes(hint)) {
      if (ob.data.payeeHints.length >= MAX_PAYEE_HINTS) throw new Error(`A bill can remember ${MAX_PAYEE_HINTS} payee names at most. Nothing was changed.`);
      await rec.capture(ob.id, d);
      await writeObligation(ob.id, withLog(applyEdit(ob.data, { payeeHints: [...ob.data.payeeHints, hint] }), i.today, 'asked Ledger to remember a payee for suggestions'), d);
    }
    await writeDecisionIn({ key: i.from.key, decision: 'tracked', snap: i.from.snap, obligationId: ob.id, today: i.today, op: i.from.op }, d, rec);
    return { undo: await rec.seal(d), reused: false };
  });
}
