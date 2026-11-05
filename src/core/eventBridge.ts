/**
 * "Create an event from anywhere." Any module calls `requestEvent({ title, date })`; the app opens the Add box on its Event
 * destination with that text filled in, so the preview ("Will add: ...") is shown before anything is saved. The Calendar owns the
 * parser and the saving; callers never import Calendar code (same idea as `requestTask` for tasks).
 */
import { openAddBox } from './globalEvents';

export interface EventRequest {
  /** Text to start with; it may carry shorthand ("lunch fri 12-1pm"). */
  title?: string;
  /** Suggested day, 'YYYY-MM-DD'. Added to the end of the text (a day typed inside the text wins). */
  date?: string;
}

export function requestEvent(req: EventRequest = {}) {
  const text = [req.title ?? '', req.date ?? ''].join(' ').trim();
  openAddBox({ dest: 'event', text });
}
