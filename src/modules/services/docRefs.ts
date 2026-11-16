/**
 * R4.1 Records: Household Services' document references, read through the module's OWN loaders (`loadArrangements`, `loadVisits`). Two kinds of record keep a reference list: a standing
 * arrangement (a cleaner, lawn care) and a logged visit. Read only. No date is attached: an arrangement's renewal and notice dates belong to the agreement, not to one stored link, so they
 * stay on the arrangement page. No gap is reported: nothing in the arrangement or visit model says a document must exist.
 */
import { db, type FinanceDB } from '../../db';
import { makeRefs, type DocumentRead, type DocumentRef } from '../../core/documentRefs';
import { dayLabel } from '../../core/time';
import { loadArrangements } from './data';
import { MODULE, STATUS_LABEL } from './model';
import { arrangementPath, visitPath } from './records';
import { loadVisits } from './visits';

export const SOURCE_LABEL = 'Household Services';

export async function readServiceDocs(_ctx?: unknown, d: FinanceDB = db): Promise<DocumentRead> {
  const [arrangements, visits] = await Promise.all([loadArrangements(d), loadVisits(d)]);
  const refs: DocumentRef[] = [];
  const byId = new Map(arrangements.map((a) => [a.id, a]));

  for (const a of arrangements) {
    refs.push(...makeRefs({
      moduleId: MODULE, sourceLabel: SOURCE_LABEL, ownerKey: `arrangement:${a.id}`, ownerName: a.data.title, recordKind: 'Arrangement',
      context: a.data.providerNameSnapshot, status: a.data.status !== 'active' ? STATUS_LABEL[a.data.status] : '',
      recordPath: arrangementPath(a.id), recordAction: 'View arrangement',
    }, a.data.refs));
  }

  for (const v of visits) {
    const parent = v.data.arrangementId !== null ? byId.get(v.data.arrangementId) : undefined;
    refs.push(...makeRefs({
      moduleId: MODULE, sourceLabel: SOURCE_LABEL, ownerKey: `visit:${v.id}`, ownerName: parent ? parent.data.title : v.data.title, recordKind: 'Visit',
      recordName: parent && parent.data.title !== v.data.title ? v.data.title : '',
      context: [v.data.date ? dayLabel(v.data.date, { year: true }) : '', v.data.providerNameSnapshot].filter(Boolean).join(' · '),
      recordPath: visitPath(v.id), recordAction: 'View visit',
    }, v.data.refs));
  }
  return { refs, gaps: [] };
}
