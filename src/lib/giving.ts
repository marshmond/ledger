import type { Donation } from '../types';

/**
 * Charitable giving: what you gave, what it is worth as a deduction, the tax on gains you avoid by giving appreciated shares, and
 * whether bunching several years of gifts into one would help. Planning estimates, not tax advice. Money in cents.
 */

/** What counts as the deduction for one gift: cash, or the market value of long-term property; short-term property is limited to cost. */
export function deductibleAmount(d: Donation): number {
  if (d.kind === 'cash') return d.amountCents;
  if (d.longTerm === false) return Math.min(d.amountCents, d.basisCents ?? d.amountCents);
  return d.amountCents;
}

export interface YearGifts {
  year: number;
  count: number;
  /** Total value given. */
  givenCents: number;
  /** What can be deducted (see deductibleAmount). */
  deductibleCents: number;
  cashCents: number;
  propertyCents: number;
  items: Donation[];
}

export function giftsInYear(ds: Donation[], year: number): YearGifts {
  const items = ds.filter((d) => d.date.startsWith(`${year}-`)).sort((a, b) => a.date.localeCompare(b.date) || (a.id ?? 0) - (b.id ?? 0));
  const cash = items.filter((d) => d.kind === 'cash').reduce((a, d) => a + d.amountCents, 0);
  const total = items.reduce((a, d) => a + d.amountCents, 0);
  return { year, count: items.length, givenCents: total, deductibleCents: items.reduce((a, d) => a + deductibleAmount(d), 0), cashCents: cash, propertyCents: total - cash, items };
}

export interface CharityTotal {
  charity: string;
  cents: number;
  count: number;
}

export function charityTotals(ds: Donation[], year: number): CharityTotal[] {
  const m = new Map<string, CharityTotal>();
  for (const d of ds) {
    if (!d.date.startsWith(`${year}-`)) continue;
    const key = d.charity.trim().toLowerCase() || '(no name)';
    const g = m.get(key) ?? { charity: d.charity.trim() || '(no name)', cents: 0, count: 0 };
    g.cents += d.amountCents;
    g.count++;
    m.set(key, g);
  }
  return [...m.values()].sort((a, b) => b.cents - a.cents || a.charity.localeCompare(b.charity));
}

/** Capital gains tax you never pay because you gave long-term appreciated property instead of selling it. */
export function gainAvoided(d: Donation, ltcgRate: number): number {
  if (d.kind === 'cash' || d.longTerm === false || d.basisCents === undefined) return 0;
  return Math.round(Math.max(0, d.amountCents - d.basisCents) * ltcgRate);
}

export interface DeductionAnalysis {
  standardCents: number;
  otherItemizedCents: number;
  giftsCents: number;
  itemizedCents: number;
  itemizes: boolean;
  /** How much itemizing lowers taxable income compared with taking the standard deduction. */
  extraDeductionCents: number;
  taxSavedCents: number;
  /** The gifts' own tax benefit: tax with the gifts minus tax without them. */
  giftBenefitCents: number;
}

export function deductionAnalysis(i: { giftsCents: number; otherItemizedCents: number; standardCents: number; marginalRate: number }): DeductionAnalysis {
  const itemized = i.otherItemizedCents + i.giftsCents;
  const best = Math.max(itemized, i.standardCents);
  const without = Math.max(i.otherItemizedCents, i.standardCents);
  return {
    standardCents: i.standardCents,
    otherItemizedCents: i.otherItemizedCents,
    giftsCents: i.giftsCents,
    itemizedCents: itemized,
    itemizes: itemized > i.standardCents,
    extraDeductionCents: Math.max(0, itemized - i.standardCents),
    taxSavedCents: Math.round(Math.max(0, itemized - i.standardCents) * i.marginalRate),
    giftBenefitCents: Math.round((best - without) * i.marginalRate),
  };
}

export interface Bunching {
  /** Deductions over two years giving the usual amount each year. */
  evenCents: number;
  /** Deductions over two years giving two years of gifts in the first and none in the second. */
  bunchedCents: number;
  extraDeductionCents: number;
  taxSavedCents: number;
  worthIt: boolean;
}

/** Bunching: give two years' worth in one year so that year itemizes, and take the standard deduction the other year. */
export function bunching(i: { yearlyGiftCents: number; otherItemizedCents: number; standardCents: number; marginalRate: number }): Bunching {
  const even = 2 * Math.max(i.standardCents, i.otherItemizedCents + i.yearlyGiftCents);
  const bunched = Math.max(i.standardCents, i.otherItemizedCents + 2 * i.yearlyGiftCents) + Math.max(i.standardCents, i.otherItemizedCents);
  const extra = Math.max(0, bunched - even);
  return { evenCents: even, bunchedCents: bunched, extraDeductionCents: extra, taxSavedCents: Math.round(extra * i.marginalRate), worthIt: extra > 0 };
}

export interface Reminder {
  id: string;
  message: string;
}

/** Paperwork the IRS expects, for the gifts in a year. */
export function reminders(y: YearGifts): Reminder[] {
  const out: Reminder[] = [];
  const noReceipt = y.items.filter((d) => d.amountCents >= 25000 && !d.receipt);
  if (noReceipt.length > 0) out.push({ id: 'ack', message: `${noReceipt.length} gift${noReceipt.length === 1 ? '' : 's'} of $250 or more ${noReceipt.length === 1 ? 'has' : 'have'} no written acknowledgment on file (${noReceipt.map((d) => d.charity || 'unnamed').join(', ')}). Get one from the charity before you file.` });
  if (y.propertyCents > 50000) out.push({ id: '8283', message: 'Gifts of property worth over $500 in total are reported on Form 8283 with your tax return.' });
  const big = y.items.filter((d) => d.kind === 'other' && d.amountCents > 500000);
  if (big.length > 0) out.push({ id: 'appraisal', message: 'Property other than publicly traded stock worth over $5,000 needs a qualified appraisal.' });
  return out;
}
