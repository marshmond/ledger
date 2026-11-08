/**
 * Which Household Services records point at a Finance transaction (ST-S2, DI-02). READ ONLY.
 * A visit's payment (`txnRefs`) and an arrangement's own payments (`txnRefs`) are each ONE dependent, however many references they hold to the same transaction.
 */
import type { TxnReferenceProvider } from '../../core/txnDependents';
import { dependentsFromRefs } from '../../core/txnDependentsBuild';
import { loadArrangements } from './data';
import { loadVisits } from './visits';

const LABEL = 'Household Services';

export const servicesTxnReferences: TxnReferenceProvider = {
  label: LABEL,
  async find({ ids, txns, d }) {
    const want = new Set(ids);
    const [visits, arrangements] = await Promise.all([loadVisits(d), loadArrangements(d)]);
    const out = [];
    for (const v of visits) {
      out.push(...dependentsFromRefs(v.data.txnRefs, want, txns, {
        module: 'services', moduleLabel: LABEL, recordId: `visit:${v.id}`, title: v.data.title || 'A service visit', noun: ['service visit', 'service visits'],
        relation: 'Payment for this service visit', href: `/services/v/${v.id}`,
        note: v.data.paidManualCents !== null ? 'This visit also holds a typed outside-Finance amount. Deleting the transaction does not switch the visit to it.' : undefined,
      }));
    }
    for (const a of arrangements) {
      out.push(...dependentsFromRefs(a.data.txnRefs, want, txns, {
        module: 'services', moduleLabel: LABEL, recordId: `arrangement:${a.id}`, title: a.data.title || 'A service arrangement', noun: ['service arrangement', 'service arrangements'],
        relation: 'Payment linked to this service arrangement', href: `/services/a/${a.id}`,
      }));
    }
    return out;
  },
};
