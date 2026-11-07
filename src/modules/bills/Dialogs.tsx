import { useEffect, useMemo, useState } from 'react';
import Modal from '../../shell/Modal';
import { useToast } from '../../ui/Toast';
import { useNavigate } from '../../core/router';
import { useToday } from '../../ui/useToday';
import {
  applyLifecycle, deleteObligation, planDelete, planLifecycle, setReview, type DeletePlan, type LifecycleAction, type LifecyclePlan,
} from './data';
import { END_REASON_LABEL, END_REASONS, type EndReason, type ObligationRecord } from './model';
import { listRoute } from './paths';
import { runUndo } from './undo';
import { Lines } from './BillsParts';

const TITLE: Record<LifecycleAction, string> = { pause: 'Pause this bill', resume: 'Resume this bill', end: 'End this bill', reopen: 'Reopen this bill' };
const GO: Record<LifecycleAction, string> = { pause: 'Pause', resume: 'Resume', end: 'End it', reopen: 'Reopen' };
const DONE: Record<LifecycleAction, string> = { pause: 'Paused', resume: 'Resumed', end: 'Ended', reopen: 'Reopened' };
const DATE_LABEL: Record<LifecycleAction, string> = { pause: 'Paused from', resume: 'Expected again from', end: 'Last day it is expected', reopen: 'Expected again from' };

/** Pause / Resume / End / Reopen. Shows exactly what will happen first; nothing is written until the button is pressed. */
export function LifecycleDialog({ obligation, action, onClose }: { obligation: ObligationRecord; action: LifecycleAction; onClose: () => void }) {
  const toast = useToast();
  const today = useToday();
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState<EndReason>('cancelled');
  const [plan, setPlan] = useState<LifecyclePlan | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void planLifecycle(obligation.id, action, { today, date, reason }).then((p) => live && setPlan(p)).catch((e) => live && setError(e instanceof Error ? e.message : 'Could not read this bill.'));
    return () => { live = false; };
  }, [obligation.id, action, today, date, reason]);

  const lines = useMemo(() => plan?.lines ?? [], [plan]);

  async function go() {
    if (!plan || plan.problem || busy) return;
    setBusy(true); setError('');
    try {
      const res = await applyLifecycle({ id: obligation.id, action, expect: plan.expect, today, date, reason });
      toast(DONE[action], () => runUndo(res.undo, toast).then(() => undefined));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not do that. Nothing was changed.');
      setBusy(false);
    }
  }

  return (
    <Modal title={TITLE[action]} onClose={onClose} wide>
      <div className="bl-form">
        {!plan && !error && <p className="muted">Checking…</p>}
        {plan?.problem && <p className="bl-warn" role="alert">{plan.problem}</p>}
        {plan && !plan.problem && (
          <>
            <div className="bl-two">
              <label className="f">{DATE_LABEL[action]}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label={DATE_LABEL[action]} /></label>
              {action === 'end' && (
                <label className="f">Why is it ending?
                  <select value={reason} onChange={(e) => setReason(e.target.value as EndReason)}>{END_REASONS.map((r) => <option key={r} value={r}>{END_REASON_LABEL[r]}</option>)}</select>
                </label>
              )}
            </div>
            <h3 className="bl-h3">What will happen</h3>
            <Lines lines={lines} />
          </>
        )}
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row bl-actions">
          <button type="button" className="btn" onClick={onClose}>{plan?.problem ? 'Close' : 'Cancel'}</button>
          {plan && !plan.problem && <button type="button" className={`btn ${action === 'end' ? 'danger' : 'primary'}`} disabled={busy} onClick={() => void go()}>{GO[action]}</button>}
        </div>
      </div>
    </Modal>
  );
}

/** Permanent delete: offered only for a bill that never had any history. Otherwise it says why and points to End. */
export function DeleteDialog({ obligation, onClose }: { obligation: ObligationRecord; onClose: () => void }) {
  const toast = useToast();
  const nav = useNavigate();
  const [plan, setPlan] = useState<DeletePlan | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { void planDelete(obligation.id).then(setPlan).catch((e) => setError(e instanceof Error ? e.message : 'Could not read this bill.')); }, [obligation.id]);

  async function go() {
    if (!plan?.allowed || busy) return;
    setBusy(true); setError('');
    try {
      const res = await deleteObligation(obligation.id, plan.expect);
      toast('Deleted', () => runUndo(res.undo, toast).then(() => undefined));
      onClose();
      nav(listRoute());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete. Nothing was changed.');
      setBusy(false);
    }
  }
  return (
    <Modal title="Delete this bill" onClose={onClose}>
      <div className="bl-form">
        {!plan && !error && <p className="muted">Checking…</p>}
        {plan && <Lines lines={plan.lines} />}
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row bl-actions">
          <button type="button" className="btn" onClick={onClose}>{plan?.allowed ? 'Cancel' : 'Close'}</button>
          {plan?.allowed && <button type="button" className="btn danger" disabled={busy} onClick={() => void go()}>Delete</button>}
        </div>
      </div>
    </Modal>
  );
}

/** Put it on, or take it off, the owner's cost-review list, with an optional note. It never cancels or changes anything else. */
export function ReviewDialog({ obligation, onClose }: { obligation: ObligationRecord; onClose: () => void }) {
  const toast = useToast();
  const today = useToday();
  const [note, setNote] = useState(obligation.data.review.note);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const on = obligation.data.review.on;
  async function go(next: boolean) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const res = await setReview(obligation.id, next, note, obligation.updatedAt, today);
      toast(next ? 'Added to your review list' : 'Removed from your review list', () => runUndo(res.undo, toast).then(() => undefined));
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Nothing was changed.'); setBusy(false); }
  }
  return (
    <Modal title={on ? 'Your review list' : 'Put on your review list'} onClose={onClose}>
      <div className="bl-form">
        <p className="muted">Your own list for looking at costs again. Putting something here never cancels it, never changes its dates or amounts, and nothing is decided for you.</p>
        <label className="f">Why? (optional)<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Check whether we still use it" /></label>
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row bl-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          {on && <button type="button" className="btn" disabled={busy} onClick={() => void go(false)}>Remove from list</button>}
          <button type="button" className="btn primary" disabled={busy} onClick={() => void go(true)}>{on ? 'Save note' : 'Add to list'}</button>
        </div>
      </div>
    </Modal>
  );
}
