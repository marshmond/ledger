import { useState } from 'react';
import ConfirmDialog from '../../shell/ConfirmDialog';
import { formatCents, parseAmountToCents } from '../../lib/money';
import { EmptyState } from '../../ui/components';
import { useToast } from '../../ui/Toast';
import { createLine, moveLine, removeLine, saveLine } from './data';
import { budgetSummary, validateLine, type BudgetLineRecord } from './model';

/** The project's budget lines: add, rename, change the planned amount, reorder and remove, with the total compared to the overall budget. */
export default function BudgetLines({ projectId, budgetCents, lines }: { projectId: number; budgetCents: number | null; lines: BudgetLineRecord[] }) {
  const toast = useToast();
  const sum = budgetSummary(budgetCents, lines);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [eName, setEName] = useState('');
  const [eAmount, setEAmount] = useState('');
  const [eError, setEError] = useState('');
  // D20.1B (NC-01): the line whose Remove was pressed, by id. Nothing is removed until the dialog's own button is pressed.
  const [askRemove, setAskRemove] = useState<number | null>(null);
  const target = askRemove === null ? undefined : lines.find((x) => x.id === askRemove);

  const guard = async (fn: () => Promise<void>, onError: (m: string) => void) => {
    try { await fn(); } catch (e) { onError(e instanceof Error ? e.message : 'Something went wrong.'); }
  };

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const problem = validateLine(name, amount);
    if (problem) return setError(problem);
    await guard(async () => {
      await createLine(projectId, name, parseAmountToCents(amount.trim() === '' ? '0' : amount) ?? 0);
      setName(''); setAmount(''); setError('');
    }, setError);
  }

  function startEdit(l: BudgetLineRecord) {
    setEditing(l.id); setEName(l.data.name); setEAmount((l.data.plannedCents / 100).toFixed(2)); setEError('');
  }
  async function saveEdit(l: BudgetLineRecord) {
    const problem = validateLine(eName, eAmount);
    if (problem) return setEError(problem);
    await guard(async () => {
      await saveLine(l.id, { name: eName, plannedCents: parseAmountToCents(eAmount.trim() === '' ? '0' : eAmount) ?? 0 });
      setEditing(null);
    }, setEError);
  }

  return (
    <section className="card pj-card" aria-labelledby="pj-lines-h">
      <h2 id="pj-lines-h">Budget lines</h2>
      {lines.length === 0 ? (
        <EmptyState title="No budget lines yet">Split the budget into the parts you expect to pay for, such as Cabinets, Flooring or Labor.</EmptyState>
      ) : (
        <ul className="plain pj-lines">
          {lines.map((l, i) => (
            <li key={l.id} className="pj-line">
              {editing === l.id ? (
                <div className="pj-line-edit">
                  <input value={eName} onChange={(e) => setEName(e.target.value)} aria-label="Line name" maxLength={120} />
                  <input value={eAmount} onChange={(e) => setEAmount(e.target.value)} aria-label="Planned amount" inputMode="decimal" />
                  <button className="btn primary" onClick={() => void saveEdit(l)}>Save</button>
                  <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
                  {eError && <div className="error" role="alert">{eError}</div>}
                </div>
              ) : (
                <>
                  <span className="pj-line-name">{l.data.name}</span>
                  <span className="pj-amount">{formatCents(l.data.plannedCents)}</span>
                  <span className="pj-line-actions">
                    <button className="btn icon" aria-label={`Move ${l.data.name} up`} disabled={i === 0} onClick={() => void moveLine(projectId, l.id, -1)}>↑</button>
                    <button className="btn icon" aria-label={`Move ${l.data.name} down`} disabled={i === lines.length - 1} onClick={() => void moveLine(projectId, l.id, 1)}>↓</button>
                    <button className="link" onClick={() => startEdit(l)}>Edit</button>
                    <button className="link danger" onClick={() => setAskRemove(l.id)}>Remove</button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {lines.length > 0 && (
        <p className={`pj-compare s-${sum.state}`} role="status">
          <strong>Lines total {formatCents(sum.plannedTotalCents)}.</strong>{' '}
          {sum.state === 'derived' && 'No overall budget is set, so this total is the budget. Set one under Edit if you want to compare.'}
          {sum.state === 'balanced' && 'That matches the overall budget exactly.'}
          {sum.state === 'under' && `${formatCents(sum.notYetPlannedCents)} of the ${formatCents(sum.budgetCents)} budget is not planned yet.`}
          {sum.state === 'over' && `That is ${formatCents(-sum.notYetPlannedCents)} more than the ${formatCents(sum.budgetCents)} overall budget.`}
        </p>
      )}

      <form className="pj-add" onSubmit={add}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New line, e.g. Cabinets" aria-label="New budget line name" maxLength={120} />
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Planned amount" aria-label="Planned amount" inputMode="decimal" />
        <button className="btn" type="submit">Add line</button>
        {error && <div className="error" role="alert">{error}</div>}
      </form>

      {target && (
        <ConfirmDialog
          title="Remove budget line?"
          confirmLabel="Remove line"
          busyLabel="Removing…"
          kind="linked"
          onCancel={() => setAskRemove(null)}
          // If a commitment or transaction uses the line, removeLine refuses; the reason is shown here and nothing is removed.
          onConfirm={async () => { await removeLine(target.id); toast('Budget line removed'); setAskRemove(null); }}
        >
          <p><strong>{target.data.name}</strong><br /><span className="muted small">Planned {formatCents(target.data.plannedCents)}</span></p>
          <p>This removes the line from the project's budget. A line that commitments or transactions still use cannot be removed.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
