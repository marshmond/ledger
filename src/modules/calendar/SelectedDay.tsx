import { DateTile } from '../../ui/DateTile';
import { AgendaRow } from './AgendaView';
import { fullDate, itemCountWords, relativeWord } from './calendarModel';
import { onDay, type CalItem } from './useCalendarData';

/** Every item on one day in the day's own order, each a button that opens it. The one list the month's selected-day area and the day dialog share. */
export function DayItems({ date, items, onOpenItem, emptyText = 'Nothing on this day.' }: { date: string; items: CalItem[]; onOpenItem: (i: CalItem) => void; emptyText?: string }) {
  const list = onDay(items, date);
  if (list.length === 0) return <p className="muted cal-day-empty">{emptyText}</p>;
  return <ul className="plain cal-daylist">{list.map((i) => <AgendaRow key={i.key} item={i} onOpen={onOpenItem} />)}</ul>;
}

/**
 * The month view's selected day (D13): the date the owner picked, in full, with every item on it and the two ways to add one with that date filled in.
 * It replaces the pop-up the day number used to open for the month view; the pop-up (`DayPanel`) is still what the week views open from a day heading.
 * Nothing here decides what is listed: it is `onDay` over the same visible items the grid draws, so the list and the cell cannot disagree.
 */
export default function SelectedDay({ date, today, items, onOpenItem, onAdd, onAddTask }: {
  date: string; today: string; items: CalItem[];
  onOpenItem: (i: CalItem) => void; onAdd: (date: string) => void; onAddTask: (date: string) => void;
}) {
  const list = onDay(items, date);
  const rel = relativeWord(date, today);
  return (
    <section className="cal-selected card" aria-labelledby="cal-sel-title">
      <header className="cal-selected-head">
        <DateTile iso={date} today={today} labelled={false} />
        <div className="cal-selected-text">
          <h2 id="cal-sel-title" className="cal-selected-title">{fullDate(date)}</h2>
          <p className="cal-selected-sub">
            {rel && <span className="ui-chip ui-chip--active">{rel}</span>}
            <span>{itemCountWords(list.length)}</span>
          </p>
        </div>
      </header>
      <DayItems date={date} items={items} onOpenItem={onOpenItem} emptyText="Nothing on this day. Use Add event to put something here." />
      <div className="row cal-selected-actions">
        <button type="button" className="btn primary" onClick={() => onAdd(date)}>Add event</button>
        <button type="button" className="btn" onClick={() => onAddTask(date)}>Add task</button>
      </div>
    </section>
  );
}
