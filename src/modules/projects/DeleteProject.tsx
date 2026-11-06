import { useEffect, useState } from 'react';
import { useNavigate } from '../../core/router';
import Modal from '../../shell/Modal';
import { useToast } from '../../ui/Toast';
import { deleteProjectPermanently, planProjectDeletion, type DeletionPlan } from './deletion';

const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

/**
 * "Delete permanently". Says what blocks it, or exactly what will be deleted and what will be kept. Archive is the gentle choice and is
 * offered first. Deleting never touches a transaction, commitment or account.
 */
export default function DeleteProject({ projectId, onClose }: { projectId: number; onClose: () => void }) {
  const toast = useToast();
  const nav = useNavigate();
  const [plan, setPlan] = useState<DeletionPlan | null>(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { void planProjectDeletion(projectId).then(setPlan).catch((e) => setError(e instanceof Error ? e.message : 'Could not read the project.')); }, [projectId]);

  async function remove() {
    if (!plan) return;
    setBusy(true);
    try {
      await deleteProjectPermanently(projectId);
      toast(`"${plan.project.data.name}" was deleted`);
      nav('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete. Nothing was changed.');
      setBusy(false);
    }
  }

  const name = plan?.project.data.name ?? '';
  const keeps = plan ? plan.tasks + plan.milestones + plan.events : 0;
  const needsName = !!plan && (plan.budgetLines > 0 || keeps > 0);
  return (
    <Modal title={plan ? `Delete "${name}" permanently?` : 'Delete project'} onClose={onClose}>
      <div className="pj-form pj-delete">
        {!plan && !error && <p className="muted">Checking what this project is connected to…</p>}
        {plan && !plan.canDelete && (
          <>
            <p><strong>This project cannot be deleted yet.</strong> Money is still attached to it, and Ledger never removes transactions or commitments for you.</p>
            <ul className="plain pj-reasons">{plan.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
            <p className="small">
              {plan.transactionIds.length > 0 && <><a className="link" href={`#/ledger/transactions?project=${projectId}`} onClick={onClose}>See the tagged transactions in Finance</a>{' · '}</>}
              {plan.commitments > 0 && <a className="link" href="#pj-commitments" onClick={onClose}>Go to the commitments</a>}
            </p>
            <p className="muted small">If you only want it out of the way, use Archive: it hides the project and keeps everything.</p>
          </>
        )}
        {plan && plan.canDelete && (
          <>
            <p>This removes the project from Ledger on all your synced devices. Old backup files you already saved still contain it.</p>
            <p><strong>Will be deleted:</strong> the project{plan.budgetLines ? ` and its ${n(plan.budgetLines, 'budget line', 'budget lines')}` : ''}.</p>
            <p>
              <strong>Will be kept, not deleted:</strong>{' '}
              {keeps === 0 && plan.links === 0 ? 'nothing else is attached to it.' : (
                [
                  plan.tasks ? `${n(plan.tasks, 'task', 'tasks')} (taken off the project)` : '',
                  plan.milestones ? `${n(plan.milestones, 'milestone', 'milestones')} (they become ordinary tasks)` : '',
                  plan.events ? `${n(plan.events, 'Calendar event', 'Calendar events')} (taken off the project; repeats are kept)` : '',
                  plan.links ? `${n(plan.links, 'link', 'links')} pointing at it will be removed` : '',
                ].filter(Boolean).join('; ') + '.'
              )}
            </p>
            <p className="muted small">No transactions, accounts or payments are touched.</p>
            {needsName && (
              <label className="f">Type the project name to confirm
                <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={name} autoComplete="off" />
              </label>
            )}
          </>
        )}
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row pj-actions">
          <button type="button" className="btn" onClick={onClose}>{plan?.canDelete ? 'Cancel' : 'Close'}</button>
          {plan?.canDelete && (
            <button type="button" className="btn danger" disabled={busy || (needsName && typed.trim() !== name.trim())} onClick={() => void remove()}>Delete permanently</button>
          )}
        </div>
      </div>
    </Modal>
  );
}
