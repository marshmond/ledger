import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Modal from '../../shell/Modal';
import { useToast } from '../../ui/Toast';
import { store } from '../../core/store';
import { parseAmountToCents, todayISO } from '../../lib/money';
import { loadAssets, publicLabel } from '../assets/data';
import { runUndo, type Undo } from './undo';
import { CANCELLED_BY, CHARGE_KIND_LABEL, CHARGE_KINDS, type CancelledBy, type ChargeKind, type VisitRecord, type VisitStatus } from './visitModel';
import { logStandaloneVisit, logVisitFromTask, planLogVisit, updateVisit, visitAssetIds, type LogExpect, type LogPlan, type VisitInput } from './visits';
import { notesWarning, type DocRef } from './model';

const NEW = '__new';
const TITLE: Record<VisitStatus, string> = { completed: 'Done, log it', skipped: 'Skip this visit', cancelled: 'Cancel this visit' };
const GO: Record<VisitStatus, string> = { completed: 'Log it', skipped: 'Skip this visit', cancelled: 'Cancel this visit' };
const DONE: Record<VisitStatus, string> = { completed: 'Visit logged', skipped: 'Visit skipped', cancelled: 'Visit cancelled' };
const KIND_DEFAULT: Record<VisitStatus, ChargeKind> = { completed: 'service', cancelled: 'cancellationFee', skipped: 'other' };

/** An Undo button's action: runs the guarded Undo and, if it is refused because the records changed, says so instead of failing silently. */
const undoer = (toast: (t: string) => void, undo: Undo) => async () => { await runUndo(undo, toast); };
const newOperationId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const Lines = ({ lines }: { lines: string[] }) => (
  <ul className="plain sv-lines" aria-label="What will happen">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
);

/** Amount charged (optional) and what it is for. Information only: it is never recorded as a payment. */
function ChargeFields({ status, amount, onAmount, kind, onKind }: { status: VisitStatus; amount: string; onAmount: (v: string) => void; kind: ChargeKind; onKind: (k: ChargeKind) => void }) {
  const cents = parseAmountToCents(amount);
  const bad = amount.trim() !== '' && (cents === null || cents < 0);
  return (
    <div className="sv-sub">
      <div className="sv-two">
        <label className="f">Amount charged (optional)<input value={amount} onChange={(e) => onAmount(e.target.value)} inputMode="decimal" placeholder="0.00" aria-invalid={bad} /></label>
        {amount.trim() !== '' && (
          <label className="f">What it is for
            <select value={kind} onChange={(e) => onKind(e.target.value as ChargeKind)}>
              {CHARGE_KINDS.filter((k) => !(status === 'cancelled' && k === 'service')).map((k) => <option key={k} value={k}>{CHARGE_KIND_LABEL[k]}</option>)}
            </select>
          </label>
        )}
      </div>
      {bad && <p className="sv-warn small" role="alert">That is not an amount.</p>}
      <p className="muted small">{status === 'skipped' ? 'Skipped visits usually have no charge. ' : ''}For your information only. It is not recorded as a payment and is not counted as money spent.</p>
    </div>
  );
}

/** Reads the typed amount: null when empty, undefined when it is not an amount. */
const readAmount = (t: string): number | null | undefined => {
  if (t.trim() === '') return null;
  const c = parseAmountToCents(t);
  return c === null || c < 0 ? undefined : c;
};

/**
 * "Done, log it", "Skip this visit" and "Cancel this visit" for an upcoming visit Task, and "Log this visit" for a Task that was finished in
 * Tasks or the Calendar. Shows what will happen first (from the same function that does it); one press writes everything or nothing.
 */
export function LogVisitDialog({ arrangementId, taskId, status, onClose }: { arrangementId: number; taskId: number; status: VisitStatus; onClose: () => void }) {
  const toast = useToast();
  const today = todayISO();
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState('');
  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState<ChargeKind>(KIND_DEFAULT[status]);
  const [by, setBy] = useState<CancelledBy | ''>('');
  const [plan, setPlan] = useState<LogPlan | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pressed = useRef(false);
  const first = useRef<LogExpect | null>(null);
  const seeded = useRef(false);
  const cents = readAmount(amount);

  const input = useMemo<VisitInput>(() => ({
    status, cancelledBy: status === 'cancelled' && by ? by : null, date, notes, chargedCents: cents ?? null, chargeKind: cents == null ? null : kind,
  }), [status, by, date, notes, cents, kind]);

  // The first plan fixes what the preview was based on; later plans only refresh the text.
  useEffect(() => {
    let live = true;
    void planLogVisit(arrangementId, taskId, input, today).then((p) => {
      if (!live) return;
      if (!first.current) first.current = p.expect;
      if (!seeded.current) {
        seeded.current = true;
        const start = p.mode === 'late' ? (status === 'completed' ? p.suggestedDate : p.taskDue ?? p.suggestedDate) : status === 'completed' ? today : p.taskDue ?? today;
        if (start !== date) setDate(start);
      }
      setPlan(p);
    }).catch((e) => live && setError(e instanceof Error ? e.message : 'Could not read the visit.'));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrangementId, taskId, input, today]);

  const late = plan?.mode === 'late';
  const heading = late ? 'Log this visit' : TITLE[status];
  const blocked = !plan || !!plan.problem || cents === undefined || (status === 'cancelled' && !by);

  async function go() {
    if (pressed.current || blocked || !first.current) return;
    pressed.current = true; setBusy(true); setError('');
    try {
      const res = await logVisitFromTask({ arrangementId, taskId, input, today, expect: first.current });
      toast(late ? 'Visit logged. The task was not finished again.' : DONE[status], undoer(toast, res.undo));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not log it. Nothing was changed.');
      pressed.current = false; setBusy(false);
    }
  }

  return (
    <Modal title={heading} onClose={onClose} wide>
      <form className="sv-form" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        {late && <p className="sv-note small" role="note">This task was finished in Tasks or the Calendar. Check the date it really happened. Nothing is logged until you press the button.</p>}
        {status === 'cancelled' && (
          <fieldset className="sv-sub">
            <legend>Who cancelled it?</legend>
            {CANCELLED_BY.map((c) => <label key={c} className="as-check"><input type="radio" name="svby" checked={by === c} onChange={() => setBy(c)} /> {c === 'household' ? 'We cancelled it' : 'The provider cancelled it'}</label>)}
          </fieldset>
        )}
        <label className="f">{status === 'completed' ? 'Date of the visit' : 'Date it was due'}
          <input type="date" value={date} max={status === 'completed' ? today : undefined} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="f">Notes (optional)<textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} /></label>
        {notesWarning(notes) && <p className="sv-warn small" role="alert">{notesWarning(notes)}</p>}
        <ChargeFields status={status} amount={amount} onAmount={setAmount} kind={kind} onKind={setKind} />
        {plan?.problem && <p className="sv-warn" role="alert">{plan.problem}</p>}
        {plan && !plan.problem && <><h3 className="sv-h3">What will happen</h3><Lines lines={plan.lines} /></>}
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row sv-actions">
          <button type="button" className="btn" onClick={onClose}>Not now</button>
          <button type="submit" className={`btn ${status === 'completed' ? 'primary' : ''}`} disabled={busy || blocked}>{late ? 'Log this visit' : GO[status]}</button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * A visit with no Task. With no `arrangementId` it is a one-off job (a plumber came once). With an arrangement (even an ended one) it is an
 * explicitly logged late or past visit. Neither makes an arrangement or a repeating Task.
 */
export function OneOffDialog({ arrangementId, providerName, defaultTitle, onClose }: { arrangementId?: number; providerName?: string; defaultTitle?: string; onClose: () => void }) {
  const toast = useToast();
  const today = todayISO();
  const contacts = useLiveQuery(() => store.shared.contacts.query(), []) ?? [];
  const assets = useLiveQuery(() => loadAssets(), []) ?? [];
  const forArrangement = arrangementId !== undefined;
  const [pick, setPick] = useState('');
  const [newName, setNewName] = useState('');
  const [title, setTitle] = useState(defaultTitle ?? '');
  const [status, setStatus] = useState<VisitStatus>('completed');
  const [by, setBy] = useState<CancelledBy | ''>('');
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState('');
  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState<ChargeKind>('service');
  const [docLabel, setDocLabel] = useState('');
  const [docUrl, setDocUrl] = useState('');
  const [assetId, setAssetId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pressed = useRef(false);
  const cents = readAmount(amount);
  const opId = useRef(newOperationId()); // one id per opened form: pressing Save twice saves once
  const setS = (s: VisitStatus) => { setStatus(s); setKind(KIND_DEFAULT[s]); };

  async function go(e: React.FormEvent) {
    e.preventDefault();
    if (pressed.current) return;
    if (cents === undefined) return setError('The amount charged is not an amount. Leave it blank if you do not know it.');
    if (!forArrangement && !pick) return setError('Pick the provider, or choose "A new provider" and type the name.');
    if (!forArrangement && pick === NEW && !newName.trim()) return setError('Enter the provider\'s name.');
    if (status === 'cancelled' && !by) return setError('Say who cancelled it.');
    const refs: DocRef[] = docLabel.trim() || docUrl.trim() ? [{ label: docLabel.trim() || 'Document', ...(docUrl.trim() ? { url: docUrl.trim() } : {}) }] : [];
    pressed.current = true; setBusy(true); setError('');
    try {
      const res = await logStandaloneVisit({
        arrangementId: forArrangement ? arrangementId : null,
        provider: forArrangement ? null : pick === NEW ? { name: newName } : { contactId: Number(pick) },
        input: { title, status, cancelledBy: status === 'cancelled' && by ? by : null, date, notes, chargedCents: cents ?? null, chargeKind: cents == null ? null : kind, refs },
        assetIds: assetId ? [Number(assetId)] : forArrangement ? undefined : [], today, operationId: opId.current,
      });
      toast(res.repeated ? 'Already saved (that was a repeated press).' : res.similarVisitId !== null ? 'Visit logged. A similar visit was already logged for that day. Both are kept; check they are not the same one.' : forArrangement ? 'Visit logged' : 'One-off visit logged', res.repeated ? undefined : undoer(toast, res.undo));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save it.');
      pressed.current = false; setBusy(false);
    }
  }

  return (
    <Modal title={forArrangement ? 'Log a past visit' : 'Log a one-off visit'} onClose={onClose} wide>
      <form className="sv-form" onSubmit={(e) => void go(e)}>
        <p className="muted small">{forArrangement ? 'Saves a visit that already happened. It does not create a task or change the schedule.' : 'For a job that does not repeat, such as a plumber or an inspection. It does not create a standing arrangement or a task.'}</p>
        {forArrangement ? (
          <p><strong>Provider:</strong> {providerName || 'None yet'}</p>
        ) : (
          <>
            <label className="f">Provider
              <select value={pick} onChange={(e) => setPick(e.target.value)} autoFocus>
                <option value="">Pick…</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value={NEW}>A new provider…</option>
              </select>
            </label>
            {pick === NEW && <label className="f">Provider name<input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={120} /></label>}
          </>
        )}
        <label className="f">What was done<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Replaced the outdoor tap" maxLength={120} /></label>
        {forArrangement && (
          <label className="f">What happened
            <select value={status} onChange={(e) => setS(e.target.value as VisitStatus)}><option value="completed">Completed</option><option value="skipped">Skipped</option><option value="cancelled">Cancelled</option></select>
          </label>
        )}
        {status === 'cancelled' && (
          <fieldset className="sv-sub">
            <legend>Who cancelled it?</legend>
            {CANCELLED_BY.map((c) => <label key={c} className="as-check"><input type="radio" name="svoby" checked={by === c} onChange={() => setBy(c)} /> {c === 'household' ? 'We cancelled it' : 'The provider cancelled it'}</label>)}
          </fieldset>
        )}
        <label className="f">Date<input type="date" value={date} max={status === 'completed' ? today : undefined} onChange={(e) => setDate(e.target.value)} /></label>
        <details className="sv-sec">
          <summary>More details (optional)</summary>
          <label className="f">Notes<textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} /></label>
          {notesWarning(notes) && <p className="sv-warn small" role="alert">{notesWarning(notes)}</p>}
          <p className="muted small">Do not store codes, passwords or bank details here. Plain backups and exports are not encrypted.</p>
          <ChargeFields status={status} amount={amount} onAmount={setAmount} kind={kind} onKind={setKind} />
          <div className="sv-ref">
            <input value={docLabel} onChange={(e) => setDocLabel(e.target.value)} placeholder="Document name (Invoice…)" aria-label="Document name" />
            <input value={docUrl} onChange={(e) => setDocUrl(e.target.value)} placeholder="https://…" aria-label="Document link" inputMode="url" />
          </div>
          <label className="f">Property or asset it concerned
            <select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              <option value="">None</option>
              {assets.filter((a) => !a.data.archived).map((a) => <option key={a.id} value={a.id}>{publicLabel(assets, a.id)}</option>)}
            </select>
          </label>
        </details>
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row sv-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>Save visit</button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Edit what is written about a past visit. The provider, the arrangement and the task it came from are shown but cannot be changed: they
 * are history. There is no delete.
 */
export function VisitEditDialog({ visit, onClose }: { visit: VisitRecord; onClose: () => void }) {
  const toast = useToast();
  const today = todayISO();
  const d = visit.data;
  const [title, setTitle] = useState(d.title);
  const [status, setStatus] = useState<VisitStatus | 'unsupported'>(d.status);
  const [by, setBy] = useState<CancelledBy | ''>(d.cancelledBy ?? '');
  const [date, setDate] = useState(d.date);
  const [notes, setNotes] = useState(d.notes);
  const [amount, setAmount] = useState(d.chargedCents !== null ? (d.chargedCents / 100).toFixed(2) : '');
  const [kind, setKind] = useState<ChargeKind>(d.chargeKind ?? KIND_DEFAULT[d.status === 'unsupported' ? 'skipped' : d.status]);
  const [refs, setRefs] = useState<DocRef[]>(d.refs);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const cents = readAmount(amount);
  const assetIds = useLiveQuery(() => visitAssetIds(visit.id), [visit.id]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (cents === undefined) return setError('The amount charged is not an amount.');
    if (status === 'cancelled' && !by) return setError('Say who cancelled it.');
    setBusy(true); setError('');
    try {
      await updateVisit(visit.id, {
        title, status, cancelledBy: status === 'cancelled' && by ? by : null, date, endDate: d.endDate && d.endDate >= date ? d.endDate : null, notes,
        chargedCents: cents ?? null, chargeKind: cents == null ? null : kind, refs: refs.filter((r) => r.label.trim() || r.url?.trim()), assetIds: assetIds ?? [],
      }, today, visit.updatedAt);
      toast('Saved');
      onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save.'); setBusy(false); }
  }
  const setRef = (i: number, p: Partial<DocRef>) => setRefs(refs.map((r, j) => (j === i ? { ...r, ...p } : r)));

  return (
    <Modal title="Edit this visit" onClose={onClose} wide>
      <form className="sv-form" onSubmit={(e) => void save(e)}>
        <p className="muted small">The provider ({d.providerNameSnapshot || 'none'}) and where this came from cannot be changed. They are the record of what happened.</p>
        {d.status === 'unsupported' && <p className="sv-warn small" role="alert">This visit has an outcome this version does not understand ("{String(d.statusRaw)}"). It may come from a newer version. If you leave "What happened" as it is, it is kept exactly as found. Choose a real outcome only if you are sure.</p>}
        <label className="f">What was done<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} autoFocus /></label>
        <div className="sv-two">
          <label className="f">What happened
            <select value={status} onChange={(e) => { const s = e.target.value as VisitStatus | 'unsupported'; setStatus(s); if (s !== 'cancelled') setBy(''); if (cents != null && s === 'cancelled' && kind === 'service') setKind('cancellationFee'); }}>
              {d.status === 'unsupported' && <option value="unsupported">Not understood by this version (kept as it is)</option>}
              <option value="completed">Completed</option><option value="skipped">Skipped</option><option value="cancelled">Cancelled</option>
            </select>
          </label>
          <label className="f">Date<input type="date" value={date} max={status === 'completed' ? today : undefined} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        {status === 'cancelled' && (
          <fieldset className="sv-sub">
            <legend>Who cancelled it?</legend>
            {CANCELLED_BY.map((c) => <label key={c} className="as-check"><input type="radio" name="sveby" checked={by === c} onChange={() => setBy(c)} /> {c === 'household' ? 'We cancelled it' : 'The provider cancelled it'}</label>)}
          </fieldset>
        )}
        <label className="f">Notes<textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} /></label>
        {notesWarning(notes) && <p className="sv-warn small" role="alert">{notesWarning(notes)}</p>}
        <ChargeFields status={status === 'unsupported' ? 'skipped' : status} amount={amount} onAmount={setAmount} kind={kind} onKind={setKind} />
        <div className="sv-sub">
          <strong>Document links</strong>
          {refs.map((r, i) => (
            <div key={i} className="sv-ref">
              <input value={r.label} onChange={(e) => setRef(i, { label: e.target.value })} placeholder="Name" aria-label="Document name" />
              <input value={r.url ?? ''} onChange={(e) => setRef(i, { url: e.target.value })} placeholder="https://…" aria-label="Document link" inputMode="url" />
              <button type="button" className="btn" onClick={() => setRefs(refs.filter((_, j) => j !== i))} aria-label="Remove document link">✕</button>
            </div>
          ))}
          <button type="button" className="btn" onClick={() => setRefs([...refs, { label: '' }])} disabled={refs.length >= 20}>Add a link</button>
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row sv-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>Save</button>
        </div>
      </form>
    </Modal>
  );
}
