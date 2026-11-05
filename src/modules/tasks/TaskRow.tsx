import type { TaskList, TaskRecord } from './model';
import { STATUS_LABEL } from './model';
import { PriorityMark } from '../../ui/PriorityMark';
import { dayLabel } from '../../core/time';
import { isOverdue } from './views';

const timeText = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

/** One task: a big tick box, the title, and a line of details. Tapping the title opens the task. */
export default function TaskRow({ task, lists, tags, today, selecting, selected, onSelect, onOpen, onToggle, restore }: {
  task: TaskRecord; lists: TaskList[]; tags: { id: number; name: string }[]; today: string;
  selecting: boolean; selected: boolean; onSelect: (id: number) => void; onOpen: (t: TaskRecord) => void; onToggle: (t: TaskRecord) => void;
  /** In the Deleted view, a Restore button replaces the tick box. */
  restore?: (t: TaskRecord) => void;
}) {
  const d = task.data;
  const yr = (date: string) => ({ year: date.slice(0, 4) !== today.slice(0, 4) });
  const done = d.status === 'done';
  const late = isOverdue(task, today);
  const list = lists.find((l) => l.id === d.listId);
  const when = d.dueDate
    ? `${d.dueDate === today ? 'Due today' : late ? `Overdue · ${dayLabel(d.dueDate, yr(d.dueDate))}` : `Due ${dayLabel(d.dueDate, yr(d.dueDate))}`}${d.dueTime ? ` at ${timeText(d.dueTime)}` : ''}`
    : d.startDate ? `Do on ${dayLabel(d.startDate, yr(d.startDate))}` : '';
  const steps = d.checklist.length ? `${d.checklist.filter((c) => c.done).length}/${d.checklist.length} steps` : '';
  return (
    <li className={`tk-row p-${d.priority} ${done ? 'done' : ''} ${late ? 'late' : ''} ${selected ? 'selected' : ''}`}>
      {restore ? (
        <button type="button" className="btn tk-restore" onClick={() => restore(task)}>Restore</button>
      ) : selecting ? (
        <input type="checkbox" className="tk-select" checked={selected} onChange={() => onSelect(task.id)} aria-label={`Select ${d.title}`} />
      ) : (
        <button type="button" className="tk-check" role="checkbox" aria-checked={done} aria-label={done ? `Mark not done: ${d.title}` : `Mark done: ${d.title}`} onClick={() => onToggle(task)}>{done ? '✓' : ''}</button>
      )}
      <button type="button" className="tk-main" onClick={() => (selecting && !restore ? onSelect(task.id) : onOpen(task))}>
        <span className="tk-title"><PriorityMark priority={d.priority} /> {d.title}{d.repeat && <span className="tk-icon" title="Repeats" aria-label="Repeats"> ↻</span>}</span>
        <span className="tk-meta">
          {when && <span className={late ? 'tk-late' : ''}>{when}</span>}
          {d.status !== 'todo' && d.status !== 'done' && <span className="tk-pill">{STATUS_LABEL[d.status]}</span>}
          {list && <span>{list.name}</span>}
          {d.tagIds.map((id) => <span key={id}>#{tags.find((t) => t.id === id)?.name ?? '?'}</span>)}
          {steps && <span>{steps}</span>}
          {d.createdFrom && <span title="Made from another record">↗ {d.createdFrom.label}</span>}
        </span>
      </button>
    </li>
  );
}
