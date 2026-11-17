import { useState } from 'react';
import { announceTaskDone } from '../../core/taskFollowUp';
import Modal from '../../shell/Modal';
import { useToast } from '../../ui/Toast';
import { DayItems } from './SelectedDay';
import { loadEvents, createCalendar, deleteCalendar, updateCalendar } from './data';
import { PRIORITY_LABEL, PERSONAL_ID, SWATCHES, type CalendarLayer } from './model';
import { PriorityMark } from './parts';
import { dayLabel } from './time';
import type { CalItem } from './useCalendarData';

/** Everything on one day, with a button to add something. Opened from "+N more" or a day number. */
export function DayPanel({ date, items, onOpenItem, onAdd, onAddTask, onClose }: {
  date: string; items: CalItem[]; onOpenItem: (i: CalItem) => void; onAdd: (date: string) => void; onAddTask: (date: string) => void; onClose: () => void;
}) {
  return (
    <Modal title={dayLabel(date, { weekday: 'long', year: true })} onClose={onClose}>
      <DayItems date={date} items={items} onOpenItem={(x) => { onClose(); onOpenItem(x); }} />
      <div className="row cal-actions"><button className="btn primary" onClick={() => { onClose(); onAdd(date); }}>Add event</button><button className="btn" onClick={() => { onClose(); onAddTask(date); }}>Add task</button></div>
    </Modal>
  );
}

/** What a Finance (or other derived) item is, and a button to its source. Derived items are read-only here. */
export function DerivedDetail({ item, onClose }: { item: CalItem; onClose: () => void }) {
  const src = item.source!;
  const toast = useToast();
  const act = src.actions;
  const [date, setDate] = useState(item.firstDay);
  const complete = async () => {
    await act!.complete!();
    const taskId = src.sourceModule === 'tasks' && typeof src.sourceRecordId === 'number' ? src.sourceRecordId : null;
    const undo = async () => { await act!.reopen?.(); };
    // A finished Task that stands for a household visit or asset maintenance also offers to log it (R1.3). Other kinds of item are unchanged.
    if (taskId !== null) await announceTaskDone(toast, { taskId, text: `Done: ${item.title}`, undo });
    else toast(`Done: ${item.title}`, undo);
    onClose();
  };
  const move = async () => {
    const was = item.firstDay;
    await act!.reschedule!(date);
    toast(`Moved to ${dayLabel(date)}`, async () => { await act!.reschedule!(was); });
    onClose();
  };
  return (
    <Modal title={item.title} onClose={onClose}>
      <dl className="cal-detail">
        <dt>When</dt><dd>{dayLabel(item.firstDay, { weekday: 'long', year: true })}{item.lastDay !== item.firstDay ? ` to ${dayLabel(item.lastDay, { year: true })}` : ''} · all day{item.overdue && <> · <span className="cal-flag bad">Overdue</span></>}</dd>
        <dt>Calendar</dt><dd><span className="cal-swatch" style={{ background: item.color }} /> {item.layerName} <span className="muted">{act ? '(your tasks)' : `(read-only: worked out from your ${src.sourceModule === 'ledger' ? 'Ledger' : src.sourceModule} data)`}</span></dd>
        <dt>Priority</dt><dd><PriorityMark priority={item.priority} /> {PRIORITY_LABEL[item.priority]}</dd>
        {item.project && <><dt>Project</dt><dd><a href={`#/projects/${item.project.id}`} onClick={onClose}>{item.project.label}</a></dd></>}
        {src.detail && <><dt>About</dt><dd>{src.detail}</dd></>}
      </dl>
      {act ? (
        <>
          <p className="muted small">This is one of your tasks, so changes made here change the task itself.</p>
          <div className="row">
            {act.complete && <button className="btn primary" onClick={() => void complete()}>Mark done</button>}
            {act.reschedule && (
              <span className="row nowrap">
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="New date" />
                <button className="btn" disabled={!date || date === item.firstDay} onClick={() => void move()}>Move</button>
              </span>
            )}
          </div>
        </>
      ) : <p className="muted small">To change this, change it where it comes from. Nothing here can move its date or approve it.</p>}
      <div className="row cal-actions">
        <button className={`btn ${act ? '' : 'primary'}`} onClick={() => { onClose(); src.openSource(); }}>{src.sourceLabel ?? 'Open source'}</button>
        <button className="btn" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

/** Add, rename, recolour and delete calendars; choose the default; export. */
export function ManageCalendars({ layers, defaultId, onExport, onClose, onSetDefault }: {
  layers: CalendarLayer[]; defaultId: number; onExport: (calendarId?: number) => void; onClose: () => void; onSetDefault: (id: number) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [color, setColor] = useState(SWATCHES[1]);
  const [deleting, setDeleting] = useState<CalendarLayer | null>(null);
  const [count, setCount] = useState(0);

  const askDelete = async (l: CalendarLayer) => {
    setCount((await loadEvents()).filter((e) => e.data.calendarId === l.id).length);
    setDeleting(l);
  };
  return (
    <>
      <Modal title="Calendars" onClose={onClose} wide>
        <ul className="plain cal-manage">
          {layers.map((l) => (
            <li key={l.id} className="cal-manage-row">
              <input type="color" value={l.color} onChange={(e) => void updateCalendar(l.id, { color: e.target.value })} aria-label={`Colour for ${l.name}`} className="cal-color" />
              {l.sourceType === 'local' ? (
                <input defaultValue={l.name} aria-label="Calendar name" onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== l.name) void updateCalendar(l.id, { name: v }); else e.target.value = l.name; }} />
              ) : <strong>{l.name}</strong>}
              <span className="muted small">{l.sourceType === 'derived' ? 'Read-only · worked out for you' : l.id === defaultId ? 'Default for new events' : ''}</span>
              <span className="row cal-manage-actions">
                {l.sourceType === 'local' && l.id !== defaultId && <button className="link" onClick={() => onSetDefault(l.id)}>Make default</button>}
                <button className="link" onClick={() => onExport(l.id)}>Export</button>
                {l.sourceType === 'local' && !l.builtin && <button className="link danger" onClick={() => void askDelete(l)}>Delete</button>}
              </span>
            </li>
          ))}
        </ul>
        <form className="row cal-new" onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; await createCalendar(name, color); setName(''); toast('Calendar added'); }}>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Colour for the new calendar" className="cal-color" />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New calendar name" aria-label="New calendar name" />
          <button className="btn" type="submit" disabled={!name.trim()}>Add calendar</button>
        </form>
        <div className="row cal-actions"><button className="btn" onClick={() => onExport()}>Export all visible…</button><button className="btn primary" onClick={onClose}>Done</button></div>
      </Modal>
      {deleting && (
        <Modal title={`Delete "${deleting.name}"?`} onClose={() => setDeleting(null)}>
          <p>{count === 0 ? 'This calendar has no events.' : `This calendar has ${count} event${count === 1 ? '' : 's'}. What should happen to ${count === 1 ? 'it' : 'them'}?`}</p>
          <div className="cal-scope">
            {count > 0 && <button className="btn primary" onClick={async () => { await deleteCalendar(deleting.id, 'move', PERSONAL_ID); setDeleting(null); toast(`Calendar deleted; events moved to Personal`); }}>Keep the events: move them to Personal</button>}
            <button className="btn danger" onClick={async () => { await deleteCalendar(deleting.id, 'delete'); setDeleting(null); toast(count ? `Calendar and ${count} event${count === 1 ? '' : 's'} deleted` : 'Calendar deleted'); }}>{count > 0 ? 'Delete the events too' : 'Delete calendar'}</button>
            <button className="link" onClick={() => setDeleting(null)}>Cancel</button>
          </div>
        </Modal>
      )}
    </>
  );
}

/** R4.3: the export dialog now lives in its own file (richer layers, privacy and alarms). Re-exported so the Calendar page's import is unchanged. */
export { ExportDialog } from './ExportDialog';
