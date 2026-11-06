import { useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { TodayCardDef, TodayCardProps } from '../../core/registry';
import { loadTasks } from '../tasks/data';
import { loadProjects } from './data';
import { attentionPhrases, projectAttention } from './todayLogic';

const MAX_ROWS = 4;

/**
 * "Projects": active projects that need a look (overdue milestones or tasks, a target date that is near or past). Counts and a link
 * into the project only. The individual tasks and events already appear in Today's other cards, so none is listed twice here.
 */
function ProjectsCard({ today, reportEmpty }: TodayCardProps) {
  const projects = useLiveQuery(() => loadProjects(), []);
  const tasks = useLiveQuery(() => loadTasks(), []);
  const list = useMemo(() => (projects && tasks ? projectAttention(projects, tasks, today) : []), [projects, tasks, today]);
  const ready = !!projects && !!tasks;
  useEffect(() => { reportEmpty(ready && list.length === 0); }, [ready, list.length, reportEmpty]);
  const shown = list.slice(0, MAX_ROWS);
  return (
    <section className="card" aria-label="Projects needing attention">
      <div className="card-head"><strong>Projects</strong>{list.length > 0 && <span className="badge">{list.length}</span>}<a className="card-link" href="#/projects">All projects</a></div>
      {!ready ? <p className="muted" style={{ margin: 0 }}>Loading…</p> : (
        <>
          <ul className="plain td-list">
            {shown.map((a) => {
              const ms = a.milestones.total ? `Milestones ${a.milestones.done}/${a.milestones.total}` : '';
              const tk = a.tasks.total ? `Tasks ${a.tasks.done}/${a.tasks.total}` : '';
              return (
                <li key={a.project.id} className="td-proj">
                  <a href={`#/projects/${a.project.id}`}><strong>{a.project.data.name}</strong></a>
                  <span className="td-proj-phrases">{attentionPhrases(a).map((p, i) => <span key={i} className={/overdue|past/.test(p) ? 'tk-late' : ''}>{p}</span>)}</span>
                  {(ms || tk) && <span className="muted small">{[ms, tk].filter(Boolean).join(' · ')}</span>}
                </li>
              );
            })}
          </ul>
          {list.length > shown.length && <p className="td-older"><a href="#/projects">{list.length - shown.length} more {list.length - shown.length === 1 ? 'project' : 'projects'} need a look</a></p>}
        </>
      )}
    </section>
  );
}

export const PROJECTS_TODAY_CARDS: TodayCardDef[] = [
  { id: 'projects.attention', title: 'Projects', defaultWidth: 'half', priority: 35, hideWhenEmpty: true, Component: ProjectsCard },
];
