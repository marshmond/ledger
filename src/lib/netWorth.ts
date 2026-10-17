import type { Account, Txn } from '../types';

export interface NetWorth {
  cash: number;
  investments: number;
  /** Credit card balances (negative = owed). */
  cards: number;
  /** Loans (negative = owed). */
  loans: number;
  total: number;
}

export interface LoanOwed {
  /** The ledger account that already holds this loan's balance, if any (it is then counted once, from the ledger). */
  ledgerAccountId?: number | null;
  /** What is still owed on the loan's schedule today. */
  owedCents: number;
}

export const ledgerBalance = (a: Account, txns: Txn[]): number => a.openingBalanceCents + txns.filter((t) => t.accountId === a.id).reduce((s, t) => s + t.amountCents, 0);

/** Cash + investments - cards - loans. Loans tied to a ledger account are counted once, from the ledger. Property value is not included. */
export function computeNetWorth(accounts: Account[], txns: Txn[], investmentsCents: number, loans: LoanOwed[]): NetWorth {
  const open = accounts.filter((a) => !a.closed);
  const sumKind = (k: Account['kind']) => open.filter((a) => a.kind === k).reduce((s, a) => s + ledgerBalance(a, txns), 0);
  const cash = sumKind('checking') + sumKind('savings');
  const cards = sumKind('credit_card');
  const ledgerLoans = sumKind('loan');
  const unlinked = loans.filter((l) => !l.ledgerAccountId || !accounts.some((a) => a.id === l.ledgerAccountId)).reduce((s, l) => s - l.owedCents, 0);
  const loanTotal = ledgerLoans + unlinked;
  return { cash, investments: investmentsCents, cards, loans: loanTotal, total: cash + investmentsCents + cards + loanTotal };
}
