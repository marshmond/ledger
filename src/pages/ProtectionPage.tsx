import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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

interface ProtectionSettings {
  monthlyOverrideCents: number | null;
  yearsOfIncome: number;
  subtractAssets: boolean;
  dependents: boolean;
}
const DEFAULTS: ProtectionSettings = { monthlyOverrideCents: null, yearsOfIncome: 10, subtractAssets: false, dependents: true };

type Ins = ReturnType<typeof useInsurance>;

/** One policy's editor. Defined outside the page so typing does not lose focus. */
function PolicyRow({ p, people, ins }: { p: Policy; people: { id?: number; name: string }[]; ins: Ins }) {
  const nameOf = (id: number | null) => (id === null ? 'Household' : people.find((x) => x.id === id)?.name ?? '?');
  return (
    <div className="card">
      <div className="row spread">
        <strong>{POLICY_LABEL[p.type]}{p.personId !== null && <span className="muted"> · {nameOf(p.personId)}</span>}</strong>
        <button className="link danger" onClick={() => confirm('Delete this policy?') && ins.remove(p.id)}>delete</button>
      </div>
      <div className="grid">
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
      <label className="f">Notes<input value={p.note} onChange={(e) => ins.update(p.id, { note: e.target.value })} placeholder="Through employer, term ends 2040…" /></label>
    </div>
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
    <>
      <h1>Protection check</h1>
      <p className="muted">
        How long your cash would last, and rough guidelines for life, disability, and umbrella insurance against the coverage you enter. These are common rules of thumb, not advice
        about what you should buy. Employer coverage counts: add it below.
      </p>

      <ul className="checklist">
        {found.map((f) => (
          <li key={f.id} className={`check ${f.level === 'warn' ? 'todo' : f.level === 'ok' ? 'ok' : 'info'}`}>
            <span className="mark" aria-hidden="true">{f.level === 'ok' ? '✓' : f.level === 'warn' ? '!' : 'i'}</span>
            <div><strong>{f.title}</strong><div className="muted">{f.detail}</div></div>
          </li>
        ))}
      </ul>

      <Collapsible id="protect.fund" title="Emergency fund">
        <div className="tiles">
          <div className="tile"><div className="muted">Cash (checking and savings)</div><div className="v">{formatCents(cash)}</div></div>
          <div className="tile"><div className="muted">Monthly spending</div><div className="v">{formatCents(monthly)}</div><div className="muted" style={{ fontSize: '0.8rem' }}>{s.monthlyOverrideCents === null ? 'from your last 3 months' : 'entered by you'}</div></div>
          <div className="tile"><div className="muted">Months covered</div><div className={`v ${fund.status === 'low' ? 'neg' : ''}`}>{fund.months === null ? '—' : fund.months.toFixed(1)}</div></div>
          <div className="tile"><div className="muted">Target</div><div className="v">{fund.targetMonths} months</div></div>
        </div>
        <div className="row">
          <MoneyField key={`m${s.monthlyOverrideCents}`} label="Monthly spending to cover (blank = from history)" cents={s.monthlyOverrideCents ?? 0} onChange={(c) => setS({ monthlyOverrideCents: c || null })} width={130} />
          <span className="muted">Use only what you could not skip: housing, food, insurance, debt payments. {earners <= 1 ? 'One income, so the target is 6 months.' : 'Two incomes, so the target is 4 months.'}</span>
        </div>
      </Collapsible>

      <Collapsible id="protect.life" title="Life and disability">
        <div className="row">
          <NumField label="Years of income to replace" value={s.yearsOfIncome} step={1} width={100} onChange={(n) => setS({ yearsOfIncome: Math.max(1, Math.round(n)) })} />
          <label className="chk"><input type="checkbox" checked={s.subtractAssets} onChange={(e) => setS({ subtractAssets: e.target.checked })} /> Count my savings and investments against the need</label>
          <label className="chk"><input type="checkbox" checked={s.dependents} onChange={(e) => setS({ dependents: e.target.checked })} /> Someone depends on my income</label>
        </div>
        <div className="scroll-x">
          <table>
            <thead><tr><th>Person</th><th className="num">Income</th><th className="num">Life: rough need</th><th className="num">Coverage</th><th className="num">Gap</th><th className="num">Disability: needed / mo</th><th className="num">Benefit / mo</th></tr></thead>
            <tbody>
              {perPerson.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td><td className="num">{formatCents(p.grossAnnualCents)}</td><td className="num">{formatCents(p.life.netNeedCents)}</td><td className="num">{formatCents(p.life.coverageCents)}</td>
                  <td className={`num ${p.life.gapCents > 0 ? 'neg' : 'pos'}`}>{formatCents(p.life.gapCents)}</td><td className="num">{formatCents(p.disability.neededMonthlyCents)}</td><td className="num">{formatCents(p.disability.benefitMonthlyCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">
          Life need = income × years + all your debts ({formatCents(debts)}) + education costs from your <Link to="/goals">goals</Link> ({formatCents(education)}). Disability need is 60% of pay, the share most plans replace.
        </p>
      </Collapsible>

      <Collapsible id="protect.umbrella" title="Umbrella liability">
        <p>Net worth <strong>{formatCents(nw?.total ?? 0)}</strong>; suggested limit <strong>{formatCents(umbrella.suggestedCents)}</strong>; entered <strong>{formatCents(umbrella.coverageCents)}</strong>.</p>
        <p className="muted">An umbrella policy pays when a lawsuit exceeds your home and auto liability limits. The usual guideline is a limit at least as large as what a plaintiff could go after.</p>
      </Collapsible>

      <Collapsible id="protect.policies" title="Your policies">
        {ins.policies.length === 0 && <p className="muted">None entered yet. Add each policy, including coverage through an employer, so the checks above are accurate. Policy numbers are stored only on this device.</p>}
        {ins.policies.map((p) => <PolicyRow key={p.id} p={p} people={people} ins={ins} />)}
        <div className="row">
          <label className="f">Add a policy
            <select value={type} onChange={(e) => setType(e.target.value as PolicyType)}>{(Object.keys(POLICY_LABEL) as PolicyType[]).map((t) => <option key={t} value={t}>{POLICY_LABEL[t]}</option>)}</select>
          </label>
          <button className="primary" onClick={() => ins.add(newPolicy(type, ['life', 'disability', 'ltc'].includes(type) ? people[0]?.id ?? null : null))}>Add</button>
        </div>
      </Collapsible>
    </>
  );
}
