import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { findOrCreateContact, validateContact } from '../../core/contacts';
import { db } from '../../db';
import { store } from '../../core/store';
import Modal from '../../shell/Modal';
import { useToast } from '../../ui/Toast';
import type { AssetRecord, AssetRef } from './model';
import { blankWarranty, type EffectiveWarranty, type WarrantyRecord } from './warranty';
import { createWarranty, deleteWarranty, deleteWarrantyAndOldFields, restoreWarranty, updateWarranty } from './warrantyData';

type Props = {
  asset: AssetRecord;
  /** Editing this stored warranty. */
  warranty?: WarrantyRecord;
  /** Starting from the asset's older simple warranty: the form is filled in, but nothing is saved (and the old fields are not touched) until Save. */
  fromImplicit?: EffectiveWarranty;
  /** True when this is the asset's only warranty record AND the asset still has the older simple warranty fields: deleting it would bring that older coverage back. */
  lastWithOld?: boolean;
  onClose: () => void;
};

/** Add or edit one warranty. Only the name is required; every date is optional (a warranty with no end date simply has no expiration marker). */
export default function WarrantyForm({ asset, warranty, fromImplicit, lastWithOld, onClose }: Props) {
  const toast = useToast();
  const contacts = useLiveQuery(() => store.shared.contacts.query(), []) ?? [];
  const base = warranty?.data ?? blankWarranty(asset.id, fromImplicit ? { title: 'Manufacturer warranty', endDate: fromImplicit.endDate, coverageNotes: fromImplicit.coverageNotes } : {});
  const [title, setTitle] = useState(base.title);
  const [start, setStart] = useState(base.startDate ?? '');
  const [end, setEnd] = useState(base.endDate ?? '');
  const [provider, setProvider] = useState<number | null>(base.providerContactId);
  const [coverage, setCoverage] = useState(base.coverageNotes);
  const [claim, setClaim] = useState(base.claimInfo);
  const [refs, setRefs] = useState<AssetRef[]>(base.refs);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [clearOld, setClearOld] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const known = provider !== null && contacts.some((c) => c.id === provider);

  async function addContact() {
    const problem = validateContact({ name: newName, phone: newPhone, email: newEmail });
    if (problem) return setError(problem);
    try {
      const { id, created } = await findOrCreateContact(db, { name: newName, phone: newPhone, email: newEmail });
      setProvider(id);
      toast(created ? `Added ${newName.trim()} to your contacts` : `${newName.trim()} was already in your contacts, so that contact was used`);
      setNewName(''); setNewPhone(''); setNewEmail(''); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not add the contact.'); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const data = { ...base, assetId: asset.id, title, startDate: start || null, endDate: end || null, providerContactId: provider, coverageNotes: coverage, claimInfo: claim, refs };
    setBusy(true);
    try {
      if (warranty) { await updateWarranty(warranty.id, data); toast('Saved'); }
      else { await createWarranty(data); toast('Warranty added'); }
      onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save.'); setBusy(false); }
  }

  async function remove() {
    if (!warranty) return;
    setBusy(true);
    try {
      if (lastWithOld) await deleteWarrantyAndOldFields(warranty.id, clearOld);
      else await deleteWarranty(warranty.id);
      // Undo brings the warranty back. Old fields cleared with it are not restored automatically; the toast says so only when it matters.
      toast(clearOld && lastWithOld ? 'Warranty deleted, and the older simple warranty on the asset was cleared' : 'Warranty deleted', clearOld && lastWithOld ? undefined : async () => { try { await restoreWarranty(warranty.id); } catch (err) { toast(err instanceof Error ? err.message : 'Could not bring it back.'); } });
      onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not delete.'); setBusy(false); }
  }

  return (
    <Modal title={warranty ? 'Edit warranty' : 'Add warranty'} onClose={onClose} wide>
      <form className="as-form" onSubmit={submit}>
        <p className="muted small">On <strong>{asset.data.name}</strong>. Only the name is needed. Leave a date blank if you do not know it.</p>
        {fromImplicit && !warranty && (
          <p className="as-note small" role="note">Started from the warranty date saved in this asset&apos;s details. Saving creates a warranty record; the older date and note on the asset are not changed or removed.</p>
        )}
        <label className="f">Name
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Manufacturer warranty" maxLength={120} autoFocus />
        </label>
        <div className="as-two">
          <label className="f">Starts <span className="muted">(optional)</span><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label className="f">Ends <span className="muted">(optional)</span><input type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} /></label>
        </div>
        <label className="f">Provided by <span className="muted">(optional)</span>
          <select value={provider ?? ''} onChange={(e) => setProvider(e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">Nobody chosen</option>
            {provider !== null && !known && <option value={provider}>(contact removed)</option>}
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <details className="as-sec">
          <summary>Add someone new as the provider</summary>
          <div className="as-new-contact">
            <div className="as-two">
              <input aria-label="New provider name" placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <input aria-label="New provider phone" placeholder="Phone (optional)" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} inputMode="tel" />
            </div>
            <input aria-label="New provider email" placeholder="Email (optional)" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} inputMode="email" />
            <button type="button" className="btn" onClick={() => void addContact()} disabled={!newName.trim()}>Add and choose</button>
          </div>
        </details>
        <label className="f">What it covers <span className="muted">(optional)</span>
          <textarea rows={3} value={coverage} onChange={(e) => setCoverage(e.target.value)} maxLength={2000} placeholder="Parts and labour, motor only, ..." />
        </label>
        <label className="f">How to make a claim <span className="muted">(optional)</span>
          <textarea rows={2} value={claim} onChange={(e) => setClaim(e.target.value)} maxLength={2000} placeholder="Who to call, what to have ready. Do not put account numbers here." />
        </label>
        <details className="as-sec" open={refs.length > 0}>
          <summary>Documents ({refs.length})</summary>
          <p className="muted small">Where the warranty paperwork is: a link to your own storage, or a note such as &quot;paper copy, blue folder&quot;. Files are not stored in Ledger.</p>
          {refs.map((r, i) => (
            <div key={i} className="as-ref">
              <input aria-label="Document label" placeholder="Label, e.g. Warranty card" value={r.label} maxLength={80} onChange={(e) => setRefs(refs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <input aria-label="Document link" placeholder="https://… (optional)" value={r.url ?? ''} maxLength={500} inputMode="url" onChange={(e) => setRefs(refs.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
              <input aria-label="Document note" placeholder="Note (optional)" value={r.note ?? ''} maxLength={200} onChange={(e) => setRefs(refs.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />
              <button type="button" className="link" onClick={() => setRefs(refs.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <button type="button" className="btn" onClick={() => setRefs([...refs, { label: '' }])}>Add a document</button>
        </details>
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row as-actions">
          {warranty && !confirmDelete && <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)}>Delete…</button>}
          {warranty && confirmDelete && (
            <span className="as-confirm" role="group" aria-label="Confirm delete">
              <span className="small">Delete this warranty? The asset and its service history are kept.</span>
              {lastWithOld && (
                <label className="as-check small">
                  <input type="checkbox" checked={clearOld} onChange={(e) => setClearOld(e.target.checked)} />
                  The older warranty date saved in the asset&apos;s details will show again after this. Tick to clear it as well.
                </label>
              )}
              <button type="button" className="btn danger" onClick={() => void remove()} disabled={busy}>Yes, delete</button>
              <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>Keep</button>
            </span>
          )}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>Save</button>
        </div>
      </form>
    </Modal>
  );
}
