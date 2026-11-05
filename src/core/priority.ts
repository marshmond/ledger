import type { Priority } from './entities';

/** Priority names and symbols shared by Tasks, Calendar and Today. (Moved here from the Calendar; the Calendar still re-exports them.) */
export const PRIORITIES: Priority[] = ['high', 'medium', 'low', 'reminder'];
export const PRIORITY_LABEL: Record<Priority, string> = { high: 'High', medium: 'Medium', low: 'Low', reminder: 'Reminder' };
/** A shape as well as a colour, so priority never depends on colour alone. */
export const PRIORITY_ICON: Record<Priority, string> = { high: '▲', medium: '◆', low: '▽', reminder: '○' };
