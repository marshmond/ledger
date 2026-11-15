/**
 * Bills & Subscriptions for "Needs you" (R1.1). READ ONLY. Every item is one of the Bills read model's own attention items (`attention(derive(snapshot, today)).items`,
 * the same list the Needs-review page and the Today card count), so the number here equals the Bills card's total exactly. The source's wording is kept: its text is
 * plain words and never an amount. Nothing is recomputed.
 *
 *   dated conditions (due soon, billed with no payment recorded, partly paid, a trial or notice or renewal date) -> kind `deadline`, with the source's own date
 *   everything else (records that disagree, linked payments to look at, lifecycle and reminder-Task checks) -> kind `review`
 * The ONLY severity used is the one the source already gives: a billing record that DISAGREES with another (`conflict.severity === 'disagree'`, "neither is
 * counted until you choose") is `serious`; nothing else is promoted.
 */
import { db, type FinanceDB } from '../../db';
import { type AttentionItem } from '../../core/attention';
import { liveAttention } from '../../core/liveAttention';
import { attention, derive, loadBillsSnapshot, type AttentionCategory, type AttentionItem as BillItem, type Derived } from './readModel';

const MODULE = 'bills';
const WHERE = 'Bills & Subscriptions';

/** Categories the source ties to a date it can act on. */
const DATED: ReadonlySet<AttentionCategory> = new Set<AttentionCategory>(['dueSoon', 'notConfirmed', 'partlyPaid', 'trials', 'notices', 'renewals']);

/** The kind of item, in the words the Bills card already uses (without the count). Shown as "From:" on the full list. */
const KIND_WORDS: Record<AttentionCategory, string> = {
  dueSoon: 'bills due in the next 7 days', notConfirmed: 'bills not confirmed paid', autopayCheck: 'automatic payments not yet seen in Finance', paymentReview: 'linked payments to review',
  paymentChanged: 'linked payments that changed in Finance', partlyPaid: 'bills partly paid', typedFinance: 'a typed payment and a Finance payment for one bill', declaredShort: 'bills marked paid in full that show less in Finance',
  duplicatePieces: 'payments linked more than once', ruleShared: 'Finance scheduled payments linked to more than one bill', unconfirmedTasks: 'finished reminder Tasks not yet confirmed',
  conflicts: 'billing records that disagree', records: 'billing records that need a look', cancelAwaiting: 'cancellation requests awaiting confirmation', lifecycleConflict: 'subscription records that disagree',
  afterCancel: 'possible charges after cancellation', scheduledAfterEnd: 'Finance scheduled payments still active for an ended bill', passedDates: 'contract dates that have passed', taskProblems: 'reminder Tasks to check',
  trials: 'trials ending in 7 days', notices: 'cancel-by deadlines in 14 days', renewals: 'renewals in 30 days',
};

const sentence = (s: string) => { const t = s.trim(); const c = t.charAt(0).toUpperCase() + t.slice(1); return /[.!?]$/.test(c) ? c : `${c}.`; };

export function billsAttentionItems(x: Derived): AttentionItem[] {
  const titleOf = (id: number | null) => (id === null ? undefined : x.snap.obligations.find((o) => o.id === id)?.data.title);
  return attention(x).items.map((it: BillItem): AttentionItem => {
    const title = titleOf(it.obligationId);
    const body = title && it.text.startsWith(`${title}: `) ? it.text.slice(title.length + 2) : it.text;
    const serious = it.conflict?.severity === 'disagree';
    return {
      id: `${MODULE}:${it.id}`, moduleId: MODULE, recordId: it.obligationId === null ? null : `bill:${it.obligationId}`, condition: null,
      kind: DATED.has(it.category) ? 'deadline' : 'review', ...(serious ? { severity: 'serious' as const, sourceSeverity: 'disagree' } : {}),
      date: it.date ?? null, title: title ?? 'A bill', reason: sentence(body),
      href: it.obligationId === null ? '#/bills/review' : `#/bills/o/${it.obligationId}`, provenance: `${WHERE}: ${KIND_WORDS[it.category]}`,
    };
  });
}

export async function readBillsAttention(today: string, d: FinanceDB = db): Promise<AttentionItem[]> {
  return billsAttentionItems(derive(await loadBillsSnapshot(d), today));
}

export const billsAttention = liveAttention(MODULE, (today) => readBillsAttention(today));
