import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Txn, TxnStatus } from '../types';
import { formatCents, todayISO } from '../lib/money';
import { deleteTxn } from '../lib/transfers';
import {
  DEFAULT_SORT, EMPTY_FILTER, activeFilterCount, applyFilter, buildRows, presetRange, sortRows, toCsv, totals, visibleSelection,
  type AmountOp, type CatSel, type DatePreset, type Sort, type SortKey, type TxnFilter,
} from '../lib/txnQuery';
import { bulkDelete, bulkSetCategory, bulkSetStatus, deleteSavedFilter, listSavedFilters, saveFilter } from '../lib/txnBulk';
import Collapsible from './Collapsible';
import { MoneyField } from './fields';
import TxnForm from './TxnForm';

const PRESETS: [DatePreset | 'custom', string][] = [
  ['all', 'All time'], ['thisMonth', 'This month'], ['lastMonth', 'Last month'], ['last30', 'Last 30 days'],
  ['last90', 'Last 90 days'], ['thisYear', 'This year'], ['lastYear', 'Last year'], ['custom', 'Custom range'],
];
const STATUSES: TxnStatus[] = ['pending', 'cleared', 'reconciled'];
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
  const txns = useLiveQuery(() => db.txns.toArray(), []) ?? [];
  const accounts = useLiveQuery(() => db.accounts.toArray(), []) ?? [];
  const categories = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const groups = useLiveQuery(() => db.categoryGroups.toArray(), []) ?? [];
  const saved = useLiveQuery(() => listSavedFilters(db), []) ?? [];

  const [filter, setFilterState] = useState<TxnFilter>(EMPTY_FILTER);
  const [sort, setSortState] = useState<Sort>(DEFAULT_SORT);
  const [preset, setPreset] = useState<DatePreset | 'custom'>('all');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<Txn | null>(null);
  const [bulkCat, setBulkCat] = useState('');
  const [bulkStatus, setBulkStatus] = useState('');
  const [saveName, setSaveName] = useState('');
  const [msg, setMsg] = useState('');
  const narrow = typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches;

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
  const nActive = activeFilterCount(filter);

  const toggle = (id: number) => { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n); };
  const toggleList = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const clickSort = (key: SortKey, first: 'asc' | 'desc') => setSort(sort.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: first });

  async function doBulk(kind: 'category' | 'status' | 'delete') {
    if (selIds.length === 0) return;
    setMsg('');
    if (kind === 'delete') {
      if (!confirm(`Delete ${selIds.length} selected transaction(s)? Deleting one side of a transfer also deletes the other side.`)) return;
      const n = await bulkDelete(db, selIds);
      setMsg(`Deleted ${n} transaction(s).`);
      setSel(new Set());
    } else if (kind === 'category') {
      const label = bulkCat === 'none' ? 'Uncategorized' : categories.find((c) => String(c.id) === bulkCat)?.name ?? '';
      if (!confirm(`Set the category to "${label}" on ${selIds.length} transaction(s)? Split transactions are replaced by this single category; transfers are skipped.`)) return;
      const r = await bulkSetCategory(db, selIds, bulkCat === 'none' ? null : Number(bulkCat));
      setMsg(`Updated ${r.updated} transaction(s).${r.skippedTransfers ? ` Skipped ${r.skippedTransfers} transfer(s).` : ''}${r.splitsCleared ? ` Replaced ${r.splitsCleared} split(s).` : ''}`);
      setBulkCat('');
      setSel(new Set());
    } else {
      const n = await bulkSetStatus(db, selIds, bulkStatus as TxnStatus);
      setMsg(`Marked ${n} transaction(s) ${bulkStatus}.`);
      setBulkStatus('');
      setSel(new Set());
    }
  }

  const accountOf = (t: Txn) => accounts.find((a) => a.id === t.accountId);

  return (
    <>
      <div className="row spread">
        <h1>Transactions</h1>
        <span className="muted">{txns.length.toLocaleString()} total across {accounts.length} account(s)</span>
      </div>

      <Collapsible
        id="tx.filters"
        title={<>Filters {nActive > 0 && <span className="badge">{nActive} active</span>}</>}
        defaultOpen={!narrow}
        right={nActive > 0 ? <button className="link" onClick={() => { setPreset('all'); setFilter(EMPTY_FILTER); }}>clear all filters</button> : undefined}
      >
        <div className="grid">
          <details className="pick">
            <summary>Accounts: {filter.accountIds.length ? `${filter.accountIds.length} selected` : 'all'}</summary>
            {accounts.map((a) => (
              <label className="chk" key={a.id}><input type="checkbox" checked={filter.accountIds.includes(a.id!)} onChange={() => patch({ accountIds: toggleList(filter.accountIds, a.id!) })} />{a.name}</label>
            ))}
          </details>

          <details className="pick">
            <summary>Categories: {filter.categories.length ? `${filter.categories.length} selected` : 'all'}</summary>
            <label className="chk"><input type="checkbox" checked={filter.categories.includes('uncategorized')} onChange={() => patch({ categories: toggleList<CatSel>(filter.categories, 'uncategorized') })} />Uncategorized</label>
            <label className="chk"><input type="checkbox" checked={filter.categories.includes('transfer')} onChange={() => patch({ categories: toggleList<CatSel>(filter.categories, 'transfer') })} />Transfers</label>
            {groups.map((g) => (
              <div key={g.id}>
                <div className="muted" style={{ marginTop: 4 }}>{g.name}</div>
                {categories.filter((c) => c.groupId === g.id).map((c) => (
                  <label className="chk" key={c.id}><input type="checkbox" checked={filter.categories.includes(c.id!)} onChange={() => patch({ categories: toggleList<CatSel>(filter.categories, c.id!) })} />{c.name}</label>
                ))}
              </div>
            ))}
          </details>

          <label className="f">Payee or memo contains
            <input value={filter.text} onChange={(e) => patch({ text: e.target.value })} placeholder="e.g. costco" />
          </label>

          <label className="f">Date
            <select value={preset} onChange={(e) => { const p = e.target.value as DatePreset | 'custom'; setPreset(p); if (p !== 'custom') patch(presetRange(p, todayISO())); }}>
              {PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="f">From<input type="date" value={filter.from} onChange={(e) => { setPreset('custom'); patch({ from: e.target.value }); }} /></label>
          <label className="f">To<input type="date" value={filter.to} onChange={(e) => { setPreset('custom'); patch({ to: e.target.value }); }} /></label>

          <label className="f">Amount
            <select value={filter.amountOp} onChange={(e) => patch({ amountOp: e.target.value as AmountOp })}>
              <option value="any">Any amount</option>
              <option value="gt">Greater than</option>
              <option value="lt">Less than</option>
              <option value="eq">Exactly</option>
              <option value="between">Between</option>
            </select>
          </label>
          {filter.amountOp !== 'any' && (
            <>
              <MoneyField key={`a-${filter.amountOp}`} label={filter.amountOp === 'between' ? 'From amount' : 'Amount'} cents={filter.amountA} onChange={(c) => patch({ amountA: c })} />
              {filter.amountOp === 'between' && <MoneyField key="b" label="To amount" cents={filter.amountB} onChange={(c) => patch({ amountB: c })} />}
              <label className="f">Compare by
                <select value={filter.amountMode} onChange={(e) => patch({ amountMode: e.target.value as 'absolute' | 'signed' })}>
                  <option value="absolute">Size (ignore in/out)</option>
                  <option value="signed">In (+) and out (−) as entered</option>
                </select>
              </label>
            </>
          )}
        </div>

        <div className="row" style={{ marginTop: 8 }}>
          <span className="muted">Status:</span>
          {STATUSES.map((s) => (
            <label className="chk" key={s}><input type="checkbox" checked={filter.statuses.includes(s)} onChange={() => patch({ statuses: toggleList(filter.statuses, s) })} />{s}</label>
          ))}
          <span className="muted" style={{ marginLeft: 8 }}>Quick:</span>
          <label className="chk"><input type="checkbox" checked={filter.uncategorizedOnly} onChange={(e) => patch({ uncategorizedOnly: e.target.checked })} />Uncategorized only</label>
          <label className="chk"><input type="checkbox" checked={filter.pendingOnly} onChange={(e) => patch({ pendingOnly: e.target.checked })} />Pending only</label>
          <label className="chk"><input type="checkbox" checked={filter.hideTransfers} onChange={(e) => patch({ hideTransfers: e.target.checked })} />Hide transfers</label>
        </div>

        <div className="row" style={{ marginTop: 8 }}>
          <label className="row">Saved filters
            <select
              value=""
              onChange={(e) => {
                const f = saved.find((x) => x.id === e.target.value);
                if (!f) return;
                setPreset('custom');
                setFilter(f.filter);
                setSortState(f.sort);
              }}
            >
              <option value="">{saved.length ? 'Choose…' : 'none saved yet'}</option>
              {saved.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
          <input placeholder="Name this filter" value={saveName} onChange={(e) => setSaveName(e.target.value)} />
          <button
            disabled={!saveName.trim()}
            onClick={async () => { await saveFilter(db, saveName, filter, sort); setMsg(`Saved filter "${saveName.trim()}".`); setSaveName(''); }}
          >Save current filter</button>
          {saved.length > 0 && (
            <select value="" onChange={async (e) => { const f = saved.find((x) => x.id === e.target.value); if (f && confirm(`Delete saved filter "${f.name}"?`)) await deleteSavedFilter(db, f.id); }}>
              <option value="">Delete a saved filter…</option>
              {saved.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          )}
        </div>
      </Collapsible>

      <div className="tiles">
        <div className="tile"><div className="muted">Showing</div><div className="v">{tot.count.toLocaleString()}</div></div>
        <div className="tile"><div className="muted">Money out</div><div className="v neg">{formatCents(tot.outCents)}</div></div>
        <div className="tile"><div className="muted">Money in</div><div className="v pos">{formatCents(tot.inCents)}</div></div>
        <div className="tile"><div className="muted">Net</div><div className={`v ${tot.netCents < 0 ? 'neg' : 'pos'}`}>{formatCents(tot.netCents)}</div></div>
      </div>
      {tot.transfers > 0 && <p className="muted">Totals include {tot.transfers} transfer row(s), which move money between your own accounts. Use “Hide transfers” to leave them out.</p>}

      <div className="row spread">
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
          <span className="muted">Page {cur + 1} of {pages}</span>
          <button disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next ›</button>
        </div>
      </div>
      {msg && <p className="ok">{msg}</p>}

      {selIds.length > 0 && (
        <div className="card bulk">
          <div className="row">
            <strong>{selIds.length} selected</strong>
            <select value={bulkCat} onChange={(e) => setBulkCat(e.target.value)}>
              <option value="">Set category…</option>
              <option value="none">Uncategorized</option>
              {groups.map((g) => (
                <optgroup key={g.id} label={g.name}>
                  {categories.filter((c) => c.groupId === g.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
              ))}
            </select>
            <button disabled={!bulkCat} onClick={() => doBulk('category')}>Apply category</button>
            <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
              <option value="">Set status…</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button disabled={!bulkStatus} onClick={() => doBulk('status')}>Apply status</button>
            <button className="danger" onClick={() => doBulk('delete')}>Delete selected</button>
            <button className="link" onClick={() => setSel(new Set())}>clear selection</button>
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

      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 28 }}>
                <input
                  type="checkbox"
                  aria-label="Select all on this page"
                  checked={allPageSelected}
                  onChange={() => { const n = new Set(sel); pageRows.forEach((r) => (allPageSelected ? n.delete(r.txn.id!) : n.add(r.txn.id!))); setSel(n); }}
                />
              </th>
              {COLS.map((c) => (
                <th key={c.key} className={c.cls} aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button className="collapse-btn" onClick={() => clickSort(c.key, c.first)} title={`Sort by ${c.label.toLowerCase()}`}>
                    {c.label} <span aria-hidden="true">{sort.key === c.key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
                  </button>
                </th>
              ))}
              <th className="hide-sm">Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map(({ txn: t, accountName, categoryLabel }) => (
              <tr key={t.id} className={sel.has(t.id!) ? 'selected' : ''}>
                <td><input type="checkbox" aria-label={`Select ${t.payee || 'transaction'}`} checked={sel.has(t.id!)} onChange={() => toggle(t.id!)} /></td>
                <td>{t.date}</td>
                <td className="hide-sm">{accountName}</td>
                <td>
                  {t.payee || <span className="muted">(no payee)</span>}
                  {t.memo && <div className="muted">{t.memo}</div>}
                  <div className="muted show-sm">{accountName} · {categoryLabel}</div>
                </td>
                <td className="hide-sm">{categoryLabel === 'Uncategorized' ? <span className="muted">{categoryLabel}</span> : categoryLabel}</td>
                <td className={`num ${t.amountCents < 0 ? 'neg' : 'pos'}`}>{formatCents(t.amountCents)}</td>
                <td className="hide-sm"><span className={`badge ${t.status}`}>{t.status}</span></td>
                <td>
                  <div className="row">
                    <button className="link" onClick={() => { setEditing(t); window.scrollTo({ top: 0 }); }}>edit</button>
                    <button
                      className="link danger"
                      onClick={() => confirm(t.transferTxnId ? 'Delete this transfer? The matching entry on the other account is deleted too.' : 'Delete this transaction?') && deleteTxn(db, t.id!)}
                    >delete</button>
                  </div>
                </td>
              </tr>
            ))}
            {pageRows.length === 0 && (
              <tr><td colSpan={8} className="muted">{txns.length === 0 ? <>No transactions yet. Add some from an account on the <Link to="/">Accounts</Link> tab, or use Import.</> : 'No transactions match these filters.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {sorted.length > pageRows.length && (
        <p className="muted">
          Showing {pageRows.length} of {sorted.length.toLocaleString()} matching.{' '}
          <button className="link" onClick={() => setSel(new Set(sorted.map((r) => r.txn.id!)))}>select all {sorted.length.toLocaleString()} matching</button>
        </p>
      )}
    </>
  );
}
