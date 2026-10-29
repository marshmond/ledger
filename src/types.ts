// Money is always integer cents. Dates are 'YYYY-MM-DD' strings.
// Amounts are signed from the account's point of view: negative = money out / debt up.
// A credit card with a balance of -50000 means $500.00 owed.

export type AccountKind = 'checking' | 'savings' | 'credit_card' | 'loan';

export interface Account {
  id?: number;
  name: string;
  kind: AccountKind;
  openingBalanceCents: number;
  openingDate: string;
  closed?: boolean;
  /** Credit cards only: the card's limit, if you want to see how much credit is left. */
  creditLimitCents?: number;
}

export interface CategoryGroup {
  id?: number;
  name: string;
  /** Place in the owner's chosen order (see lib/order); unset sorts last. */
  order?: number;
}

export interface Category {
  id?: number;
  groupId: number | null;
  name: string;
  hidden?: boolean;
  /** Income categories feed Ready to Assign instead of being budgeted. Default: expense. */
  kind?: 'expense' | 'income';
  /** Place within its group in the owner's chosen order; unset sorts last. */
  order?: number;
}

/** Money given a job: one row per month per budget line. */
export interface Assignment {
  id?: number;
  month: string; // 'YYYY-MM'
  /** `c<categoryId>` for a category, `p<cardAccountId>` for a card's payment line. */
  key: string;
  amountCents: number;
}

export type Frequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly' | 'quarterly' | 'yearly';

export interface RecurringRule {
  id?: number;
  accountId: number;
  payee: string;
  /** Signed from the account's point of view, like a transaction. */
  amountCents: number;
  categoryId: number | null;
  /** If set, posting creates a transfer with this account instead of a categorized transaction. */
  transferAccountId?: number | null;
  memo: string;
  frequency: Frequency;
  startDate: string;
  endDate?: string | null;
  /** For semimonthly: the two days of month (31 = last day). */
  semiDays?: [number, number];
  active: boolean;
}

export interface RecurringLog {
  id?: number;
  ruleId: number;
  /** The scheduled date this entry refers to (not the edited posting date). */
  date: string;
  action: 'posted' | 'skipped';
  txnId?: number;
}

export type TxnStatus = 'pending' | 'cleared' | 'reconciled';

export interface Split {
  categoryId: number | null;
  amountCents: number;
}

export interface Txn {
  id?: number;
  accountId: number;
  date: string;
  amountCents: number;
  payee: string;
  memo: string;
  status: TxnStatus;
  /** Single-category default. Ignored when `splits` is present. */
  categoryId: number | null;
  /** Optional split across categories; amounts must sum to amountCents. */
  splits?: Split[];
  /** Set on both halves of a transfer; points at the other half. */
  transferTxnId?: number | null;
  /** Bank-provided id from a CSV, if the file had one. */
  externalId?: string;
  /** Dedupe key for CSV-imported rows. */
  fingerprint?: string;
  /** Set only on rows created by an import batch. */
  importBatchId?: number | null;
  /** Set when approved from a scheduled (recurring) item. */
  recurringId?: number;
}

export interface ImportBatch {
  id?: number;
  accountId: number;
  filename: string;
  importedAt: string;
  createdCount: number;
  /** Manual transactions that were matched (marked cleared) rather than duplicated. */
  matched: { txnId: number; prevStatus: TxnStatus }[];
}

// ---- Income / payroll model (Phase 3) ----

export interface Person {
  id?: number;
  name: string;
  /** Used for 401(k)/HSA catch-up eligibility. */
  birthYear?: number | null;
}

export type DeductionType =
  | 'k401_pretax'
  | 'k401_roth'
  | 'hsa'
  | 'health'
  | 'dental'
  | 'vision'
  | 'fsa'
  | 'espp'
  | 'custom';

export interface DeductionItem {
  id: string;
  type: DeductionType;
  name: string;
  /** percent: `value` is a percentage of gross (6 = 6%). fixed: `value` is cents per paycheck (per YEAR in annual mode). */
  mode: 'percent' | 'fixed';
  value: number;
  fedExempt: boolean;
  ficaExempt: boolean;
  stateExempt: boolean;
  /** Percent items only: also taken from bonuses. */
  appliesToBonus: boolean;
}

/** A pay day within a month: 1-31 (31 = the last day, safe in short months) or the last business day. */
export type PayDay = number | 'lastBusiness';

export interface MatchConfig {
  /** 'match' (default): a share of what you contribute. 'flat': a % of your pay, whether or not you contribute. */
  formula?: 'match' | 'flat';
  /** Flat formula: employer contributes this % of eligible pay. */
  flatPctOfPay?: number;
  /** Optional yearly dollar maximum on the employer contribution (either formula). */
  annualCapCents?: number | null;
  /** Employer contributes this % of your contribution... */
  ratePct: number;
  /** ...up to this % of your pay. (50% up to 6% => ratePct 50, upToPctOfPay 6) */
  upToPctOfPay: number;
  /** Year-end true-up: match is computed on annual totals, so it is not lost if you hit the 401(k) limit early. */
  trueUp: boolean;
  appliesToBonus: boolean;
}

export interface IncomeProfile {
  id?: number;
  personId: number;
  year: number;
  /** 'paycheck' follows your actual pay schedule; 'annual' spreads everything over 12 monthly pays. */
  mode: 'paycheck' | 'annual';
  frequency: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';
  /** Any real pay date; the schedule continues from it. */
  firstPayDate: string;
  semiDays?: [number, number];
  /** Pay days within the month: two for twice-a-month pay, one for monthly. Takes precedence over semiDays / firstPayDate. */
  payDays?: PayDay[];
  /** If a pay day lands on a weekend, pay on the prior business day (holidays are not considered). */
  weekendAdjust?: boolean;
  /** Benefit switches. Unset means "on if a matching deduction already exists". */
  esppEnrolled?: boolean;
  hasHsa?: boolean;
  /** Raises: the last entry on or before a pay date applies. */
  salary: { effectiveDate: string; annualCents: number }[];
  deductions: DeductionItem[];
  match?: MatchConfig | null;
  employerHsaAnnualCents: number;
  hsaCoverage: 'self' | 'family';
  /** ESPP purchase discount, used for the IRS $25,000 limit. */
  esppDiscountPct: number;
  /** Withholding on RSU vests, in percent. Unset: the federal supplemental rate and the MA flat rate from the tax tables. */
  rsuWithholding?: { fedPct: number; statePct: number };
  fedWithholding: { mode: 'estimate' | 'manual'; manualPerPaycheckCents: number; twoJobs: boolean; extraPerPaycheckCents: number };
  stateWithholding: { mode: 'estimate' | 'manual'; manualPerPaycheckCents: number };
}

/** A bonus, entered by month because the pay date is unpredictable. Assumed paid mid-month. */
export interface Bonus {
  id?: number;
  personId: number;
  year: number;
  month: number; // 1-12
  grossCents: number;
  label: string;
}

/**
 * One RSU vest. 'cash' awards pay out in cash at a fixed (synthetic or deal) price per share, so there is no ticker.
 * 'stock' awards vest as shares of a security: the value uses the security's price unless the actual vest price is known.
 */
export type VestFrequency = 'monthly' | 'quarterly' | 'semiannual' | 'annual';

/**
 * An RSU grant whose vest dates are worked out from a start date and a schedule. The vests themselves are ordinary RsuVest rows
 * (linked by grantId) that exist once shares are entered, so everything that reads vests works unchanged.
 */
export interface RsuGrant {
  id?: number;
  personId: number;
  name: string;
  /** First day of the agreement (YYYY-MM-DD); vests fall on this day of the month. */
  startDate: string;
  frequency: VestFrequency;
  /** Length of the agreement in whole years. */
  years: number;
  /** Optional: the first vest is this many months after the start (the regular schedule continues from the start date). */
  cliffMonths?: number | null;
  kind: 'cash' | 'stock';
  /** Cash grants: the synthetic price per share every vest uses unless it has its own. */
  priceCents?: number | null;
  /** Stock grants: the security (found or created from the ticker). */
  securityId?: number | null;
  afterVest?: 'held' | 'sold';
  accountId?: number | null;
}

export interface RsuVest {
  id?: number;
  personId: number;
  date: string;
  grant: string;
  /** Set when the vest belongs to a generated grant (see RsuGrant). */
  grantId?: number | null;
  kind: 'cash' | 'stock';
  shares: number;
  /** Cash: the synthetic price per share (required). Stock: the actual price on the vest date, once known (optional). */
  priceCents?: number | null;
  /** Stock only. */
  securityId?: number | null;
  /** Stock only: shares are kept (added to a holding at the vest price) or sold at once (cash income). */
  afterVest?: 'held' | 'sold';
  /** Held shares go to this investment account. */
  accountId?: number | null;
  /** Held shares have been added to the account's holdings. */
  recorded?: boolean;
}

export interface TaxSettings {
  id?: number;
  year: number;
  /** If larger than the standard deduction, used instead. */
  itemizedDeductionCents: number;
  otherIncomeCents: number;
  /** e.g. child tax credit; entered by you. */
  federalCreditsCents: number;
  maDependents: number;
  maCreditsCents: number;
  /** JSON of an edited TaxTables for this year, if you changed the built-in one. */
  tablesOverride?: string;
}

// ---- Investments (Phase 4) ----

export type InvKind = 'brokerage' | 'ira' | '401k' | '529' | 'hsa';
export type InvTaxType = 'taxable' | 'traditional' | 'roth' | '529' | 'hsa';

export interface InvAccount {
  id?: number;
  name: string;
  kind: InvKind;
  /** IRAs and 401(k)s can be traditional or Roth; brokerage is taxable; 529 is its own bucket. */
  taxType: InvTaxType;
  personId?: number | null;
  /** Uninvested cash sitting in the account. */
  cashCents: number;
  /** Planned contribution per year for projections (today's dollars at year 1). */
  annualContributionCents: number;
  /** Yearly increase in the contribution, e.g. 3 = 3% more each year. */
  contributionGrowthPct: number;
  /** 401(k) and HSA: take contributions from the Income model (your deferrals + employer match / HSA saving + employer HSA money). */
  linkToIncome: boolean;
  closed?: boolean;
}

export type AssetKind = 'equity' | 'bond' | 'cash' | 'real_estate' | 'balanced' | 'other';

/** An asset class carries the return/volatility ASSUMPTIONS used in projections. They are assumptions, not forecasts. */
export interface AssetClass {
  id?: number;
  name: string;
  kind: AssetKind;
  /** Long-run compound (geometric, CAGR) nominal return per year, in percent. */
  expectedReturnPct: number;
  /** Standard deviation of yearly returns, in percent. */
  volatilityPct: number;
}

export interface Security {
  id?: number;
  ticker: string;
  name: string;
  /** The vehicle itself carries its asset class (e.g. a target-date fund is one class). */
  assetClassId: number;
  priceCents: number | null;
  priceDate: string | null;
  priceSource: 'manual' | 'api' | null;
}

export interface Holding {
  id?: number;
  accountId: number;
  securityId: number;
  shares: number;
  costBasisCents: number | null;
}

export interface AppSetting {
  key: string;
  value: unknown;
}

// ---- Goals, windfalls, retirement (Phase 5) ----

/** A one-time inflow (or outflow, if negative) to the portfolio, in a given calendar year. */
export interface Windfall {
  id?: number;
  label: string;
  year: number;
  /** Signed: positive = money in (inheritance, equity sale), negative = money out (large purchase). */
  amountCents: number;
  /** If true the amount is in today's dollars and is inflated to the year it arrives. */
  todaysDollars: boolean;
  /** Turn off to see the plan without it. */
  include: boolean;
}

/** Income received in retirement that reduces what must come from the portfolio (Social Security, pension...). */
export interface IncomeStream {
  id: string;
  label: string;
  /** Per year, in today's dollars, after tax. Assumed to rise with inflation. */
  annualCents: number;
  startYear: number;
  endYear?: number | null;
}

export interface RetirementSettings {
  retireYear: number;
  /** Years of retirement to fund. */
  planYears: number;
  /** Yearly spending in retirement, today's dollars, after tax. */
  spendingCents: number;
  /** Effective tax rate applied to what is withdrawn from the portfolio (grosses withdrawals up). */
  taxRatePct: number;
  streams: IncomeStream[];
  /** If set, the stock share of the portfolio from retirement on (uses your first stock and bond classes). */
  equityPctAtRetirement: number | null;
  /** How sure you want to be that the money lasts (used to find sustainable spending). */
  targetConfidencePct: number;
  sims: number;
  /** Add your scheduled loan payments (principal + interest) to retirement withdrawals. Off by default: your spending figure may already include them. */
  includeDebtPayments?: boolean;
}

/** A savings goal funded by one account over time, then drawn down (college, etc.). */
export interface Goal {
  id?: number;
  name: string;
  /** Investment account that funds it (its balance and mix are used). */
  accountId: number | null;
  /** First calendar year a cost is paid. */
  startYear: number;
  /** Number of years of costs. */
  years: number;
  /** Yearly cost in today's dollars. */
  annualCostCents: number;
  /** Cost inflation per year (college costs have historically outpaced general inflation). */
  costInflationPct: number;
  /** Share of the cost you intend to fund from this account. */
  fundingPct: number;
  contributionGrowthPct: number;
  /** How sure you want to be that it is fully funded. */
  confidencePct: number;
}

// ---- Debt (mortgage, HELOC, other loans) ----

export type LoanKind = 'mortgage' | 'heloc' | 'auto' | 'student' | 'personal' | 'other';

export interface Loan {
  id?: number;
  name: string;
  kind: LoanKind;
  /** A new or what-if loan: shown and calculated, but not counted in your debt totals and never tied to the ledger. */
  scenario?: boolean;
  /**
   * 'original': built from the original amount, term, and first payment date.
   * 'current': built from today's balance and the months remaining. (HELOCs always use 'current'.)
   */
  setup: 'original' | 'current';
  originalAmountCents?: number;
  termMonths?: number;
  firstPaymentDate?: string;
  balanceCents?: number;
  /** The date `balanceCents` is as of. */
  asOfDate?: string;
  /** Date of the next payment due (payments continue on this day each month). */
  nextPaymentDate?: string;
  remainingMonths?: number;
  /** Current annual rate in percent. Later changes go in the rate-change list. */
  annualRatePct: number;
  /** Your actual monthly principal-and-interest payment, if you know it (it overrides the calculated one at the start). */
  paymentOverrideCents?: number | null;
  /** Shown as part of the monthly total; they do not affect the loan balance. */
  escrowMonthlyCents?: number;
  pmiMonthlyCents?: number;
  heloc?: { drawStartDate: string; drawMonths: number; repayMonths: number; creditLimitCents?: number | null };
  /**
   * What extra principal does between rate changes. 'shorten': keep the payment and finish early.
   * 'lower': recalculate a lower payment over the remaining term. (A rate change always recalculates.)
   */
  extraMode: 'shorten' | 'lower';
  /** What-if: add this many points to every rate from `shockFrom` on. */
  shockPct?: number;
  shockFrom?: string;
  /** Ledger link: the liability account holding this loan's balance, and where interest is recorded. */
  ledgerAccountId?: number | null;
  interestCategoryId?: number | null;
  escrowCategoryId?: number | null;
}

export interface LoanRateChange {
  id?: number;
  loanId: number;
  /** The new rate applies to payments on or after this date. */
  date: string;
  annualRatePct: number;
}

export interface LoanEvent {
  id?: number;
  loanId: number;
  /** 'draw' adds to a HELOC balance (draw period only); 'extra' is principal paid on top of the regular payment. */
  type: 'draw' | 'extra';
  date: string;
  amountCents: number;
  /** Extra principal every month from `date` (until `endDate`, if set). */
  monthly?: boolean;
  endDate?: string | null;
  note?: string;
}

// ---- Paycheck calculator ----

/** A saved what-if for one person's pay. Editing it never changes the real setup on the Income tab. */
export interface PayScenario {
  id?: number;
  name: string;
  personId: number;
  year: number;
  /** Salary, schedule, deductions, match, and withholding for the scenario (a copy, or built from scratch). */
  profile: IncomeProfile;
  bonuses: { month: number; grossCents: number; label: string }[];
  /** Include the other person's real income (and your Income tab tax settings) when estimating the household's yearly tax. */
  includeSpouse: boolean;
  startedFrom: 'income' | 'blank';
  updatedAt: string;
}

/** Money taken out of an HSA. Qualified (medical) withdrawals are tax-free; others are taxed, plus a 20% penalty before 65. */
export interface HsaWithdrawal {
  id?: number;
  accountId: number;
  date: string;
  amountCents: number;
  qualified: boolean;
  note: string;
  /** How much of it was taken out of the account's cash balance when logged (restored if deleted). */
  fromCashCents: number;
}

// ---- Cost basis and realized gains ----

/** One purchase of a security in a taxable account. A holding's shares and cost basis are the sum of its lots. */
export interface TaxLot {
  id?: number;
  holdingId: number;
  accountId: number;
  securityId: number;
  /** null = date unknown (treated as long-term). */
  acquiredDate: string | null;
  shares: number;
  /** Total cost for the lot, in cents (not per share). */
  costBasisCents: number;
  source: 'opening' | 'buy' | 'reinvest' | 'rsu' | 'manual';
}

export type SaleMethod = 'fifo' | 'lifo' | 'hifo' | 'average' | 'specific';

export interface SaleLot {
  lotId: number;
  shares: number;
  basisCents: number;
  acquiredDate: string | null;
  longTerm: boolean;
}

/** A completed sale. Sales in taxable accounts have a gain or loss; sales in IRAs, 401(k)s, Roths, HSAs, and 529s do not. */
export interface Sale {
  id?: number;
  accountId: number;
  securityId: number;
  date: string;
  shares: number;
  /** Net of fees. */
  proceedsCents: number;
  feesCents: number;
  method: SaleMethod;
  taxable: boolean;
  lots: SaleLot[];
  basisCents: number;
  gainCents: number;
  shortTermCents: number;
  longTermCents: number;
  /** Proceeds were added to the account's cash balance. */
  toCashCents: number;
  note: string;
}

// ---- Net worth: property and history ----

/** Something you own that is not in an account: your home, a car, land. Its value is whatever you last entered. */
export interface Property {
  id?: number;
  name: string;
  kind: 'home' | 'vehicle' | 'other';
  /** Loans (mortgage, HELOC) secured by it, so equity can be shown. */
  loanIds: number[];
  /** Left out of net worth (sold, or you would rather not count it). */
  excluded?: boolean;
}

export interface PropertyValue {
  id?: number;
  propertyId: number;
  date: string;
  valueCents: number;
  note: string;
}

/** One point on the net worth chart. The app saves one a month automatically; the latest view in a month is kept. */
export interface NetWorthSnapshot {
  id?: number;
  date: string;
  cashCents: number;
  investmentsCents: number;
  propertyCents: number;
  /** Negative = owed. */
  cardsCents: number;
  loansCents: number;
  totalCents: number;
}

// ---- Payee rules ----

/** If a transaction's payee contains `pattern`, give it this category (and optionally a cleaner payee name). */
export interface PayeeRule {
  id?: number;
  pattern: string;
  categoryId: number | null;
  /** Rename the payee to this when the rule applies (e.g. "AMZN Mktp US*2K4" becomes "Amazon"). */
  rename?: string;
  /** Only for this account (blank = any). */
  accountId?: number | null;
}

// ---- Budget targets and giving ----

/** A funding goal for a budget category: set aside a set amount every month, or save up an amount by a date (or every year in a given month). */
export interface BudgetTarget {
  id?: number;
  categoryId: number;
  kind: 'monthly' | 'by_date' | 'yearly';
  amountCents: number;
  /** 'by_date': the month the money is needed, as 'YYYY-MM'. */
  dueMonth?: string;
  /** 'yearly': the month of the year (1-12) the bill comes due. */
  dueMonthOfYear?: number;
  note?: string;
  /** Place among the targets of its category in the owner's chosen order; unset sorts last. */
  order?: number;
}

/** A gift to a charity. Gifts of stock are deductible at their market value, and the gain is never taxed. */
export interface Donation {
  id?: number;
  date: string;
  charity: string;
  kind: 'cash' | 'stock' | 'other';
  /** Cash given, or the fair market value of what was given. */
  amountCents: number;
  /** Stock and other property: what you originally paid, so the gain that is not taxed can be shown. */
  basisCents?: number;
  /** Stock given: held more than a year (only then is the full market value deductible). */
  longTerm?: boolean;
  /** You have the charity's written acknowledgment (needed for gifts of $250 or more). */
  receipt?: boolean;
  note: string;
}
