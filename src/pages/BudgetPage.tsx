import { Fragment, useState } from 'react';
import { Link } from '../core/router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { copyLastMonth, loadBudget, nextMonth, prevMonth, setAssignment, type BudgetRow } from '../lib/budget';
import { monthLabel, monthOf } from '../lib/dates';
import { buildIncomeModel } from '../lib/income';
import { monthlyNet } from '../lib/payroll';
import { assignedFromEntry, formatCents, todayISO } from '../lib/money';
import { planFunding, targetNeed } from '../lib/budgetTargets';
import BudgetTargets from './BudgetTargets';
import InlineTarget from './InlineTarget';
import { PageHeader } from '../ui/components';
import { StatusChip } from '../ui/StatusChip';
import { readCollapsed, writeCollapsed } from './Collapsible';
import { sortByOrder } from '../lib/order';
import { assignedLabel, budgetEditTargetLabel, budgetFundLabel, budgetFundPaymentLabel, budgetSetTargetLabel } from '../lib/a11yLabels';
import { budgetStateWord, countWord } from './moneyPresentation';
import './money.css';

const foldKey = (groupId: number) => `budget.g${groupId}`;

export function Assigned({ month, row }: { month: string; row: BudgetRow }) {
  return (
    <input
      key={`${month}-${row.key}-${row.assigned}`}
      className="assign"
      aria-label={assignedLabel(row.name)}
      inputMode="decimal"
      defaultValue={row.assigned ? (row.assigned / 100).toFixed(2) : ''}
      placeholder="0.00"
      onBlur={async (e) => {
        const cents = assignedFromEntry(e.target.value, row.assigned);
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
  const [editingTarget, setEditingTarget] = useState<{ categoryId: number; targetId?: number } | null>(null);
  const budget = useLiveQuery(() => loadBudget(db, month), [month]);
  const forecast = useLiveQuery(async () => {
    const year = Number(month.slice(0, 4));
    const [people, profiles, bonuses, settings, rsuVests, securities] = await Promise.all([
      db.people.toArray(),
      db.incomeProfiles.toArray(),
      db.bonuses.toArray(),
      db.taxSettings.toArray(),
      db.rsuVests.toArray(),
      db.securities.toArray(),
    ]);
    const model = buildIncomeModel(year, people, profiles, bonuses, settings.find((s) => s.year === year), { vests: rsuVests, securities });
    if (model.years.length === 0) return null;
    const idx = Number(month.slice(5, 7)) - 1;
    return { net: monthlyNet(model.years, { excludeRsu: true })[idx], checks: model.years.reduce((a, y) => a + y.events.filter((e) => e.kind !== 'rsu' && Number(e.date.slice(5, 7)) === idx + 1).length, 0) };
  }, [month]);
  const groups = sortByOrder(useLiveQuery(() => db.categoryGroups.toArray(), []) ?? []);
  const cats = sortByOrder(useLiveQuery(() => db.categories.toArray(), []) ?? []);
  const targets = sortByOrder(useLiveQuery(() => db.budgetTargets.toArray(), []) ?? []);
  const [folded, setFolded] = useState<Record<number, boolean>>({});
  const isFolded = (id: number) => folded[id] ?? readCollapsed(foldKey(id)) ?? false;
  const setFold = (ids: number[], v: boolean) => {
    setFolded({ ...folded, ...Object.fromEntries(ids.map((i) => [i, v])) });
    for (const i of ids) writeCollapsed(foldKey(i), v);
  };

  if (!budget) return <p className="muted">Loading…</p>;

  const rta = budget.readyToAssign;
  const payRows = budget.rows.filter((r) => r.kind === 'payment');
  const overspent = budget.rows.filter((r) => r.available < 0 && r.kind === 'category');

  // Targets: how much each category still needs this month to be on track.
  const needs = targets.flatMap((t) => {
    const row = budget.rows.find((r) => r.kind === 'category' && r.categoryId === t.categoryId);
    return row ? [targetNeed(t, row, month, formatCents)] : [];
  });
  const needOf = (r: BudgetRow) => needs.filter((n) => n.target.categoryId === r.categoryId);
  const plan = planFunding(needs, rta);
  const fundTargets = async () => {
    for (const a of plan.adds) {
      const row = budget.rows.find((r) => r.kind === 'category' && r.categoryId === a.categoryId);
      if (row) await setAssignment(db, month, row.key, row.assigned + a.addCents);
    }
    setNote(plan.adds.length ? `Funded ${plan.adds.length} target${plan.adds.length === 1 ? '' : 's'} with ${formatCents(plan.totalAddCents)}.` : 'Nothing to fund.');
  };

  // Rows of a group in the order chosen on the Categories page.
  const catPlace = new Map(cats.map((c, i) => [c.id!, i]));
  const groupRows = (groupId: number) =>
    budget.rows.filter((r) => r.kind === 'category' && r.groupId === groupId).sort((a, b) => (catPlace.get(a.categoryId!) ?? 0) - (catPlace.get(b.categoryId!) ?? 0));
  const shownGroups = groups.filter((g) => groupRows(g.id!).length > 0);

  const cover = (r: BudgetRow) => setAssignment(db, month, r.key, r.assigned - r.available);

  const renderRow = (r: BudgetRow) => (
    <Fragment key={r.key}>
    <tr className={r.available < 0 ? 'is-over' : ''}>
      <td className="b-name" data-label="Category">
        <span className="b-title">{r.name}</span>
        {budgetStateWord(r.available) && r.kind === 'category' && <> <StatusChip tone="overdue">{budgetStateWord(r.available)}</StatusChip></>}
        {r.kind === 'category' && needOf(r).map((n) => (
          <div key={n.target.id} className={`b-target ${n.funded ? 'muted' : 'warn'}`}>
            Target {n.description}: {n.funded ? 'funded ✓' : <>needs {formatCents(n.needCents)} this month{' '}<button className="link" aria-label={budgetFundLabel(r.name)} onClick={() => setAssignment(db, month, r.key, r.assigned + n.needCents)}>fund</button></>}{' '}
            <button className="link" aria-label={budgetEditTargetLabel(r.name)} onClick={() => setEditingTarget({ categoryId: r.categoryId!, targetId: n.target.id })}>edit</button>
          </div>
        ))}
        {r.kind === 'category' && needOf(r).length === 0 && editingTarget?.categoryId !== r.categoryId && (
          <div><button className="link b-settarget" aria-label={budgetSetTargetLabel(r.name)} onClick={() => setEditingTarget({ categoryId: r.categoryId! })}>+ set a target</button></div>
        )}
        {r.kind === 'payment' && (() => {
          const u = budget.unfunded.find((x) => `p${x.accountId}` === r.key);
          return u ? (
            <div className="warn b-target">
              Owed {formatCents(u.owedCents)}; {formatCents(u.unfundedCents)} not funded yet{' '}
              <button className="link" aria-label={budgetFundPaymentLabel(r.name)} onClick={() => setAssignment(db, month, r.key, r.assigned + (u.owedCents - r.available))}>
                fund it
              </button>
            </div>
          ) : null;
        })()}
      </td>
      <td className="num b-assigned" data-label="Assigned"><Assigned month={month} row={r} /></td>
      <td className={`num b-activity ${r.activity < 0 ? '' : r.activity > 0 ? 'pos' : 'muted'}`} data-label="Activity">{formatCents(r.activity)}</td>
      <td className={`num b-avail ${r.available < 0 ? 'neg' : r.available > 0 ? 'pos' : 'muted'}`} data-label="Available">
        {formatCents(r.available)}
        {r.available < 0 && (
          <div><button className="link" aria-label={`Cover ${formatCents(-r.available)} overspent in ${r.name}`} onClick={() => cover(r)}>cover {formatCents(-r.available)}</button></div>
        )}
      </td>
    </tr>
    {r.kind === 'category' && editingTarget && editingTarget.categoryId === r.categoryId && (
      <tr className="b-editor"><td colSpan={4}>
        <InlineTarget key={`${r.categoryId}-${editingTarget.targetId ?? 'new'}`} categoryId={r.categoryId!} existing={targets.find((t) => t.id === editingTarget.targetId)} month={month} onClose={() => setEditingTarget(null)} />
      </td></tr>
    )}
    </Fragment>
  );

  const head = (
    <thead>
      <tr><th>Category</th><th className="num">Assigned</th><th className="num">Activity</th><th className="num">Available</th></tr>
    </thead>
  );

  return (
    <div className="mny-page mny-budget">
      <PageHeader title="Budget" description="Give every dollar a job." actions={<div className="mny-month">
          <button aria-label="Previous month" onClick={() => setMonth(prevMonth(month))}>‹</button>
          <strong aria-live="polite">{monthLabel(month)}</strong>
          <button aria-label="Next month" onClick={() => setMonth(nextMonth(month))}>›</button>
          <button className="link" onClick={() => setMonth(monthOf(todayISO()))}>today</button>
        </div>} />

      <section className={`card mny-rta ${rta < 0 ? 'rta-neg' : rta === 0 ? 'rta-zero' : 'rta-pos'}`} aria-label="Ready to Assign">
        <div className="mny-rta-main">
          <div className="mny-rta-label">Ready to Assign</div>
          <div className="mny-rta-amt">{formatCents(rta)}</div>
          <p className="mny-rta-msg">
            {rta > 0 && 'Give every dollar a job.'}
            {rta === 0 && 'Every dollar has a job.'}
            {rta < 0 && 'Over-assigned or overspent: move money from another category.'}
          </p>
        </div>
        <dl className="mny-rta-figs">
          <div><dt>Cash</dt><dd>{formatCents(budget.cash)}</dd></div>
          <div><dt>Income this month</dt><dd>{formatCents(budget.incomeThisMonth)}</dd></div>
        </dl>
      </section>

      {(budget.uncategorizedCount > 0 || overspent.length > 0) && (
        <section className="mny-attn" aria-label="Needs attention">
          {overspent.length > 0 && (
            <p className="warn"><StatusChip tone="overdue">Overspent</StatusChip> {overspent.length} categor{overspent.length === 1 ? 'y is' : 'ies are'} overspent. Cover it from another category, or it lowers Ready to Assign next month.</p>
          )}
          {budget.uncategorizedCount > 0 && (
            <p className="warn"><StatusChip tone="warning">Uncategorized</StatusChip> {budget.uncategorizedCount} uncategorized outflow(s) so far. They reduce Ready to Assign but no category. Categorize them in the account ledgers.</p>
          )}
        </section>
      )}

      {needs.length > 0 && (
        <section className={`card mny-targets ${plan.totalNeedCents > 0 ? '' : 'rta-pos'}`} aria-label="Targets for this month">
          <div>
            <strong>Targets</strong>
            <div className="muted">
              {plan.totalNeedCents === 0 ? 'Every target is funded for this month.' : `${formatCents(plan.totalNeedCents)} still needed this month to stay on track${plan.shortCents > 0 ? `; Ready to Assign covers ${formatCents(plan.totalAddCents)}, so ${formatCents(plan.shortCents)} is short` : ''}.`}
            </div>
          </div>
          {plan.totalNeedCents > 0 && <button className="primary" disabled={plan.totalAddCents === 0} onClick={fundTargets}>{plan.shortCents > 0 ? 'Fund what I can' : 'Fund all targets'}</button>}
        </section>
      )}

      <div className="mny-tools">
        <button
          onClick={async () => {
            const n = await copyLastMonth(db, month);
            setNote(n ? `Copied ${n} assignment(s) from ${monthLabel(prevMonth(month))}.` : 'Nothing to copy.');
          }}
        >Copy last month’s assignments</button>
        {shownGroups.length > 1 && (
          <button className="link" onClick={() => setFold(shownGroups.map((g) => g.id!), !shownGroups.every((g) => isFolded(g.id!)))}>
            {shownGroups.every((g) => isFolded(g.id!)) ? 'Expand all groups' : 'Collapse all groups'}
          </button>
        )}
        {note && <span className="muted" role="status">{note}</span>}
      </div>

      {forecast && forecast.net > 0 && (
        <p className="muted">
          Projected take-home for {monthLabel(month)} from your <Link to="/income">Income</Link> model: <strong>{formatCents(forecast.net)}</strong> across {forecast.checks} paycheck{forecast.checks === 1 ? '' : 's'}.
          Enter income as it arrives; this is a guide for how much to plan on.
        </p>
      )}

      {payRows.length > 0 && (
        <section className="card flush mny-group" aria-labelledby="b-pay">
          <div className="mny-group-head">
            <h2 id="b-pay" className="mny-h2 mny-h2--tight">Credit card payments</h2>
          </div>
          <p className="muted mny-group-note">Spending on a card moves that money here automatically; paying the card draws it down. Assign here to pay down an existing balance.</p>
          <table className="budget-table">{head}<tbody>{payRows.map(renderRow)}</tbody></table>
        </section>
      )}

      {shownGroups.map((g) => {
        const rows = groupRows(g.id!);
        const sum = (f: (r: BudgetRow) => number) => rows.reduce((s, r) => s + f(r), 0);
        const open = !isFolded(g.id!);
        return (
          <section key={g.id} className="card flush mny-group collapsible" aria-labelledby={`b-g${g.id}`}>
            <div className="mny-group-head">
              <h2 id={`b-g${g.id}`} className="mny-h2 mny-h2--tight">
                <button className="collapse-btn" aria-expanded={open} onClick={() => setFold([g.id!], open)}>
                  <span className="chev" aria-hidden="true">{open ? '▾' : '▸'}</span> {g.name}
                </button>
              </h2>
              <span className="mny-group-sum">available {formatCents(sum((r) => r.available))}{!open && <span className="muted"> · {countWord(rows.length, 'category', 'categories')}</span>}</span>
            </div>
            {open && <table className="budget-table">{head}<tbody>{rows.map(renderRow)}</tbody></table>}
          </section>
        );
      })}
      {cats.filter((c) => c.kind !== 'income').length === 0 && (
        <p className="muted">No categories yet. <Link to="/categories">Add some</Link>.</p>
      )}
      <BudgetTargets targets={targets} groups={groups} cats={cats} needs={needs} month={month} />
      <p className="muted">
        Income categories (and uncategorized deposits) feed Ready to Assign. Mark a category as income on the{' '}
        <Link to="/categories">Categories</Link> page.
      </p>
    </div>
  );
}
