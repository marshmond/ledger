import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Goal, InvAccount } from '../types';
import { formatCents, todayISO } from '../lib/money';
import { buildIncomeModel } from '../lib/income';
import { buildProjection, DEFAULT_PROJECTION, type ProjectionSettings } from '../lib/projectionInput';
import { blendMix } from '../lib/retirement';
import { solveGoal, type GoalSolution } from '../lib/goals';
import { MoneyField, NumField } from './fields';

function GoalCard({ goal, accounts, ctxFor }: { goal: Goal; accounts: InvAccount[]; ctxFor: (g: Goal) => Parameters<typeof solveGoal>[1] | null }) {
  const [sol, setSol] = useState<{ s: GoalSolution; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const key = JSON.stringify(goal);
  const stale = sol && sol.key !== key;
  const year0 = Number(todayISO().slice(0, 4));
  const acct = accounts.find((a) => a.id === goal.accountId);
  const patch = (p: Partial<Goal>) => db.goals.update(goal.id!, p);

  async function calc() {
    const ctx = ctxFor(goal);
    if (!ctx) return;
    setBusy(true);
    await new Promise((r) => setTimeout(r, 30));
    setSol({ s: solveGoal(goal, ctx, acct?.annualContributionCents ?? 0, 3000, 1), key });
    setBusy(false);
  }

  const s = sol?.s;
  return (
    <div className="card">
      <div className="row spread">
        <input value={goal.name} style={{ fontWeight: 600 }} onChange={(e) => patch({ name: e.target.value })} />
        <button className="link danger" onClick={() => confirm(`Delete "${goal.name}"?`) && db.goals.delete(goal.id!)}>delete</button>
      </div>
      <div className="grid" style={{ marginTop: 6 }}>
        <label className="f">Funded by
          <select value={goal.accountId ?? ''} onChange={(e) => patch({ accountId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">No account (start from $0)</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <NumField label="First cost year" value={goal.startYear} step={1} onChange={(v) => patch({ startYear: Math.round(v) })} />
        <NumField label="Years of costs" value={goal.years} step={1} onChange={(v) => patch({ years: Math.max(1, Math.round(v)) })} />
        <MoneyField key={`c${goal.annualCostCents}`} label="Cost per year (today's $)" cents={goal.annualCostCents} onChange={(c) => patch({ annualCostCents: c })} />
        <NumField label="Cost inflation (%/yr)" value={goal.costInflationPct} step={0.5} onChange={(v) => patch({ costInflationPct: v })} />
        <NumField label="Share you will fund (%)" value={goal.fundingPct} step={5} onChange={(v) => patch({ fundingPct: Math.min(100, Math.max(0, v)) })} />
        <NumField label="Contribution grows (%/yr)" value={goal.contributionGrowthPct} step={0.5} onChange={(v) => patch({ contributionGrowthPct: v })} />
        <NumField label="Be sure in (% of futures)" value={goal.confidencePct} step={5} onChange={(v) => patch({ confidencePct: Math.min(99, Math.max(50, v)) })} />
      </div>
      <p className="muted">
        {acct
          ? `${acct.name} currently holds ${formatCents(acct.cashCents)} cash plus holdings, and is invested in its current mix. Its planned contribution (set on Projections) is ${formatCents(acct.annualContributionCents)}/yr.`
          : 'Pick the account that will pay for this so its balance and mix are used.'}
      </p>
      <div className="row">
        <button className="primary" disabled={busy || goal.annualCostCents <= 0} onClick={calc}>{busy ? 'Calculating…' : 'Calculate contribution needed'}</button>
        {goal.annualCostCents <= 0 && <span className="muted">Enter the yearly cost first.</span>}
        {stale && <span className="muted">Inputs changed; recalculate.</span>}
      </div>

      {s && !stale && (
        <div className="viz" style={{ marginTop: 8 }}>
          <div className="muted">
            Total cost, {goal.years} year{goal.years === 1 ? '' : 's'} from {goal.startYear}, in future dollars: <strong>{formatCents(Math.round(s.model.totalCost))}</strong>
          </div>
          {s.noTimeToSave ? (
            <p className="warn">
              Costs begin within the year, so new contributions have almost no time to grow. {s.confidenceAnnual > 0
                ? `The money already set aside falls short; closing the gap would take roughly ${formatCents(Math.round(s.confidenceAnnual))} more.` : 'The money already set aside covers it.'}
            </p>
          ) : (
            <>
              <div className="tiles">
                <div className="tile">
                  <div className="muted">To be {goal.confidencePct}% sure</div>
                  <div className="v">{formatCents(Math.round(s.confidenceAnnual))}/yr</div>
                  <div className="muted">{formatCents(Math.round(s.confidenceAnnual / 12))}/month</div>
                </div>
                <div className="tile">
                  <div className="muted">If returns are exactly average</div>
                  <div className="v">{formatCents(Math.round(s.steadyAnnual))}/yr</div>
                  <div className="muted">{formatCents(Math.round(s.steadyAnnual / 12))}/month</div>
                </div>
                <div className="tile">
                  <div className="muted">On your planned {formatCents(acct?.annualContributionCents ?? 0)}/yr</div>
                  <div className="v" style={{ color: s.currentSuccessPct >= goal.confidencePct ? 'var(--pos)' : 'var(--neg)' }}>{s.currentSuccessPct.toFixed(0)}% funded</div>
                  <div className="muted">{s.currentShortfallYear ? `average path falls short in ${s.currentShortfallYear}` : 'average path fully funds it'}</div>
                </div>
              </div>
              <p className="muted">
                Contributions are for the first year{goal.contributionGrowthPct ? ` and grow ${goal.contributionGrowthPct}% a year after` : ' and stay flat'}, and stop when costs begin ({year0 < goal.startYear ? `${goal.startYear}` : 'now'}).
                {' '}The “{goal.confidencePct}% sure” figure is higher because real returns bounce around: it leaves room for a weak stretch in the years before costs begin.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function GoalsPage() {
  const year0 = Number(todayISO().slice(0, 4));
  const accounts = useLiveQuery(() => db.invAccounts.toArray(), []) ?? [];
  const holdings = useLiveQuery(() => db.holdings.toArray(), []) ?? [];
  const securities = useLiveQuery(() => db.securities.toArray(), []) ?? [];
  const classes = useLiveQuery(() => db.assetClasses.toArray(), []) ?? [];
  const people = useLiveQuery(() => db.people.toArray(), []) ?? [];
  const profiles = useLiveQuery(() => db.incomeProfiles.toArray(), []) ?? [];
  const bonuses = useLiveQuery(() => db.bonuses.toArray(), []) ?? [];
  const taxSettings = useLiveQuery(() => db.taxSettings.toArray(), []) ?? [];
  const goals = useLiveQuery(() => db.goals.toArray(), []) ?? [];
  const savedP = useLiveQuery(() => db.settings.get('projection'), []);
  const ps: ProjectionSettings = { ...DEFAULT_PROJECTION, ...((savedP?.value as Partial<ProjectionSettings>) ?? {}) };

  const incomeModel = useMemo(
    () => buildIncomeModel(year0, people, profiles, bonuses, taxSettings.find((t) => t.year === year0)),
    [year0, people, profiles, bonuses, taxSettings],
  );
  const built = useMemo(() => {
    const open = accounts.filter((a) => !a.closed);
    if (open.length === 0 || classes.length === 0) return null;
    return buildProjection({ accounts, holdings, securities, assetClasses: classes }, incomeModel.years, ps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, holdings, securities, classes, incomeModel, ps.years, ps.inflationPct]);

  const ctxFor = (g: Goal) => {
    if (!built) return null;
    return {
      year0,
      inflation: ps.inflationPct / 100,
      classes: built.input.classes,
      account: built.input.accounts.find((a) => a.id === g.accountId),
      fallbackWeights: blendMix(built.input.accounts),
    };
  };

  const education = accounts.filter((a) => !a.closed);
  async function addGoal() {
    const first529 = accounts.find((a) => a.kind === '529' && !a.closed);
    await db.goals.add({
      name: 'College',
      accountId: first529?.id ?? null,
      startYear: year0 + 15,
      years: 4,
      annualCostCents: 0,
      // College costs have historically risen faster than general inflation; this is an assumption you can edit.
      costInflationPct: 4,
      fundingPct: 100,
      contributionGrowthPct: 0,
      confidencePct: 80,
    });
  }

  return (
    <>
      <h1>Goals</h1>
      <p className="muted">
        Set a goal like a child’s college costs, and see how much to put in each year (or month) so the money is there. Each goal uses the balance and
        mix of the account that funds it, and the return assumptions from <Link to="/investments">Investments</Link>. Costs are drawn from the account
        once they begin, and the account keeps growing while it is being spent.
      </p>
      {education.length === 0 && <p className="warn">Add the account (for example a 529) on the Investments page first.</p>}
      {goals.map((g) => <GoalCard key={g.id} goal={g} accounts={education} ctxFor={ctxFor} />)}
      <button className="primary" onClick={addGoal} disabled={education.length === 0}>+ Add a goal</button>
      <div className="card" style={{ marginTop: 12 }}>
        <strong>How it works</strong>
        <ul className="muted">
          <li><strong>To be 80% sure</strong> means the money covers every cost year in at least 80 of 100 simulated futures. It is the figure to plan around.</li>
          <li><strong>If returns are exactly average</strong> assumes a smooth path. It is the minimum, because real markets are bumpy.</li>
          <li>To use the answer, enter that yearly amount as the account’s contribution on the <Link to="/projections">Projections</Link> page.</li>
          <li>Tuition-type costs are state- and school-specific; the cost and cost-inflation fields are yours to set. Scholarships, financial aid, and tax rules for 529 withdrawals are not modeled.</li>
        </ul>
      </div>
    </>
  );
}
