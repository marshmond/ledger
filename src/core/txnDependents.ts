/**
 * WHO POINTS AT THIS FINANCE TRANSACTION? (ST-S2, DI-02). A shared, READ-ONLY contract.
 *
 * Finance owns transactions; other modules hold references to them (Bills payment links, Household Services visit payments, Home & Assets costs,
 * Project tags). Finance must not import those modules, so each module that holds references contributes a small reader through the module
 * registry (`contributes.txnReferences`). This file defines the contract and the one function that asks every registered reader.
 *
 * Rules every reader follows:
 *  - READ ONLY. Nothing is written, nothing is deleted, nothing is "repaired".
 *  - It reads only the Finance `txns` table and the shared `moduleRecords` table, so the delete check can run inside the same database
 *    transaction as the delete itself.
 *  - It never matches by payee, amount or date. A record points at a transaction by its id, or it does not.
 *  - It never puts an amount in a message. (Hide Amounts has nothing to hide here.)
 *  - If it cannot read, it throws. The caller then says "could not check", never "nothing depends on this".
 *
 * Nothing here decides what spending is. The spending readers (`spend()`, `householdSpend()`, `billsRecordedPayments()`, the B5 union) are unchanged.
 */
import type { FinanceDB } from '../db';
import type { Txn } from '../types';

/** `current`: the link is in force and would count today. `stale`: it already needs review (the transaction or part changed since it was linked). `historical`: kept as history only (replaced, rejected, or unreadable by this version). */
export type DependentStanding = 'current' | 'historical' | 'stale';

export interface TxnDependent {
  txnId: number;
  /** The module id that holds the reference: `bills`, `services`, `assets`, `projects`, `ledger`. */
  module: string;
  /** Short plain name of that module, for sentences. */
  moduleLabel: string;
  /** Unique within the module. Two stored references to one record are ONE dependent. */
  recordId: string;
  /** What the record is called. Never an amount. */
  title: string;
  /** Singular and plural nouns for counting, e.g. `billing period` / `billing periods`. */
  noun: [string, string];
  /** What the reference is, in plain words. */
  relation: string;
  scope: 'whole' | 'part';
  /** Positions of the linked split parts, when `scope` is `part`. */
  parts: number[];
  standing: DependentStanding;
  /** True when this record is, right now, payment/cost/spending evidence that deleting the transaction would take away. */
  evidence: boolean;
  /** Extra plain words (never an amount). */
  note?: string;
  /** Where to open the record (a path such as `/bills/o/12`, without `#`). */
  href?: string;
}

export interface TxnReferenceContext {
  /** The transaction ids being asked about. */
  ids: number[];
  /** Those transactions as they are now (an id that is not here does not exist). */
  txns: Map<number, Txn>;
  d: FinanceDB;
}

export interface TxnReferenceProvider {
  /** Shown only when this reader could not be run: `Bills & Subscriptions`. */
  label: string;
  find(ctx: TxnReferenceContext): Promise<TxnDependent[]>;
}

export interface UnverifiedReader { label: string; message: string }

export interface TxnDependentsResult {
  /** True only when EVERY reader ran. False means "could not check", which is never the same as "nothing depends on it". */
  verified: boolean;
  dependents: TxnDependent[];
  unverified: UnverifiedReader[];
  /** A stable text of what was found: two results with the same signature found exactly the same things. */
  signature: string;
}

const lineOf = (x: TxnDependent) => [x.txnId, x.module, x.recordId, x.scope, x.parts.join(','), x.standing, x.evidence ? 1 : 0].join('|');
export const dependentsSignature = (xs: TxnDependent[]): string => xs.map(lineOf).sort().join('\n');

/**
 * Asks every reader. A reader that throws is reported under `unverified`; the others still run. No readers at all is also "not verified".
 * The result lists each (record, transaction) pair once: a reader that reports the same pair twice is merged.
 */
export async function readTxnDependents(ids: number[], txns: Map<number, Txn>, d: FinanceDB, providers: readonly TxnReferenceProvider[]): Promise<TxnDependentsResult> {
  const unique = [...new Set(ids)].sort((a, b) => a - b);
  if (providers.length === 0) return { verified: false, dependents: [], unverified: [{ label: 'Ledger', message: 'No reference readers are registered, so dependent records could not be checked.' }], signature: '' };
  const out = new Map<string, TxnDependent>();
  const unverified: UnverifiedReader[] = [];
  for (const p of providers) {
    try {
      for (const x of await p.find({ ids: unique, txns, d })) {
        const k = `${x.txnId}|${x.module}|${x.recordId}`;
        const prev = out.get(k);
        out.set(k, prev ? merge(prev, x) : x);
      }
    } catch (e) {
      unverified.push({ label: p.label, message: e instanceof Error ? e.message : 'The check failed.' });
    }
  }
  const dependents = [...out.values()].sort((a, b) => a.txnId - b.txnId || a.module.localeCompare(b.module) || a.recordId.localeCompare(b.recordId, 'en', { numeric: true }));
  return { verified: unverified.length === 0, dependents, unverified, signature: dependentsSignature(dependents) };
}

const RANK: Record<DependentStanding, number> = { current: 0, stale: 1, historical: 2 };
function merge(a: TxnDependent, b: TxnDependent): TxnDependent {
  const first = RANK[a.standing] <= RANK[b.standing] ? a : b;
  const parts = [...new Set([...a.parts, ...b.parts])].sort((x, y) => x - y);
  return { ...first, scope: a.scope === 'whole' || b.scope === 'whole' ? 'whole' : 'part', parts, evidence: a.evidence || b.evidence };
}

// ---- words ----

export interface ModuleCount { module: string; moduleLabel: string; noun: [string, string]; count: number }

/** How many distinct records of each kind depend on the transactions, in a fixed order. */
export function countByKind(xs: readonly TxnDependent[]): ModuleCount[] {
  const seen = new Set<string>();
  const m = new Map<string, ModuleCount>();
  for (const x of xs) {
    const rk = `${x.module}|${x.recordId}`;
    if (seen.has(rk)) continue;
    seen.add(rk);
    const k = `${x.module}|${x.noun[0]}`;
    const c = m.get(k) ?? { module: x.module, moduleLabel: x.moduleLabel, noun: x.noun, count: 0 };
    c.count++;
    m.set(k, c);
  }
  return [...m.values()].sort((a, b) => a.moduleLabel.localeCompare(b.moduleLabel) || a.noun[0].localeCompare(b.noun[0]));
}

/** "2 billing periods, 1 service visit and 1 home record". */
export function describeCounts(cs: readonly ModuleCount[]): string {
  const parts = cs.map((c) => `${c.count} ${c.count === 1 ? c.noun[0] : c.noun[1]}`);
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
