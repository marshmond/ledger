import { db } from '../../db';
import type { RecordChoice, RecordSource } from '../../core/registry';
import { goTo } from '../../core/dueProvider';
import { parseVisitRef } from './visitModel';
import { getVisit } from './visits';
import { arrangementRefId, parseArrangementRef, STATUS_LABEL, type ArrangementRecord } from './model';
import { getArrangement, loadArrangements } from './data';

export const arrangementPath = (id: number) => `/services/a/${id}`;
export const visitPath = (id: number) => `/services/v/${id}`;
export const providerPath = (contactId: number) => `/services/providers/${contactId}`;
/** "House cleaning, Rosa's Cleaning (paused)". Title, provider name and status only; never contact details, notes, links or amounts. */
export const arrangementLabel = (a: ArrangementRecord) =>
  `${a.data.title}${a.data.providerNameSnapshot ? `, ${a.data.providerNameSnapshot}` : ''}${a.data.status !== 'active' ? ` (${STATUS_LABEL[a.data.status].toLowerCase()})` : ''}`;

/** Lets Tasks, Calendar events and others link to an arrangement and show it by name. Ids are text: `arrangement:<n>`. */
export const serviceRecords: RecordSource = {
  async search(text) {
    const q = text.trim().toLowerCase();
    const rows = (await loadArrangements(db)).filter((a) => !q || arrangementLabel(a).toLowerCase().includes(q));
    rows.sort((a, b) => Number(a.data.status === 'ended') - Number(b.data.status === 'ended') || a.data.title.localeCompare(b.data.title));
    return rows.slice(0, 30).map<RecordChoice>((a) => ({ id: arrangementRefId(a.id), label: arrangementLabel(a), kind: 'Service' }));
  },
  async describe(id) {
    const vn = parseVisitRef(id);
    if (vn !== null) {
      const v = await getVisit(vn, db);
      return v ? { label: `${v.data.title}${v.data.providerNameSnapshot ? `, ${v.data.providerNameSnapshot}` : ''}`, kind: 'Visit', path: visitPath(v.id) } : null;
    }
    const n = parseArrangementRef(id);
    const a = n === null ? undefined : await getArrangement(n, db);
    return a ? { label: arrangementLabel(a), kind: 'Service', path: arrangementPath(a.id) } : null;
  },
  async openSource(id) {
    const info = await serviceRecords.describe(id);
    if (!info) return false;
    goTo(info.path);
    return true;
  },
};
