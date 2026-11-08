/**
 * NEEDS REVIEW ACROSS MODULES (B5). PURE, conservative and explainable. It lists what a person might want to look at and says which KIND of thing each is:
 *   - informational     one payment legitimately supports several records (nothing is wrong, nothing is double-counted);
 *   - possible duplicate  a typed amount and a Finance payment that may be one payment (both stay counted until the owner decides);
 *   - confirmed duplicate the owner explicitly linked two records as one job, and the second typed amount is already left out;
 *   - missing evidence  a linked payment that is gone or no longer matches, an amount with no figure, two typed amounts that disagree;
 *   - contractual overlap two records (a bill and a service arrangement) that may describe one expense;
 *   - lifecycle         subscription dates and cancellations that need a look.
 * It never repairs anything and offers no writer: every item links to the record that owns the fix (the module's own, already-previewed, undoable actions).
 * Nothing here is invented: the lifecycle items are the Bills read model's own attention items, the sharing and evidence items come from the recorded-spending union,
 * and the overlap items come from the commitments reader. The only new rule is "a confirmed cancellation date while a linked arrangement still expects visits after it".
 */
import { daysBetween } from '../../lib/money';
import type { AttentionCategory, Derived } from '../bills/readModel';
import { attention } from '../bills/readModel';
import type { ScheduleState } from '../services/expectedCharges';
import type { ArrangementRecord } from '../services/model';
import { servicesRows, type HouseholdCommitments } from './commitments';
import type { ReviewClass } from './model';
import type { RecordedAcrossModules } from './unionSpend';

export interface ReviewItem { id: string; class: ReviewClass; text: string; links: { label: string; href: string }[] }

/** The Bills attention categories that are about a subscription's dates, cancellations and the evidence around them (the same items the Bills Needs-review page shows). */
const LIFECYCLE: AttentionCategory[] = ['lifecycleConflict', 'cancelAwaiting', 'afterCancel', 'scheduledAfterEnd', 'passedDates'];
const CLASS_ORDER: ReviewClass[] = ['possible-duplicate', 'missing-evidence', 'contractual-overlap', 'lifecycle', 'confirmed-duplicate', 'informational'];

export interface ReviewInput {
  lifetime: RecordedAcrossModules;
  commitments: HouseholdCommitments;
  bills: Derived;
  arrangements: ArrangementRecord[];
  state: Map<number, ScheduleState>;
  serviceLinks: Map<number, number[]>;
  today: string;
}

export function householdReview(i: ReviewInput): ReviewItem[] {
  const out: ReviewItem[] = [];
  const uniq = (links: { label: string; href: string }[]) => links.filter((l, n) => links.findIndex((x) => x.href === l.href) === n).slice(0, 4);

  for (const r of i.lifetime.review) out.push({ id: `u:${r.id}`, class: r.class, text: r.text, links: uniq(r.records.map((x) => ({ label: x.title, href: x.href }))) });

  // a bill and an arrangement that are linked but cannot safely be treated as one expense (twelve-month view; the windows show their own status beside the rows)
  for (const c of i.commitments.twelve.consolidations) {
    const links = [{ label: c.billTitle, href: `#/bills/o/${c.billId}` }, { label: c.arrangementTitle, href: `#/services/a/${c.arrangementId}` }];
    if (c.status === 'folded') out.push({ id: `o:${c.billId}:${c.arrangementId}`, class: 'informational', text: `${c.billTitle} (Bills) and ${c.arrangementTitle} (Household Services) are linked and their yearly totals are equal, so they are treated as one expense and counted once.`, links });
    else out.push({ id: `o:${c.billId}:${c.arrangementId}`, class: 'contractual-overlap', text: `${c.billTitle} (Bills) and ${c.arrangementTitle} (Household Services) are linked. ${c.reason}`, links });
  }

  // lifecycle: the Bills read model's own items (already worded, no amounts)
  const a = attention(i.bills);
  for (const it of a.items) {
    if (!LIFECYCLE.includes(it.category)) continue;
    out.push({ id: `l:${it.id}`, class: 'lifecycle', text: it.text, links: it.obligationId !== null ? [{ label: 'Open the bill', href: `#/bills/o/${it.obligationId}` }] : [] });
  }

  // a CONFIRMED cancellation date, while a linked arrangement still expects visits after it
  const horizon = daysBetween(i.commitments.twelve.to, i.today);
  for (const ob of i.bills.snap.obligations) {
    const cut = ob.data.lc?.cutoffOn;
    if (!cut || ob.data.status === 'ended') continue;
    for (const arrId of i.serviceLinks.get(ob.id) ?? []) {
      const arr = i.arrangements.find((x) => x.id === arrId && x.data.status === 'active');
      if (!arr) continue;
      if (servicesRows({ arrangements: [arr], state: i.state }, i.today, horizon).rows.some((r) => r.date > cut)) {
        out.push({ id: `c:${ob.id}:${arrId}`, class: 'lifecycle', text: `${ob.data.title} is confirmed to end on ${cut}, but the linked arrangement ${arr.data.title} is still active and may expect visits after that date. Check that both say the same thing.`, links: [{ label: ob.data.title, href: `#/bills/o/${ob.id}` }, { label: arr.data.title, href: `#/services/a/${arrId}` }] });
      }
    }
  }

  return out.sort((x, y) => CLASS_ORDER.indexOf(x.class) - CLASS_ORDER.indexOf(y.class) || x.id.localeCompare(y.id, 'en', { numeric: true }));
}
