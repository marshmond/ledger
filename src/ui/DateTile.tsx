import { dateTileModel, inlineDateText } from './dateTileModel';

/**
 * A calendar-page style date: weekday, big day number, month (D6 shared component; not yet placed on any screen).
 *
 * Purely presentational. It does not read the clock, so the caller passes `today` (the app's `todayISO()`), and it does not decide overdue or
 * special: the caller passes `overdue` / `special` from the module's own rules. Colour only reinforces; the full date is hidden text inside the tile
 * (so a screen reader says "Wednesday, November 11, 2026, today"), and `caption` can print a word such as "Overdue" on the tile itself.
 * When the row beside the tile already prints the date in words, pass `labelled={false}` so it is not read twice.
 */
export function DateTile({ iso, today, overdue, special, size = 'md', caption, labelled = true, className = '' }: {
  iso: string;
  today: string;
  overdue?: boolean;
  special?: boolean;
  size?: 'md' | 'sm';
  /** A short visible word under the month, for example "Overdue". */
  caption?: string;
  labelled?: boolean;
  className?: string;
}) {
  const m = dateTileModel(iso, today, { overdue, special });
  if (!m) return null;
  const spoken = `${m.fullLabel}${!caption && m.relative ? `, ${m.relative.toLowerCase()}` : ''}${overdue ? ', overdue' : ''}`;
  return (
    <time dateTime={m.iso} className={`ui-dtile ui-dtile--${m.tone}${size === 'sm' ? ' ui-dtile--sm' : ''} ${className}`.trim()} aria-hidden={labelled ? undefined : true}>
      {labelled && <span className="sr-only">{spoken}</span>}
      <span className="ui-dtile-wd" aria-hidden="true">{m.weekday}</span>
      <span className="ui-dtile-day" aria-hidden="true">{m.day}</span>
      <span className="ui-dtile-mo" aria-hidden="true">{m.month}</span>
      {caption && <span className="ui-dtile-cap">{caption}</span>}
    </time>
  );
}

/** The same date for dense lists: "Wed, Nov 11". The weekday is bold. Today and overdue only change the tone; the words stay. */
export function DateInline({ iso, today, overdue, className = '' }: { iso: string; today: string; overdue?: boolean; className?: string }) {
  const text = inlineDateText(iso, today);
  const m = dateTileModel(iso, today, { overdue });
  if (!text || !m) return null;
  const [wd, rest] = [text.slice(0, 3), text.slice(3)];
  const tone = m.tone === 'overdue' ? ' ui-dinline--overdue' : m.tone === 'today' ? ' ui-dinline--today' : '';
  return (
    <time dateTime={m.iso} className={`ui-dinline${tone} ${className}`.trim()}>
      <b>{wd}</b>{rest}
      {overdue && <span className="sr-only"> (overdue)</span>}
    </time>
  );
}
