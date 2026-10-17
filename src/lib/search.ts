import type { Account, Holding, InvAccount, Loan, PayScenario, Security, Txn } from '../types';
import { ALL_ITEMS } from '../shell/nav';
import { formatCents } from './money';

/** Global search: pages, accounts, investment accounts, holdings, loans, paycheck scenarios, and transactions. All data stays in the browser. */

export interface SearchData {
  accounts: Account[];
  invAccounts: InvAccount[];
  securities: Security[];
  holdings: Holding[];
  loans: Loan[];
  scenarios: PayScenario[];
  txns: Txn[];
}

export type HitKind = 'page' | 'account' | 'investment' | 'holding' | 'loan' | 'scenario' | 'transaction' | 'transactions';

export interface SearchHit {
  kind: HitKind;
  title: string;
  subtitle?: string;
  to: string;
  score: number;
}

export const KIND_LABEL: Record<HitKind, string> = {
  page: 'Page',
  account: 'Account',
  investment: 'Investment account',
  holding: 'Holding',
  loan: 'Loan',
  scenario: 'Paycheck scenario',
  transaction: 'Transaction',
  transactions: 'Transactions',
};

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** Every word of the query must appear; a match at the start of the title ranks higher. Returns 0 for no match. */
function score(query: string[], title: string, extra = ''): number {
  const t = norm(title);
  const hay = `${t} ${norm(extra)}`;
  if (!query.every((w) => hay.includes(w))) return 0;
  let s = 10;
  if (t === query.join(' ')) s += 50;
  else if (t.startsWith(query[0])) s += 25;
  else if (t.split(/[\s/()-]+/).some((w) => w.startsWith(query[0]))) s += 12;
  if (query.every((w) => t.includes(w))) s += 5;
  return s;
}

const MAX_TXNS = 6;

export function searchAll(raw: string, data: SearchData, limit = 14): SearchHit[] {
  const query = norm(raw).split(/\s+/).filter(Boolean);
  if (query.length === 0) return [];
  const hits: SearchHit[] = [];
  const push = (h: Omit<SearchHit, 'score'>, s: number) => s > 0 && hits.push({ ...h, score: s });
  const secById = new Map(data.securities.map((s) => [s.id!, s]));
  const acctName = (id: number) => data.accounts.find((a) => a.id === id)?.name ?? '';

  for (const p of ALL_ITEMS) push({ kind: 'page', title: p.label, subtitle: 'Go to this page', to: p.to }, score(query, p.label, p.keywords ?? ''));
  for (const a of data.accounts) push({ kind: 'account', title: a.name, subtitle: a.kind.replace('_', ' '), to: `/account/${a.id}` }, score(query, a.name, a.kind.replace('_', ' ')));
  for (const a of data.invAccounts) push({ kind: 'investment', title: a.name, subtitle: `${a.kind.toUpperCase()}${a.closed ? ' (closed)' : ''}`, to: '/investments' }, score(query, a.name, a.kind));
  const seenSec = new Set<number>();
  for (const h of data.holdings) {
    const sec = secById.get(h.securityId);
    if (!sec || seenSec.has(sec.id!)) continue;
    seenSec.add(sec.id!);
    const where = data.invAccounts.filter((a) => data.holdings.some((x) => x.accountId === a.id && x.securityId === sec.id)).map((a) => a.name);
    push({ kind: 'holding', title: sec.ticker, subtitle: `${sec.name} · ${where.join(', ')}`, to: '/investments' }, score(query, sec.ticker, sec.name));
  }
  for (const l of data.loans) push({ kind: 'loan', title: l.name, subtitle: `${l.kind}${l.scenario ? ' (what-if)' : ''}`, to: '/debt' }, score(query, l.name, l.kind));
  for (const s of data.scenarios) push({ kind: 'scenario', title: s.name, subtitle: `Paycheck scenario, ${s.year}`, to: '/paycheck' }, score(query, s.name));

  // Transactions: match payee, memo, or the amount as typed (e.g. "45.20").
  const matching = data.txns.filter((t) => {
    const hay = `${norm(t.payee)} ${norm(t.memo)} ${(Math.abs(t.amountCents) / 100).toFixed(2)}`;
    return query.every((w) => hay.includes(w));
  });
  matching
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_TXNS)
    .forEach((t, idx) =>
      hits.push({
        kind: 'transaction',
        title: t.payee || '(no payee)',
        subtitle: `${t.date} · ${acctName(t.accountId)} · ${t.amountCents < 0 ? '−' : ''}${formatCents(Math.abs(t.amountCents))}`,
        to: `/account/${t.accountId}`,
        score: 5 - idx * 0.01, // newest first
      }),
    );
  if (matching.length > MAX_TXNS) {
    hits.push({ kind: 'transactions', title: `See all ${matching.length} matching transactions`, subtitle: 'Filter, sort, and export on the Transactions page', to: `/transactions?q=${encodeURIComponent(raw.trim())}`, score: 4 });
  }

  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}
