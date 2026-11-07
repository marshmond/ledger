import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from '../../core/router';
import { dayLabel } from '../../core/time';
import { db } from '../../db';
import { formatCents } from '../../lib/money';
import { loadProjectPieces, loadProjectSummary } from '../../lib/txnProject';
import { EmptyState } from '../../ui/components';
import { useToast } from '../../ui/Toast';
import BudgetLines from './BudgetLines';
import CommitmentForm, { type CommitmentDraft } from './CommitmentForm';
import Commitments from './Commitments';
import { activeSplit, creditChangeOrderDraft, type CommitmentRecord } from './commitmentModel';
import { archiveProject, getProject, loadBudgetLines, loadCommitments, restoreProject, setProjectStatus } from './data';
import Financials, { ProjectTxns } from './Financials';
import { countBrokenTags, groupContracts, projectWarnings, type Warning } from './financialView';
import DeleteProject from './DeleteProject';
import ProjectForm from './ProjectForm';
import ProjectWork from './ProjectWork';
import RelatedAssets from './RelatedAssets';
import RelatedServices from './RelatedServices';
import { budgetSummary, STATUSES, STATUS_LABEL, type ProjectStatus } from './model';
import Vendors from './Vendors';

/** One project: the money picture, what needs attention, commitments, the transactions on it, budget lines and vendors. */
export default function ProjectPage() {
  const toast = useToast();
  const { id } = useParams();
  const pid = /^\d+$/.test(id ?? '') ? Number(id) : NaN;
  const project = useLiveQuery(async () => (Number.isNaN(pid) ? null : (await getProject(pid)) ?? null), [pid]);
  const lines = useLiveQuery(() => (Number.isNaN(pid) ? [] : loadBudgetLines(pid)), [pid]) ?? [];
  const commitments = useLiveQuery(() => (Number.isNaN(pid) ? [] : loadCommitments(pid)), [pid]) ?? [];
  // Both of these read Finance's own tables, so they refresh by themselves when a transaction is added, edited, tagged or deleted.
  const summary = useLiveQuery(async () => (Number.isNaN(pid) ? null : await loadProjectSummary(db, pid)), [pid]);
  const pieces = useLiveQuery(async () => (Number.isNaN(pid) ? [] : await loadProjectPieces(db, pid)), [pid]) ?? [];
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [focusLine, setFocusLine] = useState<number | null | undefined>(undefined);
  const [form, setForm] = useState<{ commitment?: CommitmentRecord; draft?: CommitmentDraft } | null>(null);

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
  const groups = groupContracts(commitments, summary ?? null);
  const warnings = summary
    ? projectWarnings(summary, commitments, { brokenTags: countBrokenTags(pieces, lines.map((l) => l.id), commitments.map((c) => c.id)) })
    : [];

  const creditDraft = (root: CommitmentRecord, gap: number): CommitmentDraft => ({
    ...creditChangeOrderDraft(root, gap),
    status: 'accepted',
    note: `Lowers the agreement by the ${formatCents(gap)} you received as a credit, so the totals match. Nothing changes until you press Add.`,
  });
  const rootOf = (c: CommitmentRecord) => (c.data.parentId === null ? c : commitments.find((x) => x.id === c.data.parentId) ?? c);

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
          <button className="btn danger" onClick={() => setDeleting(true)}>Delete permanently…</button>
        </div>
      </header>

      {summary ? (
        <Financials
          summary={summary}
          derived={b.derived}
          warnings={warnings}
          projectId={project.id}
          focusLine={focusLine}
          onFocus={setFocusLine}
          onFix={(w: Warning) => {
            const root = commitments.find((c) => c.id === w.commitmentId);
            if (root && w.creditGapCents) setForm({ draft: creditDraft(root, w.creditGapCents) });
            else if (root && (w.kind === 'splitBroken' || w.kind === 'changeNotSplit' || w.kind === 'splitLineGone')) setForm({ commitment: root });
          }}
        />
      ) : (
        <section className="pj-summary" aria-label="Budget summary">
          <div className="pj-stat"><span className="muted small">{b.derived ? 'Budget (total of lines)' : 'Overall budget'}</span><strong>{formatCents(b.budgetCents)}</strong></div>
          <div className="pj-stat"><span className="muted small">Planned in lines</span><strong>{formatCents(b.plannedTotalCents)}</strong></div>
        </section>
      )}

      {d.notes && <section className="card pj-card"><h2>Notes</h2><p className="pj-notes">{d.notes}</p></section>}

      {(d.archived || d.status === 'cancelled' || d.status === 'completed') && (
        <p className="muted small pj-note" role="note">
          {d.archived ? 'This project is archived.' : d.status === 'cancelled' ? 'This project is cancelled.' : 'This project is completed.'} Its tasks, milestones and events are kept and still work, but it no longer appears as active work on Today.
        </p>
      )}
      <ProjectWork project={project} />
      <RelatedAssets project={project} />
      <RelatedServices project={project} />

      <Commitments
        groups={groups}
        lines={lines}
        pieces={pieces}
        focusLine={focusLine}
        onNew={() => setForm({})}
        onEdit={(c) => setForm({ commitment: c })}
        onChange={(root, draft) => setForm({ draft: { parentId: root.id, ...draft } })}
      />
      <ProjectTxns
        projectId={project.id}
        pieces={pieces}
        focusLine={focusLine}
        lineName={(cid) => lines.find((l) => l.id === cid)?.data.name ?? ''}
        contractName={(cid) => commitments.find((c) => c.id === cid)?.data.title ?? ''}
        lineOfCommitment={(cid) => { const c = commitments.find((x) => x.id === cid); return c && !activeSplit(rootOf(c)) ? c.data.budgetLineId ?? rootOf(c).data.budgetLineId : null; }}
      />
      <BudgetLines projectId={project.id} budgetCents={d.budgetCents} lines={lines} />
      <Vendors projectId={project.id} vendorIds={d.vendorContactIds} />

      {form && <CommitmentForm projectId={project.id} vendorIds={d.vendorContactIds} lines={lines} all={commitments} commitment={form.commitment} draft={form.draft} onClose={() => setForm(null)} />}
      {deleting && <DeleteProject projectId={project.id} onClose={() => setDeleting(false)} />}
      {editing && <ProjectForm project={project} onClose={() => setEditing(false)} />}
    </div>
  );
}
