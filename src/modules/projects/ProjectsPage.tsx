import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from '../../core/router';
import { dayLabel } from '../../core/time';
import { formatCents } from '../../lib/money';
import { EmptyState, PageHeader } from '../../ui/components';
import { todayISO } from '../../lib/money';
import { useToday } from '../../ui/useToday';
import { loadTasks } from '../tasks/data';
import { loadAllBudgetLines, loadProjects } from './data';
import { progressChips, summarizeWork } from './work';
import ProjectForm from './ProjectForm';
import { budgetSummary, OPEN_STATUSES, STATUS_LABEL, type ProjectRecord } from './model';

type Tab = 'open' | 'finished' | 'archived' | 'all';
const TABS: { id: Tab; label: string; show: (p: ProjectRecord) => boolean }[] = [
  { id: 'open', label: 'Open', show: (p) => !p.data.archived && OPEN_STATUSES.includes(p.data.status) },
  { id: 'finished', label: 'Finished', show: (p) => !p.data.archived && !OPEN_STATUSES.includes(p.data.status) },
  { id: 'archived', label: 'Archived', show: (p) => p.data.archived },
  { id: 'all', label: 'All', show: () => true },
];
const EMPTY: Record<Tab, string> = {
  open: 'No open projects. A project holds a budget made of lines, and the vendors involved.',
  finished: 'No completed or cancelled projects.',
  archived: 'Nothing is archived.',
  all: 'No projects yet.',
};

const dates = (p: ProjectRecord) => {
  const { startDate: a, targetDate: b } = p.data;
  if (a && b) return `${dayLabel(a, { year: true })} to ${dayLabel(b, { year: true })}`;
  if (b) return `Target ${dayLabel(b, { year: true })}`;
  if (a) return `Starts ${dayLabel(a, { year: true })}`;
  return '';
};

export default function ProjectsPage() {
  const nav = useNavigate();
  const projects = useLiveQuery(() => loadProjects(), []);
  const lines = useLiveQuery(() => loadAllBudgetLines(), []) ?? [];
  const allTasks = useLiveQuery(() => loadTasks(), []) ?? [];
  const today = useToday() || todayISO();
  const [tab, setTab] = useState<Tab>('open');
  const [creating, setCreating] = useState(false);

  const byProject = useMemo(() => {
    const m = new Map<number, typeof lines>();
    for (const l of lines) m.set(l.data.projectId, [...(m.get(l.data.projectId) ?? []), l]);
    return m;
  }, [lines]);
  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.id, (projects ?? []).filter(t.show).length])) as Record<Tab, number>, [projects]);
  const shown = (projects ?? []).filter(TABS.find((t) => t.id === tab)!.show);

  return (
    <div className="pj">
      <PageHeader
        title="Projects"
        description="Renovations, trips and other big jobs: a budget made of lines, and the people involved."
        actions={<button className="btn primary" onClick={() => setCreating(true)}>New project</button>}
      />
      <div className="pj-tabs" role="tablist" aria-label="Show">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label} <span className="count">{counts[t.id]}</span>
          </button>
        ))}
      </div>

      {projects === undefined ? (
        <p className="muted">Loading…</p>
      ) : shown.length === 0 ? (
        <EmptyState title={projects.length === 0 ? 'No projects yet' : 'Nothing here'} action={tab === 'open' || projects.length === 0 ? <button className="btn primary" onClick={() => setCreating(true)}>New project</button> : undefined}>
          {EMPTY[tab]}
        </EmptyState>
      ) : (
        <ul className="plain pj-list">
          {shown.map((p) => {
            const ls = byProject.get(p.id) ?? [];
            const b = budgetSummary(p.data.budgetCents, ls);
            return (
              <li key={p.id}>
                <Link to={`/${p.id}`} className="pj-row">
                  <span className="pj-row-main">
                    <strong>{p.data.name}</strong>
                    <span className="pj-row-sub muted small">{[dates(p), `${ls.length} budget ${ls.length === 1 ? 'line' : 'lines'}`, `${p.data.vendorContactIds.length} ${p.data.vendorContactIds.length === 1 ? 'vendor' : 'vendors'}`].filter(Boolean).join(' · ')}</span>
                    <span className="pj-chips" aria-label="Progress">
                      {progressChips(summarizeWork(allTasks, p.id, today), !p.data.archived && OPEN_STATUSES.includes(p.data.status)).map((c) => <span key={c.text} className={`pj-chip ${c.tone ?? ''}`}>{c.text}</span>)}
                    </span>
                  </span>
                  <span className="pj-row-side">
                    <span className={`pj-status s-${p.data.status}`}>{STATUS_LABEL[p.data.status]}</span>
                    {p.data.archived && <span className="pj-status s-archived">Archived</span>}
                    <span className="pj-amount">{b.budgetCents > 0 || !b.derived ? formatCents(b.budgetCents) : 'No budget yet'}</span>
                    {b.derived && b.budgetCents > 0 && <span className="muted small">from lines</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {creating && <ProjectForm onClose={() => setCreating(false)} onSaved={(id) => nav(`/${id}`)} />}
    </div>
  );
}
