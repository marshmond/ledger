import { describe, expect, it } from 'vitest';
import { bunching, charityTotals, deductibleAmount, deductionAnalysis, gainAvoided, giftsInYear, reminders } from './giving';
import type { Donation } from '../types';

const $ = (n: number) => Math.round(n * 100);
let id = 1;
const gift = (date: string, charity: string, amt: number, extra: Partial<Donation> = {}): Donation => ({ id: id++, date, charity, kind: 'cash', amountCents: $(amt), note: '', ...extra });

describe('what a gift deducts', () => {
  it('cash is its amount; long-term property is its market value', () => {
    expect(deductibleAmount(gift('2026-01-01', 'A', 500))).toBe($(500));
    expect(deductibleAmount(gift('2026-01-01', 'A', 5000, { kind: 'stock', basisCents: $(1000), longTerm: true }))).toBe($(5000));
  });
  it('short-term property is limited to what you paid', () => {
    expect(deductibleAmount(gift('2026-01-01', 'A', 5000, { kind: 'stock', basisCents: $(4000), longTerm: false }))).toBe($(4000));
    expect(deductibleAmount(gift('2026-01-01', 'A', 3000, { kind: 'stock', basisCents: $(4000), longTerm: false }))).toBe($(3000));
  });
});

describe('totals', () => {
  const ds = [
    gift('2026-02-01', 'Food Bank', 500), gift('2026-03-01', 'food bank', 200), gift('2026-06-01', 'School', 5000, { kind: 'stock', basisCents: $(1000), longTerm: true }),
    gift('2025-12-31', 'Last year', 999),
  ];
  it('add up the year, split into cash and property', () => {
    const y = giftsInYear(ds, 2026);
    expect(y).toMatchObject({ count: 3, givenCents: $(5700), cashCents: $(700), propertyCents: $(5000), deductibleCents: $(5700) });
    expect(y.items.map((d) => d.charity)).toEqual(['Food Bank', 'food bank', 'School']);
  });
  it('group by charity ignoring case, biggest first', () => {
    expect(charityTotals(ds, 2026)).toEqual([{ charity: 'School', cents: $(5000), count: 1 }, { charity: 'Food Bank', cents: $(700), count: 2 }]);
  });
});

describe('gain avoided by giving shares', () => {
  it('is the unrealized gain times the capital-gains rate', () => {
    expect(gainAvoided(gift('2026-01-01', 'A', 5000, { kind: 'stock', basisCents: $(1000), longTerm: true }), 0.15)).toBe($(600));
  });
  it('is zero for cash, short-term property, a loss, or an unknown cost', () => {
    expect(gainAvoided(gift('2026-01-01', 'A', 500), 0.15)).toBe(0);
    expect(gainAvoided(gift('2026-01-01', 'A', 5000, { kind: 'stock', basisCents: $(1000), longTerm: false }), 0.15)).toBe(0);
    expect(gainAvoided(gift('2026-01-01', 'A', 500, { kind: 'stock', basisCents: $(1000), longTerm: true }), 0.15)).toBe(0);
    expect(gainAvoided(gift('2026-01-01', 'A', 500, { kind: 'stock', longTerm: true }), 0.15)).toBe(0);
  });
});

describe('does itemizing pay?', () => {
  const std = $(32200);
  it('only when itemized deductions beat the standard deduction, and only the excess helps', () => {
    const a = deductionAnalysis({ giftsCents: $(8000), otherItemizedCents: $(30000), standardCents: std, marginalRate: 0.24 });
    expect(a).toMatchObject({ itemizedCents: $(38000), itemizes: true, extraDeductionCents: $(5800) });
    expect(a.taxSavedCents).toBe(Math.round($(5800) * 0.24));
    expect(a.giftBenefitCents).toBe(Math.round(($(38000) - $(32200)) * 0.24)); // without gifts the 30,000 is below the standard
  });
  it('gifts do nothing when everything stays under the standard deduction', () => {
    const a = deductionAnalysis({ giftsCents: $(3000), otherItemizedCents: $(10000), standardCents: std, marginalRate: 0.22 });
    expect(a).toMatchObject({ itemizes: false, extraDeductionCents: 0, taxSavedCents: 0, giftBenefitCents: 0 });
  });
  it('when you already itemize, the gifts are worth their full amount at your rate', () => {
    const a = deductionAnalysis({ giftsCents: $(5000), otherItemizedCents: $(40000), standardCents: std, marginalRate: 0.24 });
    expect(a.giftBenefitCents).toBe(Math.round($(5000) * 0.24));
  });
});

describe('bunching', () => {
  const base = { otherItemizedCents: $(20000), standardCents: $(32200), marginalRate: 0.24 };
  it('helps when two years of gifts together push you over the standard deduction', () => {
    const b = bunching({ ...base, yearlyGiftCents: $(8000) });
    expect(b.evenCents).toBe(2 * $(32200)); // 28,000 each year: standard both years
    expect(b.bunchedCents).toBe($(36000) + $(32200));
    expect(b.extraDeductionCents).toBe($(3800));
    expect(b.taxSavedCents).toBe(Math.round($(3800) * 0.24));
    expect(b.worthIt).toBe(true);
  });
  it('does not help when you already itemize every year, or when two years still fall short', () => {
    expect(bunching({ ...base, otherItemizedCents: $(40000), yearlyGiftCents: $(5000) }).worthIt).toBe(false);
    expect(bunching({ ...base, yearlyGiftCents: $(1000) }).worthIt).toBe(false);
  });
});

describe('paperwork reminders', () => {
  it('asks for acknowledgments on gifts of $250 or more', () => {
    const y = giftsInYear([gift('2026-01-01', 'Big Charity', 250), gift('2026-01-02', 'Small', 249), gift('2026-01-03', 'Done', 1000, { receipt: true })], 2026);
    const r = reminders(y);
    expect(r).toHaveLength(1);
    expect(r[0].message).toMatch(/1 gift of \$250 or more has no written acknowledgment.*Big Charity/);
  });
  it('mentions Form 8283 for property over $500 and an appraisal for other property over $5,000', () => {
    const y = giftsInYear([gift('2026-01-01', 'A', 600, { kind: 'stock', basisCents: 100, longTerm: true, receipt: true }), gift('2026-01-02', 'B', 6000, { kind: 'other', receipt: true })], 2026);
    expect(reminders(y).map((x) => x.id)).toEqual(['8283', 'appraisal']);
  });
  it('is quiet when everything is in order', () => {
    expect(reminders(giftsInYear([gift('2026-01-01', 'A', 100)], 2026))).toEqual([]);
  });
});
