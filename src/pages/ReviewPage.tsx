import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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

  return (
    <>
      <PageHeader className="no-print" title="Year in review" description="A printable look back at the year." actions={<><div className="row">
          <label className="row">Year<select value={year} onChange={(e) => setYear(Number(e.target.value))}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
          <button className="primary" onClick={() => window.print()}>Print or save as PDF</button>
        </div></>} />
      <h1 className="print-only">{year} in review</h1>
      <p className="muted no-print">A look back at {year}, from your accounts, your Income setup, your sales, and your net worth history. Income and spending are from the transactions in your accounts, so they are only as complete as what you entered.</p>

      {r.highlights.length > 0 ? (
        <div className="card">
          <strong>Highlights</strong>
          <ul>{r.highlights.map((h, i) => <li key={i}>{h}</li>)}</ul>
        </div>
      ) : <p className="muted">There is not enough data for {year} yet.</p>}

      <section className="pkg">
        <h2>Net worth</h2>
        {r.netWorth ? (
          <div className="tiles">
            <div className="tile"><div className="muted">Start ({r.netWorth.startDate})</div><div className="v">{formatCents(r.netWorth.startCents)}</div></div>
            <div className="tile"><div className="muted">Latest ({r.netWorth.endDate})</div><div className="v">{formatCents(r.netWorth.endCents)}</div></div>
            <div className="tile"><div className="muted">Change</div><div className={`v ${r.netWorth.changeCents >= 0 ? 'pos' : 'neg'}`}>{formatCents(r.netWorth.changeCents)}</div><div className="muted" style={{ fontSize: '0.8rem' }}>{r.netWorth.changePct === null ? '' : `${(r.netWorth.changePct * 100).toFixed(1)}%`}</div></div>
          </div>
        ) : <p className="muted">Needs at least two saved points. The app saves one each month; you can add past ones on the <Link to="/networth">Net worth</Link> page.</p>}
        {yearSnaps.length >= 2 && <LinesChart title={`Net worth in ${year}`} xLabels={yearSnaps.map((s) => s.date)} series={[{ label: 'Net worth', color: 'var(--s1)', values: yearSnaps.map((s) => s.totalCents) }]} />}
      </section>

      <section className="pkg">
        <h2>Income and spending</h2>
        <div className="tiles">
          <div className="tile"><div className="muted">Income into accounts</div><div className="v">{formatCents(r.spending.incomeCents)}</div></div>
          <div className="tile"><div className="muted">Spending</div><div className="v">{formatCents(r.spending.totalCents)}</div><div className="muted" style={{ fontSize: '0.8rem' }}>{formatCents(r.spending.monthlyAvgCents)} a month</div></div>
          <div className="tile"><div className="muted">Saved</div><div className={`v ${r.spending.savedCents < 0 ? 'neg' : 'pos'}`}>{formatCents(r.spending.savedCents)}</div><div className="muted" style={{ fontSize: '0.8rem' }}>{pct(r.spending.savingsRate)} of income</div></div>
        </div>
        {r.spending.top.length > 0 && (
          <table>
            <thead><tr><th>Top categories</th><th className="num">Spent</th><th className="num">Share</th></tr></thead>
            <tbody>{r.spending.top.map((c) => <tr key={c.name}><td>{c.name}</td><td className="num">{formatCents(c.cents)}</td><td className="num">{r.spending.totalCents ? `${Math.round((c.cents / r.spending.totalCents) * 100)}%` : ''}</td></tr>)}</tbody>
          </table>
        )}
        {r.spending.biggestMonth && <p className="muted">Highest-spending month: {monthLabel(r.spending.biggestMonth.month)} ({formatCents(r.spending.biggestMonth.cents)}). More on the <Link to="/reports">Reports</Link> page.</p>}
      </section>

      <section className="pkg">
        <h2>Pay, saving, and taxes</h2>
        <table><tbody>
          <tr><td>Gross pay (before bonuses and stock awards)</td><td className="num">{formatCents(r.pay.grossCents)}</td></tr>
          {r.pay.bonusCents > 0 && <tr><td>Bonuses</td><td className="num">{formatCents(r.pay.bonusCents)}</td></tr>}
          {r.pay.rsuCents > 0 && <tr><td>Stock awards vested</td><td className="num">{formatCents(r.pay.rsuCents)}</td></tr>}
          <tr><td>Take-home pay</td><td className="num">{formatCents(r.pay.netCents)}</td></tr>
          <tr><td>Retirement and HSA saving (you + employer)</td><td className="num">{formatCents(r.retirement.totalCents)}</td></tr>
          <tr><td>Federal income tax</td><td className="num">{formatCents(r.taxes.federalCents)}</td></tr>
          <tr><td>Massachusetts income tax</td><td className="num">{formatCents(r.taxes.maCents)}</td></tr>
          <tr><td>Social Security, Medicare, and PFML</td><td className="num">{formatCents(r.taxes.payrollCents)}</td></tr>
          <tr><td><strong>Total taxes</strong> ({pct(r.taxes.effectiveRate)} of pay)</td><td className="num"><strong>{formatCents(r.taxes.totalCents)}</strong></td></tr>
          {r.taxes.refundCents !== null && <tr><td>{r.taxes.refundCents >= 0 ? 'Expected refund' : 'Expected amount due'} (federal + MA)</td><td className={`num ${r.taxes.refundCents >= 0 ? 'pos' : 'neg'}`}>{formatCents(Math.abs(r.taxes.refundCents))}</td></tr>}
        </tbody></table>
      </section>

      <section className="pkg">
        <h2>Investing and debt</h2>
        <table><tbody>
          <tr><td>Realized gains: short-term</td><td className="num">{formatCents(r.investing.shortTermCents)}</td></tr>
          <tr><td>Realized gains: long-term</td><td className="num">{formatCents(r.investing.longTermCents)}</td></tr>
          <tr><td>Loan principal paid down</td><td className="num">{formatCents(r.debt.principalCents)}</td></tr>
          <tr><td>Loan interest paid</td><td className="num">{formatCents(r.debt.interestCents)}</td></tr>
          {(r.hsa.qualifiedCents > 0 || r.hsa.taxableCents > 0) && <tr><td>HSA withdrawals: medical / not medical</td><td className="num">{formatCents(r.hsa.qualifiedCents)} / {formatCents(r.hsa.taxableCents)}</td></tr>}
        </tbody></table>
        {goals.length > 0 && <p className="muted">Goals you are working toward: {goals.map((g) => g.name).join(', ')}. See <Link to="/goals">Goals</Link>.</p>}
      </section>
      <p className="muted">Prepared {todayISO()}. Tax figures are the app’s estimates from your Income setup, not your return.</p>
    </>
  );
}
