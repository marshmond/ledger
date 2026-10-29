import type { ReactNode } from 'react';
import type { Category, CategoryGroup, TxnStatus } from '../types';
import { formatCents } from '../lib/money';
import type { AmountOp, CatSel, DatePreset, TxnFilter } from '../lib/txnQuery';
import { MoneyField } from './fields';

/** Filter screens shared by the Transactions tab and each account's own page. */

export const PRESETS: [DatePreset | 'custom', string][] = [
  ['all', 'All time'], ['thisMonth', 'This month'], ['lastMonth', 'Last month'], ['last30', 'Last 30 days'],
  ['last90', 'Last 90 days'], ['thisYear', 'This year'], ['lastYear', 'Last year'], ['custom', 'Custom range'],
];
export const STATUSES: TxnStatus[] = ['pending', 'cleared', 'reconciled'];

export const toggleList = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

export function amountLabel(f: TxnFilter): string {
  const a = formatCents(f.amountA);
  switch (f.amountOp) {
    case 'gt': return `Amount over ${a}`;
    case 'lt': return `Amount under ${a}`;
    case 'eq': return `Amount = ${a}`;
    case 'between': return `Amount ${a} to ${formatCents(f.amountB)}`;
    default: return '';
  }
}

export interface Chip { key: string; label: string; clear: () => void }

/** What is filtering the list, as removable chips. The search box and column boxes show their own text, so they get none. */
export function filterChips(
  filter: TxnFilter,
  patch: (p: Partial<TxnFilter>) => void,
  setPreset: (p: DatePreset | 'custom') => void,
  accountLabel?: (f: TxnFilter) => string | null,
): Chip[] {
  const chips: Chip[] = [];
  const acct = accountLabel?.(filter);
  if (acct) chips.push({ key: 'acct', label: acct, clear: () => patch({ accountIds: [] }) });
  if (filter.from || filter.to) chips.push({ key: 'date', label: `${filter.from || 'start'} to ${filter.to || 'today'}`, clear: () => { setPreset('all'); patch({ from: '', to: '' }); } });
  if (filter.categories.length) chips.push({ key: 'cat', label: filter.categories.length === 1 ? 'Category: 1' : `Categories: ${filter.categories.length}`, clear: () => patch({ categories: [] }) });
  if (filter.amountOp !== 'any') chips.push({ key: 'amt', label: amountLabel(filter), clear: () => patch({ amountOp: 'any', amountA: 0, amountB: 0 }) });
  if (filter.statuses.length) chips.push({ key: 'status', label: `Status: ${filter.statuses.join(', ')}`, clear: () => patch({ statuses: [] }) });
  if (filter.hideTransfers) chips.push({ key: 'xfer', label: 'Transfers hidden', clear: () => patch({ hideTransfers: false }) });
  if (filter.uncategorizedOnly) chips.push({ key: 'uncat', label: 'Uncategorized only', clear: () => patch({ uncategorizedOnly: false }) });
  if (filter.pendingOnly) chips.push({ key: 'pend', label: 'Pending only', clear: () => patch({ pendingOnly: false }) });
  return chips;
}

export function FilterChips({ chips, onClearAll }: { chips: Chip[]; onClearAll: () => void }) {
  if (chips.length === 0) return null;
  return (
    <div className="chips" aria-label="Active filters">
      {chips.map((c) => (
        <span className="chip" key={c.key}>{c.label}<button aria-label={`Remove filter: ${c.label}`} onClick={c.clear}>×</button></span>
      ))}
      <button className="link" onClick={onClearAll}>Clear all</button>
    </div>
  );
}

export function TxnFilterPanel({ id, filter, patch, setPreset, categories, groups, children }: {
  id: string;
  filter: TxnFilter;
  patch: (p: Partial<TxnFilter>) => void;
  setPreset: (p: DatePreset | 'custom') => void;
  categories: Category[];
  groups: CategoryGroup[];
  /** Extra sections below "Show only" (the Transactions tab adds saved filters). */
  children?: ReactNode;
}) {
  return (
    <div className="filter-panel" id={id}>
      <div className="grid">
        <details className="pick">
          <summary>{filter.categories.length ? `Categories (${filter.categories.length})` : 'All categories'}</summary>
          <div className="pick-pop">
            <label className="chk"><input type="checkbox" checked={filter.categories.includes('uncategorized')} onChange={() => patch({ categories: toggleList<CatSel>(filter.categories, 'uncategorized') })} />Uncategorized</label>
            <label className="chk"><input type="checkbox" checked={filter.categories.includes('transfer')} onChange={() => patch({ categories: toggleList<CatSel>(filter.categories, 'transfer') })} />Transfers</label>
            {groups.map((g) => (
              <div key={g.id}>
                <div className="grp">{g.name}</div>
                {categories.filter((c) => c.groupId === g.id).map((c) => (
                  <label className="chk" key={c.id}><input type="checkbox" checked={filter.categories.includes(c.id!)} onChange={() => patch({ categories: toggleList<CatSel>(filter.categories, c.id!) })} />{c.name}</label>
                ))}
              </div>
            ))}
          </div>
        </details>
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

      <div>
        <h3>Show only</h3>
        <div className="row">
          {STATUSES.map((s) => (
            <label className="chk" key={s}><input type="checkbox" checked={filter.statuses.includes(s)} onChange={() => patch({ statuses: toggleList(filter.statuses, s) })} />{s}</label>
          ))}
          <label className="chk"><input type="checkbox" checked={filter.uncategorizedOnly} onChange={(e) => patch({ uncategorizedOnly: e.target.checked })} />Uncategorized only</label>
          <label className="chk"><input type="checkbox" checked={filter.pendingOnly} onChange={(e) => patch({ pendingOnly: e.target.checked })} />Pending only</label>
          <label className="chk"><input type="checkbox" checked={filter.hideTransfers} onChange={(e) => patch({ hideTransfers: e.target.checked })} />Hide transfers</label>
        </div>
      </div>
      {children}
    </div>
  );
}

type ColKey = 'colDate' | 'colPayee' | 'colCategory' | 'colAmount';
const BOXES: { key: ColKey; label: string; placeholder: string; cls: string; inputMode?: 'decimal' }[] = [
  { key: 'colDate', label: 'date', placeholder: '2026-03', cls: 'c-date' },
  { key: 'colPayee', label: 'payee', placeholder: 'Contains…', cls: 'c-payee' },
  { key: 'colCategory', label: 'category', placeholder: 'Contains…', cls: 'c-cat' },
  { key: 'colAmount', label: 'amount', placeholder: '45 or >100', cls: 'num c-amt' },
];

/**
 * The row of type-to-filter boxes under the column headers (computer screens, where the header shows).
 * The Transactions tab (variant all) has checkbox, Account and Status columns around them; an account page does not.
 */
export function ColumnFilterRow({ filter, patch, variant }: { filter: TxnFilter; patch: (p: Partial<TxnFilter>) => void; variant: 'all' | 'account' }) {
  const box = (b: (typeof BOXES)[number]) => (
    <th key={b.key} className={`${b.cls} col-filter`}>
      <input type="search" aria-label={`Filter by ${b.label}`} placeholder={b.placeholder} value={filter[b.key] ?? ''} onChange={(e) => patch({ [b.key]: e.target.value })} />
    </th>
  );
  const [date, payee, cat, amt] = BOXES.map(box);
  return variant === 'all' ? (
    <tr className="col-filters">
      <th className="c-sel" />{date}<th className="c-acct hide-sm" />{payee}{cat}{amt}<th className="c-status" /><th className="c-act" />
    </tr>
  ) : (
    <tr className="col-filters">
      {date}{payee}{cat}{amt}<th className="c-cat" /><th className="c-act" />
    </tr>
  );
}

/** The same four boxes as a small block above the list on phones, where the table header is hidden. */
export function ColumnBoxes({ filter, patch }: { filter: TxnFilter; patch: (p: Partial<TxnFilter>) => void }) {
  return (
    <div className="col-boxes show-sm">
      {BOXES.map((b) => (
        <label className="f" key={b.key}>{b.label[0].toUpperCase() + b.label.slice(1)}
          <input type="search" aria-label={`Filter by ${b.label}`} placeholder={b.placeholder} value={filter[b.key] ?? ''} onChange={(e) => patch({ [b.key]: e.target.value })} />
        </label>
      ))}
    </div>
  );
}
