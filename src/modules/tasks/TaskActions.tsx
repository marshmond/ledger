import { useState } from 'react';
import type { RecordId } from '../../core/entities';
import { createTaskFrom } from '../../core/taskBridge';
import { todayISO } from '../../lib/money';
import { useToast } from '../../ui/Toast';
import { completeTask, reopenTask } from './data';
import { useLinkedTasks } from './linked';

/**
 * A small "Add task" action plus an open-task count for any record, so a page in another module can offer both with one line:
 * `<TaskActions module="ledger" id="account:12" label="Test checking" />`. Clicking the count shows the tasks; clicking one opens it.
 */
export default function TaskActions({ module, id, label, title }: { module: string; id: RecordId; label: string; title?: string }) {
  const tasks = useLinkedTasks(module, id);
  const [open, setOpen] = useState(false);
  const toast = useToast();
  /** Mark done right here, without leaving the page. Undo puts it back (and removes a repeat's untouched next copy). */
  const finish = async (taskId: number, name: string) => {
    await completeTask(taskId, todayISO());
    toast(`Done: ${name}`, () => reopenTask(taskId));
  };
  return (
    <span className="tk-actions">
      {tasks.length > 0 && (
        <span className="tk-linked">
          <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)} title="Open tasks about this">
            ✓ {tasks.length} task{tasks.length === 1 ? '' : 's'}
          </button>
          {open && (
            <span className="tk-linked-list" role="list">
              {tasks.map((t) => (
                <span key={t.id} role="listitem" className="tk-linked-item">
                  <button type="button" className="tk-check" role="checkbox" aria-checked="false" aria-label={`Mark done: ${t.data.title}`} onClick={() => void finish(t.id, t.data.title)} />
                  <a href={`#/tasks?task=${t.id}`}>{t.data.title}</a>
                </span>
              ))}
            </span>
          )}
        </span>
      )}
      <button type="button" className="link" onClick={() => createTaskFrom(module, { id, label, title })}>Add task</button>
    </span>
  );
}
