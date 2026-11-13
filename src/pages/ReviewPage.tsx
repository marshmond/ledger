import { useMemo, useState } from 'react';
import { Link } from '../core/router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { formatCents, todayISO } from '../lib/money';
import { monthLabel } from '../lib/dates';
import { buildIncomeModel } from '../lib/income';
import { hsaYearImpact } from '../lib/hsa';
import { netForTax, realizedFor } from '../lib/lots';
import { loanView } from '../lib/loanSchedule';
import { spendingMatrix } from '../lib/reports';
import { buildReview } from '../lib/review';
import { LinesChart } from './charts';
import { PageHeader } from '../ui/components';
import { Kind, Lines, PlanFigs, PlanHero, PlanJump, PlanSection } from './PlanParts';
import './analysis.css';
import './plan.css';
import './docs.css';

const pct = (f: number | null) => (f === null ? '—' : `${(f * 100).toFixed(1)}%`);

/** A one-page summary of the year: net worth, spending, saving, taxes, investing, and debt, with highlights. Print it or save it as a PDF. */
export default function ReviewPage() {
  const thisYear = Number(todayISO().slice(0, 4));
  const [year, setYear] = useState(todayISO().slice(5, 7) <= '02' ? thisYear - 1 : thisYear);
  const people = useLiveQuery(() => db.people.toArray(), []) ?? [];
  const profiles = useLiveQuery(() => db.incomeProfiles.toArray(), []) ?? [];
  const bonuses = useLiveQuery(() => db.bonuses.toArray(), []) ?? [];
  const settings = useLiveQuery(() => db.taxSettings.toArray(), []) ?? [];
  const vests = useLiveQuery(() => db.rsuVests.toArray(), []) ?? [];
  const securities = useLiveQuery(() => db.securities.toArray(), []) ?? [];
  const invAccounts = useLiveQuery(() => db.invAccounts.toArray(), []) ?? [];
  const sales = useLiveQuery(() => db.sales.toArray(), []) ?? [];
  const hsaW = useLiveQuery(() => db.hsaWithdrawals.toArray(), []) ?? [];
  const loans = useLiveQuery(() => db.loans.toArray(), []) ?? [];
  const rates = useLiveQuery(() => db.loanRates.toArray(), []) ?? [];
  const events = useLiveQuery(() => db.loanEvents.toArray(), []) ?? [];
  const txns = useLiveQuery(() => db.txns.toArray(), []) ?? [];
  const categories = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const snaps = useLiveQuery(() => db.netWorthSnapshots.toArray(), []) ?? [];
  const goals = useLiveQuery(() => db.goals.toArray(), []) ?? [];

  const r = useMemo(() => {
    const impact = hsaYearImpact(hsaW, invAccounts, people, year);
    const realized = realizedFor(sales, year);
    const model = buildIncomeModel(year, people, profiles, bonuses, settings.find((s) => s.year === year), { vests, securities }, { taxableCents: impact.taxableCents, penaltyCents: impact.penaltyCents }, netForTax(realized));
    const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
    return buildReview(
      {
        year, snapshots: snaps, matrix: spendingMatrix(txns, categories, months), years: model.years, household: model.household, realized,
        rsuGrossCents: model.vests.filter((v) => v.vest.date.startsWith(`${year}-`)).reduce((a, v) => a + v.grossCents, 0),
        loans: loans.filter((l) => !l.scenario).map((l) => {
          const rows = loanView(l, rates.filter((x) => x.loanId === l.id), events.filter((e) => e.loanId === l.id)).schedule.rows.filter((x) => x.date.startsWith(`${year}-`));
          return { name: l.name, interestCents: Math.round(rows.reduce((a, x) => a + x.interest, 0)), principalCents: Math.round(rows.reduce((a, x) => a + x.principal + x.extra, 0)) };
        }),
        hsaWithdrawals: { qualifiedCents: impact.qualifiedCents, taxableCents: impact.taxableCents },
      },
      formatCents,
    );
  }, [year, people, profiles, bonuses, settings, vests, securities, invAccounts, sales, hsaW, loans, rates, events, txns, categories, snaps]);

  const years = [...new Set([thisYear, thisYear - 1, ...profiles.map((p) => p.year), ...snaps.map((s) => Number(s.date.slice(0, 4)))])].sort((a, b) => b - a);
  const yearSnaps = snaps.filter((s) => s.date.startsWith(`${year}-`)).sort((a, b) => a.date.localeCompare(b.date));

  const nw = r.netWorth;

  return (
    <div className="dc-doc dc-report">
      <PageHeader className="no-print" title="Year in review" description="A printable look back at the year." actions={<><div className="row">
          <label className="row">Year<select value={year} onChange={(e) => setYear(Number(e.target.value))}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
          <button className="primary" onClick={() => window.print()}>Print or save as PDF</button>
        </div></>} />
      <h1 className="print-only">{year} in review</h1>
      <p className="muted no-print dc-lede">A look back at {year}, from your accounts, your Income setup, your sales, and your net worth history. Income and spending are from the transactions in your accounts, so they are only as complete as what you entered.</p>

      <PlanHero
        id="review-top"
        label={<>Net worth, end of {year}<Kind k="recorded">Saved snapshots</Kind></>}
        amount={nw ? formatCents(nw.endCents) : 'Not enough data yet'}
        message={nw ? <>Latest saved point is {nw.endDate}.</> : <>Needs at least two saved points. The app saves one each month; you can add past ones on the <Link to="/networth">Net worth</Link> page.</>}
        figs={nw ? [
          { label: `Start (${nw.startDate})`, value: formatCents(nw.startCents) },
          { label: 'Change', value: formatCents(nw.changeCents), sub: nw.changePct === null ? undefined : `${(nw.changePct * 100).toFixed(1)}%` },
          { label: 'Saved', value: formatCents(r.spending.savedCents), sub: `${pct(r.spending.savingsRate)} of income` },
        ] : [
          { label: 'Income into accounts', value: formatCents(r.spending.incomeCents) },
          { label: 'Spending', value: formatCents(r.spending.totalCents) },
        ]}
      />

      <PlanJump label="In this report" items={[
        { id: 'rv-networth', label: 'Net worth' }, { id: 'rv-spending', label: 'Income and spending' },
        { id: 'rv-pay', label: 'Pay, saving, and taxes' }, { id: 'rv-invest', label: 'Investing and debt' },
      ]} />

      {r.highlights.length > 0 ? (
        <PlanSection id="rv-highlights" title="Highlights" kind={<Kind k="actual">From the sections below</Kind>}>
          <ul className="dc-highlights">{r.highlights.map((h, i) => <li key={i}>{h}</li>)}</ul>
        </PlanSection>
      ) : <p className="muted">There is not enough data for {year} yet.</p>}

      <PlanSection id="rv-networth" title="Net worth" kind={<Kind k="recorded">Saved snapshots</Kind>}>
        {nw ? (
          <PlanFigs label="Net worth for the year" figs={[
            { label: `Start (${nw.startDate})`, value: formatCents(nw.startCents) },
            { label: `Latest (${nw.endDate})`, value: formatCents(nw.endCents) },
            { label: 'Change', value: <span className={nw.changeCents >= 0 ? 'pos' : 'neg'}>{formatCents(nw.changeCents)}</span>, sub: nw.changePct === null ? undefined : `${(nw.changePct * 100).toFixed(1)}%` },
          ]} />
        ) : <p className="muted">Needs at least two saved points. The app saves one each month; you can add past ones on the <Link to="/networth">Net worth</Link> page.</p>}
        {yearSnaps.length >= 2 && <LinesChart title={`Net worth in ${year}`} xLabels={yearSnaps.map((s) => s.date)} series={[{ label: 'Net worth', color: 'var(--s1)', values: yearSnaps.map((s) => s.totalCents) }]} />}
      </PlanSection>

      <PlanSection id="rv-spending" title="Income and spending" kind={<Kind k="recorded">Transactions in your accounts</Kind>}>
        <PlanFigs label="Income and spending" figs={[
          { label: 'Income into accounts', value: formatCents(r.spending.incomeCents) },
          { label: 'Spending', value: formatCents(r.spending.totalCents), sub: `${formatCents(r.spending.monthlyAvgCents)} a month` },
          { label: 'Saved', value: <span className={r.spending.savedCents < 0 ? 'neg' : 'pos'}>{formatCents(r.spending.savedCents)}</span>, sub: `${pct(r.spending.savingsRate)} of income` },
        ]} />
        {r.spending.top.length > 0 && (
          <div className="an-tablewrap dc-tablegap">
            <table className="an-table">
              <thead><tr><th>Top categories</th><th className="num">Spent</th><th className="num">Share</th></tr></thead>
              <tbody>{r.spending.top.map((c) => <tr key={c.name}><td>{c.name}</td><td className="num">{formatCents(c.cents)}</td><td className="num">{r.spending.totalCents ? `${Math.round((c.cents / r.spending.totalCents) * 100)}%` : ''}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        {r.spending.biggestMonth && <p className="muted">Highest-spending month: {monthLabel(r.spending.biggestMonth.month)} ({formatCents(r.spending.biggestMonth.cents)}). More on the <Link to="/reports">Reports</Link> page.</p>}
      </PlanSection>

      <PlanSection id="rv-pay" title="Pay, saving, and taxes" kind={<Kind k="estimate">From your Income setup</Kind>}>
        <Lines label="Pay, saving, and taxes" rows={[
          { label: 'Gross pay (before bonuses and stock awards)', value: formatCents(r.pay.grossCents) },
          ...(r.pay.bonusCents > 0 ? [{ label: 'Bonuses', value: formatCents(r.pay.bonusCents) }] : []),
          ...(r.pay.rsuCents > 0 ? [{ label: 'Stock awards vested', value: formatCents(r.pay.rsuCents) }] : []),
          { label: 'Take-home pay', value: formatCents(r.pay.netCents) },
          { label: 'Retirement and HSA saving (you + employer)', value: formatCents(r.retirement.totalCents) },
          { label: 'Federal income tax', value: formatCents(r.taxes.federalCents) },
          { label: 'Massachusetts income tax', value: formatCents(r.taxes.maCents) },
          { label: 'Social Security, Medicare, and PFML', value: formatCents(r.taxes.payrollCents) },
          { label: <><strong>Total taxes</strong> ({pct(r.taxes.effectiveRate)} of pay)</>, value: <strong>{formatCents(r.taxes.totalCents)}</strong>, strong: true },
          ...(r.taxes.refundCents !== null ? [{ label: `${r.taxes.refundCents >= 0 ? 'Expected refund' : 'Expected amount due'} (federal + MA)`, value: <span className={r.taxes.refundCents >= 0 ? 'pos' : 'neg'}>{formatCents(Math.abs(r.taxes.refundCents))}</span> }] : []),
        ]} />
      </PlanSection>

      <PlanSection id="rv-invest" title="Investing and debt" kind={<Kind k="recorded">Sales and loan schedules</Kind>}>
        <Lines label="Investing and debt" rows={[
          { label: 'Realized gains: short-term', value: formatCents(r.investing.shortTermCents) },
          { label: 'Realized gains: long-term', value: formatCents(r.investing.longTermCents) },
          { label: 'Loan principal paid down', value: formatCents(r.debt.principalCents) },
          { label: 'Loan interest paid', value: formatCents(r.debt.interestCents) },
          ...((r.hsa.qualifiedCents > 0 || r.hsa.taxableCents > 0) ? [{ label: 'HSA withdrawals: medical / not medical', value: <>{formatCents(r.hsa.qualifiedCents)} / {formatCents(r.hsa.taxableCents)}</> }] : []),
        ]} />
        {goals.length > 0 && <p className="muted">Goals you are working toward: {goals.map((g) => g.name).join(', ')}. See <Link to="/goals">Goals</Link>.</p>}
      </PlanSection>
      <p className="muted dc-foot">Prepared {todayISO()}. Tax figures are the app’s estimates from your Income setup, not your return.</p>
    </div>
  );
}
