import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { syncNow, useSyncStatus } from '../lib/sync/auto';

function useOnline() {
  const [on, setOn] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  useEffect(() => {
    const up = () => setOn(true);
    const down = () => setOn(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return on;
}

const ago = (ms?: number) => {
  if (!ms) return 'not yet';
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : new Date(ms).toLocaleDateString();
};

/** A small status in the top bar: synced / syncing / offline / needs attention, with "Sync now". Shows "Sync off" until sync is set up. */
export default function SyncChip() {
  const s = useSyncStatus();
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);

  if (!s.configured) return <Link to="/settings/sync" className="syncchip off" title="Keep your devices in step">Sync off</Link>;

  let tone = 'ok';
  let label = 'Synced';
  let detail = `Last synced ${ago(s.lastSyncedAt)}.`;
  if (s.state === 'syncing') { tone = 'busy'; label = 'Syncing…'; detail = 'Syncing now.'; }
  else if (s.state === 'error') { tone = 'bad'; label = 'Needs attention'; detail = s.error ?? 'The last sync did not finish.'; }
  else if (!online) { tone = 'off'; label = 'Offline'; detail = 'No connection. Your changes are kept here and sync when you are back online.'; }
  else if (s.conflicts > 0) { tone = 'warn'; label = `Review ${s.conflicts}`; detail = `${s.conflicts} edit${s.conflicts === 1 ? '' : 's'} lost a tie between devices. The other version is saved; you can put it back.`; }
  else if (!s.auto) { tone = 'off'; label = 'Paused'; detail = `Automatic sync is off. Last synced ${ago(s.lastSyncedAt)}.`; }

  return (
    <div className="syncwrap" ref={wrap}>
      <button className={`syncchip ${tone}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)} title={detail}>
        <span className="syncdot" aria-hidden="true" />
        <span>{label}</span>
      </button>
      {open && (
        <div className="syncpop" role="dialog" aria-label="Sync status">
          <p>{detail}</p>
          <div className="row">
            <button className="primary" disabled={s.state === 'syncing' || !online} onClick={() => syncNow()}>Sync now</button>
            <Link to={s.conflicts > 0 ? '/settings/sync#conflicts' : '/settings/sync'} onClick={() => setOpen(false)}>Sync settings</Link>
          </div>
        </div>
      )}
    </div>
  );
}
