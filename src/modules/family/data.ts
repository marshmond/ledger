/**
 * Family Management F1: reading and writing household members. Members are `moduleRecords` rows (module `family`, kind `member`). This file
 * writes ONLY those rows, plus one new Contact when the person explicitly chose "Create a new contact" (in the SAME transaction, so a failed
 * member write leaves no stray Contact). It never edits, merges or deletes an existing Contact, and never touches Tasks, Calendar or Finance.
 */
import { db, type FinanceDB } from '../../db';
import { createDistinctContact } from '../../core/contacts';
import { isLive, repo } from '../../core/store';
import type { ModuleRecord } from '../../core/entities';
import { asMember, KIND, MODULE, toStored, validateFields, type MemberFields, type MemberRecord } from './model';

const rows = (d: FinanceDB) => repo<ModuleRecord>(d.moduleRecords);
const TABLES = (d: FinanceDB) => [d.moduleRecords, d.contacts] as const;

/** Every live member row, readable or not (an unreadable one is listed for review, not hidden). Oldest first. */
export async function loadMembers(d: FinanceDB = db): Promise<MemberRecord[]> {
  return (await d.moduleRecords.where('[module+kind]').equals([MODULE, KIND]).toArray()).filter(isLive).map((r) => asMember(r)).sort((a, b) => a.id - b.id);
}
export async function getMember(id: number, d: FinanceDB = db): Promise<MemberRecord | undefined> {
  const r = await d.moduleRecords.get(id);
  return r && r.module === MODULE && r.kind === KIND && isLive(r) ? asMember(r) : undefined;
}

/** Where the new member's identity comes from. `existing` links a Contact without changing it; `new` always makes a separate Contact. */
export type ContactChoice = { mode: 'existing'; contactId: number } | { mode: 'new'; name: string };
export interface CreatedMember { id: number; contactId: number; createdContact: boolean }

const liveMembersOf = async (contactId: number, d: FinanceDB) =>
  (await loadMembers(d)).filter((m) => m.data?.contactId === contactId);

/**
 * Adds a household member. One transaction checks and writes together:
 *  - the fields are valid;
 *  - `existing`: the Contact exists and is live, and no member already points at it (an active one, or a past one: open that one and mark it active);
 *  - `new`: a separate Contact is created (never matched by name) and rolled back with everything else if the member cannot be written.
 */
export async function createMember(input: { contact: ContactChoice; fields: MemberFields }, d: FinanceDB = db, thisYear = new Date().getFullYear()): Promise<CreatedMember> {
  const problem = validateFields(input.fields, thisYear);
  if (problem) throw new Error(problem);
  if (input.contact.mode === 'new' && !input.contact.name.trim()) throw new Error('Enter a name.');
  return d.transaction('rw', TABLES(d), async () => {
    let contactId: number;
    let createdContact = false;
    if (input.contact.mode === 'existing') {
      contactId = input.contact.contactId;
      const c = await d.contacts.get(contactId);
      if (!c || !isLive(c)) throw new Error('That contact no longer exists.');
      const same = await liveMembersOf(contactId, d);
      if (same.some((m) => m.data?.status === 'active')) throw new Error('That contact is already a member of the household.');
      if (same.length) throw new Error('That contact is already listed as a past member. Open them and mark them as in the household again instead of adding a second record.');
    } else {
      contactId = await createDistinctContact(d, { name: input.contact.name });
      createdContact = true;
    }
    const id = await rows(d).put({ module: MODULE, kind: KIND, data: toStored({}, contactId, input.fields) });
    return { id, contactId, createdContact };
  });
}

/**
 * Changes a member's profile. The Contact link is not part of the input and cannot change here. Fields this version does not know are kept.
 * Marking a member active is refused while another ACTIVE member points at the same contact.
 */
export async function updateMember(id: number, fields: MemberFields, d: FinanceDB = db, thisYear = new Date().getFullYear()): Promise<void> {
  const problem = validateFields(fields, thisYear);
  if (problem) throw new Error(problem);
  await d.transaction('rw', TABLES(d), async () => {
    const row = await d.moduleRecords.get(id);
    if (!row || row.module !== MODULE || row.kind !== KIND || !isLive(row)) throw new Error('That member no longer exists.');
    const m = asMember(row, thisYear);
    if (!m.data) throw new Error('This record could not be read by this version, so it was not changed.');
    if (fields.status === 'active') {
      const others = (await liveMembersOf(m.data.contactId, d)).filter((o) => o.id !== id && o.data?.status === 'active');
      if (others.length) throw new Error('Another active member already points at the same contact. Mark one of them as past first.');
    }
    await rows(d).put({ id, module: MODULE, kind: KIND, data: toStored(m.raw, m.data.contactId, fields) });
  });
}

/**
 * Marks a member past (or active again). A status change ONLY: every other stored field (a note, or a field this version could not read) is
 * written back exactly as it was, and the Contact and every Task or event that names the Contact are not touched.
 */
export async function setMemberStatus(id: number, status: 'active' | 'past', d: FinanceDB = db): Promise<void> {
  await d.transaction('rw', TABLES(d), async () => {
    const m = await getMember(id, d);
    if (!m) throw new Error('That member no longer exists.');
    if (!m.data) throw new Error('This record could not be read by this version, so it was not changed.');
    if (m.data.status === status) return;
    if (status === 'active') {
      const others = (await liveMembersOf(m.data.contactId, d)).filter((o) => o.id !== id && o.data?.status === 'active');
      if (others.length) throw new Error('Another active member already points at the same contact. Mark one of them as past first.');
    }
    await rows(d).put({ id, module: MODULE, kind: KIND, data: { ...m.raw, status } });
  });
}

/**
 * F2: includes or excludes ONE member's birthday on the owner's Calendar. Changes that single field only: everything else on the stored row (a note,
 * a field this version could not read) is written back exactly, and nothing else is touched. It is the owner's own Calendar only; it is not, and
 * never implies, permission to show the birthday anywhere else.
 */
export async function setBirthdayOnCalendar(id: number, on: boolean, d: FinanceDB = db): Promise<void> {
  await d.transaction('rw', TABLES(d), async () => {
    const m = await getMember(id, d);
    if (!m) throw new Error('That member no longer exists.');
    if (!m.data) throw new Error('This record could not be read by this version, so it was not changed.');
    if ((m.data.birthdayOnCalendar !== false) === on) return;
    const next: Record<string, unknown> = { ...m.raw };
    if (on) delete next.birthdayOnCalendar; else next.birthdayOnCalendar = false;
    await rows(d).put({ id, module: MODULE, kind: KIND, data: next });
  });
}
