/**
 * "Create a task from anywhere." Any module calls `createTaskFrom(module, record)`; the app opens a small prefilled quick-task form
 * (title from the record, a link back to it, `createdFrom` set). The form itself lives in the Tasks module and is mounted once for
 * the whole app, so Ledger and the Calendar never import Tasks code: they only send a request through here.
 */
import type { RecordId } from './entities';

export interface TaskRequest {
  /** Text to start the title with. */
  title?: string;
  /** Suggested due date, 'YYYY-MM-DD'. */
  dueDate?: string;
  notes?: string;
  /** The record the task is about. Optional: a task made from the Calendar's day has none. */
  from?: { module: string; id: RecordId; label: string };
}

const EVENT = 'ledger-create-task';

/** Opens the quick-task form prefilled for a record: `createTaskFrom('ledger', { id: 'account:12', label: 'Test checking' })`. */
export function createTaskFrom(module: string, record: { id: RecordId; label: string; title?: string; dueDate?: string; notes?: string }) {
  requestTask({ title: record.title ?? record.label, dueDate: record.dueDate, notes: record.notes, from: { module, id: record.id, label: record.label } });
}

/** Opens the quick-task form with no record behind it. */
export function requestTask(req: TaskRequest = {}) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<TaskRequest>(EVENT, { detail: req }));
}

export function onTaskRequest(fn: (req: TaskRequest) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<TaskRequest>).detail ?? {});
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}
