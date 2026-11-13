// Extra tax rules the Roth conversion planner needs beyond the Income tab's tables. All money in CENTS.
// 2026 figures (checked 2026-10-14 against secondary summaries of IRS Rev. Proc. 2025-32 / 2025-25, CMS, and HHS):
//  - Long-term capital gains thresholds (joint): 0% to $98,900, 15% to $613,700, 20% above.
//  - Additional standard deduction 65+: $1,650 per spouse (joint). Senior deduction: $6,000 per person 65+, tax years 2025-2028,
//    reduced by 6% of AGI over $150,000 (joint), gone at $250,000.
//  - IRMAA (2026, based on 2024 income, joint): tiers at $218,000 / $274,000 / $342,000 / $410,000 / $750,000.
//  - ACA: 2026 coverage uses the 2025 poverty guideline ($21,150 for two people). The 400% cliff is back after 2025.
// UNVERIFIED (could not be confirmed from the primary IRS/CMS pages): the ACA applicable-percentage table (one source shows 9.86%
// instead of 9.96% at the top), the Part B/D IRMAA dollar amounts, MA age-65 exemption ($700), and the senior-deduction phase-out detail.
// Statutory amounts that are NOT indexed to inflation (Social Security taxation thresholds, NIIT threshold, the senior deduction)
// stay fixed in the planner's later years; everything else is scaled by your inflation assumption.

const d = (dollars: number) => Math.round(dollars * 100);

export interface RetirementTaxRules {
  year: number;
  notes: string[];
  /** Long-term capital gains / qualified dividend thresholds (joint). Indexed. */
  ltcg0Top: number;
  ltcg15Top: number;
  /** Extra standard deduction per spouse age 65+. Indexed. */
  addlStdDeduction65: number;
  /** Senior deduction per person age 65+, through `seniorDeductionLastYear`. Not indexed. */
  seniorDeduction: number;
  seniorPhaseStart: number;
  seniorPhaseRate: number;
  seniorDeductionLastYear: number;
  /** Social Security taxation (joint): not indexed. */
  ssBase1: number;
  ssBase2: number;
  /** Net investment income tax. Threshold not indexed. */
  niitRate: number;
  niitThreshold: number;
  /** Massachusetts: extra exemption per person 65+. */
  maExemption65: number;
  /** IRMAA: income tiers (joint, indexed) and the extra yearly cost per person on Medicare at each tier (Part B + Part D surcharges). */
  irmaaThresholds: number[];
  irmaaPerPerson: number[];
  /** ACA: federal poverty guideline for two people used for the plan year, and the applicable-percentage knots [income/FPL, share of income]. */
  fplTwo: number;
  acaCliff: number;
  acaKnots: [number, number][];
  /** Medicare starts at this age (people on Medicare are not on the marketplace). */
  medicareAge: number;
}

export const RETIREMENT_RULES_2026: RetirementTaxRules = {
  year: 2026,
  notes: [
    'Capital gains thresholds, standard and senior deductions, Social Security taxation, NIIT: IRS Rev. Proc. 2025-32 and the statute.',
    'IRMAA tiers and surcharges: CMS 2026 Medicare premiums. The planner applies the tier from income two years earlier, as Medicare does.',
    'ACA: 2025 poverty guideline for two people ($21,150); the 400% cliff returns for 2026 (the enhanced subsidies were not extended).',
    'UNVERIFIED: ACA applicable-percentage table, IRMAA dollar amounts, the MA age-65 exemption, and the senior-deduction phase-out detail.',
    'Later years scale the indexed amounts (brackets, deductions, IRMAA tiers, poverty guideline) by your inflation assumption. The law could change.',
  ],
  ltcg0Top: d(98900),
  ltcg15Top: d(613700),
  addlStdDeduction65: d(1650),
  seniorDeduction: d(6000),
  seniorPhaseStart: d(150000),
  seniorPhaseRate: 0.06,
  seniorDeductionLastYear: 2028,
  ssBase1: d(32000),
  ssBase2: d(44000),
  niitRate: 0.038,
  niitThreshold: d(250000),
  maExemption65: d(700),
  irmaaThresholds: [d(218000), d(274000), d(342000), d(410000), d(750000)],
  // yearly cost per person on Medicare = 12 x (Part B surcharge + Part D surcharge) at that tier
  irmaaPerPerson: [
    Math.round(12 * (81.2 + 14.5) * 100),
    Math.round(12 * (202.9 + 37.5) * 100),
    Math.round(12 * (324.6 + 60.4) * 100),
    Math.round(12 * (446.3 + 83.3) * 100),
    Math.round(12 * (487.0 + 91.0) * 100),
  ],
  fplTwo: d(21150),
  acaCliff: 4,
  acaKnots: [
    [1.33, 0.0314],
    [1.5, 0.0419],
    [2, 0.066],
    [2.5, 0.0844],
    [3, 0.0996],
    [4, 0.0996],
  ],
  medicareAge: 65,
};

/**
 * 2027 rules (read 2026-11-13). VERIFIED from IRS Rev. Proc. 2026-35: capital-gains thresholds (joint 0% to $102,100, 15% to
 * $633,600, section 3.03) and the extra standard deduction for age 65+ ($1,700 per spouse, section 3.15(3)). MA age-65 exemption
 * ($700): MA DOR exemptions page, updated 2026-10-30. UNCHANGED STATUTORY: senior deduction, Social Security taxation thresholds, NIIT.
 * NOT VERIFIED FOR 2027, carried from 2026 and labelled in the notes: IRMAA tiers and surcharges, the poverty guideline, and the ACA table.
 */
export const RETIREMENT_RULES_2027: RetirementTaxRules = {
  ...RETIREMENT_RULES_2026,
  year: 2027,
  notes: [
    'VERIFIED for 2027 (IRS Rev. Proc. 2026-35): long-term capital gains thresholds for joint filers (0% to $102,100, 15% to $633,600) and the extra standard deduction for age 65+ ($1,700 per spouse).',
    'Unchanged by law (not indexed): the $6,000 senior deduction (tax years 2025-2028), Social Security taxation thresholds ($32,000 / $44,000), and the net investment income tax ($250,000 joint).',
    'NOT VERIFIED for 2027: IRMAA tiers and surcharges, the ACA poverty guideline and applicable-percentage table, and the senior-deduction phase-out detail. These are 2026 figures carried forward.',
    'Later years scale the indexed amounts (brackets, deductions, IRMAA tiers, poverty guideline) by your inflation assumption. The law could change.',
  ],
  ltcg0Top: d(102100),
  ltcg15Top: d(633600),
  addlStdDeduction65: d(1700),
};

/** Built-in rules by tax year. A year with no entry has no verified rules; `retirementRulesFor` says so instead of guessing. */
export const RETIREMENT_RULES: Record<number, RetirementTaxRules> = {
  2026: RETIREMENT_RULES_2026,
  2027: RETIREMENT_RULES_2027,
};

/**
 * The rules to use for a tax year. `exact` is false when the year has no entry: the newest earlier year is used (the earliest
 * known year for a year before any entry) and callers should say so, so an older year's thresholds are never presented as the year's own.
 */
export function retirementRulesFor(year: number): { rules: RetirementTaxRules; ruleYear: number; exact: boolean } {
  const known = Object.keys(RETIREMENT_RULES).map(Number).sort((a, b) => a - b);
  const exact = RETIREMENT_RULES[year];
  if (exact) return { rules: exact, ruleYear: year, exact: true };
  const earlier = known.filter((y) => y < year).pop();
  const ruleYear = earlier ?? known[0];
  return { rules: RETIREMENT_RULES[ruleYear], ruleYear, exact: false };
}

/** IRS Uniform Lifetime Table (distribution period by age at year end), used from 2022 on. */
export const UNIFORM_LIFETIME: Record<number, number> = {
  72: 27.4, 73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9, 78: 22.0, 79: 21.1, 80: 20.2, 81: 19.4, 82: 18.5, 83: 17.7, 84: 16.8,
  85: 16.0, 86: 15.2, 87: 14.4, 88: 13.7, 89: 12.9, 90: 12.2, 91: 11.5, 92: 10.8, 93: 10.1, 94: 9.5, 95: 8.9, 96: 8.4, 97: 7.8,
  98: 7.3, 99: 6.8, 100: 6.4, 101: 6.0, 102: 5.6, 103: 5.2, 104: 4.9, 105: 4.6, 106: 4.3, 107: 4.1, 108: 3.9, 109: 3.7, 110: 3.5,
  111: 3.4, 112: 3.3, 113: 3.1, 114: 3.0, 115: 2.9, 116: 2.8, 117: 2.7, 118: 2.5, 119: 2.3, 120: 2.0,
};

/** SECURE 2.0: RMDs start at 73 for people born 1951-1959 and 75 for 1960 or later (72 for 1950 or earlier). */
export function rmdStartAge(birthYear: number): number {
  if (birthYear <= 1950) return 72;
  if (birthYear <= 1959) return 73;
  return 75;
}

export function rmdFactor(age: number): number {
  if (age < 72) return Infinity;
  return UNIFORM_LIFETIME[Math.min(120, age)] ?? 2;
}
