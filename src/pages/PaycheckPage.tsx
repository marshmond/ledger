import { useMemo, useState } from 'react';
import { Link } from '../core/router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { PayScenario } from '../types';
import { formatCents, todayISO } from '../lib/money';
import { monthLabel } from '../lib/dates';
import { blankScenario, headline, paycheckLines, runActual, sortScenariosNewestFirst, runScenario, scenarioFromProfile, type Headline, type ScenarioResult } from '../lib/paycheckCalc';
import Collapsible from './Collapsible';
import { MoneyField } from './fields';
import ProfileEditor from './ProfileEditor';
import { PageHeader } from '../ui/components';
import { Kind, PlanHero } from './PlanParts';
import './analysis.css';
import './plan.css';

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const monthName = (m: number) => monthLabel(`2026-${String(m).padStart(2, '0')}`).split(' ')[0];
const fmtDate = (d: string | null) => (d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—');
const signed = (c: number) => `${c < 0 ? '−' : ''}${formatCents(Math.abs(c))}`;

/** The difference from the first column, in words and a sign (no color tells better from worse). */
function Delta({ v }: { v: number }) {
  if (v === 0) return <span className="an-delta"> ±0</span>;
  return <span className="an-delta"> {v > 0 ? '+' : '−'}{formatCents(Math.abs(v))}</span>;
}

export default function PaycheckPage() {
  const thisYear = Number(todayISO().slice(0, 4));
  const people = useLiveQuery(() => db.people.toArray(), []) ?? [];
  const profiles = useLiveQuery(() => db.incomeProfiles.toArray(), []) ?? [];
  const bonuses = useLiveQuery(() => db.bonuses.toArray(), []) ?? [];
  const allSettings = useLiveQuery(() => db.taxSettings.toArray(), []) ?? [];
  const rsuVests = useLiveQuery(() => db.rsuVests.toArray(), []) ?? [];
  const securities = useLiveQuery(() => db.securities.toArray(), []) ?? [];
  const scenarios = useLiveQuery(() => db.payScenarios.toArray(), []) ?? [];

  const [selId, setSelId] = useState<number | null>(null);
  const sel = scenarios.find((s) => s.id === selId) ?? null;
  const [checkIdx, setCheckIdx] = useState(0);
  const [cmp, setCmp] = useState<string[]>([]);

  // new-scenario form
  const [srcKey, setSrcKey] = useState('');
  const [blankPerson, setBlankPerson] = useState('');
  const [blankYear, setBlankYear] = useState(String(thisYear));
  const [blankSalary, setBlankSalary] = useState(0);
  const [newName, setNewName] = useState('');
  // bonus form
  const [bMonth, setBMonth] = useState('12');
  const [bAmt, setBAmt] = useState(0);
  const [bLabel, setBLabel] = useState('');

  const personName = (id: number) => people.find((p) => p.id === id)?.name ?? '?';
  const settingsFor = (year: number) => allSettings.find((s) => s.year === year);
  const run = (sc: PayScenario) => runScenario(sc, { people, profiles, bonuses, settings: settingsFor(sc.year), vests: rsuVests, securities });
  const actual = (personId: number, year: number) => runActual(personId, year, { people, profiles, bonuses, settings: settingsFor(year), vests: rsuVests, securities });

  const result = useMemo(() => (sel ? run(sel) : null), [sel, people, profiles, bonuses, allSettings, rsuVests, securities]); // eslint-disable-line react-hooks/exhaustive-deps
  const event = result ? result.year.events[Math.min(checkIdx, result.year.events.length - 1)] : null;

  const patch = (p: Partial<PayScenario>) => sel && db.payScenarios.update(sel.id!, { ...p, updatedAt: new Date().toISOString() });
  const nameFor = (s: string) => s.trim() || 'New scenario';

  async function createFromIncome() {
    const prof = profiles.find((p) => `${p.personId}:${p.year}` === srcKey);
    if (!prof) return;
    const id = await db.payScenarios.add(scenarioFromProfile(prof, nameFor(newName) === 'New scenario' ? `${personName(prof.personId)} ${prof.year}: what-if` : newName.trim()));
    setSelId(id);
    setNewName('');
    setCheckIdx(0);
  }
  async function createBlank() {
    const pid = Number(blankPerson);
    const yr = Number(blankYear);
    if (!pid || !yr) return;
    const id = await db.payScenarios.add(blankScenario(pid, yr, nameFor(newName) === 'New scenario' ? `${personName(pid)}: new job` : newName.trim(), blankSalary));
    setSelId(id);
    setNewName('');
    setCheckIdx(0);
  }

  // comparison columns: saved scenarios and each person's real setup
  const compareOptions: { key: string; label: string; isActual: boolean; result: () => ScenarioResult | null }[] = [
    ...profiles.filter((p) => p.year === (sel?.year ?? thisYear)).map((p) => ({ key: `actual:${p.personId}:${p.year}`, label: `${personName(p.personId)}: current setup ${p.year}`, isActual: true, result: () => actual(p.personId, p.year) })),
    ...scenarios.map((s) => ({ key: `sc:${s.id}`, label: s.name, isActual: false, result: () => run(s) })),
  ];
  const compared: (Headline & { isActual: boolean })[] = cmp
    .map((k) => compareOptions.find((o) => o.key === k))
    .map((o) => { const r = o?.result(); return o && r ? { ...headline(r, o.label), isActual: o.isActual } : null; })
    .filter((h): h is Headline & { isActual: boolean } => h !== null);
  const base = compared[0];
  const tableRows: { label: string; f: (h: Headline) => number | null }[] = [
    { label: 'Take-home, one paycheck', f: (h) => h.firstNet },
    { label: 'Take-home, per month (average)', f: (h) => h.monthlyNet },
    { label: 'Take-home, year', f: (h) => h.annualNet },
    { label: 'Gross pay, year', f: (h) => h.annualGross },
    { label: 'Deductions, year', f: (h) => h.deductionsTotal },
    { label: 'Taxes withheld, year', f: (h) => h.withheld },
    { label: '401(k) saved, year', f: (h) => h.k401 },
    { label: 'Employer match, year', f: (h) => h.employerMatch },
    { label: 'Federal refund (+) or amount due (−)', f: (h) => h.fedBalance },
    { label: 'MA refund (+) or amount due (−)', f: (h) => h.maBalance },
  ];

  const sorted = sortScenariosNewestFirst(scenarios);
  const incomeOptions = profiles.slice().sort((a, b) => b.year - a.year);
  const head = result ? headline(result, sel?.name) : null;

  return (
    <div className="an-page pl-page">
      <PageHeader eyebrow="Plan" title="Paycheck calculator" description="Try a raise or new deductions without touching your real setup." about={<>Try a new salary, a raise, or different deductions and see the paycheck and the year. Start from a copy of your setup on the <Link to="/income">Income</Link> tab, or
        start blank and enter everything by hand. Nothing here changes your real setup.</>} />

      <p className="an-note pl-tagline"><Kind k="estimate">Estimate</Kind> Every figure on this page is a what-if worked out from a scenario. Your real setup and real paychecks are on the <Link to="/income">Income</Link> page.</p>

      <div className="an-stack-col">
        <Collapsible id="paycheck.list" title="Saved scenarios">
          {sorted.length === 0 ? <p className="muted">None yet.</p> : (
            <div className="an-tablewrap">
              <table className="an-table an-stack" aria-label="Saved scenarios">
                <thead><tr><th>Name</th><th>Person</th><th>Year</th><th className="num">Salary</th><th /></tr></thead>
                <tbody>
                  {sorted.map((s) => {
                    const sal = [...s.profile.salary].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate)).at(-1)?.annualCents ?? 0;
                    return (
                      <tr key={s.id} className={s.id === selId ? 'is-picked' : ''}>
                        <td className="an-lead an-full"><button className="link an-title" aria-pressed={s.id === selId} onClick={() => { setSelId(s.id!); setCheckIdx(0); }}>{s.name}</button>{s.id === selId && <span className="an-kind pl-sel">Open below</span>}</td>
                        <td data-label="Person">{personName(s.personId)}</td><td data-label="Year">{s.year}</td><td className="num" data-label="Salary">{formatCents(sal)}</td>
                        <td className="an-cell-act">
                          <span className="an-rowbtns">
                            <button className="link" aria-label={`Duplicate ${s.name}`} onClick={async () => { const { id: _i, ...rest } = s; void _i; const id = await db.payScenarios.add({ ...rest, name: `${s.name} (copy)`, updatedAt: new Date().toISOString() }); setSelId(id); }}>duplicate</button>
                            <button className="link danger" aria-label={`Delete ${s.name}`} onClick={() => { if (confirm(`Delete “${s.name}”?`)) { db.payScenarios.delete(s.id!); if (selId === s.id) setSelId(null); setCmp((c) => c.filter((k) => k !== `sc:${s.id}`)); } }}>delete</button>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Collapsible>

        <Collapsible id="paycheck.new" title="Start a scenario">
          <div className="an-stack-col">
            <div className="an-split an-split--even">
            <section className="an-card an-card--soft an-stack-col" aria-labelledby="pc-copy">
              <h3 className="an-h2" id="pc-copy" style={{ fontSize: 'var(--fs-base)' }}>Copy my existing setup</h3>
              <p className="an-note" style={{ margin: 0 }}>Brings in salary, pay schedule, deductions, match, and withholding, which you can then change.</p>
              <label className="f">Person and year
                <select value={srcKey} onChange={(e) => setSrcKey(e.target.value)}>
                  <option value="">Choose…</option>
                  {incomeOptions.map((p) => <option key={`${p.personId}:${p.year}`} value={`${p.personId}:${p.year}`}>{personName(p.personId)}, {p.year}</option>)}
                </select>
              </label>
              {incomeOptions.length === 0 && <p className="warn">Set up income on the Income tab first, or start blank.</p>}
              <div><button className="primary" disabled={!srcKey} onClick={createFromIncome}>Copy into a new scenario</button></div>
            </section>
            <section className="an-card an-card--soft an-stack-col" aria-labelledby="pc-blank">
              <h3 className="an-h2" id="pc-blank" style={{ fontSize: 'var(--fs-base)' }}>Start blank</h3>
              <p className="an-note" style={{ margin: 0 }}>Enter a salary, then add deductions yourself.</p>
              <div className="an-form">
                <label className="f">Person
                  <select value={blankPerson} onChange={(e) => setBlankPerson(e.target.value)}>
                    <option value="">Choose…</option>
                    {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label className="f">Year<input inputMode="numeric" value={blankYear} onChange={(e) => setBlankYear(e.target.value)} /></label>
                <MoneyField label="Yearly salary" cents={blankSalary} onChange={setBlankSalary} />
              </div>
              <div><button className="primary" disabled={!blankPerson || blankSalary <= 0} onClick={createBlank}>Create blank scenario</button></div>
            </section>
            </div>
            <label className="f">Name (optional)<input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. New job offer" /></label>
          </div>
        </Collapsible>
      </div>

      {sel && (
        <div className="pl-cols pl-cols--out-right" aria-label={`Scenario: ${sel.name}`}>
          <div className="pl-out an-stack-col">
            {!result ? (
              <div className="an-card pl-alert" role="alert"><strong>No tax tables for {sel.year}.</strong><p>Add them on the Income tab (Start from 2026 tables), then come back.</p></div>
            ) : (
              <Collapsible id="paycheck.results" title="Results">
                <div className="an-stack-col">
                  {result.year.warnings.map((w) => <p key={w} className="warn" style={{ margin: 0 }}>{w}</p>)}
                  {event && head && (
                    <PlanHero
                      stack
                      label={`Estimated take-home, paycheck of ${event.date}`}
                      kind={<Kind k="estimate">Scenario estimate</Kind>}
                      amount={signed(event.net)}
                      message={<>From “{sel.name}”. This is not an actual paycheck.</>}
                      figs={[
                        { label: 'Per month (average)', value: formatCents(head.monthlyNet) },
                        { label: 'Take-home, year', value: formatCents(head.annualNet) },
                        { label: 'Gross pay, year', value: formatCents(head.annualGross) },
                        { label: 'Taxes withheld, year', value: formatCents(head.withheld) },
                      ]}
                    />
                  )}
                  <div className="an-tools">
                    <label className="f">Paycheck
                      <select value={Math.min(checkIdx, result.year.events.length - 1)} onChange={(e) => setCheckIdx(Number(e.target.value))}>
                        {result.year.events.map((e, i) => <option key={i} value={i}>{e.date}{e.kind !== 'regular' ? ` · ${e.label}` : ''}</option>)}
                      </select>
                    </label>
                    <span className="an-note" style={{ margin: 0 }}>{result.year.events.filter((e) => e.kind === 'regular').length} regular paychecks in {sel.year}</span>
                  </div>
                  {event && (
                    <div className="an-tablewrap">
                      <table className="an-table">
                        <thead><tr><th>This paycheck ({event.date})</th><th className="num">Amount</th><th className="num">Whole year</th></tr></thead>
                        <tbody>
                          {paycheckLines(result, event).map((l, i) => (
                            <tr key={i} style={l.kind === 'net' || l.kind === 'gross' ? { fontWeight: 600 } : undefined}>
                              <td>{l.label}</td>
                              <td className="num">{signed(l.cents)}</td>
                              <td className="num">{signed(l.yearCents ?? 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {event.notes.length > 0 && <p className="warn">{event.notes.join('; ')}</p>}
                    </div>
                  )}

                  {result.household && (
                    <div className="an-split an-split--even">
                      <section className="an-card an-card--soft" aria-labelledby="pc-fed">
                        <h3 className="an-h2" id="pc-fed" style={{ fontSize: 'var(--fs-base)' }}>Federal income tax for the year</h3>
                        <table className="an-table"><tbody>
                          <tr><td>Taxable income</td><td className="num">{formatCents(result.household.federal.taxableIncome)}</td></tr>
                          <tr><td>Total owed</td><td className="num">{formatCents(result.household.federal.totalLiability)}</td></tr>
                          <tr><td>Withheld</td><td className="num">{formatCents(result.household.federal.withheld)}</td></tr>
                          <tr><td><strong>{result.household.federal.balance >= 0 ? 'Expected refund' : 'Expected amount due'}</strong></td>
                            <td className="num"><strong>{formatCents(Math.abs(result.household.federal.balance))}</strong></td></tr>
                        </tbody></table>
                      </section>
                      <section className="an-card an-card--soft" aria-labelledby="pc-ma">
                        <h3 className="an-h2" id="pc-ma" style={{ fontSize: 'var(--fs-base)' }}>Massachusetts income tax for the year</h3>
                        <table className="an-table"><tbody>
                          <tr><td>Taxable income</td><td className="num">{formatCents(result.household.ma.taxableIncome)}</td></tr>
                          <tr><td>Total owed</td><td className="num">{formatCents(result.household.ma.totalLiability)}</td></tr>
                          <tr><td>Withheld</td><td className="num">{formatCents(result.household.ma.withheld)}</td></tr>
                          <tr><td><strong>{result.household.ma.balance >= 0 ? 'Expected refund' : 'Expected amount due'}</strong></td>
                            <td className="num"><strong>{formatCents(Math.abs(result.household.ma.balance))}</strong></td></tr>
                        </tbody></table>
                      </section>
                    </div>
                  )}
                  <section className="an-card an-card--soft" aria-labelledby="pc-dates">
                    <h3 className="an-h2" id="pc-dates" style={{ fontSize: 'var(--fs-base)' }}>Key dates</h3>
                    {(() => {
                      const m = result.year.milestones;
                      const rows: [string, string | null][] = [['Social Security cap reached', m.ssCapDate], ['401(k) annual limit reached', m.k401LimitDate], ['Employer 401(k) yearly maximum reached', m.matchCapDate], ['HSA limit reached', m.hsaLimitDate], ['ESPP limit reached', m.esppCapDate], ['Additional Medicare starts', m.addlMedicareStartDate]];
                      const hit = rows.filter((r) => r[1]);
                      return hit.length ? <ul className="pl-dates">{hit.map(([l, d]) => <li key={l}><strong className="pl-date">{fmtDate(d)}</strong><span>{l}</span></li>)}</ul> : <p className="muted" style={{ margin: 0 }}>No caps are reached this year.</p>;
                    })()}
                  </section>
                  <p className="an-note" style={{ margin: 0 }}>{result.household ? 'Yearly tax uses the Income tab’s household settings. ' : ''}This is a planning estimate, not a substitute for your pay stub or W-2.</p>
                </div>
              </Collapsible>
            )}
          </div>

          <div className="pl-in an-stack-col">
            <Collapsible id="paycheck.edit" title={`Edit: ${sel.name}`}>
              <div className="an-stack-col">
                <div className="an-tools" style={{ border: 'none', padding: 0 }}>
                  <label className="f" style={{ minWidth: 220 }}>Name<input value={sel.name} onChange={(e) => patch({ name: e.target.value })} /></label>
                  <span className="an-note" style={{ margin: 0 }}><Kind k="input">Your inputs</Kind> {personName(sel.personId)}, {sel.year} · started {sel.startedFrom === 'income' ? 'from a copy of the Income setup' : 'blank'}</span>
                </div>
                <div className="an-checks" style={{ marginTop: 0 }}>
                  <label className="chk"><input type="checkbox" checked={sel.includeSpouse} onChange={(e) => patch({ includeSpouse: e.target.checked })} /> Include the other person’s real income when estimating the household’s yearly tax (your Income tab’s tax settings are used)</label>
                </div>

                <section className="an-card an-card--soft" aria-labelledby="pc-bonus">
                  <h3 className="an-h2" id="pc-bonus" style={{ fontSize: 'var(--fs-base)' }}>Bonuses in this scenario</h3>
                  <div className="an-form an-form--wide" style={{ marginTop: 'var(--sp-3)' }}>
                    <label className="f">Month<select value={bMonth} onChange={(e) => setBMonth(e.target.value)}>{MONTHS.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}</select></label>
                    <MoneyField label="Gross amount" cents={bAmt} onChange={setBAmt} />
                    <label className="f">Label<input value={bLabel} onChange={(e) => setBLabel(e.target.value)} placeholder="Signing, annual…" /></label>
                    <div className="pl-formbtn"><button disabled={bAmt <= 0} onClick={() => { patch({ bonuses: [...sel.bonuses, { month: Number(bMonth), grossCents: bAmt, label: bLabel.trim() || 'Bonus' }] }); setBAmt(0); setBLabel(''); }}>Add bonus</button></div>
                  </div>
                  {sel.bonuses.length > 0 && (
                    <div className="an-tablewrap" style={{ marginTop: 'var(--sp-3)' }}>
                      <table className="an-table an-stack" aria-label="Bonuses in this scenario"><thead><tr><th>Month</th><th>Label</th><th className="num">Gross</th><th /></tr></thead><tbody>
                        {sel.bonuses.map((b, i) => (
                          <tr key={i}><td data-label="Month">{monthName(b.month)}</td><td data-label="Label">{b.label}</td><td className="num" data-label="Gross">{formatCents(b.grossCents)}</td>
                            <td className="an-cell-act"><button className="link danger" aria-label={`Delete bonus ${b.label}, ${monthName(b.month)}`} onClick={() => patch({ bonuses: sel.bonuses.filter((_, j) => j !== i) })}>delete</button></td></tr>
                        ))}
                      </tbody></table>
                    </div>
                  )}
                </section>

                {(() => {
                  const person = people.find((p) => p.id === sel.personId);
                  return person ? (
                    <ProfileEditor
                      key={sel.id}
                      live
                      person={person}
                      profile={sel.profile}
                      onSave={(p) => patch({ profile: p })}
                      onDelete={() => { if (confirm('Reset this scenario to a blank setup with the same salary?')) { const sal = [...sel.profile.salary].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate)).at(-1)?.annualCents ?? 0; const b = blankScenario(sel.personId, sel.year, sel.name, sal); patch({ profile: b.profile }); } }}
                      deleteLabel="clear deductions and start over"
                    />
                  ) : null;
                })()}
              </div>
            </Collapsible>
          </div>
        </div>
      )}

      <Collapsible id="paycheck.compare" title="Compare">
        {compareOptions.length === 0 ? <p className="muted">Create a scenario or set up income to compare.</p> : (
          <>
            <p className="an-note" style={{ marginTop: 0 }}>Pick two or more. Differences are measured against the first one you pick.</p>
            <ul className="pl-pick" aria-label="Choose what to compare">
              {compareOptions.map((o) => (
                <li key={o.key}>
                  <label className="chk">
                    <input type="checkbox" checked={cmp.includes(o.key)} onChange={(e) => setCmp(e.target.checked ? [...cmp, o.key] : cmp.filter((k) => k !== o.key))} /> <span>{o.label}</span>
                  </label>
                  {o.isActual ? <Kind k="recorded">Your real setup</Kind> : <Kind k="estimate">Scenario</Kind>}
                </li>
              ))}
            </ul>
            {compared.length > 0 && (
              <>
                <div className="an-tablewrap" style={{ marginTop: 'var(--sp-4)' }}>
                  <table className="an-table an-matrix" aria-label="Scenario comparison">
                    <thead><tr><th scope="col"><span className="pl-vh">What is compared</span></th> {compared.map((h, i) => <th className="num" key={h.label} scope="col">{h.label}<span className="an-sub">{h.isActual ? 'Your real setup' : 'Scenario estimate'}{i === 0 ? ' · baseline' : ''}</span></th>)}</tr></thead>
                    <tbody>
                      {tableRows.map((r) => (
                        <tr key={r.label}>
                          <td>{r.label}</td>
                          {compared.map((h, i) => {
                            const v = r.f(h);
                            const b = base ? r.f(base) : null;
                            return <td className="num" key={h.label}>{v === null ? '—' : signed(v)}{i > 0 && v !== null && b !== null && <Delta v={v - b} />}</td>;
                          })}
                        </tr>
                      ))}
                      <tr>
                        <td>Social Security cap reached</td>{compared.map((h) => <td className="num" key={h.label}>{fmtDate(h.ssCapDate)}</td>)}
                      </tr>
                      <tr>
                        <td>401(k) limit reached</td>{compared.map((h) => <td className="num" key={h.label}>{fmtDate(h.k401LimitDate)}</td>)}
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="an-scrollhint">Scroll sideways to see every column.</p>
              </>
            )}
          </>
        )}
      </Collapsible>
    </div>
  );
}
