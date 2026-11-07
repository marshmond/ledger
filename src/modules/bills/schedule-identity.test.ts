import { describe, expect, it } from 'vitest';
import { canonicalSemi, semiProblem, slotDate, type Semimonthly, type Slot } from '../../lib/semimonthly';
import { expectedDates, planScheduleChange, slotCollisions, type Schedule } from './schedule';
import { addD, dow, monday, monthly, pad, src } from './billsTestkit';

/**
 * The B0 Revision 2 identity safeguards, tested on the reader (B1 stores no period record yet; B2 will). A slot names a PERIOD (a month, a
 * month plus a/b, or a week); the nominal date is only where that period lands. Invented data.
 */
const e = (s: Schedule | null, from: string, to: string, over = {}) => expectedDates(src(s, over), from, to);
const slots = (s: Schedule, from: string, to: string) => e(s, from, to).map((x) => x.slot);
const twice = (a: Slot, b: Slot, anchorMonth = '2024-01'): Schedule => ({ kind: 'twice-monthly', semi: { a, b }, anchorMonth });
const day = (d: number, adjust: Slot['adjust'] = 'none'): Slot => ({ kind: 'day', day: d, adjust });

describe('safeguard 1 and 3: the slot does not change when the nominal date moves', () => {
  it('a business-day adjustment moves the date but never the slot (ten years, every weekend case)', () => {
    const none = e(monthly(15, '2024-01', 1, 'none'), '2024-01-01', '2033-12-31');
    const prev = e(monthly(15, '2024-01', 1, 'previous'), '2024-01-01', '2033-12-31');
    const next = e(monthly(15, '2024-01', 1, 'next'), '2024-01-01', '2033-12-31');
    expect(none.map((x) => x.slot)).toEqual(prev.map((x) => x.slot));
    expect(none.map((x) => x.slot)).toEqual(next.map((x) => x.slot));
    const moved = none.filter((x, i) => x.nominal !== prev[i].nominal);
    expect(moved.length).toBeGreaterThan(20); // there really were weekend dates that moved
    prev.forEach((x, i) => { expect(x.nominal.slice(0, 7)).toBe(x.slot.slice(1)); expect(dow(x.nominal)).not.toBe(0); expect(dow(x.nominal)).not.toBe(6); void i; });
  });
  it('a different day of the month keeps the same slots (12th to 20th)', () => {
    expect(slots(monthly(12, '2026-01'), '2026-01-01', '2027-12-31')).toEqual(slots(monthly(20, '2026-01'), '2026-01-01', '2027-12-31'));
  });
  it('a changed weekday keeps the Monday slot when the new first date is in the same week', () => {
    const wed: Schedule = { kind: 'weeks', every: 2, weekday: 3, anchorDate: '2026-12-02' };
    const fri: Schedule = { kind: 'weeks', every: 2, weekday: 5, anchorDate: '2026-12-04' };
    const sun: Schedule = { kind: 'weeks', every: 2, weekday: 0, anchorDate: '2026-12-06' }; // the Sunday that ends that same Monday-to-Sunday week
    const mon: Schedule = { kind: 'weeks', every: 2, weekday: 1, anchorDate: '2026-11-30' };
    const base = slots(wed, '2026-12-01', '2028-12-31');
    expect(base[0]).toBe('w2026-11-30');
    for (const other of [fri, sun, mon]) expect(slots(other, '2026-11-30', '2028-12-31').slice(0, base.length - 1)).toEqual(base.slice(0, base.length - 1));
  });
  it('the actual due date is not an input to the reader at all: nothing a provider says can change a slot', () => {
    // expectedDates takes only the schedule, history, tracking start, pauses and status. There is no field through which a moved due date could enter.
    const probe = Object.keys(src(monthly(12)));
    expect(probe.sort()).toEqual(['endedOn', 'pauses', 'schedule', 'scheduleHistory', 'status', 'trackingSince']);
  });
  it('every slot of a months schedule is the month of its own nominal date, and every weeks slot the Monday of its own date', () => {
    for (const adj of ['none', 'previous', 'next'] as const) for (const x of e(monthly(25, '2024-01', 1, adj), '2024-01-01', '2036-12-31')) expect(x.slot).toBe(`m${x.nominal.slice(0, 7)}`);
    const w: Schedule = { kind: 'weeks', every: 3, weekday: 6, anchorDate: '2026-11-07' };
    for (const x of e(w, '2026-11-07', '2030-01-01')) expect(x.slot).toBe(`w${monday(x.nominal)}`);
  });
});

describe('safeguard 2: twice-monthly slot identity (tests 56)', () => {
  it('a and b follow the rank of the rule, so editing the order the two days are entered in changes nothing', () => {
    const x = slots(twice(day(1), day(15)), '2026-01-01', '2026-12-31');
    const y = slots(twice(day(15), day(1)), '2026-01-01', '2026-12-31');
    expect(y).toEqual(x);
    expect(x.slice(0, 4)).toEqual(['s2026-01a', 's2026-01b', 's2026-02a', 's2026-02b']);
  });
  it('changing a day keeps the identity of each slot (1st and 15th to 10th and 20th)', () => {
    expect(slots(twice(day(10), day(20)), '2026-01-01', '2026-12-31')).toEqual(slots(twice(day(1), day(15)), '2026-01-01', '2026-12-31'));
  });
  it('a business-day adjustment does not move a slot to the other position or the other month', () => {
    const plain = e(twice(day(15), { kind: 'lastBusinessDay' }), '2024-01-01', '2033-12-31');
    const adj = e(twice(day(15, 'previous'), { kind: 'lastBusinessDay' }), '2024-01-01', '2033-12-31');
    expect(adj.map((x) => x.slot)).toEqual(plain.map((x) => x.slot));
    for (const x of adj) expect(x.nominal.slice(0, 7)).toBe(x.slot.slice(1, 8));
  });
  it('February, a 31st, December into January: each date lies inside its own slot month and never in another', () => {
    const s = twice(day(31), day(1), '2026-11'); // canonical order puts the 1st first
    const got = e(s, '2026-11-01', '2027-03-31');
    expect(got.map((x) => `${x.slot}@${x.nominal}`)).toEqual([
      's2026-11a@2026-11-01', 's2026-11b@2026-11-30', 's2026-12a@2026-12-01', 's2026-12b@2026-12-31', 's2027-01a@2027-01-01', 's2027-01b@2027-01-31',
      's2027-02a@2027-02-01', 's2027-02b@2027-02-28', 's2027-03a@2027-03-01', 's2027-03b@2027-03-31',
    ]);
    expect(slotDate(day(31), '2028-02')).toBe('2028-02-29');
  });
  it('for EVERY valid twice-monthly rule in a broad sample the first slot (a) is always the earlier date, so a and b can never swap', () => {
    const sample: Slot[] = [];
    for (const d of [1, 5, 14, 15, 16, 28, 29, 30, 31]) for (const adjust of ['none', 'previous', 'next'] as const) sample.push(day(d, adjust));
    sample.push({ kind: 'lastDay' }, { kind: 'lastBusinessDay' });
    let valid = 0;
    for (const x of sample) for (const y of sample) {
      const semi: Semimonthly = canonicalSemi({ a: x, b: y });
      if (semi.a === y && semi.b === x && JSON.stringify(x) !== JSON.stringify(y)) continue; // visit each unordered pair once
      if (JSON.stringify(x) === JSON.stringify(y) || semiProblem(semi)) continue;
      valid++;
      for (let yr = 2024; yr <= 2040; yr++) for (let m = 1; m <= 12; m++) {
        const month = `${yr}-${pad(m)}`;
        expect(slotDate(semi.a, month) < slotDate(semi.b, month), `${JSON.stringify(semi)} ${month}`).toBe(true);
      }
    }
    expect(valid).toBeGreaterThan(150);
  });
});

describe('safeguard 4 to 6: a schedule change never makes two schedules claim one period', () => {
  const cur = (schedule: Schedule | null, over = {}) => ({ schedule, scheduleHistory: [], trackingSince: '2026-01-01', ...over });
  it('changing from the 1st of a month keeps the old schedule before it and the new one after it, with no shared period', () => {
    const r = planScheduleChange(cur(monthly(12, '2026-01')), monthly(20, '2027-01'), '2027-01-01');
    expect(r.problem).toBeNull();
    expect(r.mode).toBe('revise');
    expect(r.history).toEqual([{ until: '2026-12-31', schedule: monthly(12, '2026-01') }]);
    const all = expectedDates(src(r.schedule, { scheduleHistory: r.history, trackingSince: '2026-01-01' }), '2026-10-01', '2027-03-31');
    expect(slotCollisions(all)).toEqual([]);
    expect(all.map((x) => x.nominal)).toEqual(['2026-10-12', '2026-11-12', '2026-12-12', '2027-01-20', '2027-02-20', '2027-03-20']);
  });
  it('STOP CASE, refused with the concrete period: starting a new day mid-month after the old date has passed', () => {
    const r = planScheduleChange(cur(monthly(12, '2026-01')), monthly(20, '2026-01'), '2026-12-15');
    expect(r.problem).toMatch(/December 2026/);
    expect(r.problem).toMatch(/2026-12-12/);
    expect(r.problem).toMatch(/2026-12-20/);
    expect(r.problem).toMatch(/Start the new schedule on 2027-01-01 or later/);
  });
  it('the same mid-month change is fine if the old date has not happened yet (nothing is claimed twice)', () => {
    // old: the 20th, new: the 12th, effective 5 Dec: the old schedule has produced nothing for December before the 5th
    const r = planScheduleChange(cur(monthly(20, '2026-01'), { trackingSince: '2026-12-01' }), monthly(12, '2026-01'), '2026-12-05');
    expect(r.problem).toBeNull();
    expect(r.mode).toBe('replace'); // the old schedule never applied to a date, so it is simply replaced, December stays one period
    expect(expectedDates(src(r.schedule, { scheduleHistory: r.history, trackingSince: '2026-12-01' }), '2026-12-01', '2026-12-31').map((x) => x.nominal)).toEqual(['2026-12-12']);
  });
  it('twice-monthly changed mid-month is refused for the same reason, naming the period and the position', () => {
    const old = twice(day(1), day(15), '2026-01');
    const r = planScheduleChange(cur(old), twice(day(15), { kind: 'lastDay' }, '2026-01'), '2026-12-10');
    expect(r.problem).toMatch(/December 2026 \(first bill\)/);
    const ok = planScheduleChange(cur(old), twice(day(15), { kind: 'lastDay' }, '2026-01'), '2027-01-01');
    expect(ok.problem).toBeNull();
    const all = expectedDates(src(ok.schedule, { scheduleHistory: ok.history, trackingSince: '2026-01-01' }), '2026-12-01', '2027-01-31');
    expect(all.map((x) => `${x.slot}@${x.nominal}`)).toEqual(['s2026-12a@2026-12-01', 's2026-12b@2026-12-15', 's2027-01a@2027-01-15', 's2027-01b@2027-01-31']);
    expect(slotCollisions(all)).toEqual([]);
  });
  it('weekly changes need a clean week boundary; the advice names the next Monday', () => {
    const old: Schedule = { kind: 'weeks', every: 1, weekday: 3, anchorDate: '2026-11-04' };
    const neu: Schedule = { kind: 'weeks', every: 1, weekday: 5, anchorDate: '2026-11-06' };
    const bad = planScheduleChange(cur(old, { trackingSince: '2026-11-04' }), neu, '2026-11-12'); // Thursday after the Wednesday bill
    expect(bad.problem).toMatch(/the week of 2026-11-09/);
    expect(bad.problem).toMatch(/2026-11-16/);
    expect(planScheduleChange(cur(old, { trackingSince: '2026-11-04' }), neu, '2026-11-16').problem).toBeNull();
  });
  it('a change to a different kind (monthly to twice-monthly) has no shared period, so a boundary is only a matter of tidiness', () => {
    const r = planScheduleChange(cur(monthly(12, '2026-01')), twice(day(1), day(15), '2026-01'), '2026-12-15');
    expect(r.problem).toBeNull(); // m2026-12 and s2026-12b are different periods; B2 shows old facts under "From an earlier schedule"
    const all = expectedDates(src(r.schedule, { scheduleHistory: r.history, trackingSince: '2026-01-01' }), '2026-12-01', '2026-12-31');
    expect(all.map((x) => x.slot)).toEqual(['m2026-12', 's2026-12b']);
  });
  it('a change must come after the previous change; an invalid or identical schedule is handled in words', () => {
    const history = [{ until: '2026-12-31', schedule: monthly(12, '2026-01') }];
    expect(planScheduleChange(cur(monthly(20, '2027-01'), { scheduleHistory: history }), monthly(25, '2027-01'), '2026-11-01').problem).toMatch(/already changed on 2027-01-01/);
    expect(planScheduleChange(cur(monthly(12)), monthly(12), '2026-12-01').mode).toBe('same');
    expect(planScheduleChange(cur(monthly(12)), monthly(1, '2026-01', 1, 'previous'), '2026-12-01').problem).toMatch(/outside its own month/);
    expect(planScheduleChange(cur(monthly(12)), monthly(20), 'nonsense').problem).toMatch(/real date/);
  });
  it('replacing with "on demand" and coming back from on demand', () => {
    const toNone = planScheduleChange(cur(monthly(12, '2026-01')), null, '2027-01-01');
    expect(toNone.schedule).toBeNull();
    expect(toNone.history).toHaveLength(1);
    expect(expectedDates(src(toNone.schedule, { scheduleHistory: toNone.history, trackingSince: '2026-01-01' }), '2026-12-01', '2027-03-01').map((x) => x.nominal)).toEqual(['2026-12-12']);
    const back = planScheduleChange(cur(null, { scheduleHistory: toNone.history }), monthly(5, '2027-03'), '2027-03-01');
    expect(back.problem).toBeNull();
    expect(back.history).toEqual(toNone.history); // nothing to keep: the old "schedule" was none
  });
  it('slot ids stay the same when an unrelated field changes (a tracking date, pauses) and only the dates in range differ', () => {
    const a = slots(monthly(12, '2026-01'), '2026-01-01', '2027-12-31');
    const b = e(monthly(12, '2026-01'), '2026-01-01', '2027-12-31', { pauses: [{ from: '2026-05-01', to: '2026-08-01' }], trackingSince: '2026-02-01' }).map((x) => x.slot);
    expect(b).toEqual(a.filter((s) => s !== 'm2026-01' && s !== 'm2026-05' && s !== 'm2026-06' && s !== 'm2026-07'));
    void addD;
  });
});
