import { useEffect, useState } from 'react';
import type { TaskFollowUpDialogProps } from '../../core/taskFollowUp';
import Modal from '../../shell/Modal';
import type { TaskRecord } from '../tasks/model';
import { getTask } from '../tasks/data';
import { checkAssetsFollowUp, type AssetsFollowCheck } from './followUp';
import ServiceForm from './ServiceForm';

type Ready = { check: AssetsFollowCheck; task: TaskRecord | null };

/**
 * R1.3: "Log maintenance" for a finished Task, and "Save to history" from the Home & Assets overview. It is the EXISTING `ServiceForm` in its "Save to service
 * history" form for a task that is already done, opened where the person already is. It saves nothing by itself: the person adds what was done, the cost or the
 * provider if they want, and presses Save. If the offer no longer stands (reopened, already saved, asset gone or archived) a plain explanation is shown and
 * nothing is written. `queue` is set when several tasks are being saved one after another.
 */
export function SaveTaskDialog({ taskId, subject: assetId, onClose, onSaved, queue }: TaskFollowUpDialogProps) {
  const [ready, setReady] = useState<Ready | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const check = await checkAssetsFollowUp(taskId, assetId);
      const task = check.ok ? (await getTask(taskId)) ?? null : null;
      if (live) setReady({ check: task || !check.ok ? check : { ok: false, reason: 'That task is not here any more, so there is nothing to save.' }, task });
    })().catch(() => live && setReady({ check: { ok: false, reason: 'Could not read that task just now. Nothing was changed.' }, task: null }));
    return () => { live = false; };
  }, [taskId, assetId]);
  if (!ready) return null;
  const { check, task } = ready;
  if (!check.ok || !task) {
    const c = check as Extract<AssetsFollowCheck, { ok: false }>;
    return (
      <Modal title="Nothing to save" onClose={onClose} size="sm">
        <p role="status">{c.reason}</p>
        <div className="row">
          {c.saved && <a className="btn" href={`#/assets/${c.saved.assetId}?service=${c.saved.serviceId}`} onClick={onClose}>Open that entry</a>}
          {queue && <button type="button" className="btn" onClick={queue.onSkip}>Next one</button>}
          <button type="button" className="btn primary" onClick={onClose}>Close</button>
        </div>
      </Modal>
    );
  }
  return <ServiceForm asset={check.asset} task={task} onClose={onClose} onSaved={onSaved} queue={queue} />;
}

/** What the global host opens after a Task linked to an asset is finished. */
export default function AssetsFollowUpDialog(props: TaskFollowUpDialogProps) {
  return <SaveTaskDialog {...props} />;
}
