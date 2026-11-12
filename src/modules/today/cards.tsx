import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { TodayCardDef, TodayCardProps } from '../../core/registry';
import { dayLabel } from '../../core/time';
import { addDays } from '../../lib/dates';
import { DateTile } from '../../ui/DateTile';
import { Icon } from '../../ui/icons';
import { useMediaQuery } from '../../ui/useMediaQuery';
import { limitOverdue, overdueGroups, overdueMorePath, reminderItems, todayList, upcomingDays, dayHeading, type UpcomingDay } from './logic';
import { moduleName, useTodayData } from './TodayData';
import { DayStrip } from './TodayHero';
import { PHONE_QUERY, moreText, previewDays, showAllLabel, stripCells } from './todayModel';
import { TodayRow } from './TodayRow';

const Loading = () => <p className="muted td-msg">Loading…</p>;

/** Tells the screen whether a card has nothing to show (a card marked hideWhenEmpty then disappears). */
function useReportEmpty(empty: boolean, report: (e: boolean) => void) {
  useEffect(() => { report(empty); }, [empty, report]);
}

/**
 * D13.1: the four agenda cards are one open column of sections (see composition.ts), so each is a `card td-card`: a head line with a hairline under it, then
 * full-width rows. Their ids, titles, accessible names, links, empty texts and the lists they draw (logic.ts) are exactly the D11 ones.
 */
function AgendaCard({ today, hideAmounts, reportEmpty }: TodayCardProps) {
  const { items } = useTodayData();
  const list = useMemo(() => (items ? todayList(items, today) : []), [items, today]);
  useReportEmpty(!!items && list.length === 0, reportEmpty);
  const quiet = !!items && list.length === 0;
  return (
    <section className={`card td-card${quiet ? ' td-card--quiet' : ''}`} aria-label="Today">
      <div className="card-head"><h2 className="card-title">Today</h2>{list.length > 0 && <span className="badge">{list.length}</span>}<a className="card-link" href="#/calendar?v=agenda">Calendar</a></div>
      {!items ? <Loading /> : list.length === 0
        ? <p className="muted td-msg">Nothing scheduled for today.</p>
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
    <section className="card td-card td-card--overdue" aria-label="Overdue">
      <div className="card-head"><h2 className="card-title">Overdue</h2>{total > 0 && <span className="badge badge--overdue">{total}</span>}</div>
      {!items ? <Loading /> : (
        <>
          {total === 0 && <p className="muted td-msg">Nothing overdue in the last {overdueDays} days.</p>}
          {shown.map((g) => (
            <div key={g.moduleId} className="td-group">
              {/* One strip per module: its name and how many overdue items it has in all (the list below may show fewer when "Overdue lists up to" is lower). */}
              <h3><span>{moduleName(g.moduleId)}</span><span className="td-group-count">{groups.find((x) => x.moduleId === g.moduleId)?.items.length ?? g.items.length}</span></h3>
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

/**
 * The days of Coming up, drawn from an already-computed `days` list (the value `upcomingDays` returns; nothing is recounted here). On a PHONE, while collapsed, only the
 * first three populated days are drawn (each whole) and one button reveals the rest; on a computer every day is always drawn. Drawn from props only, so a test can render
 * it with invented days. The phone and expanded states are chosen by the caller.
 */
export function UpcomingAgenda({ days, today, hideAmounts, phone, expanded, onToggle }: {
  days: UpcomingDay[]; today: string; hideAmounts: boolean; phone: boolean; expanded: boolean; onToggle: () => void;
}) {
  const listId = useId();
  const preview = useMemo(() => previewDays(days), [days]);
  const canCollapse = phone && preview.hidden.length > 0;
  const collapsed = canCollapse && !expanded;
  const drawn = collapsed ? preview.shown : days;
  const revealedFrom = preview.shown.length; // the first day that only "Show all" draws (focus goes to its first row)
  return (
    <>
      <div id={listId}>
        {drawn.map((d, di) => (
          // One date tile per day (a weekday and day number you can scan), then that day's rows. The words of the old heading stay as a hidden h3 for headings navigation and the tile speaks the full date.
          <div key={d.date} className="td-day" data-day={d.date} data-revealed={canCollapse && expanded && di === revealedFrom ? 'first' : undefined}>
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
      </div>
      {canCollapse && (
        <button type="button" className="td-more" aria-expanded={expanded} aria-controls={listId} onClick={onToggle}>
          <span className="td-more-text">
            <strong>{expanded ? 'Show fewer' : showAllLabel(preview.totalItems)}</strong>
            <span className="td-more-sub">{expanded ? `Back to the first ${preview.shown.length} days` : moreText(preview)}</span>
          </span>
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={18} />
        </button>
      )}
      {/* Said once when the state changes (the button itself keeps focus, or focus moves to the first revealed row). */}
      <span className="sr-only" role="status">{canCollapse ? (expanded ? `Showing all ${preview.totalItems} items` : '') : ''}</span>
    </>
  );
}

function UpcomingCard({ today, hideAmounts, reportEmpty }: TodayCardProps) {
  const { items, lookAheadDays } = useTodayData();
  const days = useMemo(() => (items ? upcomingDays(items, today, lookAheadDays) : []), [items, today, lookAheadDays]);
  useReportEmpty(!!items && days.length === 0, reportEmpty);
  const phone = useMediaQuery(PHONE_QUERY);
  // Not saved anywhere: every visit to Today starts compact on a phone.
  const [expanded, setExpanded] = useState(false);
  const section = useRef<HTMLElement>(null);
  const focusReveal = useRef(false);
  useEffect(() => {
    if (!focusReveal.current) return;
    focusReveal.current = false;
    if (expanded) section.current?.querySelector<HTMLElement>('[data-revealed="first"] .td-title')?.focus();
  }, [expanded]);
  return (
    <section ref={section} className="card td-card" aria-label="Coming up">
      <div className="card-head"><h2 className="card-title">Coming up</h2><span className="muted td-head-note">next {lookAheadDays} days</span></div>
      {!items ? <Loading /> : days.length === 0
        ? <p className="muted td-msg">Nothing in the next {lookAheadDays} days.</p>
        : (
          <>
            <DayStrip cells={stripCells(days, today, lookAheadDays)} />
            <UpcomingAgenda days={days} today={today} hideAmounts={hideAmounts} phone={phone} expanded={expanded} onToggle={() => { focusReveal.current = !expanded; setExpanded(!expanded); }} />
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
    <section className="card td-card" aria-label="Reminders due">
      <div className="card-head"><h2 className="card-title">Reminders due</h2>{list.length > 0 && <span className="badge">{list.length}</span>}</div>
      {!items ? <Loading /> : list.length === 0
        ? <p className="muted td-msg">No reminders are due right now.</p>
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
