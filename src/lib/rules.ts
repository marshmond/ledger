import type { FinanceDB } from '../db';
import type { Frequency, PayeeRule, RecurringRule, Txn } from '../types';
import { addDays, addMonths } from './dates';
import { daysBetween } from './money';

/**
 * Payee rules, learned category suggestions, and detection of repeating charges. Rules you create are applied on import and in the
 * quick-add form; suggestions come from how you categorized the same payee before. Nothing is changed without your say-so.
 */

/** Lowercase, drop punctuation and store numbers, so "WHOLEFDS #1234" and "Whole Foods" compare sensibly. */
export function normPayee(p: string): string {
  return p.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The rule that applies to a payee: its text must appear in the payee; the longest match wins, then the oldest rule. */
export function matchRule(rules: PayeeRule[], payee: string, accountId?: number | null): PayeeRule | null {
  const norm = normPayee(payee);
  const raw = payee.toLowerCase();
  let best: PayeeRule | null = null;
  for (const r of rules) {
    if (r.accountId != null && accountId != null && r.accountId !== accountId) continue;
    const p = r.pattern.trim().toLowerCase();
    if (!p) continue;
    if (!(raw.includes(p) || norm.includes(normPayee(p)))) continue;
    if (!best || p.length > best.pattern.trim().length || (p.length === best.pattern.trim().length && (r.id ?? 0) < (best.id ?? 0))) best = r;
  }
  return best;
}

export interface CategorySuggestion {
  categoryId: number | null;
  source: 'rule' | 'history';
  rename?: string;
}

/** A category for a payee being typed: from a rule, else from how most past transactions with that payee were categorized. */
export function suggestCategory(txns: Txn[], rules: PayeeRule[], payee: string, accountId?: number | null): CategorySuggestion | null {
  if (!payee.trim()) return null;
  const rule = matchRule(rules, payee, accountId);
  if (rule) return { categoryId: rule.categoryId, source: 'rule', rename: rule.rename || undefined };
  const key = normPayee(payee);
  if (!key) return null;
  const counts = new Map<number, number>();
  let total = 0;
  for (const t of txns) {
    if (t.transferTxnId || t.splits?.length || t.categoryId == null || normPayee(t.payee) !== key) continue;
    counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1);
    total++;
  }
  if (total < 2) return null;
  const [cat, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return n / total >= 0.6 ? { categoryId: cat, source: 'history' } : null;
}

/** Payees you have used, most frequent first, for autocomplete. */
export function recentPayees(txns: Txn[], limit = 60): string[] {
  const freq = new Map<string, { name: string; n: number; last: string }>();
  for (const t of txns) {
    const name = t.payee.trim();
    if (!name || t.transferTxnId) continue;
    const k = normPayee(name);
    const cur = freq.get(k);
    if (cur) {
      cur.n++;
      if (t.date > cur.last) {
        cur.last = t.date;
        cur.name = name;
      }
    } else freq.set(k, { name, n: 1, last: t.date });
  }
  return [...freq.values()].sort((a, b) => b.n - a.n || b.last.localeCompare(a.last)).slice(0, limit).map((x) => x.name);
}

/** Categorizes existing uncategorized transactions with your rules. Returns how many changed. Splits and transfers are left alone. */
export async function applyRulesToExisting(d: FinanceDB): Promise<number> {
  return d.transaction('rw', d.txns, d.payeeRules, async () => {
    const rules = await d.payeeRules.toArray();
    let n = 0;
    for (const t of await d.txns.toArray()) {
      if (t.categoryId != null || t.transferTxnId || t.splits?.length) continue;
      const r = matchRule(rules, t.payee, t.accountId);
      if (r && r.categoryId != null) {
        await d.txns.update(t.id!, { categoryId: r.categoryId });
        n++;
      }
    }
    return n;
  });
}

export interface RuleSuggestion {
  pattern: string;
  categoryId: number;
  count: number;
}

/** Payees you have categorized the same way at least three times (and 90% of the time) that have no rule yet. */
export function suggestRules(txns: Txn[], rules: PayeeRule[]): RuleSuggestion[] {
  const byPayee = new Map<string, { name: string; cats: Map<number, number>; total: number }>();
  for (const t of txns) {
    if (t.transferTxnId || t.splits?.length || !t.payee.trim()) continue;
    const k = normPayee(t.payee);
    if (!k) continue;
    const g = byPayee.get(k) ?? { name: t.payee.trim(), cats: new Map(), total: 0 };
    g.total++;
    if (t.categoryId != null) g.cats.set(t.categoryId, (g.cats.get(t.categoryId) ?? 0) + 1);
    byPayee.set(k, g);
  }
  const out: RuleSuggestion[] = [];
  for (const [k, g] of byPayee) {
    if (g.total < 3 || g.cats.size === 0) continue;
    const [cat, n] = [...g.cats.entries()].sort((a, b) => b[1] - a[1])[0];
    if (n < 3 || n / g.total < 0.9) continue;
    if (matchRule(rules, g.name)) continue;
    out.push({ pattern: k, categoryId: cat, count: n });
  }
  return out.sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern));
}

// ---------- repeating charges ----------

export interface RecurringGuess {
  payee: string;
  accountId: number;
  /** Signed from the account's point of view (charges are negative). */
  amountCents: number;
  frequency: Frequency;
  lastDate: string;
  nextDate: string;
  count: number;
  categoryId: number | null;
  /** Amounts were not all alike (a utility bill, say): the typical amount is used. */
  varies: boolean;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const KINDS: { freq: Frequency; days: number; tol: number }[] = [
  { freq: 'weekly', days: 7, tol: 1 },
  { freq: 'biweekly', days: 14, tol: 2 },
  { freq: 'monthly', days: 30.4, tol: 3.5 },
  { freq: 'quarterly', days: 91, tol: 6 },
  { freq: 'yearly', days: 365, tol: 8 },
];

const nextAfter = (last: string, f: Frequency): string => (f === 'weekly' ? addDays(last, 7) : f === 'biweekly' ? addDays(last, 14) : f === 'monthly' ? addMonths(last, 1) : f === 'quarterly' ? addMonths(last, 3) : addMonths(last, 12));

/** Finds charges that repeat on a regular schedule and are not already scheduled. Needs at least three occurrences. */
export function detectRecurring(txns: Txn[], scheduled: RecurringRule[], today: string): RecurringGuess[] {
  const groups = new Map<string, Txn[]>();
  for (const t of txns) {
    if (t.transferTxnId || !t.payee.trim()) continue;
    const k = `${t.accountId}|${normPayee(t.payee)}`;
    if (!normPayee(t.payee)) continue;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const out: RecurringGuess[] = [];
  for (const [key, list] of groups) {
    // one per day: a payee charged twice in a day is not a schedule
    const days = new Map<string, Txn>();
    for (const t of list) if (!days.has(t.date)) days.set(t.date, t);
    const ts = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
    if (ts.length < 3) continue;
    const gaps = ts.slice(1).map((t, i) => daysBetween(t.date, ts[i].date));
    const med = median(gaps);
    const kind = KINDS.find((k2) => Math.abs(med - k2.days) <= k2.tol);
    if (!kind) continue;
    const fit = gaps.filter((g) => Math.abs(g - kind.days) <= kind.tol * 1.6).length / gaps.length;
    if (fit < 0.75) continue;
    const amounts = ts.map((t) => t.amountCents);
    if (!(amounts.every((a) => a < 0) || amounts.every((a) => a > 0))) continue;
    const medAmt = median(amounts);
    const near = amounts.filter((a) => Math.abs(a - medAmt) <= Math.abs(medAmt) * 0.15).length / amounts.length;
    if (near < 0.6) continue;
    const last = ts[ts.length - 1];
    const next = nextAfter(last.date, kind.freq);
    // stale: it should have happened more than two periods ago, so it probably stopped
    if (daysBetween(today, next) > kind.days * 2) continue;
    const [accountId, norm] = [Number(key.split('|')[0]), key.split('|').slice(1).join('|')];
    if (scheduled.some((r) => r.active && r.accountId === accountId && (normPayee(r.payee).includes(norm) || norm.includes(normPayee(r.payee))))) continue;
    const cats = new Map<number, number>();
    for (const t of ts) if (t.categoryId != null) cats.set(t.categoryId, (cats.get(t.categoryId) ?? 0) + 1);
    const cat = [...cats.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    out.push({ payee: last.payee.trim(), accountId, amountCents: Math.round(medAmt), frequency: kind.freq, lastDate: last.date, nextDate: next, count: ts.length, categoryId: cat, varies: near < 0.95 });
  }
  return out.sort((a, b) => a.nextDate.localeCompare(b.nextDate) || a.payee.localeCompare(b.payee));
}

/** A scheduled item to create from a detected repeating charge. */
export const recurringFromGuess = (g: RecurringGuess): RecurringRule => ({
  accountId: g.accountId,
  payee: g.payee,
  amountCents: g.amountCents,
  categoryId: g.categoryId,
  memo: '',
  frequency: g.frequency,
  startDate: g.nextDate,
  active: true,
});
