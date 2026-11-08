import { useMemo, useState } from 'react';
import { rovingKeys } from '../../ui/rovingKeys';
import { useLiveQuery } from 'dexie-react-hooks';
import { dayLabel } from '../../core/time';
import { projectLabel, useProjectChoices } from '../../core/projectLink';
import { todayISO } from '../../lib/money';
import { useToday } from '../../ui/useToday';
import { useToast } from '../../ui/Toast';
import { loadEvents, setEventProject } from '../calendar/data';
import { pathFor as eventPath } from '../calendar/records';
import { occurrenceToOpen } from '../calendar/searchSource';
import { completeTask, loadTasks, reopenTask } from '../tasks/data';
import TaskEditor from '../tasks/TaskEditor';
import type { TaskRecord } from '../tasks/model';
import { isOpen, isOverdue, sortTasks } from '../tasks/views';
import { createProjectTask, groupOf, setMilestone, setTaskProject, summarizeWork, upcomingActivity, workOf, type TaskGroup } from './work';
import type { ProjectRecord } from './model';

const KIND_MARK = { milestone: '◆', task: '☐', event: '◷' } as const;
const KIND_WORD = { milestone: 'Milestone', task: 'Task', event: 'Event' } as const;

function Progress({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="pj-progress" role="img" aria-label={`${label}: ${done} of ${total} done`}>
      <span className="pj-progress-bar"><span style={{ width: `${pct}%` }} /></span>
      <span className="muted small">{total ? `${done} of ${total} done` : 'None yet'}</span>
    </div>
  );
}

/** A task or milestone row on the project page: tick box, title (opens the normal Task editor), due date, and a way off the project. */
function WorkRow({ task, today, onOpen, onToggle, onRemove }: { task: TaskRecord; today: string; onOpen: (t: TaskRecord) => void; onToggle: (t: TaskRecord) => void; onRemove: (t: TaskRecord) => void }) {
  const done = !isOpen(task);
  const late = isOverdue(task, today);
  const due = task.data.dueDate;
  return (
    <li className={`pj-work ${done ? 'done' : ''} ${late ? 'late' : ''}`}>
      <button type="button" className="tk-check" role="checkbox" aria-checked={done} aria-label={done ? `Mark not done: ${task.data.title}` : `Mark done: ${task.data.title}`} onClick={() => onToggle(task)}>{done ? '✓' : ''}</button>
      <button type="button" className="pj-work-main" onClick={() => onOpen(task)}>
        <span className="pj-work-title">{task.data.isMilestone ? '◆ ' : ''}{task.data.title}</span>
        <span className="muted small">
          {due ? `${late ? 'Overdue · ' : due === today ? 'Due today · ' : 'Due '}${dayLabel(due, { year: due.slice(0, 4) !== today.slice(0, 4) })}` : 'No due date'}
          {task.data.repeat ? ' · repeats' : ''}
        </span>
      </button>
      <button type="button" className="link" onClick={() => onRemove(task)} aria-label={`Remove ${task.data.title} from this project`}>Remove</button>
    </li>
  );
}

/** Tasks, milestones and events of one project, plus a single "coming up" list. All of it is read from, and written through, Tasks and Calendar. */
export default function ProjectWork({ project }: { project: ProjectRecord }) {
  const toast = useToast();
  const today = useToday() || todayISO();
  const pid = project.id;
  const tasks = useLiveQuery(() => loadTasks(), []);
  const events = useLiveQuery(() => loadEvents(), []);
  const projects = useProjectChoices();
  const [editing, setEditing] = useState<TaskRecord | null>(null);
  const [group, setGroup] = useState<'open' | TaskGroup | 'all'>('open');
  const [msTitle, setMsTitle] = useState('');
  const [msDue, setMsDue] = useState('');
  const [tkTitle, setTkTitle] = useState('');
  const [tkDue, setTkDue] = useState('');
  const [pickTask, setPickTask] = useState('');
  const [pickEvent, setPickEvent] = useState('');
  const [error, setError] = useState('');

  const all = tasks ?? [];
  const { tasks: plain, milestones } = useMemo(() => workOf(all, pid), [all, pid]);
  const sum = useMemo(() => summarizeWork(all, pid, today), [all, pid, today]);
  const mine = useMemo(() => (events ?? []).filter((e) => !e.data.retired && e.data.projectId === pid), [events, pid]);
  const activity = useMemo(() => upcomingActivity(all, events ?? [], pid, today, 30), [all, events, pid, today]);

  const run = async (fn: () => Promise<void>) => { try { await fn(); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); } };
  const toggle = (t: TaskRecord) => void run(async () => {
    if (isOpen(t)) { await completeTask(t.id, today); toast(`Done: ${t.data.title}`, async () => { await reopenTask(t.id); }); }
    else { await reopenTask(t.id); toast(`Reopened: ${t.data.title}`, async () => { await completeTask(t.id, today); }); }
  });
  const removeFrom = (t: TaskRecord) => void run(async () => {
    const wasMilestone = t.data.isMilestone === true;
    await setTaskProject(t.id, null);
    toast(`${t.data.title} is no longer on this project. The task itself is kept${wasMilestone ? ' (as an ordinary task)' : ''}.`, async () => { await setTaskProject(t.id, pid); if (wasMilestone) await setMilestone(t.id, true); });
  });

  const addMilestone = (e: React.FormEvent) => { e.preventDefault(); void run(async () => { await createProjectTask(pid, { title: msTitle, dueDate: msDue || null, milestone: true }); setMsTitle(''); setMsDue(''); }); };
  const addTask = (e: React.FormEvent) => { e.preventDefault(); void run(async () => { await createProjectTask(pid, { title: tkTitle, dueDate: tkDue || null }); setTkTitle(''); setTkDue(''); }); };
  const linkTask = () => void run(async () => {
    const t = all.find((x) => x.id === Number(pickTask));
    if (!t) return;
    const before = t.data.projectId;
    await setTaskProject(t.id, pid);
    setPickTask('');
    toast(`Added to this project: ${t.data.title}`, async () => { await setTaskProject(t.id, before ?? null); });
  });
  const linkEvent = () => void run(async () => {
    const ev = (events ?? []).find((x) => x.id === Number(pickEvent));
    if (!ev) return;
    const before = ev.data.projectId ?? null;
    await setEventProject(ev.id, pid);
    setPickEvent('');
    toast(`Added to this project: ${ev.data.title}`, async () => { await setEventProject(ev.id, before).catch(() => undefined); });
  });
  const unlinkEvent = (id: number, title: string) => void run(async () => {
    await setEventProject(id, null);
    toast(`${title} is no longer on this project. The event itself is kept.`, async () => { await setEventProject(id, pid); });
  });

  const shownTasks = sortTasks(plain.filter((t) => group === 'all' || (group === 'open' ? groupOf(t, today) !== 'done' : groupOf(t, today) === group)), 'due');
  const counts = { overdue: sum.tasks.overdue, open: sum.tasks.open, done: sum.tasks.done };
  const sortedMilestones = sortTasks(milestones, 'due').sort((a, b) => Number(!isOpen(a)) - Number(!isOpen(b)));
  const linkableTasks = sortTasks(all.filter((t) => t.data.projectId !== pid && isOpen(t)), 'title');
  const linkableEvents = (events ?? []).filter((e) => !e.data.retired && e.data.projectId !== pid).sort((a, b) => b.data.startDate.localeCompare(a.data.startDate)).slice(0, 200);

  if (!tasks || !events) return <p className="muted">Loading…</p>;
  return (
    <>
      {error && <p className="error" role="alert">{error}</p>}

      <section className="card pj-card" id="pj-schedule" aria-labelledby="pj-sched-h">
        <div className="pj-card-head"><h2 id="pj-sched-h">Coming up</h2><span className="muted small">next 30 days, plus anything overdue</span></div>
        {activity.length === 0 ? (
          <p className="muted">Nothing scheduled yet. Add a milestone, a task with a due date, or an event below.</p>
        ) : (
          <ul className="plain pj-paylist">
            {activity.map((a) => (
              <li key={a.key} className="pj-payrow">
                <span className="pj-payrow-main">
                  <a href={`#${a.path}`}><strong>{KIND_MARK[a.kind]} {a.title}</strong></a>
                  <span className="muted small">{KIND_WORD[a.kind]}{a.overdue ? ' · ' : ''}{a.overdue && <span className="tk-late">Overdue</span>}</span>
                </span>
                <span className={`small ${a.overdue ? 'tk-late' : 'muted'}`}>{dayLabel(a.date, { year: a.date.slice(0, 4) !== today.slice(0, 4) })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card pj-card" id="pj-milestones" aria-labelledby="pj-ms-h">
        <div className="pj-card-head"><h2 id="pj-ms-h">Milestones</h2>{sum.milestones.overdue > 0 && <span className="tk-late small">{sum.milestones.overdue} overdue</span>}</div>
        <Progress done={sum.milestones.done} total={sum.milestones.total} label="Milestones" />
        {sortedMilestones.length === 0 ? <p className="muted">No milestones yet. A milestone is a checkpoint, such as "Permit approved" or "Cabinets delivered".</p> : (
          <ul className="plain pj-worklist">{sortedMilestones.map((t) => <WorkRow key={t.id} task={t} today={today} onOpen={setEditing} onToggle={toggle} onRemove={removeFrom} />)}</ul>
        )}
        <form className="pj-add" onSubmit={addMilestone}>
          <input value={msTitle} onChange={(e) => setMsTitle(e.target.value)} placeholder="New milestone" aria-label="New milestone title" />
          <input type="date" value={msDue} onChange={(e) => setMsDue(e.target.value)} aria-label="Milestone due date" />
          <button className="btn" disabled={!msTitle.trim()}>Add milestone</button>
        </form>
      </section>

      <section className="card pj-card" id="pj-tasks" aria-labelledby="pj-tk-h">
        <div className="pj-card-head"><h2 id="pj-tk-h">Tasks</h2></div>
        <Progress done={sum.tasks.done} total={sum.tasks.total} label="Tasks" />
        <div className="tk-tabs pj-tabs" role="tablist" aria-label="Task filter" onKeyDown={rovingKeys}>
          {([['open', 'To do', counts.open], ['overdue', 'Overdue', counts.overdue], ['done', 'Done', counts.done], ['all', 'All', sum.tasks.total]] as const).map(([id, label, n]) => (
            <button key={id} role="tab" aria-selected={group === id} tabIndex={(group === id) ? 0 : -1} className={group === id ? 'on' : ''} onClick={() => setGroup(id)}>{label}<span className="count">{n}</span></button>
          ))}
        </div>
        {shownTasks.length === 0 ? <p className="muted">{plain.length === 0 ? 'No tasks on this project yet.' : 'Nothing in this filter.'}</p> : (
          <ul className="plain pj-worklist">{shownTasks.map((t) => <WorkRow key={t.id} task={t} today={today} onOpen={setEditing} onToggle={toggle} onRemove={removeFrom} />)}</ul>
        )}
        <form className="pj-add" onSubmit={addTask}>
          <input value={tkTitle} onChange={(e) => setTkTitle(e.target.value)} placeholder="New task" aria-label="New task title" />
          <input type="date" value={tkDue} onChange={(e) => setTkDue(e.target.value)} aria-label="Task due date" />
          <button className="btn" disabled={!tkTitle.trim()}>Add task</button>
        </form>
        {linkableTasks.length > 0 && (
          <div className="pj-add">
            <select value={pickTask} onChange={(e) => setPickTask(e.target.value)} aria-label="Add an existing task">
              <option value="">Add an existing task…</option>
              {linkableTasks.map((t) => <option key={t.id} value={t.id}>{t.data.title}{t.data.projectId !== undefined ? ` (now on ${projectLabel(projects, t.data.projectId)})` : ''}</option>)}
            </select>
            <button className="btn" disabled={!pickTask} onClick={linkTask}>Add to project</button>
          </div>
        )}
      </section>

      <section className="card pj-card" id="pj-events" aria-labelledby="pj-ev-h">
        <div className="pj-card-head"><h2 id="pj-ev-h">Events</h2><a className="btn" href={`#/calendar?new=1&project=${pid}`}>Add event</a></div>
        {mine.length === 0 ? <p className="muted">No events on this project. An event is a calendar entry such as a walkthrough, a delivery or an inspection. It stays an ordinary Calendar event.</p> : (
          <ul className="plain pj-paylist">
            {[...mine].sort((a, b) => a.data.startDate.localeCompare(b.data.startDate)).map((e) => {
              const occ = occurrenceToOpen(e, today);
              const date = occ?.firstDay ?? e.data.startDate;
              return (
                <li key={e.id} className="pj-payrow">
                  <span className="pj-payrow-main">
                    <a href={`#${eventPath(e)}`}><strong>◷ {e.data.title}</strong></a>
                    <span className="muted small">{dayLabel(date, { year: true })}{e.data.recurrence ? ' · repeats' : ''}{e.data.location ? ` · ${e.data.location}` : ''}</span>
                  </span>
                  <button className="link" onClick={() => unlinkEvent(e.id, e.data.title)} aria-label={`Remove ${e.data.title} from this project`}>Remove</button>
                </li>
              );
            })}
          </ul>
        )}
        {linkableEvents.length > 0 && (
          <div className="pj-add">
            <select value={pickEvent} onChange={(e) => setPickEvent(e.target.value)} aria-label="Add an existing event">
              <option value="">Add an existing event…</option>
              {linkableEvents.map((e) => <option key={e.id} value={e.id}>{e.data.title} · {e.data.startDate}{e.data.projectId !== undefined ? ` (now on ${projectLabel(projects, e.data.projectId)})` : ''}</option>)}
            </select>
            <button className="btn" disabled={!pickEvent} onClick={linkEvent}>Add to project</button>
          </div>
        )}
      </section>

      {editing && <TaskEditor key={editing.id} task={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
