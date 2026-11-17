import { useEffect, useState } from 'react';
import { Pill, SettingsSection } from '../../../pages/SettingsParts';
import { cancelConnect, connectGmail, disconnectGmail, preloadGoogle, removeGmailClientId, saveGmailClientId } from './auth';
import { readClientId } from './clientId';
import { APP_ORIGIN } from './config';
import { useGmailState } from './useGmail';
import { ACCOUNT_NOTE, PERMISSION_NOTE, problemText, SETUP_STEPS, summaryOf, TESTING_NOTE } from './words';

/**
 * CAL-G1: Calendar settings, "Email notifications through Gmail". Shows whether Gmail is set up, connected or expired; takes the public Google client
 * ID; connects and disconnects. Connecting only fills memory with Google's short-lived permission: nothing is sent, and nothing is stored but the ID.
 */
export default function GmailSettings() {
  const g = useGmailState();
  const [draft, setDraft] = useState(() => readClientId() ?? '');
  const [fieldProblem, setFieldProblem] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => { preloadGoogle(); }, [g.configured]);
  const sum = summaryOf(g);
  const saved = readClientId();
  const dirty = draft.trim() !== (saved ?? '');

  const save = () => {
    const r = saveGmailClientId(draft);
    setFieldProblem(r.ok ? '' : r.problem);
    setNote(r.ok ? 'Client ID saved on this device.' : '');
    if (r.ok) setDraft(readClientId() ?? '');
  };
  const remove = () => { removeGmailClientId(); setDraft(''); setFieldProblem(''); setNote('Gmail is switched off on this device. Nothing else changed.'); };
  const disconnect = async () => {
    const r = await disconnectGmail();
    setNote(r.revoked === true ? 'Disconnected. Google was asked to cancel the permission too.'
      : 'Disconnected. Ledger forgot the permission. If you want Google to cancel it as well, remove Ledger under Third-party access in your Google Account security page; otherwise it runs out by itself.');
  };

  return (
    <SettingsSection id="cal-gmail" title="Email notifications through Gmail" badge={<Pill tone={sum.tone}>{sum.label}</Pill>}
      intro={`Lets Ledger send the Calendar messages you approve, from your own Gmail account, through Google's official sign-in. ${PERMISSION_NOTE} Nothing is ever sent unless you press Send on a message.`}>
      <p role="status">{sum.sentence}</p>
      <p className="muted small">{ACCOUNT_NOTE}</p>

      <div className="an-form an-form--wide">
        <label className="f">Google client ID
          <input value={draft} onChange={(e) => { setDraft(e.target.value); setFieldProblem(''); setNote(''); }} placeholder="1234567890-abc123.apps.googleusercontent.com" spellCheck={false} autoComplete="off" aria-invalid={!!fieldProblem} aria-describedby="cal-gmail-id-help" />
        </label>
      </div>
      <p className="muted small" id="cal-gmail-id-help">This ID is public (it is not a password) and stays on this device only: not in backups, not synced. Never paste a client secret.</p>
      {fieldProblem && <div className="error" role="alert">{fieldProblem}</div>}
      <div className="row se-actions">
        <button type="button" className="btn" onClick={save} disabled={!draft.trim() || !dirty}>Save client ID</button>
        {g.configured && <button type="button" className="btn" onClick={remove}>Remove client ID</button>}
      </div>

      {g.configured && (
        <div className="row se-actions">
          {g.phase === 'connecting'
            ? <button type="button" className="btn" onClick={cancelConnect}>Cancel</button>
            : g.phase === 'connected'
              ? <button type="button" className="btn" onClick={() => void disconnect()}>Disconnect Gmail</button>
              : <button type="button" className="btn primary" onClick={() => { setNote(''); void connectGmail(); }}>{g.phase === 'expired' ? 'Reconnect Gmail' : 'Connect Gmail'}</button>}
        </div>
      )}
      {g.problem && <div className="error" role="alert">{problemText(g.problem)}</div>}
      {note && <p className="muted small" role="status">{note}</p>}

      <details className="se-sub-details">
        <summary>How to set up Google (one time)</summary>
        <ol className="se-steps">{SETUP_STEPS.map((s) => <li key={s}>{s}</li>)}</ol>
        <p className="muted small">{TESTING_NOTE}</p>
        <p className="muted small">The address Google needs is {APP_ORIGIN} (the domain only).</p>
      </details>
    </SettingsSection>
  );
}
