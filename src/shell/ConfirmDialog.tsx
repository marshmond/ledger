import { useEffect, useRef, useState, type ReactNode } from 'react';
import Modal from './Modal';

/**
 * A plain yes/no question for one important action, on top of the shared `Modal` (so it traps Tab, closes on Escape, and gives focus back
 * to the button that opened it). It is deliberately small:
 *  - a title that names the action, and plain-language consequences as the body;
 *  - Cancel comes first and has focus, so pressing Enter or Space by reflex does NOT do the destructive thing;
 *  - the action button says exactly what it does ("Delete account"), never just "OK";
 *  - `onConfirm` is run only when pressed; it may refuse by returning or throwing a message, which is shown inside the dialog (as an alert) and leaves it open;
 *  - while it runs both buttons are off and the dialog is marked busy, so a second click cannot repeat the action.
 * It does not decide whether the action is allowed. Callers still run their own checks inside `onConfirm` (the dependency re-check for accounts, for example),
 * so an out-of-date dialog can never get around them.
 */
export default function ConfirmDialog({ title, children, confirmLabel, busyLabel, tone = 'danger', onConfirm, onCancel }: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  tone?: 'danger' | 'primary';
  /** Return nothing/true to close (the caller closes it); return a string, or throw, to stay open and show that message. */
  onConfirm: () => Promise<string | void | boolean> | string | void | boolean;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  // Cancel takes focus once the dialog is up. Done here, after Modal has set itself up, so it holds in every case (the autoFocus attribute alone loses to Modal's own focus when React re-runs effects in development).
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancel.current?.focus(); }, []);

  async function go() {
    if (running.current) return;
    running.current = true;
    setBusy(true); setError(null);
    try {
      const r = await onConfirm();
      if (typeof r === 'string') setError(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nothing was changed.');
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={() => { if (!running.current) onCancel(); }}>
      <div className="confirm-body" aria-busy={busy}>
        {children}
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row confirm-actions">
          <button type="button" ref={cancel} onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className={tone === 'danger' ? 'danger' : 'primary'} disabled={busy} onClick={() => void go()}>{busy ? (busyLabel ?? 'Working…') : confirmLabel}</button>
        </div>
      </div>
    </Modal>
  );
}
