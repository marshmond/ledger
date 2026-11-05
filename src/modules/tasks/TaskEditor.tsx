import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Priority, RecordRef } from '../../core/entities';
import { store } from '../../core/store';
import { todayISO } from '../../lib/money';
import Modal from '../../shell/Modal';
import { useToast } from '../../ui/Toast';
import { PRIORITIES, PRIORITY_ICON, PRIORITY_LABEL } from '../calendar/model';
import { ContactPicker, RecordLinks, RefLabel, TagPicker, refKey } from '../calendar/pickers';
import RepeatFields from '../calendar/RepeatFields';
import { normalizeRule, type Recurrence } from '../calendar/recurrence';
import { completeTask, createList, loadLists, removeTasks, reopenTask, restoreTasks, saveTask } from './data';
import { MODULE, STATUSES, STATUS_LABEL, type ChecklistItem, type TaskRecord, type TaskStatus } from './model';

/** All the details of one task. Only the title is required. */
export default function TaskEditor({ task, onClose }: { task: TaskRecord; onClose: () => void }) {
  const toast = useToast();
  const t = task.data;
  const today = todayISO();
  const lists = useLiveQuery(() => loadLists(), []) ?? [];
  const [title, setTitle] = useState(t.title);
  const [notes, setNotes] = useState(t.notes);
  const [status, setStatus] = useState<TaskStatus>(t.status);
  const [priority, setPriority] = useState<Priority>(t.priority);
  const [dueDate, setDueDate] = useState(t.dueDate ?? '');
  const [dueTime, setDueTime] = useState(t.dueTime ?? '');
  const [startDate, setStartDate] = useState(t.startDate ?? '');
  const [rule, setRule] = useState<Recurrence | null>(t.repeat?.rule ?? null);
  const [mode, setMode] = useState<'fixed' | 'after'>(t.repeat?.mode ?? 'fixed');
  const [listName, setListName] = useState('');
  const [listTouched, setListTouched] = useState(false);
  const [tagIds, setTagIds] = useState(t.tagIds);
  const [contactIds, setContactIds] = useState(t.contactIds);
  const [checklist, setChecklist] = useState<ChecklistItem[]>(t.checklist);
  const [newItem, setNewItem] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const currentListName = lists.find((l) => l.id === t.listId)?.name ?? '';
  const shownList = listTouched ? listName : currentListName;

  const links = useLiveQuery(() => store.shared.links.linkedTo({ module: MODULE, id: task.id }), [task.id]) ?? [];
  const existing = useMemo(() => links.map((l) => ({
    linkId: l.id as number,
    ref: (l.fromModule === MODULE && l.fromId === task.id ? { module: l.toModule, id: l.toId } : { module: l.fromModule, id: l.fromId }) as RecordRef,
  })), [links, task.id]);
  const [added, setAdded] = useState<RecordRef[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  const save = async () => {
    if (!title.trim()) return setError('Give it a title.');
    if (startDate && dueDate && startDate > dueDate) return setError('The "do on" date is after the due date.');
    setBusy(true);
    try {
      const listId = listTouched ? (listName.trim() ? await createList(listName) : null) : t.listId;
      const done = status === 'done';
      await saveTask(task.id, {
        ...t, title: title.trim(), notes: notes.trim(), status, priority, dueDate: dueDate || null, dueTime: dueDate && dueTime ? dueTime : null, startDate: startDate || null,
        repeat: rule ? { mode, rule: normalizeRule(rule) ?? rule } : null, tagIds, contactIds, checklist: checklist.filter((c) => c.text.trim()), listId,
        completedAt: done ? t.completedAt ?? Date.now() : null,
      });
      for (const e of existing) if (removed.has(refKey(e.ref))) await store.shared.links.remove(e.linkId);
      for (const r of added) await store.shared.links.add({ module: MODULE, id: task.id }, r, 'about');
      toast('Task saved');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
      setBusy(false);
    }
  };

  const del = async () => {
    await removeTasks([task.id]);
    toast('Task deleted', async () => { await restoreTasks([task.id]); });
    onClose();
  };
  const toggleDone = async () => {
    if (t.status === 'done') { await reopenTask(task.id); toast('Task reopened'); }
    else { const { spawnedId } = await completeTask(task.id, today); toast(spawnedId ? 'Done. The next one is created.' : 'Done', async () => { await reopenTask(task.id); }); }
    onClose();
  };

  return (
    <Modal title="Task" onClose={onClose} wide>
      <form className="cal-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <label className="f">Title<input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus /></label>
        <div className="cal-when">
          <label className="f">Status
            <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
          </label>
          <label className="f">Priority
            <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_ICON[p]} {PRIORITY_LABEL[p]}{p === 'reminder' ? ' (a nudge)' : ''}</option>)}
            </select>
          </label>
        </div>
        <div className="cal-when">
          <label className="f">Due
            <span className="row nowrap">
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              {dueDate && <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} aria-label="Due time" />}
            </span>
          </label>
          <label className="f">Do on <span className="muted">(optional)</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
        </div>
        <label className="f">List <span className="muted">(optional; type a new name to make a list)</span>
          {/* A plain menu for existing lists, plus a box for a new one: the browser's suggestion pop-up (datalist) can open far from the box. */}
          <span className="row grow">
            {lists.length > 0 && (
              <select value={lists.some((l) => l.name === shownList) ? shownList : ''} onChange={(e) => { setListTouched(true); setListName(e.target.value); }} aria-label="Pick a list">
                <option value="">No list</option>
                {lists.map((l) => <option key={l.id} value={l.name}>{l.name}</option>)}
              </select>
            )}
            <input value={lists.some((l) => l.name === shownList) ? '' : shownList} onChange={(e) => { setListTouched(true); setListName(e.target.value); }} placeholder={lists.length ? 'or type a new list name' : 'No list; type a name to make one'} aria-label="New list name" />
          </span>
        </label>

        <RepeatFields rule={rule} onChange={setRule} start={dueDate || today} mode={mode} onMode={setMode} />
        {rule && !dueDate && <p className="muted small">With no due date, the first due date is set when you complete it.</p>}

        <label className="f">Notes<textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>

        <div className="f"><span>Checklist {checklist.length > 0 && <span className="muted">· {checklist.filter((c) => c.done).length} of {checklist.length} done</span>}</span>
          <ul className="plain tk-checklist">
            {checklist.map((c) => (
              <li key={c.id} className="row nowrap">
                <input type="checkbox" checked={c.done} onChange={(e) => setChecklist(checklist.map((x) => (x.id === c.id ? { ...x, done: e.target.checked } : x)))} aria-label={`Done: ${c.text}`} />
                <input value={c.text} onChange={(e) => setChecklist(checklist.map((x) => (x.id === c.id ? { ...x, text: e.target.value } : x)))} aria-label="Checklist item" />
                <button type="button" className="link danger" onClick={() => setChecklist(checklist.filter((x) => x.id !== c.id))} aria-label="Remove item">✕</button>
              </li>
            ))}
          </ul>
          <div className="row grow">
            <input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add a step" aria-label="New checklist step"
              onKeyDown={(e) => { if (e.key === 'Enter' && newItem.trim()) { e.preventDefault(); setChecklist([...checklist, { id: Date.now(), text: newItem.trim(), done: false }]); setNewItem(''); } }} />
            <button type="button" className="btn" disabled={!newItem.trim()} onClick={() => { setChecklist([...checklist, { id: Date.now(), text: newItem.trim(), done: false }]); setNewItem(''); }}>Add</button>
          </div>
        </div>

        <div className="f"><span>Tags</span><TagPicker value={tagIds} onChange={setTagIds} /></div>
        <div className="f"><span>People</span><ContactPicker value={contactIds} onChange={setContactIds} /></div>
        <div className="f"><span>Linked records</span>
          {t.createdFrom && <p className="small">Made from: <RefLabel r={{ module: t.createdFrom.module, id: t.createdFrom.id }} /></p>}
          <RecordLinks
            existing={existing.map((e) => e.ref)} added={added} removed={removed}
            onAdd={(r) => setAdded((a) => [...a, r])}
            onRemove={(r) => (added.some((a) => refKey(a) === refKey(r)) ? setAdded(added.filter((a) => refKey(a) !== refKey(r))) : setRemoved(new Set([...removed, refKey(r)])))}
            onUndoRemove={(r) => setRemoved(new Set([...removed].filter((k) => k !== refKey(r))))}
          />
        </div>

        {error && <p className="cal-error" role="alert">{error}</p>}
        <div className="row spread cal-actions">
          <span className="row">
            <button type="submit" className="btn primary" disabled={busy}>Save</button>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
          </span>
          <span className="row">
            <button type="button" className="btn" onClick={() => void toggleDone()}>{t.status === 'done' ? 'Reopen' : 'Mark done'}</button>
            <button type="button" className="btn danger" onClick={() => void del()}>Delete</button>
          </span>
        </div>
      </form>
    </Modal>
  );
}
