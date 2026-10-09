import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Txn } from '../types';
import { formatCents, parseAmountToCents, todayISO } from '../lib/money';
import { finalizeReconcile, reconcileCheck, type ReconcileResult } from '../lib/ledger';
import { deleteTxn, findTransferCandidates, linkPair, unlinkTransfer, updateTxn } from '../lib/transfers';
import TxnForm from './TxnForm';

export default function LedgerPage() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const account = useLiveQuery(() => db.accounts.get(id), [id]);
  const txns = useLiveQuery(() => db.txns.where('accountId').equals(id).toArray(), [id]);
  const accounts = useLiveQuery(() => db.accounts.toArray(), []) ?? [];
  const cats = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const allTxns = useLiveQuery(() => db.txns.toArray(), []) ?? [];
  const candidates = useLiveQuery(() => findTransferCandidates(db), [allTxns.length]) ?? [];

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Txn | null>(null);
  const [recDate, setRecDate] = useState(todayISO());
  const [recBal, setRecBal] = useState('');
  const [rec, setRec] = useState<ReconcileResult | null>(null);
  const [recErr, setRecErr] = useState('');

  if (!account || !txns) return <p className="muted">Loading…</p>;

  const isCard = account.kind === 'credit_card' || account.kind === 'loan'; // a balance you owe, shown positive
  const acctName = (aid: number) => accounts.find((a) => a.id === aid)?.name ?? '?';
  const catName = (cid: number | null) => cats.find((c) => c.id === cid)?.name ?? 'Uncategorized';

  const sorted = [...txns].sort((a, b) => a.date.localeCompare(b.date) || a.id! - b.id!);
  let run = account.openingBalanceCents;
  const withRun = sorted.map((t) => ({ t, run: (run += t.amountCents) }));
  const balance = run;
  const pendingTotal = txns.filter((t) => t.status === 'pending').reduce((s, t) => s + t.amountCents, 0);
  const myCandidates = candidates.filter(([a, b]) => a.accountId === id || b.accountId === id);

  async function runReconcile() {
    setRecErr('');
    const cents = parseAmountToCents(recBal);
    if (cents === null) return setRecErr('Enter the statement ending balance');
    // For cards the statement shows what you owe; we hold debt as negative.
    setRec(await reconcileCheck(db, id, recDate, isCard ? -Math.abs(cents) : cents));
  }

  return (
    <>
      <div className="row spread">
        <h1>{account.name}</h1>
        <span className="row"><Link to="/transactions">All transactions</Link><Link to="/">← Accounts</Link></span>
      </div>
      <div className="card row spread">
        <span>{isCard ? 'Owed' : 'Balance'}: <strong className={balance < 0 ? 'neg' : ''}>{formatCents(isCard ? -balance : balance)}</strong></span>
        <span className="muted">Cleared: {formatCents(isCard ? -(balance - pendingTotal) : balance - pendingTotal)} · Pending: {formatCents(pendingTotal)}</span>
        <span className="muted">Opening {formatCents(isCard ? -account.openingBalanceCents : account.openingBalanceCents)} on {account.openingDate}</span>
      </div>

      {myCandidates.length > 0 && (
        <div className="card">
          <strong>Possible transfers</strong>
          <p className="muted">These look like two halves of one transfer. Link them so they stop counting as spending.</p>
          {myCandidates.map(([a, b]) => (
            <div className="row spread" key={`${a.id}-${b.id}`}>
              <span>
                {a.date} {acctName(a.accountId)} {formatCents(a.amountCents)} ↔ {b.date} {acctName(b.accountId)} {formatCents(b.amountCents)}
              </span>
              <button onClick={() => linkPair(db, a.id!, b.id!)}>Link as transfer</button>
            </div>
          ))}
        </div>
      )}

      {adding || editing ? (
        <TxnForm
          key={editing?.id ?? 'new'}
          account={account}
          editing={editing ?? undefined}
          otherAccountId={editing?.transferTxnId ? allTxns.find((t) => t.id === editing.transferTxnId)?.accountId : undefined}
          onDone={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      ) : (
        <button className="primary" onClick={() => setAdding(true)}>+ Add transaction</button>
      )}

      <h2>Transactions</h2>
      <table>
        <thead>
          <tr>
            <th>Date</th><th>Payee</th><th className="hide-sm">Category</th><th className="num">Amount</th><th className="num hide-sm">Balance</th><th></th>
          </tr>
        </thead>
        <tbody>
          {[...withRun].reverse().map(({ t, run }) => {
            const other = t.transferTxnId ? allTxns.find((x) => x.id === t.transferTxnId) : undefined;
            return (
              <tr key={t.id}>
                <td>{t.date}</td>
                <td>
                  {t.payee || <span className="muted">(no payee)</span>}{' '}
                  <span className={`badge ${t.status}`}>{t.status}</span>
                  {t.recurringId && t.status === 'pending' && <span className="badge scheduled"> scheduled</span>}
                  <div className="muted">{t.memo}</div>
                </td>
                <td className="hide-sm">
                  {other ? (
                    <span>↔ {acctName(other.accountId)}</span>
                  ) : t.splits?.length ? (
                    <span>Split: {t.splits.map((s) => catName(s.categoryId)).join(', ')}</span>
                  ) : (
                    <span className={t.categoryId ? '' : 'muted'}>{catName(t.categoryId)}</span>
                  )}
                </td>
                <td className={`num ${t.amountCents < 0 ? 'neg' : 'pos'}`}>{formatCents(t.amountCents)}</td>
                <td className="num hide-sm">{formatCents(run)}</td>
                <td>
                  <div className="row">
                    {t.status === 'pending' && <button className="link" onClick={() => updateTxn(db, t.id!, { status: 'cleared' })}>clear</button>}
                    <button className="link" onClick={() => { setAdding(false); setEditing(t); window.scrollTo({ top: 0 }); }}>edit</button>
                    {t.transferTxnId && <button className="link" onClick={() => unlinkTransfer(db, t.id!)}>unlink</button>}
                    <button
                      className="link danger"
                      onClick={() => {
                        const msg = t.transferTxnId ? 'Delete this transfer? The matching entry on the other account will be deleted too.' : 'Delete this transaction?';
                        if (confirm(msg)) deleteTxn(db, t.id!);
                      }}
                    >delete</button>
                  </div>
                </td>
              </tr>
            );
          })}
          {withRun.length === 0 && <tr><td colSpan={6} className="muted">No transactions yet.</td></tr>}
        </tbody>
      </table>

      <h2>Reconcile</h2>
      <div className="card">
        <p className="muted">Enter the ending balance from your statement. {isCard ? 'For a card or loan, enter the amount owed.' : ''}</p>
        <div className="row">
          <label className="f">Statement date<input type="date" value={recDate} onChange={(e) => setRecDate(e.target.value)} /></label>
          <label className="f">Ending balance<input value={recBal} onChange={(e) => setRecBal(e.target.value)} inputMode="decimal" /></label>
          <button onClick={runReconcile}>Check</button>
        </div>
        {recErr && <div className="error">{recErr}</div>}
        {rec && (
          <div style={{ marginTop: 8 }}>
            <div>Cleared balance through {recDate}: <strong>{formatCents(isCard ? -rec.clearedBalanceCents : rec.clearedBalanceCents)}</strong></div>
            {rec.differenceCents === 0 ? (
              <div className="ok">
                Balanced. <button onClick={async () => { await finalizeReconcile(db, rec.clearedTxnIds); setRec(null); }}>Lock {rec.clearedTxnIds.length} cleared transactions as reconciled</button>
              </div>
            ) : (
              <div className="warn">
                Off by {formatCents(Math.abs(rec.differenceCents))}. Look for a missing or duplicated transaction, or one still marked pending that has cleared.
              </div>
            )}
          </div>
        )}
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <button
          className="danger"
          onClick={async () => {
            if (!confirm(`Delete "${account.name}" and all ${txns.length} of its transactions? Linked transfer entries on other accounts are removed too.`)) return;
            await db.transaction('rw', db.accounts, db.txns, async () => {
              for (const t of txns) await deleteTxn(db, t.id!);
              await db.accounts.delete(id);
            });
            nav('/');
          }}
        >Delete account</button>
      </div>
    </>
  );
}
