/**
 * The "Related bill" of a Household Services arrangement (B5, the small follow-up B4 left): READ ONLY.
 *
 * It reads the EXISTING shared `bills-for` link (a plain row in `links`, from `obligation:<n>` to `arrangement:<n>`) through the same read functions Bills uses. It invents no link,
 * writes no record, matches nothing by name, and changes nothing about the arrangement's schedule, its single visit Task, its payment history or any total.
 * If the bill the link points at is gone (deleted on another device, or not synced here yet) the link is still shown, with the plain state, never silently dropped.
 */
import { db, type FinanceDB } from '../../db';
import { todayISO } from '../../lib/money';
import { billsLinkedTo } from '../bills/crossLinks';
import { getObligation } from '../bills/data';
import { HOW_LABEL, expectedAmountOn } from '../bills/model';
import { describeSchedule } from '../bills/schedule';

export type RelatedState = 'active' | 'paused' | 'ended' | 'cancelling' | 'missing' | 'unreadable';
export interface RelatedBill {
  billId: number;
  state: RelatedState;
  title: string;
  /** Plain words, never an amount. */
  statusText: string;
  /** How it is paid and when: "Monthly on the 15th · I pay it by hand". Empty when the bill is missing. */
  arrangementText: string;
  /** The amount in force today, in cents, or null when it is not known (never zero). */
  amountCents: number | null;
  amountKind: 'fixed' | 'variable' | 'unknown' | null;
  href: string;
  /** The date a confirmed cancellation takes effect, when there is one. */
  cancelOn: string | null;
}

export async function loadRelatedBills(arrangementId: number, d: FinanceDB = db, today: string = todayISO()): Promise<RelatedBill[]> {
  const ids = [...(await billsLinkedTo(arrangementId, d))].sort((a, b) => a - b);
  const out: RelatedBill[] = [];
  for (const id of ids) {
    const ob = await getObligation(id, d);
    if (!ob) { out.push({ billId: id, state: 'missing', title: 'A bill that is not here', statusText: 'It may have been deleted on another device, or it has not reached this device yet. The link is kept.', arrangementText: '', amountCents: null, amountKind: null, href: '#/bills', cancelOn: null }); continue; }
    const data = ob.data;
    if (data.status === 'unsupported') { out.push({ billId: id, state: 'unreadable', title: data.title, statusText: 'This bill has a status this version does not understand.', arrangementText: '', amountCents: null, amountKind: null, href: `#/bills/o/${id}`, cancelOn: null }); continue; }
    const cancelOn = data.lc?.cutoffOn ?? null;
    const state: RelatedState = data.status === 'ended' ? 'ended' : data.status === 'paused' ? 'paused' : cancelOn ? 'cancelling' : 'active';
    const amt = expectedAmountOn(data, today);
    const when = describeSchedule(data.schedule);
    const how = data.payment.how === 'unknown' ? '' : HOW_LABEL[data.payment.how];
    out.push({
      billId: id, state, title: data.title,
      // the chip already says Active or Paused; words are added only where there is more to say
      statusText: state === 'ended' ? `Ended${data.endedOn ? ` on ${data.endedOn}` : ''}. Its payment history stays in Bills.` : state === 'cancelling' ? `Cancellation confirmed, effective ${cancelOn}.` : state === 'paused' ? 'Paused: no new payments are expected while it is paused.' : '',
      arrangementText: [when, how].filter(Boolean).join(' · '), amountCents: amt.cents, amountKind: amt.basis, href: `#/bills/o/${id}`, cancelOn,
    });
  }
  return out;
}
