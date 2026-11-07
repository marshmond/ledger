import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Modal from '../../shell/Modal';
import { useToast } from '../../ui/Toast';
import { CostSourceField, maskMoney, RefLine, TxnPicker, useResolved } from '../../ui/TxnRefs';
import { chooseCost, type CostChoice } from '../../lib/costSource';
import { loadTxnMap, lookupOfMap } from '../../lib/txnLookup';
import { formatCents, parseAmountToCents, todayISO } from '../../lib/money';
import { addDays } from '../../lib/dates';
import { pieceKey, type TxnRef, type TxnLookup } from '../../lib/txnRef';
import { loadHideAmounts } from '../today/layout';
import { loadProjects } from '../projects/data';
import { expectedWindow, scheduleStateOf, type ExpectedWindow, type ScheduleState } from './expectedCharges';
import { droppedBySwitch, setArrangementPayments, setVisitPayment } from './payments';
import { CLASS_LABEL, PAY_BUCKETS, forArrangement, forProvider, payRecords, servicesSpend, typicalCost, visitPayment, visitReview, TYPICAL_MIN_SAMPLE, type PayRecord, type ReviewNote, type ServicesSpend } from './servicesSpend';
import { chargeWords, type VisitRecord } from './visitModel';
import { loadArrangements, tasksOfArrangement } from './data';
import { loadVisits } from './visits';
import type { ArrangementRecord } from './model';

const useMoney = () => { const hide = loadHideAmounts(); return (c: number) => (hide ? '$••••' : formatCents(c)); };
const hidden = () => loadHideAmounts();

export interface PayData { arrangements: ArrangementRecord[]; visits: VisitRecord[]; all: PayRecord[]; lookup: TxnLookup; projects: Map<number, string>; schedule: Map<number, ScheduleState> }
/** Everything the money views need, read live (it refreshes when a Finance transaction, a visit or an arrangement changes). Read only. */
export function usePayData(): PayData | undefined {
  return useLiveQuery(async () => {
    const [arrangements, visits, projects] = await Promise.all([loadArrangements(), loadVisits(), loadProjects()]);
    const all = payRecords(arrangements, visits);
    const lookup = lookupOfMap(await loadTxnMap(all.flatMap((r) => r.refs)));
    const schedule = new Map<number, ScheduleState>();
    for (const a of arrangements) schedule.set(a.id, scheduleStateOf(await tasksOfArrangement(a.id)));
    return { arrangements, visits, all, lookup, projects: new Map(projects.map((p) => [p.id, p.data.name])), schedule };
  }, []);
}

const NOTE_ICON: Record<ReviewNote['kind'], string> = { difference: 'ℹ', missing: '⚠', changed: 'ℹ', split: '⚠', duplicate: '⚠', overlap: 'ℹ', shared: 'ℹ', conflict: '⚠', project: 'ℹ' };
const NEEDS_ATTENTION = new Set<ReviewNote['kind']>(['missing', 'split', 'duplicate', 'conflict']);

// ---- one visit ----

/** What was charged, what was paid and how, kept apart. A visit with no payment says "No payment recorded", never "Unpaid". */
export function VisitPaymentCard({ visit, data }: { visit: VisitRecord; data: PayData }) {
  const money = useMoney();
  const [open, setOpen] = useState(false);
  const d = visit.data;
  const p = visitPayment(visit, data.all, data.lookup);
  // the linked-payment lines already show the missing, changed and split notes next to each payment; they are not repeated here
  const notes = visitReview(visit, data.all, data.lookup, money, (id) => data.projects.get(id)).filter((n) => n.kind !== 'missing' && n.kind !== 'split' && n.kind !== 'changed');
  const fee = chargeWords(d, money);
  const resolved = useResolved(d.txnRefs);
  const service = d.status === 'completed' ? 'Yes' : d.status === 'unsupported' ? 'Not known' : 'No';
  return (
    <section className="card sv-card" aria-labelledby="sv-pay-h">
      <div className="sv-card-head"><h2 id="sv-pay-h">Charge and payment</h2><button className="btn" onClick={() => setOpen(true)} disabled={d.status === 'unsupported'}>{p.source === 'none' ? 'Record a payment' : 'Change payment'}</button></div>
      <dl className="sv-facts">
        <div className="sv-fact"><dt>Service performed</dt><dd>{service}</dd></div>
        <div className="sv-fact"><dt>Charged</dt><dd>{fee ?? 'No charge recorded'}<div className="small muted">What the provider billed. Information only: not a payment.</div></dd></div>
        <div className="sv-fact"><dt>Payment</dt><dd>
          {p.source === 'none' && <strong>No payment recorded</strong>}
          {p.source === 'finance' && <strong>Paid: {p.paidCents !== null && !p.needsReview.length ? money(p.paidCents) : p.needsReview.length ? `${money(p.paidCents ?? 0)} counted, ${p.needsReview.length} link${p.needsReview.length === 1 ? '' : 's'} need review` : '—'} — linked to Finance</strong>}
          {p.source === 'manual' && <strong>Paid: {money(p.paidCents ?? 0)} — paid outside Finance (entered by you, not checked against Finance)</strong>}
          {p.source === 'none' && <div className="small muted">This is not the same as unpaid. Cash, a payment not imported yet, or someone else paying all look like this.</div>}
        </dd></div>
      </dl>
      {d.txnRefs.length > 0 && (
        <ul className="plain as-txns" aria-label="Linked Finance payments">{(resolved ?? []).map((r) => <RefLine key={r.key} r={r} hide={hidden()} />)}</ul>
      )}
      {notes.length > 0 && (
        <ul className="plain sv-lines" aria-label="Payment notes">
          {notes.map((n, i) => <li key={i} className={NEEDS_ATTENTION.has(n.kind) ? 'sv-warn small' : 'small muted'} role={NEEDS_ATTENTION.has(n.kind) ? 'alert' : undefined}><span aria-hidden="true">{NOTE_ICON[n.kind]} </span>{hidden() ? maskMoney(n.text) : n.text}</li>)}
        </ul>
      )}
      {open && <PaymentDialog visit={visit} onClose={() => setOpen(false)} />}
    </section>
  );
}

const parseCents = (t: string): number | null | undefined => { if (!t.trim()) return null; const c = parseAmountToCents(t); return c === null || c < 0 ? undefined : c; };

/** Link Finance payments, or record an amount paid outside Finance. One source; switching names what is removed and needs a tick. */
export function PaymentDialog({ visit, onClose }: { visit: VisitRecord; onClose: () => void }) {
  const toast = useToast();
  const d = visit.data;
  const [choice, setChoice] = useState<CostChoice>(d.txnRefs.length ? 'finance' : 'manual');
  const [text, setText] = useState(d.paidManualCents !== null ? (d.paidManualCents / 100).toFixed(2) : '');
  const [refs, setRefs] = useState<TxnRef[]>(d.txnRefs);
  const [ack, setAck] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const chosen = chooseCost(choice, text, refs, parseCents);
  const source = chosen.refs.length ? 'finance' : chosen.cents !== null ? 'manual' : 'none';
  const removes = droppedBySwitch(d, { source });
  const needTick = !!removes;
  async function save() {
    if (busy) return;
    setError('');
    if (chosen.badAmount) return setError('The amount is not a valid amount of money.');
    if (needTick && !ack) return setError(`Saving removes ${removes}. Tick the box to confirm.`);
    setBusy(true);
    try {
      await setVisitPayment(visit.id, { source, refs: chosen.refs, manualCents: chosen.cents, confirmSwitch: ack }, visit.updatedAt);
      toast(source === 'none' ? 'Payment cleared' : 'Payment saved');
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Nothing was changed.'); setBusy(false); }
  }
  return (
    <Modal title="Payment for this visit" onClose={onClose} wide>
      <form className="sv-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <p className="muted small">Record how this visit was paid, if you know. A payment never changes whether the visit counts as done, and nothing here changes Finance. Leave it empty if you do not know.</p>
        <CostSourceField hide={hidden()} label="Payment" idp="svpay" choice={choice} setChoice={setChoice} text={text} setText={setText} refs={refs} setRefs={setRefs} parse={parseCents} ack={ack} setAck={setAck}
          manualLabel="Paid outside Finance" amountLabel="Amount paid" help="Cash or any payment that is not in Ledger Finance. It is your own entry and is never matched to a Finance transaction automatically."
          financeIntro="The amount comes from the Finance transactions you link and follows them if they change there. Pick the real payment; Ledger never guesses." />
        {needTick && !chosen.dropped && (
          <label className="as-check warn"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> Saving removes {removes}. Tick to confirm.</label>
        )}
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row sv-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="submit" className="btn primary" disabled={busy}>Save payment</button></div>
      </form>
    </Modal>
  );
}

// ---- totals ----

export function SpendLines({ s, scope, extra }: { s: ServicesSpend; scope: string; extra?: React.ReactNode }) {
  const money = useMoney();
  const sum = s.summary;
  return (
    <div className="sv-spend">
      <dl className="sv-facts">
        <div className="sv-fact"><dt>Linked payments and typed payments, each counted once</dt><dd><strong>{money(s.totalCents)}</strong>
          <div className="small muted">{money(s.financeCents)} from Finance · {money(s.manualCents)} paid outside Finance (typed)</div></dd></div>
        {PAY_BUCKETS.filter((c) => c !== 'shared' || s.byClass.shared !== 0).map((c) => <div className="sv-fact" key={c}><dt>{CLASS_LABEL[c]}</dt><dd>{money(s.byClass[c])}</dd></div>)}
      </dl>
      {sum.sharedPieces.length > 0 && <p className="small muted">{sum.sharedPieces.length} payment{sum.sharedPieces.length === 1 ? ' is' : 's are'} linked more than once (for example one invoice for several visits). Each is counted once here and is not divided, so rows below may add to more than this total.</p>}
      {sum.review.length > 0 && <p className="sv-warn small" role="alert">{sum.review.length} linked payment{sum.review.length === 1 ? ' needs' : 's need'} review (missing, changed or no longer spending). {sum.review.length === 1 ? 'It is' : 'They are'} counted as $0 until fixed.</p>}
      {sum.coveredParts.length > 0 && <p className="small muted">{sum.coveredParts.length} part{sum.coveredParts.length === 1 ? '' : 's'} of a transaction {sum.coveredParts.length === 1 ? 'is' : 'are'} not added because the whole transaction is linked too.</p>}
      {s.conflicts.length > 0 && <p className="sv-warn small" role="alert">{s.conflicts.length} visit{s.conflicts.length === 1 ? ' has' : 's have'} both a Finance link and a typed amount. Only the Finance link is counted.</p>}
      <p className="muted small">{scope}</p>
      {extra}
    </div>
  );
}

export function TypicalCostLine({ visits, data }: { visits: VisitRecord[]; data: PayData }) {
  const money = useMoney();
  const t = typicalCost(visits, data.all, data.lookup);
  const ex = t.excluded;
  const left = ex.noPayment + ex.unreliable + ex.shared + ex.notPositive;
  return (
    <div className="sv-fact">
      <dt>Typical price per completed visit (median)</dt>
      <dd>
        {t.enough ? <strong>{money(t.medianCents!)}</strong> : <span>Not enough yet</span>}
        <div className="small muted">
          Based on {t.sample} completed visit{t.sample === 1 ? '' : 's'} with a clear, unshared payment ({t.fromFinance} from Finance, {t.typed} typed){t.enough ? '' : `. At least ${TYPICAL_MIN_SAMPLE} are needed before a typical price is shown`}.
          {left > 0 && ` Left out: ${left} completed visit${left === 1 ? '' : 's'} (${[ex.noPayment && `${ex.noPayment} with no payment recorded`, ex.shared && `${ex.shared} with a shared payment`, ex.unreliable && `${ex.unreliable} with a link needing review`, ex.notPositive && `${ex.notPositive} netting to zero or less`].filter(Boolean).join(', ')}). Cancelled and skipped visits are never included.`}
        </div>
      </dd>
    </div>
  );
}

export function ExpectedBlock({ arrangements, data, only }: { arrangements: ArrangementRecord[]; data: PayData; only?: number }) {
  const money = useMoney();
  const today = todayISO();
  const list = only === undefined ? arrangements : arrangements.filter((a) => a.id === only);
  const w: ExpectedWindow[] = [30, 90].map((n) => expectedWindow(list, data.schedule, today, n));
  const hasAny = list.some((a) => a.data.expected && a.data.status === 'active');
  if (!hasAny) return null;
  return (
    <div className="sv-sub" aria-label="Estimates of upcoming charges">
      <strong>Estimates of upcoming charges</strong>
      <p className="small muted">Estimates only, from your cost estimates and the schedule. They are not charges, not payments and not spending.</p>
      {w.map((x) => (
        <p key={x.days} className="small">Next {x.days} days (to {addDays(today, x.days)}): <strong>{x.items.length ? `about ${money(x.estimateCents)}` : 'no estimate available'}</strong>
          {x.items.map((i) => <span key={i.arrangementId} className="muted"> · {i.title}: {i.visits} visit{i.visits === 1 ? '' : 's'} × {money(i.centsEach)}{i.partial ? ' (only the next visit can be projected)' : ''}</span>)}</p>
      ))}
      {w[1].notConverted.length > 0 && (
        <details className="small"><summary>Not included ({w[1].notConverted.length})</summary>
          <ul className="plain">{w[1].notConverted.map((n) => <li key={n.arrangementId}><strong>{n.title}</strong>: {n.reason}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

// ---- the arrangement as a whole ----

export function ArrangementPaymentsEditor({ arrangement }: { arrangement: ArrangementRecord }) {
  const toast = useToast();
  const refs = arrangement.data.txnRefs;
  const resolved = useResolved(refs);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  async function change(next: TxnRef[]) {
    setError('');
    try { await setArrangementPayments(arrangement.id, next, arrangement.updatedAt); toast('Saved'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Nothing was changed.'); }
  }
  return (
    <div className="sv-sub">
      <strong>Payments for the arrangement as a whole</strong>
      <p className="small muted">For a charge that is not tied to one visit, such as a monthly retainer. It is not split among visits. Link each payment in one place only: here or on a visit.</p>
      {refs.length === 0 ? <p className="small muted">None linked.</p> : <ul className="plain as-txns">{(resolved ?? []).map((r) => <RefLine key={r.key} r={r} hide={hidden()} onRemove={() => void change(refs.filter((x) => pieceKey(x) !== r.key))} />)}</ul>}
      {picking ? <TxnPicker hide={hidden()} chosen={refs} onPick={(r) => { void change([...refs, r]); setPicking(false); }} onClose={() => setPicking(false)} />
        : <button type="button" className="btn" onClick={() => setPicking(true)}>{refs.length ? 'Link another payment' : 'Link a payment'}</button>}
      {error && <div className="error" role="alert">{error}</div>}
    </div>
  );
}

// ---- ready-made sections for the three pages ----

export function ArrangementMoney({ arrangement }: { arrangement: ArrangementRecord }) {
  const data = usePayData();
  if (!data) return null;
  const mine = forArrangement(data.all, arrangement.id);
  const s = servicesSpend(mine, data.lookup, undefined, data.all);
  const visits = data.visits.filter((v) => v.data.arrangementId === arrangement.id);
  const unpaidDone = visits.filter((v) => v.data.status === 'completed' && v.data.txnRefs.length === 0 && v.data.paidManualCents === null).length;
  return (
    <section className="card sv-card" aria-labelledby="sv-money-h">
      <h2 id="sv-money-h">Money</h2>
      <SpendLines s={s} scope="Paid means money that actually left the household, from linked Finance payments or an amount you typed as paid outside Finance. Charges and estimates are never counted here." />
      <dl className="sv-facts"><TypicalCostLine visits={visits} data={data} /></dl>
      {unpaidDone > 0 && <p className="small muted">{unpaidDone} completed visit{unpaidDone === 1 ? ' has' : 's have'} no payment recorded. That does not mean unpaid.</p>}
      <ExpectedBlock arrangements={[arrangement]} data={data} />
      <ArrangementPaymentsEditor arrangement={arrangement} />
    </section>
  );
}

export function ProviderMoney({ providerKey }: { providerKey: string }) {
  const data = usePayData();
  if (!data) return null;
  const mine = forProvider(data.all, providerKey);
  const visits = data.visits.filter((v) => data.all.length >= 0 && (v.data.providerContactId !== null ? `c:${v.data.providerContactId}` : `n:${v.data.providerNameSnapshot.trim().toLowerCase()}`) === providerKey);
  return (
    <section className="card sv-card" aria-labelledby="sv-pmoney-h">
      <h2 id="sv-pmoney-h">Money paid to this provider</h2>
      <SpendLines s={servicesSpend(mine, data.lookup, undefined, data.all)} scope="Counted per payment, once, across all of this provider's arrangements and visits. Arrangement pages may add up to more than this when one payment is linked in two places." />
      <dl className="sv-facts"><TypicalCostLine visits={visits} data={data} /></dl>
    </section>
  );
}
