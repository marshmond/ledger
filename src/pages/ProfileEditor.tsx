import { useState } from 'react';
import type { DeductionItem, DeductionType, IncomeProfile, Person } from '../types';
import { newDeduction } from '../lib/income';
import { MoneyField, NumField } from './fields';

const ADD: [DeductionType, string][] = [
  ['k401_pretax', '+ 401(k) pre-tax'],
  ['k401_roth', '+ Roth 401(k)'],
  ['hsa', '+ HSA'],
  ['health', '+ Health'],
  ['dental', '+ Dental'],
  ['vision', '+ Vision'],
  ['fsa', '+ FSA'],
  ['espp', '+ ESPP'],
  ['custom', '+ Other'],
];

const HELP: Partial<Record<DeductionType, string>> = {
  k401_pretax: 'Pre-tax and Roth share one annual limit. Reduces federal wages, not Social Security/Medicare.',
  k401_roth: 'After-tax. Counts toward the same annual 401(k) limit as pre-tax.',
  hsa: 'Annual limit applies to you plus any employer contribution below.',
  espp: 'After-tax. Stops at the IRS $25,000 stock-value limit (adjusted for your discount below).',
  custom: 'Set which taxes it reduces using the boxes on the right.',
};

export default function ProfileEditor({
  person,
  profile,
  onSave,
  onCopyPrev,
  onDelete,
}: {
  person: Person;
  profile: IncomeProfile;
  onSave: (p: IncomeProfile) => void;
  onCopyPrev?: () => void;
  onDelete: () => void;
}) {
  const [d, setD] = useState<IncomeProfile>(profile);
  const dirty = JSON.stringify(d) !== JSON.stringify(profile);
  const set = (patch: Partial<IncomeProfile>) => setD({ ...d, ...patch });
  const setDed = (id: string, patch: Partial<DeductionItem>) =>
    set({ deductions: d.deductions.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const annual = d.mode === 'annual';

  return (
    <div className="card">
      <div className="row spread">
        <strong>{person.name}: {d.year}</strong>
        <div className="row">
          {onCopyPrev && <button className="link" onClick={onCopyPrev}>copy from {d.year - 1}</button>}
          <button className="link danger" onClick={onDelete}>remove this year</button>
        </div>
      </div>

      <h3>Pay</h3>
      <div className="grid">
        <label className="f">Model by
          <select value={d.mode} onChange={(e) => set({ mode: e.target.value as IncomeProfile['mode'] })}>
            <option value="paycheck">Paycheck (real pay schedule)</option>
            <option value="annual">Annual numbers (spread over 12 months)</option>
          </select>
        </label>
        {!annual && (
          <>
            <label className="f">Paid
              <select value={d.frequency} onChange={(e) => set({ frequency: e.target.value as IncomeProfile['frequency'] })}>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every 2 weeks</option>
                <option value="semimonthly">Twice a month</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
            <label className="f">A real pay date
              <input type="date" value={d.firstPayDate} onChange={(e) => set({ firstPayDate: e.target.value })} />
            </label>
            {d.frequency === 'semimonthly' && (
              <>
                <NumField label="1st pay day of month" value={d.semiDays?.[0] ?? 1} onChange={(n) => set({ semiDays: [n, d.semiDays?.[1] ?? 15] })} step={1} />
                <NumField label="2nd pay day (31 = last)" value={d.semiDays?.[1] ?? 15} onChange={(n) => set({ semiDays: [d.semiDays?.[0] ?? 1, n] })} step={1} />
              </>
            )}
          </>
        )}
      </div>
      {!annual && <p className="muted">The pay date is only an anchor: the schedule runs forward and backward from it, so the whole year is covered.</p>}

      <h3>Salary</h3>
      {d.salary.map((s, i) => (
        <div className="row" key={i} style={{ marginBottom: 4 }}>
          <label className="f">{i === 0 ? 'Effective' : 'Raise effective'}
            <input type="date" value={s.effectiveDate} onChange={(e) => set({ salary: d.salary.map((x, j) => (j === i ? { ...x, effectiveDate: e.target.value } : x)) })} />
          </label>
          <MoneyField label="Annual gross" cents={s.annualCents} width={130} onChange={(c) => set({ salary: d.salary.map((x, j) => (j === i ? { ...x, annualCents: c } : x)) })} />
          {i > 0 && <button className="link danger" onClick={() => set({ salary: d.salary.filter((_, j) => j !== i) })}>remove</button>}
        </div>
      ))}
      <button onClick={() => set({ salary: [...d.salary, { effectiveDate: `${d.year}-07-01`, annualCents: d.salary.at(-1)?.annualCents ?? 0 }] })}>+ raise</button>
      <p className="muted">Bonuses are entered by month in the Bonuses section below.</p>

      <h3>Deductions</h3>
      <p className="muted">
        {annual ? 'Fixed amounts are per YEAR in annual mode.' : 'Fixed amounts are per paycheck.'} Percentages are of gross pay.
        The three boxes say which taxes each item reduces (Fed income tax / FICA / MA income tax). Defaults follow standard rules; change them to
        match your pay stub or W-2.
      </p>
      {d.deductions.length > 0 && (
        <table>
          <thead><tr><th>Item</th><th>Amount</th><th>Reduces</th><th className="hide-sm">Bonus</th><th></th></tr></thead>
          <tbody>
            {d.deductions.map((x) => (
              <tr key={x.id}>
                <td>
                  <input value={x.name} onChange={(e) => setDed(x.id, { name: e.target.value })} />
                  {HELP[x.type] && <div className="muted">{HELP[x.type]}</div>}
                </td>
                <td>
                  <div className="row">
                    <select value={x.mode} onChange={(e) => setDed(x.id, { mode: e.target.value as 'percent' | 'fixed', value: 0 })}>
                      <option value="percent">% of gross</option>
                      <option value="fixed">$ fixed</option>
                    </select>
                    {x.mode === 'percent' ? (
                      <NumField value={x.value} onChange={(n) => setDed(x.id, { value: n })} width={80} />
                    ) : (
                      <MoneyField cents={x.value} onChange={(c) => setDed(x.id, { value: c })} width={100} />
                    )}
                  </div>
                </td>
                <td>
                  <label className="row"><input type="checkbox" checked={x.fedExempt} onChange={(e) => setDed(x.id, { fedExempt: e.target.checked })} />Fed</label>
                  <label className="row"><input type="checkbox" checked={x.ficaExempt} onChange={(e) => setDed(x.id, { ficaExempt: e.target.checked })} />FICA</label>
                  <label className="row"><input type="checkbox" checked={x.stateExempt} onChange={(e) => setDed(x.id, { stateExempt: e.target.checked })} />MA</label>
                </td>
                <td className="hide-sm">
                  {x.mode === 'percent' ? (
                    <label className="row"><input type="checkbox" checked={x.appliesToBonus} onChange={(e) => setDed(x.id, { appliesToBonus: e.target.checked })} />on bonus</label>
                  ) : <span className="muted">n/a</span>}
                </td>
                <td><button className="link danger" onClick={() => set({ deductions: d.deductions.filter((y) => y.id !== x.id) })}>remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row" style={{ marginTop: 6 }}>
        {ADD.map(([t, l]) => <button key={t} onClick={() => set({ deductions: [...d.deductions, newDeduction(t)] })}>{l}</button>)}
      </div>

      <h3>Employer contributions</h3>
      <label className="row">
        <input
          type="checkbox"
          checked={!!d.match}
          onChange={(e) => set({ match: e.target.checked ? { ratePct: 50, upToPctOfPay: 6, trueUp: false, appliesToBonus: false } : null })}
        />
        401(k) match
      </label>
      {d.match && (
        <div className="row" style={{ marginTop: 4 }}>
          <NumField label="Employer matches (%)" value={d.match.ratePct} onChange={(n) => set({ match: { ...d.match!, ratePct: n } })} width={90} />
          <NumField label="…up to (% of pay)" value={d.match.upToPctOfPay} onChange={(n) => set({ match: { ...d.match!, upToPctOfPay: n } })} width={90} />
          <label className="row"><input type="checkbox" checked={d.match.trueUp} onChange={(e) => set({ match: { ...d.match!, trueUp: e.target.checked } })} />Year-end true-up</label>
          <label className="row"><input type="checkbox" checked={d.match.appliesToBonus} onChange={(e) => set({ match: { ...d.match!, appliesToBonus: e.target.checked } })} />Match on bonuses</label>
        </div>
      )}
      <p className="muted">Example: “50% up to 6%” means the employer adds 50¢ per $1 you put in, on up to 6% of pay. Without a true-up, hitting the 401(k) limit early stops the match for the rest of the year.</p>
      <div className="row">
        <MoneyField label="Employer HSA contribution (per year)" cents={d.employerHsaAnnualCents} onChange={(c) => set({ employerHsaAnnualCents: c })} width={140} />
        <label className="f">HSA coverage
          <select value={d.hsaCoverage} onChange={(e) => set({ hsaCoverage: e.target.value as 'self' | 'family' })}>
            <option value="family">Family</option>
            <option value="self">Self-only</option>
          </select>
        </label>
        <NumField label="ESPP discount (%)" value={d.esppDiscountPct} onChange={(n) => set({ esppDiscountPct: n })} width={90} />
      </div>

      <h3>Income tax withholding</h3>
      <div className="row">
        <label className="f">Federal
          <select value={d.fedWithholding.mode} onChange={(e) => set({ fedWithholding: { ...d.fedWithholding, mode: e.target.value as 'estimate' | 'manual' } })}>
            <option value="estimate">Estimate</option>
            <option value="manual">I’ll enter it (from my pay stub)</option>
          </select>
        </label>
        {d.fedWithholding.mode === 'manual' ? (
          <MoneyField label="Federal per paycheck" cents={d.fedWithholding.manualPerPaycheckCents} onChange={(c) => set({ fedWithholding: { ...d.fedWithholding, manualPerPaycheckCents: c } })} width={120} />
        ) : (
          <>
            <label className="row"><input type="checkbox" checked={d.fedWithholding.twoJobs} onChange={(e) => set({ fedWithholding: { ...d.fedWithholding, twoJobs: e.target.checked } })} />Both spouses work (W-4 step 2)</label>
            <MoneyField label="Extra per paycheck" cents={d.fedWithholding.extraPerPaycheckCents} onChange={(c) => set({ fedWithholding: { ...d.fedWithholding, extraPerPaycheckCents: c } })} width={100} />
          </>
        )}
        <label className="f">MA state
          <select value={d.stateWithholding.mode} onChange={(e) => set({ stateWithholding: { ...d.stateWithholding, mode: e.target.value as 'estimate' | 'manual' } })}>
            <option value="estimate">Estimate (5%)</option>
            <option value="manual">I’ll enter it</option>
          </select>
        </label>
        {d.stateWithholding.mode === 'manual' && (
          <MoneyField label="MA per paycheck" cents={d.stateWithholding.manualPerPaycheckCents} onChange={(c) => set({ stateWithholding: { ...d.stateWithholding, manualPerPaycheckCents: c } })} width={110} />
        )}
      </div>
      <p className="muted">Withholding only affects paycheck take-home. The yearly tax owed is calculated separately below, and the difference shows as an expected refund or amount due.</p>

      <div className="row" style={{ marginTop: 10 }}>
        <button className="primary" disabled={!dirty} onClick={() => onSave(d)}>{dirty ? 'Save changes' : 'Saved'}</button>
        {dirty && <button onClick={() => setD(profile)}>Discard</button>}
      </div>
    </div>
  );
}
