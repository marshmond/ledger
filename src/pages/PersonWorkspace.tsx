import { useEffect, useId, useState, type ReactNode } from 'react';
import { db } from '../db';
import type { Bonus, IncomeProfile, Person } from '../types';
import type { PersonYear } from '../lib/payroll';
import { formatCents } from '../lib/money';
import { MoneyField } from './fields';
import { useCollapsed } from './Collapsible';
import { Kind } from './PlanParts';
import { MONTHS, bonusFor, monthName, personCollapseId, personStartsOpen, type PersonSummary } from './incomeOwners';

/**
 * D18.1: the pieces of one person's compensation workspace on the Income page.
 * These draw records that already exist and use the page's own handlers. A person's workspace shows that person's records only, found by the stored
 * person id (never by name or position); nothing is reassigned, repaired or created by opening, folding or drawing one.
 */

function SummaryFig({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <span className="pw-fig">
      <span className="pw-fig-l">{label}</span>
      <span className="pw-fig-v">{value}</span>
      {note && <span className="pw-fig-n">{note}</span>}
    </span>
  );
}

/** What the folded header says about one person (the income model's own figures for the selected year, or a plain "Not set up"). */
export function SummaryLine({ s, year }: { s: PersonSummary; year: number }) {
  if (s.state === 'not-set-up') return <span className="pw-state">Not set up for {year}</span>;
  if (s.state === 'not-calculated') return <span className="pw-state">{s.reason}</span>;
  return (
    <>
      <SummaryFig label="Gross pay" value={formatCents(s.gross)} />
      <SummaryFig label="Take-home" value={formatCents(s.net)} />
      {s.bonusGross > 0 && <SummaryFig label="Bonus" value={formatCents(s.bonusGross)} />}
      {s.rsuGross > 0 && <SummaryFig label="Stock awards" value={formatCents(s.rsuGross)} note="counted when they vest" />}
      {s.warnings > 0 && <span className="pw-flag">{s.warnings} {s.warnings === 1 ? 'note' : 'notes'} to read</span>}
    </>
  );
}

/**
 * One person's expandable workspace. Opening and closing it is a screen preference remembered on this device under the person's stable id; it never touches the
 * database. The content stays mounted while folded, so anything half-typed in a form is not lost.
 */
export function PersonWorkspace({
  person, index, year, summary, openSignal, children,
}: {
  person: Person;
  /** Only decides the starting state when this device has no saved choice: the first person starts open, the others folded. */
  index: number;
  year: number;
  summary: PersonSummary;
  /** Changes when the jump list asks for this person: the workspace opens so the jump never lands on hidden content. */
  openSignal?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useCollapsed(personCollapseId(person.id!), personStartsOpen(index));
  const bodyId = useId();
  const nameId = `${bodyId}-name`;
  const sumId = `${bodyId}-sum`;
  useEffect(() => {
    if (openSignal) setOpen(true);
  }, [openSignal, setOpen]);
  return (
    <article className="an-card pw" data-person={person.id}>
      <h2 className="pw-head">
        <button type="button" className="pw-toggle" aria-expanded={open} aria-controls={bodyId} aria-labelledby={`${nameId}`} aria-describedby={sumId} onClick={() => setOpen(!open)}>
          <span className="chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
          <span className="pw-id">
            <span className="pw-name" id={nameId}>{person.name}<span className="pw-year"> · {year} compensation</span></span>
            <Kind k="estimate">Estimate</Kind>
          </span>
          <span className="pw-sum" id={sumId}><SummaryLine s={summary} year={year} /></span>
        </button>
      </h2>
      <div id={bodyId} className="pw-body" hidden={!open}>{children}</div>
    </article>
  );
}

/** A person's bonuses for the selected year, with the same add and delete actions the page always had. New bonuses are saved under this person. */
export function PersonBonuses({ person, year, bonuses }: { person: Person; year: number; bonuses: Bonus[] }) {
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [amt, setAmt] = useState(0);
  const [label, setLabel] = useState('');
  const mine = bonuses.filter((b) => b.personId === person.id && b.year === year).sort((a, b) => a.month - b.month);
  return (
    <section className="pw-section" aria-label={`Bonuses for ${person.name}, ${year}`}>
      <h3 className="pw-h3">Bonuses</h3>
      <p className="an-note pw-note">Enter each bonus by the month it is paid (assumed mid-month). Add, change, or remove them whenever the timing changes; everything updates.</p>
      <div className="an-form an-form--wide">
        <label className="f">Month
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            {MONTHS.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
          </select>
        </label>
        <MoneyField label="Gross amount" cents={amt} onChange={setAmt} />
        <label className="f">Label<input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Annual, commission, retention…" /></label>
        <div className="pl-formbtn">
          <button
            className="primary"
            disabled={amt <= 0}
            onClick={async () => {
              await db.bonuses.add(bonusFor(person.id!, year, Number(month), amt, label));
              setAmt(0);
              setLabel('');
            }}
          >Add bonus for {person.name}</button>
        </div>
      </div>
      {mine.length === 0 ? <p className="muted">No bonuses entered for {person.name} in {year}.</p> : (
        <div className="an-tablewrap">
          <table className="an-table an-stack" aria-label={`Bonuses entered for ${person.name}, ${year}`}>
            <thead><tr><th>Month</th><th>Label</th><th className="num">Gross</th><th /></tr></thead>
            <tbody>
              {mine.map((b) => (
                <tr key={b.id}>
                  <td data-label="Month">{monthName(b.month)} {b.year}</td>
                  <td data-label="Label">{b.label}</td>
                  <td className="num" data-label="Gross">{formatCents(b.grossCents)}</td>
                  <td className="an-cell-act"><button className="link danger" aria-label={`Delete bonus ${b.label}, ${monthName(b.month)} ${b.year}, ${person.name}`} onClick={() => db.bonuses.delete(b.id!)}>delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** One person's paycheck-by-paycheck estimate (moved here from the household results; same rows, same figures). */
export function PersonPaycheckDetail({ py, profile, name }: { py: PersonYear; profile: IncomeProfile; name: string }) {
  return (
    <details className="pl-detail pw-detail">
      <summary><strong>{name}: paycheck detail</strong> <span className="muted">(estimated, one row per paycheck)</span></summary>
      <div className="an-tablewrap">
        <table className="an-table an-matrix" aria-label={`Paycheck detail for ${name}`}>
          <thead>
            <tr><th>Date</th><th className="num">Gross</th><th className="num">Deductions</th><th className="num">Fed tax</th><th className="num">SS</th><th className="num">Medicare</th><th className="num">MA tax</th><th className="num">PFML</th><th className="num">Net</th></tr>
          </thead>
          <tbody>
            {py.events.map((e, i) => {
              const dedTotal = Object.values(e.deductions).reduce((a, b) => a + b, 0);
              return (
                <tr key={i}>
                  <td>{e.date}{e.kind !== 'regular' && <span className="badge"> {e.label}</span>}{e.notes.length > 0 && <div className="warn" style={{ whiteSpace: 'normal' }}>{e.notes.join('; ')}</div>}</td>
                  <td className="num">{formatCents(e.gross)}</td>
                  <td className="num">{formatCents(dedTotal)}</td>
                  <td className="num">{formatCents(e.fedWithholding)}</td>
                  <td className="num">{formatCents(e.socialSecurity)}</td>
                  <td className="num">{formatCents(e.medicare + e.addlMedicare)}</td>
                  <td className="num">{formatCents(e.stateWithholding)}</td>
                  <td className="num">{formatCents(e.pfml)}</td>
                  <td className="num">
                    <strong>{formatCents(e.net)}</strong>
                    {e.keptValue !== undefined && <div className="muted" style={{ fontSize: '0.75rem' }}>{formatCents(e.keptValue)} kept as shares</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="an-note">
        Deductions: {profile.deductions.map((d) => `${d.name} ${formatCents(py.totals.deductions[d.id] ?? 0)}`).join(' · ') || 'none'}
      </p>
    </details>
  );
}

/** Bonuses whose person is not on the page. Listed so they are not lost; the only action is the delete the page always had. Nothing is reassigned. */
export function UnassignedBonuses({ bonuses }: { bonuses: Bonus[] }) {
  if (bonuses.length === 0) return null;
  return (
    <section className="pw-section" aria-label="Bonuses with no matching person">
      <h3 className="pw-h3">Bonuses with no matching person</h3>
      <div className="an-tablewrap">
        <table className="an-table an-stack" aria-label="Bonuses with no matching person">
          <thead><tr><th>Month</th><th>Label</th><th className="num">Gross</th><th /></tr></thead>
          <tbody>
            {[...bonuses].sort((a, b) => a.year - b.year || a.month - b.month).map((b) => (
              <tr key={b.id}>
                <td data-label="Month">{monthName(b.month)} {b.year}</td>
                <td data-label="Label">{b.label}</td>
                <td className="num" data-label="Gross">{formatCents(b.grossCents)}</td>
                <td className="an-cell-act"><button className="link danger" aria-label={`Delete bonus ${b.label}, ${monthName(b.month)} ${b.year}`} onClick={() => db.bonuses.delete(b.id!)}>delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
