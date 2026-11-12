import { useEffect, useRef } from 'react';
import { addDays, monthLabel } from '../../lib/dates';
import { cellModel, dayButtonName, dayTone, gridWeeks, moveSelection, weekdayHeads } from './calendarModel';
import { Chip } from './parts';
import type { CalItem } from './useCalendarData';

/** The first day shown for a month grid: the start of the week that holds the 1st. */
export function monthGridStart(month: string, weekStart: number): string {
  const first = `${month}-01`;
  const dow = new Date(first + 'T00:00:00Z').getUTCDay();
  return addDays(first, -((dow - weekStart + 7) % 7));
}

/**
 * Six weeks starting on the first day of the week that holds the 1st of the month (D13 redesign of the same grid).
 *
 * Two different days are marked, and neither relies on colour alone: TODAY is the real current date (a filled number and the word "Today"
 * in the cell, "today" in the spoken name); the SELECTED day is the one the owner is looking at (the `d` of the address: a heavier frame,
 * `aria-selected`). One day number button per cell is the single Tab stop of the grid (roving); arrow keys, Home/End and PageUp/PageDown move
 * the selection (see `moveSelection`). Clicking a cell selects it; double-clicking an empty part of a cell starts a new event for that date (a
 * single click used to start one, which on a phone created events by accident; the selected-day list has Add event with the date filled in).
 * Items listed in a cell are reached with Tab only in the selected cell, because the selected day's list shows every item with its own button:
 * nothing is hidden, and Tab is not 42 cells of chips long.
 */
export default function MonthView({ month, selected, weekStart, today, items, onSelect, onCreate, onOpenItem }: {
  month: string; selected: string; weekStart: number; today: string; items: CalItem[];
  onSelect: (date: string) => void; onCreate: (date: string) => void; onOpenItem: (i: CalItem) => void;
}) {
  const weeks = gridWeeks(monthGridStart(month, weekStart));
  const heads = weekdayHeads(weekStart);
  const root = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);

  // After a key moves the selection the grid redraws; put focus on the new day's number so the keyboard keeps going.
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    root.current?.querySelector<HTMLElement>(`[data-date="${selected}"] .cal-daynum`)?.focus();
  }, [selected]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (!t.classList?.contains('cal-daynum')) return;
    const from = t.closest<HTMLElement>('[data-date]')?.dataset.date;
    if (!from) return;
    const to = moveSelection(from, e.key, weekStart, e.shiftKey);
    if (!to) return;
    e.preventDefault();
    refocus.current = true;
    onSelect(to);
  };

  return (
    <div className="cal-month" role="grid" aria-label={`${monthLabel(month)} calendar`} ref={root} onKeyDown={onKeyDown}>
      <div className="cal-month-head" role="row">
        {heads.map((h) => <div key={h.long} role="columnheader" aria-label={h.long}><span aria-hidden="true">{h.short}</span></div>)}
      </div>
      <div className="cal-month-body">
        {weeks.map((week) => (
          <div className="cal-week" role="row" key={week[0]}>
            {week.map((d) => {
              const c = cellModel(d, { month, today, selected, items });
              return (
                <div
                  key={d}
                  role="gridcell"
                  data-date={d}
                  aria-selected={c.isSelected}
                  aria-current={c.isToday ? 'date' : undefined}
                  className={`cal-cell tone-${dayTone(c)}${c.isSelected ? ' selected' : ''}${c.isWeekend ? ' weekend' : ''}${c.isOut ? ' out' : ''}${c.isToday ? ' today' : ''}`}
                  onClick={() => onSelect(d)}
                  onDoubleClick={() => onCreate(d)}
                >
                  <div className="cal-cell-head">
                    <button type="button" className="cal-daynum" tabIndex={c.isSelected ? 0 : -1} aria-label={dayButtonName(d, today, c.count)} onClick={(e) => { e.stopPropagation(); onSelect(d); }}>
                      <span aria-hidden="true">{c.day}</span>
                    </button>
                    {c.isToday && <span className="cal-today-tag" aria-hidden="true">Today</span>}
                    {c.day === 1 && !c.isToday && <span className="cal-month-tag" aria-hidden="true">{new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}</span>}
                  </div>
                  <div className="cal-chips">
                    {c.shown.map((i) => <Chip key={i.key} item={i} onOpen={onOpenItem} tabIndex={c.isSelected ? 0 : -1} />)}
                    {c.more > 0 && <button type="button" className="cal-more" tabIndex={c.isSelected ? 0 : -1} onClick={(e) => { e.stopPropagation(); onSelect(d); }}>+{c.more} more</button>}
                  </div>
                  {/* Phones: the cell is small, so show coloured dots (shape still marks automatic items); the day's full list sits under the grid. */}
                  {c.count > 0 && (
                    <div className="cal-dots" aria-hidden="true">
                      {c.dots.map((i) => <span key={i.key} className={`cal-dot p-${i.priority} ${i.derived ? 'derived' : ''}`} style={{ background: i.color }} />)}
                      {c.count > 4 && <span className="cal-dots-more">+</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
