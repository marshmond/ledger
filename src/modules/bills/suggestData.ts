/**
 * B3.1: loads what the pure `suggestMatches` needs for ONE billing period, in bulk, and hands it over. READS ONLY. It opens no write transaction,
 * creates no fact, and reads Finance only through the shared read-only loader (`lib/financeRead`) and the Bills snapshot's single bulk read of linked
 * and rejected pieces. Viewing suggestions therefore writes nothing at all (a test snapshots every table around a load).
 *
 * "Used by another module": Household Services and Home & Assets store Finance references in the shared H3 form (`txnRefs`). They are read here ONLY
 * through the shared reference reader (`readTxnRefs`), so a payment another module already counts is shown as such and a shared payment is never
 * presented as an ordinary recommendation.
 */
import { db, type FinanceDB } from '../../db';
import { isLive } from '../../core/store';
import { loadScheduled, loadTxnsBetween } from '../../lib/financeRead';
import { addDays } from '../../lib/dates';
import { pieceKey, readTxnRefs, type TxnLookup } from '../../lib/txnRef';
import type { Txn } from '../../types';
import { periodsOf, type Period } from './periods';
import { loadBillsSnapshot } from './readModel';
import type { ObligationRecord } from './model';
import { suggestMatches, suggestWindow, type SuggestResult, type Suggestion } from './suggest';

const MODULE_NAME: Record<string, string> = { services: 'Household Services', assets: 'Home & Assets' };

/** Finance pieces other modules already use: pieceKey -> the module's name. */
export async function otherModuleUses(d: FinanceDB = db): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const rowsOf = await d.moduleRecords.where('module').anyOf(Object.keys(MODULE_NAME)).toArray();
  for (const r of rowsOf) {
    if (!isLive(r)) continue;
    const name = MODULE_NAME[r.module ?? ''];
    for (const ref of readTxnRefs((r.data as { txnRefs?: unknown } | undefined)?.txnRefs)) {
      const k = pieceKey(ref);
      const cur = out.get(k) ?? [];
      if (!cur.includes(name)) out.set(k, [...cur, name]);
    }
  }
  return out;
}

/** Suggestions for one period. Reads only; nothing is stored, linked or counted. */
export async function loadSuggestions(ob: ObligationRecord, period: Period, today: string, d: FinanceDB = db): Promise<SuggestResult> {
  const snap = await loadBillsSnapshot(d);
  const due = period.timing.date ?? period.nominal;
  const win = due ? suggestWindow(ob, due) : null;
  const [txns, scheduled, otherModules] = await Promise.all([
    win ? loadTxnsBetween(win.from, win.loadTo, d) : Promise.resolve([]),
    ob.data.scheduledRuleIds.length ? loadScheduled(d, ob.data.scheduledRuleIds) : Promise.resolve(undefined),
    otherModuleUses(d),
  ]);
  // the live transactions behind every stored link and rejection, plus the ones just read
  const live = new Map(snap.financeTxns);
  for (const t of txns) if (t.id !== undefined) live.set(t.id, t);
  const lookup: TxnLookup = (id) => live.get(id);
  const current = snap.obligations.find((o) => o.id === ob.id) ?? ob; // the stored bill, so a stale prop cannot mislead
  return suggestMatches({ obligation: current, period, obligations: snap.obligations, cycles: snap.cycles, transactions: txns, lookup, scheduled, otherModules, today });
}

// ---- R2.2: the same suggestions, but starting from TRANSACTIONS (Possible matches) instead of one billing period ----

export interface TxnSuggestion { ob: ObligationRecord; period: Period; s: Suggestion }

/** How far from a payment its billing period's due date can lie (the widest of the two payment windows, both directions). */
const REACH = 12;

/**
 * For these Finance transactions, every billing period of an active bill that `suggestMatches` (the SAME reader the Link-a-payment dialog uses) would offer one of them
 * for. READS ONLY, in bulk: one Bills snapshot and one date-range read of Finance. Nothing is stored or linked. Only periods still open are looked at (a bill already
 * recorded as paid, skipped or not due is left alone), and only the chosen transactions are offered (other payments of the same dates are not, so the per-period
 * limit of three cannot push a chosen one out). Money coming back in the range is passed along so the "this may have been refunded" check still works.
 */
export async function suggestForTxns(selected: Txn[], today: string, d: FinanceDB = db): Promise<TxnSuggestion[]> {
  if (selected.length === 0) return [];
  const dates = selected.map((t) => t.date).sort();
  const lo = dates[0], hi = dates[dates.length - 1];
  const snap = await loadBillsSnapshot(d);
  const active = snap.obligations.filter((o) => o.data.status === 'active');
  if (active.length === 0) return [];
  const [inRange, otherModules] = await Promise.all([loadTxnsBetween(addDays(lo, -REACH), addDays(hi, 90), d), otherModuleUses(d)]);
  const live = new Map(snap.financeTxns);
  for (const t of inRange) if (t.id !== undefined) live.set(t.id, t);
  for (const t of selected) if (t.id !== undefined) live.set(t.id, t);
  const lookup: TxnLookup = (id) => live.get(id);
  const ids = new Set(selected.map((t) => t.id));
  const pool = [...selected, ...inRange.filter((t) => t.amountCents > 0 && !ids.has(t.id))];
  const out: TxnSuggestion[] = [];
  for (const ob of active) {
    const periods = periodsOf(ob, snap.cycles, today, { from: addDays(lo, -REACH), to: addDays(hi, REACH) }, { lookup });
    const scheduled = ob.data.scheduledRuleIds.length ? await loadScheduled(d, ob.data.scheduledRuleIds) : undefined;
    for (const period of periods) {
      if (!period.open) continue;
      const r = suggestMatches({ obligation: ob, period, obligations: snap.obligations, cycles: snap.cycles, transactions: pool, lookup, scheduled, otherModules, today });
      for (const s of r.suggestions) if (s.txn.id !== undefined && ids.has(s.txn.id)) out.push({ ob, period, s });
    }
  }
  return out;
}
