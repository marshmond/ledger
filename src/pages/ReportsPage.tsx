import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { formatCents, todayISO } from '../lib/money';
import { monthLabel } from '../lib/dates';
import { categoryCsv, categoryStats, compareTotals, jumps, lastMonths, savingsRates, spendingMatrix, topPayees } from '../lib/reports';
import { downloadText } from '../lib/download';
import { LinesChart } from './charts';
import Collapsible from './Collapsible';
import PageTabs from './PageTabs';
import FlowPanel from './FlowPanel';

const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)'];
const pct = (f: number) => `${f >= 0 ? '+' : '−'}${Math.abs(Math.round(f * 100))}%`;

function Delta({ now, then, label }: { now: number; then: number | null; label: string }) {
  if (then === null) return <div className="tile"><div className="muted">{label}</div><div className="v">—</div></div>;
  const diff = now - then;
  return (
    <div className="tile">
      <div className="muted">{label}</div>
      <div className="v">{formatCents(then)}</div>
      <div className={diff > 0 ? 'neg' : 'pos'} style={{ fontSize: '0.85rem' }}>{diff === 0 ? 'same' : `${diff > 0 ? 'up' : 'down'} ${formatCents(Math.abs(diff))}${then > 0 ? ` (${pct(diff / then)})` : ''}`}</div>
    </div>
  );
}

/** Where the money went: a flow diagram, and month-by-month totals, category trends, what jumped, and top payees. */
export default function ReportsPage() {
  return (
    <>
      <h1>Reports</h1>
      <PageTabs id="reports" tabs={[{ id: 'trends', label: 'Trends', content: <Trends /> }, { id: 'flow', label: 'Flow diagram', content: <FlowPanel /> }]} />
    </>
  );
}

function Trends() {
  const thisMonth = todayISO().slice(0, 7);
  const [end, setEnd] = useState(thisMonth);
  const [payeeRange, setPayeeRange] = useState<'month' | 'year'>('month');
  const txns = useLiveQuery(() => db.txns.toArray(), []) ?? [];
  const categories = useLiveQuery(() => db.categories.toArray(), []) ?? [];

  const months = useMemo(() => lastMonths(end, 13), [end]);
  const view = useMemo(() => months.slice(1), [months]);
  const matrix = useMemo(() => spendingMatrix(txns, categories, months), [txns, categories, months]);
  const stats = useMemo(() => categoryStats(matrix), [matrix]);
  const cmp = compareTotals(matrix);
  const saved = savingsRates(matrix);
  const jumped = jumps(stats);
  const top5 = matrix.cats.slice(0, 5);
  const payees = useMemo(() => topPayees(txns, categories, payeeRange === 'month' ? `${end}-01` : `${months[1]}-01`, `${end}-31`, 10), [txns, categories, payeeRange, end, months]);
  const options = lastMonths(thisMonth, 24).reverse();
  const n = matrix.months.length;

  return (
    <>
      <div className="row spread">
        <h2 style={{ margin: 0 }}>Spending by month</h2>
        <label className="row">Through<select value={end} onChange={(e) => setEnd(e.target.value)}>{options.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></label>
      </div>
      <p className="muted">Where your money went, from the transactions in your accounts. Transfers between accounts are left out; refunds reduce spending.</p>

      <div className="tiles">
        <div className="tile"><div className="muted">Spent in {monthLabel(end)}</div><div className="v">{formatCents(cmp.thisMonth)}</div></div>
        <Delta now={cmp.thisMonth} then={cmp.lastMonth} label="Last month" />
        <Delta now={cmp.thisMonth} then={cmp.sameMonthLastYear} label="Same month last year" />
        <Delta now={cmp.thisMonth} then={cmp.avg3} label="3-month average" />
        <div className="tile"><div className="muted">Saved this month</div><div className={`v ${saved[n - 1] !== null && (saved[n - 1] as number) < 0 ? 'neg' : ''}`}>{saved[n - 1] === null ? '—' : `${Math.round((saved[n - 1] as number) * 100)}%`}</div><div className="muted" style={{ fontSize: '0.8rem' }}>of income</div></div>
      </div>

      <Collapsible id="reports.trend" title="Spending and income by month">
        {view.every((_, i) => matrix.spent[i + 1] === 0 && matrix.income[i + 1] === 0) ? <p className="muted">No transactions in this period yet.</p> : (
          <LinesChart
            title="Last 12 months"
            subtitle="Spending and income"
            xLabels={view.map((m) => `${m}-01`)}
            series={[
              { label: 'Spending', color: 'var(--s2)', values: matrix.spent.slice(1) },
              { label: 'Income', color: 'var(--s3)', values: matrix.income.slice(1) },
            ]}
          />
        )}
        <div className="scroll-x">
          <table>
            <thead><tr><th>Month</th><th className="num">Income</th><th className="num">Spending</th><th className="num">Saved</th><th className="num">Savings rate</th></tr></thead>
            <tbody>
              {[...view].reverse().map((m, k) => {
                const i = n - 1 - k;
                return (
                  <tr key={m}>
                    <td>{monthLabel(m)}</td><td className="num">{formatCents(matrix.income[i])}</td><td className="num">{formatCents(matrix.spent[i])}</td>
                    <td className={`num ${matrix.income[i] - matrix.spent[i] < 0 ? 'neg' : ''}`}>{formatCents(matrix.income[i] - matrix.spent[i])}</td>
                    <td className="num">{saved[i] === null ? '—' : `${Math.round((saved[i] as number) * 100)}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Collapsible>

      <Collapsible id="reports.jumps" title="Where spending jumped">
        {jumped.length === 0 ? <p className="muted">No category is far above its recent average this month.</p> : (
          <ul className="plain">
            {jumped.map((j) => (
              <li key={j.name}><strong>{j.name}</strong>: {formatCents(j.thisMonth)} vs a usual {formatCents(j.avg3)} <span className="neg">({pct(j.vsAvg3 as number)}, {formatCents(j.thisMonth - j.avg3)} more)</span></li>
            ))}
          </ul>
        )}
      </Collapsible>

      <Collapsible id="reports.cats" title="Categories" right={<button className="link" disabled={matrix.cats.length === 0} onClick={() => downloadText(`spending-${months[1]}-to-${end}.csv`, 'text/csv', categoryCsv({ ...matrix, months: view, cats: matrix.cats.map((c) => ({ ...c, byMonth: c.byMonth.slice(1) })), spent: matrix.spent.slice(1), income: matrix.income.slice(1) }))}>download CSV</button>}>
        {top5.length > 0 && (
          <LinesChart title="Top categories over 12 months" xLabels={view.map((m) => `${m}-01`)} series={top5.map((c, i) => ({ label: c.name, color: SERIES[i], values: c.byMonth.slice(1) }))} />
        )}
        {stats.length === 0 ? <p className="muted">No spending yet.</p> : (
          <div className="scroll-x">
            <table>
              <thead><tr><th>Category</th><th className="num">{monthLabel(end).split(' ')[0]}</th><th className="num">Last month</th><th className="num">3-mo avg</th><th className="num">vs avg</th><th className="num">12-mo avg</th></tr></thead>
              <tbody>
                {stats.filter((s) => s.thisMonth > 0 || s.avg3 > 0).map((s) => (
                  <tr key={s.name}>
                    <td>{s.name}</td><td className="num"><strong>{formatCents(s.thisMonth)}</strong></td><td className="num">{formatCents(s.lastMonth)}</td><td className="num">{formatCents(s.avg3)}</td>
                    <td className={`num ${s.vsAvg3 === null ? 'muted' : s.vsAvg3 > 0.1 ? 'neg' : s.vsAvg3 < -0.1 ? 'pos' : ''}`}>{s.vsAvg3 === null ? '—' : pct(s.vsAvg3)}</td>
                    <td className="num">{formatCents(s.avg12)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Collapsible>

      <Collapsible id="reports.payees" title="Top payees" right={
        <div className="seg" role="group" aria-label="Period">
          <button className={payeeRange === 'month' ? 'on' : ''} onClick={() => setPayeeRange('month')}>This month</button>
          <button className={payeeRange === 'year' ? 'on' : ''} onClick={() => setPayeeRange('year')}>12 months</button>
        </div>
      }>
        {payees.length === 0 ? <p className="muted">No spending in this period.</p> : (
          <table>
            <tbody>{payees.map((p) => <tr key={p.payee}><td>{p.payee}</td><td className="muted">{p.count} time{p.count === 1 ? '' : 's'}</td><td className="num">{formatCents(p.cents)}</td></tr>)}</tbody>
          </table>
        )}
      </Collapsible>
    </>
  );
}
