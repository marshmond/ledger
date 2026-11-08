import { useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { TodayCardDef, TodayCardProps } from '../../core/registry';
import { attentionCounts, loadSnapshot, type AttentionCounts } from './views';

export interface AttentionRow { id: string; text: string; href: string }

/**
 * Pure. The lines the card shows, from three counts. Words and numbers only: no provider names, phone numbers, notes, links, task titles
 * or amounts. It never lists the upcoming visit tasks themselves, because Tasks and the Calendar already put those on Today.
 */
export function attentionLines(c: AttentionCounts): AttentionRow[] {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const rows: AttentionRow[] = [];
  if (c.unlogged > 0) rows.push({ id: 'unlogged', text: `${plural(c.unlogged, 'finished visit is', 'finished visits are')} not yet logged`, href: '#/services' });
  if (c.duplicateGroups > 0) rows.push({ id: 'dup', text: `${plural(c.duplicateGroups, 'possible duplicate visit record needs', 'possible duplicate visit records need')} a look`, href: '#/services' });
  if (c.scheduleChecks > 0) rows.push({ id: 'sched', text: `${plural(c.scheduleChecks, 'arrangement needs', 'arrangements need')} a schedule check`, href: '#/services' });
  if (c.needsReview > 0) rows.push({ id: 'review', text: `${plural(c.needsReview, 'visit has', 'visits have')} a status this version does not understand`, href: '#/services' });
  // S4: contract deadlines. Two different things, counted separately even when they fall on the same day.
  if ((c.notices ?? 0) > 0) rows.push({ id: 'notice', text: `${plural(c.notices!, 'agreement notice deadline', 'agreement notice deadlines')} in the next 30 days`, href: '#/services' });
  if ((c.renewals ?? 0) > 0) rows.push({ id: 'renewal', text: `${plural(c.renewals!, 'renewal date', 'renewal dates')} in the next 30 days`, href: '#/services' });
  return rows;
}

/** "Household Services" on Today: counts only, read-only, hidden when there is nothing to look at. Money is never shown. */
function ServicesCard({ today, reportEmpty }: TodayCardProps) {
  const counts = useLiveQuery(async () => attentionCounts(await loadSnapshot(), today), [today]);
  const rows = useMemo(() => (counts ? attentionLines(counts) : []), [counts]);
  useEffect(() => { reportEmpty(!!counts && rows.length === 0); }, [counts, rows.length, reportEmpty]);
  return (
    <section className="card" aria-label="Household services needing attention">
      <div className="card-head"><h2 className="card-title">Household Services</h2>{rows.length > 0 && <span className="badge">{rows.length}</span>}<a className="card-link" href="#/services">Open</a></div>
      {!counts ? <p className="muted" style={{ margin: 0 }}>Loading…</p> : (
        <ul className="plain td-list">
          {rows.map((r) => <li key={r.id} className="td-proj"><a href={r.href}>{r.text}</a></li>)}
        </ul>
      )}
    </section>
  );
}

export const SERVICES_TODAY_CARDS: TodayCardDef[] = [
  { id: 'services.attention', title: 'Household Services', defaultWidth: 'half', priority: 39, hideWhenEmpty: true, Component: ServicesCard },
];
