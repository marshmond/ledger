import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Modal from '../../shell/Modal';
import { useToast } from '../../ui/Toast';
import { useToday } from '../../ui/useToday';
import { localISO } from '../../core/time';
import { newId } from '../../lib/sync/track';
import { Lines, day, useMoney } from './BillsParts';
import type { Conflict } from './cycleConflicts';
import { loadCycles } from './cycleData';
import { factWords, type CycleRecord } from './cycleModel';
import { applyMove, applyRepair, planMove, planRepair, REPAIR_LABEL, type MovePlan, type RepairChoice, type RepairPlan } from './cycleRepair';
import { scheduleSource, type ObligationRecord } from './model';
import { slotWords2 } from './schedule';
import { extraSlot, moveTargets } from './slots';
import { runUndo } from './undo';

/** Previews a repair in words, then applies it in one guarded step with Undo. */
export function RepairDialog({ conflictKey, choice, onClose }: { conflictKey: string; choice: RepairChoice; onClose: () => void }) {
  const { text } = useMoney();
  const toast = useToast();
  const today = useToday();
  const [plan, setPlan] = useState<RepairPlan | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void planRepair(conflictKey, choice).then((p) => live && setPlan(p)).catch((e) => live && setError(e instanceof Error ? e.message : 'Could not read the records.'));
    return () => { live = false; };
  }, [conflictKey, choice]);
  async function go() {
    if (busy || !plan || plan.problem) return;
    setBusy(true); setError('');
    try {
      const r = await applyRepair({ key: conflictKey, choice, today });
      toast(`${REPAIR_LABEL[choice.kind]}: done`, () => runUndo(r.undo, toast).then(() => undefined));
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not do that. Nothing was changed.'); setBusy(false); }
  }
  return (
    <Modal title={REPAIR_LABEL[choice.kind]} onClose={onClose} wide>
      <div className="bl-form">
        {!plan && !error && <p className="muted">Checking…</p>}
        {plan?.problem && <p className="bl-warn" role="alert">{plan.problem}</p>}
        {plan && !plan.problem && (<><h3 className="bl-h3">What will happen</h3><Lines lines={plan.lines.map(text)} /></>)}
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row bl-actions">
          <button type="button" className="btn" onClick={onClose}>{plan?.problem ? 'Close' : 'Cancel'}</button>
          {plan && !plan.problem && <button type="button" className={`btn ${choice.kind === 'remove' ? 'danger' : 'primary'}`} disabled={busy} onClick={() => void go()}>{REPAIR_LABEL[choice.kind]}</button>}
        </div>
      </div>
    </Modal>
  );
}

/**
 * Records that disagree (or look alike), side by side, with the approved choices. Nothing is merged or chosen for you; the amount owed stays unknown
 * while two bills disagree. Every choice opens a preview first.
 */
export function ConflictCard({ conflict, records, obligation }: { conflict: Conflict; records: Map<number, CycleRecord>; obligation?: ObligationRecord }) {
  const { money } = useMoney();
  const [choice, setChoice] = useState<RepairChoice | null>(null);
  const [move, setMove] = useState(false);
  const recs = conflict.ids.map((i) => records.get(i)).filter((r): r is CycleRecord => !!r);
  const has = (k: Conflict['repairs'][number]) => conflict.repairs.includes(k);
  return (
    <div className={`bl-conflict sev-${conflict.severity}`}>
      <p className="bl-conflict-text">
        <strong>{conflict.severity === 'disagree' ? 'Records disagree. ' : conflict.severity === 'duplicate' ? 'Possible duplicate. ' : 'Needs a look. '}</strong>
        {conflict.text}
        {conflict.acknowledged ? <span className="muted small"> You chose to leave this as it is.</span> : null}
      </p>
      {recs.length > 0 && (
        <ul className="plain bl-sidebyside" aria-label="The records involved">
          {recs.map((r) => (
            <li key={r.id} className="bl-rec">
              <span>{r.body ? factWords(r.body, money) : 'A record this version cannot read (kept exactly as saved)'}</span>
              <span className="muted small">Recorded {day(localISO(r.createdAt))}{r.movedFrom ? ` · moved from ${slotWords2(r.movedFrom)}` : ''}{typeof r.raw.separatedFrom === 'string' ? ` · made separate from ${slotWords2(r.raw.separatedFrom)}` : ''}</span>
              {r.body && has('use-one') && conflict.candidates.includes(r.id) && <button className="btn" onClick={() => setChoice({ kind: 'use-one', keepId: r.id })}>{conflict.kind === 'skip-payment' ? 'Use this payment (set the skip aside)' : 'Use this one'}</button>}
              {r.body && has('different-bills') && conflict.candidates.includes(r.id) && <button className="btn" onClick={() => setChoice({ kind: 'different-bills', moveId: r.id })}>These are different bills (make this one separate)</button>}
            </li>
          ))}
        </ul>
      )}
      <div className="bl-actionrow">
        {has('move') && obligation && conflict.slot && <button className="btn" onClick={() => setMove(true)}>Move to another billing period…</button>}
        {has('remove') && <button className="btn danger" onClick={() => setChoice({ kind: 'remove' })}>{REPAIR_LABEL.remove}</button>}
        {has('leave') && !conflict.acknowledged && conflict.obligationId !== null && <button className="btn" onClick={() => setChoice({ kind: 'leave' })}>Leave as is</button>}
      </div>
      {choice && <RepairDialog conflictKey={conflict.key} choice={choice} onClose={() => setChoice(null)} />}
      {move && obligation && conflict.slot && <MoveDialog obligation={obligation} from={conflict.slot} defaultTo={conflict.target} onClose={() => setMove(false)} />}
    </div>
  );
}

/** "Move to another billing period": the one explicit way to change which period records belong to. Preview, then one guarded step with Undo. */
export function MoveDialog({ obligation, from, defaultTo, onClose }: { obligation: ObligationRecord; from: string; defaultTo?: string | null; onClose: () => void }) {
  const toast = useToast();
  const today = useToday();
  const cycles = useLiveQuery(() => loadCycles(), []);
  const [newExtra] = useState(() => extraSlot(newId()));
  const [to, setTo] = useState<string>(defaultTo ?? '');
  const [plan, setPlan] = useState<MovePlan | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const options = useMemo(() => {
    const held = new Set((cycles ?? []).filter((c) => c.obligationId === obligation.id && c.slot !== null && c.movedFrom !== from).map((c) => c.slot as string));
    return moveTargets(scheduleSource(obligation.data), today).filter((t) => t.slot !== from && (!held.has(t.slot) || t.slot === defaultTo));
  }, [cycles, obligation, from, today, defaultTo]);
  useEffect(() => {
    if (!to) { setPlan(null); return; }
    let live = true;
    void planMove(obligation.id, from, to).then((p) => live && setPlan(p)).catch((e) => live && setError(e instanceof Error ? e.message : 'Could not read the records.'));
    return () => { live = false; };
  }, [obligation.id, from, to, cycles]);
  async function go() {
    if (busy || !plan || plan.problem) return;
    setBusy(true); setError('');
    try {
      const r = await applyMove({ obligationId: obligation.id, from, to, expect: plan.expect, today });
      toast(`Moved ${r.moved} record${r.moved === 1 ? '' : 's'}`, () => runUndo(r.undo, toast).then(() => undefined));
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not move them. Nothing was changed.'); setBusy(false); }
  }
  return (
    <Modal title="Move to another billing period" onClose={onClose} wide>
      <div className="bl-form">
        <p className="muted" style={{ margin: 0 }}>Records of <strong>{slotWords2(from)}</strong> for {obligation.data.title}.</p>
        <label className="f">Move them to
          <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="Move to">
            <option value="">Choose a period…</option>
            {options.map((o) => <option key={o.slot} value={o.slot}>{slotWords2(o.slot)} ({day(o.nominal)})</option>)}
            {defaultTo && !options.some((o) => o.slot === defaultTo) && <option value={defaultTo}>{slotWords2(defaultTo)}</option>}
            <option value={newExtra}>A new extra bill</option>
          </select>
        </label>
        {plan?.problem && <p className="bl-warn" role="alert">{plan.problem}</p>}
        {plan && !plan.problem && (<><h3 className="bl-h3">What will happen</h3><Lines lines={plan.lines} /></>)}
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row bl-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={busy || !plan || !!plan.problem} onClick={() => void go()}>Move them</button>
        </div>
      </div>
    </Modal>
  );
}
