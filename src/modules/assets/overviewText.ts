/** The plain-words "needs attention" lines, shared by the Overview page and the Today card so the two always say the same thing. Counts only: no names, amounts or private details. */
import { attentionTotal, type Attention } from './overview';
import { SOON_DAYS } from './warranty';

export interface AttentionRow { id: string; text: string; hint?: string; href: string }

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function attentionRows(a: Attention): AttentionRow[] {
  const rows: AttentionRow[] = [];
  if (a.overdueTasks.length) {
    const assets = a.overdueAssetIds.length;
    rows.push({ id: 'overdue', href: '#/assets', text: `Maintenance is overdue on ${assets} ${plural(assets, 'asset', 'assets')}`, hint: `${a.overdueTasks.length} ${plural(a.overdueTasks.length, 'task', 'tasks')}, listed in Tasks` });
  }
  if (a.expiringWarranties.length) {
    const n = a.expiringWarranties.length;
    rows.push({ id: 'warranty', href: '#/assets', text: `${n} ${plural(n, 'warranty ends', 'warranties end')} within ${SOON_DAYS} days` });
  }
  if (a.unsaved.length) {
    const n = a.unsaved.length;
    rows.push({ id: 'unsaved', href: '#/assets', text: `${n} completed ${plural(n, 'task is', 'tasks are')} not saved to service history` });
  }
  if (a.duplicateJobs) rows.push({ id: 'dup', href: '#/assets', text: `${a.duplicateJobs} ${plural(a.duplicateJobs, 'job is', 'jobs are')} saved twice in service history` });
  if (a.orphans) rows.push({ id: 'orphans', href: '#/assets/list', text: `${a.orphans} ${plural(a.orphans, 'record points', 'records point')} at an asset that is not here` });
  if (a.reviewRefs) rows.push({ id: 'review', href: '#/assets', text: `${a.reviewRefs} linked ${plural(a.reviewRefs, 'payment needs', 'payments need')} a second look`, hint: 'Left out of the totals until fixed' });
  return rows;
}

export { attentionTotal };
