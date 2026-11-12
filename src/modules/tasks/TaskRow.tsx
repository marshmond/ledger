import type { TaskList, TaskRecord } from './model';
import { STATUS_LABEL } from './model';
import { PriorityMark } from '../../ui/PriorityMark';
import { DateInline } from '../../ui/DateTile';
import { StatusChip } from '../../ui/StatusChip';
import { isOverdue } from './views';
import { dueState } from './viewModel';
import { projectLabel, type ProjectChoice } from '../../core/projectLink';

const timeText = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

/**
 * One task: a big tick box, then ONE button holding the title and everything about it (tapping it opens the task). D11: the button is a
 * shared left-aligned row (`ui-row`), so the title no longer centers; its parts sit in fixed columns on a computer (title, project and
 * steps, due date) and flow onto two lines on a phone. Every piece of information, control and label from before is still here.
 */
export default function TaskRow({ task, lists, tags, projects, today, selecting, selected, onSelect, onOpen, onToggle, restore }: {
  task: TaskRecord; lists: TaskList[]; tags: { id: number; name: string }[]; projects?: ProjectChoice[]; today: string;
  selecting: boolean; selected: boolean; onSelect: (id: number) => void; onOpen: (t: TaskRecord) => void; onToggle: (t: TaskRecord) => void;
  /** In the Deleted view, a Restore button replaces the tick box. */
  restore?: (t: TaskRecord) => void;
}) {
  const d = task.data;
  const done = d.status === 'done';
  const late = isOverdue(task, today);
  const state = dueState(task, today);
  const list = lists.find((l) => l.id === d.listId);
  const steps = d.checklist.length ? `${d.checklist.filter((c) => c.done).length}/${d.checklist.length} steps` : '';
  const at = d.dueDate && d.dueTime ? ` at ${timeText(d.dueTime)}` : '';
  const hasProject = d.projectId !== undefined;
  const extras = !!list || d.tagIds.length > 0 || !!d.createdFrom;
  return (
    <li className={`tk-row p-${d.priority} due-${state} ${done ? 'done' : ''} ${late ? 'late' : ''} ${selected ? 'selected' : ''}`}>
      {restore ? (
        <button type="button" className="btn tk-restore" onClick={() => restore(task)}>Restore</button>
      ) : selecting ? (
        <input type="checkbox" className="tk-select" checked={selected} onChange={() => onSelect(task.id)} aria-label={`Select ${d.title}`} />
      ) : (
        <button type="button" className="tk-check" role="checkbox" aria-checked={done} aria-label={done ? `Mark not done: ${d.title}` : `Mark done: ${d.title}`} onClick={() => onToggle(task)}>{done ? '✓' : ''}</button>
      )}
      <button type="button" className="ui-row tk-main" onClick={() => (selecting && !restore ? onSelect(task.id) : onOpen(task))}>
        <span className="tk-title">
          <PriorityMark priority={d.priority} />
          <span className="tk-title-text">{d.title}</span>
          {d.repeat && <span className="tk-icon" title="Repeats" aria-label="Repeats">↻</span>}
          {d.status !== 'todo' && d.status !== 'done' && <span className="tk-pill">{STATUS_LABEL[d.status]}</span>}
        </span>
        <span className="tk-side">
          {hasProject && <span className="tk-proj" title="Project">{d.isMilestone ? '◆' : '◇'} {projectLabel(projects ?? [], d.projectId!)}</span>}
          {steps && <span className="tk-steps">{steps}</span>}
        </span>
        <span className="tk-duecell">
          {state === 'done' && <StatusChip tone="done">{STATUS_LABEL.done}</StatusChip>}
          {state === 'overdue' && <><span aria-hidden="true"><StatusChip tone="overdue">Overdue</StatusChip></span><DateInline iso={d.dueDate!} today={today} overdue /></>}
          {state === 'today' && <StatusChip tone="active">Due today</StatusChip>}
          {state === 'tomorrow' && <><span className="sr-only">Due </span><span aria-hidden="true"><StatusChip tone="active" icon={false}>Tomorrow</StatusChip></span><DateInline iso={d.dueDate!} today={today} /></>}
          {state === 'upcoming' && <><span className="sr-only">Due </span><DateInline iso={d.dueDate!} today={today} /></>}
          {state === 'planned' && <><span className="tk-muted">Do on</span><DateInline iso={d.startDate!} today={today} /></>}
          {state === 'none' && <span className="tk-muted">No due date</span>}
          {at && <span className="tk-time">{at.replace(' at ', '')}</span>}
        </span>
        {extras && (
          <span className="tk-meta">
            {list && <span>{list.name}</span>}
            {d.tagIds.map((id) => <span key={id}>#{tags.find((t) => t.id === id)?.name ?? '?'}</span>)}
            {d.createdFrom && <span title="Made from another record">↗ {d.createdFrom.label}</span>}
          </span>
        )}
      </button>
    </li>
  );
}
