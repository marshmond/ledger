import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { loadCalendarSettings, saveCalendarSettings, type ViewId } from '../../core/calendarSettings';
import { addDays, addMonths, monthLabel } from '../../lib/dates';
import { todayISO } from '../../lib/money';
import { requestTask } from '../../core/taskBridge';
import AgendaView from './AgendaView';
import { DayPanel, DerivedDetail, ExportDialog, Legend, ManageCalendars } from './dialogs';
import { defaultCalendarId, ensureCalendarSeed } from './data';
import EventEditor, { type EditorStart } from './EventEditor';
import MonthView, { monthGridStart } from './MonthView';
import { PERSONAL_ID } from './model';
import type { Occurrence } from './occurrences';
import TimeGrid, { weekStartOf, workWeekDays } from './TimeGrid';
import { dayLabel } from './time';
import { useCalendarData, useLayerVisibility, useNow, type CalItem } from './useCalendarData';
import { dropCovered } from './markerCoordination';

const VIEWS: { id: ViewId; label: string }[] = [
  { id: 'month', label: 'Month' }, { id: 'week', label: 'Week' }, { id: 'workweek', label: 'Work week' }, { id: 'agenda', label: 'Agenda' },
];
const RANGES = [7, 14, 30, 90];
const VIEW_KEY = 'calendar-last-view';
const RANGE_KEY = 'calendar-agenda-range';

const isView = (v: unknown): v is ViewId => v === 'month' || v === 'week' || v === 'workweek' || v === 'agenda';
const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
function read(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
function write(key: string, v: string) { try { localStorage.setItem(key, v); } catch { /* storage unavailable */ } }
const narrow = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 640px)').matches;

type Editor = { occ: Occurrence; start?: undefined } | { occ?: undefined; start: EditorStart };

export default function CalendarPage() {
  const [sp, setSp] = useSearchParams();
  const today = todayISO();
  const now = useNow();
  const settings = useLiveQuery(() => loadCalendarSettings(), []);
  useEffect(() => { void ensureCalendarSeed().catch(() => undefined); }, []);

  // Which view: the address says, else the settings say, else the one used last, else month on a computer and agenda on a phone.
  const fallbackView: ViewId = settings?.openWith && settings.openWith !== 'last' ? settings.openWith : isView(read(VIEW_KEY)) ? (read(VIEW_KEY) as ViewId) : narrow() ? 'agenda' : 'month';
  const view: ViewId = isView(sp.get('v')) ? (sp.get('v') as ViewId) : fallbackView;
  const anchor = isDate(sp.get('d')) ? sp.get('d')! : today;
  const rangeDays = RANGES.includes(Number(sp.get('r'))) ? Number(sp.get('r')) : RANGES.includes(Number(read(RANGE_KEY))) ? Number(read(RANGE_KEY)) : 14;
  const weekStart = settings?.weekStart ?? 0;

  const go = (patch: { v?: ViewId; d?: string; r?: number }) => {
    const next = new URLSearchParams(sp);
    const v = patch.v ?? view;
    next.set('v', v);
    next.set('d', patch.d ?? anchor);
    next.set('r', String(patch.r ?? rangeDays));
    if (patch.v) write(VIEW_KEY, patch.v);
    if (patch.r) write(RANGE_KEY, String(patch.r));
    setSp(next, { replace: true });
  };

  // The days on screen
  const range = useMemo(() => {
    if (view === 'month') { const m = anchor.slice(0, 7); const s = monthGridStart(m, weekStart); return { from: s, to: addDays(s, 41), days: [] as string[] }; }
    if (view === 'week') { const s = weekStartOf(anchor, weekStart); const days = Array.from({ length: 7 }, (_, i) => addDays(s, i)); return { from: days[0], to: days[6], days }; }
    if (view === 'workweek') { const days = workWeekDays(anchor, weekStart); return { from: days[0], to: days[4], days }; }
    return { from: anchor, to: addDays(anchor, rangeDays - 1), days: [] as string[] };
  }, [view, anchor, weekStart, rangeDays]);

  const data = useCalendarData(range.from, range.to, view === 'agenda', now);
  const layerIds = useMemo(() => (data?.layers ?? []).map((l) => l.id), [data]);
  const vis = useLayerVisibility(layerIds);
  // B3.1: a Bills marker is left out only while the Finance marker of its linked Scheduled payment is itself shown (display only; nothing is stored or deleted)
  const items = useMemo(() => dropCovered((data?.items ?? []).filter((i) => vis.isVisible(i.layerId))), [data, vis.vis]); // eslint-disable-line react-hooks/exhaustive-deps
  const defaultCal = useLiveQuery(() => defaultCalendarId(), [settings?.defaultCalendarId]) ?? PERSONAL_ID;

  const [editor, setEditor] = useState<Editor | null>(null);
  const [detail, setDetail] = useState<CalItem | null>(null);
  const [dayOpen, setDayOpen] = useState<string | null>(null);
  const [manage, setManage] = useState(false);
  const [exporting, setExporting] = useState<{ only?: number } | null>(null);

  const openItem = (i: CalItem) => (i.derived ? setDetail(i) : i.occ && setEditor({ occ: i.occ }));

  // #/calendar?new=1 (the "Add an event" action in search) opens a blank event for today (or the date in `d`), then tidies the address.
  const wantNew = sp.get('new');
  useEffect(() => {
    if (!wantNew) return;
    const next = new URLSearchParams(sp); next.delete('new'); next.delete('project'); setSp(next, { replace: true });
    const pid = Number(sp.get('project'));
    setEditor({ start: { date: anchor, ...(Number.isInteger(pid) && pid > 0 ? { projectId: pid } : {}) } });
  }, [wantNew]); // eslint-disable-line react-hooks/exhaustive-deps

  // A link such as #/calendar?d=2026-11-05&open=e:12:2026-11-05 (from the Today screen) opens that event, then tidies the address.
  const openParam = sp.get('open');
  useEffect(() => {
    if (!openParam || !data) return;
    const found = data.items.find((i) => i.key === openParam);
    const next = new URLSearchParams(sp); next.delete('open'); setSp(next, { replace: true });
    if (found) openItem(found);
  }, [openParam, data]); // eslint-disable-line react-hooks/exhaustive-deps

  const step = (dir: 1 | -1) => {
    if (view === 'month') go({ d: addMonths(`${anchor.slice(0, 7)}-01`, dir, 1) });
    else if (view === 'agenda') go({ d: addDays(anchor, dir * rangeDays) });
    else go({ d: addDays(anchor, dir * 7) });
  };
  const title = view === 'month' ? monthLabel(anchor.slice(0, 7)) : `${dayLabel(range.from)} – ${dayLabel(range.to, { year: true })}`;

  if (!settings) return <p className="muted">Loading…</p>;
  return (
    <div className="cal">
      <div className="cal-toolbar">
        <h1 className="cal-title" aria-live="polite">{title}</h1>
        <div className="row cal-nav">
          <button className="btn" onClick={() => step(-1)} aria-label="Previous">‹</button>
          <button className="btn" onClick={() => go({ d: today })} disabled={range.from <= today && range.to >= today && anchor === today}>Today</button>
          <button className="btn" onClick={() => step(1)} aria-label="Next">›</button>
          <label className="cal-jump"><span className="sr-only">Jump to date</span><input type="date" value={anchor} onChange={(e) => e.target.value && go({ d: e.target.value })} aria-label="Jump to date" /></label>
          <button className="btn primary cal-add" onClick={() => setEditor({ start: { date: today >= range.from && today <= range.to ? today : anchor } })}>+ Add event</button>
          <button className="btn cal-addtask" onClick={() => requestTask({ dueDate: today >= range.from && today <= range.to ? today : anchor })}>+ Add task</button>
        </div>
      </div>
      <div className="cal-toolbar2">
        <div className="cal-views" role="tablist" aria-label="View">
          {VIEWS.map((v) => <button key={v.id} role="tab" aria-selected={view === v.id} className={view === v.id ? 'on' : ''} onClick={() => go({ v: v.id })}>{v.label}</button>)}
        </div>
        {view === 'agenda' && (
          <label className="row cal-range">Show <select value={rangeDays} onChange={(e) => go({ r: Number(e.target.value) })} aria-label="Agenda range">{RANGES.map((r) => <option key={r} value={r}>next {r} days</option>)}</select></label>
        )}
        <button className="link" onClick={() => setExporting({})}>Export…</button>
      </div>
      {data && <Legend layers={data.layers} isVisible={vis.isVisible} count={vis.count} onToggle={vis.toggle} onSelectAll={vis.selectAll} onDeselectAll={vis.deselectAll} onManage={() => setManage(true)} />}
      {data && vis.count === 0 && <p className="muted cal-allhidden" role="status">Every calendar is switched off, so nothing is shown. Choose <strong>Select all</strong>, or switch on a calendar above (for example Personal). Nothing was deleted or changed.</p>}

      {!data ? <p className="muted">Loading…</p> : view === 'month' ? (
        <MonthView month={anchor.slice(0, 7)} weekStart={weekStart} today={today} items={items} onCreate={(date) => setEditor({ start: { date } })} onOpenDay={setDayOpen} onOpenItem={openItem} />
      ) : view === 'agenda' ? (
        <AgendaView from={range.from} days={rangeDays} today={today} items={items} onOpenItem={openItem} onCreate={(date) => setEditor({ start: { date } })} />
      ) : (
        <TimeGrid days={range.days} today={today} now={now} items={items} onSlot={(date, minutes) => setEditor({ start: { date, minutes } })} onOpenItem={openItem} onOpenDay={setDayOpen} />
      )}

      {editor && data && <EventEditor key={editor.occ ? `${editor.occ.eventId}:${editor.occ.key}` : 'new'} occ={editor.occ} start={editor.start} layers={data.layers} defaultCalendarId={defaultCal} onClose={() => setEditor(null)} />}
      {detail && <DerivedDetail item={detail} onClose={() => setDetail(null)} />}
      {dayOpen && <DayPanel date={dayOpen} items={items} onOpenItem={openItem} onAdd={(date) => setEditor({ start: { date } })} onAddTask={(date) => requestTask({ dueDate: date })} onClose={() => setDayOpen(null)} />}
      {manage && data && <ManageCalendars layers={data.layers} defaultId={defaultCal} onClose={() => setManage(false)} onExport={(only) => { setManage(false); setExporting({ only }); }} onSetDefault={(id) => void saveCalendarSettings({ defaultCalendarId: id })} />}
      {exporting && data && <ExportDialog layers={data.layers} isVisible={vis.isVisible} only={exporting.only} onClose={() => setExporting(null)} />}
    </div>
  );
}
