/**
 * Contacts C2: which Tasks list a Contact under People (`contactIds`). READ ONLY: reads the Task records through the Tasks reader and writes nothing. A Task
 * is found only by a stored Contact id, never by a name in its title. Repeating Tasks and completion keep the Tasks module's own meaning (this shows the
 * one stored Task, its own status and its own next due date; it creates nothing).
 */
import { readRows, type ContactReference, type ContactReferenceProvider } from '../../core/contactReferences';
import { asTask, MODULE, STATUS_LABEL } from './model';

export const tasksContactReferences: ContactReferenceProvider = {
  label: 'Tasks',
  async find({ ids, d }) {
    const out: ContactReference[] = [];
    for (const t of await readRows(d, MODULE, 'task', asTask)) {
      for (const cid of new Set(t.data.contactIds)) {
        if (!ids.has(cid)) continue;
        const done = t.data.status === 'done';
        out.push({
          contactId: cid, module: 'tasks', kind: 'task', recordId: String(t.id), role: 'person',
          title: t.data.title.trim() || 'Untitled task',
          relation: 'Listed under People on this task',
          href: `/tasks?task=${t.id}`,
          ...(t.data.dueDate ? { date: t.data.dueDate } : {}),
          status: `${STATUS_LABEL[t.data.status]}${t.data.repeat ? ', repeats' : ''}`,
          ...(done ? { inactive: true } : {}),
        });
      }
    }
    return out;
  },
};
