import { useState } from 'react';
import { allDueProviders } from '../../core/dueProvider';
import { addDays } from '../../lib/dates';
import { downloadText } from '../../lib/download';
import { todayISO } from '../../lib/money';
import { store } from '../../core/store';
import { queryProviders } from '../../core/dueProvider';
import Modal from '../../shell/Modal';
import { useToast } from '../../ui/Toast';
import { DayItems } from './SelectedDay';
import { buildIcs } from './ics';
import { loadEvents, createCalendar, deleteCalendar, updateCalendar } from './data';
import { PRIORITY_LABEL, PERSONAL_ID, SWATCHES, type CalendarLayer } from './model';
import { PriorityMark } from './parts';
import { loadHideAmounts } from '../../core/hideAmounts';
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
    toast(`Done: ${item.title}`, async () => { await act!.reopen?.(); });
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
                {l.sourceType === 'local' && <button className="link" onClick={() => onExport(l.id)}>Export</button>}
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

/** Download a calendar file (.ics) of one calendar or of everything visible. */
export function ExportDialog({ layers, isVisible, only, onClose }: { layers: CalendarLayer[]; isVisible: (id: number) => boolean; only?: number; onClose: () => void }) {
  const toast = useToast();
  const [includeFinance, setIncludeFinance] = useState(false);
  const [busy, setBusy] = useState(false);
  const provLayers = layers.filter((l) => l.sourceType === 'derived' && l.providerId);
  const finance = provLayers.find((l) => l.providerId === 'ledger');
  const chosen = only !== undefined ? layers.filter((l) => l.id === only) : layers.filter((l) => l.sourceType === 'local' && isVisible(l.id));
  const hideAmounts = loadHideAmounts();

  const run = async () => {
    setBusy(true);
    const events = (await loadEvents()).filter((e) => chosen.some((c) => c.id === e.data.calendarId));
    const tags = new Map((await store.shared.tags.query()).map((t) => [t.id as number, t.name]));
    let derived: Awaited<ReturnType<typeof queryProviders>>[string] = [];
    if (includeFinance && finance && only === undefined) {
      const today = todayISO();
      const p = allDueProviders().filter((x) => x.id === finance.providerId);
      // The same stretch of time the existing Ledger file covers: from today for a year.
      derived = (await queryProviders({ from: today, to: addDays(today, 365), today, overdueDays: 0 }, p))[finance.providerId!] ?? [];
    }
    const name = only !== undefined ? chosen[0]?.name ?? 'Calendar' : 'Calendar';
    const text = buildIcs({ name, events, derived, nowIso: new Date().toISOString(), tagName: (id) => tags.get(id) });
    downloadText(`${name.replace(/[^\w-]+/g, '-').toLowerCase()}.ics`, 'text/calendar', text);
    toast(`Downloaded ${events.length} event${events.length === 1 ? '' : 's'}${derived.length ? ` and ${derived.length} finance date${derived.length === 1 ? '' : 's'}` : ''}`);
    setBusy(false);
    onClose();
  };
  return (
    <Modal title="Export a calendar file (.ics)" onClose={onClose}>
      <p>{only !== undefined ? <>Exports <strong>{chosen[0]?.name}</strong>.</> : <>Exports your {chosen.length} visible calendar{chosen.length === 1 ? '' : 's'}: {chosen.map((c) => c.name).join(', ') || 'none'}.</>}</p>
      {only === undefined && finance && (
        <label className="row cal-check">
          <input type="checkbox" checked={includeFinance} onChange={(e) => setIncludeFinance(e.target.checked)} />
          Also include the Finance layer (the next 12 months)
        </label>
      )}
      {only === undefined && finance && <p className="muted small">Off by default. If your phone calendar already has Ledger's "Add to my calendar" file, the bills here use the same ids, so they are not shown twice.</p>}
      {only === undefined && finance && includeFinance && hideAmounts && <p className="bl-warn small" role="note">Hide Amounts is on, but this file still includes the amounts of your scheduled Finance items, as Ledger's own calendar file does. Leave the Finance layer out if you do not want the amounts to leave this screen.</p>}
      {only === undefined && chosen.length === 0 && <p className="muted small">None of your own calendars is switched on. Switch one on in the Calendar, or pick one under Manage calendars and choose Export.</p>}
      <p className="muted small">This only creates a file on this device. Nothing is sent anywhere, and repeats, all-day dates and reminders are included.</p>
      <div className="row cal-actions"><button className="btn primary" disabled={busy || chosen.length === 0} onClick={() => void run()}>Download</button><button className="btn" onClick={onClose}>Cancel</button></div>
    </Modal>
  );
}

