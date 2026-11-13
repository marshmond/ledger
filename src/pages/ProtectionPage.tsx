import { useMemo, useState } from 'react';
import { Link } from '../core/router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { formatCents, todayISO } from '../lib/money';
import { addMonths } from '../lib/dates';
import { buildIncomeModel } from '../lib/income';
import { loadNetWorth } from '../lib/netWorthLive';
import { lastMonths, spendingMatrix } from '../lib/reports';
import { POLICY_LABEL, disabilityNeed, emergencyFund, findings, lifeNeed, newPolicy, umbrellaNeed, type Policy, type PolicyType } from '../lib/protection';
import Collapsible from './Collapsible';
import { MoneyField, NumField } from './fields';
import { useInsurance } from './useInsurance';
import { PageHeader } from '../ui/components';
import { Kind, Lines, PlanChecks, PlanHero, PlanJump } from './PlanParts';
import './analysis.css';
import './plan.css';

interface ProtectionSettings {
  monthlyOverrideCents: number | null;
  yearsOfIncome: number;
  subtractAssets: boolean;
  dependents: boolean;
}
const DEFAULTS: ProtectionSettings = { monthlyOverrideCents: null, yearsOfIncome: 10, subtractAssets: false, dependents: true };
const FINDING_WORDS = { ok: 'Looks fine', info: 'Note', warn: 'Needs attention' } as const;

type Ins = ReturnType<typeof useInsurance>;

/** One policy's editor. Defined outside the page so typing does not lose focus. */
function PolicyRow({ p, people, ins }: { p: Policy; people: { id?: number; name: string }[]; ins: Ins }) {
  const nameOf = (id: number | null) => (id === null ? 'Household' : people.find((x) => x.id === id)?.name ?? '?');
  const label = `${POLICY_LABEL[p.type]}${p.personId !== null ? `, ${nameOf(p.personId)}` : ''}`;
  return (
    <article className="an-card an-card--soft pl-policy" aria-label={label}>
      <header className="an-head" style={{ marginBottom: 'var(--sp-2)' }}>
        <h3 className="an-h2" style={{ fontSize: 'var(--fs-base)' }}>{POLICY_LABEL[p.type]}{p.personId !== null && <span className="muted"> · {nameOf(p.personId)}</span>} <Kind k="recorded">Recorded</Kind></h3>
        <button className="link danger" aria-label={`Delete ${label}`} onClick={() => confirm('Delete this policy?') && ins.remove(p.id)}>delete</button>
      </header>
      <ul className="an-chipline pl-policy-facts" aria-label="Policy summary">
        <li><span className="an-chip">Coverage <b>{formatCents(p.coverageCents)}</b></span></li>
        {p.type === 'disability' && <li><span className="an-chip">Monthly benefit <b>{formatCents(p.monthlyBenefitCents)}</b></span></li>}
        <li><span className="an-chip">Premium <b>{formatCents(p.annualPremiumCents)}</b> / yr</span></li>
        {p.company && <li><span className="an-chip">{p.company}</span></li>}
      </ul>
      <div className="an-form an-form--wide">
        <label className="f">Company<input value={p.company} onChange={(e) => ins.update(p.id, { company: e.target.value })} /></label>
        <label className="f">Policy number<input value={p.policyNumber} onChange={(e) => ins.update(p.id, { policyNumber: e.target.value })} /></label>
        {(p.type === 'life' || p.type === 'disability' || p.type === 'ltc') && (
          <label className="f">Insured
            <select value={p.personId ?? ''} onChange={(e) => ins.update(p.id, { personId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Household / not sure</option>
              {people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
        )}
        <MoneyField key={`c${p.id}`} label={p.type === 'umbrella' || p.type === 'home' || p.type === 'auto' ? 'Coverage / limit' : 'Coverage (death benefit)'} cents={p.coverageCents} onChange={(c) => ins.update(p.id, { coverageCents: c })} />
        {p.type === 'disability' && <MoneyField key={`b${p.id}`} label="Monthly benefit" cents={p.monthlyBenefitCents} onChange={(c) => ins.update(p.id, { monthlyBenefitCents: c })} />}
        <MoneyField key={`a${p.id}`} label="Premium per year" cents={p.annualPremiumCents} onChange={(c) => ins.update(p.id, { annualPremiumCents: c })} />
        <label className="f">Beneficiary<input value={p.beneficiary} onChange={(e) => ins.update(p.id, { beneficiary: e.target.value })} /></label>
      </div>
      <label className="f" style={{ marginTop: 'var(--sp-3)' }}>Notes<input value={p.note} onChange={(e) => ins.update(p.id, { note: e.target.value })} placeholder="Through employer, term ends 2040…" /></label>
    </article>
  );
}

/** Emergency fund runway and rough insurance guidelines, with the policies you have entered. */
export default function ProtectionPage() {
  const today = todayISO();
  const year = Number(today.slice(0, 4));
  const people = useLiveQuery(() => db.people.toArray(), []) ?? [];
  const profiles = useLiveQuery(() => db.incomeProfiles.toArray(), []) ?? [];
  const bonuses = useLiveQuery(() => db.bonuses.toArray(), []) ?? [];
  const taxSettings = useLiveQuery(() => db.taxSettings.toArray(), []) ?? [];
  const txns = useLiveQuery(() => db.txns.toArray(), []) ?? [];
  const categories = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const goals = useLiveQuery(() => db.goals.toArray(), []) ?? [];
  const nw = useLiveQuery(() => loadNetWorth(db, today), [today]);
  const saved = useLiveQuery(() => db.settings.get('protection'), []);
  const s: ProtectionSettings = { ...DEFAULTS, ...((saved?.value as Partial<ProtectionSettings>) ?? {}) };
  const setS = (p: Partial<ProtectionSettings>) => db.settings.put({ key: 'protection', value: { ...s, ...p } });
  const ins = useInsurance();
  const [type, setType] = useState<PolicyType>('life');

  const income = useMemo(() => buildIncomeModel(year, people, profiles, bonuses, taxSettings.find((t) => t.year === year)), [year, people, profiles, bonuses, taxSettings]);
  const estimate = useMemo(() => {
    const months = lastMonths(addMonths(`${today.slice(0, 7)}-01`, -1).slice(0, 7), 3);
    const m = spendingMatrix(txns, categories, months);
    const used = m.spent.filter((v) => v > 0);
    return used.length ? Math.round(used.reduce((a, b) => a + b, 0) / used.length) : 0;
  }, [txns, categories, today]);
  const monthly = s.monthlyOverrideCents ?? estimate;

  const grossOf = (id: number) => {
    const y = income.years.find((x) => x.personId === id);
    return y ? y.totals.gross - y.totals.rsuGross : 0;
  };
  const earners = people.filter((p) => grossOf(p.id!) > 0).length;
  const cash = nw?.cash ?? 0;
  const debts = nw ? -(nw.cards + nw.loans) : 0;
  const assets = nw ? nw.cash + nw.investments : 0;
  const education = goals.reduce((a, g) => a + Math.round((g.annualCostCents * g.years * g.fundingPct) / 100), 0);
  const fund = emergencyFund(cash, monthly, earners);
  const umbrellaCover = ins.policies.filter((p) => p.type === 'umbrella').reduce((a, p) => a + p.coverageCents, 0);
  const umbrella = umbrellaNeed(nw?.total ?? 0, umbrellaCover);

  const perPerson = people.map((p) => {
    const gross = grossOf(p.id!);
    const lifeCover = ins.policies.filter((x) => x.type === 'life' && (x.personId === p.id || x.personId === null)).reduce((a, x) => a + x.coverageCents, 0);
    const disBenefit = ins.policies.filter((x) => x.type === 'disability' && x.personId === p.id).reduce((a, x) => a + x.monthlyBenefitCents, 0);
    return {
      id: p.id!, name: p.name, grossAnnualCents: gross,
      life: lifeNeed({ grossAnnualCents: gross, yearsOfIncome: s.yearsOfIncome, debtsCents: debts, educationCents: education, assetsCents: assets, subtractAssets: s.subtractAssets, coverageCents: lifeCover }),
      disability: disabilityNeed(gross, disBenefit),
      hasLifePolicy: ins.policies.some((x) => x.type === 'life' && (x.personId === p.id || x.personId === null)),
      hasDisabilityPolicy: ins.policies.some((x) => x.type === 'disability' && x.personId === p.id),
    };
  });
  const found = findings({ fund, people: perPerson, umbrella, dependents: s.dependents, fmt: formatCents });

  return (
    <div className="an-page pl-page">
      <PageHeader eyebrow="Plan" title="Protection check" description="Emergency-fund runway and insurance guidelines." about={<>How long your cash would last, and rough guidelines for life, disability, and umbrella insurance against the coverage you enter. These are common rules of thumb, not advice
        about what you should buy. Employer coverage counts: add it below.</>} />

      <PlanHero
        label="Emergency fund runway"
        kind={<Kind k="guideline">Guideline</Kind>}
        amount={fund.months === null ? '—' : `${fund.months.toFixed(1)} months`}
        message={<>How many months of spending your cash would cover, against a rule-of-thumb target of {fund.targetMonths} months. {fund.status === 'low' ? <strong>That is below the target.</strong> : null}</>}
        figs={[
          { label: 'Cash (checking and savings)', value: formatCents(cash), kind: <Kind k="recorded">Recorded</Kind> },
          { label: 'Monthly spending', value: formatCents(monthly), sub: s.monthlyOverrideCents === null ? 'from your last 3 months' : 'entered by you' },
          { label: 'Target', value: `${fund.targetMonths} months`, kind: <Kind k="guideline">Guideline</Kind> },
        ]}
      />

      <section className="an-card" aria-labelledby="pr-found">
        <h2 className="an-h2" id="pr-found">What the guidelines found <Kind k="guideline">Rules of thumb</Kind></h2>
        <p className="an-note">These compare what you have entered with common guidelines. They are not advice about what to buy.</p>
        <PlanChecks label="Findings" words={FINDING_WORDS} items={found.map((f) => ({ id: f.id, level: f.level, title: f.title, detail: f.detail }))} />
      </section>

      <PlanJump items={[
        { id: 'pr-fund', label: 'Emergency fund' },
        { id: 'pr-life', label: 'Life and disability' },
        { id: 'pr-umb', label: 'Umbrella liability' },
        { id: 'pr-pol', label: 'Your policies' },
      ]} />

      <h2 className="an-h2 pl-subhead">Guideline estimates <Kind k="guideline">Calculated from rules of thumb</Kind></h2>

      <div id="pr-fund" className="pl-anchor" tabIndex={-1}>
        <Collapsible id="protect.fund" title="Emergency fund">
          <div className="an-form an-form--wide">
            <MoneyField key={`m${s.monthlyOverrideCents}`} label="Monthly spending to cover (blank = from history)" cents={s.monthlyOverrideCents ?? 0} onChange={(c) => setS({ monthlyOverrideCents: c || null })} />
          </div>
          <p className="an-note">Use only what you could not skip: housing, food, insurance, debt payments. {earners <= 1 ? 'One income, so the target is 6 months.' : 'Two incomes, so the target is 4 months.'}</p>
        </Collapsible>
      </div>

      <div id="pr-life" className="pl-anchor" tabIndex={-1}>
        <Collapsible id="protect.life" title="Life and disability">
          <div className="an-form an-form--wide">
            <NumField label="Years of income to replace" value={s.yearsOfIncome} step={1} onChange={(n) => setS({ yearsOfIncome: Math.max(1, Math.round(n)) })} />
          </div>
          <div className="an-checks">
            <label className="chk"><input type="checkbox" checked={s.subtractAssets} onChange={(e) => setS({ subtractAssets: e.target.checked })} /> Count my savings and investments against the need</label>
            <label className="chk"><input type="checkbox" checked={s.dependents} onChange={(e) => setS({ dependents: e.target.checked })} /> Someone depends on my income</label>
          </div>
          <div className="an-tablewrap" style={{ marginTop: 'var(--sp-4)' }}>
            <table className="an-table an-stack" aria-label="Life and disability needs by person">
              <thead>
                <tr>
                  <th>Person</th>
                  <th className="num">Income</th>
                  <th className="num">Life: rough need<span className="an-sub">Guideline</span></th>
                  <th className="num">Coverage<span className="an-sub">Recorded</span></th>
                  <th className="num">Gap</th>
                  <th className="num">Disability: needed / mo<span className="an-sub">Guideline</span></th>
                  <th className="num">Benefit / mo<span className="an-sub">Recorded</span></th>
                </tr>
              </thead>
              <tbody>
                {perPerson.map((p) => (
                  <tr key={p.id}>
                    <td className="an-full an-lead"><span className="an-title">{p.name}</span></td>
                    <td className="num" data-label="Income">{formatCents(p.grossAnnualCents)}</td>
                    <td className="num" data-label="Life: rough need (guideline)">{formatCents(p.life.netNeedCents)}</td>
                    <td className="num" data-label="Coverage (recorded)">{formatCents(p.life.coverageCents)}</td>
                    <td className="num" data-label="Gap">{formatCents(p.life.gapCents)}<span className="an-sub">{p.life.gapCents > 0 ? 'Below the guideline' : 'Meets the guideline'}</span></td>
                    <td className="num" data-label="Disability: needed / mo (guideline)">{formatCents(p.disability.neededMonthlyCents)}</td>
                    <td className="num" data-label="Benefit / mo (recorded)">{formatCents(p.disability.benefitMonthlyCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="an-note">
            Life need = income × years + all your debts ({formatCents(debts)}) + education costs from your <Link to="/goals">goals</Link> ({formatCents(education)}). Disability need is 60% of pay, the share most plans replace.
          </p>
        </Collapsible>
      </div>

      <div id="pr-umb" className="pl-anchor" tabIndex={-1}>
        <Collapsible id="protect.umbrella" title="Umbrella liability">
          <Lines rows={[
            { label: 'Net worth', value: formatCents(nw?.total ?? 0) },
            { label: <>Suggested limit <Kind k="guideline">Guideline</Kind></>, value: formatCents(umbrella.suggestedCents), strong: true },
            { label: <>Entered <Kind k="recorded">Recorded</Kind></>, value: formatCents(umbrella.coverageCents), strong: true },
          ]} />
          <p className="an-note">An umbrella policy pays when a lawsuit exceeds your home and auto liability limits. The usual guideline is a limit at least as large as what a plaintiff could go after.</p>
        </Collapsible>
      </div>

      <h2 className="an-h2 pl-subhead">Your recorded policies <Kind k="recorded">What you entered</Kind></h2>

      <div id="pr-pol" className="pl-anchor" tabIndex={-1}>
        <Collapsible id="protect.policies" title="Your policies">
          {ins.policies.length === 0 && <p className="muted">None entered yet. Add each policy, including coverage through an employer, so the checks above are accurate. Policy numbers are stored only on this device.</p>}
          <div className="an-stack-col">
            {ins.policies.map((p) => <PolicyRow key={p.id} p={p} people={people} ins={ins} />)}
          </div>
          <div className="an-tools" style={{ marginTop: 'var(--sp-4)' }}>
            <label className="f">Add a policy
              <select value={type} onChange={(e) => setType(e.target.value as PolicyType)}>{(Object.keys(POLICY_LABEL) as PolicyType[]).map((t) => <option key={t} value={t}>{POLICY_LABEL[t]}</option>)}</select>
            </label>
            <button className="primary" onClick={() => ins.add(newPolicy(type, ['life', 'disability', 'ltc'].includes(type) ? people[0]?.id ?? null : null))}>Add</button>
          </div>
        </Collapsible>
      </div>
    </div>
  );
}
