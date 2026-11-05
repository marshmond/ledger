import type { CSSProperties } from 'react';
import { goTo } from '../../core/dueProvider';
import { useToast } from '../../ui/Toast';
import { markOccurrenceDone } from '../calendar/data';
import { Flags, PriorityMark, whenLabel } from '../calendar/parts';
import type { CalItem } from '../calendar/useCalendarData';
import { maskAmounts } from './logic';

/** Opens an item in the module that owns it. Navigation only: Today never changes money. */
export function openItem(item: CalItem): void {
  if (item.derived && item.source) item.source.openSource();
  else goTo(`/calendar?v=agenda&d=${item.firstDay}&open=${encodeURIComponent(item.key)}`);
}

/** The words for "go to the source", e.g. "Edit in Ledger". */
export const openLabel = (item: CalItem) => (item.derived ? item.source?.sourceLabel ?? 'Open' : 'Edit in Calendar');

/**
 * One line on the Today screen, the same everywhere: a bar in the calendar's colour, the priority mark, the title, when it is, and either
 * a check button (tasks, and events you chose to keep until done) or an "Edit in <module>" button. Money items never have a money
 * action here; they only open in Ledger.
 */
export function TodayRow({ item, hideAmounts, when }: { item: CalItem; hideAmounts: boolean; when?: string }) {
  const toast = useToast();
  const title = hideAmounts ? maskAmounts(item.title) : item.title;
  const complete = item.source?.actions?.complete;
  const reopen = item.source?.actions?.reopen;
  const canCheck = !item.done && (!!complete || !!item.occ?.trackDone);

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
    <li className={`td-row p-${item.priority} ${item.done ? 'done' : ''}`} style={{ ['--chip' as string]: item.color } as CSSProperties}>
      <span className="td-bar" aria-hidden="true" />
      <span className="td-when">{when ?? whenLabel(item)}</span>
      <span className="td-main">
        <button type="button" className="td-title" onClick={() => openItem(item)}><PriorityMark priority={item.priority} /> {title}</button>
        <span className="td-sub">{item.layerName}{item.location ? ` · ${item.location}` : ''} <Flags item={item} /></span>
      </span>
      <span className="td-act">
        {canCheck
          ? <button type="button" className="td-check" aria-label={`Mark done: ${title}`} title="Mark done" onClick={check}><span aria-hidden="true">✓</span></button>
          : <button type="button" className="link" onClick={() => openItem(item)}>{openLabel(item)}</button>}
      </span>
    </li>
  );
}
