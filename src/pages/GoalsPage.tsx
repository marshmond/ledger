import { useMemo, useState } from 'react';
import { Link } from '../core/router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Goal, InvAccount } from '../types';
import { formatCents, todayISO } from '../lib/money';
import { buildIncomeModel } from '../lib/income';
import { buildProjection, DEFAULT_PROJECTION, type ProjectionSettings } from '../lib/projectionInput';
import { blendMix } from '../lib/retirement';
import { solveGoal, type GoalSolution } from '../lib/goals';
import { MoneyField, NumField } from './fields';
import { PageHeader } from '../ui/components';
import { Fields, Kind, PlanFigs } from './PlanParts';
import './analysis.css';
import './plan.css';

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
  // A new goal (no cost yet) opens its settings so the first thing to do is visible; a goal with a cost keeps them folded behind a summary.
  const [open, setOpen] = useState(goal.annualCostCents <= 0);
  const nameId = `goal-${goal.id}`;
  return (
    <article className="an-card pl-goal" aria-labelledby={nameId}>
      <h2 className="pl-vh" id={nameId}>Goal: {goal.name}</h2>
      <header className="pl-goal-head">
        <input aria-label="Goal name" className="pl-goal-name" value={goal.name} onChange={(e) => patch({ name: e.target.value })} />
        <button className="link danger" aria-label={`Delete goal ${goal.name}`} onClick={() => confirm(`Delete "${goal.name}"?`) && db.goals.delete(goal.id!)}>delete</button>
      </header>
      <ul className="an-chipline pl-goal-facts" aria-label="Goal summary">
        <li><span className="an-chip">Funded by <b>{acct ? acct.name : 'no account yet'}</b></span></li>
        <li><span className="an-chip">Costs begin <b>{goal.startYear}</b></span></li>
        <li><span className="an-chip">Years of costs <b>{goal.years}</b></span></li>
        <li><span className="an-chip">Cost per year <b>{formatCents(goal.annualCostCents)}</b> today’s $</span></li>
        <li><span className="an-chip">You fund <b>{goal.fundingPct}%</b></span></li>
      </ul>
      <p className="an-note pl-goal-acct">
        {acct
          ? `${acct.name} currently holds ${formatCents(acct.cashCents)} cash plus holdings, and is invested in its current mix. Its planned contribution (set on Projections) is ${formatCents(acct.annualContributionCents)}/yr.`
          : 'Pick the account that will pay for this so its balance and mix are used.'}
      </p>

      <details className="pl-detail" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>Goal settings <Kind k="input">Your inputs</Kind></summary>
        <div className="an-stack-col" style={{ marginTop: 'var(--sp-3)' }}>
          <Fields legend="The cost">
            <MoneyField key={`c${goal.annualCostCents}`} label="Cost per year (today's $)" cents={goal.annualCostCents} onChange={(c) => patch({ annualCostCents: c })} />
            <NumField label="Cost inflation (%/yr)" value={goal.costInflationPct} step={0.5} onChange={(v) => patch({ costInflationPct: v })} />
            <NumField label="First cost year" value={goal.startYear} step={1} onChange={(v) => patch({ startYear: Math.round(v) })} />
            <NumField label="Years of costs" value={goal.years} step={1} onChange={(v) => patch({ years: Math.max(1, Math.round(v)) })} />
            <NumField label="Share you will fund (%)" value={goal.fundingPct} step={5} onChange={(v) => patch({ fundingPct: Math.min(100, Math.max(0, v)) })} />
          </Fields>
          <Fields legend="How it is funded">
            <label className="f">Funded by
              <select value={goal.accountId ?? ''} onChange={(e) => patch({ accountId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">No account (start from $0)</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <NumField label="Contribution grows (%/yr)" value={goal.contributionGrowthPct} step={0.5} onChange={(v) => patch({ contributionGrowthPct: v })} />
            <NumField label="Be sure in (% of futures)" value={goal.confidencePct} step={5} onChange={(v) => patch({ confidencePct: Math.min(99, Math.max(50, v)) })} />
          </Fields>
        </div>
      </details>

      <div className="an-actions">
        <button className="primary" disabled={busy || goal.annualCostCents <= 0} onClick={calc}>{busy ? 'Calculating…' : 'Calculate contribution needed'}</button>
        {goal.annualCostCents <= 0 && <span className="an-note" style={{ margin: 0 }}>Enter the yearly cost first.</span>}
        {stale && <span className="an-note" style={{ margin: 0 }}>Inputs changed; recalculate.</span>}
      </div>

      {s && !stale && (
        <div className="pl-goal-result an-stack-col" role="status">
          <p className="an-note" style={{ margin: 0 }}>
            <Kind k="projected">Projected</Kind> Total cost, {goal.years} year{goal.years === 1 ? '' : 's'} from {goal.startYear}, in future dollars: <strong>{formatCents(Math.round(s.model.totalCost))}</strong>
          </p>
          {s.noTimeToSave ? (
            <p className="warn" style={{ margin: 0 }}>
              Costs begin within the year, so new contributions have almost no time to grow. {s.confidenceAnnual > 0
                ? `The money already set aside falls short; closing the gap would take roughly ${formatCents(Math.round(s.confidenceAnnual))} more.` : 'The money already set aside covers it.'}
            </p>
          ) : (
            <>
              <PlanFigs
                label="Modeled contribution needed"
                figs={[
                  { label: `To be ${goal.confidencePct}% sure`, value: `${formatCents(Math.round(s.confidenceAnnual))}/yr`, sub: `${formatCents(Math.round(s.confidenceAnnual / 12))}/month` },
                  { label: 'If returns are exactly average', value: `${formatCents(Math.round(s.steadyAnnual))}/yr`, sub: `${formatCents(Math.round(s.steadyAnnual / 12))}/month` },
                  { label: `On your planned ${formatCents(acct?.annualContributionCents ?? 0)}/yr`, value: `${s.currentSuccessPct.toFixed(0)}% funded`, sub: `${s.currentSuccessPct >= goal.confidencePct ? `meets your ${goal.confidencePct}% goal; ` : `below your ${goal.confidencePct}% goal; `}${s.currentShortfallYear ? `average path falls short in ${s.currentShortfallYear}` : 'average path fully funds it'}` },
                ]}
              />
              <p className="an-note" style={{ margin: 0 }}>
                Contributions are for the first year{goal.contributionGrowthPct ? ` and grow ${goal.contributionGrowthPct}% a year after` : ' and stay flat'}, and stop when costs begin ({year0 < goal.startYear ? `${goal.startYear}` : 'now'}).
                {' '}The “{goal.confidencePct}% sure” figure is higher because real returns bounce around: it leaves room for a weak stretch in the years before costs begin.
              </p>
            </>
          )}
        </div>
      )}
    </article>
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
  const rsuVests = useLiveQuery(() => db.rsuVests.toArray(), []) ?? [];
  const goals = useLiveQuery(() => db.goals.toArray(), []) ?? [];
  const savedP = useLiveQuery(() => db.settings.get('projection'), []);
  const ps: ProjectionSettings = { ...DEFAULT_PROJECTION, ...((savedP?.value as Partial<ProjectionSettings>) ?? {}) };

  const incomeModel = useMemo(
    () => buildIncomeModel(year0, people, profiles, bonuses, taxSettings.find((t) => t.year === year0), { vests: rsuVests, securities }),
    [year0, people, profiles, bonuses, taxSettings, rsuVests, securities],
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
    <div className="an-page pl-page">
      <PageHeader eyebrow="Plan" title="Goals" description="How much to save each year for a goal like college." about={<>Set a goal like a child’s college costs, and see how much to put in each year (or month) so the money is there. Each goal uses the balance and
        mix of the account that funds it, and the return assumptions from <Link to="/investments">Investments</Link>. Costs are drawn from the account
        once they begin, and the account keeps growing while it is being spent.</>} />
      {education.length === 0 && <p className="warn">Add the account (for example a 529) on the Investments page first.</p>}
      <div className="an-split">
        <div className="an-stack-col">
          {goals.length === 0 && education.length > 0 && <p className="an-note" style={{ margin: 0 }}>No goals yet. Add one to see how much to save each year.</p>}
          {goals.map((g) => <GoalCard key={g.id} goal={g} accounts={education} ctxFor={ctxFor} />)}
          <div><button className="primary" onClick={addGoal} disabled={education.length === 0}>+ Add a goal</button></div>
        </div>
        <section className="an-card an-card--soft pl-sticky" aria-labelledby="goals-how">
          <h2 className="an-h2" id="goals-how" style={{ fontSize: 'var(--fs-base)' }}>How it works</h2>
          <ul className="muted">
            <li><strong>To be 80% sure</strong> means the money covers every cost year in at least 80 of 100 simulated futures. It is the figure to plan around.</li>
            <li><strong>If returns are exactly average</strong> assumes a smooth path. It is the minimum, because real markets are bumpy.</li>
            <li>To use the answer, enter that yearly amount as the account’s contribution on the <Link to="/projections">Projections</Link> page.</li>
            <li>Tuition-type costs are state- and school-specific; the cost and cost-inflation fields are yours to set. Scholarships, financial aid, and tax rules for 529 withdrawals are not modeled.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
