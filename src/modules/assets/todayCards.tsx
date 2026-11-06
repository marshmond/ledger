import { useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { TodayCardDef, TodayCardProps } from '../../core/registry';
import { attentionRows } from './overviewText';
import { loadOverview } from './overviewData';

/**
 * "Home & Assets" on Today: counts only, each with a link into the module. No money, no names of assets, and no serial numbers, plates,
 * addresses or links. It never lists the overdue maintenance tasks themselves, because Tasks and the Calendar already put those on Today;
 * the warranty dates are on the Calendar through the Home & Assets layer. The card is hidden when there is nothing to look at.
 * Every number comes from `loadOverview`, the same reader the Overview page uses.
 */
function AssetsCard({ today, reportEmpty }: TodayCardProps) {
  const ov = useLiveQuery(() => loadOverview('all', today), [today]);
  const rows = useMemo(() => (ov ? attentionRows(ov.attention) : []), [ov]);
  useEffect(() => { reportEmpty(!!ov && rows.length === 0); }, [ov, rows.length, reportEmpty]);
  return (
    <section className="card" aria-label="Home and assets needing attention">
      <div className="card-head"><strong>Home &amp; Assets</strong>{rows.length > 0 && <span className="badge">{rows.length}</span>}<a className="card-link" href="#/assets">Overview</a></div>
      {!ov ? <p className="muted" style={{ margin: 0 }}>Loading…</p> : (
        <ul className="plain td-list">
          {rows.map((r) => (
            <li key={r.id} className="td-proj">
              <a href={r.href}>{r.text}</a>
              {r.hint && <span className="muted small">{r.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export const ASSETS_TODAY_CARDS: TodayCardDef[] = [
  { id: 'assets.attention', title: 'Home & Assets', defaultWidth: 'half', priority: 38, hideWhenEmpty: true, Component: AssetsCard },
];
