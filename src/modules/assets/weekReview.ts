/**
 * Home & Assets for the weekly review (R1.2). READ ONLY. The rows are the Overview's own `upcoming` maintenance (the same reader the Overview page and the Today
 * card use); nothing is recalculated. The overview exposes its next six rows, and the review uses only what it returns.
 */
import { todayISO } from '../../lib/money';
import type { WeekMaintenance } from '../../core/weekReaders';
import type { Overview } from './overview';
import { loadOverview } from './overviewData';

export const maintenanceOf = (o: Pick<Overview, 'upcoming'>): WeekMaintenance[] => o.upcoming.map((m) => ({ taskId: m.taskId, title: m.title, dueDate: m.dueDate, overdue: m.overdue, href: `#/assets/${m.assetIds[0]}` }));

export async function readWeekMaintenance(today: string = todayISO()): Promise<WeekMaintenance[]> {
  return maintenanceOf(await loadOverview('all', today));
}
