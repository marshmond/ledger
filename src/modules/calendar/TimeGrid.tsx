import { useEffect, useRef } from 'react';
import { addDays } from '../../lib/dates';
import { layoutDay, segmentOnDay } from './layout';
import { Chip, colorStyle, itemClass, PriorityMark } from './parts';
import { onDay, type CalItem } from './useCalendarData';
import { dayLabel, minutesOfDay, msAt, timeLabel, WEEKDAYS_SHORT } from './time';

const HOUR = 48; // pixels per hour
const SNAP = 30; // minutes

/** First day shown for a week view: the start of the week holding `date`. For a work week, the Monday of it. */
export function weekStartOf(date: string, weekStart: number): string {
  const dow = new Date(date + 'T00:00:00Z').getUTCDay();
  return addDays(date, -((dow - weekStart + 7) % 7));
}
/** Monday to Friday of the week (as laid out by the first-day-of-week setting) that holds the given date. */
export const workWeekDays = (date: string, weekStart: number): string[] => {
  const monday = addDays(weekStartOf(date, weekStart), (1 - weekStart + 7) % 7);
  return Array.from({ length: 5 }, (_, i) => addDays(monday, i));
};

/** Week and work-week: an all-day strip on top, then a time grid with overlapping items side by side and a "now" line. */
export default function TimeGrid({ days, today, now, items, onSlot, onOpenItem, onOpenDay }: {
  days: string[]; today: string; now: number; items: CalItem[];
  onSlot: (date: string, minutes: number) => void; onOpenItem: (i: CalItem) => void; onOpenDay: (date: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const first = days[0];
  // Start the view an hour before the current time (or at 7am for other weeks).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const nowMin = days.includes(today) ? minutesOfDay(Date.now()) : 8 * 60;
    el.scrollTop = Math.max(0, ((nowMin - 60) / 60) * HOUR);
  }, [first, days.length, today]); // eslint-disable-line react-hooks/exhaustive-deps

  const cols = `repeat(${days.length}, minmax(0, 1fr))`;
  return (
    <div className="cal-tg" role="grid" aria-label={days.length === 5 ? 'Work week' : 'Week'}>
      <div className="cal-tg-head">
        <div className="cal-tg-gutter" />
        <div className="cal-tg-cols" style={{ gridTemplateColumns: cols }}>
          {days.map((d) => (
            <button key={d} type="button" className={`cal-tg-day ${d === today ? 'today' : ''}`} onClick={() => onOpenDay(d)}>
              <span className="cal-tg-dow">{WEEKDAYS_SHORT[new Date(d + 'T00:00:00Z').getUTCDay()]}</span>
              <span className="cal-tg-date">{Number(d.slice(8, 10))}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="cal-tg-allday">
        <div className="cal-tg-gutter small">All day</div>
        <div className="cal-tg-cols" style={{ gridTemplateColumns: cols }}>
          {days.map((d) => (
            <div key={d} className="cal-tg-adcell" onClick={() => onOpenDay(d)}>
              {onDay(items, d).filter((i) => i.allDay).map((i) => <Chip key={i.key} item={i} onOpen={onOpenItem} />)}
            </div>
          ))}
        </div>
      </div>
      <div className="cal-tg-scroll" ref={scroller}>
        <div className="cal-tg-body" style={{ height: 24 * HOUR }}>
          <div className="cal-tg-gutter">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="cal-tg-hour" style={{ top: h * HOUR }}>{h === 0 ? '' : timeLabel(msAt('2026-01-01', h * 60)).replace(':00', '')}</div>
            ))}
          </div>
          <div className="cal-tg-cols" style={{ gridTemplateColumns: cols }}>
            {days.map((d) => {
              const segs = onDay(items, d)
                .filter((i) => !i.allDay)
                .map((i) => segmentOnDay(i, i.startMs, i.endMs, d))
                .filter((s): s is NonNullable<typeof s> => s !== null);
              const placed = layoutDay(segs);
              const nowMin = d === today ? minutesOfDay(now) : null;
              return (
                <div
                  key={d}
                  className={`cal-tg-col ${d === today ? 'today' : ''}`}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const minutes = Math.min(23 * 60 + 30, Math.floor((((e.clientY - rect.top) / HOUR) * 60) / SNAP) * SNAP);
                    onSlot(d, minutes);
                  }}
                  aria-label={dayLabel(d)}
                >
                  {Array.from({ length: 24 }, (_, h) => <div key={h} className="cal-tg-line" style={{ top: h * HOUR }} />)}
                  {placed.map((p) => {
                    const i = p.item;
                    return (
                      <button
                        key={i.key}
                        type="button"
                        className={`${itemClass(i)} cal-block`}
                        style={{ ...colorStyle(i), top: (p.start / 60) * HOUR, height: Math.max(18, ((p.end - p.start) / 60) * HOUR - 1), left: `${(p.col / p.cols) * 100}%`, width: `${100 / p.cols}%` }}
                        onClick={(e) => { e.stopPropagation(); onOpenItem(i); }}
                        title={`${i.title} · ${timeLabel(i.startMs)}–${timeLabel(i.endMs)} · ${i.layerName}`}
                      >
                        <span className="cal-block-title"><PriorityMark priority={i.priority} /> {i.title}</span>
                        <span className="cal-block-time">{timeLabel(i.startMs)}</span>
                      </button>
                    );
                  })}
                  {nowMin !== null && <div className="cal-now" style={{ top: (nowMin / 60) * HOUR }} aria-label="Current time"><span /></div>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
