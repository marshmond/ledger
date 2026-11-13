import { useMemo, useState } from 'react';
import { Link } from '../core/router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { IncomeStream, RetirementSettings, Windfall } from '../types';
import { formatCents, todayISO } from '../lib/money';
import { buildIncomeModel } from '../lib/income';
import { buildProjection, DEFAULT_PROJECTION, type ProjectionSettings } from '../lib/projectionInput';
import { DEFAULT_RETIREMENT, annualToMonthlyCents, monthlyToAnnualCents, planRetirement, sustainableSpending, trailingAnnualSpending, type RetirementInput } from '../lib/retirement';
import { toReal } from '../lib/projection';
import { loanView, paymentsInYear } from '../lib/loanSchedule';
import { FanChart, compactUSD } from './charts';
import { MoneyField, NumField, PercentField } from './fields';
import ScenarioTable from './ScenarioTable';
import { PageHeader } from '../ui/components';
import { Fields, Kind, PlanHero, PlanJump } from './PlanParts';
import './analysis.css';
import './plan.css';

export default function RetirementPage() {
  const today = todayISO();
  const year0 = Number(today.slice(0, 4));
  const accounts = useLiveQuery(() => db.invAccounts.toArray(), []) ?? [];
  const holdings = useLiveQuery(() => db.holdings.toArray(), []) ?? [];
  const securities = useLiveQuery(() => db.securities.toArray(), []) ?? [];
  const classes = useLiveQuery(() => db.assetClasses.toArray(), []) ?? [];
  const people = useLiveQuery(() => db.people.toArray(), []) ?? [];
  const profiles = useLiveQuery(() => db.incomeProfiles.toArray(), []) ?? [];
  const bonuses = useLiveQuery(() => db.bonuses.toArray(), []) ?? [];
  const taxSettings = useLiveQuery(() => db.taxSettings.toArray(), []) ?? [];
  const rsuVests = useLiveQuery(() => db.rsuVests.toArray(), []) ?? [];
  const windfalls = useLiveQuery(() => db.windfalls.toArray(), []) ?? [];
  const txns = useLiveQuery(() => db.txns.toArray(), []) ?? [];
  const pfCategories = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const pfAccounts = useLiveQuery(() => db.accounts.toArray(), []) ?? [];
  const loans = useLiveQuery(() => db.loans.toArray(), []) ?? [];
  const loanRates = useLiveQuery(() => db.loanRates.toArray(), []) ?? [];
  const loanEvents = useLiveQuery(() => db.loanEvents.toArray(), []) ?? [];
  const savedR = useLiveQuery(() => db.settings.get('retirement'), []);
  const savedP = useLiveQuery(() => db.settings.get('projection'), []);

  const rs: RetirementSettings = { ...DEFAULT_RETIREMENT(year0), ...((savedR?.value as Partial<RetirementSettings>) ?? {}) };
  const ps: ProjectionSettings = { ...DEFAULT_PROJECTION, ...((savedP?.value as Partial<ProjectionSettings>) ?? {}) };
  const setR = (patch: Partial<RetirementSettings>) => db.settings.put({ key: 'retirement', value: { ...rs, ...patch } });
  const infl = ps.inflationPct / 100;

  const [seed, setSeed] = useState(1);
  const [sustainable, setSustainable] = useState<{ cents: number; forSettings: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const incomeModel = useMemo(
    () => buildIncomeModel(year0, people, profiles, bonuses, taxSettings.find((t) => t.year === year0), { vests: rsuVests, securities }),
    [year0, people, profiles, bonuses, taxSettings, rsuVests, securities],
  );

  const built = useMemo(() => {
    const open = accounts.filter((a) => !a.closed && a.kind !== '529');
    if (open.length === 0 || classes.length === 0) return null;
    const b = buildProjection({ accounts: open, holdings, securities, assetClasses: classes }, incomeModel.years, ps);
    return b;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, holdings, securities, classes, incomeModel, ps.years, ps.inflationPct]);

  // Your actual (not what-if) loans, with the schedules you have set up.
  const debts = useMemo(
    () =>
      loans
        .filter((l) => !l.scenario)
        .map((l) => ({ loan: l, s: loanView(l, loanRates.filter((r) => r.loanId === l.id), loanEvents.filter((e) => e.loanId === l.id)).schedule }))
        .filter((x) => x.s.rows.length > 0),
    [loans, loanRates, loanEvents],
  );
  const debtPaymentsAt = (t: number) => debts.reduce((sum, x) => sum + paymentsInYear(x.s, year0 + t), 0);
  const input: RetirementInput | null = built ? { year0, accounts: built.input.accounts, classes: built.input.classes, windfalls, inflation: infl, settings: rs, debtPaymentsAt } : null;
  const settingsKey = JSON.stringify([rs, windfalls, infl, built?.startTotal, debts.map((x) => [x.loan.id, x.s.totalPaid, x.s.rows.length])]);

  const result = useMemo(() => (input && rs.spendingCents > 0 ? planRetirement(input, seed) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settingsKey, built, seed]);

  const budgetSpend = useMemo(() => trailingAnnualSpending(txns, pfCategories, pfAccounts, today, 3), [txns, pfCategories, pfAccounts, today]);

  const [wLabel, setWLabel] = useState('');
  const [wYear, setWYear] = useState(year0 + 10);
  const [wAmt, setWAmt] = useState(0);
  const [wDir, setWDir] = useState<'in' | 'out'>('in');
  const [wReal, setWReal] = useState(true);
  const [sLabel, setSLabel] = useState('Social Security');
  const [sAmt, setSAmt] = useState(0);
  const [sStart, setSStart] = useState(year0 + 20);
  const [sEnd, setSEnd] = useState(0);

  const real = (arr: number[]) => toReal(arr, infl);
  const yr = (t: number) => year0 + t;
  const status = result ? (result.mc.successRate * 100 >= rs.targetConfidencePct ? 'ok' : 'short') : null;

  async function findSustainable() {
    if (!input) return;
    setBusy(true);
    await new Promise((r) => setTimeout(r, 30)); // let the button state paint
    const cents = sustainableSpending(input, rs.targetConfidencePct, 3000, 1);
    setSustainable({ cents, forSettings: settingsKey });
    setBusy(false);
  }

  if (accounts.filter((a) => a.kind !== '529').length === 0) {
    return (
      <div className="an-page pl-page">
        <PageHeader eyebrow="Plan" title="Retirement" description={<>Add your non-529 investment accounts on the <Link to="/investments">Investments</Link> page first.</>} />
      </div>
    );
  }

  const retireIdx = result?.model.retireIdx ?? Math.max(0, rs.retireYear - year0);
  const fan = result && {
    startYear: year0,
    p10: real(result.mc.p10),
    p25: real(result.mc.p25),
    p50: real(result.mc.p50),
    p75: real(result.mc.p75),
    p90: real(result.mc.p90),
    steady: real(result.steady.values),
  };
  const staleSustainable = sustainable && sustainable.forSettings !== settingsKey;
  const gap = sustainable && !staleSustainable ? sustainable.cents - rs.spendingCents : null;

  return (
    <div className="an-page pl-page">
      <PageHeader eyebrow="Plan" title="Retirement" description="Does the money last? Tested against many possible futures." about={<>Tests whether your savings can fund the spending you want, using the same asset-class assumptions as <Link to="/projections">Projections</Link>.
        529 accounts are left out because they are earmarked for education. All dollar figures here are in today’s dollars.</>} />

      <PlanJump items={[
        { id: 'ret-plan', label: 'Your plan' },
        { id: 'ret-income', label: 'Other income' },
        { id: 'ret-debts', label: 'Debts' },
        { id: 'ret-windfalls', label: 'Windfalls' },
        ...(result ? [{ id: 'ret-chart', label: 'Savings chart' }, { id: 'ret-years', label: 'Year by year' }] : []),
      ]} />

      <div className="pl-cols pl-cols--out-right">
        <div className="pl-out pl-sticky">
          <section className="an-stack-col" aria-label="Results" id="ret-results">
            {rs.spendingCents <= 0 && <p className="warn" style={{ margin: 0 }}>Enter your yearly retirement spending in “Your plan” to see results.</p>}
            {result && fan && built && (
              <>
                {built.warnings.map((w) => <p key={w} className="warn" style={{ margin: 0 }}>{w}</p>)}
                <PlanHero
                  stack
                  label={`Chance your money lasts through ${yr(result.model.horizon)}`}
                  kind={<Kind k="projected">Simulated</Kind>}
                  amount={`${(result.mc.successRate * 100).toFixed(0)}%`}
                  message={<>
                    <strong>{status === 'ok' ? `Meets your ${rs.targetConfidencePct}% goal` : `Below your ${rs.targetConfidencePct}% goal`}</strong>{' '}
                    {status === 'ok'
                      ? `for spending ${formatCents(rs.spendingCents)} a year.`
                      : `${result.medianRuinYear ? `In the futures where it fails, the money typically runs out around ${yr(result.medianRuinYear)}.` : ''}`}
                    {' '}This is the share of simulated futures that last, not a promise.
                  </>}
                  figs={[
                    { label: `Median savings at ${rs.retireYear}`, value: compactUSD(real(result.mc.p50)[Math.min(retireIdx, result.model.horizon)]) },
                    { label: 'First-year withdrawal rate', value: Number.isFinite(result.firstYearWithdrawalPct) ? `${result.firstYearWithdrawalPct.toFixed(1)}%` : 'n/a', sub: `after other income, incl. ${rs.taxRatePct}% tax` },
                    { label: 'Average-return path', value: result.steady.ruinYear ? `runs out ${yr(result.steady.ruinYear)}` : 'lasts' },
                    { label: 'Retirement funded', value: `${rs.planYears} yrs` },
                  ]}
                />
                <section className="an-card an-stack-col" aria-labelledby="ret-sust">
                  <h2 className="an-h2" id="ret-sust" style={{ fontSize: 'var(--fs-base)' }}>Is the withdrawal rate supportive of your spending?</h2>
                  <p className="an-note" style={{ margin: 0 }}>
                    A first-year withdrawal of about 4% of savings is a common rule of thumb for roughly 30 years; longer retirements, a lower stock share, or
                    a poor start in the market call for less. The simulation above is the better test because it uses your own mix, income, and windfalls.
                  </p>
                  <div className="an-actions" style={{ margin: 0 }}>
                    <button className="primary" disabled={busy} onClick={findSustainable}>{busy ? 'Calculating…' : `Find spending that lasts at ${rs.targetConfidencePct}%`}</button>
                  </div>
                  {sustainable && !staleSustainable && (
                    <p style={{ margin: 0 }} role="status">
                      Sustainable: <strong>{formatCents(sustainable.cents)}</strong> a year
                      {gap !== null && <> ({gap >= 0 ? `${formatCents(gap)} more than` : `${formatCents(-gap)} less than`} your plan)</>}
                    </p>
                  )}
                  {staleSustainable && <p className="an-note" style={{ margin: 0 }}>Settings changed; recalculate.</p>}
                </section>
              </>
            )}
          </section>
        </div>

        <div className="pl-in an-stack-col">
          <div id="ret-plan" className="pl-anchor" tabIndex={-1}>
            <section className="an-card an-stack-col" aria-labelledby="ret-plan-h">
              <h2 className="an-h2" id="ret-plan-h">Your plan <Kind k="input">Your assumptions</Kind></h2>
              <Fields legend="When and for how long">
                <NumField label="Retire in (calendar year)" value={rs.retireYear} step={1} onChange={(v) => setR({ retireYear: Math.round(v) })} />
                <NumField label="Years of retirement to fund" value={rs.planYears} step={1} onChange={(v) => setR({ planYears: Math.min(60, Math.max(1, Math.round(v))) })} />
              </Fields>
              <Fields legend="Spending and tax">
                <MoneyField key={`sp${rs.spendingCents}`} label="Yearly spending in retirement" cents={rs.spendingCents} onChange={(c) => setR({ spendingCents: c })} />
                <NumField label="Tax on withdrawals (%)" value={rs.taxRatePct} step={1} onChange={(v) => setR({ taxRatePct: Math.min(60, Math.max(0, v)) })} />
              </Fields>
              <div className="pl-spendhelp">
                {budgetSpend.annualCents > 0 && (
                  <button onClick={() => setR({ spendingCents: budgetSpend.annualCents })}>
                    Use my recent spending: {formatCents(budgetSpend.annualCents)}/yr
                  </button>
                )}
                <span className="an-note" style={{ margin: 0 }}>
                  {budgetSpend.annualCents > 0
                    ? `Average of your last ${budgetSpend.monthsUsed} full month(s) of outflows (card payments and transfers excluded). Retirement spending often differs: housing may be paid off, health costs rise.`
                    : 'No full months of spending in your ledger yet, so enter an amount. Once you have a few months of transactions, you can pull your actual spending from them.'}
                </span>
              </div>
              <Fields legend="How sure, and how many simulations">
                <PercentField label="Want the money to last in (% of futures)" value={rs.targetConfidencePct} min={0} max={99} onChange={(v) => setR({ targetConfidencePct: v })} />
                <label className="f">Simulations
                  <select value={rs.sims} onChange={(e) => setR({ sims: Number(e.target.value) })}>
                    <option value={1000}>1,000 (fast)</option><option value={5000}>5,000</option><option value={20000}>20,000</option>
                  </select>
                </label>
              </Fields>
              <Fields legend="Stock share at retirement">
                <div className="pl-equity-row">
                  <label className="chk">
                    <input type="checkbox" checked={rs.equityPctAtRetirement !== null} onChange={(e) => setR({ equityPctAtRetirement: e.target.checked ? 60 : null })} />
                    Change the stock share at retirement
                  </label>
                  {rs.equityPctAtRetirement !== null && (
                    <NumField ariaLabel="Stock share at retirement, percent" value={rs.equityPctAtRetirement} step={5} width={80} onChange={(v) => setR({ equityPctAtRetirement: Math.min(100, Math.max(0, v)) })} />
                  )}
                </div>
                <p className="an-note" style={{ margin: 0 }}>{rs.equityPctAtRetirement !== null ? '% stocks, rest bonds, from retirement on (uses your first stock and bond classes).' : 'Otherwise the current mix continues.'}</p>
              </Fields>
            </section>
          </div>

          <div id="ret-income" className="pl-anchor" tabIndex={-1}>
            <section className="an-card an-stack-col" aria-labelledby="ret-inc-h">
              <h2 className="an-h2" id="ret-inc-h">Other retirement income <Kind k="input">Your inputs</Kind></h2>
              <p className="an-note" style={{ margin: 0 }}>Social Security, pensions, rental income: what you expect to receive, per month, in today’s dollars and after tax. It reduces what the portfolio must pay.</p>
              {rs.streams.length > 0 && (
                <div className="an-tablewrap">
                  <table className="an-table an-stack" aria-label="Other retirement income">
                    <tbody>
                      {rs.streams.map((x) => (
                        <tr key={x.id}>
                          <td className="an-full an-lead"><span className="an-title">{x.label}</span></td>
                          <td className="num" data-label="Per month">{formatCents(annualToMonthlyCents(x.annualCents))}/mo</td>
                          <td data-label="When">from {x.startYear}{x.endYear ? ` to ${x.endYear}` : ''}</td>
                          <td className="an-cell-act"><button className="link danger" aria-label={`Remove ${x.label}`} onClick={() => setR({ streams: rs.streams.filter((s) => s.id !== x.id) })}>remove</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="an-form an-form--wide">
                <label className="f">Name<input value={sLabel} onChange={(e) => setSLabel(e.target.value)} /></label>
                <MoneyField label="Per month (today's $)" cents={sAmt} onChange={setSAmt} />
                <NumField label="Starts (year)" value={sStart} step={1} onChange={(v) => setSStart(Math.round(v))} />
                <NumField label="Ends (optional)" value={sEnd} step={1} onChange={(v) => setSEnd(Math.round(v))} />
                <div className="pl-formbtn">
                  <button
                    disabled={sAmt <= 0}
                    onClick={async () => {
                      const x: IncomeStream = { id: crypto.randomUUID(), label: sLabel.trim() || 'Income', annualCents: monthlyToAnnualCents(sAmt), startYear: sStart, endYear: sEnd > 0 ? sEnd : null };
                      await setR({ streams: [...rs.streams, x] });
                      setSAmt(0);
                    }}
                  >Add</button>
                </div>
              </div>
            </section>
          </div>

          <div id="ret-debts" className="pl-anchor" tabIndex={-1}>
            <section className="an-card an-stack-col" aria-labelledby="ret-debt-h">
              <h2 className="an-h2" id="ret-debt-h">Your debts in retirement <Kind k="recorded">From your loans</Kind></h2>
              {debts.length === 0 ? (
                <p className="an-note" style={{ margin: 0 }}>No loans set up. Add a mortgage or HELOC on the <Link to="/debt">Debt</Link> tab and its payments and payoff date can be included here.</p>
              ) : (
                <>
                  <div className="an-tablewrap">
                    <table className="an-table an-stack an-stack--3" aria-label="Your debts in retirement">
                      <tbody>
                        {debts.map(({ loan, s }) => {
                          const after = Array.from({ length: Math.max(0, s.rows.length ? Number(s.rows.at(-1)!.date.slice(0, 4)) - rs.retireYear : 0) }, (_, i) => rs.retireYear + 1 + i);
                          const during = after.reduce((sum, y) => sum + paymentsInYear(s, y), 0);
                          return (
                            <tr key={loan.id}>
                              <td className="an-full an-lead"><span className="an-title">{loan.name}</span></td>
                              <td className="an-full">{s.payoffDate ? `paid off ${s.payoffDate.slice(0, 7)}` : 'not paid off in the schedule'}</td>
                              <td className="num an-full">{formatCents(during)} due after {rs.retireYear}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <label className="chk">
                    <input type="checkbox" checked={!!rs.includeDebtPayments} onChange={(e) => setR({ includeDebtPayments: e.target.checked })} />
                    Add these loan payments (principal + interest) to my retirement spending
                  </label>
                  <p className="an-note" style={{ margin: 0 }}>
                    Leave this off if the yearly spending above already includes your mortgage or HELOC payments. If you pulled spending from your ledger,
                    note it includes interest but not principal, so turn this on to cover the principal.
                  </p>
                </>
              )}
            </section>
          </div>

          <div id="ret-windfalls" className="pl-anchor" tabIndex={-1}>
            <section className="an-card an-stack-col" aria-labelledby="ret-wf-h">
              <h2 className="an-h2" id="ret-wf-h">Windfalls <Kind k="input">Your inputs</Kind></h2>
              <p className="an-note" style={{ margin: 0 }}>
                One-time money in (inheritance, selling company stock, a business sale) or out (a big purchase), by calendar year. They apply to everything on
                the Retirement and <Link to="/projections">Projections</Link> pages; switch one off to see the plan without it. Treated as arriving at the end of that year.
              </p>
              {windfalls.length > 0 && (
                <div className="an-tablewrap">
                  <table className="an-table an-stack" aria-label="Windfalls">
                    <tbody>
                      {[...windfalls].sort((a, b) => a.year - b.year).map((w) => (
                        <tr key={w.id} className={w.include ? '' : 'muted'}>
                          <td className="an-full an-lead"><label className="chk"><input type="checkbox" checked={w.include} onChange={(e) => db.windfalls.update(w.id!, { include: e.target.checked })} /><span>{w.label}</span></label>{!w.include && <span className="an-kind"> Switched off</span>}</td>
                          <td data-label="Year">{w.year}</td>
                          <td className="num" data-label="Amount">{w.amountCents < 0 ? 'Out: ' : 'In: '}{formatCents(Math.abs(w.amountCents))}{w.todaysDollars ? " (today's $)" : ''}</td>
                          <td className="an-cell-act"><button className="link danger" aria-label={`Delete ${w.label}`} onClick={() => db.windfalls.delete(w.id!)}>delete</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="an-form an-form--wide">
                <label className="f">Label<input value={wLabel} onChange={(e) => setWLabel(e.target.value)} placeholder="Inheritance, RSU sale…" /></label>
                <NumField label="Year" value={wYear} step={1} onChange={(v) => setWYear(Math.round(v))} />
                <label className="f">Direction
                  <select value={wDir} onChange={(e) => setWDir(e.target.value as 'in' | 'out')}>
                    <option value="in">Money in (+)</option><option value="out">Money out (−)</option>
                  </select>
                </label>
                <MoneyField label="Amount" cents={wAmt} onChange={setWAmt} />
                <label className="chk pl-formchk"><input type="checkbox" checked={wReal} onChange={(e) => setWReal(e.target.checked)} />in today’s dollars</label>
                <div className="pl-formbtn">
                  <button
                    disabled={wAmt <= 0 || !wLabel.trim()}
                    onClick={async () => {
                      const w: Windfall = { label: wLabel.trim(), year: wYear, amountCents: wDir === 'in' ? wAmt : -wAmt, todaysDollars: wReal, include: true };
                      await db.windfalls.add(w);
                      setWLabel('');
                      setWAmt(0);
                    }}
                  >Add windfall</button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>

      {result && fan && built && (
        <>
          <div id="ret-chart" className="pl-anchor" tabIndex={-1}>
            <FanChart
              data={fan}
              realTerms
              fit
              title={`Savings through retirement (${yr(0)}–${yr(result.model.horizon)})`}
              subtitle={`${rs.sims.toLocaleString()} simulated futures · today's dollars · withdrawals begin after ${rs.retireYear}`}
              marker={{ index: retireIdx, label: 'Retire' }}
              steadyLabel="Average-return path"
            />
            <div className="an-tools" style={{ marginTop: 'var(--sp-3)' }}>
              <button onClick={() => setSeed(seed + 1)}>Re-run with new random draws</button>
              <span className="an-note" style={{ margin: 0 }}>Same assumptions, different luck.</span>
            </div>
          </div>

          <div id="ret-years" className="pl-anchor an-card pl-scn" tabIndex={-1}>
            <ScenarioTable result={result} year0={year0} inflation={infl} sims={rs.sims} />
          </div>

          <section className="an-card" aria-labelledby="ret-still">
            <h2 className="an-h2" id="ret-still">Chance your money is still there <Kind k="projected">Simulated</Kind></h2>
            <div className="an-tablewrap" style={{ marginTop: 'var(--sp-3)' }}>
              <table className="an-table an-stack an-stack--3">
                <thead><tr><th>Years into retirement</th><th>Year</th><th className="num">Still funded</th></tr></thead>
                <tbody>
                  {[5, 10, 15, 20, 25, 30, 35, 40].filter((k) => k <= rs.planYears).map((k) => {
                    const t = retireIdx + k;
                    return <tr key={k}><td data-label="Years into retirement">{k}</td><td data-label="Year">{yr(t)}</td><td className="num" data-label="Still funded">{((1 - result.mc.ruinedByYear[t]) * 100).toFixed(0)}%</td></tr>;
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="an-card an-card--soft" aria-labelledby="ret-incl">
            <h2 className="an-h2" id="ret-incl" style={{ fontSize: 'var(--fs-base)' }}>What this does and doesn’t include</h2>
            <ul className="muted">
              <li>Spending, other income, and windfalls rise with inflation as entered; withdrawals are grossed up for the tax rate you set.</li>
              <li>Taxes are one flat rate on withdrawals, not a bracket-by-bracket calculation, and Roth vs traditional accounts are not distinguished.</li>
              <li>No fees, no required minimum distributions, no change in spending as you age, and no health-care or long-term-care shocks.</li>
              <li>Savings contributions before retirement come from the amounts on the Projections page (including 401(k)s linked to your Income model).</li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
