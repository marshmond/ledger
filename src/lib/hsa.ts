import type { HsaWithdrawal, InvAccount, Person } from '../types';

/**
 * HSA withdrawals: spending on qualified medical costs is tax-free. Anything else is ordinary income, plus a 20% penalty
 * if the owner is under 65 (death and disability exceptions are not modeled). Money in cents.
 */

export interface HsaImpact {
  qualifiedCents: number;
  /** Non-qualified withdrawals: added to taxable income. */
  taxableCents: number;
  /** 20% of non-qualified withdrawals by owners under 65 (or with no known birth year). */
  penaltyCents: number;
  /** Withdrawals whose owner or birth year is unknown, so the penalty was assumed. */
  assumedUnder65: number;
}

export function hsaYearImpact(withdrawals: HsaWithdrawal[], accounts: InvAccount[], people: Person[], year: number): HsaImpact {
  const out: HsaImpact = { qualifiedCents: 0, taxableCents: 0, penaltyCents: 0, assumedUnder65: 0 };
  for (const w of withdrawals) {
    if (!w.date.startsWith(`${year}-`)) continue;
    if (w.qualified) {
      out.qualifiedCents += w.amountCents;
      continue;
    }
    out.taxableCents += w.amountCents;
    const owner = people.find((p) => p.id === accounts.find((a) => a.id === w.accountId)?.personId);
    const age = owner?.birthYear ? year - owner.birthYear : null;
    if (age === null) out.assumedUnder65++;
    if (age === null || age < 65) out.penaltyCents += Math.round(w.amountCents * 0.2);
  }
  return out;
}

/** Years that have any HSA withdrawals, newest first. */
export const withdrawalYears = (ws: HsaWithdrawal[]): number[] => [...new Set(ws.map((w) => Number(w.date.slice(0, 4))))].sort((a, b) => b - a);
