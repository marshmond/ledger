import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { EmptyState, PageHeader } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { todayISO } from '../../lib/money';
import { useToday } from '../../ui/useToday';
import { loadHouseholdOverview } from './overview';
import { ActionsCard, AreasCard, CommitmentsCard, ManagedCard, ReadMe, ReviewCard, SpendingCard, SummaryTiles, TraceCard, UpcomingCard, useMoney } from './Parts';
import './household.css';

/**
 * Household finances (B5): one read-only page that keeps three ideas apart (what is expected soon, what you have committed to, what has been recorded) and never
 * changes a record. A failed load shows an error and NO totals, so a figure built from only some of the sources can never look complete.
 */
export default function OverviewPage() {
  const today = useToday() || todayISO();
  const { hide, money, text } = useMoney();
  const [period, setPeriod] = useState('last12');
  const [days, setDays] = useState<7 | 30 | 90>(30); // the Expected payments window; the summary tile follows it, so the two never disagree
  const [again, setAgain] = useState(0);
  const res = useLiveQuery(async () => {
    try { return { ok: true as const, ov: await loadHouseholdOverview(period, today) }; }
    catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : 'Something went wrong while reading.' }; }
  }, [period, today, hide, again]);

  const head = <PageHeader title="Household Finances" eyebrow="Finances" description="What is coming up, what you have committed to, and what has actually been recorded, kept apart and never double-counted." actions={<span className="hh-readonly"><Icon name="info" size={16} />Read-only: nothing here changes a record</span>} />;
  if (!res) return <div className="hh">{head}<p className="hh-skel" role="status">Loading… no totals are shown until everything has been read.</p></div>;
  if (!res.ok) {
    return (
      <div className="hh">{head}
        <div className="hh-err" role="alert">
          <strong>Ledger could not read all of your records, so it is showing no totals.</strong>
          <p className="small">A partial figure could look complete and be wrong, so nothing is shown instead. Nothing was changed. {res.error}</p>
          <button type="button" className="btn" onClick={() => setAgain((n) => n + 1)}>Try again</button>
        </div>
      </div>
    );
  }
  const ov = res.ov;
  if (ov.empty) {
    return (
      <div className="hh">{head}
        <EmptyState title="Nothing to bring together yet" action={<span className="row"><a className="btn primary" href="#/bills">Bills &amp; Subscriptions</a><a className="btn" href="#/services">Household Services</a><a className="btn" href="#/assets">Home &amp; Assets</a></span>}>
          This page combines your bills and subscriptions, your household services and your home and assets. Add something in one of them and it appears here.
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="hh">
      {head}
      <ReadMe />
      <SummaryTiles c={ov.commitments} s={ov.spending} days={days} periodLabel={ov.period.label} hide={hide} money={money} />
      <ReviewCard items={ov.review} text={text} />
      <UpcomingCard c={ov.commitments} money={money} text={text} days={days} onDays={setDays} />
      <div className="hh-two">
        <CommitmentsCard c={ov.commitments} money={money} text={text} />
        <div className="hh-stack"><ActionsCard actions={ov.actions} text={text} /><ManagedCard managed={ov.managed} /></div>
      </div>
      <div className="hh-two">
        <SpendingCard s={ov.spending} periodLabel={ov.period.label} periodOptions={ov.periodOptions} period={ov.period.id} onPeriod={setPeriod} money={money} hide={hide} />
        <AreasCard s={ov.spending} money={money} hide={hide} />
      </div>
      <TraceCard s={ov.spending} money={money} text={text} />
    </div>
  );
}
