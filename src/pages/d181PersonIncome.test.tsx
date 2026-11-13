import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import type { IncomeProfile, Person, RsuVest } from '../types';
import { buildIncomeModel, newProfile } from '../lib/income';
import { COLLAPSE_KEY, readCollapsed, writeCollapsed } from './Collapsible';
import { PersonWorkspace, SummaryLine, UnassignedBonuses } from './PersonWorkspace';
import RsuSection from './RsuSection';
import { bonusFor, inScope, personAnchorId, personCollapseId, personStartsOpen, personSummary, scopeRows } from './incomeOwners';

/**
 * D18.1 Person-centric Income. Each person's pay setup, bonuses and stock awards sit in that person's own workspace. These tests pin the ownership rules (records are found by the
 * stored person id, a new record starts with the person whose workspace it was made in, nothing is reassigned or repaired on its own) and the small pieces of the page. Layout and
 * the real clicks were checked in a browser, not here.
 */
const read = (f: string) => readFileSync(f, 'utf8');
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

const AVERY: Person = { id: 11, name: 'Avery Test', birthYear: 1988 };
const JORDAN: Person = { id: 22, name: 'Jordan Sample', birthYear: 1990 };
const PEOPLE = [AVERY, JORDAN];
const profile = (personId: number, annualCents: number): IncomeProfile => ({ ...newProfile(personId, 2026), salary: [{ effectiveDate: '2026-01-01', annualCents }] });
const vest = (id: number, personId: number, grant: string, date = '2026-06-15'): RsuVest => ({ id, personId, date, grant, kind: 'cash', shares: 10, priceCents: 1000, securityId: null, afterVest: undefined, accountId: null });
const VESTS = [vest(1, 11, 'Avery award'), vest(2, 22, 'Jordan award'), vest(3, 999, 'Orphan award', '2025-03-01')];
const PROFILES = [profile(11, 15000000), profile(22, 12000000)];
const MODEL = buildIncomeModel(2026, PEOPLE, PROFILES, [], undefined, { vests: VESTS, securities: [] });
const rsu = (extra: Partial<Parameters<typeof RsuSection>[0]>) => html(createElement(RsuSection, { year: 2026, people: PEOPLE, profiles: PROFILES, model: MODEL, vests: VESTS, securities: [], invAccounts: [], tables: MODEL.tables, ...extra }));

describe('D18.1 who owns a record', () => {
  const rows = [{ personId: 11, n: 'a' }, { personId: 22, n: 'b' }, { personId: 999, n: 'orphan' }];
  it('a person scope keeps only that person\'s records, found by id', () => {
    expect(scopeRows(rows, { personId: 11 }, PEOPLE).map((r) => r.n)).toEqual(['a']);
    expect(scopeRows(rows, { personId: 22 }, PEOPLE).map((r) => r.n)).toEqual(['b']);
  });
  it('the review scope keeps only records whose person is not on the page, and no scope keeps everything as before', () => {
    expect(scopeRows(rows, { unassigned: true }, PEOPLE).map((r) => r.n)).toEqual(['orphan']);
    expect(scopeRows(rows, {}, PEOPLE)).toHaveLength(3);
    expect(inScope(999, { personId: 11 }, PEOPLE)).toBe(false);
  });
  it('two people with the same name are still told apart by id', () => {
    const twins: Person[] = [{ id: 1, name: 'Sam' }, { id: 2, name: 'Sam' }];
    expect(scopeRows([{ personId: 1 }, { personId: 2 }], { personId: 2 }, twins)).toEqual([{ personId: 2 }]);
  });
  it('a bonus saved from a person\'s workspace belongs to that person', () => {
    expect(bonusFor(22, 2026, 12, 123400, '  Spot  ')).toEqual({ personId: 22, year: 2026, month: 12, grossCents: 123400, label: 'Spot' });
    expect(bonusFor(11, 2026, 3, 100, '').label).toBe('Bonus');
  });
  it('workspace keys use the stable id, never the name or position', () => {
    expect(personCollapseId(22)).toBe('income.person.22');
    expect(personAnchorId(22)).toBe('income-person-22');
    expect(personStartsOpen(0)).toBe(true);
    expect(personStartsOpen(1)).toBe(false);
  });
});

describe('D18.1 folded header summary', () => {
  it('uses the model totals; a person with no setup is told so instead of being shown zeros', () => {
    const py = MODEL.years.find((y) => y.personId === 11)!;
    const s = personSummary(2026, PROFILES[0], py, true);
    expect(s).toMatchObject({ state: 'ready', gross: py.totals.gross, net: py.totals.net, bonusGross: py.totals.bonusGross, rsuGross: py.totals.rsuGross });
    expect(personSummary(2026, undefined, undefined, true)).toEqual({ state: 'not-set-up' });
    const text = html(createElement(SummaryLine, { s: { state: 'not-set-up' }, year: 2026 }));
    expect(text).toContain('Not set up for 2026');
    expect(text).not.toContain('$0.00');
  });
  it('a setup with no estimate says why, and stock awards are labeled as counted at vest', () => {
    expect(personSummary(2030, profile(11, 1), undefined, false)).toEqual({ state: 'not-calculated', reason: 'No 2030 tax tables, so no estimate' });
    const out = html(createElement(SummaryLine, { s: { state: 'ready', gross: 100000, net: 80000, bonusGross: 0, rsuGross: 5000, warnings: 0 }, year: 2026 }));
    expect(out).toContain('counted when they vest');
    expect(out).not.toContain('Bonus');
  });
});

describe('D18.1 folding is a screen preference', () => {
  it('a workspace that starts folded remembers that it was opened (both choices are stored)', () => {
    const data: Record<string, string> = {};
    const s = { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; } };
    expect(readCollapsed('income.person.22', s)).toBeUndefined();
    writeCollapsed('income.person.22', false, s, true);
    expect(readCollapsed('income.person.22', s)).toBe(false);
    writeCollapsed('income.person.22', true, s, true);
    expect(readCollapsed('income.person.22', s)).toBe(true);
    expect(JSON.parse(data[COLLAPSE_KEY])).toEqual({ 'income.person.22': true });
  });
  it('sections that start open still remember nothing when open', () => {
    const data: Record<string, string> = {};
    const s = { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; } };
    writeCollapsed('x', true, s);
    writeCollapsed('x', false, s);
    expect(JSON.parse(data[COLLAPSE_KEY])).toEqual({});
  });
  it('the first person renders open and the next one folded, each with its own control and body', () => {
    const first = html(createElement(PersonWorkspace, { person: AVERY, index: 0, year: 2026, summary: { state: 'not-set-up' }, children: createElement('p', null, 'body A') }));
    const second = html(createElement(PersonWorkspace, { person: JORDAN, index: 1, year: 2026, summary: { state: 'not-set-up' }, children: createElement('p', null, 'body B') }));
    expect(first).toContain('aria-expanded="true"');
    expect(first).not.toMatch(/class="pw-body" hidden/);
    expect(second).toContain('aria-expanded="false"');
    expect(second).toMatch(/class="pw-body" hidden/);
    expect(second).toContain('body B'); // folded content stays in the page, so a half-typed form is not lost
    expect(first).toContain('data-person="11"');
    expect(second).toContain('data-person="22"');
  });
});

describe('D18.1 stock awards are scoped to one person', () => {
  it('a person\'s section lists only that person\'s vests and no one else\'s', () => {
    const a = rsu({ personId: 11 });
    expect(a).toContain('Avery award');
    expect(a).not.toContain('Jordan award');
    expect(a).not.toContain('Orphan award');
    const j = rsu({ personId: 22 });
    expect(j).toContain('Jordan award');
    expect(j).not.toContain('Avery award');
  });
  it('a new vest starts with the person whose workspace it is, shown as fixed text with no person choice', () => {
    const j = rsu({ personId: 22 });
    expect(j).toContain('Add a single vest for Jordan Sample');
    expect(j).toContain('pw-owner');
    expect(j).not.toContain('<option value="11">');
    expect(j).not.toContain('<option value="22">');
  });
  it('withholding rows show only that person\'s own income profile', () => {
    const j = rsu({ personId: 22 });
    expect(j).toContain('Jordan Sample</strong>');
    expect(j).not.toContain('Avery Test</strong>');
  });
  it('the review list shows only records with no matching person, says so, and offers no add form', () => {
    const o = rsu({ unassigned: true });
    expect(o).toContain('Orphan award');
    expect(o).toContain('no matching person');
    expect(o).not.toContain('Avery award');
    expect(o).not.toContain('Jordan award');
    expect(o).not.toContain('Add a single vest (one-off');
    expect(o).not.toContain('Add vest</button>');
  });
  it('without a scope the section is the one the page always had: everyone\'s vests and a person choice', () => {
    const all = rsu({});
    expect(all).toContain('Avery award');
    expect(all).toContain('Jordan award');
    expect(all).toMatch(/<option value="11"[^>]*>Avery Test</);
  });
  it('radio groups are named per form, so two people\'s forms on one page cannot share a group', () => {
    const src = read('src/pages/RsuSection.tsx') + read('src/pages/RsuGrants.tsx');
    expect(src).not.toMatch(/name="(rsukind|rsuafter|grantkind|grantafter)"/);
    expect(src).toContain('useId()');
  });
});

describe('D18.1 source guards', () => {
  const grants = read('src/pages/RsuGrants.tsx');
  const sec = read('src/pages/RsuSection.tsx');
  const page = read('src/pages/IncomePage.tsx');
  const pw = read('src/pages/PersonWorkspace.tsx');
  it('a new grant or vest in a person\'s workspace is saved under that person, not under a form choice', () => {
    expect(grants).toMatch(/scoped && !editing \? personId/);
    expect(sec).toMatch(/\.\.\.\(scoped && !editing \? \{ personId \} : \{\}\)/);
  });
  it('grants are filtered by stored id before they are shown', () => {
    expect(grants).toContain('allGrants.filter((g) => inScope(g.personId');
  });
  it('the bonus form has no person choice and saves through bonusFor with the workspace person', () => {
    expect(pw).toContain('bonusFor(person.id!');
    expect(pw).not.toMatch(/<label className="f">Person/);
  });
  it('folding and the jump list only change screen state: no database call in the header or the jump', () => {
    const header = pw.slice(pw.indexOf('export function PersonWorkspace'), pw.indexOf('export function PersonBonuses'));
    expect(header).not.toMatch(/\bdb\./);
    expect(page).toContain('setOpenSignals');
  });
  it('records with no matching person are listed but never repaired on their own', () => {
    const review = page.slice(page.indexOf('needsReview &&'));
    expect(review).not.toMatch(/db\.(bonuses|rsuVests|rsuGrants)\.(put|update|add|bulk)/);
    expect(page).toContain('peopleQuery ? scopeRows');
  });
  it('the income and RSU engines are untouched by the page and still the ones used', () => {
    expect(page).toContain("buildIncomeModel");
    expect(page).toContain("from '../lib/payroll'");
    expect(sec).toContain("from '../lib/rsu'");
  });
  it('profiles are shown for the selected year and never created by opening a workspace', () => {
    expect(page).toContain('x.personId === p.id && x.year === year');
    const body = page.slice(page.indexOf('<PersonWorkspace'), page.indexOf('</PersonWorkspace>'));
    expect(body.match(/save\(/g)?.length).toBe(3); // only the calls the page already had: Set up, Copy, and the confirmed replace
  });
  it('the unassigned bonus list renders nothing when there is nothing to review', () => {
    expect(html(createElement(UnassignedBonuses, { bonuses: [] }))).toBe('');
    expect(html(createElement(UnassignedBonuses, { bonuses: [{ id: 1, personId: 999, year: 2026, month: 5, grossCents: 77700, label: 'Orphan bonus' }] }))).toContain('Orphan bonus');
  });
});
