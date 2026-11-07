/**
 * The PRIMARY LABEL of one billing period (B2, B0 6.5): one pure function with a fixed precedence. The first line that applies wins, so a
 * period always gets exactly one label. Timing, amounts and payment evidence are derived separately and are only INPUTS here.
 *
 * What it will not do (tested over every combination):
 *   - never say "Paid" while an amount remains, never say "Overdue" or "Not confirmed paid" when payment is recorded or declared
 *   - never call an automatic payment overdue, and never claim one succeeded (it is only "scheduled")
 *   - never use a settlement word ("settled", "received", "bank-confirmed"). B3 reads Finance, and quotes ONLY Finance's own status words
 *     ("Recorded in Finance: pending / cleared / reconciled", see payments.ts): those are the owner's own marks, never bank settlement
 *   - "Overdue" needs a recorded invoice, a bill paid by hand (or not sure how) and no evidence; an unmatched bill past its date is only
 *     "Not confirmed paid" (Ledger does not know it is unpaid, only that nothing is recorded)
 */
import { AUTOPAY_GRACE_DAYS, type TimingClass } from './timing';

export type LabelId =
  | 'skipped' | 'no-payment-due' | 'no-payment-expected'
  | 'paid' | 'partly-paid' | 'payment-recorded' | 'marked-paid' | 'marked-paid-short' | 'needs-review'
  | 'scheduled-auto' | 'autopay-check'
  | 'upcoming' | 'due-soon' | 'due-today' | 'overdue' | 'not-confirmed' | 'date-unclear';

export interface LabelInput {
  /** An effective skip record exists. */
  skip: boolean;
  /** Owed in cents, or null when unknown (no basis, or the invoices disagree). */
  owed: number | null;
  /** True when owed comes from a recorded invoice (or credit against one), not an expectation. */
  owedFromBill: boolean;
  /** Typed amount paid outside Finance (0 when none or when two typed amounts disagree). */
  paid: number;
  remaining: number | null;
  /** A declaration without an amount (paid in full, or paid outside with no amount). */
  declared: boolean;
  /** B3: a declaration that live Finance contradicts (a linked payment is missing, changed in structure or reversed, and nothing is counted). */
  suspended: boolean;
  /** B3: the amount paid comes from linked Finance payments (not a typed amount). */
  fromFinance?: boolean;
  /** B3: an explicit "paid in full" declaration is recorded (not merely "paid outside, no amount"). */
  declaredFull?: boolean;
  timing: TimingClass;
  days: number | null;
  how: 'auto' | 'manual' | 'unknown';
  invoiceRecorded: boolean;
  graceDays?: number;
}

export function primaryLabel(i: LabelInput): LabelId {
  const evidence = i.paid > 0 || i.declared;
  if (i.skip && !evidence) return 'skipped'; // P1
  if (i.owed === 0 && i.paid <= 0) return i.owedFromBill ? 'no-payment-due' : 'no-payment-expected'; // P2
  // B0 C4: the owner declared it paid in full but Finance shows less. Their statement is respected and the difference is stated, never hidden
  if (i.fromFinance && i.declaredFull && !i.suspended && i.paid > 0 && i.owed !== null && (i.remaining ?? 0) > 0) return 'marked-paid-short';
  if (i.paid > 0 && i.owed !== null) return (i.remaining ?? 0) === 0 ? 'paid' : 'partly-paid'; // P3, P4
  if (i.paid > 0) return 'payment-recorded'; // P5
  if (i.declared && !i.suspended) return 'marked-paid'; // P6
  if (i.declared && i.suspended) return 'needs-review'; // P7 (B3)
  const grace = i.graceDays ?? AUTOPAY_GRACE_DAYS;
  if (i.timing === 'unclear') return 'date-unclear'; // P15
  if (i.how === 'auto') return i.timing === 'past' && i.days !== null && i.days < -grace ? 'autopay-check' : 'scheduled-auto'; // P8, P9
  if (i.timing === 'upcoming') return 'upcoming'; // P10
  if (i.timing === 'soon') return 'due-soon'; // P11
  if (i.timing === 'today') return 'due-today'; // P12
  return i.invoiceRecorded ? 'overdue' : 'not-confirmed'; // P13, P14
}

export const LABEL_TEXT: Record<LabelId, string> = {
  skipped: 'Skipped', 'no-payment-due': 'No payment due', 'no-payment-expected': 'No payment expected',
  paid: 'Paid', 'partly-paid': 'Partly paid', 'payment-recorded': 'Payment recorded', 'marked-paid': 'Marked paid by you (no amount recorded)', 'marked-paid-short': 'Marked paid in full by you; Finance shows less', 'needs-review': 'Needs review: a payment you marked is no longer supported by Finance',
  'scheduled-auto': 'Scheduled for automatic payment', 'autopay-check': 'Autopay not yet seen in Finance, please check',
  upcoming: 'Upcoming', 'due-soon': 'Due soon', 'due-today': 'Due today', overdue: 'Overdue (billed, no payment recorded)', 'not-confirmed': 'Not confirmed paid', 'date-unclear': 'Due date unclear',
};

/** Labels that still need the household's attention or a payment (everything that is neither settled, skipped nor merely scheduled for autopay). */
export const OPEN_LABELS: ReadonlySet<LabelId> = new Set(['upcoming', 'due-soon', 'due-today', 'overdue', 'not-confirmed', 'date-unclear', 'scheduled-auto', 'autopay-check', 'partly-paid']);
/** Labels that mean something is recorded as dealt with (paid, declared, skipped, nothing due). */
export const SETTLED_LABELS: ReadonlySet<LabelId> = new Set(['skipped', 'no-payment-due', 'no-payment-expected', 'paid', 'payment-recorded', 'marked-paid', 'marked-paid-short']);

/** The mandatory second line under a label: what Ledger actually knows, with no claim about a bank. */
export function evidenceLine(l: LabelId): string {
  switch (l) {
    case 'paid': case 'partly-paid': case 'payment-recorded': return 'You recorded this as paid outside Finance. Ledger has not checked it against a bank or Finance.';
    case 'marked-paid-short': return 'You declared it paid in full. Finance shows less than the bill; the difference is shown, not hidden.';
    case 'marked-paid': return 'You declared it paid, with no amount. Nothing is counted as money paid.';
    case 'skipped': return 'You recorded that this period was not billed.';
    case 'no-payment-due': return 'The bill is recorded as zero (or fully covered by a credit), so nothing is owed.';
    case 'no-payment-expected': return 'The expected amount is zero. No bill is recorded, so this is a forecast, not a confirmed fact.';
    case 'scheduled-auto': return 'Automatic payment is only an expectation. No payment is recorded in Ledger.';
    case 'autopay-check': return 'No payment is linked from Finance or recorded here. An automatic payment may not have happened, or may not be in Finance yet.';
    case 'overdue': return 'A bill is recorded and no payment is recorded. Ledger does not know whether it was paid elsewhere.';
    case 'not-confirmed': return 'No payment is recorded. Ledger does not know whether it was paid.';
    case 'date-unclear': return 'Two different due dates are recorded, or none is known.';
    case 'needs-review': return 'You marked this paid, but the Finance payment linked to it is missing, changed or was reversed, so nothing is counted until you look.';
    default: return 'No payment is recorded.';
  }
}
