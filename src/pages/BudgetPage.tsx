import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { copyLastMonth, loadBudget, nextMonth, prevMonth, setAssignment, type BudgetRow } from '../lib/budget';
import { monthLabel, monthOf } from '../lib/dates';
import { buildIncomeModel } from '../lib/income';
import { monthlyNet } from '../lib/payroll';
import { formatCents, parseAmountToCents, todayISO } from '../lib/money';

function Assigned({ month, row }: { month: string; row: BudgetRow }) {
  return (
    <input
      key={`${month}-${row.key}-${row.assigned}`}
      className="assign"
      inputMode="decimal"
      defaultValue={row.assigned ? (row.assigned / 100).toFixed(2) : ''}
      placeholder="0.00"
      onBlur={async (e) => {
        const raw = e.target.value.trim();
        const cents = raw === '' ? 0 : parseAmountToCents(raw);
        if (cents === null) {
          e.target.value = row.assigned ? (row.assigned / 100).toFixed(2) : '';
          return;
        }
        if (cents !== row.assigned) await setAssignment(db, month, row.key, cents);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

export default function BudgetPage() {
  const [month, setMonth] = useState(monthOf(todayISO()));
  const [note, setNote] = useState('');
  const budget = useLiveQuery(() => loadBudget(db, month), [month]);
  const forecast = useLiveQuery(async () => {
    const year = Number(month.slice(0, 4));
    const [people, profiles, bonuses, settings] = await Promise.all([
      db.people.toArray(),
      db.incomeProfiles.toArray(),
      db.bonuses.toArray(),
      db.taxSettings.toArray(),
    ]);
    const model = buildIncomeModel(year, people, profiles, bonuses, settings.find((s) => s.year === year));
    if (model.years.length === 0) return null;
    const idx = Number(month.slice(5, 7)) - 1;
    return { net: monthlyNet(model.years)[idx], checks: model.years.reduce((a, y) => a + y.events.filter((e) => Number(e.date.slice(5, 7)) === idx + 1).length, 0) };
  }, [month]);
  const groups = useLiveQuery(() => db.categoryGroups.toArray(), []) ?? [];
  const cats = useLiveQuery(() => db.categories.toArray(), []) ?? [];

  if (!budget) return <p className="muted">Loading…</p>;

  const rta = budget.readyToAssign;
  const payRows = budget.rows.filter((r) => r.kind === 'payment');
  const overspent = budget.rows.filter((r) => r.available < 0 && r.kind === 'category');

  const cover = (r: BudgetRow) => setAssignment(db, month, r.key, r.assigned - r.available);

  const renderRow = (r: BudgetRow) => (
    <tr key={r.key}>
      <td>
        {r.name}
        {r.kind === 'payment' && (() => {
          const u = budget.unfunded.find((x) => `p${x.accountId}` === r.key);
          return u ? (
            <div className="warn">
              Owed {formatCents(u.owedCents)}; {formatCents(u.unfundedCents)} not funded yet{' '}
              <button className="link" onClick={() => setAssignment(db, month, r.key, r.assigned + (u.owedCents - r.available))}>
                fund it
              </button>
            </div>
          ) : null;
        })()}
      </td>
      <td className="num"><Assigned month={month} row={r} /></td>
      <td className={`num hide-sm ${r.activity < 0 ? '' : r.activity > 0 ? 'pos' : 'muted'}`}>{formatCents(r.activity)}</td>
      <td className={`num ${r.available < 0 ? 'neg' : r.available > 0 ? 'pos' : 'muted'}`}>
        {formatCents(r.available)}
        {r.available < 0 && (
          <div><button className="link" onClick={() => cover(r)}>cover {formatCents(-r.available)}</button></div>
        )}
      </td>
    </tr>
  );

  const head = (
    <thead>
      <tr><th>Category</th><th className="num">Assigned</th><th className="num hide-sm">Activity</th><th className="num">Available</th></tr>
    </thead>
  );

  return (
    <>
      <div className="row spread">
        <h1>Budget</h1>
        <div className="row">
          <button onClick={() => setMonth(prevMonth(month))}>‹</button>
          <strong>{monthLabel(month)}</strong>
          <button onClick={() => setMonth(nextMonth(month))}>›</button>
          <button className="link" onClick={() => setMonth(monthOf(todayISO()))}>today</button>
        </div>
      </div>

      <div className={`card row spread rta ${rta < 0 ? 'rta-neg' : rta === 0 ? 'rta-zero' : 'rta-pos'}`}>
        <div>
          <div className="muted">Ready to Assign</div>
          <div className="rta-amt">{formatCents(rta)}</div>
        </div>
        <div className="muted">
          Cash {formatCents(budget.cash)} · Income this month {formatCents(budget.incomeThisMonth)}
          <div>
            {rta > 0 && 'Give every dollar a job.'}
            {rta === 0 && 'Every dollar has a job.'}
            {rta < 0 && 'Over-assigned or overspent: move money from another category.'}
          </div>
        </div>
      </div>

      {forecast && forecast.net > 0 && (
        <p className="muted">
          Projected take-home for {monthLabel(month)} from your <Link to="/income">Income</Link> model: <strong>{formatCents(forecast.net)}</strong> across {forecast.checks} paycheck{forecast.checks === 1 ? '' : 's'}.
          Enter income as it arrives; this is a guide for how much to plan on.
        </p>
      )}

      <div className="row">
        <button
          onClick={async () => {
            const n = await copyLastMonth(db, month);
            setNote(n ? `Copied ${n} assignment(s) from ${monthLabel(prevMonth(month))}.` : 'Nothing to copy.');
          }}
        >Copy last month’s assignments</button>
        {note && <span className="muted">{note}</span>}
      </div>

      {budget.uncategorizedCount > 0 && (
        <p className="warn">{budget.uncategorizedCount} uncategorized outflow(s) so far. They reduce Ready to Assign but no category. Categorize them in the account ledgers.</p>
      )}
      {overspent.length > 0 && (
        <p className="warn">{overspent.length} categor{overspent.length === 1 ? 'y is' : 'ies are'} overspent. Cover it from another category, or it lowers Ready to Assign next month.</p>
      )}

      {payRows.length > 0 && (
        <section>
          <h2>Credit card payments</h2>
          <p className="muted">Spending on a card moves that money here automatically; paying the card draws it down. Assign here to pay down an existing balance.</p>
          <table>{head}<tbody>{payRows.map(renderRow)}</tbody></table>
        </section>
      )}

      {groups.map((g) => {
        const rows = budget.rows.filter((r) => r.kind === 'category' && r.groupId === g.id);
        if (!rows.length) return null;
        const sum = (f: (r: BudgetRow) => number) => rows.reduce((s, r) => s + f(r), 0);
        return (
          <section key={g.id}>
            <h2>{g.name} <span className="muted">· available {formatCents(sum((r) => r.available))}</span></h2>
            <table>{head}<tbody>{rows.map(renderRow)}</tbody></table>
          </section>
        );
      })}
      {cats.filter((c) => c.kind !== 'income').length === 0 && (
        <p className="muted">No categories yet. <Link to="/categories">Add some</Link>.</p>
      )}
      <p className="muted">
        Income categories (and uncategorized deposits) feed Ready to Assign. Mark a category as income on the{' '}
        <Link to="/categories">Categories</Link> page.
      </p>
    </>
  );
}
