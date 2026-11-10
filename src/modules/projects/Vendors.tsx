import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { updateContactDetails } from '../../core/contacts';
import { contactChoiceLabel, sharedNameIds } from '../../core/contactChoice';
import type { Contact } from '../../core/entities';
import { store } from '../../core/store';
import { db } from '../../db';
import { EmptyState } from '../../ui/components';
import { useToast } from '../../ui/Toast';
import { NewContactBox } from '../../ui/ContactChoice';
import { addNewVendor, addVendor, commitmentsWithVendor, projectsUsingContact, removeVendor } from './data';

/**
 * The people and businesses involved in a project. They are the shared contacts: an existing contact is chosen from the menu (by id), a new one is created on
 * purpose (a name that is already taken is shown first and needs a tick; nothing is reused or merged by name), and the same contact can be on several projects.
 * Editing a contact here changes it everywhere it is used.
 */
export default function Vendors({ projectId, vendorIds }: { projectId: number; vendorIds: number[] }) {
  const toast = useToast();
  const contacts = useLiveQuery(() => store.shared.contacts.query(), []) ?? [];
  const byId = new Map(contacts.map((c) => [c.id as number, c]));
  const vendors = vendorIds.map((id) => byId.get(id));
  const free = contacts.filter((c) => !vendorIds.includes(c.id as number)).sort((a, b) => a.name.localeCompare(b.name));

  const shared = sharedNameIds(contacts);
  const [pick, setPick] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Contact | null>(null);

  async function run(fn: () => Promise<void>) {
    try { await fn(); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); }
  }

  const addExisting = () => run(async () => { await addVendor(projectId, Number(pick)); setPick(''); });

  return (
    <section className="card pj-card" aria-labelledby="pj-vendors-h">
      <h2 id="pj-vendors-h">Vendors and people</h2>
      {vendorIds.length === 0 ? (
        <EmptyState title="No vendors yet">Add the contractor, designer or shop involved. They are saved in your shared contacts.</EmptyState>
      ) : (
        <ul className="plain pj-vendors">
          {vendors.map((c, i) => c ? (
            <li key={c.id} className="pj-vendor">
              {editing?.id === c.id ? (
                <VendorEdit contact={c} onDone={() => setEditing(null)} />
              ) : (
                <>
                  <span className="pj-vendor-main">
                    <strong>{c.name}</strong>
                    {c.relationship && <span className="muted small">{c.relationship}</span>}
                    <span className="pj-vendor-contact small">
                      {c.phone && <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}>{c.phone}</a>}
                      {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
                      {!c.phone && !c.email && <span className="muted">No phone or email yet</span>}
                    </span>
                  </span>
                  <span className="pj-line-actions">
                    <button className="link" onClick={() => setEditing(c)}>Edit</button>
                    <button className="link danger" onClick={() => void run(async () => {
                      const others = (await projectsUsingContact(c.id as number)).filter((p) => p.id !== projectId).length;
                      const used = await commitmentsWithVendor(projectId, c.id as number);
                      if (!confirm(`Take ${c.name} off this project?${used ? ` They are still the vendor on ${used} commitment${used === 1 ? '' : 's'}, which keep${used === 1 ? 's' : ''} them.` : ''}${others ?` They stay on ${others} other project${others === 1 ? '' : 's'} and in your contacts.` : ' They stay in your contacts.'}`)) return;
                      await removeVendor(projectId, c.id as number);
                    })}>Remove</button>
                  </span>
                </>
              )}
            </li>
          ) : (
            <li key={`missing-${vendorIds[i]}`} className="pj-vendor muted">
              <span>(contact no longer exists)</span>
              <button className="link danger" onClick={() => void run(() => removeVendor(projectId, vendorIds[i]))}>Remove</button>
            </li>
          ))}
        </ul>
      )}

      {free.length > 0 && (
        <div className="pj-add">
          <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Add an existing contact">
            <option value="">Add someone from your contacts…</option>
            {free.map((c) => <option key={c.id} value={c.id}>{contactChoiceLabel(c, contacts, shared)}</option>)}
          </select>
          <button className="btn" disabled={!pick} onClick={() => void addExisting()}>Add</button>
        </div>
      )}

      {creating ? (
        <NewContactBox idp="pj-newvendor" showRelationship submitLabel="Create new contact"
          onReady={async (c) => { await addNewVendor(projectId, c); toast(`Added ${(c.name ?? "").trim()} as a new contact and vendor`); setCreating(false); }}
          onUseExisting={(id) => void run(async () => { await addVendor(projectId, id); setCreating(false); })}
          onCancel={() => setCreating(false)} />
      ) : (
        <button type="button" className="btn pj-newvendor-btn" onClick={() => setCreating(true)}>Create a new vendor contact</button>
      )}
      {error && <div className="error" role="alert">{error}</div>}
    </section>
  );
}

function VendorEdit({ contact, onDone }: { contact: Contact; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(contact.name);
  const [role, setRole] = useState(contact.relationship ?? '');
  const [phone, setPhone] = useState(contact.phone ?? '');
  const [email, setEmail] = useState(contact.email ?? '');
  const [error, setError] = useState('');
  async function save() {
    try {
      await updateContactDetails(db, contact.id as number, { name, relationship: role, phone, email });
      toast('Contact saved');
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); }
  }
  return (
    <div className="pj-newvendor">
      <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" maxLength={120} />
      <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="What they do" aria-label="What they do" />
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" aria-label="Phone" inputMode="tel" />
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" aria-label="Email" inputMode="email" />
      <span className="muted small">Changes this contact everywhere it is used.</span>
      <button className="btn primary" onClick={() => void save()}>Save</button>
      <button className="btn" onClick={onDone}>Cancel</button>
      {error && <div className="error" role="alert">{error}</div>}
    </div>
  );
}
