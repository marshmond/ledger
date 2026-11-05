import type { Priority } from '../core/entities';
import { PRIORITY_ICON, PRIORITY_LABEL } from '../core/priority';

/** Priority as a shape plus a word for screen readers, so it never relies on colour alone. */
export function PriorityMark({ priority }: { priority: Priority }) {
  return (
    <span className={`cal-prio p-${priority}`} title={`${PRIORITY_LABEL[priority]} priority`}>
      <span aria-hidden="true">{PRIORITY_ICON[priority]}</span>
      <span className="sr-only">{PRIORITY_LABEL[priority]} priority</span>
    </span>
  );
}
