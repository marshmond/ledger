/**
 * What Today's Projects card shows. Pure (no screen, no database), so the rules are tested on their own.
 *
 * The card is a short list of ACTIVE projects (planning or in progress) that need a look, with counts, not a second copy of their
 * tasks: the individual tasks, milestones and events already appear in Today's own cards through the Tasks and Calendar providers.
 * A project appears only when one of these is true:
 *   - it has overdue milestones, or overdue ordinary tasks;
 *   - its target date has passed and it is not finished;
 *   - its target date is within the next 14 days.
 * Archived, cancelled, completed and on-hold projects never appear.
 */
import { daysBetween } from '../../lib/money';
import type { TaskRecord } from '../tasks/model';
import type { ProjectRecord } from './model';
import { summarizeWork, type Tally } from './work';

export const TARGET_SOON_DAYS = 14;
export const ACTIVE_STATUSES = ['planning', 'active'] as const;

export const isActiveProject = (p: ProjectRecord) => !p.data.archived && (ACTIVE_STATUSES as readonly string[]).includes(p.data.status);

export interface Attention {
  project: ProjectRecord;
  overdueMilestones: number;
  overdueTasks: number;
  /** Days from today to the target date (negative = already past). null when there is no target date. */
  daysToTarget: number | null;
  milestones: Tally;
  tasks: Tally;
}

export function projectAttention(projects: ProjectRecord[], tasks: TaskRecord[], today: string): Attention[] {
  const out: Attention[] = [];
  for (const project of projects) {
    if (!isActiveProject(project)) continue;
    const w = summarizeWork(tasks, project.id, today);
    const daysToTarget = project.data.targetDate ? daysBetween(project.data.targetDate, today) : null;
    const pastTarget = daysToTarget !== null && daysToTarget < 0;
    const soon = daysToTarget !== null && daysToTarget >= 0 && daysToTarget <= TARGET_SOON_DAYS;
    // A project whose every task and milestone is done and that is past target still deserves the nudge to mark it completed.
    if (w.milestones.overdue === 0 && w.tasks.overdue === 0 && !pastTarget && !soon) continue;
    out.push({ project, overdueMilestones: w.milestones.overdue, overdueTasks: w.tasks.overdue, daysToTarget, milestones: w.milestones, tasks: w.tasks });
  }
  // Most urgent first: overdue milestones, then past target, then overdue tasks, then the nearest target; name breaks ties.
  const rank = (a: Attention) => (a.overdueMilestones > 0 ? 0 : a.daysToTarget !== null && a.daysToTarget < 0 ? 1 : a.overdueTasks > 0 ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b) || (a.daysToTarget ?? 9999) - (b.daysToTarget ?? 9999) || a.project.data.name.localeCompare(b.project.data.name) || a.project.id - b.project.id);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The short phrases shown under a project's name, most important first. */
export function attentionPhrases(a: Attention): string[] {
  const out: string[] = [];
  if (a.overdueMilestones) out.push(`${plural(a.overdueMilestones, 'milestone')} overdue`);
  if (a.overdueTasks) out.push(`${plural(a.overdueTasks, 'task')} overdue`);
  if (a.daysToTarget !== null) {
    if (a.daysToTarget < 0) out.push(`${plural(-a.daysToTarget, 'day')} past target`);
    else if (a.daysToTarget <= TARGET_SOON_DAYS) out.push(a.daysToTarget === 0 ? 'Target is today' : `Target in ${plural(a.daysToTarget, 'day')}`);
  }
  return out;
}
