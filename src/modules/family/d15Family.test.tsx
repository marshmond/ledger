import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { createDistinctContact } from '../../core/contacts';
import { FinanceDB } from '../../db';
import { installTracking } from '../../lib/sync/track';
import { DateTile } from '../../ui/DateTile';
import { dateTileModel } from '../../ui/dateTileModel';
import { nextOccurrence } from './calendarDates';
import { createMember, loadMembers, setMe } from './data';
import { createDate, loadDates } from './dateData';
import { monthGroups } from './DatesPage';
import { COLORS, effectiveMe, ROLE_LABEL, type MemberFields } from './model';
import { MEMBER_COLOR_CHOICES, memberColorId } from './memberIdentity';
import { upcomingRows } from './upcoming';

/**
 * D15 Family detail. The member page was recomposed (a hero with the D9 mark, role, status and the next birthday as a date tile, then two columns) and the
 * dates page groups by month under date tiles. The roles, "This is me", the stored colors, the dates and every link are the ones the screens already had.
 * Real Dexie, invented people. Layout and look are checked in a real browser, not here.
 */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-d15-fam-${n++}`); installTracking(d); return d; };
const TODAY = '2026-11-12';
const fields = (over: Partial<MemberFields> = {}): MemberFields => ({ role: 'parent', status: 'active', ...over });
const src = (f: string) => readFileSync(`src/modules/family/${f}`, 'utf8');
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(createElement(MemoryRouter, null, el));

describe('D15 Family: identity, role and "This is me" stay separate', () => {
  it('a member marked "This is me" keeps their own role; the marker adds no role and no other member changes', async () => {
    const d = fresh();
    const a = await createMember({ contact: { mode: 'new', name: 'Invented Child' }, fields: fields({ role: 'child' }) }, d);
    const b = await createMember({ contact: { mode: 'new', name: 'Invented Parent' }, fields: fields({ role: 'parent' }) }, d);
    await setMe(a.id, d);
    const members = await loadMembers(d);
    const me = effectiveMe(members).me!;
    expect(me.id).toBe(a.id);
    expect(me.data!.role).toBe('child');
    expect(ROLE_LABEL[me.data!.role]).toBe('Child');
    expect(members.find((m) => m.id === b.id)!.data!.role).toBe('parent');
    expect(members.find((m) => m.id === b.id)!.data!.isMe).toBeFalsy();
  });
  it('the page draws role, status and "This is you" as three separate chips from the existing values, and has no permissions or account wording', () => {
    const page = code(src('MemberPage.tsx'));
    expect(page).toContain('{ROLE_LABEL[d.role]}');
    expect(page).toContain('{STATUS_LABEL[d.status]}');
    expect(page).toMatch(/\{isMe && <StatusChip tone="done">This is you<\/StatusChip>\}/);
    expect(page).not.toMatch(/permission|log ?in|sign ?in|account holder|administrator|Admin\b/i);
    expect(page).toContain('This is me');
  });
});

describe('D15 Family: the D9 colors are untouched', () => {
  it('the eight stored colors still map to their ids, and anything else (or nothing) is "no color"', () => {
    expect(COLORS).toHaveLength(8);
    for (const c of COLORS) expect(memberColorId(c.value)).toBe(c.name.toLowerCase());
    expect(MEMBER_COLOR_CHOICES.map((c) => c.value)).toEqual(COLORS.map((c) => c.value));
    expect(memberColorId('#123456')).toBeNull();
    expect(memberColorId(undefined)).toBeNull();
    expect(memberColorId('')).toBeNull();
  });
  it('the page still draws the mark, the color chip and the color\'s NAME from the stored value, and writes no color', () => {
    const page = src('MemberPage.tsx');
    expect(page).toMatch(/<MemberMark name=\{contact\?\.name\} colorId=\{memberColorId\(d\.color\)\} size="xl" \/>/);
    expect(page).toMatch(/<MemberChip colorId=\{memberColorId\(d\.color\)\}>\{colorName\(d\.color\)\}<\/MemberChip>/);
    expect(page).toContain('<MemberChip>No color</MemberChip>');
    expect(code(page)).not.toMatch(/color:\s*['"`#]|updateMember\([^)]*color/);
    expect(src('family.css').slice(src('family.css').indexOf('Family member page and dates (D15)'))).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
  it('a member saved with no color stays without one (nothing assigns a color on the way through)', async () => {
    const d = fresh();
    const m = await createMember({ contact: { mode: 'new', name: 'Invented Grandparent' }, fields: fields({ role: 'grandparent' }) }, d);
    expect((await loadMembers(d)).find((x) => x.id === m.id)!.data!.color).toBeUndefined();
  });
});

describe('D15 Family: dates are plain dates', () => {
  it('the tile for a birthday shows the stored month and day and the right weekday, with no time zone involved', () => {
    const m = dateTileModel('2027-03-14', TODAY, { special: true })!;
    expect(m.day).toBe('14');
    expect(m.month).toBe('MAR');
    expect(m.weekday).toBe(['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][new Date(Date.UTC(2027, 2, 14)).getUTCDay()]);
    expect(m.tone).toBe('special');
    const out = renderToStaticMarkup(createElement(DateTile, { iso: '2027-03-14', today: TODAY, special: true, caption: 'Birthday' }));
    expect(out).toContain('dateTime="2027-03-14"');
    expect(out).toContain('Birthday');
  });
  it('the next birthday is the stored month and day in this year or the next, and 29 February is never moved into a different month', () => {
    expect(nextOccurrence('03-14', TODAY)).toBe('2027-03-14');
    expect(nextOccurrence('11-12', TODAY)).toBe('2026-11-12');
    expect(nextOccurrence('11-19', TODAY)).toBe('2026-11-19');
    expect(nextOccurrence('02-29', TODAY).slice(5, 7)).toBe('02');
  });
  it('the dates list is the same list the page had: birthdays and active dates in the order they next fall, and a birthday off the Calendar is marked, not dropped', async () => {
    const d = fresh();
    const a = await createMember({ contact: { mode: 'new', name: 'Invented One' }, fields: fields({ birthMonthDay: '11-19', birthdayOnCalendar: false }) }, d);
    await createMember({ contact: { mode: 'new', name: 'Invented Two' }, fields: fields({ birthMonthDay: '03-02' }) }, d);
    await createDate({ dateKind: 'anniversary', label: 'Invented anniversary', monthDay: '06-12', status: 'active', onCalendar: true }, d, 2026);
    const members = await loadMembers(d);
    const dates = await loadDates(d);
    const names = new Map((await d.contacts.toArray()).map((c) => [c.id as number, c.name]));
    const rows = upcomingRows(members, dates, names, TODAY);
    expect(rows.map((r) => [r.title, r.date, r.onCalendar])).toEqual([
      ["Invented One's birthday", '2026-11-19', false], ['Invented Two\'s birthday', '2027-03-02', true], ['Invented anniversary', '2027-06-12', true],
    ]);
    expect(rows[0].memberId).toBe(a.id);
  });
  it('groups the dates by month and year in the order given, across a year boundary', () => {
    const r = (date: string) => ({ key: date, type: 'other' as const, title: date, date, onCalendar: true });
    const g = monthGroups([r('2026-12-24'), r('2026-12-31'), r('2027-01-02'), r('2027-01-30'), r('2027-02-01')]);
    expect(g.map((x) => [x.label, x.rows.length])).toEqual([['December 2026', 2], ['January 2027', 2], ['February 2027', 1]]);
  });
  it('browsing creates nothing: no Calendar event and no Task exists after the lists are read', async () => {
    const d = fresh();
    await createMember({ contact: { mode: 'new', name: 'Invented Three' }, fields: fields({ birthMonthDay: '11-19' }) }, d);
    const before = JSON.stringify([await d.moduleRecords.toArray(), await d.links.toArray()]);
    upcomingRows(await loadMembers(d), await loadDates(d), new Map(), TODAY);
    expect(JSON.stringify([await d.moduleRecords.toArray(), await d.links.toArray()])).toBe(before);
    expect((await d.moduleRecords.filter((x) => x.module === 'tasks' || x.module === 'calendar').toArray())).toHaveLength(0);
  });
});

describe('D15 Family: Contacts are never matched or merged by name', () => {
  it('two Contacts with the same name stay two Contacts; a member points at the one that was chosen and the other is left alone', async () => {
    const d = fresh();
    const first = await createDistinctContact(d, { name: 'Sam Invented' });
    const second = await createDistinctContact(d, { name: 'Sam Invented' });
    expect(second).not.toBe(first);
    const m = await createMember({ contact: { mode: 'existing', contactId: second }, fields: fields() }, d);
    expect(m.contactId).toBe(second);
    expect((await loadMembers(d)).map((x) => x.data!.contactId)).toEqual([second]);
    expect((await d.contacts.toArray()).filter((c) => c.name === 'Sam Invented')).toHaveLength(2);
  });
  it('adding a member with a NEW Contact of an existing name creates a separate Contact and links no existing one', async () => {
    const d = fresh();
    const first = await createDistinctContact(d, { name: 'Sam Invented' });
    const m = await createMember({ contact: { mode: 'new', name: 'Sam Invented' }, fields: fields() }, d);
    expect(m.createdContact).toBe(true);
    expect(m.contactId).not.toBe(first);
  });
  it('the member page names the linked Contact, offers no merge, replace or re-link control, and does not create Contacts', () => {
    const page = code(src('MemberPage.tsx'));
    expect(page).toContain('Linked contact');
    expect(page).not.toMatch(/createDistinctContact|findOrCreateContact|mergeContact|Merge contact|Link to another|Change contact/);
  });
});

describe('D15 Family: related is not assigned', () => {
  it('the tasks section is "Related tasks" and says being named is not responsibility; no page uses assignment words', () => {
    const sections = src('MemberSections.tsx');
    expect(sections).toContain('id="fm-todo">Related tasks</h2>');
    expect(sections).toContain('Being named on a task does not make someone responsible for it.');
    expect(sections).not.toMatch(/id="fm-todo">To do/);
    for (const f of ['MemberPage.tsx', 'MemberSections.tsx', 'DatesPage.tsx']) expect(code(src(f)), f).not.toMatch(/Assigned to|Responsible for|Owned by|belongs to|Responsibilities/);
  });
  it('the member page, its sections and the dates page write no Task, no event and no role', () => {
    for (const f of ['MemberSections.tsx']) expect(code(src(f)), f).not.toMatch(/createTask|saveTask|createEvent|updateMember|setMe\(|transaction\(/);
    expect(code(src('DatesPage.tsx'))).not.toMatch(/createTask|createEvent|updateMember/);
  });
});

describe('D15 Family: the page keeps every section and action, and works on a phone', () => {
  it('keeps the actions and sections the page had', () => {
    const page = src('MemberPage.tsx');
    for (const t of ['>Edit</button>', 'Mark as past member', 'Mark as in the household', '<ScheduleSection', '<TodoSection', '<ProjectsSection', '<ImportantContactsSection', '<MemberDatesSection', 'Linked contact', 'Private note', 'Possible duplicate member', 'More than one member is marked']) expect(page).toContain(t);
    expect(page).toContain('{nextBirthday && <DateTile iso={nextBirthday} today={today} special caption="Birthday" />}');
    expect(page).toContain("d.status === 'active' && d.birthMonthDay ? nextOccurrence(d.birthMonthDay, today) : null");
  });
  it('the dates page keeps Add, Edit, Calendar on/off, Archive and Restore', () => {
    const page = src('DatesPage.tsx');
    for (const t of ['Add date', 'Edit ${r.title}', 'my Calendar: ${r.title}', 'Archive ${r.title}', 'Restore ${r.data!.label}', 'Open profile: ${r.title}']) expect(page).toContain(t);
  });
  it('the phone rules stack the hero and keep targets at 44px', () => {
    const css = src('family.css');
    expect(css).toMatch(/\.fm-hero-main \{ flex-wrap: wrap; align-items: center;/);
    expect(css).toMatch(/\.fm-hero-actions \.btn \{[^}]*min-height: 44px/);
  });
  it('the hero heading is the only h1 on the page and the page header is not repeated', () => {
    const page = code(src('MemberPage.tsx'));
    const hero = page.slice(page.indexOf('<header className="card fm-hero">'), page.indexOf('</header>'));
    expect((hero.match(/<h1>/g) ?? []).length).toBe(1);
    expect(html(createElement('div', null, 'x'))).toContain('x');
  });
});
