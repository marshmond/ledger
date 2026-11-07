import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Modal from '../../shell/Modal';
import ScheduleFields from './ScheduleFields';
import { useToast } from '../../ui/Toast';
import { db } from '../../db';
import { store } from '../../core/store';
import { parseAmountToCents } from '../../lib/money';
import { useToday } from '../../ui/useToday';
import { createObligation, editObligation, type ProviderInput } from './data';
import { blankDraft, draftOfSchedule, draftProblem, scheduleOfDraft } from './scheduleDraft';
import { runUndo } from './undo';
import {
  AMOUNT_KIND_LABEL, AMOUNT_KINDS, blankObligation, defaultNeed, firstAmountCents, guessType, HOW_LABEL, HOWS, NEED_LABEL, NEEDS, notesWarning, TYPE_LABEL, TYPES,
  type AmountKind, type BillType, type DocRef, type How, type Need, type ObligationRecord,
} from './model';

const NEW = '__new';
const sameSchedule = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Add or edit a bill or subscription. Three questions come first (what is it, how much, how often); everything else is under "More details".
 * An amount here is what the bill is EXPECTED to cost. It is never described as spent or paid. Nothing in Finance, Tasks or the Calendar is created or changed.
 */
export default function ObligationForm({ obligation, onClose, onSaved }: { obligation?: ObligationRecord; onClose: () => void; onSaved?: (id: number) => void }) {
  const toast = useToast();
  const today = useToday();
  const editing = !!obligation;
  const d = obligation?.data ?? blankObligation({}, today);
  const contacts = useLiveQuery(() => store.shared.contacts.query(), []) ?? [];
  const accounts = useLiveQuery(() => db.accounts.toArray(), []) ?? [];

  const [title, setTitle] = useState(d.title);
  const [type, setType] = useState<BillType>(d.type);
  const [typeTouched, setTypeTouched] = useState(editing);
  const [need, setNeed] = useState<Need>(editing ? d.need : defaultNeed(d.type));
  const [needTouched, setNeedTouched] = useState(editing);
  const [choice, setChoice] = useState<string>(d.providerContactId !== null ? String(d.providerContactId) : '');
  const [newName, setNewName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [amountKind, setAmountKind] = useState<AmountKind>(editing ? d.amountKind : 'fixed');
  const first = firstAmountCents(d);
  const [amount, setAmount] = useState(first === null ? '' : (first / 100).toFixed(2));
  const [draft, setDraft] = useState(() => (editing ? draftOfSchedule(d.schedule, today) : blankDraft(today)));
  const [how, setHow] = useState<How>(d.payment.how);
  const [tracking, setTracking] = useState(d.trackingSince || today);
  const [accountId, setAccountId] = useState(d.payment.fundingAccountId !== null ? String(d.payment.fundingAccountId) : '');
  const [paidThroughLoan, setPaidThroughLoan] = useState(d.paidThroughLoan);
  const [reviewOn, setReviewOn] = useState(d.review.on);
  const [reviewNote, setReviewNote] = useState(d.review.note);
  const [scheduleFrom, setScheduleFrom] = useState('');
  const [refs, setRefs] = useState<DocRef[]>(d.refs);
  const [notes, setNotes] = useState(d.notes);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const typed = newName.trim().toLowerCase();
  const sameAsExisting = !!typed && contacts.some((c) => c.name.trim().toLowerCase() === typed);
  const warn = notesWarning(notes);
  const schedule = scheduleOfDraft(draft);
  const scheduleChanged = editing && !sameSchedule(schedule, d.schedule);
  const accountGone = accountId !== '' && accounts.length > 0 && !accounts.some((a) => String(a.id) === accountId);

  function onTitle(v: string) {
    setTitle(v);
    if (!typeTouched) { const t = guessType(v); setType(t); if (!needTouched) setNeed(defaultNeed(t)); }
  }

  async function save() {
    if (busy) return;
    setError('');
    if (!title.trim()) return setError('Enter what the bill or subscription is (for example "Streamly Premium").');
    let cents: number | null = null;
    if (amountKind !== 'unknown' && amount.trim()) {
      cents = parseAmountToCents(amount);
      if (cents === null || cents < 0) return setError('The amount is not valid. Use a number such as 15.49.');
    }
    if (amountKind === 'fixed' && cents === null) return setError('Enter the amount, or choose "It varies" or "I do not know".');
    const bad = draftProblem(draft);
    if (bad) return setError(bad);
    if (choice === NEW && !newName.trim()) return setError('Enter the provider\'s name, or pick "No provider".');
    const provider: ProviderInput | null = choice === NEW ? { name: newName, phone, email } : choice ? { contactId: Number(choice) } : null;
    const payment = { how, fundingAccountId: accountId ? Number(accountId) : null };
    setBusy(true);
    try {
      if (obligation) {
        const r = await editObligation(obligation.id, {
          title, type, need, provider: choice === (d.providerContactId !== null ? String(d.providerContactId) : '') ? undefined : provider, amountKind, amountCents: cents, trackingSince: tracking, schedule, scheduleFrom: scheduleChanged ? scheduleFrom || null : null,
          payment, paidThroughLoan, review: { on: reviewOn, note: reviewNote }, refs, notes,
        }, obligation.updatedAt, today);
        toast('Saved', () => runUndo(r.undo, toast).then(() => undefined));
        onSaved?.(obligation.id);
      } else {
        const prices = amountKind !== 'unknown' && cents !== null ? [{ from: tracking, cents, label: '' }] : [];
        const r = await createObligation({
          data: blankObligation({ title, type, need, amountKind, prices, schedule, trackingSince: tracking, payment, paidThroughLoan, review: { on: reviewOn, note: reviewNote.trim(), since: reviewOn ? today : null }, refs, notes }, today),
          provider,
        });
        toast('Added. Nothing was paid or created in Finance.', () => runUndo(r.undo, toast).then(() => undefined));
        onSaved?.(r.id);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Nothing was changed.');
      setBusy(false);
    }
  }

  const setRef = (i: number, p: Partial<DocRef>) => setRefs(refs.map((r, j) => (j === i ? { ...r, ...p } : r)));

  return (
    <Modal title={editing ? 'Edit bill or subscription' : 'Add a bill or subscription'} onClose={onClose} wide>
      <form className="bl-form" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
        <label className="f">What is it?
          <input value={title} onChange={(e) => onTitle(e.target.value)} placeholder="Streamly Premium, Example Power Co, Home insurance…" autoFocus maxLength={120} aria-invalid={!!error && !title.trim()} />
        </label>

        <div className="bl-two">
          <label className="f">How much?
            <select value={amountKind} onChange={(e) => setAmountKind(e.target.value as AmountKind)} aria-label="How much">
              {AMOUNT_KINDS.map((k) => <option key={k} value={k}>{AMOUNT_KIND_LABEL[k]}</option>)}
            </select>
          </label>
          {amountKind !== 'unknown' && (
            <label className="f">{amountKind === 'fixed' ? 'Amount each time' : 'Typical amount (optional)'}
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" aria-label={amountKind === 'fixed' ? 'Amount each time' : 'Typical amount'} autoComplete="off" />
            </label>
          )}
        </div>
        <p className="muted small">An expected amount only. It is never counted as money spent, and nothing is paid or recorded in Finance.</p>

        <ScheduleFields draft={draft} onChange={setDraft} trackingSince={tracking} today={today} />

        <fieldset className="bl-sub">
          <legend>Who pays it?</legend>
          <div className="row">
            {HOWS.map((h) => (
              <label key={h} className="as-check"><input type="radio" name="bl-how" checked={how === h} onChange={() => setHow(h)} /> {HOW_LABEL[h]}</label>
            ))}
          </div>
          <p className="muted small">"Paid automatically" only means the company is expected to collect it. Ledger never treats that as proof it was paid.</p>
        </fieldset>

        <label className="f">Provider
          <select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Provider">
            <option value="">No provider</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value={NEW}>A new provider…</option>
          </select>
        </label>
        {choice === NEW && (
          <div className="bl-sub">
            <label className="f">Provider name<input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={120} /></label>
            {sameAsExisting && <p className="bl-note small">A contact with this name already exists, so it will be used. No second contact is made.</p>}
            <div className="bl-two">
              <label className="f">Phone (optional)<input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="off" /></label>
              <label className="f">Email (optional)<input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" autoComplete="off" /></label>
            </div>
            <p className="muted small">Saved in your shared Contacts.</p>
          </div>
        )}

        <details className="bl-sec">
          <summary>More details</summary>
          <div className="bl-two">
            <label className="f">Type
              <select value={type} onChange={(e) => { setType(e.target.value as BillType); setTypeTouched(true); if (!needTouched) setNeed(defaultNeed(e.target.value as BillType)); }} aria-label="Type">
                {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </select>
            </label>
            <label className="f">How important is it? (a label you can change)
              <select value={need} onChange={(e) => { setNeed(e.target.value as Need); setNeedTouched(true); }} aria-label="How important">
                {NEEDS.map((n) => <option key={n} value={n}>{NEED_LABEL[n]}</option>)}
              </select>
            </label>
          </div>
          <label className="f">Ledger expects bills from
            <input type="date" value={tracking} onChange={(e) => setTracking(e.target.value)} aria-label="Tracking since" />
          </label>
          <p className="muted small">Nothing before this date is ever expected, so adding a bill never creates a pile of missed ones.</p>

          {scheduleChanged && (
            <label className="f">The new schedule applies from
              <input type="date" value={scheduleFrom} onChange={(e) => setScheduleFrom(e.target.value)} aria-label="New schedule applies from" />
              <span className="muted small">Leave empty for today. Earlier dates keep the old schedule. A start date in the middle of a month, after that month's bill, is refused with a suggestion.</span>
            </label>
          )}

          <label className="f">Account it is expected to come from (optional)
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="Funding account">
              <option value="">Not stated</option>
              {accounts.filter((a) => !a.closed || String(a.id) === accountId).map((a) => <option key={a.id} value={a.id}>{a.name}{a.closed ? ' (closed)' : ''}</option>)}
              {accountGone && <option value={accountId}>An account that no longer exists</option>}
            </select>
          </label>
          <p className="muted small">Read from Finance and never changed. It is a note about where the money is expected to come from, not a payment.</p>

          {(type === 'insurance' || type === 'tax') && (
            <label className="as-check"><input type="checkbox" checked={paidThroughLoan} onChange={(e) => setPaidThroughLoan(e.target.checked)} /> Already paid through my loan payment (escrow)</label>
          )}
          {type === 'loan' && <p className="muted small">Loan payments are tracked on the Loans page. This bill is listed here but left out of the expected-cost figures.</p>}

          <div className="bl-sub">
            <label className="as-check"><input type="checkbox" checked={reviewOn} onChange={(e) => setReviewOn(e.target.checked)} /> Put on my review list</label>
            {reviewOn && <label className="f">Why? (optional)<input value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} maxLength={500} placeholder="Check whether we still use it" /></label>}
            <p className="muted small">Your own list for looking at costs again. Putting something here never cancels it or changes anything else.</p>
          </div>

          <div className="bl-sub">
            <strong>Document links</strong>
            {refs.map((r, i) => (
              <div key={i} className="bl-ref">
                <input value={r.label} onChange={(e) => setRef(i, { label: e.target.value })} placeholder="Name (Statement, Agreement…)" aria-label="Document name" />
                <input value={r.url ?? ''} onChange={(e) => setRef(i, { url: e.target.value })} placeholder="https://…" aria-label="Document link" inputMode="url" />
                <button type="button" className="btn" onClick={() => setRefs(refs.filter((_, j) => j !== i))} aria-label="Remove document link">✕</button>
              </div>
            ))}
            <button type="button" className="btn" onClick={() => setRefs([...refs, { label: '' }])} disabled={refs.length >= 20}>Add a link</button>
          </div>

          <label className="f">Notes
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
          </label>
          <p className="muted small">Do not store account numbers, card numbers, codes or passwords here. Plain backups and exports are not encrypted. Keep those in a password manager.</p>
          {warn && <p className="bl-warn small" role="alert">{warn}</p>}
        </details>

        {error && <div className="error" role="alert">{error}</div>}
        <div className="row bl-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>{editing ? 'Save' : 'Add'}</button>
        </div>
      </form>
    </Modal>
  );
}
