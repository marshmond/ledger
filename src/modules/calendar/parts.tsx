import type { CSSProperties } from 'react';
import type { Priority } from '../../core/entities';
import { PRIORITY_ICON, PRIORITY_LABEL } from './model';
import type { CalItem } from './useCalendarData';
import { timeLabel } from './time';

/** Priority as a shape plus a word for screen readers, so it never relies on colour alone. */
export function PriorityMark({ priority }: { priority: Priority }) {
  return (
    <span className={`cal-prio p-${priority}`} title={`${PRIORITY_LABEL[priority]} priority`}>
      <span aria-hidden="true">{PRIORITY_ICON[priority]}</span>
      <span className="sr-only">{PRIORITY_LABEL[priority]} priority</span>
    </span>
  );
}

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
      title={`${item.title}${item.allDay ? '' : ' · ' + timeLabel(item.startMs)} · ${item.layerName}`}
    >
      <PriorityMark priority={item.priority} />
      {showTime && !item.allDay && <span className="cal-chip-time">{timeLabel(item.startMs).replace(/ ?[AP]M$/i, (m) => m.trim().toLowerCase().slice(0, 1))}</span>}
      <span className="cal-chip-title">{item.title}</span>
      {item.overdue && <span className="cal-chip-mark" aria-label="Overdue">!</span>}
    </button>
  );
}
