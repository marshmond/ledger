import type { FinanceDB } from '../db';
import type { Holding, RsuVest, Security } from '../types';
import type { PersonYear } from './payroll';

/**
 * RSU vests. A vest is wage income on its date. Two kinds:
 *  - cash: paid out at a fixed (synthetic / deal) price per share. No ticker, no price lookup.
 *  - stock: shares of a security. Valued at the security's current price until the actual vest price is entered.
 */

export type PriceSource = 'deal' | 'actual' | 'current' | 'none';

export interface ResolvedVest {
  vest: RsuVest;
  /** Gross value in cents (0 when no price is known). */
  grossCents: number;
  priceCents: number | null;
  source: PriceSource;
  /** Set when the vest cannot be valued. */
  warning?: string;
}

export function resolveVest(v: RsuVest, securities: Security[]): ResolvedVest {
  const entered = v.priceCents != null && v.priceCents > 0 ? v.priceCents : null;
  if (v.kind === 'cash') {
    if (entered === null) return { vest: v, grossCents: 0, priceCents: null, source: 'none', warning: `${v.grant || 'Cash vest'} on ${v.date} has no price per share yet` };
    return { vest: v, grossCents: Math.round(v.shares * entered), priceCents: entered, source: 'deal' };
  }
  if (entered !== null) return { vest: v, grossCents: Math.round(v.shares * entered), priceCents: entered, source: 'actual' };
  const sec = securities.find((s) => s.id === v.securityId);
  if (sec && sec.priceCents != null && sec.priceCents > 0) {
    return { vest: v, grossCents: Math.round(v.shares * sec.priceCents), priceCents: sec.priceCents, source: 'current' };
  }
  const name = sec ? sec.ticker : 'its stock';
  return { vest: v, grossCents: 0, priceCents: null, source: 'none', warning: `${v.grant || 'Stock vest'} on ${v.date} has no price: enter a price for ${name} on the Investments tab or the actual vest price` };
}

export const resolveVests = (vests: RsuVest[], securities: Security[]): ResolvedVest[] => vests.map((v) => resolveVest(v, securities));

/** The vests that fall in a year for one person. */
export const vestsFor = (rs: ResolvedVest[], personId: number, year: number): ResolvedVest[] =>
  rs.filter((r) => r.vest.personId === personId && r.vest.date.startsWith(`${year}-`));

export interface VestOutcome {
  vest: RsuVest;
  grossCents: number;
  taxWithheldCents: number;
  /** Cash that reaches you (cash vests, and stock that is sold at once): the vest's net pay. */
  netCashCents: number;
  /** Stock kept after the tax is covered by selling shares (held vests only). */
  sharesKept: number;
  basisCents: number;
}

/**
 * What a vest turns into after tax. For held stock the tax is assumed to be covered by selling shares at the vest price
 * (sell-to-cover), so you keep the shares worth the net amount. If the company withholds differently, set the withholding
 * rates on the Income tab to match the real figures.
 */
export function vestOutcome(r: ResolvedVest, year: PersonYear | undefined): VestOutcome {
  const ev = year?.events.find((e) => e.kind === 'rsu' && e.vestId === r.vest.id);
  const gross = r.grossCents;
  const tax = ev ? ev.fedWithholding + ev.socialSecurity + ev.medicare + ev.addlMedicare + ev.stateWithholding + ev.pfml : 0;
  const net = Math.max(0, gross - tax);
  const held = r.vest.kind === 'stock' && r.vest.afterVest === 'held';
  const frac = gross > 0 ? net / gross : 0;
  return {
    vest: r.vest,
    grossCents: gross,
    taxWithheldCents: tax,
    netCashCents: held ? 0 : net,
    sharesKept: held ? r.vest.shares * frac : 0,
    basisCents: held ? net : 0,
  };
}

/**
 * Adds a held vest's shares to the account's holding for that security (cost basis added at the vest price), and marks the
 * vest recorded. Nothing happens twice: an already-recorded vest is left alone.
 */
export async function recordHeldVest(d: FinanceDB, vestId: number, outcome: VestOutcome): Promise<'recorded' | 'already' | 'not-held' | 'missing'> {
  const v = await d.rsuVests.get(vestId);
  if (!v) return 'missing';
  if (v.kind !== 'stock' || v.afterVest !== 'held') return 'not-held';
  if (v.recorded) return 'already';
  if (!v.securityId || !v.accountId) return 'missing';
  await d.transaction('rw', d.holdings, d.rsuVests, async () => {
    const cur = await d.holdings.where('accountId').equals(v.accountId!).filter((h) => h.securityId === v.securityId).first();
    if (cur) {
      await d.holdings.update(cur.id!, {
        shares: cur.shares + outcome.sharesKept,
        costBasisCents: (cur.costBasisCents ?? 0) + outcome.basisCents,
      } as Partial<Holding>);
    } else {
      await d.holdings.add({ accountId: v.accountId!, securityId: v.securityId!, shares: outcome.sharesKept, costBasisCents: outcome.basisCents });
    }
    await d.rsuVests.update(vestId, { recorded: true });
  });
  return 'recorded';
}

/** Why a vest cannot be saved yet, or null when it is complete. */
export function vestProblem(v: Partial<RsuVest>): string | null {
  if (!v.personId) return 'Choose a person';
  if (!v.date || !/^\d{4}-\d{2}-\d{2}$/.test(v.date)) return 'Enter the vest date';
  if (!(v.shares != null && v.shares > 0)) return 'Enter the number of shares';
  if (v.kind === 'cash') {
    if (!(v.priceCents != null && v.priceCents > 0)) return 'Enter the price per share this cash award pays at';
  } else {
    if (!v.securityId) return 'Choose the stock (add the ticker on the Investments tab first)';
    if (v.afterVest === 'held' && !v.accountId) return 'Choose the brokerage account that will hold the shares';
  }
  return null;
}
