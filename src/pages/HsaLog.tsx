import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { InvAccount, Person } from '../types';
import { hsaYearImpact } from '../lib/hsa';
import { formatCents, todayISO } from '../lib/money';
import { MoneyField } from './fields';
import ConfirmDialog from '../shell/ConfirmDialog';
import { deleteHsaWithdrawal } from '../lib/confirmedDeletes';

/** Withdrawals from an HSA: qualified medical spending is tax-free; the rest is taxed (plus a penalty before 65). */
export default function HsaLog({ account, people }: { account: InvAccount; people: Person[] }) {
  const all = useLiveQuery(() => db.hsaWithdrawals.where('accountId').equals(account.id!).toArray(), [account.id]) ?? [];
  const [date, setDate] = useState(todayISO());
  const [amt, setAmt] = useState(0);
  const [qualified, setQualified] = useState(true);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const year = Number(todayISO().slice(0, 4));
  const impact = hsaYearImpact(all, [account], people, year);
  const sorted = [...all].sort((a, b) => b.date.localeCompare(a.date));

  async function add() {
    if (amt <= 0 || !date) return;
    const fromCash = Math.min(amt, Math.max(0, account.cashCents));
    await db.transaction('rw', db.hsaWithdrawals, db.invAccounts, async () => {
      await db.hsaWithdrawals.add({ accountId: account.id!, date, amountCents: amt, qualified, note: note.trim(), fromCashCents: fromCash });
      if (fromCash > 0) await db.invAccounts.update(account.id!, { cashCents: account.cashCents - fromCash });
    });
    setMsg(fromCash >= amt ? 'Logged, and taken from the account’s cash.' : `Logged. ${formatCents(amt - fromCash)} was more than the account’s cash; sell holdings to cover it.`);
    setAmt(0);
    setNote('');
  }
  // D20.1B (NC-14): the withdrawal whose "delete" was pressed, by id. Nothing is changed until the dialog's own button is pressed.
  const [askId, setAskId] = useState<number | null>(null);
  const askRow = askId === null ? undefined : all.find((x) => x.id === askId);
  // The row is read again inside the transaction (lib/confirmedDeletes.ts), so a withdrawal already deleted elsewhere gives its cash back only once.
  const remove = (id: number) => deleteHsaWithdrawal(db, account.id!, id);

  return (
    <div style={{ marginTop: 8 }}>
      <strong>Withdrawals</strong>
      <p className="muted">
        Spending on qualified medical costs is tax-free. A withdrawal marked “not for medical costs” is added to your taxable income on the Income tab, plus a 20% penalty if the owner is under 65.
      </p>
      <div className="row">
        <label className="f">Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <MoneyField key={`a${all.length}`} label="Amount" cents={amt} onChange={setAmt} width={110} />
        <label className="f">Note<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Dentist, prescriptions…" /></label>
        <label className="chk"><input type="checkbox" checked={qualified} onChange={(e) => setQualified(e.target.checked)} /> Qualified medical expense</label>
        <button disabled={amt <= 0} onClick={add}>Log withdrawal</button>
      </div>
      {msg && <p className="muted" role="status">{msg}</p>}
      {all.some((w) => w.date.startsWith(`${year}-`)) && (
        <p>
          {year} so far: <strong>{formatCents(impact.qualifiedCents)}</strong> qualified (tax-free)
          {impact.taxableCents > 0 && <>, <strong className="neg">{formatCents(impact.taxableCents)}</strong> taxable{impact.penaltyCents > 0 && <> + <strong className="neg">{formatCents(impact.penaltyCents)}</strong> penalty</>}</>}.
          {impact.assumedUnder65 > 0 && <span className="muted"> (Set the owner so the age-65 rule can apply.)</span>}
        </p>
      )}
      {sorted.length > 0 && (
        <table>
          <tbody>
            {sorted.slice(0, 12).map((w) => (
              <tr key={w.id}>
                <td>{w.date}</td><td className="num">{formatCents(w.amountCents)}</td>
                <td>{w.qualified ? <span className="ok">qualified</span> : <span className="warn">taxable</span>}</td>
                <td>{w.note}</td>
                <td><button className="link danger" aria-label={`Delete the ${w.date} withdrawal of ${formatCents(w.amountCents)}`} onClick={() => setAskId(w.id!)}>delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {askRow && (
        <ConfirmDialog
          title="Delete HSA withdrawal?"
          confirmLabel="Delete withdrawal"
          busyLabel="Deleting…"
          kind="linked"
          onCancel={() => setAskId(null)}
          onConfirm={async () => { await remove(askRow.id!); setAskId(null); }}
        >
          <p><strong>{askRow.date} · {formatCents(askRow.amountCents)}</strong><br /><span className="muted small">{askRow.qualified ? 'Qualified medical expense' : 'Not for medical costs (taxable)'}{askRow.note ? ` · ${askRow.note}` : ''}</span></p>
          <p>This removes the withdrawal from your log and its effect on this year's tax figures.{askRow.fromCashCents > 0 ? ` The ${formatCents(askRow.fromCashCents)} that was taken from the account's cash goes back into it.` : ' No cash was taken from the account for it, so none is returned.'}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
