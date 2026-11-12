import { useMemo } from 'react';
import { Icon } from '../../ui/icons';
import { whenLabel } from '../calendar/parts';
import { maskAmounts } from './logic';
import { moduleName, useTodayData } from './TodayData';
import { nextWhen, rangeText, summarizeToday, type StripCell, type TodaySummary } from './todayModel';
import { openItem, openLabel } from './TodayRow';

/**
 * D11: the top of Today. A "Next up" bar and one status band, both drawn from the lists the cards already use (see todayModel.ts), so they
 * add no rule and no number of their own. They are not dashboard cards: they are not in the card list, the saved layout or Edit layout, and
 * they hold no money, so Hide amounts has nothing to mask except an item's own words (a title can mention an amount; it is masked here
 * exactly as the rows below mask it). While the data is loading they draw nothing (the cards below say "Loading…").
 */
export function TodayHero({ today, hideAmounts }: { today: string; hideAmounts: boolean }) {
  const { items, overdueDays, lookAheadDays } = useTodayData();
  const s = useMemo(() => (items ? summarizeToday(items, today, overdueDays, lookAheadDays) : null), [items, today, overdueDays, lookAheadDays]);
  return s ? <TodayHeroView s={s} today={today} hideAmounts={hideAmounts} overdueDays={overdueDays} lookAheadDays={lookAheadDays} /> : null;
}

/** The drawing alone, from an already-computed summary (so a test can draw it with invented items). */
export function TodayHeroView({ s, today, hideAmounts, overdueDays, lookAheadDays }: { s: TodaySummary; today: string; hideAmounts: boolean; overdueDays: number; lookAheadDays: number }) {
  const mask = (t: string) => (hideAmounts ? maskAmounts(t) : t);
  const next = s.next;
  const where = next ? [next.layerName, next.location].filter(Boolean).join(' · ') : '';
  const range = rangeText(s.upcomingFrom, s.upcomingTo);
  return (
    <section className="td-hero" aria-label="Today at a glance">
      <div className="td-next">
        <div className="td-next-now">
          <Icon name={s.todayCount ? 'calendar' : 'check'} size={22} />
          <div>
            <strong>{s.todayCount ? `${s.todayCount} on today's schedule` : 'Nothing scheduled for today'}</strong>
            <span className="td-next-sub">{s.todayCount > 0 ? 'Listed under Today below' : 'No events or due items today'}</span>
          </div>
        </div>
        <div className="td-next-item">
          {/* D13.1: Next up is the first row of Coming up, which starts TOMORROW, so when today still has items the label says so (the words are added only then). Selection is unchanged. */}
          <span className="td-next-label">Next up{s.todayCount > 0 && next ? <span className="td-next-qual"> · after today</span> : null}</span>
          {next ? (
            <>
              <div className="td-next-body">
                <strong className="td-next-title">{mask(next.title)}</strong>
                <span className="td-next-when">{nextWhen(next.firstDay, today)} · {whenLabel(next)}{where ? ` · ${mask(where)}` : ''}</span>
              </div>
              <button type="button" className="td-next-btn" onClick={() => openItem(next)}>{openLabel(next)}</button>
            </>
          ) : (
            <span className="td-next-when">Nothing in the next {lookAheadDays} days</span>
          )}
        </div>
      </div>

      <ul className="td-band" aria-label="Status">
        <li className={`td-stat ${s.overdueTotal > 0 ? 'td-stat--overdue' : ''}`}>
          <span className="td-stat-label"><Icon name={s.overdueTotal > 0 ? 'alert' : 'check'} size={14} /> Overdue</span>
          <span className="td-stat-num">{s.overdueTotal}</span>
          <span className="td-stat-sub">{s.overdueTotal > 0 ? s.overdueParts.map((p) => `${moduleName(p.moduleId)} ${p.count}`).join(' · ') : `Nothing overdue in the last ${overdueDays} days`}</span>
        </li>
        <li className="td-stat">
          <span className="td-stat-label"><Icon name="calendar" size={14} /> Today</span>
          <span className="td-stat-num">{s.todayCount}</span>
          <span className="td-stat-sub">{s.todayCount === 1 ? 'item scheduled' : 'items scheduled'}</span>
        </li>
        <li className="td-stat">
          <span className="td-stat-label"><Icon name="dot" size={14} /> Coming up</span>
          <span className="td-stat-num">{s.upcomingCount}</span>
          <span className="td-stat-sub">Next {lookAheadDays} days · {range}</span>
        </li>
      </ul>
    </section>
  );
}

/** A phone-only picture of the next days: a column per day with a dot for each item (up to three). The list below carries the same facts in words, so this is hidden from assistive technology. */
export function DayStrip({ cells }: { cells: StripCell[] }) {
  if (cells.length === 0) return null;
  return (
    <div className="td-strip" aria-hidden="true">
      {cells.map((c) => (
        <span key={c.date} className={`td-strip-cell td-strip-cell--${c.tone}`}>
          <span className="td-strip-wd">{c.weekday}</span>
          <span className="td-strip-day">{c.day}</span>
          <span className="td-strip-dots">{c.count === 0 ? <i className="td-dot td-dot--none" /> : Array.from({ length: Math.min(3, c.count) }, (_, k) => <i key={k} className="td-dot" />)}</span>
        </span>
      ))}
    </div>
  );
}
