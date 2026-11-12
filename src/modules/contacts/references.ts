/**
 * Contacts C2: pure helpers for the named-reference views (no database, clock or network).
 */
import { facetsOf, FACET_LABEL, type ContactFacet, type ContactReference } from '../../core/contactReferences';
import type { UsageEntry } from '../../core/contactUsage';

/** How many references each section shows before "Show all", and the most it ever lists (the rest are counted, never silently dropped). */
export const PREVIEW = 5;
export const MAX_LISTED = 100;

export type FilterId = 'all' | ContactFacet | 'none';
export const FILTERS: readonly { id: FilterId; label: string }[] = [
  { id: 'all', label: 'All contacts' },
  { id: 'member', label: 'Household members' },
  { id: 'important', label: 'Important Family contacts' },
  { id: 'provider', label: 'Service providers' },
  { id: 'project', label: 'Project participants' },
  { id: 'none', label: 'No confirmed references' },
];

/** What the directory knows about one Contact, from stored relationships only. */
export interface ContactFacts {
  facets: Set<ContactFacet>;
  /** Named references the module readers found. */
  named: number;
  /** Records that mention the Contact's id (the complete numeric scan). */
  mentions: number;
}

export const factsFor = (refs: readonly ContactReference[] | undefined, usage: readonly UsageEntry[] | undefined): ContactFacts => ({
  facets: facetsOf(refs ?? []),
  named: new Set((refs ?? []).map((r) => `${r.module}/${r.kind}/${r.recordId}`)).size,
  mentions: (usage ?? []).reduce((n, e) => n + e.count, 0),
});

/**
 * Does a Contact belong under this filter? "No confirmed references" needs BOTH the named readers and the complete scan to be clear, and every reader to
 * have run (`checked`): a failed or partial check never counts as "none". It is a way to find Contacts, never a permission to remove one.
 */
export function matchesFilter(filter: FilterId, f: ContactFacts, checked: boolean): boolean {
  if (filter === 'all') return true;
  if (filter === 'none') return checked && f.named === 0 && f.mentions === 0;
  return f.facets.has(filter);
}

/** Pure: the relationship names for a row, in the fixed order ("Household member", "Service provider"), or an empty list. */
export const facetList = (facets: ReadonlySet<ContactFacet>): string[] =>
  (['member', 'important', 'provider', 'project'] as const).filter((x) => facets.has(x)).map((x) => FACET_LABEL[x]);

/** Pure: "Household member, Service provider" for a row, or an empty string. */
export const facetText = (facets: ReadonlySet<ContactFacet>): string => facetList(facets).join(', ');
