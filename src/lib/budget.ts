import type { FinanceDB } from '../db';
import type { Account, Assignment, Category, Txn } from '../types';
import { allocations } from './ledger';
import { endOfMonth, monthOf, monthRange, nextMonth, prevMonth } from './dates';

/**
 * Envelope ("every dollar has a job") budget math. Pure functions over plain arrays so it is easy to test.
 *
 * Rules:
 *  - Ready to Assign (RTA) = checking+savings cash through month end, minus every line's positive available.
 *  - A line's available = last month's carry + assigned this month + activity (spending is negative).
 *  - Positive availability carries forward. Overspending does NOT carry: it resets to 0 next month and, because the
 *    cash already left, it lowers RTA. (Cover it by assigning more to that category.)
 *  - Spending on a credit card moves the money you had budgeted for it into that card's payment line; paying the card
 *    (a transfer into it) draws the payment line down. Card spending beyond what was budgeted stays "unfunded debt".
 *  - Existing card debt is not spending. Fund it by assigning to the card's payment line.
 *  - When a category's funds don't cover both cash and card spending in a month, cash spending is assumed to have used
 *    the funds first, and what remains covers card spending (split pro rata across cards).
 */

export interface BudgetRow {
  key: string;
  kind: 'category' | 'payment';
  categoryId?: number;
  accountId?: number;
  name: string;
  groupId: number | null;
  carry: number;
  assigned: number;
  activity: number;
  available: number;
}

export interface UnfundedDebt {
  accountId: number;
  name: string;
  owedCents: number;
  unfundedCents: number;
}

export interface BudgetResult {
  month: string;
  readyToAssign: number;
  cash: number;
  rows: BudgetRow[];
  incomeThisMonth: number;
  uncategorizedCount: number;
  unfunded: UnfundedDebt[];
}

export const catKey = (id: number) => `c${id}`;
export const payKey = (accountId: number) => `p${accountId}`;

export interface BudgetInput {
  accounts: Account[];
  categories: Category[];
  txns: Txn[];
  assignments: Assignment[];
  month: string;
}

export function computeBudget({ accounts, categories, txns, assignments, month }: BudgetInput): BudgetResult {
  const cards = accounts.filter((a) => a.kind === 'credit_card');
  // Loans (mortgage, HELOC...) are debts like cards, but nothing is bought on them: they only get a payment line, which you fund
  // by assigning the principal you plan to pay. They are never part of spendable cash.
  const loans = accounts.filter((a) => a.kind === 'loan');
  const debtAccts = [...cards, ...loans];
  const cashAccts = new Set(accounts.filter((a) => a.kind !== 'credit_card' && a.kind !== 'loan').map((a) => a.id!));
  const cardIds = new Set(cards.map((c) => c.id!));
  const payIds = new Set(debtAccts.map((c) => c.id!));
  const expense = categories.filter((c) => c.kind !== 'income');
  const expenseIds = new Set(expense.map((c) => c.id!));
  const incomeIds = new Set(categories.filter((c) => c.kind === 'income').map((c) => c.id!));

  const assignedBy = new Map<string, number>();
  for (const a of assignments) assignedBy.set(`${a.month}|${a.key}`, (assignedBy.get(`${a.month}|${a.key}`) ?? 0) + a.amountCents);

  const monthsSeen = [
    month,
    ...accounts.map((a) => monthOf(a.openingDate)),
    ...txns.map((t) => monthOf(t.date)),
    ...assignments.map((a) => a.month),
  ].filter((m) => m <= month);
  const start = monthsSeen.reduce((a, b) => (a < b ? a : b), month);

  const txnsByMonth = new Map<string, Txn[]>();
  for (const t of txns) {
    const m = monthOf(t.date);
    if (m > month) continue;
    (txnsByMonth.get(m) ?? txnsByMonth.set(m, []).get(m)!).push(t);
  }

  let carry = new Map<string, number>();
  let rows: BudgetRow[] = [];
  let incomeThisMonth = 0;
  let uncategorizedCount = 0;

  for (const m of monthRange(start, month)) {
    const list = txnsByMonth.get(m) ?? [];
    const activity = new Map<string, number>(); // by category key, signed
    const cardSpend = new Map<string, Map<number, number>>(); // category key -> card id -> spend (positive = spent)
    const payments = new Map<number, number>(); // card id -> signed credits from transfers
    let income = 0;
    let uncategorized = 0;

    for (const t of list) {
      if (t.transferTxnId) {
        if (payIds.has(t.accountId)) payments.set(t.accountId, (payments.get(t.accountId) ?? 0) + t.amountCents);
        continue;
      }
      for (const s of allocations(t)) {
        if (s.categoryId !== null && incomeIds.has(s.categoryId)) {
          income += s.amountCents;
        } else if (s.categoryId !== null && expenseIds.has(s.categoryId)) {
          const k = catKey(s.categoryId);
          activity.set(k, (activity.get(k) ?? 0) + s.amountCents);
          if (cardIds.has(t.accountId)) {
            const per = cardSpend.get(k) ?? new Map<number, number>();
            per.set(t.accountId, (per.get(t.accountId) ?? 0) - s.amountCents);
            cardSpend.set(k, per);
          }
        } else if (s.amountCents >= 0) {
          income += s.amountCents; // uncategorized inflow counts as income
        } else {
          uncategorized++;
        }
      }
    }

    const nextCarry = new Map<string, number>();
    const rowsThisMonth: BudgetRow[] = [];
    const paymentAdds = new Map<number, number>();

    for (const c of expense) {
      const k = catKey(c.id!);
      const cr = carry.get(k) ?? 0;
      const assigned = assignedBy.get(`${m}|${k}`) ?? 0;
      const act = activity.get(k) ?? 0;
      const funds = cr + assigned;
      const available = funds + act;

      // Move budgeted money for card spending into the card payment lines.
      const per = cardSpend.get(k);
      if (per) {
        const spendTotal = -act;
        const cardTotal = [...per.values()].reduce((s, v) => s + v, 0);
        const cashSpend = spendTotal - cardTotal;
        const positive = [...per.entries()].filter(([, v]) => v > 0);
        const positiveTotal = positive.reduce((s, [, v]) => s + v, 0);
        const coverable = Math.min(Math.max(funds - cashSpend, 0), positiveTotal);
        for (const [card, v] of per.entries()) {
          const covered = v < 0 ? v : positiveTotal > 0 ? Math.round((coverable * v) / positiveTotal) : 0;
          paymentAdds.set(card, (paymentAdds.get(card) ?? 0) + covered);
        }
      }

      nextCarry.set(k, Math.max(0, available));
      rowsThisMonth.push({
        key: k,
        kind: 'category',
        categoryId: c.id,
        name: c.name,
        groupId: c.groupId,
        carry: cr,
        assigned,
        activity: act,
        available,
      });
    }

    for (const card of debtAccts) {
      const k = payKey(card.id!);
      const cr = carry.get(k) ?? 0;
      const assigned = assignedBy.get(`${m}|${k}`) ?? 0;
      // Money moved in by card spending, minus money paid out to the card.
      const act = (paymentAdds.get(card.id!) ?? 0) - (payments.get(card.id!) ?? 0);
      const available = cr + assigned + act;
      nextCarry.set(k, Math.max(0, available));
      rowsThisMonth.push({
        key: k,
        kind: 'payment',
        accountId: card.id,
        name: `Payment: ${card.name}`,
        groupId: null,
        carry: cr,
        assigned,
        activity: act,
        available,
      });
    }

    carry = nextCarry;
    rows = rowsThisMonth;
    incomeThisMonth = income;
    uncategorizedCount += uncategorized;
  }

  const end = endOfMonth(month);
  const balanceOf = (a: Account) =>
    (a.openingDate <= end ? a.openingBalanceCents : 0) +
    txns.filter((t) => t.accountId === a.id && t.date <= end).reduce((s, t) => s + t.amountCents, 0);
  const cash = accounts.filter((a) => cashAccts.has(a.id!)).reduce((s, a) => s + balanceOf(a), 0);
  const readyToAssign = cash - rows.reduce((s, r) => s + Math.max(0, r.available), 0);

  const unfunded: UnfundedDebt[] = cards
    .map((card) => {
      const owed = Math.max(0, -balanceOf(card));
      const funded = Math.max(0, rows.find((r) => r.key === payKey(card.id!))?.available ?? 0);
      return { accountId: card.id!, name: card.name, owedCents: owed, unfundedCents: Math.max(0, owed - funded) };
    })
    .filter((u) => u.unfundedCents > 0);

  return { month, readyToAssign, cash, rows, incomeThisMonth, uncategorizedCount, unfunded };
}

export async function loadBudget(d: FinanceDB, month: string): Promise<BudgetResult> {
  const [accounts, categories, txns, assignments] = await Promise.all([
    d.accounts.toArray(),
    d.categories.toArray(),
    d.txns.toArray(),
    d.assignments.toArray(),
  ]);
  return computeBudget({ accounts, categories, txns, assignments, month });
}

/** Sets a line's assignment for a month (0 removes it). */
export async function setAssignment(d: FinanceDB, month: string, key: string, amountCents: number) {
  await d.transaction('rw', d.assignments, async () => {
    const existing = await d.assignments.where('[month+key]').equals([month, key]).toArray();
    await d.assignments.bulkDelete(existing.map((e) => e.id!));
    if (amountCents !== 0) await d.assignments.add({ month, key, amountCents });
  });
}

/** Copies last month's assignments into any lines that have none this month. */
export async function copyLastMonth(d: FinanceDB, month: string): Promise<number> {
  const prev = await d.assignments.where('month').equals(prevMonth(month)).toArray();
  const cur = new Set((await d.assignments.where('month').equals(month).toArray()).map((a) => a.key));
  const todo = prev.filter((a) => !cur.has(a.key));
  for (const a of todo) await d.assignments.add({ month, key: a.key, amountCents: a.amountCents });
  return todo.length;
}

export { nextMonth, prevMonth };
