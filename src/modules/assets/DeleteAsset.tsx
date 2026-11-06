import { useEffect, useState } from 'react';
import { useNavigate } from '../../core/router';
import Modal from '../../shell/Modal';
import { useToast } from '../../ui/Toast';
import { deleteAssetPermanently, planAssetDeletion, type AssetDeletionPlan } from './deletion';

const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

/** "Delete permanently". For an asset created by mistake. Anything with history is archived or marked sold instead. */
export default function DeleteAsset({ assetId, onClose }: { assetId: number; onClose: () => void }) {
  const toast = useToast();
  const nav = useNavigate();
  const [plan, setPlan] = useState<AssetDeletionPlan | null>(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { void planAssetDeletion(assetId).then(setPlan).catch((e) => setError(e instanceof Error ? e.message : 'Could not read the asset.')); }, [assetId]);

  async function remove() {
    if (!plan) return;
    setBusy(true);
    try {
      await deleteAssetPermanently(assetId);
      toast(`"${plan.asset.data.name}" was deleted`);
      nav('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete. Nothing was changed.');
      setBusy(false);
    }
  }

  const name = plan?.asset.data.name ?? '';
  return (
    <Modal title={plan ? `Delete "${name}" permanently?` : 'Delete asset'} onClose={onClose}>
      <div className="as-form">
        {!plan && !error && <p className="muted">Checking what it is connected to…</p>}
        {plan && !plan.canDelete && (
          <>
            <p><strong>This cannot be deleted yet.</strong> Ledger keeps anything that holds history or structure.</p>
            <ul className="plain as-reasons">{plan.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
            <p className="muted small">If you only want it out of the way, use Archive. If it is gone from your life, mark it as sold, disposed of or replaced. Both keep everything.</p>
          </>
        )}
        {plan && plan.canDelete && (
          <>
            <p>This removes the asset from Ledger on all your synced devices, and it cannot be undone here. Old backup files you already saved still contain it.</p>
            <p><strong>Will be deleted:</strong> the asset only.</p>
            <p>
              <strong>Will be kept, not deleted:</strong>{' '}
              {plan.openTasks + plan.events + plan.links === 0 ? 'nothing else is attached to it.' : [
                plan.openTasks ? `${n(plan.openTasks, 'open task', 'open tasks')} (they stay, unlinked)` : '',
                plan.events ? `${n(plan.events, 'Calendar event', 'Calendar events')} (they stay, unlinked)` : '',
              ].filter(Boolean).join('; ') + '.'}
            </p>
            <p className="muted small">Archive is the gentle choice: it hides the asset and keeps everything.</p>
            <label className="f">Type the name to confirm
              <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={name} autoComplete="off" />
            </label>
          </>
        )}
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row as-actions">
          <button type="button" className="btn" onClick={onClose}>{plan?.canDelete ? 'Cancel' : 'Close'}</button>
          {plan?.canDelete && <button type="button" className="btn danger" disabled={busy || typed.trim() !== name.trim()} onClick={() => void remove()}>Delete permanently</button>}
        </div>
      </div>
    </Modal>
  );
}
