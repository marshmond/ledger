/**
 * Contacts U2: the ONE place where a module turns "the owner's choice of a Contact" into a Contact id. Two kinds of choice exist, and neither is ever
 * decided by a name:
 *  - an EXISTING Contact, named by its stable id (`contactId`);
 *  - a NEW Contact, created on purpose (`name`, plus optional phone, email, relationship). If a live Contact already has that name (ignoring case, accents
 *    and spacing, the app's `nameKey`), NOTHING is created and `SameNameContactError` lists the matches, unless the owner has said "this is a different
 *    person or organization" (`confirmedDifferent`). Even then a NEW Contact is made; the old one is never reused, merged or edited.
 * It replaces the older find-or-create helper in every interactive path (that helper reused a Contact because a name matched). Safe to call inside a larger
 * transaction that includes `d.contacts` (it joins it, so a later failure rolls a new Contact back with the record that uses it).
 */
import type { FinanceDB } from '../db';
import { createDistinctContact, nameKey, sameNameMatches, validateContact } from './contacts';
import type { Contact } from './entities';
import { isLive } from './store';

export interface ContactChoice {
  /** An existing Contact, by id. When present, every field below is ignored. */
  contactId?: number | null;
  /** A NEW Contact to create. Never used to look anything up. */
  name?: string;
  phone?: string;
  email?: string;
  relationship?: string;
  /** The owner has seen the Contacts that already have this name and says this one is someone else. */
  confirmedDifferent?: boolean;
}
export interface ResolvedContact { id: number; name: string; created: boolean }

const tidy = (s: string | undefined) => (s ?? '').trim().replace(/\s+/g, ' ');

/** Thrown, with nothing written, when a new Contact's name is already used by a live Contact and the owner has not confirmed it is someone else. */
export class SameNameContactError extends Error {
  readonly matches: Contact[];
  constructor(name: string, matches: Contact[]) {
    super(`${matches.length === 1 ? 'A contact' : `${matches.length} contacts`} named "${tidy(name)}" already ${matches.length === 1 ? 'exists' : 'exist'}. Choose the right one, or confirm this is someone different. Nothing was saved.`);
    this.name = 'SameNameContactError';
    this.matches = matches;
  }
}

/** True when a choice names an existing Contact or a new one (so "no provider" is `false`). */
export const hasContactChoice = (c: ContactChoice | null | undefined): c is ContactChoice => !!c && (c.contactId != null || !!tidy(c.name));

/** Read only: the live Contacts that already use this name (ignoring case, accents and spacing). Never fuzzy. For showing the owner before they confirm. */
export async function findSameNameContacts(d: FinanceDB, name: string): Promise<Contact[]> {
  return nameKey(name) ? sameNameMatches(await d.contacts.toArray(), name) : [];
}

/**
 * Turns a choice into a Contact id. An existing Contact must still be live (a removed one is an error, never replaced by a same-name one). A new Contact is
 * checked and created in one transaction, so a Contact added a moment ago (another tab, a sync) is still noticed.
 */
export async function resolveContactChoice(d: FinanceDB, choice: ContactChoice): Promise<ResolvedContact> {
  if (choice.contactId != null) {
    const c = await d.contacts.get(choice.contactId);
    if (!c || !isLive(c)) throw new Error('That contact no longer exists.');
    return { id: c.id as number, name: c.name, created: false };
  }
  const input = { name: tidy(choice.name), phone: choice.phone, email: choice.email, relationship: choice.relationship };
  const problem = validateContact(input);
  if (problem) throw new Error(problem);
  return d.transaction('rw', d.contacts, async () => {
    const matches = sameNameMatches(await d.contacts.toArray(), input.name);
    if (matches.length > 0 && !choice.confirmedDifferent) throw new SameNameContactError(input.name, matches);
    const id = await createDistinctContact(d, input);
    return { id, name: input.name, created: true };
  });
}
