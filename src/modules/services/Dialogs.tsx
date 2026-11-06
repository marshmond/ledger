import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Modal from '../../shell/Modal';
import RepeatFields from '../../ui/RepeatFields';
import { useToast } from '../../ui/Toast';
import { useNavigate } from '../../core/router';
import { store } from '../../core/store';
import type { Recurrence } from '../../core/recurrence';
import { dayOfWeek } from '../../lib/dates';
import { todayISO } from '../../lib/money';
import {
  applyLifecycle, applyRepair, applyScheduleChange, describeLifecycle, planLifecycle, planRepair, planScheduleChange, REPAIR_LABEL, TASK_CHOICE_LABEL,
  type LifecycleAction, type LifecyclePlan, type RepairKind, type RepairPlan, type SchedulePlan, type TaskChoice,
} from './changes';
import { runUndo } from './undo';
import { cadenceText, END_REASON_LABEL, END_REASONS, validateArrangement, normalizeArrangement, withExplicitWeekday, type ArrangementRecord, type Cadence, type EndReason } from './model';
import { arrangementRoute } from './paths';

const NEW = '__new';
const TITLE: Record<LifecycleAction, string> = { pause: 'Pause this arrangement', resume: 'Resume this arrangement', end: 'End this arrangement', replace: 'Replace the provider' };
const GO: Record<LifecycleAction, string> = { pause: 'Pause', resume: 'Resume', end: 'End it', replace: 'Replace provider' };
const DONE: Record<LifecycleAction, string> = { pause: 'Paused', resume: 'Resumed', end: 'Ended', replace: 'Provider replaced' };

const Lines = ({ lines }: { lines: string[] }) => (
  <ul className="plain sv-lines" aria-label="What will happen">
    {lines.map((l, i) => <li key={i} className={l.startsWith('WARNING') ? 'sv-warn' : ''} role={l.startsWith('WARNING') ? 'alert' : undefined}>{l}</li>)}
  </ul>
);

/** Pause / Resume / End / Replace provider. Shows exactly what will happen first; nothing is written until the button is pressed. */
export function LifecycleDialog({ arrangementId, action, onClose }: { arrangementId: number; action: LifecycleAction; onClose: () => void }) {
  const toast = useToast();
  const nav = useNavigate();
  const today = todayISO();
  const contacts = useLiveQuery(() => store.shared.contacts.query(), []) ?? [];
  const [plan, setPlan] = useState<LifecyclePlan | null>(null);
  const [choice, setChoice] = useState<TaskChoice>('remove');
  const [align, setAlign] = useState(true);
  const [reason, setReason] = useState<EndReason>('cancelled');
  const [endDate, setEndDate] = useState(today);
  const [pick, setPick] = useState('');
  const [newName, setNewName] = useState('');
  const [first, setFirst] = useState('');
  const [copyNotes, setCopyNotes] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { void planLifecycle(arrangementId, action, today).then((p) => { setPlan(p); setChoice(p.defaultChoice); setAlign(p.reusedDiffers); }).catch((e) => setError(e instanceof Error ? e.message : 'Could not read the arrangement.')); }, [arrangementId, action, today]);

  const newProviderName = pick === NEW ? newName.trim() : contacts.find((c) => String(c.id) === pick)?.name ?? '';
  const lines = useMemo(() => (plan ? describeLifecycle(plan, { taskChoice: choice, alignReused: align, endReason: action === 'end' ? reason : undefined, endDate: action === 'end' || action === 'replace' ? endDate : undefined, providerName: newProviderName, copyNotes }) : []), [plan, choice, align, reason, endDate, action, newProviderName, copyNotes]);
  const hasTasks = (plan?.tasks.length ?? 0) > 0;
  const needsTaskChoice = hasTasks && (action === 'pause' || action === 'end' || action === 'replace');

  async function go() {
    if (!plan || busy) return;
    if (action === 'replace' && !pick) return setError('Pick the new provider.');
    if (action === 'replace' && pick === NEW && !newName.trim()) return setError('Enter the new provider\'s name.');
    setBusy(true); setError('');
    try {
      const res = await applyLifecycle({
        action, arrangementId, expect: plan.expect, today, taskChoice: choice, alignReused: align, endReason: reason, endDate: action === 'end' || action === 'replace' ? endDate : undefined,
        replace: action === 'replace' ? { provider: pick === NEW ? { name: newName } : { contactId: Number(pick) }, firstDate: first || null, copyNotes } : undefined,
      });
      toast(DONE[action], () => runUndo(res.undo, toast).then(() => undefined));
      onClose();
      if (res.successorId) nav(arrangementRoute(res.successorId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not do that. Nothing was changed.');
      setBusy(false);
    }
  }

  return (
    <Modal title={TITLE[action]} onClose={onClose} wide>
      <div className="sv-form">
        {!plan && !error && <p className="muted">Checking…</p>}
        {plan?.problem && <p className="sv-warn" role="alert">{plan.problem}</p>}
        {plan && !plan.problem && (
          <>
            {action === 'end' && (
              <div className="sv-two">
                <label className="f">Why is it ending?<select value={reason} onChange={(e) => setReason(e.target.value as EndReason)}>{END_REASONS.filter((r) => r !== 'replaced').map((r) => <option key={r} value={r}>{END_REASON_LABEL[r]}</option>)}</select></label>
                <label className="f">Ends on<input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
              </div>
            )}
            {action === 'replace' && (
              <>
                <label className="f">New provider
                  <select value={pick} onChange={(e) => setPick(e.target.value)}>
                    <option value="">Pick…</option>
                    {contacts.filter((c) => c.id !== plan.arrangement.data.providerContactId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    <option value={NEW}>A new provider…</option>
                  </select>
                </label>
                {pick === NEW && <label className="f">New provider name<input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={120} /></label>}
                <div className="sv-two">
                  <label className="f">Old arrangement ends on<input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
                  {plan.arrangement.data.cadence && <label className="f">First visit date (optional)<input type="date" value={first} onChange={(e) => setFirst(e.target.value)} /></label>}
                </div>
                <label className="as-check"><input type="checkbox" checked={copyNotes} onChange={(e) => setCopyNotes(e.target.checked)} /> Copy my notes to the new arrangement</label>
                {copyNotes && <p className="muted small">Notes can hold details about the old provider. Check them afterwards.</p>}
              </>
            )}
            {needsTaskChoice && (
              <fieldset className="sv-sub">
                <legend>The upcoming visit task</legend>
                {(['remove', 'stop', 'keep'] as TaskChoice[]).map((c) => (
                  <label key={c} className="as-check"><input type="radio" name="svchoice" checked={choice === c} onChange={() => setChoice(c)} /> {TASK_CHOICE_LABEL[c]}</label>
                ))}
              </fieldset>
            )}
            {action === 'resume' && plan.reusedDiffers && (
              <label className="as-check"><input type="checkbox" checked={align} onChange={(e) => setAlign(e.target.checked)} /> Make the existing task repeat like the schedule</label>
            )}
            <h3 className="sv-h3">What will happen</h3>
            <Lines lines={lines} />
          </>
        )}
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row sv-actions">
          <button type="button" className="btn" onClick={onClose}>{plan?.problem ? 'Close' : 'Cancel'}</button>
          {plan && !plan.problem && <button type="button" className={`btn ${action === 'end' ? 'danger' : 'primary'}`} disabled={busy} onClick={() => void go()}>{GO[action]}</button>}
        </div>
      </div>
    </Modal>
  );
}

/** Change the standing schedule. Shows both choices for the visit that is already scheduled, with the dates they give. */
export function ScheduleDialog({ arrangement, onClose }: { arrangement: ArrangementRecord; onClose: () => void }) {
  const toast = useToast();
  const today = todayISO();
  const c = arrangement.data.cadence;
  const [rule, setRule] = useState<Recurrence | null>(c?.rule ?? null);
  const [mode, setMode] = useState<'fixed' | 'after'>(c?.mode ?? 'fixed');
  const [first, setFirst] = useState(c?.anchorDate ?? today);
  const [time, setTime] = useState(arrangement.data.visitTime ?? '');
  const [visit, setVisit] = useState<'move' | 'keep'>('move');
  const [plan, setPlan] = useState<SchedulePlan | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const cadence: Cadence | null = rule ? { mode, rule: withExplicitWeekday(rule, first), anchorDate: first } : null;
  const problem = rule ? validateArrangement(normalizeArrangement({ ...arrangement.data, cadence, visitTime: time || null })) : null;
  const key = JSON.stringify([cadence, time]);
  useEffect(() => {
    let live = true;
    if (problem) { setPlan(null); return; }
    void planScheduleChange(arrangement.id, cadence, time || null, today).then((p) => live && setPlan(p)).catch((e) => live && setError(e instanceof Error ? e.message : 'Could not read the arrangement.'));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, arrangement.id, today]);

  const onFirst = (v: string) => { setFirst(v); if (v && rule?.freq === 'weekly' && (rule.byWeekday?.length ?? 0) <= 1) setRule({ ...rule, byWeekday: [dayOfWeek(v)] }); };
  const hasOpen = (plan?.tasks.length ?? 0) > 0;

  async function save() {
    if (!plan || busy) return;
    setBusy(true); setError('');
    try {
      const res = await applyScheduleChange({ arrangementId: arrangement.id, expect: plan.expect, today, cadence, visitTime: time || null, currentVisit: visit });
      toast('Schedule changed', () => runUndo(res.undo, toast).then(() => undefined));
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Nothing was changed.'); setBusy(false); }
  }

  return (
    <Modal title="Change schedule" onClose={onClose} wide>
      <div className="sv-form">
        <p className="muted small">Now: {cadenceText(c)}{arrangement.data.visitTime ? ` at ${arrangement.data.visitTime}` : ''}.</p>
        <RepeatFields rule={rule} onChange={setRule} start={first || today} mode={mode} onMode={setMode} />
        {rule && (
          <div className="sv-two">
            <label className="f">First date of the new pattern<input type="date" value={first} onChange={(e) => onFirst(e.target.value)} /></label>
            <label className="f">Time (optional)<input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
          </div>
        )}
        {rule && hasOpen && arrangement.data.status === 'active' && (
          <fieldset className="sv-sub">
            <legend>The visit that is already scheduled</legend>
            <label className="as-check"><input type="radio" name="svvisit" checked={visit === 'move'} onChange={() => setVisit('move')} /> Move it to the new pattern</label>
            <label className="as-check"><input type="radio" name="svvisit" checked={visit === 'keep'} onChange={() => setVisit('keep')} /> Keep its date, use the new pattern after it</label>
          </fieldset>
        )}
        {problem && <p className="sv-warn" role="alert">{problem}</p>}
        {plan && !problem && (
          <>
            <h3 className="sv-h3">What will happen</h3>
            {plan.problem ? <p className="sv-warn" role="alert">{plan.problem}</p> : <Lines lines={plan.lines.filter((l) => !(l.startsWith('Move the current') && visit === 'keep') && !(l.startsWith('Keep the current') && visit === 'move'))} />}
          </>
        )}
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row sv-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={busy || !plan || !!plan.problem || !!problem} onClick={() => void save()}>Save schedule</button>
        </div>
      </div>
    </Modal>
  );
}

/** One schedule fix, previewed. The button is the only thing that writes. */
export function RepairDialog({ kind, arrangementId, taskId, onClose }: { kind: RepairKind; arrangementId: number; taskId: number | null; onClose: () => void }) {
  const toast = useToast();
  const today = todayISO();
  const [plan, setPlan] = useState<RepairPlan | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { void planRepair(kind, arrangementId, taskId, today).then(setPlan).catch((e) => setError(e instanceof Error ? e.message : 'Could not read the arrangement.')); }, [kind, arrangementId, taskId, today]);
  async function go() {
    if (!plan || busy) return;
    setBusy(true); setError('');
    try {
      const res = await applyRepair({ kind, arrangementId, taskId, expect: plan.expect, today });
      toast('Done', () => runUndo(res.undo, toast).then(() => undefined));
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not do that. Nothing was changed.'); setBusy(false); }
  }
  return (
    <Modal title={REPAIR_LABEL[kind]} onClose={onClose}>
      <div className="sv-form">
        {!plan && !error && <p className="muted">Checking…</p>}
        {plan?.effect.problem && <p className="sv-warn" role="alert">{plan.effect.problem}</p>}
        {plan && !plan.effect.problem && <><h3 className="sv-h3">What will happen</h3><Lines lines={plan.effect.lines} /></>}
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row sv-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          {plan && !plan.effect.problem && <button type="button" className="btn primary" disabled={busy} onClick={() => void go()}>{REPAIR_LABEL[kind]}</button>}
        </div>
      </div>
    </Modal>
  );
}
