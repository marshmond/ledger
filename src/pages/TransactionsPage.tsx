import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSearchParams } from 'react-router-dom';
import { db } from '../db';
import type { Txn, TxnStatus } from '../types';
import { formatCents, todayISO } from '../lib/money';
import { deleteTxn } from '../lib/transfers';
import {
  DEFAULT_SORT, EMPTY_FILTER, applyFilter, buildRows, presetRange, sortRows, toCsv, totals, visibleSelection,
  type DatePreset, type Sort, type SortKey, type TxnFilter,
} from '../lib/txnQuery';
import { bulkDelete, bulkSetCategory, bulkSetStatus, deleteSavedFilter, listSavedFilters, saveFilter } from '../lib/txnBulk';
import { EmptyState, PageHeader, signedCents } from '../ui/components';
import { useToast } from '../ui/Toast';
import { openAddTransaction } from '../shell/QuickAdd';
import { ColumnBoxes, ColumnFilterRow, FilterChips, PRESETS, STATUSES, TxnFilterPanel, filterChips, toggleList } from './TxnFilterUi';
import TxnForm from './TxnForm';
import { SplitDetailRow, SplitToggle } from './SplitDetail';

const COLS: { key: SortKey; label: string; cls?: string; first: 'asc' | 'desc' }[] = [
  { key: 'date', label: 'Date', first: 'desc' },
  { key: 'account', label: 'Account', cls: 'hide-sm', first: 'asc' },
  { key: 'payee', label: 'Payee', first: 'asc' },
  { key: 'category', label: 'Category', cls: 'hide-sm', first: 'asc' },
  { key: 'amount', label: 'Amount', cls: 'num', first: 'desc' },
];

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function TransactionsPage() {
  const txnsLoaded = useLiveQuery(() => db.txns.toArray(), []);
  const txns = txnsLoaded ?? [];
  const accounts = useLiveQuery(() => db.accounts.toArray(), []) ?? [];
  const categories = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const groups = useLiveQuery(() => db.categoryGroups.toArray(), []) ?? [];
  const saved = useLiveQuery(() => listSavedFilters(db), []) ?? [];

  const [searchParams] = useSearchParams();
  const startText = searchParams.get('q') ?? '';
  const [filter, setFilterState] = useState<TxnFilter>(() => ({ ...EMPTY_FILTER, text: startText }));
  const [sort, setSortState] = useState<Sort>(DEFAULT_SORT);
  const [preset, setPreset] = useState<DatePreset | 'custom'>('all');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<Txn | null>(null);
  const [bulkCat, setBulkCat] = useState('');
  const [bulkStatus, setBulkStatus] = useState('');
  const [saveName, setSaveName] = useState('');
  const [panel, setPanel] = useState(false);
  const [openSplits, setOpenSplits] = useState<Set<number>>(new Set());
  const toggleSplit = (id: number) => setOpenSplits((o) => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const catName = (id: number | null) => (id === null ? 'Uncategorized' : categories.find((c) => c.id === id)?.name ?? 'Unknown');
  const toast = useToast();

  useEffect(() => {
    const onDown = (e: MouseEvent) => document.querySelectorAll('details.pick[open]').forEach((d) => { if (!d.contains(e.target as Node)) d.removeAttribute('open'); });
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // Arriving from search while already on this page: apply the new text.
  useEffect(() => { if (startText) { setFilterState((f) => ({ ...f, text: startText })); setPage(0); } }, [startText]);
  const setFilter = (f: TxnFilter) => { setFilterState(f); setPage(0); };
  const patch = (p: Partial<TxnFilter>) => setFilter({ ...filter, ...p });
  const setSort = (s: Sort) => { setSortState(s); setPage(0); };

  const allRows = useMemo(() => buildRows(txns, accounts, categories), [txns, accounts, categories]);
  const filtered = useMemo(() => applyFilter(allRows, filter), [allRows, filter]);
  const sorted = useMemo(() => sortRows(filtered, sort), [filtered, sort]);
  const tot = useMemo(() => totals(filtered), [filtered]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const pageRows = sorted.slice(cur * pageSize, (cur + 1) * pageSize);
  // Only rows inside the current filter can be acted on: a row hidden by a filter change is never touched by a bulk action.
  const selIds = useMemo(() => visibleSelection(sel, filtered), [sel, filtered]);
  const allPageSelected = pageRows.length > 0 && pageRows.every((r) => sel.has(r.txn.id!));

  const toggle = (id: number) => { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n); };
  const clickSort = (key: SortKey, first: 'asc' | 'desc') => setSort(sort.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: first });

  async function doBulk(kind: 'category' | 'delete') {
    if (selIds.length === 0) return;
    if (kind === 'delete') {
      if (!confirm(`Delete ${selIds.length} selected transaction(s)? Deleting one side of a transfer also deletes the other side.`)) return;
      const n = await bulkDelete(db, selIds);
      toast(`Deleted ${n} transaction${n === 1 ? '' : 's'}.`);
      setSel(new Set());
    } else if (kind === 'category') {
      const label = bulkCat === 'none' ? 'Uncategorized' : categories.find((c) => String(c.id) === bulkCat)?.name ?? '';
      if (!confirm(`Set the category to "${label}" on ${selIds.length} transaction(s)? Split transactions are replaced by this single category; transfers are skipped.`)) return;
      const r = await bulkSetCategory(db, selIds, bulkCat === 'none' ? null : Number(bulkCat));
      toast(`Updated ${r.updated} transaction${r.updated === 1 ? '' : 's'}.${r.skippedTransfers ? ` Skipped ${r.skippedTransfers} transfer(s).` : ''}${r.splitsCleared ? ` Replaced ${r.splitsCleared} split(s).` : ''}`);
      setBulkCat('');
      setSel(new Set());
    }
  }

  const accountOf = (t: Txn) => accounts.find((a) => a.id === t.accountId);

  // What is filtering the list, as removable chips. The search box shows its own text, so it gets no chip.
  const chips = filterChips(filter, patch, setPreset, (f) => (f.accountIds.length ? (f.accountIds.length === 1 ? accounts.find((a) => a.id === f.accountIds[0])?.name ?? '1 account' : `${f.accountIds.length} accounts`) : null));
  const clearAll = () => { setPreset('all'); setFilter(EMPTY_FILTER); };

  const setBulkStatusWithUndo = async () => {
    const status = bulkStatus as TxnStatus;
    const ids = selIds;
    // Remember each row's old status so Undo can put it back exactly.
    const before = new Map<TxnStatus, number[]>();
    for (const id of ids) {
      const t = txns.find((x) => x.id === id);
      if (t) before.set(t.status, [...(before.get(t.status) ?? []), id]);
    }
    const n = await bulkSetStatus(db, ids, status);
    setBulkStatus('');
    setSel(new Set());
    toast(`Marked ${n} transaction${n === 1 ? '' : 's'} ${status}.`, async () => {
      for (const [old, group] of before) await bulkSetStatus(db, group, old);
    });
  };

  return (
    <>
      <PageHeader
        title="Transactions"
        description={`Every transaction from every account in one place. ${txns.length.toLocaleString()} across ${accounts.length} account${accounts.length === 1 ? '' : 's'}.`}
        actions={<button className="primary" onClick={openAddTransaction}>Add transaction</button>}
      />

      <div className="toolbar">
        <label className="grow">
          <span className="sr-only">Search payee or memo</span>
          <input type="search" value={filter.text} onChange={(e) => patch({ text: e.target.value })} placeholder="Search payee or memo" />
        </label>
        <label>
          <span className="sr-only">Date</span>
          <select value={preset} onChange={(e) => { const p = e.target.value as DatePreset | 'custom'; setPreset(p); if (p === 'custom') setPanel(true); else patch(presetRange(p, todayISO())); }}>
            {PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <details className="pick">
          <summary>{filter.accountIds.length ? `Accounts (${filter.accountIds.length})` : 'All accounts'}</summary>
          <div className="pick-pop">
            {accounts.map((a) => (
              <label className="chk" key={a.id}><input type="checkbox" checked={filter.accountIds.includes(a.id!)} onChange={() => patch({ accountIds: toggleList(filter.accountIds, a.id!) })} />{a.name}</label>
            ))}
            {accounts.length === 0 && <div className="muted" style={{ padding: 8 }}>No accounts yet.</div>}
          </div>
        </details>
        <button className="filter-btn" aria-expanded={panel} aria-controls="txn-filter-panel" onClick={() => setPanel(!panel)}>
          Filters {chips.length > 0 && <span className="count">{chips.length}</span>}
        </button>
        <label className="sort-sm">
          <span className="sr-only">Sort by</span>
          <select value={`${sort.key}:${sort.dir}`} onChange={(e) => { const [key, dir] = e.target.value.split(':'); setSort({ key: key as SortKey, dir: dir as 'asc' | 'desc' }); }}>
            {COLS.flatMap((c) => [
              <option key={`${c.key}:asc`} value={`${c.key}:asc`}>Sort: {c.label} ↑</option>,
              <option key={`${c.key}:desc`} value={`${c.key}:desc`}>Sort: {c.label} ↓</option>,
            ])}
          </select>
        </label>
      </div>

      {panel && (
        <TxnFilterPanel id="txn-filter-panel" filter={filter} patch={patch} setPreset={setPreset} categories={categories} groups={groups}>
      <div>
        <h3>Saved filters</h3>
        <div className="row">
          <select
            aria-label="Apply a saved filter"
            value=""
            onChange={(e) => {
              const f = saved.find((x) => x.id === e.target.value);
              if (!f) return;
              setPreset('custom');
              setFilter(f.filter);
              setSortState(f.sort);
            }}
          >
            <option value="">{saved.length ? 'Apply a saved filter…' : 'None saved yet'}</option>
            {saved.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <input aria-label="Name for this filter" placeholder="Name this filter" value={saveName} onChange={(e) => setSaveName(e.target.value)} />
          <button
            disabled={!saveName.trim()}
            onClick={async () => { await saveFilter(db, saveName, filter, sort); toast(`Saved filter “${saveName.trim()}”.`); setSaveName(''); }}
          >Save current filter</button>
          {saved.length > 0 && (
            <select aria-label="Delete a saved filter" value="" onChange={async (e) => { const f = saved.find((x) => x.id === e.target.value); if (f && confirm(`Delete saved filter "${f.name}"?`)) await deleteSavedFilter(db, f.id); }}>
              <option value="">Delete a saved filter…</option>
              {saved.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          )}
        </div>
      </div>
        </TxnFilterPanel>
      )}

      <FilterChips chips={chips} onClearAll={clearAll} />

      <div className="tiles">
        <div className="tile"><div className="muted">Showing</div><div className="v">{tot.count.toLocaleString()}</div></div>
        <div className="tile"><div className="muted">Money out</div><div className="v neg">{formatCents(tot.outCents)}</div></div>
        <div className="tile"><div className="muted">Money in</div><div className="v pos">{signedCents(tot.inCents)}</div></div>
        <div className="tile"><div className="muted">Net</div><div className={`v ${tot.netCents < 0 ? 'neg' : 'pos'}`}>{signedCents(tot.netCents)}</div></div>
      </div>
      {tot.transfers > 0 && <p className="muted">Totals include {tot.transfers} transfer row(s), which move money between your own accounts. Use “Hide transfers” to leave them out.</p>}

      {selIds.length > 0 && (
        <div className="card bulk">
          <div className="row">
            <strong>{selIds.length} selected</strong>
            <select aria-label="Set category" value={bulkCat} onChange={(e) => setBulkCat(e.target.value)}>
              <option value="">Set category…</option>
              <option value="none">Uncategorized</option>
              {groups.map((g) => (
                <optgroup key={g.id} label={g.name}>
                  {categories.filter((c) => c.groupId === g.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
              ))}
            </select>
            <button disabled={!bulkCat} onClick={() => doBulk('category')}>Apply category</button>
            <select aria-label="Set status" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
              <option value="">Set status…</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button disabled={!bulkStatus} onClick={setBulkStatusWithUndo}>Apply status</button>
            <button className="danger" onClick={() => doBulk('delete')}>Delete selected</button>
            <button className="link" onClick={() => setSel(new Set())}>Clear selection</button>
          </div>
        </div>
      )}

      {editing && accountOf(editing) && (
        <TxnForm
          key={editing.id}
          account={accountOf(editing)!}
          editing={editing}
          otherAccountId={editing.transferTxnId ? txns.find((t) => t.id === editing.transferTxnId)?.accountId : undefined}
          onDone={() => setEditing(null)}
        />
      )}

      <ColumnBoxes filter={filter} patch={patch} />
      <div className="txn-wrap">
        <table className="txn-table">
          <thead>
            <tr>
              <th className="c-sel">
                <input
                  type="checkbox"
                  aria-label="Select all on this page"
                  checked={allPageSelected}
                  onChange={() => { const n = new Set(sel); pageRows.forEach((r) => (allPageSelected ? n.delete(r.txn.id!) : n.add(r.txn.id!))); setSel(n); }}
                />
              </th>
              {COLS.map((c) => (
                <th key={c.key} className={`c-${c.key === 'account' ? 'acct' : c.key === 'category' ? 'cat' : c.key === 'amount' ? 'amt' : c.key} ${c.cls ?? ''}`} aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button className="collapse-btn" onClick={() => clickSort(c.key, c.first)} title={`Sort by ${c.label.toLowerCase()}`}>
                    {c.label} <span aria-hidden="true">{sort.key === c.key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
                  </button>
                </th>
              ))}
              <th className="c-status">Status</th>
              <th className="c-act"><span className="sr-only">Actions</span></th>
            </tr>
            <ColumnFilterRow filter={filter} patch={patch} variant="all" />
          </thead>
          <tbody>
            {pageRows.map(({ txn: t, accountName, categoryLabel }) => (
              <Fragment key={t.id}>
              <tr className={sel.has(t.id!) ? 'selected' : ''}>
                <td className="c-sel"><input type="checkbox" aria-label={`Select ${t.payee || 'transaction'}`} checked={sel.has(t.id!)} onChange={() => toggle(t.id!)} /></td>
                <td className="c-date">{t.date}</td>
                <td className="c-acct">{accountName}</td>
                <td className="c-payee">
                  {t.payee || <span className="muted">(no payee)</span>}
                  {t.memo && <span className="sub">{t.memo}</span>}
                  <span className="sub show-sm">{t.date} · {accountName} · {categoryLabel}{t.status !== 'cleared' ? ` · ${t.status}` : ''}</span>
                  {t.splits?.length ? <SplitToggle className="show-sm" open={openSplits.has(t.id!)} onToggle={() => toggleSplit(t.id!)}>Show split amounts</SplitToggle> : null}
                </td>
                <td className="c-cat">{t.splits?.length ? <SplitToggle open={openSplits.has(t.id!)} onToggle={() => toggleSplit(t.id!)}>{categoryLabel}</SplitToggle> : categoryLabel === 'Uncategorized' ? <span className="muted">{categoryLabel}</span> : categoryLabel}</td>
                <td className={`num c-amt ${t.amountCents < 0 ? 'neg' : 'pos'}`}>{signedCents(t.amountCents)}</td>
                <td className="c-status"><span className={`badge ${t.status}`}>{t.status}</span></td>
                <td className="c-act">
                  <button className="link" onClick={() => { setEditing(t); window.scrollTo({ top: 0 }); }}>Edit</button>
                  <button
                    className="link danger"
                    onClick={() => confirm(t.transferTxnId ? 'Delete this transfer? The matching entry on the other account is deleted too.' : 'Delete this transaction?') && deleteTxn(db, t.id!)}
                  >Delete</button>
                </td>
              </tr>
              {t.splits?.length && openSplits.has(t.id!) ? <SplitDetailRow txn={t} catName={catName} variant="all" /> : null}
              </Fragment>
            ))}
            {txnsLoaded === undefined && [0, 1, 2, 3, 4].map((i) => (
              <tr key={`sk${i}`} aria-hidden="true"><td colSpan={8}><div className="skeleton" /></td></tr>
            ))}
            {txnsLoaded !== undefined && pageRows.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: 0 }}>
                  {txns.length === 0 ? (
                    <EmptyState title="No transactions yet" action={<div className="row"><button className="primary" onClick={openAddTransaction}>Add a transaction</button><Link className="btn" to="/import">Import a bank file</Link></div>}>Add one by hand, or import a CSV from your bank.</EmptyState>
                  ) : (
                    <EmptyState title="Nothing matches these filters" action={<button onClick={clearAll}>Clear all filters</button>}>Try a wider date range or fewer filters.</EmptyState>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="page-foot">
        <div className="row">
          <button disabled={sorted.length === 0} onClick={() => download(`transactions-${todayISO()}.csv`, toCsv(sorted, categories))}>Export {sorted.length.toLocaleString()} to CSV</button>
          <label className="row">Per page
            <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}>
              {[50, 100, 250, 500].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
        <div className="row">
          <button disabled={cur === 0} onClick={() => setPage(cur - 1)}>‹ Prev</button>
          <span>Page {cur + 1} of {pages}</span>
          <button disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next ›</button>
        </div>
      </div>
      {sorted.length > pageRows.length && (
        <p className="muted">
          Showing {pageRows.length} of {sorted.length.toLocaleString()} matching.{' '}
          <button className="link" onClick={() => setSel(new Set(sorted.map((r) => r.txn.id!)))}>Select all {sorted.length.toLocaleString()} matching</button>
        </p>
      )}
    </>
  );
}
