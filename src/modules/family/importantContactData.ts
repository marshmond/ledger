/**
 * Family Management F3: reading and writing important-contact associations. Rows of `moduleRecords` (module `family`, kind `contact`) only, plus one
 * new Contact when the person explicitly chose "Create a new contact" (in the SAME transaction, so a failed association leaves no stray Contact).
 * It never edits, merges or deletes an existing Contact, and never touches Tasks, Calendar, Projects or Finance.
 *
 * There is NO permanent delete. "Remove" is ARCHIVE: the association moves to "Removed" and can be put back. Archiving rewrites the stored row
 * from its raw form with only the status changed, so a field this version cannot read is never lost. The shared Contact is never touched.
 */
import { db, type FinanceDB } from '../../db';
import { createDistinctContact } from '../../core/contacts';
import { isLive, repo } from '../../core/store';
import type { ModuleRecord } from '../../core/entities';
import type { ContactChoice } from './data';
import { getMember } from './data';
import {
  asImportantContact, associationKey, CONTACT_KIND, toStoredImportantContact, validateImportantContact,
  type ImportantContactFields, type ImportantContactRecord,
} from './importantContactModel';
import { MODULE } from './model';

const rows = (d: FinanceDB) => repo<ModuleRecord>(d.moduleRecords);
const TABLES = (d: FinanceDB) => [d.moduleRecords, d.contacts] as const;

/** Every live association row, readable or not (an unreadable one is counted for review, not hidden). Oldest first. */
export async function loadImportantContacts(d: FinanceDB = db): Promise<ImportantContactRecord[]> {
  return (await d.moduleRecords.where('[module+kind]').equals([MODULE, CONTACT_KIND]).toArray()).filter(isLive).map(asImportantContact).sort((a, b) => a.id - b.id);
}
export async function getImportantContact(id: number, d: FinanceDB = db): Promise<ImportantContactRecord | undefined> {
  const r = await d.moduleRecords.get(id);
  return r && r.module === MODULE && r.kind === CONTACT_KIND && isLive(r) ? asImportantContact(r) : undefined;
}

const sameActive = async (f: Pick<ImportantContactFields, 'memberId' | 'contactId' | 'purpose'>, d: FinanceDB, exceptId?: number) =>
  (await loadImportantContacts(d)).some((r) => r.id !== exceptId && r.data?.status === 'active' && associationKey(r.data) === associationKey(f));

const DUPLICATE = 'That contact is already listed for this person with the same purpose.';

/**
 * Adds an important contact to a member. One transaction checks and writes together:
 *  - the purpose is valid and the member exists and can be read;
 *  - `existing`: the Contact exists and is live, is not the member's own Contact, and there is no ACTIVE association with the same member, Contact and purpose;
 *  - `new`: a separate Contact is created (never matched by name) and rolled back with everything else if the association cannot be written.
 * A Contact can be important to several members, and to one member for several purposes.
 */
export async function addImportantContact(input: { memberId: number; contact: ContactChoice; purpose: string }, d: FinanceDB = db): Promise<{ id: number; contactId: number; createdContact: boolean }> {
  const base = { memberId: input.memberId, purpose: input.purpose, status: 'active' as const };
  const problem = validateImportantContact({ ...base, contactId: input.contact.mode === 'existing' ? input.contact.contactId : 0 });
  if (problem) throw new Error(problem);
  if (input.contact.mode === 'new' && !input.contact.name.trim()) throw new Error('Enter a name.');
  return d.transaction('rw', TABLES(d), async () => {
    const member = await getMember(input.memberId, d);
    if (!member) throw new Error('That family member no longer exists.');
    if (!member.data) throw new Error('This family member could not be read by this version, so nothing was added.');
    let contactId: number;
    let createdContact = false;
    if (input.contact.mode === 'existing') {
      contactId = input.contact.contactId;
      const c = await d.contacts.get(contactId);
      if (!c || !isLive(c)) throw new Error('That contact no longer exists.');
      if (contactId === member.data.contactId) throw new Error('That is the person themselves. Choose someone else.');
      if (await sameActive({ ...base, contactId }, d)) throw new Error(DUPLICATE);
    } else {
      contactId = await createDistinctContact(d, { name: input.contact.name });
      createdContact = true;
    }
    const id = await rows(d).put({ module: MODULE, kind: CONTACT_KIND, data: toStoredImportantContact({}, { ...base, contactId }) });
    return { id, contactId, createdContact };
  });
}

/** Changes only the purpose. The member and the Contact cannot change (remove this one and add another). Refused if it would repeat another active one. */
export async function updateImportantContactPurpose(id: number, purpose: string, d: FinanceDB = db): Promise<void> {
  await d.transaction('rw', TABLES(d), async () => {
    const cur = await getImportantContact(id, d);
    if (!cur) throw new Error('That association no longer exists.');
    if (!cur.data) throw new Error('This record could not be read by this version, so it was not changed.');
    const next = { ...cur.data, purpose };
    const problem = validateImportantContact(next);
    if (problem) throw new Error(problem);
    if (next.status === 'active' && (await sameActive(next, d, id))) throw new Error(DUPLICATE);
    await rows(d).put({ id, module: MODULE, kind: CONTACT_KIND, data: toStoredImportantContact(cur.raw, next) });
  });
}

/** Removes (archives) or puts back an association: the status only. Every other stored field is written back exactly. The Contact is never touched. */
export async function setImportantContactStatus(id: number, status: 'active' | 'archived', d: FinanceDB = db): Promise<void> {
  await d.transaction('rw', TABLES(d), async () => {
    const cur = await getImportantContact(id, d);
    if (!cur) throw new Error('That association no longer exists.');
    if (!cur.data) throw new Error('This record could not be read by this version, so it was not changed.');
    if (cur.data.status === status) return;
    if (status === 'active' && (await sameActive(cur.data, d, id))) throw new Error(`${DUPLICATE} Remove that one first, or change this one's purpose.`);
    await rows(d).put({ id, module: MODULE, kind: CONTACT_KIND, data: { ...cur.raw, status } });
  });
}
