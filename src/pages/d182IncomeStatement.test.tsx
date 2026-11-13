import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import type { Bonus, IncomeProfile, Person, RsuVest } from '../types';
import { buildIncomeModel, newDeduction, newProfile } from '../lib/income';
import type { PersonYear } from '../lib/payroll';
import { HouseholdComparison, PersonStatementView } from './IncomeStatement';
import { buildHouseholdStatements, buildStatementSchema, deductionSlotFor, householdCell, type ColumnId } from './incomeStatementModel';

/**
 * D18.2 Gross-to-net statement. The layout is one shared column list for the household, so every person's categories sit in the same place and a missing item is an
 * empty cell, never a "$0" and never a shifted neighbor. The expected amounts below are worked out by hand from the invented setups (salary / pay periods, percent of pay,
 * the 6.2% Social Security rate), NOT by calling the helper being tested. Only invented people and amounts are used.
 */
const read = (f: string) => readFileSync(f, 'utf8');
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

const AVERY: Person = { id: 11, name: 'Avery Test', birthYear: 1988 };
const JORDAN: Person = { id: 22, name: 'Jordan Sample', birthYear: 1990 };
const SKYLER: Person = { id: 33, name: 'Skyler Nosetup', birthYear: 1985 };
const PEOPLE = [AVERY, JORDAN, SKYLER];

const ded = (type: Parameters<typeof newDeduction>[0], mode: 'percent' | 'fixed', value: number) => ({ ...newDeduction(type), id: `${type}-${value}`, mode, value });

/** Avery: $150,000 salary, 10% traditional 401(k), HSA $125 a paycheck, employer match, one $12,000 bonus, no stock awards, no ESPP. */
const averyProfile = (year = 2026): IncomeProfile => ({
  ...newProfile(11, year),
  salary: [{ effectiveDate: `${year}-01-01`, annualCents: 15000000 }],
  deductions: [ded('k401_pretax', 'percent', 10), ded('hsa', 'fixed', 12500)],
  match: { ratePct: 50, upToPctOfPay: 6, trueUp: false, appliesToBonus: false },
});
/** Jordan: $100,000 salary, 5% Roth 401(k), 3% ESPP, $200 a paycheck health premium, no HSA, no bonus, a cash stock award and a held (kept) one. */
const jordanProfile = (year = 2026): IncomeProfile => ({
  ...newProfile(22, year),
  salary: [{ effectiveDate: `${year}-01-01`, annualCents: 10000000 }],
  deductions: [ded('k401_roth', 'percent', 5), ded('espp', 'percent', 3), ded('health', 'fixed', 20000)],
});
const BONUSES: Bonus[] = [{ id: 1, personId: 11, year: 2026, month: 3, grossCents: 1200000, label: 'Annual' }];
const vest = (id: number, kind: 'cash' | 'stock', shares: number, priceCents: number, date: string, afterVest?: 'held' | 'sold'): RsuVest => ({ id, personId: 22, date, grant: 'Jordan award', kind, shares, priceCents, securityId: null, afterVest, accountId: null });
const VESTS: RsuVest[] = [vest(1, 'cash', 10, 60000, '2026-06-15'), vest(2, 'stock', 40, 5000, '2026-09-15', 'held')];
const PROFILES = [averyProfile(), jordanProfile()];
const MODEL = buildIncomeModel(2026, PEOPLE, PROFILES, BONUSES, undefined, { vests: VESTS, securities: [] });
const pyOf = (id: number, m = MODEL) => m.years.find((y) => y.personId === id)!;
const SET = buildHouseholdStatements(2026, PEOPLE, PROFILES, MODEL.years, true);
const [AVERY_S, JORDAN_S, SKYLER_S] = SET.statements;
const cents = (s: typeof AVERY_S, id: ColumnId) => { const c = s.cells[id]; return c.state === 'value' ? c.cents : null; };

const EXPECTED_ORDER: ColumnId[] = [
  'wages', 'bonus', 'rsu', 'gross',
  'ded.k401Pretax', 'ded.k401Roth', 'ded.hsa', 'ded.fsa', 'ded.insurance', 'ded.espp', 'ded.other', 'deductions',
  'tax.fed', 'tax.state', 'tax.ss', 'tax.medicare', 'tax.addlMedicare', 'tax.pfml', 'taxes',
  'net', 'kept', 'er.k401', 'er.hsa',
];

describe('D18.2 shared column schema', () => {
  it('is one fixed list in a fixed order, whoever has what', () => {
    expect(SET.schema.columns.map((c) => c.id)).toEqual(EXPECTED_ORDER);
    expect(buildStatementSchema([]).columns.map((c) => c.id)).toEqual(EXPECTED_ORDER);
    expect(buildStatementSchema([pyOf(11)]).columns.map((c) => c.id)).toEqual(EXPECTED_ORDER);
  });
  it('every person, including one with no setup, has exactly the same cells in the same order', () => {
    for (const s of SET.statements) expect(Object.keys(s.cells)).toEqual(EXPECTED_ORDER);
  });
  it('deduction slots come from the stored type, never from the label', () => {
    expect(deductionSlotFor('k401_pretax')).toBe('ded.k401Pretax');
    expect(deductionSlotFor('k401_roth')).toBe('ded.k401Roth');
    expect(deductionSlotFor('health')).toBe('ded.insurance');
    expect(deductionSlotFor('dental')).toBe('ded.insurance');
    expect(deductionSlotFor('vision')).toBe('ded.insurance');
    expect(deductionSlotFor('custom')).toBe('ded.other');
    // a deduction named "HSA" but typed custom lands in Other, and one typed hsa stays in HSA whatever it is called
    const odd: IncomeProfile = { ...jordanProfile(), deductions: [{ ...ded('custom', 'fixed', 100), name: 'HSA' }, { ...ded('hsa', 'fixed', 100), name: 'Sandwich fund' }] };
    const m = buildIncomeModel(2026, [JORDAN], [odd], [], undefined, undefined);
    const s = buildHouseholdStatements(2026, [JORDAN], [odd], m.years, true).statements[0];
    expect(s.cells['ded.other'].state).toBe('value');
    expect(s.cells['ded.hsa'].state).toBe('value');
    expect(s.cells['ded.k401Pretax'].state).toBe('blank');
  });
  it('an unplaced earning adds one extra column in the same position for everyone (never reorders the rest)', () => {
    const bumped: PersonYear = { ...pyOf(11), totals: { ...pyOf(11).totals, gross: pyOf(11).totals.gross + 12345 } };
    const years = [bumped, pyOf(22)];
    const set = buildHouseholdStatements(2026, [AVERY, JORDAN], PROFILES, years, true);
    const ids = set.schema.columns.map((c) => c.id);
    expect(ids).toEqual(['wages', 'bonus', 'rsu', 'otherEarnings', 'gross', ...EXPECTED_ORDER.slice(4)]);
    expect(Object.keys(set.statements[0].cells)).toEqual(ids);
    expect(Object.keys(set.statements[1].cells)).toEqual(ids);
    expect(cents(set.statements[0], 'otherEarnings')).toBe(12345);
    expect(set.statements[1].cells.otherEarnings.state).toBe('blank');
  });
});

describe('D18.2 alignment in the drawn page', () => {
  const comparison = html(createElement(HouseholdComparison, { year: 2026, people: PEOPLE, schema: SET.schema, statements: SET.statements }));
  const rowsOf = (markup: string) => [...markup.matchAll(/<tr data-person="([^"]+)">(.*?)<\/tr>/g)].map((m) => ({ who: m[1], cols: [...m[2].matchAll(/data-col="([^"]+)" data-state="([^"]+)"/g)].map((x) => ({ id: x[1], state: x[2] })) }));

  it('the comparison draws the same columns, in the same order, for every person', () => {
    const rows = rowsOf(comparison);
    expect(rows.map((r) => r.who)).toEqual(['11', '22', '33']);
    const order = rows[0].cols.map((c) => c.id);
    expect(order).toEqual(['wages', 'bonus', 'rsu', 'gross', 'deductions', 'taxes', 'net', 'kept']);
    for (const r of rows) expect(r.cols.map((c) => c.id)).toEqual(order);
  });
  it('a missing bonus or stock award leaves an empty cell in its own column instead of moving the next value left', () => {
    const [avery, jordan] = rowsOf(comparison);
    const state = (r: typeof avery, id: string) => r.cols.find((c) => c.id === id)!.state;
    expect(state(avery, 'bonus')).toBe('value');
    expect(state(avery, 'rsu')).toBe('blank');
    expect(state(avery, 'kept')).toBe('blank');
    expect(state(jordan, 'bonus')).toBe('blank');
    expect(state(jordan, 'rsu')).toBe('value');
    expect(state(jordan, 'kept')).toBe('value');
    // the cell markup itself is empty of money and has a spoken label
    const cell = comparison.match(/<td[^>]*data-col="bonus" data-state="blank">(.*?)<\/td>/)![1];
    expect(cell).not.toContain('$');
    expect(cell).toContain('Jordan Sample');
    expect(cell).toContain('none entered');
  });
  it('the person statements list the same lines in the same order for both people, with blanks where a person has no item', () => {
    const draw = (p: Person, s: typeof AVERY_S) => html(createElement(PersonStatementView, { person: p, year: 2026, schema: SET.schema, statement: s }));
    const shape = (markup: string) => [...markup.matchAll(/data-col="([^"]+)" data-state="([^"]+)"/g)].map((x) => x[1]);
    const a = draw(AVERY, AVERY_S);
    const j = draw(JORDAN, JORDAN_S);
    const s = draw(SKYLER, SKYLER_S);
    expect(shape(a)).toEqual(shape(j));
    expect(shape(a)).toEqual(shape(s));
    expect(shape(a)).toEqual(['wages', 'bonus', 'rsu', 'gross', 'ded.k401Pretax', 'ded.k401Roth', 'ded.hsa', 'ded.fsa', 'ded.insurance', 'ded.espp', 'ded.other', 'deductions', 'tax.fed', 'tax.state', 'tax.ss', 'tax.medicare', 'tax.addlMedicare', 'tax.pfml', 'taxes', 'net', 'kept', 'er.k401', 'er.hsa']);
    // identical visible labels in identical order
    const labels = (markup: string) => [...markup.matchAll(/<dt>([^<]*)/g)].map((x) => x[1]);
    expect(labels(a)).toEqual(labels(j));
    expect(labels(a)).toEqual(labels(s));
    // only Avery has an HSA deduction and employer match; only Jordan has ESPP, Roth, insurance and kept shares
    const stateOf = (markup: string, id: string) => markup.match(new RegExp(`data-col="${id}" data-state="([a-z]+)"`))![1];
    expect([stateOf(a, 'ded.hsa'), stateOf(j, 'ded.hsa')]).toEqual(['value', 'blank']);
    expect([stateOf(a, 'ded.espp'), stateOf(j, 'ded.espp')]).toEqual(['blank', 'value']);
    expect([stateOf(a, 'ded.k401Pretax'), stateOf(j, 'ded.k401Pretax')]).toEqual(['value', 'blank']);
    expect([stateOf(a, 'ded.k401Roth'), stateOf(j, 'ded.k401Roth')]).toEqual(['blank', 'value']);
    expect([stateOf(a, 'ded.insurance'), stateOf(j, 'ded.insurance')]).toEqual(['blank', 'value']);
    expect([stateOf(a, 'er.k401'), stateOf(j, 'er.k401')]).toEqual(['value', 'blank']);
  });
  it('the statement reads left to right: income sources, gross, deductions, taxes withheld, cash take-home, then employer contributions', () => {
    const j = html(createElement(PersonStatementView, { person: JORDAN, year: 2026, schema: SET.schema, statement: JORDAN_S }));
    const at = (t: string) => j.indexOf(t);
    const heads = ['Income sources', 'Gross compensation', 'Employee deductions', 'Taxes withheld', 'Cash take-home', 'Employer contributions'].map((h) => at(`>${h}</h4>`));
    expect(heads.every((i) => i > 0)).toBe(true);
    expect([...heads].sort((x, y) => x - y)).toEqual(heads);
    expect(j).toContain('Equity kept as shares');
    expect(j).toContain('Not the same as the tax you will owe for the year');
    expect(j).toContain('do not reduce your take-home');
  });
  it('the summary is read-only: no inputs, buttons or save controls', () => {
    const j = html(createElement(PersonStatementView, { person: JORDAN, year: 2026, schema: SET.schema, statement: JORDAN_S }));
    expect(j).not.toMatch(/<(input|button|select|textarea)\b/);
  });
});

describe('D18.2 blank, zero and unavailable are different things', () => {
  it('an absent item is blank (not $0); a genuinely calculated zero is a value', () => {
    expect(JORDAN_S.cells.bonus).toEqual({ state: 'blank' });
    expect(AVERY_S.cells.rsu).toEqual({ state: 'blank' });
    // nobody here earns enough for Additional Medicare: the model calculated zero, which is shown as a real $0.00
    expect(AVERY_S.cells['tax.addlMedicare']).toEqual({ state: 'value', cents: 0 });
    const a = html(createElement(PersonStatementView, { person: AVERY, year: 2026, schema: SET.schema, statement: AVERY_S }));
    expect(a.match(/data-col="tax.addlMedicare" data-state="value"[^]*?<\/dd>/)![0]).toContain('$0.00');
    expect(a.match(/data-col="rsu" data-state="blank"[^]*?<\/dd>/)![0]).not.toContain('$');
  });
  it('a capped or zero-valued deduction the person does have still shows $0.00, while a deduction they do not have stays blank', () => {
    const zero: IncomeProfile = { ...jordanProfile(), deductions: [ded('hsa', 'fixed', 0)] };
    const m = buildIncomeModel(2026, [JORDAN], [zero], [], undefined, undefined);
    const s = buildHouseholdStatements(2026, [JORDAN], [zero], m.years, true).statements[0];
    expect(s.cells['ded.hsa']).toEqual({ state: 'value', cents: 0 });
    expect(s.cells['ded.espp']).toEqual({ state: 'blank' });
  });
  it('a person with no income setup is told so, with the layout intact and no zeros', () => {
    expect(SKYLER_S.status).toBe('not-set-up');
    expect(Object.values(SKYLER_S.cells).every((c) => c.state === 'unavailable')).toBe(true);
    const out = html(createElement(PersonStatementView, { person: SKYLER, year: 2026, schema: SET.schema, statement: SKYLER_S }));
    expect(out).toContain('Not set up for 2026');
    expect(out).not.toContain('$0');
    expect(out).not.toMatch(/\$\d/);
    expect(out).toContain('not calculated');
  });
  it('missing tax tables say "not calculated" with the reason, and are not treated as zero', () => {
    const m = buildIncomeModel(2099, PEOPLE, [averyProfile(2099)], [], undefined, undefined);
    expect(m.tables).toBeNull();
    const set = buildHouseholdStatements(2099, [AVERY], [averyProfile(2099)], m.years, !!m.tables);
    expect(set.statements[0].status).toBe('not-calculated');
    expect(set.statements[0].reason).toBe('No 2099 tax tables, so no estimate');
    const comp = html(createElement(HouseholdComparison, { year: 2099, people: [AVERY], schema: set.schema, statements: set.statements }));
    expect(comp).toContain('Not calculated');
    expect(comp).not.toMatch(/\$\d/);
  });
});

describe('D18.2 amounts: worked out by hand, then compared with what the statement shows', () => {
  it('Avery: wages, bonus, gross and deductions', () => {
    const wages = 24 * (15000000 / 24); // semimonthly: 24 equal paychecks
    expect(cents(AVERY_S, 'wages')).toBe(wages);
    expect(cents(AVERY_S, 'bonus')).toBe(1200000);
    expect(cents(AVERY_S, 'gross')).toBe(wages + 1200000);
    expect(cents(AVERY_S, 'ded.k401Pretax')).toBe(24 * 62500); // 10% of each regular paycheck, not of the bonus
    expect(cents(AVERY_S, 'ded.hsa')).toBe(24 * 12500);
    expect(cents(AVERY_S, 'deductions')).toBe(24 * 62500 + 24 * 12500);
    expect(AVERY_S.cells.rsu.state).toBe('blank');
  });
  it('Jordan: wages, stock awards, deductions and Social Security', () => {
    const paycheck = Math.round(10000000 / 24);
    const wages = 24 * paycheck;
    expect(cents(JORDAN_S, 'wages')).toBe(wages);
    expect(cents(JORDAN_S, 'bonus')).toBeNull();
    expect(cents(JORDAN_S, 'rsu')).toBe(10 * 60000 + 40 * 5000);
    expect(cents(JORDAN_S, 'gross')).toBe(wages + 800000);
    expect(cents(JORDAN_S, 'ded.k401Roth')).toBe(24 * Math.round(paycheck * 0.05));
    expect(cents(JORDAN_S, 'ded.espp')).toBe(24 * Math.round(paycheck * 0.03));
    expect(cents(JORDAN_S, 'ded.insurance')).toBe(24 * 20000);
    // Social Security: 6.2% of pay after the health premium (exempt from FICA); stock awards carry no deductions; well under the wage base
    const ssRegular = 24 * Math.round((paycheck - 20000) * 0.062);
    expect(cents(JORDAN_S, 'tax.ss')).toBe(ssRegular + Math.round(600000 * 0.062) + Math.round(200000 * 0.062));
  });
  it('the statement shows exactly the model\'s own figures (cash, withholding, deductions) and never recomputes them', () => {
    for (const [s, id] of [[AVERY_S, 11], [JORDAN_S, 22]] as const) {
      const t = pyOf(id).totals;
      expect(cents(s, 'net')).toBe(t.net);
      expect(cents(s, 'gross')).toBe(t.gross);
      expect(cents(s, 'tax.fed')).toBe(t.fedWithholding);
      expect(cents(s, 'tax.state')).toBe(t.stateWithholding);
      expect(cents(s, 'tax.ss')).toBe(t.socialSecurity);
      expect(cents(s, 'tax.medicare')).toBe(t.medicare);
      expect(cents(s, 'tax.addlMedicare')).toBe(t.addlMedicare);
      expect(cents(s, 'tax.pfml')).toBe(t.pfml);
      expect(cents(s, 'deductions')).toBe(Object.values(t.deductions).reduce((a, b) => a + b, 0));
    }
  });
  it('bonuses and stock awards are not counted twice: wages + bonuses + stock awards is the model\'s gross', () => {
    for (const [s, id] of [[AVERY_S, 11], [JORDAN_S, 22]] as const) {
      expect((cents(s, 'wages') ?? 0) + (cents(s, 'bonus') ?? 0) + (cents(s, 'rsu') ?? 0)).toBe(pyOf(id).totals.gross);
    }
  });
  it('Jordan\'s held shares are shown apart from cash and are not part of cash take-home', () => {
    const held = pyOf(22).events.find((e) => e.kind === 'rsu' && e.keptValue !== undefined)!;
    expect(held.net).toBe(0);
    expect(cents(JORDAN_S, 'kept')).toBe(held.keptValue);
    expect(held.keptValue).toBeGreaterThan(0);
    // 200,000 of gross, less the taxes on that vest (all of them, no deductions on a vest), is what stays as shares
    expect(held.keptValue).toBe(200000 - held.fedWithholding - held.stateWithholding - held.socialSecurity - held.medicare - held.addlMedicare - held.pfml);
    const cashVest = pyOf(22).events.find((e) => e.kind === 'rsu' && e.keptValue === undefined)!;
    expect(cashVest.net).toBeGreaterThan(0);
    expect(cents(JORDAN_S, 'net')).toBe(pyOf(22).events.reduce((a, e) => a + e.net, 0));
    expect(AVERY_S.cells.kept.state).toBe('blank');
  });
});

describe('D18.2 reconciliation', () => {
  it('gross minus deductions minus taxes withheld equals cash plus equity kept as shares, with nothing left over', () => {
    for (const s of [AVERY_S, JORDAN_S]) {
      expect(s.reconciliation.difference).toBe(0);
      expect((cents(s, 'gross') ?? 0) - (cents(s, 'deductions') ?? 0) - (cents(s, 'taxes') ?? 0)).toBe((cents(s, 'net') ?? 0) + (cents(s, 'kept') ?? 0));
      expect(s.reconciliation.deductionPlacementGap).toBe(0);
      expect(s.reconciliation.otherEarnings).toBe(0);
    }
  });
  it('the sum of the deduction category lines equals the deduction total, and the tax lines equal the taxes total', () => {
    for (const s of [AVERY_S, JORDAN_S]) {
      const ded = (['ded.k401Pretax', 'ded.k401Roth', 'ded.hsa', 'ded.fsa', 'ded.insurance', 'ded.espp', 'ded.other'] as ColumnId[]).reduce((a, id) => a + (cents(s, id) ?? 0), 0);
      const tax = (['tax.fed', 'tax.state', 'tax.ss', 'tax.medicare', 'tax.addlMedicare', 'tax.pfml'] as ColumnId[]).reduce((a, id) => a + (cents(s, id) ?? 0), 0);
      expect(ded).toBe(cents(s, 'deductions'));
      expect(tax).toBe(cents(s, 'taxes'));
    }
  });
  it('a difference is reported plainly and never balanced away', () => {
    const tampered: PersonYear = { ...pyOf(22), totals: { ...pyOf(22).totals, net: pyOf(22).totals.net + 5000 } };
    const set = buildHouseholdStatements(2026, [JORDAN], [jordanProfile()], [tampered], true);
    expect(set.statements[0].reconciliation.difference).toBe(-5000);
    expect(cents(set.statements[0], 'net')).toBe(tampered.totals.net); // the model's number stays as the shown cash
    const out = html(createElement(PersonStatementView, { person: JORDAN, year: 2026, schema: set.schema, statement: set.statements[0] }));
    expect(out).toContain('nothing was adjusted to make it add up');
    expect(out).toContain('$50.00');
  });
  it('a paycheck where deductions and taxes exceed pay is called out, using the model\'s own negative cash', () => {
    const ev = pyOf(22).events[0];
    const negative = { ...pyOf(22), events: [{ ...ev, net: -100 }, ...pyOf(22).events.slice(1)] };
    const set = buildHouseholdStatements(2026, [JORDAN], [jordanProfile()], [negative], true);
    expect(set.statements[0].reconciliation.negativePaychecks).toBe(1);
    expect(html(createElement(PersonStatementView, { person: JORDAN, year: 2026, schema: set.schema, statement: set.statements[0] }))).toContain('One paycheck has');
  });
});

describe('D18.2 employer contributions stay separate', () => {
  it('the employer match is shown on its own and changes neither gross nor take-home', () => {
    const noMatch: IncomeProfile = { ...averyProfile(), match: null };
    const m2 = buildIncomeModel(2026, [AVERY], [noMatch], BONUSES, undefined, undefined);
    const s2 = buildHouseholdStatements(2026, [AVERY], [noMatch], m2.years, true).statements[0];
    expect(AVERY_S.cells['er.k401']).toMatchObject({ state: 'value' });
    expect(cents(AVERY_S, 'er.k401')).toBe(pyOf(11).totals.employerMatch);
    expect(cents(AVERY_S, 'er.k401')!).toBeGreaterThan(0);
    expect(s2.cells['er.k401'].state).toBe('blank');
    expect(cents(AVERY_S, 'gross')).toBe(cents(s2, 'gross'));
    expect(cents(AVERY_S, 'net')).toBe(cents(s2, 'net'));
    expect(cents(AVERY_S, 'deductions')).toBe(cents(s2, 'deductions'));
  });
  it('an employer HSA contribution is shown only when set, and is not a deduction', () => {
    const withEr: IncomeProfile = { ...averyProfile(), employerHsaAnnualCents: 100000 };
    const m = buildIncomeModel(2026, [AVERY], [withEr], BONUSES, undefined, undefined);
    const s = buildHouseholdStatements(2026, [AVERY], [withEr], m.years, true).statements[0];
    expect(cents(s, 'er.hsa')).toBe(100000);
    expect(AVERY_S.cells['er.hsa'].state).toBe('blank');
    expect(cents(s, 'deductions')).toBe(cents(AVERY_S, 'deductions'));
  });
});

describe('D18.2 household comparison row totals', () => {
  it('sums only the people who have the item, and stays blank when nobody does', () => {
    expect(householdCell(SET.statements, 'bonus')).toEqual({ state: 'value', cents: 1200000 });
    expect(householdCell(SET.statements, 'gross')).toEqual({ state: 'value', cents: (cents(AVERY_S, 'gross') ?? 0) + (cents(JORDAN_S, 'gross') ?? 0) });
    expect(householdCell([AVERY_S, SKYLER_S], 'rsu')).toEqual({ state: 'blank' });
    expect(householdCell([SKYLER_S], 'gross')).toEqual({ state: 'unavailable' });
  });
  it('the year in view is stated, and the person list is not matched by name', () => {
    const comp = html(createElement(HouseholdComparison, { year: 2027, people: PEOPLE, schema: SET.schema, statements: SET.statements }));
    expect(comp).toContain('Compare people, 2027');
    const twins = [{ id: 1, name: 'Sam' }, { id: 2, name: 'Sam' }];
    const prof = [{ ...jordanProfile(), personId: 2 }];
    const m = buildIncomeModel(2026, twins, prof, [], undefined, undefined);
    const set = buildHouseholdStatements(2026, twins, prof, m.years, true);
    expect(set.statements.map((s) => s.status)).toEqual(['not-set-up', 'ready']);
  });
});

describe('D18.2 changing the tax year', () => {
  it('uses that year\'s own model and keeps the same layout', () => {
    const p27: IncomeProfile = { ...averyProfile(2027), salary: [{ effectiveDate: '2027-01-01', annualCents: 18000000 }] };
    const m27 = buildIncomeModel(2027, PEOPLE, [p27], [], undefined, undefined);
    expect(m27.tables?.year).toBe(2027);
    const set = buildHouseholdStatements(2027, PEOPLE, [p27], m27.years, true);
    expect(set.schema.columns.map((c) => c.id)).toEqual(EXPECTED_ORDER);
    expect(cents(set.statements[0], 'wages')).toBe(18000000);
    expect(cents(set.statements[0], 'net')).toBe(m27.years[0].totals.net);
    expect(set.statements[1].status).toBe('not-set-up');
    expect(set.statements[0].cells.bonus.state).toBe('blank');
  });
});

describe('D18.2 presentation only', () => {
  const model = read('src/pages/incomeStatementModel.ts');
  const view = read('src/pages/IncomeStatement.tsx');
  it('the new files never touch the database or write anything', () => {
    for (const src of [model, view]) {
      expect(src).not.toMatch(/from '\.\.\/db'/);
      expect(src).not.toMatch(/\bdb\./);
      expect(src).not.toMatch(/\.(put|add|bulkAdd|bulkPut|delete|update)\(/);
      expect(src).not.toMatch(/localStorage|sessionStorage/);
    }
  });
  it('they use the income model\'s results and do not run a payroll or tax calculation of their own', () => {
    expect(model).not.toMatch(/simulatePerson|householdTax|bracketTax|buildIncomeModel/);
    expect(model).toContain("import type { PersonYear } from '../lib/payroll'");
    expect(view).not.toMatch(/style=\{/);
  });
  it('Income draws the comparison under the hero and the statement inside each person workspace, and the old at-a-glance block is gone', () => {
    const page = read('src/pages/IncomePage.tsx');
    expect(page).toContain('<HouseholdComparison');
    expect(page).toContain('<PersonStatementView');
    expect(page.indexOf('<PlanHero')).toBeLessThan(page.indexOf('<HouseholdComparison'));
    expect(page.indexOf('<HouseholdComparison')).toBeLessThan(page.indexOf('<PlanJump'));
    expect(page).not.toContain('at a glance');
    // the existing editors are still there
    for (const piece of ['<ProfileEditor', '<PersonBonuses', '<RsuSection', '<PersonPaycheckDetail', 'Household tax settings']) expect(page).toContain(piece);
  });
});
