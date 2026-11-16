/**
 * R1.2 "This Week": what the modules hand to the weekly review. READ ONLY. The review (modules/today/week) is a consumer: it never imports a module, exactly like
 * "Needs you" (core/attention.ts). A module that has something to say registers plain async readers through `contributes.weekReview`, each one calling the
 * module's EXISTING reader and doing nothing but cut its answer to the week and hand it over in the neutral shapes below. These shapes carry no rule of their
 * own and no record the module would not already show on its own screens.
 */

/** How sure an amount is: B5's own four words. */
export type WeekCertainty = 'known' | 'estimated' | 'unknown' | 'disputed';

/** One expected payment or commitment dated inside the week. `cents` is null when no amount is known (never zero). */
export interface WeekPayRow {
  id: string;
  module: 'bills' | 'services';
  /** The bill or arrangement id in its module. Used only to recognise the same bill's "Due:" marker on the Calendar. */
  sourceId: number;
  title: string;
  date: string;
  cents: number | null;
  certainty: WeekCertainty;
  /** Plain words, no amounts. */
  note: string;
  href: string;
}
export interface WeekTotals { known: { cents: number; count: number }; estimated: { cents: number; count: number }; unknown: { count: number }; disputed: { count: number } }
export interface WeekContractDate { id: string; date: string; title: string; label: string; href: string }
export interface WeekMoney {
  /** Rows inside the week. A Services row folded into its linked bill's row is NOT here (it is counted in `folded`). */
  rows: WeekPayRow[];
  folded: number;
  /** The module's own tally of `rows`: fixed and estimated amounts stay apart, unknown and disputed are counts. */
  totals: WeekTotals;
  /** A listed bill or arrangement is in a linked pair that could not be proven to be one charge (counted twice, with a warning). */
  overlap: boolean;
  /** Arrangements expected whose estimate is not per visit: no figure for the week. */
  notConverted: number;
  contractDates: WeekContractDate[];
}

export interface WeekPerson { memberId: number; name: string; /** A semantic color id (never a stored color value), or null for none. */ colorId: string | null; href: string }
export interface WeekFamilyDate { key: string; date: string; title: string; kind: string; href: string; person: WeekPerson | null }
export interface WeekFamilyActivity {
  key: string;
  /** The Calendar's own key for this occurrence, so the schedule can leave it out (it is shown here). */
  openKey: string;
  title: string;
  firstDay: string;
  /** "9:30 AM – 10:15 AM" or "All day". */
  when: string;
  calendarName: string;
  href: string;
  people: WeekPerson[];
}
export interface WeekFamily { dates: WeekFamilyDate[]; activities: WeekFamilyActivity[]; hiddenActivities: number }

export interface WeekMaintenance { taskId: number; title: string; dueDate: string; overdue: boolean; href: string }
export interface WeekOverBudget { id: number; name: string; budgetCents: number; expectedTotalCents: number; overCents: number; href: string }

export interface WeekReaders {
  /** Household finances: expected payments, commitments and contract dates for the week. */
  money?: (today: string) => Promise<WeekMoney>;
  /** Family: birthdays, important dates and activities for the week. */
  family?: (today: string) => Promise<WeekFamily>;
  /** Home & Assets: open dated maintenance (the module's own "upcoming" rows). */
  maintenance?: (today: string) => Promise<WeekMaintenance[]>;
  /** Projects: active projects whose expected cost is over their budget. */
  overBudget?: () => Promise<WeekOverBudget[]>;
}
