import { useEffect, useRef, useState, type ReactNode } from 'react';
import Modal from './Modal';
import { makeConfirmRunner, type ConfirmRunner } from './confirmRun';
import { Icon } from '../ui/icons';

/**
 * What a confirmation is about, so the dialog does not sound the same for every action. Optional and VISUAL ONLY: it adds a short labelled line (an icon and words, never colour alone)
 * and an accent on the dialog. It never decides whether the action is allowed and never changes what `onConfirm` does. Pick it only when the dialog's own text already says so.
 *  - 'linked': the action changes a record other records point to.
 *  - 'irreversible': once confirmed, the action cannot be undone from Ledger.
 *  - 'replace': the action replaces data that is already there.
 */
export type ConfirmKind = 'linked' | 'irreversible' | 'replace';
export const CONFIRM_KIND_LABEL: Record<ConfirmKind, string> = {
  linked: 'Changes a record that other records use',
  irreversible: 'This cannot be undone from Ledger',
  replace: 'Replaces data that is already here',
};

/**
 * A plain yes/no question for one important action, on top of the shared `Modal` (so it traps Tab, closes on Escape, and gives focus back
 * to the button that opened it). It is deliberately small:
 *  - a title that names the action, and plain-language consequences as the body;
 *  - Cancel comes first and has focus, so pressing Enter or Space by reflex does NOT do the destructive thing;
 *  - the action button says exactly what it does ("Delete account"), never just "OK";
 *  - `onConfirm` is run only when pressed; it may refuse by returning or throwing a message, which is shown inside the dialog (as an alert) and leaves it open;
 *  - while it runs both buttons are off and the dialog is marked busy, so a second click cannot repeat the action. D20: the dialog is also locked, so Escape, a click outside and the
 *    close button cannot dismiss it while the action is running (the outcome would be unclear).
 * It does not decide whether the action is allowed. Callers still run their own checks inside `onConfirm` (the dependency re-check for accounts, for example),
 * so an out-of-date dialog can never get around them.
 */
export default function ConfirmDialog({ title, children, confirmLabel, busyLabel, tone = 'danger', kind, onConfirm, onCancel }: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  tone?: 'danger' | 'primary';
  /** Optional, visual only (see `ConfirmKind`). */
  kind?: ConfirmKind;
  /** Return nothing/true to close (the caller closes it); return a string, or throw, to stay open and show that message. */
  onConfirm: () => Promise<string | void | boolean> | string | void | boolean;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The press-the-action logic (busy, no repeat while running, refusal or error stays open) lives in confirmRun.ts, where it is tested; it always runs the newest handler.
  const handler = useRef(onConfirm);
  handler.current = onConfirm;
  const runner = useRef<ConfirmRunner | null>(null);
  runner.current ??= makeConfirmRunner(() => handler.current, { setBusy, setError });
  // Cancel takes focus once the dialog is up. Done here, after Modal has set itself up, so it holds in every case (the autoFocus attribute alone loses to Modal's own focus when React re-runs effects in development).
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancel.current?.focus(); }, []);

  const accent = kind === 'replace' ? ' modal--replace' : kind === 'linked' ? ' modal--linked' : tone === 'danger' ? ' modal--danger' : '';
  return (
    <Modal title={title} size="sm" locked={busy} className={`modal--confirm${accent}`} onClose={() => { if (!runner.current?.running) onCancel(); }}>
      <div className="confirm-body" aria-busy={busy}>
        {kind && <p className="ui-confirm-kind"><Icon name={kind === 'linked' ? 'info' : 'warning'} />{CONFIRM_KIND_LABEL[kind]}</p>}
        {children}
        {error && <div className="error ui-dialog-error" role="alert">{error}</div>}
        <div className="row confirm-actions">
          <button type="button" ref={cancel} onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className={tone === 'danger' ? 'danger' : 'primary'} disabled={busy} aria-busy={busy || undefined} onClick={() => void runner.current?.go()}>{busy ? (busyLabel ?? 'Working…') : confirmLabel}</button>
        </div>
      </div>
    </Modal>
  );
}
