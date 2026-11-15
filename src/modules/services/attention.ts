/**
 * Household Services for "Needs you" (R1.1). READ ONLY. This is the Today card's own set of conditions (`attentionCounts` in views.ts), item by item instead of
 * counted: finished visits not logged, arrangements whose schedule needs a check, possible duplicate visit records, visits with a status this version does not
 * understand, and contract renewal and notice dates in the next 30 days. The same readers decide each one (`buildOverview`, `unloggedVisits`,
 * `duplicateGroups`, `contractDeadlines`), so an item here exists exactly when the card counts it. No provider name, phone number, note, link or amount is used:
 * only the arrangement's or visit's own title.
 */
import { addDays } from '../../lib/dates';
import { attentionPlural as plural, daysFrom, type AttentionItem } from '../../core/attention';
import { liveAttention } from '../../core/liveAttention';
import { contractDeadlines, DEADLINE_LABEL } from './contract';
import { arrangementRoute, visitRoute } from './paths';
import { buildOverview, loadSnapshot, type Snapshot } from './views';

const MODULE = 'services';
const WHERE = 'Household Services';
/** The same 30-day window the Today card counts contract dates in. */
export const CONTRACT_DAYS = 30;
const at = (route: string) => `#/services${route}`;

export function servicesAttentionItems(s: Snapshot, today: string): AttentionItem[] {
  const ov = buildOverview(s);
  const out: AttentionItem[] = [];
  const titleOf = (arrangementId: number) => s.arrangements.find((a) => a.id === arrangementId)?.data.title ?? 'A household service';

  for (const u of ov.unlogged) {
    out.push({
      id: `${MODULE}:task:${u.task.id}:unlogged`, moduleId: MODULE, recordId: `task:${u.task.id}`, condition: `task:${u.task.id}:visit-unlogged`, kind: 'review', date: u.finishedOn || null,
      title: titleOf(u.arrangementId), reason: `A completed visit has not been logged${u.finishedOn ? ` (finished ${u.finishedOn})` : ''}.`,
      href: at(arrangementRoute(u.arrangementId)), provenance: `${WHERE}: finished visits not logged`,
    });
  }
  for (const r of ov.rows) {
    if (!r.health.needsAttention) continue;
    out.push({
      id: `${MODULE}:arrangement:${r.a.id}:schedule`, moduleId: MODULE, recordId: `arrangement:${r.a.id}`, condition: null, kind: 'review', date: null,
      title: r.a.data.title, reason: `The schedule needs a check: ${r.health.message.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase())}.`,
      href: at(arrangementRoute(r.a.id)), provenance: `${WHERE}: schedule checks`,
    });
  }
  for (const g of ov.duplicates.filter((d) => d.reason !== 'lookalike')) {
    out.push({
      id: `${MODULE}:visits:${g.key}:duplicate`, moduleId: MODULE, recordId: `visit:${g.visits[0].id}`, condition: null, kind: 'review', date: null,
      title: g.visits[0].data.title, reason: 'These visit records may describe the same visit. Nothing was merged.',
      href: at(visitRoute(g.visits[0].id)), provenance: `${WHERE}: possible duplicate visits`,
    });
  }
  for (const v of ov.needsReview) {
    out.push({
      id: `${MODULE}:visit:${v.id}:status`, moduleId: MODULE, recordId: `visit:${v.id}`, condition: null, kind: 'review', date: null,
      title: v.data.title, reason: 'This visit has a status this version of Ledger does not understand.',
      href: at(visitRoute(v.id)), provenance: `${WHERE}: visits to review`,
    });
  }
  const last = addDays(today, CONTRACT_DAYS);
  for (const d of contractDeadlines(s.arrangements)) {
    if (d.date < today || d.date > last) continue;
    const days = daysFrom(d.date, today);
    out.push({
      id: `${MODULE}:arrangement:${d.arrangementId}:${d.kind}`, moduleId: MODULE, recordId: `arrangement:${d.arrangementId}`, condition: null, kind: 'deadline', date: d.date,
      title: d.title,
      reason: d.kind === 'renewal' ? `The agreement renews on ${d.date}, ${days === 0 ? 'today' : `in ${plural(days, 'day')}`}.` : `The last day to act or give notice is ${d.date}, ${days === 0 ? 'today' : `in ${plural(days, 'day')}`}.`,
      href: at(arrangementRoute(d.arrangementId)), provenance: `${WHERE}: ${DEADLINE_LABEL[d.kind].toLowerCase()}s in the next ${CONTRACT_DAYS} days`,
    });
  }
  return out;
}

export async function readServicesAttention(today: string): Promise<AttentionItem[]> {
  return servicesAttentionItems(await loadSnapshot(), today);
}

export const servicesAttention = liveAttention(MODULE, readServicesAttention);
