/**
 * Shared contacts: one record per person or business, whatever module uses them. A vendor is not a different kind of record. A project
 * points at the contact (project.vendorContactIds), so the same contact can serve several projects, and a future personal-CRM or
 * household-services module can use it too without a second copy. These helpers add the two things vendors need (phone, email) and
 * keep a name from being created twice.
 */
import type { FinanceDB } from '../db';
import type { Contact } from './entities';
import { createStore, isLive } from './store';

export interface ContactInput {
  name: string;
  phone?: string;
  email?: string;
  /** What they are to you or what they do: "plumber", "sister". */
  relationship?: string;
}

const tidy = (s: string | undefined) => (s ?? '').trim().replace(/\s+/g, ' ');
/** Names match ignoring case, accents and extra spaces. */
export const nameKey = (s: string) => tidy(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
export const validEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/** Plain-words problem with a contact's details, or null. Phone is free text (any format, extensions). */
export function validateContact(input: ContactInput): string | null {
  if (!tidy(input.name)) return 'Enter a name.';
  if (tidy(input.name).length > 120) return 'That name is too long.';
  const email = tidy(input.email);
  if (email && !validEmail(email)) return 'That email address does not look right.';
  if (tidy(input.phone).length > 40) return 'That phone number is too long.';
  return null;
}

/**
 * Finds the live contact with this name, or makes one. A contact that already exists is never overwritten: only details it does not
 * have yet (phone, email, relationship) are filled in. Done in one transaction, so two quick calls cannot make two.
 */
export async function findOrCreateContact(d: FinanceDB, input: ContactInput): Promise<{ id: number; created: boolean }> {
  const problem = validateContact(input);
  if (problem) throw new Error(problem);
  const name = tidy(input.name);
  return d.transaction('rw', d.contacts, async () => {
    const contacts = createStore(d).shared.contacts;
    const found = (await d.contacts.toArray()).find((c) => isLive(c) && nameKey(c.name) === nameKey(name));
    const extra = { phone: tidy(input.phone), email: tidy(input.email), relationship: tidy(input.relationship) };
    if (found) {
      const fill: Partial<Contact> = {};
      for (const k of ['phone', 'email', 'relationship'] as const) if (extra[k] && !found[k]) fill[k] = extra[k];
      if (Object.keys(fill).length) await contacts.put({ ...found, ...fill, id: found.id });
      return { id: found.id as number, created: false };
    }
    const id = await contacts.put({ name, ...(extra.phone ? { phone: extra.phone } : {}), ...(extra.email ? { email: extra.email } : {}), ...(extra.relationship ? { relationship: extra.relationship } : {}) });
    return { id, created: true };
  });
}

/**
 * Always makes a NEW contact, even when another live contact has the same name. For callers that must never merge two people (Family:
 * two relatives can share a name). It does not look at names at all, so the caller is responsible for warning the person first.
 * Safe to call inside a larger transaction that includes `d.contacts` (it then joins it, so a failure later rolls the contact back too).
 */
export async function createDistinctContact(d: FinanceDB, input: ContactInput): Promise<number> {
  const problem = validateContact(input);
  if (problem) throw new Error(problem);
  const extra = { phone: tidy(input.phone), email: tidy(input.email), relationship: tidy(input.relationship) };
  return d.transaction('rw', d.contacts, () =>
    createStore(d).shared.contacts.put({ name: tidy(input.name), ...(extra.phone ? { phone: extra.phone } : {}), ...(extra.email ? { email: extra.email } : {}), ...(extra.relationship ? { relationship: extra.relationship } : {}) }));
}

/** Thrown when a save was based on an older version of the contact than the one stored now (another tab or a sync changed it). Nothing was written. */
export class StaleContactError extends Error {
  constructor() {
    super('This contact changed while you were editing. Nothing was saved. Reload the current details and try again.');
    this.name = 'StaleContactError';
  }
}

export interface UpdateContactOptions {
  /**
   * The version the form was opened on (the Contact as it was loaded). When given, the save is refused (StaleContactError) if the stored Contact
   * differs from it in updatedAt OR in any of the four details (so even a change made in the same millisecond is noticed). The check and the write
   * are one transaction, so nothing can slip in between. Omitted = the older behaviour (no check), which Projects and Services still use.
   */
  expected?: Pick<Contact, 'updatedAt' | 'name' | 'phone' | 'email' | 'relationship'>;
}

/**
 * Changes a contact's details. An empty phone, email or relationship removes it. Fields this code does not know are kept (including `notes`).
 * A save that changes nothing writes nothing (no new `updatedAt`, so it cannot overwrite another device's edit in sync). Returns whether it wrote.
 */
export async function updateContactDetails(d: FinanceDB, id: number, input: ContactInput, opts: UpdateContactOptions = {}): Promise<{ changed: boolean }> {
  const problem = validateContact(input);
  if (problem) throw new Error(problem);
  return d.transaction('rw', d.contacts, async () => {
    const existing = await d.contacts.get(id);
    if (!existing || !isLive(existing)) throw new Error('That contact no longer exists.');
    if (opts.expected && (existing.updatedAt !== opts.expected.updatedAt || (['name', 'phone', 'email', 'relationship'] as const).some((k) => (existing[k] ?? '') !== (opts.expected![k] ?? '')))) throw new StaleContactError();
    const next: Contact = { ...existing, name: tidy(input.name) };
    for (const k of ['phone', 'email', 'relationship'] as const) {
      const v = tidy(input[k]);
      if (v) next[k] = v; else delete next[k];
    }
    const same = (['name', 'phone', 'email', 'relationship'] as const).every((k) => (existing[k] ?? '') === (next[k] ?? ''));
    if (same) return { changed: false };
    next.updatedAt = Date.now(); // (the change-tracking hook stamps it again on write)
    await d.contacts.put(next);
    return { changed: true };
  });
}

/** Live contacts that share a name with `typed` (ignoring case, accents and spacing), optionally leaving one out (the contact being edited). Never fuzzy. */
export function sameNameMatches<T extends { id?: number; name: string; deletedAt?: number | null }>(contacts: readonly T[], typed: string, exceptId?: number): T[] {
  const k = nameKey(typed);
  return k ? contacts.filter((c) => isLive(c) && c.id !== exceptId && nameKey(c.name) === k) : [];
}
