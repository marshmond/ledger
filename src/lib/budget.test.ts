import { describe, expect, it } from 'vitest';
import { computeBudget, copyLastMonth, loadBudget, payKey, setAssignment } from './budget';
import { FinanceDB } from '../db';
import type { Account, Assignment, Category, Txn } from '../types';

const checking: Account = { id: 1, name: 'Checking', kind: 'checking', openingBalanceCents: 100000, openingDate: '2026-01-01' };
const card: Account = { id: 2, name: 'Card', kind: 'credit_card', openingBalanceCents: 0, openingDate: '2026-01-01' };
const groceries: Category = { id: 10, groupId: 1, name: 'Groceries', kind: 'expense' };
const dining: Category = { id: 11, groupId: 1, name: 'Dining', kind: 'expense' };
const paycheck: Category = { id: 12, groupId: 2, name: 'Paycheck', kind: 'income' };
const cats = [groceries, dining, paycheck];

let nextId = 1;
const tx = (p: Partial<Txn> & Pick<Txn, 'accountId' | 'date' | 'amountCents'>): Txn => ({
  id: nextId++,
  payee: '',
  memo: '',
  status: 'cleared',
  categoryId: null,
  ...p,
});
const asg = (month: string, key: string, amountCents: number): Assignment => ({ month, key, amountCents });

const run = (month: string, accounts: Account[], txns: Txn[], assignments: Assignment[]) =>
  computeBudget({ accounts, categories: cats, txns, assignments, month });
const row = (r: ReturnType<typeof run>, key: string) => r.rows.find((x) => x.key === key)!;

describe('budget', () => {
  it('assigning gives money a job and lowers Ready to Assign', () => {
    const r = run('2026-02', [checking], [], [asg('2026-02', 'c10', 30000)]);
    expect(r.readyToAssign).toBe(70000);
    expect(row(r, 'c10').available).toBe(30000);
  });

  it('cash spending reduces the category, not Ready to Assign', () => {
    const r = run('2026-02', [checking], [tx({ accountId: 1, date: '2026-02-05', amountCents: -10000, categoryId: 10 })], [asg('2026-02', 'c10', 30000)]);
    expect(row(r, 'c10').available).toBe(20000);
    expect(r.readyToAssign).toBe(70000);
  });

  it('positive balances roll over to next month', () => {
    const r = run('2026-03', [checking], [], [asg('2026-02', 'c10', 30000), asg('2026-03', 'c10', 5000)]);
    expect(row(r, 'c10').carry).toBe(30000);
    expect(row(r, 'c10').available).toBe(35000);
    expect(r.readyToAssign).toBe(65000);
  });

  it('cash overspending lowers Ready to Assign and does not carry a negative', () => {
    const t = [tx({ accountId: 1, date: '2026-02-05', amountCents: -40000, categoryId: 10 })];
    const feb = run('2026-02', [checking], t, [asg('2026-02', 'c10', 30000)]);
    expect(row(feb, 'c10').available).toBe(-10000);
    expect(feb.readyToAssign).toBe(60000); // 1000 - 400 cash, nothing left reserved
    const mar = run('2026-03', [checking], t, [asg('2026-02', 'c10', 30000)]);
    expect(row(mar, 'c10').carry).toBe(0);
    expect(mar.readyToAssign).toBe(60000);
  });

  it('income inflows raise Ready to Assign; refunds on an expense category raise its available', () => {
    const r = run(
      '2026-02',
      [checking],
      [
        tx({ accountId: 1, date: '2026-02-01', amountCents: 250000, categoryId: 12 }),
        tx({ accountId: 1, date: '2026-02-03', amountCents: 2000, categoryId: 10 }),
      ],
      [],
    );
    expect(r.incomeThisMonth).toBe(250000);
    expect(row(r, 'c10').available).toBe(2000);
    expect(r.readyToAssign).toBe(100000 + 250000 + 2000 - 2000);
  });

  it('card spending moves budgeted money into the card payment line', () => {
    const t = [tx({ accountId: 2, date: '2026-02-05', amountCents: -10000, categoryId: 10 })];
    const r = run('2026-02', [checking, card], t, [asg('2026-02', 'c10', 30000)]);
    expect(row(r, 'c10').available).toBe(20000);
    expect(row(r, payKey(2)).available).toBe(10000);
    expect(r.readyToAssign).toBe(100000 - 20000 - 10000);
    expect(r.unfunded).toHaveLength(0);
  });

  it('paying the card from checking (a transfer) draws the payment line down', () => {
    const t = [
      tx({ accountId: 2, date: '2026-02-05', amountCents: -10000, categoryId: 10 }),
      tx({ accountId: 1, date: '2026-02-20', amountCents: -10000, transferTxnId: 99 }),
      tx({ accountId: 2, date: '2026-02-20', amountCents: 10000, transferTxnId: 98 }),
    ];
    const r = run('2026-02', [checking, card], t, [asg('2026-02', 'c10', 30000)]);
    expect(row(r, payKey(2)).available).toBe(0);
    expect(r.readyToAssign).toBe(90000 - 20000); // cash 900, groceries 200 reserved
  });

  it('card spending beyond what was budgeted is unfunded debt', () => {
    const t = [tx({ accountId: 2, date: '2026-02-05', amountCents: -10000, categoryId: 10 })];
    const r = run('2026-02', [checking, card], t, []);
    expect(row(r, payKey(2)).available).toBe(0);
    expect(r.unfunded[0]).toMatchObject({ owedCents: 10000, unfundedCents: 10000 });
  });

  it('partially budgeted card spending funds only the covered part', () => {
    const t = [tx({ accountId: 2, date: '2026-02-05', amountCents: -10000, categoryId: 10 })];
    const r = run('2026-02', [checking, card], t, [asg('2026-02', 'c10', 4000)]);
    expect(row(r, payKey(2)).available).toBe(4000);
    expect(r.unfunded[0].unfundedCents).toBe(6000);
  });

  it('cash spending uses the funds before card spending does', () => {
    const t = [
      tx({ accountId: 1, date: '2026-02-04', amountCents: -8000, categoryId: 10 }),
      tx({ accountId: 2, date: '2026-02-05', amountCents: -10000, categoryId: 10 }),
    ];
    const r = run('2026-02', [checking, card], t, [asg('2026-02', 'c10', 15000)]);
    expect(row(r, payKey(2)).available).toBe(7000); // 150 - 80 cash leaves 70 for the card
  });

  it('existing card debt is not spending; funding the payment line pays it down', () => {
    const owing: Account = { ...card, openingBalanceCents: -50000 };
    const base = run('2026-02', [checking, owing], [], []);
    expect(base.readyToAssign).toBe(100000);
    expect(base.unfunded[0].unfundedCents).toBe(50000);

    const funded = run('2026-02', [checking, owing], [], [asg('2026-02', payKey(2), 50000)]);
    expect(funded.readyToAssign).toBe(50000);
    expect(funded.unfunded).toHaveLength(0);

    const paid = run(
      '2026-02',
      [checking, owing],
      [
        tx({ accountId: 1, date: '2026-02-10', amountCents: -50000, transferTxnId: 99 }),
        tx({ accountId: 2, date: '2026-02-10', amountCents: 50000, transferTxnId: 98 }),
      ],
      [asg('2026-02', payKey(2), 50000)],
    );
    expect(row(paid, payKey(2)).available).toBe(0);
    expect(paid.readyToAssign).toBe(50000);
    expect(paid.unfunded).toHaveLength(0);
  });

  it('splits budget each part against its own category', () => {
    const t = [
      tx({
        accountId: 1,
        date: '2026-02-05',
        amountCents: -10000,
        splits: [
          { categoryId: 10, amountCents: -6000 },
          { categoryId: 11, amountCents: -4000 },
        ],
      }),
    ];
    const r = run('2026-02', [checking], t, []);
    expect(row(r, 'c10').activity).toBe(-6000);
    expect(row(r, 'c11').activity).toBe(-4000);
  });

  it('counts uncategorized outflows', () => {
    const r = run('2026-02', [checking], [tx({ accountId: 1, date: '2026-02-05', amountCents: -500 })], []);
    expect(r.uncategorizedCount).toBe(1);
    expect(r.readyToAssign).toBe(100000 - 500);
  });

  it('a budget started mid-month works from the starting balance', () => {
    const mid: Account = { ...checking, openingDate: '2026-02-18' };
    const r = run('2026-02', [mid], [], []);
    expect(r.readyToAssign).toBe(100000);
  });
});

describe('accounts left out of the budget', () => {
  const longTerm: Account = { id: 3, name: 'Long-term savings', kind: 'savings', openingBalanceCents: 500000, openingDate: '2026-01-01', budgetExcluded: true };

  it('their balance is not part of Ready to Assign, and the switch defaults to included', () => {
    expect(run('2026-02', [checking, longTerm], [], []).readyToAssign).toBe(100000);
    expect(run('2026-02', [checking, { ...longTerm, budgetExcluded: undefined }], [], []).readyToAssign).toBe(600000);
    expect(run('2026-02', [checking, { ...longTerm, budgetExcluded: false }], [], []).readyToAssign).toBe(600000);
  });

  it('moving money to or from one counts as money leaving or entering the budget', () => {
    const out = [
      tx({ accountId: 1, date: '2026-02-03', amountCents: -50000, transferTxnId: 98 }),
      tx({ accountId: 3, date: '2026-02-03', amountCents: 50000, transferTxnId: 97 }),
    ];
    expect(run('2026-02', [checking, longTerm], out, []).readyToAssign).toBe(50000);
    const back = [
      tx({ accountId: 1, date: '2026-02-03', amountCents: 20000, transferTxnId: 98 }),
      tx({ accountId: 3, date: '2026-02-03', amountCents: -20000, transferTxnId: 97 }),
    ];
    expect(run('2026-02', [checking, longTerm], back, []).readyToAssign).toBe(120000);
  });

  it('interest earned and spending inside one are not budgeted', () => {
    const t = [
      tx({ accountId: 3, date: '2026-02-05', amountCents: 1234, categoryId: 12 }),
      tx({ accountId: 3, date: '2026-02-06', amountCents: -2000, categoryId: 10 }),
    ];
    const r = run('2026-02', [checking, longTerm], t, []);
    expect(r.readyToAssign).toBe(100000);
    expect(r.incomeThisMonth).toBe(0);
    expect(row(r, 'c10').activity).toBe(0);
  });
});

describe('budget persistence helpers', () => {
  it('setAssignment upserts and removes; copyLastMonth fills gaps only', async () => {
    const d = new FinanceDB('budget-test');
    await d.accounts.add({ name: 'C', kind: 'checking', openingBalanceCents: 100000, openingDate: '2026-01-01' });
    await d.categories.add({ groupId: 1, name: 'G', kind: 'expense' });
    await setAssignment(d, '2026-01', 'c1', 5000);
    await setAssignment(d, '2026-01', 'c1', 7000);
    expect(await d.assignments.count()).toBe(1);
    expect(await copyLastMonth(d, '2026-02')).toBe(1);
    expect(await copyLastMonth(d, '2026-02')).toBe(0);
    await setAssignment(d, '2026-01', 'c1', 0);
    expect((await d.assignments.where('month').equals('2026-01').count())).toBe(0);
    expect((await loadBudget(d, '2026-02')).readyToAssign).toBe(100000 - 7000);
  });
});
