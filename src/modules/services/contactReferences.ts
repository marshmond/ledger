/**
 * Contacts C2: where a Contact appears in Household Services. READ ONLY, by stored Contact id:
 *  - `arrangement.providerContactId` (the provider) and `arrangement.extraContactIds` (other people involved);
 *  - `visit.providerContactId` (the provider AT THE TIME of that visit).
 * The provider-name text saved on arrangements and visits is a historical snapshot, never a live Contact, so it is neither read nor shown here. An
 * arrangement is shown with its schedule in words; visits are listed one per record (the Contact page shows a short preview and a bounded full list).
 */
import { readRows, type ContactReference, type ContactReferenceProvider } from '../../core/contactReferences';
import { asArrangement, cadenceText, KIND, MODULE, STATUS_LABEL } from './model';
import { arrangementPath, visitPath } from './records';
import { asVisit } from './visitModel';

const VISIT_STATUS: Record<string, string> = { completed: 'Completed', skipped: 'Skipped', cancelled: 'Cancelled' };

export const servicesContactReferences: ContactReferenceProvider = {
  label: 'Household Services',
  async find({ ids, d }) {
    const out: ContactReference[] = [];
    for (const a of await readRows(d, MODULE, KIND, asArrangement)) {
      const ended = a.data.status === 'ended';
      const schedule = (() => { try { return cadenceText(a.data.cadence); } catch { return ''; } })();
      const base = {
        module: 'services', kind: 'arrangement', recordId: String(a.id), title: a.data.title.trim() || 'Untitled arrangement', href: arrangementPath(a.id),
        status: `${STATUS_LABEL[a.data.status]}${schedule ? `, ${schedule.charAt(0).toLowerCase()}${schedule.slice(1)}` : ''}`, ...(ended ? { inactive: true } : {}),
      };
      const p = a.data.providerContactId;
      if (p !== null && ids.has(p)) out.push({ ...base, contactId: p, role: 'provider', facet: 'provider', relation: 'Provider for this arrangement' });
      for (const cid of new Set(a.data.extraContactIds)) {
        if (ids.has(cid) && cid !== p) out.push({ ...base, contactId: cid, role: 'extra', relation: 'Also involved in this arrangement' });
      }
    }
    for (const v of await readRows(d, MODULE, 'visit', asVisit)) {
      const cid = v.data.providerContactId;
      if (cid === null || !ids.has(cid)) continue;
      out.push({
        contactId: cid, module: 'services', kind: 'visit', recordId: String(v.id), role: 'provider', facet: 'provider',
        title: v.data.title.trim() || 'Service visit', relation: 'Provider for this visit',
        href: visitPath(v.id), ...(v.data.date ? { date: v.data.date } : {}),
        status: VISIT_STATUS[String(v.data.status)] ?? 'Needs review',
      });
    }
    return out;
  },
};
