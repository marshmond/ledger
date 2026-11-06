/**
 * The Tasks due provider: any open task with a due date (or a "do on" date) appears on the Calendar's Tasks layer, worked out when the
 * Calendar draws. Nothing is copied: tasks are stored records, so completing or rescheduling from the Calendar is a normal edit of
 * the task itself. Tasks without a date stay off the Calendar.
 */
import { db, type FinanceDB } from '../../db';
import { derivedId, goTo, type DerivedItem, type DueProvider, type DueQuery } from '../../core/dueProvider';
import { addDays } from '../../lib/dates';
import { todayISO } from '../../lib/money';
import { loadTasks, completeTask, reopenTask, saveTask, getTask } from './data';

export const TASKS_LAYER_COLOR = '#c0562f';

export async function taskDueItems(d: FinanceDB, q: DueQuery): Promise<DerivedItem[]> {
  const tasks = (await loadTasks(d)).filter((t) => t.data.status !== 'done');
  const oldest = addDays(q.today, -Math.max(0, q.overdueDays));
  const wanted = (date: string) => (date >= q.from && date <= q.to) || (q.overdueDays > 0 && date < q.today && date >= oldest);
  const out: DerivedItem[] = [];
  for (const t of tasks) {
    const base = {
      sourceModule: 'tasks', priority: t.data.priority, status: 'open' as const, detail: t.data.notes || undefined,
      openSource: () => goTo(`/tasks?task=${t.id}`), sourceLabel: 'Open task',
      projectId: t.data.projectId,
    };
    const move = (field: 'dueDate' | 'startDate') => async (date: string) => {
      const cur = await getTask(t.id, d);
      if (cur) await saveTask(t.id, { ...cur.data, [field]: date }, d);
    };
    const actions = (field: 'dueDate' | 'startDate') => ({
      complete: async () => { await completeTask(t.id, todayISO(), d); },
      reopen: () => reopenTask(t.id, d),
      reschedule: move(field),
    });
    if (t.data.dueDate && wanted(t.data.dueDate)) {
      out.push({ ...base, id: derivedId('tasks', t.id, t.data.dueDate), sourceRecordId: t.id, title: t.data.isMilestone ? `◆ ${t.data.title}` : t.data.title, date: t.data.dueDate, allDay: !t.data.dueTime, time: t.data.dueTime ?? undefined, actions: actions('dueDate') });
    }
    if (t.data.startDate && t.data.startDate !== t.data.dueDate && wanted(t.data.startDate)) {
      out.push({ ...base, id: derivedId('tasks', `${t.id}-start`, t.data.startDate), sourceRecordId: t.id, title: `Start: ${t.data.title}`, date: t.data.startDate, allDay: true, actions: actions('startDate') });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

export const tasksDueProvider: DueProvider = {
  id: 'tasks',
  layerName: 'Tasks',
  color: TASKS_LAYER_COLOR,
  getDueItems: (q) => taskDueItems(db, q),
  /** Open tasks due before the cutoff, for Today's "N older items" link to the Tasks Overdue view. */
  olderThan: async (cutoff) => {
    const count = (await loadTasks(db)).filter((t) => t.data.status !== 'done' && !!t.data.dueDate && t.data.dueDate < cutoff).length;
    return count > 0 ? { count, path: '/tasks?v=overdue' } : null;
  },
};
