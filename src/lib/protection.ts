/**
 * Protection check: how long your cash would last, and rough guidelines for life insurance, disability insurance, and an umbrella
 * policy compared with the coverage you have entered. These are common rules of thumb, not advice for your situation. Money in cents.
 */

export type PolicyType = 'life' | 'disability' | 'umbrella' | 'ltc' | 'home' | 'auto' | 'health' | 'other';

export interface Policy {
  id: string;
  type: PolicyType;
  /** The person insured (life, disability, long-term care), or null for the household. */
  personId: number | null;
  company: string;
  policyNumber: string;
  /** Death benefit, liability limit, or the amount of coverage. */
  coverageCents: number;
  /** Disability: the monthly benefit. */
  monthlyBenefitCents: number;
  annualPremiumCents: number;
  beneficiary: string;
  note: string;
}

export const POLICY_LABEL: Record<PolicyType, string> = {
  life: 'Life insurance',
  disability: 'Disability insurance',
  umbrella: 'Umbrella liability',
  ltc: 'Long-term care',
  home: 'Home or renters',
  auto: 'Auto',
  health: 'Health',
  other: 'Other',
};

export const newPolicy = (type: PolicyType, personId: number | null = null): Policy => ({
  id: `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`,
  type,
  personId,
  company: '',
  policyNumber: '',
  coverageCents: 0,
  monthlyBenefitCents: 0,
  annualPremiumCents: 0,
  beneficiary: '',
  note: '',
});

// ---------- emergency fund ----------

export interface EmergencyFund {
  months: number | null;
  targetMonths: number;
  status: 'low' | 'ok' | 'good' | 'unknown';
  /** Cash still needed to reach the target (0 if you are there). */
  shortfallCents: number;
}

/** Months of spending your cash would cover. The target is 6 months for a one-income household, 3 to 6 otherwise (we use 4). */
export function emergencyFund(cashCents: number, monthlyEssentialCents: number, earners: number): EmergencyFund {
  const targetMonths = earners <= 1 ? 6 : 4;
  if (monthlyEssentialCents <= 0) return { months: null, targetMonths, status: 'unknown', shortfallCents: 0 };
  const months = cashCents / monthlyEssentialCents;
  const status = months < Math.min(3, targetMonths) ? 'low' : months >= targetMonths ? 'good' : 'ok';
  return { months, targetMonths, status, shortfallCents: Math.max(0, Math.round(targetMonths * monthlyEssentialCents - cashCents)) };
}

// ---------- life insurance ----------

export interface LifeNeedInput {
  grossAnnualCents: number;
  yearsOfIncome: number;
  /** All debts the family would still owe (mortgage, loans, cards). */
  debtsCents: number;
  /** Future education costs for the kids. */
  educationCents: number;
  /** Savings and investments that could be used instead of insurance. */
  assetsCents: number;
  /** Count those assets against the need. */
  subtractAssets: boolean;
  coverageCents: number;
}

export interface LifeNeed {
  /** Income to replace plus debts and education. */
  needCents: number;
  netNeedCents: number;
  coverageCents: number;
  gapCents: number;
  /** Coverage as a multiple of yearly income. */
  multiple: number | null;
}

/** The "DIME" rule: Debt + Income for several years + Mortgage (here, all debts) + Education. */
export function lifeNeed(i: LifeNeedInput): LifeNeed {
  const need = Math.round(i.grossAnnualCents * i.yearsOfIncome) + i.debtsCents + i.educationCents;
  const net = Math.max(0, need - (i.subtractAssets ? i.assetsCents : 0));
  return { needCents: need, netNeedCents: net, coverageCents: i.coverageCents, gapCents: Math.max(0, net - i.coverageCents), multiple: i.grossAnnualCents > 0 ? i.coverageCents / i.grossAnnualCents : null };
}

// ---------- disability ----------

export interface DisabilityNeed {
  /** What to replace each month: a share of gross pay (employers' plans usually cover about 60%). */
  neededMonthlyCents: number;
  benefitMonthlyCents: number;
  gapMonthlyCents: number;
}

export function disabilityNeed(grossAnnualCents: number, benefitMonthlyCents: number, replacePct = 60): DisabilityNeed {
  const needed = Math.round((grossAnnualCents / 12) * (replacePct / 100));
  return { neededMonthlyCents: needed, benefitMonthlyCents, gapMonthlyCents: Math.max(0, needed - benefitMonthlyCents) };
}

// ---------- umbrella ----------

export interface UmbrellaNeed {
  /** Suggested limit: at least your net worth, in $1,000,000 steps (never less than $1,000,000). */
  suggestedCents: number;
  coverageCents: number;
  gapCents: number;
}

export function umbrellaNeed(netWorthCents: number, coverageCents: number): UmbrellaNeed {
  const million = 100000000;
  const suggested = Math.max(million, Math.ceil(Math.max(0, netWorthCents) / million) * million);
  return { suggestedCents: suggested, coverageCents, gapCents: Math.max(0, suggested - coverageCents) };
}

// ---------- findings ----------

export interface Finding {
  id: string;
  level: 'warn' | 'ok' | 'info';
  title: string;
  detail: string;
}

export interface FindingsInput {
  fund: EmergencyFund;
  people: { id: number; name: string; grossAnnualCents: number; life: LifeNeed; disability: DisabilityNeed; hasLifePolicy: boolean; hasDisabilityPolicy: boolean }[];
  umbrella: UmbrellaNeed;
  dependents: boolean;
  fmt: (cents: number) => string;
}

export function findings(i: FindingsInput): Finding[] {
  const out: Finding[] = [];
  const f = i.fund;
  if (f.status === 'unknown') out.push({ id: 'fund', level: 'info', title: 'Emergency fund', detail: 'Enter your monthly spending to see how many months your cash would last.' });
  else if (f.status === 'low') out.push({ id: 'fund', level: 'warn', title: `Cash covers only ${f.months!.toFixed(1)} months`, detail: `Aim for ${f.targetMonths} months. About ${i.fmt(f.shortfallCents)} more would get you there.` });
  else if (f.status === 'ok') out.push({ id: 'fund', level: 'info', title: `Cash covers ${f.months!.toFixed(1)} months`, detail: `A decent cushion; ${f.targetMonths} months is the usual target for your household.` });
  else out.push({ id: 'fund', level: 'ok', title: `Cash covers ${f.months!.toFixed(1)} months`, detail: 'You have a solid emergency fund.' });

  for (const p of i.people) {
    if (p.grossAnnualCents <= 0) continue;
    if (p.life.gapCents > 0 && (i.dependents || p.life.needCents > p.life.coverageCents)) {
      out.push({ id: `life-${p.id}`, level: p.life.coverageCents === 0 ? 'warn' : 'info', title: `${p.name}: life insurance gap of about ${i.fmt(p.life.gapCents)}`, detail: p.hasLifePolicy ? `Entered coverage is ${i.fmt(p.life.coverageCents)} against a rough need of ${i.fmt(p.life.netNeedCents)}. Employer group coverage counts too if you add it.` : 'No life policy is entered. If your employer provides group life insurance, add it.' });
    } else if (p.life.needCents > 0) out.push({ id: `life-${p.id}`, level: 'ok', title: `${p.name}: life coverage looks adequate`, detail: `Coverage ${i.fmt(p.life.coverageCents)} against a rough need of ${i.fmt(p.life.netNeedCents)}.` });
    if (p.disability.gapMonthlyCents > 0) {
      out.push({ id: `dis-${p.id}`, level: p.hasDisabilityPolicy ? 'info' : 'warn', title: `${p.name}: disability benefit falls short by ${i.fmt(p.disability.gapMonthlyCents)} a month`, detail: `Replacing 60% of pay takes ${i.fmt(p.disability.neededMonthlyCents)} a month; entered benefits are ${i.fmt(p.disability.benefitMonthlyCents)}. Many employers offer long-term disability: add it if you have it.` });
    } else out.push({ id: `dis-${p.id}`, level: 'ok', title: `${p.name}: disability coverage looks adequate`, detail: `Benefits of ${i.fmt(p.disability.benefitMonthlyCents)} a month against about ${i.fmt(p.disability.neededMonthlyCents)} needed.` });
  }

  if (i.umbrella.gapCents > 0) out.push({ id: 'umbrella', level: i.umbrella.coverageCents === 0 ? 'warn' : 'info', title: 'Umbrella liability coverage', detail: `A common guideline is a limit at least as large as your net worth: about ${i.fmt(i.umbrella.suggestedCents)}. You have ${i.fmt(i.umbrella.coverageCents)} entered.` });
  else out.push({ id: 'umbrella', level: 'ok', title: 'Umbrella coverage meets the guideline', detail: `${i.fmt(i.umbrella.coverageCents)} against a suggested ${i.fmt(i.umbrella.suggestedCents)}.` });
  return out;
}
