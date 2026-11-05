import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from '../../core/router';
import { dayLabel } from '../../core/time';
import { formatCents } from '../../lib/money';
import { EmptyState } from '../../ui/components';
import { useToast } from '../../ui/Toast';
import BudgetLines from './BudgetLines';
import { archiveProject, getProject, loadBudgetLines, restoreProject, setProjectStatus } from './data';
import ProjectForm from './ProjectForm';
import { budgetSummary, STATUSES, STATUS_LABEL, type ProjectStatus } from './model';
import Vendors from './Vendors';

/** One project: its details, the budget against its lines, the budget lines, and the vendors. */
export default function ProjectPage() {
  const toast = useToast();
  const { id } = useParams();
  const pid = /^\d+$/.test(id ?? '') ? Number(id) : NaN;
  const project = useLiveQuery(async () => (Number.isNaN(pid) ? null : (await getProject(pid)) ?? null), [pid]);
  const lines = useLiveQuery(() => (Number.isNaN(pid) ? [] : loadBudgetLines(pid)), [pid]) ?? [];
  const [editing, setEditing] = useState(false);

  if (project === undefined) return <p className="muted">Loading…</p>;
  if (project === null) {
    return (
      <div className="pj">
        <EmptyState title="This project does not exist" action={<Link to="/" className="btn">Back to projects</Link>}>It may have been removed on another device.</EmptyState>
      </div>
    );
  }
  const d = project.data;
  const b = budgetSummary(d.budgetCents, lines);

  return (
    <div className="pj">
      <p className="pj-back"><Link to="/">← Projects</Link></p>
      <header className="pj-head">
        <div className="pj-head-text">
          <h1>{d.name}</h1>
          <p className="pj-head-meta">
            <span className={`pj-status s-${d.status}`}>{STATUS_LABEL[d.status]}</span>
            {d.archived && <span className="pj-status s-archived">Archived</span>}
            {d.startDate && <span className="muted small">Starts {dayLabel(d.startDate, { year: true })}</span>}
            {d.targetDate && <span className="muted small">Target {dayLabel(d.targetDate, { year: true })}</span>}
          </p>
        </div>
        <div className="pj-head-actions">
          <label className="pj-statuspick">
            <span className="sr-only">Status</span>
            <select value={d.status} onChange={(e) => void setProjectStatus(project.id, e.target.value as ProjectStatus).then(() => toast(`Status: ${STATUS_LABEL[e.target.value as ProjectStatus]}`))} aria-label="Status">
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <button className="btn" onClick={() => setEditing(true)}>Edit</button>
          {d.archived
            ? <button className="btn" onClick={() => void restoreProject(project.id).then(() => toast('Project restored'))}>Restore</button>
            : <button className="btn" onClick={() => void archiveProject(project.id).then(() => toast('Project archived', async () => { await restoreProject(project.id); }))}>Archive</button>}
        </div>
      </header>

      <section className="pj-summary" aria-label="Budget summary">
        <div className="pj-stat"><span className="muted small">{b.derived ? 'Budget (total of lines)' : 'Overall budget'}</span><strong>{formatCents(b.budgetCents)}</strong></div>
        <div className="pj-stat"><span className="muted small">Planned in lines</span><strong>{formatCents(b.plannedTotalCents)}</strong></div>
        {!b.derived && (
          <div className="pj-stat"><span className="muted small">{b.notYetPlannedCents < 0 ? 'Lines over budget by' : 'Not planned yet'}</span><strong className={b.notYetPlannedCents < 0 ? 'neg' : ''}>{formatCents(Math.abs(b.notYetPlannedCents))}</strong></div>
        )}
      </section>

      {d.notes && <section className="card pj-card"><h2>Notes</h2><p className="pj-notes">{d.notes}</p></section>}

      <BudgetLines projectId={project.id} budgetCents={d.budgetCents} lines={lines} />
      <Vendors projectId={project.id} vendorIds={d.vendorContactIds} />

      {editing && <ProjectForm project={project} onClose={() => setEditing(false)} />}
    </div>
  );
}
