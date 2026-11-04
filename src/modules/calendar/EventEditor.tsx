import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addDays, dayOfWeek } from '../../lib/dates';
import { daysBetween } from '../../lib/money';
import type { RecordRef } from '../../core/entities';
import { store } from '../../core/store';
import Modal from '../../shell/Modal';
import { useToast } from '../../ui/Toast';
import {
  createEvent, markOccurrenceDone, newEventData, removeOccurrence, restoreEventData, saveEdit, snapshotEvent, type Scope,
} from './data';
import { MODULE, PRIORITIES, PRIORITY_ICON, PRIORITY_LABEL, type CalendarLayer, type EventFields } from './model';
import { REMINDER_CHOICES, reminderLabel, type Occurrence } from './occurrences';
import { ContactPicker, RecordLinks, TagPicker, refKey } from './pickers';
import { describeRule, nthOfMonth, normalizeRule, type Recurrence } from './recurrence';
import { fmtHM, localISO, minutesOfDay, msAt, parseHM, WEEKDAYS_LONG, WEEKDAYS_SHORT } from './time';
import type { Priority } from '../../core/entities';

export interface EditorStart {
  date: string;
  /** Minutes after midnight when the user clicked a time slot; leave out for an all-day item. */
  minutes?: number;
}

const SCOPE_WORDS: Record<Scope, string> = { one: 'This event', following: 'This and following events', all: 'All events' };

/** Asks which part of a repeating series a change or delete applies to. */
function ScopeDialog({ verb, onPick, onClose }: { verb: string; onPick: (s: Scope) => void; onClose: () => void }) {
  return (
    <Modal title={`${verb} a repeating event`} onClose={onClose}>
      <p className="muted">This event repeats. What should be {verb === 'Delete' ? 'deleted' : 'changed'}?</p>
      {verb !== 'Delete' && <p className="muted small">"This event" changes only this one date. The calendar, tags, people and repeat settings always apply to the whole series.</p>}
      <div className="cal-scope">
        {(['one', 'following', 'all'] as Scope[]).map((s) => <button key={s} className={`btn ${s === 'all' ? 'primary' : ''}`} onClick={() => onPick(s)}>{SCOPE_WORDS[s]}</button>)}
        <button className="link" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

/** Add or edit an event. Only the title is required. Repeating events ask which occurrences a change applies to. */
export default function EventEditor({ occ, start, layers, defaultCalendarId, onClose }: {
  occ?: Occurrence; start?: EditorStart; layers: CalendarLayer[]; defaultCalendarId: number; onClose: () => void;
}) {
  const toast = useToast();
  const ev = occ?.event.data;
  const initial = useMemo(() => {
    if (occ) return occ;
    const s = start ?? { date: localISO(Date.now()) };
    const startAt = s.minutes !== undefined ? msAt(s.date, s.minutes) : msAt(s.date, 9 * 60);
    return { title: '', allDay: s.minutes === undefined, startDate: s.date, endDate: s.date, startAt, endAt: startAt + 3600_000, location: '', notes: '', priority: 'medium' as Priority, reminders: [] as number[] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [title, setTitle] = useState(initial.title);
  const [allDay, setAllDay] = useState(initial.allDay);
  const [startDate, setStartDate] = useState(initial.allDay ? initial.startDate : localISO(initial.startAt));
  const [startTime, setStartTime] = useState(fmtHM(minutesOfDay(initial.startAt)));
  const [endDate, setEndDate] = useState(initial.allDay ? initial.endDate : localISO(initial.endAt > initial.startAt ? initial.endAt - 1 : initial.endAt));
  const [endTime, setEndTime] = useState(fmtHM(minutesOfDay(initial.endAt)));
  const [location, setLocation] = useState(initial.location);
  const [notes, setNotes] = useState(initial.notes);
  const [priority, setPriority] = useState<Priority>(initial.priority);
  const [reminders, setReminders] = useState<number[]>(initial.reminders);
  const [calendarId, setCalendarId] = useState(ev?.calendarId ?? defaultCalendarId);
  const [tagIds, setTagIds] = useState<number[]>(ev?.tagIds ?? []);
  const [contactIds, setContactIds] = useState<number[]>(ev?.contactIds ?? []);
  const [rule, setRule] = useState<Recurrence | null>(ev?.recurrence ?? null);
  const [trackDone, setTrackDone] = useState(ev?.trackDone ?? false);
  const [error, setError] = useState('');
  const [ask, setAsk] = useState<null | { kind: 'save'; fields: EventFields } | { kind: 'delete' }>(null);
  const [busy, setBusy] = useState(false);

  // Links to other records: loaded for an existing event, changed only when you press Save.
  const links = useLiveQuery(async () => (occ ? await store.shared.links.linkedTo({ module: MODULE, id: occ.eventId }) : []), [occ?.eventId]) ?? [];
  const existing = useMemo(() => links.map((l) => ({
    linkId: l.id as number,
    ref: (l.fromModule === MODULE && l.fromId === occ?.eventId ? { module: l.toModule, id: l.toId } : { module: l.fromModule, id: l.fromId }) as RecordRef,
  })), [links, occ?.eventId]);
  const [added, setAdded] = useState<RecordRef[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  // Keep the end after the start when the start moves.
  const startMsNow = () => (allDay ? null : msAt(startDate, parseHM(startTime) ?? 0));
  const onStartDate = (v: string) => {
    if (!v) return;
    const shift = daysBetween(v, startDate);
    setStartDate(v);
    setEndDate(addDays(endDate, shift));
  };
  const onStartTime = (v: string) => {
    const was = startMsNow();
    setStartTime(v);
    const nm = parseHM(v);
    if (was === null || nm === null) return;
    const endMs = msAt(endDate, parseHM(endTime) ?? 0);
    const next = msAt(startDate, nm) + Math.max(0, endMs - was);
    setEndDate(localISO(next)); setEndTime(fmtHM(minutesOfDay(next)));
  };

  const cals = layers.filter((l) => l.sourceType === 'local');

  const build = (): EventFields | null => {
    if (!title.trim()) { setError('Give it a title.'); return null; }
    if (!startDate || !endDate) { setError('Pick a date.'); return null; }
    let f: EventFields;
    if (allDay) {
      if (endDate < startDate) { setError('The end date is before the start date.'); return null; }
      f = { title: title.trim(), allDay: true, startDate, endDate, startAt: msAt(startDate), endAt: msAt(addDays(endDate, 1)), location: location.trim(), notes: notes.trim(), priority, reminders };
    } else {
      const sm = parseHM(startTime), em = parseHM(endTime);
      if (sm === null || em === null) { setError('Enter the times like 9:30.'); return null; }
      const startAt = msAt(startDate, sm), endAt = msAt(endDate, em);
      if (endAt < startAt) { setError('The end is before the start.'); return null; }
      f = { title: title.trim(), allDay: false, startDate: localISO(startAt), endDate: localISO(endAt > startAt ? endAt - 1 : endAt), startAt, endAt, location: location.trim(), notes: notes.trim(), priority, reminders };
    }
    if (rule?.end.type === 'until' && rule.end.date < startDate) { setError('The repeat ends before the first date.'); return null; }
    setError('');
    return f;
  };

  const extras = () => ({ calendarId, tagIds, contactIds, recurrence: rule ? normalizeRule(rule) : null, trackDone, ...(ev?.type ? { type: ev.type } : {}) });

  const applyLinks = async (eventId: number) => {
    for (const e of existing) if (removed.has(refKey(e.ref))) await store.shared.links.remove(e.linkId);
    for (const r of added) await store.shared.links.add({ module: MODULE, id: eventId }, r, 'about');
  };

  const doSave = async (fields: EventFields, scope: Scope) => {
    setBusy(true);
    try {
      const id = occ ? await saveEdit(occ, fields, extras(), scope) : await createEvent(newEventData(fields, extras()));
      await applyLinks(id);
      toast(occ ? 'Event saved' : 'Event added');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
      setBusy(false);
    }
  };
  const save = () => {
    const f = build();
    if (!f) return;
    if (occ?.recurring) setAsk({ kind: 'save', fields: f });
    else void doSave(f, 'all');
  };

  const doDelete = async (scope: Scope) => {
    if (!occ) return;
    const snap = await snapshotEvent(occ.eventId);
    await removeOccurrence(occ, scope);
    toast('Event deleted', async () => { await restoreEventData(occ.eventId, snap); });
    onClose();
  };
  const del = () => (occ?.recurring ? setAsk({ kind: 'delete' }) : void doDelete('all'));

  // Esc closes the dialog (Modal handles it); Enter in the title saves.
  useEffect(() => setError(''), [title]);

  const setRuleField = (patch: Partial<Recurrence>) => setRule((r) => (r ? { ...r, ...patch } : r));
  const startForRule = startDate || localISO(Date.now());
  const nth = nthOfMonth(startForRule);
  const onRepeatKind = (v: string) => {
    if (v === 'none') return setRule(null);
    const freq = v as Recurrence['freq'];
    setRule({ freq, interval: rule?.interval ?? 1, end: rule?.end ?? { type: 'never' }, ...(freq === 'weekly' ? { byWeekday: [dayOfWeek(startForRule)] } : {}), ...(freq === 'monthly' ? { monthly: 'date' as const } : {}) });
  };
  const unit = rule ? { daily: 'day(s)', weekly: 'week(s)', monthly: 'month(s)', yearly: 'year(s)' }[rule.freq] : '';

  return (
    <>
      <Modal title={occ ? 'Edit event' : 'New event'} onClose={onClose} wide>
        <form className="cal-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <label className="f">Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="What is it?" />
          </label>

          <label className="row cal-check"><input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> All day</label>
          <div className="cal-when">
            <label className="f">{allDay ? 'First day' : 'Starts'}
              <span className="row nowrap">
                <input type="date" value={startDate} onChange={(e) => onStartDate(e.target.value)} />
                {!allDay && <input type="time" value={startTime} onChange={(e) => onStartTime(e.target.value)} aria-label="Start time" />}
              </span>
            </label>
            <label className="f">{allDay ? 'Last day' : 'Ends'}
              <span className="row nowrap">
                <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
                {!allDay && <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} aria-label="End time" />}
              </span>
            </label>
          </div>
          {allDay && <p className="muted small">All-day items are plain dates, so they stay on the same day in any time zone.</p>}

          <div className="cal-when">
            <label className="f">Calendar
              <select value={calendarId} onChange={(e) => setCalendarId(Number(e.target.value))}>
                {cals.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                {!cals.some((c) => c.id === calendarId) && <option value={calendarId}>(deleted calendar)</option>}
              </select>
            </label>
            <label className="f">Priority
              <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_ICON[p]} {PRIORITY_LABEL[p]}{p === 'reminder' ? ' (a nudge, not a commitment)' : ''}</option>)}
              </select>
            </label>
          </div>

          <fieldset className="cal-repeat">
            <legend>Repeat</legend>
            <div className="row">
              <select value={rule?.freq ?? 'none'} onChange={(e) => onRepeatKind(e.target.value)} aria-label="Repeat">
                <option value="none">Does not repeat</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
              {rule && (
                <>
                  <span>every</span>
                  <input type="number" min={1} max={999} className="cal-num" value={rule.interval} onChange={(e) => setRuleField({ interval: Math.max(1, Number(e.target.value) || 1) })} aria-label="Repeat every" />
                  <span>{unit}</span>
                </>
              )}
            </div>
            {rule?.freq === 'weekly' && (
              <div className="row cal-days" role="group" aria-label="Repeat on">
                {WEEKDAYS_SHORT.map((w, d) => {
                  const on = (rule.byWeekday ?? []).includes(d);
                  return (
                    <button type="button" key={w} className={`cal-daybtn ${on ? 'on' : ''}`} aria-pressed={on} aria-label={WEEKDAYS_LONG[d]}
                      onClick={() => {
                        const cur = rule.byWeekday ?? [];
                        const next = on ? cur.filter((x) => x !== d) : [...cur, d];
                        setRuleField({ byWeekday: next.length ? next.sort((a, b) => a - b) : cur });
                      }}>{w[0]}<span className="sr-only">{w}</span></button>
                  );
                })}
              </div>
            )}
            {rule?.freq === 'monthly' && (
              <select value={rule.monthly ?? 'date'} onChange={(e) => setRuleField({ monthly: e.target.value as Recurrence['monthly'] })} aria-label="Monthly pattern">
                <option value="date">On day {Number(startForRule.slice(8, 10))} (last day in shorter months)</option>
                <option value="nth">On the {['', '1st', '2nd', '3rd', '4th'][nth.nth]} {WEEKDAYS_LONG[nth.weekday]}</option>
                <option value="last">On the last {WEEKDAYS_LONG[nth.weekday]}</option>
              </select>
            )}
            {rule && (
              <div className="row">
                <select value={rule.end.type} onChange={(e) => {
                  const t = e.target.value;
                  setRuleField({ end: t === 'until' ? { type: 'until', date: addDays(startForRule, 90) } : t === 'count' ? { type: 'count', count: 10 } : { type: 'never' } });
                }} aria-label="Repeat ends">
                  <option value="never">Never ends</option>
                  <option value="until">Ends on a date</option>
                  <option value="count">Ends after a number of times</option>
                </select>
                {rule.end.type === 'until' && <input type="date" value={rule.end.date} onChange={(e) => e.target.value && setRuleField({ end: { type: 'until', date: e.target.value } })} aria-label="Repeat until" />}
                {rule.end.type === 'count' && <><input type="number" min={1} max={1000} className="cal-num" value={rule.end.count} onChange={(e) => setRuleField({ end: { type: 'count', count: Math.max(1, Number(e.target.value) || 1) } })} aria-label="Number of times" /><span>times</span></>}
              </div>
            )}
            {rule && <p className="muted small">{describeRule(rule, startForRule)}</p>}
          </fieldset>

          <label className="f">Location<input value={location} onChange={(e) => setLocation(e.target.value)} /></label>
          <label className="f">Notes<textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>

          <div className="f"><span>Reminders <span className="muted">(shown in the app only: no pushes, texts or emails yet)</span></span>
            <div className="row">
              {reminders.map((m) => <span key={m} className="chip">{reminderLabel(m)}<button type="button" aria-label="Remove reminder" onClick={() => setReminders(reminders.filter((x) => x !== m))}>✕</button></span>)}
              <select value="" onChange={(e) => { const m = Number(e.target.value); if (e.target.value !== '' && !reminders.includes(m)) setReminders([...reminders, m].sort((a, b) => a - b)); }} aria-label="Add a reminder">
                <option value="">Add a reminder…</option>
                {REMINDER_CHOICES.filter((c) => !reminders.includes(c.minutes)).map((c) => <option key={c.minutes} value={c.minutes}>{c.label}</option>)}
              </select>
            </div>
          </div>

          <label className="row cal-check"><input type="checkbox" checked={trackDone} onChange={(e) => setTrackDone(e.target.checked)} /> Keep it as overdue until I mark it done</label>

          <div className="f"><span>Tags</span><TagPicker value={tagIds} onChange={setTagIds} /></div>
          <div className="f"><span>People</span><ContactPicker value={contactIds} onChange={setContactIds} /></div>
          <div className="f"><span>Linked records</span>
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
            {occ && (
              <span className="row">
                {occ.trackDone && <button type="button" className="btn" onClick={async () => { await markOccurrenceDone(occ, !occ.done); toast(occ.done ? 'Marked not done' : 'Marked done'); onClose(); }}>{occ.done ? 'Mark not done' : 'Mark done'}</button>}
                <button type="button" className="btn danger" onClick={del}>Delete</button>
              </span>
            )}
          </div>
        </form>
      </Modal>
      {ask?.kind === 'save' && <ScopeDialog verb="Change" onClose={() => setAsk(null)} onPick={(s) => { const f = ask.fields; setAsk(null); void doSave(f, s); }} />}
      {ask?.kind === 'delete' && <ScopeDialog verb="Delete" onClose={() => setAsk(null)} onPick={(s) => { setAsk(null); void doDelete(s); }} />}
    </>
  );
}
