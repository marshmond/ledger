import type { TaxTables } from '../data/taxYears';
import { RETIREMENT_RULES_2026 } from '../data/retirementTax';
import type { InvAccount, Person, RsuVest, Security, TaxLot } from '../types';
import type { HouseholdTax, PersonYear } from './payroll';
import { isLongTerm, netForTax, type Realized } from './lots';
import { rmdFactor, rmdStartAge } from '../data/retirementTax';
import { daysBetween } from './money';

/**
 * Year-end tax planning helpers: how much room is left in the bracket, whether withholding covers the tax, which tax lots have
 * losses worth harvesting, and what is left to do before December 31. Pure functions over what the Income tab and the lots
 * already know. All money in cents. These are estimates for planning, not tax advice.
 */

// ---------- bracket room ----------

export interface BracketRoom {
  /** Rate on the last dollar of ordinary income. */
  rate: number;
  /** Ordinary taxable income now (after the standard/itemized deduction, without long-term gains). */
  ordinaryTaxable: number;
  /** The top of the current bracket (Infinity for the 37% bracket). */
  top: number;
  /** More ordinary income that fits before the next bracket starts (e.g. a Roth conversion), or null in the top bracket. */
  roomCents: number | null;
  nextRate: number | null;
  /** How much more long-term gain fits in the 0% capital-gains band (taxable income up to the threshold). */
  zeroGainRoomCents: number;
}

export function bracketRoom(t: TaxTables, taxableIncome: number, longTermGains: number): BracketRoom {
  const ord = Math.max(0, taxableIncome - Math.min(longTermGains, taxableIncome));
  const b = t.fedBracketsMFJ;
  let i = 0;
  for (let k = 0; k < b.length; k++) if (ord > b[k].over) i = k;
  const top = i + 1 < b.length ? b[i + 1].over : Infinity;
  return {
    rate: b[i].rate,
    ordinaryTaxable: ord,
    top,
    roomCents: Number.isFinite(top) ? top - ord : null,
    nextRate: i + 1 < b.length ? b[i + 1].rate : null,
    zeroGainRoomCents: Math.max(0, RETIREMENT_RULES_2026.ltcg0Top - taxableIncome),
  };
}

// ---------- withholding and estimated payments ----------

export interface WithholdingPlan {
  /** Federal and MA: owed for the year, the withholding the schedule will produce, and the difference (negative = you owe). */
  federal: { owed: number; withheldToDate: number; projected: number; balance: number };
  ma: { owed: number; withheldToDate: number; projected: number; balance: number };
  /** Paychecks (and bonuses) still to come this year, by person. */
  remaining: { personId: number; checks: number }[];
  /** Paying at least this much (through withholding) avoids an underpayment penalty: the smaller of 90% of this year and 100%/110% of last year. */
  safeHarbor: { requiredCents: number; basis: string; met: boolean } | null;
  /** To close a federal shortfall: extra withholding per remaining paycheck for one person, or one payment before the January deadline. */
  extraPerCheck: { personId: number; cents: number }[];
  estimatedPaymentCents: number;
}

export function withholdingPlan(household: HouseholdTax, years: PersonYear[], today: string, prior: HouseholdTax | null): WithholdingPlan {
  const toDate = (f: (e: PersonYear['events'][number]) => number) => years.reduce((s, y) => s + y.events.filter((e) => e.date <= today).reduce((a, e) => a + f(e), 0), 0);
  const fed = household.federal;
  const ma = household.ma;
  const remaining = years.map((y) => ({ personId: y.personId, checks: y.events.filter((e) => e.date > today && e.kind !== 'rsu').length }));
  const balance = fed.balance;
  const extraPerCheck = balance < 0 ? remaining.filter((r) => r.checks > 0).map((r) => ({ personId: r.personId, cents: Math.ceil(-balance / r.checks) })) : [];

  let safeHarbor: WithholdingPlan['safeHarbor'] = null;
  const thisYear90 = Math.round(fed.totalLiability * 0.9);
  if (prior) {
    const mult = prior.federal.wages + prior.federal.otherIncome > 15000000 ? 1.1 : 1;
    const priorReq = Math.round(prior.federal.totalLiability * mult);
    const req = Math.min(thisYear90, priorReq);
    safeHarbor = { requiredCents: req, basis: req === thisYear90 ? '90% of this year’s tax' : `${mult === 1.1 ? '110%' : '100%'} of last year’s tax`, met: fed.withheld >= req };
  } else {
    safeHarbor = { requiredCents: thisYear90, basis: '90% of this year’s tax (no last-year figure to compare)', met: fed.withheld >= thisYear90 };
  }
  return {
    federal: { owed: fed.totalLiability, withheldToDate: toDate((e) => e.fedWithholding + e.addlMedicare), projected: fed.withheld, balance },
    ma: { owed: ma.totalLiability, withheldToDate: toDate((e) => e.stateWithholding), projected: ma.withheld, balance: ma.balance },
    remaining,
    safeHarbor,
    extraPerCheck,
    estimatedPaymentCents: balance < 0 ? -balance : 0,
  };
}

/** The usual estimated-tax due dates for a year (April 15, June 15, September 15, and January 15 of the next year). */
export function estimatedDueDates(year: number): string[] {
  return [`${year}-04-15`, `${year}-06-15`, `${year}-09-15`, `${year + 1}-01-15`];
}

// ---------- tax-loss harvesting ----------

export interface Harvest {
  lot: TaxLot;
  ticker: string;
  accountName: string;
  shares: number;
  lossCents: number;
  longTerm: boolean;
  /** The same security is also held in a tax-sheltered account: buying more there within 30 days of the sale can disallow the loss. */
  washRisk: boolean;
}

export function harvestCandidates(lots: TaxLot[], securities: Security[], accounts: InvAccount[], otherHoldings: { accountId: number; securityId: number }[], today: string): Harvest[] {
  const secById = new Map(securities.map((s) => [s.id!, s]));
  const acctById = new Map(accounts.map((a) => [a.id!, a]));
  const out: Harvest[] = [];
  for (const lot of lots) {
    const sec = secById.get(lot.securityId);
    const acct = acctById.get(lot.accountId);
    if (!sec || sec.priceCents == null || !acct || acct.closed || acct.taxType !== 'taxable') continue;
    const value = Math.round(lot.shares * sec.priceCents);
    const loss = lot.costBasisCents - value;
    if (loss <= 0 || lot.costBasisCents === 0) continue;
    const sheltered = otherHoldings.some((h) => h.securityId === lot.securityId && acctById.get(h.accountId)?.taxType !== 'taxable');
    out.push({ lot, ticker: sec.ticker, accountName: acct.name, shares: lot.shares, lossCents: loss, longTerm: isLongTerm(lot.acquiredDate, today), washRisk: sheltered });
  }
  return out.sort((a, b) => b.lossCents - a.lossCents);
}

/** Realized results after also selling the candidates (their losses added to the short- or long-term side). */
export function withHarvest(realized: Realized, picks: Harvest[]): Realized {
  const st = picks.filter((h) => !h.longTerm).reduce((s, h) => s - h.lossCents, 0);
  const lt = picks.filter((h) => h.longTerm).reduce((s, h) => s - h.lossCents, 0);
  const r = { ...realized, shortTermCents: realized.shortTermCents + st, longTermCents: realized.longTermCents + lt };
  r.netCents = r.shortTermCents + r.longTermCents;
  return r;
}

export { netForTax };

// ---------- checklist ----------

export interface CheckItem {
  id: string;
  title: string;
  detail: string;
  status: 'todo' | 'ok' | 'info';
  to?: string;
}

export interface ChecklistInput {
  today: string;
  year: number;
  people: Person[];
  years: PersonYear[];
  household: HouseholdTax | null;
  room: BracketRoom | null;
  vests: { vest: RsuVest; grossCents: number }[];
  invAccounts: InvAccount[];
  /** Current value of traditional (pre-tax) retirement money by owner id, used for a rough RMD estimate. */
  traditionalByOwner: Map<number, number>;
  itemizedCents: number;
  standardCents: number;
  appreciatedLots: Harvest[];
  fmt: (cents: number) => string;
}

export function yearEndChecklist(i: ChecklistInput): CheckItem[] {
  const out: CheckItem[] = [];
  const daysLeft = daysBetween(`${i.year}-12-31`, i.today);
  const name = (id: number) => i.people.find((p) => p.id === id)?.name ?? 'Person';

  for (const y of i.years) {
    const room = y.limits.k401 - (y.contributions.k401Pretax + y.contributions.k401Roth);
    if (y.limits.k401 > 0) {
      out.push({
        id: `k401-${y.personId}`,
        title: `${name(y.personId)}: 401(k) room`,
        detail: room > 100 ? `${i.fmt(room)} of the ${i.fmt(y.limits.k401)} limit is still unused at the current savings rate.` : 'On track to reach the yearly limit.',
        status: room > 100 ? 'todo' : 'ok',
        to: '/income',
      });
    }
    const hsaRoom = y.limits.hsa - y.contributions.hsa;
    if (y.limits.hsa > 0 && y.contributions.hsa + y.contributions.employerHsa > 0) {
      out.push({
        id: `hsa-${y.personId}`,
        title: `${name(y.personId)}: HSA room`,
        detail: hsaRoom > 100 ? `${i.fmt(hsaRoom)} more can go into the HSA this year (after the employer’s share).` : 'On track to reach the HSA limit.',
        status: hsaRoom > 100 ? 'todo' : 'ok',
        to: '/income',
      });
    }
  }

  if (i.room) {
    out.push({
      id: 'room',
      title: 'Roth conversion room',
      detail: i.room.roomCents === null
        ? `You are in the top (${Math.round(i.room.rate * 100)}%) bracket. Converting more would be taxed at that rate.`
        : `${i.fmt(i.room.roomCents)} more ordinary income fits in the ${Math.round(i.room.rate * 100)}% bracket before the ${Math.round((i.room.nextRate ?? 0) * 100)}% bracket starts.`,
      status: 'info',
      to: '/roth',
    });
  }

  const upcoming = i.vests.filter((v) => v.vest.date > i.today && v.vest.date.startsWith(`${i.year}-`));
  if (upcoming.length > 0) {
    out.push({ id: 'vests', title: 'RSU vests still to come this year', detail: `${upcoming.length} vest${upcoming.length === 1 ? '' : 's'} worth ${i.fmt(upcoming.reduce((s, v) => s + v.grossCents, 0))} before tax, already counted in the projection above.`, status: 'info', to: '/income' });
  }

  for (const p of i.people) {
    if (!p.birthYear) continue;
    const age = i.year - p.birthYear;
    if (age >= rmdStartAge(p.birthYear)) {
      const bal = i.traditionalByOwner.get(p.id!) ?? 0;
      const est = bal > 0 ? Math.round(bal / rmdFactor(age)) : 0;
      out.push({ id: `rmd-${p.id}`, title: `${p.name}: required minimum distribution`, detail: `Due by December 31. A rough estimate from today’s traditional balance is ${i.fmt(est)}; your custodian will give the exact amount from last year-end.`, status: 'todo', to: '/investments' });
    }
  }

  const gift = i.appreciatedLots.filter((h) => h.longTerm).slice(0, 3);
  out.push({
    id: 'charity',
    title: 'Charitable giving',
    detail: i.itemizedCents > i.standardCents
      ? 'You itemize, so gifts reduce your tax. Giving shares with large long-term gains avoids tax on the gain.'
      : `Your itemized deductions (${i.fmt(i.itemizedCents)}) are below the standard deduction (${i.fmt(i.standardCents)}), so gifts may not lower tax this year unless you bunch several years together.${gift.length ? ' Shares with large long-term gains are the most tax-efficient to give.' : ''}`,
    status: 'info',
    to: '/investments',
  });

  out.push({ id: 'days', title: 'Time left', detail: daysLeft > 0 ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} until December 31.` : 'The year has ended.', status: 'info' });
  return out;
}

/** Lots with large gains (shares worth giving to charity instead of cash). `lossCents` is negative: it holds minus the gain. */
export function appreciatedCandidates(lots: TaxLot[], securities: Security[], accounts: InvAccount[], today: string): Harvest[] {
  const secById = new Map(securities.map((s) => [s.id!, s]));
  const acctById = new Map(accounts.map((a) => [a.id!, a]));
  const out: Harvest[] = [];
  for (const lot of lots) {
    const sec = secById.get(lot.securityId);
    const acct = acctById.get(lot.accountId);
    if (!sec || sec.priceCents == null || !acct || acct.closed || acct.taxType !== 'taxable' || lot.costBasisCents === 0) continue;
    const gain = Math.round(lot.shares * sec.priceCents) - lot.costBasisCents;
    if (gain <= 0) continue;
    out.push({ lot, ticker: sec.ticker, accountName: acct.name, shares: lot.shares, lossCents: -gain, longTerm: isLongTerm(lot.acquiredDate, today), washRisk: false });
  }
  return out.sort((a, b) => a.lossCents - b.lossCents);
}
