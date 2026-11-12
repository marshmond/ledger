import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons';

/**
 * A small label for a status (D6 shared component; not yet placed on any screen).
 *
 * Purely presentational and independent of any module: the caller decides which status a record has and passes the words. The chip never decides
 * overdue, verified, complete or needs-attention. The words are always shown, and each tone also has its own icon shape, so a status is never
 * told by colour alone. The six tones map to the approved families: neutral, overdue (and errors), warning, done (completed and verified),
 * info, active (active and selected).
 */
export type StatusTone = 'neutral' | 'overdue' | 'warning' | 'done' | 'info' | 'active';

export const STATUS_TONES: StatusTone[] = ['neutral', 'overdue', 'warning', 'done', 'info', 'active'];

/** The icon each tone shows by default (neutral shows none). */
export const TONE_ICON: Record<StatusTone, IconName | null> = { neutral: null, overdue: 'alert', warning: 'warning', done: 'check', info: 'info', active: 'dot' };

/** The class list for a chip. Exported so tests (and any caller that cannot use the component) get the same names. */
export const statusChipClass = (tone: StatusTone = 'neutral') => (tone === 'neutral' ? 'ui-chip' : `ui-chip ui-chip--${tone}`);

export function StatusChip({ tone = 'neutral', children, icon = true, title }: {
  tone?: StatusTone;
  children: ReactNode;
  /** true: the tone's own icon; false: none; a name: that icon. */
  icon?: boolean | IconName;
  title?: string;
}) {
  const name = icon === false ? null : typeof icon === 'string' ? icon : TONE_ICON[tone];
  return (
    <span className={statusChipClass(tone)} title={title}>
      {name && <Icon name={name} size={12} />}
      {children}
    </span>
  );
}
