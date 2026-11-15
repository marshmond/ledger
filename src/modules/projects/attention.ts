/**
 * Projects for "Needs you" (R1.1). READ ONLY. One item per project that `projectAttention` (todayLogic.ts) already lists on Today's Projects card, so the count equals
 * the card's. The reasons are the card's own phrases (`attentionPhrases`: "2 milestones overdue", "5 days past target"). Archived, cancelled, completed and
 * on-hold projects never appear (the source decides). Individual tasks stay in Today's agenda, so they are not listed again here.
 *
 *   overdue milestones or tasks, or the target date has passed -> kind `overdue`, dated by the target date when there is one
 *   target date within the next 14 days (nothing overdue)       -> kind `deadline`, dated by the target date
 */
import { db, type FinanceDB } from '../../db';
import { type AttentionItem } from '../../core/attention';
import { liveAttention } from '../../core/liveAttention';
import { loadTasks } from '../tasks/data';
import { loadProjects } from './data';
import { attentionPhrases, projectAttention, type Attention } from './todayLogic';

const MODULE = 'projects';

export function projectsAttentionItems(list: Attention[]): AttentionItem[] {
  return list.map((a): AttentionItem => {
    const late = a.overdueMilestones > 0 || a.overdueTasks > 0 || (a.daysToTarget !== null && a.daysToTarget < 0);
    return {
      id: `${MODULE}:project:${a.project.id}`, moduleId: MODULE, recordId: `project:${a.project.id}`, condition: null, kind: late ? 'overdue' : 'deadline', date: a.project.data.targetDate ?? null,
      title: a.project.data.name, reason: `${attentionPhrases(a).join(', ')}.`.replace(/^./, (c) => c.toUpperCase()),
      href: `#/projects/${a.project.id}`, provenance: 'Projects: projects needing a look',
    };
  });
}

export async function readProjectsAttention(today: string, d: FinanceDB = db): Promise<AttentionItem[]> {
  const [projects, tasks] = await Promise.all([loadProjects(d), loadTasks(d)]);
  return projectsAttentionItems(projectAttention(projects, tasks, today));
}

export const projectsAttention = liveAttention(MODULE, (today) => readProjectsAttention(today));
