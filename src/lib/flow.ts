import type { Account, Category, CategoryGroup, Txn } from '../types';
import { allocations } from './ledger';
import type { PersonYear } from './payroll';
import { SETUP_CATEGORY_ID, isSetupAlloc } from './setupCategory';

/**
 * Where the money came from and where it went, as a flow diagram (a Sankey). Pure: builds the nodes and links; layout is in flowLayout.ts.
 *
 * Net view (from your accounts):  income categories -> Income -> spending groups -> categories, plus what was left over.
 * Gross view (from your Income setup): pay -> Gross pay -> taxes, deductions, and Take-home pay -> spending -> what was left over.
 *
 * Counted as spending: every expense category, and the principal part of loan, mortgage, and HELOC payments (recorded as transfers to the loan's
 * account). Left out: other transfers (to savings, investments) and credit card payments, because the spending on the card is already counted.
 */

export type FlowDetail = 'groups' | 'categories';

export interface PaySummary {
  sources: { label: string; cents: number }[];
  fed: number;
  fica: number;
  state: number;
  deductions: { label: string; cents: number }[];
}

export interface FlowInput {
  txns: Txn[];
  accounts: Account[];
  categories: Category[];
  groups: CategoryGroup[];
  /** Both ends inclusive. */
  start: string;
  end: string;
  /** Only these accounts (null or missing = all). */
  accountIds?: Set<number> | null;
  /** Filter keys switched off (see `catKey`, UNCATEGORIZED, LOAN_PRINCIPAL, OTHER_INCOME). */
  off?: Set<string>;
  detail: FlowDetail;
  /** Show entries filed under Initial setup (balances entered to get started). Left out unless asked for. */
  includeSetup?: boolean;
  /** When given, draws the gross view with this pay. */
  pay?: PaySummary | null;
}

export interface FlowNode {
  id: string;
  label: string;
  col: number;
  color: string;
}
export interface FlowLink {
  source: string;
  target: string;
  value: number;
  color: string;
}
export interface FlowGraph {
  nodes: FlowNode[];
  links: FlowLink[];
  /** Total in (income, or take-home pay in the gross view), total spending, and what remains (negative = drawn from savings). */
  income: number;
  spending: number;
  left: number;
  /** Something is switched off, so "left over" is not the true amount saved. */
  filtered: boolean;
  mode: 'net' | 'gross';
  empty: boolean;
}

export const UNCATEGORIZED = 'unc';
export const LOAN_PRINCIPAL = 'loan';
export const OTHER_INCOME = 'uin';
export const SETUP_IN = 'setup-in';
export const SETUP_OUT = 'setup-out';
export const catKey = (id: number) => `c${id}`;

const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
const IN = 'var(--pos)';
const TAX = 'var(--neg)';
const DED = 'var(--warn)';
const KEPT = 'var(--accent)';

interface Entry {
  label: string;
  group: string;
  groupLabel: string;
  cents: number;
}

function aggregate(i: FlowInput) {
  const catById = new Map(i.categories.map((c) => [c.id!, c]));
  const groupName = new Map(i.groups.map((g) => [g.id!, g.name]));
  const acctKind = new Map(i.accounts.map((a) => [a.id!, a.kind]));
  const txnById = new Map(i.txns.map((t) => [t.id!, t]));
  const income = new Map<string, Entry>();
  const spend = new Map<string, Entry>();
  const add = (m: Map<string, Entry>, key: string, e: Omit<Entry, 'cents'>, cents: number) => {
    const cur = m.get(key);
    if (cur) cur.cents += cents;
    else m.set(key, { ...e, cents });
  };

  for (const t of i.txns) {
    if (t.date < i.start || t.date > i.end) continue;
    if (i.accountIds && !i.accountIds.has(t.accountId)) continue;
    if (t.transferTxnId) {
      // Paying down a loan is money spent on it; every other transfer (cards, savings, investments) is just money moving.
      const other = txnById.get(t.transferTxnId);
      if (t.amountCents < 0 && other && acctKind.get(other.accountId) === 'loan' && acctKind.get(t.accountId) !== 'loan') {
        add(spend, LOAN_PRINCIPAL, { label: 'Loan principal', group: LOAN_PRINCIPAL, groupLabel: 'Loan principal' }, -t.amountCents);
      }
      continue;
    }
    for (const s of allocations(t)) {
      if (isSetupAlloc(s)) {
        if (!i.includeSetup) continue;
        if (s.amountCents > 0) add(income, SETUP_IN, { label: 'Initial setup (money in)', group: '', groupLabel: '' }, s.amountCents);
        else add(spend, SETUP_OUT, { label: 'Initial setup (money out)', group: SETUP_OUT, groupLabel: 'Initial setup' }, -s.amountCents);
        continue;
      }
      const cat = s.categoryId == null ? undefined : catById.get(s.categoryId);
      if (cat?.kind === 'income') add(income, catKey(cat.id!), { label: cat.name, group: '', groupLabel: '' }, s.amountCents);
      else if (!cat && s.amountCents > 0) add(income, OTHER_INCOME, { label: 'Other income (uncategorized)', group: '', groupLabel: '' }, s.amountCents);
      else if (cat) {
        const gl = (cat.groupId != null && groupName.get(cat.groupId)) || 'Other';
        add(spend, catKey(cat.id!), { label: cat.name, group: `g${cat.groupId ?? 'x'}`, groupLabel: gl }, -s.amountCents);
      } else add(spend, UNCATEGORIZED, { label: 'Uncategorized', group: UNCATEGORIZED, groupLabel: 'Uncategorized' }, -s.amountCents);
    }
  }
  return { income, spend };
}

const byCents = <T extends { cents: number }>(a: T, b: T) => b.cents - a.cents;

export function buildFlow(i: FlowInput): FlowGraph {
  const off = i.off ?? new Set<string>();
  const { income, spend } = aggregate(i);
  const filtered = off.size > 0 || (!!i.accountIds && i.accountIds.size < i.accounts.length);
  const nodes: FlowNode[] = [];
  const links: FlowLink[] = [];
  const node = (id: string, label: string, col: number, color: string) => nodes.push({ id, label, col, color });
  const link = (source: string, target: string, value: number, color: string) => value > 0 && links.push({ source, target, value, color });

  // Spending, grouped, biggest first. A category that nets to zero or less (refunds) is left out.
  const groups = new Map<string, { label: string; cents: number; items: [string, Entry][] }>();
  for (const [key, e] of spend) {
    if (off.has(key) || e.cents <= 0) continue;
    const g = groups.get(e.group) ?? { label: e.groupLabel, cents: 0, items: [] };
    g.cents += e.cents;
    g.items.push([key, e]);
    groups.set(e.group, g);
  }
  const groupList = [...groups.entries()].sort((a, b) => b[1].cents - a[1].cents || a[1].label.localeCompare(b[1].label));
  const spending = groupList.reduce((a, [, g]) => a + g.cents, 0);

  const gross = !!i.pay;
  let hub: string;
  let inflow: number;
  let baseCol: number; // the column holding the node that spending flows out of

  if (i.pay) {
    const p = i.pay;
    const sources = p.sources.filter((s) => s.cents > 0);
    const grossPay = sources.reduce((a, s) => a + s.cents, 0);
    node('gross', 'Gross pay', 1, IN);
    sources.forEach((s, k) => {
      node(`src${k}`, s.label, 0, IN);
      link(`src${k}`, 'gross', s.cents, IN);
    });
    const takes: [string, string, number, string][] = [
      ['fed', 'Federal income tax', p.fed, TAX],
      ['fica', 'Social Security & Medicare', p.fica, TAX],
      ['state', 'State tax & family leave', p.state, TAX],
      ...p.deductions.filter((d) => d.cents > 0).map((d, k): [string, string, number, string] => [`ded${k}`, d.label, d.cents, DED]),
    ];
    let taken = 0;
    for (const [id, label, cents, color] of takes) {
      if (cents <= 0) continue;
      node(id, label, 2, color);
      link('gross', id, cents, color);
      taken += cents;
    }
    inflow = Math.max(0, grossPay - taken);
    hub = 'take';
    baseCol = 2;
    node('take', 'Take-home pay', 2, IN);
    link('gross', 'take', inflow, IN);
  } else {
    const inc = [...income.entries()].filter(([k, e]) => !off.has(k) && e.cents > 0).sort((a, b) => byCents(a[1], b[1]));
    inflow = inc.reduce((a, [, e]) => a + e.cents, 0);
    hub = 'income';
    baseCol = 1;
    for (const [k, e] of inc) {
      node(`in-${k}`, e.label, 0, IN);
      link(`in-${k}`, hub, e.cents, IN);
    }
    node(hub, 'Income', 1, IN);
  }

  // If more went out than came in, the difference came from savings.
  const short = Math.max(0, spending - inflow);
  if (short > 0) {
    node('short', 'Drawn from savings', baseCol - 1, DED);
    link('short', hub, short, DED);
  }
  groupList.forEach(([gid, g], gi) => {
    const color = gid === UNCATEGORIZED ? 'var(--muted)' : SERIES[gi % SERIES.length];
    node(`g-${gid}`, g.label, baseCol + 1, color);
    link(hub, `g-${gid}`, g.cents, color);
  });
  const left = inflow - spending;
  if (left > 0) {
    node('left', filtered ? 'Left over' : 'Saved', baseCol + 1, KEPT);
    link(hub, 'left', left, KEPT);
  }
  if (i.detail === 'categories') {
    groupList.forEach(([gid, g], gi) => {
      const color = gid === UNCATEGORIZED ? 'var(--muted)' : SERIES[gi % SERIES.length];
      for (const [k, e] of g.items.sort((a, b) => byCents(a[1], b[1]))) {
        node(`k-${k}`, e.label, baseCol + 2, color);
        link(`g-${gid}`, `k-${k}`, e.cents, color);
      }
    });
  }

  // A node with nothing attached would just be a stray label.
  const used = new Set(links.flatMap((l) => [l.source, l.target]));
  return { nodes: nodes.filter((n) => used.has(n.id)), links, income: inflow, spending, left, filtered, mode: gross ? 'gross' : 'net', empty: links.length === 0 };
}

// ---- pay, for the gross view ----

/** Adds up pay events dated within the range, across everyone. `nameOf` turns a deduction id into its label. */
export function summarizePay(years: PersonYear[], start: string, end: string, nameOf: (id: string) => string): PaySummary {
  const s: PaySummary = { sources: [], fed: 0, fica: 0, state: 0, deductions: [] };
  const src: Record<string, number> = { regular: 0, bonus: 0, rsu: 0 };
  const ded = new Map<string, number>();
  for (const y of years) {
    for (const e of y.events) {
      if (e.date < start || e.date > end) continue;
      src[e.kind] += e.gross;
      s.fed += e.fedWithholding + e.addlMedicare;
      s.fica += e.socialSecurity + e.medicare;
      s.state += e.stateWithholding + e.pfml;
      for (const [id, cents] of Object.entries(e.deductions)) ded.set(nameOf(id), (ded.get(nameOf(id)) ?? 0) + cents);
    }
  }
  s.sources = [
    { label: 'Salary', cents: src.regular },
    { label: 'Bonus', cents: src.bonus },
    { label: 'Stock vests (RSU)', cents: src.rsu },
  ].filter((x) => x.cents > 0);
  s.deductions = [...ded.entries()].map(([label, cents]) => ({ label, cents })).sort(byCents);
  return s;
}

// ---- the category filter list ----

export interface FilterTree {
  income: { key: string; label: string }[];
  groups: { id: string; label: string; items: { key: string; label: string }[] }[];
}

/** Everything that can be switched on or off, grouped the way the budget groups it. */
export function filterTree(categories: Category[], groups: CategoryGroup[]): FilterTree {
  const income = categories.filter((c) => c.kind === 'income').map((c) => ({ key: catKey(c.id!), label: c.name }));
  income.push({ key: OTHER_INCOME, label: 'Other income (uncategorized)' });
  const out: FilterTree['groups'] = [];
  for (const g of groups) {
    const items = categories.filter((c) => c.kind !== 'income' && c.id !== SETUP_CATEGORY_ID && c.groupId === g.id).map((c) => ({ key: catKey(c.id!), label: c.name }));
    if (items.length) out.push({ id: `g${g.id}`, label: g.name, items });
  }
  const loose = categories.filter((c) => c.kind !== 'income' && c.id !== SETUP_CATEGORY_ID && !groups.some((g) => g.id === c.groupId)).map((c) => ({ key: catKey(c.id!), label: c.name }));
  if (loose.length) out.push({ id: 'gx', label: 'Other', items: loose });
  out.push({ id: 'special', label: 'Other spending', items: [{ key: LOAN_PRINCIPAL, label: 'Loan principal' }, { key: UNCATEGORIZED, label: 'Uncategorized' }] });
  return { income, groups: out };
}

/** The flows as table rows: what went from where to where, and its share of what came in. */
export function flowRows(g: FlowGraph): { from: string; to: string; cents: number; share: number }[] {
  const label = new Map(g.nodes.map((n) => [n.id, n.label]));
  return g.links.map((l) => ({ from: label.get(l.source) ?? l.source, to: label.get(l.target) ?? l.target, cents: l.value, share: g.income > 0 ? l.value / g.income : 0 }));
}
