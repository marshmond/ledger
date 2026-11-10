import { useState } from 'react';
import { db } from '../db';
import type { Contact } from '../core/entities';
import { contactBrief, contactChoiceLabel, sharedNameIds } from '../core/contactChoice';
import { findSameNameContacts, resolveContactChoice, SameNameContactError, type ContactChoice } from '../core/contactIdentity';
import { validateContact } from '../core/contacts';
import { isLive } from '../core/store';
import './contactChoice.css';

/**
 * Contacts U2: the small, shared "use an existing Contact / create a new one" choice for the Home & Assets, Bills, Projects and Household Services forms.
 *
 *  - An existing Contact is picked from a menu BY ITS ID. Two Contacts with one name are two separate choices, each labelled with what tells them apart.
 *  - A new Contact is created only when the owner presses the button. If a live Contact already has that name, nothing is created: every match is listed
 *    (with details, so they can be told apart), each has "Use this contact" (by id), and a separate Contact needs the tick "This is a different person or
 *    organization".
 *  - A name typed here never selects an existing Contact.
 */

/** What the owner has chosen for one Contact field: an existing Contact by id, a NEW one (made when the form is saved), or neither. */
export interface ContactPick { contactId: number | null; newContact: ContactChoice | null }
export const NO_PICK: ContactPick = { contactId: null, newContact: null };
export const pickOf = (contactId: number | null): ContactPick => ({ contactId, newContact: null });
/** What a save passes to the data layer, or null for "nobody". */
export const pickToChoice = (p: ContactPick): ContactChoice | null => p.newContact ?? (p.contactId != null ? { contactId: p.contactId } : null);
/** True when the pick differs from the Contact id stored on the record (so an unchanged field can be left out of the save). */
export const pickChanged = (p: ContactPick, stored: number | null): boolean => p.newContact !== null || p.contactId !== stored;

// ---- the existing-Contact menu ----

/** A menu of live Contacts, chosen by id. A stored id that is no longer a live Contact stays selectable as "(contact removed)" and is never replaced silently. */
export function ContactSelect({ idp, label, contacts, value, onChange, noneLabel, exclude = [], disabled = false }: {
  idp: string; label: string; contacts: readonly Contact[]; value: number | null; onChange: (id: number | null) => void; noneLabel: string; exclude?: readonly number[]; disabled?: boolean;
}) {
  const live = contacts.filter((c) => isLive(c));
  const shared = sharedNameIds(live);
  const missing = value !== null && !live.some((c) => c.id === value);
  return (
    <label className="f cc-sel" htmlFor={`${idp}-sel`}>{label}
      <select id={`${idp}-sel`} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
        <option value="">{noneLabel}</option>
        {missing && <option value={value}>(contact removed)</option>}
        {live.filter((c) => !exclude.includes(c.id as number)).map((c) => <option key={c.id} value={c.id}>{contactChoiceLabel(c, live, shared)}</option>)}
      </select>
    </label>
  );
}

// ---- the new-Contact box ----

export interface NewContactFields { name: string; phone: string; email: string; relationship: string }
export const BLANK_FIELDS: NewContactFields = { name: '', phone: '', email: '', relationship: '' };

/** The look of the box for a given state. Pure (no database), so every state can be checked without a browser. */
export function NewContactBoxView({ idp, fields, matches, different, error, busy, submitLabel, showRelationship, onField, onSubmit, onUse, onDifferent, onCancel }: {
  idp: string; fields: NewContactFields; matches: Contact[] | null; different: boolean; error: string; busy: boolean; submitLabel: string; showRelationship: boolean;
  onField: (k: keyof NewContactFields, v: string) => void; onSubmit: () => void; onUse: (id: number) => void; onDifferent: (v: boolean) => void; onCancel: () => void;
}) {
  const enter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); onSubmit(); } };
  const name = fields.name.trim();
  return (
    <div className="cc-box" role="group" aria-label="Create a new contact">
      <strong className="small">Create new contact</strong>
      <label className="f" htmlFor={`${idp}-name`}>Name
        <input id={`${idp}-name`} value={fields.name} maxLength={120} autoComplete="off" onChange={(e) => onField('name', e.target.value)} onKeyDown={enter} />
      </label>
      <div className="cc-two">
        <label className="f" htmlFor={`${idp}-phone`}>Phone (optional)
          <input id={`${idp}-phone`} value={fields.phone} inputMode="tel" autoComplete="off" onChange={(e) => onField('phone', e.target.value)} onKeyDown={enter} />
        </label>
        <label className="f" htmlFor={`${idp}-email`}>Email (optional)
          <input id={`${idp}-email`} value={fields.email} inputMode="email" autoComplete="off" onChange={(e) => onField('email', e.target.value)} onKeyDown={enter} />
        </label>
      </div>
      {showRelationship && (
        <label className="f" htmlFor={`${idp}-rel`}>What they do (optional)
          <input id={`${idp}-rel`} value={fields.relationship} autoComplete="off" onChange={(e) => onField('relationship', e.target.value)} onKeyDown={enter} />
        </label>
      )}
      {error && <p className="cc-error" role="alert">{error}</p>}
      {matches && matches.length > 0 && (
        <div className="cc-same" role="group" aria-label="This name already exists">
          <p role="alert"><strong>This name already exists.</strong> {matches.length === 1 ? 'A contact named' : `${matches.length} contacts named`} “{name}” {matches.length === 1 ? 'is' : 'are'} already in your contacts. Use the right one, or confirm this is someone different.</p>
          <ul className="plain">
            {matches.map((m) => (
              <li key={m.id} className="cc-match">
                <span>{m.name} <span className="muted small">{contactBrief(m)}</span></span>
                <button type="button" className="btn" aria-label={`Use existing contact ${m.name}, ${contactBrief(m)}`} onClick={() => onUse(m.id as number)}>Use this contact</button>
              </li>
            ))}
          </ul>
          <label className="as-check cc-check"><input type="checkbox" checked={different} onChange={(e) => onDifferent(e.target.checked)} /> <span>This is a different person or organization with the same name</span></label>
        </div>
      )}
      <div className="row cc-actions">
        <button type="button" className="btn" onClick={onSubmit} disabled={!name || busy || (!!matches && matches.length > 0 && !different)}>{submitLabel}</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/**
 * Collects the details of a NEW Contact and checks the name against the live Contacts. It writes nothing itself: when the owner has finished (and, if the
 * name is taken, confirmed), it hands `onReady` the choice, and the form decides when to save it. `onUseExisting` is the "Use this contact" button.
 * If `onReady` throws `SameNameContactError` (a Contact with this name appeared since the check), the matches are shown instead of an error.
 */
export function NewContactBox({ idp, initialName = '', submitLabel = 'Create new contact', showRelationship = false, onReady, onUseExisting, onCancel }: {
  idp: string; initialName?: string; submitLabel?: string; showRelationship?: boolean;
  onReady: (choice: ContactChoice) => Promise<void> | void; onUseExisting: (id: number) => void; onCancel: () => void;
}) {
  const [fields, setFields] = useState<NewContactFields>({ ...BLANK_FIELDS, name: initialName });
  const [matches, setMatches] = useState<Contact[] | null>(null);
  const [different, setDifferent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return;
    const problem = validateContact(fields);
    if (problem) return setError(problem);
    setBusy(true); setError('');
    try {
      const found = await findSameNameContacts(db, fields.name);
      if (found.length > 0 && !different) { setMatches(found); return; }
      await onReady({ name: fields.name, phone: fields.phone, email: fields.email, relationship: fields.relationship, confirmedDifferent: found.length > 0 && different });
      setFields(BLANK_FIELDS); setMatches(null); setDifferent(false);
    } catch (e) {
      if (e instanceof SameNameContactError) { setMatches(e.matches); setDifferent(false); }
      else setError(e instanceof Error ? e.message : 'That contact could not be added.');
    } finally { setBusy(false); }
  };
  return (
    <NewContactBoxView
      idp={idp} fields={fields} matches={matches} different={different} error={error} busy={busy} submitLabel={submitLabel} showRelationship={showRelationship}
      onField={(k, v) => { setFields({ ...fields, [k]: v }); if (k === 'name') { setMatches(null); setDifferent(false); } setError(''); }}
      onSubmit={() => void submit()} onUse={onUseExisting} onDifferent={setDifferent} onCancel={onCancel}
    />
  );
}

// ---- one Contact field: menu + new ----

/** What a "new contact" the owner has set up (but that is not saved yet) looks like, with Change and Remove. Pure. */
export function PendingNewContact({ choice, onChange, onRemove }: { choice: ContactChoice; onChange: () => void; onRemove: () => void }) {
  return (
    <div className="cc-pending" role="status">
      <span>New contact to be created when you save: <strong>{choice.name}</strong>{choice.phone ? ` · ${choice.phone}` : ''}{choice.email ? ` · ${choice.email}` : ''}{choice.confirmedDifferent ? ' (a different person or organization from the contact with the same name)' : ''}</span>
      <span className="cc-pending-actions">
        <button type="button" className="link" onClick={onChange} aria-label={`Change the new contact ${choice.name}`}>Change</button>
        <button type="button" className="link" onClick={onRemove} aria-label={`Do not create the new contact ${choice.name}`}>Do not create</button>
      </span>
    </div>
  );
}

/**
 * One Contact field for a form that saves everything at once (Bills, Projects commitments, Household Services). The owner picks an existing Contact (by id)
 * or sets up a new one; a new one is NOT created here: the form passes `pickToChoice(value)` to its save, which creates it in the same transaction as the
 * record (and refuses a taken name that was not confirmed).
 */
export function ContactField({ idp, label, contacts, value, onChange, noneLabel, newLabel = 'Create a new contact instead', initialNewName = '', showRelationship = false, exclude }: {
  idp: string; label: string; contacts: readonly Contact[]; value: ContactPick; onChange: (p: ContactPick) => void; noneLabel: string;
  newLabel?: string; initialNewName?: string; showRelationship?: boolean; exclude?: readonly number[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="cc-field">
      <ContactSelect idp={idp} label={label} contacts={contacts} value={value.newContact ? null : value.contactId} noneLabel={value.newContact ? 'New contact (below)' : noneLabel} exclude={exclude}
        onChange={(id) => { onChange({ contactId: id, newContact: null }); setOpen(false); }} />
      {value.newContact && !open && <PendingNewContact choice={value.newContact} onChange={() => setOpen(true)} onRemove={() => onChange(NO_PICK)} />}
      {!open && !value.newContact && <button type="button" className="link cc-new-link" onClick={() => setOpen(true)}>{newLabel}</button>}
      {open && (
        <NewContactBox idp={`${idp}-new`} initialName={value.newContact?.name ?? initialNewName} submitLabel="Add as new contact" showRelationship={showRelationship}
          onReady={(c) => { onChange({ contactId: null, newContact: c }); setOpen(false); }}
          onUseExisting={(id) => { onChange({ contactId: id, newContact: null }); setOpen(false); }}
          onCancel={() => setOpen(false)} />
      )}
    </div>
  );
}

/**
 * The same choice for a form that writes the Contact at once (Home & Assets: the contact is part of a list the form edits). It makes the Contact only when the
 * owner presses the button (after the same-name review), then calls `onChosen` with its id. Cancelling the form later leaves that Contact in place.
 */
export function NewContactNow({ idp, onChosen, label = 'Create a new contact', showRelationship = false }: { idp: string; onChosen: (id: number, created: boolean, name: string) => void; label?: string; showRelationship?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" className="btn cc-new-link" onClick={() => setOpen(true)}>{label}</button>;
  return (
    <NewContactBox idp={`${idp}-new`} showRelationship={showRelationship} submitLabel="Create new contact"
      onReady={async (c) => { const r = await resolveContactChoice(db, c); onChosen(r.id, r.created, r.name); setOpen(false); }}
      onUseExisting={(id) => { onChosen(id, false, ''); setOpen(false); }}
      onCancel={() => setOpen(false)} />
  );
}
