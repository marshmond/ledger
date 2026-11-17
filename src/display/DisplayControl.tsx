import { useId } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Effective } from './grants';
import { eventDisplayStatus, taskDisplayStatus } from './editorStatus';
import type { DisplayChoice } from './pending';
import './display.css';

/**
 * CS-1: the compact "On the family tablet" control in the event and Task editors. A choice here is a PENDING form change: it is held by the editor,
 * written only when the editor's Save succeeds (in the same transaction as the save, see `pending.ts`), and dropped by Cancel or by closing. Nothing is
 * published anywhere in this release; it only records what the owner allows a FUTURE shared display to show.
 */
type Choice = DisplayChoice;
const OPTIONS: { value: Choice; label: string; hint: string }[] = [
  { value: 'hide', label: 'Not shown', hint: 'Private. This is how every event and Task starts.' },
  { value: 'show', label: 'Shown', hint: 'The title as typed, the date and time, and the people named.' },
  { value: 'busy', label: 'Shown as "Busy"', hint: 'Only that you are busy at that time. No title.' },
];

const chosen = (e: Effective): Choice => (e.show === 'busy' ? 'busy' : e.show === 'details' ? 'show' : 'hide');

function Radios({ name, value, onPick, busyAllowed }: { name: string; value: Choice; onPick: (c: Choice) => void; busyAllowed: boolean }) {
  return (
    <div className="ds-options" role="radiogroup" aria-label="On the family tablet">
      {OPTIONS.filter((o) => busyAllowed || o.value !== 'busy').map((o) => (
        <label key={o.value} className="ds-option">
          <input type="radio" name={name} checked={value === o.value} onChange={() => onPick(o.value)} />
          <span><strong>{o.label}</strong> <span className="muted small">{o.hint}</span></span>
        </label>
      ))}
    </div>
  );
}

const PENDING_NOTE = 'This only records what a shared family display may show. Nothing is published yet. Your choice is saved when you press Save, and dropped if you press Cancel or close this window.';

export function EventDisplayControl({ eventId, calendarId, savedTitle, formTitle, value, onChange }: {
  eventId: number | null; calendarId: number; savedTitle: string; formTitle: string; value: DisplayChoice | null; onChange: (c: DisplayChoice | null) => void;
}) {
  const name = useId();
  const s = useLiveQuery(() => eventDisplayStatus(db, eventId ?? -1, calendarId), [eventId, calendarId]);
  if (!s) return null;
  const current = chosen(s.eff);
  const shown = value ?? current;
  // picking what is already in effect is "no change": nothing pending, nothing written
  const pick = (c: Choice) => onChange(c === current ? null : c);
  const inherited = s.eff.via === 'calendar' && s.eff.show !== 'hidden' && value === null;
  const title = (formTitle.trim() || savedTitle).trim();
  const willShow = shown === 'show';
  const titleChanged = eventId !== null && willShow && ((s.own.state === 'show' && !!s.own.titleAtGrant && s.own.titleAtGrant !== title) || (s.eff.show === 'details' && savedTitle.trim() !== '' && title !== savedTitle.trim()));
  return (
    <fieldset className="ds-box" aria-labelledby={`${name}-l`}>
      <legend id={`${name}-l`}>On the family tablet</legend>
      <p className="muted small ds-local">{PENDING_NOTE} It applies to every date of a repeating event.</p>
      {s.rejection ? (
        <p className="ds-note ds-note--stop" role="status"><strong>{s.rejection.text.replace(/^Not eligible: /, 'Cannot be shown: ')}</strong> It stays private even if its calendar is shared.</p>
      ) : (
        <>
          <Radios name={name} value={shown} busyAllowed onPick={pick} />
          {s.killed && <p className="ds-note ds-note--stop" role="status">Hide everything is on, so nothing is shown right now whatever you choose.</p>}
          {eventId === null && s.calendarShared && value === null && <p className="ds-note" role="status"><strong>{s.calendarName} is shown on the family tablet.</strong> This event will be eligible as soon as you save it, with its title, date, time and the people named. Choose "Not shown" to keep it private.</p>}
          {inherited && eventId !== null && (
            <p className="ds-note" role="status">
              <strong>Shown because the calendar "{s.calendarName}" is shown.</strong>{' '}
              <button type="button" className="btn" onClick={() => onChange('hide')}>Keep this one private</button>
            </p>
          )}
          {value !== null && <p className="ds-note" role="status"><strong>Pending:</strong> {value === 'hide' ? 'this event will be kept private' : value === 'busy' ? 'this event will show as Busy' : 'this event will be shown'} when you press Save.</p>}
          {value === null && s.eff.show === 'hidden' && s.own.state === 'hide' && s.calendarShared && <p className="ds-note" role="status">🔒 Kept private, even though its calendar is shown.</p>}
          {s.own.conflict && <p className="ds-note ds-note--stop" role="status">Two of your devices chose differently, so it stays hidden until you choose again.</p>}
          {titleChanged && <p className="ds-note" role="status"><strong>The title changed since you approved it.</strong> After saving, the family tablet would show: “{title}”.</p>}
          {shown === 'show' && !titleChanged && title && <p className="muted small">The tablet would show the title exactly as typed: “{title}”. Notes and places are never shown.</p>}
          {shown === 'busy' && <p className="muted small">The tablet would show only “Busy” at this date and time, with the people named. The title, notes and place are never shown.</p>}
        </>
      )}
    </fieldset>
  );
}

export function TaskDisplayControl({ taskId, savedTitle, formTitle, value, onChange }: {
  taskId: number; savedTitle: string; formTitle: string; value: DisplayChoice | null; onChange: (c: DisplayChoice | null) => void;
}) {
  const name = useId();
  const s = useLiveQuery(() => taskDisplayStatus(db, taskId), [taskId]);
  if (!s) return null;
  const current = chosen(s.eff);
  const shown = value ?? current;
  const pick = (c: Choice) => onChange(c === current ? null : c);
  const title = (formTitle.trim() || savedTitle).trim();
  const titleChanged = shown === 'show' && ((s.own.state === 'show' && !!s.own.titleAtGrant && s.own.titleAtGrant !== title) || (s.eff.show === 'details' && title !== savedTitle.trim()));
  return (
    <fieldset className="ds-box" aria-labelledby={`${name}-l`}>
      <legend id={`${name}-l`}>On the family tablet</legend>
      <p className="muted small ds-local">{PENDING_NOTE} It covers this Task and the next ones made when it repeats; a display would show it read-only.</p>
      {s.rejection ? (
        <p className="ds-note ds-note--stop" role="status"><strong>{s.rejection.text.replace(/^Not eligible: /, 'Cannot be shown: ')}</strong></p>
      ) : s.rootId === null ? (
        <p className="ds-note ds-note--stop" role="status"><strong>Cannot be shown.</strong> Its repeat history is incomplete, so Ledger cannot tell which series it belongs to. It stays private.</p>
      ) : (
        <>
          <Radios name={name} value={shown} busyAllowed={false} onPick={pick} />
          {s.killed && <p className="ds-note ds-note--stop" role="status">Hide everything is on, so nothing is shown right now whatever you choose.</p>}
          {value !== null && <p className="ds-note" role="status"><strong>Pending:</strong> {value === 'hide' ? 'this Task will be kept private' : 'this Task will be shown'} when you press Save.</p>}
          {s.own.conflict && <p className="ds-note ds-note--stop" role="status">Two of your devices chose differently, so it stays hidden until you choose again.</p>}
          {titleChanged && <p className="ds-note" role="status"><strong>The title changed.</strong> After saving, the family tablet would show: “{title}”.</p>}
          {shown === 'show' && !titleChanged && <p className="muted small">The tablet would show the title exactly as typed: “{title}”, its due date and status. Notes, checklists and projects are never shown.</p>}
        </>
      )}
    </fieldset>
  );
}
