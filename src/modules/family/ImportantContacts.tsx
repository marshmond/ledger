import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { nameKey } from '../../core/contacts';
import type { Contact } from '../../core/entities';
import { store } from '../../core/store';
import ConfirmDialog from '../../shell/ConfirmDialog';
import Modal from '../../shell/Modal';
import { EmptyState } from '../../ui/components';
import { useToast } from '../../ui/Toast';
import { contactDetail } from './MemberForm';
import { type ContactChoice } from './data';
import { addImportantContact, loadImportantContacts, setImportantContactStatus, updateImportantContactPurpose } from './importantContactData';
import { activeFor, duplicateAssociations, PURPOSE_MAX, type ImportantContactRecord } from './importantContactModel';
import { sameNameContacts } from './model';

/**
 * Add an important contact to a member, or change the purpose of one. Adding asks the person to CHOOSE: link an existing Contact (never changed) or
 * create a separate new Contact (never silently matched to a same-named one; the same-name warning is the member form's). The Contact cannot be
 * changed when editing: remove the association and add another instead.
 */
export function ContactForm({ memberId, ownContactId, record, onClose, onSaved }: { memberId: number; ownContactId: number; record?: ImportantContactRecord; onClose: () => void; onSaved: (created: boolean) => void }) {
  const editing = !!record?.data;
  const contacts = useLiveQuery(() => store.shared.contacts.query(), []) ?? [];
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [filter, setFilter] = useState('');
  const [picked, setPicked] = useState<number | null>(null);
  const [newName, setNewName] = useState('');
  const [different, setDifferent] = useState(false);
  const [purpose, setPurpose] = useState(record?.data?.purpose ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const linked = record?.data ? contacts.find((c) => c.id === record.data!.contactId) : undefined;
  const shown = useMemo(() => {
    const q = nameKey(filter);
    return contacts.filter((c) => c.id !== ownContactId && (!q || nameKey(c.name).includes(q))).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 50);
  }, [contacts, filter, ownContactId]);
  const matches = mode === 'new' ? sameNameContacts(contacts, newName, nameKey) : [];

  async function save() {
    if (busy) return;
    setError('');
    let contact: ContactChoice | null = null;
    if (!editing) {
      if (mode === 'existing') {
        if (picked === null) return setError('Choose which contact this is, or switch to “Create a new contact”.');
        contact = { mode: 'existing', contactId: picked };
      } else {
        if (!newName.trim()) return setError('Enter a name.');
        if (matches.length > 0 && !different) return setError('A contact with this name already exists. Choose “Use this one instead”, or tick the box to confirm this is a different person.');
        contact = { mode: 'new', name: newName };
      }
    }
    setBusy(true);
    try {
      if (editing) {
        await updateImportantContactPurpose(record!.id, purpose);
        onSaved(false);
      } else {
        const r = await addImportantContact({ memberId, contact: contact!, purpose });
        onSaved(r.createdContact);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nothing was saved.');
      setBusy(false);
    }
  }

  return (
    <Modal title={editing ? 'Change purpose' : 'Add an important contact'} onClose={onClose}>
      <form className="fm-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {editing ? (
          <p className="fm-note">Contact: <strong>{linked?.name ?? 'a contact that no longer exists'}</strong>. To use a different contact, remove this one and add another.</p>
        ) : (
          <>
            <fieldset className="fm-sub">
              <legend>Who is it?</legend>
              <label className="as-check"><input type="radio" name="fm-ic-mode" checked={mode === 'existing'} onChange={() => setMode('existing')} /> Use an existing contact</label>
              <label className="as-check"><input type="radio" name="fm-ic-mode" checked={mode === 'new'} onChange={() => setMode('new')} /> Create a new contact</label>
            </fieldset>
            {mode === 'existing' ? (
              <fieldset className="fm-sub">
                <legend>Existing contact</legend>
                <label className="f">Search contacts<input value={filter} onChange={(e) => setFilter(e.target.value)} autoComplete="off" placeholder="Type part of a name" /></label>
                {contacts.length === 0 ? <p className="muted small">There are no contacts yet. Choose “Create a new contact”.</p> : shown.length === 0 ? <p className="muted small" role="status">No contact matches that.</p> : (
                  <div className="fm-pick" role="radiogroup" aria-label="Existing contacts">
                    {shown.map((c) => (
                      <label key={c.id} className="fm-opt">
                        <input type="radio" name="fm-ic-contact" value={c.id} checked={picked === c.id} onChange={() => setPicked(c.id!)} />
                        <span><strong>{c.name}</strong><br /><span className="muted small">{contactDetail(c)}</span></span>
                      </label>
                    ))}
                  </div>
                )}
                <p className="muted small">Linking does not change the contact.</p>
              </fieldset>
            ) : (
              <fieldset className="fm-sub">
                <legend>New contact</legend>
                <label className="f">Name<input value={newName} onChange={(e) => { setNewName(e.target.value); setDifferent(false); }} maxLength={120} autoComplete="off" /></label>
                {matches.length > 0 && (
                  <div className="fm-warn" role="status">
                    <strong>{matches.length === 1 ? 'A contact with this name already exists.' : `${matches.length} contacts with this name already exist.`}</strong>
                    <ul className="plain">
                      {matches.map((c: Contact) => (
                        <li key={c.id} className="row">
                          <span>{c.name} <span className="muted small">({contactDetail(c)})</span></span>
                          {c.id !== ownContactId && <button type="button" className="btn" onClick={() => { setMode('existing'); setPicked(c.id!); setFilter(c.name); setDifferent(false); }}>Use this one instead</button>}
                        </li>
                      ))}
                    </ul>
                    <label className="as-check"><input type="checkbox" checked={different} onChange={(e) => setDifferent(e.target.checked)} /> This is a different person or place with the same name. Create a separate contact.</label>
                  </div>
                )}
                <p className="muted small">A new contact is added to your shared Contacts. Nothing existing is changed or merged. Add a phone number or email later wherever you edit contacts.</p>
              </fieldset>
            )}
          </>
        )}
        <label className="f">What is this contact for?
          <input value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={PURPOSE_MAX} autoComplete="off" placeholder="For example School office, Soccer coach" aria-describedby="fm-ic-help" />
        </label>
        <p className="muted small" id="fm-ic-help">A few words. Do not put health details, identity numbers, passwords or account details here.</p>
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row fm-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>{editing ? 'Save' : 'Add contact'}</button>
        </div>
      </form>
    </Modal>
  );
}

/** The contacts that matter for one member (school office, coach, emergency contact…). A link to a shared Contact plus a short purpose. */
export function ImportantContactsSection({ memberId, ownContactId, memberName }: { memberId: number; ownContactId: number; memberName: string }) {
  const records = useLiveQuery(() => loadImportantContacts(), []);
  const contacts = useLiveQuery(() => store.shared.contacts.query(), []);
  const [form, setForm] = useState<{ record?: ImportantContactRecord } | null>(null);
  const [confirm, setConfirm] = useState<ImportantContactRecord | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const toast = useToast();

  if (!records || !contacts) {
    return <section className="card" aria-labelledby="fm-ic"><div className="card-head"><h2 className="card-title" id="fm-ic">Important contacts</h2></div><p className="muted" role="status">Loading…</p></section>;
  }
  const byId = new Map(contacts.map((c) => [c.id as number, c]));
  const mine = records.filter((r) => r.data?.memberId === memberId);
  const active = activeFor(mine, memberId);
  const removed = mine.filter((r) => r.data?.status === 'archived');
  const unreadable = records.filter((r) => !r.data).length;
  const dup = new Set(duplicateAssociations(mine).flat().map((r) => r.id));

  const run = async (fn: () => Promise<void>, done: string) => {
    try { await fn(); toast(done); } catch (e) { toast(e instanceof Error ? e.message : 'Nothing was changed.'); }
  };

  const row = (r: ImportantContactRecord, isRemoved: boolean) => {
    const c = byId.get(r.data!.contactId);
    return (
      <li key={r.id} className="fm-item fm-ic-row">
        <div className="fm-item-text">
          <span className="fm-item-title">{c?.name ?? 'A contact that no longer exists'}</span>
          <span className="small">{r.data!.purpose}</span>
          {c ? <span className="muted small">{contactDetail(c)}</span> : <span className="muted small">The shared contact was removed. This association is kept.</span>}
          {dup.has(r.id) && <span className="fm-late small">Possible duplicate: the same contact and purpose is listed more than once. Nothing was merged. Remove the extra one.</span>}
        </div>
        <span className="row fm-date-actions">
          {isRemoved ? (
            <button type="button" className="btn fm-mini" aria-label={`Put back ${c?.name ?? 'contact'} (${r.data!.purpose})`} onClick={() => void run(() => setImportantContactStatus(r.id, 'active'), 'Put back')}>Put back</button>
          ) : (
            <>
              <button type="button" className="btn fm-mini" aria-label={`Change purpose of ${c?.name ?? 'contact'} (${r.data!.purpose})`} onClick={() => setForm({ record: r })}>Change purpose</button>
              <button type="button" className="btn fm-mini" aria-label={`Remove ${c?.name ?? 'contact'} (${r.data!.purpose}) from ${memberName}`} onClick={() => setConfirm(r)}>Remove</button>
            </>
          )}
        </span>
      </li>
    );
  };

  return (
    <section className="card" aria-labelledby="fm-ic">
      <div className="card-head">
        <h2 className="card-title" id="fm-ic">Important contacts</h2>
        <button type="button" className="btn fm-mini" onClick={() => setForm({})}>Add contact</button>
      </div>
      {active.length === 0 ? (
        <EmptyState title="No important contacts yet">
          Add the school office, a coach, a childcare provider or an emergency contact. They come from your shared Contacts, and nothing is copied.
        </EmptyState>
      ) : <ul className="plain fm-items">{active.map((r) => row(r, false))}</ul>}
      {unreadable > 0 && <p className="muted small" role="status">{unreadable === 1 ? '1 saved contact link' : `${unreadable} saved contact links`} could not be read by this version of Ledger. {unreadable === 1 ? 'It is' : 'They are'} kept exactly as {unreadable === 1 ? 'it is' : 'they are'}.</p>}
      {removed.length > 0 && (
        <>
          <button type="button" className="btn fm-mini" aria-expanded={showRemoved} onClick={() => setShowRemoved(!showRemoved)}>{showRemoved ? 'Hide removed' : `Show removed (${removed.length})`}</button>
          {showRemoved && <ul className="plain fm-items">{removed.map((r) => row(r, true))}</ul>}
        </>
      )}
      {form && (
        <ContactForm
          memberId={memberId} ownContactId={ownContactId} record={form.record}
          onClose={() => setForm(null)}
          onSaved={(created) => { setForm(null); toast(form.record ? 'Saved' : created ? 'Added, with a new contact' : 'Added'); }}
        />
      )}
      {confirm?.data && (
        <ConfirmDialog
          title="Remove this important contact?"
          confirmLabel="Remove"
          tone="primary"
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            await setImportantContactStatus(confirm.id, 'archived');
            setConfirm(null);
            toast('Removed. You can put it back.');
          }}
        >
          <p>{byId.get(confirm.data.contactId)?.name ?? 'This contact'} ({confirm.data.purpose}) is taken off {memberName}’s list. The contact itself is not deleted or changed, and you can put it back from “Show removed”.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
