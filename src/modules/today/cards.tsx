import { useEffect, useMemo } from 'react';
import type { TodayCardDef, TodayCardProps } from '../../core/registry';
import { dayLabel } from '../../core/time';
import { addDays } from '../../lib/dates';
import { DateTile } from '../../ui/DateTile';
import { limitOverdue, overdueGroups, overdueMorePath, reminderItems, todayList, upcomingDays, dayHeading } from './logic';
import { moduleName, useTodayData } from './TodayData';
import { DayStrip } from './TodayHero';
import { stripCells } from './todayModel';
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
      <div className="card-head"><h2 className="card-title">Today</h2><a className="card-link" href="#/calendar?v=agenda">Calendar</a></div>
      {!items ? <Loading /> : list.length === 0
        ? <p className="muted" style={{ margin: 0 }}>Nothing scheduled for today.</p>
        : <ul className="plain td-list">{list.map((i) => <TodayRow key={i.key} item={i} hideAmounts={hideAmounts} />)}</ul>}
    </section>
  );
}

function OverdueCard({ today, hideAmounts, reportEmpty }: TodayCardProps) {
  const { items, overdueDays, overdueRows, older } = useTodayData();
  const groups = useMemo(() => (items ? overdueGroups(items, today, overdueDays) : []), [items, today, overdueDays]);
  const total = groups.reduce((s, g) => s + g.items.length, 0);
  // The first rows are listed (the number is a setting); the rest are one link away in the module that holds them. The badge shows the true total.
  const { shown, more } = useMemo(() => limitOverdue(groups, overdueRows), [groups, overdueRows]);
  useReportEmpty(!!items && total === 0 && older.length === 0, reportEmpty);
  return (
    <section className="card" aria-label="Overdue">
      <div className="card-head"><h2 className="card-title">Overdue</h2>{total > 0 && <span className="badge">{total}</span>}</div>
      {!items ? <Loading /> : (
        <>
          {total === 0 && <p className="muted" style={{ margin: 0 }}>Nothing overdue in the last {overdueDays} days.</p>}
          {shown.map((g) => (
            <div key={g.moduleId} className="td-group">
              <h3>{moduleName(g.moduleId)}</h3>
              <ul className="plain td-list">{g.items.map((i) => <TodayRow key={i.key} item={i} hideAmounts={hideAmounts} tile={{ today, overdue: true }} />)}</ul>
            </div>
          ))}
          {more.length > 0 && (
            <p className="td-older">
              {more.map((m, k) => (
                <span key={m.moduleId}>{k > 0 && ' · '}<a href={`#${overdueMorePath(m.moduleId, today, overdueDays)}`}>Show {m.count} more overdue {m.count === 1 ? 'item' : 'items'} in {moduleName(m.moduleId)}</a></span>
              ))}
            </p>
          )}
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
      <div className="card-head"><h2 className="card-title">Coming up</h2><span className="muted">next {lookAheadDays} days</span></div>
      {!items ? <Loading /> : days.length === 0
        ? <p className="muted" style={{ margin: 0 }}>Nothing in the next {lookAheadDays} days.</p>
        : (
          <>
            <DayStrip cells={stripCells(days, today, lookAheadDays)} />
            {days.map((d) => (
              // D11: one date tile per day (a weekday and day number you can scan), then that day's rows. The words of the old heading stay as a hidden h3 for headings navigation and the tile speaks the full date.
              <div key={d.date} className="td-day">
                <div className="td-day-side" aria-hidden="true">
                  <DateTile iso={d.date} today={today} size="sm" labelled={false} />
                  {d.date === addDays(today, 1) && <span className="td-day-cap">Tomorrow</span>}
                </div>
                <div className="td-day-body">
                  <h3 className="sr-only">{dayHeading(d.date, today, (x) => dayLabel(x))}</h3>
                  <ul className="plain td-list">{d.items.map((i) => <TodayRow key={i.key} item={i} hideAmounts={hideAmounts} />)}</ul>
                </div>
              </div>
            ))}
          </>
        )}
    </section>
  );
}

function RemindersCard({ hideAmounts, reportEmpty }: TodayCardProps) {
  const { items } = useTodayData();
  const list = useMemo(() => (items ? reminderItems(items) : []), [items]);
  useReportEmpty(!!items && list.length === 0, reportEmpty);
  return (
    <section className="card" aria-label="Reminders due">
      <div className="card-head"><h2 className="card-title">Reminders due</h2>{list.length > 0 && <span className="badge">{list.length}</span>}</div>
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
