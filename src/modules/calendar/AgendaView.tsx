import { addDays } from '../../lib/dates';
import { Flags, PriorityMark, colorStyle, itemClass, whenLabel } from './parts';
import { onDay, type CalItem } from './useCalendarData';
import { dayLabel } from './time';

/** One row in a list: when, priority, title, which calendar, where. */
export function AgendaRow({ item, onOpen }: { item: CalItem; onOpen: (i: CalItem) => void }) {
  return (
    <li>
      <button type="button" className={`cal-row ${itemClass(item).replace('cal-chip', '')}`} style={colorStyle(item)} onClick={() => onOpen(item)}>
        <span className="cal-row-when">{whenLabel(item)}</span>
        <span className="cal-row-dot" aria-hidden="true" />
        <span className="cal-row-main">
          <span className="cal-row-title"><PriorityMark priority={item.priority} /> {item.title}</span>
          <span className="cal-row-sub">
            {item.layerName}{item.location ? ` · ${item.location}` : ''}{item.recurring ? ' · repeats' : ''}{item.project ? <span className="cal-proj" title="Project"> · ◇ {item.project.label}</span> : null} <Flags item={item} />
          </span>
        </span>
      </button>
    </li>
  );
}

/** A chronological list grouped by day, with an Overdue section on top for things past due that are still open. */
export default function AgendaView({ from, days, today, items, onOpenItem, onCreate }: {
  from: string; days: number; today: string; items: CalItem[];
  onOpenItem: (i: CalItem) => void; onCreate: (date: string) => void;
}) {
  const to = addDays(from, days - 1);
  const overdue = items
    .filter((i) => i.overdue && i.lastDay < today)
    .sort((a, b) => a.firstDay.localeCompare(b.firstDay) || a.title.localeCompare(b.title));
  const dates = Array.from({ length: days }, (_, k) => addDays(from, k));
  const groups = dates.map((d) => ({ d, list: onDay(items, d).filter((i) => !(i.overdue && i.lastDay < today)) })).filter((g) => g.list.length > 0);
  return (
    <div className="cal-agenda">
      {overdue.length > 0 && (
        <section className="cal-ag-day overdue-section" aria-label="Overdue">
          <h3>Overdue <span className="muted">· {overdue.length}</span></h3>
          <ul className="plain">
            {overdue.map((i) => (
              <li key={i.key}>
                <button type="button" className={`cal-row ${itemClass(i).replace('cal-chip', '')}`} style={colorStyle(i)} onClick={() => onOpenItem(i)}>
                  <span className="cal-row-when">{dayLabel(i.firstDay)}</span>
                  <span className="cal-row-dot" aria-hidden="true" />
                  <span className="cal-row-main">
                    <span className="cal-row-title"><PriorityMark priority={i.priority} /> {i.title}</span>
                    <span className="cal-row-sub">{i.layerName}{i.project ? <span className="cal-proj"> · ◇ {i.project.label}</span> : null}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {groups.length === 0 && <p className="muted cal-empty">Nothing on the calendar from {dayLabel(from, { year: true })} to {dayLabel(to, { year: true })}. <button className="link" onClick={() => onCreate(from > today ? from : today)}>Add an event</button></p>}
      {groups.map(({ d, list }) => (
        <section key={d} className={`cal-ag-day ${d === today ? 'today' : ''}`} aria-label={dayLabel(d, { weekday: 'long', year: true })}>
          <h3>{dayLabel(d, { weekday: 'long' })}{d === today && <span className="badge scheduled">Today</span>}</h3>
          <ul className="plain">{list.map((i) => <AgendaRow key={i.key} item={i} onOpen={onOpenItem} />)}</ul>
        </section>
      ))}
    </div>
  );
}
