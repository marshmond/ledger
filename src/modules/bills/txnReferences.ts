/**
 * Which Bills records point at a Finance transaction (ST-S2, DI-02). READ ONLY: reads Bills facts and bills; changes nothing.
 *
 * A billing period (`bill:<bill id>:<period>`) holds a payment through a `payment-link` fact. Several facts for one period (an old replaced link beside the
 * live one) are ONE dependent. A `suggestion-reject` fact also names a transaction, but only as "not this payment"; it counts no money, so it is shown as
 * history. A fact this version cannot read is not skipped: if its stored `ref` names a transaction it is reported as history ("kept as saved"), because
 * saying nothing would imply nothing depends on that payment.
 */
import { isLive } from '../../core/store';
import type { TxnReferenceProvider, TxnDependent } from '../../core/txnDependents';
import { dependentsFromRefs } from '../../core/txnDependentsBuild';
import { readTxnRefs } from '../../lib/txnRef';
import { slotWords2 } from './schedule';
import { isEffective, readCycle } from './cycleModel';
import { KIND, MODULE } from './model';
import { CYCLE_KIND } from './cycleModel';

const NOUN: [string, string] = ['billing period', 'billing periods'];
const LABEL = 'Bills & Subscriptions';

export const billsTxnReferences: TxnReferenceProvider = {
  label: LABEL,
  async find({ ids, txns, d }) {
    const want = new Set(ids);
    const [cycleRows, bills] = await Promise.all([
      d.moduleRecords.where('[module+kind]').equals([MODULE, CYCLE_KIND]).toArray(),
      d.moduleRecords.where('[module+kind]').equals([MODULE, KIND]).toArray(),
    ]);
    const titleOf = new Map<number, string>();
    for (const b of bills) if (isLive(b)) titleOf.set(b.id as number, String((b.data as { title?: unknown } | undefined)?.title ?? '') || 'A bill');
    const cycles = cycleRows.filter(isLive).map(readCycle);
    // typed outside-Finance amounts per period: they stay set aside while a Finance link exists, and a deletion does not bring them back
    const typed = new Set<string>();
    for (const c of cycles) if (isEffective(c) && c.body.fact === 'paid-outside' && c.body.cents !== null && c.body.cents > 0) typed.add(`${c.obligationId}|${c.slot}`);

    const out: TxnDependent[] = [];
    for (const c of cycles) {
      const oid = c.obligationId;
      if (oid === null || !titleOf.has(oid) || c.slot === null) continue;
      const recordId = `bill:${oid}:${c.slot}`;
      const base = { module: 'bills', moduleLabel: LABEL, recordId, title: `${titleOf.get(oid)}, ${slotWords2(c.slot)}`, noun: NOUN, href: `/bills/o/${oid}` };
      if (c.body === null) {
        // unreadable by this version: report what its stored reference names, as history, and keep it exactly as saved
        const refs = readTxnRefs([(c.raw as { ref?: unknown }).ref]);
        out.push(...dependentsFromRefs(refs, want, txns, { ...base, relation: 'A saved entry this version of Ledger cannot read, which names this transaction. It is kept exactly as saved.' }, { historical: true }));
        continue;
      }
      if (c.body.fact === 'payment-link') {
        const effective = isEffective(c);
        const setAside = effective && typed.has(`${oid}|${c.slot}`);
        out.push(...dependentsFromRefs([c.body.ref], want, txns, {
          ...base,
          relation: effective ? 'Payment linked to this billing period' : 'An earlier payment link for this billing period (replaced, kept as history)',
          note: setAside ? 'A typed outside-Finance amount for this period stays set aside. Deleting the transaction does not bring it back into the totals.' : undefined,
        }, { historical: !effective }));
      } else if (c.body.fact === 'suggestion-reject') {
        out.push(...dependentsFromRefs([c.body.ref], want, txns, { ...base, relation: 'You rejected this transaction as a suggested payment for this billing period. It counts no money.' }, { historical: true }));
      }
    }
    return out;
  },
};
