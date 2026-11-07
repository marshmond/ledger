import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from '../../core/router';
import { dayLabel } from '../../core/time';
import { EmptyState } from '../../ui/components';
import { useToast } from '../../ui/Toast';
import { useToday } from '../../ui/useToday';
import { formatCents, todayISO } from '../../lib/money';
import { loadHideAmounts } from '../today/layout';
import ArrangementForm from './ArrangementForm';
import { LifecycleDialog, RepairDialog, ScheduleDialog } from './Dialogs';
import type { LifecycleAction, RepairKind } from './changes';
import { bookingTasksOf, ensureNextVisitTask } from './data';
import { LogVisitDialog, OneOffDialog } from './VisitDialogs';
import VisitList from './VisitList';
import { addBookingReminder, unloggedVisits } from './visits';
import { visitStats, type VisitStatus } from './visitModel';
import { BASIS_LABEL, cadenceText, END_REASON_LABEL, STATUS_LABEL } from './model';
import { arrangementRoute, providerRoute, visitRoute } from './paths';
import { loadSnapshot, buildRow, visitRows, type Row } from './views';
import { markersOf } from './schedule';
import { ArrangementMoney } from './PaymentUI';
import { contractWarnings, datesOf } from './contract';
import ProjectLinks from './ProjectLinkCard';
import { ContractDialog, MoveDialog } from './S4Dialogs';

const day = (d: string) => dayLabel(d, { weekday: 'short', year: true });

/** One arrangement: who, how often, the next visit and whether it matches the schedule, what it serves, and the actions. */
export default function ArrangementPage({ id }: { id: number }) {
  const today = useToday() || todayISO();
  const snap = useLiveQuery(() => loadSnapshot(), []);
  const [life, setLife] = useState<LifecycleAction | null>(null);
  const [edit, setEdit] = useState(false);
  const [sched, setSched] = useState(false);
  const [fix, setFix] = useState<{ kind: RepairKind; taskId: number | null } | null>(null);
  const [logging, setLogging] = useState<{ taskId: number; status: VisitStatus } | null>(null);
  const [past, setPast] = useState(false);
  const [contract, setContract] = useState(false);
  const [moving, setMoving] = useState<number | null>(null);
  const bookings = useLiveQuery(() => bookingTasksOf(id), [id]) ?? [];

  if (!snap) return <div className="sv"><p className="muted">Loading…</p></div>;
  const a = snap.arrangements.find((x) => x.id === id);
  if (!a) return <div className="sv"><p><Link to="/">← Household Services</Link></p><EmptyState title="That arrangement is not here">It may have been removed on another device, or the address is wrong.</EmptyState></div>;
  const row = buildRow(snap, a);
  const d = a.data;
  const hide = loadHideAmounts();
  const pred = d.predecessorId !== null ? snap.arrangements.find((x) => x.id === d.predecessorId) : undefined;
  const succ = snap.arrangements.find((x) => x.data.predecessorId === a.id);
  const money = (c: number) => (hide ? '$••••' : formatCents(c));
  const mine = snap.visits.filter((v) => v.data.arrangementId === a.id);
  const stats = visitStats(mine);
  const unlogged = unloggedVisits([a], snap.tasksBy, snap.visits);
  const alreadyLogged = row.open ? snap.visits.find((v) => v.data.taskId === row.open!.id) : undefined;

  return (
    <div className="sv">
      <p className="sv-back"><Link to="/">← Household Services</Link></p>
      <div className="sv-head">
        <div>
          <h1>{d.title}</h1>
          <p className="sv-chips">
            <span className={`sv-chip s-${d.status}`}>{STATUS_LABEL[d.status]}{d.status === 'ended' && d.endReason ? `: ${END_REASON_LABEL[d.endReason].toLowerCase()}` : ''}</span>
            {d.providerContactId !== null ? <Link to={providerRoute(d.providerContactId)}>{row.contactGone ? `${d.providerNameSnapshot} (contact removed)` : d.providerNameSnapshot}</Link> : <span className="muted">No provider yet</span>}
          </p>
        </div>
        <div className="sv-head-actions">
          <button className="btn" onClick={() => setEdit(true)}>Edit</button>
          {d.status === 'active' && <button className="btn" onClick={() => setLife('pause')}>Pause</button>}
          {d.status === 'paused' && <button className="btn primary" onClick={() => setLife('resume')}>Resume</button>}
          {d.status !== 'ended' && <button className="btn" onClick={() => setLife('replace')}>Replace provider</button>}
          {d.status !== 'ended' && <button className="btn" onClick={() => setLife('end')}>End</button>}
        </div>
      </div>

      {(pred || succ) && (
        <p className="sv-note small">
          {pred && <>Replaced <Link to={arrangementRoute(pred.id)}>{pred.data.providerNameSnapshot || 'the earlier arrangement'}</Link>. </>}
          {succ && <>Replaced by <Link to={arrangementRoute(succ.id)}>{succ.data.providerNameSnapshot || 'a new arrangement'}</Link>. This one keeps its original provider.</>}
        </p>
      )}

      <section className="card sv-card" aria-labelledby="sv-sched-h">
        <div className="sv-card-head"><h2 id="sv-sched-h">Schedule</h2>{d.status !== 'ended' && <button className="btn" onClick={() => setSched(true)}>Change schedule</button>}</div>
        <dl className="sv-facts">
          <div className="sv-fact"><dt>How often</dt><dd>{cadenceText(d.cadence)}{d.visitTime ? ` at ${d.visitTime}` : ''}</dd></div>
          <div className="sv-fact"><dt>Next visit</dt><dd><NextVisit row={row} today={today} /></dd></div>
          {d.startDate && <div className="sv-fact"><dt>Started</dt><dd>{day(d.startDate)}</dd></div>}
          {d.endDate && <div className="sv-fact"><dt>Ended</dt><dd>{day(d.endDate)}</dd></div>}
        </dl>
        <HealthBlock row={row} onFix={(kind, taskId) => setFix({ kind, taskId })} />
        {row.open && d.status !== 'ended' && alreadyLogged && (
          <p className="sv-warn small" role="alert">A visit was already logged for this task (maybe on another device). <Link to={visitRoute(alreadyLogged.id)}>Look at it</Link>. The task is open again, probably because it was edited on another device.</p>
        )}
        {row.open && d.status !== 'ended' && !alreadyLogged && (
          <div className="sv-actionrow" role="group" aria-label="Log the upcoming visit">
            <button className="btn primary" onClick={() => setLogging({ taskId: row.open!.id, status: 'completed' })}>Done, log it</button>
            <button className="btn" onClick={() => setLogging({ taskId: row.open!.id, status: 'skipped' })}>Skip this visit</button>
            <button className="btn" onClick={() => setLogging({ taskId: row.open!.id, status: 'cancelled' })}>Cancel this visit</button>
          </div>
        )}
        {d.status === 'active' && !row.open && !d.cadence && <OneOff id={a.id} />}
        {d.status === 'paused' && <p className="muted small">Paused. The schedule is kept; Resume brings it back with no catching up on missed visits.</p>}
      </section>

      <ArrangementMoney arrangement={a} />

      <section className="card sv-card" aria-labelledby="sv-asset-h">
        <h2 id="sv-asset-h">Property or assets it serves</h2>
        {row.assets.length === 0 ? <p className="muted">None linked. Use Edit to link a property or an appliance.</p> : (
          <ul className="plain sv-items">
            {row.assets.map((as) => (
              <li key={as.id}>
                {as.missing ? <span className="sv-warn">{as.name}. Use Edit to remove the link.</span> : <a href={`#/assets/${as.id}`}><strong>{as.name}</strong></a>}
                {!as.missing && <div className="small muted">{as.typeLabel} · <span className={as.past ? 'sv-late' : ''}>{as.statusLabel}</span>{as.archived ? ' · Archived' : ''}{as.past && as.replacedBy ? ` · replaced by ${as.replacedBy}` : ''}</div>}
                {d.status !== 'ended' && !as.missing && (as.past || as.archived) && (
                  <div className="sv-note small" role="note">
                    <strong>{as.status === 'replaced' ? 'This arrangement still serves a replaced asset.' : as.status === 'sold' || as.status === 'disposed' ? `This arrangement still serves an asset that was ${as.statusLabel.toLowerCase()}.` : 'This arrangement serves an archived asset.'}</strong>
                    {as.status === 'replaced' && as.replacementId !== null && <> Future service coverage can point at {as.replacedBy ?? 'the replacement'} instead. Past visits keep pointing at the old asset.</>}
                    {as.status === 'replaced' && as.replacementId === null && <> Its replacement is missing or cannot be used (it may be deleted, archived, not synced yet, or not chosen). Ledger will not pick one for you. Fix the replacement in Home &amp; Assets, or choose another asset with Edit.</>}
                    <div className="sv-actionrow">
                      {as.status === 'replaced' && as.replacementId !== null && <button type="button" className="btn primary" onClick={() => setMoving(as.id)}>Move to replacement…</button>}
                      <button type="button" className="btn" onClick={() => setEdit(true)}>Choose assets…</button>
                      <button type="button" className="btn" onClick={() => setLife('end')}>End this arrangement…</button>
                    </div>
                    <span className="muted"> Or leave it as it is: this notice stays until you decide. Nothing moves or ends by itself.</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card sv-card" aria-labelledby="sv-con-h">
        <div className="sv-card-head"><h2 id="sv-con-h">Contract dates</h2><button type="button" className="btn" onClick={() => setContract(true)}>{d.renewalDate || d.noticeByDate ? 'Edit dates' : 'Add dates'}</button></div>
        {d.renewalDate || d.noticeByDate ? (
          <dl className="sv-facts">
            <div className="sv-fact"><dt>Renews</dt><dd>{d.renewalDate ? day(d.renewalDate) : <span className="muted">Not set</span>}</dd></div>
            <div className="sv-fact"><dt>Give notice by</dt><dd>{d.noticeByDate ? day(d.noticeByDate) : <span className="muted">Not set</span>}</dd></div>
          </dl>
        ) : <p className="muted">No renewal or notice date. Add them if this service has an agreement you may want to change or cancel.</p>}
        {contractWarnings(datesOf(d), d.status, today).map((w, i) => <p key={i} className="sv-warn small" role="status">{w}</p>)}
        <p className="muted small">You enter these yourself for each agreement period. Ledger shows them on the Calendar and Today. It never renews, cancels or repeats them for you.</p>
      </section>

      <ProjectLinks end={{ kind: 'arrangement', id: a.id }} />

      <section className="card sv-card" aria-labelledby="sv-cost-h">
        <h2 id="sv-cost-h">Cost estimate</h2>
        {d.expected ? <p><strong>{money(d.expected.cents)}</strong> {BASIS_LABEL[d.expected.basis]} <span className="sv-chip">Estimate</span></p> : <p className="muted">No estimate. Add one with Edit if you want a rough idea.</p>}
        <p className="muted small">An estimate only. It is not money spent, and nothing here reads your Finance records.</p>
      </section>

      {(d.notes || d.refs.length > 0) && (
        <section className="card sv-card" aria-labelledby="sv-notes-h">
          <h2 id="sv-notes-h">Notes and documents</h2>
          {d.refs.length > 0 && <ul className="plain sv-items">{d.refs.map((r, i) => <li key={i}>{r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer">{r.label}</a> : r.label}{r.note && <div className="small muted">{r.note}</div>}</li>)}</ul>}
          {d.notes && <p className="sv-notes">{d.notes}</p>}
        </section>
      )}

      {unlogged.length > 0 && (
        <section className="card sv-card" aria-labelledby="sv-unl-h">
          <h2 id="sv-unl-h">Finished, not yet logged</h2>
          <p className="muted small">These tasks were finished in Tasks or the Calendar, but no visit was saved. Nothing is saved until you choose.</p>
          <ul className="plain sv-items">
            {unlogged.map((u) => (
              <li key={u.task.id}>
                <strong>{u.task.data.title}</strong> <span className="muted small">finished {u.finishedOn ? day(u.finishedOn) : 'on an unknown day'}</span>
                {u.staleCopy && <div className="small sv-warn">The next visit task still carries this one's old date. Logging this will fix it.</div>}
                <div className="sv-actionrow">
                  <button className="btn" onClick={() => setLogging({ taskId: u.task.id, status: 'completed' })}>Log it as done</button>
                  <button className="btn" onClick={() => setLogging({ taskId: u.task.id, status: 'skipped' })}>It was skipped</button>
                  <button className="btn" onClick={() => setLogging({ taskId: u.task.id, status: 'cancelled' })}>It was cancelled</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card sv-card" aria-labelledby="sv-book-h">
        <h2 id="sv-book-h">Reminders to book</h2>
        <p className="muted small">A reminder such as "Book the furnace service" is an ordinary task. Finishing it does not log a visit.</p>
        {bookings.length > 0 && <ul className="plain sv-items">{bookings.map((t) => <li key={t.id}><a href={`#/tasks?task=${t.id}`}>{t.data.title}</a><span className="muted small"> · {t.data.status === 'done' ? 'done' : t.data.dueDate ? day(t.data.dueDate) : 'no date'}</span></li>)}</ul>}
        {d.status !== 'ended' && <BookingReminder id={a.id} />}
      </section>

      <section className="card sv-card" aria-labelledby="sv-vis-h">
        <div className="sv-card-head"><h2 id="sv-vis-h">Visit history</h2><button className="btn" onClick={() => setPast(true)}>Log a past visit</button></div>
        {mine.length > 0 && (
          <p className="sv-stats small" aria-label="Visit totals">
            <span>Completed: <strong>{stats.completed}</strong></span><span>Skipped: <strong>{stats.skipped}</strong></span><span>Cancelled: <strong>{stats.cancelled}</strong></span>
            <span>Last serviced: <strong>{stats.lastServiced ? day(stats.lastServiced) : 'never logged'}</strong></span>
          </p>
        )}
        <VisitList rows={visitRows(snap, mine)} showProvider showArrangement={false} empty="No visits logged yet. Use Done, log it on an upcoming visit, or Log a past visit." />
      </section>

      {edit && <ArrangementForm arrangement={a} assetIds={row.assets.map((x) => x.id)} onClose={() => setEdit(false)} />}
      {sched && <ScheduleDialog arrangement={a} onClose={() => setSched(false)} />}
      {life && <LifecycleDialog arrangementId={a.id} action={life} onClose={() => setLife(null)} />}
      {logging && <LogVisitDialog arrangementId={a.id} taskId={logging.taskId} status={logging.status} onClose={() => setLogging(null)} />}
      {past && <OneOffDialog arrangementId={a.id} providerName={d.providerNameSnapshot} defaultTitle={d.title} onClose={() => setPast(false)} />}
      {fix && <RepairDialog kind={fix.kind} arrangementId={a.id} taskId={fix.taskId} onClose={() => setFix(null)} />}
      {contract && <ContractDialog arrangement={a} today={today} onClose={() => setContract(false)} />}
      {moving !== null && <MoveDialog arrangementId={a.id} oldAssetId={moving} onClose={() => setMoving(null)} />}
    </div>
  );
}

function NextVisit({ row, today }: { row: Row; today: string }) {
  if (!row.open) return <span className="muted">{row.a.data.status === 'active' ? 'Nothing scheduled' : 'None'}</span>;
  const due = row.open.data.dueDate;
  const m = markersOf(row.open);
  return (
    <>
      <a href={`#/tasks?task=${row.open.id}`}>{due ? day(due) : 'No date'}{row.open.data.dueTime ? ` at ${row.open.data.dueTime}` : ''}</a>
      {due && due < today && <span className="sv-late"> · overdue</span>}
      {m.occurrence && due && m.occurrence !== due && <span className="muted small"> · moved from {day(m.occurrence)}</span>}
    </>
  );
}

function HealthBlock({ row, onFix }: { row: Row; onFix: (kind: RepairKind, taskId: number | null) => void }) {
  const h = row.health;
  if (h.state === 'ok' || h.state === 'not-applicable') return row.a.data.status === 'active' && row.open ? <p className="sv-ok" role="status">✓ The visit task matches the schedule.</p> : null;
  const btn = (kind: RepairKind, label: string, taskId: number | null = h.taskIds[0] ?? null) => <button key={kind + taskId} className="btn" onClick={() => onFix(kind, taskId)}>{label}</button>;
  return (
    <div className={`sv-health ${h.needsAttention ? 'attn' : ''}`} role={h.needsAttention ? 'alert' : 'status'}>
      <strong>{h.needsAttention ? '⚠ ' : 'ℹ '}{h.message}</strong>
      {h.acknowledged && <span className="muted small"> (you chose to leave this as it is)</span>}
      {h.detail.length > 0 && <ul className="plain sv-lines">{h.detail.map((x, i) => <li key={i}>{x}</li>)}</ul>}
      {h.state !== 'moved-once' && <p className="muted small">Nothing has been changed. Choose a fix to see exactly what it would do first.</p>}
      <div className="row">
        {h.state === 'no-task' && btn('schedule-next', 'Schedule the next visit', null)}
        {h.state === 'duplicate-open' && row.tasks.filter((t) => h.taskIds.includes(t.id)).map((t) => btn('keep-one', `Keep only ${t.data.dueDate ? day(t.data.dueDate) : 'the undated one'}`, t.id))}
        {h.state === 'rule-differs' && <>{btn('task-follows', 'Make the task follow the arrangement')}{btn('arrangement-follows', 'Make the arrangement follow the task')}</>}
        {h.state === 'stale-marker' && btn('realign', 'Re-align it to the arrangement')}
        {h.state === 'off-cadence' && <>{btn('one-time-move', 'Treat it as a one-time move')}{btn('realign', 'Re-align it to the arrangement')}</>}
        {h.needsAttention && h.ackKey && btn('leave', 'Leave it as it is')}
      </div>
    </div>
  );
}

/** An arrangement with no regular schedule: schedule one visit on a date, as an ordinary task. */
function OneOff({ id }: { id: number }) {
  const toast = useToast();
  const nav = useNavigate();
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [error, setError] = useState('');
  async function go() {
    setError('');
    if (!date) return setError('Pick a date.');
    try { const r = await ensureNextVisitTask(id, { today: todayISO(), date, time: time || null }); toast(r.kind === 'created' ? 'Visit scheduled in Tasks' : 'A visit is already scheduled'); if (r.kind !== 'created') nav(arrangementRoute(id)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not schedule it.'); }
  }
  return (
    <form className="sv-oneoff" onSubmit={(e) => { e.preventDefault(); void go(); }}>
      <strong>Schedule a visit</strong>
      <div className="row">
        <label className="f">Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="f">Time (optional)<input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
        <button type="submit" className="btn primary">Schedule</button>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
    </form>
  );
}

/** Adds a "remind me to book" task for this arrangement. */
function BookingReminder({ id }: { id: number }) {
  const toast = useToast();
  const [date, setDate] = useState('');
  const [error, setError] = useState('');
  async function go() {
    setError('');
    try { await addBookingReminder(id, date || null); toast('Reminder added to Tasks'); setDate(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not add it.'); }
  }
  return (
    <form className="sv-oneoff" onSubmit={(e) => { e.preventDefault(); void go(); }}>
      <div className="row">
        <label className="f">Remind me to book on (optional)<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <button type="submit" className="btn">Add reminder</button>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
    </form>
  );
}
