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
import { pieceKey, readTxnRefs, type TxnLookup } from '../../lib/txnRef';
import { loadBillsSnapshot } from './readModel';
import type { ObligationRecord } from './model';
import type { Period } from './periods';
import { suggestMatches, suggestWindow, type SuggestResult } from './suggest';

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
