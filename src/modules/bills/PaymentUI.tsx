import { useEffect, useRef, useState } from 'react';
import Modal from '../../shell/Modal';
import { useToast } from '../../ui/Toast';
import { useToday } from '../../ui/useToday';
import { RefLine, TxnPicker, useResolved } from '../../ui/TxnRefs';
import { pieceKey, type TxnRef } from '../../lib/txnRef';
import { Lines, useMoney, type Money } from './BillsParts';
import { newOp, planFact, recordFact, type FactPlan } from './cycleData';
import type { CycleRecord } from './cycleModel';
import { LABEL_TEXT } from './labels';
import type { ObligationRecord } from './model';
import { STATUS_WORDS, type PaymentPiece } from './payments';
import type { Period } from './periods';
import { slotWords2 } from './schedule';
import { runUndo } from './undo';

/** The words a link's role needs, or null when it is an ordinary counted payment. */
const roleNote = (p: PaymentPiece): string | null =>
  p.role === 'duplicate' ? 'Linked more than once. Counted once.' : p.role === 'covered' ? 'Covered by the whole transaction, which is counted instead.' : null;

/**
 * The Finance payments linked to one period, one line each: who, when, the live amount, Finance's OWN status word (pending, cleared or reconciled: your
 * own marks, never bank settlement), whether it changed since it was linked, whether it is counted, and a way to replace or remove the link. A link that
 * needs review is kept and shown with why; it counts for nothing until you pick the payment again. Amounts follow Hide Amounts.
 */
export function PaymentList({ p, money, hide, onReplace, onRemove, readOnly = false }: { p: Period; money: Money; hide: boolean; onReplace?: (r: CycleRecord) => void; onRemove?: (r: CycleRecord) => void; readOnly?: boolean }) {
  const f = p.amounts.finance;
  if (!f) return null;
  const rec = (id: number) => p.records.find((r) => r.id === id);
  return (
    <div className="bl-pays">
      <h3 className="bl-h3">Finance payments linked to this period</h3>
      <ul className="plain as-txns" aria-label="Linked Finance payments">
        {f.pieces.map((x) => {
          const chips = (
            <span className="bl-paychips">
              {x.status && x.role === 'counted' && <span className={`bl-chip bl-st-${x.status}`}>{STATUS_WORDS[x.status]}</span>}
              {x.imported && x.role === 'counted' && <span className="bl-chip">seen in an imported bank file</span>}
              {x.role === 'counted' && x.resolved.state === 'changed' && <span className="bl-chip bl-l-needs-review">changed in Finance since linked</span>}
              {roleNote(x) && <span className="muted small"> {roleNote(x)}</span>}
            </span>
          );
          const r = rec(x.factId);
          return (
            <div key={x.factId} className="bl-payrow">
              <RefLine r={x.resolved} hide={hide} extra={chips} />
              {!readOnly && r && (
                <span className="bl-actionrow">
                  {onReplace && <button type="button" className="btn" onClick={() => onReplace(r)}>Replace this payment</button>}
                  {onRemove && <button type="button" className="btn" onClick={() => onRemove(r)}>Remove link</button>}
                </span>
              )}
            </div>
          );
        })}
      </ul>
      <p className="muted small">Net recorded in Finance for this period: {money(f.netCents)}{f.backCents > 0 ? ` (${money(f.outCents)} paid, ${money(f.backCents)} money back)` : ''}. Finance's status words are your own marks and imports; they do not show that the provider received the money.</p>
    </div>
  );
}

/** What the period would look like after the link, in words (amounts through Hide Amounts). */
function resultWords(plan: FactPlan, money: Money): string | null {
  const r = plan.result;
  if (!r) return null;
  const owed = r.owedCents !== null ? ` of ${money(r.owedCents)}` : '';
  if (r.label === 'partly-paid') return `Partly paid: ${money(r.paidCents)}${owed} recorded, ${r.remainingCents !== null ? money(r.remainingCents) : 'an unknown amount'} left.`;
  if (r.label === 'paid') return `Paid: ${money(r.paidCents)} recorded${r.owedCents !== null ? ` against ${money(r.owedCents)} billed` : ''}.`;
  if (r.label === 'payment-recorded') return `Payment recorded: ${money(r.paidCents)} (the amount owed is not known).`;
  if (r.reversed) return 'The payments and money back add up to nothing paid. The period stays open.';
  return `It will read: ${LABEL_TEXT[r.label]}.`;
}

/**
 * "Link a Finance payment": pick an existing transaction (or one part of a split), see exactly what will happen, then confirm. Nothing is linked by
 * looking alike, nothing is suggested, and nothing in Finance is created, changed, cleared or reconciled. When the period already holds a typed
 * outside-Finance payment, the owner must confirm the switch: Ledger counts one source at a time, the typed payment stays in History.
 * `replace` swaps one existing link for another in one step.
 */
export function LinkPaymentDialog({ obligation, period, replace, onClose }: { obligation: ObligationRecord; period: Period; replace?: CycleRecord | null; onClose: () => void }) {
  const toast = useToast();
  const today = useToday();
  const { money, hide } = useMoney();
  const op = useRef(newOp()).current; // one per open dialog: a second press writes nothing
  const [picked, setPicked] = useState<TxnRef | null>(null);
  const [switchTyped, setSwitchTyped] = useState(false);
  const [finishTask, setFinishTask] = useState(true);
  const [plan, setPlan] = useState<FactPlan | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const slot = period.slot;
  const words = slotWords2(slot);
  const links = period.effective.flatMap((f) => (f.body.fact === 'payment-link' && f.id !== replace?.id ? [f.body.ref] : []));
  const typedCount = period.effective.filter((f) => f.body.fact === 'paid-outside' && f.body.cents !== null && f.body.cents > 0).length;
  const resolved = useResolved(picked ? [picked] : []);

  useEffect(() => {
    if (!picked) { setPlan(null); return; }
    let live = true;
    void planFact({ obligationId: obligation.id, slot, body: { fact: 'payment-link', ref: picked }, today, switchTyped, replaceFactId: replace?.id ?? null })
      .then((p) => live && setPlan(p)).catch(() => live && setPlan(null));
    return () => { live = false; };
  }, [picked, switchTyped, obligation.id, slot, today, replace?.id]);

  async function confirm() {
    if (busy || !picked || !plan || plan.problem) return;
    setBusy(true); setError('');
    try {
      const finish = plan.taskId != null && finishTask ? plan.taskId : null;
      const r = await recordFact({ obligationId: obligation.id, slot, body: { fact: 'payment-link', ref: picked }, op, today, finishTaskId: finish, switchTyped, replaceFactId: replace?.id ?? null });
      toast(r.reused ? 'That payment was already linked' : `${replace ? 'Payment replaced' : 'Payment linked'}. Nothing was changed in Finance.`, () => runUndo(r.undo, toast).then(() => undefined));
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not link it. Nothing was changed.'); setBusy(false); }
  }

  const title = replace ? 'Replace a linked payment' : typedCount > 0 ? 'Replace the outside-Finance payment with a Finance payment' : 'Link a Finance payment';
  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="bl-form">
        <p className="muted" style={{ margin: 0 }}><strong>{obligation.data.title}</strong>, {words}</p>
        {!picked ? (
          <>
            <p className="muted small">Pick the payment you made, from the transactions already in Finance. Ledger links the one you choose and never guesses. Split transactions can be linked one part at a time.</p>
            <TxnPicker chosen={links} onPick={(r) => { setPicked(r); setError(''); }} onClose={onClose} hide={hide} />
          </>
        ) : (
          <>
            <h3 className="bl-h3">The payment you picked</h3>
            <ul className="plain as-txns">{(resolved ?? []).map((r) => <RefLine key={r.key} r={r} hide={hide} />)}</ul>
            {typedCount > 0 && (
              <fieldset className="bl-sub">
                <legend>Replace the outside-Finance payment with a Finance-linked payment</legend>
                <p className="small" style={{ margin: 0 }}>A Finance transaction will now represent the payment. Your typed outside-Finance payment stays in the history and is set aside, so Ledger will not count both. No Finance transaction is changed.</p>
                <label className="as-check"><input type="checkbox" checked={switchTyped} onChange={(e) => setSwitchTyped(e.target.checked)} /> Yes, set my typed payment aside and use this Finance payment</label>
              </fieldset>
            )}
            {plan?.problem && <p className="bl-warn" role="alert">{plan.problem}</p>}
            {plan && !plan.problem && (
              <>
                <h3 className="bl-h3">What will happen</h3>
                <Lines lines={plan.lines} />
                {resultWords(plan, money) && <p className="small"><strong>{resultWords(plan, money)}</strong></p>}
                {plan.taskId != null && <label className="as-check"><input type="checkbox" checked={finishTask} onChange={(e) => setFinishTask(e.target.checked)} /> Also finish the reminder Task &ldquo;{plan.taskTitle}&rdquo;</label>}
              </>
            )}
            {error && <div className="error" role="alert">{error}</div>}
            <div className="row bl-actions">
              <button type="button" className="btn" onClick={() => { setPicked(null); setSwitchTyped(false); }}>Pick another</button>
              <button type="button" className="btn primary" disabled={busy || !plan || !!plan.problem} onClick={() => void confirm()}>{replace ? 'Replace the payment' : 'Link this payment'}</button>
            </div>
          </>
        )}
        {!picked && error && <div className="error" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}

/** Removing a link: a preview in words, one record goes (a soft delete), the transaction itself is untouched, and Undo brings it back. */
export const removeLinkLines = (words: string): string[] => [
  `Remove the link to this Finance payment from ${words}.`,
  'The transaction itself stays in Finance exactly as it is. Only the link from this bill goes, so the bill may show as unpaid or partly paid again. If it has reminders turned on, its reminder Task for this period may be made again.',
  'You can undo this.',
];

export { pieceKey };
