import { useMemo, useState } from 'react';
import { Link } from '../core/router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { buildIncomeModel } from '../lib/income';
import { formatCents, todayISO } from '../lib/money';
import { buildPlanInput, DEFAULT_ROTH, newStrategyId, planBaseTables, starterStrategies, type RothSettings } from '../lib/rothInputs';
import {
  comparePlans, firstRmdYear, makeZPaths, NO_CONVERSION, planEndYear, runMonteCarlo, type McSummary, type OtherIncome, type PlanInput, type Strategy,
} from '../lib/rothPlan';
import { RETIREMENT_RULES, RETIREMENT_RULES_2026, rmdStartAge } from '../data/retirementTax';
import { LinesChart, compactUSD } from './charts';
import Collapsible from './Collapsible';
import { MoneyField, NumField } from './fields';
import { PageHeader } from '../ui/components';
import { Fields, Kind, Lines, PlanFigs, PlanJump } from './PlanParts';
import './analysis.css';
import './plan.css';

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
    <article className="an-card an-card--soft pl-strat an-stack-col" aria-label={`Strategy: ${s.label}`}>
      <div className="pl-strat-head">
        <label className="f">Name<input value={s.label} onChange={(e) => onChange({ label: e.target.value })} /></label>
        {canDelete && <button className="link danger" aria-label={`Remove strategy ${s.label}`} onClick={onDelete}>remove</button>}
      </div>
      <div className="an-form">
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
        {s.kind === 'fixed' && <MoneyField label="Per year (today’s dollars)" cents={s.fixedCents} onChange={(c) => onChange({ fixedCents: c })} />}
        {(s.kind === 'bracket' || s.kind === 'fixed') && (
          <>
            <NumField label="From year" value={s.fromYear} step={1} onChange={(n) => onChange({ fromYear: Math.round(n) })} />
            <NumField label="Through year" value={s.toYear} step={1} onChange={(n) => onChange({ toYear: Math.round(n) })} />
          </>
        )}
      </div>
      {s.kind === 'table' && (
        <label className="f">One year per line, like “2031: 40000” (dollars in that year)
          <textarea rows={4} value={tableText} onChange={(e) => setTableText(e.target.value)} onBlur={() => onChange({ table: textToTable(tableText) })} />
        </label>
      )}
      {s.kind !== 'none' && (
        <div className="an-checks" style={{ marginTop: 0 }}>
          <label className="chk"><input type="checkbox" checked={s.capIrmaa} onChange={(e) => onChange({ capIrmaa: e.target.checked })} /> Never raise income into the first Medicare IRMAA tier (when Medicare is two years away or here)</label>
          <label className="chk"><input type="checkbox" checked={s.capAca} onChange={(e) => onChange({ capAca: e.target.checked })} /> Never push income over the ACA subsidy cliff</label>
        </div>
      )}
    </article>
  );
}

function OtherIncomeEditor({ items, onChange, year0 }: { items: OtherIncome[]; onChange: (v: OtherIncome[]) => void; year0: number }) {
  const [d, setD] = useState<OtherIncome>({ label: '', annualCents: 0, startYear: year0 + 10, endYear: null, taxablePct: 100 });
  return (
    <div className="an-stack-col">
      {items.length > 0 && (
        <div className="an-tablewrap">
          <table className="an-table an-stack" aria-label="Other income">
            <thead><tr><th>Income</th><th className="num">Per year (today’s $)</th><th>From</th><th>Until</th><th className="num">Taxable</th><th /></tr></thead>
            <tbody>
              {items.map((o, i) => (
                <tr key={i}>
                  <td className="an-full an-lead"><span className="an-title">{o.label}</span></td><td className="num" data-label="Per year (today’s $)">{formatCents(o.annualCents)}</td><td data-label="From">{o.startYear}</td><td data-label="Until">{o.endYear ?? 'for life'}</td><td className="num" data-label="Taxable">{o.taxablePct}%</td>
                  <td className="an-cell-act"><button className="link danger" aria-label={`Remove ${o.label}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="an-form an-form--wide">
        <label className="f">Label<input value={d.label} placeholder="Pension, rental…" onChange={(e) => setD({ ...d, label: e.target.value })} /></label>
        <MoneyField label="Per year (today’s dollars)" cents={d.annualCents} onChange={(c) => setD({ ...d, annualCents: c })} />
        <NumField label="From year" value={d.startYear} step={1} onChange={(n) => setD({ ...d, startYear: Math.round(n) })} />
        <label className="f">Until year (blank = life)<input inputMode="numeric" value={d.endYear ?? ''} onChange={(e) => setD({ ...d, endYear: e.target.value ? Number(e.target.value) : null })} /></label>
        <NumField label="Taxable %" value={d.taxablePct} step={5} onChange={(n) => setD({ ...d, taxablePct: Math.max(0, Math.min(100, n)) })} />
        <div className="pl-formbtn"><button disabled={!d.label.trim() || d.annualCents <= 0} onClick={() => { onChange([...items, { ...d, label: d.label.trim() }]); setD({ ...d, label: '', annualCents: 0 }); }}>Add</button></div>
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

  if (!loaded) return <div className="an-page pl-page"><PageHeader eyebrow="Plan" title="Roth conversions" description="Compare ways of converting traditional money to Roth." /></div>;

  const idxOf = (year: number) => Math.pow(1 + (input?.inflationPct ?? 0) / 100, year - year0);
  const real = (v: number, year: number) => v / idxOf(year);
  const nameOf = (id: string | null) => strategies.find((x) => x.id === id)?.label ?? '';
  const cell = (v: number) => formatCents(Math.round(v));
  const winnerBadge = (id: string) => {
    const w = compared?.winners;
    if (!w) return null;
    return (
      <span className="pl-badges">
        {w.lowestCost === id && <span className="an-kind an-kind--manual" title="Lowest lifetime taxes and premiums">lowest cost</span>}
        {w.highestWealth === id && <span className="an-kind an-kind--manual" title="Most money left at the end of the plan">most left</span>}
        {w.highestHeirs === id && <span className="an-kind an-kind--manual" title="Most after-tax money for heirs">best for heirs</span>}
      </span>
    );
  };
  const hasHsa = !!input && (built.hsa > 0 || (input.hsa?.contribCents ?? 0) > 0);

  return (
    <div className="an-page pl-page">
      <PageHeader eyebrow="Plan" title="Roth conversions" description="Compare ways of converting traditional money to Roth." about={<>Compare ways of moving money from traditional IRAs and 401(k)s into a Roth. Each year’s federal and Massachusetts taxes, Social Security taxation, Medicare IRMAA
        surcharges, and the ACA premium credit are calculated for every strategy, then the results are compared three ways: lowest lifetime taxes, most money left, and the
        most after-tax money for your heirs. It is a planning model, not tax advice.</>} />

      {built.problems.map((p) => <p key={p} className="warn" style={{ margin: 0 }}>{p}</p>)}
      {people.length === 0 && <p className="an-note" style={{ margin: 0 }}>Start on the <Link to="/income">Income</Link> tab.</p>}

      {input && (
        <>
          {compared && (
            <section aria-label="Strategies at a glance" className="an-stack-col">
              <h2 className="an-h2">Which strategy comes out best <Kind k="projected">Projected, steady returns</Kind></h2>
              <PlanFigs
                label="Winners"
                figs={[
                  { label: 'Lowest lifetime cost', value: <span className="pl-textfig">{nameOf(compared.winners.lowestCost)}</span> },
                  { label: 'Most money left', value: <span className="pl-textfig">{nameOf(compared.winners.highestWealth)}</span> },
                  { label: 'Best for heirs', value: <span className="pl-textfig">{nameOf(compared.winners.highestHeirs)}</span> },
                ]}
              />
              <p className="an-note" style={{ margin: 0 }}>Each is the best of the strategies you compare below under the same assumptions. It is a result of this model, not a recommendation.</p>
            </section>
          )}

          <PlanJump items={[
            { id: 'roth-situation', label: 'Your situation' },
            { id: 'roth-assume', label: 'Assumptions' },
            { id: 'roth-strats', label: 'Strategies' },
            ...(compared ? [{ id: 'roth-results', label: 'Results' }] : []),
            { id: 'roth-notes', label: 'How this works' },
          ]} />

          <div id="roth-situation" className="pl-anchor" tabIndex={-1}>
            <Collapsible id="roth.situation" title="Your situation">
              <p className="an-note" style={{ marginTop: 0 }}><Kind k="recorded">From your records</Kind> Balances come from the Investments tab (traditional IRA, 401(k), Roth, and taxable accounts; 529s are left out). Wages and 401(k) saving come from the Income tab, with RSU vests counted in the year they vest.</p>
              <div className="an-props">
                {input.people.map((p, i) => {
                  const cfg = s.perPerson.find((x) => x.personId === people.slice().sort((a, b) => (a.id ?? 0) - (b.id ?? 0))[i]?.id);
                  const pid = people.slice().sort((a, b) => (a.id ?? 0) - (b.id ?? 0))[i]?.id ?? 0;
                  const setP = (patch: Partial<RothSettings['perPerson'][number]>) =>
                    setS({ perPerson: [...s.perPerson.filter((x) => x.personId !== pid), { personId: pid, retireYear: cfg?.retireYear ?? null, ssAnnualCents: cfg?.ssAnnualCents ?? 0, ssClaimAge: cfg?.ssClaimAge ?? 67, iraBasisCents: cfg?.iraBasisCents ?? 0, ...patch }] });
                  return (
                    <article className="an-card an-card--soft an-prop" key={pid} aria-label={p.name}>
                      <h3 className="an-h2" style={{ fontSize: 'var(--fs-base)' }}>{p.name}</h3>
                      <p className="an-note" style={{ margin: 0 }}>born {p.birthYear}; RMDs start at {rmdStartAge(p.birthYear)} ({p.birthYear + rmdStartAge(p.birthYear)})</p>
                      <Lines rows={[
                        { label: 'Traditional IRA', value: cell(p.ira) },
                        { label: '401(k)', value: cell(p.k401) },
                        { label: 'Roth', value: cell(p.roth) },
                        { label: 'Wages now (after pre-tax items)', value: cell(p.wagesCents) },
                      ]} />
                      <Fields legend={<>Your inputs <Kind k="input">Yours to set</Kind></>}>
                        <NumField label="Retires in" value={p.retireYear} step={1} onChange={(n) => setP({ retireYear: Math.round(n) })} />
                        <MoneyField label="Social Security per year (today’s $)" cents={p.ssAnnualCents} onChange={(c) => setP({ ssAnnualCents: c })} />
                        <NumField label="Claims at age" value={p.ssClaimAge} step={1} onChange={(n) => setP({ ssClaimAge: Math.max(62, Math.min(70, Math.round(n))) })} />
                        <MoneyField label="After-tax money in IRAs (nondeductible basis)" cents={p.iraBasisCents} onChange={(c) => setP({ iraBasisCents: c })} />
                      </Fields>
                    </article>
                  );
                })}
                <article className="an-card an-card--soft an-prop" aria-label="Taxable accounts">
                  <h3 className="an-h2" style={{ fontSize: 'var(--fs-base)' }}>Taxable accounts</h3>
                  <Lines rows={[
                    { label: 'Value', value: cell(input.taxableCents) },
                    { label: 'Cost basis', value: cell(input.taxableBasisCents) },
                  ]} />
                  <p className="an-note" style={{ margin: 0 }}>Conversion taxes are paid from here first.</p>
                </article>
                {hasHsa && (
                  <article className="an-card an-card--soft an-prop" aria-label="Health savings account">
                    <h3 className="an-h2" style={{ fontSize: 'var(--fs-base)' }}>Health savings account</h3>
                    <Lines rows={[
                      { label: 'Balance', value: cell(built.hsa) },
                      { label: 'Saved per year while working', value: cell(input.hsa?.contribCents ?? 0) },
                    ]} />
                    <p className="an-note" style={{ margin: 0 }}>Pays medical costs tax-free in retirement (set the yearly amount under Assumptions).</p>
                  </article>
                )}
              </div>
              {built.notes.map((n) => <p key={n} className="an-note">{n}</p>)}
              <h3 className="an-h3">Other income</h3>
              <OtherIncomeEditor items={s.other} onChange={(v) => setS({ other: v })} year0={year0} />
            </Collapsible>
          </div>

          <div id="roth-assume" className="pl-anchor" tabIndex={-1}>
            <Collapsible id="roth.assumptions" title="Assumptions">
              <p className="an-note" style={{ marginTop: 0 }}><Kind k="assumption">Your assumptions</Kind> The estimates shown in the labels come from your holdings; replace any of them. None of these is a prediction.</p>
              <div className="an-stack-col">
                <Fields legend="Timeline and spending">
                  <NumField label="Plan through the year the younger person turns" value={s.planAge} step={1} onChange={(n) => setS({ planAge: Math.round(n) })} />
                  <MoneyField label={`Spending in retirement per year, today’s $ (blank = Retirement tab)`} cents={s.spendingCents ?? 0} onChange={(c) => setS({ spendingCents: c || null })} />
                  {hasHsa && <MoneyField label="Medical costs the HSA pays per year in retirement, today’s $" cents={s.hsaMedicalCents} onChange={(c) => setS({ hsaMedicalCents: c })} />}
                </Fields>
                <Fields legend="Growth and prices">
                  <NumField label="Inflation %" value={s.inflationPct} step={0.1} onChange={(n) => setS({ inflationPct: n })} />
                  <NumField label="Wage growth %" value={s.wageGrowthPct} step={0.1} onChange={(n) => setS({ wageGrowthPct: n })} />
                  <NumField label={`Return, traditional % (estimate ${built.estReturn.trad.toFixed(1)})`} value={s.returnPct.trad ?? built.estReturn.trad} step={0.1} onChange={(n) => setS({ returnPct: { ...s.returnPct, trad: n } })} />
                  <NumField label={`Return, Roth % (estimate ${built.estReturn.roth.toFixed(1)})`} value={s.returnPct.roth ?? built.estReturn.roth} step={0.1} onChange={(n) => setS({ returnPct: { ...s.returnPct, roth: n } })} />
                  <NumField label={`Return, taxable % (estimate ${built.estReturn.taxable.toFixed(1)})`} value={s.returnPct.taxable ?? built.estReturn.taxable} step={0.1} onChange={(n) => setS({ returnPct: { ...s.returnPct, taxable: n } })} />
                  <NumField label={`Volatility % (estimate ${built.estVol.toFixed(1)})`} value={s.volPct ?? built.estVol} step={0.5} onChange={(n) => setS({ volPct: n })} />
                </Fields>
                <Fields legend="Taxable account and taxes">
                  <NumField label="Taxable account yield %" value={s.yieldPct} step={0.1} onChange={(n) => setS({ yieldPct: n })} />
                  <NumField label="…of which interest/ordinary %" value={s.yieldOrdinaryPct} step={5} onChange={(n) => setS({ yieldOrdinaryPct: n })} />
                  <NumField label="Tax rate on traditional money left at the end %" value={s.endTaxRatePct} step={1} onChange={(n) => setS({ endTaxRatePct: n })} />
                  <NumField label="Your heirs’ tax rate on traditional money %" value={s.heirTaxRatePct} step={1} onChange={(n) => setS({ heirTaxRatePct: n })} />
                </Fields>
                <Fields legend="Paying the conversion tax and health insurance" wide>
                  <label className="f">Pay the tax on conversions from
                    <select value={s.conversionTaxFrom} onChange={(e) => setS({ conversionTaxFrom: e.target.value as RothSettings['conversionTaxFrom'] })}>
                      <option value="outside">Outside money (taxable account first) — keeps the whole conversion in the Roth</option>
                      <option value="conversion">The converted amount itself — less lands in the Roth</option>
                    </select>
                  </label>
                  <label className="chk pl-formchk"><input type="checkbox" checked={s.aca.on} onChange={(e) => setS({ aca: { ...s.aca, on: e.target.checked } })} /> Buy health insurance on the ACA marketplace until Medicare at 65</label>
                  {s.aca.on && (
                    <>
                      <MoneyField label="Yearly premium of the benchmark (second-lowest silver) plan" cents={s.aca.benchmarkCents} onChange={(c) => setS({ aca: { ...s.aca, benchmarkCents: c } })} />
                      <NumField label="Premium growth % per year" value={s.aca.premiumGrowthPct} step={0.5} onChange={(n) => setS({ aca: { ...s.aca, premiumGrowthPct: n } })} />
                    </>
                  )}
                </Fields>
                {s.aca.on && <p className="an-note" style={{ margin: 0 }}>Leave health premiums out of your spending figure; the planner adds what you pay after the credit.</p>}
              </div>
            </Collapsible>
          </div>

          <div id="roth-strats" className="pl-anchor" tabIndex={-1}>
            <Collapsible id="roth.strategies" title="Strategies to compare" right={<button onClick={() => setS({ strategies: null })}>Reset to the starter set</button>}>
              <p className="an-note" style={{ marginTop: 0 }}>
                The first RMD year is {firstRmdYear(input)}; the plan runs through {planEndYear(input)}. “Fill a bracket” converts as much as keeps your ordinary income at the top of the chosen bracket each year.
              </p>
              <div className="pl-strats">
                {strategies.map((st) => (
                  <StrategyEditor key={st.id} s={st} canDelete={strategies.length > 1} onChange={(p) => editStrategy(st.id, p)} onDelete={() => setStrategies(strategies.filter((x) => x.id !== st.id))} />
                ))}
              </div>
              <div className="an-actions">
                <button
                  disabled={strategies.length >= 8}
                  onClick={() => setStrategies([...strategies, { ...NO_CONVERSION(input.startYear, Math.max(input.startYear, firstRmdYear(input) - 1)), id: newStrategyId(), label: 'New strategy', kind: 'bracket', bracketRate: 0.22 }])}
                >Add a strategy</button>
              </div>
            </Collapsible>
          </div>

          {compared && (
            <div id="roth-results" className="pl-anchor" tabIndex={-1}>
              <Collapsible id="roth.results" title="Results">
                <p className="an-note" style={{ marginTop: 0 }}><Kind k="projected">Projected</Kind> All dollar amounts below are in today’s dollars unless marked. “Cost” adds federal, Massachusetts, net investment income tax, Medicare IRMAA surcharges, and ACA premiums paid. These are modeled consequences, not transactions you have made.</p>
                <div className="an-tablewrap">
                  <table className="an-table an-matrix" aria-label="Strategy comparison">
                    <thead>
                      <tr><th>Strategy</th><th className="num">Converted</th><th className="num">Lifetime cost</th><th className="num">Federal</th><th className="num">MA</th><th className="num">IRMAA</th><th className="num">ACA premiums</th><th className="num">Left at the end</th><th className="num">After tax to heirs</th><th>Money lasts?</th></tr>
                    </thead>
                    <tbody>
                      {compared.results.map(({ strategy: st, result: r }) => {
                        const sm = r.summary;
                        const endY = planEndYear(input);
                        return (
                          <tr key={st.id} className={shown?.strategy.id === st.id ? 'is-picked' : ''}>
                            <td><button className="link" aria-pressed={shown?.strategy.id === st.id} onClick={() => setPicked(st.id)}>{st.label}</button>{winnerBadge(st.id)}</td>
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
                <p className="an-scrollhint">Scroll sideways to see every column. Choose a strategy’s name to see it year by year below.</p>
                {compared.results.some((r) => r.result.summary.failedYear !== null) && <p className="warn">A strategy that runs out of money is never picked as a winner.</p>}

                <h3 className="an-h3">Simulated futures <Kind k="projected">Simulated</Kind></h3>
                <p className="an-note" style={{ marginTop: 0 }}>
                  The table above uses steady returns. This runs {s.sims.toLocaleString()} random sequences of returns (the same ones for every strategy) to show how often the money lasts and the spread of what is left.
                </p>
                <div className="an-tools">
                  <NumField label="Futures" value={s.sims} step={100} onChange={(n) => setS({ sims: Math.max(50, Math.min(2000, Math.round(n))) })} />
                  <button className="primary" disabled={running} onClick={runMc}>{running ? 'Running…' : mc ? 'Run again' : 'Run simulations'}</button>
                  {mc && !mcFresh && !running && <span className="warn">Inputs changed since this ran.</span>}
                </div>
                {mc && (
                  <div className="an-tablewrap" style={{ marginTop: 'var(--sp-3)' }}>
                    <table className="an-table an-stack" aria-label="Simulated futures by strategy">
                      <thead><tr><th>Strategy</th><th className="num">Money lasts</th><th className="num">Left at end (10th / middle / 90th)</th><th className="num">To heirs (10th / middle / 90th)</th></tr></thead>
                      <tbody>
                        {strategies.map((st) => {
                          const m = mc.byId[st.id];
                          return m ? (
                            <tr key={st.id}>
                              <td className="an-full an-lead"><span className="an-title">{st.label}</span></td>
                              <td className="num" data-label="Money lasts"><strong>{m.successPct.toFixed(0)}%</strong></td>
                              <td className="num" data-label="Left at end (10th / middle / 90th)">{m.endWealthReal.map(compactUSD).join(' / ')}</td>
                              <td className="num" data-label="To heirs (10th / middle / 90th)">{m.heirsReal.map(compactUSD).join(' / ')}</td>
                            </tr>
                          ) : null;
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {shown && (
                  <>
                    <h3 className="an-h3">{shown.strategy.label}: year by year</h3>
                    {shown.result.warnings.map((w) => <p key={w} className="warn">{w}</p>)}
                    <LinesChart
                      title="Balances in today’s dollars"
                      subtitle="Traditional (taxed when withdrawn), Roth, and taxable"
                      xLabels={shown.result.rows.map((r) => `${r.year}-01-01`)}
                      fit
                      series={[
                        { label: 'Traditional', color: 'var(--s1)', values: shown.result.rows.map((r) => real(r.trad, r.year)) },
                        { label: 'Roth', color: 'var(--s2)', values: shown.result.rows.map((r) => real(r.roth, r.year)), dashed: true },
                        { label: 'Taxable', color: 'var(--s3)', values: shown.result.rows.map((r) => real(r.taxable, r.year)) },
                      ]}
                    />
                    <div className="an-tablewrap" style={{ marginTop: 'var(--sp-3)' }}>
                      <table className="an-table an-matrix" aria-label={`${shown.strategy.label}: year by year`}>
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
                    <p className="an-scrollhint">Scroll sideways to see every column.</p>
                    <p className="an-note">Dollar amounts in this table are in each year’s own dollars. {shown.result.rows.some((r) => r.unmet > 0) && 'Years with a shortfall show money that could not be found.'}</p>
                  </>
                )}
              </Collapsible>
            </div>
          )}

          <div id="roth-notes" className="pl-anchor" tabIndex={-1}>
            <Collapsible id="roth.notes" title="How this works and what it leaves out" defaultOpen={false}>
              <ul>
                <li>Conversions are made on January 1 and taxed in the same year. Taxes are computed with the joint-return rules (brackets, standard and senior deductions, Social Security taxation, capital-gains stacking, 3.8% net investment income tax) and Massachusetts’ 5% tax (4% surtax over its threshold; Social Security is not taxed there).</li>
                <li>Social Security, brackets, and deductions follow your inflation assumption. A few amounts are fixed in law and are not indexed: the Social Security taxation thresholds, the investment income tax threshold, and the temporary senior deduction (it ends after 2028). Tax law will change; rerun this as it does.</li>
                <li>Required withdrawals use the IRS uniform table and last year-end balances. A 401(k) is rolled into an IRA when its owner retires, which is also when it becomes convertible. After-tax IRA money is handled with the pro-rata rule.</li>
                <li>Before everyone retires, your wages cover spending and ordinary taxes; only the extra cost caused by a conversion (tax, IRMAA, lost ACA credit) is taken from savings. After that, spending plus all taxes come from Social Security, other income, RMDs, then the taxable account, then traditional, then Roth.</li>
                <li>Medicare IRMAA uses income from two years earlier, per person on Medicare. The ACA credit uses current-year income and a household of two; it vanishes above 400% of the poverty guideline.</li>
                <li>Left out: early-withdrawal penalties and the Roth five-year rules (convert and withdraw with those in mind if anyone is under 59½), HSAs, one spouse dying (survivor tax brackets and benefits), state tax outside Massachusetts, long-term care costs, and the 10-year inherited-account payout schedule (heirs’ tax is one flat rate you set).</li>
                <li>Random futures use one common market return each year for all accounts, with the volatility above.</li>
                {(RETIREMENT_RULES[planBaseTables(year0).year] ?? RETIREMENT_RULES_2026).notes.map((n) => <li key={n} className="muted">{n}</li>)}
              </ul>
            </Collapsible>
          </div>
        </>
      )}
    </div>
  );
}
