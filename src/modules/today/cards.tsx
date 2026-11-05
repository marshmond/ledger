import { useEffect, useMemo } from 'react';
import type { TodayCardDef, TodayCardProps } from '../../core/registry';
import { dayLabel } from '../calendar/time';
import { overdueGroups, reminderItems, todayList, upcomingDays, dayHeading } from './logic';
import { moduleName, useTodayData } from './TodayData';
import { TodayRow } from './TodayRow';

const Loading = () => <p className="muted" style={{ margin: 0 }}>Loading…</p>;

/** Tells the screen whether a card has nothing to show (a card marked hideWhenEmpty then disappears). */
function useReportEmpty(empty: boolean, report: (e: boolean) => void) {
  useEffect(() => { report(empty); }, [empty, report]);
}

function AgendaCard({ today, hideAmounts, reportEmpty }: TodayCardProps) {
  const { items } = useTodayData();
  const list = useMemo(() => (items ? todayList(items, today) : []), [items, today]);
  useReportEmpty(!!items && list.length === 0, reportEmpty);
  return (
    <section className="card" aria-label="Today">
      <div className="card-head"><strong>Today</strong><a className="card-link" href="#/calendar?v=agenda">Calendar</a></div>
      {!items ? <Loading /> : list.length === 0
        ? <p className="muted" style={{ margin: 0 }}>Nothing scheduled for today.</p>
        : <ul className="plain td-list">{list.map((i) => <TodayRow key={i.key} item={i} hideAmounts={hideAmounts} />)}</ul>}
    </section>
  );
}

function OverdueCard({ today, hideAmounts, reportEmpty }: TodayCardProps) {
  const { items, overdueDays, older } = useTodayData();
  const groups = useMemo(() => (items ? overdueGroups(items, today, overdueDays) : []), [items, today, overdueDays]);
  const total = groups.reduce((s, g) => s + g.items.length, 0);
  useReportEmpty(!!items && total === 0 && older.length === 0, reportEmpty);
  return (
    <section className="card" aria-label="Overdue">
      <div className="card-head"><strong>Overdue</strong>{total > 0 && <span className="badge">{total}</span>}</div>
      {!items ? <Loading /> : (
        <>
          {total === 0 && <p className="muted" style={{ margin: 0 }}>Nothing overdue in the last {overdueDays} days.</p>}
          {groups.map((g) => (
            <div key={g.moduleId} className="td-group">
              <h3>{moduleName(g.moduleId)}</h3>
              <ul className="plain td-list">{g.items.map((i) => <TodayRow key={i.key} item={i} hideAmounts={hideAmounts} when={dayLabel(i.firstDay)} />)}</ul>
            </div>
          ))}
          {older.length > 0 && (
            <p className="td-older">
              {older.map((o, k) => (
                <span key={o.moduleId}>{k > 0 && ' · '}<a href={`#${o.path}`}>{o.count} older {o.count === 1 ? 'item' : 'items'} in {o.moduleName}</a></span>
              ))}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function UpcomingCard({ today, hideAmounts, reportEmpty }: TodayCardProps) {
  const { items, lookAheadDays } = useTodayData();
  const days = useMemo(() => (items ? upcomingDays(items, today, lookAheadDays) : []), [items, today, lookAheadDays]);
  useReportEmpty(!!items && days.length === 0, reportEmpty);
  return (
    <section className="card" aria-label="Coming up">
      <div className="card-head"><strong>Coming up</strong><span className="muted">next {lookAheadDays} days</span></div>
      {!items ? <Loading /> : days.length === 0
        ? <p className="muted" style={{ margin: 0 }}>Nothing in the next {lookAheadDays} days.</p>
        : days.map((d) => (
          <div key={d.date} className="td-group">
            <h3>{dayHeading(d.date, today, (x) => dayLabel(x))}</h3>
            <ul className="plain td-list">{d.items.map((i) => <TodayRow key={i.key} item={i} hideAmounts={hideAmounts} />)}</ul>
          </div>
        ))}
    </section>
  );
}

function RemindersCard({ hideAmounts, reportEmpty }: TodayCardProps) {
  const { items } = useTodayData();
  const list = useMemo(() => (items ? reminderItems(items) : []), [items]);
  useReportEmpty(!!items && list.length === 0, reportEmpty);
  return (
    <section className="card" aria-label="Reminders due">
      <div className="card-head"><strong>Reminders due</strong>{list.length > 0 && <span className="badge">{list.length}</span>}</div>
      {!items ? <Loading /> : list.length === 0
        ? <p className="muted" style={{ margin: 0 }}>No reminders are due right now.</p>
        : <ul className="plain td-list">{list.map((i) => <TodayRow key={i.key} item={i} hideAmounts={hideAmounts} />)}</ul>}
      <p className="muted td-note">Reminders show here and in the Calendar while this app is open. They do not send notifications.</p>
    </section>
  );
}

/** The cards the Today module itself offers (they read dated items from every module). Ledger offers its own: alerts and the cash outlook. */
export const TODAY_CARDS: TodayCardDef[] = [
  { id: 'today.agenda', title: 'Today', defaultWidth: 'full', priority: 10, Component: AgendaCard },
  { id: 'today.reminders', title: 'Reminders due', defaultWidth: 'half', priority: 15, hideWhenEmpty: true, Component: RemindersCard },
  { id: 'today.overdue', title: 'Overdue', defaultWidth: 'half', priority: 20, hideWhenEmpty: true, Component: OverdueCard },
  { id: 'today.upcoming', title: 'Coming up', defaultWidth: 'half', priority: 30, Component: UpcomingCard },
];
