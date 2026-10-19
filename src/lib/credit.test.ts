import { describe, expect, it } from 'vitest';
import { creditStatus, parseLimit, utilizationNote } from './credit';

const $ = (n: number) => Math.round(n * 100);

describe('credit status', () => {
  it('works out what is left before the limit', () => {
    const s = creditStatus(-$(1200), $(5000))!;
    expect(s).toMatchObject({ limit: $(5000), owed: $(1200), available: $(3800), level: 'ok' });
    expect(s.usedPct).toBeCloseTo(24, 5);
  });
  it('flags high use and going over the limit', () => {
    expect(creditStatus(-$(4000), $(5000))!.level).toBe('high');
    expect(creditStatus(-$(5000), $(5000))).toMatchObject({ available: 0, level: 'high' });
    const over = creditStatus(-$(5200), $(5000))!;
    expect(over).toMatchObject({ available: -$(200), level: 'over' });
    expect(over.usedPct).toBeCloseTo(104, 5);
  });
  it('a card in credit adds to what you can spend and uses none of the limit', () => {
    const s = creditStatus($(150), $(5000))!;
    expect(s).toMatchObject({ owed: -$(150), available: $(5150), usedPct: 0, level: 'ok' });
  });
  it('is nothing without a limit', () => {
    expect(creditStatus(-$(100), undefined)).toBeNull();
    expect(creditStatus(-$(100), null)).toBeNull();
    expect(creditStatus(-$(100), 0)).toBeNull();
  });
  it('words the use of the limit', () => {
    expect(utilizationNote(creditStatus(-$(1000), $(5000))!)).toBe('Under 30% of the limit.');
    expect(utilizationNote(creditStatus(-$(2000), $(5000))!)).toMatch(/Above 30%/);
    expect(utilizationNote(creditStatus(-$(4000), $(5000))!)).toMatch(/High use/);
    expect(utilizationNote(creditStatus(-$(6000), $(5000))!)).toBe('Over the limit.');
  });
});

describe('typing a limit', () => {
  it('accepts amounts, blank to clear, and rejects the rest', () => {
    expect(parseLimit('$5,000')).toEqual({ cents: $(5000) });
    expect(parseLimit('7500.50')).toEqual({ cents: 750050 });
    expect(parseLimit('  ')).toEqual({ cents: undefined });
    expect(parseLimit('abc')).toEqual({ error: 'That is not a valid amount.' });
    expect(parseLimit('0')).toMatchObject({ error: expect.stringMatching(/more than zero/) });
    expect(parseLimit('-100')).toMatchObject({ error: expect.stringMatching(/more than zero/) });
  });
});
