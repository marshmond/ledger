import { useState } from 'react';
import Modal from '../../shell/Modal';
import { formatCents } from '../../lib/money';
import { useToast } from '../../ui/Toast';
import { createProject, saveProject } from './data';
import { blankProject, budgetFromText, STATUSES, STATUS_LABEL, validateProject, type ProjectData, type ProjectRecord, type ProjectStatus } from './model';

/** Create (no `project`) or edit a project's own details. Budget lines and vendors are managed on the project page. */
export default function ProjectForm({ project, onClose, onSaved }: { project?: ProjectRecord; onClose: () => void; onSaved?: (id: number) => void }) {
  const toast = useToast();
  const d = project?.data ?? blankProject();
  const [name, setName] = useState(d.name);
  const [status, setStatus] = useState<ProjectStatus>(d.status);
  const [startDate, setStartDate] = useState(d.startDate ?? '');
  const [targetDate, setTargetDate] = useState(d.targetDate ?? '');
  const [budget, setBudget] = useState(d.budgetCents === null ? '' : (d.budgetCents / 100).toFixed(2));
  const [notes, setNotes] = useState(d.notes);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const problem = validateProject({ name, startDate, targetDate, budget });
    if (problem) return setError(problem);
    setBusy(true);
    try {
      const data: ProjectData = { ...d, name: name.trim(), status, startDate: startDate || null, targetDate: targetDate || null, budgetCents: budgetFromText(budget), notes };
      const id = project ? project.id : await createProject(data);
      if (project) await saveProject(project.id, data);
      toast(project ? 'Project saved' : `Project created: ${data.name}`);
      onSaved?.(id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      setBusy(false);
    }
  }

  return (
    <Modal title={project ? 'Edit project' : 'New project'} onClose={onClose}>
      <form className="pj-form" onSubmit={save}>
        <label className="f">Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Kitchen renovation" autoFocus maxLength={120} /></label>
        <label className="f">Status
          <select value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <div className="pj-two">
          <label className="f">Start date<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
          <label className="f">Target completion<input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} /></label>
        </div>
        <label className="f">Overall budget (optional)
          <input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" placeholder="Leave blank to use the total of the budget lines" />
        </label>
        {budget.trim() && !validateProject({ name: 'x', startDate: '', targetDate: '', budget }) && <p className="muted small">Budget: {formatCents(budgetFromText(budget) ?? 0)}</p>}
        <label className="f">Notes<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} /></label>
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row pj-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>{project ? 'Save' : 'Create project'}</button>
        </div>
      </form>
    </Modal>
  );
}
