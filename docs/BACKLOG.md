# Change backlog (from the owner's first-use notes)

**Working rule (still in effect for NEW notes):** collect notes tab by tab, ask clarifying questions up front, and wait for the owner's go-ahead before building.

Status key: `[ ]` not started, `[x]` built.

## STATUS: everything below was BUILT on 2026-10-09 (owner asked "build these now")

Built and verified (242 automated tests, plus a walkthrough in the browser: theme switching, pay schedules and employer cap, ESPP/HSA switches,
collapse memory, price override, every transaction filter/sort/bulk/export, mortgage and HELOC numbers against independent calculations,
ledger link, budget, retirement panel, phone layout of all 13 pages).

### Judgment calls made while the owner was asleep (please review; all are easy to change)

1. **Weekend pay rule is OFF by default** (the box is unchecked on new and existing profiles). Turn it on per person under Pay schedule. Holidays are not considered. With the rule on, a pay day can move across a year boundary (e.g. a Saturday Jan 1 pays on Dec 31), which can make a 25-paycheck year; each paycheck is still salary / 24.
2. **"Last day of the month" is stored as day 31**, and day numbers past a short month's end clamp to its last day (tested for Feb, 30-day months, and leap years). "Last business day" is a separate choice. The **Scheduled** tab's recurring items still use the older day rules (no last-business-day option there yet).
3. **Employer 401(k) contribution** is one section with two formulas (match on contributions, or flat % of pay), an optional yearly dollar maximum, and a key-date line when the maximum is reached. With a match + true-up, the maximum applies to the year-end total.
4. **HSA / ESPP** appear only when switched on ("I have an HSA", "enrolled in ESPP"). Existing data that already has either shows them automatically. Switching one off removes its deduction (after a confirmation).
5. **Collapsible sections** remember per device what you collapsed; everything is open the first time. The Transactions filter panel starts collapsed on phone-width screens.
6. **Theme button** sits at the end of the top navigation bar and cycles Device, Light, Dark.
7. **Manual price**: refreshing prices overwrites a manual price (as asked); a ticker the API cannot price keeps the manual value. The Price cell in each holding row is now editable and always visible (it was hidden on phones).
8. **All Transactions**: totals include transfer rows with a note saying how many (use "Hide transfers" to exclude them). Bulk category skips transfers and replaces splits with the single category (it says how many). Selection only ever counts rows inside the current filter, and clears after a bulk action. The CSV defuses text starting with `= + - @` (prefixes an apostrophe); amounts stay plain numbers.
9. **Debt: interest accrual** is simple monthly (balance x rate / 12), shown in the app; reconcile against a statement.
10. **Debt: "keep my payment" vs "lower my payment"** is a per-loan setting (default: keep the payment and finish sooner). In "lower" mode a large recurring extra can still finish a little before the original end date. A rate change always recalculates the payment over the months that remain.
11. **Debt: ledger link.** A loan becomes a new "Loan" account kind (a balance you owe). Loans are never part of spendable cash. In the Budget a loan gets a "Payment: <loan>" line that you fund by assigning the principal you plan to pay; there is no "unfunded debt" warning for loans. Payments are recorded from the loan card ("Record a payment"): principal as a transfer to the loan, interest/escrow as an expense split across the categories you choose.
12. **Debt: escrow and PMI** are informational (shown in the total monthly payment and recorded as an expense when you record a payment); they do not change the loan balance.
13. **Debt feeds Retirement** through an opt-in checkbox, OFF by default, because a spending figure that already includes the mortgage would be double counted. Net worth (cash + investments - cards - loans) is on the Debt tab; property value is not included.
14. **Phone layout**: tables wider than the screen now scroll sideways inside their own box on every page, and long checkbox sentences wrap. Found and fixed during testing.

### Still open (not built, from the questions listed under the Debt tab below)
- Daily interest accrual; HELOC lifetime/periodic rate caps and prime + margin modeling; lender-specific HELOC minimum payments.
- Adding "last business day" to the Scheduled tab.
- Showing a "no price" holding more helpfully in totals (it still counts as $0, with a warning).

---

## Income tab

Collected 2026-10-08. All decisions below were confirmed by the owner.

- [x] **1. Collapsible sections.**
  - Add collapse/expand to the sections on the Income page: People, each person's setup (and its inner parts: Pay, Salary,
    Deductions, Employer contributions, Income tax withholding), Bonuses, Household tax settings, Results, and the paycheck detail.
  - **Default: open. Remember what the owner collapses** (per device, in browser storage; the page must still work if storage is unavailable).

- [x] **2. Pay setup line is confusing ("Model by / Paid / A real pay date").**
  - Owner's question: is it the start date for annual income? No. Explained to the owner: it picks how paychecks fall in the year; the "real pay date" is only an anchor.
  - **Decision: show only what is needed, with plain labels and a one-line explanation.**
    - Weekly / every 2 weeks: ask for "any past payday" (anchor; explains it decides which dates and which months get 3 paychecks).
    - Twice a month: ask for the two pay days (no anchor date).
    - Monthly: ask for the pay day of the month (no anchor date).
    - Annual numbers mode: no date at all.
  - **Twice-a-month pay days (owner's real case: the 15th and the final business day of the month).**
    - Entering 31 must never break short months (it already clamps to the last calendar day; keep a test for Feb, 30-day months, leap years).
    - Add an explicit **"last business day"** choice (not just 31) and a **"if the pay day lands on a weekend, pay on the prior business day"** option.
    - Assumption to confirm when implementing: weekends only; public holidays are ignored (note this in the UI).
    - Add tests for months ending on a weekend and for a 1st/15th on a weekend.

- [x] **3. Deductions table: spacing of the "reduces" checkboxes is off.**
  - The checkbox and its label (Fed / FICA / MA) sit on separate lines, so it is hard to tell which box goes with which label.
  - Fix: put each checkbox and its label on one line (checkbox directly beside its label), in a tidy aligned group.
  - Also consider clearer wording than "FICA" (e.g. "Social Security & Medicare").

- [x] **4. 401(k) match: add a dollar maximum, and support two formulas.**
  - Owner's example: "my employer matches 10% up to a total of $5,000".
  - **Decision: support both formulas, chosen per person:**
    - **(a) Match on contributions (the more likely case):** employer adds X% of what the employee contributes, up to Y% of pay.
    - **(b) Flat contribution based on pay:** employer contributes a % of pay regardless of what the employee contributes.
    - **Either formula gets an optional yearly dollar maximum** (the cap applies to the employer's total contribution for the year, including with true-up on).
  - Needs: engine change in `simulatePerson` (cap applied as the year progresses, so the match stops once the cap is reached), a new match config shape with a data migration for existing saved profiles, tests (cap reached mid-year; cap with true-up; flat formula; formula (b) with no employee contribution), UI fields, and a milestone line in the results ("employer match cap reached on ...").

- [x] **5. ESPP is lumped in with HSA under "Employer contributions". Only surface ESPP if enrolled; same rule for HSA.**
  - **Decision: each benefit appears only when switched on for that person.**
    - Add an "Enrolled in ESPP" checkbox; only then show the ESPP discount field and the "+ ESPP" deduction button.
    - HSA: show employer HSA contribution and coverage type only once an HSA deduction exists (or an "I have an HSA" switch is on).
  - Edge case to handle: existing saved data that already has an ESPP or HSA deduction must show those controls automatically.
  - Copy-from-last-year should carry the switches forward.
  - Consider renaming the section heading, since it will no longer be a single "Employer contributions" block (401(k) match, plus optional HSA and ESPP details).

---

## New feature: Debt tab

Requested 2026-10-09. Decisions confirmed by the owner. Same working rule: do not build until the owner says all notes are in.

- [x] **Debt tab: mortgage tracking, HELOC planner, and amortization for new or what-if loans.**
  - **What the owner has:** an outstanding mortgage (track amortization) and a HELOC with a **10-year interest-only draw period followed by a
    15-year payback**. Wants amortization tables for existing and new loans, and a calculator to forecast HELOC payments.
  - **Integration decision: tied into the ledger.**
    - Each loan appears as a liability (new account kind). A payment entered in a checking account is **split into interest (an expense,
      for the budget) and principal (reduces the loan balance)**, so budget and loan balances stay in sync.
    - Debts feed the **Retirement** tab (payments and payoff dates as known obligations) and a net-worth view.
    - Reuse the existing transfer machinery where possible; interest expense should land in a user-chosen category.
  - **Mortgage setup: either method, chosen per loan.**
    - Original terms (amount, rate, term, first payment date), or current balance + rate + remaining months.
    - Reconcile against the owner's latest statement balance and show any difference.
  - **HELOC.**
    - Variable rate, and **the owner may keep drawing**: model additional draws (and repayments) by date during the draw period.
    - Rate changes entered by date (a rate-change schedule), plus a **what-if shock** (e.g. +1%, +2%) to see sensitivity of payments and total interest.
    - Draw-period payment is interest only; **repayment period re-amortizes at each rate change** (payment recalculated to pay off the
      remaining balance over the remaining months at the new rate).
    - Make the draw length and repayment length editable (defaults 10 and 15 years).
  - **Extra principal payments in BOTH periods** (the owner corrected an earlier summary that implied interest-only only).
    - Support recurring extra amounts (e.g. monthly) and one-time lump sums by date, on any loan, in either phase.
    - Interest-only period: extra principal lowers the balance, so the interest-only payment falls.
    - Payback period: show the effect on payoff date and total interest.
  - **Outputs.** Full amortization table (month, payment, interest, principal, extra, balance), total interest, payoff date,
    interest saved by extra payments, a balance-over-time chart (base case vs rate shock), and a table view. Same engine for new/what-if
    loans (refinance, auto, student, other) so they can be compared with an existing loan.
  - **Open questions to confirm at implementation time (not yet asked):**
    - Interest accrual convention (simple monthly: balance x annual rate / 12, versus daily accrual). Default to monthly; say so in the UI.
    - Mortgage escrow (property tax / insurance) and PMI: track or ignore? (affects the real monthly payment shown).
    - HELOC rate caps (lifetime and periodic) and prime + margin structure, if the owner wants them modeled.
    - In the payback period, after extra principal: keep the payment the same and finish early, or re-amortize to a lower payment? (Rate changes
      always re-amortize; the choice is how extras behave between rate changes.)
    - HELOC minimum-payment rules during the draw period (interest only versus a lender-specific minimum).
  - **Engineering notes:** new tables (loans, loan rate changes, draws, extra payments) via a new DB version and backup version; pure schedule
    engine with tests (rate change mid-schedule, draw then payback, extra principal in each phase, final-payment rounding, balance reaches
    zero exactly); loans excluded from the budget's cash accounts; links with `createTransfer`-style split logic.

---

## New feature: theme switch (dark mode)

Requested 2026-10-09. Decisions confirmed by the owner. Same working rule: do not build until the owner says all notes are in.

- [x] **Light / Dark / Device theme switch in the top navigation bar.**
  - **Current state:** the app already follows the device's light/dark setting (CSS `prefers-color-scheme`), including the chart palettes.
    There is no way to override it inside the app.
  - **Decision: three choices, Device (default) / Light / Dark.** A small sun/moon button in the top nav, visible on every tab (including phone width),
    that cycles or opens the three choices and shows which is active.
  - **Persistence:** remember per device (browser storage; must still render correctly if storage is unavailable).
  - **Engineering notes:**
    - Today's colors are defined only under `@media (prefers-color-scheme: dark)`, in `src/styles.css` for the app and the `.viz` chart tokens.
      Add explicit `:root[data-theme="dark"]` and `:root[data-theme="light"]` scopes so a forced choice beats the device setting both ways
      (dark values declared under both the media query, guarded with `:root:not([data-theme="light"])`, and the `data-theme="dark"` scope).
    - Set `data-theme` on `<html>` as early as possible (inline script in `index.html`) to avoid a flash of the wrong theme on load.
    - Update `<meta name="theme-color">` to match the active theme, and keep `color-scheme` in sync so form controls and scrollbars follow.
    - Check every page in both modes, especially the budget colors (.pos/.neg/.warn), badges, tooltips, and the allocation/fan charts.

---

## Investments tab

Reported 2026-10-09. Same working rule: do not build until the owner says all notes are in.

- [x] **Manual price override is not available where the owner looks for it.**
  - **What the owner saw:** in an account's holdings table the Price column just says "none", with no way to enter a price.
  - **What exists today:** the editable price box is only in the separate "Holdings vehicles and prices" table near the bottom of the page.
    It is easy to miss, and the commit-on-blur behavior gives no confirmation.
  - **Requested behavior:** let the owner type a price manually, as a stopgap until the API refresh supplies it. **A later price refresh overwrites
    the manual price** (this already matches how `applyPrices` works; keep it, and keep a manual price when the API cannot price that ticker).
  - **Proposed fix (no decision needed unless the owner objects):**
    - Make the Price cell in each holding row an editable field (shown as "Enter price" when empty), saving on Enter or when leaving the field,
      with a brief "saved" confirmation.
    - Show where the price came from: "manual" vs "refreshed" and its date, next to the price.
    - Prices belong to the ticker, so entering one in one account prices every account holding that ticker; say so in a hint.
    - Keep the vehicles table as is.
  - **Related bug found while reviewing:** in the vehicles table, typing something that is not a valid number clears the stored price (invalid
    text is treated the same as an empty box). Invalid input should be rejected with a message and leave the price unchanged. Add a test.
  - Also consider showing the empty-price state more helpfully in the allocation/total (a "no price" holding currently counts as $0).

---

## New feature: All Transactions screen

Requested 2026-10-09 (the owner could not find a transaction history; history today is only per account, on each account's page).
Decisions confirmed by the owner. Same working rule: do not build until the owner says all notes are in.

- [x] **A screen that lists transactions from every account, with filtering and sorting.**
  - **Filters (all combinable):**
    - Account (by name; multi-select).
    - Date and date range (from/to, plus quick ranges such as this month, last month, last 90 days, this year).
    - Category (multi-select, including "uncategorized"; a split transaction matches if any of its parts matches).
    - Payee (text search, "contains"; also search memo).
    - Amount with comparison: **greater than, less than**, equal to, and between; handle inflow vs outflow clearly (filter on absolute amount, or on signed, with a visible choice).
  - **Sorting:** by account name, date, category, payee, and amount, ascending/descending, by clicking the column headers; sensible default is newest first.
  - **Actions (decision: edit/delete plus bulk):**
    - Edit or delete any transaction from this screen, using the same editor as the account page (including transfer handling: editing/deleting one half of a
      transfer keeps the other half in sync; a transfer is shown as one row with both accounts, or clearly marked).
    - Select several rows (with select-all for the current filter) and apply bulk actions: set category, change status (pending/cleared), delete. Confirm before
      deleting; show how many rows will change. Bulk category should skip or warn on transfers and handle splits (set one category and clear splits, with a warning).
  - **Extras (decision: all four):**
    - **Totals for the filtered results:** count, total money out, total money in, net.
    - **Export the filtered list to CSV** (exactly what is on screen, in the current sort; amounts as plain numbers).
    - **Quick filters:** uncategorized, pending only, include/exclude transfers (default: show transfers, since they are real entries, but make it one click to hide them).
    - **Saved filters:** name a combination of filters and sort, recall it with one click, delete it later (per device, in browser storage/DB, included in backups).
  - **Engineering notes:**
    - Needs a new route and nav item ("Transactions"); consider also linking to it from each account page ("see all").
    - Performance: handle thousands of rows (filter in memory with sorting; paginate or virtualize the table; keep the page responsive on a phone).
    - Pure filter/sort function with tests (each filter alone and combined, date boundaries, amount comparisons including negatives, split categories,
      transfers, sort stability and ties); CSV export test (quoting, commas, negative numbers); saved filters round-trip in backup (new settings key or table, backup version bump).
    - Phone layout: filters collapsed behind a "Filters" button; columns reduced to date/payee/amount with the rest in a detail line.
    - Existing CSV-export concerns: neutralize cells starting with `=`, `+`, `-`, `@` that are text (payee/memo) so spreadsheets do not run them as formulas.

---

## Other tabs

_Not yet received._ Accounts, Budget, Scheduled, Import, Categories, Projections, Retirement, Goals, Backup.
