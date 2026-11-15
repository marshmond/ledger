/**
 * Household finances for "Needs you" (R1.1). READ ONLY. Exactly what the Today card "Household finances" counts (`todayCounts` in overview.ts), item by item, from the
 * same `loadHouseholdOverview`: payments that may be recorded twice across modules, a bill and a service that may be one expense, and expected payments in the next 30
 * days whose amount is not known. Nothing is recomputed here.
 *
 * Deliberately NOT repeated here: the Needs-review page also lists lifecycle items (they are the Bills read model's own items, which the Bills source already
 * raises, so listing them again would show one condition twice), evidence items (Bills, Services and Home & Assets each raise their own), and informational
 * notes (nothing is wrong). Titles are record names; reasons are plain words. No amount.
 */
import { db, type FinanceDB } from '../../db';
import { attentionPlural as plural, type AttentionItem } from '../../core/attention';
import { liveAttention } from '../../core/liveAttention';
import { loadHouseholdOverview, todayCounts } from './overview';
import type { HouseholdOverview } from './overview';

const MODULE = 'household';
const WHERE = 'Household finances';

export function householdAttentionItems(o: HouseholdOverview): AttentionItem[] {
  const out: AttentionItem[] = [];
  for (const r of o.lifetime.review.filter((x) => x.kind === 'possible-duplicate')) {
    out.push({
      id: `${MODULE}:duplicate:${r.id}`, moduleId: MODULE, recordId: null, condition: null, kind: 'review', date: null,
      title: r.records[0]?.title ?? 'A payment recorded twice', reason: 'A payment may be recorded in more than one place. Both stay counted until you decide.',
      href: '#/household', provenance: `${WHERE}: payments that may be recorded twice`,
    });
  }
  for (const c of o.commitments.twelve.consolidations.filter((x) => x.status !== 'folded')) {
    out.push({
      id: `${MODULE}:overlap:${c.billId}:${c.arrangementId}`, moduleId: MODULE, recordId: `bill:${c.billId}`, condition: null, kind: 'review', date: null,
      title: `${c.billTitle} and ${c.arrangementTitle}`, reason: 'A bill and a household service may describe the same expense.',
      href: '#/household', provenance: `${WHERE}: a bill and a service that may be one expense`,
    });
  }
  const unknown = todayCounts(o).unknownSoon;
  if (unknown > 0) {
    out.push({
      id: `${MODULE}:unknown-amounts`, moduleId: MODULE, recordId: null, condition: null, kind: 'review', date: null,
      title: 'Expected payments with no known amount', reason: `${plural(unknown, 'expected payment has', 'expected payments have')} no known amount in the next 30 days.`,
      href: '#/household', provenance: `${WHERE}: expected payments in the next 30 days`, count: unknown,
    });
  }
  return out;
}

export async function readHouseholdAttention(today: string, d: FinanceDB = db): Promise<AttentionItem[]> {
  return householdAttentionItems(await loadHouseholdOverview('all', today, d));
}

export const householdAttention = liveAttention(MODULE, (today) => readHouseholdAttention(today));
