import { describe, expect, it } from 'vitest';
import { expandEvents, runForecast, type ForecastInput } from './forecast';

const $ = (n: number) => Math.round(n * 100);
const base: ForecastInput = {
  today: '2026-10-17', months: 6, startCents: $(5000), pay: [], scheduled: [], loans: [], taxes: [], oneOffs: [], everydayMonthlyCents: 0, otherIncomeMonthlyCents: 0,
};

describe('building the events', () => {
  it('keeps only dates after today and before the horizon, sorted with income before bills on the same day', () => {
    const e = expandEvents({
      ...base,
      pay: [{ date: '2026-10-17', label: 'today', netCents: 1 }, { date: '2026-11-01', label: 'Pay', netCents: $(2000) }, { date: '2027-05-01', label: 'too far', netCents: 1 }],
      scheduled: [{ date: '2026-11-01', label: 'Rent', cents: -$(1500) }],
      loans: [{ date: '2026-11-05', label: 'Mortgage', paymentCents: $(2400) }],
    });
    expect(e.map((x) => [x.date, x.label, x.cents])).toEqual([['2026-11-01', 'Pay', $(2000)], ['2026-11-01', 'Rent', -$(1500)], ['2026-11-05', 'Mortgage', -$(2400)]]);
  });
  it('spreads everyday spending over the weeks', () => {
    const e = expandEvents({ ...base, months: 2, everydayMonthlyCents: $(2600) });
    expect(e.every((x) => x.kind === 'spending' && x.cents === -$(600))).toBe(true);
    expect(e[0].date).toBe('2026-10-24');
    expect(e.map((x) => x.date)).toEqual(['2026-10-24', '2026-10-31', '2026-11-07', '2026-11-14', '2026-11-21', '2026-11-28']); // through the end of November
  });
  it('adds other monthly income on the first of each month', () => {
    const e = expandEvents({ ...base, months: 3, otherIncomeMonthlyCents: $(500) });
    expect(e.map((x) => x.date)).toEqual(['2026-11-01', '2026-12-01']);
  });
});

describe('running the forecast', () => {
  it('applies every event in order and tracks the balance', () => {
    const r = runForecast({
      ...base,
      pay: [{ date: '2026-11-01', label: 'Pay', netCents: $(3000) }],
      scheduled: [{ date: '2026-11-03', label: 'Rent', cents: -$(1500) }],
      loans: [{ date: '2026-11-05', label: 'Mortgage', paymentCents: $(2000) }],
    });
    expect(r.events.map((e) => e.balanceCents)).toEqual([$(8000), $(6500), $(4500)]);
    expect(r.endCents).toBe($(4500));
    expect(r.totalIn).toBe($(3000));
    expect(r.totalOut).toBe($(3500));
  });
  it('finds the lowest point and when it happens, within a month and overall', () => {
    const r = runForecast({
      ...base,
      scheduled: [{ date: '2026-11-02', label: 'Big bill', cents: -$(6000) }],
      pay: [{ date: '2026-11-20', label: 'Pay', netCents: $(4000) }],
    });
    expect(r.low).toEqual({ date: '2026-11-02', balanceCents: -$(1000) });
    const nov = r.months.find((m) => m.month === '2026-11')!;
    expect(nov.lowCents).toBe(-$(1000));
    expect(nov.lowDate).toBe('2026-11-02');
    expect(nov.endCents).toBe($(3000));
  });
  it('reports the first day below a threshold', () => {
    const r = runForecast({ ...base, scheduled: [{ date: '2026-11-02', label: 'Bill', cents: -$(4500) }, { date: '2026-12-02', label: 'Bill', cents: -$(1000) }] }, $(1000));
    expect(r.firstBelow).toEqual({ date: '2026-11-02', balanceCents: $(500) });
    expect(runForecast({ ...base, scheduled: [{ date: '2026-11-02', label: 'Bill', cents: -$(100) }] }, $(1000)).firstBelow).toBeNull();
    expect(runForecast({ ...base, startCents: $(500) }, $(1000)).firstBelow).toEqual({ date: '2026-10-17', balanceCents: $(500) });
  });
  it('months chain: each starts where the last ended, and break out income, bills, loans, taxes, spending, one-offs', () => {
    const r = runForecast({
      ...base,
      pay: [{ date: '2026-11-15', label: 'Pay', netCents: $(2000) }, { date: '2026-12-15', label: 'Pay', netCents: $(2000) }],
      scheduled: [{ date: '2026-11-10', label: 'Rent', cents: -$(800) }],
      loans: [{ date: '2026-12-01', label: 'Loan', paymentCents: $(300) }],
      taxes: [{ date: '2026-12-20', label: 'Tax due', cents: -$(500) }],
      oneOffs: [{ date: '2026-11-25', label: 'Trip', cents: -$(700) }],
    });
    for (let k = 1; k < r.months.length; k++) expect(r.months[k].startCents).toBe(r.months[k - 1].endCents);
    const nov = r.months[1];
    expect(nov).toMatchObject({ month: '2026-11', startCents: $(5000), incomeCents: $(2000), billsCents: -$(800), oneOffCents: -$(700), endCents: $(5500) });
    const dec = r.months[2];
    expect(dec).toMatchObject({ incomeCents: $(2000), loansCents: -$(300), taxesCents: -$(500), endCents: $(6700) });
    expect(r.months[r.months.length - 1].endCents).toBe(r.endCents);
  });
  it('a quiet month still has a start, end, and low', () => {
    const r = runForecast({ ...base, scheduled: [{ date: '2027-02-10', label: 'Late', cents: -$(100) }] });
    for (const m of r.months) {
      expect(m.endCents).toBeGreaterThanOrEqual(0);
      expect(m.lowCents).not.toBe(Infinity);
    }
    expect(r.months[0].month).toBe('2026-10');
    expect(r.months).toHaveLength(6);
    expect(r.months[1].startCents).toBe($(5000));
  });
  it('with nothing entered the balance just stays put', () => {
    const r = runForecast(base);
    expect(r.endCents).toBe($(5000));
    expect(r.low.balanceCents).toBe($(5000));
    expect(r.events).toEqual([]);
  });
});
