import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Modal from '../../shell/Modal';
import { todayISO } from '../../lib/money';
import { useToast } from '../../ui/Toast';
import { loadAssets, publicLabel, setAssetStatus } from './data';
import { ASSET_STATUSES, STATUS_LABEL, type AssetRecord, type AssetStatus } from './model';

/** How the asset left (or returned to) everyday use. Nothing inside it, linked to it or attached to it is changed. */
export default function RetireDialog({ asset, onClose }: { asset: AssetRecord; onClose: () => void }) {
  const toast = useToast();
  const all = useLiveQuery(() => loadAssets(), []) ?? [];
  const [status, setStatus] = useState<AssetStatus>(asset.data.status);
  const [date, setDate] = useState(asset.data.statusDate ?? todayISO());
  const [note, setNote] = useState(asset.data.statusNote);
  const [by, setBy] = useState<number | null>(asset.data.replacedById);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await setAssetStatus(asset.id, { status, statusDate: status === 'active' ? null : date || null, statusNote: note, replacedById: by });
      toast(status === 'active' ? 'Back in use' : `Marked as ${STATUS_LABEL[status].toLowerCase()}`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      setBusy(false);
    }
  }
  return (
    <Modal title={`Status of ${asset.data.name}`} onClose={onClose}>
      <form className="as-form" onSubmit={save}>
        <label className="f">Status
          <select value={status} onChange={(e) => setStatus(e.target.value as AssetStatus)}>
            {ASSET_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        {status !== 'active' && (
          <>
            <label className="f">{status === 'stored' ? 'Since' : 'On'}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label className="f">Note (optional)<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={status === 'sold' ? 'Who bought it' : ''} /></label>
          </>
        )}
        {status === 'replaced' && (
          <label className="f">Replaced by (optional)
            <select value={by ?? ''} onChange={(e) => setBy(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Not recorded</option>
              {all.filter((a) => a.id !== asset.id).map((a) => <option key={a.id} value={a.id}>{publicLabel(all, a.id)}</option>)}
            </select>
          </label>
        )}
        <p className="muted small">This only records what happened. The things inside it, its tasks and its links stay exactly as they are. You can set it back to "In use" at any time.</p>
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row as-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>Save</button>
        </div>
      </form>
    </Modal>
  );
}
