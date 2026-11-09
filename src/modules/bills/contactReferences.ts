/**
 * Contacts C2: which bills and subscriptions name a Contact as provider (`obligation.providerContactId`). READ ONLY. The provider-name text saved on a
 * bill is a snapshot used for payee hints, never a live Contact, so it is not read here. Nothing about payments, amounts or Finance is shown.
 */
import { readRows, type ContactReference, type ContactReferenceProvider } from '../../core/contactReferences';
import { asObligation, isSubscriptionType, STATUS_LABEL } from './model';
import { obligationPath } from './paths';

export const billsContactReferences: ContactReferenceProvider = {
  label: 'Bills & Subscriptions',
  async find({ ids, d }) {
    const out: ContactReference[] = [];
    for (const o of await readRows(d, 'bills', 'obligation', asObligation)) {
      const cid = o.data.providerContactId;
      if (cid === null || !ids.has(cid)) continue;
      out.push({
        contactId: cid, module: 'bills', kind: 'obligation', recordId: String(o.id), role: 'provider', facet: 'provider',
        title: o.data.title.trim() || 'Untitled bill', relation: `Provider of this ${isSubscriptionType(o.data.type) ? 'subscription' : 'bill'}`,
        href: obligationPath(o.id), status: STATUS_LABEL[o.data.status],
        ...(o.data.status === 'ended' ? { inactive: true } : {}),
      });
    }
    return out;
  },
};
