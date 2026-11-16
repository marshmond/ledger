import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSearchParams } from 'react-router-dom';
import { loadCalendarSettings } from '../../core/calendarSettings';
import { nameList } from '../../core/householdPeople';
import { useLens } from '../../core/peopleLens';
import { Link } from '../../core/router';
import { addDays } from '../../lib/dates';
import { downloadText } from '../../lib/download';
import Modal from '../../shell/Modal';
import { DateTile } from '../../ui/DateTile';
import { EmptyState, PageHeader } from '../../ui/components';
import { PeopleChips, PeopleFilterBar } from '../../ui/PeopleLens';
import { useToast } from '../../ui/Toast';
import { useToday } from '../../ui/useToday';
import { readVisibility } from '../calendar/useCalendarData';
import { weekStartOf } from '../calendar/TimeGrid';
import { dayLabel } from '../calendar/time';
import { entriesOf, narrowFamilyView, readFamilyView, type FamilyEntry, type FamilyView } from './familyView';
import { EXPORT_DAYS, readFamilyIcs } from './familyIcs';

const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const KIND: Record<FamilyEntry['kind'], string> = { event: 'Event', task: 'Task', birthday: 'Birthday', date: 'Date' };
const STATUS_WORDS: Partial<Record<FamilyEntry['status'], string>> = { done: 'Done', overdue: 'Overdue', waiting: 'Waiting', 'in-progress': 'In progress' };

/** "4:00 PM" from a stored `HH:MM`. */
function clock(hm: string): string {
  const [h, m] = hm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
/** The time column for an entry on a given day: a time, "All day", or how a multi-day item continues. */
export function whenOnDay(e: Pick<FamilyEntry, 'kind' | 'allDay' | 'startTime' | 'endTime' | 'firstDay' | 'lastDay'>, date: string): string {
  if (e.lastDay > e.firstDay) {
    if (date > e.firstDay) return date < e.lastDay ? 'Continues' : `Ends${e.allDay || !e.endTime ? '' : ` ${clock(e.endTime)}`}`;
    return e.allDay || !e.startTime ? `Starts, to ${dayLabel(e.lastDay)}` : `${clock(e.startTime)}, to ${dayLabel(e.lastDay)}`;
  }
  if (e.allDay || !e.startTime) return e.kind === 'task' ? 'No time set' : 'All day';
  return e.endTime ? `${clock(e.startTime)} – ${clock(e.endTime)}` : clock(e.startTime);
}
/** "Sun, Nov 15 – Sat, Nov 21, 2026". */
export const rangeText = (from: string, to: string) => `${dayLabel(from)} – ${dayLabel(to, { year: true })}`;

function Entry({ e, date, when }: { e: FamilyEntry; date: string; when?: string }) {
  const word = STATUS_WORDS[e.status];
  return (
    <li className={`fm-wk-item fm-wk-${e.kind}${e.status === 'done' ? ' done' : ''}`}>
      <span className="fm-wk-when">{when ?? whenOnDay(e, date)}</span>
      <div className="fm-wk-main">
        <span className="fm-wk-line">
          <span className="fm-wk-kind">{KIND[e.kind]}</span>
          <a className="fm-item-title" href={e.link}>{e.title}</a>
          {word && <span className={`ui-chip${e.status === 'overdue' ? ' ui-chip--overdue' : e.status === 'done' ? ' ui-chip--done' : ''}`}>{word}</span>}
          {e.recurring && e.kind !== 'birthday' && e.kind !== 'date' && <span className="muted small">Repeats</span>}
        </span>
        {e.people.length > 0 ? <PeopleChips people={e.people} max={6} /> : <span className="muted small">Whole household</span>}
      </div>
      <span className="fm-wk-src small muted">{e.source}</span>
    </li>
  );
}

function ExportDialog({ selected, onClose, who }: { selected: readonly number[]; who: string; onClose: () => void }) {
  const toast = useToast();
  const today = useToday();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const run = async () => {
    setBusy(true); setProblem('');
    try {
      const f = await readFamilyIcs({ today, visibility: readVisibility(), selected });
      downloadText('family-calendar.ics', 'text/calendar', f.text);
      toast(`Downloaded ${f.eventCount} event${f.eventCount === 1 ? '' : 's'} and ${f.dateCount} family date${f.dateCount === 1 ? '' : 's'}`);
      onClose();
    } catch {
      setProblem('The file could not be made. Nothing was saved or changed.');
      setBusy(false);
    }
  };
  return (
    <Modal title="Download a family calendar file (.ics)" onClose={onClose}>
      <p>Makes a calendar file of {who}'s schedule for the next 12 months ({EXPORT_DAYS} days).</p>
      <p><strong>Included:</strong> Calendar events that name a family member (title, date and time, repeat rule, and who it is for) and family birthdays and important dates.</p>
      <p><strong>Not included:</strong> money, bills, payments, accounts, services, home and project items, Tasks, locations, notes and reminders.</p>
      <p className="muted small">This is a snapshot. It does not update itself: download a new one after you change something. The file is only created on this device; nothing is sent anywhere. Event titles are written as you typed them, so check they are fine to share before you give the file to anyone.</p>
      {problem && <p className="ui-dialog-error" role="alert">{problem}</p>}
      <div className="row fm-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={busy} onClick={() => void run()}>{busy ? 'Making the file…' : 'Download'}</button></div>
    </Modal>
  );
}

/**
 * Family → This week (R4.2): the household's week, day by day, from the shared Family view reader (`readFamilyView`, owner audience). Read-only: nothing here
 * creates or changes a Calendar event, Task or member. The week is the Calendar's own (its first-day-of-week setting). The same list is what Print week prints
 * and what the family calendar file starts from.
 */
export default function WeekPage() {
  const today = useToday();
  const [sp, setSp] = useSearchParams();
  const settings = useLiveQuery(() => loadCalendarSettings(), []);
  const lens = useLens();
  const [exporting, setExporting] = useState(false);
  const anchor = isDate(sp.get('d')) ? sp.get('d')! : today;
  const from = weekStartOf(anchor, settings?.weekStart ?? 0);
  const to = addDays(from, 6);
  const result = useLiveQuery(
    () => readFamilyView('owner', { from, to, today, visibility: readVisibility() }).then((v): { view: FamilyView } | { failed: true } => ({ view: v })).catch((): { failed: true } => ({ failed: true })),
    [from, to, today],
  );
  const go = (d: string) => { const n = new URLSearchParams(sp); n.set('d', d); setSp(n, { replace: true }); };
  const everyone = result && 'view' in result ? result.view : null;
  const view = useMemo(() => (everyone ? narrowFamilyView(everyone, lens.selected) : null), [everyone, lens.selected]);
  const who = lens.active ? nameList(lens.chosen.map((p) => p.name)) : 'everyone';
  const total = view ? entriesOf(view).length : 0;

  const head = (
    <PageHeader
      title="This week"
      eyebrow="Family"
      description={<time dateTime={from}>{rangeText(from, to)}</time>}
      className="fm-noprint"
      actions={
        <span className="row fm-wk-actions">
          <span className="ui-seg fm-wk-nav" role="group" aria-label="Change week">
            <button type="button" aria-label="Previous week" onClick={() => go(addDays(from, -7))}>‹ Previous</button>
            <button type="button" aria-label="This week" disabled={from <= today && to >= today} onClick={() => go(today)}>This week</button>
            <button type="button" aria-label="Next week" onClick={() => go(addDays(from, 7))}>Next ›</button>
          </span>
          <button type="button" className="btn" onClick={() => window.print()} disabled={!view}>Print week</button>
          <button type="button" className="btn" onClick={() => setExporting(true)} disabled={!view || view.people.length === 0}>Download family calendar</button>
        </span>
      }
    />
  );

  if (result && 'failed' in result) {
    return <div className="fm fm-wk">{head}<div className="ui-state ui-state--bad" role="alert"><p><strong>The week could not be read.</strong></p><p>Nothing was changed. Reload the page; if it keeps happening, your backup is untouched and you can restore it from Settings.</p></div></div>;
  }
  if (!view) return <div className="fm fm-wk">{head}<p className="muted" role="status">Loading…</p></div>;
  if (view.people.length === 0) {
    return (
      <div className="fm fm-wk">
        {head}
        <EmptyState title="No family members yet" action={<Link to="/" className="btn primary">Go to Family</Link>}>Add the people in your household first. The week then lists the events and tasks that name them, and their birthdays.</EmptyState>
      </div>
    );
  }

  return (
    <div className="fm fm-wk">
      {head}
      <div className="fm-noprint"><PeopleFilterBar lens={lens} note="Shared events appear once, with everyone they name." /></div>
      {/* On paper only: what this page is, for whom, and a plain way to read the labels. */}
      <div className="fm-printonly">
        <h1>Family week: {rangeText(from, to)}</h1>
        <p>Showing {who}. {total === 0 ? 'Nothing is planned.' : `${total} item${total === 1 ? '' : 's'}.`} Each line says whether it is an event, a task, a birthday or a date, and names the people it concerns.</p>
      </div>
      {view.hiddenCount > 0 && <p className="muted small fm-noprint" role="status">{view.hiddenCount} {view.hiddenCount === 1 ? 'event is' : 'events are'} not shown because {view.hiddenCount === 1 ? 'its calendar is' : 'their calendars are'} switched off on this device. Switch {view.hiddenCount === 1 ? 'it' : 'them'} back on under Layers in the Calendar.</p>}

      {view.carriedOver.length > 0 && (
        <section className="card fm-wk-day fm-wk-carried" aria-labelledby="fm-wk-carried">
          <h2 className="card-title" id="fm-wk-carried">Still open from earlier <span className="badge">{view.carriedOver.length}</span></h2>
          <ul className="plain fm-wk-list">{view.carriedOver.map((e) => <Entry key={e.key} e={e} date={e.firstDay} when={`Due ${dayLabel(e.firstDay)}`} />)}</ul>
        </section>
      )}

      {total === 0 && <p className="muted fm-wk-none" role="status">{lens.active ? `Nothing is planned for ${who} this week.` : 'Nothing is planned for the household this week.'} Events and tasks appear here when they name a family member under “People”.</p>}

      <div className="fm-wk-days">
        {view.days.map((d) => (
          <section key={d.date} className={`card fm-wk-day${d.date === today ? ' today' : ''}`} aria-labelledby={`fm-wk-${d.date}`}>
            <div className="fm-wk-head">
              <DateTile iso={d.date} today={today} size="sm" labelled={false} />
              <h2 className="card-title" id={`fm-wk-${d.date}`}>{dayLabel(d.date, { weekday: 'long' }).split(',')[0]}<span className="sr-only">, {dayLabel(d.date).replace(/^[^,]*, /, '')}</span>{d.date === today && <span className="ui-chip ui-chip--active">Today</span>}</h2>
              {d.entries.length > 0 ? <span className="badge">{d.entries.length}</span> : <span className="muted small fm-wk-empty">{lens.active ? `Nothing for ${who}.` : 'Nothing planned.'}</span>}
            </div>
            {d.entries.length > 0 && <ul className="plain fm-wk-list">{d.entries.map((e) => <Entry key={e.key} e={e} date={d.date} />)}</ul>}
          </section>
        ))}
      </div>

      <p className="muted small fm-noprint fm-wk-foot">Only events and tasks that name a family member are listed; the rest stay in the <a href="#/calendar?v=week">Calendar</a> and <a href="#/tasks">Tasks</a>. Nothing here can be edited: open an item to change it. A downloaded calendar file is a snapshot and does not update itself.</p>
      <p className="fm-printonly small">Printed from Ledger. A snapshot of {rangeText(from, to)}.</p>
      {exporting && <ExportDialog selected={lens.selected} who={who} onClose={() => setExporting(false)} />}
    </div>
  );
}
