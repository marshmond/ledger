import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ModuleBase } from '../../core/router';
import { all, byTag, parseHtml, textOf } from '../../lib/a11yTestkit';
import { ToastProvider } from '../../ui/Toast';
import { ActivitiesSection, DatesSection, RelatedTasksSection, daysUntil, inWords } from './HouseholdSections';
import type { HouseholdActivity, HouseholdDate, HouseholdTask, PersonRef } from './householdOverview';
import { memberColorId } from './memberIdentity';

/**
 * D12, Family overview. The page was restyled: member cards, filter chips, date tiles, two columns. The members, their roles and colors, the "This is you" marker, the filter,
 * the dates and every link are the same, and nothing here assigns a person to anything. Static markup and source checks: structure and text, not a look
 * (checked in a real browser, including a member with no color) and not real devices.
 */
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => parseHtml(renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ModuleBase, { value: '/family' }, createElement(ToastProvider, null, el)))));
const src = (f: string) => readFileSync(`src/modules/family/${f}`, 'utf8');
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/ \/\/ .*$/gm, '');
const TODAY = '2026-11-09';
const sam: PersonRef = { memberId: 11, contactId: 1, name: 'Sam Example', color: '#4a7bd0' };
const activity = (id: number, title: string): HouseholdActivity => ({
  key: `${id}:2026-11-1${id % 10}`, eventId: id, occKey: `2026-11-1${id % 10}`, title, allDay: false, firstDay: `2026-11-1${id % 10}`, lastDay: `2026-11-1${id % 10}`, startMs: id, endMs: id + 1,
  location: '', recurring: false, done: false, trackDone: false, calendarId: 1, calendarName: 'Personal', color: '#2f8f6b', openKey: `e:${id}:2026-11-1${id % 10}`, also: [], people: [sam],
});
const taskRow = (id: number, title: string, over: Partial<HouseholdTask> = {}): HouseholdTask => ({ id, title, when: null, overdue: false, high: false, repeats: false, status: 'todo', people: [sam], ...over });
const dateRow = (key: string, over: Partial<HouseholdDate> = {}): HouseholdDate => ({ key, type: 'birthday', title: "Sam Example's birthday", date: '2026-11-12', memberId: 11, onCalendar: true, person: sam, ...over });

describe('D12 Family: member cards use the D9 identity pieces and the stored color', () => {
  const page = code(src('OverviewPage.tsx'));

  it('each card draws the shared mark with the stored color id, the color\'s NAME in words, and a dot, with no color system of its own', () => {
    expect(src('OverviewPage.tsx')).toMatch(/<MemberMark name=\{[^}]*\} colorId=\{memberColorId\(d\.color\)\}/);
    expect(page).toContain('data-mc={memberColorId(d.color) ?? undefined}');
    expect(page).toMatch(/\{d\.color && <span className="fm-colorname small"><MemberDot colorId=\{memberColorId\(d\.color\)\} \/>\{colorName\(d\.color\)\}<\/span>\}/);
    expect(page.replace(/'[^']*'|"[^"]*"/g, '')).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src('HouseholdSections.tsx')).toMatch(/<MemberDot colorId=\{memberColorId\(p\.color\)\} \/>/);
  });

  it('a stored color gives its id, and no color (or a color that is not one of the eight) gives the neutral look, never an invented color', () => {
    expect(memberColorId('#4a7bd0')).toBe('blue');
    expect(memberColorId(undefined)).toBeNull();
    expect(memberColorId('#123456')).toBeNull();
    const css = src('family.css');
    expect(css).toMatch(/\.fm-grid > \.fm-mcard:not\(\[data-mc\]\) \{ border-top-style: dashed; \}/); // no color: a dashed neutral edge
    expect(css).toMatch(/border-top: 4px solid var\(--pc, var\(--control-line\)\)/);
    expect(page).not.toMatch(/color:\s*(randomColor|autoColor|nextColor|COLORS\[)/); // nothing assigns a color on the page
  });

  it('role, "This is you" and the birthday come from the same fields as before; "This is you" stays separate from the role', () => {
    expect(page).toContain('{ROLE_LABEL[d.role]}');
    expect(page).toContain('meState.me?.id === m.id');
    expect(page).toContain('monthDayText(d.birthMonthDay)');
    expect(page).toMatch(/This is you/);
  });

  it('current and past members stay in separate sections, sorted as before, and unreadable records stay under Needs review', () => {
    expect(page).toContain("data!.status === 'active'");
    expect(page).toContain("data!.status === 'past'");
    expect(page).toContain('Past members');
    expect(page).toContain('Needs review');
    expect(page).toContain('nameOf(a).localeCompare(nameOf(b))');
    expect(page).toContain('memberRoute(m.id)');
  });

  it('the birthday tag ("In 6 days") is read from the same 30-day list as the Birthdays section, with the same wording function', () => {
    expect(page).toContain("overview?.dates.find((x) => x.type === 'birthday' && x.memberId === memberId)");
    expect(page).toContain('inWords(daysUntil(today, r.date))');
    expect(inWords(daysUntil('2026-11-12', '2026-11-18'))).toBe('In 6 days');
    expect(inWords(0)).toBe('Today');
  });
});

describe('D12 Family: no assignment, no new links between people and things', () => {
  it('the tasks section says "Related tasks" and the page says tasks and events are "associated with" a member: no "Responsibilities", no "belong to", no "owner"', () => {
    const sections = html(createElement(RelatedTasksSection, { items: [taskRow(1, 'T')], today: TODAY, who: null }));
    expect(textOf(byTag(sections, 'h2')[0])).toBe('Related tasks');
    expect(textOf(sections)).toMatch(/Associated with:/);
    expect(textOf(sections)).toMatch(/Ledger does not record who has to do them/);
    const page = src('OverviewPage.tsx');
    expect(page).toContain('so tasks and events that name that contact are associated with them.');
    for (const f of ['OverviewPage.tsx', 'HouseholdSections.tsx']) {
      const c = code(src(f));
      expect(c, f).not.toMatch(/Responsibilit/);
      expect(c, f).not.toMatch(/belong(s)? to (them|a member|the member)|owned by|must complete|assigned to/i);
    }
  });

  it('the page and its sections never say or do "assign": no assignee, no responsible person, no owner, no weekly matrix', () => {
    for (const f of ['OverviewPage.tsx', 'HouseholdSections.tsx']) {
      const c = code(src(f));
      expect(c, f).not.toMatch(/assign(ed|ee|ment)?\b/i);
      expect(c, f).not.toMatch(/in charge|responsible for|owner of|this week by person|per-person/i);
    }
    expect(src('HouseholdSections.tsx')).toContain('Ledger does not record who has to do them');
  });

  it('the overview writes nothing about a member or a Contact; only the Add form (unchanged) can create one', () => {
    const c = code(src('OverviewPage.tsx'));
    expect(c).not.toMatch(/\b(setMe|updateMember|setMemberStatus|setBirthdayOnCalendar)\b/);
    expect(c).not.toMatch(/store\.shared\.contacts\.(add|update|remove|put)/);
    expect(c).toContain('<MemberForm onClose');
    expect(c).toContain("navigate(memberRoute(id))");
  });

  it('the filter is a view only: chips and the phone select set the same local choice, and nothing is saved', () => {
    const c = code(src('OverviewPage.tsx'));
    expect(c).toContain('const [who, setWho] = useState<number | null>(null)');
    expect((c.match(/setWho\(/g) ?? []).length).toBe(3); // Everyone, a person, the select
    expect(c).toMatch(/<div className="fm-chips" role="group" aria-label="Show everyone or one person">/);
    expect(c).toMatch(/aria-pressed=\{!picked\}/);
    expect(c).toMatch(/aria-pressed=\{picked\?\.memberId === p\.memberId\}/);
    expect(c).toContain('Narrows the three sections below. Nothing is saved.');
    expect(c).not.toMatch(/localStorage|sessionStorage|saveHide/);
    const css = src('family.css');
    expect(css).toMatch(/\.fm-who-select \{ display: none; \}/);
    expect(css).toMatch(/@media \(max-width: 700px\) \{ \.fm-chips \{ display: none; \} \.fm-who-select \{ display: inline-block; \} \}/);
  });
});

describe('D12 Family: dates use the shared tile and keep their meaning', () => {
  it('each activity starts with a date tile that is decoration (the text beside it states the date); the stripe is still the calendar\'s own color', () => {
    const d = html(createElement(ActivitiesSection, { items: [activity(5, 'Practice')], hiddenCount: 0, today: TODAY, who: null }));
    const tile = all(d, (e) => (e.attrs.class ?? '').split(' ').includes('ui-dtile'));
    expect(tile).toHaveLength(1);
    expect(tile[0].attrs['aria-hidden']).toBe('true');
    expect(textOf(d)).toMatch(/Thu, Nov 15|Nov 15/);
    expect(src('HouseholdSections.tsx')).toMatch(/className="fm-bar" style=\{\{ background: it\.color \}\}/);
    expect(renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ModuleBase, { value: '/family' }, createElement(ActivitiesSection, { items: [activity(5, 'Practice')], hiddenCount: 0, today: TODAY, who: null }))))).toContain('background:#2f8f6b');
  });

  it('an overdue task has the overdue tile and the word "Overdue"; a task with no date has no tile, only a spacer, and says "No date"', () => {
    const rows = [taskRow(1, 'Late', { when: { label: 'Due', date: '2026-11-05', time: undefined } as never, overdue: true }), taskRow(2, 'Someday')];
    const markup = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(RelatedTasksSection, { items: rows, today: TODAY, who: null })));
    expect(markup).toContain('ui-dtile--overdue');
    expect(markup).toContain('Overdue</strong>');
    expect(markup).toContain('fm-tile-none');
    expect(markup).toContain('No date');
  });

  it('used without a date reference the section draws exactly the rows it drew before (no tile)', () => {
    const markup = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(RelatedTasksSection, { items: [taskRow(1, 'T')], who: null })));
    expect(markup).not.toContain('ui-dtile');
    expect(markup).not.toContain('fm-tile-none');
  });

  it('only a birthday gets the warm tile; an important date gets the plain one, and the dates, wording and links are unchanged', () => {
    const rows = [dateRow('b1'), dateRow('o1', { type: 'other', title: 'Moving-in day', date: '2026-11-20', memberId: undefined, person: undefined, aboutMemberId: undefined } as never)];
    const markup = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ModuleBase, { value: '/family' }, createElement(DatesSection, { items: rows, today: TODAY, who: null }))));
    expect(markup.match(/ui-dtile--special/g) ?? []).toHaveLength(1);
    expect(markup).toContain('In 3 days');
    expect(markup).toContain('In 11 days');
    expect(markup).toContain('href="/family/m/11"');
    expect(markup).toContain('href="/family/dates"');
    expect(byTag(html(createElement(DatesSection, { items: rows, today: TODAY, who: null })), 'time')).toHaveLength(2);
  });

  it('no Calendar event or Task is created or recolored from a member color', () => {
    for (const f of ['OverviewPage.tsx', 'HouseholdSections.tsx']) {
      const c = code(src(f));
      expect(c, f).not.toMatch(/createEvent|createTask|calendars\.(put|add|update)|event\.color\s*=|color:\s*memberColor/);
    }
  });
});

describe('D12 Family: stylesheet', () => {
  const css = src('family.css');
  const d12 = css.slice(css.indexOf('/* ---- Family overview (D12)'));
  it('the new rules use tokens only: no hex color, no priority override, no new font, American spelling', () => {
    const rules = d12.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rules).not.toMatch(/!important|@font-face|url\(/);
    expect(d12).not.toMatch(/colour|grey\b/i);
  });
  it('the page widens only when the member grid is present (the member pages and dates keep their width)', () => {
    expect(d12).toContain('.fm-main:has(.fm-grid) { max-width: min(1220px, 100%); }');
    expect(css).toContain('.fm-main { padding-bottom: var(--sp-6, 48px); max-width: min(900px, 100%); }');
  });
  it('member cards go two across on a phone and one across when the screen is too narrow for a long name', () => {
    expect(d12).toContain('.fm-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));');
    expect(d12).toContain('.fm-mcard .fm-name { align-self: flex-start;');
    expect(d12).toMatch(/overflow-wrap: anywhere/);
  });
});
