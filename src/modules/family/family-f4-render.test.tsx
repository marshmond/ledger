import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { scrubGeneratedIds } from '../../lib/leakTestkit';
import { accessibleName, all, byTag, headingSkips, headings, parseHtml, textOf, unnamedButtons, unnamedFields } from '../../lib/a11yTestkit';
import { ModuleBase } from '../../core/router';
import { ToastProvider } from '../../ui/Toast';
import { ActivitiesSection, daysUntil, DatesSection, inWords, PREVIEW, ResponsibilitiesSection } from './HouseholdSections';
import type { HouseholdActivity, HouseholdDate, HouseholdTask, PersonRef } from './householdOverview';
import OverviewPage from './OverviewPage';
import { calendarLink } from './memberSchedule';

/**
 * F4 rendering: what a reader and a screen reader meet in the overview's sections, with real rows. Static markup, the same method as F1 to F3; layout at
 * 320 and 375 px and light and dark were checked in a real browser (see the F4 report).
 */
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => parseHtml(renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ModuleBase, { value: '/family' }, createElement(ToastProvider, null, el)))));
const TODAY = '2026-11-09';
const sam: PersonRef = { memberId: 11, contactId: 1, name: 'Sam Example', color: '#4a7bd0' };
const robin: PersonRef = { memberId: 12, contactId: 2, name: 'Robin Example' };
const activity = (id: number, title: string, over: Partial<HouseholdActivity> = {}): HouseholdActivity => ({
  key: `${id}:2026-11-1${id % 10}`, eventId: id, occKey: `2026-11-1${id % 10}`, title, allDay: false, firstDay: `2026-11-1${id % 10}`, lastDay: `2026-11-1${id % 10}`, startMs: id, endMs: id + 1,
  location: 'Private address 12', recurring: false, done: false, trackDone: false, calendarId: 1, calendarName: 'Personal', color: '#2f8f6b', openKey: `e:${id}:2026-11-1${id % 10}`, also: [], people: [sam], ...over,
});
const taskRow = (id: number, title: string, over: Partial<HouseholdTask> = {}): HouseholdTask => ({ id, title, when: null, overdue: false, high: false, repeats: false, status: 'todo', people: [sam], ...over });
const dateRow = (key: string, over: Partial<HouseholdDate> = {}): HouseholdDate => ({ key, type: 'birthday', title: "Sam Example's birthday", date: '2026-11-12', memberId: 11, onCalendar: true, person: sam, ...over });

describe('activities', () => {
  it('each title opens the Calendar occurrence; a shared event is one row naming every member, each a link to their profile', () => {
    const it1 = activity(5, 'Swim meet', { people: [robin, sam] });
    const d = html(createElement(ActivitiesSection, { items: [it1], hiddenCount: 0, today: TODAY, who: null }));
    const link = byTag(d, 'a').find((a) => textOf(a) === 'Swim meet')!;
    expect(link.attrs.href).toBe(calendarLink(it1));
    expect(link.attrs.href).toBe('#/calendar?v=agenda&d=2026-11-15&open=e%3A5%3A2026-11-15');
    expect(all(d, (e) => e.tag === 'li')).toHaveLength(1);
    const chips = byTag(d, 'a').filter((a) => /Example$/.test(textOf(a)));
    expect(chips.map((a) => textOf(a))).toEqual(['Robin Example', 'Sam Example']);
    expect(chips.map((a) => a.attrs.href)).toEqual(['/family/m/12', '/family/m/11']);
    expect(textOf(d)).toMatch(/People:/);
  });

  it('the colour dot is decoration only: the name is always in text', () => {
    const d = html(createElement(ActivitiesSection, { items: [activity(5, 'Practice')], hiddenCount: 0, today: TODAY, who: null }));
    for (const dot of all(d, (e) => /\bfm-(dot|bar)\b/.test(e.attrs.class ?? ''))) expect(dot.attrs['aria-hidden']).toBe('true');
    expect(textOf(d)).toContain('Sam Example');
  });

  it('shows a short preview with an expandable "Show all", and never the event location or any other detail', () => {
    const items = Array.from({ length: PREVIEW + 3 }, (_, i) => activity(i + 1, `Event ${i + 1}`));
    const d = html(createElement(ActivitiesSection, { items, hiddenCount: 0, today: TODAY, who: null }));
    expect(all(d, (e) => e.tag === 'li')).toHaveLength(PREVIEW);
    const more = byTag(d, 'button').find((b) => /Show all/.test(textOf(b)))!;
    expect(textOf(more)).toBe(`Show all ${PREVIEW + 3} activities`);
    expect(more.attrs['aria-expanded']).toBe('false');
    expect(textOf(d)).not.toMatch(/Private address/);
  });

  it('says how many are hidden by switched-off calendars, in words, with a way back', () => {
    const d = html(createElement(ActivitiesSection, { items: [], hiddenCount: 2, today: TODAY, who: null }));
    expect(textOf(d)).toMatch(/2 upcoming activities are not shown because their calendars are switched off on this device/);
    expect(textOf(d)).toMatch(/No activities shown/);
    const one = html(createElement(ActivitiesSection, { items: [activity(1, 'x')], hiddenCount: 1, today: TODAY, who: null }));
    expect(textOf(one)).toMatch(/1 upcoming activity is not shown because its calendar is switched off/);
  });

  it('empty states are plain words, for everyone and for one person; a link to the Calendar is always there', () => {
    const a = html(createElement(ActivitiesSection, { items: [], hiddenCount: 0, today: TODAY, who: null }));
    expect(textOf(a)).toMatch(/Nothing planned in the next 7 days/);
    const b = html(createElement(ActivitiesSection, { items: [], hiddenCount: 0, today: TODAY, who: 'Sam Example' }));
    expect(textOf(b)).toMatch(/Sam Example is not named on any upcoming Calendar event/);
    expect(byTag(b, 'a').some((x) => x.attrs.href === `#/calendar?v=agenda&d=${TODAY}`)).toBe(true);
  });
});

describe('responsibilities', () => {
  it('overdue and high priority are words, a repeating task says so, and the wording is "associated with", never ownership', () => {
    const d = html(createElement(ResponsibilitiesSection, {
      items: [taskRow(7, 'Sign form', { overdue: true, high: true, repeats: true, when: { label: 'Due', date: '2026-11-03', time: null }, people: [robin, sam] }), taskRow(8, 'Undated thing')],
      who: null,
    }));
    const text = textOf(d);
    expect(text).toMatch(/Overdue/);
    expect(text).toMatch(/High priority/);
    expect(text).toMatch(/Repeats/);
    expect(text).toMatch(/1 overdue/);
    expect(text).toMatch(/Associated with:/);
    expect(text).toMatch(/No date/);
    expect(text).toMatch(/Ledger does not record who has to do them/);
    expect(text).not.toMatch(/assigned|responsible for|owner/i);
    expect(byTag(d, 'a').find((a) => textOf(a) === 'Sign form')!.attrs.href).toBe('#/tasks?task=7');
  });

  it('one row per task however many members it names; no completion control is offered', () => {
    const d = html(createElement(ResponsibilitiesSection, { items: [taskRow(7, 'Pack bags', { people: [robin, sam] })], who: null }));
    expect(all(d, (e) => e.tag === 'li')).toHaveLength(1);
    expect(byTag(d, 'input')).toEqual([]);
    expect(byTag(d, 'button').map((b) => textOf(b))).toEqual([]);
  });

  it('previews six rows and offers Show all; empty states for everyone and for one person', () => {
    const many = html(createElement(ResponsibilitiesSection, { items: Array.from({ length: 9 }, (_, i) => taskRow(i + 1, `Task ${i + 1}`)), who: null }));
    expect(all(many, (e) => e.tag === 'li')).toHaveLength(PREVIEW);
    expect(textOf(byTag(many, 'button')[0])).toBe('Show all 9 tasks');
    expect(textOf(html(createElement(ResponsibilitiesSection, { items: [], who: null })))).toMatch(/No open tasks/);
    expect(textOf(html(createElement(ResponsibilitiesSection, { items: [], who: 'Robin Example' })))).toMatch(/Robin Example is not named on any open task/);
  });
});

describe('birthdays and dates', () => {
  it('a birthday opens the member; a date about a member opens the member; a household date opens the Family dates page', () => {
    const d = html(createElement(DatesSection, {
      today: TODAY, who: null,
      items: [
        dateRow('b11'),
        dateRow('d3', { type: 'anniversary', title: 'Wedding anniversary', date: '2026-11-14', memberId: undefined, recordId: 3, aboutMemberId: 12, person: robin }),
        dateRow('d4', { type: 'other', title: 'House move day', date: '2026-11-25', memberId: undefined, recordId: 4, person: undefined }),
      ],
    }));
    const href = (t: string) => byTag(d, 'a').find((a) => textOf(a) === t)!.attrs.href;
    expect(href("Sam Example's birthday")).toBe('/family/m/11');
    expect(href('Wedding anniversary')).toBe('/family/m/12');
    expect(href('House move day')).toBe('/family/dates');
  });

  it('shows day and "in N days" words, the kind, and "Not on my Calendar" when so; no year or age', () => {
    const d = html(createElement(DatesSection, { today: TODAY, who: null, items: [dateRow('b1', { date: TODAY, onCalendar: false }), dateRow('b2', { date: '2026-11-10' }), dateRow('b3', { date: '2026-11-14' })] }));
    const text = scrubGeneratedIds(textOf(d));
    expect(text).toMatch(/Today/);
    expect(text).toMatch(/Tomorrow/);
    expect(text).toMatch(/In 5 days/);
    expect(text).toMatch(/Not on my Calendar/);
    expect(text).not.toMatch(/2026|turns|age /i);
  });

  it('empty states, for everyone and for one person', () => {
    expect(textOf(html(createElement(DatesSection, { today: TODAY, items: [], who: null })))).toMatch(/No dates in the next 30 days/);
    expect(textOf(html(createElement(DatesSection, { today: TODAY, items: [], who: 'Sam Example' })))).toMatch(/Sam Example has no birthday or important date coming up/);
  });

  it('daysUntil counts calendar days across a year end, a leap day and clock changes', () => {
    expect([daysUntil('2026-12-30', '2027-01-02'), daysUntil('2028-02-27', '2028-03-01'), daysUntil('2027-02-27', '2027-03-01'), daysUntil('2026-03-07', '2026-03-09'), daysUntil('2026-10-30', '2026-11-02')]).toEqual([3, 3, 2, 2, 3]);
    expect([inWords(0), inWords(1), inWords(9), inWords(-2)]).toEqual(['Today', 'Tomorrow', 'In 9 days', '2 days ago']);
  });
});

describe('structure and the whole page', () => {
  const sections = html(createElement('div', null, createElement('h1', null, 'Family'),
    createElement(ActivitiesSection, { items: [activity(1, 'A')], hiddenCount: 0, today: TODAY, who: null }),
    createElement(ResponsibilitiesSection, { items: [taskRow(1, 'T')], who: null }),
    createElement(DatesSection, { items: [dateRow('b1')], today: TODAY, who: null }),
  ));
  it('each section is a named region with an h2 and no heading level is skipped', () => {
    expect(headings(sections).filter((h) => h.level === 2).map((h) => h.text)).toEqual(['Activities, next 7 days', 'Responsibilities', 'Birthdays and dates, next 30 days']);
    expect(headingSkips(sections)).toEqual([]);
    for (const s of all(sections, (e) => e.tag === 'section')) expect(s.attrs['aria-labelledby']).toBeTruthy();
  });
  it('every link and button has a name', () => {
    expect(unnamedButtons(sections)).toEqual([]);
    for (const a of byTag(sections, 'a')) expect(accessibleName(sections, a)).not.toBe('');
  });
  it('the Family page draws its header and loading state with no unnamed control and one h1', () => {
    const page = html(createElement(OverviewPage));
    expect(headings(page).filter((h) => h.level === 1).map((h) => h.text)).toEqual(['Family']);
    expect(unnamedButtons(page)).toEqual([]);
    expect(unnamedFields(page)).toEqual([]);
  });
});
