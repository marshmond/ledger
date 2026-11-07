import { useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { TodayCardDef, TodayCardProps } from '../../core/registry';
import { attention, attentionLines, derive, loadBillsSnapshot, type AttentionCategory } from './readModel';

const HREF: Record<AttentionCategory, string> = {
  dueSoon: '#/bills/upcoming', trials: '#/bills/upcoming', notices: '#/bills/upcoming', renewals: '#/bills/upcoming',
  notConfirmed: '#/bills/review', autopayCheck: '#/bills/review', unconfirmedTasks: '#/bills/review', conflicts: '#/bills/review', records: '#/bills/review', passedDates: '#/bills/review', taskProblems: '#/bills/review',
  paymentReview: '#/bills/review', paymentChanged: '#/bills/review', partlyPaid: '#/bills/review', typedFinance: '#/bills/review', duplicatePieces: '#/bills/review', declaredShort: '#/bills/review',
};

/**
 * "Bills & Subscriptions" on Today: counts only, read-only, hidden when there is nothing to look at. The lines carry numbers and words, never a bill's
 * name, a provider, a note or an amount, so Hide Amounts has nothing to hide. It never lists the reminder Tasks themselves: Tasks and the Calendar
 * already put those on Today. The numbers are the same ones the Bills Overview shows (one shared read model).
 */
function BillsCard({ today, reportEmpty }: TodayCardProps) {
  const a = useLiveQuery(async () => attention(derive(await loadBillsSnapshot(), today)), [today]);
  const rows = useMemo(() => (a ? attentionLines(a) : []), [a]);
  useEffect(() => { reportEmpty(!!a && rows.length === 0); }, [a, rows.length, reportEmpty]);
  return (
    <section className="card" aria-label="Bills and subscriptions needing attention">
      <div className="card-head"><strong>Bills &amp; Subscriptions</strong>{rows.length > 0 && <span className="badge">{rows.length}</span>}<a className="card-link" href="#/bills">Open</a></div>
      {!a ? <p className="muted" style={{ margin: 0 }}>Loading…</p> : (
        <ul className="plain td-list">
          {rows.map((r) => <li key={r.id} className="td-proj"><a href={HREF[r.id]}>{r.text}</a></li>)}
        </ul>
      )}
    </section>
  );
}

export const BILLS_TODAY_CARDS: TodayCardDef[] = [
  { id: 'bills.attention', title: 'Bills & Subscriptions', defaultWidth: 'half', priority: 37, hideWhenEmpty: true, Component: BillsCard },
];
