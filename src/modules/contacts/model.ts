/**
 * Contacts & Relationships C1: pure helpers for the directory (no database, clock or network). The module works on the ONE shared `contacts` table;
 * it has no records of its own and invents no fields: name, relationship, phone, email, and the existing dates.
 */
import { nameKey } from '../../core/contacts';
import type { Contact } from '../../core/entities';
import { isLive } from '../../core/store';
import { norm } from '../../lib/search';

export const CONTACTS_BASE = '/contacts';
/** A Contact's page, as written inside the module (the module prefix is added by the router). */
export const contactRoute = (id: number) => `/c/${id}`;
/** The same page as a full address (for Search and other modules). */
export const contactPath = (id: number) => `${CONTACTS_BASE}${contactRoute(id)}`;

export type SortMode = 'name' | 'recent';

/** Digits only, for comparing phone numbers typed in different styles. */
const digits = (s: string) => s.replace(/\D/g, '');

/**
 * Directory search: every typed word must appear in the name, the relationship, the email or the phone (ignoring case and accents; a phone also
 * matches on its digits alone, so "5550100" finds "555-0100"). Pure. An empty query keeps everything.
 */
export function filterContacts(contacts: readonly Contact[], query: string): Contact[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [...contacts];
  return contacts.filter((c) => {
    const hay = norm(`${c.name} ${c.relationship ?? ''} ${c.email ?? ''} ${c.phone ?? ''}`);
    const dig = digits(c.phone ?? '');
    return words.every((w) => hay.includes(w) || (/^\d{3,}$/.test(w) && dig.includes(w)));
  });
}

/** A to Z (ignoring case and accents), or most recently added or changed first. Ties fall back to the name, then the id, so the order is stable. */
export function sortContacts(contacts: readonly Contact[], mode: SortMode): Contact[] {
  const byName = (a: Contact, b: Contact) => nameKey(a.name).localeCompare(nameKey(b.name)) || a.name.localeCompare(b.name) || (a.id ?? 0) - (b.id ?? 0);
  return [...contacts].sort(mode === 'recent' ? (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || byName(a, b) : byName);
}

/** For each live Contact id: how many OTHER live Contacts share its name. One pass over the list, not one per row. */
export function sameNameCounts(contacts: readonly Contact[]): Map<number, number> {
  const groups = new Map<string, number[]>();
  for (const c of contacts) {
    if (!isLive(c) || c.id === undefined) continue;
    const k = nameKey(c.name);
    groups.set(k, [...(groups.get(k) ?? []), c.id]);
  }
  const out = new Map<number, number>();
  for (const ids of groups.values()) if (ids.length > 1) for (const id of ids) out.set(id, ids.length - 1);
  return out;
}

const dateText = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
export { dateText };

/** Enough to tell two same-named Contacts apart: what they are to you, how to reach them, when the entry was added. Never a note. */
export function distinguish(c: Contact): string {
  const parts = [c.relationship, c.phone, c.email].filter((x): x is string => !!x);
  return `${parts.length ? parts.join(' · ') : 'no other details'} · added ${dateText(c.createdAt)}`;
}

/** A phone link target: digits and a leading plus only. Null when nothing dialable is left. */
export function telHref(phone: string): string | null {
  const d = phone.trim().replace(/[^\d+]/g, '');
  return /\d/.test(d) ? `tel:${d}` : null;
}
/** A mail link target only for an address that passes the same shape check as the form. */
export function mailHref(email: string, valid: (s: string) => boolean): string | null {
  const e = email.trim();
  return valid(e) ? `mailto:${encodeURIComponent(e).replace(/%40/g, '@')}` : null;
}
