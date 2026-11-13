import { Fragment, useEffect, useMemo, useState } from 'react';
import { txnRowLabel } from '../lib/a11yLabels';
import { Link } from '../core/router';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSearchParams } from 'react-router-dom';
import { db } from '../db';
import type { Txn, TxnStatus } from '../types';
import { formatCents, todayISO } from '../lib/money';
import TxnDeleteDialog from './TxnDeleteDialog';
import ConfirmDialog from '../shell/ConfirmDialog';
import {
  DEFAULT_SORT, EMPTY_FILTER, applyFilter, buildRows, presetRange, sortRows, toCsv, totals, visibleSelection,
  type DatePreset, type Sort, type SortKey, type TxnFilter,
} from '../lib/txnQuery';
import { bulkSetCategory, bulkSetStatus, deleteSavedFilter, listSavedFilters, saveFilter } from '../lib/txnBulk';
import { EmptyState, PageHeader, signedCents } from '../ui/components';
import { useToast } from '../ui/Toast';
import { openAddTransaction } from '../shell/QuickAdd';
import { ColumnBoxes, ColumnFilterRow, FilterChips, PRESETS, STATUSES, TxnFilterPanel, filterChips, toggleList } from './TxnFilterUi';
import TxnForm from './TxnForm';
import BulkProject from './BulkProject';
import { projectLabel, useProjectChoices } from '../core/projectLink';
import { SplitDetailRow, SplitToggle } from './SplitDetail';
import { StatusChip } from '../ui/StatusChip';
import { Figure } from '../ui/Figure';
import { STATUS_HELP, STATUS_WORD, statusTone } from './moneyPresentation';
import RowActions from './RowActions';
import './money.css';

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

  const [searchParams, setSearchParams] = useSearchParams();
  const projectChoices = useProjectChoices();
  const startText = searchParams.get('q') ?? '';
  const startProject = Number(searchParams.get('project')) || undefined;
  const startTxn = Number(searchParams.get('txn')) || undefined;
  const [filter, setFilterState] = useState<TxnFilter>(() => ({ ...EMPTY_FILTER, text: startText }));
  const [sort, setSortState] = useState<Sort>(DEFAULT_SORT);
  const [preset, setPreset] = useState<DatePreset | 'custom'>('all');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<Txn | null>(null);
  /** The delete confirmation: one transaction, or the whole selection. */
  const [deleting, setDeleting] = useState<{ ids: number[]; subject: 'transaction' | 'selection' } | null>(null);
  const [bulkCat, setBulkCat] = useState('');
  // D20.1B (NC-35, NC-36): the bulk category change, and the saved filter (by id), waiting for the dialog's own button.
  const [askCat, setAskCat] = useState<{ ids: number[]; categoryId: number | null; label: string } | null>(null);
  const [askFilter, setAskFilter] = useState<string | null>(null);
  const askFilterRow = askFilter === null ? undefined : saved.find((x) => x.id === askFilter);
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

  // Arriving from a project (#/ledger/transactions?project=3): show just that project's transactions, then tidy the address.
  useEffect(() => {
    if (startProject === undefined) return;
    setFilterState((f) => ({ ...f, projectId: startProject })); setPage(0);
    const next = new URLSearchParams(searchParams); next.delete('project'); setSearchParams(next, { replace: true });
  }, [startProject]); // eslint-disable-line react-hooks/exhaustive-deps
  // ...or to one transaction (#/ledger/transactions?txn=42): open it for viewing and editing, as if its row had been clicked.
  useEffect(() => {
    if (startTxn === undefined || !txnsLoaded) return;
    const t = txnsLoaded.find((x) => x.id === startTxn);
    if (t) setEditing(t);
    const next = new URLSearchParams(searchParams); next.delete('txn'); setSearchParams(next, { replace: true });
  }, [startTxn, txnsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

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
      setDeleting({ ids: selIds, subject: 'selection' });
    } else if (kind === 'category') {
      // NC-35: only remembers what was chosen (the rows by id, the category by id). Nothing is written until the dialog's own button is pressed.
      const label = bulkCat === 'none' ? 'Uncategorized' : categories.find((c) => String(c.id) === bulkCat)?.name ?? '';
      setAskCat({ ids: selIds, categoryId: bulkCat === 'none' ? null : Number(bulkCat), label });
    }
  }
  /** NC-35, on confirm: the same bulk change as before. The category is checked again first, so a category deleted while the question was open cannot leave rows pointing at nothing. */
  async function applyBulkCategory(a: { ids: number[]; categoryId: number | null }) {
    if (a.categoryId !== null && !(await db.categories.get(a.categoryId))) throw new Error('That category no longer exists. Nothing was changed. Choose a category again.');
    const r = await bulkSetCategory(db, a.ids, a.categoryId);
    toast(`Updated ${r.updated} transaction${r.updated === 1 ? '' : 's'}.${r.skippedTransfers ? ` Skipped ${r.skippedTransfers} transfer(s).` : ''}${r.splitsCleared ? ` Replaced ${r.splitsCleared} split(s).` : ''}`);
    setBulkCat('');
    setSel(new Set());
    setAskCat(null);
  }

  const accountOf = (t: Txn) => accounts.find((a) => a.id === t.accountId);

  // What is filtering the list, as removable chips. The search box shows its own text, so it gets no chip.
  const chips = filterChips(filter, patch, setPreset, (f) => (f.accountIds.length ? (f.accountIds.length === 1 ? accounts.find((a) => a.id === f.accountIds[0])?.name ?? '1 account' : `${f.accountIds.length} accounts`) : null), (id) => projectLabel(projectChoices, id));
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
    <div className="mny-page mny-txns">
      <PageHeader
        title="Transactions"
        description={`Every transaction from every account in one place. ${txns.length.toLocaleString()} across ${accounts.length} account${accounts.length === 1 ? '' : 's'}.`}
        actions={<button className="primary" onClick={openAddTransaction}>Add transaction</button>}
      />

      <div className="toolbar mny-toolbar">
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
        <TxnFilterPanel id="txn-filter-panel" filter={filter} patch={patch} setPreset={setPreset} categories={categories} groups={groups} projects={projectChoices.map((p) => ({ id: p.id, name: projectLabel(projectChoices, p.id) }))}>
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
            <select aria-label="Delete a saved filter" value="" onChange={(e) => { const f = saved.find((x) => x.id === e.target.value); if (f) setAskFilter(f.id); }}>
              <option value="">Delete a saved filter…</option>
              {saved.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          )}
        </div>
      </div>
        </TxnFilterPanel>
      )}

      <FilterChips chips={chips} onClearAll={clearAll} />

      {/* The same four totals as before (the same totals() function over the filtered rows), now one band. Money out and in keep their sign words; none is recomputed here. */}
      <div className="card ui-band mny-band" role="group" aria-label="Totals for the transactions shown">
        <Figure label="Showing" value={tot.count.toLocaleString()} description="transactions" />
        <Figure label="Money out" value={formatCents(tot.outCents)} tone="bad" />
        <Figure label="Money in" value={signedCents(tot.inCents)} tone="good" />
        <Figure label="Net" value={signedCents(tot.netCents)} />
      </div>
      {tot.transfers > 0 && <p className="muted">Totals include {tot.transfers} transfer row(s), which move money between your own accounts. Use “Hide transfers” to leave them out.</p>}

      {selIds.length > 0 && (
        <section className="card bulk mny-bulk" aria-label="Actions for the selected transactions">
          <div className="mny-bulk-row">
            <strong className="mny-bulk-count" role="status">{selIds.length} selected</strong>
            <div className="mny-bulk-group">
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
            </div>
            <div className="mny-bulk-group">
              <select aria-label="Set status" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
                <option value="">Set status…</option>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button disabled={!bulkStatus} onClick={setBulkStatusWithUndo}>Apply status</button>
            </div>
            <div className="mny-bulk-group mny-bulk-end">
              <button className="danger" onClick={() => doBulk('delete')}>Delete selected</button>
              <button className="link" onClick={() => setSel(new Set())}>Clear selection</button>
            </div>
          </div>
          <BulkProject ids={selIds} txns={txns} onDone={() => setSel(new Set())} />
        </section>
      )}

      {askCat && (() => {
        const rows = askCat.ids.map((id) => txns.find((t) => t.id === id)).filter((t): t is Txn => !!t);
        const transfers = rows.filter((t) => t.transferTxnId).length;
        const splits = rows.filter((t) => !t.transferTxnId && t.splits?.length).length;
        return (
          <ConfirmDialog
            title="Change category?"
            confirmLabel="Change category"
            busyLabel="Changing…"
            kind="replace"
            onCancel={() => setAskCat(null)}
            onConfirm={() => applyBulkCategory(askCat)}
          >
            <p>Set the category to <strong>{askCat.label}</strong> on {askCat.ids.length} selected transaction{askCat.ids.length === 1 ? '' : 's'}?</p>
            <p>Split transactions are replaced by this single category{splits ? ` (${splits} selected ${splits === 1 ? 'is a split' : 'are splits'})` : ''}. Transfers are skipped{transfers ? ` (${transfers} selected ${transfers === 1 ? 'is a transfer' : 'are transfers'})` : ''}.</p>
          </ConfirmDialog>
        );
      })()}

      {askFilterRow && (
        <ConfirmDialog
          title="Delete saved filter?"
          confirmLabel="Delete filter"
          busyLabel="Deleting…"
          onCancel={() => setAskFilter(null)}
          onConfirm={async () => { await deleteSavedFilter(db, askFilterRow.id); setAskFilter(null); }}
        >
          <p><strong>{askFilterRow.name}</strong></p>
          <p>This removes the saved filter from the list. Your transactions are not changed.</p>
        </ConfirmDialog>
      )}

      {deleting && (
        <TxnDeleteDialog
          ids={deleting.ids}
          subject={deleting.subject}
          onClose={() => setDeleting(null)}
          onDeleted={(n) => { toast(`Deleted ${n} transaction${n === 1 ? '' : 's'}.`); if (deleting.subject === 'selection') setSel(new Set()); setDeleting(null); }}
        />
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
                <td className="c-sel"><label className="mny-selhit"><input type="checkbox" aria-label={txnRowLabel('Select', t.payee, t.date)} checked={sel.has(t.id!)} onChange={() => toggle(t.id!)} /></label></td>
                <td className="c-date">{t.date}</td>
                <td className="c-acct">{accountName}</td>
                <td className="c-payee">
                  <span className="mny-nameline">
                    <span className="mny-payee">{t.payee || <span className="muted">(no payee)</span>}</span>
                    {t.transferTxnId ? <> <StatusChip tone="info" icon={false}>Transfer</StatusChip></> : null}
                    <span className="show-sm mny-flag"> <StatusChip tone={statusTone(t.status)} icon={false}>{STATUS_WORD[t.status]}</StatusChip></span>
                  </span>
                  <span className="mny-metaline">
                    {t.memo && <span className="sub">{t.memo}</span>}
                    <span className="sub show-sm">{t.date} · {accountName} · {categoryLabel}</span>
                    {t.splits?.length ? <SplitToggle className="show-sm" open={openSplits.has(t.id!)} onToggle={() => toggleSplit(t.id!)}>Show split amounts</SplitToggle> : null}
                  </span>
                </td>
                <td className="c-cat">{t.splits?.length ? <SplitToggle open={openSplits.has(t.id!)} onToggle={() => toggleSplit(t.id!)}>{categoryLabel}</SplitToggle> : categoryLabel === 'Uncategorized' ? <span className="muted">{categoryLabel}</span> : categoryLabel}</td>
                <td className={`num c-amt ${t.amountCents < 0 ? 'neg' : 'pos'}`}>{signedCents(t.amountCents)}</td>
                <td className="c-status"><span title={STATUS_HELP[t.status]}><StatusChip tone={statusTone(t.status)} icon={false}>{STATUS_WORD[t.status]}</StatusChip></span></td>
                <td className="c-act">
                  <RowActions label={`${t.payee || 'transaction'}, ${t.date}`}>
                    <button className="link" aria-label={txnRowLabel('Edit', t.payee, t.date)} onClick={() => { setEditing(t); window.scrollTo({ top: 0 }); }}>Edit</button>
                    <button
                      className="link danger"
                      aria-label={txnRowLabel('Delete', t.payee, t.date)}
                      onClick={() => setDeleting({ ids: [t.id!], subject: 'transaction' })}
                    >Delete</button>
                  </RowActions>
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
    </div>
  );
}
