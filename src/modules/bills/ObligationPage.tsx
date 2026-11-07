import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from '../../core/router';
import { EmptyState } from '../../ui/components';
import { useToday } from '../../ui/useToday';
import { db } from '../../db';
import { store } from '../../core/store';
import { DeleteDialog, LifecycleDialog, ReviewDialog } from './Dialogs';
import ObligationForm from './ObligationForm';
import { amountOf, day, NeedChip, StatusChip, TypeChip, useMoney } from './BillsParts';
import { getObligation, type LifecycleAction } from './data';
import { expectedAmountOn, HOW_LABEL, isLoanExcluded, needsReview, scheduleSource, STATUS_LABEL } from './model';
import { listRoute, overviewRoute } from './paths';
import { describeSchedule, expectedDates, nextExpected, slotCollisions } from './schedule';
import { addDays } from '../../lib/dates';

const FIELD_WORDS: Record<string, string> = {
  status: 'the status', schedule: 'the schedule', scheduleHistory: 'the schedule history', amountKind: 'the amount type', prices: 'the prices', pauses: 'the pauses', payment: 'the payment arrangement',
  type: 'the type', need: 'the importance label', title: 'the title', notes: 'the notes', refs: 'the document links', review: 'the review-list entry', trackingSince: 'the tracking start date', endedOn: 'the end date',
};

/** One bill or subscription: its terms, who the provider is, what is expected next, the review-list choice and the lifecycle actions. No payment history exists yet, so none is shown. */
export default function ObligationPage({ id }: { id: number }) {
  const today = useToday();
  const { money } = useMoney();
  const ob = useLiveQuery(async () => ({ r: await getObligation(id) }), [id]);
  const contacts = useLiveQuery(() => store.shared.contacts.query(), []);
  const accounts = useLiveQuery(() => db.accounts.toArray(), []);
  const [life, setLife] = useState<LifecycleAction | null>(null);
  const [edit, setEdit] = useState(false);
  const [review, setReview] = useState(false);
  const [del, setDel] = useState(false);

  if (!ob) return <div className="bl"><p className="muted">Loading…</p></div>;
  const r = ob.r;
  if (!r) return <div className="bl"><p><Link to={overviewRoute()}>← Bills & Subscriptions</Link></p><EmptyState title="That bill is not here">It may have been removed on another device, or the address is wrong.</EmptyState></div>;
  const d = r.data;
  const src = scheduleSource(d);
  const next = nextExpected(src, today, 6);
  const contactGone = d.providerContactId !== null && !!contacts && !contacts.some((c) => c.id === d.providerContactId);
  const acct = d.payment.fundingAccountId === null ? null : accounts?.find((a) => a.id === d.payment.fundingAccountId);
  const review2 = needsReview(d);
  const collisions = slotCollisions(expectedDates(src, addDays(today, -62), addDays(today, 400)));
  const pausedBefore = d.pauses.filter((p) => p.to !== null);
  const reviewable = d.status === 'active' || d.status === 'paused' || d.status === 'ended';

  return (
    <div className="bl">
      <p className="bl-back"><Link to={listRoute()}>← All bills</Link></p>
      <div className="bl-head">
        <div>
          <h1>{d.title}</h1>
          <p className="bl-chips">
            <StatusChip d={d} /> <TypeChip d={d} /> <NeedChip d={d} />
            {d.review.on && <span className="bl-chip">On your review list</span>}
            {d.providerNameSnapshot ? <span>{d.providerNameSnapshot}{contactGone ? ' (contact removed)' : ''}</span> : <span className="muted">No provider</span>}
          </p>
        </div>
        <div className="bl-head-actions">
          <button className="btn" onClick={() => setEdit(true)}>Edit</button>
          {d.status === 'active' && <button className="btn" onClick={() => setLife('pause')}>Pause</button>}
          {d.status === 'paused' && <button className="btn primary" onClick={() => setLife('resume')}>Resume</button>}
          {(d.status === 'active' || d.status === 'paused') && <button className="btn" onClick={() => setLife('end')}>End</button>}
          {d.status === 'ended' && <button className="btn primary" onClick={() => setLife('reopen')}>Reopen</button>}
        </div>
      </div>

      {review2.length > 0 && (
        <div className="bl-banner" role="status">
          <strong>Needs review.</strong> This version of Ledger could not read {review2.map((k) => FIELD_WORDS[k] ?? k).join(', ')}. {d.status === 'unsupported' ? 'Nothing is expected from this record until the status is understood. ' : ''}It is kept exactly as saved and is not changed when you edit other details.
        </div>
      )}
      {collisions.length > 0 && <div className="bl-banner" role="status"><strong>Two schedules claim the same billing period.</strong> Edit the schedule and choose a start date that does not overlap.</div>}
      {isLoanExcluded(d) && (
        <p className="bl-note">{d.type === 'loan' || d.loanId !== null ? 'Loan payments are tracked on the Loans page, so this one is left out of the expected-cost figures here. ' : 'This is paid through your loan payment, so it is left out of the expected-cost figures here. '}<a href="#/ledger/debt">See Loans</a></p>
      )}

      <section className="card bl-card" aria-labelledby="bl-terms-h">
        <h2 id="bl-terms-h">Terms</h2>
        <dl className="bl-facts">
          <div className="bl-fact"><dt>Expected amount</dt><dd>{amountOf(d, today, money)}</dd></div>
          <div className="bl-fact"><dt>How often</dt><dd>{describeSchedule(d.schedule)}</dd></div>
          <div className="bl-fact"><dt>Payment arrangement</dt><dd>{HOW_LABEL[d.payment.how]}</dd></div>
          <div className="bl-fact"><dt>Expected from</dt><dd>{day(d.trackingSince)}</dd></div>
          <div className="bl-fact"><dt>Account it is expected to come from</dt><dd>{d.payment.fundingAccountId === null ? 'Not stated' : accounts === undefined ? '…' : acct ? `${acct.name}${acct.closed ? ' (closed)' : ''}` : 'An account that no longer exists'}</dd></div>
          {d.status === 'ended' && d.endedOn && <div className="bl-fact"><dt>Ended</dt><dd>{day(d.endedOn)}{d.endReason ? ` · ${d.endReason}` : ''}</dd></div>}
        </dl>
        <p className="muted small">Expected amounts are the terms you entered. They are not payments, and nothing here is recorded in Finance. {d.payment.how === 'auto' ? '"Paid automatically" only means the company is expected to collect it.' : ''}</p>
        {(d.scheduleHistory.length > 0 || pausedBefore.length > 0) && (
          <details>
            <summary>Earlier schedules and pauses</summary>
            <ul className="plain bl-items">
              {d.scheduleHistory.map((h) => <li key={h.until}>{describeSchedule(h.schedule)} · until {day(h.until)}</li>)}
              {pausedBefore.map((p) => <li key={p.from}>No dates expected {day(p.from)} to {day(addDays(p.to!, -1))}</li>)}
            </ul>
          </details>
        )}
      </section>

      <section className="card bl-card" aria-labelledby="bl-next-h">
        <h2 id="bl-next-h">Next expected dates</h2>
        {next.length === 0 ? (
          <p className="muted">{d.status === 'paused' ? 'Paused: no dates are expected until you resume.' : d.status === 'ended' ? 'Ended: no further dates are expected.' : !d.schedule ? 'No regular schedule, so no dates are worked out.' : 'No expected date found.'}</p>
        ) : (
          <ul className="plain bl-datelist" aria-label="Next expected dates">
            {next.map((e) => { const a = expectedAmountOn(d, e.nominal); return <li key={e.slot}><span>{day(e.nominal)}</span><span className="muted small">{a.cents === null ? 'amount not known' : `${a.basis === 'variable' ? 'about ' : ''}${money(a.cents)}`}</span></li>; })}
          </ul>
        )}
        <p className="muted small">Expected dates only: worked out from the schedule, nothing is created in Tasks or the Calendar, and none is shown as paid.</p>
      </section>

      <section className="card bl-card" aria-labelledby="bl-rev-h">
        <div className="bl-card-head"><h2 id="bl-rev-h">Your review list</h2>{reviewable && <button className="btn" onClick={() => setReview(true)}>{d.review.on ? 'Edit' : 'Put on my review list'}</button>}</div>
        {d.review.on ? <p>On your list{d.review.note ? `: ${d.review.note}` : '.'}{d.review.since ? <span className="muted small"> Since {day(d.review.since)}.</span> : null}</p> : <p className="muted">Not on your list. Putting it there never cancels it or changes anything.</p>}
      </section>

      {d.refs.length > 0 && (
        <section className="card bl-card" aria-labelledby="bl-doc-h">
          <h2 id="bl-doc-h">Document links</h2>
          <ul className="plain bl-items">{d.refs.map((x, i) => <li key={i}>{x.url ? <a href={x.url} target="_blank" rel="noopener noreferrer">{x.label}</a> : x.label}{x.note ? <span className="muted small"> · {x.note}</span> : null}</li>)}</ul>
          <p className="muted small">Links only. Ledger stores no files.</p>
        </section>
      )}
      {d.notes && <section className="card bl-card" aria-labelledby="bl-notes-h"><h2 id="bl-notes-h">Notes</h2><p className="bl-notes">{d.notes}</p></section>}

      {d.lifecycle.length > 0 && (
        <section className="card bl-card" aria-labelledby="bl-life-h">
          <h2 id="bl-life-h">What you have done to it</h2>
          <ul className="plain bl-items">{[...d.lifecycle].reverse().slice(0, 10).map((e, i) => <li key={i}>{day(e.on)} · {e.kind}{e.note ? ` (${e.note})` : ''}</li>)}</ul>
        </section>
      )}

      <p className="bl-foot"><button className="btn danger" onClick={() => setDel(true)}>Delete…</button> <span className="muted small">Only a bill with no history can be deleted. Otherwise, end it.</span></p>
      <p className="muted small">Status: {STATUS_LABEL[d.status]}.</p>

      {edit && <ObligationForm obligation={r} onClose={() => setEdit(false)} />}
      {life && <LifecycleDialog obligation={r} action={life} onClose={() => setLife(null)} />}
      {review && <ReviewDialog obligation={r} onClose={() => setReview(false)} />}
      {del && <DeleteDialog obligation={r} onClose={() => setDel(false)} />}
    </div>
  );
}
