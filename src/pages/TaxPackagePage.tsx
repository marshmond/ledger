import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { todayISO } from '../lib/money';
import { buildIncomeModel } from '../lib/income';
import { hsaYearImpact } from '../lib/hsa';
import { netForTax, realizedFor } from '../lib/lots';
import { loanView } from '../lib/loanSchedule';
import { downloadText } from '../lib/download';
import { buildTaxPackage, displayCell, sectionCsv } from '../lib/taxPackage';

/** A worksheet for your tax preparer: pay, RSUs, sales by lot, HSA, mortgage interest, and the app's estimate. Print it or download CSVs. */
export default function TaxPackagePage() {
  const thisYear = Number(todayISO().slice(0, 4));
  const [year, setYear] = useState(thisYear - (todayISO().slice(5, 7) <= '04' ? 1 : 0));
  const people = useLiveQuery(() => db.people.toArray(), []) ?? [];
  const profiles = useLiveQuery(() => db.incomeProfiles.toArray(), []) ?? [];
  const bonuses = useLiveQuery(() => db.bonuses.toArray(), []) ?? [];
  const settings = useLiveQuery(() => db.taxSettings.toArray(), []) ?? [];
  const vests = useLiveQuery(() => db.rsuVests.toArray(), []) ?? [];
  const securities = useLiveQuery(() => db.securities.toArray(), []) ?? [];
  const invAccounts = useLiveQuery(() => db.invAccounts.toArray(), []) ?? [];
  const sales = useLiveQuery(() => db.sales.toArray(), []) ?? [];
  const hsaW = useLiveQuery(() => db.hsaWithdrawals.toArray(), []) ?? [];
  const loans = useLiveQuery(() => db.loans.toArray(), []) ?? [];
  const rates = useLiveQuery(() => db.loanRates.toArray(), []) ?? [];
  const events = useLiveQuery(() => db.loanEvents.toArray(), []) ?? [];

  const sections = useMemo(() => {
    const impact = hsaYearImpact(hsaW, invAccounts, people, year);
    const gains = netForTax(realizedFor(sales, year));
    const model = buildIncomeModel(year, people, profiles, bonuses, settings.find((s) => s.year === year), { vests, securities }, { taxableCents: impact.taxableCents, penaltyCents: impact.penaltyCents }, gains);
    return buildTaxPackage({
      year, people, years: model.years, household: model.household, vests: model.vests, sales, securities, invAccounts, hsaWithdrawals: hsaW,
      loans: loans.map((l) => ({ loan: l, view: loanView(l, rates.filter((r) => r.loanId === l.id), events.filter((e) => e.loanId === l.id)) })),
    });
  }, [year, people, profiles, bonuses, settings, vests, securities, invAccounts, sales, hsaW, loans, rates, events]);

  const years = [...new Set([...profiles.map((p) => p.year), ...sales.map((s) => Number(s.date.slice(0, 4))), thisYear, thisYear - 1])].sort((a, b) => b - a);
  const withRows = sections.filter((s) => s.rows.length > 0);

  return (
    <>
      <div className="row spread no-print">
        <h1>Tax package</h1>
        <label className="row">Tax year<select value={year} onChange={(e) => setYear(Number(e.target.value))}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
      </div>
      <p className="muted no-print">
        Everything your preparer usually asks for, gathered from what you have entered. Official figures come from your W-2, 1099-B, 1099-SA, and 1098, so use this to check
        them. Print it (choose “Save as PDF” in the print window) or download any table as a spreadsheet file.
      </p>
      <div className="row no-print">
        <button className="primary" onClick={() => window.print()}>Print or save as PDF</button>
        <button
          disabled={withRows.length === 0}
          onClick={() => withRows.forEach((s, i) => setTimeout(() => downloadText(`tax-${year}-${s.id}.csv`, 'text/csv', sectionCsv(s)), i * 250))}
        >Download all tables (CSV)</button>
      </div>

      <div className="printable">
        <h1 className="print-only">Tax worksheet, {year}</h1>
        {sections.map((s) => (
          <section key={s.id} className="pkg">
            <div className="row spread">
              <h2>{s.title}</h2>
              {s.rows.length > 0 && <button className="link no-print" onClick={() => downloadText(`tax-${year}-${s.id}.csv`, 'text/csv', sectionCsv(s))}>download CSV</button>}
            </div>
            {s.note && <p className="muted">{s.note}</p>}
            {s.rows.length === 0 ? <p className="muted">Nothing to report for {year}.</p> : (
              <div className="scroll-x">
                <table>
                  <thead><tr>{s.headers.map((h, k) => <th key={k} className={s.moneyCols.includes(k) ? 'num' : ''}>{h}</th>)}</tr></thead>
                  <tbody>
                    {s.rows.map((r, i) => (
                      <tr key={i}>{r.map((_, k) => <td key={k} className={s.moneyCols.includes(k) ? 'num' : ''}>{displayCell(s, r, k)}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}
        <p className="muted">Prepared {todayISO()} from the data in this browser. This is a planning worksheet, not tax advice or a substitute for your official tax forms.</p>
      </div>
    </>
  );
}
