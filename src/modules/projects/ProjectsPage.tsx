import { useMemo, useState } from 'react';
import { rovingKeys } from '../../ui/rovingKeys';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from '../../core/router';
import { dayLabel } from '../../core/time';
import { db } from '../../db';
import { formatCents } from '../../lib/money';
import { loadProjectSummary } from '../../lib/txnProject';
import { EmptyState, PageHeader } from '../../ui/components';
import { StatusChip } from '../../ui/StatusChip';
import { todayISO } from '../../lib/money';
import { useToday } from '../../ui/useToday';
import { loadTasks } from '../tasks/data';
import { loadAllBudgetLines, loadProjects } from './data';
import { progressChips, summarizeWork } from './work';
import ProjectForm from './ProjectForm';
import { groupProjects, isLive, progressTone, STATUS_TONE } from './presentation';
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

/** The Projects overview: filter tabs, then one card per project (grouped by status on the Open tab) with its status, progress and money at a glance. */
export default function ProjectsPage() {
  const nav = useNavigate();
  const projects = useLiveQuery(() => loadProjects(), []);
  const lines = useLiveQuery(() => loadAllBudgetLines(), []) ?? [];
  const allTasks = useLiveQuery(() => loadTasks(), []) ?? [];
  // The same Finance-based summary the project page uses, so "Agreed" and "Paid" here are the very figures shown there.
  const money = useLiveQuery(async () => {
    const m = new Map<number, { agreed: number; paid: number }>();
    for (const p of await loadProjects()) {
      const s = await loadProjectSummary(db, p.id);
      if (s) m.set(p.id, { agreed: s.agreedCents, paid: s.paidCents });
    }
    return m;
  }, []);
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
  const groups = groupProjects(shown, tab === 'open');

  const card = (p: ProjectRecord) => {
    const ls = byProject.get(p.id) ?? [];
    const b = budgetSummary(p.data.budgetCents, ls);
    const mm = money?.get(p.id);
    const meta = [dates(p), `${ls.length} budget ${ls.length === 1 ? 'line' : 'lines'}`, `${p.data.vendorContactIds.length} ${p.data.vendorContactIds.length === 1 ? 'vendor' : 'vendors'}`].filter(Boolean).join(' · ');
    return (
      <li key={p.id}>
        <Link to={`/${p.id}`} className="pj-pcard">
          <span className="pj-pcard-top">
            <strong className="pj-pcard-title">{p.data.name}</strong>
            <span className="pj-pcard-status">
              <StatusChip tone={STATUS_TONE[p.data.status]}>{STATUS_LABEL[p.data.status]}</StatusChip>
              {p.data.archived && <StatusChip>Archived</StatusChip>}
            </span>
          </span>
          <span className="pj-pcard-meta">{meta}</span>
          <span className="pj-chips" aria-label="Progress">
            {progressChips(summarizeWork(allTasks, p.id, today), isLive(p)).map((c) => <StatusChip key={c.text} tone={progressTone(c.tone)} icon={false}>{c.text}</StatusChip>)}
          </span>
          <span className="pj-pcard-figs">
            <span className="pj-fig">
              <span className="pj-fig-label">Budget</span>
              <span className="pj-fig-value">{b.budgetCents > 0 || !b.derived ? formatCents(b.budgetCents) : 'No budget yet'}</span>
              {b.derived && b.budgetCents > 0 && <span className="pj-fig-note">from lines</span>}
            </span>
            {mm && (
              <>
                <span className="pj-fig"><span className="pj-fig-label">Agreed</span><span className="pj-fig-value">{formatCents(mm.agreed)}</span></span>
                <span className="pj-fig"><span className="pj-fig-label">Paid so far</span><span className="pj-fig-value">{formatCents(mm.paid)}</span></span>
              </>
            )}
          </span>
        </Link>
      </li>
    );
  };

  return (
    <div className="pj">
      <PageHeader
        title="Projects"
        description="Renovations, trips and other big jobs: a budget made of lines, and the people involved."
        actions={<button className="btn primary" onClick={() => setCreating(true)}>New project</button>}
      />
      <div className="ui-seg pj-tabs" role="tablist" aria-label="Show" onKeyDown={rovingKeys}>
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} tabIndex={(tab === t.id) ? 0 : -1} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
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
        <ul className="plain pj-grid">{groups.flatMap((g) => g.projects).map(card)}</ul>
      )}

      {creating && <ProjectForm onClose={() => setCreating(false)} onSaved={(id) => nav(`/${id}`)} />}
    </div>
  );
}
