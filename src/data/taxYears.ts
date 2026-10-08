// Tax tables by year. All money is in CENTS. Rates are fractions (0.05 = 5%).
// To add a new year: copy a year block, change the numbers, and add it to TAX_YEARS (or paste an
// edited copy in the app under Income -> Tax tables, which stores it in your browser).
//
// Sources for 2026 (checked 2026-10-08):
//  - IRS Rev. Proc. 2025-32 / IRS newsroom release on 2026 inflation adjustments (brackets, standard deduction, health FSA)
//  - IRS Notice 2025-67 (401(k) limits), SSA (wage base $184,500), IRS HSA limits for 2026
//  - Massachusetts DOR / mass.gov (5% rate, $8,800 MFJ exemption, $2,000-per-spouse FICA deduction)
//  - MA DFML (PFML employee share 0.46%)
// Items marked UNVERIFIED could not be confirmed from an official page; check them before relying on them.

export interface Bracket {
  /** Taxable income above this amount (cents) is taxed at `rate`. */
  over: number;
  rate: number;
}

export interface TaxTables {
  year: number;
  notes: string[];

  fedBracketsMFJ: Bracket[];
  stdDeductionMFJ: number;
  /** Flat rate used to withhold on bonuses / supplemental wages. */
  supplementalFedRate: number;

  ssRate: number;
  ssWageBase: number;
  medicareRate: number;
  addlMedicareRate: number;
  /** Employers start withholding the extra 0.9% on an employee's wages above this. */
  addlMedicareWithholdingThreshold: number;
  /** Actual liability threshold on a joint return (combined wages). */
  addlMedicareThresholdMFJ: number;

  limits: {
    k401Deferral: number;
    k401CatchUp50: number;
    /** Replaces the regular catch-up at ages 60-63. */
    k401CatchUp6063: number;
    hsaSelf: number;
    hsaFamily: number;
    hsaCatchUp55: number;
    healthFsa: number;
    dependentCareFsa: number;
    /** IRC 423 limit: $25,000 of stock (at grant-date value) per year. */
    esppStockValue: number;
  };

  ma: {
    rate: number;
    surtaxRate: number;
    /** UNVERIFIED for 2026: sources disagree; $1,083,150 is the most common figure. */
    surtaxThreshold: number;
    personalExemptionMFJ: number;
    dependentExemption: number;
    /** Deduction for Social Security + Medicare paid, per spouse, on their own wages. */
    ficaDeductionCapPerSpouse: number;
    pfmlEmployeeRate: number;
    /** UNVERIFIED: assumed equal to the Social Security wage base. */
    pfmlWageCap: number;
    withholdingRate: number;
    /** Annual allowance subtracted per person when estimating MA withholding (half of the MFJ exemption). */
    withholdingAllowancePerPerson: number;
  };
}

const d = (dollars: number) => Math.round(dollars * 100);

export const TAX_2026: TaxTables = {
  year: 2026,
  notes: [
    'Federal brackets, standard deduction, health FSA: IRS Rev. Proc. 2025-32.',
    '401(k) limits: IRS Notice 2025-67. Social Security wage base: SSA.',
    'UNVERIFIED: dependent care FSA ($7,500), HSA catch-up ($1,000, statutory), MA surtax threshold, MA PFML wage cap.',
    'UNVERIFIED: whether MA excludes 401(k) deferrals from state wages. Compare your W-2 Box 16 to Box 1 and change the "state exempt" box on the deduction if needed.',
    'Federal withholding per paycheck is an estimate of the IRS percentage method; the annual liability calculation is the more reliable figure.',
  ],

  fedBracketsMFJ: [
    { over: 0, rate: 0.1 },
    { over: d(24800), rate: 0.12 },
    { over: d(100800), rate: 0.22 },
    { over: d(211400), rate: 0.24 },
    { over: d(403550), rate: 0.32 },
    { over: d(512450), rate: 0.35 },
    { over: d(768700), rate: 0.37 },
  ],
  stdDeductionMFJ: d(32200),
  supplementalFedRate: 0.22,

  ssRate: 0.062,
  ssWageBase: d(184500),
  medicareRate: 0.0145,
  addlMedicareRate: 0.009,
  addlMedicareWithholdingThreshold: d(200000),
  addlMedicareThresholdMFJ: d(250000),

  limits: {
    k401Deferral: d(24500),
    k401CatchUp50: d(8000),
    k401CatchUp6063: d(11250),
    hsaSelf: d(4400),
    hsaFamily: d(8750),
    hsaCatchUp55: d(1000),
    healthFsa: d(3400),
    dependentCareFsa: d(7500),
    esppStockValue: d(25000),
  },

  ma: {
    rate: 0.05,
    surtaxRate: 0.04,
    surtaxThreshold: d(1083150),
    personalExemptionMFJ: d(8800),
    dependentExemption: d(1000),
    ficaDeductionCapPerSpouse: d(2000),
    pfmlEmployeeRate: 0.0046,
    pfmlWageCap: d(184500),
    withholdingRate: 0.05,
    withholdingAllowancePerPerson: d(4400),
  },
};

export const TAX_YEARS: Record<number, TaxTables> = {
  2026: TAX_2026,
};

/** Built-in table for a year, or null if we have none (the app then asks you to add one; it never guesses). */
export function builtInTables(year: number): TaxTables | null {
  return TAX_YEARS[year] ?? null;
}
