import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { formatCents, todayISO } from '../lib/money';
import { monthLabel } from '../lib/dates';
import { DEFAULT_FORECAST, loadForecast, type ForecastSettings } from '../lib/forecastLive';
import { LinesChart } from './charts';
import Collapsible from './Collapsible';
import { MoneyField } from './fields';

const KIND_LABEL: Record<string, string> = { income: 'Pay', bill: 'Bill', loan: 'Loan', tax: 'Tax', spending: 'Spending', oneoff: 'One-off' };
const fmtDay = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Will you have the cash? A day-by-day projection of checking and savings from your pay, bills, loans, taxes, and spending. */
export default function ForecastPage() {
  const today = todayISO();
  const f = useLiveQuery(() => loadForecast(db, today), [today]);
  const saved = useLiveQuery(() => db.settings.get('forecast'), []);
  const s: ForecastSettings = { ...DEFAULT_FORECAST, ...((saved?.value as Partial<ForecastSettings>) ?? {}) };
  const setS = (patch: Partial<ForecastSettings>) => db.settings.put({ key: 'forecast', value: { ...s, ...patch } });
  const [oDate, setODate] = useState(today);
  const [oLabel, setOLabel] = useState('');
  const [oAmt, setOAmt] = useState(0);
  const [oDir, setODir] = useState<'out' | 'in'>('out');

  if (!f) return <h1>Cash-flow forecast</h1>;
  const { input, result } = f;
  const below = result.firstBelow;
  const thresholdLine = result.months.map(() => s.thresholdCents);
  const upcoming = result.events.slice(0, 24);

  return (
    <>
      <h1>Cash-flow forecast</h1>
      <p className="muted">
        Will you have the cash? This starts from your checking{s.includeSavings ? ' and savings' : ''} balance and adds your paychecks, scheduled bills, loan payments, taxes, and an estimate of everyday spending, day by day.
        It only knows what you have entered, so keep <Link to="/scheduled">Scheduled</Link> and <Link to="/income">Income</Link> up to date.
      </p>

      {f.cashAccounts === 0 && <p className="warn">No checking or savings accounts yet. Add them on the <Link to="/accounts">Accounts</Link> page.</p>}

      {below ? (
        <div className="card rta-neg"><strong className="neg">Cash may drop below {formatCents(s.thresholdCents)} on {fmtDay(below.date)}</strong> (to {formatCents(below.balanceCents)}). Adjust a bill, move money in, or plan around it.</div>
      ) : (
        <p className="ok">Your balance stays above {formatCents(s.thresholdCents)} for the next {s.months} months.</p>
      )}

      <div className="tiles">
        <div className="tile"><div className="muted">Cash today</div><div className="v">{formatCents(input.startCents)}</div></div>
        <div className="tile"><div className="muted">Lowest point</div><div className={`v ${result.low.balanceCents < s.thresholdCents ? 'neg' : ''}`}>{formatCents(result.low.balanceCents)}</div><div className="muted" style={{ fontSize: '0.8rem' }}>{fmtDay(result.low.date)}</div></div>
        <div className="tile"><div className="muted">In {s.months} months</div><div className="v">{formatCents(result.endCents)}</div></div>
        <div className="tile"><div className="muted">Money in</div><div className="v pos">{formatCents(result.totalIn)}</div></div>
        <div className="tile"><div className="muted">Money out</div><div className="v">{formatCents(result.totalOut)}</div></div>
      </div>

      <LinesChart
        title="Balance at the end of each month"
        subtitle={`Dashed line: your warning level (${formatCents(s.thresholdCents)})`}
        xLabels={result.months.map((m) => `${m.month}-01`)}
        series={[
          { label: 'End of month', color: 'var(--s1)', values: result.months.map((m) => Math.max(0, m.endCents)) },
          { label: 'Lowest in month', color: 'var(--s2)', values: result.months.map((m) => Math.max(0, m.lowCents)), dashed: true },
          { label: 'Warning level', color: 'var(--s4)', values: thresholdLine, dashed: true },
        ]}
      />
      {result.months.some((m) => m.endCents < 0 || m.lowCents < 0) && <p className="warn">The chart shows $0 for any month the balance goes negative; see the table for the exact amounts.</p>}

      <Collapsible id="forecast.months" title="Month by month">
        <div className="scroll-x">
          <table>
            <thead><tr><th>Month</th><th className="num">Start</th><th className="num">Pay</th><th className="num">Bills</th><th className="num">Loans</th><th className="num">Taxes</th><th className="num">Everyday</th><th className="num">One-off</th><th className="num">End</th><th className="num">Lowest</th></tr></thead>
            <tbody>
              {result.months.map((m) => (
                <tr key={m.month}>
                  <td>{monthLabel(m.month)}</td><td className="num">{formatCents(m.startCents)}</td><td className="num pos">{m.incomeCents ? formatCents(m.incomeCents) : '—'}</td>
                  <td className="num">{m.billsCents ? formatCents(m.billsCents) : '—'}</td><td className="num">{m.loansCents ? formatCents(m.loansCents) : '—'}</td>
                  <td className="num">{m.taxesCents ? formatCents(m.taxesCents) : '—'}</td><td className="num">{m.spendingCents ? formatCents(m.spendingCents) : '—'}</td><td className="num">{m.oneOffCents ? formatCents(m.oneOffCents) : '—'}</td>
                  <td className="num"><strong>{formatCents(m.endCents)}</strong></td>
                  <td className={`num ${m.lowCents < s.thresholdCents ? 'neg' : ''}`}>{formatCents(m.lowCents)}<div className="muted" style={{ fontSize: '0.7rem' }}>{fmtDay(m.lowDate)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Collapsible>

      <Collapsible id="forecast.next" title="The next 24 items">
        <div className="scroll-x">
          <table>
            <tbody>
              {upcoming.map((e, i) => (
                <tr key={i}>
                  <td>{fmtDay(e.date)}</td><td><span className="badge">{KIND_LABEL[e.kind]}</span></td><td>{e.label}</td>
                  <td className={`num ${e.cents > 0 ? 'pos' : ''}`}>{formatCents(e.cents)}</td><td className={`num muted ${e.balanceCents < s.thresholdCents ? 'neg' : ''}`}>{formatCents(e.balanceCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Collapsible>

      <Collapsible id="forecast.assumptions" title="Assumptions">
        <div className="grid">
          <label className="f">Look ahead
            <select value={s.months} onChange={(e) => setS({ months: Number(e.target.value) })}>{[6, 12, 18, 24].map((m) => <option key={m} value={m}>{m} months</option>)}</select>
          </label>
          <MoneyField key={`e${s.everydayCents}`} label={`Everyday spending per month (estimate ${formatCents(f.estimateCents)})`} cents={s.everydayCents ?? f.estimateCents} onChange={(c) => setS({ everydayCents: c })} />
          <MoneyField key={`o${s.otherIncomeMonthlyCents}`} label="Other income per month" cents={s.otherIncomeMonthlyCents} onChange={(c) => setS({ otherIncomeMonthlyCents: c })} />
          <MoneyField key={`t${s.thresholdCents}`} label="Warn me below" cents={s.thresholdCents} onChange={(c) => setS({ thresholdCents: c })} />
        </div>
        {s.everydayCents !== null && <button className="link" onClick={() => setS({ everydayCents: null })}>use the estimate from my history</button>}
        <div className="checks wrap">
          <label className="chk"><input type="checkbox" checked={s.includeSavings} onChange={(e) => setS({ includeSavings: e.target.checked })} /> Count savings accounts as cash I can spend</label>
          <label className="chk"><input type="checkbox" checked={s.includeTaxes} onChange={(e) => setS({ includeTaxes: e.target.checked })} /> Include tax due (or a refund) when I file next spring</label>
        </div>
        <p className="muted">
          Everyday spending is the average of your last three full months, leaving out bills posted from Scheduled and loan interest and escrow (they are forecast on their own). Card
          payments are not counted separately, because the card spending is already in that average. Pay comes from the Income tab; shares you keep from a stock vest are not cash.
        </p>
      </Collapsible>

      <Collapsible id="forecast.oneoffs" title="One-off items">
        <p className="muted">A vacation, a car repair, a bonus you expect, a tax payment: anything dated that is not already scheduled.</p>
        <div className="row">
          <label className="f">Date<input type="date" value={oDate} onChange={(e) => setODate(e.target.value)} /></label>
          <label className="f">What<input value={oLabel} onChange={(e) => setOLabel(e.target.value)} placeholder="Summer trip" /></label>
          <MoneyField key={s.oneOffs.length} label="Amount" cents={oAmt} onChange={setOAmt} width={110} />
          <div className="seg" role="group" aria-label="Direction">
            <button className={oDir === 'out' ? 'on' : ''} onClick={() => setODir('out')}>Spend</button>
            <button className={oDir === 'in' ? 'on' : ''} onClick={() => setODir('in')}>Receive</button>
          </div>
          <button
            disabled={!oLabel.trim() || oAmt <= 0 || !oDate}
            onClick={() => { setS({ oneOffs: [...s.oneOffs, { id: crypto.randomUUID(), date: oDate, label: oLabel.trim(), cents: oDir === 'out' ? -oAmt : oAmt }] }); setOLabel(''); setOAmt(0); }}
          >Add</button>
        </div>
        {s.oneOffs.length > 0 && (
          <table><tbody>
            {[...s.oneOffs].sort((a, b) => a.date.localeCompare(b.date)).map((o) => (
              <tr key={o.id}><td>{o.date}</td><td>{o.label}</td><td className={`num ${o.cents > 0 ? 'pos' : ''}`}>{formatCents(o.cents)}</td><td><button className="link danger" onClick={() => setS({ oneOffs: s.oneOffs.filter((x) => x.id !== o.id) })}>delete</button></td></tr>
            ))}
          </tbody></table>
        )}
      </Collapsible>
    </>
  );
}
