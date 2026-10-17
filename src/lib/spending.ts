import type { Category, Txn } from '../types';
import { allocations } from './ledger';

/** This month's spending and income from the ledger. Transfers are left out (they move money, they do not spend it). */

export interface SpendingSnapshot {
  month: string;
  spentCents: number;
  incomeCents: number;
  top: { name: string; cents: number }[];
  count: number;
}

export function spendingSnapshot(txns: Txn[], categories: Category[], month: string, topN = 4): SpendingSnapshot {
  const catById = new Map(categories.map((c) => [c.id!, c]));
  const byCat = new Map<string, number>();
  let spent = 0;
  let income = 0;
  let count = 0;
  for (const t of txns) {
    if (!t.date.startsWith(month) || t.transferTxnId) continue;
    count++;
    for (const s of allocations(t)) {
      const cat = s.categoryId == null ? undefined : catById.get(s.categoryId);
      if (cat?.kind === 'income' || (!cat && s.amountCents > 0)) {
        income += s.amountCents;
        continue;
      }
      spent -= s.amountCents; // outflows are negative; refunds reduce spending
      const name = cat?.name ?? 'Uncategorized';
      byCat.set(name, (byCat.get(name) ?? 0) - s.amountCents);
    }
  }
  const top = [...byCat.entries()].filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).slice(0, topN).map(([name, cents]) => ({ name, cents }));
  return { month, spentCents: Math.max(0, spent), incomeCents: income, top, count };
}
