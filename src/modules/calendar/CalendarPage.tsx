import { useEffect, useMemo, useState } from 'react';
import { rovingKeys } from '../../ui/rovingKeys';
import { useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { loadCalendarSettings, saveCalendarSettings, type ViewId } from '../../core/calendarSettings';
import { addDays, monthLabel } from '../../lib/dates';
import { useToday } from '../../ui/useToday';
import { PageHeader } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { requestTask } from '../../core/taskBridge';
import AgendaView from './AgendaView';
import { DayPanel, DerivedDetail, ExportDialog, ManageCalendars } from './dialogs';
import { contextLine, stepMonth } from './calendarModel';
import SelectedDay from './SelectedDay';
import LayerMenu from './LayerMenu';
import { defaultCalendarId, ensureCalendarSeed } from './data';
import EventEditor, { type EditorStart } from './EventEditor';
import MonthView, { monthGridStart } from './MonthView';
import { PERSONAL_ID } from './model';
import type { Occurrence } from './occurrences';
import TimeGrid, { weekStartOf, workWeekDays } from './TimeGrid';
import { dayLabel } from './time';
import { lensItems, useCalendarData, useLayerVisibility, useNow, withPeople, type CalItem } from './useCalendarData';
import { useLens } from '../../core/peopleLens';
import { PeopleFilterBar } from '../../ui/PeopleLens';
import { dropCovered } from './markerCoordination';
import NoticeComposer from './notify/NoticeComposer';
import NoticePrompt from './notify/NoticePrompt';
import type { NoticeOffer } from './notify/offers';
import { installDevSwitch } from './notify/devSwitch';
import { declineOffer } from './notify/send';
import { todayISO } from '../../lib/money';

installDevSwitch(); // development builds only (a no-op in the real app)

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
  const today = useToday();
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
  // R4.2: the person filter narrows what the switched-on calendars show (it never changes the calendar switches); each item then carries the household people it names.
  const lens = useLens();
  const items = useMemo(() => withPeople(lensItems(dropCovered((data?.items ?? []).filter((i) => vis.isVisible(i.layerId))), lens.selected, false), lens.byContact), [data, vis.vis, lens.selected, lens.byContact]); // eslint-disable-line react-hooks/exhaustive-deps
  const defaultCal = useLiveQuery(() => defaultCalendarId(), [settings?.defaultCalendarId]) ?? PERSONAL_ID;

  const [editor, setEditor] = useState<Editor | null>(null);
  const [detail, setDetail] = useState<CalItem | null>(null);
  const [dayOpen, setDayOpen] = useState<string | null>(null);
  const [manage, setManage] = useState(false);
  const [exporting, setExporting] = useState<{ only?: number } | null>(null);
  // CAL-N1: the optional "email someone about it?" question after a save or delete. `offer` is the small prompt; `composing` is the review screen. Nothing here sends anything.
  const [offer, setOffer] = useState<NoticeOffer | null>(null);
  const [composing, setComposing] = useState<NoticeOffer | null>(null);
  const notify = (o: NoticeOffer, openNow?: boolean) => { if (openNow) { setOffer(null); setComposing(o); } else setOffer(o); };
  const notNow = () => { const o = offer; setOffer(null); if (o) void declineOffer(o.subject, { today: todayISO() }).catch(() => undefined); };

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
    if (view === 'month') go({ d: stepMonth(anchor, dir) });
    else if (view === 'agenda') go({ d: addDays(anchor, dir * rangeDays) });
    else go({ d: addDays(anchor, dir * 7) });
  };
  const title = view === 'month' ? monthLabel(anchor.slice(0, 7)) : `${dayLabel(range.from)} – ${dayLabel(range.to, { year: true })}`;

  if (!settings) return <p className="muted">Loading…</p>;
  const ctx = contextLine(today);
  const addDate = today >= range.from && today <= range.to ? today : anchor;
  const sideDay = view === 'month';
  return (
    <div className="cal">
      <PageHeader
        title="Calendar"
        eyebrow="Productivity"
        description={<><b>{ctx.weekday}</b> · {ctx.rest}</>}
        actions={
          <div className="cal-head-actions">
            <button className="btn primary cal-add" onClick={() => setEditor({ start: { date: addDate } })}><Icon name="plus" size={16} /> Add event</button>
            <button className="btn cal-addtask" onClick={() => requestTask({ dueDate: addDate })}><Icon name="plus" size={16} /> Add task</button>
          </div>
        }
      />
      <div className="cal-bar">
        <div className="cal-bar-nav">
          <div className="cal-stepper" role="group" aria-label="Change period">
            <button className="btn cal-step" onClick={() => step(-1)} aria-label="Previous"><Icon name="chevron-down" size={16} className="cal-chev cal-chev-prev" /></button>
            <button className="btn cal-today-btn" onClick={() => go({ d: today })} disabled={range.from <= today && range.to >= today && anchor === today}>Today</button>
            <button className="btn cal-step" onClick={() => step(1)} aria-label="Next"><Icon name="chevron-down" size={16} className="cal-chev cal-chev-next" /></button>
          </div>
          <h2 className="cal-period" aria-live="polite">{title}</h2>
        </div>
        <div className="cal-bar-tools">
          <div className="ui-seg cal-views" role="tablist" aria-label="View" onKeyDown={rovingKeys}>
            {VIEWS.map((v) => <button key={v.id} role="tab" aria-selected={view === v.id} tabIndex={(view === v.id) ? 0 : -1} className={view === v.id ? 'on' : ''} onClick={() => go({ v: v.id })}>{v.label}</button>)}
          </div>
          {view === 'agenda' && (
            <label className="row cal-range">Show <select value={rangeDays} onChange={(e) => go({ r: Number(e.target.value) })} aria-label="Agenda range">{RANGES.map((r) => <option key={r} value={r}>next {r} days</option>)}</select></label>
          )}
          {data && <LayerMenu layers={data.layers.map((l) => ({ id: l.id, name: l.name, color: l.color, derived: l.sourceType === 'derived' }))} isVisible={vis.isVisible} onToggle={vis.toggle} onSelectAll={vis.selectAll} onDeselectAll={vis.deselectAll} onManage={() => setManage(true)} />}
          <label className="cal-jump"><span className="sr-only">Jump to date</span><input type="date" value={anchor} onChange={(e) => e.target.value && go({ d: e.target.value })} aria-label="Jump to date" /></label>
          <button className="link cal-export" onClick={() => setExporting({})}>Export…</button>
        </div>
      </div>
      <PeopleFilterBar lens={lens} note="Only events, tasks and family dates that name them are listed here. Your calendar switches under Layers are unchanged." />
      {data && vis.count === 0 && <p className="muted cal-allhidden" role="status">Every calendar is switched off, so nothing is shown. Open <strong>Layers</strong> and choose <strong>Select all</strong>, or switch on a calendar (for example Personal). Nothing was deleted or changed.</p>}

      {!data ? <p className="muted">Loading…</p> : (
        <div className={`cal-body${sideDay ? ' with-side' : ''}`}>
          <div className="cal-stage">
            {view === 'month' ? (
              <MonthView month={anchor.slice(0, 7)} selected={anchor} weekStart={weekStart} today={today} items={items} onSelect={(date) => go({ d: date })} onCreate={(date) => setEditor({ start: { date } })} onOpenItem={openItem} />
            ) : view === 'agenda' ? (
              <AgendaView from={range.from} days={rangeDays} today={today} items={items} onOpenItem={openItem} onCreate={(date) => setEditor({ start: { date } })} />
            ) : (
              <TimeGrid days={range.days} today={today} now={now} items={items} onSlot={(date, minutes) => setEditor({ start: { date, minutes } })} onOpenItem={openItem} onOpenDay={setDayOpen} />
            )}
          </div>
          {sideDay && (
            <aside className="cal-side" aria-label="Selected day">
              <SelectedDay date={anchor} today={today} items={items} onOpenItem={openItem} onAdd={(date) => setEditor({ start: { date } })} onAddTask={(date) => requestTask({ dueDate: date })} />
            </aside>
          )}
        </div>
      )}

      {editor && data && <EventEditor key={editor.occ ? `${editor.occ.eventId}:${editor.occ.key}` : 'new'} occ={editor.occ} start={editor.start} layers={data.layers} defaultCalendarId={defaultCal} onClose={() => setEditor(null)} onNotify={notify} />}
      {offer && !composing && <NoticePrompt offer={offer} onNotNow={notNow} onChoose={() => { setComposing(offer); setOffer(null); }} />}
      {composing && <NoticeComposer offer={composing} onClose={() => setComposing(null)} />}
      {detail && <DerivedDetail item={detail} onClose={() => setDetail(null)} />}
      {dayOpen && <DayPanel date={dayOpen} items={items} onOpenItem={openItem} onAdd={(date) => setEditor({ start: { date } })} onAddTask={(date) => requestTask({ dueDate: date })} onClose={() => setDayOpen(null)} />}
      {manage && data && <ManageCalendars layers={data.layers} defaultId={defaultCal} onClose={() => setManage(false)} onExport={(only) => { setManage(false); setExporting({ only }); }} onSetDefault={(id) => void saveCalendarSettings({ defaultCalendarId: id })} />}
      {exporting && data && <ExportDialog layers={data.layers} isVisible={vis.isVisible} only={exporting.only} onClose={() => setExporting(null)} />}
    </div>
  );
}
