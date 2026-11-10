import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { contactChoiceLabel, sharedNameIds } from '../../core/contactChoice';
import { NewContactNow } from '../../ui/ContactChoice';
import { store } from '../../core/store';
import Modal from '../../shell/Modal';
import { formatCents } from '../../lib/money';
import { useToast } from '../../ui/Toast';
import { db } from '../../db';
import { createAsset, descendantIds, loadAssets, lookupOf, publicLabel, updateAsset } from './data';
import { ASSET_STATUSES, ASSET_TYPES, blankAsset, CONTACT_ROLE_HINTS, STATUS_LABEL, TYPE_LABEL, type AssetData, type AssetRecord, type AssetStatus, type AssetType } from './model';
import { chooseCost, initialChoice, type CostChoice } from './costSource';
import { CostSourceField } from './TxnRefs';
import { assetWarnings, priceFromText, validateAsset } from './validate';

/**
 * Create (no `asset`) or edit an asset. First screen: name, type, where it is. Everything else is folded away until wanted.
 * Sensitive fields are shown plainly here because you are typing them; they are hidden everywhere else.
 */
export default function AssetForm({ asset, parentId, onClose, onSaved }: { asset?: AssetRecord; parentId?: number | null; onClose: () => void; onSaved?: (id: number) => void }) {
  const toast = useToast();
  const all = useLiveQuery(() => loadAssets(), []) ?? [];
  const contacts = useLiveQuery(() => store.shared.contacts.query(), []) ?? [];
  const base = asset?.data ?? blankAsset({ parentId: parentId ?? null, type: parentId ? 'appliance' : 'other' });
  const [name, setName] = useState(base.name);
  const [type, setType] = useState<AssetType>(base.type);
  const [parent, setParent] = useState<number | null>(base.parentId);
  const [parentFilter, setParentFilter] = useState('');
  const [status, setStatus] = useState<AssetStatus>(base.status);
  const [manufacturer, setManufacturer] = useState(base.manufacturer);
  const [model, setModel] = useState(base.model);
  const [serial, setSerial] = useState(base.serialNumber);
  const [purchaseDate, setPurchaseDate] = useState(base.purchaseDate ?? '');
  const [installDate, setInstallDate] = useState(base.installDate ?? '');
  const [price, setPrice] = useState(base.purchaseCents === null ? '' : (base.purchaseCents / 100).toFixed(2));
  const [priceRefs, setPriceRefs] = useState(base.purchaseTxnRefs);
  const [priceChoice, setPriceChoice] = useState<CostChoice>(initialChoice(base.purchaseCents, base.purchaseTxnRefs));
  const [priceAck, setPriceAck] = useState(false);
  const [ledgerProp, setLedgerProp] = useState<number | null>(base.ledgerPropertyId);
  const netWorth = useLiveQuery(() => db.properties.toArray(), []) ?? [];
  const [warrantyEnd, setWarrantyEnd] = useState(base.warrantyEndDate ?? '');
  const [warrantyNote, setWarrantyNote] = useState(base.warrantyNote);
  const [notes, setNotes] = useState(base.notes);
  const [address, setAddress] = useState(base.address);
  const [plate, setPlate] = useState(base.plate);
  const [cs, setCs] = useState(base.contacts);
  const [specs, setSpecs] = useState(base.specs);
  const [refs, setRefs] = useState(base.refs);
  const [dropOk, setDropOk] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const blocked = useMemo(() => (asset ? descendantIds(all, asset.id) : new Set<number>()), [all, asset]);
  const parentChoices = all.filter((a) => !blocked.has(a.id) && (!a.data.archived || a.id === parent) && publicLabel(all, a.id).toLowerCase().includes(parentFilter.trim().toLowerCase()));
  const losing = [type !== 'property' && address.trim() ? 'address' : '', type !== 'vehicle' && plate.trim() ? 'plate' : ''].filter(Boolean);
  const chosenPrice = chooseCost(priceChoice, price, priceRefs, priceFromText);

  const draft = (): AssetData => ({
    ...base, name, type, parentId: parent, status, manufacturer, model, serialNumber: serial,
    purchaseDate: purchaseDate || null, installDate: installDate || null, purchaseCents: chosenPrice.cents, purchaseTxnRefs: chosenPrice.refs, ledgerPropertyId: ledgerProp,
    warrantyEndDate: warrantyEnd || null, warrantyNote, notes, address, plate, contacts: cs, specs, refs,
  });
  const warnings = assetWarnings({ purchaseDate: purchaseDate || null, installDate: installDate || null });

  // U2: a contact is chosen from the menu BY ID, or created on purpose in the box below (a taken name is shown first and needs a tick). Never matched by name.
  const sharedNames = sharedNameIds(contacts);
  const chooseContact = (id: number, created: boolean, name: string) => {
    if (!cs.some((c) => c.contactId === id)) setCs([...cs, { contactId: id, role: '' }]);
    toast(created ? `Created the new contact ${name}` : 'Added the existing contact');
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (chosenPrice.badAmount) return setError('The price is not an amount.');
    if (chosenPrice.dropped && !priceAck) return setError(`Tick the box to confirm removing ${chosenPrice.dropped}, or switch back to keep it.`);
    if (losing.length && !dropOk) return setError(`Tick the box to remove the saved ${losing.join(' and ')}, or change the type back.`);
    const problem = validateAsset(draft(), asset?.id, lookupOf(all));
    if (problem) return setError(problem);
    setBusy(true);
    try {
      const id = asset ? asset.id : await createAsset(draft());
      if (asset) await updateAsset(asset.id, draft());
      toast(asset ? 'Saved' : `Added ${name.trim()}`);
      onClose(); // first, so a "go to the new asset" in onSaved is the last navigation
      onSaved?.(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      setBusy(false);
    }
  }

  return (
    <Modal title={asset ? 'Edit asset' : 'Add asset'} onClose={onClose} wide>
      <form className="as-form" onSubmit={save}>
        <label className="f">Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dishwasher" autoFocus maxLength={120} /></label>
        <div className="as-two">
          <label className="f">Type
            <select value={type} onChange={(e) => setType(e.target.value as AssetType)}>
              {ASSET_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
          </label>
          {asset && (
            <label className="f">Status
              <select value={status} onChange={(e) => setStatus(e.target.value as AssetStatus)}>
                {ASSET_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </label>
          )}
        </div>
        {type !== 'property' ? (
          <div className="f as-where">
            <label htmlFor="as-where">Where is it? (optional)</label>
            <input value={parentFilter} onChange={(e) => setParentFilter(e.target.value)} placeholder="Type to narrow the list" aria-label="Narrow the list of places" type="search" />
            <select id="as-where" value={parent ?? ''} onChange={(e) => setParent(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Nowhere in particular</option>
              {parentChoices.map((a) => <option key={a.id} value={a.id}>{publicLabel(all, a.id)}</option>)}
            </select>
          </div>
        ) : <p className="muted small">A property sits at the top, so it has no place above it.</p>}

        <details className="as-sec">
          <summary>Make, dates and warranty</summary>
          <div className="as-two">
            <label className="f">Make (manufacturer)<input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} maxLength={80} /></label>
            <label className="f">Model<input value={model} onChange={(e) => setModel(e.target.value)} maxLength={80} /></label>
          </div>
          <label className="f">{type === 'vehicle' ? 'VIN (vehicle identification number)' : 'Serial number'}<input value={serial} onChange={(e) => setSerial(e.target.value)} maxLength={60} autoComplete="off" spellCheck={false} /></label>
          <div className="as-two">
            <label className="f">Bought on<input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} /></label>
            <label className="f">Installed or in use since<input type="date" value={installDate} onChange={(e) => setInstallDate(e.target.value)} /></label>
          </div>
          {warnings.map((w) => <p key={w} className="muted small" role="status">{w}</p>)}
          <CostSourceField idp="price" label="Price paid" choice={priceChoice} setChoice={setPriceChoice} text={price} setText={setPrice} refs={priceRefs} setRefs={setPriceRefs} parse={priceFromText} ack={priceAck} setAck={setPriceAck}
            help="Not tracked if left blank. Just a note for this item: it does not change your net worth or accounts." />
          {priceChoice === 'manual' && chosenPrice.cents !== null && <p className="muted small">Price: {formatCents(chosenPrice.cents)}</p>}
          {(type === 'property' || type === 'vehicle' || type === 'other') && (
            <label className="f">Net worth entry (optional)
              <select value={ledgerProp ?? ''} onChange={(e) => setLedgerProp(e.target.value === '' ? null : Number(e.target.value))}>
                <option value="">None</option>
                {ledgerProp !== null && !netWorth.some((p) => p.id === ledgerProp) && <option value={ledgerProp}>(net worth entry removed)</option>}
                {netWorth.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <span className="muted small">Points at an entry on Finance's Net worth screen so its latest value can be shown here. Finance keeps the value; nothing is created or changed there.</span>
            </label>
          )}
          <div className="as-two">
            <label className="f">Warranty ends<input type="date" value={warrantyEnd} onChange={(e) => setWarrantyEnd(e.target.value)} /></label>
            <label className="f">Warranty note<input value={warrantyNote} onChange={(e) => setWarrantyNote(e.target.value)} placeholder="What it covers" maxLength={500} /></label>
          </div>
          <p className="muted small">One simple warranty only. For several (manufacturer, extended), save this asset and use Warranties on its page.</p>
          {type === 'property' && <label className="f">Address<input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} autoComplete="off" /></label>}
          {type === 'vehicle' && <label className="f">Plate<input value={plate} onChange={(e) => setPlate(e.target.value)} maxLength={20} autoComplete="off" spellCheck={false} /></label>}
        </details>

        <details className="as-sec">
          <summary>Contacts ({cs.length})</summary>
          <p className="muted small">The people and companies behind it: who installed it, who services it, who to call for the warranty. They are your shared contacts.</p>
          {cs.map((c, i) => (
            <div key={i} className="as-line">
              <select className="cc-fill" aria-label="Contact" value={c.contactId} onChange={(e) => setCs(cs.map((x, j) => (j === i ? { ...x, contactId: Number(e.target.value) } : x)))}>
                {contacts.some((k) => k.id === c.contactId) ? null : <option value={c.contactId}>(contact removed)</option>}
                {contacts.map((k) => <option key={k.id} value={k.id}>{contactChoiceLabel(k, contacts, sharedNames)}</option>)}
              </select>
              <input aria-label="Role" list="as-roles" placeholder="Role, e.g. installer" value={c.role} maxLength={40} onChange={(e) => setCs(cs.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} />
              <button type="button" className="link" onClick={() => setCs(cs.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <datalist id="as-roles">{CONTACT_ROLE_HINTS.map((r) => <option key={r} value={r} />)}</datalist>
          {contacts.length > 0 && (
            <select className="cc-fill" aria-label="Add an existing contact" value="" onChange={(e) => { if (e.target.value) setCs([...cs, { contactId: Number(e.target.value), role: '' }]); }}>
              <option value="">Add an existing contact…</option>
              {contacts.filter((k) => !cs.some((c) => c.contactId === k.id)).map((k) => <option key={k.id} value={k.id}>{contactChoiceLabel(k, contacts, sharedNames)}</option>)}
            </select>
          )}
          <NewContactNow idp="as-contact" label="Or create a new contact" onChosen={chooseContact} />
          <p className="muted small">A new contact is created as soon as you confirm it, even if you then cancel this form.</p>
        </details>

        <details className="as-sec">
          <summary>Specs ({specs.length})</summary>
          <p className="muted small">Anything useful: filter size, paint colour, capacity.</p>
          {specs.map((s, i) => (
            <div key={i} className="as-line">
              <input aria-label="Spec label" placeholder="Label" value={s.label} maxLength={40} onChange={(e) => setSpecs(specs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <input aria-label="Spec value" placeholder="Value" value={s.value} maxLength={200} onChange={(e) => setSpecs(specs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
              <button type="button" className="link" onClick={() => setSpecs(specs.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <button type="button" className="btn" onClick={() => setSpecs([...specs, { label: '', value: '' }])}>Add a spec</button>
        </details>

        <details className="as-sec">
          <summary>Documents ({refs.length})</summary>
          <p className="muted small">Where the receipt or manual is: a link to your own cloud storage, or a note such as "paper copy, blue folder". Files are not stored in Ledger.</p>
          {refs.map((r, i) => (
            <div key={i} className="as-ref">
              <input aria-label="Document label" placeholder="Label, e.g. Receipt" value={r.label} maxLength={80} onChange={(e) => setRefs(refs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <input aria-label="Document link" placeholder="https://… (optional)" value={r.url ?? ''} maxLength={500} inputMode="url" onChange={(e) => setRefs(refs.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
              <input aria-label="Document note" placeholder="Note (optional)" value={r.note ?? ''} maxLength={200} onChange={(e) => setRefs(refs.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />
              <button type="button" className="link" onClick={() => setRefs(refs.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <button type="button" className="btn" onClick={() => setRefs([...refs, { label: '' }])}>Add a document</button>
        </details>

        <details className="as-sec">
          <summary>Notes</summary>
          <p className="muted small">Please do not store alarm codes, passwords or account numbers here.</p>
          <label className="f sr-label">Notes<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} maxLength={5000} /></label>
        </details>

        {losing.length > 0 && (
          <label className="as-check warn"><input type="checkbox" checked={dropOk} onChange={(e) => setDropOk(e.target.checked)} /> Remove the saved {losing.join(' and ')} (it only applies to {losing.includes('address') ? 'a property' : 'a vehicle'}).</label>
        )}
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row as-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>{asset ? 'Save' : 'Add asset'}</button>
        </div>
      </form>
    </Modal>
  );
}
