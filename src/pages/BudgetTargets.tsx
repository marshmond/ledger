import { useState } from 'react';
import { SETUP_CATEGORY_ID } from '../lib/setupCategory';
import { db } from '../db';
import type { BudgetTarget, Category, CategoryGroup } from '../types';
import { formatCents } from '../lib/money';
import { monthLabel } from '../lib/dates';
import { MoneyField, NumField } from './fields';
import Collapsible from './Collapsible';
import type { TargetNeed } from '../lib/budgetTargets';

/** Add, review, and remove budget targets. */
export default function BudgetTargets({ targets, groups, cats, needs, month }: { targets: BudgetTarget[]; groups: CategoryGroup[]; cats: Category[]; needs: TargetNeed[]; month: string }) {
  const [catId, setCatId] = useState('');
  const [kind, setKind] = useState<BudgetTarget['kind']>('monthly');
  const [amt, setAmt] = useState(0);
  const [due, setDue] = useState(month);
  const [moy, setMoy] = useState(12);
  const [every, setEvery] = useState(3);
  const catName = (id: number) => cats.find((c) => c.id === id)?.name ?? '?';
  const needFor = (id?: number) => needs.find((n) => n.target.id === id);

  async function add() {
    if (!catId || amt <= 0) return;
    const t: BudgetTarget = { categoryId: Number(catId), kind, amountCents: amt };
    if (kind === 'by_date') t.dueMonth = due;
    if (kind === 'repeating') { t.dueMonth = due; t.everyMonths = every; }
    if (kind === 'yearly') t.dueMonthOfYear = moy;
    await db.budgetTargets.add(t);
    setAmt(0);
  }

  return (
    <Collapsible id="budget.targets" title="Targets" defaultOpen={targets.length === 0}>
      <p className="muted">
        Tell a category what it needs and the budget shows how much to assign each month to be on track: a set amount every month, an amount saved by a date, or a bill that comes
        every year (car insurance, property tax, a trip). Money assigned to a category rolls over, so it is there when the bill arrives.
      </p>
      {targets.length > 0 && (
        <table>
          <thead><tr><th>Category</th><th>Target</th><th className="num">This month</th><th /></tr></thead>
          <tbody>
            {targets.map((t) => {
              const n = needFor(t.id);
              return (
                <tr key={t.id}>
                  <td>{catName(t.categoryId)}</td>
                  <td>{n?.description ?? ''}{n && n.dueMonth && <div className="muted" style={{ fontSize: '0.75rem' }}>{monthLabel(n.dueMonth)}: set aside {formatCents(n.perMonthCents)} a month</div>}</td>
                  <td className="num">{n ? (n.funded ? <span className="ok">funded</span> : <span className="warn">needs {formatCents(n.needCents)}</span>) : ''}</td>
                  <td><button className="link danger" onClick={() => db.budgetTargets.delete(t.id!)}>delete</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <label className="f">Category
          <select value={catId} onChange={(e) => setCatId(e.target.value)}>
            <option value="">Choose…</option>
            {groups.map((g) => <optgroup key={g.id} label={g.name}>{cats.filter((c) => c.groupId === g.id && c.kind !== 'income' && !c.hidden && c.id !== SETUP_CATEGORY_ID).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>)}
          </select>
        </label>
        <label className="f">Type
          <select value={kind} onChange={(e) => setKind(e.target.value as BudgetTarget['kind'])}>
            <option value="monthly">A set amount every month</option>
            <option value="by_date">An amount by a date</option>
            <option value="yearly">A bill that comes every year</option>
            <option value="repeating">A bill that repeats every few months</option>
          </select>
        </label>
        <MoneyField key={`a${targets.length}`} label={kind === 'monthly' ? 'Per month' : kind === 'repeating' ? 'Amount of each bill' : 'Amount needed'} cents={amt} onChange={setAmt} width={110} />
        {kind === 'by_date' && <label className="f">Needed by<input type="month" value={due} onChange={(e) => setDue(e.target.value)} /></label>}
        {kind === 'repeating' && (
          <>
            <label className="f">Comes due
              <select value={every} onChange={(e) => setEvery(Number(e.target.value))}>
                <option value={3}>Every 3 months (quarterly)</option>
                <option value={6}>Every 6 months (twice a year)</option>
                <option value={12}>Every 12 months (yearly)</option>
              </select>
            </label>
            <label className="f">Next due<input type="month" value={due} onChange={(e) => setDue(e.target.value)} /></label>
          </>
        )}
        {kind === 'yearly' && <NumField label="Due in month (1-12)" value={moy} step={1} width={90} onChange={(n) => setMoy(Math.max(1, Math.min(12, Math.round(n))))} />}
        <button className="primary" disabled={!catId || amt <= 0} onClick={add}>Add target</button>
      </div>
    </Collapsible>
  );
}
