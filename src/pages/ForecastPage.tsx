import { useState } from 'react';
import { Link } from '../core/router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { formatCents, todayISO } from '../lib/money';
import { monthLabel } from '../lib/dates';
import { DEFAULT_FORECAST, loadForecast, type ForecastSettings } from '../lib/forecastLive';
import { LinesChart } from './charts';
import Collapsible from './Collapsible';
import { MoneyField } from './fields';
import { Banner, PageHeader } from '../ui/components';
import './analysis.css';

const KIND_LABEL: Record<string, string> = { income: 'Pay', bill: 'Bill', loan: 'Loan', tax: 'Tax', spending: 'Spending', oneoff: 'One-off' };
const fmtDay = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Will you have the cash? A day-by-day projection of checking and savings from your pay, bills, loans, taxes, and spending. */
export default function ForecastPage() {
  const today = todayISO();
  const f = useLiveQuery(() => loadForecast(db, today), [today]);
  const saved = useLiveQuery(() => db.settings.get('forecast'), []);
  const s: ForecastSettings = { ...DEFAULT_FORECAST, ...((saved?.value as Partial<ForecastSettings>) ?? {}) };
  const setS = (patch: Partial<ForecastSettings>) => db.settings.put({ key: 'forecast', value: { ...s, ...patch } });
  const people = useLiveQuery(() => db.people.toArray(), []) ?? [];
  const vestOwners = new Set((useLiveQuery(() => db.rsuVests.toArray(), []) ?? []).map((v) => v.personId));
  const ignored = s.ignoreVestsFor ?? [];
  const [oDate, setODate] = useState(today);
  const [oLabel, setOLabel] = useState('');
  const [oAmt, setOAmt] = useState(0);
  const [oDir, setODir] = useState<'out' | 'in'>('out');

  if (!f) return <PageHeader title="Cash-flow forecast" description="Will you have the cash? Your balance, day by day." eyebrow="Money" />;
  const { input, result } = f;
  const level = f.thresholdCents;
  const below = result.firstBelow;
  const thresholdLine = result.months.map(() => level);
  const upcoming = result.events.slice(0, 24);
  const goesNegative = result.months.some((m) => m.endCents < 0 || m.lowCents < 0);

  return (
    <div className="an-page">
      <PageHeader eyebrow="Money" title="Cash-flow forecast" description="Will you have the cash? Your balance, day by day." about={<>Will you have the cash? This starts from your checking{s.includeSavings ? ' and savings' : ''} balance and adds your paychecks, scheduled bills, loan payments, taxes, and an estimate of everyday spending, day by day.
        It only knows what you have entered, so keep <Link to="/scheduled">Scheduled</Link> and <Link to="/income">Income</Link> up to date.</>} />

      {f.cashAccounts === 0 && <p className="warn">No checking or savings accounts yet. Add them on the <Link to="/accounts">Accounts</Link> page.</p>}

      <section className="an-hero" aria-label="Forecast summary">
        <div>
          <div className="an-hero-label">In {s.months} months <span className="an-kind an-kind--projected">Projected</span></div>
          <div className="an-hero-amt">{formatCents(result.endCents)}</div>
          <p className="an-hero-msg">A projection of your checking{s.includeSavings ? ' and savings' : ''} cash from what you have entered. It is an estimate, not a promise. {below ? '' : <>Your balance stays above <strong>{formatCents(level)}</strong> for the next {s.months} months.</>}</p>
        </div>
        <dl className="an-hero-figs">
          <div><dt>Cash today <span className="an-kind">Actual</span></dt><dd>{formatCents(input.startCents)}</dd></div>
          <div><dt>Lowest point <span className="an-kind an-kind--projected">Projected</span></dt><dd>{formatCents(result.low.balanceCents)}<span className="an-sub">{fmtDay(result.low.date)}</span></dd></div>
          <div><dt>Money in <span className="an-kind an-kind--projected">Projected</span></dt><dd>{formatCents(result.totalIn)}</dd></div>
          <div><dt>Money out <span className="an-kind an-kind--projected">Projected</span></dt><dd>{formatCents(result.totalOut)}</dd></div>
        </dl>
      </section>

      {below && (
        <Banner level={result.low.balanceCents < 0 ? 'bad' : 'warn'} title={`Cash may drop below ${formatCents(level)} on ${fmtDay(below.date)}`}>
          (to {formatCents(below.balanceCents)}). Adjust a bill, move money in, or plan around it.
        </Banner>
      )}

      <section aria-label="Assumptions in use" className="an-stack-col">
        <div className="an-head" style={{ marginBottom: 0 }}>
          <h2 className="an-h2">Assumptions in use <span className="an-kind an-kind--assumption">Your assumptions</span></h2>
        </div>
        <ul className="an-chipline">
          <li className="an-chip">Looking ahead <b>{s.months} months</b></li>
          <li className="an-chip">Everyday spending <b>{formatCents(s.everydayCents ?? f.estimateCents)}</b> a month{s.everydayCents === null ? ' (estimated from your history)' : ' (your number)'}</li>
          <li className="an-chip">Other income <b>{formatCents(s.otherIncomeMonthlyCents)}</b> a month</li>
          <li className="an-chip">Warning level <b>{formatCents(level)}</b></li>
          <li className="an-chip">Savings accounts <b>{s.includeSavings ? 'counted as cash' : 'not counted'}</b></li>
          <li className="an-chip">Tax due or refund <b>{s.includeTaxes ? 'included' : 'not included'}</b></li>
        </ul>
      </section>

      <div className="an-stack-col">
        <div className="an-tools">
          <label className="f an-ctl">Look ahead
            <select value={s.months} onChange={(e) => setS({ months: Number(e.target.value) })}>{[6, 12, 18, 24].map((m) => <option key={m} value={m}>{m} months</option>)}</select>
          </label>
          <span className="an-note" style={{ margin: 0 }}>Everything after today is projected. Months below the zero line are projected to run out of cash.</span>
        </div>
        <LinesChart
          title="Balance at the end of each month"
          subtitle={`Projected. Dashed lines: the lowest point in each month and your warning level (${formatCents(level)})`}
          xLabels={result.months.map((m) => `${m.month}-01`)}
          fit
          allowNegative
          precise
          axis="month"
          series={[
            { label: 'End of month', color: 'var(--s1)', values: result.months.map((m) => m.endCents) },
            { label: 'Lowest in month', color: 'var(--s2)', values: result.months.map((m) => m.lowCents), dashed: true },
            { label: 'Warning level', color: 'var(--s4)', values: thresholdLine, dashed: true },
          ]}
        />
        {goesNegative && <p className="an-note" style={{ margin: 0 }}>The chart draws the exact projected balance, including months below zero; the table below has the same amounts.</p>}
      </div>

      <Collapsible id="forecast.months" title="Month by month">
        <div className="an-tablewrap">
          <table className="an-table an-matrix">
            <thead><tr><th>Month</th><th className="num">Start</th><th className="num">Pay</th><th className="num">Bills</th><th className="num">Loans</th><th className="num">Taxes</th><th className="num">Everyday</th><th className="num">One-off</th><th className="num">End</th><th className="num">Lowest</th></tr></thead>
            <tbody>
              {result.months.map((m) => (
                <tr key={m.month}>
                  <td className="an-lead"><strong>{monthLabel(m.month)}</strong></td>
                  <td className="num" data-label="Start">{formatCents(m.startCents)}</td>
                  <td className="num" data-label="Pay">{m.incomeCents ? formatCents(m.incomeCents) : '—'}</td>
                  <td className="num" data-label="Bills">{m.billsCents ? formatCents(m.billsCents) : '—'}</td>
                  <td className="num" data-label="Loans">{m.loansCents ? formatCents(m.loansCents) : '—'}</td>
                  <td className="num" data-label="Taxes">{m.taxesCents ? formatCents(m.taxesCents) : '—'}</td>
                  <td className="num" data-label="Everyday">{m.spendingCents ? formatCents(m.spendingCents) : '—'}</td>
                  <td className="num" data-label="One-off">{m.oneOffCents ? formatCents(m.oneOffCents) : '—'}</td>
                  <td className="num" data-label="End"><strong>{formatCents(m.endCents)}</strong></td>
                  <td className="num" data-label="Lowest">{formatCents(m.lowCents)}<span className="an-sub">{fmtDay(m.lowDate)}{m.lowCents < level ? ' · below warning level' : ''}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="an-scrollhint">Scroll sideways for more columns.</p>
        </div>
      </Collapsible>

      <Collapsible id="forecast.next" title="The next 24 items">
        <div className="an-tablewrap">
          <table className="an-table an-matrix">
            <thead><tr><th>Date</th><th>Type</th><th>What</th><th className="num">Amount</th><th className="num">Balance after</th></tr></thead>
            <tbody>
              {upcoming.map((e, i) => (
                <tr key={i}>
                  <td data-label="Date">{fmtDay(e.date)}</td><td data-label="Type"><span className="badge">{KIND_LABEL[e.kind]}</span></td><td className="an-full an-wrap">{e.label}</td>
                  <td className="num" data-label="Amount">{formatCents(e.cents)}</td><td className="num" data-label="Balance after">{formatCents(e.balanceCents)}{e.balanceCents < level ? <span className="an-sub">below warning level</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Collapsible>

      <Collapsible id="forecast.assumptions" title="Assumptions">
        <div className="an-form">
          <MoneyField key={`e${s.everydayCents}`} label={`Everyday spending per month (estimate ${formatCents(f.estimateCents)})`} cents={s.everydayCents ?? f.estimateCents} onChange={(c) => setS({ everydayCents: c })} />
          <MoneyField key={`o${s.otherIncomeMonthlyCents}`} label="Other income per month" cents={s.otherIncomeMonthlyCents} onChange={(c) => setS({ otherIncomeMonthlyCents: c })} />
          <MoneyField key={`t${s.thresholdCents}`} label={f.floorCents > 0 ? `Warn me below (not used: your account minimums add up to ${formatCents(f.floorCents)})` : "Warn me below"} cents={s.thresholdCents} onChange={(c) => setS({ thresholdCents: c })} />
        </div>
        {s.everydayCents !== null && <button className="link" onClick={() => setS({ everydayCents: null })}>use the estimate from my history</button>}
        <div className="an-checks">
          <label className="chk"><input type="checkbox" checked={s.includeSavings} onChange={(e) => setS({ includeSavings: e.target.checked })} /> Count savings accounts as cash I can spend</label>
          <label className="chk"><input type="checkbox" checked={s.includeTaxes} onChange={(e) => setS({ includeTaxes: e.target.checked })} /> Include tax due (or a refund) when I file next spring</label>
          {people.filter((p) => vestOwners.has(p.id!)).map((p) => (
            <label className="chk" key={p.id}><input type="checkbox" checked={!ignored.includes(p.id!)} onChange={(e) => setS({ ignoreVestsFor: e.target.checked ? ignored.filter((x) => x !== p.id) : [...ignored, p.id!] })} /> Count {p.name}'s stock vests as cash coming in</label>
          ))}
        </div>
        <p className="an-note">
          Everyday spending is the average of your last three full months, leaving out bills posted from Scheduled and loan interest and escrow (they are forecast on their own). Card
          payments are not counted separately, because the card spending is already in that average. Pay comes from the Income tab; shares you keep from a stock vest are not cash.
        </p>
      </Collapsible>

      <Collapsible id="forecast.oneoffs" title="One-off items">
        <p className="an-note" style={{ marginTop: 0 }}>A vacation, a car repair, a bonus you expect, a tax payment: anything dated that is not already scheduled.</p>
        <div className="an-form an-form--wide" style={{ marginTop: 'var(--sp-3)' }}>
          <label className="f">Date<input type="date" value={oDate} onChange={(e) => setODate(e.target.value)} /></label>
          <label className="f">What<input value={oLabel} onChange={(e) => setOLabel(e.target.value)} placeholder="Summer trip" /></label>
          <MoneyField key={s.oneOffs.length} label="Amount" cents={oAmt} onChange={setOAmt} width={110} />
          <div className="seg" role="group" aria-label="Direction">
            <button className={oDir === 'out' ? 'on' : ''} onClick={() => setODir('out')}>Spend</button>
            <button className={oDir === 'in' ? 'on' : ''} onClick={() => setODir('in')}>Receive</button>
          </div>
        </div>
        <div className="an-actions">
          <button
            className="primary"
            disabled={!oLabel.trim() || oAmt <= 0 || !oDate}
            onClick={() => { setS({ oneOffs: [...s.oneOffs, { id: crypto.randomUUID(), date: oDate, label: oLabel.trim(), cents: oDir === 'out' ? -oAmt : oAmt }] }); setOLabel(''); setOAmt(0); }}
          >Add</button>
        </div>
        {s.oneOffs.length > 0 && (
          <div className="an-tablewrap" style={{ marginTop: 'var(--sp-3)' }}>
            <table className="an-table an-stack">
              <thead><tr><th>Date</th><th>What</th><th className="num">Amount</th><th /></tr></thead>
              <tbody>
                {[...s.oneOffs].sort((a, b) => a.date.localeCompare(b.date)).map((o) => (
                  <tr key={o.id}><td data-label="Date">{o.date}</td><td data-label="What" className="an-wrap">{o.label}</td><td className="num" data-label="Amount">{formatCents(o.cents)}</td><td className="an-cell-act"><button className="link danger" onClick={() => setS({ oneOffs: s.oneOffs.filter((x) => x.id !== o.id) })}>delete</button></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Collapsible>
    </div>
  );
}
