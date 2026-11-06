import type { CSSProperties } from 'react';
import { PriorityMark } from '../../ui/PriorityMark';

export { PriorityMark };
import type { CalItem } from './useCalendarData';
import { timeLabel } from './time';

export const itemClass = (i: CalItem) =>
  `cal-chip p-${i.priority} ${i.derived ? 'derived' : ''} ${i.done ? 'done' : ''} ${i.overdue ? 'overdue' : ''} ${i.soon ? 'soon' : ''}`;
export const colorStyle = (i: CalItem): CSSProperties => ({ ['--chip' as string]: i.color });

/** Small text flags: overdue / due soon / done. */
export function Flags({ item }: { item: CalItem }) {
  return (
    <>
      {item.overdue && <span className="cal-flag bad">Overdue</span>}
      {item.soon && <span className="cal-flag warn" title="A reminder time has passed">Due soon</span>}
      {item.done && !item.derived && <span className="cal-flag ok">Done</span>}
    </>
  );
}

export const whenLabel = (i: CalItem) => (i.allDay ? 'All day' : `${timeLabel(i.startMs)}`);

export function Chip({ item, onOpen, showTime = true }: { item: CalItem; onOpen: (i: CalItem) => void; showTime?: boolean }) {
  return (
    <button
      type="button"
      className={itemClass(item)}
      style={colorStyle(item)}
      onClick={(e) => { e.stopPropagation(); onOpen(item); }}
      title={`${item.title}${item.allDay ? '' : ' · ' + timeLabel(item.startMs)} · ${item.layerName}${item.project ? ' · Project: ' + item.project.label : ''}`}
    >
      <PriorityMark priority={item.priority} />
      {showTime && !item.allDay && <span className="cal-chip-time">{timeLabel(item.startMs).replace(/ ?[AP]M$/i, (m) => m.trim().toLowerCase().slice(0, 1))}</span>}
      <span className="cal-chip-title">{item.title}</span>
      {item.project && <span className="cal-chip-proj" aria-label={`Project: ${item.project.label}`}>◇</span>}
      {item.overdue && <span className="cal-chip-mark" aria-label="Overdue">!</span>}
    </button>
  );
}
