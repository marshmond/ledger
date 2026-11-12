import { useState } from 'react';
import { Link } from '../../core/router';
import { PRIORITY_LABEL } from '../../core/priority';
import { EmptyState } from '../../ui/components';
import { MemberDot } from '../../ui/MemberIdentity';
import { memberColorId } from './memberIdentity';
import { dayLabel, timeLabel } from '../calendar/time';
import { ACTIVITY_DAYS, DATE_DAYS, type HouseholdActivity, type HouseholdDate, type HouseholdTask, type PersonRef } from './householdOverview';
import { calendarLink, scheduleWhen } from './memberSchedule';
import { DATES_ROUTE, memberRoute } from './model';
import { DATE_KIND_LABEL } from './dateModel';

/** Rows shown before "Show all". A short list on a phone; "Show all" itself stops at SHOW_ALL_MAX and points to the owning screen for the rest. */
export const PREVIEW = 6;
export const SHOW_ALL_MAX = 50;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Days from `today` to `date` (both `YYYY-MM-DD`), counted on the calendar so no time zone or daylight-saving change can move it. */
export function daysUntil(today: string, date: string): number {
  const u = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((u(date) - u(today)) / 86_400_000);
}
export const inWords = (n: number) => (n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n < 0 ? `${-n} days ago` : `In ${n} days`);

/** "16:30" as the device's usual time style. */
function timeFromHM(hm: string): string {
  const [h, m] = hm.split(':').map(Number);
  return timeLabel(new Date(2000, 0, 1, h, m).getTime());
}

/** Everyone a row names, as color dots with their NAMES in text (color is never the only cue). Each name opens that member's profile. */
function People({ label, people }: { label: string; people: readonly PersonRef[] }) {
  return (
    <span className="fm-people small">
      <span className="muted">{label}</span>
      {people.map((p) => (
        <Link key={p.memberId} to={memberRoute(p.memberId)} className="fm-chip">
          <MemberDot colorId={memberColorId(p.color)} />{p.name}
        </Link>
      ))}
    </span>
  );
}

function More({ total, open, setOpen, what }: { total: number; open: boolean; setOpen: (v: boolean) => void; what: string }) {
  if (total <= PREVIEW) return null;
  return <button type="button" className="btn fm-mini" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? `Show fewer ${what}` : `Show all ${total} ${what}`}</button>;
}

function visible<T>(list: readonly T[], open: boolean): T[] { return open ? list.slice(0, SHOW_ALL_MAX) : list.slice(0, PREVIEW); }

/** Upcoming activities: the next 7 days of Calendar events that name a household member. Read-only; each title opens that occurrence in the Calendar. */
export function ActivitiesSection({ items, hiddenCount, today, who }: { items: readonly HouseholdActivity[]; hiddenCount: number; today: string; who: string | null }) {
  const [open, setOpen] = useState(false);
  const shown = visible(items, open);
  return (
    <section className="card" aria-labelledby="fm-hh-act">
      <div className="card-head"><h2 className="card-title" id="fm-hh-act">Activities, next {ACTIVITY_DAYS} days</h2><span className="muted small">{items.length}</span></div>
      {items.length === 0 ? (
        <EmptyState title={hiddenCount > 0 ? 'No activities shown' : `Nothing planned in the next ${ACTIVITY_DAYS} days`}>
          {who ? `${who} is not named on any upcoming Calendar event.` : 'Events appear here when they name a household member under “People” in the Calendar.'}
        </EmptyState>
      ) : (
        <>
          <ul className="plain fm-items">
            {shown.map((it) => (
              <li key={it.key} className="fm-item">
                <span className="fm-bar" style={{ background: it.color }} aria-hidden="true" />
                <div className="fm-item-text">
                  <a className="fm-item-title" href={calendarLink(it)}>{it.title}</a>
                  <span className="muted small">{scheduleWhen(it)}{it.recurring ? ' · Repeats' : ''}{it.done ? ' · Done' : ''} · {it.calendarName}</span>
                  <People label="People:" people={it.people} />
                </div>
              </li>
            ))}
          </ul>
          <More total={items.length} open={open} setOpen={setOpen} what="activities" />
          {open && items.length > SHOW_ALL_MAX && <p className="muted small">Showing the first {SHOW_ALL_MAX}. The Calendar has the rest.</p>}
        </>
      )}
      {hiddenCount > 0 && (
        <p className="muted small" role="status">{plural(hiddenCount, 'upcoming activity is', 'upcoming activities are')} not shown because {hiddenCount === 1 ? 'its calendar is' : 'their calendars are'} switched off on this device. You can switch {hiddenCount === 1 ? 'it' : 'them'} back on under Layers in the Calendar.</p>
      )}
      <p><a className="small fm-foot" href={`#/calendar?v=agenda&d=${today}`}>Open the Calendar</a></p>
    </section>
  );
}

/** Responsibilities: open Tasks that name a household member. Read-only; each title opens the Task in Tasks, where it is finished or changed. */
export function ResponsibilitiesSection({ items, who }: { items: readonly HouseholdTask[]; who: string | null }) {
  const [open, setOpen] = useState(false);
  const shown = visible(items, open);
  const overdue = items.filter((t) => t.overdue).length;
  return (
    <section className="card" aria-labelledby="fm-hh-todo">
      <div className="card-head"><h2 className="card-title" id="fm-hh-todo">Responsibilities</h2><span className="muted small">{items.length}</span></div>
      {items.length === 0 ? (
        <EmptyState title="No open tasks">
          {who ? `${who} is not named on any open task.` : 'Open tasks appear here when they name a household member under “People” in Tasks.'}
        </EmptyState>
      ) : (
        <>
          <p className="muted small">
            {plural(items.length, 'open task', 'open tasks')}{overdue > 0 ? `, ${overdue} overdue` : ''}. These are tasks that name a household member; Ledger does not record who has to do them. Open one in Tasks to finish or change it.
          </p>
          <ul className="plain fm-items">
            {shown.map((t) => (
              <li key={t.id} className="fm-item">
                <div className="fm-item-text">
                  <a className="fm-item-title" href={`#/tasks?task=${t.id}`}>{t.title}</a>
                  <span className="muted small">
                    {t.when ? `${t.when.label} ${dayLabel(t.when.date)}${t.when.time ? `, ${timeFromHM(t.when.time)}` : ''}` : 'No date'}
                    {t.overdue && <> · <strong className="fm-late">Overdue</strong></>}
                    {t.high && <> · <strong>{PRIORITY_LABEL.high} priority</strong></>}
                    {t.repeats ? ' · Repeats' : ''}
                    {t.status === 'waiting' ? ' · Waiting' : t.status === 'doing' ? ' · In progress' : ''}
                  </span>
                  <People label="Associated with:" people={t.people} />
                </div>
              </li>
            ))}
          </ul>
          <More total={items.length} open={open} setOpen={setOpen} what="tasks" />
          {open && items.length > SHOW_ALL_MAX && <p className="muted small">Showing the first {SHOW_ALL_MAX}. Tasks has the rest.</p>}
        </>
      )}
      <p><a className="small fm-foot" href="#/tasks">Open Tasks</a></p>
    </section>
  );
}

/** Birthdays and important dates in the next 30 days, from F2's own list. Names and dates only: no year, age or note. */
export function DatesSection({ items, today, who }: { items: readonly HouseholdDate[]; today: string; who: string | null }) {
  return (
    <section className="card" aria-labelledby="fm-hh-dates">
      <div className="card-head"><h2 className="card-title" id="fm-hh-dates">Birthdays and dates, next {DATE_DAYS} days</h2><span className="muted small">{items.length}</span></div>
      {items.length === 0 ? (
        <EmptyState title={`No dates in the next ${DATE_DAYS} days`}>
          {who ? `${who} has no birthday or important date coming up.` : 'Birthdays come from member profiles; add anniversaries and other yearly dates under Family dates.'}
        </EmptyState>
      ) : (
        <ul className="plain fm-items">
          {items.map((r) => {
            const to = r.type === 'birthday' ? (r.memberId !== undefined ? memberRoute(r.memberId) : DATES_ROUTE) : r.aboutMemberId !== undefined ? memberRoute(r.aboutMemberId) : DATES_ROUTE;
            return (
              <li key={r.key} className="fm-item">
                <div className="fm-item-text">
                  <Link to={to} className="fm-item-title">{r.title}</Link>
                  <span className="muted small">{dayLabel(r.date)} · {inWords(daysUntil(today, r.date))} · {r.type === 'birthday' ? 'Birthday' : DATE_KIND_LABEL[r.type]}{r.onCalendar ? '' : ' · Not on my Calendar'}</span>
                  {r.person ? <People label="About:" people={[r.person]} /> : r.aboutName ? <span className="muted small">About: {r.aboutName}</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p><Link to={DATES_ROUTE} className="small fm-foot">All family dates</Link></p>
    </section>
  );
}
