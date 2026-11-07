import { describe, expect, it } from 'vitest';
import { generateDates } from '../core/recurrence';
import * as lib from './semimonthly';
import * as services from '../modules/services/semimonthly';

/**
 * Bills B1.0: the month-slot helper moved to `src/lib/semimonthly.ts`. These tests prove (1) the old Services path still gives the very same
 * functions, (2) the single-slot additions agree with the existing `generateDates` for every plain day-of-month rule, and (3) the awkward
 * calendar cases. Expected values are worked out here WITHOUT the code under test (integer day counts, no Date, no time zone).
 */
const dim = (y: number, m: number) => [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
const dn = (iso: string) => {
  let [y, m, d] = iso.split('-').map(Number);
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400), yoe = y - era * 400, doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719468;
};
const dow = (iso: string) => (((dn(iso) + 4) % 7) + 7) % 7;
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const lastBiz = (y: number, m: number) => { let d = dim(y, m); while (dow(iso(y, m, d)) === 0 || dow(iso(y, m, d)) === 6) d--; return iso(y, m, d); };
const slot = (day: number, adjust: lib.Slot['adjust'] = 'none'): lib.Slot => ({ kind: 'day', day, adjust });

describe('B1.0: the helper is shared without changing Household Services', () => {
  it('the old Services path re-exports the very same functions (identity, not copies)', () => {
    for (const name of Object.keys(lib) as (keyof typeof lib)[]) {
      expect((services as Record<string, unknown>)[name], name).toBe(lib[name]);
    }
    expect(Object.keys(services).sort()).toEqual(Object.keys(lib).sort());
  });
  it('twice-monthly results are unchanged for a fixed set of rules (golden values worked out by hand)', () => {
    const s = lib.canonicalSemi({ a: slot(15), b: { kind: 'lastBusinessDay' } });
    expect(lib.semiDates(s, '2026-01-01', '2026-01-01', '2026-03-31')).toEqual(['2026-01-15', '2026-01-30', '2026-02-15', '2026-02-27', '2026-03-15', '2026-03-31']);
    expect(lib.semiProblem({ a: slot(30), b: { kind: 'lastDay' } })).toMatch(/same date/);
    expect(lib.semiProblem({ a: slot(1, 'previous'), b: slot(15) })).toMatch(/outside its own month/);
  });
});

describe('B1.0: single slot stepped by months equals generateDates for every plain day rule', () => {
  const ANCHORS = ['2024-01', '2024-03', '2024-07']; // months that have 31 days, so every day number exists in the anchor month
  const EVERY = [1, 2, 3, 6, 12];
  it('days 1 to 31, every 1/2/3/6/12 months, ten years including leap years: identical lists', () => {
    let compared = 0;
    for (const anchor of ANCHORS) {
      for (let day = 1; day <= 31; day++) {
        for (const every of EVERY) {
          const want = generateDates(`${anchor}-${pad(day)}`, { freq: 'monthly', interval: every, monthly: 'date', end: { type: 'never' } }, '2024-01-01', '2034-12-31');
          const got = lib.monthSlotDates(slot(day), every, anchor, '2024-01-01', '2034-12-31').map((x) => x.date);
          expect(got, `${anchor} day ${day} every ${every}`).toEqual(want);
          compared++;
        }
      }
    }
    expect(compared).toBe(3 * 31 * 5);
  });
  it('a February anchor works for days that exist in February (1 to 28)', () => {
    for (let day = 1; day <= 28; day++) for (const every of EVERY) {
      const want = generateDates(`2025-02-${pad(day)}`, { freq: 'monthly', interval: every, monthly: 'date', end: { type: 'never' } }, '2025-01-01', '2035-12-31');
      expect(lib.monthSlotDates(slot(day), every, '2025-02', '2025-01-01', '2035-12-31').map((x) => x.date), `day ${day} every ${every}`).toEqual(want);
    }
  });
  it('the 29th of February: annual lands on the 28th in other years, and on the 29th in leap years', () => {
    const got = lib.monthSlotDates(slot(29), 12, '2024-02', '2024-01-01', '2033-12-31').map((x) => x.date);
    expect(got).toEqual(['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29', '2033-02-28']);
    expect(got).toEqual(generateDates('2024-02-29', { freq: 'yearly', interval: 1, end: { type: 'never' } }, '2024-01-01', '2033-12-31'));
  });
  it('the 31st clamps to the last real day of short months, and months before the anchor give nothing', () => {
    const got = lib.monthSlotDates(slot(31), 1, '2026-01', '2025-06-01', '2026-06-30').map((x) => x.date);
    expect(got).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30']);
    expect(lib.monthSlotDates(slot(10), 1, '2026-03', '2026-01-01', '2026-02-28')).toEqual([]);
  });
  it('the window edges are inclusive and each result names its own month', () => {
    const got = lib.monthSlotDates(slot(15), 1, '2026-01', '2026-03-15', '2026-05-15');
    expect(got).toEqual([{ month: '2026-03', date: '2026-03-15' }, { month: '2026-04', date: '2026-04-15' }, { month: '2026-05', date: '2026-05-15' }]);
    expect(lib.monthSlotDates(slot(15), 1, '2026-01', '2026-03-16', '2026-04-14')).toEqual([]);
  });
});

describe('B1.0: last day, last business day and weekend adjustments', () => {
  it('last day and last business day for every month of 2024 to 2027 (leap February included)', () => {
    for (let y = 2024; y <= 2027; y++) for (let m = 1; m <= 12; m++) {
      const month = `${y}-${pad(m)}`;
      expect(lib.slotDate({ kind: 'lastDay' }, month), month).toBe(iso(y, m, dim(y, m)));
      expect(lib.slotDate({ kind: 'lastBusinessDay' }, month), month).toBe(lastBiz(y, m));
    }
  });
  it('previous and next business-day adjustment are the Friday before and the Monday after a weekend date', () => {
    // 2026-08-15 is a Saturday, 2026-11-15 is a Sunday, 2026-12-15 is a Tuesday
    expect(lib.slotDate(slot(15, 'previous'), '2026-08')).toBe('2026-08-14');
    expect(lib.slotDate(slot(15, 'next'), '2026-08')).toBe('2026-08-17');
    expect(lib.slotDate(slot(15, 'previous'), '2026-11')).toBe('2026-11-13');
    expect(lib.slotDate(slot(15, 'next'), '2026-11')).toBe('2026-11-16');
    expect(lib.slotDate(slot(15, 'previous'), '2026-12')).toBe('2026-12-15');
    expect(lib.slotDate(slot(15, 'next'), '2026-12')).toBe('2026-12-15');
  });
  it('a single slot that could leave its month is refused with a real example; a safe one is accepted', () => {
    expect(lib.slotProblem(slot(1, 'previous'))).toMatch(/outside its own month/);
    expect(lib.slotProblem(slot(31, 'next'))).toMatch(/outside its own month/);
    expect(lib.slotProblem(slot(1, 'next'))).toBeNull();
    expect(lib.slotProblem(slot(28, 'previous'))).toBeNull();
    expect(lib.slotProblem(slot(15, 'none'))).toBeNull();
    expect(lib.slotProblem({ kind: 'lastDay' })).toBeNull();
    expect(lib.slotProblem({ kind: 'lastBusinessDay' })).toBeNull();
    expect(lib.slotProblem({ kind: 'day', day: 32 })).toMatch(/1 to 31/);
  });
  it('every weekday adjustment that passes the check stays inside its month over 2000 to 2130', () => {
    for (let day = 1; day <= 31; day++) for (const adjust of ['previous', 'next'] as const) {
      const s = slot(day, adjust);
      if (lib.slotProblem(s)) continue;
      for (let y = 2000; y <= 2130; y += 7) for (let m = 1; m <= 12; m++) expect(lib.slotDate(s, `${y}-${pad(m)}`).slice(0, 7)).toBe(`${y}-${pad(m)}`);
    }
  });
  it('bounded: a huge window does not loop forever', () => {
    expect(lib.monthSlotDates(slot(1), 1, '2000-01', '2000-01-01', '9999-12-31').length).toBeLessThanOrEqual(1200);
  });
});
