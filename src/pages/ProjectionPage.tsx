import { useMemo, useState } from 'react';
import { Link } from '../core/router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { buildIncomeModel } from '../lib/income';
import { windfallFlow } from '../lib/retirement';
import { formatCents, todayISO } from '../lib/money';
import { probAtLeast, realTargetToNominal, runMonteCarlo, steadyPath, toReal } from '../lib/projection';
import { baseContribution, buildProjection, DEFAULT_PROJECTION, type ProjectionSettings } from '../lib/projectionInput';
import { FanChart, compactUSD } from './charts';
import { MoneyField, NumField } from './fields';
import { PageHeader } from '../ui/components';
import { Fields, Kind, PlanHero } from './PlanParts';
import './analysis.css';
import './plan.css';

export default function ProjectionPage() {
  const year0 = Number(todayISO().slice(0, 4));
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
  const saved = useLiveQuery(() => db.settings.get('projection'), []);
  const s: ProjectionSettings = { ...DEFAULT_PROJECTION, ...((saved?.value as Partial<ProjectionSettings>) ?? {}) };
  const setS = (patch: Partial<ProjectionSettings>) => db.settings.put({ key: 'projection', value: { ...s, ...patch } });
  const [seed, setSeed] = useState(1);

  const incomeModel = useMemo(
    () => buildIncomeModel(year0, people, profiles, bonuses, taxSettings.find((t) => t.year === year0), { vests: rsuVests, securities }),
    [year0, people, profiles, bonuses, taxSettings, rsuVests, securities],
  );

  const open = accounts.filter((a) => !a.closed);
  const result = useMemo(() => {
    if (open.length === 0 || classes.length === 0) return null;
    const built = buildProjection({ accounts, holdings, securities, assetClasses: classes }, incomeModel.years, s);
    built.input.extraFlow = windfallFlow(windfalls, year0, s.inflationPct / 100);
    const steady = steadyPath(built.input);
    const mc = runMonteCarlo(built.input, s.sims, seed);
    return { built, steady, mc };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, holdings, securities, classes, incomeModel, windfalls, s.years, s.inflationPct, s.sims, seed]);

  if (accounts.length === 0) {
    return (
      <div className="an-page pl-page">
        <PageHeader eyebrow="Plan" title="Projections" description={<>Add your accounts and holdings on the <Link to="/investments">Investments</Link> page first.</>} />
      </div>
    );
  }

  const infl = s.inflationPct / 100;
  const view = (arr: number[]) => (s.realTerms ? toReal(arr, infl) : arr);
  const n = s.years;
  const ty = Math.min(Math.max(1, s.targetYear), n);
  const dollars = s.realTerms ? "today's dollars" : 'future dollars';

  let prob: number | null = null;
  if (result && s.targetCents > 0) {
    const nominal = s.realTerms ? realTargetToNominal(s.targetCents, infl, ty) : s.targetCents;
    prob = probAtLeast(result.mc, ty, nominal);
  }

  // Total added over the horizon. In today's dollars each year's contribution (spread through the year, so about
  // half a year of inflation) is deflated individually.
  const totalContrib = result
    ? result.built.input.accounts.reduce(
        (sum, a) =>
          sum +
          Array.from({ length: n }, (_, t) => a.contribution(t + 1) / (s.realTerms ? Math.pow(1 + infl, t + 0.5) : 1)).reduce((x, y) => x + y, 0),
        0,
      )
    : 0;

  const fan = result && {
    startYear: year0,
    p10: view(result.mc.p10),
    p25: view(result.mc.p25),
    p50: view(result.mc.p50),
    p75: view(result.mc.p75),
    p90: view(result.mc.p90),
    steady: view(result.steady.total),
  };

  return (
    <div className="an-page pl-page">
      <PageHeader eyebrow="Plan" title="Projections" description="Long-range growth from your holdings and contributions." about={<>A long-range “what could happen” view built from your holdings, your contributions, and the return assumptions on the{' '}
        <Link to="/investments">Investments</Link> page. It is a planning tool, not a prediction: change the assumptions and see how the range moves.</>} />

      {result && fan && (
        <>
          {result.built.warnings.map((w) => <p key={w} className="warn" style={{ margin: 0 }}>{w}</p>)}
          {windfalls.some((w) => w.include) && (
            <p className="an-note" style={{ margin: 0 }}>Includes {windfalls.filter((w) => w.include).length} windfall(s) from <Link to="/retirement">Retirement</Link>, treated as arriving at the end of their year.</p>
          )}
          <PlanHero
            label={`Median outcome in ${year0 + n} (${dollars})`}
            kind={<Kind k="projected">Simulated</Kind>}
            amount={formatCents(Math.round(fan.p50[n]))}
            message={<>The middle of {s.sims.toLocaleString()} simulated futures. Real results could be well above or below it, and nothing here is guaranteed.</>}
            figs={[
              { label: 'Starting value', value: compactUSD(result.built.startTotal), kind: <Kind k="actual">Current</Kind> },
              { label: 'Poor case (10th percentile)', value: compactUSD(fan.p10[n]) },
              { label: 'Strong case (90th percentile)', value: compactUSD(fan.p90[n]) },
              { label: 'Steady-return path', value: compactUSD(fan.steady[n]) },
              { label: `Contributed over ${n} yrs`, value: compactUSD(totalContrib), kind: <Kind k="assumption">From your inputs</Kind> },
            ]}
          />

          <FanChart
            data={fan}
            realTerms={s.realTerms}
            fit
            title={`Portfolio value over ${n} years`}
            subtitle={`${s.sims.toLocaleString()} simulated futures · ${dollars}`}
          />
          <div className="an-tools">
            <button onClick={() => setSeed(seed + 1)}>Re-run with new random draws</button>
            <span className="an-note" style={{ margin: 0, flex: '1 1 260px' }}>Same assumptions, different luck. If the picture changes a lot, use more simulations.</span>
          </div>
        </>
      )}

      <div className="an-split an-split--even">
        <section className="an-card an-stack-col" aria-labelledby="pj-assume">
          <h2 className="an-h2" id="pj-assume">Growth, inflation and simulation <Kind k="assumption">Your assumptions</Kind></h2>
          <Fields legend="Time and inflation">
            <NumField label="Years to project" value={s.years} step={1} onChange={(v) => setS({ years: Math.min(60, Math.max(1, Math.round(v))) })} />
            <NumField label="Inflation (% per year)" value={s.inflationPct} step={0.1} onChange={(v) => setS({ inflationPct: v })} />
          </Fields>
          <Fields legend="How results are shown" note={s.realTerms ? 'Today’s dollars take inflation out, so a figure far in the future is comparable to money you have now.' : 'Future dollars are the plain amounts you would see then; they are inflated, so they look larger than they feel.'}>
            <label className="f">Dollars
              <select value={s.realTerms ? 'real' : 'nominal'} onChange={(e) => setS({ realTerms: e.target.value === 'real' })}>
                <option value="real">Today’s dollars (inflation-adjusted)</option>
                <option value="nominal">Future dollars (nominal)</option>
              </select>
            </label>
          </Fields>
          <Fields legend="Simulation">
            <label className="f">Simulations
              <select value={s.sims} onChange={(e) => setS({ sims: Number(e.target.value) })}>
                <option value={1000}>1,000 (fast)</option>
                <option value={5000}>5,000</option>
                <option value={20000}>20,000 (smoothest)</option>
              </select>
            </label>
          </Fields>
        </section>

        <section className="an-card an-stack-col" aria-labelledby="pj-target">
          <h2 className="an-h2" id="pj-target">Target <Kind k="input">Your input</Kind></h2>
          <Fields legend="Goal">
            <MoneyField label={`Goal amount (${dollars})`} cents={s.targetCents} onChange={(c) => setS({ targetCents: c })} />
            <NumField label="…by year (from now)" value={s.targetYear} step={1} onChange={(v) => setS({ targetYear: Math.round(v) })} />
          </Fields>
          {prob !== null ? (
            <div className="an-result" role="status">
              <div className="muted">Chance of reaching it by {year0 + ty} <Kind k="projected">Simulated</Kind></div>
              <div className="pl-bignum-val">{(prob * 100).toFixed(0)}%</div>
              <p className="an-note" style={{ margin: 0 }}>Out of {result!.mc.sims.toLocaleString()} simulated futures, this share ended at or above the goal. It is a share of simulated outcomes, not a promise.</p>
            </div>
          ) : <p className="an-note" style={{ margin: 0 }}>Enter a goal amount to see the share of simulated futures that reach it.</p>}
        </section>
      </div>

      <section className="an-card" aria-labelledby="pj-contrib">
        <h2 className="an-h2" id="pj-contrib">Contributions <Kind k="input">Your inputs</Kind></h2>
        <p className="an-note">
          Yearly amounts you expect to add, in dollars of the first year. They rise by the growth % each year; at 0% the amount stays flat,
          which shrinks in today’s dollars, so set it near your expected raises. 401(k)s and HSAs can follow your{' '}
          <Link to="/income">Income</Link> model (your deferrals plus employer match for {year0}).
        </p>
        <div className="an-tablewrap">
          <table className="an-table an-stack">
            <thead><tr><th>Account</th><th className="num">Per year</th><th className="num">Grows %/yr</th><th>Source</th></tr></thead>
            <tbody>
              {open.map((a) => {
                const linked = (a.kind === '401k' || a.kind === 'hsa') && a.linkToIncome;
                const base = baseContribution(a, incomeModel.years);
                return (
                  <tr key={a.id}>
                    <td className="an-full"><span className="an-title">{a.name}</span></td>
                    <td className="num" data-label="Per year">
                      {linked ? <>{formatCents(base.cents)} <span className="an-kind an-kind--manual">From Income</span></> : <MoneyField key={`${a.id}-${a.annualContributionCents}`} ariaLabel={`Per year for ${a.name}`} cents={a.annualContributionCents} width={120} onChange={(c) => db.invAccounts.update(a.id!, { annualContributionCents: c })} />}
                    </td>
                    <td className="num" data-label="Grows %/yr"><NumField ariaLabel={`Grows % per year for ${a.name}`} value={a.contributionGrowthPct} step={0.5} width={80} onChange={(v) => db.invAccounts.update(a.id!, { contributionGrowthPct: v })} /></td>
                    <td className="an-full">
                      {a.kind === '401k' || a.kind === 'hsa' ? (
                        <div className="pl-source">
                          <label className="chk"><input type="checkbox" checked={a.linkToIncome} onChange={(e) => db.invAccounts.update(a.id!, { linkToIncome: e.target.checked })} />From income model</label>
                          {a.linkToIncome && (
                            <select aria-label={`Whose income for ${a.name}`} value={a.personId ?? ''} onChange={(e) => db.invAccounts.update(a.id!, { personId: e.target.value ? Number(e.target.value) : null })}>
                              <option value="">Whose?</option>
                              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                          )}
                        </div>
                      ) : <span className="muted">entered</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {result && fan && (
        <>
          <section className="an-card" aria-labelledby="pj-accts">
            <h2 className="an-h2" id="pj-accts">Where each account ends up (steady-return path) <Kind k="projected">Projected</Kind></h2>
            <div className="an-tablewrap" style={{ marginTop: 'var(--sp-3)' }}>
              <table className="an-table an-stack an-stack--3">
                <thead><tr><th>Account</th><th className="num">Now</th><th className="num">In {n} years</th></tr></thead>
                <tbody>
                  {result.steady.perAccount.map((a) => {
                    const vals = view(a.values);
                    return <tr key={a.id}><td className="an-full an-lead"><span className="an-title">{a.name}</span></td><td className="num" data-label="Now">{formatCents(Math.round(vals[0]))}</td><td className="num" data-label={`In ${n} years`}>{formatCents(Math.round(vals[n]))}</td></tr>;
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="an-card an-card--soft" aria-labelledby="pj-read">
            <h2 className="an-h2" id="pj-read" style={{ fontSize: 'var(--fs-base)' }}>How to read this</h2>
            <ul className="muted">
              <li><strong>Median vs steady path.</strong> The steady path assumes every year earns exactly the compound return you entered for each asset class. That figure already includes the cost of ups and downs, so the typical (median) simulated outcome should land close to the steady path. A gap of a few percent is normal: contributions and withdrawals land at different times, and a mix of classes can compound a little differently from the average of its parts.</li>
              <li><strong>The bands.</strong> The darker band holds the middle half of simulated futures; the lighter band holds 80% of them. About one future in ten ends below the lower edge, and one in ten above the upper.</li>
              <li><strong>What is assumed.</strong> Each account keeps its current mix (rebalanced yearly). Contributions arrive evenly through the year. Asset classes move together in realistic ways (stocks with stocks, bonds less so).</li>
              <li><strong>What is not modeled.</strong> Fees, taxes, and market conditions that change over time. Withdrawals in retirement are modeled on the <Link to="/retirement">Retirement</Link> page, and college-type goals on <Link to="/goals">Goals</Link>.</li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
