import { useState } from 'react';
import type { DeductionItem, DeductionType, IncomeProfile, MatchConfig, PayDay, Person } from '../types';
import { esppOn, hsaOn, newDeduction, payDaysOf } from '../lib/income';
import Collapsible, { useCollapsed } from './Collapsible';
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

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10 > 3 ? 0 : n % 10]}`;

/** Pay-day choices: 1st to 30th, then "last day" (31, safe in short months) and "last business day". */
const DAY_OPTIONS: { value: string; label: string }[] = [
  ...Array.from({ length: 30 }, (_, i) => ({ value: String(i + 1), label: ordinal(i + 1) })),
  { value: '31', label: 'Last day of the month' },
  { value: 'lastBusiness', label: 'Last business day of the month' },
];
const toValue = (d: PayDay) => String(d);
const fromValue = (v: string): PayDay => (v === 'lastBusiness' ? 'lastBusiness' : Number(v));

function DayPicker({ label, value, onChange }: { label: string; value: PayDay; onChange: (d: PayDay) => void }) {
  return (
    <label className="f">{label}
      <select value={toValue(value)} onChange={(e) => onChange(fromValue(e.target.value))}>
        {DAY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

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
  // Merge onto the latest draft (not the one captured at render), so two quick edits can never overwrite each other.
  const set = (patch: Partial<IncomeProfile>) => setD((prev) => ({ ...prev, ...patch }));
  const setDed = (id: string, patch: Partial<DeductionItem>) =>
    set({ deductions: d.deductions.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const annual = d.mode === 'annual';
  const dayBased = !annual && (d.frequency === 'semimonthly' || d.frequency === 'monthly');
  const anchorBased = !annual && (d.frequency === 'weekly' || d.frequency === 'biweekly');
  const payDays = payDaysOf(d);
  const setPayDay = (i: number, v: PayDay) => set({ payDays: payDays.map((x, j) => (j === i ? v : x)) });
  const hsa = hsaOn(d);
  const espp = esppOn(d);
  const match = d.match ?? null;
  const flat = match?.formula === 'flat';
  const setMatch = (patch: Partial<MatchConfig>) => match && set({ match: { ...match, ...patch } });
  const [open, setOpen] = useCollapsed(`income.p${person.id}`);

  function switchBenefit(kind: 'hsa' | 'espp', on: boolean) {
    const type: DeductionType = kind;
    const has = d.deductions.some((x) => x.type === type);
    if (!on && has && !confirm(`Turning this off removes the ${kind === 'hsa' ? 'HSA' : 'ESPP'} deduction from ${person.name}'s setup. Continue?`)) return;
    if (kind === 'hsa') set({ hasHsa: on, ...(on ? {} : { employerHsaAnnualCents: 0, deductions: d.deductions.filter((x) => x.type !== 'hsa') }) });
    else set({ esppEnrolled: on, ...(on ? {} : { deductions: d.deductions.filter((x) => x.type !== 'espp') }) });
  }

  return (
    <div className="card">
      <div className="row spread">
        <button className="collapse-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="chev" aria-hidden="true">{open ? '▾' : '▸'}</span> <strong>{person.name}: {d.year}</strong>
          {dirty && <span className="badge pending">unsaved</span>}
        </button>
        <div className="row">
          {onCopyPrev && <button className="link" onClick={onCopyPrev}>copy from {d.year - 1}</button>}
          <button className="link danger" onClick={onDelete}>remove this year</button>
        </div>
      </div>

      <div hidden={!open}>
        <Collapsible id={`income.p${person.id}.pay`} level={3} title="Pay schedule">
          <div className="grid">
            <label className="f">How should I model your pay?
              <select value={d.mode} onChange={(e) => set({ mode: e.target.value as IncomeProfile['mode'] })}>
                <option value="paycheck">By paycheck (follows my real pay schedule)</option>
                <option value="annual">By annual numbers (spread evenly over 12 months)</option>
              </select>
            </label>
            {!annual && (
              <label className="f">How often are you paid?
                <select
                  value={d.frequency}
                  onChange={(e) => {
                    const frequency = e.target.value as IncomeProfile['frequency'];
                    set({ frequency, payDays: payDaysOf({ ...d, frequency, payDays: undefined }) });
                  }}
                >
                  <option value="weekly">Every week</option>
                  <option value="biweekly">Every 2 weeks</option>
                  <option value="semimonthly">Twice a month</option>
                  <option value="monthly">Once a month</option>
                </select>
              </label>
            )}
            {anchorBased && (
              <label className="f">Any past payday
                <input type="date" value={d.firstPayDate} onChange={(e) => set({ firstPayDate: e.target.value })} />
              </label>
            )}
            {dayBased && (
              <>
                <DayPicker label={d.frequency === 'semimonthly' ? 'First pay day each month' : 'Pay day each month'} value={payDays[0]} onChange={(v) => setPayDay(0, v)} />
                {d.frequency === 'semimonthly' && <DayPicker label="Second pay day each month" value={payDays[1]} onChange={(v) => setPayDay(1, v)} />}
              </>
            )}
          </div>
          {annual && <p className="muted">Annual mode ignores pay dates: salary and fixed amounts are spread evenly across 12 months.</p>}
          {anchorBased && (
            <p className="muted">
              Pick any date you were paid (your latest paycheck works). I count forward and backward from it to find every payday in the year, which
              decides whether the year has 26 or 27 paychecks and which months get three.
            </p>
          )}
          {dayBased && (
            <>
              <label className="chk">
                <input type="checkbox" checked={d.weekendAdjust ?? false} onChange={(e) => set({ weekendAdjust: e.target.checked })} />
                If a pay day lands on a weekend, pay on the Friday before
              </label>
              <p className="muted">
                “Last day of the month” works in every month, including February. Weekends are the only days off I know about; holidays are not
                considered. Moving a pay day off a weekend can occasionally shift a paycheck across a year boundary (a 25-paycheck year is real).
              </p>
            </>
          )}
        </Collapsible>

        <Collapsible id={`income.p${person.id}.salary`} level={3} title="Salary">
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
        </Collapsible>

        <Collapsible id={`income.p${person.id}.deductions`} level={3} title="Deductions">
          <p className="muted">
            {annual ? 'Fixed amounts are per YEAR in annual mode.' : 'Fixed amounts are per paycheck.'} Percentages are of gross pay. The checkboxes say which
            taxes each item reduces. Defaults follow standard rules; change them to match your pay stub or W-2.
          </p>
          {d.deductions.length > 0 && (
            <table>
              <thead><tr><th>Item</th><th>Amount</th><th>Reduces tax on</th><th className="hide-sm">Bonus</th><th></th></tr></thead>
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
                      <div className="checks">
                        <label className="chk"><input type="checkbox" checked={x.fedExempt} onChange={(e) => setDed(x.id, { fedExempt: e.target.checked })} />Federal income tax</label>
                        <label className="chk"><input type="checkbox" checked={x.ficaExempt} onChange={(e) => setDed(x.id, { ficaExempt: e.target.checked })} />Social Security &amp; Medicare</label>
                        <label className="chk"><input type="checkbox" checked={x.stateExempt} onChange={(e) => setDed(x.id, { stateExempt: e.target.checked })} />MA income tax</label>
                      </div>
                    </td>
                    <td className="hide-sm">
                      {x.mode === 'percent' ? (
                        <label className="chk"><input type="checkbox" checked={x.appliesToBonus} onChange={(e) => setDed(x.id, { appliesToBonus: e.target.checked })} />on bonus</label>
                      ) : <span className="muted">n/a</span>}
                    </td>
                    <td><button className="link danger" onClick={() => set({ deductions: d.deductions.filter((y) => y.id !== x.id) })}>remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="row" style={{ marginTop: 6 }}>
            {ADD.filter(([t]) => (t !== 'hsa' || hsa) && (t !== 'espp' || espp)).map(([t, l]) => (
              <button key={t} onClick={() => set({ deductions: [...d.deductions, newDeduction(t)] })}>{l}</button>
            ))}
          </div>
          {(!hsa || !espp) && (
            <p className="muted">
              {!hsa && 'HSA'}{!hsa && !espp && ' and '}{!espp && 'ESPP'} become{!hsa && !espp ? '' : 's'} available once switched on under Employer benefits below.
            </p>
          )}
        </Collapsible>

        <Collapsible id={`income.p${person.id}.employer`} level={3} title="Employer benefits">
          <label className="chk">
            <input
              type="checkbox"
              checked={!!match}
              onChange={(e) => set({ match: e.target.checked ? { formula: 'match', ratePct: 50, upToPctOfPay: 6, flatPctOfPay: 3, annualCapCents: null, trueUp: false, appliesToBonus: false } : null })}
            />
            Employer contributes to my 401(k)
          </label>
          {match && (
            <div style={{ marginTop: 6 }}>
              <div className="row">
                <label className="f">How does the employer contribute?
                  <select value={match.formula ?? 'match'} onChange={(e) => setMatch({ formula: e.target.value as 'match' | 'flat' })}>
                    <option value="match">A match on what I contribute</option>
                    <option value="flat">A flat % of my pay (whether or not I contribute)</option>
                  </select>
                </label>
                {flat ? (
                  <NumField label="% of my pay" value={match.flatPctOfPay ?? 0} step={0.5} width={100} onChange={(n) => setMatch({ flatPctOfPay: n })} />
                ) : (
                  <>
                    <NumField label="Employer matches (% of my contribution)" value={match.ratePct} width={110} onChange={(n) => setMatch({ ratePct: n })} />
                    <NumField label="…on contributions up to (% of my pay)" value={match.upToPctOfPay} width={110} onChange={(n) => setMatch({ upToPctOfPay: n })} />
                  </>
                )}
                <MoneyField key={`cap${match.annualCapCents ?? 0}`} label="Employer yearly maximum (optional)" cents={match.annualCapCents ?? 0} width={130} onChange={(c) => setMatch({ annualCapCents: c > 0 ? c : null })} />
              </div>
              <div className="row" style={{ marginTop: 4 }}>
                {!flat && <label className="chk"><input type="checkbox" checked={match.trueUp} onChange={(e) => setMatch({ trueUp: e.target.checked })} />Year-end true-up</label>}
                <label className="chk"><input type="checkbox" checked={match.appliesToBonus} onChange={(e) => setMatch({ appliesToBonus: e.target.checked })} />Also on bonuses</label>
              </div>
              <p className="muted">
                {flat
                  ? 'Example: “10% of my pay, up to $5,000 a year”: choose flat, enter 10, and set the yearly maximum to $5,000.'
                  : 'Example: “50% of my first 6%, up to $5,000 a year”: enter 50 and 6, and set the yearly maximum to $5,000. Without a true-up, hitting the 401(k) limit early stops the match for the rest of the year.'}
                {' '}Once the yearly maximum is reached the employer contribution stops, and the date shows in the results.
              </p>
            </div>
          )}

          <div className="row" style={{ marginTop: 10 }}>
            <label className="chk"><input type="checkbox" checked={hsa} onChange={(e) => switchBenefit('hsa', e.target.checked)} />I have an HSA</label>
            <label className="chk"><input type="checkbox" checked={espp} onChange={(e) => switchBenefit('espp', e.target.checked)} />I’m enrolled in my employer’s ESPP</label>
          </div>
          {hsa && (
            <div className="row" style={{ marginTop: 6 }}>
              <MoneyField label="Employer HSA contribution (per year)" cents={d.employerHsaAnnualCents} onChange={(c) => set({ employerHsaAnnualCents: c })} width={140} />
              <label className="f">HSA coverage
                <select value={d.hsaCoverage} onChange={(e) => set({ hsaCoverage: e.target.value as 'self' | 'family' })}>
                  <option value="family">Family</option>
                  <option value="self">Self-only</option>
                </select>
              </label>
            </div>
          )}
          {espp && (
            <div className="row" style={{ marginTop: 6 }}>
              <NumField label="ESPP purchase discount (%)" value={d.esppDiscountPct} onChange={(n) => set({ esppDiscountPct: n })} width={110} />
              <span className="muted">Used for the IRS $25,000 yearly limit. Add the ESPP contribution under Deductions.</span>
            </div>
          )}
        </Collapsible>

        <Collapsible id={`income.p${person.id}.withholding`} level={3} title="Income tax withholding">
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
                <label className="chk"><input type="checkbox" checked={d.fedWithholding.twoJobs} onChange={(e) => set({ fedWithholding: { ...d.fedWithholding, twoJobs: e.target.checked } })} />Both spouses work (W-4 step 2)</label>
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
        </Collapsible>

        <div className="row" style={{ marginTop: 10 }}>
          <button className="primary" disabled={!dirty} onClick={() => onSave(d)}>{dirty ? 'Save changes' : 'Saved'}</button>
          {dirty && <button onClick={() => setD(profile)}>Discard</button>}
        </div>
      </div>
    </div>
  );
}
