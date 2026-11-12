import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sameNameMatches } from '../../core/contacts';
import { memberInitials } from '../../ui/memberIdentityModel';
import { sameNameCounts } from './model';
import { facetList, facetText, FILTERS } from './references';

/** D14 Contacts redesign: the directory and Contact page look different, but identity, duplicate handling and lifecycle limits are exactly as before. Invented data only. */
const read = (p: string) => readFileSync(`src/modules/contacts/${p}`, 'utf8');
const c = (id: number, name: string, extra: Record<string, unknown> = {}) => ({ id, name, relationship: '', phone: '', email: '', deletedAt: null, ...extra });

describe('relationship words on a row', () => {
  it('facetList is the fixed-order list and facetText is that list joined, exactly as before', () => {
    const f = new Set(['provider', 'member'] as const);
    expect(facetList(f)).toEqual(['Household member', 'Service provider']);
    expect(facetText(f)).toBe('Household member, Service provider');
    expect(facetList(new Set())).toEqual([]);
    expect(facetText(new Set())).toBe('');
  });
});

describe('contacts with the same name stay separate', () => {
  const a = c(1, 'Jordan Rivera', { relationship: 'Electrician' });
  const b = c(2, 'Jordan Rivera', { relationship: 'Neighbor' });
  const other = c(3, 'Morgan Demo');

  it('each is marked as sharing a name with the other, by its own id, and the unrelated one is not marked', () => {
    const m = sameNameCounts([a, b, other] as never);
    expect(m.get(1)).toBe(1);
    expect(m.get(2)).toBe(1);
    expect(m.has(3)).toBe(false);
  });

  it('the other same-name contacts are found without the contact itself, so a page can warn and offer a link, never a merge', () => {
    expect(sameNameMatches([a, b, other] as never, 'Jordan Rivera', 1).map((x) => x.id)).toEqual([2]);
  });

  it('a matching initials tile does not make them one person: the tile is decoration and the name, relationship and link tell them apart', () => {
    expect(memberInitials(a.name)).toBe(memberInitials(b.name));
    const dir = read('DirectoryPage.tsx');
    expect(dir).toContain('aria-hidden="true">{memberInitials(c.name)');
    expect(dir).toContain('key={c.id}');
    expect(dir).toContain('{c.relationship && <span className="ct-rel">{c.relationship}</span>}');
  });
});

describe('the directory keeps search, filters, sorting and its safety notes', () => {
  const dir = read('DirectoryPage.tsx');

  it('keeps the search, Show and Sort controls with their labels and the six filters', () => {
    for (const text of ['>Search<input type="search"', '>Show', '>Sort', 'A to Z', 'Recently added or changed', 'Name, relationship, phone or email']) expect(dir).toContain(text);
    expect(FILTERS.map((f) => f.id)).toEqual(['all', 'member', 'important', 'provider', 'project', 'none']);
    expect(dir).toContain("disabled={f.id === 'none' && !checked}");
  });

  it('keeps the unchecked-module note and the removed-but-in-use recovery card with its Restore button', () => {
    expect(dir).toContain('Ledger could not check every module just now');
    expect(dir).toContain('Removed contacts that are still in use');
    expect(dir).toContain('restoreContact(db, contact.id as number)');
  });

  it('keeps the empty states and the Add contact action', () => {
    expect(dir).toContain('No contacts yet');
    expect(dir).toContain('Add the first contact');
    expect(dir).toContain('Add contact');
    expect(dir).toContain('No contact matches');
    expect(dir).toContain('No contact in this list.');
  });

  it('still shows where each contact is used (usageSummary) and the stored relationships, from the same readers', () => {
    expect(dir).toContain('usageSummary(data.usage.byContact.get(c.id as number))');
    expect(dir).toContain('factsFor(data.refs.byContact.get(c.id as number)');
  });

  it('each row has exactly one link, the name, which opens that contact by id', () => {
    const row = dir.slice(dir.indexOf('<li key={c.id} className="ct-row">'), dir.indexOf('</li>', dir.indexOf('<li key={c.id} className="ct-row">')));
    expect(row.match(/<Link /g)).toHaveLength(1);
    expect(row).toContain('to={contactRoute(c.id as number)}');
  });
});

describe('the contact page keeps every section and offers no new way to change identity', () => {
  const page = read('ContactPage.tsx');

  it('keeps details, where used, stored mentions, removal, the same-name warning and Edit', () => {
    for (const tag of ['<WhereUsed', '<MentionCounts', '<RemoveContact', '<ContactForm']) expect(page).toContain(tag);
    for (const text of ['Another contact has the same name.', 'Nothing is merged.', 'Not recorded', 'Last changed', 'Added', '>Edit</button>']) expect(page).toContain(text);
    expect(page).toContain('<RemoveContact contact={c} inUse={refs.length > 0 || entries.length > 0} checkedAll={!!data.refs?.verified} />');
  });

  it('adds no merge, delete, archive, reassign or link-by-name control to the directory or the contact page', () => {
    for (const file of ['DirectoryPage.tsx', 'ContactPage.tsx']) {
      const src = read(file);
      // No control with those words (the sentence "Nothing is merged." is explanation, not a control).
      expect(src).not.toMatch(/<(button|Link|a)\b[^>]*>[^<]*(Merge|Archive|Delete|Reassign|Combine)/i);
      expect(src).not.toMatch(/mergeContact|archiveContact|reassign/i);
      expect(src).not.toMatch(/findOrCreateContact|createDistinctContact|updateContactDetails|removeContact\(|\.delete\(|\.put\(|\.add\(/);
    }
  });

  it('the page shows the counts it already had, per module, from the grouped references', () => {
    expect(page).toContain('groupReferences(refs)');
    expect(page).toContain('{g.items.length}');
    expect(page).toContain('{g.label}');
  });

  it('removal and the form are the same files with the same checks: RemoveContact still refuses a contact that is in use', () => {
    const rm = read('RemoveContact.tsx');
    expect(rm).toContain('This contact is in use, so it cannot be removed.');
    expect(rm).toContain('inUse');
  });
});

describe('a Contact is not a Family member', () => {
  it('no Family member color, mark or chip is used by any Contacts screen or stylesheet', () => {
    for (const file of ['DirectoryPage.tsx', 'ContactPage.tsx', 'contacts.css']) {
      const src = read(file);
      expect(src).not.toMatch(/MemberMark|MemberDot|MemberChip|data-mc|--mc-|colorId/);
    }
  });

  it('the tile uses a neutral surface and ink, never an identity color', () => {
    const css = read('contacts.css');
    const tile = css.match(/\.ct-mono \{[^}]*\}/)![0];
    expect(tile).toContain('var(--surface-sunken)');
    expect(tile).toContain('var(--fg-2)');
    expect(tile).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  it('no Contacts file imports another module (the Family link is shown from stored references, as before)', () => {
    for (const file of ['DirectoryPage.tsx', 'ContactPage.tsx']) expect(read(file)).not.toMatch(/from '\.\.\/(family|projects|assets|tasks|calendar)/);
  });
});

describe('the stylesheet: phone behavior, tokens and the earlier guarded rules', () => {
  const css = read('contacts.css');

  it('keeps the earlier C2 rules the existing tests rely on', () => {
    expect(css).toMatch(/\.ct-ref \{[^}]*overflow-wrap: anywhere/);
    expect(css).toMatch(/@media \(max-width: 480px\)[\s\S]*\.ct-ref-title \{ min-height: 44px/);
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*\.ct-tools \{ grid-template-columns: 1fr/);
  });

  it('a row becomes a stack on a phone and long names wrap', () => {
    expect(css).toMatch(/@media \(max-width: 600px\)[\s\S]*\.ct-row \{ grid-template-columns: 40px minmax\(0, 1fr\)/);
    expect(css).toMatch(/\.ct-row \{[^}]*overflow-wrap: anywhere/);
    expect(css).toMatch(/\.ct-layout \{[^}]*grid-template-columns: minmax\(0, 1\.5fr\) minmax\(0, 1fr\)/);
  });

  it('adds no !important', () => {
    expect(css).not.toContain('!important');
  });
});
