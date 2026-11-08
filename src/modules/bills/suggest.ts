/**
 * B3.1 PAYMENT-MATCH SUGGESTIONS. PURE: no database, no clock, no network. `suggestMatches` looks at Finance transactions that were loaded in bulk
 * and says which of them plausibly paid ONE billing period, and why. It is a reader. It writes nothing, links nothing and counts no money: a
 * suggestion is only a pointer the owner may confirm through the same Link-a-payment dialog and the same checks B3 already has.
 *
 * TWO TIERS (B0 4.7). Anything weaker than "possible" is not shown at all, and the result says so in words rather than inventing a match.
 *   strong    the payment was posted from the bill's linked Finance Scheduled item for that date (the owner's own Approve), OR the payee matches
 *             what Ledger knows about this bill, the date is within 3 days of the due date, and the amount matches a RELIABLE amount
 *   possible  the payee (or the linked Scheduled item) points at this bill, the date is inside the usual window, and nothing contradicts it
 *
 * INDEPENDENT SIGNALS. Payee, date, amount, the linked Scheduled item and category are separate evidence. An amount is used only when the bill's
 * amount is reliable (a recorded bill, or a fixed price; a variable bill is compared with its earlier payments, and its amount is never a reason to
 * leave a payment out). An equal amount ALONE is never a suggestion, and the same amount at a different provider is not either.
 *
 * WHAT IT NEVER DOES: assume a Scheduled item was paid because its date passed (only the posted log and `Txn.recurringId` count), suggest money
 * coming back as a payment, suggest a transfer or a setup entry, suggest a piece already linked to this period, or present a payment already linked
 * elsewhere as an ordinary recommendation (it goes to a separate, qualified list). A rejected piece stays rejected for THIS period only; if it has
 * since changed in Finance (or its split moved) it is judged again, conservatively, never as a strong match.
 *
 * SPLITS. A split transaction offers its whole and each money-out part as separate pieces (the shared `pieceKey`), each with its own amount. Linking a
 * whole beside one of its parts is refused by the same shared rule at confirmation, so nothing is ever counted twice.
 */
import { addDays } from '../../lib/dates';
import { occurrencesBetween } from '../../lib/financeRead';
import { daysBetween } from '../../lib/money';
import { isSetupAlloc } from '../../lib/setupCategory';
import { isSpendingTxn, makeTxnRef, pieceKey, resolveRef, type TxnLookup, type TxnRef } from '../../lib/txnRef';
import type { RecurringLog, RecurringRule, Txn } from '../../types';
import { isEffective, type CycleRecord, type FactBody } from './cycleModel';
import { isLoanExcluded, type ObligationRecord } from './model';
import { namesOfBill, payeeMatch } from './payeeMatch';
import type { Period } from './periods';
import { slotWords2 } from './schedule';

export const MAX_SUGGESTIONS = 3;
export const MAX_ELSEWHERE = 3;
/** The date windows around the due date (B0 4.7): a manual payment is made near the due date; an automatic one is collected on or just after it. */
export const WINDOW = { manual: { before: 7, after: 10 }, auto: { before: 2, after: 7 } } as const;
/** How many days a refund may trail a payment and still be noted against it. */
const REFUND_DAYS = 60;

export type Tier = 'strong' | 'possible';
export type EvidenceKind =
  | 'rule-posted' | 'payee-exact' | 'payee-partial' | 'date' | 'amount-match' | 'amount-range' | 'amount-typical' | 'category-same'
  | 'amount-differs' | 'amount-outside-range' | 'amount-unknown' | 'refund-after' | 'changed-since-rejection' | 'split-whole' | 'split-part';
export interface Evidence {
  kind: EvidenceKind;
  /** Whole days (date), a count (split), or null. */
  n?: number;
  cents?: number;
  /** Which amount was compared: billed, expected, remaining. */
  basis?: 'billed' | 'expected' | 'remaining' | 'estimate';
  /** The words that matched, the date of a scheduled posting or refund, or which name matched. */
  text?: string;
  via?: string;
}

export interface PieceUse { obligationId: number; title: string; slot: string; sameBill: boolean }
export interface Suggestion {
  key: string;
  ref: TxnRef;
  tier: Tier;
  txn: Txn;
  /** Positive = money out. */
  spendCents: number;
  part: { index: number; count: number } | null;
  forPoints: Evidence[];
  againstPoints: Evidence[];
  /** Linked from another billing period (this bill or another) or another module. */
  elsewhere: { bills: PieceUse[]; modules: string[] };
  /** Choosing it deserves a closer look first (shared payment, changed since a rejection, a refund afterwards). */
  needsReview: boolean;
  reviewReasons: string[];
  fromRule: { ruleId: number; scheduledDate: string } | null;
}
export interface RejectedPiece { rec: CycleRecord & { body: Extract<FactBody, { fact: 'suggestion-reject' }> }; state: 'unchanged' | 'changed' | 'gone' | 'split-changed' }
export interface SuggestResult {
  suggestions: Suggestion[];
  /** Candidates already linked elsewhere: shown separately, dimmed and qualified, never as a recommendation. */
  elsewhere: Suggestion[];
  rejected: RejectedPiece[];
  /** Plain words for why nothing is shown, or null. */
  none: string | null;
  /** How many transaction pieces were looked at. */
  considered: number;
}

export interface SuggestInput {
  obligation: ObligationRecord;
  period: Period;
  /** Every bill (to name where a payment is already linked). */
  obligations: ObligationRecord[];
  /** Every fact record of every bill. */
  cycles: CycleRecord[];
  /** Finance transactions around the due date, read in bulk by the caller. This function never reads Finance. */
  transactions: Txn[];
  /** The live transactions the stored links and rejections point at. */
  lookup: TxnLookup;
  /** The linked Finance Scheduled rules and their handled log. */
  scheduled?: { rules: RecurringRule[]; log: RecurringLog[] };
  /** Pieces other modules (Household Services, Home & Assets) already use: pieceKey -> the module's name. */
  otherModules?: Map<string, string[]>;
  today: string;
}

// ---- pieces ----

interface Piece { txn: Txn; ref: TxnRef; key: string; spendCents: number; part: { index: number; count: number } | null; categoryId: number | null }

/** The money-out pieces of a transaction: the whole, and each money-out part of a split. Transfers, setup entries and money coming back give none. */
export function piecesOf(t: Txn): Piece[] {
  if (t.id === undefined || !isSpendingTxn(t)) return [];
  const out: Piece[] = [];
  const splits = t.splits ?? [];
  const setupPart = splits.some(isSetupAlloc);
  if (t.amountCents < 0 && !setupPart) {
    const ref = makeTxnRef(t);
    out.push({ txn: t, ref, key: pieceKey(ref), spendCents: -t.amountCents, part: null, categoryId: splits.length === 1 ? splits[0].categoryId : splits.length === 0 ? t.categoryId : null });
  }
  if (splits.length > 1) {
    splits.forEach((s, i) => {
      if (s.amountCents >= 0 || isSetupAlloc(s)) return;
      const ref = makeTxnRef(t, i);
      out.push({ txn: t, ref, key: pieceKey(ref), spendCents: -s.amountCents, part: { index: i, count: splits.length }, categoryId: s.categoryId });
    });
  }
  return out;
}

// ---- what Bills already knows about each piece ----

const links = (cycles: CycleRecord[]) => cycles.filter(isEffective).flatMap((c) => (c.body.fact === 'payment-link' ? [{ c, ref: c.body.ref }] : []));

/** A whole and one of its parts are the same money; a part and another part are not. */
const overlaps = (a: { txnId: number; splitIndex?: number }, b: { txnId: number; splitIndex?: number }) =>
  a.txnId === b.txnId && (a.splitIndex === undefined || b.splitIndex === undefined || a.splitIndex === b.splitIndex);

/** The amounts this bill's earlier periods actually recorded (net, money out), newest first, up to 12. Used only to judge a VARIABLE bill's amount. */
export function historyAmounts(obligationId: number, excludeSlot: string, cycles: CycleRecord[], lookup: TxnLookup): number[] {
  const bySlot = new Map<string, number>();
  for (const { c, ref } of links(cycles)) {
    if (c.obligationId !== obligationId || c.slot === excludeSlot) continue;
    const r = resolveRef(ref, lookup);
    if (r.needsReview) continue;
    bySlot.set(c.slot, (bySlot.get(c.slot) ?? 0) + r.spendCents);
  }
  return [...bySlot.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([, v]) => v).filter((v) => v > 0).slice(0, 12);
}

type AmountSignal =
  | { kind: 'match'; basis: 'billed' | 'expected' | 'remaining'; cents: number }
  | { kind: 'range' }
  | { kind: 'typical'; cents: number }
  | { kind: 'differs'; basis: 'billed' | 'expected' | 'remaining'; cents: number }
  | { kind: 'outside-range' }
  | { kind: 'unknown' };

/** Whether a RELIABLE amount exists for this period (a recorded bill, or a fixed price). A variable bill is judged against its history instead. */
function reliableTargets(p: Period): { basis: 'billed' | 'expected'; targets: { cents: number; basis: 'billed' | 'expected' | 'remaining' }[] } | null {
  const a = p.amounts;
  if ((a.basis !== 'billed' && a.basis !== 'expected') || a.owed === null || a.owed <= 0) return null;
  const basis = a.basis === 'billed' ? 'billed' : 'expected';
  const targets: { cents: number; basis: 'billed' | 'expected' | 'remaining' }[] = [{ cents: a.owed, basis }];
  if (a.remaining !== null && a.remaining > 0 && a.remaining !== a.owed) targets.push({ cents: a.remaining, basis: 'remaining' });
  return { basis, targets };
}

function amountSignal(spend: number, p: Period, history: number[]): AmountSignal {
  const rel = reliableTargets(p);
  if (rel) {
    const hit = rel.targets.find((t) => Math.abs(spend - t.cents) <= Math.round(t.cents * 0.01));
    if (hit) return { kind: 'match', basis: hit.basis, cents: hit.cents };
    return { kind: 'differs', basis: rel.targets[0].basis, cents: rel.targets[0].cents };
  }
  if (history.length >= 3) {
    const lo = Math.min(...history), hi = Math.max(...history);
    return spend >= Math.floor(lo * 0.9) && spend <= Math.ceil(hi * 1.1) ? { kind: 'range' } : { kind: 'outside-range' };
  }
  const a = p.amounts;
  if (a.basis === 'estimate' && a.basisCents !== null && a.basisCents > 0) {
    return Math.abs(spend - a.basisCents) <= a.basisCents * 0.5 ? { kind: 'typical', cents: a.basisCents } : { kind: 'unknown' };
  }
  return { kind: 'unknown' };
}

// ---- the reader ----

const byId = (a: Txn, b: Txn) => (a.id ?? 0) - (b.id ?? 0);

/**
 * The dates Finance transactions are read for: the usual payment window around the due date, and a little further on so a refund that trails a payment
 * can be noticed. Pure, so the loader and the reader use one definition.
 */
export function suggestWindow(ob: ObligationRecord, due: string): { from: string; to: string; loadTo: string } {
  const win = ob.data.payment.how === 'auto' ? WINDOW.auto : WINDOW.manual;
  return { from: addDays(due, -win.before), to: addDays(due, win.after), loadTo: addDays(due, win.after + REFUND_DAYS) };
}

export function suggestMatches(input: SuggestInput): SuggestResult {
  const { obligation: ob, period: p } = input;
  const empty = (none: string, considered = 0): SuggestResult => ({ suggestions: [], elsewhere: [], rejected: rejectedOf(input), none, considered });
  if (isLoanExcluded(ob.data)) return empty('Loan payments are tracked on the Loans page, so Ledger does not look for payments to link here.');
  const due = p.timing.date ?? p.nominal;
  if (due === null) return empty('This billing period has no due date yet, so Ledger has nothing to compare dates with. Record the due date, or search below.');
  const { from, to } = suggestWindow(ob, due);
  const names = namesOfBill(ob.data);

  // what is already linked, and what has been rejected, for this period
  const allLinks = links(input.cycles);
  const here = allLinks.filter((l) => l.c.obligationId === ob.id && l.c.slot === p.slot);
  const titleOf = (id: number) => input.obligations.find((o) => o.id === id)?.data.title ?? 'another bill';
  const rejections = input.cycles.filter(isEffective).filter((c) => c.obligationId === ob.id && c.slot === p.slot && c.body.fact === 'suggestion-reject') as RejectedPiece['rec'][];
  const history = historyAmounts(ob.id, p.slot, input.cycles, input.lookup);

  // posted from a linked Scheduled item (the owner's own Approve): the posted log and the transaction's own mark, nothing inferred from a passed date
  const postedFrom = new Map<number, { ruleId: number; scheduledDate: string }>();
  for (const rule of input.scheduled?.rules ?? []) {
    if (rule.id === undefined || !ob.data.scheduledRuleIds.includes(rule.id)) continue;
    const dates = occurrencesBetween(rule, addDays(due, -14), addDays(due, 14));
    for (const l of input.scheduled?.log ?? []) {
      if (l.ruleId !== rule.id || l.action !== 'posted' || l.txnId === undefined || !dates.includes(l.date)) continue;
      if (!postedFrom.has(l.txnId)) postedFrom.set(l.txnId, { ruleId: rule.id, scheduledDate: l.date });
    }
  }

  const cand: Suggestion[] = [];
  let considered = 0;
  const refunds = input.transactions.filter((t) => t.amountCents > 0 && isSpendingTxn(t));

  for (const t of [...input.transactions].sort(byId)) {
    const rule = t.id !== undefined ? postedFrom.get(t.id) ?? null : null;
    for (const piece of piecesOf(t)) {
      // inside the window, or posted from the linked Scheduled item for a date near this period
      const days = daysBetween(t.date, due);
      const inWindow = t.date >= from && t.date <= to;
      if (!inWindow && !rule) continue;
      considered++;

      // already linked to THIS period (the same piece, or its whole/part): nothing to suggest
      if (here.some((l) => overlaps(l.ref, piece.ref))) continue;

      const payee = payeeMatch(t.payee, names);
      const amt = amountSignal(piece.spendCents, p, history);
      const cat = ob.data.categoryId !== null && piece.categoryId === ob.data.categoryId;
      const reliable = reliableTargets(p) !== null || (history.length >= 3 && amt.kind === 'range');

      // identity: the payee points at this bill, or the linked Scheduled item posted it. Amount alone is never enough.
      const identity = !!rule || payee.kind === 'exact' || (payee.kind === 'partial' && (amt.kind === 'match' || cat));
      if (!identity) continue;
      // a RELIABLE amount that does not match leaves a payment out unless the linked Scheduled item posted it
      if (!rule && (amt.kind === 'differs')) continue;
      // a partial payee resemblance needs a reliable amount match to be worth showing
      if (!rule && payee.kind === 'partial' && amt.kind !== 'match') continue;

      const forP: Evidence[] = [], against: Evidence[] = [];
      if (rule) forP.push({ kind: 'rule-posted', text: rule.scheduledDate });
      if (payee.kind === 'exact') forP.push({ kind: 'payee-exact', via: payee.via ?? undefined, text: payee.word ?? undefined });
      else if (payee.kind === 'partial') forP.push({ kind: 'payee-partial', text: payee.word ?? undefined });
      forP.push({ kind: 'date', n: days });
      if (amt.kind === 'match') forP.push({ kind: 'amount-match', cents: amt.cents, basis: amt.basis });
      else if (amt.kind === 'range') forP.push({ kind: 'amount-range' });
      else if (amt.kind === 'typical') forP.push({ kind: 'amount-typical', cents: amt.cents });
      else if (amt.kind === 'differs') against.push({ kind: 'amount-differs', cents: amt.cents, basis: amt.basis });
      else if (amt.kind === 'outside-range') against.push({ kind: 'amount-outside-range' });
      else against.push({ kind: 'amount-unknown' });
      if (cat) forP.push({ kind: 'category-same' });

      // tier
      let tier: Tier = 'possible';
      if (rule && inWindow && amt.kind !== 'differs' && amt.kind !== 'outside-range') tier = 'strong';
      else if (payee.kind === 'exact' && Math.abs(days) <= 3 && reliable && (amt.kind === 'match' || amt.kind === 'range')) tier = 'strong';

      // review reasons
      const reasons: string[] = [];
      if (piece.part) forP.push({ kind: 'split-part', n: piece.part.index + 1, cents: piece.part.count });
      else if ((t.splits?.length ?? 0) > 1) forP.push({ kind: 'split-whole', n: t.splits!.length });
      const rejected = rejections.find((r) => pieceKey(r.body.ref) === piece.key);
      if (rejected) {
        const state = resolveRef(rejected.body.ref, input.lookup).state;
        if (state === 'ok') continue; // rejected for this period and unchanged: it stays out
        against.push({ kind: 'changed-since-rejection' });
        reasons.push(state === 'split-changed' ? 'You rejected a part in this position before the transaction was split differently, so this may be a different part. Look again before linking it.' : 'You rejected this payment for this period, but it has changed in Finance since. Look again before linking it.');
        tier = 'possible';
      }
      const refund = refunds.find((r) => r.id !== t.id && r.date >= t.date && daysBetween(r.date, t.date) <= REFUND_DAYS && r.amountCents <= piece.spendCents && payeeMatch(r.payee, names).kind !== 'none');
      if (refund) {
        against.push({ kind: 'refund-after', text: refund.date });
        reasons.push('Money came back from this payee afterwards, so this payment may have been reversed. Look at it before linking it.');
        tier = 'possible';
      }

      // elsewhere: linked from another billing period, another bill or another module
      const bills: PieceUse[] = allLinks
        .filter((l) => overlaps(l.ref, piece.ref) && !(l.c.obligationId === ob.id && l.c.slot === p.slot))
        .map((l) => ({ obligationId: l.c.obligationId, title: titleOf(l.c.obligationId), slot: l.c.slot, sameBill: l.c.obligationId === ob.id }));
      // another module's use of the same piece, or of its whole when this is a part (and the reverse): the same money
      const modules = [...new Set([...(input.otherModules?.get(piece.key) ?? []), ...(piece.part ? input.otherModules?.get(`${t.id}:w`) ?? [] : [...(t.splits ?? []).flatMap((_, i) => input.otherModules?.get(`${t.id}:${i}`) ?? [])])])];
      if (bills.length || modules.length) {
        reasons.push('This payment is already linked somewhere else. A real payment can be shared by two bills, but linking it here counts it once and never divides it.');
      }
      cand.push({
        key: piece.key, ref: piece.ref, tier: bills.length || modules.length ? 'possible' : tier, txn: t, spendCents: piece.spendCents, part: piece.part,
        forPoints: forP, againstPoints: against, elsewhere: { bills, modules }, needsReview: reasons.length > 0, reviewReasons: reasons, fromRule: rule,
      });
    }
  }

  const rank = (s: Suggestion) => [s.tier === 'strong' ? 0 : 1, s.fromRule ? 0 : 1, s.forPoints.some((e) => e.kind === 'payee-exact') ? 0 : 1, Math.abs(daysBetween(s.txn.date, due)), s.part ? 1 : 0, s.txn.id ?? 0, s.part?.index ?? -1];
  const order = (a: Suggestion, b: Suggestion) => { const x = rank(a), y = rank(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
  const isElsewhere = (s: Suggestion) => s.elsewhere.bills.length > 0 || s.elsewhere.modules.length > 0;
  const suggestions = cand.filter((s) => !isElsewhere(s)).sort(order).slice(0, MAX_SUGGESTIONS);
  const elsewhere = cand.filter(isElsewhere).sort(order).slice(0, MAX_ELSEWHERE);
  const none = suggestions.length === 0
    ? elsewhere.length > 0
      ? 'The only payments that look like this bill are already linked somewhere else (shown below). Nothing else looks like it.'
      : considered === 0 && input.transactions.length === 0
        ? `Ledger found no Finance transactions dated ${from} to ${to}, around ${slotWords2(p.slot)}.`
        : `No payment in Finance looks like ${slotWords2(p.slot)} yet. If you paid it, search all transactions below, or record that it was paid outside Finance.`
    : null;
  return { suggestions, elsewhere, rejected: rejectedOf(input), none, considered };
}

/** The rejections of this period, each with whether the rejected piece is still the same piece in Finance. */
export function rejectedOf(input: Pick<SuggestInput, 'obligation' | 'period' | 'cycles' | 'lookup'>): RejectedPiece[] {
  return input.cycles.filter(isEffective)
    .filter((c) => c.obligationId === input.obligation.id && c.slot === input.period.slot && c.body.fact === 'suggestion-reject')
    .map((c) => {
      const rec = c as RejectedPiece['rec'];
      const r = resolveRef(rec.body.ref, input.lookup);
      const state: RejectedPiece['state'] = r.state === 'missing' || r.state === 'not-spending' ? 'gone' : r.state === 'split-changed' ? 'split-changed' : r.state === 'changed' ? 'changed' : 'unchanged';
      return { rec, state };
    })
    .sort((a, b) => b.rec.createdAt - a.rec.createdAt || b.rec.id - a.rec.id);
}

/**
 * Is a suggested piece still exactly what was suggested? The dialog asks this just before it writes, with a FRESH read of Finance. A suggestion is
 * only a pointer; if the transaction was deleted, edited or restructured while the owner was reading, the answer is a plain refusal (and nothing is
 * written), so a stale suggestion can never become a link. Null means unchanged.
 */
export function suggestionStale(ref: TxnRef, lookup: TxnLookup): string | null {
  switch (resolveRef(ref, lookup).state) {
    case 'ok': return null;
    case 'missing': return 'That payment is no longer in Finance, so it cannot be linked. Nothing was changed. Look at the suggestions again.';
    case 'not-spending': return 'That transaction is now a transfer or a setup entry, so it cannot be linked as a payment. Nothing was changed.';
    case 'split-changed': return 'That transaction was split differently since it was suggested, so the part may now be a different one. Nothing was changed. Look at the suggestions again.';
    case 'changed': return 'That payment changed in Finance (its amount, date or payee) since it was suggested. Nothing was changed. Look at the suggestions again.';
  }
}

// ---- words ----

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const dayWords = (n: number) => (n === 0 ? 'on the due date' : n < 0 ? `${plural(-n, 'day')} before the due date` : `${plural(n, 'day')} after the due date`);
const BASIS_WORDS: Record<NonNullable<Evidence['basis']>, string> = { billed: 'the bill you recorded', expected: 'the expected amount', remaining: 'what is still left to pay', estimate: 'the typical amount' };

/** One piece of evidence in plain words. Amounts go through `money`, so Hide Amounts applies. */
export function evidenceWords(e: Evidence, money: (c: number) => string): string {
  switch (e.kind) {
    case 'rule-posted': return `Posted from the linked Finance Scheduled payment for ${e.text}. You approved that posting yourself; it does not show the provider was paid.`;
    case 'payee-exact': return e.via === 'hint' ? 'The payee matches a payee you asked Ledger to remember for this bill.' : e.via === 'provider' ? 'The payee matches the provider.' : e.via === 'rule' ? 'The payee matches the linked Scheduled payment.' : 'The payee matches the name of this bill.';
    case 'payee-partial': return `The payee shares the word "${e.text}" with this bill. That is a weak resemblance.`;
    case 'date': return `Dated ${dayWords(e.n ?? 0)}.`;
    case 'amount-match': return `The amount matches ${BASIS_WORDS[e.basis ?? 'billed']} (${money(e.cents ?? 0)}).`;
    case 'amount-range': return 'The amount is within the range of the payments you linked before for this bill.';
    case 'amount-typical': return `The amount is near the typical amount you entered (${money(e.cents ?? 0)}).`;
    case 'category-same': return 'It has the same Finance category as this bill.';
    case 'amount-differs': return `The amount differs from ${BASIS_WORDS[e.basis ?? 'billed']} (${money(e.cents ?? 0)}).`;
    case 'amount-outside-range': return 'The amount is outside the range of the payments you linked before for this bill. That can be normal for a bill that varies.';
    case 'amount-unknown': return 'Ledger has no reliable amount for this bill, so the amount was not used to judge it.';
    case 'refund-after': return `Money came back from this payee on ${e.text}.`;
    case 'changed-since-rejection': return 'You rejected it earlier, and it has changed in Finance since.';
    case 'split-whole': return `This transaction is split into ${e.n} parts. Linking the whole treats all of it as this payment; you can link one part instead.`;
    case 'split-part': return `This is part ${e.n} of ${e.cents} of a larger transaction.`;
  }
}

/** The one-line label for the tier. Never a percentage. */
export const TIER_WORDS: Record<Tier, string> = { strong: 'Looks like the payment', possible: 'Possible match' };
