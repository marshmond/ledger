import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Modal from '../../shell/Modal';
import { db } from '../../db';
import { createDistinctContact, nameKey, sameNameMatches, StaleContactError, updateContactDetails, validateContact } from '../../core/contacts';
import { readContactUsage, usageSummary } from '../../core/contactUsage';
import type { Contact } from '../../core/entities';
import { isLive, store } from '../../core/store';
import { distinguish } from './model';

/**
 * Add a Contact, or edit one. Adding always makes a NEW Contact (`createDistinctContact`): it never matches or merges by name. A name that is already
 * taken (when adding, or when renaming to it) is shown with what tells the entries apart and needs a tick that this is a different person or
 * organisation. Editing remembers the version it opened; if the Contact changed meanwhile the save is refused and nothing is overwritten.
 */
export default function ContactForm({ contact, onClose, onSaved, onOpen }: {
  contact?: Contact;
  onClose: () => void;
  /** `changed` is false for an edit that changed nothing (nothing was written). */
  onSaved: (id: number, changed: boolean, created: boolean) => void;
  /** Open another existing Contact instead of saving (the warning's "Open this one"). */
  onOpen: (id: number) => void;
}) {
  const editing = !!contact;
  const [name, setName] = useState(contact?.name ?? '');
  const [relationship, setRelationship] = useState(contact?.relationship ?? '');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [email, setEmail] = useState(contact?.email ?? '');
  /** The stored version this form was opened on (or last reloaded to). */
  const [expected, setExpected] = useState(contact);
  const [different, setDifferent] = useState(false);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);

  const all = useLiveQuery(() => store.shared.contacts.query(), []) ?? [];
  const matches = sameNameMatches(all, name, contact?.id);
  const renamed = editing && nameKey(name) !== nameKey(contact!.name);
  const needsTick = matches.length > 0 && (!editing || renamed);
  const matchKey = matches.map((m) => m.id).join(',');
  const matchUsage = useLiveQuery(async () => (matches.length ? readContactUsage(db, matches.map((m) => m.id as number)) : null), [matchKey]);

  async function reload() {
    const cur = contact?.id !== undefined ? await db.contacts.get(contact.id) : undefined;
    if (!cur || !isLive(cur)) { setError('This contact no longer exists. Close this window.'); return; }
    setName(cur.name); setRelationship(cur.relationship ?? ''); setPhone(cur.phone ?? ''); setEmail(cur.email ?? '');
    setExpected(cur); setStale(false); setError(''); setDifferent(false);
  }

  async function save() {
    if (busy) return;
    setError('');
    const input = { name, relationship, phone, email };
    const problem = validateContact(input);
    if (problem) return setError(problem);
    if (needsTick && !different) return setError('A contact with this name already exists. Open that one instead, or tick the box to confirm this is a different person or organization.');
    setBusy(true);
    try {
      if (editing) {
        const r = await updateContactDetails(db, contact!.id as number, input, { expected });
        onSaved(contact!.id as number, r.changed, false);
      } else {
        const id = await createDistinctContact(db, input);
        onSaved(id, true, true);
      }
    } catch (e) {
      if (e instanceof StaleContactError) setStale(true);
      setError(e instanceof Error ? e.message : 'Nothing was saved.');
      setBusy(false);
    }
  }

  return (
    <Modal title={editing ? 'Edit contact' : 'Add a contact'} onClose={onClose}>
      <form className="ct-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <label className="f">Name<input value={name} onChange={(e) => { setName(e.target.value); setDifferent(false); }} maxLength={120} autoComplete="off" required autoFocus /></label>
        <label className="f">How you know them, or what they do (optional)<input value={relationship} onChange={(e) => setRelationship(e.target.value)} autoComplete="off" placeholder="sister, plumber, school office" /></label>
        <label className="f">Phone (optional)<input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={40} autoComplete="off" /></label>
        <label className="f">Email (optional)<input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" autoComplete="off" /></label>

        {matches.length > 0 && (
          <div className="ct-warn" role="status">
            <strong>{matches.length === 1 ? 'A contact with this name already exists.' : `${matches.length} contacts with this name already exist.`}</strong>
            <ul className="plain">
              {matches.map((m) => (
                <li key={m.id} className="ct-match">
                  <span><strong>{m.name}</strong><br /><span className="muted small">{distinguish(m)}</span><br /><span className="muted small">{matchUsage ? usageSummary(matchUsage.byContact.get(m.id as number)) : 'Checking where it is used…'}</span></span>
                  <button type="button" className="btn" onClick={() => onOpen(m.id as number)}>Open this one</button>
                </li>
              ))}
            </ul>
            {needsTick ? (
              <label className="as-check"><input type="checkbox" checked={different} onChange={(e) => setDifferent(e.target.checked)} aria-labelledby="ct-diff-text" /> <span id="ct-diff-text">{editing ? 'This is a different person or organization with the same name. Keep both.' : 'This is a different person or organization with the same name. Create a separate contact.'}</span></label>
            ) : (
              <p className="muted small">This contact already shared its name with another before this edit. Nothing is merged.</p>
            )}
          </div>
        )}

        {editing && (
          <p className="ct-note small">
            Saving changes the one shared contact that Family, Tasks, Calendar, Projects, Home &amp; Assets, Household Services and Bills all use.
            {renamed && ' A new name will show wherever the contact is linked. A few places keep the name that was written at the time and are not changed: provider names saved on past bills and service visits, and the titles of birthday events that were already created.'}
          </p>
        )}
        {!editing && <p className="muted small">A new contact is added to your shared contacts. Nothing existing is changed or merged.</p>}

        {error && (
          <div className="error" role="alert">
            {error}
            {stale && <> <button type="button" className="btn" onClick={() => void reload()}>Reload the current details</button></>}
          </div>
        )}
        <div className="row ct-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>{editing ? 'Save' : 'Add contact'}</button>
        </div>
      </form>
    </Modal>
  );
}
