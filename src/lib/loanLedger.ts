import type { FinanceDB } from '../db';
import type { Loan, Split } from '../types';
import { createTransfer } from './transfers';

/**
 * Ties a loan to your ledger. The loan gets a liability account (a balance you owe, shown as negative like a credit card).
 * A payment is recorded as two things on the account you pay from:
 *   1. a TRANSFER to the loan account for the principal (reduces what you owe; not spending), and
 *   2. an EXPENSE for the interest (and any escrow/PMI), split across your categories, so the budget sees the real cost.
 */

export async function createLoanLedgerAccount(d: FinanceDB, loanId: number, opening: { balanceCents: number; date: string }): Promise<number> {
  const loan = await d.loans.get(loanId);
  if (!loan) throw new Error('Loan not found');
  if (loan.scenario) throw new Error('A what-if loan cannot be tied to the ledger');
  if (loan.ledgerAccountId && (await d.accounts.get(loan.ledgerAccountId))) throw new Error('This loan already has a ledger account');
  return d.transaction('rw', d.accounts, d.loans, async () => {
    const id = await d.accounts.add({
      name: loan.name,
      kind: 'loan',
      openingBalanceCents: -Math.abs(Math.round(opening.balanceCents)),
      openingDate: opening.date,
    });
    await d.loans.update(loanId, { ledgerAccountId: id });
    return id;
  });
}

export interface LoanPaymentInput {
  loanId: number;
  date: string;
  /** The checking/savings account the money comes from. */
  fromAccountId: number;
  interestCents: number;
  /** Scheduled principal. */
  principalCents: number;
  /** Extra principal on top of the scheduled payment (also recorded in the loan's extra-payment list). */
  extraCents?: number;
  escrowCents?: number;
  interestCategoryId: number | null;
  /** Category for escrow/PMI (defaults to the interest category). */
  escrowCategoryId?: number | null;
  memo?: string;
}

export interface LoanPaymentResult {
  principalTxnId?: number;
  expenseTxnId?: number;
  eventId?: number;
}

const whole = (n: number | undefined) => Math.round(n ?? 0);

export async function recordLoanPayment(d: FinanceDB, p: LoanPaymentInput): Promise<LoanPaymentResult> {
  const interest = whole(p.interestCents);
  const principal = whole(p.principalCents);
  const extra = whole(p.extraCents);
  const escrow = whole(p.escrowCents);
  if ([interest, principal, extra, escrow].some((n) => n < 0)) throw new Error('Amounts cannot be negative');
  if (interest + principal + extra + escrow <= 0) throw new Error('Enter an amount to record');

  const loan: Loan | undefined = await d.loans.get(p.loanId);
  if (!loan) throw new Error('Loan not found');
  if (loan.scenario) throw new Error('A what-if loan cannot be tied to the ledger');
  if (!loan.ledgerAccountId || !(await d.accounts.get(loan.ledgerAccountId))) throw new Error('Create the loan’s ledger account first');
  const from = await d.accounts.get(p.fromAccountId);
  if (!from) throw new Error('Choose the account you paid from');
  if (from.kind === 'credit_card' || from.kind === 'loan') throw new Error('Pay from a checking or savings account');

  return d.transaction('rw', d.txns, d.accounts, d.loanEvents, async () => {
    const out: LoanPaymentResult = {};
    const toPrincipal = principal + extra;
    if (toPrincipal > 0) {
      const { fromTxnId } = await createTransfer(d, {
        fromAccountId: p.fromAccountId,
        toAccountId: loan.ledgerAccountId!,
        date: p.date,
        amountCents: toPrincipal,
        memo: p.memo ?? '',
        status: 'pending',
      });
      out.principalTxnId = fromTxnId;
    }
    const cost = interest + escrow;
    if (cost > 0) {
      const escrowCat = p.escrowCategoryId === undefined ? p.interestCategoryId : p.escrowCategoryId;
      let splits: Split[] | undefined;
      let categoryId: number | null = p.interestCategoryId;
      if (interest > 0 && escrow > 0 && escrowCat !== p.interestCategoryId) {
        splits = [
          { categoryId: p.interestCategoryId, amountCents: -interest },
          { categoryId: escrowCat, amountCents: -escrow },
        ];
        categoryId = null;
      } else if (interest === 0) categoryId = escrowCat;
      out.expenseTxnId = await d.txns.add({
        accountId: p.fromAccountId,
        date: p.date,
        amountCents: -cost,
        payee: `${loan.name}: ${interest > 0 && escrow > 0 ? 'interest & escrow' : interest > 0 ? 'interest' : 'escrow'}`,
        memo: p.memo ?? '',
        status: 'pending',
        categoryId,
        splits,
      });
    }
    if (extra > 0) {
      out.eventId = await d.loanEvents.add({ loanId: p.loanId, type: 'extra', date: p.date, amountCents: extra, note: 'recorded with a payment' });
    }
    return out;
  });
}

/** What you owe according to the ledger (positive), if the loan is tied to an account. */
export async function ledgerOwed(d: FinanceDB, loan: Loan): Promise<number | null> {
  if (!loan.ledgerAccountId) return null;
  const a = await d.accounts.get(loan.ledgerAccountId);
  if (!a) return null;
  const txns = await d.txns.where('accountId').equals(a.id!).toArray();
  return -(a.openingBalanceCents + txns.reduce((s, t) => s + t.amountCents, 0));
}
