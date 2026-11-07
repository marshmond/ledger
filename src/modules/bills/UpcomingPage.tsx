import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from '../../core/router';
import { addDays } from '../../lib/dates';
import { EmptyState, PageHeader } from '../../ui/components';
import { useToday } from '../../ui/useToday';
import { day, useMoney, type Money } from './BillsParts';
import { amountLine, dueLine, PeriodLabel } from './PeriodParts';
import { mondayOf } from './schedule';
import { cashTiming, derive, loadBillsSnapshot, upcoming, upcomingDeadlines, CASH_WINDOWS, type CashWindow } from './readModel';
import { DEADLINE_LABEL, relativeDay } from './terms';
import { markersOf } from './tasks';
import { obligationRoute, overviewRoute, reviewRoute } from './paths';

/** The cash figures: expected, by what is known. Never "paid" or "cleared", never added to the Finance forecast. Unknown amounts are counted, not added. */
export function CashFigures({ wins, money }: { wins: CashWindow[]; money: Money }) {
  return (
    <div className="bl-cash" role="table" aria-label="Expected cash needed">
      <div className="bl-cash-row bl-cash-head" role="row"><span role="columnheader">Next</span><span role="columnheader">Known</span><span role="columnheader">Estimated</span><span role="columnheader">Amount not known</span></div>
      {wins.map((w) => (
        <div className="bl-cash-row" role="row" key={w.days} data-testid={`cash-${w.days}`}>
          <span role="rowheader">{w.days} days</span>
          <span role="cell" data-testid={`cash-${w.days}-known`}>{money(w.known.cents)}<span className="muted small"> · {w.known.count} bill{w.known.count === 1 ? '' : 's'}</span></span>
          <span role="cell" data-testid={`cash-${w.days}-estimated`}>{money(w.estimated.cents)}<span className="muted small"> · {w.estimated.count} bill{w.estimated.count === 1 ? '' : 's'}</span></span>
          <span role="cell" data-testid={`cash-${w.days}-unknown`}>{w.unknown.count} bill{w.unknown.count === 1 ? '' : 's'}</span>
        </div>
      ))}
    </div>
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
  const row = (e: (typeof ahead)[number]) => {
    const task = openPayTask(e.ob.id, e.period.slot);
    return (
      <li key={`${e.ob.id}-${e.period.slot}`} className="bl-uprow" data-testid="upcoming-row">
        <div className="bl-row-main">
          <Link to={obligationRoute(e.ob.id)}><strong>{e.ob.data.title}</strong></Link>
          <span className="muted small">{dueLine(e.period)} · {e.ob.data.payment.how === 'auto' ? 'automatic' : e.ob.data.payment.how === 'manual' ? 'you pay it' : 'how it is paid is not stated'}</span>
          <span className="small">{amountLine(e.period, money)}</span>
          {task && <span className="muted small">Reminder Task for {task.data.dueDate ? day(task.data.dueDate) : 'no date'}</span>}
        </div>
        <div className="bl-row-side"><PeriodLabel p={e.period} money={money} /></div>
      </li>
    );
  };
  const nothing = pastDue.length === 0 && ahead.length === 0 && deadlines.length === 0;
  return (
    <div className="bl">
      <p className="bl-back"><Link to={overviewRoute()}>← Bills & Subscriptions</Link></p>
      <PageHeader title="Upcoming" description="The next 90 days: expected bills, their recorded due dates and amounts, and contract dates. Worked out each time you look; nothing is stored in advance." actions={<Link to={reviewRoute()} className="btn">Needs review</Link>} />
      <section className="card bl-card" aria-labelledby="bl-cash-h">
        <h2 id="bl-cash-h">Expected cash needed</h2>
        <CashFigures wins={wins} money={money} />
        <p className="muted small">{CASH_NOTE} Counted: a bill due today up to {CASH_WINDOWS.join(', ')} days ahead that is not yet recorded as paid, using what remains to be paid.</p>
      </section>

      {nothing ? <EmptyState title="Nothing coming up">Add a bill or subscription and its next expected dates appear here.</EmptyState> : (
        <>
          {pastDue.length > 0 && (
            <section className="card bl-card" aria-labelledby="bl-past-h">
              <h2 id="bl-past-h">Past its date, not confirmed ({pastDue.length})</h2>
              <ul className="plain bl-uplist">{pastDue.map(row)}</ul>
              <p className="muted small">Ledger only knows that no payment is recorded. It does not know whether these were paid elsewhere. Open a bill to record what happened. The last 45 days are shown.</p>
            </section>
          )}
          {[...weeks].map(([monday, list]) => (
            <section className="card bl-card" key={monday} aria-label={`Week of ${day(monday)}`}>
              <h2>Week of {day(monday)}</h2>
              <ul className="plain bl-uplist">{list.map(row)}</ul>
            </section>
          ))}
          {deadlines.length > 0 && (
            <section className="card bl-card" aria-labelledby="bl-dl-h">
              <h2 id="bl-dl-h">Contract dates</h2>
              <ul className="plain bl-items">
                {deadlines.map((d) => <li key={`${d.ob.id}-${d.kind}`}><Link to={obligationRoute(d.ob.id)}><strong>{d.ob.data.title}</strong></Link> · {DEADLINE_LABEL[d.kind]}: {day(d.date)} <span className="muted small">({relativeDay(d.date, today)})</span></li>)}
              </ul>
              <p className="muted small">Dates only. Nothing renews, cancels or changes when one passes. Through {day(addDays(today, 90))}.</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
