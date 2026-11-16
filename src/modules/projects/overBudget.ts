/**
 * Projects that are over budget (R1.2). READ ONLY. A small list built on the SAME summary the project page and the Projects list use (`loadProjectSummary`),
 * and on that summary's own `flags.overBudget` ("expected total cost is more than the budget"). No project figure is recalculated here: the amounts are the
 * summary's `expectedTotalCents` and `budgetCents`, and the "over by" figure is their difference, exactly as the project page words it.
 *
 * Only projects that are still going (`isActiveProject`: planning or active, not archived) are listed, and only when a budget is actually set
 * (a budget of zero is "no budget", never "over budget by everything"). Nothing is written.
 */
import { db, type FinanceDB } from '../../db';
import type { ProjectSummary } from '../../lib/txnProject';
import { loadProjectSummary } from '../../lib/txnProject';
import { loadProjects } from './data';
import type { ProjectRecord } from './model';
import { isActiveProject } from './todayLogic';

export interface OverBudgetProject {
  id: number;
  name: string;
  budgetCents: number;
  expectedTotalCents: number;
  /** expected total minus budget; always above zero. */
  overCents: number;
  /** True when the project has no overall budget, so its budget is the total of its budget lines (the project page words it the same way). */
  budgetFromLines: boolean;
  href: string;
}

/** Pure: which of these projects are over budget, given each one's summary. Most over first, then by name and id. */
export function overBudgetOf(projects: readonly ProjectRecord[], summaries: ReadonlyMap<number, ProjectSummary | null>): OverBudgetProject[] {
  const out: OverBudgetProject[] = [];
  for (const p of projects) {
    if (!isActiveProject(p)) continue;
    const s = summaries.get(p.id);
    if (!s || !s.flags.overBudget || s.budgetCents <= 0) continue;
    out.push({ id: p.id, name: p.data.name, budgetCents: s.budgetCents, expectedTotalCents: s.expectedTotalCents, overCents: s.expectedTotalCents - s.budgetCents, budgetFromLines: p.data.budgetCents === null, href: `#/projects/${p.id}` });
  }
  return out.sort((a, b) => b.overCents - a.overCents || a.name.localeCompare(b.name) || a.id - b.id);
}

export async function readOverBudgetProjects(d: FinanceDB = db): Promise<OverBudgetProject[]> {
  const projects = (await loadProjects(d)).filter(isActiveProject);
  const summaries = new Map<number, ProjectSummary | null>();
  for (const p of projects) summaries.set(p.id, await loadProjectSummary(d, p.id));
  return overBudgetOf(projects, summaries);
}
