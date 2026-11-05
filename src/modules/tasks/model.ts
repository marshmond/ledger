/**
 * Task records. They live in the shared `moduleRecords` table (module 'tasks'), so backup, restore and device sync already cover them.
 * Two kinds: 'task' and 'list' (an optional one-level grouping such as "Renovation").
 */
import type { ModuleRecord, Priority, RecordId } from '../../core/entities';
import { normalizeRule, type Recurrence } from '../../core/recurrence';

export const MODULE = 'tasks';

export type TaskStatus = 'todo' | 'doing' | 'waiting' | 'done';
export const STATUSES: TaskStatus[] = ['todo', 'doing', 'waiting', 'done'];
export const STATUS_LABEL: Record<TaskStatus, string> = { todo: 'To do', doing: 'In progress', waiting: 'Waiting', done: 'Done' };

export interface ChecklistItem {
  id: number;
  text: string;
  done: boolean;
}

/** `fixed`: the next one is due on the schedule. `after`: the next one is due a set time after you finish this one. */
export interface TaskRepeat {
  mode: 'fixed' | 'after';
  rule: Recurrence;
}

export interface TaskData {
  title: string;
  notes: string;
  status: TaskStatus;
  priority: Priority;
  /** Local date 'YYYY-MM-DD' (no time zone), optionally with a local clock time 'HH:MM'. */
  dueDate: string | null;
  dueTime: string | null;
  /** "Do on" date: when you plan to work on it. */
  startDate: string | null;
  repeat: TaskRepeat | null;
  tagIds: number[];
  contactIds: number[];
  checklist: ChecklistItem[];
  listId: number | null;
  /** The record this task was made from (a Ledger account, a bill, ...). A link back is also stored in the shared Links. */
  createdFrom?: { module: string; id: RecordId; label: string };
  completedAt: number | null;
  /** For a task made automatically when a repeating task was completed: the one it came from. */
  recurFrom?: number;
}
export interface TaskRecord {
  id: number;
  createdAt: number;
  updatedAt: number;
  data: TaskData;
}
export interface TaskList {
  id: number;
  name: string;
}

/** Fields this reader understands. Anything else in a stored record (written by another module or a newer version) is carried through untouched. */
const TASK_KEYS = new Set(['title', 'notes', 'status', 'priority', 'dueDate', 'dueTime', 'startDate', 'repeat', 'tagIds', 'contactIds', 'checklist', 'listId', 'createdFrom', 'completedAt', 'recurFrom']);

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const nums = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []);

/** Reads a stored record defensively, so a record from another device or version can never crash a screen. */
export function asTask(r: ModuleRecord): TaskRecord {
  const d = r.data as Partial<TaskData>;
  const rule = d.repeat ? normalizeRule(d.repeat.rule) : null;
  const status: TaskStatus = STATUSES.includes(d.status as TaskStatus) ? (d.status as TaskStatus) : 'todo';
  return {
    id: r.id as number,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    data: {
      ...(Object.fromEntries(Object.entries(d).filter(([k, v]) => !TASK_KEYS.has(k) && v !== undefined)) as object),
      title: str(d.title, '(no title)'),
      notes: str(d.notes),
      status,
      priority: d.priority === 'high' || d.priority === 'low' || d.priority === 'reminder' ? d.priority : 'medium',
      dueDate: isDate(d.dueDate) ? d.dueDate : null,
      dueTime: isDate(d.dueDate) && /^\d{2}:\d{2}$/.test(str(d.dueTime)) ? str(d.dueTime) : null,
      startDate: isDate(d.startDate) ? d.startDate : null,
      repeat: rule && d.repeat ? { mode: d.repeat.mode === 'after' ? 'after' : 'fixed', rule } : null,
      tagIds: nums(d.tagIds),
      contactIds: nums(d.contactIds),
      checklist: Array.isArray(d.checklist) ? d.checklist.filter((c) => c && typeof c.text === 'string').map((c) => ({ id: Number(c.id) || 0, text: c.text, done: c.done === true })) : [],
      listId: typeof d.listId === 'number' ? d.listId : null,
      ...(d.createdFrom && typeof d.createdFrom.module === 'string' ? { createdFrom: { module: d.createdFrom.module, id: d.createdFrom.id, label: str(d.createdFrom.label) } } : {}),
      completedAt: typeof d.completedAt === 'number' ? d.completedAt : null,
      ...(typeof d.recurFrom === 'number' ? { recurFrom: d.recurFrom } : {}),
    },
  };
}

export function asList(r: ModuleRecord): TaskList {
  return { id: r.id as number, name: str((r.data as { name?: unknown }).name, 'List') };
}

export const blankTask = (over: Partial<TaskData> = {}): TaskData => ({
  title: '', notes: '', status: 'todo', priority: 'medium', dueDate: null, dueTime: null, startDate: null, repeat: null,
  tagIds: [], contactIds: [], checklist: [], listId: null, completedAt: null, ...over,
});
