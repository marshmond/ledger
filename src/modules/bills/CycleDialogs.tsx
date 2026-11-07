import { useEffect, useRef, useState } from 'react';
import Modal from '../../shell/Modal';
import { useToast } from '../../ui/Toast';
import { parseAmountToCents } from '../../lib/money';
import { useToday } from '../../ui/useToday';
import { Lines } from './BillsParts';
import { editFact, newOp, planFact, recordFact, removeFact, type FactPlan } from './cycleData';
import { cleanText, validateBody, type CycleRecord, type FactBody } from './cycleModel';
import type { ObligationRecord } from './model';
import { slotWords2 } from './schedule';
import { runUndo } from './undo';

export type FactKind = 'invoice' | 'due-date' | 'paid' | 'skip' | 'credit';
const TITLE: Record<FactKind, string> = { invoice: 'Enter the bill', 'due-date': 'Set the due date', paid: 'Mark paid', skip: 'Skip this period', credit: 'Record a provider credit' };
const DONE: Record<FactKind, string> = { invoice: 'Bill recorded', 'due-date': 'Due date recorded', paid: 'Recorded as paid', skip: 'Period skipped', credit: 'Credit recorded' };

const amountText = (c: number | null | undefined) => (c === null || c === undefined ? '' : (c / 100).toFixed(2));

/**
 * One form for every billing fact: the bill (invoice), its actual due date, "paid outside Finance" or "paid in full", "not billed this period", and a
 * provider credit. It shows exactly what will happen first (including the reminder Task it will finish or make), writes in one step, saves once even
 * if pressed twice, and offers Undo. It never posts, pays or records anything in Finance. A declaration with no amount creates no amount.
 * When `taskId` is given the form is the "Done, mark paid" step for that reminder Task.
 */
export function FactDialog({ obligation, slot, kind, existing, taskId, onClose }: { obligation: ObligationRecord; slot: string; kind: FactKind; existing?: CycleRecord; taskId?: number | null; onClose: () => void }) {
  const toast = useToast();
  const today = useToday();
  const op = useRef(newOp()).current; // one per open form: a second press writes nothing
  const eb = existing?.body ?? null;
  const [choice, setChoice] = useState<'outside' | 'full'>(eb?.fact === 'paid-in-full' ? 'full' : 'outside');
  const [amount, setAmount] = useState(eb?.fact === 'invoice' ? amountText(eb.invoicedCents) : eb?.fact === 'paid-outside' ? amountText(eb.cents) : eb?.fact === 'credit' ? amountText(eb.cents) : '');
  const [zeroOk, setZeroOk] = useState(eb?.fact === 'invoice' && eb.invoicedCents === 0);
  const [invoiceDate, setInvoiceDate] = useState(eb?.fact === 'invoice' ? eb.invoiceDate ?? '' : '');
  const [dueDate, setDueDate] = useState(eb?.fact === 'invoice' ? eb.dueDate ?? '' : eb?.fact === 'due-date' ? eb.dueDate : '');
  const [number, setNumber] = useState(eb?.fact === 'invoice' ? eb.invoiceNumber : '');
  const [paidOn, setPaidOn] = useState(eb?.fact === 'paid-outside' ? eb.paidOn : eb?.fact === 'paid-in-full' ? eb.on ?? '' : today);
  const [reason, setReason] = useState(eb?.fact === 'skip' ? eb.reason : '');
  const [note, setNote] = useState(eb?.fact === 'credit' ? eb.note : '');
  const [finishTask, setFinishTask] = useState(true);
  const [plan, setPlan] = useState<FactPlan | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const cents = amount.trim() ? parseAmountToCents(amount) : null;
  const amountBad = amount.trim() !== '' && (cents === null || cents < 0);

  /** The body the form describes right now, or a plain reason it cannot be saved yet. */
  function build(): { body: FactBody } | { problem: string } {
    if (kind === 'invoice') {
      if (!amount.trim()) return { problem: 'Enter the amount from the bill.' };
      if (cents === null || amountBad) return { problem: 'The amount is not valid. Use a number such as 114.20.' };
      if (cents === 0 && !zeroOk) return { problem: 'Tick the box to confirm this bill really is $0.00.' };
      return { body: { fact: 'invoice', invoicedCents: cents, invoiceDate: invoiceDate || null, dueDate: dueDate || null, invoiceNumber: cleanText(number, 40), nominal: eb?.fact === 'invoice' ? eb.nominal : null } };
    }
    if (kind === 'due-date') return dueDate ? { body: { fact: 'due-date', dueDate } } : { problem: 'Pick the due date.' };
    if (kind === 'skip') return { body: { fact: 'skip', reason: cleanText(reason, 200) } };
    if (kind === 'credit') {
      if (!amount.trim() || cents === null || amountBad) return { problem: 'Enter the credit amount, such as 20.00.' };
      return { body: { fact: 'credit', cents, note: cleanText(note, 200) } };
    }
    if (choice === 'full') return { body: { fact: 'paid-in-full', on: paidOn || null } };
    if (amountBad) return { problem: 'The amount is not valid. Use a number such as 114.20, or leave it empty.' };
    return paidOn ? { body: { fact: 'paid-outside', paidOn, cents: cents } } : { problem: 'Pick the date it was paid.' };
  }
  const built = build();
  const problem = 'problem' in built ? built.problem : validateBody(built.body);

  // what will happen: re-worked whenever a valid form changes (a new record only; an edit just says it changes one record)
  const bodyKey = 'body' in built ? JSON.stringify(built.body) : '';
  useEffect(() => {
    if (existing || !('body' in built) || problem) { setPlan(null); return; }
    let live = true;
    void planFact({ obligationId: obligation.id, slot, body: built.body, today }).then((p) => live && setPlan(p)).catch(() => live && setPlan(null));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyKey, obligation.id, slot, today, existing?.id]);

  async function save() {
    if (busy || problem || !('body' in built)) return;
    setBusy(true); setError('');
    try {
      let undo;
      if (existing) {
        undo = (await editFact(existing.id, built.body, existing.updatedAt, today)).undo;
      } else {
        const finish = plan?.taskId != null && finishTask ? plan.taskId : taskId ?? null;
        const r = await recordFact({ obligationId: obligation.id, slot, body: built.body, op, today, finishTaskId: (kind === 'paid' || kind === 'skip') ? finish : null });
        undo = r.undo;
      }
      toast(`${existing ? 'Saved' : DONE[kind]}. Nothing was changed in Finance.`, () => runUndo(undo, toast).then(() => undefined));
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Nothing was changed.'); setBusy(false); }
  }

  const words = slotWords2(slot);
  return (
    <Modal title={existing ? `Change: ${TITLE[kind]}` : TITLE[kind]} onClose={onClose} wide>
      <form className="bl-form" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
        <p className="muted" style={{ margin: 0 }}><strong>{obligation.data.title}</strong>, {words}</p>

        {kind === 'invoice' && (
          <>
            <div className="bl-two">
              <label className="f">Amount on the bill<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" autoComplete="off" autoFocus aria-invalid={amountBad} /></label>
              <label className="f">Due date on the bill (optional)<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
            </div>
            {cents === 0 && <label className="as-check"><input type="checkbox" checked={zeroOk} onChange={(e) => setZeroOk(e.target.checked)} /> Yes, this bill really is $0.00 (it is not just unknown)</label>}
            <div className="bl-two">
              <label className="f">Bill date (optional)<input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></label>
              <label className="f">Document number (optional)<input value={number} onChange={(e) => setNumber(e.target.value)} maxLength={40} autoComplete="off" /></label>
            </div>
            <p className="muted small">A bill is not a payment. The document number is only used to notice a bill entered twice; do not enter an account number.</p>
          </>
        )}

        {kind === 'due-date' && (
          <>
            <label className="f">Actual due date<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} autoFocus /></label>
            <p className="muted small">For a bill whose provider states its own date. The billing period itself does not change, only the date used for reminders and timing.</p>
          </>
        )}

        {kind === 'paid' && (
          <>
            <fieldset className="bl-sub">
              <legend>What do you mean?</legend>
              <label className="as-check"><input type="radio" name="paidchoice" checked={choice === 'outside'} onChange={() => setChoice('outside')} disabled={!!existing} /> I paid it outside Finance (on this date, and I may know the amount)</label>
              <label className="as-check"><input type="radio" name="paidchoice" checked={choice === 'full'} onChange={() => setChoice('full')} disabled={!!existing} /> It is paid in full, and I am not entering an amount</label>
            </fieldset>
            <div className="bl-two">
              <label className="f">{choice === 'outside' ? 'Date paid' : 'Date paid (optional)'}<input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></label>
              {choice === 'outside' && <label className="f">Amount paid (optional)<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Leave empty if you do not know" autoComplete="off" aria-invalid={amountBad} /></label>}
            </div>
            <p className="muted small">This is only your own note. Ledger does not check it against a bank or Finance, nothing is posted, and an empty amount is never counted as $0.00.</p>
          </>
        )}

        {kind === 'skip' && (
          <>
            <label className="f">Why was nothing billed? (optional)<input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Away that month, billed twice last time…" autoFocus /></label>
            <p className="muted small">The schedule is not changed. This period just stops appearing as an expected bill.</p>
          </>
        )}

        {kind === 'credit' && (
          <>
            <div className="bl-two">
              <label className="f">Credit amount<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" autoComplete="off" autoFocus aria-invalid={amountBad} /></label>
              <label className="f">What for? (optional)<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></label>
            </div>
            <p className="muted small">A credit lowers what is owed. It is never counted as a payment.</p>
          </>
        )}

        {!existing && plan && !plan.problem && (
          <>
            <h3 className="bl-h3">What will happen</h3>
            <Lines lines={plan.lines} />
            {plan.taskId != null && (kind === 'paid' || kind === 'skip') && (
              <label className="as-check"><input type="checkbox" checked={finishTask} onChange={(e) => setFinishTask(e.target.checked)} /> Also finish the reminder Task &ldquo;{plan.taskTitle}&rdquo;</label>
            )}
          </>
        )}
        {!existing && plan?.problem && <p className="bl-warn" role="alert">{plan.problem}</p>}
        {existing && <p className="muted small">This changes the one record you opened. The period stays the same, and you can undo it.</p>}
        {(error || (problem && ('problem' in built))) && <div className={error ? 'error' : 'muted small'} role={error ? 'alert' : undefined}>{error || problem}</div>}
        <div className="row bl-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy || !!problem || (!existing && !!plan?.problem)}>{existing ? 'Save' : kind === 'paid' ? (taskId != null ? 'Done, mark paid' : 'Mark paid') : kind === 'invoice' ? 'Record the bill' : kind === 'skip' ? 'Skip it' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Remove one record the household recorded by mistake. Shows what goes first; Undo brings it back. */
export function RemoveFactDialog({ record, words, extraLines, onClose }: { record: CycleRecord; words: string; extraLines?: string[]; onClose: () => void }) {
  const toast = useToast();
  const today = useToday();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    if (busy) return;
    setBusy(true); setError('');
    try { const r = await removeFact(record.id, record.updatedAt, today); toast('Record removed', () => runUndo(r.undo, toast).then(() => undefined)); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not remove it. Nothing was changed.'); setBusy(false); }
  }
  return (
    <Modal title="Remove this record" onClose={onClose}>
      <div className="bl-form">
        <Lines lines={extraLines ?? [`Remove ${words}.`, 'Only this one record goes. Nothing in Finance is changed, and you can undo it.']} />
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row bl-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn danger" disabled={busy} onClick={() => void go()}>Remove</button></div>
      </div>
    </Modal>
  );
}
