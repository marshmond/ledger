/**
 * Which Home & Assets records point at a Finance transaction (ST-S2, DI-02). READ ONLY.
 * An asset's purchase (`purchaseTxnRefs`) and a maintenance/service record (`txnRefs`) are each ONE dependent. Whole transactions and split parts are both reported
 * (`scope`/`parts`); whether a part still matches is judged by the shared reference reader, exactly as the spending readers judge it.
 */
import type { TxnReferenceProvider } from '../../core/txnDependents';
import { dependentsFromRefs } from '../../core/txnDependentsBuild';
import { loadAssets } from './data';
import { loadServices } from './serviceData';

const LABEL = 'Home & Assets';

export const assetsTxnReferences: TxnReferenceProvider = {
  label: LABEL,
  async find({ ids, txns, d }) {
    const want = new Set(ids);
    const [assets, services] = await Promise.all([loadAssets(d), loadServices(d)]);
    const out = [];
    for (const a of assets) {
      out.push(...dependentsFromRefs(a.data.purchaseTxnRefs, want, txns, {
        module: 'assets', moduleLabel: LABEL, recordId: `asset:${a.id}`, title: a.data.name, noun: ['home or asset purchase record', 'home or asset purchase records'],
        relation: 'Payment for the purchase of this asset', href: `/assets/${a.id}`,
      }));
    }
    for (const s of services) {
      out.push(...dependentsFromRefs(s.data.txnRefs, want, txns, {
        module: 'assets', moduleLabel: LABEL, recordId: `service:${s.id}`, title: s.data.title || 'A maintenance record', noun: ['home-maintenance record', 'home-maintenance records'],
        relation: 'Cost of this maintenance or service record', href: `/assets/${s.data.assetId}?service=${s.id}`,
        note: s.data.costCents !== null ? 'This record also holds a typed amount. Deleting the transaction does not switch it to the typed amount.' : undefined,
      }));
    }
    return out;
  },
};
