/**
 * The Projects due provider: puts each live project's start date and target date on the Calendar as plain, read-only markers
 * ("Start: Kitchen"). Worked out when the Calendar draws; nothing is stored or copied. Milestones and project events are NOT here:
 * milestones are tasks (the Tasks provider shows them) and project events are ordinary Calendar events.
 *
 *  - Archived, cancelled and completed projects show no markers (they are not active work).
 *  - A marker whose date has passed is `handled`, so a missed target never sits in Overdue forever; Today's Projects card flags a
 *    project that is past its target instead.
 *  - A target marker is always shown, even on a day a milestone of the project is due: they are different facts (the project's end date, and a
 *    checkpoint), each is one entry with its own title, and neither record is changed.
 */
import { db, type FinanceDB } from '../../db';
import { derivedId, goTo, type DerivedItem, type DueProvider, type DueQuery } from '../../core/dueProvider';
import { loadProjects } from './data';

export const PROJECTS_LAYER_COLOR = '#8a5cc7';
/** Project states that still have dates worth showing. */
const SHOWN = new Set(['planning', 'active', 'on_hold']);

export async function projectDueItems(d: FinanceDB, q: DueQuery): Promise<DerivedItem[]> {
  const projects = (await loadProjects(d)).filter((p) => !p.data.archived && SHOWN.has(p.data.status));
  if (projects.length === 0) return [];
  const out: DerivedItem[] = [];
  const add = (id: number, name: string, kind: 'start' | 'target', date: string | null) => {
    if (!date || date < q.from || date > q.to) return;
    out.push({
      id: derivedId('projects', `${id}-${kind}`, date), sourceModule: 'projects', sourceRecordId: id,
      title: kind === 'start' ? `Start: ${name}` : `Target: ${name}`, date, allDay: true, priority: 'low',
      status: date >= q.today ? 'open' : 'handled', projectId: id,
      detail: kind === 'start' ? 'The project start date.' : 'The project target completion date.',
      openSource: () => goTo(`/projects/${id}`), sourceLabel: 'Open project',
    });
  };
  for (const p of projects) {
    add(p.id, p.data.name, 'start', p.data.startDate);
    add(p.id, p.data.name, 'target', p.data.targetDate);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

export const projectsDueProvider: DueProvider = {
  id: 'projects',
  layerName: 'Projects',
  color: PROJECTS_LAYER_COLOR,
  getDueItems: (q) => projectDueItems(db, q),
};
