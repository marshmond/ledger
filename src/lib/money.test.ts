import { describe, expect, it } from 'vitest';
import { assignedFromEntry, isAmountSum, parseAmountMath } from './money';

describe('parseAmountMath', () => {
  it('adds and subtracts amounts', () => {
    expect(parseAmountMath('15.37+123.86')).toBe(13923);
    expect(parseAmountMath('200-15.50')).toBe(18450);
    expect(parseAmountMath('10+20-5.25')).toBe(2475);
    expect(parseAmountMath('$1,200.50 + 3')).toBe(120350);
  });
  it('can go negative', () => {
    expect(parseAmountMath('5-20')).toBe(-1500);
    expect(parseAmountMath('-5+2')).toBe(-300);
  });
  it('avoids floating-point drift', () => {
    expect(parseAmountMath('0.1+0.2')).toBe(30);
    expect(parseAmountMath('19.99+0.01')).toBe(2000);
  });
  it('still reads single amounts as before', () => {
    expect(parseAmountMath('12.34')).toBe(1234);
    expect(parseAmountMath('(12.34)')).toBe(-1234);
    expect(parseAmountMath('-12.34')).toBe(-1234);
    expect(parseAmountMath('12.34-')).toBe(-1234);
    expect(parseAmountMath('')).toBeNull();
  });
  it('rejects unfinished or odd sums', () => {
    expect(parseAmountMath('15.37+')).toBeNull();
    expect(parseAmountMath('15++3')).toBeNull();
    expect(parseAmountMath('1+a')).toBeNull();
    expect(parseAmountMath('3*4')).toBeNull();
  });
});

describe('isAmountSum', () => {
  it('is true only for a complete sum', () => {
    expect(isAmountSum('1+2')).toBe(true);
    expect(isAmountSum('1')).toBe(false);
    expect(isAmountSum('-1')).toBe(false);
    expect(isAmountSum('1+')).toBe(false);
  });
});

describe('assignedFromEntry', () => {
  it('replaces with plain amounts and sums', () => {
    expect(assignedFromEntry('150', 999)).toBe(15000);
    expect(assignedFromEntry('100+50', 999)).toBe(15000);
    expect(assignedFromEntry('', 999)).toBe(0);
  });
  it('adjusts when the text starts with a sign', () => {
    expect(assignedFromEntry('+25', 10000)).toBe(12500);
    expect(assignedFromEntry('-10', 10000)).toBe(9000);
    expect(assignedFromEntry('+20+5', 10000)).toBe(12500);
    expect(assignedFromEntry('-150', 10000)).toBe(-5000);
  });
  it('rejects junk', () => {
    expect(assignedFromEntry('abc', 100)).toBeNull();
    expect(assignedFromEntry('5+', 100)).toBeNull();
  });
});
