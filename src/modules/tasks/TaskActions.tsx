import { useState } from 'react';
import type { RecordId } from '../../core/entities';
import { createTaskFrom } from '../../core/taskBridge';
import { useLinkedTasks } from './linked';

/**
 * A small "Add task" action plus an open-task count for any record, so a page in another module can offer both with one line:
 * `<TaskActions module="ledger" id="account:12" label="Test checking" />`. Clicking the count shows the tasks; clicking one opens it.
 */
export default function TaskActions({ module, id, label, title }: { module: string; id: RecordId; label: string; title?: string }) {
  const tasks = useLinkedTasks(module, id);
  const [open, setOpen] = useState(false);
  return (
    <span className="tk-actions">
      {tasks.length > 0 && (
        <span className="tk-linked">
          <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)} title="Open tasks about this">
            ✓ {tasks.length} task{tasks.length === 1 ? '' : 's'}
          </button>
          {open && (
            <span className="tk-linked-list" role="list">
              {tasks.map((t) => <a key={t.id} role="listitem" href={`#/tasks?task=${t.id}`}>{t.data.title}</a>)}
            </span>
          )}
        </span>
      )}
      <button type="button" className="link" onClick={() => createTaskFrom(module, { id, label, title })}>Add task</button>
    </span>
  );
}
