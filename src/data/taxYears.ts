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

/**
 * How far a built-in value can be trusted.
 *  - verified: read from an official publication for this tax year.
 *  - statutory: a fixed amount in law that is not indexed for inflation (carried unchanged; says so in `note`).
 *  - provisional: no official value for this year was found, so an earlier figure is carried and labelled. Treat as a placeholder.
 *  - approximation: a modelling shortcut Ledger already used (not an official table value).
 */
export type FieldStatus = 'verified' | 'statutory' | 'provisional' | 'approximation';

export interface TaxProvenance {
  /** Date the official sources were read (YYYY-MM-DD). */
  checkedOn: string;
  sources: { label: string; url: string; published: string }[];
  fields: { field: string; status: FieldStatus; note: string }[];
}

export interface TaxTables {
  year: number;
  notes: string[];
  /** Built-in tables only. Optional so saved custom tables (which do not carry it) stay valid. */
  provenance?: TaxProvenance;

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

// Sources for 2027 (read 2026-11-13). Full field-by-field table: docs/TAX-2027-UPDATE-REPORT.md.
//  - IRS Rev. Proc. 2026-35 (IR-2026-133, 2026-11-05): brackets, standard deduction, health FSA, capital-gains thresholds, aged/blind deduction.
//  - IRS Notice 2026-66 (IR-2026-136, 2026-11-12): 401(k) deferral and catch-up limits.
//  - IRS Rev. Proc. 2026-24 (IRB 2026-25, 2026-06-15): HSA limits.
//  - SSA 2027 COLA fact sheet: wage base, 7.65% employee rate, Additional Medicare thresholds.
//  - MA DFML (updated 2026-10-01): PFML 2027 contribution split. MA DOR exemptions page (updated 2026-10-30).
// NOT published when this was written: the Massachusetts 2027 surtax threshold (DOR lists 2023-2026 only). See `provenance`.
const SRC = {
  rp: { label: 'IRS Revenue Procedure 2026-35 (2027 inflation adjustments)', url: 'https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2027-taxpayers-continue-to-benefit-from-the-working-families-tax-cuts', published: '2026-11-05' },
  notice: { label: 'IRS Notice 2026-66 (2027 retirement plan limits)', url: 'https://www.irs.gov/newsroom/401k-limit-increases-to-25500-for-2027-ira-limit-remains-7500', published: '2026-11-12' },
  hsa: { label: 'IRS Revenue Procedure 2026-24 (2027 HSA limits)', url: 'https://www.irs.gov/irb/2026-25_irb', published: '2026-06-15' },
  ssa: { label: 'SSA 2027 COLA fact sheet', url: 'https://www.ssa.gov/cola/factsheets/2027.html', published: '2026-10' },
  dfml: { label: 'MA DFML PFML contribution rates', url: 'https://www.mass.gov/info-details/paid-family-and-medical-leave-employer-contribution-rates-and-calculator', published: '2026-10-01' },
  exemptions: { label: 'MA DOR personal income tax exemptions', url: 'https://www.mass.gov/info-details/personal-income-tax-exemptions', published: '2026-10-30' },
  dcfsa: { label: 'IRS: dependent care benefits exclusion is $7,500 from 2026 (P.L. 119-21 s.70404)', url: 'https://www.irs.gov/forms-pubs/correction-to-the-dependent-care-benefits-exclusion-amount-in-the-2026-general-instructions-for-forms-w-2-and-w-3', published: '2026' },
  surtax: { label: 'MA DOR 4% surtax (lists thresholds for 2023 to 2026 only)', url: 'https://www.mass.gov/info-details/massachusetts-4-surtax-on-taxable-income', published: '2026-06-01' },
};

export const TAX_2027: TaxTables = {
  year: 2027,
  notes: [
    'Federal brackets, standard deduction, health FSA: IRS Rev. Proc. 2026-35 (Nov. 5, 2026). 401(k) limits: IRS Notice 2026-66 (Nov. 12, 2026). HSA: Rev. Proc. 2026-24.',
    'Social Security wage base $192,300: SSA 2027 fact sheet. MA PFML: employee share stays 0.46% in 2027 (0.28% family + 0.18% medical), capped at the Social Security wage base.',
    'PROVISIONAL: the MA 4% surtax threshold. DOR has not published a 2027 figure, so the 2026 amount ($1,107,750) is carried as a placeholder. It is not a 2027 figure and may change when Massachusetts publishes 2027 guidance; surtax results above that income level are provisional.',
    'UNVERIFIED for 2027: MA 5% rate and $2,000 FICA deduction, MA withholding allowance, whether MA excludes 401(k) deferrals from state wages. Dependent care FSA $7,500 is fixed by law from 2026 (P.L. 119-21 s.70404, per IRS).',
    'Federal withholding per paycheck is an estimate of the IRS percentage method; the annual liability calculation is the more reliable figure.',
  ],
  provenance: {
    checkedOn: '2026-11-13',
    sources: [SRC.rp, SRC.notice, SRC.hsa, SRC.ssa, SRC.dfml, SRC.exemptions, SRC.dcfsa, SRC.surtax],
    fields: [
      { field: 'Federal MFJ brackets', status: 'verified', note: 'Rev. Proc. 2026-35 section 3.01 Table 1 (10% to $25,600 ... 37% over $793,650).' },
      { field: 'Standard deduction (MFJ)', status: 'verified', note: 'Rev. Proc. 2026-35 section 3.15: $33,200.' },
      { field: 'Supplemental wage withholding 22%', status: 'statutory', note: 'Flat rate set by regulation, not indexed. Not part of Rev. Proc. 2026-35; carried from 2026.' },
      { field: 'Social Security rate and wage base', status: 'verified', note: 'SSA: 6.2% and $192,300 for 2027.' },
      { field: 'Medicare rate, Additional Medicare 0.9% and thresholds', status: 'statutory', note: 'SSA and IRS Topics 560/751: 1.45%, 0.9% over $200,000 (employer withholding) and $250,000 joint. Fixed in law.' },
      { field: '401(k) deferral and catch-up limits', status: 'verified', note: 'Notice 2026-66: $25,500; age 50+ catch-up $8,500; ages 60-63 catch-up $11,750.' },
      { field: 'HSA self-only and family limits', status: 'verified', note: 'Rev. Proc. 2026-24 section 3.01: $4,500 and $9,000.' },
      { field: 'HSA age-55 catch-up', status: 'statutory', note: '$1,000 by statute (section 223(b)(3)), not indexed.' },
      { field: 'Health FSA limit', status: 'verified', note: 'Rev. Proc. 2026-35 section 3.16: $3,500.' },
      { field: 'Dependent care FSA limit', status: 'statutory', note: 'IRS: P.L. 119-21 section 70404 raised the exclusion to $7,500 beginning in 2026. A fixed statutory amount; not part of Rev. Proc. 2026-35. Not used in any calculation yet.' },
      { field: 'ESPP $25,000 stock limit', status: 'statutory', note: 'Section 423(b)(8), not indexed.' },
      { field: 'MA income tax rate 5%', status: 'approximation', note: 'Existing assumption. DOR pages read did not state a 2027 rate.' },
      { field: 'MA 4% surtax rate', status: 'statutory', note: '4% on income above the threshold (DOR surtax page).' },
      { field: 'MA 4% surtax threshold', status: 'provisional', note: 'Placeholder: this is the 2026 amount ($1,107,750), not a 2027 figure. DOR lists 2023-2026 only and indexes the threshold yearly; it may change when Massachusetts publishes 2027 guidance.' },
      { field: 'MA personal exemption (MFJ) and dependent exemption', status: 'statutory', note: 'DOR exemptions page (updated Oct. 30, 2026): $8,800 and $1,000. Fixed amounts; the page does not name a tax year.' },
      { field: 'MA FICA deduction cap per spouse', status: 'approximation', note: 'Existing $2,000 assumption, not re-checked against an official 2027 source.' },
      { field: 'MA PFML employee rate', status: 'verified', note: 'DFML: 2027 family leave 0.28% + medical leave 0.18% may be withheld from employees = 0.46%. The 0.88% total includes the employer share.' },
      { field: 'MA PFML wage cap', status: 'verified', note: 'DFML: individual contributions are capped at the Social Security taxable maximum ($192,300).' },
      { field: 'MA withholding rate and per-person allowance', status: 'approximation', note: 'Existing planning estimate (5% and half the joint exemption). Circular M for 2027 is not published.' },
    ],
  },

  fedBracketsMFJ: [
    { over: 0, rate: 0.1 },
    { over: d(25600), rate: 0.12 },
    { over: d(104050), rate: 0.22 },
    { over: d(218250), rate: 0.24 },
    { over: d(416650), rate: 0.32 },
    { over: d(529100), rate: 0.35 },
    { over: d(793650), rate: 0.37 },
  ],
  stdDeductionMFJ: d(33200),
  supplementalFedRate: 0.22,

  ssRate: 0.062,
  ssWageBase: d(192300),
  medicareRate: 0.0145,
  addlMedicareRate: 0.009,
  addlMedicareWithholdingThreshold: d(200000),
  addlMedicareThresholdMFJ: d(250000),

  limits: {
    k401Deferral: d(25500),
    k401CatchUp50: d(8500),
    k401CatchUp6063: d(11750),
    hsaSelf: d(4500),
    hsaFamily: d(9000),
    hsaCatchUp55: d(1000),
    healthFsa: d(3500),
    dependentCareFsa: d(7500),
    esppStockValue: d(25000),
  },

  ma: {
    rate: 0.05,
    surtaxRate: 0.04,
    surtaxThreshold: d(1107750),
    personalExemptionMFJ: d(8800),
    dependentExemption: d(1000),
    ficaDeductionCapPerSpouse: d(2000),
    pfmlEmployeeRate: 0.0046,
    pfmlWageCap: d(192300),
    withholdingRate: 0.05,
    withholdingAllowancePerPerson: d(4400),
  },
};

export const TAX_YEARS: Record<number, TaxTables> = {
  2026: TAX_2026,
  2027: TAX_2027,
};

/** Built-in table for a year, or null if we have none (the app then asks you to add one; it never guesses). */
export function builtInTables(year: number): TaxTables | null {
  return TAX_YEARS[year] ?? null;
}

/** The newest year that has a built-in table. */
export function latestBuiltInYear(): number {
  return Math.max(...Object.keys(TAX_YEARS).map(Number));
}
