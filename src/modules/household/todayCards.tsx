import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { TodayCardDef, TodayCardProps } from '../../core/registry';
import { db, type FinanceDB } from '../../db';
import { loadHouseholdOverview, todayCounts, type TodayCounts } from './overview';

/**
 * "Household finances" on Today: counts only, read-only, hidden only after a SUCCESSFUL load with nothing to say; a failed read shows a discreet "could not be read" notice (never a zero). It says ONLY what the Bills and Household Services cards do not already say, because it needs
 * more than one module to see it: payments that may be recorded twice across modules, a bill and a service that may be one expense, and payments expected in the next
 * 30 days whose amount is not known. No name, no provider and no amount ever appears here, so Hide Amounts has nothing to hide. The numbers are the Overview's own.
 */
/** What the card knows: still loading, a read failed ('unavailable', no counts invented), or the Overview's own counts (which may all be zero). */
export type TodayState = undefined | 'unavailable' | TodayCounts;
const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
export function todayRows(c: TodayCounts): { id: string; text: string }[] {
  const rows: { id: string; text: string }[] = [];
  if (c.possibleDuplicates) rows.push({ id: 'dup', text: `${n(c.possibleDuplicates, 'payment may be', 'payments may be')} recorded twice across modules` });
  if (c.overlaps) rows.push({ id: 'overlap', text: `${n(c.overlaps, 'bill and service may', 'bills and services may')} describe the same expense` });
  if (c.unknownSoon) rows.push({ id: 'unknown', text: `${n(c.unknownSoon, 'expected payment has', 'expected payments have')} no known amount in the next 30 days` });
  return rows;
}
/** The pure view: loading, unavailable (a discreet notice and a link, never a zero), or the counts (hidden by the caller when there are none). */
export function HouseholdCardView({ state }: { state: TodayState }) {
  const label = 'Household finances needing attention';
  if (state === undefined) return <section className="card" aria-label={label}><div className="card-head"><strong>Household finances</strong></div><p className="muted" style={{ margin: 0 }}>Loading…</p></section>;
  if (state === 'unavailable') return <section className="card" aria-label={label}><div className="card-head"><strong>Household finances</strong><a className="card-link" href="#/household">Open</a></div><p className="muted" role="status" style={{ margin: 0 }}>Household figures could not be read just now, so nothing is shown. <a href="#/household">Look at the page</a>.</p></section>;
  const rows = todayRows(state);
  return (
    <section className="card" aria-label={label}>
      <div className="card-head"><strong>Household finances</strong>{rows.length > 0 && <span className="badge">{rows.length}</span>}<a className="card-link" href="#/household">Open</a></div>
      <ul className="plain td-list">{rows.map((r) => <li key={r.id} className="td-proj"><a href="#/household">{r.text}</a></li>)}</ul>
    </section>
  );
}

/** One read. A failure is reported as 'unavailable' (never as zero counts). */
export async function loadTodayState(today: string, d: FinanceDB = db): Promise<TodayState> {
  try { return todayCounts(await loadHouseholdOverview('all', today, d)); } catch { return 'unavailable'; }
}

function HouseholdCard({ today, reportEmpty }: TodayCardProps) {
  const state = useLiveQuery<TodayState>(() => loadTodayState(today), [today]);
  const quiet = state !== undefined && state !== 'unavailable' && todayRows(state).length === 0;
  useEffect(() => { reportEmpty(quiet); }, [quiet, reportEmpty]);
  return <HouseholdCardView state={state} />;
}

export const HOUSEHOLD_TODAY_CARDS: TodayCardDef[] = [
  { id: 'household.attention', title: 'Household finances', defaultWidth: 'half', priority: 38, hideWhenEmpty: true, Component: HouseholdCard },
];
