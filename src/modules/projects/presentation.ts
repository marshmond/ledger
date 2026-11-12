import type { StatusTone } from '../../ui/StatusChip';
import { OPEN_STATUSES, type ProjectRecord, type ProjectStatus } from './model';

/**
 * D14. Presentation helpers for the Projects screens. Nothing here reads or writes a record, and nothing here works out money: the figures on a
 * screen come from `budgetSummary` and `loadProjectSummary`, exactly as before.
 */

/** The chip tone each status is drawn in. The word always comes with it. */
export const STATUS_TONE: Record<ProjectStatus, StatusTone> = { planning: 'info', active: 'active', on_hold: 'warning', completed: 'done', cancelled: 'neutral' };

/** The order the open projects are grouped in on the overview: what is moving first, then what is only planned, then what is paused. */
export const OPEN_GROUP_ORDER: ProjectStatus[] = ['active', 'planning', 'on_hold'];

export interface ProjectGroup { status: ProjectStatus | null; projects: ProjectRecord[] }

/**
 * Splits the open projects into one group per status (in `OPEN_GROUP_ORDER`); any other list is a single ungrouped group. Every project appears
 * exactly once, in its original relative order, so grouping can never hide or duplicate a record.
 */
export function groupProjects(projects: ProjectRecord[], grouped: boolean): ProjectGroup[] {
  if (!grouped) return projects.length ? [{ status: null, projects }] : [];
  const out: ProjectGroup[] = OPEN_GROUP_ORDER.map((status) => ({ status, projects: projects.filter((p) => p.data.status === status) })).filter((g) => g.projects.length > 0);
  const placed = new Set(out.flatMap((g) => g.projects.map((p) => p.id)));
  const rest = projects.filter((p) => !placed.has(p.id));
  if (rest.length) out.push({ status: null, projects: rest });
  return out;
}

/** True for a project that is live work (open status and not archived). */
export const isLive = (p: ProjectRecord) => !p.data.archived && OPEN_STATUSES.includes(p.data.status);

/** The chip tone for a progress chip the module's `progressChips` produced: overdue is drawn as overdue, everything else is neutral. */
export const progressTone = (tone?: string): StatusTone => (tone === 'neg' ? 'overdue' : 'neutral');
