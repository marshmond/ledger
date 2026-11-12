import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../ui/icons';
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

/** A small status in the top bar: synced / syncing / offline / needs attention, with "Sync now". Shows "Sync off" until sync is set up. D7: on a phone the bar's copy is hidden and the module list holds one (`inline`). */
export default function SyncChip({ inline = false }: { inline?: boolean } = {}) {
  const s = useSyncStatus();
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      // D7: put focus back on the chip when it was inside the details (which disappear), so keyboard users are not dropped at the top of the page.
      if (wrap.current?.contains(document.activeElement)) chip.current?.focus();
    };
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

  // D7: on a phone the bar shows the chip only when something needs attention (an error or edits to review), as a warning icon button.
  const attention = tone === 'bad' || tone === 'warn';
  return (
    // `inline`: the copy inside the phone module list. Its details open in the flow of the list instead of floating over it.
    <div className={`syncwrap${inline ? ' inline' : ''}${attention ? ' attn' : ''}`} ref={wrap}>
      <button ref={chip} className={`syncchip ${tone}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)} title={detail}>
        <span className="syncdot" aria-hidden="true" />
        <Icon name={tone === 'bad' ? 'alert' : 'warning'} size={18} className="syncicon" />
        <span className="synctext">{label}</span>
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
