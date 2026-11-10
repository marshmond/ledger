import { db, type FinanceDB } from '../../db';
import type { SearchResult, SearchSource } from '../../core/registry';
import { createStore } from '../../core/store';
import { norm, score } from '../../lib/search';
import { loadMembers } from './data';
import { loadDates } from './dateData';
import { DATE_KIND_LABEL, type DateRecord } from './dateModel';
import { birthdaySubjects } from './dueProvider';
import { DATES_ROUTE, duplicateGroups, FAMILY_BASE, memberRoute, monthDayText, ROLE_LABEL, type MemberRecord } from './model';

/**
 * Family Management F5: what global search finds in Family. READ ONLY and small.
 *
 * Three kinds of hit, each a different record, each labelled so it cannot be mistaken for a Contact hit (Contacts has its own group):
 *  - **Family member** (a household member record; opens that member's page; past members say so),
 *  - **Family birthday** (a member's own birthday, read from the member profile; only for an active member; opens the member),
 *  - **Family date** (an active important date; opens the member it is about, else the Family dates page).
 *
 * One underlying record gives one hit. A member's birthday is shown only when the typed words are about the date ("sam birthday", "14 may"); a plain
 * name already finds the member, so it does not also find the same person a second time. Two different people with the same name stay two hits (they are
 * different records and Ledger never merges them).
 *
 * Privacy: the Contact is reduced to its NAME before this code sees it (phone, email and Contact notes are never read), and the member's private note,
 * birth year and an anniversary's start year are never searched, shown or returned. Titles carry a name or the owner's own date label and the date
 * without a year.
 */
export interface FamilySearchData {
  members: readonly MemberRecord[];
  dates: readonly DateRecord[];
  /** Contact id to name. Names only. */
  names: ReadonlyMap<number, string>;
}

const PAGE_FAMILY: SearchResult = { id: 'page:/family', title: 'Family', subtitle: 'Go to this page', kind: 'Page', path: FAMILY_BASE };
const PAGE_DATES: SearchResult = { id: 'page:/family/dates', title: 'Family dates', subtitle: 'Go to this page', kind: 'Page', path: `${FAMILY_BASE}${DATES_ROUTE}` };

/** Pure: the Family hits for a typed query from already-loaded records. */
export function searchFamilyData(raw: string, data: FamilySearchData, cap = 8): SearchResult[] {
  const query = norm(raw).split(/\s+/).filter(Boolean);
  if (query.length === 0) return [];
  // The word "family" names the module (its pages answer it); next to other words it is dropped for the records, so "family birthday" works, and "family" alone does not list every person.
  const records = query.length > 1 ? query.filter((w) => w !== 'family') : query;
  const out: SearchResult[] = [];

  const s1 = score(query, 'Family', 'household members people');
  if (s1 > 0) out.push({ ...PAGE_FAMILY, score: s1 });
  const s2 = score(query, 'Family dates', 'birthdays anniversaries important dates');
  if (s2 > 0) out.push({ ...PAGE_DATES, score: s2 });

  const dups = new Set(duplicateGroups(data.members).flat().map((m) => m.id));
  // Two different people can share a name (Ledger never merges them). Their hits then also say when each was added, so they can be told apart.
  const nameUse = new Map<string, number>();
  for (const m of data.members) { const nm = m.data ? data.names.get(m.data.contactId) : undefined; if (nm) nameUse.set(norm(nm.trim()), (nameUse.get(norm(nm.trim())) ?? 0) + 1); }
  const added = (m: MemberRecord, name: string) => ((nameUse.get(norm(name)) ?? 0) > 1 ? `Added ${new Date(m.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : '');
  const memberScore = new Map<number, number>();
  for (const m of data.members) {
    const d = m.data;
    const name = d ? data.names.get(d.contactId)?.trim() : undefined;
    if (!d || !name) continue; // an unreadable record, or one whose Contact is gone, is not offered
    const past = d.status === 'past';
    const s = score(records, name, `${ROLE_LABEL[d.role]} ${past ? 'past member' : 'household'}`);
    memberScore.set(m.id, s);
    if (s <= 0) continue;
    out.push({
      id: `family-member:${m.id}`,
      title: name,
      subtitle: [ROLE_LABEL[d.role], past ? 'Past member' : '', dups.has(m.id) ? 'Possible duplicate' : '', added(m, name)].filter(Boolean).join(' · '),
      kind: 'Family member',
      score: past ? s - 3 : s,
      path: `${FAMILY_BASE}${memberRoute(m.id)}`,
    });
  }

  // Birthdays: the same people F2 gives a birthday (active, one per Contact), whatever their Calendar switch says. Only when the words are about the date.
  const everyBirthday = data.members.map((m) => (m.data && m.data.birthdayOnCalendar === false ? { ...m, data: { ...m.data, birthdayOnCalendar: undefined } } : m));
  for (const b of birthdaySubjects(everyBirthday, data.names)) {
    if ((memberScore.get(b.memberId) ?? 0) > 0) continue;
    const when = monthDayText(b.monthDay);
    const s = score(records, `${b.name}'s birthday`, when);
    if (s <= 0) continue;
    out.push({ id: `family-birthday:${b.memberId}`, title: `${b.name}'s birthday`, subtitle: when, kind: 'Family birthday', score: s, path: `${FAMILY_BASE}${memberRoute(b.memberId)}` });
  }

  const memberById = new Map(data.members.map((m) => [m.id, m]));
  for (const r of data.dates) {
    const d = r.data;
    if (!d || d.status !== 'active') continue;
    const about = d.memberId !== undefined ? memberById.get(d.memberId) : undefined;
    const aboutName = about?.data ? data.names.get(about.data.contactId)?.trim() : undefined;
    const when = monthDayText(d.monthDay);
    const s = score(records, d.label, `${DATE_KIND_LABEL[d.dateKind]} ${when} ${aboutName ?? ''}`);
    if (s <= 0) continue;
    out.push({
      id: `family-date:${r.id}`,
      title: d.label,
      subtitle: [when, DATE_KIND_LABEL[d.dateKind], aboutName ? `About ${aboutName}` : ''].filter(Boolean).join(' · '),
      kind: 'Family date',
      score: s,
      path: about?.data ? `${FAMILY_BASE}${memberRoute(about.id)}` : `${FAMILY_BASE}${DATES_ROUTE}`,
    });
  }

  return out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)).slice(0, cap);
}

/** The records search needs, read once. Reads only; of a Contact it keeps the name and nothing else. */
export async function readFamilySearchData(d: FinanceDB = db): Promise<FamilySearchData> {
  const [members, dates, contacts] = await Promise.all([loadMembers(d), loadDates(d), createStore(d).shared.contacts.query()]);
  const names = new Map<number, string>();
  for (const c of contacts) if (c.id !== undefined && typeof c.name === 'string') names.set(c.id, c.name);
  return { members, dates, names };
}

/** What global search finds in Family: household members, their birthdays and the important dates, never their notes or contact details. */
export const familySearchSource: SearchSource = {
  group: 'Family',
  async search(query, limit) {
    return searchFamilyData(query, await readFamilySearchData()).slice(0, limit);
  },
};
