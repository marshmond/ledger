import type { CSSProperties } from 'react';
import { goTo } from '../../core/dueProvider';
import { DateTile } from '../../ui/DateTile';
import { Icon } from '../../ui/icons';
import { StatusChip } from '../../ui/StatusChip';
import { useToast } from '../../ui/Toast';
import { markOccurrenceDone } from '../calendar/data';
import { PriorityMark, whenLabel } from '../calendar/parts';
import type { CalItem } from '../calendar/useCalendarData';
import { maskAmounts, moduleOf } from './logic';
import { kindIcon } from './todayModel';

/** Opens an item in the module that owns it. Navigation only: Today never changes money. */
export function openItem(item: CalItem): void {
  if (item.derived && item.source) item.source.openSource();
  else goTo(`/calendar?v=agenda&d=${item.firstDay}&open=${encodeURIComponent(item.key)}`);
}

/** The words for "go to the source", e.g. "Edit in Ledger". */
export const openLabel = (item: CalItem) => (item.derived ? item.source?.sourceLabel ?? 'Open' : 'Edit in Calendar');

/**
 * One line on the Today screen, the same everywhere: the time (or, in Overdue, a date tile), a small kind icon, the priority mark and title, a status chip,
 * the source line, and either a check button (tasks, and events you chose to keep until done) or an "Edit in <module>" button. Money items never have a
 * money action here; they only open in Ledger. D13.1 replaced the colored bar with the kind icon; the calendar color is still carried by the icon's tint.
 */
export function TodayRow({ item, hideAmounts, when, tile }: { item: CalItem; hideAmounts: boolean; when?: string; tile?: { today: string; overdue?: boolean } }) {
  const toast = useToast();
  const title = hideAmounts ? maskAmounts(item.title) : item.title;
  const complete = item.source?.actions?.complete;
  const reopen = item.source?.actions?.reopen;
  const canCheck = !item.done && (!!complete || !!item.occ?.trackDone);
  const icon = kindIcon(moduleOf(item));

  async function check() {
    try {
      if (complete) {
        await complete();
        toast(`Done: ${title}`, reopen ? () => reopen() : undefined);
      } else if (item.occ) {
        const occ = item.occ;
        await markOccurrenceDone(occ, true);
        toast(`Done: ${title}`, () => markOccurrenceDone(occ, false));
      }
    } catch {
      toast('Could not mark that done. Open it and try again.');
    }
  }

  return (
    <li className={`td-row p-${item.priority} ${item.done ? 'done' : ''} ${tile ? 'td-row--tile' : ''}`} style={{ ['--chip' as string]: item.color } as CSSProperties}>
      {tile
        ? <DateTile iso={item.firstDay} today={tile.today} overdue={tile.overdue} size="sm" className="td-tile" />
        : <span className="td-when">{when ?? whenLabel(item)}</span>}
      {!tile && <span className="td-kind" aria-hidden="true"><Icon name={icon} size={16} /></span>}
      <span className="td-main">
        <span className="td-line">
          <button type="button" className="td-title" onClick={() => openItem(item)}><PriorityMark priority={item.priority} /> {title}</button>
          {item.overdue && <StatusChip tone="overdue">Overdue</StatusChip>}
          {item.soon && <StatusChip tone="warning" title="A reminder time has passed">Due soon</StatusChip>}
          {item.done && !item.derived && <StatusChip tone="done">Done</StatusChip>}
        </span>
        <span className="td-sub">
          {tile && <span className="td-sub-kind" aria-hidden="true"><Icon name={icon} size={13} /></span>}
          {item.layerName}{item.location ? ` · ${item.location}` : ''}
        </span>
      </span>
      <span className="td-act">
        {canCheck
          ? <button type="button" className="td-check" aria-label={`Mark done: ${title}`} title="Mark done" onClick={check}><span aria-hidden="true">✓</span></button>
          : <button type="button" className="link td-open" onClick={() => openItem(item)}>{openLabel(item)}</button>}
      </span>
    </li>
  );
}
