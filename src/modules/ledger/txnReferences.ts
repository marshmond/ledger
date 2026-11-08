/**
 * Finance's own dependents of a transaction (ST-S2, DI-02). READ ONLY.
 *
 * A scheduled payment that was approved keeps a log entry naming the transaction it posted. If the transaction is deleted the entry stays, so that date is still
 * remembered as "posted" and the schedule does not offer it again. That is Finance's existing behaviour; this reader only makes it visible before a delete.
 * Transfer partners are not listed here: the delete plan names them itself, because deleting one half of a transfer deletes the other.
 */
import type { TxnDependent, TxnReferenceProvider } from '../../core/txnDependents';

export const ledgerTxnReferences: TxnReferenceProvider = {
  label: 'Ledger scheduled payments',
  async find({ ids, d }) {
    const want = new Set(ids);
    const log = (await d.recurringLog.toArray()).filter((l) => l.action === 'posted' && l.txnId !== undefined && want.has(l.txnId));
    if (!log.length) return [];
    const rules = new Map((await d.recurring.toArray()).map((r) => [r.id, r]));
    const out: TxnDependent[] = [];
    for (const l of log) {
      const r = rules.get(l.ruleId);
      out.push({
        txnId: l.txnId!, module: 'ledger', moduleLabel: 'Ledger scheduled payments', recordId: `scheduled:${l.ruleId}:${l.date}`,
        title: r ? `Scheduled payment: ${r.payee || 'no payee'}, ${l.date}` : `A scheduled payment that no longer exists, ${l.date}`, noun: ['scheduled-payment record', 'scheduled-payment records'],
        relation: 'This transaction was posted from a scheduled payment. The schedule keeps remembering that date as posted, so it will not offer it again.',
        scope: 'whole', parts: [], standing: 'historical', evidence: false, href: r ? '/ledger/scheduled' : undefined,
      });
    }
    return out;
  },
};
