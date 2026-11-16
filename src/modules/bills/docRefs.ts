/**
 * R4.1 Records: Bills & Subscriptions' document references. One kind of record keeps a reference list: the obligation (a bill or a subscription). The obligation's rows are read
 * directly with the module's OWN reader `asObligation`, not `loadObligations`, because that also reads every billing period and lifecycle fact that this index does not need.
 * Read only. No date is attached (a renewal date can be superseded by a recorded lifecycle fact, so it is not copied here) and no gap is reported.
 */
import { db, type FinanceDB } from '../../db';
import { isLive } from '../../core/store';
import { makeRefs, type DocumentRead, type DocumentRef } from '../../core/documentRefs';
import { asObligation, isSubscriptionType, KIND, MODULE, STATUS_LABEL } from './model';
import { obligationPath } from './paths';

export const SOURCE_LABEL = 'Bills & Subscriptions';

export async function readBillDocs(_ctx?: unknown, d: FinanceDB = db): Promise<DocumentRead> {
  const bills = (await d.moduleRecords.where('[module+kind]').equals([MODULE, KIND]).toArray()).filter(isLive).map(asObligation);
  const refs: DocumentRef[] = [];
  for (const b of bills) {
    const sub = isSubscriptionType(b.data.type);
    refs.push(...makeRefs({
      moduleId: MODULE, sourceLabel: SOURCE_LABEL, ownerKey: `obligation:${b.id}`, ownerName: b.data.title, recordKind: sub ? 'Subscription' : 'Bill',
      context: b.data.providerNameSnapshot, status: b.data.status !== 'active' ? STATUS_LABEL[b.data.status] : '',
      recordPath: obligationPath(b.id), recordAction: sub ? 'View subscription' : 'View bill',
    }, b.data.refs));
  }
  return { refs, gaps: [] };
}
