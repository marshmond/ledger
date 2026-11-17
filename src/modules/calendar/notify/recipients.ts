/**
 * CAL-N1: who can be emailed. Pure.
 *
 * Nobody is pre-selected. Contacts the event is about ("people involved") come first as a convenience; any other Contact can be added. A Contact
 * with no usable address is listed as unavailable with the reason, and two Contacts that share an address are never both emailed. This is not a
 * CRM: it only reads the name and email Ledger already stores.
 */
import { validEmail } from '../../../core/contacts';
import type { Contact } from '../../../core/entities';

export const MAX_RECIPIENTS = 10;
export const MAX_PER_DAY = 30;

export interface RecipientRow {
  contactId: number;
  name: string;
  /** Lower-case, trimmed ('' when there is none). */
  email: string;
  involved: boolean;
  usable: boolean;
  /** Why it cannot be chosen (plain words). */
  reason?: string;
}

export const normalizeEmail = (s: string | undefined) => (s ?? '').trim().toLowerCase();

/** Every live Contact as a row. Involved people first, then by name; the first holder of an address keeps it. */
export function classifyContacts(contacts: readonly Contact[], involvedIds: readonly number[]): RecipientRow[] {
  const involved = new Set(involvedIds);
  const live = contacts.filter((c) => c.deletedAt == null && c.id !== undefined);
  const sorted = [...live].sort((a, b) => Number(involved.has(b.id!)) - Number(involved.has(a.id!)) || a.name.localeCompare(b.name) || a.id! - b.id!);
  const holder = new Map<string, string>();
  return sorted.map<RecipientRow>((c) => {
    const email = normalizeEmail(c.email);
    const base = { contactId: c.id!, name: c.name, email, involved: involved.has(c.id!) };
    if (!email) return { ...base, usable: false, reason: 'No email address.' };
    if (!validEmail(email)) return { ...base, usable: false, reason: 'The email address does not look right.' };
    const first = holder.get(email);
    if (first) return { ...base, usable: false, reason: `Same address as ${first}.` };
    holder.set(email, c.name);
    return { ...base, usable: true };
  });
}

/** True when at least one Contact could be emailed. Used so an empty notification prompt never interrupts anyone. */
export const hasEligible = (rows: readonly RecipientRow[]) => rows.some((r) => r.usable);

/** Drops anything that is not a usable row or repeats an address, keeps the order, and stops at the limit. */
export function pickRecipients(rows: readonly RecipientRow[], chosenIds: readonly number[]): { picked: RecipientRow[]; overLimit: boolean } {
  const byId = new Map(rows.map((r) => [r.contactId, r]));
  const seen = new Set<string>();
  const picked: RecipientRow[] = [];
  for (const id of chosenIds) {
    const r = byId.get(id);
    if (!r || !r.usable || seen.has(r.email)) continue;
    seen.add(r.email);
    picked.push(r);
  }
  return { picked: picked.slice(0, MAX_RECIPIENTS), overLimit: picked.length > MAX_RECIPIENTS };
}
