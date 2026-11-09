/**
 * Family Management F3: the Tasks and Projects that belong to a member. READ-ONLY: nothing is stored, copied, completed or written, and no Task or
 * Project record is made or changed. A Task or Project that stops naming the member's Contact simply stops being listed (that is correct: it is no
 * longer about them), and there is no second association to keep in step.
 *
 *  - TASKS: a Task "is for" a member when its `contactIds` contains the member's Contact id (the Tasks "People" box). Which are open, which are
 *    overdue and the order all come from Tasks' own functions (`isOpen`, `isOverdue`, `sortTasks`). A repeating Task is ONE record that Tasks moves on
 *    when it is completed, so the member sees the current one and never a copy.
 *  - PROJECTS: the only explicit person-to-project link Ledger has is the project's "Vendors and people" list (`vendorContactIds`, shared Contacts).
 *    A project is listed only when that list names the member's Contact. It is never guessed from a title, and never derived from a Task's project.
 */
import { db, type FinanceDB } from '../../db';
import { loadProjects } from '../projects/data';
import { OPEN_STATUSES, STATUS_LABEL, type ProjectRecord } from '../projects/model';
import { isLive } from '../../core/store';
import { asTask, MODULE as TASKS_MODULE } from '../tasks/model';
import type { TaskRecord } from '../tasks/model';
import { isOpen, isOverdue, sortTasks } from '../tasks/views';

export interface MemberTasks {
  /** Open Tasks that name the Contact, in Tasks' own "due date" order (overdue first, then soonest, undated last). */
  tasks: TaskRecord[];
  overdue: number;
}

/** Pure: the open Tasks for a Contact. */
export function memberTasks(all: readonly TaskRecord[], contactId: number, today: string): MemberTasks {
  const mine = all.filter((t) => isOpen(t) && t.data.contactIds.includes(contactId));
  return { tasks: sortTasks(mine, 'due'), overdue: mine.filter((t) => isOverdue(t, today)).length };
}

/** The live Tasks, read one row at a time with Tasks' own parser (`asTask`): a row it cannot parse is skipped instead of stopping the page. Nothing is written. */
async function readTasks(d: FinanceDB): Promise<TaskRecord[]> {
  const out: TaskRecord[] = [];
  for (const r of await d.moduleRecords.where('[module+kind]').equals([TASKS_MODULE, 'task']).toArray()) {
    if (!isLive(r)) continue;
    try { out.push(asTask(r)); } catch { /* unreadable row: not listed */ }
  }
  return out;
}

export async function readMemberTasks(contactId: number, today: string, d: FinanceDB = db): Promise<MemberTasks> {
  return memberTasks(await readTasks(d), contactId, today);
}

/** The task's date in words for a row: the due date (with its time), else its "do on" date, else nothing. */
export function taskWhen(t: TaskRecord): { label: 'Due' | 'Do on'; date: string; time: string | null } | null {
  if (t.data.dueDate) return { label: 'Due', date: t.data.dueDate, time: t.data.dueTime };
  if (t.data.startDate) return { label: 'Do on', date: t.data.startDate, time: null };
  return null;
}

export interface MemberProjects {
  /** Planning, active or on hold, not archived. */
  open: ProjectRecord[];
  /** Completed or cancelled, not archived. */
  finished: ProjectRecord[];
  archived: ProjectRecord[];
}

/** Pure: the projects whose "Vendors and people" list names the Contact. Each group is in name order. */
export function memberProjects(all: readonly ProjectRecord[], contactId: number): MemberProjects {
  const mine = all.filter((p) => p.data.vendorContactIds.includes(contactId)).sort((a, b) => a.data.name.localeCompare(b.data.name) || a.id - b.id);
  return {
    open: mine.filter((p) => !p.data.archived && OPEN_STATUSES.includes(p.data.status)),
    finished: mine.filter((p) => !p.data.archived && !OPEN_STATUSES.includes(p.data.status)),
    archived: mine.filter((p) => p.data.archived),
  };
}

export async function readMemberProjects(contactId: number, d: FinanceDB = db): Promise<MemberProjects> {
  return memberProjects(await loadProjects(d), contactId);
}

export const projectStatusText = (p: ProjectRecord) => `${STATUS_LABEL[p.data.status]}${p.data.archived ? ' · Archived' : ''}`;
