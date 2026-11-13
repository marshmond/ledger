import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from '../../core/router';
import { PRIORITY_LABEL } from '../../core/priority';
import { EmptyState } from '../../ui/components';
import { DateTile } from '../../ui/DateTile';
import { todayISO } from '../../lib/money';
import { nextOccurrence } from './calendarDates';
import { dayLabel, timeLabel } from '../calendar/time';
import { readVisibility } from '../calendar/useCalendarData';
import { loadDates } from './dateData';
import { DATE_KIND_LABEL } from './dateModel';
import { DATES_ROUTE, monthDayText } from './model';
import { calendarLink, readMemberSchedule, scheduleWhen } from './memberSchedule';
import { projectStatusText, readMemberProjects, readMemberTasks, taskWhen } from './memberWork';

/** How many rows each list shows before "Show all". Keeps a busy household's page short on a phone. */
const SHOWN = 8;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function More({ total, shown, setShown, what }: { total: number; shown: boolean; setShown: (v: boolean) => void; what: string }) {
  if (total <= SHOWN) return null;
  return (
    <button type="button" className="btn fm-mini" aria-expanded={shown} onClick={() => setShown(!shown)}>
      {shown ? `Show fewer ${what}` : `Show all ${total} ${what}`}
    </button>
  );
}

/** "Also for: Robin, Alex": the OTHER household members a record names. Names come from the shared Contacts; nothing else is shown. */
function Also({ names }: { names: string[] }) {
  return names.length ? <span className="muted small">Also for: {names.join(', ')}</span> : null;
}

/** Upcoming Calendar events that name this person. Read-only: each row opens the event in the Calendar. */
export function ScheduleSection({ contactId, today, nameOfContact }: { contactId: number; today: string; nameOfContact: (id: number) => string }) {
  const sched = useLiveQuery(() => readMemberSchedule(contactId, today, readVisibility()), [contactId, today]);
  const [all, setAll] = useState(false);
  const items = sched?.items ?? [];
  const shown = all ? items : items.slice(0, SHOWN);
  return (
    <section className="card" aria-labelledby="fm-schedule">
      <div className="card-head"><h2 className="card-title" id="fm-schedule">Schedule</h2></div>
      {!sched ? <p className="muted" role="status">Loading…</p> : items.length === 0 ? (
        <EmptyState title={sched.hiddenCount > 0 ? 'No events shown' : 'Nothing in the next 30 days'}>
          Events appear here when they name this person under “People” in the Calendar.
        </EmptyState>
      ) : (
        <>
          <p className="muted small">The next 30 days, from your Calendar. Open an event there to change it.</p>
          <ul className="plain fm-items">
            {shown.map((it) => (
              <li key={it.key} className="fm-item">
                <DateTile iso={it.firstDay} today={today} size="sm" labelled={false} />
                <span className="fm-bar" style={{ background: it.color }} aria-hidden="true" />
                <div className="fm-item-text">
                  <a className="fm-item-title" href={calendarLink(it)}>{it.title}</a>
                  <span className="muted small">{scheduleWhen(it)}{it.recurring ? ' · Repeats' : ''}{it.done ? ' · Done' : ''}</span>
                  <span className="muted small">{it.calendarName}{it.location ? ` · ${it.location}` : ''}</span>
                  <Also names={it.also.map((a) => nameOfContact(a.contactId))} />
                </div>
              </li>
            ))}
          </ul>
          <More total={items.length} shown={all} setShown={setAll} what="events" />
        </>
      )}
      {sched && sched.hiddenCount > 0 && (
        <p className="muted small" role="status">{plural(sched.hiddenCount, 'upcoming event is', 'upcoming events are')} not shown because {sched.hiddenCount === 1 ? 'its calendar is' : 'their calendars are'} switched off on this device. You can switch {sched.hiddenCount === 1 ? 'it' : 'them'} back on under Layers in the Calendar.</p>
      )}
    </section>
  );
}

/** Open Tasks that name this person. Read-only: each row opens the Task in Tasks, where it is completed or changed. */
export function TodoSection({ contactId, today, nameOfContact, otherContacts }: { contactId: number; today: string; nameOfContact: (id: number) => string; otherContacts: ReadonlySet<number> }) {
  const res = useLiveQuery(() => readMemberTasks(contactId, today), [contactId, today]);
  const [all, setAll] = useState(false);
  const tasks = res?.tasks ?? [];
  const shown = all ? tasks : tasks.slice(0, SHOWN);
  return (
    <section className="card" aria-labelledby="fm-todo">
      <div className="card-head"><h2 className="card-title" id="fm-todo">Related tasks</h2></div>
      {!res ? <p className="muted" role="status">Loading…</p> : tasks.length === 0 ? (
        <EmptyState title="No related tasks">
          Open tasks appear here when they name this person under “People” in Tasks. Being named on a task does not make someone responsible for it. A task you finish, or one you take them off, leaves this list.
        </EmptyState>
      ) : (
        <>
          <p className="muted small">
            {plural(tasks.length, 'open task', 'open tasks')}{res.overdue > 0 ? `, ${res.overdue} overdue` : ''}. Open one in Tasks to finish or change it. A task you take this person off leaves this list.
          </p>
          <ul className="plain fm-items">
            {shown.map((t) => {
              const when = taskWhen(t);
              const late = !!t.data.dueDate && t.data.dueDate < today;
              const others = t.data.contactIds.filter((c) => c !== contactId && otherContacts.has(c));
              return (
                <li key={t.id} className="fm-item">
                  {when ? <DateTile iso={when.date} today={today} size="sm" overdue={late} labelled={false} /> : <span className="fm-tile-none" aria-hidden="true" />}
                  <div className="fm-item-text">
                    <a className="fm-item-title" href={`#/tasks?task=${t.id}`}>{t.data.title}</a>
                    <span className="muted small">
                      {when ? `${when.label} ${dayLabel(when.date)}${when.time ? `, ${timeFromHM(when.time)}` : ''}` : 'No date'}
                      {late && <> · <strong className="fm-late">Overdue</strong></>}
                      {t.data.repeat ? ' · Repeats' : ''}
                      {t.data.status === 'waiting' ? ' · Waiting' : t.data.status === 'doing' ? ' · In progress' : ''}
                      {t.data.priority === 'high' ? ` · ${PRIORITY_LABEL.high}` : ''}
                    </span>
                    <Also names={[...new Set(others)].map(nameOfContact)} />
                  </div>
                </li>
              );
            })}
          </ul>
          <More total={tasks.length} shown={all} setShown={setAll} what="tasks" />
        </>
      )}
    </section>
  );
}

/** "16:30" as the device's usual time style. */
function timeFromHM(hm: string): string {
  const [h, m] = hm.split(':').map(Number);
  return timeLabel(new Date(2000, 0, 1, h, m).getTime());
}

/** Projects whose “Vendors and people” list names this person. Read-only: each row opens the project. */
export function ProjectsSection({ contactId }: { contactId: number }) {
  const res = useLiveQuery(() => readMemberProjects(contactId), [contactId]);
  const [all, setAll] = useState(false);
  const list = res ? [...res.open, ...res.finished, ...res.archived] : [];
  const shown = all ? list : list.slice(0, SHOWN);
  return (
    <section className="card" aria-labelledby="fm-projects">
      <div className="card-head"><h2 className="card-title" id="fm-projects">Projects</h2></div>
      {!res ? <p className="muted" role="status">Loading…</p> : list.length === 0 ? (
        <EmptyState title="No projects">
          A project appears here when this person is listed under “Vendors and people” on it. Ledger never guesses from a project’s name.
        </EmptyState>
      ) : (
        <>
          <ul className="plain fm-items">
            {shown.map((p) => (
              <li key={p.id} className="fm-item">
                <div className="fm-item-text">
                  <a className="fm-item-title" href={`#/projects/${p.id}`}>{p.data.name}</a>
                  <span className="muted small">{projectStatusText(p)}{p.data.targetDate ? ` · Target ${dayLabel(p.data.targetDate, { year: true })}` : ''}</span>
                </div>
              </li>
            ))}
          </ul>
          <More total={list.length} shown={all} setShown={setAll} what="projects" />
        </>
      )}
    </section>
  );
}

/** The important dates (anniversaries and others) that are about this member. Their birthday is on the profile above. */
export function MemberDatesSection({ memberId, today = todayISO() }: { memberId: number; today?: string }) {
  const dates = useLiveQuery(() => loadDates(), []);
  const mine = (dates ?? []).filter((r) => r.data?.status === 'active' && r.data.memberId === memberId);
  return (
    <section className="card" aria-labelledby="fm-mdates">
      <div className="card-head"><h2 className="card-title" id="fm-mdates">Important dates</h2></div>
      {!dates ? <p className="muted" role="status">Loading…</p> : mine.length === 0 ? (
        <p className="muted">No other dates are set for this person. Their birthday is in the profile.</p>
      ) : (
        <ul className="plain fm-items">
          {mine.map((r) => (
            <li key={r.id} className="fm-item">
              <DateTile iso={nextOccurrence(r.data!.monthDay, today)} today={today} size="sm" special labelled={false} />
              <div className="fm-item-text">
                <span className="fm-item-title">{r.data!.label}</span>
                <span className="muted small">{monthDayText(r.data!.monthDay)} · {DATE_KIND_LABEL[r.data!.dateKind]}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p><Link to={DATES_ROUTE} className="small">All family dates</Link></p>
    </section>
  );
}
