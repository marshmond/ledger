/**
 * Contacts C2: choosing and adding a Contact from the "People" box of the Calendar and Task editors. Pure helpers plus ONE write function.
 *
 * Two rules, both about identity:
 *  - An existing Contact is chosen by its stable id, never by its name. Two Contacts with one name stay two choices, each labelled with enough to tell them apart.
 *  - A NEW Contact is always created on purpose (`createDistinctContact`). A name that is already taken is shown first and needs the owner's confirmation; the
 *    app never picks the first name match for them and never merges.
 */
import type { FinanceDB } from '../db';
import { createDistinctContact, nameKey, sameNameMatches, validateContact } from './contacts';
import type { Contact } from './entities';
import { isLive } from './store';

const dateText = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** What tells a Contact apart from another with the same name: how you know them, how to reach them, when it was added. Never a note. */
export function contactBrief(c: Contact): string {
  const parts = [c.relationship, c.phone, c.email].filter((x): x is string => !!x);
  return `${parts.length ? parts.join(' · ') : 'no other details'} · added ${dateText(c.createdAt)}`;
}

/** Ids of live Contacts that share a name (ignoring case, accents and spacing) with at least one other live Contact. */
export function sharedNameIds(contacts: readonly Contact[]): Set<number> {
  const groups = new Map<string, number[]>();
  for (const c of contacts) if (isLive(c) && c.id !== undefined) groups.set(nameKey(c.name), [...(groups.get(nameKey(c.name)) ?? []), c.id]);
  return new Set([...groups.values()].filter((g) => g.length > 1).flat());
}

/** Pure: "2 of 3" among the live Contacts that share this one's name, in the order they were added (so it never changes between two looks). */
function ordinal(contacts: readonly Contact[], c: Contact): string {
  const same = contacts.filter((x) => isLive(x) && nameKey(x.name) === nameKey(c.name)).sort((a, b) => a.createdAt - b.createdAt || (a.id ?? 0) - (b.id ?? 0));
  return `${same.findIndex((x) => x.id === c.id) + 1} of ${same.length} with this name`;
}

/**
 * The text for one Contact in a menu or on a chip. A name used once is just the name (plus how you know them, when recorded). A name used more than once
 * always carries what tells the entries apart AND its place among them, so two entries can never read the same.
 */
export function contactChoiceLabel(c: Contact, all: readonly Contact[], shared: ReadonlySet<number> = sharedNameIds(all)): string {
  if (c.id !== undefined && shared.has(c.id)) return `${c.name} (${contactBrief(c)}; ${ordinal(all, c)})`;
  return c.relationship ? `${c.name} (${c.relationship})` : c.name;
}

export type AddPicked =
  | { status: 'created'; id: number }
  /** The name is already used: nothing was created. Show these and ask. */
  | { status: 'needs-confirmation'; matches: Contact[] };

/**
 * Adds a brand-new Contact from a typed name. Never finds-and-reuses. If the name is already used by a live Contact and the owner has not confirmed that
 * this is a different person or organization, NOTHING is created and the matches are returned. The check and the create are one transaction, so a Contact
 * added a moment ago (another tab, a sync) is still noticed. A problem with the name is thrown as an Error with a plain message.
 */
export function addPickedContact(d: FinanceDB, name: string, confirmedDifferent: boolean): Promise<AddPicked> {
  const problem = validateContact({ name });
  if (problem) return Promise.reject(new Error(problem));
  return d.transaction('rw', d.contacts, async () => {
    const matches = sameNameMatches(await d.contacts.toArray(), name);
    if (matches.length > 0 && !confirmedDifferent) return { status: 'needs-confirmation' as const, matches };
    return { status: 'created' as const, id: await createDistinctContact(d, { name }) };
  });
}
