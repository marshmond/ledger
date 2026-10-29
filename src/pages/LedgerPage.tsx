import { Fragment, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Txn } from '../types';
import { formatCents, parseAmountToCents, todayISO } from '../lib/money';
import { finalizeReconcile, reconcileCheck, type ReconcileResult } from '../lib/ledger';
import { deleteTxn, findTransferCandidates, linkPair, unlinkTransfer, updateTxn } from '../lib/transfers';
import TxnForm from './TxnForm';
import { SplitDetailRow, SplitToggle } from './SplitDetail';
import CreditLimit from './CreditLimit';
import RenameAccount from './RenameAccount';
import { canBePrimary, getPrimaryAccountId, setPrimaryAccountId } from '../lib/primaryAccount';
import { EmptyState, signedCents } from '../ui/components';
import { EMPTY_FILTER, applyFilter, activeFilterCount, buildRows, presetRange, type DatePreset, type TxnFilter } from '../lib/txnQuery';
import { ColumnBoxes, ColumnFilterRow, FilterChips, PRESETS, TxnFilterPanel, filterChips } from './TxnFilterUi';

export default function LedgerPage() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const account = useLiveQuery(() => db.accounts.get(id), [id]);
  const txns = useLiveQuery(() => db.txns.where('accountId').equals(id).toArray(), [id]);
  const accounts = useLiveQuery(() => db.accounts.toArray(), []) ?? [];
  const cats = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const groups = useLiveQuery(() => db.categoryGroups.toArray(), []) ?? [];
  const allTxns = useLiveQuery(() => db.txns.toArray(), []) ?? [];
  const candidates = useLiveQuery(() => findTransferCandidates(db), [allTxns.length]) ?? [];
  const primaryId = useLiveQuery(() => getPrimaryAccountId(db), []);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Txn | null>(null);
  const [recDate, setRecDate] = useState(todayISO());
  const [recBal, setRecBal] = useState('');
  const [rec, setRec] = useState<ReconcileResult | null>(null);
  const [recErr, setRecErr] = useState('');
  const [filter, setFilter] = useState<TxnFilter>(EMPTY_FILTER);
  const [preset, setPreset] = useState<DatePreset | 'custom'>('all');
  const [panel, setPanel] = useState(false);
  const [openSplits, setOpenSplits] = useState<Set<number>>(new Set());
  const toggleSplit = (sid: number) => setOpenSplits((o) => { const n = new Set(o); n.has(sid) ? n.delete(sid) : n.add(sid); return n; });
  const patch = (p: Partial<TxnFilter>) => setFilter((f) => ({ ...f, ...p }));

  if (!account || !txns) return <p className="muted">Loading…</p>;

  const isCard = account.kind === 'credit_card' || account.kind === 'loan'; // a balance you owe, shown positive
  const acctName = (aid: number) => accounts.find((a) => a.id === aid)?.name ?? '?';
  const catName = (cid: number | null) => cats.find((c) => c.id === cid)?.name ?? 'Uncategorized';

  const sorted = [...txns].sort((a, b) => a.date.localeCompare(b.date) || a.id! - b.id!);
  let run = account.openingBalanceCents;
  const withRun = sorted.map((t) => ({ t, run: (run += t.amountCents) }));
  const balance = run;
  // Filters only decide which rows are listed; each row keeps its true running balance.
  const shownIds = new Set(applyFilter(buildRows(allTxns, accounts, cats), { ...filter, accountIds: [id] }).map((r) => r.txn.id));
  const shownRows = withRun.filter(({ t }) => shownIds.has(t.id!));
  const chips = filterChips(filter, patch, setPreset);
  const clearAll = () => { setPreset('all'); setFilter(EMPTY_FILTER); };
  const filtering = activeFilterCount(filter) > 0;
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
        <RenameAccount table="accounts" id={id} name={account.name} taken={accounts.filter((a) => a.id !== id).map((a) => a.name)} heading />
        <span className="row"><Link to="/transactions">All transactions</Link><Link to="/accounts">← Accounts</Link></span>
      </div>
      <div className="card row spread">
        <span>{isCard ? 'Owed' : 'Balance'}: <strong className={balance < 0 ? 'neg' : ''}>{formatCents(isCard ? -balance : balance)}</strong></span>
        <span className="muted">Cleared: {formatCents(isCard ? -(balance - pendingTotal) : balance - pendingTotal)} · Pending: {formatCents(pendingTotal)}</span>
        <span className="muted">Opening {formatCents(isCard ? -account.openingBalanceCents : account.openingBalanceCents)} on {account.openingDate}</span>
      </div>

      {canBePrimary(account) && (
        <div className="row" style={{ margin: '6px 0' }}>
          {primaryId === id ? (
            <>
              <span className="badge">Primary payment account</span>
              <span className="muted">Quick add starts here.</span>
              <button className="link" onClick={() => setPrimaryAccountId(db, null)}>remove</button>
            </>
          ) : (
            <>
              <button className="link" onClick={() => setPrimaryAccountId(db, id)}>Make this my primary payment account</button>
              <span className="muted">The account Quick add starts on.</span>
            </>
          )}
        </div>
      )}

      {account.kind === 'credit_card' && <CreditLimit account={account} balance={balance} />}

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
      <div className="toolbar">
        <label className="grow">
          <span className="sr-only">Search payee or memo</span>
          <input type="search" value={filter.text} onChange={(e) => patch({ text: e.target.value })} placeholder="Search payee or memo" />
        </label>
        <label>
          <span className="sr-only">Date</span>
          <select value={preset} onChange={(e) => { const v = e.target.value as DatePreset | 'custom'; setPreset(v); if (v === 'custom') setPanel(true); else patch(presetRange(v, todayISO())); }}>
            {PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <button className="filter-btn" aria-expanded={panel} aria-controls="acct-filter-panel" onClick={() => setPanel(!panel)}>
          Filters {chips.length > 0 && <span className="count">{chips.length}</span>}
        </button>
      </div>
      {panel && <TxnFilterPanel id="acct-filter-panel" filter={filter} patch={patch} setPreset={setPreset} categories={cats} groups={groups} />}
      <FilterChips chips={chips} onClearAll={clearAll} />
      {filtering && <p className="muted">Showing {shownRows.length.toLocaleString()} of {withRun.length.toLocaleString()} transactions. The Balance column still shows the true running balance.</p>}
      <ColumnBoxes filter={filter} patch={patch} />
      <div className="txn-wrap"><table className="txn-table no-sel">
        <thead>
          <tr>
            <th className="c-date">Date</th><th className="c-payee">Payee</th><th className="c-cat">Category</th><th className="num c-amt">Amount</th><th className="num c-cat">Balance</th><th className="c-act"><span className="sr-only">Actions</span></th>
          </tr>
          <ColumnFilterRow filter={filter} patch={patch} variant="account" />
        </thead>
        <tbody>
          {[...shownRows].reverse().map(({ t, run }) => {
            const other = t.transferTxnId ? allTxns.find((x) => x.id === t.transferTxnId) : undefined;
            return (
              <Fragment key={t.id}>
              <tr>
                <td className="c-date">{t.date}</td>
                <td className="c-payee">
                  {t.payee || <span className="muted">(no payee)</span>}{' '}
                  <span className={`badge ${t.status}`}>{t.status}</span>
                  {t.recurringId && t.status === 'pending' && <span className="badge scheduled"> scheduled</span>}
                  {t.memo && <span className="sub">{t.memo}</span>}
                  <span className="sub show-sm">{t.date}</span>
                  {t.splits?.length && !other ? <SplitToggle className="show-sm" open={openSplits.has(t.id!)} onToggle={() => toggleSplit(t.id!)}>Show split amounts</SplitToggle> : null}
                </td>
                <td className="c-cat">
                  {other ? (
                    <span>↔ {acctName(other.accountId)}</span>
                  ) : t.splits?.length ? (
                    <SplitToggle open={openSplits.has(t.id!)} onToggle={() => toggleSplit(t.id!)}>Split: {t.splits.map((s) => catName(s.categoryId)).join(', ')}</SplitToggle>
                  ) : (
                    <span className={t.categoryId ? '' : 'muted'}>{catName(t.categoryId)}</span>
                  )}
                </td>
                <td className={`num c-amt ${t.amountCents < 0 ? 'neg' : 'pos'}`}>{signedCents(t.amountCents)}</td>
                <td className="num c-cat">{formatCents(run)}</td>
                <td className="c-act">
                  <div className="row" style={{ justifyContent: 'inherit', flexWrap: 'nowrap' }}>
                    {t.status === 'pending' && <button className="link" onClick={() => updateTxn(db, t.id!, { status: 'cleared' })}>Clear</button>}
                    <button className="link" onClick={() => { setAdding(false); setEditing(t); window.scrollTo({ top: 0 }); }}>Edit</button>
                    {t.transferTxnId && <button className="link" onClick={() => unlinkTransfer(db, t.id!)}>Unlink</button>}
                    <button
                      className="link danger"
                      onClick={() => {
                        const msg = t.transferTxnId ? 'Delete this transfer? The matching entry on the other account will be deleted too.' : 'Delete this transaction?';
                        if (confirm(msg)) deleteTxn(db, t.id!);
                      }}
                    >Delete</button>
                  </div>
                </td>
              </tr>
              {t.splits?.length && !other && openSplits.has(t.id!) ? <SplitDetailRow txn={t} catName={catName} variant="account" /> : null}
              </Fragment>
            );
          })}
          {withRun.length > 0 && shownRows.length === 0 && <tr><td colSpan={6} style={{ padding: 0 }}><EmptyState title="Nothing matches these filters" action={<button onClick={clearAll}>Clear all filters</button>}>Try a wider date range or fewer filters.</EmptyState></td></tr>}
          {withRun.length === 0 && <tr><td colSpan={6} style={{ padding: 0 }}><EmptyState title="No transactions yet" action={<button className="primary" onClick={() => setAdding(true)}>Add a transaction</button>}>Add one by hand, or import a bank file.</EmptyState></td></tr>}
        </tbody>
      </table></div>

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
