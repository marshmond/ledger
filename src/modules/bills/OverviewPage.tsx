import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from '../../core/router';
import { EmptyState, PageHeader } from '../../ui/components';
import { useToday } from '../../ui/useToday';
import ObligationForm from './ObligationForm';
import { amountWords, day, useMoney } from './BillsParts';
import { loadObligations } from './data';
import { listRoute, obligationRoute } from './paths';
import { describeSchedule } from './schedule';
import { buildOverview, currentAmount } from './views';

/**
 * Bills & Subscriptions landing page (B1). Everything on it is EXPECTED: amounts and dates come from the terms you entered. Nothing is a
 * payment, nothing is read from Finance, and an unknown amount is counted, never treated as zero.
 */
export default function OverviewPage() {
  const today = useToday();
  const { money } = useMoney();
  const [adding, setAdding] = useState(false);
  const obligations = useLiveQuery(() => loadObligations(), []);
  if (!obligations) return <div className="bl"><PageHeader title="Bills & Subscriptions" /><p className="muted">Loading…</p></div>;
  const ov = buildOverview(obligations, today);
  const c = ov.commitments;
  const n = ov.counts;
  const unknownBits = [c.unknown.periods > 0 ? `${c.unknown.periods} expected date${c.unknown.periods === 1 ? '' : 's'} (${c.unknown.obligations} bill${c.unknown.obligations === 1 ? '' : 's'}) have no amount, so they are in neither figure` : '', c.onDemand > 0 ? `${c.onDemand} on-demand bill${c.onDemand === 1 ? '' : 's'} with no schedule not counted` : '', c.loanExcluded > 0 ? `${c.loanExcluded} loan-related bill${c.loanExcluded === 1 ? '' : 's'} left out (see Loans)` : ''].filter(Boolean);

  return (
    <div className="bl">
      <PageHeader
        title="Bills & Subscriptions"
        description="What you expect to pay regularly, and when. Expected amounts only: nothing here is a payment."
        actions={<><Link to={listRoute()} className="btn">All bills</Link><button className="btn primary" onClick={() => setAdding(true)}>Add</button></>}
      />
      {n.total === 0 ? (
        <EmptyState title="No bills or subscriptions yet" action={<button className="btn primary" onClick={() => setAdding(true)}>Add your first one</button>}>
          Add a bill or subscription with three answers: what it is, how much, and how often. Ledger works out the next expected dates. Nothing is paid, posted or created in Finance.
        </EmptyState>
      ) : (
        <>
          <section className="card bl-card" aria-labelledby="bl-count-h">
            <h2 id="bl-count-h">At a glance</h2>
            <div className="bl-counts">
              <div className="bl-fig"><span className="bl-big" data-testid="count-active">{n.active}</span><span className="bl-label">active</span></div>
              <div className="bl-fig"><span className="bl-big" data-testid="count-paused">{n.paused}</span><span className="bl-label">paused</span></div>
              <div className="bl-fig"><span className="bl-big" data-testid="count-ended">{n.ended}</span><span className="bl-label">ended</span></div>
            </div>
          </section>

          <section className="card bl-card" aria-labelledby="bl-com-h">
            <h2 id="bl-com-h">Expected recurring costs, next 12 months</h2>
            <div className="bl-kinds">
              <div className="bl-fig"><span className="bl-label">Known (fixed amounts)</span><span className="bl-big" data-testid="known">{money(c.known.cents)}</span><span className="bl-label">about {money(c.averaged.knownCents)} a month, averaged</span></div>
              <div className="bl-fig"><span className="bl-label">Estimated (amounts that vary)</span><span className="bl-big" data-testid="estimated">{money(c.estimated.cents)}</span><span className="bl-label">about {money(c.averaged.estimatedCents)} a month, averaged</span></div>
            </div>
            {unknownBits.length > 0 && <p className="small" data-testid="unknown">{unknownBits.join('. ')}.</p>}
            <p className="muted small">Worked out from the amounts and schedules you entered, {day(c.window.from)} to {day(c.window.to)}. These are expectations, not money spent. A yearly bill counts once, on its date; the monthly figure is simply the 12-month total divided by 12. An unknown amount is never counted as zero.</p>
          </section>

          <section className="card bl-card" aria-labelledby="bl-up-h">
            <h2 id="bl-up-h">Coming up (expected, next {ov.upcomingDays} days)</h2>
            {ov.upcoming.length === 0 ? <p className="muted">No expected dates in the next {ov.upcomingDays} days.</p> : (
              <ul className="plain bl-datelist" aria-label="Expected dates">
                {ov.upcoming.map((u) => (
                  <li key={`${u.ob.id}-${u.slot}`}>
                    <span><Link to={obligationRoute(u.ob.id)}>{u.ob.data.title}</Link> <span className="muted small">· {day(u.nominal)}</span></span>
                    <span className="muted small">{amountWords(u.amount, money)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="muted small">A preview of dates. Nothing is created in Tasks or the Calendar, and none of these is recorded as paid.</p>
          </section>

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

          {ov.notes.length > 0 && (
            <section className="card bl-card" aria-labelledby="bl-notes-h">
              <h2 id="bl-notes-h">Worth a look</h2>
              <ul className="plain bl-items">{ov.notes.map((x) => <li key={x.id}>{x.obligationId ? <Link to={obligationRoute(x.obligationId)}>{x.text}</Link> : x.text}</li>)}</ul>
            </section>
          )}
        </>
      )}
      {adding && <ObligationForm onClose={() => setAdding(false)} />}
    </div>
  );
}
