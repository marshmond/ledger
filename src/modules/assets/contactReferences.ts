/**
 * Contacts C2: where a Contact appears in Home & Assets. READ ONLY, three stored fields:
 *  - `asset.contacts` (related people, each with the role the owner wrote, such as "installer");
 *  - `service.providerContactId` (who did the work, on a service history entry);
 *  - `warranty.providerContactId` (the warranty provider).
 * Titles come from the module's own public labels (the place and name; never a serial number, plate or address). The implicit warranty an asset
 * carries in its own end-date field has no Contact, so it is not listed.
 */
import { readRows, type ContactReference, type ContactReferenceProvider } from '../../core/contactReferences';
import { asAsset, MODULE } from './model';
import { asService } from './service';
import { asWarranty } from './warranty';
import { assetLabel, servicePath, serviceLabel, warrantyLabel, warrantyPath } from './records';


export const assetsContactReferences: ContactReferenceProvider = {
  label: 'Home & Assets',
  async find({ ids, d }) {
    const out: ContactReference[] = [];
    const all = (await readRows(d, MODULE, 'asset', asAsset)).sort((a, b) => a.data.name.localeCompare(b.data.name) || a.id - b.id);
    for (const a of all) {
      const seen = new Set<string>();
      for (const c of a.data.contacts) {
        if (!ids.has(c.contactId)) continue;
        const k = `${c.contactId}|${c.role}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const gone = a.data.archived || a.data.status === 'sold' || a.data.status === 'disposed' || a.data.status === 'replaced';
        out.push({
          contactId: c.contactId, module: 'assets', kind: 'asset', recordId: String(a.id), role: c.role ? `person:${c.role.toLowerCase()}` : 'person',
          title: assetLabel(all, a),
          relation: c.role ? `Related person on this item, as “${c.role}”` : 'Related person on this item',
          href: `/assets/${a.id}`,
          ...(gone ? { inactive: true } : {}),
        });
      }
    }
    for (const s of await readRows(d, MODULE, 'service', asService)) {
      const cid = s.data.providerContactId;
      if (cid === null || !ids.has(cid)) continue;
      out.push({
        contactId: cid, module: 'assets', kind: 'service', recordId: String(s.id), role: 'provider', facet: 'provider',
        title: serviceLabel(all, s), relation: 'Did the work on this service history entry',
        href: servicePath(all, s), ...(s.data.date ? { date: s.data.date } : {}),
      });
    }
    for (const w of await readRows(d, MODULE, 'warranty', asWarranty)) {
      const cid = w.data.providerContactId;
      if (cid === null || !ids.has(cid)) continue;
      out.push({
        contactId: cid, module: 'assets', kind: 'warranty', recordId: String(w.id), role: 'provider', facet: 'provider',
        title: warrantyLabel(all, w), relation: 'Warranty provider',
        href: warrantyPath(all, w), ...(w.data.endDate ? { date: w.data.endDate } : {}),
      });
    }
    return out;
  },
};
