/**
 * Home & Assets for "Needs you" (R1.1). READ ONLY. Every item comes from `loadOverview(...).attention`, the SAME reader the Overview page and the Today card
 * use, so the three can never disagree; this file only dresses what that reader already found. There is no rule of its own for "overdue", "ending"
 * or "not saved". The asset names come from one extra read of the assets table (names only, no serial numbers, plates, addresses or links).
 *
 *   overdue maintenance task      -> one item per TASK (a task on three assets is one item; the same rule as the overview), kind overdue
 *   warranty ending soon (60 d)   -> one item per warranty, kind deadline (its end date)
 *   completed task not saved      -> one item per task, kind review
 *   jobs saved twice / records pointing at a missing asset / linked payments to look at again -> one counted item each, kind review
 */
import { db, type FinanceDB } from '../../db';
import { attentionPlural as plural, daysFrom, type AttentionItem } from '../../core/attention';
import { liveAttention } from '../../core/liveAttention';
import { loadAssets } from './data';
import type { Attention } from './overview';
import { loadOverview } from './overviewData';

const MODULE = 'assets';
const WHERE = 'Home & Assets overview';

export function assetsAttentionItems(a: Attention, names: ReadonlyMap<number, string>, today: string): AttentionItem[] {
  const out: AttentionItem[] = [];
  const nameOf = (ids: number[]) => ids.map((i) => names.get(i)).filter((n): n is string => !!n)[0];
  for (const t of a.overdueTasks) {
    const asset = nameOf(t.assetIds);
    const days = daysFrom(today, t.dueDate);
    out.push({
      id: `${MODULE}:task:${t.taskId}:overdue`, moduleId: MODULE, recordId: `task:${t.taskId}`, condition: `task:${t.taskId}:overdue`, kind: 'overdue', date: t.dueDate,
      title: t.title, reason: `${asset ? `The maintenance task for ${asset}` : 'A maintenance task'} is ${plural(days, 'day')} overdue.`,
      href: `#/assets/${t.assetIds[0]}`, provenance: `${WHERE}: overdue maintenance`,
    });
  }
  for (const w of a.expiringWarranties) {
    const asset = names.get(w.assetId);
    out.push({
      id: `${MODULE}:warranty:${w.warrantyId ?? `asset-${w.assetId}`}`, moduleId: MODULE, recordId: w.warrantyId === null ? `asset:${w.assetId}` : `warranty:${w.warrantyId}`, condition: null, kind: 'deadline', date: w.endDate,
      title: asset ? `${asset}: warranty ends` : 'A warranty ends soon', reason: `The warranty ends on ${w.endDate}, in ${plural(w.daysLeft, 'day')}.`,
      href: `#/assets/${w.assetId}${w.warrantyId === null ? '' : `?warranty=${w.warrantyId}`}`, provenance: `${WHERE}: warranties ending soon`,
    });
  }
  for (const u of a.unsaved) {
    out.push({
      id: `${MODULE}:task:${u.taskId}:unsaved`, moduleId: MODULE, recordId: `task:${u.taskId}`, condition: `task:${u.taskId}:unsaved-history`, kind: 'review', date: null,
      title: u.title, reason: `A completed maintenance task${nameOf(u.assetIds) ? ` for ${nameOf(u.assetIds)}` : ''} is not saved to service history.`,
      href: `#/assets/${u.assetIds[0]}`, provenance: `${WHERE}: completed tasks not saved`,
    });
  }
  if (a.duplicateJobs > 0) out.push({ id: `${MODULE}:duplicate-jobs`, moduleId: MODULE, recordId: null, condition: null, kind: 'review', date: null, title: 'Jobs saved twice in service history', reason: `${plural(a.duplicateJobs, 'job is', 'jobs are')} saved twice in service history. Nothing was merged.`, href: '#/assets', provenance: `${WHERE}: duplicate jobs`, count: a.duplicateJobs });
  if (a.orphans > 0) out.push({ id: `${MODULE}:orphans`, moduleId: MODULE, recordId: null, condition: null, kind: 'review', date: null, title: 'Records point at a missing asset', reason: `${plural(a.orphans, 'record points', 'records point')} at an asset that is not here.`, href: '#/assets/list', provenance: `${WHERE}: records without an asset`, count: a.orphans });
  if (a.reviewRefs > 0) out.push({ id: `${MODULE}:review-refs`, moduleId: MODULE, recordId: null, condition: null, kind: 'review', date: null, title: 'Linked payments need a second look', reason: `${plural(a.reviewRefs, 'linked payment needs', 'linked payments need')} a second look and ${a.reviewRefs === 1 ? 'is' : 'are'} left out of the totals until fixed.`, href: '#/assets', provenance: `${WHERE}: payments to review`, count: a.reviewRefs });
  return out;
}

/** The plain reader (also what the tests call). One overview read plus one read of asset names. */
export async function readAssetsAttention(today: string, d: FinanceDB = db): Promise<AttentionItem[]> {
  const [ov, assets] = await Promise.all([loadOverview('all', today, d), loadAssets(d)]);
  return assetsAttentionItems(ov.attention, new Map(assets.map((x) => [x.id, x.data.name])), today);
}

export const assetsAttention = liveAttention(MODULE, (today) => readAssetsAttention(today));
