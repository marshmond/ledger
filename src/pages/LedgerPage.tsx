import TaskActions from '../modules/tasks/TaskActions';
import { Fragment, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Link, useNavigate } from '../core/router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Txn } from '../types';
import { formatCents, parseAmountToCents, todayISO } from '../lib/money';
import { finalizeReconcile, reconcileCheck, type ReconcileResult } from '../lib/ledger';
import Modal from '../shell/Modal';
import { blockedReasons, blocksDeletion, confirmParts, deleteAccountWithTransactions, readAccountDependents, type AccountDependents } from '../lib/accountDependents';
import ConfirmDialog from '../shell/ConfirmDialog';
import { txnRowLabel } from '../lib/a11yLabels';
import { findTransferCandidates, linkPair, unlinkTransfer, updateTxn } from '../lib/transfers';
import TxnForm from './TxnForm';
import TxnDeleteDialog from './TxnDeleteDialog';
import { SplitDetailRow, SplitToggle } from './SplitDetail';
import CreditLimit from './CreditLimit';
import MinBalance from './MinBalance';
import RenameAccount from './RenameAccount';
import RowActions from './RowActions';
import { canBePrimary, getPrimaryAccountId, setPrimaryAccountId } from '../lib/primaryAccount';
import { EmptyState, signedCents } from '../ui/components';
import { StatusChip } from '../ui/StatusChip';
import { EMPTY_FILTER, applyFilter, activeFilterCount, buildRows, presetRange, type DatePreset, type TxnFilter } from '../lib/txnQuery';
import { ColumnBoxes, ColumnFilterRow, FilterChips, PRESETS, TxnFilterPanel, filterChips } from './TxnFilterUi';
import { KIND_LABEL, STATUS_HELP, STATUS_WORD, isDebtKind, statusTone } from './moneyPresentation';
import './money.css';

export default function LedgerPage() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const [blocked, setBlocked] = useState<AccountDependents | null>(null);
  // The account-deletion question (what depends on the account was read just before it opened; the deletion reads it again).
  const [confirmingDelete, setConfirmingDelete] = useState<AccountDependents | null>(null);
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
  const [deletingTxn, setDeletingTxn] = useState<number | null>(null);
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
  const formOpen = adding || !!editing;
  /** The register is one screen away from the form: bring the form into view when it opens (it used to open at the top of the page). */
  const showForm = () => setTimeout(() => document.getElementById('acct-txn-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);

  async function runReconcile() {
    setRecErr('');
    const cents = parseAmountToCents(recBal);
    if (cents === null) return setRecErr('Enter the statement ending balance');
    // For cards the statement shows what you owe; we hold debt as negative.
    setRec(await reconcileCheck(db, id, recDate, isCard ? -Math.abs(cents) : cents));
  }

  return (
    <div className="mny-page mny-acctpage">
      <nav className="mny-crumbs" aria-label="Account navigation">
        <Link to="/accounts">← Accounts</Link>
        <Link to="/transactions">All transactions</Link>
      </nav>

      <header className="card mny-ahead">
        <div className="mny-ahead-top">
          <div className="mny-ahead-id">
            <RenameAccount table="accounts" id={id} name={account.name} taken={accounts.filter((a) => a.id !== id).map((a) => a.name)} heading />
            <div className="mny-chips">
              <StatusChip tone="neutral" icon={false}>{KIND_LABEL[account.kind]}</StatusChip>
              {account.closed && <StatusChip tone="neutral" icon={false}>Closed</StatusChip>}
              {primaryId === id && canBePrimary(account) && <StatusChip tone="active" icon={false}>Primary payment account</StatusChip>}
            </div>
          </div>
          <div className="mny-ahead-act">
            <TaskActions module="ledger" id={`account:${id}`} label={account.name} />
            {!formOpen && <button className="primary" onClick={() => { setAdding(true); showForm(); }}>+ Add transaction</button>}
          </div>
        </div>
        <dl className="mny-ahead-figs">
          <div className="mny-ahead-main"><dt>{isCard ? 'Owed' : 'Balance'}</dt><dd className={!isDebtKind(account.kind) && balance < 0 ? 'neg' : ''}>{formatCents(isCard ? -balance : balance)}</dd></div>
          <div><dt>Cleared</dt><dd>{formatCents(isCard ? -(balance - pendingTotal) : balance - pendingTotal)}</dd></div>
          <div><dt>Pending</dt><dd>{formatCents(pendingTotal)}</dd></div>
          <div><dt>Opening</dt><dd>{formatCents(isCard ? -account.openingBalanceCents : account.openingBalanceCents)}<span className="mny-fig-sub"> on {account.openingDate}</span></dd></div>
        </dl>
      </header>

      <div className="mny-acctgrid">
        <section className="card mny-reccard" aria-labelledby="reconcile-h">
          <h2 id="reconcile-h" className="mny-h2 mny-h2--tight">Reconcile</h2>
          <p className="muted">Enter the ending balance from your statement. {isCard ? 'For a card or loan, enter the amount owed.' : ''}</p>
          <div className="mny-recform">
            <label className="f">Statement date<input type="date" value={recDate} onChange={(e) => setRecDate(e.target.value)} /></label>
            <label className="f">Ending balance<input value={recBal} onChange={(e) => setRecBal(e.target.value)} inputMode="decimal" /></label>
            <button onClick={runReconcile}>Check</button>
          </div>
          {recErr && <div className="error" role="alert">{recErr}</div>}
          {rec && (
            <div className="mny-recresult">
              <div>Cleared balance through {recDate}: <strong>{formatCents(isCard ? -rec.clearedBalanceCents : rec.clearedBalanceCents)}</strong></div>
              {rec.differenceCents === 0 ? (
                <div className="ok" role="status">
                  Balanced. <button onClick={async () => { await finalizeReconcile(db, rec.clearedTxnIds, id); setRec(null); }}>Lock {rec.clearedTxnIds.length} cleared transactions as reconciled</button>
                </div>
              ) : (
                <div className="warn" role="status">
                  Off by {formatCents(Math.abs(rec.differenceCents))}. Look for a missing or duplicated transaction, or one still marked pending that has cleared.
                </div>
              )}
            </div>
          )}
        </section>

        <div className="mny-acctside">
          {canBePrimary(account) && (
            <div className="card mny-primary">
              {primaryId === id ? (
                <>
                  <span><strong>Primary payment account.</strong> <span className="muted">Quick add starts here.</span></span>
                  <button className="link" onClick={() => setPrimaryAccountId(db, null)}>remove</button>
                </>
              ) : (
                <>
                  <span className="muted">The account Quick add starts on.</span>
                  <button className="link" onClick={() => setPrimaryAccountId(db, id)}>Make this my primary payment account</button>
                </>
              )}
            </div>
          )}
          {account.kind === 'credit_card' && <CreditLimit account={account} balance={balance} />}
          {!account.closed && (account.kind === 'checking' || account.kind === 'savings') && <MinBalance account={account} balance={balance} />}
        </div>
      </div>

      {myCandidates.length > 0 && (
        <section className="card" aria-labelledby="poss-h">
          <h2 id="poss-h" className="mny-h2 mny-h2--tight">Possible transfers</h2>
          <p className="muted">These look like two halves of one transfer. Link them so they stop counting as spending.</p>
          {myCandidates.map(([a, b]) => (
            <div className="mny-cand" key={`${a.id}-${b.id}`}>
              <span>
                {a.date} {acctName(a.accountId)} {formatCents(a.amountCents)} ↔ {b.date} {acctName(b.accountId)} {formatCents(b.amountCents)}
              </span>
              <button onClick={() => linkPair(db, a.id!, b.id!)}>Link as transfer</button>
            </div>
          ))}
        </section>
      )}

      {formOpen && (
        <div id="acct-txn-form">
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
        </div>
      )}

      <section aria-labelledby="txns-h">
        <h2 id="txns-h" className="mny-h2">Transactions <span className="mny-count">{filtering ? `${shownRows.length.toLocaleString()} of ${withRun.length.toLocaleString()}` : withRun.length.toLocaleString()}</span></h2>
        <div className="toolbar mny-toolbar">
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
        <div className="txn-wrap mny-ledger"><table className="txn-table no-sel" aria-label={`Transactions in ${account.name}`}>
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
                    <span className="mny-nameline">
                      <span className="mny-payee">{t.payee || <span className="muted">(no payee)</span>}</span>{' '}
                      <span title={STATUS_HELP[t.status]}><StatusChip tone={statusTone(t.status)} icon={false}>{STATUS_WORD[t.status]}</StatusChip></span>
                      {t.recurringId && t.status === 'pending' && <> <StatusChip tone="info" icon={false}>scheduled</StatusChip></>}
                      {other && <> <StatusChip tone="info" icon={false}>Transfer</StatusChip></>}
                    </span>
                    <span className="mny-metaline">
                      {t.memo && <span className="sub">{t.memo}</span>}
                      <span className="sub show-sm">{t.date} · {other ? `↔ ${acctName(other.accountId)}` : t.splits?.length ? 'Split' : catName(t.categoryId)} · <span className="mny-nowrap">Balance {formatCents(run)}</span></span>
                      {t.splits?.length && !other ? <SplitToggle className="show-sm" open={openSplits.has(t.id!)} onToggle={() => toggleSplit(t.id!)}>Show split amounts</SplitToggle> : null}
                    </span>
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
                  <td className="num c-cat c-run">{formatCents(run)}</td>
                  <td className="c-act">
                    <RowActions label={`${t.payee || 'transaction'}, ${t.date}`}>
                      <TaskActions module="ledger" id={`txn:${t.id}`} label={`${t.payee || 'Transaction'} ${t.date}`} />
                      {t.status === 'pending' && <button className="link" aria-label={txnRowLabel('Clear', t.payee, t.date)} onClick={() => updateTxn(db, t.id!, { status: 'cleared' })}>Clear</button>}
                      <button className="link" aria-label={txnRowLabel('Edit', t.payee, t.date)} onClick={() => { setAdding(false); setEditing(t); showForm(); }}>Edit</button>
                      {t.transferTxnId && <button className="link" aria-label={txnRowLabel('Unlink', t.payee, t.date)} onClick={() => unlinkTransfer(db, t.id!)}>Unlink</button>}
                      <button
                        className="link danger"
                        aria-label={txnRowLabel('Delete', t.payee, t.date)}
                        onClick={() => setDeletingTxn(t.id!)}
                      >Delete</button>
                    </RowActions>
                  </td>
                </tr>
                {t.splits?.length && !other && openSplits.has(t.id!) ? <SplitDetailRow txn={t} catName={catName} variant="account" /> : null}
                </Fragment>
              );
            })}
            {withRun.length > 0 && shownRows.length === 0 && <tr><td colSpan={6} className="mny-emptycell"><EmptyState title="Nothing matches these filters" action={<button onClick={clearAll}>Clear all filters</button>}>Try a wider date range or fewer filters.</EmptyState></td></tr>}
            {withRun.length === 0 && <tr><td colSpan={6} className="mny-emptycell"><EmptyState title="No transactions yet" action={<button className="primary" onClick={() => { setAdding(true); showForm(); }}>Add a transaction</button>}>Add one by hand, or import a bank file.</EmptyState></td></tr>}
          </tbody>
        </table></div>
      </section>

      <div className="mny-danger">
        <button
          className="danger"
          onClick={async () => {
            // ST-S1 (DI-01): look at what still depends on this account first. Scheduled items and linked loans BLOCK the deletion.
            const dep = await readAccountDependents(db, id);
            if (blocksDeletion(dep)) return setBlocked(dep);
            setConfirmingDelete(dep);
          }}
        >Delete account</button>
      </div>
      {deletingTxn !== null && <TxnDeleteDialog ids={[deletingTxn]} subject="transaction" onClose={() => setDeletingTxn(null)} onDeleted={() => setDeletingTxn(null)} />}

      {confirmingDelete && (
        <ConfirmDialog
          title={`Delete "${account.name}"?`}
          confirmLabel="Delete account"
          busyLabel="Deleting…"
          onCancel={() => setConfirmingDelete(null)}
          onConfirm={async () => {
            const res = await deleteAccountWithTransactions(db, id); // re-checks inside one transaction, so an out-of-date question cannot get around a block
            setConfirmingDelete(null);
            if (!res.ok) return setBlocked(res.dependents);
            nav('/');
          }}
        >
          <p><strong>{confirmParts(account.name, confirmingDelete).headline}</strong></p>
          {confirmParts(account.name, confirmingDelete).notes.length > 0 && (
            <>
              <p>Also:</p>
              <ul>{confirmParts(account.name, confirmingDelete).notes.map((n) => <li key={n}>{n}</li>)}</ul>
            </>
          )}
        </ConfirmDialog>
      )}

      {blocked && (
        <Modal title="This account cannot be deleted yet" onClose={() => setBlocked(null)}>
          {blockedReasons(account.name, blocked).map((r) => <p key={r}>{r}</p>)}
          <p>Nothing was deleted. Before deleting the account, move each of those items to another account (open it and change its account) or delete it yourself.{blocked.rules.length > 0 && <> You can do that on the <Link to="/scheduled">Scheduled page</Link>.</>} Pausing an item is not enough, because a paused item can be turned back on. Then come back and delete the account.</p>
          <div className="row"><button className="primary" onClick={() => setBlocked(null)}>OK</button></div>
        </Modal>
      )}
    </div>
  );
}
