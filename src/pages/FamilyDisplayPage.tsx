import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { todayISO } from '../lib/money';
import { PageHeader } from '../ui/components';
import { useToast } from '../ui/Toast';
import ConfirmDialog from '../shell/ConfirmDialog';
import { loadLayers } from '../modules/calendar/data';
import { loadArrangements } from '../modules/services/data';
import { listMaintenancePlans } from '../modules/assets/displaySchedule';
import { buildProjection, ProjectionLimitError } from '../display/build';
import { randomIdKey, type DisplayProjection, type IdKey } from '../display/contract';
import { appendDecision, setKillSwitch, type DecisionInput } from '../display/grantStore';
import { ALL_DATES_SUBJECT, memberDatesSubject, subjectOf, type GrantIndex, type Level } from '../display/grants';
import { previewCalendarShare, readDisplayState, RECENT_DAYS, type CalendarPreview } from '../display/readState';
import { Pill, SettingsSection, SubHeading } from './SettingsParts';
import '../display/display.css';

/**
 * CS-1: Settings > Family display. The owner's management page for what a shared family display MAY show, with a LOCAL preview of exactly the
 * dataset a later release could publish. There is no display yet: nothing here is published, sent or stored anywhere else, and the page says so.
 */
const dayLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const shortDay = (date: string | null) => (date ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'no upcoming date');

type Dialog =
  | { kind: 'kill' }
  | { kind: 'resume' }
  | { kind: 'share'; layerId: number; preview: CalendarPreview }
  | { kind: 'unshare'; layerId: number; name: string; count: number };

export default function FamilyDisplayPage() {
  const toast = useToast();
  const [key, setKey] = useState<IdKey | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState<Level>('details');
  const [projection, setProjection] = useState<DisplayProjection | null>(null);
  const [projectionError, setProjectionError] = useState<string | null>(null);
  const today = todayISO();
  const tz = useMemo(() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } }, []);

  // A throw-away key: ids in this preview are random each time the page opens and are never stored. A real display key is a later release's job.
  useEffect(() => { void randomIdKey().then(setKey); }, []);
  const state = useLiveQuery(() => (key ? readDisplayState(db, { today, tz, nowMs: Date.now(), idKey: key }) : undefined), [key, today, tz]);
  const layers = useLiveQuery(() => loadLayers(), []) ?? [];
  const arrangements = useLiveQuery(() => loadArrangements(db), []) ?? [];
  const plans = useLiveQuery(() => listMaintenancePlans(db), []) ?? [];

  useEffect(() => {
    if (!state) return;
    let live = true;
    setProjectionError(null);
    buildProjection(state.input).then((p) => { if (live) setProjection(p); }).catch((e: unknown) => {
      if (!live) return;
      setProjection(null);
      setProjectionError(e instanceof ProjectionLimitError ? e.message : 'The preview could not be built.');
    });
    return () => { live = false; };
  }, [state]);

  if (!state) return <p className="muted">Loading…</p>;
  const { report, grants, family } = state;

  const run = async (inputs: DecisionInput | DecisionInput[], done: string) => {
    setError(null);
    try {
      for (const i of Array.isArray(inputs) ? inputs : [inputs]) await appendDecision(i, db);
      toast(done);
    } catch (e) { setError(e instanceof Error ? e.message : 'That choice could not be saved.'); }
  };
  const sharedIds = new Set(report.sharedCalendars.map((c) => c.id));
  const localLayers = layers.filter((l) => l.sourceType === 'local');

  const openShare = async (layerId: number) => {
    setError(null);
    try {
      const preview = await previewCalendarShare(db, layerId, { today });
      setLevel('details');
      setDialog({ kind: 'share', layerId, preview });
    } catch { setError('That calendar could not be read.'); }
  };
  const openUnshare = (layerId: number, name: string) => {
    const only = report.events.filter((e) => e.calendarId === layerId && e.via === 'calendar').length;
    setDialog({ kind: 'unshare', layerId, name, count: only });
  };

  const eventsByCal = (id: number) => report.events.filter((e) => e.calendarId === id).length;
  const sharedPersonal = report.sharedCalendars.some((c) => layers.find((l) => l.id === c.id)?.builtin);

  return (
    <div className="ds-page">
      <PageHeader title="Family display" description="Choose what a shared family display, such as a kitchen tablet, is allowed to show. Everything starts hidden, and nothing is shown unless you choose it." />

      <p className="ds-banner" role="note">
        <strong>This is a local preview. Nothing has been published.</strong> No display exists yet, and Ledger has sent nothing to any device or service. Your choices are saved only in Ledger (and in your backups and synced devices, like everything else). Finance, Bills, Projects, notes, places and contact details can never be shown.
      </p>
      {error && <p className="cal-error" role="alert">{error}</p>}
      {report.limitations.length > 0 && <p className="ds-note ds-note--stop" role="status">{report.limitations.join(' ')} Those parts are left out of the preview.</p>}

      <SettingsSection id="fd-kill" title="Hide everything" badge={<Pill tone={report.killed ? 'warn' : 'ok'}>{report.killed ? 'On: everything hidden' : 'Off'}</Pill>} tone={report.killed ? 'warn' : 'default'}
        intro="One switch that hides every item at once without losing your choices. Your other choices are kept; turning it off lets them apply again.">
        {report.killed
          ? <p><button type="button" className="btn primary" onClick={() => setDialog({ kind: 'resume' })}>Stop hiding everything</button></p>
          : <p><button type="button" className="btn danger" onClick={() => setDialog({ kind: 'kill' })}>Hide everything now</button></p>}
        <p className="muted small">This changes what Ledger would allow a display to show. Because nothing is published yet, it affects only this device's preview and your other synced devices. When publishing is added later, it will say separately whether a display has actually been updated.</p>
      </SettingsSection>

      <SettingsSection id="fd-summary" title="What is allowed right now" badge={<Pill tone="info">Preview only</Pill>}>
        <ul className="ds-stats">
          <li><strong>{report.events.length}</strong><span className="muted small">events</span></li>
          <li><strong>{report.tasks.length}</strong><span className="muted small">Tasks</span></li>
          <li><strong>{report.dates.length}</strong><span className="muted small">family dates</span></li>
          <li><strong>{report.visits.length}</strong><span className="muted small">service visits</span></li>
          <li><strong>{report.reminders.length}</strong><span className="muted small">maintenance reminders</span></li>
        </ul>
        {report.killed && <p className="ds-note ds-note--stop" role="status">Hide everything is on, so none of these would be shown.</p>}
      </SettingsSection>

      <SettingsSection id="fd-calendars" title="Calendars" intro="Showing a whole calendar is for a calendar that holds only family events. Events you add to it later become eligible too. You can always keep one event private.">
        {localLayers.length === 0 ? <p className="muted">You have no calendars of your own yet.</p> : (
          <ul className="ds-list">
            {localLayers.map((l) => {
              const on = sharedIds.has(l.id);
              const lvl = report.sharedCalendars.find((c) => c.id === l.id)?.level;
              return (
                <li key={l.id} className="ds-row">
                  <span className="ds-row-main"><strong>{l.name}</strong><span className="muted small">{on ? `Shown${lvl === 'busy' ? ' as Busy' : ''}: ${eventsByCal(l.id)} event${eventsByCal(l.id) === 1 ? '' : 's'}` : 'Private'}</span></span>
                  <span className="ds-row-actions">
                    {on
                      ? <button type="button" className="btn" onClick={() => openUnshare(l.id, l.name)} aria-label={`Stop showing the calendar ${l.name}`}>Stop showing</button>
                      : <button type="button" className="btn" onClick={() => void openShare(l.id)} aria-label={`Review and show the calendar ${l.name}`}>Review and show…</button>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="muted small">Calendars made from other parts of Ledger (Finance, Bills, Tasks, Projects, Home &amp; Assets, Household Services, Family) cannot be shown.</p>
        {sharedPersonal && <p className="ds-note ds-note--stop" role="status">Your Personal calendar is shown. It often holds private items, so check the list below.</p>}
      </SettingsSection>

      <SettingsSection id="fd-events" title="Events" intro="Events that would appear, with their real titles. The display shows each title exactly as typed.">
        {report.events.length === 0 ? <p className="muted">No events are allowed. Open an event and choose "Shown" under "On the family tablet", or show a whole calendar above.</p> : (
          <ul className="ds-list">
            {report.events.map((e) => (
              <li key={e.eventId} className="ds-row">
                <span className="ds-row-main">
                  <strong>{e.title || '(no title)'}</strong>
                  <span className="muted small">
                    {e.calendarName} · {e.show === 'busy' ? 'Shown as Busy' : 'Shown with its title'} · {e.via === 'calendar' ? 'because the calendar is shown' : 'chosen for this event'} · {e.recurring ? 'repeats · ' : ''}{shortDay(e.nextDate)}
                    {e.titleChanged ? ' · title changed since you approved it' : ''}{e.conflict ? ' · your devices disagree' : ''}
                  </span>
                </span>
                <span className="ds-row-actions">
                  {e.show === 'details'
                    ? <button type="button" className="btn" onClick={() => void run({ subject: subjectOf('event', e.eventId), decision: 'show', level: 'busy', titleAtGrant: e.title }, 'Set to show as Busy')} aria-label={`Show ${e.title} as Busy`}>Show as Busy</button>
                    : <button type="button" className="btn" onClick={() => void run({ subject: subjectOf('event', e.eventId), decision: 'show', titleAtGrant: e.title }, 'Set to show its title')} aria-label={`Show the title of ${e.title}`}>Show title</button>}
                  <button type="button" className="btn" onClick={() => void run({ subject: subjectOf('event', e.eventId), decision: 'hide' }, 'Kept private')} aria-label={`Keep ${e.title} private`}>Keep private</button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {report.keptPrivate.length > 0 && (
          <>
            <SubHeading>Kept private on a shown calendar</SubHeading>
            <ul className="ds-list">
              {report.keptPrivate.map((k) => (
                <li key={k.eventId} className="ds-row">
                  <span className="ds-row-main"><strong><span className="ds-lock" aria-hidden="true">🔒</span>{k.title || '(no title)'}</strong><span className="muted small">{k.calendarName} · private</span></span>
                  <span className="ds-row-actions"><button type="button" className="btn" onClick={() => void run({ subject: subjectOf('event', k.eventId), decision: 'show', titleAtGrant: k.title }, 'Marked to show')} aria-label={`Show ${k.title}`}>Show again</button></span>
                </li>
              ))}
            </ul>
          </>
        )}
        {report.rejected.length > 0 && (
          <>
            <SubHeading>Not eligible, whatever you choose</SubHeading>
            <ul className="ds-list">
              {report.rejected.map((r) => (
                <li key={`${r.where}-${r.id}`} className="ds-row"><span className="ds-row-main"><strong>{r.title || '(no title)'}</strong><span className="muted small">{r.where} · {r.rejection.text}</span></span></li>
              ))}
            </ul>
          </>
        )}
      </SettingsSection>

      <SettingsSection id="fd-tasks" title="Tasks" intro="A display shows these read-only: the title, due date and status. Choosing a repeating Task covers the next ones it creates too.">
        {report.tasks.length === 0 ? <p className="muted">No Tasks are allowed. Open a Task and choose "Shown" under "On the family tablet".</p> : (
          <ul className="ds-list">
            {report.tasks.map((t) => (
              <li key={t.taskId} className="ds-row">
                <span className="ds-row-main"><strong>{t.title || '(no title)'}</strong><span className="muted small">{t.due ? `Due ${shortDay(t.due)}` : 'No due date'} · {t.status}{t.titleChanged ? ' · title changed since you approved it' : ''}{t.conflict ? ' · your devices disagree' : ''}</span></span>
                <span className="ds-row-actions"><button type="button" className="btn" onClick={() => void run({ subject: subjectOf('task', t.rootId), decision: 'hide' }, 'Kept private')} aria-label={`Keep ${t.title} private`}>Keep private</button></span>
              </li>
            ))}
          </ul>
        )}
        {report.ambiguousTasks > 0 && <p className="ds-note ds-note--stop" role="status">{report.ambiguousTasks} Task{report.ambiguousTasks === 1 ? '' : 's'} cannot be shown because the history of their repeats is incomplete. They stay private.</p>}
      </SettingsSection>

      <SettingsSection id="fd-dates" title="Family dates" intro="Birthdays and important dates: a name and a date only. Never an age or a birth year.">
        <ul className="ds-list">
          <li className="ds-row">
            <span className="ds-row-main"><strong>All birthdays and important dates</strong><span className="muted small">{grants.get(ALL_DATES_SUBJECT).state === 'show' ? 'Shown' : 'Private'}</span></span>
            <span className="ds-row-actions">
              {grants.get(ALL_DATES_SUBJECT).state === 'show'
                ? <button type="button" className="btn" onClick={() => void run({ subject: ALL_DATES_SUBJECT, decision: 'hide' }, 'Kept private')}>Stop showing all</button>
                : <button type="button" className="btn" onClick={() => void run({ subject: ALL_DATES_SUBJECT, decision: 'show' }, 'Marked to show')}>Show all</button>}
            </span>
          </li>
          {family.people.filter((p) => family.birthdays.some((b) => b.memberId === p.memberId)).map((p) => {
            const st = grants.get(memberDatesSubject(p.memberId));
            return (
              <li key={p.memberId} className="ds-row">
                <span className="ds-row-main"><strong>{p.name}'s birthday</strong><span className="muted small">{st.state === 'none' ? 'Follows "All birthdays and important dates"' : st.state === 'show' ? 'Shown' : 'Private'}</span></span>
                <span className="ds-row-actions">
                  <button type="button" className="btn" onClick={() => void run({ subject: memberDatesSubject(p.memberId), decision: 'show' }, 'Marked to show')} aria-label={`Show ${p.name}'s birthday`}>Show</button>
                  <button type="button" className="btn" onClick={() => void run({ subject: memberDatesSubject(p.memberId), decision: 'hide' }, 'Kept private')} aria-label={`Keep ${p.name}'s birthday private`}>Keep private</button>
                </span>
              </li>
            );
          })}
          {family.dates.map((x) => {
            const st = grants.get(subjectOf('date', x.id));
            return (
              <li key={x.id} className="ds-row">
                <span className="ds-row-main"><strong>{x.label}</strong><span className="muted small">{st.state === 'none' ? 'Follows the choice above' : st.state === 'show' ? 'Shown' : 'Private'}</span></span>
                <span className="ds-row-actions">
                  <button type="button" className="btn" onClick={() => void run({ subject: subjectOf('date', x.id), decision: 'show' }, 'Marked to show')} aria-label={`Show ${x.label}`}>Show</button>
                  <button type="button" className="btn" onClick={() => void run({ subject: subjectOf('date', x.id), decision: 'hide' }, 'Kept private')} aria-label={`Keep ${x.label} private`}>Keep private</button>
                </span>
              </li>
            );
          })}
        </ul>
      </SettingsSection>

      <SettingsSection id="fd-visits" title="Household Services visits" intro="Show that a visit is happening, using a name you type. The display never gets the service's own name, provider, cost, agreement or notes.">
        {arrangements.filter((a) => a.data.status === 'active').length === 0 ? <p className="muted">No active service arrangements.</p> : (
          <ul className="ds-list">
            {arrangements.filter((a) => a.data.status === 'active').map((a) => (
              <ScheduleRow key={a.id} subject={subjectOf('visit', a.id)} sourceName={a.data.title} grants={grants} people={family.people} onSave={run} count={report.visits.find((v) => v.id === a.id)?.count} />
            ))}
          </ul>
        )}
      </SettingsSection>

      <SettingsSection id="fd-reminders" title="Maintenance reminders" intro="Repeating home-maintenance Tasks linked to an item. Show the next due date under a name you type. The display never gets the item, its details or its history.">
        {plans.length === 0 ? <p className="muted">No repeating maintenance Tasks are linked to an item.</p> : (
          <ul className="ds-list">
            {plans.map((p) => (
              <ScheduleRow key={p.rootId} subject={subjectOf('reminder', p.rootId)} sourceName={p.title} grants={grants} people={family.people} onSave={run} count={report.reminders.find((v) => v.id === p.rootId)?.count} />
            ))}
          </ul>
        )}
      </SettingsSection>

      <SettingsSection id="fd-review" title="Recent changes and choices to review" intro={`Shown items added or edited in the last ${RECENT_DAYS} days, and any choice your devices disagree about.`}>
        {report.conflicts.length > 0 && (
          <>
            <SubHeading>Please choose again</SubHeading>
            <ul className="ds-list">
              {report.conflicts.map((c) => (
                <li key={c.subject} className="ds-row">
                  <span className="ds-row-main"><strong>{report.subjectNames[c.subject] ?? 'A choice'}</strong><span className="muted small">{c.reason === 'unreadable' || c.reason === 'deleted' || c.reason === 'cycle' ? 'A saved choice could not be read, so this stays hidden.' : 'Two of your devices chose differently, so this stays hidden.'}</span></span>
                  <span className="ds-row-actions"><button type="button" className="btn" onClick={() => void run({ subject: c.subject, decision: 'hide' }, 'Kept private')} aria-label={`Keep ${report.subjectNames[c.subject] ?? 'this'} private`}>Keep private</button></span>
                </li>
              ))}
            </ul>
          </>
        )}
        {report.recentEvents.length + report.recentTasks.length === 0 ? <p className="muted">No shown event or Task was added or edited recently.</p> : (
          <ul className="ds-list">
            {report.recentEvents.map((e) => (
              <li key={`e${e.eventId}`} className="ds-row">
                <span className="ds-row-main"><strong>{e.title || '(no title)'}</strong><span className="muted small">Event · {e.titleChanged ? 'title changed since you approved it' : 'added or edited recently'} · shown {e.show === 'busy' ? 'as Busy' : 'with its title'}</span></span>
                <span className="ds-row-actions"><button type="button" className="btn" onClick={() => void run({ subject: subjectOf('event', e.eventId), decision: 'hide' }, 'Kept private')} aria-label={`Keep ${e.title} private`}>Keep private</button></span>
              </li>
            ))}
            {report.recentTasks.map((t) => (
              <li key={`t${t.taskId}`} className="ds-row">
                <span className="ds-row-main"><strong>{t.title || '(no title)'}</strong><span className="muted small">Task · {t.titleChanged ? 'title changed since you approved it' : 'added or edited recently'}</span></span>
                <span className="ds-row-actions"><button type="button" className="btn" onClick={() => void run({ subject: subjectOf('task', t.rootId), decision: 'hide' }, 'Kept private')} aria-label={`Keep ${t.title} private`}>Keep private</button></span>
              </li>
            ))}
          </ul>
        )}
        {report.recentDecisions.length > 0 && (
          <details className="ds-detail">
            <summary>Choices recorded in the last {RECENT_DAYS} days ({report.recentDecisions.length})</summary>
            <ul className="ds-list">
              {report.recentDecisions.map((r) => (
                <li key={r.id} className="ds-row"><span className="ds-row-main"><strong>{report.subjectNames[r.subject] ?? 'A choice'}</strong><span className="muted small">{r.decision === 'hide' ? 'Kept private' : r.level === 'busy' ? 'Shown as Busy' : 'Shown'} · {new Date(r.createdAt).toLocaleString()}</span></span></li>
              ))}
            </ul>
          </details>
        )}
      </SettingsSection>

      <SettingsSection id="fd-preview" title="Preview of what a display would receive" badge={<Pill tone="quiet">Local · not published</Pill>}
        intro="This is built by the same code a later release would use to publish. It is shown only here. Nothing in it has been sent anywhere.">
        {projectionError && <p className="cal-error" role="alert">{projectionError}</p>}
        {!projection ? <p className="muted">Building the preview…</p> : <Preview p={projection} killed={report.killed} />}
      </SettingsSection>

      {dialog?.kind === 'kill' && (
        <ConfirmDialog title="Hide everything" confirmLabel="Hide everything" busyLabel="Hiding…" tone="danger"
          onConfirm={async () => { await setKillSwitch(true, db); toast('Everything is hidden (local choice)'); setDialog(null); }} onCancel={() => setDialog(null)}>
          <p>This hides every event, Task, date, visit and reminder from the family display. Your individual choices are kept.</p>
          <p className="muted small">It changes this preview and Ledger's choices only. No display exists yet, so nothing is removed from any device. When publishing is added, Ledger will say separately whether a display has been updated.</p>
        </ConfirmDialog>
      )}
      {dialog?.kind === 'resume' && (
        <ConfirmDialog title="Stop hiding everything" confirmLabel="Stop hiding" busyLabel="Working…" tone="primary"
          onConfirm={async () => { await setKillSwitch(false, db); toast('Your choices apply again'); setDialog(null); }} onCancel={() => setDialog(null)}>
          <p>Your individual choices will apply again: {report.events.length} event{report.events.length === 1 ? '' : 's'}, {report.tasks.length} Task{report.tasks.length === 1 ? '' : 's'}, {report.dates.length} date{report.dates.length === 1 ? '' : 's'}, {report.visits.length} visit{report.visits.length === 1 ? '' : 's'} and {report.reminders.length} reminder{report.reminders.length === 1 ? '' : 's'}.</p>
        </ConfirmDialog>
      )}
      {dialog?.kind === 'share' && (
        <ConfirmDialog title={`Show the calendar "${dialog.preview.layerName}"?`} confirmLabel="Show this calendar" busyLabel="Saving…" tone="primary"
          onConfirm={async () => { await appendDecision({ subject: subjectOf('calendar', dialog.layerId), decision: 'show', level }, db); toast(`"${dialog.preview.layerName}" is now allowed (local choice)`); setDialog(null); }} onCancel={() => setDialog(null)}>
          <p><strong>Every event on this calendar, including events you add or move here later, can appear on the family display</strong> with its title, date, time and the people named. Notes, places and anything outside Calendar never appear. Use a calendar that holds only family events.</p>
          {layers.find((l) => l.id === dialog.layerId)?.builtin && <p className="ds-note ds-note--stop" role="status"><strong>This is your Personal calendar.</strong> It often holds private items. Look through the list before you continue.</p>}
          <fieldset className="ds-box">
            <legend>How should its events show?</legend>
            <label className="ds-option"><input type="radio" name="fd-level" checked={level === 'details'} onChange={() => setLevel('details')} /><span><strong>With the title</strong> <span className="muted small">as typed</span></span></label>
            <label className="ds-option"><input type="radio" name="fd-level" checked={level === 'busy'} onChange={() => setLevel('busy')} /><span><strong>As "Busy"</strong> <span className="muted small">date and time only, no title</span></span></label>
          </fieldset>
          <p><strong>{dialog.preview.eligible.length} event{dialog.preview.eligible.length === 1 ? '' : 's'} would become eligible</strong> (those within about 4 months, and repeating series):</p>
          {dialog.preview.eligible.length === 0 ? <p className="muted">None today.</p> : (
            <ul className="ds-list ds-scroll">
              {dialog.preview.eligible.map((e) => <li key={e.eventId} className="ds-row"><span className="ds-row-main"><strong>{level === 'busy' ? 'Busy' : (e.title || '(no title)')}</strong><span className="muted small">{level === 'busy' ? `${e.title || '(no title)'} · ` : ''}{e.recurring ? 'repeats · ' : ''}{shortDay(e.nextDate)}</span></span></li>)}
            </ul>
          )}
          {dialog.preview.keptPrivate.length > 0 && <p className="muted small">{dialog.preview.keptPrivate.length} event{dialog.preview.keptPrivate.length === 1 ? ' is' : 's are'} kept private and stay private.</p>}
          {dialog.preview.rejected.length > 0 && (
            <>
              <p className="muted small">Not eligible, whatever you choose ({dialog.preview.rejected.length}):</p>
              <ul className="plain muted small">{dialog.preview.rejected.map((r) => <li key={r.id}>{r.title || '(no title)'} — {r.rejection.text.replace(/^Not eligible: /, '')}</li>)}</ul>
            </>
          )}
          <p className="muted small">You can turn this off again at any time. Nothing is published by this choice.</p>
        </ConfirmDialog>
      )}
      {dialog?.kind === 'unshare' && (
        <ConfirmDialog title={`Stop showing "${dialog.name}"?`} confirmLabel="Stop showing" busyLabel="Saving…" tone="primary"
          onConfirm={async () => { await appendDecision({ subject: subjectOf('calendar', dialog.layerId), decision: 'hide' }, db); toast(`"${dialog.name}" is private again`); setDialog(null); }} onCancel={() => setDialog(null)}>
          <p>{dialog.count} event{dialog.count === 1 ? ' is' : 's are'} allowed only because this calendar is shown. {dialog.count === 1 ? 'It becomes' : 'They become'} private. Events you chose one by one stay as you chose.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function ScheduleRow({ subject, sourceName, grants, people, onSave, count }: {
  subject: string; sourceName: string; grants: GrantIndex; people: { memberId: number; name: string }[];
  onSave: (i: DecisionInput, done: string) => Promise<void>; count?: number;
}) {
  const st = grants.get(subject);
  const [label, setLabel] = useState(st.label ?? '');
  const [who, setWho] = useState<number[]>(st.people);
  useEffect(() => { setLabel(st.label ?? ''); setWho(st.people); }, [st.label, st.people.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const on = st.state === 'show';
  const id = `fd-${subject.replace(':', '-')}`;
  return (
    <li className="ds-row">
      <span className="ds-row-main">
        <strong>{sourceName}</strong>
        <span className="muted small">{on ? `Shown to the display as "${st.label}"${count !== undefined ? ` · ${count} upcoming` : ''}` : st.state === 'hide' ? 'Private' : 'Not shown'}</span>
        <span className="ds-label-form">
          <label className="f" htmlFor={id}>Name the display shows<input id={id} value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder="For example: Cleaner" /></label>
        </span>
        {people.length > 0 && (
          <span className="row" role="group" aria-label={`Who ${sourceName} is for`}>
            {people.map((p) => <label key={p.memberId} className="row cal-check"><input type="checkbox" checked={who.includes(p.memberId)} onChange={(e) => setWho(e.target.checked ? [...who, p.memberId] : who.filter((x) => x !== p.memberId))} /> {p.name}</label>)}
          </span>
        )}
      </span>
      <span className="ds-row-actions">
        <button type="button" className="btn" disabled={!label.trim()} onClick={() => void onSave({ subject, decision: 'show', label, people: who }, on ? 'Updated' : 'Marked to show')}>{on ? 'Save name and people' : 'Show'}</button>
        {on && <button type="button" className="btn" onClick={() => void onSave({ subject, decision: 'hide' }, 'Kept private')} aria-label={`Stop showing ${sourceName}`}>Stop showing</button>}
      </span>
    </li>
  );
}

function Preview({ p, killed }: { p: DisplayProjection; killed: boolean }) {
  const names = new Map(p.people.map((x) => [x.id, x.name]));
  const days = new Map<string, { when: string; title: string; who: string; kind: string }[]>();
  for (const e of p.entries) {
    const when = e.allDay ? (e.start.date === e.end.date ? 'All day' : `All day to ${shortDay(e.end.date)}`) : `${e.start.time}–${e.end.time}`;
    days.set(e.start.date, [...(days.get(e.start.date) ?? []), { when, title: e.title, who: e.people.map((x) => names.get(x) ?? '').join(', '), kind: e.source }]);
  }
  const KIND: Record<string, string> = { events: 'Event', dates: 'Family date', visits: 'Visit', reminders: 'Reminder' };
  return (
    <>
      <ul className="ds-stats">
        <li><strong>{p.counts.entries}</strong><span className="muted small">{p.counts.entries === 1 ? 'calendar item' : 'calendar items'}</span></li>
        <li><strong>{p.counts.tasks}</strong><span className="muted small">Tasks</span></li>
        <li><strong>{p.people.length}</strong><span className="muted small">{p.people.length === 1 ? 'person named' : 'people named'}</span></li>
        <li><strong>{p.grantsSeen.length}</strong><span className="muted small">{p.grantsSeen.length === 1 ? 'choice recorded' : 'choices recorded'}</span></li>
      </ul>
      <p className="muted small">From {shortDay(p.window.from)} to {shortDay(p.window.to)}, in the time zone {p.generatedFor.tz}.</p>
      {p.entries.length === 0 && p.tasks.length === 0 && <p className="muted">{killed ? 'Hide everything is on, so nothing would be shown.' : 'Nothing would be shown. That is how everything starts.'}</p>}
      {[...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, items]) => (
        <div key={date}>
          <h4 className="ds-preview-day">{dayLabel(date)}</h4>
          <ul className="ds-list">
            {items.map((it, i) => <li key={i} className="ds-row"><span className="ds-row-main"><strong>{it.title}</strong><span className="muted small">{KIND[it.kind]} · {it.when}{it.who ? ` · ${it.who}` : ''}</span></span></li>)}
          </ul>
        </div>
      ))}
      {p.tasks.length > 0 && (
        <div>
          <h4 className="ds-preview-day">Tasks</h4>
          <ul className="ds-list">
            {p.tasks.map((t) => <li key={t.id} className="ds-row"><span className="ds-row-main"><strong>{t.title}</strong><span className="muted small">{t.due ? `Due ${shortDay(t.due.date)}${t.due.time ? ` ${t.due.time}` : ''}` : 'No due date'} · {t.status}{t.repeat ? ' · repeats' : ''}{t.people.length ? ` · ${t.people.map((x) => names.get(x) ?? '').join(', ')}` : ''}</span></span></li>)}
          </ul>
        </div>
      )}
    </>
  );
}
