import { useEffect } from 'react';
import { Link } from '../../../core/router';
import { cancelConnect, connectGmail, preloadGoogle } from './auth';
import { problemText } from './words';
import { useGmailState } from './useGmail';

/**
 * CAL-G1: the Connect Gmail button, used wherever the owner is told "Gmail is not connected" (the review screen and the event's Messages).
 * Pressing it opens Google's own window and, if the owner agrees, keeps the permission in memory. It NEVER sends, approves or records anything:
 * the owner presses Send afterwards, on purpose. When no client ID has been entered it only points to the setup in Calendar settings.
 */
export default function GmailConnect({ primary = false }: { primary?: boolean }) {
  const g = useGmailState();
  useEffect(() => { preloadGoogle(); }, [g.configured]);
  if (!g.configured) return <Link to="/settings/calendar" className="btn">Set up Gmail in Calendar settings</Link>;
  if (g.phase === 'connected') return null;
  if (g.phase === 'connecting') {
    return (
      <span className="row">
        <span className="muted small" role="status">Waiting for Google…</span>
        <button type="button" className="btn" onClick={cancelConnect}>Cancel</button>
      </span>
    );
  }
  return (
    <>
      <button type="button" className={`btn${primary ? ' primary' : ''}`} onClick={() => { void connectGmail(); }}>{g.phase === 'expired' ? 'Reconnect Gmail' : 'Connect Gmail'}</button>
      {g.problem && <p className="cal-error" role="alert">{problemText(g.problem)}</p>}
    </>
  );
}
