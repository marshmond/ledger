/**
 * R2.2 "Possible matches": the neutral, SHELL-LEVEL gatherer for suggestions that connect a Finance payment to a household record.
 *
 *   Ledger suggests. The owner confirms. Existing modules perform the actual linking.
 *
 * What lives here: the contract a module fills in (`PaymentSuggestionSource`), the one function that asks every module (`gatherSuggestions`), the one function
 * that carries out an Accept by handing it back to the module that owns the record (`acceptCandidate`), and one small memory of "Not a match" for modules that have
 * none of their own (Bills keeps using its own `suggestion-reject` fact).
 *
 * What does NOT live here: any matching rule of a module, any money, any link. Finance never imports a household module, and neither does this file. A module
 * registers `contributes.paymentSuggestions` (loaded on demand, like `taskFollowUp`), and Accept calls that module's EXISTING link function.
 *
 * A suggestion is READ ONLY. Gathering writes nothing. The only writes in R2.2 are (1) an Accept, which is the module's own link operation, and (2) a "Not a match".
 *
 * Which Finance transactions are even considered (all checked here, once, so a module cannot forget them):
 *  - money out only (a refund, a transfer and a setup entry are never suggested);
 *  - not already linked to any household record (any module's `txnReferences` reader, plus a Project tag): Ledger never replaces or unlinks a link, and it does
 *    not offer to share a payment between two records (that stays a manual choice in the module);
 *  - at most `MAX_TXNS` at a time, newest first.
 * If the "already linked?" check cannot be completed, NOTHING is suggested (the result says so): a missed suggestion is better than a wrong one.
 */
import { db, type FinanceDB } from '../db';
import type { Txn } from '../types';
import { isSpendingTxn } from '../lib/txnRef';
import { readTxnDependents, type TxnDependent, type TxnReferenceProvider } from './txnDependents';
import { allPaymentSuggestionSources, allTxnReferenceProviders } from './registry';

/** The most transactions looked at in one go (a bigger import is looked at in its newest part). */
export const MAX_TXNS = 400;
/** The most candidates shown for one transaction. */
export const MAX_PER_TXN = 4;

export type LinkAction = 'accept' | 'review';

/** What a transaction looked like when it was suggested. Accept refuses if it changed since. */
export interface TxnSnap { date: string; payee: string; amountCents: number }
export const snapOf = (t: Pick<Txn, 'date' | 'payee' | 'amountCents'>): TxnSnap => ({ date: t.date, payee: t.payee, amountCents: t.amountCents });
const sameSnap = (a: TxnSnap, b: TxnSnap) => a.date === b.date && a.payee === b.payee && a.amountCents === b.amountCents;

/** What a module returns for one (transaction, household record) pair. The shell adds the id, module and transaction snapshot. */
export interface RawCandidate {
  txnId: number;
  /** Stable, unique within the module: names the household record (and, for a bill, the billing period). Used to remember "Not a match". */
  targetKey: string;
  /** "Bill", "Visit", "Maintenance record", "Project". */
  targetKind: string;
  targetTitle: string;
  /** One short line of context: the period, the date, the asset. Never an amount (Hide Amounts cannot mask text). */
  targetDetail: string;
  /** Where the household record opens (a path inside Ledger, starting with `/`). */
  href: string;
  /** Plain-English reasons, each supported by the matching inputs. Never an amount, never a percentage. */
  reasons: string[];
  /** `accept`: the whole association is clear and the module's own link operation can do it safely. `review`: a choice is still needed, so the module's own screen is opened instead. */
  action: LinkAction;
  /** Why it is a review (shown beside the button). */
  reviewNote: string | null;
  /** Where the module's own workflow is (a path inside Ledger). */
  reviewHref: string | null;
  /** Opaque, the module's own: what it needs to re-check and link. Must be plain JSON. */
  payload: unknown;
}

export interface LinkCandidate extends RawCandidate {
  id: string;
  moduleId: string;
  moduleLabel: string;
  txn: TxnSnap;
}

export interface PaymentSuggestionContext {
  /** Committed Finance transactions that passed the shell's checks (money out, not linked anywhere). */
  txns: Txn[];
  today: string;
  d: FinanceDB;
}

export type LinkResult = { ok: true; message: string } | { ok: false; message: string };

export interface PaymentSuggestionSource {
  /** The module's plain name, for sentences ("Bills & Subscriptions"). */
  label: string;
  /** READ ONLY. Candidates for these transactions, already without anything the owner said "Not a match" to. Throw if it cannot answer. */
  suggest(ctx: PaymentSuggestionContext): Promise<RawCandidate[]>;
  /**
   * Links the payment through the module's EXISTING link operation. It must re-read the household record and the transaction first and refuse (with a plain reason, and
   * without writing) when anything changed. It must never change the Finance transaction's amount, payee, account, date, splits or status.
   */
  accept(c: LinkCandidate, d: FinanceDB, today: string): Promise<LinkResult>;
  /** Remembers "Not a match" for this one pair. May return a function that takes it back. */
  reject(c: LinkCandidate, d: FinanceDB): Promise<(() => Promise<void>) | void>;
}

export interface MatchGroup {
  txn: Txn;
  candidates: LinkCandidate[];
  /** More than one record could be the match: Ledger has not chosen. */
  ambiguous: boolean;
}

export interface GatherResult {
  groups: MatchGroup[];
  /** Modules that could not answer (named so the screen can say so); the others still did. */
  unavailable: string[];
  /** How many transactions were looked at after the shell's own checks. */
  considered: number;
  /** False when the "already linked?" check could not be completed (nothing is suggested then). */
  checked: boolean;
  /** Transactions beyond `MAX_TXNS` that were left out. */
  leftOut: number;
}

/** What the gatherer asks. The app uses the registered modules; a test passes its own. */
export interface GatherEnv { sources: readonly { moduleId: string; source: PaymentSuggestionSource }[]; providers: readonly TxnReferenceProvider[] }
export const liveEnv = (): GatherEnv => ({ sources: allPaymentSuggestionSources(), providers: allTxnReferenceProviders() });

const idOf = (moduleId: string, txnId: number, targetKey: string) => `${moduleId}|${txnId}|${targetKey}`;

// ---- which transactions may be suggested for ----

/** A dependent that means "this payment is already used by a household record". A Ledger Scheduled posting is not one, and history (a replaced or rejected link) is not either. */
const isUse = (x: TxnDependent) => x.module !== 'ledger' && x.standing !== 'historical';

/** The transactions that may be suggested for, or null when the "already linked?" check could not be completed. READ ONLY. */
export async function eligibleTxns(ids: readonly number[], d: FinanceDB = db, providers: readonly TxnReferenceProvider[] = allTxnReferenceProviders()): Promise<{ txns: Txn[]; checked: boolean; leftOut: number }> {
  const unique = [...new Set(ids)];
  const rows = unique.length ? await d.txns.bulkGet(unique) : [];
  const money = rows.filter((t): t is Txn => !!t && t.id !== undefined && t.amountCents < 0 && isSpendingTxn(t) && !t.project)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.id ?? 0) - (a.id ?? 0));
  const leftOut = Math.max(0, money.length - MAX_TXNS);
  const take = money.slice(0, MAX_TXNS);
  if (take.length === 0) return { txns: [], checked: true, leftOut };
  const map = new Map(take.map((t) => [t.id!, t] as [number, Txn]));
  let used: Set<number>;
  try {
    const r = await readTxnDependents(take.map((t) => t.id!), map, d, providers);
    if (!r.verified) return { txns: [], checked: false, leftOut };
    used = new Set(r.dependents.filter(isUse).map((x) => x.txnId));
  } catch { return { txns: [], checked: false, leftOut }; }
  return { txns: take.filter((t) => !used.has(t.id!)), checked: true, leftOut };
}

/**
 * Possible matches for these transactions. READ ONLY: nothing is written, linked or counted (a test snapshots every table around a call). A module that throws is
 * left out and named in `unavailable`. A transaction no module has a credible record for does not appear.
 */
export async function gatherSuggestions(
  ids: readonly number[], today: string, d: FinanceDB = db,
  env: GatherEnv = liveEnv(),
): Promise<GatherResult> {
  const { txns, checked, leftOut } = await eligibleTxns(ids, d, env.providers);
  const out: GatherResult = { groups: [], unavailable: [], considered: txns.length, checked, leftOut };
  if (txns.length === 0) return out;
  const byId = new Map(txns.map((t) => [t.id!, t] as [number, Txn]));
  const all: LinkCandidate[] = [];
  for (const { moduleId, source } of env.sources) {
    try {
      const raw = await source.suggest({ txns, today, d });
      for (const r of raw) {
        const t = byId.get(r.txnId);
        if (!t) continue; // a module can only answer for what it was asked about
        all.push({ ...r, id: idOf(moduleId, r.txnId, r.targetKey), moduleId, moduleLabel: source.label, txn: snapOf(t) });
      }
    } catch { out.unavailable.push(source.label); }
  }
  const seen = new Set<string>();
  const by = new Map<number, LinkCandidate[]>();
  for (const c of all) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    by.set(c.txnId, [...(by.get(c.txnId) ?? []), c]);
  }
  out.groups = txns.filter((t) => by.has(t.id!)).map((t) => {
    const all = by.get(t.id!)!;
    const ambiguous = all.length > 1;
    // Several records could be the match: Ledger does not pick one, and none of them can be accepted from the list. Each opens in its own module, where the owner chooses.
    const candidates = all.slice(0, MAX_PER_TXN).map((c): LinkCandidate => (ambiguous
      ? { ...c, action: 'review', reviewHref: c.reviewHref ?? c.href }
      : c));
    return { txn: t, candidates, ambiguous };
  });
  return out;
}

// ---- Accept and Not a match ----

const sourceOf = (env: GatherEnv, moduleId: string) => env.sources.find((s) => s.moduleId === moduleId)?.source;
export const TOO_STALE = 'Something changed since Ledger looked, so nothing was linked. Look at the possible matches again.';

/**
 * Carries out an Accept. The shell re-checks the parts it owns (the transaction is unchanged and still not linked anywhere), then the owning module re-checks its own
 * record and runs its existing link operation. Anything that no longer holds is a plain refusal and nothing is written. Only an `accept` candidate can be accepted:
 * a `review` candidate always goes to the module's own screen.
 */
export async function acceptCandidate(c: LinkCandidate, d: FinanceDB, today: string, env: GatherEnv = liveEnv()): Promise<LinkResult> {
  if (c.action !== 'accept') return { ok: false, message: 'This one needs your choice first. Open it to decide. Nothing was linked.' };
  const source = sourceOf(env, c.moduleId);
  if (!source) return { ok: false, message: 'That part of Ledger is not available, so nothing was linked.' };
  try {
    const t = await d.txns.get(c.txnId);
    if (!t) return { ok: false, message: 'That payment is no longer in Finance, so nothing was linked.' };
    if (!sameSnap(snapOf(t), c.txn)) return { ok: false, message: 'That payment changed in Finance since Ledger looked, so nothing was linked. Look at the possible matches again.' };
    const now = await eligibleTxns([c.txnId], d, env.providers);
    if (!now.checked) return { ok: false, message: 'Ledger could not check whether that payment is already linked, so nothing was linked.' };
    if (!now.txns.some((x) => x.id === c.txnId)) return { ok: false, message: 'That payment is already linked to a record (or is no longer a payment), so nothing was linked. Ledger never replaces a link.' };
    return await source.accept(c, d, today);
  } catch (e) {
    return { ok: false, message: `${e instanceof Error && e.message ? e.message.replace(/\s*$/, '') : 'Could not link that.'}${/nothing was (changed|linked)/i.test(e instanceof Error ? e.message : '') ? '' : ' Nothing was linked.'}` };
  }
}

export async function rejectCandidate(c: LinkCandidate, d: FinanceDB = db, env: GatherEnv = liveEnv()): Promise<(() => Promise<void>) | void> {
  const source = sourceOf(env, c.moduleId);
  if (!source) throw new Error('That part of Ledger is not available.');
  return source.reject(c, d);
}

// ---- "Not a match" for modules with no memory of their own ----
//
// One row per (module, transaction, record) in the existing `settings` table, so it rides sync and backup with no new table and no migration, and two devices
// rejecting different pairs never overwrite each other. It holds the pair's ids and a small snapshot of the transaction (date, payee, amount) so a transaction that was
// later EDITED is judged again (a different payment may be a different match). It never blocks a merchant or a provider, only this pair.

const REJECT_PREFIX = 'link-reject:';
const rejectKey = (moduleId: string, txnId: number, targetKey: string) => `${REJECT_PREFIX}${moduleId}:${txnId}:${targetKey}`;

export async function saveRejection(d: FinanceDB, moduleId: string, txn: Pick<Txn, 'id' | 'date' | 'payee' | 'amountCents'>, targetKey: string): Promise<() => Promise<void>> {
  const key = rejectKey(moduleId, txn.id!, targetKey);
  const had = await d.settings.get(key);
  await d.settings.put({ key, value: { v: 1, ...snapOf(txn) } });
  return async () => { if (had) await d.settings.put(had); else await d.settings.delete(key); };
}

/** What this module was told "Not a match" to, keyed `<txnId>:<targetKey>`, with the transaction as it was then. */
export async function loadRejections(d: FinanceDB, moduleId: string): Promise<Map<string, TxnSnap>> {
  const prefix = `${REJECT_PREFIX}${moduleId}:`;
  const rows = await d.settings.where('key').startsWith(prefix).toArray();
  const out = new Map<string, TxnSnap>();
  for (const r of rows) {
    const v = r.value as Partial<TxnSnap> | null;
    if (!v || typeof v.date !== 'string' || typeof v.payee !== 'string' || typeof v.amountCents !== 'number') continue;
    out.set(r.key.slice(prefix.length), { date: v.date, payee: v.payee, amountCents: v.amountCents });
  }
  return out;
}

/** Still rejected: said "Not a match" to this pair and the transaction has not been edited since. */
export const isRejected = (rej: Map<string, TxnSnap>, t: Pick<Txn, 'id' | 'date' | 'payee' | 'amountCents'>, targetKey: string): boolean => {
  const s = rej.get(`${t.id}:${targetKey}`);
  return !!s && sameSnap(s, snapOf(t));
};

// ---- small shared readers for the module adapters ----

/** The current names of live Contacts, by id (a removed Contact is simply absent). READ ONLY. */
export async function liveContactNames(d: FinanceDB, ids: Iterable<number>): Promise<Map<number, string>> {
  const want = [...new Set(ids)];
  const rows = want.length ? await d.contacts.bulkGet(want) : [];
  const out = new Map<number, string>();
  for (const c of rows) if (c && c.id !== undefined && !c.deletedAt && c.name.trim()) out.set(c.id, c.name);
  return out;
}
