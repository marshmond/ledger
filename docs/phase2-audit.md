# Phase 2 audit: what Ledger already stores about bills, recurring items and dates

Written 2026-11-04 from reading the code (`src/db.ts`, `src/types.ts`, `src/lib/schedule.ts`, `calendar.ts`, `calendarLive.ts`, `budgetTargets.ts`, `ComingUp.tsx`, `src/core/entities.ts`). Nothing was changed. No personal data is described here, only the shape of the records.

## 1. Short answer

- **There is no "bill" record.** A bill is a *scheduled item* (a recurring rule). One table holds them.
- **Only one kind of date-bearing record is stored as a rule: `recurring`.** Everything else on the Home "Coming up" list (RSU vests, tax deadlines, RMDs, loan payments, pay-cap dates, year-end reminder) is **worked out on the fly each time** from other data. None of it is saved as a dated item.
- The new shared `dueItems` table (Phase 1) is **empty and unused**. Nothing publishes to it yet.
- Dates are plain `YYYY-MM-DD` text, all-day only. There are no times anywhere in Ledger.

## 2. What is stored

| Thing | Table | Key fields | Notes |
|---|---|---|---|
| Scheduled item ("bill", paycheck, transfer) | `recurring` | account, payee, signed amount (cents), category or transfer account, memo, `frequency`, `startDate`, optional `endDate`, `semiDays`, `active` | Money in or out. The same table holds income and transfers, so "bill" = a rule with a negative amount. |
| What you did with each occurrence | `recurringLog` | rule id, the *scheduled* date, `posted` or `skipped`, the transaction id | Only handled occurrences are stored. |
| Transactions made from a rule | `txns` | `recurringId` | Posting creates a *pending* transaction (or a pair, for a transfer). |
| Budget "bill" goals | `budgetTargets` | category, kind (monthly / by date / yearly / repeating), amount, `dueMonth`, `everyMonths`, `dueMonthOfYear` | A savings goal for a bill. **Month only, no day.** Not shown on Coming up. |
| Loans | `loans` (+ `loanRates`, `loanEvents`) | `nextPaymentDate`, `firstPaymentDate`, payment override, escrow, PMI | Payment dates come from a calculated schedule; only the *next* one is shown. |
| RSU vests | `rsuVests`, `rsuGrants` | date, grant, shares | Stored dates. |
| Windfalls, goals | `windfalls`, `goals` | **year only** | Not date-level. |
| People | `people` | name, `birthYear` | Income-model people, not contacts. No birthdays. |
| Donations, HSA withdrawals | own tables | date | Records of things done, not upcoming. |

Frequencies supported: weekly, biweekly, semimonthly (two chosen days, 31 = last day), monthly, quarterly, yearly. Months clamp to the last day (a rule starting on the 31st lands on the 28th/30th when needed).

**Not stored anywhere:** credit card statement or due days, subscription renewals, reminders, to-dos, times of day, anything with a priority, tags on Ledger records, a "paid / unpaid" flag other than the log.

## 3. How the dates reach the screen today

1. `dueInstances()` (schedule.ts) loops each active rule from its **start date** up to today + N days and drops the ones in `recurringLog`. Used by: Home (7 days), the sidebar count (7 days), the Scheduled page, the daily check-in, and the calendar (up to 60 days).
2. `loadCalendar()` (calendarLive.ts) builds the Home "Coming up" list by combining item 1 with vests, tax dates, RMDs, pay milestones and the next loan payment. Nothing is saved.
3. "Add to my calendar" downloads an `.ics` snapshot. Event ids look like `bill-<ruleId>-<date>@ledger.local`.
4. The forecast and payroll code reuse `occurrencesBetween()` for the same dates.

## 4. What this means for Part C (my reading, to be checked against your prompt)

1. **The cleanest source of truth for bills already exists** (`recurring` + `recurringLog`). A Calendar/Tasks module should *read* it, not copy it.
2. **Publishing bills as shared due items has a duplicate risk across devices.** `publishDueItem` looks for an existing row by module + record id, but each device would create its own row with its own time-based id before they have synced, so two devices could produce two copies of the same bill. Options: compute them on the fly (nothing stored, no duplicates), or give published rows a fixed id built from module + record + date.
3. **Overdue items never expire.** `dueInstances` starts at the rule's start date, so every unhandled past occurrence stays "due" until approved or skipped. A rule started years ago and never approved would produce a long list. Any publisher needs a cut-off (for example, only the last N days).
4. **Retracting must follow the log.** An occurrence leaves the list when it is posted or skipped, when the rule is deleted (its log is erased), when the rule ends, or when it is turned off. A published due item has to be retracted in all of those cases.
5. **Repeat rules would need a translation.** `DueItem.recurrence` is iCalendar text and "not interpreted yet". Ledger's six frequencies map directly, except semimonthly with day 31 ("last day", which needs the iCalendar "-1" day) and month-end clamping.
6. **Time of day does not exist yet.** A Calendar needs times; `DueItem` already has `time` and `allDay`, Ledger records do not.
7. **Budget bill goals have a month but no day**, and loan payments are derived, so neither can become a dated item without a decision (pick a day, or leave them out).
8. **The current `.ics` export would overlap** with a real Calendar. Keep it as is, or replace it later; changing event ids would make phone calendars show duplicates.
9. **Sync is not a problem for any of this.** Every table already syncs. Derived dates need no syncing at all.
10. **People/contacts:** `people` (income model, with birth year) and `contacts` (shared, empty) are separate by your earlier choice. Birthdays have no home yet.

## 5. Not verified

- I read the code; I did not run the Scheduled page or the Home list for this report.
- I did not check how many scheduled items you have or how old they are (that is your private data, and the report does not need it).
