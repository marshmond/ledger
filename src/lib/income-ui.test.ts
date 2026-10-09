import { describe, expect, it } from 'vitest';
import { COLLAPSE_KEY, parseCollapsed, readCollapsed, writeCollapsed } from '../pages/Collapsible';
import { esppOn, hsaOn, newDeduction, newProfile, payDaysOf, rollForward } from './income';

const fakeStorage = (initial: Record<string, string> = {}) => {
  const m = new Map(Object.entries(initial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), dump: () => Object.fromEntries(m) };
};

describe('collapsible state', () => {
  it('open is the default and remembers nothing; collapsed sections are remembered', () => {
    const s = fakeStorage();
    expect(readCollapsed('income.people', s)).toBeUndefined();
    writeCollapsed('income.people', true, s);
    expect(readCollapsed('income.people', s)).toBe(true);
    writeCollapsed('income.bonuses', true, s);
    writeCollapsed('income.people', false, s); // re-opened: forgotten again
    expect(JSON.parse(s.dump()[COLLAPSE_KEY])).toEqual({ 'income.bonuses': true });
  });

  it('tolerates junk in storage', () => {
    for (const raw of ['{nope', '[]', '"str"', '5', 'null', '{"a":1,"b":true}']) {
      expect(() => parseCollapsed(raw)).not.toThrow();
    }
    expect(parseCollapsed('{"a":1,"b":true}')).toEqual({ b: true });
    expect(parseCollapsed(null)).toEqual({});
  });

  it('keeps working when storage is blocked', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readCollapsed('x', broken)).toBeUndefined();
    expect(() => writeCollapsed('x', true, broken)).not.toThrow();
  });
});

describe('benefit switches (ESPP / HSA appear only when on)', () => {
  const base = () => newProfile(1, 2026);

  it('new profiles have neither switched on', () => {
    expect(esppOn(base())).toBe(false);
    expect(hsaOn(base())).toBe(false);
  });

  it('existing data with an ESPP or HSA deduction (or employer HSA money) shows the controls automatically', () => {
    expect(esppOn({ ...base(), deductions: [newDeduction('espp')] })).toBe(true);
    expect(hsaOn({ ...base(), deductions: [newDeduction('hsa')] })).toBe(true);
    expect(hsaOn({ ...base(), employerHsaAnnualCents: 100000 })).toBe(true);
  });

  it('an explicit switch wins over what the deductions imply', () => {
    expect(esppOn({ ...base(), esppEnrolled: false, deductions: [newDeduction('espp')] })).toBe(false);
    expect(esppOn({ ...base(), esppEnrolled: true })).toBe(true);
    expect(hsaOn({ ...base(), hasHsa: true })).toBe(true);
  });

  it('copying to a new year carries the switches, match setup, and pay days forward', () => {
    const p = { ...base(), esppEnrolled: true, hasHsa: true, payDays: [15, 'lastBusiness'] as ('lastBusiness' | number)[], weekendAdjust: true,
      match: { formula: 'flat' as const, flatPctOfPay: 10, annualCapCents: 500000, ratePct: 50, upToPctOfPay: 6, trueUp: false, appliesToBonus: false } };
    const n = rollForward(p, 2027);
    expect(n).toMatchObject({ year: 2027, esppEnrolled: true, hasHsa: true, weekendAdjust: true, payDays: [15, 'lastBusiness'] });
    expect(n.match).toMatchObject({ formula: 'flat', flatPctOfPay: 10, annualCapCents: 500000 });
  });
});

describe('pay days shown in the editor', () => {
  it('twice a month: saved choices, else what older profiles implied', () => {
    expect(payDaysOf({ frequency: 'semimonthly', payDays: [15, 'lastBusiness'], firstPayDate: '2026-01-15' })).toEqual([15, 'lastBusiness']);
    expect(payDaysOf({ frequency: 'semimonthly', semiDays: [5, 20], firstPayDate: '2026-01-15' })).toEqual([5, 20]);
    expect(payDaysOf({ frequency: 'semimonthly', firstPayDate: '2026-01-15' })).toEqual([1, 15]);
  });

  it('monthly takes the day of the old anchor date; switching frequency pads or trims to the right count', () => {
    expect(payDaysOf({ frequency: 'monthly', firstPayDate: '2026-03-20' })).toEqual([20]);
    expect(payDaysOf({ frequency: 'monthly', payDays: [15, 31], firstPayDate: '2026-03-20' })).toEqual([15]);
    expect(payDaysOf({ frequency: 'semimonthly', payDays: [20], firstPayDate: '2026-03-20' })).toEqual([20, 15]);
    expect(payDaysOf({ frequency: 'weekly', firstPayDate: '2026-03-20' })).toEqual([]);
  });
});
