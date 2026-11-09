import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Modal from '../../shell/Modal';
import { nameKey } from '../../core/contacts';
import { store } from '../../core/store';
import type { Contact } from '../../core/entities';
import { createMember, loadMembers, updateMember, type ContactChoice } from './data';
import { COLORS, MONTH_NAMES, NOTE_MAX, ROLES, ROLE_LABEL, monthDay, sameNameContacts, validMonthDay, type MemberFields, type MemberRecord, type Role } from './model';

/** Enough to tell two same-named contacts apart: what they are to you, how to reach them, and when the entry was added. Never a note. */
export function contactDetail(c: Contact): string {
  const parts = [c.relationship, c.phone, c.email].filter((x): x is string => !!x);
  return parts.length ? parts.join(' · ') : `no other details, added ${new Date(c.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

/**
 * Add a household member, or edit one. Adding asks the person to CHOOSE: link an existing Contact (it is never changed) or create a separate
 * new Contact (never silently matched to a same-named one). The linked Contact cannot be changed when editing.
 */
export default function MemberForm({ member, onClose, onSaved }: { member?: MemberRecord; onClose: () => void; onSaved: (id: number, created: boolean) => void }) {
  const editing = !!member?.data;
  const start = member?.data;
  const contacts = useLiveQuery(() => store.shared.contacts.query(), []) ?? [];
  const members = useLiveQuery(() => loadMembers(), []) ?? [];

  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [filter, setFilter] = useState('');
  const [picked, setPicked] = useState<number | null>(null);
  const [newName, setNewName] = useState('');
  const [different, setDifferent] = useState(false);
  const [role, setRole] = useState<Role>(start?.role ?? 'child');
  const [month, setMonth] = useState(start?.birthMonthDay ? start.birthMonthDay.slice(0, 2) : '');
  const [day, setDay] = useState(start?.birthMonthDay ? String(Number(start.birthMonthDay.slice(3))) : '');
  const [year, setYear] = useState(start?.birthYear !== undefined ? String(start.birthYear) : '');
  const [color, setColor] = useState(start?.color ?? '');
  const [note, setNote] = useState(start?.note ?? '');
  const [onCalendar, setOnCalendar] = useState(start?.birthdayOnCalendar !== false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const linked = start ? contacts.find((c) => c.id === start.contactId) : undefined;
  const taken = useMemo(() => new Set(members.filter((m) => m.data).map((m) => m.data!.contactId)), [members]);
  const shown = useMemo(() => {
    const q = nameKey(filter);
    return contacts.filter((c) => !q || nameKey(c.name).includes(q)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 50);
  }, [contacts, filter]);
  const matches = mode === 'new' ? sameNameContacts(contacts, newName, nameKey) : [];

  async function save() {
    if (busy) return;
    setError('');
    const fields: MemberFields = {
      role,
      status: start?.status ?? 'active',
      ...(month || day ? { birthMonthDay: monthDay(Number(month), Number(day)) } : {}),
      ...(year.trim() ? { birthYear: Number(year.trim()) } : {}),
      ...(color ? { color } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(!onCalendar ? { birthdayOnCalendar: false } : {}),
    };
    if ((month || day) && (!month || !day || !validMonthDay(fields.birthMonthDay))) return setError('Choose a month and a day that exist together (for example not 31 April), or leave both empty.');
    if (year.trim() && !/^\d{4}$/.test(year.trim())) return setError('Enter the birth year as four digits, or leave it empty.');
    let contact: ContactChoice | null = null;
    if (!editing) {
      if (mode === 'existing') {
        if (picked === null) return setError('Choose which contact this is, or switch to "Create a new contact".');
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
        await updateMember(member!.id, fields);
        onSaved(member!.id, false);
      } else {
        const r = await createMember({ contact: contact!, fields });
        onSaved(r.id, r.createdContact);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nothing was saved.');
      setBusy(false);
    }
  }

  return (
    <Modal title={editing ? 'Edit family member' : 'Add a family member'} onClose={onClose}>
      <form className="fm-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {editing ? (
          <p className="fm-note" id="fm-contact-fixed">Linked contact: <strong>{linked?.name ?? 'a contact that no longer exists'}</strong>. The link stays fixed so that tasks and events keep belonging to the same person.</p>
        ) : (
          <>
            <fieldset className="fm-sub">
              <legend>Who is this?</legend>
              <label className="as-check"><input type="radio" name="fm-mode" checked={mode === 'existing'} onChange={() => setMode('existing')} /> Use an existing contact</label>
              <label className="as-check"><input type="radio" name="fm-mode" checked={mode === 'new'} onChange={() => setMode('new')} /> Create a new contact</label>
            </fieldset>

            {mode === 'existing' ? (
              <fieldset className="fm-sub">
                <legend>Existing contact</legend>
                <label className="f">Search contacts<input value={filter} onChange={(e) => setFilter(e.target.value)} autoComplete="off" placeholder="Type part of a name" /></label>
                {contacts.length === 0 ? <p className="muted small">There are no contacts yet. Choose “Create a new contact”.</p> : shown.length === 0 ? <p className="muted small" role="status">No contact matches that.</p> : (
                  <div className="fm-pick" role="radiogroup" aria-label="Existing contacts">
                    {shown.map((c) => {
                      const used = taken.has(c.id!);
                      return (
                        <label key={c.id} className={`fm-opt${used ? ' off' : ''}`}>
                          <input type="radio" name="fm-contact" value={c.id} disabled={used} checked={picked === c.id} onChange={() => setPicked(c.id!)} />
                          <span><strong>{c.name}</strong>{used && <em> (already a member)</em>}{' '}<br /><span className="muted small">{contactDetail(c)}</span></span>
                        </label>
                      );
                    })}
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
                      {matches.map((c) => (
                        <li key={c.id} className="row">
                          <span>{c.name} <span className="muted small">({contactDetail(c)})</span></span>
                          {!taken.has(c.id!) && <button type="button" className="btn" onClick={() => { setMode('existing'); setPicked(c.id!); setFilter(c.name); setDifferent(false); }}>Use this one instead</button>}
                          {taken.has(c.id!) && <span className="muted small">already a member</span>}
                        </li>
                      ))}
                    </ul>
                    <label className="as-check"><input type="checkbox" checked={different} onChange={(e) => setDifferent(e.target.checked)} /> This is a different person with the same name. Create a separate contact.</label>
                  </div>
                )}
                <p className="muted small">A new contact is added to your shared Contacts. Nothing existing is changed or merged.</p>
              </fieldset>
            )}
          </>
        )}

        <label className="f">Role
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
        </label>

        <fieldset className="fm-sub">
          <legend>Birthday (optional)</legend>
          <div className="fm-two">
            <label className="f">Month
              <select value={month} onChange={(e) => setMonth(e.target.value)}>
                <option value="">Not set</option>
                {MONTH_NAMES.map((n, i) => <option key={n} value={String(i + 1).padStart(2, '0')}>{n}</option>)}
              </select>
            </label>
            <label className="f">Day
              <select value={day} onChange={(e) => setDay(e.target.value)}>
                <option value="">Not set</option>
                {DAYS.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
          <label className="f">Birth year (optional)<input value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" maxLength={4} autoComplete="off" /></label>
          <label className="as-check"><input type="checkbox" checked={onCalendar} onChange={(e) => setOnCalendar(e.target.checked)} aria-describedby="fm-cal-help" /> Show this birthday on my Calendar</label>
          <p className="muted small" id="fm-cal-help">Your own Calendar and Today only. It does not share the birthday with anyone or anything else. If you already keep your own Birthday event for this person, Ledger shows just one of the two when it can tell they are the same.</p>
        </fieldset>

        <fieldset className="fm-sub">
          <legend>Display colour (optional)</legend>
          <div className="fm-colors">
            <label className={`fm-color${color === '' ? ' on' : ''}`}><input type="radio" name="fm-color" checked={color === ''} onChange={() => setColor('')} /> None</label>
            {COLORS.map((c) => (
              <label key={c.value} className={`fm-color${color === c.value ? ' on' : ''}`}>
                <input type="radio" name="fm-color" checked={color === c.value} onChange={() => setColor(c.value)} />
                <span className="fm-dot" style={{ background: c.value }} aria-hidden="true" /> {c.name}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="f">Private note (optional)
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={NOTE_MAX} aria-describedby="fm-note-help" />
        </label>
        <p className="muted small" id="fm-note-help">{note.length} of {NOTE_MAX} characters. The note is hidden until you press Show. Do not store health details, identity numbers, passwords or account details here. Plain backups are not encrypted.</p>

        {error && <div className="error" role="alert">{error}</div>}
        <div className="row fm-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>{editing ? 'Save' : 'Add member'}</button>
        </div>
      </form>
    </Modal>
  );
}
