import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from '../../core/router';
import { EmptyState, PageHeader } from '../../ui/components';
import { Figure } from '../../ui/Figure';
import { useMediaQuery } from '../../ui/useMediaQuery';
import { useToday } from '../../ui/useToday';
import { previewByDate, reviewTotal } from './presentation';
import ObligationForm from './ObligationForm';
import { DiscoverCard } from './DiscoverCard';
import { day, useMoney } from './BillsParts';
import { DueList } from './DueList';
import { CashFigures, CASH_NOTE } from './UpcomingPage';
import { amountWords } from './BillsParts';
import { addDays } from '../../lib/dates';
import { attention, attentionLines, cashTiming, derive, loadBillsSnapshot, upcoming, type AttentionCategory } from './readModel';
import { listRoute, obligationRoute, reviewRoute, upcomingRoute } from './paths';
import { describeSchedule } from './schedule';
import { buildOverview, currentAmount, UPCOMING_DAYS } from './views';

/**
 * Bills & Subscriptions landing page (B1, recomposed in D15). Everything on it is EXPECTED: amounts and dates come from the terms you entered. Nothing is a
 * payment, nothing is read from Finance, and an unknown amount is counted, never treated as zero. The page leads with what is coming up, with the cash
 * needed beside it (known and estimated kept apart); the counts, the attention list and the review list are the same lists as before.
 */
export default function OverviewPage() {
  const today = useToday();
  const { money } = useMoney();
  const [adding, setAdding] = useState(false);
  /** Phone: cash first, then a short preview of the next dates. One tree is drawn at a time, so nothing is fetched or drawn twice and the Tab order is the reading order. */
  const phone = useMediaQuery('(max-width: 640px)');
  const x = useLiveQuery(async () => derive(await loadBillsSnapshot(), today), [today]);
  if (!x) return <div className="bl"><PageHeader title="Bills & Subscriptions" eyebrow="Household" /><p className="muted">Loading…</p></div>;
  const obligations = x.snap.obligations;
  const ov = buildOverview(obligations, today);
  const att = attention(x);
  const lines = attentionLines(att);
  const wins = cashTiming(x);
  const ahead = upcoming(x).ahead;
  const soonAll = ahead.filter((e) => e.period.timing.date! <= addDays(today, UPCOMING_DAYS));
  const soon = soonAll.slice(0, 12);
  const preview = previewByDate(soonAll, (e) => e.period.timing.date!);
  const comingEntries = phone ? preview.groups.flatMap((g) => g.entries) : soon;
  const LINK: Record<AttentionCategory, string> = { dueSoon: upcomingRoute(), trials: upcomingRoute(), notices: upcomingRoute(), renewals: upcomingRoute(), notConfirmed: reviewRoute(), autopayCheck: reviewRoute(), unconfirmedTasks: reviewRoute(), conflicts: reviewRoute(), records: reviewRoute(), passedDates: reviewRoute(), taskProblems: reviewRoute(), paymentReview: reviewRoute(), paymentChanged: reviewRoute(), partlyPaid: reviewRoute(), typedFinance: reviewRoute(), duplicatePieces: reviewRoute(), declaredShort: reviewRoute(), ruleShared: reviewRoute(), cancelAwaiting: reviewRoute(), lifecycleConflict: reviewRoute(), afterCancel: reviewRoute(), scheduledAfterEnd: reviewRoute() };
  const c = ov.commitments;
  const n = ov.counts;
  const unknownBits = [c.unknown.periods > 0 ? `${c.unknown.periods} expected date${c.unknown.periods === 1 ? '' : 's'} (${c.unknown.obligations} bill${c.unknown.obligations === 1 ? '' : 's'}) have no amount, so they are in neither figure` : '', c.onDemand > 0 ? `${c.onDemand} on-demand bill${c.onDemand === 1 ? '' : 's'} with no schedule not counted` : '', c.loanExcluded > 0 ? `${c.loanExcluded} loan-related bill${c.loanExcluded === 1 ? '' : 's'} left out (see Loans)` : ''].filter(Boolean);

  const band = (
    <section className="card bl-band" aria-labelledby="bl-count-h">
      <h2 id="bl-count-h" className="sr-only">At a glance</h2>
      <div className="bl-counts">
        <div className="bl-fig"><span className="bl-big" data-testid="count-active">{n.active}</span><span className="bl-label">active</span></div>
        <div className="bl-fig"><span className="bl-big" data-testid="count-paused">{n.paused}</span><span className="bl-label">paused</span></div>
        <div className="bl-fig"><span className="bl-big" data-testid="count-ended">{n.ended}</span><span className="bl-label">ended</span></div>
      </div>
    </section>
  );
  const attentionEl = lines.length > 0 ? (
    <section className="card bl-card bl-attn" aria-labelledby="bl-att-h">
      <h2 id="bl-att-h">Needs attention</h2>
      <ul className="plain bl-items" aria-label="Needs attention">{lines.map((l) => <li key={l.id} data-testid={`att-${l.id}`}><Link to={LINK[l.id]}>{l.text}</Link></li>)}</ul>
      <p className="muted small">The same counts the Today card shows. Nothing here is a payment.</p>
    </section>
  ) : null;
  const comingEl = (
    <section className="card bl-card" aria-labelledby="bl-up-h">
      <h2 id="bl-up-h">Coming up (next {ov.upcomingDays} days)</h2>
      {comingEntries.length === 0 ? <p className="muted">No expected dates in the next {ov.upcomingDays} days.</p> : <DueList entries={comingEntries} today={today} money={money} />}
      {phone ? (
        <>
          {preview.hiddenDates > 0 && <p className="muted small bl-previewnote" role="status">Showing the next {preview.groups.length} dates ({preview.shown} of {preview.total} expected in the next {ov.upcomingDays} days).</p>}
          <p className="bl-viewall"><Link to={upcomingRoute()} className="btn">View all upcoming{ahead.length > 0 ? ` (${ahead.length})` : ''}</Link></p>
          <p className="muted small">Dates are worked out each time you look and nothing is stored in advance. None of these is recorded as paid unless you recorded it.</p>
        </>
      ) : (
        <p className="muted small"><Link to={upcomingRoute()}>See the next 90 days</Link>. Dates are worked out each time you look and nothing is stored in advance. None of these is recorded as paid unless you recorded it.</p>
      )}
    </section>
  );
  const reviewEl = (
    <section className="card bl-card" aria-labelledby="bl-rev-h">
      <h2 id="bl-rev-h">Your review list ({ov.review.length})</h2>
      {ov.review.length === 0 ? <p className="muted">Nothing on your review list. Open any bill and choose "Put on my review list" to look at its cost again.</p> : (
        <ul className="plain bl-items">
          {ov.review.map((r) => (
            <li key={r.ob.id}>
              <Link to={obligationRoute(r.ob.id)}><strong>{r.ob.data.title}</strong></Link>{' '}
              <span className="muted small">· {describeSchedule(r.ob.data.schedule)} · {amountWords(currentAmount(r.ob.data, today), money)}{r.ob.data.status !== 'active' ? ` · ${r.ob.data.status}` : ''}{r.ob.data.review.note ? ` · ${r.ob.data.review.note}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">Your own selection. It does not cancel anything and does not predict savings.</p>
    </section>
  );
  const notesEl = ov.notes.length > 0 ? (
    <section className="card bl-card" aria-labelledby="bl-notes-h">
      <h2 id="bl-notes-h">Worth a look</h2>
      <ul className="plain bl-items">{ov.notes.map((x) => <li key={x.id}>{x.obligationId ? <Link to={obligationRoute(x.obligationId)}>{x.text}</Link> : x.text}</li>)}</ul>
    </section>
  ) : null;
  const cashEl = (
    <section className="card bl-card" aria-labelledby="bl-cash-h">
      <h2 id="bl-cash-h">Expected cash needed</h2>
      <CashFigures wins={wins} money={money} />
      <p className="muted small">{CASH_NOTE}</p>
    </section>
  );
  const costsEl = (
    <section className="card bl-card" aria-labelledby="bl-com-h">
      <h2 id="bl-com-h">Expected recurring costs, next 12 months</h2>
      <div className="bl-kinds">
        <div data-testid="known"><Figure label="Known (fixed amounts)" value={money(c.known.cents)} description={`about ${money(c.averaged.knownCents)} a month, averaged`} /></div>
        <div data-testid="estimated"><Figure label="Estimated (amounts that vary)" certainty="estimated" value={money(c.estimated.cents)} description={`about ${money(c.averaged.estimatedCents)} a month, averaged`} /></div>
      </div>
      {unknownBits.length > 0 && <p className="small" data-testid="unknown">{unknownBits.join('. ')}.</p>}
      <p className="muted small">Worked out from the amounts and schedules you entered, {day(c.window.from)} to {day(c.window.to)}. These are expectations, not money spent. A yearly bill counts once, on its date; the monthly figure is simply the 12-month total divided by 12. An unknown amount is never counted as zero.</p>
    </section>
  );

  return (
    <div className="bl bl-ov">
      <PageHeader
        title="Bills & Subscriptions"
        eyebrow="Household"
        description="What you expect to pay regularly, and when. Expected amounts only: nothing here is a payment."
        actions={<><Link to={upcomingRoute()} className="btn">Upcoming</Link><Link to={reviewRoute()} className="btn">Needs review{reviewTotal(att) > 0 ? ` (${reviewTotal(att)})` : ''}</Link><Link to={listRoute()} className="btn">All bills</Link><button className="btn primary" onClick={() => setAdding(true)}>Add</button></>}
      />
      {n.total === 0 ? (
        <>
          <EmptyState title="No bills or subscriptions yet" action={<button className="btn primary" onClick={() => setAdding(true)}>Add your first one</button>}>
            Add a bill or subscription with three answers: what it is, how much, and how often. Ledger works out the next expected dates. Nothing is paid, posted or created in Finance.
          </EmptyState>
          <DiscoverCard />
        </>
      ) : (
        <>
          {band}
          {attentionEl}
          {phone ? (
            <>
              {cashEl}
              {comingEl}
              {costsEl}
              {reviewEl}
              {notesEl}
            </>
          ) : (
            <div className="bl-layout">
              <div className="bl-col bl-col-main">
                {comingEl}
                {reviewEl}
                {notesEl}
              </div>
              <div className="bl-col bl-col-side">
                {cashEl}
                {costsEl}
              </div>
            </div>
          )}

          <DiscoverCard />
        </>
      )}
      {adding && <ObligationForm onClose={() => setAdding(false)} />}
    </div>
  );
}
