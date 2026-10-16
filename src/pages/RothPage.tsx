import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { buildIncomeModel } from '../lib/income';
import { formatCents, todayISO } from '../lib/money';
import { buildPlanInput, DEFAULT_ROTH, newStrategyId, starterStrategies, type RothSettings } from '../lib/rothInputs';
import {
  comparePlans, firstRmdYear, makeZPaths, NO_CONVERSION, planEndYear, runMonteCarlo, type McSummary, type OtherIncome, type PlanInput, type Strategy,
} from '../lib/rothPlan';
import { RETIREMENT_RULES_2026, rmdStartAge } from '../data/retirementTax';
import { LinesChart, compactUSD } from './charts';
import Collapsible from './Collapsible';
import { MoneyField, NumField } from './fields';

const BRACKETS = [0.1, 0.12, 0.22, 0.24, 0.32, 0.35];
const KIND_LABEL: Record<Strategy['kind'], string> = { none: 'No conversions', bracket: 'Fill a tax bracket', fixed: 'Fixed amount each year', table: 'My own amounts by year' };

const tableToText = (t: Record<number, number>) => Object.entries(t).sort(([a], [b]) => Number(a) - Number(b)).map(([y, c]) => `${y}: ${(c / 100).toFixed(0)}`).join('\n');
function textToTable(text: string): Record<number, number> {
  const out: Record<number, number> = {};
  for (const line of text.split('\n')) {
    const m = line.match(/(\d{4})\D+?([\d,]+(?:\.\d+)?)/);
    if (m) out[Number(m[1])] = Math.round(Number(m[2].replace(/,/g, '')) * 100);
  }
  return out;
}

function StrategyEditor({ s, onChange, onDelete, canDelete }: { s: Strategy; onChange: (p: Partial<Strategy>) => void; onDelete: () => void; canDelete: boolean }) {
  const [tableText, setTableText] = useState(tableToText(s.table));
  return (
    <div className="card">
      <div className="row spread">
        <label className="f" style={{ flex: 1 }}>Name<input value={s.label} onChange={(e) => onChange({ label: e.target.value })} /></label>
        {canDelete && <button className="link danger" onClick={onDelete}>remove</button>}
      </div>
      <div className="row">
        <label className="f">How much to convert
          <select value={s.kind} onChange={(e) => onChange({ kind: e.target.value as Strategy['kind'] })}>
            {(Object.keys(KIND_LABEL) as Strategy['kind'][]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </label>
        {s.kind === 'bracket' && (
          <label className="f">Up to the top of the
            <select value={s.bracketRate} onChange={(e) => onChange({ bracketRate: Number(e.target.value) })}>
              {BRACKETS.map((b) => <option key={b} value={b}>{Math.round(b * 100)}% bracket</option>)}
            </select>
          </label>
        )}
        {s.kind === 'fixed' && <MoneyField label="Per year (today’s dollars)" cents={s.fixedCents} onChange={(c) => onChange({ fixedCents: c })} width={120} />}
        {(s.kind === 'bracket' || s.kind === 'fixed') && (
          <>
            <NumField label="From year" value={s.fromYear} step={1} width={80} onChange={(n) => onChange({ fromYear: Math.round(n) })} />
            <NumField label="Through year" value={s.toYear} step={1} width={80} onChange={(n) => onChange({ toYear: Math.round(n) })} />
          </>
        )}
      </div>
      {s.kind === 'table' && (
        <label className="f">One year per line, like “2031: 40000” (dollars in that year)
          <textarea rows={4} value={tableText} onChange={(e) => setTableText(e.target.value)} onBlur={() => onChange({ table: textToTable(tableText) })} />
        </label>
      )}
      {s.kind !== 'none' && (
        <div className="checks wrap">
          <label className="chk"><input type="checkbox" checked={s.capIrmaa} onChange={(e) => onChange({ capIrmaa: e.target.checked })} /> Never raise income into the first Medicare IRMAA tier (when Medicare is two years away or here)</label>
          <label className="chk"><input type="checkbox" checked={s.capAca} onChange={(e) => onChange({ capAca: e.target.checked })} /> Never push income over the ACA subsidy cliff</label>
        </div>
      )}
    </div>
  );
}

function OtherIncomeEditor({ items, onChange, year0 }: { items: OtherIncome[]; onChange: (v: OtherIncome[]) => void; year0: number }) {
  const [d, setD] = useState<OtherIncome>({ label: '', annualCents: 0, startYear: year0 + 10, endYear: null, taxablePct: 100 });
  return (
    <div>
      {items.length > 0 && (
        <table>
          <thead><tr><th>Income</th><th className="num">Per year (today’s $)</th><th>From</th><th>Until</th><th className="num">Taxable</th><th /></tr></thead>
          <tbody>
            {items.map((o, i) => (
              <tr key={i}>
                <td>{o.label}</td><td className="num">{formatCents(o.annualCents)}</td><td>{o.startYear}</td><td>{o.endYear ?? 'for life'}</td><td className="num">{o.taxablePct}%</td>
                <td><button className="link danger" onClick={() => onChange(items.filter((_, j) => j !== i))}>remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row">
        <label className="f">Label<input value={d.label} placeholder="Pension, rental…" onChange={(e) => setD({ ...d, label: e.target.value })} /></label>
        <MoneyField label="Per year (today’s dollars)" cents={d.annualCents} onChange={(c) => setD({ ...d, annualCents: c })} width={120} />
        <NumField label="From year" value={d.startYear} step={1} width={80} onChange={(n) => setD({ ...d, startYear: Math.round(n) })} />
        <label className="f">Until year (blank = life)<input style={{ width: 90 }} inputMode="numeric" value={d.endYear ?? ''} onChange={(e) => setD({ ...d, endYear: e.target.value ? Number(e.target.value) : null })} /></label>
        <NumField label="Taxable %" value={d.taxablePct} step={5} width={70} onChange={(n) => setD({ ...d, taxablePct: Math.max(0, Math.min(100, n)) })} />
        <button disabled={!d.label.trim() || d.annualCents <= 0} onClick={() => { onChange([...items, { ...d, label: d.label.trim() }]); setD({ ...d, label: '', annualCents: 0 }); }}>Add</button>
      </div>
    </div>
  );
}

export default function RothPage() {
  const year0 = Number(todayISO().slice(0, 4));
  const people = useLiveQuery(() => db.people.toArray(), []) ?? [];
  const profiles = useLiveQuery(() => db.incomeProfiles.toArray(), []) ?? [];
  const bonuses = useLiveQuery(() => db.bonuses.toArray(), []) ?? [];
  const taxSettings = useLiveQuery(() => db.taxSettings.toArray(), []) ?? [];
  const rsuVests = useLiveQuery(() => db.rsuVests.toArray(), []) ?? [];
  const accounts = useLiveQuery(() => db.invAccounts.toArray(), []) ?? [];
  const holdings = useLiveQuery(() => db.holdings.toArray(), []) ?? [];
  const securities = useLiveQuery(() => db.securities.toArray(), []) ?? [];
  const classes = useLiveQuery(() => db.assetClasses.toArray(), []) ?? [];
  const sales = useLiveQuery(() => db.sales.toArray(), []) ?? [];
  const savedRet = useLiveQuery(() => db.settings.get('retirement'), []);
  const savedProj = useLiveQuery(() => db.settings.get('projection'), []);
  const saved = useLiveQuery(() => db.settings.get('rothPlan'), []);
  const loaded = saved !== undefined || savedRet !== undefined || people.length > 0;
  const s: RothSettings = { ...DEFAULT_ROTH, ...((saved?.value as Partial<RothSettings>) ?? {}) };
  const setS = (patch: Partial<RothSettings>) => db.settings.put({ key: 'rothPlan', value: { ...s, ...patch } });

  const income = useMemo(
    () => buildIncomeModel(year0, people, profiles, bonuses, taxSettings.find((t) => t.year === year0), { vests: rsuVests, securities }),
    [year0, people, profiles, bonuses, taxSettings, rsuVests, securities],
  );
  const built = useMemo(
    () => buildPlanInput({ year0, people, profiles, income, accounts, holdings, securities, classes, sales, retirement: savedRet?.value as never, projectionInflationPct: (savedProj?.value as { inflationPct?: number } | undefined)?.inflationPct }, s),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [year0, people, profiles, income, accounts, holdings, securities, classes, sales, savedRet, savedProj, saved],
  );
  const input: PlanInput | null = built.input;
  const strategies: Strategy[] = useMemo(() => s.strategies ?? (input ? starterStrategies(input) : []), [s.strategies, input]);
  const setStrategies = (list: Strategy[]) => setS({ strategies: list });
  const editStrategy = (id: string, patch: Partial<Strategy>) => setStrategies(strategies.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const compared = useMemo(() => (input && strategies.length ? comparePlans(input, strategies) : null), [input, strategies]);
  const [picked, setPicked] = useState<string>('');
  const shown = compared?.results.find((r) => r.strategy.id === picked) ?? compared?.results[0];

  const [mc, setMc] = useState<{ key: string; byId: Record<string, McSummary> } | null>(null);
  const [running, setRunning] = useState(false);
  const key = useMemo(() => JSON.stringify([input, strategies, s.sims]), [input, strategies, s.sims]);
  const mcFresh = mc && mc.key === key;

  async function runMc() {
    if (!input) return;
    setRunning(true);
    const years = planEndYear(input) - input.startYear + 1;
    const paths = makeZPaths(s.sims, years);
    const byId: Record<string, McSummary> = {};
    for (const st of strategies) {
      await new Promise((r) => setTimeout(r, 0));
      byId[st.id] = runMonteCarlo(input, st, paths);
      setMc({ key, byId: { ...byId } });
    }
    setRunning(false);
  }

  if (!loaded) return <h1>Roth conversions</h1>;

  const idxOf = (year: number) => Math.pow(1 + (input?.inflationPct ?? 0) / 100, year - year0);
  const real = (v: number, year: number) => v / idxOf(year);
  const nameOf = (id: string | null) => strategies.find((x) => x.id === id)?.label ?? '';
  const cell = (v: number) => formatCents(Math.round(v));
  const winnerBadge = (id: string) => {
    const w = compared?.winners;
    if (!w) return null;
    return (
      <>
        {w.lowestCost === id && <span className="badge" title="Lowest lifetime taxes and premiums"> lowest cost</span>}
        {w.highestWealth === id && <span className="badge" title="Most money left at the end of the plan"> most left</span>}
        {w.highestHeirs === id && <span className="badge" title="Most after-tax money for heirs"> best for heirs</span>}
      </>
    );
  };

  return (
    <>
      <h1>Roth conversions</h1>
      <p className="muted">
        Compare ways of moving money from traditional IRAs and 401(k)s into a Roth. Each year’s federal and Massachusetts taxes, Social Security taxation, Medicare IRMAA
        surcharges, and the ACA premium credit are calculated for every strategy, then the results are compared three ways: lowest lifetime taxes, most money left, and the
        most after-tax money for your heirs. It is a planning model, not tax advice.
      </p>

      {built.problems.map((p) => <p key={p} className="warn">{p}</p>)}
      {people.length === 0 && <p className="muted">Start on the <Link to="/income">Income</Link> tab.</p>}

      {input && (
        <>
          <Collapsible id="roth.situation" title="Your situation">
            <p className="muted">Balances come from the Investments tab (traditional IRA, 401(k), Roth, and taxable accounts; 529s are left out). Wages and 401(k) saving come from the Income tab, with RSU vests counted in the year they vest.</p>
            <div className="grid">
              {input.people.map((p, i) => {
                const cfg = s.perPerson.find((x) => x.personId === people.slice().sort((a, b) => (a.id ?? 0) - (b.id ?? 0))[i]?.id);
                const pid = people.slice().sort((a, b) => (a.id ?? 0) - (b.id ?? 0))[i]?.id ?? 0;
                const setP = (patch: Partial<RothSettings['perPerson'][number]>) =>
                  setS({ perPerson: [...s.perPerson.filter((x) => x.personId !== pid), { personId: pid, retireYear: cfg?.retireYear ?? null, ssAnnualCents: cfg?.ssAnnualCents ?? 0, ssClaimAge: cfg?.ssClaimAge ?? 67, iraBasisCents: cfg?.iraBasisCents ?? 0, ...patch }] });
                return (
                  <div className="card" key={pid}>
                    <strong>{p.name}</strong> <span className="muted">born {p.birthYear}; RMDs start at {rmdStartAge(p.birthYear)} ({p.birthYear + rmdStartAge(p.birthYear)})</span>
                    <table><tbody>
                      <tr><td>Traditional IRA</td><td className="num">{cell(p.ira)}</td></tr>
                      <tr><td>401(k)</td><td className="num">{cell(p.k401)}</td></tr>
                      <tr><td>Roth</td><td className="num">{cell(p.roth)}</td></tr>
                      <tr><td>Wages now (after pre-tax items)</td><td className="num">{cell(p.wagesCents)}</td></tr>
                    </tbody></table>
                    <div className="row">
                      <NumField label="Retires in" value={p.retireYear} step={1} width={80} onChange={(n) => setP({ retireYear: Math.round(n) })} />
                      <MoneyField label="Social Security per year (today’s $)" cents={p.ssAnnualCents} onChange={(c) => setP({ ssAnnualCents: c })} width={120} />
                      <NumField label="Claims at age" value={p.ssClaimAge} step={1} width={70} onChange={(n) => setP({ ssClaimAge: Math.max(62, Math.min(70, Math.round(n))) })} />
                    </div>
                    <MoneyField label="After-tax money in IRAs (nondeductible basis)" cents={p.iraBasisCents} onChange={(c) => setP({ iraBasisCents: c })} width={120} />
                  </div>
                );
              })}
              <div className="card">
                <strong>Taxable accounts</strong>
                <table><tbody>
                  <tr><td>Value</td><td className="num">{cell(input.taxableCents)}</td></tr>
                  <tr><td>Cost basis</td><td className="num">{cell(input.taxableBasisCents)}</td></tr>
                </tbody></table>
                <p className="muted">Conversion taxes are paid from here first.</p>
              </div>
              {(built.hsa > 0 || (input.hsa?.contribCents ?? 0) > 0) && (
                <div className="card">
                  <strong>Health savings account</strong>
                  <table><tbody>
                    <tr><td>Balance</td><td className="num">{cell(built.hsa)}</td></tr>
                    <tr><td>Saved per year while working</td><td className="num">{cell(input.hsa?.contribCents ?? 0)}</td></tr>
                  </tbody></table>
                  <p className="muted">Pays medical costs tax-free in retirement (set the yearly amount under Assumptions).</p>
                </div>
              )}
            </div>
            {built.notes.map((n) => <p key={n} className="muted">{n}</p>)}
            <h3>Other income</h3>
            <OtherIncomeEditor items={s.other} onChange={(v) => setS({ other: v })} year0={year0} />
          </Collapsible>

          <Collapsible id="roth.assumptions" title="Assumptions">
            <div className="grid">
              <NumField label="Plan through the year the younger person turns" value={s.planAge} step={1} onChange={(n) => setS({ planAge: Math.round(n) })} />
              <MoneyField label={`Spending in retirement per year, today’s $ (blank = Retirement tab)`} cents={s.spendingCents ?? 0} onChange={(c) => setS({ spendingCents: c || null })} />
              {(built.hsa > 0 || (input.hsa?.contribCents ?? 0) > 0) && <MoneyField label="Medical costs the HSA pays per year in retirement, today’s $" cents={s.hsaMedicalCents} onChange={(c) => setS({ hsaMedicalCents: c })} />}
              <NumField label="Inflation %" value={s.inflationPct} step={0.1} onChange={(n) => setS({ inflationPct: n })} />
              <NumField label="Wage growth %" value={s.wageGrowthPct} step={0.1} onChange={(n) => setS({ wageGrowthPct: n })} />
              <NumField label={`Return, traditional % (estimate ${built.estReturn.trad.toFixed(1)})`} value={s.returnPct.trad ?? built.estReturn.trad} step={0.1} onChange={(n) => setS({ returnPct: { ...s.returnPct, trad: n } })} />
              <NumField label={`Return, Roth % (estimate ${built.estReturn.roth.toFixed(1)})`} value={s.returnPct.roth ?? built.estReturn.roth} step={0.1} onChange={(n) => setS({ returnPct: { ...s.returnPct, roth: n } })} />
              <NumField label={`Return, taxable % (estimate ${built.estReturn.taxable.toFixed(1)})`} value={s.returnPct.taxable ?? built.estReturn.taxable} step={0.1} onChange={(n) => setS({ returnPct: { ...s.returnPct, taxable: n } })} />
              <NumField label={`Volatility % (estimate ${built.estVol.toFixed(1)})`} value={s.volPct ?? built.estVol} step={0.5} onChange={(n) => setS({ volPct: n })} />
              <NumField label="Taxable account yield %" value={s.yieldPct} step={0.1} onChange={(n) => setS({ yieldPct: n })} />
              <NumField label="…of which interest/ordinary %" value={s.yieldOrdinaryPct} step={5} onChange={(n) => setS({ yieldOrdinaryPct: n })} />
              <NumField label="Tax rate on traditional money left at the end %" value={s.endTaxRatePct} step={1} onChange={(n) => setS({ endTaxRatePct: n })} />
              <NumField label="Your heirs’ tax rate on traditional money %" value={s.heirTaxRatePct} step={1} onChange={(n) => setS({ heirTaxRatePct: n })} />
            </div>
            <label className="f" style={{ maxWidth: 420 }}>Pay the tax on conversions from
              <select value={s.conversionTaxFrom} onChange={(e) => setS({ conversionTaxFrom: e.target.value as RothSettings['conversionTaxFrom'] })}>
                <option value="outside">Outside money (taxable account first) — keeps the whole conversion in the Roth</option>
                <option value="conversion">The converted amount itself — less lands in the Roth</option>
              </select>
            </label>
            <div className="checks wrap">
              <label className="chk"><input type="checkbox" checked={s.aca.on} onChange={(e) => setS({ aca: { ...s.aca, on: e.target.checked } })} /> Buy health insurance on the ACA marketplace until Medicare at 65</label>
            </div>
            {s.aca.on && (
              <div className="row">
                <MoneyField label="Yearly premium of the benchmark (second-lowest silver) plan" cents={s.aca.benchmarkCents} onChange={(c) => setS({ aca: { ...s.aca, benchmarkCents: c } })} width={130} />
                <NumField label="Premium growth % per year" value={s.aca.premiumGrowthPct} step={0.5} width={90} onChange={(n) => setS({ aca: { ...s.aca, premiumGrowthPct: n } })} />
                <span className="muted">Leave health premiums out of your spending figure; the planner adds what you pay after the credit.</span>
              </div>
            )}
          </Collapsible>

          <Collapsible id="roth.strategies" title="Strategies to compare" right={<button onClick={() => setS({ strategies: null })}>Reset to the starter set</button>}>
            <p className="muted">
              The first RMD year is {firstRmdYear(input)}; the plan runs through {planEndYear(input)}. “Fill a bracket” converts as much as keeps your ordinary income at the top of the chosen bracket each year.
            </p>
            {strategies.map((st) => (
              <StrategyEditor key={st.id} s={st} canDelete={strategies.length > 1} onChange={(p) => editStrategy(st.id, p)} onDelete={() => setStrategies(strategies.filter((x) => x.id !== st.id))} />
            ))}
            <button
              disabled={strategies.length >= 8}
              onClick={() => setStrategies([...strategies, { ...NO_CONVERSION(input.startYear, Math.max(input.startYear, firstRmdYear(input) - 1)), id: newStrategyId(), label: 'New strategy', kind: 'bracket', bracketRate: 0.22 }])}
            >Add a strategy</button>
          </Collapsible>

          {compared && (
            <Collapsible id="roth.results" title="Results">
              <p className="muted">All dollar amounts below are in today’s dollars unless marked. “Cost” adds federal, Massachusetts, net investment income tax, Medicare IRMAA surcharges, and ACA premiums paid.</p>
              <div className="grid">
                <div className="tile"><div className="muted">Lowest lifetime cost</div><div className="v">{nameOf(compared.winners.lowestCost)}</div></div>
                <div className="tile"><div className="muted">Most money left</div><div className="v">{nameOf(compared.winners.highestWealth)}</div></div>
                <div className="tile"><div className="muted">Best for heirs</div><div className="v">{nameOf(compared.winners.highestHeirs)}</div></div>
              </div>
              <div className="scroll-x">
                <table>
                  <thead>
                    <tr><th>Strategy</th><th className="num">Converted</th><th className="num">Lifetime cost</th><th className="num">Federal</th><th className="num">MA</th><th className="num">IRMAA</th><th className="num">ACA premiums</th><th className="num">Left at the end</th><th className="num">After tax to heirs</th><th>Money lasts?</th></tr>
                  </thead>
                  <tbody>
                    {compared.results.map(({ strategy: st, result: r }) => {
                      const sm = r.summary;
                      const endY = planEndYear(input);
                      return (
                        <tr key={st.id} className={shown?.strategy.id === st.id ? 'sel' : ''}>
                          <td><button className="link" onClick={() => setPicked(st.id)}>{st.label}</button>{winnerBadge(st.id)}</td>
                          <td className="num">{cell(sm.totalConverted)}</td>
                          <td className="num"><strong>{cell(sm.lifetimeCostReal)}</strong></td>
                          <td className="num">{cell(r.rows.reduce((a, x) => a + real(x.fed + x.niit, x.year), 0))}</td>
                          <td className="num">{cell(r.rows.reduce((a, x) => a + real(x.ma, x.year), 0))}</td>
                          <td className="num">{cell(r.rows.reduce((a, x) => a + real(x.irmaa, x.year), 0))}</td>
                          <td className="num">{cell(r.rows.reduce((a, x) => a + real(x.acaNet, x.year), 0))}</td>
                          <td className="num">{cell(sm.endWealthReal)}</td>
                          <td className="num">{cell(sm.heirsReal)}</td>
                          <td>{sm.failedYear === null ? <span className="ok">yes, to {endY}</span> : <span className="error">runs out {sm.failedYear}</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {compared.results.some((r) => r.result.summary.failedYear !== null) && <p className="warn">A strategy that runs out of money is never picked as a winner.</p>}

              <h3>Simulated futures</h3>
              <p className="muted">
                The table above uses steady returns. This runs {s.sims.toLocaleString()} random sequences of returns (the same ones for every strategy) to show how often the money lasts and the spread of what is left.
              </p>
              <div className="row">
                <NumField label="Futures" value={s.sims} step={100} width={90} onChange={(n) => setS({ sims: Math.max(50, Math.min(2000, Math.round(n))) })} />
                <button className="primary" disabled={running} onClick={runMc}>{running ? 'Running…' : mc ? 'Run again' : 'Run simulations'}</button>
                {mc && !mcFresh && !running && <span className="warn">Inputs changed since this ran.</span>}
              </div>
              {mc && (
                <div className="scroll-x">
                  <table>
                    <thead><tr><th>Strategy</th><th className="num">Money lasts</th><th className="num">Left at end (10th / middle / 90th)</th><th className="num">To heirs (10th / middle / 90th)</th></tr></thead>
                    <tbody>
                      {strategies.map((st) => {
                        const m = mc.byId[st.id];
                        return m ? (
                          <tr key={st.id}>
                            <td>{st.label}</td>
                            <td className="num"><strong>{m.successPct.toFixed(0)}%</strong></td>
                            <td className="num">{m.endWealthReal.map(compactUSD).join(' / ')}</td>
                            <td className="num">{m.heirsReal.map(compactUSD).join(' / ')}</td>
                          </tr>
                        ) : null;
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {shown && (
                <>
                  <h3>{shown.strategy.label}: year by year</h3>
                  {shown.result.warnings.map((w) => <p key={w} className="warn">{w}</p>)}
                  <LinesChart
                    title="Balances in today’s dollars"
                    subtitle="Traditional (taxed when withdrawn), Roth, and taxable"
                    xLabels={shown.result.rows.map((r) => `${r.year}-01-01`)}
                    series={[
                      { label: 'Traditional', color: 'var(--s1)', values: shown.result.rows.map((r) => real(r.trad, r.year)) },
                      { label: 'Roth', color: 'var(--s2)', values: shown.result.rows.map((r) => real(r.roth, r.year)) },
                      { label: 'Taxable', color: 'var(--s3)', values: shown.result.rows.map((r) => real(r.taxable, r.year)) },
                    ]}
                  />
                  <div className="scroll-x">
                    <table>
                      <thead>
                        <tr><th>Year</th><th>Ages</th><th className="num">Wages</th><th className="num">Soc. Sec. (taxable)</th><th className="num">RMD</th><th className="num">Converted</th><th className="num">Income (AGI)</th><th className="num">Fed tax</th><th className="num">MA tax</th><th className="num">IRMAA</th><th className="num">ACA premium</th><th className="num">Top rate</th><th className="num">Traditional</th><th className="num">Roth</th><th className="num">Taxable</th></tr>
                      </thead>
                      <tbody>
                        {shown.result.rows.map((r) => (
                          <tr key={r.year}>
                            <td>{r.year}</td><td>{r.ages.join(' / ')}</td>
                            <td className="num">{cell(r.wages)}</td>
                            <td className="num">{cell(r.ss)} <span className="muted">({cell(r.ssTaxable)})</span></td>
                            <td className="num">{cell(r.rmd)}</td>
                            <td className="num"><strong>{r.conversion ? cell(r.conversion) : '—'}</strong></td>
                            <td className="num">{cell(r.agi)}</td>
                            <td className="num">{cell(r.fed + r.niit)}</td>
                            <td className="num">{cell(r.ma)}</td>
                            <td className="num">{r.irmaa ? cell(r.irmaa) : '—'}</td>
                            <td className="num">{r.acaNet ? cell(r.acaNet) : '—'}{r.acaNet > 0 && r.acaSubsidy === 0 && <span className="warn"> no credit</span>}</td>
                            <td className="num">{Math.round(r.marginal * 100)}%</td>
                            <td className="num">{cell(r.trad)}</td><td className="num">{cell(r.roth)}</td><td className="num">{cell(r.taxable)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="muted">Dollar amounts in this table are in each year’s own dollars. {shown.result.rows.some((r) => r.unmet > 0) && 'Years with a shortfall show money that could not be found.'}</p>
                </>
              )}
            </Collapsible>
          )}

          <Collapsible id="roth.notes" title="How this works and what it leaves out" defaultOpen={false}>
            <ul>
              <li>Conversions are made on January 1 and taxed in the same year. Taxes are computed with the joint-return rules (brackets, standard and senior deductions, Social Security taxation, capital-gains stacking, 3.8% net investment income tax) and Massachusetts’ 5% tax (4% surtax over its threshold; Social Security is not taxed there).</li>
              <li>Social Security, brackets, and deductions follow your inflation assumption. A few amounts are fixed in law and are not indexed: the Social Security taxation thresholds, the investment income tax threshold, and the temporary senior deduction (it ends after 2028). Tax law will change; rerun this as it does.</li>
              <li>Required withdrawals use the IRS uniform table and last year-end balances. A 401(k) is rolled into an IRA when its owner retires, which is also when it becomes convertible. After-tax IRA money is handled with the pro-rata rule.</li>
              <li>Before everyone retires, your wages cover spending and ordinary taxes; only the extra cost caused by a conversion (tax, IRMAA, lost ACA credit) is taken from savings. After that, spending plus all taxes come from Social Security, other income, RMDs, then the taxable account, then traditional, then Roth.</li>
              <li>Medicare IRMAA uses income from two years earlier, per person on Medicare. The ACA credit uses current-year income and a household of two; it vanishes above 400% of the poverty guideline.</li>
              <li>Left out: early-withdrawal penalties and the Roth five-year rules (convert and withdraw with those in mind if anyone is under 59½), HSAs, one spouse dying (survivor tax brackets and benefits), state tax outside Massachusetts, long-term care costs, and the 10-year inherited-account payout schedule (heirs’ tax is one flat rate you set).</li>
              <li>Random futures use one common market return each year for all accounts, with the volatility above.</li>
              {RETIREMENT_RULES_2026.notes.map((n) => <li key={n} className="muted">{n}</li>)}
            </ul>
          </Collapsible>
        </>
      )}
    </>
  );
}
