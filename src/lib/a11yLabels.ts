/**
 * The spoken names of controls that sit in a row or a table and so cannot be told apart by their visible text alone
 * ("Assigned", "edit", "delete"). Each one names the PURPOSE and the RECORD, in that order, so a screen reader announces
 * "Assigned amount for Groceries" rather than "edit text".
 *
 * Rules: plain words; the record is identified by its name and, where the same name can repeat, its date; and NO money figures or
 * balances appear in a name (so Hide Amounts never has anything to leak through assistive technology).
 */

const clean = (s: string | null | undefined, fallback: string): string => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t || fallback;
};

// ---- Budget ----
export const assignedLabel = (lineName: string) => `Assigned amount for ${clean(lineName, 'this budget line')}`;
export const budgetFundLabel = (lineName: string) => `Fund the target for ${clean(lineName, 'this budget line')}`;
export const budgetEditTargetLabel = (lineName: string) => `Edit the target for ${clean(lineName, 'this budget line')}`;
export const budgetSetTargetLabel = (lineName: string) => `Set a target for ${clean(lineName, 'this budget line')}`;
export const budgetFundPaymentLabel = (lineName: string) => `Fund the payment line for ${clean(lineName, 'this card')}`;

// ---- Scheduled ----
/** A due item can come round more than once in the list, so the scheduled date is part of the name. */
const dueTail = (payee: string, scheduledDate: string) => `${clean(payee, 'this item')}, scheduled ${clean(scheduledDate, 'date unknown')}`;
export const dueDateLabel = (payee: string, scheduledDate: string) => `Posting date for ${dueTail(payee, scheduledDate)}`;
export const dueAmountLabel = (payee: string, scheduledDate: string) => `Amount to post for ${dueTail(payee, scheduledDate)}`;
export const dueApproveLabel = (payee: string, scheduledDate: string) => `Approve ${dueTail(payee, scheduledDate)}`;
export const dueSkipLabel = (payee: string, scheduledDate: string) => `Skip ${dueTail(payee, scheduledDate)}`;
export const ruleActionLabel = (verb: 'Edit' | 'Pause' | 'Resume' | 'Delete', payee: string) => `${verb} ${clean(payee, 'this recurring item')}`;

// ---- Finance transaction rows ----
/** "Delete Demo Market, 2026-11-06". The payee and date identify the row; the amount is left out on purpose. */
export const txnRowLabel = (verb: 'Edit' | 'Delete' | 'Clear' | 'Unlink' | 'Select', payee: string | undefined, date: string) => `${verb} ${clean(payee, 'transaction')}, ${clean(date, 'date unknown')}`;
