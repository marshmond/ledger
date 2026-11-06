import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import { useToast } from '../../ui/Toast';
import { loadAssets, publicLabel } from './data';
import { detectOrphans, rehomeOrphan, removeOrphan, WHY_TEXT, type Orphan } from './orphans';

const REMOVE_WORD: Record<Orphan['kind'], string> = { service: 'Delete record', warranty: 'Delete record', replacement: 'Clear the link', link: 'Remove the link' };

/**
 * "Needs attention": records that point at an asset that is not here. Shown only when there are some. Nothing is changed unless the owner
 * picks Re-home or the remove button on one record, and (when this device has no trace of the asset) ticks that they have waited for sync.
 */
export default function OrphanCard() {
  const toast = useToast();
  const orphans = useLiveQuery(() => detectOrphans(db), []);
  const assets = useLiveQuery(() => loadAssets(), []) ?? [];
  const [busyKey, setBusyKey] = useState('');
  const [target, setTarget] = useState<Record<string, number>>({});
  const [sure, setSure] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (!orphans || orphans.length === 0) return null;

  async function run(o: Orphan, what: 'rehome' | 'remove') {
    setBusyKey(o.key);
    setErrors((e) => ({ ...e, [o.key]: '' }));
    try {
      if (what === 'rehome') { await rehomeOrphan(o, target[o.key]); toast('Moved'); }
      else { await removeOrphan(o); toast(o.kind === 'link' || o.kind === 'replacement' ? 'Link removed' : 'Record deleted'); }
    } catch (e) { setErrors((m) => ({ ...m, [o.key]: e instanceof Error ? e.message : 'Could not do that. Nothing was changed.' })); }
    setBusyKey('');
  }

  return (
    <section className="card as-card as-warn" aria-labelledby="as-orph-h">
      <h2 id="as-orph-h">Needs attention ({orphans.length})</h2>
      <p className="small">{orphans.length === 1 ? 'This record points' : 'These records point'} at an asset that is not here. Nothing has been changed or deleted. Pick what to do with each one, or leave it for later.</p>
      <ul className="plain as-items">
        {orphans.map((o) => {
          const needsTick = o.why === 'absent';
          const ok = !needsTick || sure[o.key];
          return (
            <li key={o.key} className="as-orphan">
              <div><strong>{o.what}:</strong> {o.label}</div>
              <div className="small muted">{WHY_TEXT[o.why]}</div>
              {needsTick && <label className="as-check small"><input type="checkbox" checked={!!sure[o.key]} onChange={(e) => setSure((s) => ({ ...s, [o.key]: e.target.checked }))} /> I have synced my other devices and it is still missing.</label>}
              <div className="as-orphan-actions">
                <label className="f as-inline">Move to
                  <select value={target[o.key] ?? ''} onChange={(e) => setTarget((t) => ({ ...t, [o.key]: Number(e.target.value) }))}>
                    <option value="">Pick an asset</option>
                    {assets.filter((a) => !a.data.archived || o.kind === 'link').map((a) => <option key={a.id} value={a.id}>{publicLabel(assets, a.id)}</option>)}
                  </select>
                </label>
                <button className="btn" disabled={!ok || !target[o.key] || busyKey === o.key} onClick={() => void run(o, 'rehome')}>Re-home</button>
                <button className="btn danger" disabled={!ok || busyKey === o.key} onClick={() => void run(o, 'remove')}>{REMOVE_WORD[o.kind]}</button>
              </div>
              {errors[o.key] && <div className="error" role="alert">{errors[o.key]}</div>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
