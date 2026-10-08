import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { TAX_2026 } from '../data/taxYears';
import type { Bonus, IncomeProfile, TaxSettings } from '../types';
import { formatCents, todayISO } from '../lib/money';
import { monthLabel } from '../lib/dates';
import { buildIncomeModel, DEFAULT_SETTINGS, newProfile, parseTablesJson, resolveTables, rollForward } from '../lib/income';
import { monthlyNet, type PersonYear } from '../lib/payroll';
import ProfileEditor from './ProfileEditor';
import { MoneyField, NumField } from './fields';

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const monthName = (m: number) => monthLabel(`2026-${String(m).padStart(2, '0')}`).split(' ')[0];
const fmtDate = (d: string | null) => (d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—');

function Milestones({ y, name }: { y: PersonYear; name: string }) {
  const rows: [string, string | null, string][] = [
    ['Social Security cap reached', y.milestones.ssCapDate, 'No more 6.2% Social Security on pay after this; take-home rises.'],
    ['401(k) annual limit reached', y.milestones.k401LimitDate, 'Deferrals stop after this paycheck; take-home rises (and a non-true-up match stops).'],
    ['HSA limit reached', y.milestones.hsaLimitDate, ''],
    ['ESPP limit reached', y.milestones.esppCapDate, 'IRS $25,000 stock-value limit.'],
    ['Additional Medicare (0.9%) starts', y.milestones.addlMedicareStartDate, 'Withholding on wages above $200,000.'],
  ];
  const hit = rows.filter((r) => r[1]);
  return (
    <div>
      <strong>{name}: key dates</strong>
      {hit.length === 0 ? <p className="muted">No caps are reached this year.</p> : (
        <ul>{hit.map(([l, d, h]) => <li key={l}><strong>{fmtDate(d)}</strong>: {l}{h && <span className="muted"> ({h})</span>}</li>)}</ul>
      )}
    </div>
  );
}

export default function IncomePage() {
  const thisYear = Number(todayISO().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const people = useLiveQuery(() => db.people.toArray(), []) ?? [];
  const profiles = useLiveQuery(() => db.incomeProfiles.toArray(), []) ?? [];
  const bonuses = useLiveQuery(() => db.bonuses.toArray(), []) ?? [];
  const allSettings = useLiveQuery(() => db.taxSettings.toArray(), []) ?? [];
  const settings = allSettings.find((s) => s.year === year);

  const model = useMemo(() => buildIncomeModel(year, people, profiles, bonuses, settings), [year, people, profiles, bonuses, settings]);
  const yearsWithData = [...new Set([...profiles.map((p) => p.year), thisYear, thisYear + 1])].sort();

  const [newName, setNewName] = useState('');
  const [newBirth, setNewBirth] = useState('');
  const [bPerson, setBPerson] = useState('');
  const [bMonth, setBMonth] = useState(String(new Date().getMonth() + 1));
  const [bAmt, setBAmt] = useState(0);
  const [bLabel, setBLabel] = useState('');
  const [tablesText, setTablesText] = useState<string | null>(null);
  const [tablesMsg, setTablesMsg] = useState('');

  const save = async (p: IncomeProfile) => {
    if (p.id) await db.incomeProfiles.put(p);
    else await db.incomeProfiles.add(p);
  };
  const setSettings = async (patch: Partial<TaxSettings>) => {
    const cur = settings ?? DEFAULT_SETTINGS(year);
    await db.taxSettings.put({ ...cur, ...patch, year });
  };
  const monthly = monthlyNet(model.years);
  const yearBonuses = bonuses.filter((b) => b.year === year);
  const personName = (id: number) => people.find((p) => p.id === id)?.name ?? '?';
  const hh = model.household;

  const tablesForEdit = () => {
    const r = resolveTables(year, settings);
    const base = r.tables ?? { ...TAX_2026, year, notes: [`Copied from 2026 as a starting point for ${year}. Update every number from the IRS, SSA, and MA DOR before relying on it.`] };
    return JSON.stringify(base, null, 2);
  };

  return (
    <>
      <div className="row spread">
        <h1>Income</h1>
        <label className="row">Year
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {yearsWithData.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      </div>

      {model.tableSource === 'none' && (
        <div className="card rta-neg">
          <strong className="neg">No tax tables for {year}.</strong>
          <p>
            I don’t guess at tax law, so nothing is calculated for {year} until tables exist. The IRS usually publishes next year’s limits in
            October or November. Start from the 2026 tables, update the numbers, and save.
          </p>
          <button className="primary" onClick={() => { setTablesText(tablesForEdit()); setTablesMsg(''); }}>Start from 2026 tables</button>
        </div>
      )}
      {model.tableSource === 'built-in' && model.tables && (
        <p className="muted">
          Using built-in {year} tax tables (federal MFJ, Social Security, MA).{' '}
          <button className="link" onClick={() => { setTablesText(tablesForEdit()); setTablesMsg(''); }}>view or edit</button>
        </p>
      )}
      {model.tableSource === 'custom' && <p className="muted">Using your edited {year} tax tables. <button className="link" onClick={() => { setTablesText(tablesForEdit()); setTablesMsg(''); }}>view or edit</button></p>}

      {tablesText !== null && (
        <div className="card">
          <strong>Tax tables for {year} (amounts in cents)</strong>
          <p className="muted">Fields marked UNVERIFIED in the notes could not be confirmed from an official source. Save stores your edited copy in this browser.</p>
          <textarea value={tablesText} onChange={(e) => setTablesText(e.target.value)} rows={16} style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.8rem' }} />
          <div className="row" style={{ marginTop: 6 }}>
            <button
              className="primary"
              onClick={async () => {
                const r = parseTablesJson(tablesText, year);
                if (r.error) return setTablesMsg(r.error);
                await setSettings({ tablesOverride: tablesText });
                setTablesMsg('Saved.');
                setTablesText(null);
              }}
            >Save tables</button>
            {settings?.tablesOverride && <button onClick={async () => { await setSettings({ tablesOverride: undefined }); setTablesText(null); }}>Reset to built-in</button>}
            <button onClick={() => setTablesText(null)}>Close</button>
            {tablesMsg && <span className={tablesMsg === 'Saved.' ? 'ok' : 'error'}>{tablesMsg}</span>}
          </div>
        </div>
      )}

      <h2>People</h2>
      <div className="row">
        {people.map((p) => <span className="badge" key={p.id}>{p.name}{p.birthYear ? ` (b. ${p.birthYear})` : ''}</span>)}
        <input placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <input placeholder="Birth year" style={{ width: 100 }} inputMode="numeric" value={newBirth} onChange={(e) => setNewBirth(e.target.value)} />
        <button
          onClick={async () => {
            if (!newName.trim()) return;
            await db.people.add({ name: newName.trim(), birthYear: newBirth ? Number(newBirth) : null });
            setNewName('');
            setNewBirth('');
          }}
        >Add person</button>
      </div>
      <p className="muted">Birth year sets 401(k) catch-up (50+, and the larger 60–63 amount) and HSA catch-up (55+).</p>

      {people.length === 0 && <p className="muted">Add yourself and your spouse to begin.</p>}

      {people.map((p) => {
        const prof = profiles.find((x) => x.personId === p.id && x.year === year);
        const prev = profiles.find((x) => x.personId === p.id && x.year === year - 1);
        if (!prof) {
          return (
            <div className="card row spread" key={p.id}>
              <span>{p.name}: no income set up for {year}</span>
              <div className="row">
                <button className="primary" onClick={() => save(newProfile(p.id!, year))}>Set up {year}</button>
                {prev && <button onClick={() => save(rollForward(prev, year))}>Copy from {year - 1}</button>}
              </div>
            </div>
          );
        }
        return (
          <ProfileEditor
            key={`${prof.id}`}
            person={p}
            profile={prof}
            onSave={save}
            onCopyPrev={prev ? () => confirm(`Replace ${p.name}'s ${year} setup with ${year - 1}'s?`) && save({ ...rollForward(prev, year), id: prof.id }) : undefined}
            onDelete={() => confirm(`Remove ${p.name}'s ${year} income setup?`) && db.incomeProfiles.delete(prof.id!)}
          />
        );
      })}

      <h2>Bonuses</h2>
      <p className="muted">Enter each bonus by the month it is paid (assumed mid-month). Add, change, or remove them whenever the timing changes; everything below updates.</p>
      <div className="row">
        <label className="f">Person
          <select value={bPerson} onChange={(e) => setBPerson(e.target.value)}>
            <option value="">Choose…</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="f">Month
          <select value={bMonth} onChange={(e) => setBMonth(e.target.value)}>
            {MONTHS.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
          </select>
        </label>
        <MoneyField label="Gross amount" cents={bAmt} onChange={setBAmt} width={120} />
        <label className="f">Label<input value={bLabel} onChange={(e) => setBLabel(e.target.value)} placeholder="Annual, commission, retention…" /></label>
        <button
          className="primary"
          disabled={!bPerson || bAmt <= 0}
          onClick={async () => {
            const b: Bonus = { personId: Number(bPerson), year, month: Number(bMonth), grossCents: bAmt, label: bLabel.trim() || 'Bonus' };
            await db.bonuses.add(b);
            setBAmt(0);
            setBLabel('');
          }}
        >Add bonus</button>
      </div>
      {yearBonuses.length > 0 && (
        <table>
          <tbody>
            {[...yearBonuses].sort((a, b) => a.month - b.month).map((b) => (
              <tr key={b.id}>
                <td>{monthName(b.month)} {b.year}</td>
                <td>{personName(b.personId)}</td>
                <td>{b.label}</td>
                <td className="num pos">{formatCents(b.grossCents)}</td>
                <td><button className="link danger" onClick={() => db.bonuses.delete(b.id!)}>delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Household tax settings</h2>
      <div className="grid">
        <MoneyField key={`i${year}`} label="Itemized deductions (if larger than standard)" cents={settings?.itemizedDeductionCents ?? 0} onChange={(c) => setSettings({ itemizedDeductionCents: c })} />
        <MoneyField key={`o${year}`} label="Other taxable income" cents={settings?.otherIncomeCents ?? 0} onChange={(c) => setSettings({ otherIncomeCents: c })} />
        <MoneyField key={`f${year}`} label="Federal credits (e.g. child tax credit)" cents={settings?.federalCreditsCents ?? 0} onChange={(c) => setSettings({ federalCreditsCents: c })} />
        <NumField key={`d${year}`} label="MA dependents" value={settings?.maDependents ?? 0} step={1} onChange={(n) => setSettings({ maDependents: n })} />
        <MoneyField key={`m${year}`} label="MA credits" cents={settings?.maCreditsCents ?? 0} onChange={(c) => setSettings({ maCreditsCents: c })} />
      </div>
      <p className="muted">Credit amounts are yours to enter; I don’t apply dependent credits automatically because the rules depend on your situation.</p>

      {model.years.length > 0 && model.tables && hh && (
        <>
          <h2>{year} results</h2>
          <div className="grid">
            {model.years.map((y) => (
              <div className="card" key={y.personId}>
                <strong>{personName(y.personId)}</strong>
                <div>Gross {formatCents(y.totals.gross)}{y.totals.bonusGross > 0 && <span className="muted"> (incl. {formatCents(y.totals.bonusGross)} bonus)</span>}</div>
                <div>Take-home {formatCents(y.totals.net)}</div>
                <div className="muted">
                  401(k): {formatCents(y.contributions.k401Pretax)} pre-tax + {formatCents(y.contributions.k401Roth)} Roth
                  {y.contributions.employerMatch > 0 && ` + ${formatCents(y.contributions.employerMatch)} match`}
                </div>
                {(y.contributions.hsa > 0 || y.contributions.employerHsa > 0) && <div className="muted">HSA: {formatCents(y.contributions.hsa + y.contributions.employerHsa)}</div>}
                {y.contributions.espp > 0 && <div className="muted">ESPP: {formatCents(y.contributions.espp)}</div>}
                {y.warnings.map((w) => <div key={w} className="warn">{w}</div>)}
              </div>
            ))}
            <div className="card">
              <strong>Household total</strong>
              <div>Gross {formatCents(model.years.reduce((a, y) => a + y.totals.gross, 0))}</div>
              <div>Take-home {formatCents(model.years.reduce((a, y) => a + y.totals.net, 0))}</div>
              <div className="muted">Social Security + Medicare {formatCents(hh.ficaTotal)} · MA PFML {formatCents(hh.pfmlTotal)}</div>
            </div>
          </div>

          <div className="grid">
            <div className="card">
              <strong>Federal income tax</strong>
              <table><tbody>
                <tr><td>Wages (after pre-tax items)</td><td className="num">{formatCents(hh.federal.wages)}</td></tr>
                {hh.federal.otherIncome > 0 && <tr><td>Other income</td><td className="num">{formatCents(hh.federal.otherIncome)}</td></tr>}
                <tr><td>{hh.federal.usedItemized ? 'Itemized' : 'Standard'} deduction</td><td className="num">−{formatCents(hh.federal.deduction)}</td></tr>
                <tr><td>Taxable income</td><td className="num">{formatCents(hh.federal.taxableIncome)}</td></tr>
                <tr><td>Tax {hh.federal.credits > 0 && `(after ${formatCents(hh.federal.credits)} credits)`}</td><td className="num">{formatCents(hh.federal.incomeTax)}</td></tr>
                {hh.federal.addlMedicareLiability > 0 && <tr><td>Additional Medicare</td><td className="num">{formatCents(hh.federal.addlMedicareLiability)}</td></tr>}
                <tr><td><strong>Total owed</strong></td><td className="num"><strong>{formatCents(hh.federal.totalLiability)}</strong></td></tr>
                <tr><td>Withheld from paychecks</td><td className="num">{formatCents(hh.federal.withheld)}</td></tr>
                <tr><td><strong>{hh.federal.balance >= 0 ? 'Expected refund' : 'Expected amount due'}</strong></td><td className={`num ${hh.federal.balance >= 0 ? 'pos' : 'neg'}`}><strong>{formatCents(Math.abs(hh.federal.balance))}</strong></td></tr>
              </tbody></table>
            </div>
            <div className="card">
              <strong>Massachusetts income tax</strong>
              <table><tbody>
                <tr><td>MA wages</td><td className="num">{formatCents(hh.ma.wages)}</td></tr>
                <tr><td>Exemptions</td><td className="num">−{formatCents(hh.ma.exemptions)}</td></tr>
                <tr><td>Social Security/Medicare deduction</td><td className="num">−{formatCents(hh.ma.ficaDeduction)}</td></tr>
                <tr><td>Taxable income</td><td className="num">{formatCents(hh.ma.taxableIncome)}</td></tr>
                <tr><td>Tax (5%)</td><td className="num">{formatCents(hh.ma.baseTax)}</td></tr>
                {hh.ma.surtax > 0 && <tr><td>4% surtax</td><td className="num">{formatCents(hh.ma.surtax)}</td></tr>}
                {hh.ma.credits > 0 && <tr><td>Credits</td><td className="num">−{formatCents(hh.ma.credits)}</td></tr>}
                <tr><td><strong>Total owed</strong></td><td className="num"><strong>{formatCents(hh.ma.totalLiability)}</strong></td></tr>
                <tr><td>Withheld from paychecks</td><td className="num">{formatCents(hh.ma.withheld)}</td></tr>
                <tr><td><strong>{hh.ma.balance >= 0 ? 'Expected refund' : 'Expected amount due'}</strong></td><td className={`num ${hh.ma.balance >= 0 ? 'pos' : 'neg'}`}><strong>{formatCents(Math.abs(hh.ma.balance))}</strong></td></tr>
              </tbody></table>
            </div>
          </div>

          <div className="card">
            {model.years.map((y) => <Milestones key={y.personId} y={y} name={personName(y.personId)} />)}
          </div>

          <h2>Take-home by month</h2>
          <table>
            <thead>
              <tr><th>Month</th>{model.years.map((y) => <th className="num" key={y.personId}>{personName(y.personId)}</th>)}<th className="num">Household</th></tr>
            </thead>
            <tbody>
              {MONTHS.map((m) => {
                const per = model.years.map((y) => monthlyNet([y])[m - 1]);
                const counts = model.years.map((y) => y.events.filter((e) => Number(e.date.slice(5, 7)) === m).length);
                return (
                  <tr key={m}>
                    <td>{monthName(m)}</td>
                    {per.map((v, i) => <td className="num" key={i}>{formatCents(v)} <span className="muted">({counts[i]})</span></td>)}
                    <td className="num"><strong>{formatCents(monthly[m - 1])}</strong></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted">Numbers in parentheses are paychecks received that month (including bonuses). Months with an extra paycheck stand out.</p>

          {model.years.map((y) => {
            const prof = profiles.find((p) => p.personId === y.personId && p.year === year)!;
            return (
              <details key={y.personId} style={{ marginTop: 10 }}>
                <summary><strong>{personName(y.personId)}: paycheck detail</strong></summary>
                <div style={{ overflowX: 'auto' }}>
                  <table>
                    <thead>
                      <tr><th>Date</th><th className="num">Gross</th><th className="num">Deductions</th><th className="num">Fed tax</th><th className="num">SS</th><th className="num">Medicare</th><th className="num">MA tax</th><th className="num">PFML</th><th className="num">Net</th></tr>
                    </thead>
                    <tbody>
                      {y.events.map((e, i) => {
                        const dedTotal = Object.values(e.deductions).reduce((a, b) => a + b, 0);
                        return (
                          <tr key={i}>
                            <td>{e.date}{e.kind === 'bonus' && <span className="badge"> {e.label}</span>}{e.notes.length > 0 && <div className="warn">{e.notes.join('; ')}</div>}</td>
                            <td className="num">{formatCents(e.gross)}</td>
                            <td className="num">{formatCents(dedTotal)}</td>
                            <td className="num">{formatCents(e.fedWithholding)}</td>
                            <td className="num">{formatCents(e.socialSecurity)}</td>
                            <td className="num">{formatCents(e.medicare + e.addlMedicare)}</td>
                            <td className="num">{formatCents(e.stateWithholding)}</td>
                            <td className="num">{formatCents(e.pfml)}</td>
                            <td className="num"><strong>{formatCents(e.net)}</strong></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="muted">
                    Deductions: {prof.deductions.map((d) => `${d.name} ${formatCents(y.totals.deductions[d.id] ?? 0)}`).join(' · ') || 'none'}
                  </p>
                </div>
              </details>
            );
          })}

          <div className="card">
            <strong>About these numbers</strong>
            <ul>{model.tables.notes.map((n) => <li key={n} className="muted">{n}</li>)}</ul>
            <p className="muted">This is a planning model, not tax advice or a substitute for your pay stubs and W-2.</p>
          </div>
        </>
      )}
    </>
  );
}
