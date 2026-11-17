import { useCallback, useEffect, useRef, useState } from 'react';
import { ageText, POLL_MS, RETENTION_CHOICES } from './freshness';
import { idbKv } from './storage';
import { Tablet, type TabletView } from './retrieval';
import './tablet.css';

/**
 * CS-2: the diagnostic page. It proves a display can pair, fetch, decrypt and validate the published file, and it shows how fresh that is. It is
 * deliberately NOT the family calendar (CS-3): it shows counts and times only, never an event or Task title.
 */
const tablet = new Tablet({ kv: idbKv(), now: () => Date.now() });

const clock = (ms: number | null) => (ms === null ? '—' : new Date(ms).toLocaleString());
const TONE: Record<string, string> = { recent: 'ok', delayed: 'warn', stale: 'warn', 'extended-outage': 'bad', expired: 'bad', never: 'info' };

export default function App() {
  const [view, setView] = useState<TabletView | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmForget, setConfirmForget] = useState(false);
  const [, setTick] = useState(0);
  const mounted = useRef(true);

  const check = useCallback(async (force = false) => {
    setBusy(true);
    try { const v = await tablet.checkNow(force); if (mounted.current) setView(v); } finally { if (mounted.current) setBusy(false); }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void tablet.tick().then((v) => mounted.current && setView(v)).then(() => check());
    const poll = setInterval(() => void check(), POLL_MS);
    const minute = setInterval(() => void tablet.tick().then((v) => mounted.current && (setView(v), setTick((n) => n + 1))), 60_000);
    const wake = () => document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    return () => { mounted.current = false; clearInterval(poll); clearInterval(minute); document.removeEventListener('visibilitychange', wake); window.removeEventListener('online', wake); };
  }, [check]);

  const pair = async () => {
    setError(null);
    setBusy(true);
    const r = await tablet.pair(code);
    setBusy(false);
    if (r.ok) { setCode(''); setView(r.view); } else setError(r.message);
  };

  if (!view) return <main className="t-page"><p>Loading…</p></main>;

  if (!view.paired) {
    return (
      <main className="t-page">
        <h1>Family display</h1>
        <p className="t-status t-info">Not paired</p>
        <p>To connect this display, open Ledger on your phone, go to Settings → Family display → Pair a display, copy the pairing code, and paste it here.</p>
        <p className="t-note">The pairing code lets this display read the schedule you approved. Keep it private. It is not sent anywhere except to GitHub, to fetch the display file.</p>
        <label htmlFor="code">Pairing code</label>
        <textarea id="code" rows={4} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} />
        {error && <p className="t-error" role="alert">{error}</p>}
        <button type="button" className="t-btn t-primary" disabled={busy || !code.trim()} onClick={() => void pair()}>{busy ? 'Pairing…' : 'Pair this display'}</button>
      </main>
    );
  }

  const f = view.freshness;
  const rows: [string, string][] = [
    ['Paired', `Yes (${view.repo})`],
    ['Connection', view.connection === 'connected' ? 'Connected' : view.connection === 'disconnected' ? 'Disconnected' : 'Not checked yet'],
    ['Last successful check', view.lastSuccessAt ? `${ageText(Date.now() - view.lastSuccessAt)} (${clock(view.lastSuccessAt)})` : 'Never'],
    ['Last publication', view.publishedAt ? clock(Date.parse(view.publishedAt)) : view.hasCopy ? '—' : 'No saved copy'],
    ['Data version', view.projectionVersion === null ? '—' : String(view.projectionVersion)],
    ['Revision', view.revision === null ? '—' : String(view.revision)],
    ['Approved calendar entries', view.counts ? String(view.counts.entries) : '—'],
    ['Approved Tasks', view.counts ? String(view.counts.tasks) : '—'],
    ['Validation', view.validation === 'ok' ? 'Passed' : view.validation === 'failed' ? 'Failed (saved copy kept)' : 'Nothing to validate'],
    ['Saved copy', view.hasCopy ? 'Saved (encrypted)' : 'None'],
  ];

  return (
    <main className="t-page">
      <h1>Family display</h1>
      <p className={`t-status t-${TONE[f.state]}`}>{f.label}</p>
      {view.problem && <p className="t-error" role="status">{view.problem.message}</p>}
      {view.clockWarning && <p className="t-warn" role="status">{view.clockWarning}</p>}
      <dl className="t-list">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <p className="t-note">“Last successful check” is when this display last reached GitHub and got a valid answer. “Last publication” is when Ledger last published, which can be much earlier if nothing changed.</p>

      <div className="t-actions">
        <button type="button" className="t-btn t-primary" disabled={busy} onClick={() => void check(true)}>{busy ? 'Checking…' : 'Check now'}</button>
        <button type="button" className="t-btn" onClick={() => setConfirmForget(true)}>Forget this display</button>
      </div>

      <label htmlFor="keep">Keep the saved schedule for up to</label>
      <select id="keep" value={view.retentionMs} onChange={(e) => void tablet.setRetention(Number(e.target.value)).then(setView)}>
        {RETENTION_CHOICES.map((c) => <option key={c.id} value={c.ms}>{c.label} without a successful check</option>)}
      </select>
      <p className="t-note">If this display cannot reach GitHub for that long, it deletes its saved copy the next time the app runs. A display that is switched off cannot delete anything until it is switched on.</p>

      {confirmForget && (
        <div className="t-dialog" role="alertdialog" aria-modal="true" aria-labelledby="forget-h">
          <h2 id="forget-h">Forget this display?</h2>
          <p>This deletes the saved schedule, the key and the pairing from this device. You will need a new pairing code from Ledger. Nothing in Ledger or GitHub changes.</p>
          <div className="t-actions">
            <button type="button" className="t-btn" onClick={() => setConfirmForget(false)}>Cancel</button>
            <button type="button" className="t-btn t-danger" onClick={() => void tablet.forget().then((v) => { setConfirmForget(false); setView(v); })}>Forget this display</button>
          </div>
        </div>
      )}
    </main>
  );
}
