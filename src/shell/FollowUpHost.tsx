import { useEffect, useState, type ComponentType } from 'react';
import { getModule } from '../core/registry';
import { advanceRun, onTaskFollowUp, stopRun, type FollowUpQueue, type FollowUpRun, type ResolvedFollowUp, type TaskFollowUpDialogProps } from '../core/taskFollowUp';
import { ToastProvider } from '../ui/Toast';
import Modal from './Modal';

type Phase = { kind: 'loading' } | { kind: 'ready'; Dialog: ComponentType<TaskFollowUpDialogProps> } | { kind: 'failed' };

/** Loads the module's own logging dialog (a separate file, fetched only now) for the finished Task. */
function Loaded({ follow, queue, onSaved, onClose }: { follow: ResolvedFollowUp; queue?: FollowUpQueue; onSaved: () => void; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    const load = getModule(follow.moduleId)?.contributes?.taskFollowUp?.Dialog;
    if (!load) { setPhase({ kind: 'failed' }); return; }
    load().then((m) => live && setPhase({ kind: 'ready', Dialog: m.default }), () => live && setPhase({ kind: 'failed' }));
    return () => { live = false; };
  }, [follow]);
  if (phase.kind === 'ready') return <phase.Dialog taskId={follow.taskId} subject={follow.subject} onClose={onClose} onSaved={onSaved} queue={queue} />;
  if (phase.kind === 'failed') {
    return (
      <Modal title="Could not open that just now" onClose={onClose} size="sm">
        <p>This part of Ledger could not be loaded (you may be offline). The task is still done, and nothing was saved. You can log the work later from the household module's own page.</p>
        <div className="row">
          {queue && <button type="button" className="btn" onClick={queue.onSkip}>Next one</button>}
          <button type="button" className="btn primary" onClick={onClose}>Close</button>
        </div>
      </Modal>
    );
  }
  return null; // the file is normally already on the device; nothing is drawn while it arrives
}

/**
 * R1.3: mounted once for the whole app (like the quick-task form). When a finished Task's "Log ..." button is pressed, the owning module's EXISTING dialog opens here,
 * on top of whatever screen the person is on (Today, Tasks, the Calendar), so nothing navigates away. Its own toast provider keeps "Visit logged" (with Undo) on
 * screen after the dialog closes. The host never saves anything itself.
 *
 * Several Tasks (a bulk completion, or "Log selected one at a time" on an overview) are walked through one dialog at a time: saving moves on to the next, "Skip this one"
 * moves on without saving, and closing the dialog (Cancel, Not now, the X, Escape) stops the whole list. Each Task is saved only by its own dialog's own button.
 */
export default function FollowUpHost() {
  const [run, setRun] = useState<FollowUpRun | null>(null);
  useEffect(() => onTaskFollowUp((items) => setRun({ items, i: 0 })), []);
  if (!run) return <ToastProvider>{null}</ToastProvider>;
  const { items, i } = run;
  // These only act while the dialog they belong to is still the current one, so a save that advances the list is never undone by the close that follows it.
  const advance = () => setRun((r) => advanceRun(r, i));
  const stop = () => setRun((r) => stopRun(r, i));
  const queue: FollowUpQueue | undefined = items.length > 1 ? { position: i + 1, total: items.length, onSkip: advance } : undefined;
  return (
    <ToastProvider>
      <Loaded key={`${items[i].moduleId}:${items[i].taskId}:${i}`} follow={items[i]} queue={queue} onSaved={advance} onClose={stop} />
    </ToastProvider>
  );
}
