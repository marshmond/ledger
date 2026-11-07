import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Modal from '../../shell/Modal';
import { useToast } from '../../ui/Toast';
import { loadAssets, publicLabel } from '../assets/data';
import { applyMoveToReplacement, planMoveToReplacement, type MovePlan } from './assetLinks';
import { contractWarnings, datesOf } from './contract';
import { setContractDates } from './contractData';
import { handoffEligibility, handoffsOfVisit, handoffTargets } from './handoff';
import { isDate, type ArrangementRecord } from './model';
import { runUndo } from './undo';
import type { VisitRecord } from './visitModel';

/** Renewal and notice-by dates. They are two different dates; nothing here repeats, renews, cancels or reminds. */
export function ContractDialog({ arrangement, today, onClose }: { arrangement: ArrangementRecord; today: string; onClose: () => void }) {
  const toast = useToast();
  const cur = datesOf(arrangement.data);
  const [renewal, setRenewal] = useState(cur.renewalDate ?? '');
  const [notice, setNotice] = useState(cur.noticeByDate ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dates = { renewalDate: renewal || null, noticeByDate: notice || null };
  const warnings = useMemo(() => contractWarnings(dates, arrangement.data.status, today), [renewal, notice, arrangement.data.status, today]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (busy) return;
    if ((renewal && !isDate(renewal)) || (notice && !isDate(notice))) return setError('Enter real dates, or clear the box.');
    setBusy(true); setError('');
    try {
      const r = await setContractDates(arrangement.id, dates, arrangement.updatedAt);
      toast('Contract dates saved', () => runUndo(r.undo, toast).then(() => undefined));
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Nothing was changed.'); setBusy(false); }
  }
  return (
    <Modal title="Contract dates" onClose={onClose}>
      <form className="sv-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <p className="muted small">Two different dates for the service agreement. They are not visit dates. Ledger shows them on the Calendar and Today. It does not renew or cancel anything, make a reminder task, or repeat them yearly: enter the dates for each agreement period yourself.</p>
        <label className="f">Renewal date <span className="muted">(optional)</span>
          <input type="date" value={renewal} onChange={(e) => setRenewal(e.target.value)} />
          <span className="muted small">The day the agreement renews.</span>
        </label>
        <label className="f">Notice-by date <span className="muted">(optional)</span>
          <input type="date" value={notice} onChange={(e) => setNotice(e.target.value)} />
          <span className="muted small">The last day to act or give notice if you want to change or cancel it.</span>
        </label>
        {warnings.length > 0 && <ul className="plain sv-lines" aria-label="Things to check">{warnings.map((w, i) => <li key={i} className="sv-warn" role="status">{w}</li>)}</ul>}
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row sv-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="submit" className="btn primary" disabled={busy}>Save dates</button></div>
      </form>
    </Modal>
  );
}

/** Move one arrangement's link from a replaced asset to its replacement. Preview first; history is never rewritten. */
export function MoveDialog({ arrangementId, oldAssetId, onClose }: { arrangementId: number; oldAssetId: number; onClose: () => void }) {
  const toast = useToast();
  const [plan, setPlan] = useState<MovePlan | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { void planMoveToReplacement(arrangementId, oldAssetId).then(setPlan).catch((e) => setError(e instanceof Error ? e.message : 'Could not read the arrangement.')); }, [arrangementId, oldAssetId]);

  async function go() {
    if (!plan?.expect || busy) return;
    setBusy(true); setError('');
    try {
      const r = await applyMoveToReplacement({ arrangementId, expect: plan.expect });
      toast('Moved to the replacement', () => runUndo(r.undo, toast).then(() => undefined));
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not move it. Nothing was changed.'); setBusy(false); }
  }
  return (
    <Modal title="Move to the replacement" onClose={onClose} wide>
      <div className="sv-form">
        {!plan && !error && <p className="muted">Checking…</p>}
        {plan?.problem && <p className="sv-warn" role="alert">{plan.problem}</p>}
        {plan && !plan.problem && (
          <>
            <h3 className="sv-h3">What will happen</h3>
            <ul className="plain sv-lines" aria-label="What will happen">{plan.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
          </>
        )}
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row sv-actions">
          <button type="button" className="btn" onClick={onClose}>{plan && !plan.problem ? 'Cancel' : 'Close'}</button>
          {plan && !plan.problem && <button type="button" className="btn primary" disabled={busy} onClick={() => void go()}>Move to {plan.replacement?.name}</button>}
        </div>
      </div>
    </Modal>
  );
}

/** Which asset a completed visit is recorded against. The owner chooses; nothing is guessed. Opens the Home & Assets form, which saves nothing until Save. */
export function HandoffChooser({ visit, onClose }: { visit: VisitRecord; onClose: () => void }) {
  const elig = handoffEligibility(visit);
  const assets = useLiveQuery(() => loadAssets(), []);
  const linked = useLiveQuery(() => handoffTargets(visit), [visit.id]);
  const done = useLiveQuery(async () => new Map((await handoffsOfVisit(visit.id)).filter((h) => h.service).map((h) => [h.service!.data.assetId, h.serviceId])), [visit.id]);
  const [pick, setPick] = useState<string>('');
  if (!assets || !linked || !done) return <Modal title="Record maintenance in Home & Assets" onClose={onClose}><p className="muted">Loading…</p></Modal>;
  const usable = assets.filter((a) => !a.data.archived);
  const mine = linked.filter((id) => usable.some((a) => a.id === id));
  const others = usable.filter((a) => !mine.includes(a.id));
  const chosen = pick && /^\d+$/.test(pick) ? Number(pick) : null;
  const already = chosen !== null ? done.get(chosen) : undefined;
  return (
    <Modal title="Record maintenance in Home & Assets" onClose={onClose}>
      <div className="sv-form">
        {!elig.ok ? <p className="sv-warn" role="alert">{elig.reason}</p> : (
          <>
            <p className="muted small">This opens the Home & Assets service form with this visit's details filled in. Nothing is saved until you review it and press Save. You choose the asset: Ledger does not guess it from names, notes or payments.</p>
            <label className="f">Which asset was this work done on?
              <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Asset the work was done on">
                <option value="">Choose an asset…</option>
                {mine.length > 0 && <optgroup label="Linked to this visit or arrangement">{mine.map((id) => <option key={id} value={id}>{publicLabel(assets, id)}{done.has(id) ? ' (already recorded)' : ''}</option>)}</optgroup>}
                <optgroup label={mine.length ? 'Any other asset' : 'Your assets'}>{others.map((a) => <option key={a.id} value={a.id}>{publicLabel(assets, a.id)}{done.has(a.id) ? ' (already recorded)' : ''}</option>)}</optgroup>
              </select>
            </label>
            {usable.length === 0 && <p className="muted">There is no asset to record this against. Add one in Home & Assets first.</p>}
            {already !== undefined && <p className="sv-warn" role="status">This visit is already recorded for that asset. <a href={`#/assets/${chosen}?service=${already}`}>Open the existing entry</a>. A second one would be a duplicate.</p>}
          </>
        )}
        <div className="row sv-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          {elig.ok && <a className={`btn primary${chosen === null || already !== undefined ? ' disabled' : ''}`} aria-disabled={chosen === null || already !== undefined} href={chosen !== null && already === undefined ? `#/assets/${chosen}?fromVisit=${visit.id}` : undefined} onClick={(e) => { if (chosen === null || already !== undefined) e.preventDefault(); else onClose(); }}>Open the form</a>}
        </div>
      </div>
    </Modal>
  );
}
