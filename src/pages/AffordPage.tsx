import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { formatCents, todayISO } from '../lib/money';
import { addDays, addMonths } from '../lib/dates';
import { buildIncomeModel } from '../lib/income';
import { loadNetWorth } from '../lib/netWorthLive';
import { loadForecast } from '../lib/forecastLive';
import { runForecast } from '../lib/forecast';
import { loanView, nextRow } from '../lib/loanSchedule';
import { ledgerBalance } from '../lib/netWorth';
import { estimateEveryday } from '../lib/forecastLive';
import { evaluatePurchase, maxAffordablePrice, rentVsBuy, type AffordInput, type PurchaseKind } from '../lib/afford';
import { LinesChart } from './charts';
import { MoneyField, NumField } from './fields';
import PageTabs from './PageTabs';
import { PageHeader } from '../ui/components';

const KIND: Record<PurchaseKind, string> = { house: 'A house', car: 'A car', other: 'Something else' };
const LEVEL = { ok: 'ok', caution: 'info', warn: 'todo' } as const;
const MARK = { ok: '✓', caution: 'i', warn: '!' } as const;

/** Can I afford it? A house, a car, or any big purchase checked against guidelines, your cash, your forecast, and renting. */
export default function AffordPage() {
  const today = todayISO();
  const year = Number(today.slice(0, 4));
  const people = useLiveQuery(() => db.people.toArray(), []) ?? [];
  const profiles = useLiveQuery(() => db.incomeProfiles.toArray(), []) ?? [];
  const bonuses = useLiveQuery(() => db.bonuses.toArray(), []) ?? [];
  const taxSettings = useLiveQuery(() => db.taxSettings.toArray(), []) ?? [];
  const accounts = useLiveQuery(() => db.accounts.toArray(), []) ?? [];
  const txns = useLiveQuery(() => db.txns.toArray(), []) ?? [];
  const categories = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const loans = useLiveQuery(() => db.loans.toArray(), []) ?? [];
  const rates = useLiveQuery(() => db.loanRates.toArray(), []) ?? [];
  const events = useLiveQuery(() => db.loanEvents.toArray(), []) ?? [];
  const nw = useLiveQuery(() => loadNetWorth(db, today), [today]);
  const base = useLiveQuery(() => loadForecast(db, today), [today]);

  // what we know about you
  const income = useMemo(() => buildIncomeModel(year, people, profiles, bonuses, taxSettings.find((t) => t.year === year)), [year, people, profiles, bonuses, taxSettings]);
  const grossMonthly = Math.round(income.years.reduce((a, y) => a + y.totals.gross - y.totals.rsuGross, 0) / 12);
  const netMonthly = Math.round(income.years.reduce((a, y) => a + y.totals.net, 0) / 12);
  const loanPay = useMemo(
    () => loans.filter((l) => !l.scenario).reduce((a, l) => {
      const v = loanView(l, rates.filter((r) => r.loanId === l.id), events.filter((e) => e.loanId === l.id));
      const r = v.schedule.rows.length ? nextRow(v.schedule, today) : null;
      return a + (r ? r.payment : 0);
    }, 0),
    [loans, rates, events, today],
  );
  const cardMin = accounts.filter((a) => !a.closed && a.kind === 'credit_card').reduce((a, c) => { const owed = Math.max(0, -ledgerBalance(c, txns)); return a + (owed > 0 ? Math.max(2500, Math.round(owed * 0.02)) : 0); }, 0);
  const spendEst = useMemo(() => estimateEveryday(txns, categories, today), [txns, categories, today]);

  const [kind, setKind] = useState<PurchaseKind>('house');
  const [price, setPrice] = useState(50000000);
  const [downPct, setDownPct] = useState(20);
  const [apr, setApr] = useState(6.5);
  const [term, setTerm] = useState(360);
  const [taxPct, setTaxPct] = useState(1.2);
  const [insurance, setInsurance] = useState(15000);
  const [maintPct, setMaintPct] = useState(1);
  const [hoa, setHoa] = useState(0);
  const [carExtra, setCarExtra] = useState(35000);
  const [closingPct, setClosingPct] = useState(3);
  const [oneTime, setOneTime] = useState(250000);
  const [other, setOther] = useState(0);
  const [income2, setIncome2] = useState<number | null>(null);
  const [spend2, setSpend2] = useState<number | null>(null);
  const [date, setDate] = useState(addDays(today, 60));

  const setKindAndDefaults = (k: PurchaseKind) => {
    setKind(k);
    if (k === 'house') { setPrice(50000000); setApr(6.5); setTerm(360); setDownPct(20); }
    if (k === 'car') { setPrice(4000000); setApr(7); setTerm(60); setDownPct(20); }
    if (k === 'other') { setPrice(1000000); setApr(0); setTerm(12); setDownPct(100); }
  };

  const gross = income2 ?? grossMonthly;
  const spending = spend2 ?? spendEst;
  const build = (p: number): AffordInput => {
    const extra = kind === 'house' ? Math.round((p * taxPct) / 1200 + insurance + (p * maintPct) / 1200 + hoa) : kind === 'car' ? carExtra : 0;
    const one = kind === 'house' ? Math.round((p * closingPct) / 100) : oneTime;
    return {
      kind, priceCents: p, downPaymentCents: Math.round((p * downPct) / 100), aprPct: apr, termMonths: term, monthlyExtraCents: extra, oneTimeCents: one,
      grossMonthlyIncomeCents: gross, existingDebtMonthlyCents: loanPay + cardMin + other, cashCents: nw?.cash ?? 0, monthlyEssentialCents: spending, monthlySavingsCents: netMonthly - spending,
    };
  };
  const input = build(price);
  const res = evaluatePurchase(input, formatCents);
  const max = kind === 'other' ? null : maxAffordablePrice(build);

  // what the purchase does to your cash forecast
  const withBuy = useMemo(() => {
    if (!base) return null;
    const horizon = base.input.months;
    const monthly: { date: string; label: string; cents: number }[] = [];
    for (let k = 1; k <= horizon; k++) {
      const d = addMonths(`${date.slice(0, 7)}-01`, k);
      monthly.push({ date: d, label: 'New payment and costs', cents: -res.monthlyCostCents });
    }
    const i = { ...base.input, oneOffs: [...base.input.oneOffs, { date, label: 'Purchase: up front', cents: -res.upfrontCents }], scheduled: [...base.input.scheduled, ...(res.monthlyCostCents > 0 ? monthly : [])] };
    return runForecast(i, base.settings.thresholdCents);
  }, [base, date, res.monthlyCostCents, res.upfrontCents]);

  // rent or buy
  const [rent, setRent] = useState(280000);
  const [rentGrowth, setRentGrowth] = useState(3);
  const [appr, setAppr] = useState(3);
  const [ret, setRet] = useState(6);
  const [years, setYears] = useState(10);
  const [sellPct, setSellPct] = useState(6);
  const rb = rentVsBuy({
    priceCents: price, downPaymentCents: Math.round((price * downPct) / 100), aprPct: apr, termMonths: term, closingPct, sellingPct: sellPct, propertyTaxPct: taxPct, insuranceMonthlyCents: insurance,
    maintenancePct: maintPct, hoaMonthlyCents: hoa, appreciationPct: appr, rentMonthlyCents: rent, rentGrowthPct: rentGrowth, investReturnPct: ret, years,
  });

  const afford = (
    <>
      <div className="card">
        <div className="row">
          <label className="f">What are you buying?
            <select value={kind} onChange={(e) => setKindAndDefaults(e.target.value as PurchaseKind)}>{(Object.keys(KIND) as PurchaseKind[]).map((k) => <option key={k} value={k}>{KIND[k]}</option>)}</select>
          </label>
          <MoneyField key={`p${kind}`} label="Price" cents={price} onChange={setPrice} width={140} />
          <NumField label={kind === 'other' ? 'Paid in cash %' : 'Down payment %'} value={downPct} step={1} width={90} onChange={(n) => setDownPct(Math.max(0, Math.min(100, n)))} />
          {kind !== 'other' && <NumField label="Interest rate %" value={apr} step={0.125} width={90} onChange={setApr} />}
          {kind !== 'other' && <NumField label="Loan term (months)" value={term} step={12} width={100} onChange={(n) => setTerm(Math.max(1, Math.round(n)))} />}
          <label className="f">Buying around<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        {kind === 'house' && (
          <div className="row">
            <NumField label="Property tax % of price / yr" value={taxPct} step={0.1} width={110} onChange={setTaxPct} />
            <MoneyField label="Home insurance / month" cents={insurance} onChange={setInsurance} width={110} />
            <NumField label="Upkeep % of price / yr" value={maintPct} step={0.25} width={110} onChange={setMaintPct} />
            <MoneyField label="HOA / month" cents={hoa} onChange={setHoa} width={100} />
            <NumField label="Closing costs %" value={closingPct} step={0.5} width={100} onChange={setClosingPct} />
          </div>
        )}
        {kind === 'car' && (
          <div className="row">
            <MoneyField label="Insurance, fuel, upkeep / month" cents={carExtra} onChange={setCarExtra} width={140} />
            <MoneyField label="Tax, title, fees" cents={oneTime} onChange={setOneTime} width={110} />
          </div>
        )}
        {kind === 'other' && <p className="muted">Enter the price and the share you would pay in cash; the checks below show what is left.</p>}
        <details>
          <summary className="muted">Your numbers (filled in from the app, change them if they are off)</summary>
          <div className="row" style={{ marginTop: 6 }}>
            <MoneyField key={`g${grossMonthly}`} label="Gross income / month" cents={gross} onChange={setIncome2} width={120} />
            <MoneyField key={`s${spendEst}`} label="Spending / month" cents={spending} onChange={setSpend2} width={120} />
            <MoneyField label="Other debt payments / month" cents={other} onChange={setOther} width={120} />
          </div>
          <p className="muted">
            Loans and card minimums already counted: {formatCents(loanPay + cardMin)} a month. Cash available: {formatCents(nw?.cash ?? 0)}. Take-home about {formatCents(netMonthly)} a month.
            {grossMonthly === 0 && <> Set up income on the <Link to="/income">Income</Link> tab to fill in your income.</>}
          </p>
        </details>
      </div>

      <div className="tiles">
        <div className="tile"><div className="muted">Loan</div><div className="v">{formatCents(res.loanCents)}</div></div>
        <div className="tile"><div className="muted">Payment (principal + interest)</div><div className="v">{formatCents(res.paymentCents)}</div></div>
        <div className="tile"><div className="muted">Total monthly cost</div><div className="v">{formatCents(res.monthlyCostCents)}</div></div>
        <div className="tile"><div className="muted">Cash needed up front</div><div className="v">{formatCents(res.upfrontCents)}</div></div>
      </div>

      <ul className="checklist">
        {res.checks.map((c) => (
          <li key={c.id} className={`check ${LEVEL[c.level]}`}>
            <span className="mark" aria-hidden="true">{MARK[c.level]}</span>
            <div><strong>{c.title}</strong><div className="muted">{c.detail}</div></div>
          </li>
        ))}
      </ul>

      {max && (
        <div className="card">
          <strong>The most you could afford by the usual guidelines</strong>
          <div className="hero" style={{ fontSize: '1.6rem' }}>{formatCents(max.priceCents)}</div>
          <p className="muted">
            {max.priceCents === 0 ? 'Needs your income first.' : kind === 'house'
              ? `Keeps housing at 28% of gross income and all debts at 36% (${max.limit === 'dti' ? 'your other debts are what limits it' : 'the housing cost is what limits it'}), with the same ${downPct}% down. Lenders may approve more; that does not mean it is comfortable.`
              : 'Keeps all car costs at 15% of gross income and all debts at 36%.'}
          </p>
        </div>
      )}

      {withBuy && base && (
        <div className="card">
          <strong>What it does to your cash forecast</strong>
          <p className="muted">Using your forecast for the next {base.input.months} months, with the up-front cost on {date} and the monthly cost starting the month after.</p>
          <table><tbody>
            <tr><td>Lowest balance without it</td><td className="num">{formatCents(base.result.low.balanceCents)}</td></tr>
            <tr><td><strong>Lowest balance with it</strong></td><td className={`num ${withBuy.low.balanceCents < base.settings.thresholdCents ? 'neg' : ''}`}><strong>{formatCents(withBuy.low.balanceCents)}</strong> <span className="muted">on {withBuy.low.date}</span></td></tr>
            <tr><td>Balance at the end, without / with</td><td className="num">{formatCents(base.result.endCents)} / {formatCents(withBuy.endCents)}</td></tr>
          </tbody></table>
          {withBuy.firstBelow
            ? <p className="warn">Your cash would fall below your {formatCents(base.settings.thresholdCents)} warning level on {withBuy.firstBelow.date}.</p>
            : <p className="ok">Your cash stays above your {formatCents(base.settings.thresholdCents)} warning level.</p>}
          <LinesChart
            title="Cash at the end of each month"
            xLabels={withBuy.months.map((m) => `${m.month}-01`)}
            series={[
              { label: 'Without the purchase', color: 'var(--s3)', values: base.result.months.map((m) => Math.max(0, m.endCents)) },
              { label: 'With the purchase', color: 'var(--s2)', values: withBuy.months.map((m) => Math.max(0, m.endCents)) },
            ]}
          />
        </div>
      )}
    </>
  );

  const compare = (
    <>
      <p className="muted">
        Buying uses the house price, down payment, and costs from the first tab. Renting means paying rent and investing the down payment and closing money; whichever path costs
        less each month invests the difference. At the end the house is sold. Mortgage-interest and property-tax deductions are not included, and appreciation and returns are guesses.
      </p>
      <div className="card">
        <div className="row">
          <MoneyField label="Rent per month" cents={rent} onChange={setRent} width={120} />
          <NumField label="Rent rises % / yr" value={rentGrowth} step={0.5} width={100} onChange={setRentGrowth} />
          <NumField label="Home price rises % / yr" value={appr} step={0.5} width={110} onChange={setAppr} />
          <NumField label="Investments return % / yr (after tax)" value={ret} step={0.5} width={130} onChange={setRet} />
          <NumField label="Years" value={years} step={1} width={70} onChange={(n) => setYears(Math.max(1, Math.min(40, Math.round(n))))} />
          <NumField label="Selling costs %" value={sellPct} step={0.5} width={100} onChange={setSellPct} />
        </div>
      </div>
      <div className="tiles">
        <div className="tile"><div className="muted">Owning costs per month (first month)</div><div className="v">{formatCents(rb.monthlyOwnCostCents)}</div></div>
        <div className="tile"><div className="muted">Rent per month</div><div className="v">{formatCents(rb.monthlyRentCents)}</div></div>
        <div className="tile"><div className="muted">After {years} years: buying</div><div className="v">{formatCents(rb.buyWealthCents)}</div></div>
        <div className="tile"><div className="muted">After {years} years: renting</div><div className="v">{formatCents(rb.rentWealthCents)}</div></div>
      </div>
      <p>
        <strong>{rb.advantageCents >= 0 ? 'Buying' : 'Renting'} comes out ahead by {formatCents(Math.abs(rb.advantageCents))}</strong> over {years} years.
        {rb.breakEvenYear !== null ? ` Buying pulls ahead in year ${rb.breakEvenYear}.` : ' Buying does not catch up within this period.'}
      </p>
      <LinesChart
        title="Net worth from each path"
        xLabels={rb.years.map((y) => `${year + y.year}-01-01`)}
        series={[
          { label: 'Buy', color: 'var(--s1)', values: rb.years.map((y) => Math.max(0, y.buyWealthCents)) },
          { label: 'Rent and invest', color: 'var(--s2)', values: rb.years.map((y) => Math.max(0, y.rentWealthCents)) },
        ]}
      />
    </>
  );

  return (
    <>
      <PageHeader title="Can I afford it?" description={<>Check a big purchase against the guidelines lenders and planners use, your cash, and your forecast. These are rules of thumb, not a loan approval.</>} />
      <PageTabs id="afford" tabs={[{ id: 'afford', label: 'Can I afford it?', content: afford }, { id: 'rent', label: 'Rent or buy?', content: compare }]} />
    </>
  );
}
