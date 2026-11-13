import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { TAX_YEARS, builtInTables, latestBuiltInYear } from '../data/taxYears';
import type { IncomeProfile, TaxSettings } from '../types';
import { formatCents, todayISO } from '../lib/money';
import { buildIncomeModel, DEFAULT_SETTINGS, newProfile, parseTablesJson, resolveTables, rollForward } from '../lib/income';
import { monthlyNet, type PersonYear } from '../lib/payroll';
import ProfileEditor from './ProfileEditor';
import { MoneyField, NumField } from './fields';
import Collapsible from './Collapsible';
import RsuSection from './RsuSection';
import { PersonBonuses, PersonPaycheckDetail, PersonWorkspace, UnassignedBonuses } from './PersonWorkspace';
import { MONTHS, monthName, personAnchorId, personSummary, scopeRows } from './incomeOwners';
import { hsaYearImpact } from '../lib/hsa';
import { netForTax, realizedFor } from '../lib/lots';
import { PageHeader } from '../ui/components';
import TaxProvenanceNote, { CustomTableNotice, customTableDifferences } from './TaxProvenance';
import { Kind, Lines, PlanHero, PlanJump } from './PlanParts';
import './analysis.css';
import './plan.css';

const fmtDate = (d: string | null) => (d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—');

function Milestones({ y, name }: { y: PersonYear; name: string }) {
  const rows: [string, string | null, string][] = [
    ['Social Security cap reached', y.milestones.ssCapDate, 'No more 6.2% Social Security on pay after this; take-home rises.'],
    ['401(k) annual limit reached', y.milestones.k401LimitDate, 'Deferrals stop after this paycheck; take-home rises (and a non-true-up match stops).'],
    ['Employer 401(k) yearly maximum reached', y.milestones.matchCapDate, 'The employer contribution stops after this paycheck.'],
    ['HSA limit reached', y.milestones.hsaLimitDate, ''],
    ['ESPP limit reached', y.milestones.esppCapDate, 'IRS $25,000 stock-value limit.'],
    ['Additional Medicare (0.9%) starts', y.milestones.addlMedicareStartDate, 'Withholding on wages above $200,000.'],
  ];
  const hit = rows.filter((r) => r[1]);
  return (
    <div className="pl-dates">
      <h4 className="an-h3">{name}: key dates</h4>
      {hit.length === 0 ? <p className="muted">No caps are reached this year.</p> : (
        <ul>{hit.map(([l, d, h]) => <li key={l}><strong className="pl-date">{fmtDate(d)}</strong><span>{l}{h && <span className="muted"> ({h})</span>}</span></li>)}</ul>
      )}
    </div>
  );
}

export default function IncomePage() {
  const thisYear = Number(todayISO().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const peopleQuery = useLiveQuery(() => db.people.toArray(), []);
  const people = peopleQuery ?? [];
  const profiles = useLiveQuery(() => db.incomeProfiles.toArray(), []) ?? [];
  const bonuses = useLiveQuery(() => db.bonuses.toArray(), []) ?? [];
  const allSettings = useLiveQuery(() => db.taxSettings.toArray(), []) ?? [];
  const rsuVests = useLiveQuery(() => db.rsuVests.toArray(), []) ?? [];
  const rsuGrants = useLiveQuery(() => db.rsuGrants.toArray(), []) ?? [];
  const securities = useLiveQuery(() => db.securities.toArray(), []) ?? [];
  const invAccounts = useLiveQuery(() => db.invAccounts.toArray(), []) ?? [];
  const hsaWithdrawals = useLiveQuery(() => db.hsaWithdrawals.toArray(), []) ?? [];
  const sales = useLiveQuery(() => db.sales.toArray(), []) ?? [];
  const settings = allSettings.find((s) => s.year === year);

  const hsaImpact = useMemo(() => hsaYearImpact(hsaWithdrawals, invAccounts, people, year), [hsaWithdrawals, invAccounts, people, year]);
  const realized = useMemo(() => realizedFor(sales, year), [sales, year]);
  const gains = useMemo(() => netForTax(realized), [realized]);
  const model = useMemo(
    () => buildIncomeModel(year, people, profiles, bonuses, settings, { vests: rsuVests, securities }, { taxableCents: hsaImpact.taxableCents, penaltyCents: hsaImpact.penaltyCents }, gains),
    [year, people, profiles, bonuses, settings, rsuVests, securities, hsaImpact, gains],
  );
  const yearsWithData = [...new Set([...profiles.map((p) => p.year), thisYear, thisYear + 1])].sort();

  const [newName, setNewName] = useState('');
  const [newBirth, setNewBirth] = useState('');
  /** Bumped when the jump list asks for a person, so that person's folded workspace opens before the page scrolls to it. */
  const [openSignals, setOpenSignals] = useState<Record<number, number>>({});
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
  const personName = (id: number) => people.find((p) => p.id === id)?.name ?? '?';
  const hh = model.household;
  // Records whose person is not on the page (only judged once the people list has loaded). They are shown for review, never changed or hidden.
  const noPerson = { unassigned: true };
  const orphanBonuses = peopleQuery ? scopeRows(bonuses, noPerson, people) : [];
  const orphanVests = peopleQuery ? scopeRows(rsuVests, noPerson, people) : [];
  const orphanGrants = peopleQuery ? scopeRows(rsuGrants, noPerson, people) : [];
  const needsReview = orphanBonuses.length + orphanVests.length + orphanGrants.length > 0;

  const tablesForEdit = () => {
    const r = resolveTables(year, settings);
    const from = latestBuiltInYear();
    const base = r.tables ?? { ...TAX_YEARS[from], year, notes: [`Copied from ${from} as a starting point for ${year}. Update every number from the IRS, SSA, and MA DOR before relying on it.`] };
    const { provenance: _p, ...editable } = base; // the source list is shown on the page, not edited as text
    void _p;
    return JSON.stringify(editable, null, 2);
  };
  const showResults = model.years.length > 0 && !!model.tables && !!hh;
  const totalGross = model.years.reduce((a, y) => a + y.totals.gross, 0);
  const totalNet = model.years.reduce((a, y) => a + y.totals.net, 0);

  return (
    <div className="an-page pl-page">
      <PageHeader eyebrow="Plan" title="Income" description="Salary, bonuses, stock awards, and what taxes take." actions={<><label className="row">Year
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {yearsWithData.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label></>} />

      {model.tableSource === 'none' && (
        <div className="an-card pl-alert" role="alert">
          <strong>No tax tables for {year}.</strong>
          <p>
            I don’t guess at tax law, so nothing is calculated for {year} until tables exist. The IRS usually publishes next year’s limits in
            October or November. Start from the {latestBuiltInYear()} tables, update the numbers, and save.
          </p>
          <div className="an-actions"><button className="primary" onClick={() => { setTablesText(tablesForEdit()); setTablesMsg(''); }}>Start from {latestBuiltInYear()} tables</button></div>
        </div>
      )}
      {model.tableSource === 'built-in' && model.tables && (
        <p className="an-note pl-tables-note">
          <Kind k="recorded">Tax tables</Kind> Using built-in {year} tax tables (federal MFJ, Social Security, MA).{' '}
          <button className="link" onClick={() => { setTablesText(tablesForEdit()); setTablesMsg(''); }}>view or edit</button>
        </p>
      )}
      {year === 2027 && model.tableSource === 'custom' && model.tables && builtInTables(year) && (
        <CustomTableNotice year={year} differences={customTableDifferences(model.tables, builtInTables(year)!)} onEdit={() => { setTablesText(tablesForEdit()); setTablesMsg(''); }} />
      )}
      {model.tableSource === 'built-in' && model.tables?.provenance && <TaxProvenanceNote year={year} provenance={model.tables.provenance} />}
      {model.capGainsRules && !model.capGainsRules.exact && (
        <p className="an-note" role="status">Capital-gains and net investment income rules for {year} are not built in, so {model.capGainsRules.ruleYear} thresholds were used. Check them before relying on gains figures.</p>
      )}
      {model.tableSource === 'custom' && <p className="an-note pl-tables-note"><Kind k="recorded">Tax tables</Kind> Using your edited {year} tax tables. <button className="link" onClick={() => { setTablesText(tablesForEdit()); setTablesMsg(''); }}>view or edit</button></p>}

      {tablesText !== null && (
        <section className="an-card" aria-label={`Tax tables for ${year}`}>
          <h2 className="an-h2">Tax tables for {year} <span className="an-small muted">(amounts in cents)</span></h2>
          <p className="an-note">Fields marked UNVERIFIED in the notes could not be confirmed from an official source. Save stores your edited copy in this browser.</p>
          <textarea aria-label={`Tax tables for ${year}, as text`} value={tablesText} onChange={(e) => setTablesText(e.target.value)} rows={16} style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.8rem' }} />
          <div className="an-actions">
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
            {tablesMsg && <span className={tablesMsg === 'Saved.' ? 'ok' : 'error'} role="status">{tablesMsg}</span>}
          </div>
        </section>
      )}

      {showResults && hh && (
        <>
          <PlanHero
            label={`Household take-home, ${year}`}
            kind={<Kind k="estimate">Estimate</Kind>}
            amount={formatCents(totalNet)}
            message={<>Modeled from the income set up on this page, not read from your paychecks. <strong>Stock awards count as income on the day they vest</strong>; an award that has not vested is not money you have received.</>}
            figs={[
              { label: 'Gross pay', value: formatCents(totalGross), sub: 'before taxes and deductions' },
              { label: 'Social Security + Medicare', value: formatCents(hh.ficaTotal), sub: `MA PFML ${formatCents(hh.pfmlTotal)}` },
              { label: `Federal: ${hh.federal.balance >= 0 ? 'expected refund' : 'expected amount due'}`, value: formatCents(Math.abs(hh.federal.balance)) },
              { label: `Massachusetts: ${hh.ma.balance >= 0 ? 'expected refund' : 'expected amount due'}`, value: formatCents(Math.abs(hh.ma.balance)) },
            ]}
          />
        </>
      )}

      <PlanJump items={[
        { id: 'income-people', label: 'People' },
        ...people.map((p) => ({ id: personAnchorId(p.id!), label: p.name, onJump: () => setOpenSignals((o) => ({ ...o, [p.id!]: (o[p.id!] ?? 0) + 1 })) })),
        ...(needsReview ? [{ id: 'income-review', label: 'Needs review' }] : []),
        { id: 'income-tax', label: 'Household tax settings' },
        ...(showResults ? [{ id: 'income-results', label: `${year} results` }] : []),
      ]} />

      <div id="income-people" className="pl-anchor" tabIndex={-1}>
        <Collapsible id="income.people" title="People">
          <p className="an-note pw-note">These are the people Income is set up for. They are kept separate from the people in Family and are not matched to them.</p>
          <div className="an-form an-form--wide">
            <label className="f">Name<input value={newName} onChange={(e) => setNewName(e.target.value)} /></label>
            <label className="f">Birth year<input inputMode="numeric" value={newBirth} onChange={(e) => setNewBirth(e.target.value)} /></label>
            <div className="pl-formbtn">
              <button
                onClick={async () => {
                  if (!newName.trim()) return;
                  await db.people.add({ name: newName.trim(), birthYear: newBirth ? Number(newBirth) : null });
                  setNewName('');
                  setNewBirth('');
                }}
              >Add person</button>
            </div>
          </div>
          {people.length > 0 && <ul className="an-chipline pl-peoplelist">{people.map((p) => <li key={p.id}><span className="an-chip">{p.name}{p.birthYear ? <b>b. {p.birthYear}</b> : null}</span></li>)}</ul>}
          <p className="an-note">Birth year sets 401(k) catch-up (50+, and the larger 60–63 amount) and HSA catch-up (55+).</p>
          {people.length === 0 && <p className="muted">Add yourself and your spouse to begin.</p>}
        </Collapsible>
      </div>

      {people.length > 0 && (
        <section className="pw-list" aria-label={`Compensation by person, ${year}`}>
          <p className="pw-eyebrow">Each person’s pay, bonuses and stock awards for {year}. Open as many as you like; opening one changes nothing.</p>
          {people.map((p, i) => {
            const prof = profiles.find((x) => x.personId === p.id && x.year === year);
            const prev = profiles.find((x) => x.personId === p.id && x.year === year - 1);
            const py = model.years.find((y) => y.personId === p.id);
            const summary = personSummary(year, prof, py, !!model.tables);
            return (
              <div id={personAnchorId(p.id!)} className="pl-anchor" tabIndex={-1} key={p.id}>
                <PersonWorkspace person={p} index={i} year={year} summary={summary} openSignal={openSignals[p.id!]}>
                  {py && (
                    <section className="pw-section" aria-label={`${p.name}: ${year} at a glance`}>
                      <h3 className="pw-h3">{year} at a glance <Kind k="estimate">Estimate</Kind></h3>
                      <Lines
                        rows={[
                          { label: 'Gross pay', value: formatCents(py.totals.gross), strong: true },
                          ...(py.totals.bonusGross > 0 ? [{ label: 'of which bonus', value: formatCents(py.totals.bonusGross), muted: true }] : []),
                          ...(py.totals.rsuGross > 0 ? [{ label: 'of which stock awards (counted when they vest)', value: formatCents(py.totals.rsuGross), muted: true }] : []),
                          { label: 'Take-home', value: formatCents(py.totals.net), strong: true },
                          { label: '401(k) pre-tax + Roth', value: `${formatCents(py.contributions.k401Pretax)} + ${formatCents(py.contributions.k401Roth)}`, muted: true },
                          ...(py.contributions.employerMatch > 0 ? [{ label: 'Employer 401(k) match', value: formatCents(py.contributions.employerMatch), muted: true }] : []),
                          ...(py.contributions.hsa > 0 || py.contributions.employerHsa > 0 ? [{ label: 'HSA (you + employer)', value: formatCents(py.contributions.hsa + py.contributions.employerHsa), muted: true }] : []),
                          ...(py.contributions.espp > 0 ? [{ label: 'ESPP', value: formatCents(py.contributions.espp), muted: true }] : []),
                        ]}
                      />
                      {py.warnings.map((w) => <p key={w} className="warn pl-warn">{w}</p>)}
                    </section>
                  )}

                  <section className="pw-section" aria-label={`Pay setup for ${p.name}, ${year}`}>
                    {!prof ? (
                      <div className="pl-setup pw-setup">
                        <span><strong>Pay setup:</strong> no income set up for {p.name} in {year}. Bonuses and stock awards below are still kept.</span>
                        <div className="an-actions" style={{ margin: 0 }}>
                          <button className="primary" onClick={() => save(newProfile(p.id!, year))}>Set up {year}</button>
                          {prev && <button onClick={() => save(rollForward(prev, year))}>Copy from {year - 1}</button>}
                        </div>
                      </div>
                    ) : (
                      <ProfileEditor
                        key={`${prof.id}`}
                        embedded
                        person={p}
                        profile={prof}
                        onSave={save}
                        onCopyPrev={prev ? () => confirm(`Replace ${p.name}'s ${year} setup with ${year - 1}'s?`) && save({ ...rollForward(prev, year), id: prof.id }) : undefined}
                        onDelete={() => confirm(`Remove ${p.name}'s ${year} income setup?`) && db.incomeProfiles.delete(prof.id!)}
                      />
                    )}
                  </section>

                  <PersonBonuses person={p} year={year} bonuses={bonuses} />

                  <section className="pw-section" aria-label={`Stock awards for ${p.name}`}>
                    <p className="an-note pl-equity"><Kind k="projected">Equity</Kind> Stock awards are income on the day each vest happens. They are kept apart from salary and bonus, and the vest schedule feeds {p.name}’s take-home and the household tax figures.</p>
                    <RsuSection personId={p.id} year={year} people={people} profiles={profiles} model={model} vests={rsuVests} securities={securities} invAccounts={invAccounts} tables={model.tables} />
                  </section>

                  {py && prof && <PersonPaycheckDetail py={py} profile={prof} name={p.name} />}
                </PersonWorkspace>
              </div>
            );
          })}
        </section>
      )}

      {needsReview && (
        <div id="income-review" className="pl-anchor" tabIndex={-1}>
          <section className="an-card pl-alert pw-review" aria-labelledby="income-review-h">
            <h2 className="an-h2" id="income-review-h">Needs review: records with no matching person</h2>
            <p>These records point to a person who is not in the People list above, so they are not counted in anyone’s figures. Nothing was changed or moved. Editing a grant or a vest lets you choose its person; a bonus can only be deleted.</p>
            <UnassignedBonuses bonuses={orphanBonuses} />
            {(orphanVests.length > 0 || orphanGrants.length > 0) && (
              <RsuSection unassigned year={year} people={people} profiles={profiles} model={model} vests={rsuVests} securities={securities} invAccounts={invAccounts} tables={model.tables} />
            )}
          </section>
        </div>
      )}

      <div id="income-tax" className="pl-anchor" tabIndex={-1}>
        <Collapsible id="income.household" title="Household tax settings">
          <div className="an-form an-form--wide">
            <MoneyField key={`i${year}`} label="Itemized deductions (if larger than standard)" cents={settings?.itemizedDeductionCents ?? 0} onChange={(c) => setSettings({ itemizedDeductionCents: c })} />
            <MoneyField key={`o${year}`} label="Other taxable income" cents={settings?.otherIncomeCents ?? 0} onChange={(c) => setSettings({ otherIncomeCents: c })} />
            <MoneyField key={`f${year}`} label="Federal credits (e.g. child tax credit)" cents={settings?.federalCreditsCents ?? 0} onChange={(c) => setSettings({ federalCreditsCents: c })} />
            <NumField key={`d${year}`} label="MA dependents" value={settings?.maDependents ?? 0} step={1} onChange={(n) => setSettings({ maDependents: n })} />
            <MoneyField key={`m${year}`} label="MA credits" cents={settings?.maCreditsCents ?? 0} onChange={(c) => setSettings({ maCreditsCents: c })} />
          </div>
          <p className="an-note">Credit amounts are yours to enter; I don’t apply dependent credits automatically because the rules depend on your situation.</p>
        </Collapsible>
      </div>

      {showResults && hh && model.tables && (
        <div id="income-results" className="pl-anchor" tabIndex={-1}>
          <Collapsible id="income.results" title={`${year} results`}>
            <p className="an-note" style={{ marginTop: 0 }}><Kind k="estimate">Estimate</Kind> Everything in this section is worked out from the setup above; none of it is an actual tax return.</p>
            <div className="an-split an-split--even" style={{ marginTop: 'var(--sp-3)' }}>
              <section className="an-card an-card--soft" aria-labelledby="inc-fed">
                <h3 className="an-h2" id="inc-fed" style={{ fontSize: 'var(--fs-base)' }}>Federal income tax</h3>
                <table className="an-table"><tbody>
                  <tr><td>Wages (after pre-tax items)</td><td className="num">{formatCents(hh.federal.wages)}</td></tr>
                  {hh.federal.otherIncome > 0 && <tr><td>Other income{hsaImpact.taxableCents > 0 && <span className="muted"> (incl. {formatCents(hsaImpact.taxableCents)} HSA withdrawals not for medical costs)</span>}</td><td className="num">{formatCents(hh.federal.otherIncome)}</td></tr>}
                  <tr><td>{hh.federal.usedItemized ? 'Itemized' : 'Standard'} deduction</td><td className="num">−{formatCents(hh.federal.deduction)}</td></tr>
                  <tr><td>Taxable income</td><td className="num">{formatCents(hh.federal.taxableIncome)}</td></tr>
                  {realized.count > 0 && <tr><td className="muted">Sales this year: {formatCents(realized.shortTermCents)} short-term, {formatCents(realized.longTermCents)} long-term{gains.lossDeductionCents > 0 && ` (loss deduction ${formatCents(gains.lossDeductionCents)})`}</td><td /></tr>}
                  <tr><td>Tax {hh.federal.credits > 0 && `(after ${formatCents(hh.federal.credits)} credits)`}</td><td className="num">{formatCents(hh.federal.incomeTax)}</td></tr>
                  {hh.federal.addlMedicareLiability > 0 && <tr><td>Additional Medicare</td><td className="num">{formatCents(hh.federal.addlMedicareLiability)}</td></tr>}
                  {hh.federal.hsaPenalty > 0 && <tr><td>HSA 20% penalty</td><td className="num">{formatCents(hh.federal.hsaPenalty)}</td></tr>}
                  {hh.federal.niit > 0 && <tr><td>Net investment income tax (3.8%)</td><td className="num">{formatCents(hh.federal.niit)}</td></tr>}
                  <tr><td><strong>Total owed</strong></td><td className="num"><strong>{formatCents(hh.federal.totalLiability)}</strong></td></tr>
                  <tr><td>Withheld from paychecks</td><td className="num">{formatCents(hh.federal.withheld)}</td></tr>
                  <tr><td><strong>{hh.federal.balance >= 0 ? 'Expected refund' : 'Expected amount due'}</strong></td><td className="num"><strong>{formatCents(Math.abs(hh.federal.balance))}</strong></td></tr>
                </tbody></table>
              </section>
              <section className="an-card an-card--soft" aria-labelledby="inc-ma">
                <h3 className="an-h2" id="inc-ma" style={{ fontSize: 'var(--fs-base)' }}>Massachusetts income tax</h3>
                <table className="an-table"><tbody>
                  <tr><td>MA wages</td><td className="num">{formatCents(hh.ma.wages)}</td></tr>
                  <tr><td>Exemptions</td><td className="num">−{formatCents(hh.ma.exemptions)}</td></tr>
                  <tr><td>Social Security/Medicare deduction</td><td className="num">−{formatCents(hh.ma.ficaDeduction)}</td></tr>
                  <tr><td>Taxable income</td><td className="num">{formatCents(hh.ma.taxableIncome)}</td></tr>
                  <tr><td>Tax (5%)</td><td className="num">{formatCents(hh.ma.baseTax)}</td></tr>
                  {hh.ma.surtax > 0 && <tr><td>4% surtax</td><td className="num">{formatCents(hh.ma.surtax)}</td></tr>}
                  {hh.ma.credits > 0 && <tr><td>Credits</td><td className="num">−{formatCents(hh.ma.credits)}</td></tr>}
                  <tr><td><strong>Total owed</strong></td><td className="num"><strong>{formatCents(hh.ma.totalLiability)}</strong></td></tr>
                  <tr><td>Withheld from paychecks</td><td className="num">{formatCents(hh.ma.withheld)}</td></tr>
                  <tr><td><strong>{hh.ma.balance >= 0 ? 'Expected refund' : 'Expected amount due'}</strong></td><td className="num"><strong>{formatCents(Math.abs(hh.ma.balance))}</strong></td></tr>
                </tbody></table>
              </section>
            </div>

            <section className="an-card an-card--soft pl-milestones" aria-label="Key dates">
              {model.years.map((y) => <Milestones key={y.personId} y={y} name={personName(y.personId)} />)}
            </section>

            <Collapsible id="income.monthly" level={3} title="Take-home by month">
              <div className="an-tablewrap">
                <table className="an-table an-matrix">
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
              </div>
              <p className="an-scrollhint">Scroll sideways to see every column.</p>
              <p className="an-note">Numbers in parentheses are paychecks received that month (including bonuses). Months with an extra paycheck stand out.</p>
            </Collapsible>

            <p className="an-note" style={{ marginTop: 'var(--sp-3)' }}>Each person’s paycheck-by-paycheck detail is in that person’s workspace above.</p>

            <section className="an-card an-card--soft" style={{ marginTop: 'var(--sp-4)' }} aria-labelledby="inc-about">
              <h3 className="an-h2" id="inc-about" style={{ fontSize: 'var(--fs-base)' }}>About these numbers</h3>
              <ul>{model.tables.notes.map((n) => <li key={n} className="muted">{n}</li>)}</ul>
              <p className="an-note">This is a planning model, not tax advice or a substitute for your pay stubs and W-2.</p>
            </section>
          </Collapsible>
        </div>
      )}
    </div>
  );
}
