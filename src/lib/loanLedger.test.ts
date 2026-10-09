import { beforeEach, describe, expect, it } from 'vitest';
import { FinanceDB } from '../db';
import type { Account, Category, Loan } from '../types';
import { createLoanLedgerAccount, ledgerOwed, recordLoanPayment } from './loanLedger';
import { accountBalance } from './ledger';
import { computeBudget, payKey } from './budget';
import { exportAll, importAll } from './backup';

const $ = (n: number) => Math.round(n * 100);
let d: FinanceDB;
let n = 0;
let checking: number;
let loanId: number;

const baseLoan = (p: Partial<Loan> = {}): Loan => ({
  name: 'Mortgage', kind: 'mortgage', setup: 'current', balanceCents: $(200000), asOfDate: '2026-10-01', nextPaymentDate: '2026-11-01',
  remainingMonths: 300, annualRatePct: 6, extraMode: 'shorten', ...p,
});

beforeEach(async () => {
  d = new FinanceDB(`loan-ledger-${n++}`);
  checking = await d.accounts.add({ name: 'Checking', kind: 'checking', openingBalanceCents: $(10000), openingDate: '2026-01-01' });
  await d.categories.bulkAdd([
    { id: 5, groupId: 1, name: 'Mortgage interest', kind: 'expense' },
    { id: 6, groupId: 1, name: 'Escrow', kind: 'expense' },
  ]);
  loanId = await d.loans.add(baseLoan());
});

describe('loan ledger account', () => {
  it('creates a liability account with the balance owed as a negative, and links it to the loan', async () => {
    const acct = await createLoanLedgerAccount(d, loanId, { balanceCents: $(200000), date: '2026-10-01' });
    const a = (await d.accounts.get(acct))!;
    expect(a).toMatchObject({ kind: 'loan', name: 'Mortgage', openingBalanceCents: -$(200000), openingDate: '2026-10-01' });
    expect((await d.loans.get(loanId))!.ledgerAccountId).toBe(acct);
    expect(await ledgerOwed(d, (await d.loans.get(loanId))!)).toBe($(200000));
  });

  it('refuses a second account, a what-if loan, and a missing loan', async () => {
    await createLoanLedgerAccount(d, loanId, { balanceCents: $(1), date: '2026-10-01' });
    await expect(createLoanLedgerAccount(d, loanId, { balanceCents: $(1), date: '2026-10-01' })).rejects.toThrow('already');
    const what = await d.loans.add(baseLoan({ scenario: true }));
    await expect(createLoanLedgerAccount(d, what, { balanceCents: $(1), date: '2026-10-01' })).rejects.toThrow('what-if');
    await expect(createLoanLedgerAccount(d, 999, { balanceCents: $(1), date: '2026-10-01' })).rejects.toThrow('not found');
  });
});

describe('recording a payment', () => {
  const pay = (over: Partial<Parameters<typeof recordLoanPayment>[1]> = {}) =>
    recordLoanPayment(d, {
      loanId, date: '2026-11-01', fromAccountId: checking, interestCents: $(1000), principalCents: $(500), extraCents: $(200),
      escrowCents: $(300), interestCategoryId: 5, escrowCategoryId: 6, ...over,
    });
  const setup = () => createLoanLedgerAccount(d, loanId, { balanceCents: $(200000), date: '2026-10-01' });

  it('principal is a transfer to the loan; interest and escrow are an expense split across categories', async () => {
    const acct = await setup();
    const r = await pay();
    // principal + extra reduce what you owe and leave checking
    expect(await ledgerOwed(d, (await d.loans.get(loanId))!)).toBe($(200000) - $(700));
    const out = (await d.txns.get(r.principalTxnId!))!;
    expect(out).toMatchObject({ accountId: checking, amountCents: -$(700), status: 'pending' });
    expect((await d.txns.get(out.transferTxnId!))!.accountId).toBe(acct);
    // interest + escrow are an expense with a split
    const exp = (await d.txns.get(r.expenseTxnId!))!;
    expect(exp.amountCents).toBe(-$(1300));
    expect(exp.splits).toEqual([{ categoryId: 5, amountCents: -$(1000) }, { categoryId: 6, amountCents: -$(300) }]);
    expect(exp.categoryId).toBeNull();
    expect(exp.payee).toBe('Mortgage: interest & escrow');
    // cash out of checking is the whole payment
    expect(await accountBalance(d, checking)).toBe($(10000) - $(700) - $(1300));
  });

  it('the extra principal is also remembered on the loan so the schedule reflects it', async () => {
    await setup();
    const r = await pay();
    expect(await d.loanEvents.get(r.eventId!)).toMatchObject({ loanId, type: 'extra', date: '2026-11-01', amountCents: $(200) });
    const none = await pay({ extraCents: 0, date: '2026-12-01' });
    expect(none.eventId).toBeUndefined();
  });

  it('uses one category when interest and escrow share it, and the right one when only one is present', async () => {
    await setup();
    const same = await pay({ escrowCategoryId: 5 });
    expect((await d.txns.get(same.expenseTxnId!))!).toMatchObject({ categoryId: 5, amountCents: -$(1300) });
    expect((await d.txns.get(same.expenseTxnId!))!.splits).toBeUndefined();

    const onlyInterest = await pay({ escrowCents: 0 });
    expect((await d.txns.get(onlyInterest.expenseTxnId!))!).toMatchObject({ categoryId: 5, payee: 'Mortgage: interest' });

    const onlyEscrow = await pay({ interestCents: 0 });
    expect((await d.txns.get(onlyEscrow.expenseTxnId!))!).toMatchObject({ categoryId: 6, payee: 'Mortgage: escrow' });
  });

  it('a principal-only payment makes only a transfer; an interest-only payment makes only an expense', async () => {
    await setup();
    const p = await pay({ interestCents: 0, escrowCents: 0, extraCents: 0 });
    expect(p.expenseTxnId).toBeUndefined();
    expect(p.principalTxnId).toBeDefined();
    const i = await pay({ principalCents: 0, extraCents: 0, escrowCents: 0 });
    expect(i.principalTxnId).toBeUndefined();
    expect(i.expenseTxnId).toBeDefined();
  });

  it('rejects bad input without writing anything', async () => {
    await expect(pay()).rejects.toThrow('ledger account'); // not linked yet
    await setup();
    const before = await d.txns.count();
    await expect(pay({ interestCents: -1 })).rejects.toThrow('negative');
    await expect(pay({ interestCents: 0, principalCents: 0, extraCents: 0, escrowCents: 0 })).rejects.toThrow('Enter an amount');
    await expect(pay({ fromAccountId: 999 })).rejects.toThrow('Choose the account');
    const card = await d.accounts.add({ name: 'Card', kind: 'credit_card', openingBalanceCents: 0, openingDate: '2026-01-01' } as Account);
    await expect(pay({ fromAccountId: card })).rejects.toThrow('checking or savings');
    await expect(pay({ loanId: 999 })).rejects.toThrow('not found');
    expect(await d.txns.count()).toBe(before);
  });
});

describe('loans in the budget', () => {
  const cats: Category[] = [{ id: 5, groupId: 1, name: 'Mortgage interest', kind: 'expense' }];
  const accts: Account[] = [
    { id: 1, name: 'Checking', kind: 'checking', openingBalanceCents: $(10000), openingDate: '2026-01-01' },
    { id: 2, name: 'Mortgage', kind: 'loan', openingBalanceCents: -$(200000), openingDate: '2026-01-01' },
  ];

  it('a loan is not spendable cash, so its balance never touches Ready to Assign', () => {
    const r = computeBudget({ accounts: accts, categories: cats, txns: [], assignments: [], month: '2026-10' });
    expect(r.cash).toBe($(10000));
    expect(r.readyToAssign).toBe($(10000));
    expect(r.unfunded).toEqual([]); // the whole balance is not "unfunded debt"; you fund the principal you plan to pay
  });

  it('gets a payment line you fund by assigning, which a principal transfer draws down', () => {
    const txns = [
      { id: 1, accountId: 1, date: '2026-10-05', amountCents: -$(700), payee: '', memo: '', status: 'cleared' as const, categoryId: null, transferTxnId: 2 },
      { id: 2, accountId: 2, date: '2026-10-05', amountCents: $(700), payee: '', memo: '', status: 'cleared' as const, categoryId: null, transferTxnId: 1 },
    ];
    const funded = computeBudget({ accounts: accts, categories: cats, txns, assignments: [{ month: '2026-10', key: payKey(2), amountCents: $(700) }], month: '2026-10' });
    const line = funded.rows.find((x) => x.key === payKey(2))!;
    expect(line.name).toBe('Payment: Mortgage');
    expect(line.available).toBe(0); // assigned 700, paid 700
    expect(funded.readyToAssign).toBe($(10000) - $(700)); // the money left checking and is not left over

    const unfunded = computeBudget({ accounts: accts, categories: cats, txns, assignments: [], month: '2026-10' });
    expect(unfunded.rows.find((x) => x.key === payKey(2))!.available).toBe(-$(700));
    expect(unfunded.readyToAssign).toBe($(9300)); // paying without having assigned it reduces Ready to Assign
  });

  it('the interest expense is ordinary spending in its category', () => {
    const txns = [{ id: 1, accountId: 1, date: '2026-10-05', amountCents: -$(1000), payee: '', memo: '', status: 'cleared' as const, categoryId: 5 }];
    const r = computeBudget({ accounts: accts, categories: cats, txns, assignments: [{ month: '2026-10', key: 'c5', amountCents: $(1000) }], month: '2026-10' });
    expect(r.rows.find((x) => x.key === 'c5')!.available).toBe(0);
  });
});

describe('backup includes loans', () => {
  it('round-trips loans, rate changes, and events', async () => {
    await d.loanRates.add({ loanId, date: '2027-01-01', annualRatePct: 7 });
    await d.loanEvents.add({ loanId, type: 'extra', date: '2026-12-01', amountCents: 100, monthly: true });
    const data = JSON.parse(JSON.stringify(await exportAll(d)));
    const d2 = new FinanceDB(`loan-ledger-restore-${n++}`);
    await importAll(d2, data);
    expect(await d2.loans.count()).toBe(1);
    expect(await d2.loanRates.count()).toBe(1);
    expect((await d2.loanEvents.toArray())[0]).toMatchObject({ monthly: true, amountCents: 100 });
  });
});
