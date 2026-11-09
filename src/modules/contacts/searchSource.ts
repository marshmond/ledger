import { db } from '../../db';
import type { SearchResult, SearchSource } from '../../core/registry';
import type { Contact } from '../../core/entities';
import { createStore } from '../../core/store';
import { norm, score } from '../../lib/search';
import { contactPath } from './model';

const store = createStore(db);

/**
 * Pure: the Contacts hits for a typed query, from already-loaded Contacts. Matches the NAME and the relationship only, and shows the relationship
 * only. Phone, email and notes are never searched, shown or returned. Each hit opens the Contact's own page.
 */
export function searchContactsData(raw: string, contacts: readonly Contact[], cap = 8): SearchResult[] {
  const query = norm(raw).split(/\s+/).filter(Boolean);
  if (query.length === 0) return [];
  return contacts
    .filter((c) => c.id !== undefined)
    .map((c) => ({ c, s: score(query, c.name, c.relationship ?? '') }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.c.name.localeCompare(b.c.name))
    .slice(0, cap)
    .map(({ c, s }) => ({ id: `contact:${c.id}`, title: c.name, ...(c.relationship ? { subtitle: c.relationship } : {}), kind: 'Contact', score: s, path: contactPath(c.id as number) }));
}

/** What global search finds in Contacts & Relationships: people and organisations, by name or what they are to you. */
export const contactsSearchSource: SearchSource = {
  group: 'Contacts',
  async search(query, limit) {
    return searchContactsData(query, await store.shared.contacts.query()).slice(0, limit);
  },
};
