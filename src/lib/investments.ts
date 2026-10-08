import type { AssetClass, Holding, InvAccount, Security } from '../types';

/** Market value of one holding in cents. A security with no price counts as 0 and is reported as missing. */
export function holdingValue(h: Holding, sec: Security | undefined): number {
  if (!sec || sec.priceCents === null) return 0;
  return Math.round(h.shares * sec.priceCents);
}

export interface AllocationSlice {
  /** Asset class id, or null for cash when no cash class exists. */
  assetClassId: number | null;
  name: string;
  cents: number;
  pct: number; // 0-100
}

export interface PortfolioInputs {
  accounts: InvAccount[];
  holdings: Holding[];
  securities: Security[];
  assetClasses: AssetClass[];
}

/** The class that uninvested cash counts toward: the first 'cash' class, if any. */
export function cashClass(classes: AssetClass[]): AssetClass | undefined {
  return classes.find((c) => c.kind === 'cash');
}

/** Value by asset class for the given accounts (cash is counted toward the cash class). */
export function allocationFor(accountIds: number[] | 'all', p: PortfolioInputs): AllocationSlice[] {
  const ids = new Set(accountIds === 'all' ? p.accounts.filter((a) => !a.closed).map((a) => a.id!) : accountIds);
  const secById = new Map(p.securities.map((s) => [s.id!, s]));
  const byClass = new Map<number | null, number>();
  const add = (k: number | null, v: number) => byClass.set(k, (byClass.get(k) ?? 0) + v);

  for (const h of p.holdings) {
    if (!ids.has(h.accountId)) continue;
    const sec = secById.get(h.securityId);
    if (!sec) continue;
    add(sec.assetClassId, holdingValue(h, sec));
  }
  const cc = cashClass(p.assetClasses);
  for (const a of p.accounts) if (ids.has(a.id!) && a.cashCents) add(cc?.id ?? null, a.cashCents);

  const total = [...byClass.values()].reduce((s, v) => s + v, 0);
  const nameOf = (id: number | null) => (id === null ? 'Cash' : p.assetClasses.find((c) => c.id === id)?.name ?? 'Unknown');
  return [...byClass.entries()]
    .filter(([, v]) => v !== 0)
    .map(([id, cents]) => ({ assetClassId: id, name: nameOf(id), cents, pct: total ? (cents / total) * 100 : 0 }))
    .sort((a, b) => b.cents - a.cents);
}

export interface AccountSummary {
  account: InvAccount;
  invested: number;
  cash: number;
  total: number;
  missingPrices: string[]; // tickers
}

export function summarize(p: PortfolioInputs): { accounts: AccountSummary[]; total: number; byKind: Record<string, number>; missing: string[] } {
  const secById = new Map(p.securities.map((s) => [s.id!, s]));
  const accounts = p.accounts.map((account) => {
    const hs = p.holdings.filter((h) => h.accountId === account.id);
    const invested = hs.reduce((s, h) => s + holdingValue(h, secById.get(h.securityId)), 0);
    const missingPrices = hs
      .map((h) => secById.get(h.securityId))
      .filter((s): s is Security => !!s && s.priceCents === null)
      .map((s) => s.ticker);
    return { account, invested, cash: account.cashCents, total: invested + account.cashCents, missingPrices };
  });
  const open = accounts.filter((a) => !a.account.closed);
  const byKind: Record<string, number> = {};
  for (const a of open) byKind[a.account.kind] = (byKind[a.account.kind] ?? 0) + a.total;
  return {
    accounts,
    total: open.reduce((s, a) => s + a.total, 0),
    byKind,
    missing: [...new Set(open.flatMap((a) => a.missingPrices))],
  };
}

/** Unrealized gain/loss for holdings with a known cost basis (taxable accounts matter most). */
export function gainLoss(h: Holding, sec: Security | undefined): number | null {
  if (h.costBasisCents === null || !sec || sec.priceCents === null) return null;
  return holdingValue(h, sec) - h.costBasisCents;
}
