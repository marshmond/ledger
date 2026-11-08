import { useEffect, useMemo, useState } from 'react';
import { rovingKeys } from '../../ui/rovingKeys';
import { useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Priority } from '../../core/entities';
import { store } from '../../core/store';
import { todayISO } from '../../lib/money';
import { useToday } from '../../ui/useToday';
import { useToast } from '../../ui/Toast';
import { projectLabel, selectableProjects, useProjectChoices } from '../../core/projectLink';
import { dayLabel } from '../../core/time';
import { PRIORITIES, PRIORITY_ICON, PRIORITY_LABEL } from '../../core/priority';
import { assignTasksToProject, completeTask, loadDeletedTasks, loadLists, loadTasks, planTaskProject, removeTasks, reopenTask, restoreTaskData, restoreTasks, saveTask, updateTasks } from './data';
import ListsDialog from './ListsDialog';
import { QuickAddBar } from './QuickTask';
import TaskEditor from './TaskEditor';
import TaskRow from './TaskRow';
import type { TaskRecord } from './model';
import { NO_FILTER, SORTS, VIEWS, buildView, counts, isOpen, type Filter, type SortKey, type ViewId } from './views';

const VIEW_KEY = 'tasks-last-view';
const isView = (v: unknown): v is ViewId => VIEWS.some((x) => x.id === v);
function lastView(): ViewId { try { const v = localStorage.getItem(VIEW_KEY); return isView(v) ? v : 'today'; } catch { return 'today'; } }

const EMPTY: Record<ViewId, string> = {
  today: 'Nothing due or planned for today. Add a task above, or look at Upcoming.',
  upcoming: 'Nothing coming up in this range.',
  overdue: 'Nothing is overdue.',
  all: 'No open tasks. Add one above.',
  lists: 'No open tasks.',
  tags: 'No open tasks.',
  priority: 'No open tasks.',
  waiting: 'Nothing is marked Waiting. Set a task\'s status to Waiting when it depends on someone else.',
  completed: 'Nothing completed in the last 30 days.',
  deleted: 'Nothing deleted.',
};

export default function TasksPage() {
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const today = useToday();
  const tasks = useLiveQuery(() => loadTasks(), []);
  const deleted = useLiveQuery(() => loadDeletedTasks(), []) ?? [];
  const lists = useLiveQuery(() => loadLists(), []) ?? [];
  const tags = useLiveQuery(() => store.shared.tags.query(), []) ?? [];
  const projects = useProjectChoices();
  const tagList = useMemo(() => tags.map((t) => ({ id: t.id as number, name: t.name })), [tags]);

  const view: ViewId = isView(sp.get('v')) ? (sp.get('v') as ViewId) : lastView();
  const [filter, setFilter] = useState<Filter>(NO_FILTER);
  const [sort, setSort] = useState<SortKey>('due');
  const [days, setDays] = useState(7);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<TaskRecord | null>(null);
  const [manageLists, setManageLists] = useState(false);

  const go = (v: ViewId) => {
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage unavailable */ }
    const next = new URLSearchParams(sp); next.set('v', v); next.delete('task');
    setSp(next, { replace: true });
    setSelected(new Set());
  };

  // A link such as #/tasks?task=123 (from the Calendar or a record) opens that task.
  const wanted = Number(sp.get('task'));
  useEffect(() => {
    if (!wanted || !tasks) return;
    const t = tasks.find((x) => x.id === wanted);
    if (t) setEditing(t);
    const next = new URLSearchParams(sp); next.delete('task'); setSp(next, { replace: true });
  }, [wanted, tasks]); // eslint-disable-line react-hooks/exhaustive-deps

  // A link such as #/tasks?v=all&tag=3 or &contact=7 (from global search) shows just that tag or contact, then tidies the address.
  const wantTag = Number(sp.get('tag')) || '';
  const wantContact = Number(sp.get('contact')) || '';
  const wantProject = Number(sp.get('project')) || '';
  useEffect(() => {
    if (wantTag === '' && wantContact === '' && wantProject === '') return;
    setFilter({ ...NO_FILTER, ...(wantTag !== '' ? { tagId: wantTag } : {}), ...(wantContact !== '' ? { contactId: wantContact } : {}), ...(wantProject !== '' ? { projectId: wantProject } : {}) });
    const next = new URLSearchParams(sp); next.delete('tag'); next.delete('contact'); next.delete('project'); setSp(next, { replace: true });
  }, [wantTag, wantContact, wantProject]); // eslint-disable-line react-hooks/exhaustive-deps
  const contacts = useLiveQuery(() => store.shared.contacts.query(), []) ?? [];
  const filteredContact = filter.contactId ? contacts.find((c) => c.id === filter.contactId)?.name : undefined;

  // In Completed the natural order is "recently completed"; everywhere else that choice means the default (due date).
  const effSort: SortKey = view === 'completed' ? (sort === 'due' ? 'completed' : sort) : sort === 'completed' ? 'due' : sort;
  const groups = useMemo(
    () => buildView(view, tasks ?? [], deleted, { today, days, sort: effSort, filter, lists, tags: tagList }),
    [view, tasks, deleted, today, days, effSort, filter, lists, tagList],
  );
  const badge = useMemo(() => counts(tasks ?? [], today), [tasks, today]);
  const listCounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const t of tasks ?? []) if (isOpen(t) && t.data.listId !== null) m.set(t.data.listId, (m.get(t.data.listId) ?? 0) + 1);
    return m;
  }, [tasks]);
  const visible = groups.flatMap((g) => g.tasks);

  const toggle = async (t: TaskRecord) => {
    if (t.data.status === 'done') {
      await reopenTask(t.id);
      toast('Reopened', async () => { await completeTask(t.id, todayISO()); });
    } else {
      const { spawnedId } = await completeTask(t.id, today);
      toast(spawnedId ? 'Done. The next one is created.' : 'Done', async () => { await reopenTask(t.id); });
    }
  };

  // ---- bulk actions: each can be undone ----
  const picked = () => (tasks ?? []).filter((t) => selected.has(t.id));
  const bulkEdit = async (label: string, change: (t: TaskRecord['data']) => TaskRecord['data']) => {
    const before = picked();
    await updateTasks(before.map((t) => t.id), change);
    toast(`${label}: ${before.length} task${before.length === 1 ? '' : 's'}`, async () => { for (const t of before) await saveTask(t.id, t.data); });
    setSelected(new Set());
  };
  /** Put the selected tasks on a project, move them, or (value 'none') take them off. Says what will be replaced first; undoable. */
  const bulkProject = async (value: string) => {
    const target = value === 'none' ? null : Number(value);
    const ids = [...selected];
    try {
      const plan = await planTaskProject(ids, target);
      const where = target === null ? 'no project' : projectLabel(projects, target);
      if (plan.missing) { toast(`${plan.missing} of the selected tasks no longer exist. Nothing was changed.`); return; }
      if (plan.unchanged === plan.total) { toast(target === null ? 'None of those tasks are on a project.' : `All of those tasks are already on ${where}.`); return; }
      if (plan.replacing > 0) {
        const from = plan.replacedFrom.map((id) => projectLabel(projects, id)).join(', ');
        const ms = plan.milestonesLeaving ? ` ${plan.milestonesLeaving} milestone${plan.milestonesLeaving === 1 ? '' : 's'} will become ordinary task${plan.milestonesLeaving === 1 ? '' : 's'}.` : '';
        const msg = target === null
          ? `Take ${plan.replacing} task${plan.replacing === 1 ? '' : 's'} off ${from || 'their project'}?${ms}`
          : `${plan.replacing} of the ${plan.total} selected task${plan.total === 1 ? ' is' : 's are'} on ${from}. Move ${plan.replacing === 1 ? 'it' : 'them'} to ${where}?${plan.adding ? ` ${plan.adding} more will be added to it.` : ''}`;
        if (!confirm(msg)) return;
      }
      const { changed, before } = await assignTasksToProject(ids, target);
      toast(`${target === null ? 'Taken off their projects' : `On ${where}`}: ${changed} task${changed === 1 ? '' : 's'}${plan.unchanged ? ` (${plan.unchanged} already there)` : ''}`, async () => { await restoreTaskData(before); });
      setSelected(new Set());
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not change the project. Nothing was changed.');
    }
  };
  const bulkComplete = async () => {
    const ids = picked().filter(isOpen).map((t) => t.id);
    for (const id of ids) await completeTask(id, today);
    toast(`Completed ${ids.length} task${ids.length === 1 ? '' : 's'}`, async () => { for (const id of ids) await reopenTask(id); });
    setSelected(new Set());
  };
  const bulkDelete = async () => {
    const ids = [...selected];
    await removeTasks(ids);
    toast(`Deleted ${ids.length} task${ids.length === 1 ? '' : 's'}`, async () => { await restoreTasks(ids); });
    setSelected(new Set());
  };
  const [moveTo, setMoveTo] = useState('');

  if (!tasks) return <p className="muted">Loading…</p>;
  const f = (patch: Partial<Filter>) => {
    const next = { ...filter, ...patch };
    if (next.projectId === '') delete next.projectId; // "Any project" is the same as no project filter at all
    setFilter(next);
  };
  const filtering = JSON.stringify(filter) !== JSON.stringify(NO_FILTER);

  return (
    <div className="tk">
      <div className="row spread"><h1 className="cal-title">Tasks</h1><button className="link" onClick={() => setManageLists(true)}>Lists…</button></div>
      <QuickAddBar />

      <div className="tk-tabs" role="tablist" aria-label="Task views" onKeyDown={rovingKeys}>
        {VIEWS.map((v) => {
          const n = v.id === 'today' ? badge.today : v.id === 'overdue' ? badge.overdue : v.id === 'waiting' ? badge.waiting : 0;
          return <button key={v.id} role="tab" aria-selected={view === v.id} tabIndex={(view === v.id) ? 0 : -1} className={view === v.id ? 'on' : ''} onClick={() => go(v.id)}>{v.label}{n > 0 && <span className="count">{n}</span>}</button>;
        })}
      </div>

      <div className="tk-controls">
        <input type="search" value={filter.text} onChange={(e) => f({ text: e.target.value })} placeholder="Search tasks" aria-label="Search tasks" />
        <select value={effSort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort by">{SORTS.filter((s) => s.id !== 'completed' || view === 'completed').map((s) => <option key={s.id} value={s.id}>Sort: {s.label}</option>)}</select>
        <select value={filter.priority} onChange={(e) => f({ priority: e.target.value as Priority | '' })} aria-label="Filter by priority">
          <option value="">Any priority</option>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_ICON[p]} {PRIORITY_LABEL[p]}</option>)}
        </select>
        <select value={String(filter.listId)} onChange={(e) => f({ listId: e.target.value === '' ? '' : e.target.value === 'none' ? 'none' : Number(e.target.value) })} aria-label="Filter by list">
          <option value="">Any list</option><option value="none">No list</option>{lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select value={String(filter.tagId)} onChange={(e) => f({ tagId: e.target.value === '' ? '' : Number(e.target.value) })} aria-label="Filter by tag">
          <option value="">Any tag</option>{tagList.map((t) => <option key={t.id} value={t.id}>#{t.name}</option>)}
        </select>
        {projects.length > 0 && (
          <select value={String(filter.projectId ?? '')} onChange={(e) => f({ projectId: e.target.value === '' ? '' : e.target.value === 'none' ? 'none' : Number(e.target.value) })} aria-label="Filter by project">
            <option value="">Any project</option><option value="none">No project</option>{projects.map((p) => <option key={p.id} value={p.id}>{projectLabel(projects, p.id)}</option>)}
          </select>
        )}
        {view === 'upcoming' && <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Upcoming range">{[7, 14, 30].map((d) => <option key={d} value={d}>Next {d} days</option>)}</select>}
        {filteredContact && <span className="badge">Contact: {filteredContact}</span>}
        {filtering && <button className="link" onClick={() => setFilter(NO_FILTER)}>Clear filters</button>}
        {view !== 'deleted' && <button className={`btn ${selecting ? 'primary' : ''}`} onClick={() => { setSelecting(!selecting); setSelected(new Set()); }}>{selecting ? 'Done selecting' : 'Select'}</button>}
      </div>

      {selecting && (
        <div className="tk-bulk" role="toolbar" aria-label="Bulk actions">
          <span><strong>{selected.size}</strong> selected</span>
          <button className="link" onClick={() => setSelected(new Set(visible.map((t) => t.id)))}>All {visible.length}</button>
          <button className="btn" disabled={!selected.size} onClick={() => void bulkComplete()}>Complete</button>
          <span className="row nowrap">
            <input type="date" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="New due date" />
            <button className="btn" disabled={!selected.size || !moveTo} onClick={() => void bulkEdit(`Rescheduled to ${dayLabel(moveTo)}`, (d) => ({ ...d, dueDate: moveTo }))}>Reschedule</button>
          </span>
          <select disabled={!selected.size} value="" aria-label="Change priority" onChange={(e) => e.target.value && void bulkEdit(`Priority ${e.target.value}`, (d) => ({ ...d, priority: e.target.value as Priority }))}>
            <option value="">Priority…</option>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_ICON[p]} {PRIORITY_LABEL[p]}</option>)}
          </select>
          <select disabled={!selected.size} value="" aria-label="Move to list" onChange={(e) => e.target.value && void bulkEdit('List changed', (d) => ({ ...d, listId: e.target.value === 'none' ? null : Number(e.target.value) }))}>
            <option value="">List…</option><option value="none">No list</option>{lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          {projects.length > 0 && (
            <select disabled={!selected.size} value="" aria-label="Put on a project" onChange={(e) => e.target.value && void bulkProject(e.target.value)}>
              <option value="">Project…</option>
              {selectableProjects(projects).map((p) => <option key={p.id} value={p.id}>{projectLabel(projects, p.id)}</option>)}
              <option value="none">No project (take off)</option>
            </select>
          )}
          <select disabled={!selected.size} value="" aria-label="Add a tag" onChange={(e) => e.target.value && void bulkEdit('Tag added', (d) => ({ ...d, tagIds: [...new Set([...d.tagIds, Number(e.target.value)])] }))}>
            <option value="">Add tag…</option>{tagList.map((t) => <option key={t.id} value={t.id}>#{t.name}</option>)}
          </select>
          <button className="btn danger" disabled={!selected.size} onClick={() => void bulkDelete()}>Delete</button>
        </div>
      )}

      {groups.length === 0 ? <p className="muted tk-empty">{filtering ? 'No tasks match these filters.' : EMPTY[view]}</p> : groups.map((g) => (
        <section key={g.key} className={`tk-group ${g.tone ?? ''}`} aria-label={g.title}>
          <h2>{view === 'upcoming' && /^\d{4}-/.test(g.title) ? dayLabel(g.title, { weekday: 'long' }) : g.title} <span className="muted">· {g.tasks.length}</span></h2>
          <ul className="plain">
            {g.tasks.map((t) => (
              <TaskRow key={t.id} task={t} lists={lists} tags={tagList} projects={projects} today={today} selecting={selecting} selected={selected.has(t.id)}
                onSelect={(id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
                onOpen={setEditing} onToggle={(x) => void toggle(x)}
                restore={view === 'deleted' ? async (x) => { await restoreTasks([x.id]); toast('Task restored'); } : undefined} />
            ))}
          </ul>
        </section>
      ))}

      {editing && <TaskEditor key={editing.id} task={editing} onClose={() => setEditing(null)} />}
      {manageLists && <ListsDialog lists={lists} counts={listCounts} onClose={() => setManageLists(false)} />}
    </div>
  );
}
