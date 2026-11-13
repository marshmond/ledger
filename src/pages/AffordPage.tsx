import { useMemo, useState } from 'react';
import { Link } from '../core/router';
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
import { Fields, Kind, Lines, PlanChecks, PlanHero, type CheckLevel } from './PlanParts';
import './analysis.css';
import './plan.css';

const KIND: Record<PurchaseKind, string> = { house: 'A house', car: 'A car', other: 'Something else' };
const LEVEL: Record<'ok' | 'caution' | 'warn', CheckLevel> = { ok: 'ok', caution: 'info', warn: 'warn' };
const LEVEL_WORD: Record<CheckLevel, string> = { ok: 'Within guideline', info: 'Caution', warn: 'Outside guideline' };

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
    return runForecast(i, base.thresholdCents);
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
    <div className="an-stack-col">
      <PlanHero
        label="Total monthly cost"
        kind={<Kind k="estimate">Rule of thumb</Kind>}
        amount={formatCents(res.monthlyCostCents)}
        message={<>If you buy {KIND[kind].toLowerCase()}: a check against common guidelines, your cash and your forecast. It is not a loan approval and not a recommendation.</>}
        figs={[
          { label: 'Loan', value: formatCents(res.loanCents) },
          { label: 'Payment (principal + interest)', value: formatCents(res.paymentCents) },
          { label: 'Cash needed up front', value: formatCents(res.upfrontCents) },
        ]}
      />

      <div className="an-split">
        <section className="an-card an-stack-col" aria-labelledby="af-in">
          <h2 className="an-h2" id="af-in">The purchase <Kind k="input">Your inputs</Kind></h2>
          <Fields legend="What and when">
            <label className="f">What are you buying?
              <select value={kind} onChange={(e) => setKindAndDefaults(e.target.value as PurchaseKind)}>{(Object.keys(KIND) as PurchaseKind[]).map((k) => <option key={k} value={k}>{KIND[k]}</option>)}</select>
            </label>
            <MoneyField key={`p${kind}`} label="Price" cents={price} onChange={setPrice} />
            <label className="f">Buying around<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          </Fields>
          <Fields legend={kind === 'other' ? 'Paying' : 'Financing'}>
            <NumField label={kind === 'other' ? 'Paid in cash %' : 'Down payment %'} value={downPct} step={1} onChange={(n) => setDownPct(Math.max(0, Math.min(100, n)))} />
            {kind !== 'other' && <NumField label="Interest rate %" value={apr} step={0.125} onChange={setApr} />}
            {kind !== 'other' && <NumField label="Loan term (months)" value={term} step={12} onChange={(n) => setTerm(Math.max(1, Math.round(n)))} />}
          </Fields>
          {kind === 'house' && (
            <>
              <Fields legend="Ongoing house costs">
                <NumField label="Property tax % of price / yr" value={taxPct} step={0.1} onChange={setTaxPct} />
                <MoneyField label="Home insurance / month" cents={insurance} onChange={setInsurance} />
                <NumField label="Upkeep % of price / yr" value={maintPct} step={0.25} onChange={setMaintPct} />
                <MoneyField label="HOA / month" cents={hoa} onChange={setHoa} />
              </Fields>
              <Fields legend="Up-front costs">
                <NumField label="Closing costs %" value={closingPct} step={0.5} onChange={setClosingPct} />
              </Fields>
            </>
          )}
          {kind === 'car' && (
            <Fields legend="Car costs">
              <MoneyField label="Insurance, fuel, upkeep / month" cents={carExtra} onChange={setCarExtra} />
              <MoneyField label="Tax, title, fees" cents={oneTime} onChange={setOneTime} />
            </Fields>
          )}
          {kind === 'other' && <p className="an-note" style={{ margin: 0 }}>Enter the price and the share you would pay in cash; the checks below show what is left.</p>}
          <details className="pl-detail">
            <summary>Your numbers (filled in from the app, change them if they are off)</summary>
            <div className="an-form" style={{ marginTop: 'var(--sp-3)' }}>
              <MoneyField key={`g${grossMonthly}`} label="Gross income / month" cents={gross} onChange={setIncome2} />
              <MoneyField key={`s${spendEst}`} label="Spending / month" cents={spending} onChange={setSpend2} />
              <MoneyField label="Other debt payments / month" cents={other} onChange={setOther} />
            </div>
            <p className="an-note">
              Loans and card minimums already counted: {formatCents(loanPay + cardMin)} a month. Cash available: {formatCents(nw?.cash ?? 0)}. Take-home about {formatCents(netMonthly)} a month.
              {grossMonthly === 0 && <> Set up income on the <Link to="/income">Income</Link> tab to fill in your income.</>}
            </p>
          </details>
        </section>

        <div className="an-stack-col">
          <section className="an-card an-stack-col" aria-labelledby="af-checks">
            <h2 className="an-h2" id="af-checks">Checks against the guidelines <Kind k="guideline">Rules of thumb</Kind></h2>
            <PlanChecks label="Affordability checks" words={LEVEL_WORD} items={res.checks.map((c) => ({ id: c.id, level: LEVEL[c.level], title: c.title, detail: c.detail }))} />
          </section>

          {max && (
            <section className="an-card" aria-labelledby="af-max">
              <h2 className="an-h2" id="af-max" style={{ fontSize: 'var(--fs-base)' }}>The most you could afford by the usual guidelines <Kind k="guideline">Guideline</Kind></h2>
              <div className="pl-bignum"><div className="pl-bignum-val">{formatCents(max.priceCents)}</div></div>
              <p className="an-note" style={{ margin: 0 }}>
                {max.priceCents === 0 ? 'Needs your income first.' : kind === 'house'
                  ? `Keeps housing at 28% of gross income and all debts at 36% (${max.limit === 'dti' ? 'your other debts are what limits it' : 'the housing cost is what limits it'}), with the same ${downPct}% down. Lenders may approve more; that does not mean it is comfortable.`
                  : 'Keeps all car costs at 15% of gross income and all debts at 36%.'}
              </p>
            </section>
          )}
        </div>
      </div>

      {withBuy && base && (
        <section className="an-card an-stack-col" aria-labelledby="af-fc">
          <h2 className="an-h2" id="af-fc">What it does to your cash forecast <Kind k="projected">Projected</Kind></h2>
          <p className="an-note" style={{ margin: 0 }}>Using your forecast for the next {base.input.months} months, with the up-front cost on {date} and the monthly cost starting the month after.</p>
          <Lines rows={[
            { label: 'Lowest balance without it', value: formatCents(base.result.low.balanceCents) },
            { label: 'Lowest balance with it', value: <>{formatCents(withBuy.low.balanceCents)} <span className="muted">on {withBuy.low.date}</span></>, strong: true },
            { label: 'Balance at the end, without / with', value: `${formatCents(base.result.endCents)} / ${formatCents(withBuy.endCents)}` },
          ]} />
          {withBuy.firstBelow
            ? <p className="pl-status pl-status--warn" role="status"><strong>Below your warning level. </strong>Your cash would fall below your {formatCents(base.thresholdCents)} warning level on {withBuy.firstBelow.date}.</p>
            : <p className="pl-status pl-status--ok" role="status"><strong>Above your warning level. </strong>Your cash stays above your {formatCents(base.thresholdCents)} warning level.</p>}
          <LinesChart
            title="Cash at the end of each month"
            xLabels={withBuy.months.map((m) => `${m.month}-01`)}
            fit
            precise
            allowNegative
            axis="month"
            series={[
              { label: 'Without the purchase', color: 'var(--s3)', values: base.result.months.map((m) => m.endCents) },
              { label: 'With the purchase', color: 'var(--s2)', values: withBuy.months.map((m) => m.endCents), dashed: true },
            ]}
          />
        </section>
      )}
    </div>
  );

  const compare = (
    <div className="an-stack-col">
      <PlanHero
        label={`After ${years} years`}
        kind={<Kind k="projected">Projected, built on guesses</Kind>}
        amount={formatCents(Math.abs(rb.advantageCents))}
        message={<>
          <strong>{rb.advantageCents >= 0 ? 'Buying' : 'Renting'} comes out ahead by {formatCents(Math.abs(rb.advantageCents))}</strong> over {years} years.
          {rb.breakEvenYear !== null ? ` Buying pulls ahead in year ${rb.breakEvenYear}.` : ' Buying does not catch up within this period.'}{' '}
          Rent growth, home prices and returns are guesses, so this is one possible outcome, not a recommendation.
        </>}
      />
      <p className="an-note" style={{ margin: 0 }}>
        Buying uses the house price, down payment, and costs from the first tab. Renting means paying rent and investing the down payment and closing money; whichever path costs
        less each month invests the difference. At the end the house is sold. Mortgage-interest and property-tax deductions are not included, and appreciation and returns are guesses.
      </p>

      <div className="an-split an-split--even">
        <section className="an-card an-stack-col" aria-labelledby="rb-buy">
          <h2 className="an-h2" id="rb-buy">Buy <Kind k="projected">Projected</Kind></h2>
          <Lines label="Taken from the first tab" rows={[
            { label: 'Price', value: formatCents(price), muted: true },
            { label: 'Down payment', value: `${downPct}%`, muted: true },
            { label: 'Interest rate', value: `${apr}%`, muted: true },
            { label: 'Loan term', value: `${term} months`, muted: true },
          ]} />
          <Fields legend="Assumptions for buying">
            <NumField label="Home price rises % / yr" value={appr} step={0.5} onChange={setAppr} />
            <NumField label="Selling costs %" value={sellPct} step={0.5} onChange={setSellPct} />
          </Fields>
          <Lines rows={[
            { label: 'Owning costs per month (first month)', value: formatCents(rb.monthlyOwnCostCents) },
            { label: `After ${years} years: buying`, value: formatCents(rb.buyWealthCents), strong: true },
          ]} />
        </section>
        <section className="an-card an-stack-col" aria-labelledby="rb-rent">
          <h2 className="an-h2" id="rb-rent">Rent and invest <Kind k="projected">Projected</Kind></h2>
          <Fields legend="Assumptions for renting">
            <MoneyField label="Rent per month" cents={rent} onChange={setRent} />
            <NumField label="Rent rises % / yr" value={rentGrowth} step={0.5} onChange={setRentGrowth} />
            <NumField label="Investments return % / yr (after tax)" value={ret} step={0.5} onChange={setRet} />
          </Fields>
          <Lines rows={[
            { label: 'Rent per month', value: formatCents(rb.monthlyRentCents) },
            { label: `After ${years} years: renting`, value: formatCents(rb.rentWealthCents), strong: true },
          ]} />
        </section>
      </div>

      <section className="an-card an-stack-col" aria-labelledby="rb-years">
        <h2 className="an-h2" id="rb-years">How long <Kind k="input">Your input</Kind></h2>
        <div className="an-form">
          <NumField label="Years" value={years} step={1} onChange={(n) => setYears(Math.max(1, Math.min(40, Math.round(n))))} />
        </div>
        <LinesChart
          title="Net worth from each path"
          xLabels={rb.years.map((y) => `${year + y.year}-01-01`)}
          fit
          precise
          allowNegative
          series={[
            { label: 'Buy', color: 'var(--s1)', values: rb.years.map((y) => y.buyWealthCents) },
            { label: 'Rent and invest', color: 'var(--s2)', values: rb.years.map((y) => y.rentWealthCents), dashed: true },
          ]}
        />
      </section>
    </div>
  );

  return (
    <div className="an-page pl-page">
      <PageHeader eyebrow="Plan" title="Can I afford it?" description={<>Check a big purchase against the guidelines lenders and planners use, your cash, and your forecast. These are rules of thumb, not a loan approval.</>} />
      <PageTabs id="afford" tabs={[{ id: 'afford', label: 'Can I afford it?', content: afford }, { id: 'rent', label: 'Rent or buy?', content: compare }]} />
    </div>
  );
}
