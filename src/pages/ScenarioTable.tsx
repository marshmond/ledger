import { useMemo, useState } from 'react';
import { formatCents } from '../lib/money';
import { downloadText } from '../lib/download';
import type { RetirementResult } from '../lib/retirement';
import { SCENARIO_LABELS, scenarioCsv, scenarioRows, type ScenarioKey, type ScenarioRow } from '../lib/retirementTable';

const KEYS: ScenarioKey[] = ['p10', 'p50', 'p90'];
const dash = <span className="muted">—</span>;
const money = (c: number | null, signed = false) =>
  c === null ? dash : signed && c > 0 ? `+${formatCents(Math.round(c))}` : formatCents(Math.round(c));
/** A zero in a column that does not apply that year reads as a dash, so the table is easy to scan. */
const part = (c: number | null) => (c === null || Math.round(c) === 0 ? dash : formatCents(Math.round(c)));

/** Year-by-year cash flows behind one of the percentile lines on the savings chart. */
export default function ScenarioTable({ result, year0, inflation, sims }: { result: RetirementResult; year0: number; inflation: number; sims: number }) {
  const [key, setKey] = useState<ScenarioKey>('p50');
  const [todays, setTodays] = useState(true);
  const rows = useMemo(
    () => scenarioRows(result.model, result.mc[key], year0, inflation, todays),
    [result, key, year0, inflation, todays],
  );
  const ranOutAt = rows.find((r) => r.status === 'ran-out-this-year');
  const label = SCENARIO_LABELS[key];

  return (
    <>
      <h2>Year by year</h2>
      <p className="muted">
        The cash flows behind the lines on the chart. Pick a line to see each year. These are the chart's percentile lines, not one simulated life: in each year
        the {sims.toLocaleString()} futures are sorted and the 10th, middle, or 90th is shown. The plan's spending, income, and windfalls are the same in every
        future; what differs is the market growth. Growth is what bridges one year to the next, so each row adds up.
      </p>
      <div className="row">
        <div className="seg" role="group" aria-label="Scenario">
          {KEYS.map((k) => <button key={k} className={key === k ? 'on' : ''} onClick={() => setKey(k)}>{SCENARIO_LABELS[k]}</button>)}
        </div>
        <div className="seg" role="group" aria-label="Dollars">
          <button className={todays ? 'on' : ''} onClick={() => setTodays(true)}>Today’s dollars</button>
          <button className={!todays ? 'on' : ''} onClick={() => setTodays(false)}>Future dollars</button>
        </div>
        <button className="link" onClick={() => downloadText(`retirement-${key}-${todays ? 'todays' : 'future'}-dollars.csv`, 'text/csv', scenarioCsv(rows))}>download CSV</button>
      </div>
      {ranOutAt && (
        <p className="warn">In the {label.toLowerCase()} case the money runs out in {ranOutAt.year}. The year it runs out shows the planned amounts, not what was actually paid; later years are blank.</p>
      )}
      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th>Year</th>
              <th className="num">Contributions</th>
              <th className="num">Other income</th>
              <th className="num">Windfalls in</th>
              <th className="num">Spending</th>
              <th className="num">Loan payments</th>
              <th className="num">Tax on withdrawals</th>
              <th className="num">Windfalls out</th>
              <th className="num">Net flow</th>
              <th className="num">{todays ? 'Growth after inflation' : 'Growth'}</th>
              <th className="num">Start balance</th>
              <th className="num">End balance</th>
              <th className="num">Withdrawal rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => <Row key={r.year} r={r} />)}
          </tbody>
        </table>
      </div>
      <p className="muted">
        Withdrawal rate is the money taken out of savings (spending, loan payments, and tax, less other income) as a percent of the start balance. Other income
        above your spending is not added to savings in this model. {todays && 'In today’s dollars each year is divided by the inflation factor, so growth is after inflation.'}
      </p>
    </>
  );
}

function Row({ r }: { r: ScenarioRow }) {
  const out = r.status !== 'ok';
  return (
    <tr className={r.status === 'ran-out' ? 'muted' : undefined}>
      <td>
        {r.year}
        <div className="muted">{r.status === 'ran-out-this-year' ? 'money ran out' : r.status === 'ran-out' ? 'ran out earlier' : r.retirementYear ? `retirement year ${r.retirementYear}` : 'working'}</div>
      </td>
      <td className="num">{part(r.contributions)}</td>
      <td className="num">{part(r.otherIncome)}</td>
      <td className="num">{part(r.windfallIn)}</td>
      <td className="num">{part(r.spending)}</td>
      <td className="num">{part(r.loanPayments)}</td>
      <td className="num">{part(r.tax)}</td>
      <td className="num">{part(r.windfallOut)}</td>
      <td className={`num ${r.netFlow !== null && r.netFlow < 0 ? 'neg' : r.netFlow ? 'pos' : ''}`}>{money(r.netFlow, true)}</td>
      <td className="num">{money(r.growth, true)}</td>
      <td className="num">{formatCents(Math.round(r.startBalance))}</td>
      <td className={`num ${out ? 'neg' : ''}`}><strong>{formatCents(Math.round(r.endBalance))}</strong></td>
      <td className="num">{r.withdrawalPct === null ? dash : `${r.withdrawalPct.toFixed(1)}%`}</td>
    </tr>
  );
}
