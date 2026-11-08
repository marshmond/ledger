import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Modal from '../../shell/Modal';
import { useToast } from '../../ui/Toast';
import { useToday } from '../../ui/useToday';
import { addDays } from '../../lib/dates';
import { parseAmountToCents } from '../../lib/money';
import { Lines, useMoney } from './BillsParts';
import { applyLifecycle, previewLifecycle, type LcAction, type LcPreview } from './lifecycleData';
import {
  CADENCES, CADENCE_LABEL, FINAL_CHARGES, METHODS, METHOD_LABEL, PRICE_SOURCES, PRICE_SOURCE_LABEL, PRICE_STATUSES, RENEWAL_CHANGES, TRIAL_OUTCOMES, WITHDRAW_KINDS, WITHDRAW_LABEL,
  type Cadence, type FinalCharge, type LcBody, type LcEff, type Method, type PriceSource, type PriceStatus, type RenewalChanges, type TrialOutcome, type WithdrawKind, type YesNo,
} from './lifecycleModel';
import type { LcConflict } from './lifecycleState';
import { applyServiceLink, previewServiceLink, type LinkPreview } from './crossLinks';
import type { ObligationRecord } from './model';
import { runUndo } from './undo';

/** One shared shell: the fields, then exactly what will happen (read-only preview), then the button. Nothing is written until the button is pressed. */
function ActionDialog({ ob, title, intro, action, saveLabel, doneText, onClose, children }: { ob: ObligationRecord; title: string; intro?: string; action: LcAction | string; saveLabel: string; doneText: string; onClose: () => void; children: ReactNode }) {
  const toast = useToast();
  const today = useToday();
  const { money } = useMoney();
  const [preview, setPreview] = useState<LcPreview | { problem: string; lines: string[]; warnings: string[]; token: ''; midPeriod: false } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const key = JSON.stringify(action);
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    setPreview(null);
    if (typeof action === 'string') { setPreview({ problem: action, lines: [], warnings: [], token: '', midPeriod: false }); return; }
    void previewLifecycle(ob.id, action, today, money).then((p) => mine === seq.current && setPreview(p)).catch((e) => mine === seq.current && setError(e instanceof Error ? e.message : 'Could not read this bill.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ob.id, ob.updatedAt, today]);
  async function save() {
    if (busy || typeof action === 'string' || !preview || preview.problem || !preview.token) return;
    setBusy(true); setError('');
    try {
      const r = await applyLifecycle(ob.id, action, preview.token, today);
      toast(doneText, () => runUndo(r.undo, toast).then(() => undefined));
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Nothing was changed.'); setBusy(false); }
  }
  return (
    <Modal title={title} onClose={onClose} wide>
      <form className="bl-form" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
        {intro && <p className="bl-note small">{intro}</p>}
        {children}
        <h3 className="bl-h3">What will happen</h3>
        {!preview && !error && <p className="muted small">Checking…</p>}
        {preview?.problem && <p className="bl-warn" role="alert">{preview.problem}</p>}
        {preview && !preview.problem && <Lines lines={preview.lines} />}
        {preview?.warnings.map((w) => <p key={w} className="bl-warn small" role="status">{w}</p>)}
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row bl-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="submit" className="btn primary" disabled={busy || !preview || !!preview.problem}>{saveLabel}</button></div>
      </form>
    </Modal>
  );
}

const Field = ({ label, children }: { label: string; children: ReactNode }) => <label className="f">{label}{children}</label>;
const cents = (s: string): number | null | 'bad' => (s.trim() === '' ? null : (() => { const c = parseAmountToCents(s); return c === null || c < 0 ? 'bad' : c; })());
const isoOk = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const Pick = <T extends string>({ label, value, set, options, words }: { label: string; value: T; set: (v: T) => void; options: readonly T[]; words: (v: T) => string }) => (
  <Field label={label}><select value={value} onChange={(e) => set(e.target.value as T)} aria-label={label}>{options.map((o) => <option key={o} value={o}>{words(o)}</option>)}</select></Field>
);

// ---- trial ----
export function TrialDialog({ ob, onClose }: { ob: ObligationRecord; onClose: () => void }) {
  const today = useToday();
  const [start, setStart] = useState(today), [end, setEnd] = useState(''), [pay, setPay] = useState<YesNo>('unknown'), [conv, setConv] = useState<'auto' | 'manual' | 'unknown'>('unknown');
  const [price, setPrice] = useState(''), [cad, setCad] = useState<Cadence>('monthly'), [must, setMust] = useState(false), [by, setBy] = useState(''), [mk, setMk] = useState(true), [note, setNote] = useState('');
  const c = cents(price);
  const action: LcAction | string = !isoOk(end) ? 'Pick the date the trial ends.' : c === 'bad' ? 'The price after the trial is not valid. Use a number such as 14.99, or leave it empty if you do not know it.' : { type: 'trial', startsOn: isoOk(start) ? start : null, endsOn: end, paymentOnFile: pay, conversion: conv, convertsToCents: c, cadence: cad, mustCancel: must, noticeBy: must && isoOk(by) ? by : null, note, makePrices: mk };
  return (
    <ActionDialog ob={ob} title="Record a trial" intro="You are recording what you know about a free or introductory trial. Ledger does not contact the provider and never assumes a trial turned into a paid plan." action={action} saveLabel="Record trial" doneText="Trial recorded" onClose={onClose}>
      <div className="bl-two"><Field label="Trial started"><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field><Field label="Trial ends"><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field></div>
      <div className="bl-two">
        <Pick label="Is a payment method on file?" value={pay} set={setPay} options={['unknown', 'yes', 'no'] as const} words={(v) => (v === 'yes' ? 'Yes' : v === 'no' ? 'No' : 'Not sure')} />
        <Pick label="What happens when it ends?" value={conv} set={setConv} options={['unknown', 'auto', 'manual'] as const} words={(v) => (v === 'auto' ? 'It converts to paid by itself' : v === 'manual' ? 'I have to choose to continue' : 'Not sure')} />
      </div>
      <div className="bl-two"><Field label="Price after the trial (optional)"><input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="Leave empty if unknown" /></Field><Pick label="Billed" value={cad} set={setCad} options={CADENCES} words={(v) => CADENCE_LABEL[v]} /></div>
      <label className="as-check"><input type="checkbox" checked={must} onChange={(e) => setMust(e.target.checked)} /> I have to cancel before it converts</label>
      {must && <Field label="Last day to cancel"><input type="date" value={by} onChange={(e) => setBy(e.target.value)} /></Field>}
      <label className="as-check"><input type="checkbox" checked={mk} onChange={(e) => setMk(e.target.checked)} /> Also record the prices: no charge during the trial, then the price after it</label>
      <Field label="Note (optional, no account numbers)"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></Field>
    </ActionDialog>
  );
}

export function ExtendTrialDialog({ ob, onClose }: { ob: ObligationRecord; onClose: () => void }) {
  const [end, setEnd] = useState(''), [note, setNote] = useState('');
  return (
    <ActionDialog ob={ob} title="The provider extended the trial" action={isoOk(end) ? { type: 'trial-extend', endsOn: end, note } : 'Pick the new end date.'} saveLabel="Record extension" doneText="Trial extension recorded" onClose={onClose}>
      <Field label="The trial now ends"><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></Field>
    </ActionDialog>
  );
}

export function TrialOutcomeDialog({ ob, onClose }: { ob: ObligationRecord; onClose: () => void }) {
  const today = useToday();
  const [o, setO] = useState<TrialOutcome>('converted'), [on, setOn] = useState(today), [note, setNote] = useState('');
  const words: Record<TrialOutcome, string> = { converted: 'It converted to a paid plan', 'ended-no-charge': 'It ended with no charge', cancelled: 'I cancelled it' };
  return (
    <ActionDialog ob={ob} title="What happened to the trial?" intro="Record only what you know. This is a note, not a payment, and Ledger makes no transaction." action={isoOk(on) ? { type: 'trial-outcome', outcome: o, on, note } : 'Pick a date.'} saveLabel="Record outcome" doneText="Trial outcome recorded" onClose={onClose}>
      <Pick label="What happened" value={o} set={setO} options={TRIAL_OUTCOMES} words={(v) => words[v]} />
      <Field label="On"><input type="date" value={on} onChange={(e) => setOn(e.target.value)} /></Field>
      <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></Field>
    </ActionDialog>
  );
}

// ---- price ----
export function PriceDialog({ ob, onClose, correct, start }: { ob: ObligationRecord; onClose: () => void; correct?: number[]; start?: { from: string; cents: number | null; until: string | null; status: PriceStatus; source: PriceSource | null; label: string } }) {
  const today = useToday();
  const [from, setFrom] = useState(start?.from ?? addDays(today, 30)), [price, setPrice] = useState(start?.cents != null ? (start.cents / 100).toFixed(2) : ''), [until, setUntil] = useState(start?.until ?? '');
  const [status, setStatus] = useState<PriceStatus>(start?.status ?? 'fixed'), [src, setSrc] = useState<PriceSource>(start?.source ?? 'provider-notice'), [label, setLabel] = useState(start?.label ?? ''), [note, setNote] = useState('');
  const c = cents(price);
  const action: LcAction | string = !isoOk(from) ? 'Pick the day the price starts.' : status !== 'unknown' && (c === null || c === 'bad') ? 'Enter the price (for example 17.99), or choose "not known". An unknown price is never treated as zero.' : { type: 'price', from, until: isoOk(until) ? until : null, cents: status === 'unknown' ? null : (c as number), status, label, source: src, note, correct };
  const sw: Record<PriceStatus, string> = { fixed: 'A fixed price', estimated: 'An estimate', unknown: 'I do not know the price' };
  return (
    <ActionDialog ob={ob} title={correct?.length ? 'Correct a price' : 'Record a price change'} intro="A new price only changes what is EXPECTED from its start day. Bills you already recorded and payments in Finance are never changed." action={action} saveLabel="Record price" doneText="Price recorded" onClose={onClose}>
      <div className="bl-two"><Field label="Starts on"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="Ends on (optional)"><input type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></Field></div>
      <div className="bl-two"><Pick label="This price is" value={status} set={setStatus} options={PRICE_STATUSES} words={(v) => sw[v]} />{status !== 'unknown' && <Field label="Amount each time"><input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="17.99" /></Field>}</div>
      <div className="bl-two"><Pick label="How do you know?" value={src} set={setSrc} options={PRICE_SOURCES} words={(v) => PRICE_SOURCE_LABEL[v]} /><Field label="Label (optional, such as introductory)"><input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} /></Field></div>
      <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></Field>
    </ActionDialog>
  );
}

// ---- renewal ----
export function RenewalDialog({ ob, onClose }: { ob: ObligationRecord; onClose: () => void }) {
  const cur = ob.data.lc?.renewal.fact?.body;
  const [date, setDate] = useState(cur?.renewalDate ?? ''), [cad, setCad] = useState<Cadence>(cur?.cadence ?? 'annual'), [auto, setAuto] = useState(cur?.auto === null || cur === undefined ? 'unknown' : cur.auto ? 'yes' : 'no');
  const [days, setDays] = useState(cur?.noticeDays != null ? String(cur.noticeDays) : ''), [notice, setNotice] = useState(cur?.noticeByDate ?? ''), [changes, setChanges] = useState<RenewalChanges>(cur?.changes ?? 'unknown'), [confirmed, setConfirmed] = useState(cur?.confirmed ?? true), [note, setNote] = useState('');
  const action: LcAction | string = !isoOk(date) ? 'Pick the renewal date.' : { type: 'renewal', renewalDate: date, cadence: cad, auto: auto === 'yes' ? true : auto === 'no' ? false : null, noticeDays: days.trim() === '' ? null : Number(days), noticeByDate: isoOk(notice) ? notice : null, changes, confirmed, note };
  const cw: Record<RenewalChanges, string> = { price: 'The price', terms: 'The terms', both: 'Price and terms', none: 'Nothing', unknown: 'Not sure' };
  return (
    <ActionDialog ob={ob} title="Renewal terms" intro="Dates only. Ledger renews nothing, repeats expected renewals on the Calendar without storing them, and never assumes a renewal happened." action={action} saveLabel="Save renewal" doneText="Renewal recorded" onClose={onClose}>
      <div className="bl-two"><Field label="Renewal date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field><Pick label="Repeats" value={cad} set={setCad} options={CADENCES} words={(v) => CADENCE_LABEL[v]} /></div>
      <div className="bl-two"><Pick label="Renews by itself?" value={auto} set={setAuto} options={['unknown', 'yes', 'no'] as const} words={(v) => (v === 'yes' ? 'Yes' : v === 'no' ? 'No, I have to renew it' : 'Not sure')} /><Pick label="A renewal may change" value={changes} set={setChanges} options={RENEWAL_CHANGES} words={(v) => cw[v]} /></div>
      <div className="bl-two"><Field label="Notice needed (days before)"><input value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} inputMode="numeric" /></Field><Field label="Or the last day to cancel"><input type="date" value={notice} onChange={(e) => setNotice(e.target.value)} /></Field></div>
      <label className="as-check"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> This date is confirmed (leave unticked if it is an estimate)</label>
      <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></Field>
    </ActionDialog>
  );
}

export function RenewalOutcomeDialog({ ob, forDate, onClose }: { ob: ObligationRecord; forDate: string; onClose: () => void }) {
  const today = useToday();
  const cur = ob.data.lc?.renewal.fact?.body;
  const [o, setO] = useState<'renewed' | 'not-renewed' | 'unsure'>('renewed'), [next, setNext] = useState(cur?.cadence === 'annual' ? addDays(forDate, 365) : ''), [note, setNote] = useState('');
  const action: LcAction | string = o === 'renewed' && next && !isoOk(next) ? 'Pick the next renewal date, or leave it empty.' : { type: 'renewal-outcome', forDate, outcome: o, on: today, note, ...(o === 'renewed' && isoOk(next) && cur ? { next: { renewalDate: next, cadence: cur.cadence, auto: cur.auto, noticeDays: cur.noticeDays, noticeByDate: null, changes: cur.changes, confirmed: false } } : {}) };
  return (
    <ActionDialog ob={ob} title={`Did the renewal of ${forDate} happen?`} intro="Record only what you know. This is not payment evidence, and Ledger changes nothing in Finance." action={action} saveLabel="Record" doneText="Renewal outcome recorded" onClose={onClose}>
      <Pick label="What happened" value={o} set={setO} options={['renewed', 'not-renewed', 'unsure'] as const} words={(v) => (v === 'renewed' ? 'It renewed' : v === 'not-renewed' ? 'It did not renew' : 'I am not sure')} />
      {o === 'renewed' && <Field label="Next renewal date (optional, marked as an estimate)"><input type="date" value={next} onChange={(e) => setNext(e.target.value)} /></Field>}
      <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></Field>
    </ActionDialog>
  );
}

// ---- cancellation ----
export function RequestDialog({ ob, onClose }: { ob: ObligationRecord; onClose: () => void }) {
  const today = useToday();
  const [on, setOn] = useState(today), [eff, setEff] = useState(''), [method, setMethod] = useState<Method>('website'), [ref, setRef] = useState(''), [awaiting, setAwaiting] = useState(true), [fu, setFu] = useState(false), [fuOn, setFuOn] = useState(addDays(today, 7)), [note, setNote] = useState('');
  const action: LcAction | string = !isoOk(on) ? 'Pick the date you asked.' : { type: 'cancel-request', requestedOn: on, requestedEffectiveOn: isoOk(eff) ? eff : null, method, ref, awaiting, note, followUpOn: fu && isoOk(fuOn) ? fuOn : null };
  return (
    <ActionDialog ob={ob} title="Record a cancellation request" intro="Ledger is recording that YOU asked to cancel. It is not contacting the provider and it does not cancel anything. A request is not proof the provider accepted it, so the subscription stays active." action={action} saveLabel="Record request" doneText="Cancellation request recorded" onClose={onClose}>
      <div className="bl-two"><Field label="You asked on"><input type="date" value={on} onChange={(e) => setOn(e.target.value)} /></Field><Field label="Effective date you asked for (optional)"><input type="date" value={eff} onChange={(e) => setEff(e.target.value)} /></Field></div>
      <div className="bl-two"><Pick label="How you asked" value={method} set={setMethod} options={METHODS} words={(v) => METHOD_LABEL[v]} /><Field label="Reference or confirmation number (optional)"><input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={40} placeholder="Not an account number" /></Field></div>
      <label className="as-check"><input type="checkbox" checked={awaiting} onChange={(e) => setAwaiting(e.target.checked)} /> I am still waiting for the provider to confirm</label>
      <label className="as-check"><input type="checkbox" checked={fu} onChange={(e) => setFu(e.target.checked)} /> Make one follow-up Task for me</label>
      {fu && <Field label="Follow up on"><input type="date" value={fuOn} onChange={(e) => setFuOn(e.target.value)} /></Field>}
      <Field label="Note (optional, no account numbers)"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></Field>
    </ActionDialog>
  );
}

export function ConfirmDialog({ ob, onClose }: { ob: ObligationRecord; onClose: () => void }) {
  const today = useToday();
  const cur = ob.data.lc?.cancel.confirm?.body;
  const [on, setOn] = useState(cur?.confirmedOn ?? today), [eff, setEff] = useState(cur?.effectiveOn ?? ''), [ref, setRef] = useState(cur?.providerRef ?? ''), [fc, setFc] = useState<FinalCharge>(cur?.finalCharge ?? 'unknown'), [fcAmt, setFcAmt] = useState(cur?.finalChargeCents != null ? (cur.finalChargeCents / 100).toFixed(2) : '');
  const [refund, setRefund] = useState(cur?.refundCents != null ? (cur.refundCents / 100).toFixed(2) : ''), [access, setAccess] = useState(cur?.accessUntil ?? ''), [note, setNote] = useState('');
  const fcc = cents(fcAmt), rc = cents(refund);
  const action: LcAction | string = !isoOk(on) ? 'Pick the date the provider confirmed.' : !isoOk(eff) ? 'Pick the effective date: the day the cancellation takes effect.' : fcc === 'bad' || rc === 'bad' ? 'An amount is not valid. Use a number such as 7.50, or leave it empty.' : { type: 'cancel-confirm', confirmedOn: on, effectiveOn: eff, providerRef: ref, finalCharge: fc, finalChargeCents: fc === 'expected' ? (fcc as number | null) : null, refundCents: rc as number | null, accessUntil: isoOk(access) ? access : null, note };
  const fw: Record<FinalCharge, string> = { none: 'No final charge', expected: 'A final charge is expected', unknown: 'I do not know' };
  return (
    <ActionDialog ob={ob} title={cur ? 'Provider changed the effective date' : 'Record a cancellation confirmation'} intro="Record what the provider told you. The effective date, not the confirmation date, decides when expected bills stop. Service is not shown as ended before it, and no payment or refund is invented." action={action} saveLabel="Record confirmation" doneText="Cancellation confirmation recorded" onClose={onClose}>
      <div className="bl-two"><Field label="Provider confirmed on"><input type="date" value={on} onChange={(e) => setOn(e.target.value)} /></Field><Field label="Effective on"><input type="date" value={eff} onChange={(e) => setEff(e.target.value)} /></Field></div>
      <p className="muted small"><button type="button" className="link" onClick={() => setEff(on)}>It is effective immediately</button></p>
      <div className="bl-two"><Field label="Provider reference (optional)"><input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={40} placeholder="Not an account number" /></Field><Field label="Service access continues until (optional)"><input type="date" value={access} onChange={(e) => setAccess(e.target.value)} /></Field></div>
      <div className="bl-two"><Pick label="Final charge" value={fc} set={setFc} options={FINAL_CHARGES} words={(v) => fw[v]} />{fc === 'expected' && <Field label="Expected final charge"><input value={fcAmt} onChange={(e) => setFcAmt(e.target.value)} inputMode="decimal" /></Field>}</div>
      <Field label="Expected refund (optional)"><input value={refund} onChange={(e) => setRefund(e.target.value)} inputMode="decimal" /></Field>
      <Field label="Note (optional, no account numbers)"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></Field>
    </ActionDialog>
  );
}

export function WithdrawDialog({ ob, mode, onClose }: { ob: ObligationRecord; mode: 'withdraw' | 'reactivate'; onClose: () => void }) {
  const today = useToday();
  const [kind, setKind] = useState<WithdrawKind>('owner-retracted'), [on, setOn] = useState(today), [reopen, setReopen] = useState(ob.data.status === 'ended'), [note, setNote] = useState('');
  const action: LcAction | string = !isoOk(on) ? 'Pick a date.' : mode === 'reactivate' ? { type: 'reactivate', on, note, reopen } : { type: 'cancel-withdraw', on, kind, note, reopen };
  return (
    <ActionDialog ob={ob} title={mode === 'reactivate' ? 'The subscription was reactivated' : 'Withdraw the cancellation'} intro="The earlier request and confirmation are kept in the history, marked as withdrawn. Nothing is deleted." action={action} saveLabel={mode === 'reactivate' ? 'Record reactivation' : 'Record withdrawal'} doneText={mode === 'reactivate' ? 'Reactivation recorded' : 'Withdrawal recorded'} onClose={onClose}>
      {mode === 'withdraw' && <Pick label="Why" value={kind} set={setKind} options={WITHDRAW_KINDS} words={(v) => WITHDRAW_LABEL[v]} />}
      <Field label="On"><input type="date" value={on} onChange={(e) => setOn(e.target.value)} /></Field>
      {ob.data.status === 'ended' && <label className="as-check"><input type="checkbox" checked={reopen} onChange={(e) => setReopen(e.target.checked)} /> Also reopen this bill</label>}
      <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></Field>
    </ActionDialog>
  );
}

// ---- resolving a disagreement ----
export const lcWords = (b: LcBody, money: (c: number) => string): string => {
  switch (b.fact) {
    case 'cancel-confirm': return `Confirmed ${b.confirmedOn}, effective ${b.effectiveOn}`;
    case 'cancel-request': return `Requested ${b.requestedOn}`;
    case 'cancel-withdraw': return `Withdrawn ${b.on} (${WITHDRAW_LABEL[b.kind].toLowerCase()})`;
    case 'reactivate': return `Reactivated ${b.on}`;
    case 'price-step': return `${b.cents === null ? 'Price not known' : money(b.cents)} from ${b.from}${b.until ? ` until ${b.until}` : ''}`;
    case 'renewal': return `Renewal ${b.renewalDate}`;
    case 'trial': return `Trial ends ${b.endsOn}`;
    case 'trial-extend': return `Trial extended to ${b.endsOn}`;
    case 'trial-outcome': return `Trial ${b.outcome} on ${b.on}`;
    default: return b.fact;
  }
};

export function ResolveDialog({ ob, conflict, onClose }: { ob: ObligationRecord; conflict: LcConflict; onClose: () => void }) {
  const { money } = useMoney();
  const cands = useMemo(() => (ob.data.lc?.effective ?? []).filter((r) => conflict.ids.includes(r.id)) as LcEff[], [ob, conflict]);
  const [pick, setPick] = useState<number>(cands[0]?.id ?? 0);
  return (
    <ActionDialog ob={ob} title="Which record stands?" intro="The records below disagree. Pick the one that is right. The others stay in the history, marked as replaced, and nothing is deleted." action={pick ? { type: 'resolve', conflictKey: conflict.key, chooseId: pick } : 'Pick one.'} saveLabel="Use this one" doneText="Done. The other records are kept in the history." onClose={onClose}>
      <fieldset className="bl-radios"><legend className="visually-hidden">Records that disagree</legend>
        {cands.map((r) => <label key={r.id} className="as-check"><input type="radio" name="pick" checked={pick === r.id} onChange={() => setPick(r.id)} /> {lcWords(r.body, money)} <span className="muted small">(recorded {new Date(r.createdAt).toLocaleDateString()})</span></label>)}
      </fieldset>
    </ActionDialog>
  );
}

/** Linking or unlinking a Household Services arrangement: a preview first, then one confirmation. Nothing is merged and no name is matched. */
export function ServiceLinkDialog({ ob, arrangementId, action, onClose }: { ob: ObligationRecord; arrangementId: number; action: 'linked' | 'unlinked'; onClose: () => void }) {
  const toast = useToast();
  const today = useToday();
  const [p, setP] = useState<LinkPreview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; void previewServiceLink(ob.id, arrangementId, action).then((x) => live && setP(x)).catch((e) => live && setError(e instanceof Error ? e.message : 'Could not read this bill.')); return () => { live = false; }; }, [ob.id, arrangementId, action]);
  async function go() {
    if (!p || p.problem || busy) return;
    setBusy(true); setError('');
    try { const r = await applyServiceLink(ob.id, arrangementId, action, p.token, today); toast(action === 'linked' ? 'Linked to the Household Services arrangement' : 'Unlinked', () => runUndo(r.undo, toast).then(() => undefined)); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Nothing was changed.'); setBusy(false); }
  }
  return (
    <Modal title={action === 'linked' ? 'Link to a Household Services arrangement' : 'Unlink from the arrangement'} onClose={onClose} wide>
      <div className="bl-form">
        {!p && !error && <p className="muted small">Checking…</p>}
        {p?.problem && <p className="bl-warn" role="alert">{p.problem}</p>}
        {p && !p.problem && <Lines lines={p.lines} />}
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row bl-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={busy || !p || !!p.problem} onClick={() => void go()}>{action === 'linked' ? 'Link them' : 'Unlink'}</button></div>
      </div>
    </Modal>
  );
}
