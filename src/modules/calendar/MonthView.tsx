import { addDays } from '../../lib/dates';
import { Chip } from './parts';
import { onDay, type CalItem } from './useCalendarData';
import { WEEKDAYS_SHORT } from './time';

const MAX_CHIPS = 3;

/** The first day shown for a month grid: the start of the week that holds the 1st. */
export function monthGridStart(month: string, weekStart: number): string {
  const first = `${month}-01`;
  const dow = new Date(first + 'T00:00:00Z').getUTCDay();
  return addDays(first, -((dow - weekStart + 7) % 7));
}

/** Six weeks starting on the first day of the week that holds the 1st of the month. */
export default function MonthView({ month, weekStart, today, items, onCreate, onOpenDay, onOpenItem }: {
  month: string; weekStart: number; today: string; items: CalItem[];
  onCreate: (date: string) => void; onOpenDay: (date: string) => void; onOpenItem: (i: CalItem) => void;
}) {
  const start = monthGridStart(month, weekStart);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const heads = Array.from({ length: 7 }, (_, i) => WEEKDAYS_SHORT[(weekStart + i) % 7]);
  return (
    <div className="cal-month" role="grid" aria-label="Month">
      <div className="cal-month-head" role="row">{heads.map((h) => <div key={h} role="columnheader">{h}</div>)}</div>
      <div className="cal-month-grid">
        {days.map((d) => {
          const list = onDay(items, d);
          const shown = list.slice(0, MAX_CHIPS);
          const more = list.length - shown.length;
          const out = d.slice(0, 7) !== month;
          return (
            <div
              key={d}
              role="gridcell"
              className={`cal-cell ${out ? 'out' : ''} ${d === today ? 'today' : ''}`}
              onClick={() => onCreate(d)}
              aria-label={`${d}${list.length ? `, ${list.length} item${list.length === 1 ? '' : 's'}` : ''}`}
            >
              <button type="button" className="cal-daynum" onClick={(e) => { e.stopPropagation(); onOpenDay(d); }} aria-label={`Open ${d}`}>
                {Number(d.slice(8, 10))}
              </button>
              <div className="cal-chips">
                {shown.map((i) => <Chip key={i.key} item={i} onOpen={onOpenItem} />)}
                {more > 0 && <button type="button" className="cal-more" onClick={(e) => { e.stopPropagation(); onOpenDay(d); }}>+{more} more</button>}
              </div>
              {/* Phones: the cell is small, so show coloured dots; tap the day to see the list. */}
              {list.length > 0 && (
                <div className="cal-dots" aria-hidden="true">
                  {list.slice(0, 4).map((i) => <span key={i.key} className={`cal-dot p-${i.priority} ${i.derived ? 'derived' : ''}`} style={{ background: i.color }} />)}
                  {list.length > 4 && <span className="cal-dots-more">+</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
