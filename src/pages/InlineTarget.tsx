import { useState } from 'react';
import { db } from '../db';
import type { BudgetTarget } from '../types';
import { makeTarget } from '../lib/budgetTargets';
import { NumField } from './fields';
import { parseAmountToCents } from '../lib/money';

/** Set, change, or remove a category's target right on its budget line. */
export default function InlineTarget({ categoryId, existing, month, onClose }: { categoryId: number; existing?: BudgetTarget; month: string; onClose: () => void }) {
  const [kind, setKind] = useState<BudgetTarget['kind']>(existing?.kind ?? 'monthly');
  // The amount is read when you save, so pressing Enter right after typing works.
  const [amtText, setAmtText] = useState(existing ? (existing.amountCents / 100).toFixed(2) : '');
  const [due, setDue] = useState(existing?.dueMonth ?? month);
  const [moy, setMoy] = useState(existing?.dueMonthOfYear ?? 12);
  const [every, setEvery] = useState(existing?.everyMonths ?? 3);
  const [err, setErr] = useState('');

  async function save() {
    const cents = amtText.trim() === '' ? 0 : parseAmountToCents(amtText);
    if (cents === null) return setErr('That is not a valid amount.');
    const r = makeTarget({ id: existing?.id, categoryId, kind, amountCents: cents, dueMonth: due, monthOfYear: moy, everyMonths: every });
    if ('error' in r) return setErr(r.error);
    await db.budgetTargets.put(r.target);
    onClose();
  }

  return (
    <form className="inline-target" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <div className="row">
        <label className="f">I need
          <select value={kind} onChange={(e) => setKind(e.target.value as BudgetTarget['kind'])}>
            <option value="monthly">A set amount every month</option>
            <option value="by_date">An amount by a date</option>
            <option value="yearly">A bill that comes every year</option>
            <option value="repeating">A bill that repeats every few months</option>
          </select>
        </label>
        <label className="f">{kind === 'monthly' ? 'Amount per month' : kind === 'repeating' ? 'Amount of each bill' : 'Total amount'}
          <input style={{ width: 120 }} inputMode="decimal" placeholder="0.00" value={amtText} onChange={(e) => setAmtText(e.target.value)} autoFocus />
        </label>
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
      </div>
      <div className="muted" style={{ fontSize: '0.8rem', margin: '4px 0' }}>
        {kind === 'monthly' && 'The budget will show how much more to assign this month to reach this amount, for example your mortgage payment.'}
        {kind === 'by_date' && 'The budget spreads what is still needed over the months left, so you are on track by the date.'}
        {kind === 'repeating' && 'The budget spreads each bill over the months until it is next due. Once that month passes, it starts saving for the one after, so you only enter it once.'}
        {kind === 'yearly' && 'The budget spreads the bill over the months until it is next due, so the money is there when it arrives.'}
      </div>
      <div className="row">
        <button className="primary" type="submit">Save target</button>
        <button type="button" onClick={onClose}>Cancel</button>
        {existing?.id !== undefined && <button type="button" className="link danger" onClick={async () => { await db.budgetTargets.delete(existing.id!); onClose(); }}>remove target</button>}
        {err && <span className="error" role="alert">{err}</span>}
      </div>
    </form>
  );
}
