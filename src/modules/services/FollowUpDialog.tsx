import { useEffect, useState } from 'react';
import type { TaskFollowUpDialogProps } from '../../core/taskFollowUp';
import Modal from '../../shell/Modal';
import { checkServicesFollowUp, type ServicesFollowCheck } from './followUp';
import { visitRoute } from './paths';
import { LogVisitDialog } from './VisitDialogs';

/**
 * R1.3: "Log completed visit" for a Task that was just marked done. It is the EXISTING `LogVisitDialog` (in its "Log this visit" form for a Task finished
 * elsewhere), opened where the person already is. It saves nothing by itself: the person checks the date, adds notes or a charge if they want, and presses
 * the dialog's own button. If the offer no longer stands (reopened, already logged, service removed) a plain explanation is shown instead and nothing is written.
 */
export default function ServicesFollowUpDialog({ taskId, onClose, onSaved, queue }: TaskFollowUpDialogProps) {
  const [check, setCheck] = useState<ServicesFollowCheck | null>(null);
  useEffect(() => {
    let live = true;
    void checkServicesFollowUp(taskId).then((c) => live && setCheck(c), () => live && setCheck({ ok: false, reason: 'Could not read that visit just now. Nothing was changed.' }));
    return () => { live = false; };
  }, [taskId]);
  if (!check) return null;
  if (!check.ok) {
    return (
      <Modal title="Nothing to log" onClose={onClose} size="sm">
        <p role="status">{check.reason}</p>
        <div className="row">
          {check.visitId !== undefined && <a className="btn" href={`#/services${visitRoute(check.visitId)}`} onClick={onClose}>Open that visit</a>}
          {queue && <button type="button" className="btn" onClick={queue.onSkip}>Next one</button>}
          <button type="button" className="btn primary" onClick={onClose}>Close</button>
        </div>
      </Modal>
    );
  }
  return <LogVisitDialog arrangementId={check.arrangementId} taskId={taskId} status="completed" finished onClose={onClose} onSaved={onSaved} queue={queue} />;
}
