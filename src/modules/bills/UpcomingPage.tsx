import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from '../../core/router';
import { addDays } from '../../lib/dates';
import { EmptyState, PageHeader } from '../../ui/components';
import { DateTile } from '../../ui/DateTile';
import { Figure } from '../../ui/Figure';
import { useToday } from '../../ui/useToday';
import { day, useMoney, type Money } from './BillsParts';
import { DueList } from './DueList';
import { billCount } from './presentation';
import { mondayOf } from './schedule';
import { cashTiming, derive, loadBillsSnapshot, upcoming, upcomingDeadlines, CASH_WINDOWS, type CashWindow } from './readModel';
import { DEADLINE_LABEL, relativeDay } from './terms';
import { markersOf } from './tasks';
import { obligationRoute, overviewRoute, reviewRoute } from './paths';

/**
 * The cash figures: expected, by what is known. Never "paid" or "cleared", never added to the Finance forecast. Known and estimated amounts are two separate
 * figures (never one total), and bills whose amount is not known are counted in words, never as $0.
 */
export function CashFigures({ wins, money }: { wins: CashWindow[]; money: Money }) {
  return (
    <ul className="plain bl-cashwins" aria-label="Expected cash needed">
      {wins.map((w) => (
        <li className="bl-cashwin" key={w.days} data-testid={`cash-${w.days}`}>
          <h3 className="bl-cashwin-h">Next {w.days} days</h3>
          <div className="bl-cashfigs">
            <div data-testid={`cash-${w.days}-known`}>
              {w.known.count > 0 ? <Figure label="Known" value={money(w.known.cents)} description={billCount(w.known.count)} /> : <div className="bl-cashnone"><span className="ui-figure-label">Known</span><span className="muted">None expected</span></div>}
            </div>
            <div data-testid={`cash-${w.days}-estimated`}>
              {w.estimated.count > 0 ? <Figure label="Estimated" certainty="estimated" value={money(w.estimated.cents)} description={billCount(w.estimated.count)} /> : <div className="bl-cashnone"><span className="ui-figure-label">Estimated</span><span className="muted">None expected</span></div>}
            </div>
          </div>
          <p className="small bl-cashunk" data-testid={`cash-${w.days}-unknown`}>{w.unknown.count > 0 ? <><strong>{billCount(w.unknown.count)}</strong> with no known amount. Counted here, not added.</> : <span className="muted">Every bill in this window has an amount.</span>}</p>
        </li>
      ))}
    </ul>
  );
}
export const CASH_NOTE = 'What is still expected to be needed, from the bills and amounts you entered. These are not payments, bank-cleared money or a forecast, and they are not added to your Finance cash outlook. An amount that is not known is counted but never treated as zero.';

export default function UpcomingPage() {
  const today = useToday();
  const { money } = useMoney();
  const x = useLiveQuery(async () => derive(await loadBillsSnapshot(), today), [today]);
  if (!x) return <div className="bl"><PageHeader title="Upcoming" /><p className="muted">Loading…</p></div>;
  const { pastDue, ahead } = upcoming(x);
  const wins = cashTiming(x);
  const deadlines = upcomingDeadlines(x);
  const weeks = new Map<string, typeof ahead>();
  for (const e of ahead) { const w = mondayOf(e.period.timing.date!); weeks.set(w, [...(weeks.get(w) ?? []), e]); }
  const openPayTask = (obId: number, slot: string) => x.snap.tasks.find((t) => { const m = markersOf(t); return m?.obligation === obId && m.purpose === 'pay' && m.cycle === slot && t.data.status !== 'done'; });
  const detail = (e: (typeof ahead)[number]) => {
    const task = openPayTask(e.ob.id, e.period.slot);
    return (
      <>
        <span className="muted small">{e.ob.data.payment.how === 'auto' ? 'Paid automatically' : e.ob.data.payment.how === 'manual' ? 'You pay it' : 'How it is paid is not stated'}</span>
        {task && <span className="muted small">Reminder Task for {task.data.dueDate ? day(task.data.dueDate) : 'no date'}</span>}
      </>
    );
  };
  const nothing = pastDue.length === 0 && ahead.length === 0 && deadlines.length === 0;
  return (
    <div className="bl bl-up">
      <p className="bl-back"><Link to={overviewRoute()}>← Bills & Subscriptions</Link></p>
      <PageHeader title="Upcoming" eyebrow="Household" description="The next 90 days: expected bills, their recorded due dates and amounts, and contract dates. Worked out each time you look; nothing is stored in advance." actions={<Link to={reviewRoute()} className="btn">Needs review</Link>} />
      <section className="card bl-card" aria-labelledby="bl-cash-h">
        <h2 id="bl-cash-h">Expected cash needed</h2>
        <CashFigures wins={wins} money={money} />
        <p className="muted small">{CASH_NOTE} Counted: a bill due today up to {CASH_WINDOWS.join(', ')} days ahead that is not yet recorded as paid, using what remains to be paid.</p>
      </section>

      {nothing ? <EmptyState title="Nothing coming up">Add a bill or subscription and its next expected dates appear here.</EmptyState> : (
        <div className={`bl-layout${deadlines.length === 0 ? ' bl-layout--one' : ''}`}>
          <div className="bl-col bl-col-main">
            {pastDue.length > 0 && (
              <section className="card bl-card bl-pastdue" aria-labelledby="bl-past-h">
                <h2 id="bl-past-h">Past its date, not confirmed ({pastDue.length})</h2>
                <DueList entries={pastDue} today={today} money={money} past label="Past its date" />
                <p className="muted small">Ledger only knows that no payment is recorded. It does not know whether these were paid elsewhere. Open a bill to record what happened. The last 45 days are shown.</p>
              </section>
            )}
            {weeks.size > 0 && (
              <section className="card bl-card" aria-labelledby="bl-weeks-h">
                <h2 id="bl-weeks-h">Coming up, week by week</h2>
                {[...weeks].map(([monday, list]) => (
                  <div className="bl-week" key={monday} role="group" aria-label={`Week of ${day(monday)}`}>
                    <h3 className="bl-week-h">Week of {day(monday)}</h3>
                    <DueList entries={list} today={today} money={money} detail={detail} label={`Expected dates, week of ${day(monday)}`} />
                  </div>
                ))}
              </section>
            )}
          </div>
          {deadlines.length > 0 && (
            <div className="bl-col bl-col-side">
              <section className="card bl-card" aria-labelledby="bl-dl-h">
                <h2 id="bl-dl-h">Contract dates</h2>
                <ul className="plain bl-dated">
                  {deadlines.map((d) => (
                    <li key={`${d.ob.id}-${d.kind}`} className="bl-dated-row">
                      <DateTile iso={d.date} today={today} size="sm" special />
                      <div className="bl-dated-main"><Link to={obligationRoute(d.ob.id)}><strong>{d.ob.data.title}</strong></Link><div>{DEADLINE_LABEL[d.kind]}: {day(d.date)} <span className="muted small">({relativeDay(d.date, today)})</span></div></div>
                    </li>
                  ))}
                </ul>
                <p className="muted small">Dates only. Nothing renews, cancels or changes when one passes. Through {day(addDays(today, 90))}.</p>
              </section>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
