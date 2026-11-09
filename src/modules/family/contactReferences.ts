/**
 * Contacts C2: where a Contact appears in Family. READ ONLY, two stored fields:
 *  - `family/member.contactId` (the Contact is a household member's identity);
 *  - `family/contact.contactId` (the Contact is an important contact for a member: school office, coach...). An archived association is still listed, quietly.
 * It never changes Spouse, "This is me" or anything stored, and it does not show the note or the birthday. A row this version cannot fully read is still
 * listed if its Contact id can be read, marked "needs review".
 */
import { readRows, type ContactReference, type ContactReferenceProvider } from '../../core/contactReferences';
import { isLive } from '../../core/store';
import { asImportantContact, CONTACT_KIND } from './importantContactModel';
import { asMember, KIND, MODULE, memberRoute, FAMILY_BASE, ROLE_LABEL, STATUS_LABEL } from './model';

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

export const familyContactReferences: ContactReferenceProvider = {
  label: 'Family',
  async find({ ids, d }) {
    const out: ContactReference[] = [];
    const members = (await readRows(d, MODULE, KIND, asMember)).sort((a, b) => a.id - b.id);
    const memberHref = (id: number) => `${FAMILY_BASE}${memberRoute(id)}`;
    for (const m of members) {
      const cid = m.data?.contactId ?? (isInt(m.raw.contactId) ? m.raw.contactId : null);
      if (cid === null || !ids.has(cid)) continue;
      out.push(m.data
        ? {
          contactId: cid, module: 'family', kind: 'member', recordId: String(m.id), role: 'member', title: 'Household member',
          relation: `${ROLE_LABEL[m.data.role]} in the household`, href: memberHref(m.id), status: STATUS_LABEL[m.data.status],
          ...(m.data.status === 'active' ? { facet: 'member' as const } : { inactive: true }),
        }
        : {
          contactId: cid, module: 'family', kind: 'member', recordId: String(m.id), role: 'member', title: 'Household member (needs review)',
          relation: 'A household member record points at this contact, but part of it could not be read', href: memberHref(m.id), status: 'Needs review',
        });
    }
    const entries = (await readRows(d, MODULE, CONTACT_KIND, asImportantContact)).sort((a, b) => a.id - b.id);
    const mine = entries.filter((c) => { const cid = c.data?.contactId ?? (isInt(c.raw.contactId) ? c.raw.contactId : null); return cid !== null && ids.has(cid); });
    if (!mine.length) return out;
    // The member's name is the member's Contact's name (nothing is copied into Family), read only for the members these entries are for.
    const byId = new Map(members.map((m) => [m.id, m]));
    const memberContactIds = [...new Set(mine.flatMap((c) => { const m = c.data ? byId.get(c.data.memberId) : undefined; return m?.data ? [m.data.contactId] : []; }))];
    const names = new Map<number, string>();
    for (const row of await d.contacts.bulkGet(memberContactIds)) if (row && isLive(row)) names.set(row.id as number, row.name);
    for (const c of mine) {
      const cid = (c.data?.contactId ?? c.raw.contactId) as number;
      if (!c.data) {
        out.push({ contactId: cid, module: 'family', kind: 'contact', recordId: String(c.id), role: 'important', title: 'Important contact (needs review)', relation: 'An important-contact entry points at this contact, but part of it could not be read', status: 'Needs review' });
        continue;
      }
      const m = byId.get(c.data.memberId);
      const who = m?.data ? names.get(m.data.contactId) : undefined;
      const archived = c.data.status === 'archived';
      out.push({
        contactId: cid, module: 'family', kind: 'contact', recordId: String(c.id), role: 'important', title: c.data.purpose,
        relation: `Important contact${who ? ` for ${who}` : ' for a household member'}`,
        ...(m ? { href: memberHref(m.id) } : {}),
        status: archived ? 'Removed from the member’s list' : 'Active',
        ...(archived ? { inactive: true } : { facet: 'important' as const }),
      });
    }
    return out;
  },
};
