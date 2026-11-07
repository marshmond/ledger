import { describe, expect, it } from 'vitest';
import { generateDates } from '../../core/recurrence';
import {
  canonicalSemi, describeSemi, readSemi, semiDates, semiNext, semiProblem, slotDate, type Semimonthly, type Slot,
} from './semimonthly';
import { blankArrangement, cadenceBetween, cadenceText, isCadenceDate, nextCadenceDate, normalizeArrangement, validateArrangement, asArrangement, type Cadence } from './model';
import { cadenceSignature, nearestCadenceDate, taskRepeatOf } from './schedule';

/** Invented, pure checks. The expected dates are worked out here WITHOUT the code under test (integer day counts, no Date, no time zone). */
const dim = (y: number, m: number) => [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
/** days since 1970-01-01 (civil-from-days algorithm), so the weekday never goes through Date */
const dn = (iso: string) => {
  let [y, m, d] = iso.split('-').map(Number);
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400), yoe = y - era * 400, doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719468;
};
const dow = (iso: string) => (((dn(iso) + 4) % 7) + 7) % 7; // 0 = Sunday
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const lastBiz = (y: number, m: number) => { let d = dim(y, m); while (dow(iso(y, m, d)) === 0 || dow(iso(y, m, d)) === 6) d--; return iso(y, m, d); };

const day = (d: number, adjust: Slot['adjust'] = 'none'): Slot => ({ kind: 'day', day: d, adjust });
const LAST: Slot = { kind: 'lastDay' };
const LASTBIZ: Slot = { kind: 'lastBusinessDay' };
const semi = (a: Slot, b: Slot): Semimonthly => ({ a, b });
const cad = (s: Semimonthly, anchor: string, until?: string): Cadence => ({ mode: 'fixed', rule: { freq: 'monthly', interval: 1, monthly: 'date', end: until ? { type: 'until', date: until } : { type: 'never' } }, anchorDate: anchor, semi: s });
const year = (s: Semimonthly, y: number) => semiDates(s, `${y}-01-01`, `${y}-01-01`, `${y}-12-31`);

describe('twice monthly: whole-year calendars', () => {
  it('1st and 15th for a full year: 24 dates, two in every month', () => {
    const want = Array.from({ length: 12 }, (_, i) => [iso(2026, i + 1, 1), iso(2026, i + 1, 15)]).flat();
    expect(year(semi(day(1), day(15)), 2026)).toEqual(want);
  });
  it('15th and the last business day for a full year (checked against independent weekday arithmetic)', () => {
    const want = Array.from({ length: 12 }, (_, i) => [iso(2026, i + 1, 15), lastBiz(2026, i + 1)]).flat();
    const got = year(semi(day(15), LASTBIZ), 2026);
    expect(got).toEqual(want);
    // spot checks a person can verify on a wall calendar: 31 Jan 2026 is a Saturday, 28 Feb a Saturday, 31 May a Sunday
    expect(got).toContain('2026-01-30'); expect(got).toContain('2026-02-27'); expect(got).toContain('2026-05-29');
    expect(got).toContain('2026-03-31');
    for (const d of got) if (Number(d.slice(8)) !== 15) { expect(dow(d)).toBeGreaterThanOrEqual(1); expect(dow(d)).toBeLessThanOrEqual(5); }
  });
  it('15th and the last calendar day, in every year of a 30-year span, matches the real month lengths', () => {
    for (let y = 2020; y <= 2050; y++) {
      const got = year(semi(day(15), LAST), y);
      expect(got).toEqual(Array.from({ length: 12 }, (_, i) => [iso(y, i + 1, 15), iso(y, i + 1, dim(y, i + 1))]).flat());
    }
  });
  it('10th and 25th, with the last-business-day pairing, for a full year each', () => {
    expect(year(semi(day(10), day(25)), 2027)).toHaveLength(24);
    expect(year(semi(day(10), LASTBIZ), 2027)).toHaveLength(24);
  });
  it('February: the last calendar day follows leap years; a 30th or 31st means the month\'s last day', () => {
    expect(year(semi(day(15), LAST), 2024)).toContain('2024-02-29');
    expect(year(semi(day(15), LAST), 2025)).toContain('2025-02-28');
    expect(year(semi(day(15), LAST), 2100)).toContain('2100-02-28'); // 2100 is not a leap year
    expect(year(semi(day(15), day(31)), 2025).filter((d) => d.startsWith('2025-04'))).toEqual(['2025-04-15', '2025-04-30']);
    expect(year(semi(day(1), day(30)), 2026).filter((d) => d.startsWith('2026-02'))).toEqual(['2026-02-01', '2026-02-28']);
    expect(year(semi(day(1), day(30)), 2028).filter((d) => d.startsWith('2028-02'))).toEqual(['2028-02-01', '2028-02-29']);
  });
  it('months that end on a Saturday or Sunday: the last business day is the Friday before', () => {
    expect(slotDate(LASTBIZ, '2026-01')).toBe('2026-01-30'); // 31 Jan 2026 = Saturday
    expect(slotDate(LASTBIZ, '2026-05')).toBe('2026-05-29'); // 31 May 2026 = Sunday
    expect(slotDate(LASTBIZ, '2026-03')).toBe('2026-03-31'); // Tuesday
    expect(slotDate(LASTBIZ, '2025-11')).toBe('2025-11-28'); // 30 Nov 2025 = Sunday
  });
  it('a fixed date stays a fixed calendar date unless an adjustment is chosen', () => {
    expect(slotDate(day(14), '2026-11')).toBe('2026-11-14'); // a Saturday, left alone
    expect(slotDate(day(14, 'previous'), '2026-11')).toBe('2026-11-13');
    expect(slotDate(day(14, 'next'), '2026-11')).toBe('2026-11-16');
    expect(slotDate(day(15, 'next'), '2026-11')).toBe('2026-11-16'); // a Sunday
    expect(slotDate(day(11, 'previous'), '2026-11')).toBe('2026-11-11'); // a Wednesday: unchanged
  });
  it('gives the same dates whatever the day it is asked on (only the range matters), in any order of asking', () => {
    const s = semi(day(15), LASTBIZ);
    const a = semiDates(s, '2026-01-15', '2026-01-15', '2026-12-31');
    const b = [...semiDates(s, '2026-01-15', '2026-07-01', '2026-12-31'), ...semiDates(s, '2026-01-15', '2026-01-01', '2026-06-30')].sort();
    expect(b).toEqual(a);
    expect(semiDates(s, '2026-01-15', '2026-03-01', '2026-03-31')).toEqual(['2026-03-15', '2026-03-31']);
  });
  it('nothing before the first date and nothing after the end date', () => {
    const s = semi(day(1), day(15));
    expect(semiDates(s, '2026-03-15', '2026-01-01', '2026-04-30')).toEqual(['2026-03-15', '2026-04-01', '2026-04-15']);
    expect(semiDates(s, '2026-01-01', '2026-01-01', '2026-12-31', '2026-02-15')).toEqual(['2026-01-01', '2026-01-15', '2026-02-01', '2026-02-15']);
    expect(semiNext(s, '2026-01-01', '2026-02-16', '2026-02-15')).toBeNull();
    expect(semiNext(s, '2026-01-01', '2026-02-02')).toBe('2026-02-15');
    expect(semiNext(s, '2026-05-01', '2026-01-01')).toBe('2026-05-01');
  });
});

describe('twice monthly: rules that are refused when saved', () => {
  it('two days that can collide are refused with an example', () => {
    expect(semiProblem(semi(day(30), LAST))).toMatch(/same date/);
    expect(semiProblem(semi(day(28), LAST))).toMatch(/same date/); // 28 Feb in a non-leap year
    expect(semiProblem(semi(day(31), LAST))).toMatch(/same date/);
    expect(semiProblem(semi(day(15), day(15)))).toMatch(/same date/);
    expect(semiProblem(semi(LASTBIZ, LAST))).toMatch(/same date/); // a month that ends on a weekday
    expect(semiProblem(semi(day(30), day(31)))).toMatch(/same date/); // 30 April
  });
  it('an adjustment that collides with the other day is refused', () => {
    expect(semiProblem(semi(day(15, 'next'), day(16, 'next')))).toMatch(/same date/);
    expect(semiProblem(semi(day(14, 'previous'), day(13, 'previous')))).toMatch(/same date/);
  });
  it('an adjustment that would leave its own month is refused, and says which way to go', () => {
    const p1 = semiProblem(semi(day(1, 'previous'), day(15)));
    expect(p1).toMatch(/outside its own month/);
    expect(p1).toMatch(/business day after/);
    const p2 = semiProblem(semi(day(15), day(31, 'next')));
    expect(p2).toMatch(/outside its own month/);
    expect(p2).toMatch(/business day before/);
  });
  it('the safe versions are accepted: 1st next, 31st previous, and the pairs people actually use', () => {
    expect(semiProblem(semi(day(1, 'next'), day(15)))).toBeNull();
    expect(semiProblem(semi(day(15), day(31, 'previous')))).toBeNull();
    expect(semiProblem(semi(day(1), day(15)))).toBeNull();
    expect(semiProblem(semi(day(10), day(25)))).toBeNull();
    expect(semiProblem(semi(day(15), LAST))).toBeNull();
    expect(semiProblem(semi(day(15), LASTBIZ))).toBeNull();
    expect(semiProblem(semi(day(1), LAST))).toBeNull();
  });
  it('every accepted rule really gives two different dates inside every month for 130 years (the property the check promises)', () => {
    const rules = [semi(day(1), day(15)), semi(day(15), LASTBIZ), semi(day(10, 'next'), day(25, 'previous')), semi(day(1, 'next'), LAST)];
    for (const r of rules) {
      expect(semiProblem(r)).toBeNull();
      for (let y = 2000; y <= 2130; y++) for (let m = 1; m <= 12; m++) {
        const month = `${y}-${pad(m)}`;
        const a = slotDate(r.a, month), b = slotDate(r.b, month);
        expect(a).not.toBe(b);
        expect(a.slice(0, 7)).toBe(month); expect(b.slice(0, 7)).toBe(month);
      }
    }
  });
  it('reading is defensive: junk is not a rule, slots come out in a fixed order', () => {
    expect(readSemi(null)).toBeNull();
    expect(readSemi({ a: { kind: 'day', day: 40 }, b: { kind: 'lastDay' } })).toBeNull();
    expect(readSemi({ a: { kind: 'day', day: 15 } })).toBeNull();
    expect(readSemi({ a: { kind: 'sometimes' }, b: { kind: 'lastDay' } })).toBeNull();
    expect(readSemi({ a: LAST, b: day(15) })).toEqual({ a: { kind: 'day', day: 15, adjust: 'none' }, b: { kind: 'lastDay' } });
    expect(canonicalSemi(semi(LAST, LASTBIZ))).toEqual(semi(LASTBIZ, LAST));
  });
  it('describes itself in plain words', () => {
    expect(describeSemi(semi(day(15), LASTBIZ))).toBe('Twice monthly: the 15th and the last business day of the month.');
    expect(describeSemi(semi(day(1), day(15)))).toBe('Twice monthly: the 1st and the 15th.');
    expect(describeSemi(semi(day(2, 'next'), day(22)))).toMatch(/2nd \(the business day after, if a weekend\) and the 22nd/);
  });
});

describe('twice monthly inside the arrangement model', () => {
  const c = cad(semi(day(15), LASTBIZ), '2026-11-15');
  it('is a valid fixed cadence; its text names both days; it is not "every 14 days"', () => {
    const d = blankArrangement({ title: 'Pool service', cadence: c });
    expect(validateArrangement(normalizeArrangement(d))).toBeNull();
    expect(cadenceText(c)).toBe('Twice monthly: the 15th and the last business day of the month');
    const gaps = cadenceBetween(c, '2026-11-15', '2027-02-28').map((x, i, a) => (i ? dn(x) - dn(a[i - 1]) : 0)).slice(1);
    expect(new Set(gaps).size).toBeGreaterThan(1); // the gap changes from month to month
  });
  it('the first date must be one of the schedule\'s own dates', () => {
    const bad = blankArrangement({ title: 'x', cadence: { ...c, anchorDate: '2026-11-16' } });
    expect(validateArrangement(normalizeArrangement(bad))).toMatch(/first date/i);
  });
  it('refuses a colliding rule, a repeat-after mode, and an unreadable rule', () => {
    expect(validateArrangement(normalizeArrangement(blankArrangement({ title: 'x', cadence: cad(semi(day(30), LAST), '2026-11-30') })))).toMatch(/same date/);
    expect(validateArrangement(normalizeArrangement(blankArrangement({ title: 'x', cadence: { ...c, mode: 'after' } })))).toBeNull(); // normalised to fixed when read
    const junk = { ...c, semi: { a: { kind: 'day', day: 99 }, b: LAST } as unknown as Semimonthly };
    expect(validateArrangement(blankArrangement({ title: 'x', cadence: junk }))).toMatch(/not valid/);
  });
  it('an end date is honoured', () => {
    const e = cad(semi(day(1), day(15)), '2026-11-01', '2026-12-15');
    expect(cadenceBetween(e, '2026-11-01', '2027-06-01')).toEqual(['2026-11-01', '2026-11-15', '2026-12-01', '2026-12-15']);
    expect(nextCadenceDate(e, '2026-12-16')).toBeNull();
  });
  it('isCadenceDate, nextCadenceDate and nearestCadenceDate agree with the dates', () => {
    expect(isCadenceDate(c, '2026-11-30')).toBe(true);
    expect(isCadenceDate(c, '2026-11-29')).toBe(false);
    expect(nextCadenceDate(c, '2026-11-16')).toBe('2026-11-30');
    expect(nextCadenceDate(c, '2026-11-30')).toBe('2026-11-30');
    expect(nearestCadenceDate(c, '2026-11-20')).toBe('2026-11-15'); // 5 days from the 15th, 10 from the 30th
    expect(nearestCadenceDate(c, '2026-11-27')).toBe('2026-11-30');
  });
  it('its Task has NO repeat, and agrees with the arrangement about that', () => {
    expect(taskRepeatOf(c)).toBeNull();
    expect(cadenceSignature(c)).toBe('none');
  });
  it('an older arrangement with no twice-monthly field reads exactly as before', () => {
    const old: Cadence = { mode: 'fixed', rule: { freq: 'monthly', interval: 1, monthly: 'date', end: { type: 'never' } }, anchorDate: '2026-11-15' };
    const a = asArrangement({ id: 1, module: 'services', kind: 'arrangement', createdAt: 1, updatedAt: 1, data: { title: 'Gutters', cadence: old } } as never);
    expect(a.data.cadence?.semi).toBeUndefined();
    expect(cadenceText(a.data.cadence)).toBe('Every month on day 15');
    expect(cadenceBetween(a.data.cadence!, '2026-11-01', '2027-01-31')).toEqual(generateDates('2026-11-15', old.rule, '2026-11-01', '2027-01-31'));
    expect(taskRepeatOf(a.data.cadence!)).not.toBeNull();
  });
  it('a stored but unreadable twice-monthly rule is never read as an ordinary monthly schedule', () => {
    const a = asArrangement({ id: 1, module: 'services', kind: 'arrangement', createdAt: 1, updatedAt: 1, data: { title: 'x', cadence: { ...c, semi: { a: 3 } } } } as never);
    expect(a.data.cadence).toBeNull();
  });
  it('a twice-monthly cadence survives being read and written (the stored form is the same)', () => {
    const a = asArrangement({ id: 1, module: 'services', kind: 'arrangement', createdAt: 1, updatedAt: 1, data: { title: 'x', cadence: c, futureField: 7 } } as never);
    expect(a.data.cadence).toEqual(c);
    expect((a.data as unknown as Record<string, unknown>).futureField).toBe(7);
  });
});

describe('biweekly (every 2 weeks) uses the existing weekly rule', () => {
  const bw = (anchor: string): Cadence => ({ mode: 'fixed', rule: { freq: 'weekly', interval: 2, byWeekday: [5], end: { type: 'never' } }, anchorDate: anchor });
  it('every other Friday is exactly 14 days apart, over a full year, whatever the month', () => {
    const got = cadenceBetween(bw('2026-01-02'), '2026-01-01', '2026-12-31');
    expect(got).toHaveLength(26);
    got.forEach((d, i) => { expect(dow(d)).toBe(5); if (i) expect(dn(d) - dn(got[i - 1])).toBe(14); });
  });
  it('the same weeks are kept across years and month ends (no parity change)', () => {
    const c = bw('2026-01-02');
    expect(isCadenceDate(c, '2026-12-18')).toBe(true);
    expect(isCadenceDate(c, '2027-01-01')).toBe(true);
    expect(isCadenceDate(c, '2027-01-08')).toBe(false);
    expect(nextCadenceDate(c, '2026-11-07')).toBe('2026-11-20');
  });
});
