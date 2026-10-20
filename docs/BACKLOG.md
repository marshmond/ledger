# Change backlog (from the owner's first-use notes)

**Working rule (still in effect for NEW notes):** collect notes tab by tab, ask clarifying questions up front, and wait for the owner's go-ahead before building.

Status key: `[ ]` not started, `[x]` built.

## STATUS 2026-10-20: targets can be set on the budget line itself BUILT

Verified with 708 automated tests and a browser walk-through (set, fund, edit, remove, empty-save message, phone width).

Judgment calls (please review):
1. **Where:** each category line on Budget has "+ set a target" (and "edit" once it has one) that opens a small form right under the line. The Targets section at the bottom still lists every target and can add them too.
2. **Monthly means "set aside another":** a monthly target of $2,400 shows "needs $2,400 this month" until you have assigned $2,400 this month (money left over from earlier months does not count toward it). YNAB's other monthly style, "refill up to $X" (top up what is left), is NOT built; say if you want it.
3. **One target per category from the line:** the inline form edits one target per category (like YNAB). The bottom section can still add a second one.
4. The amount is read when you press Save (or Enter), so you do not have to click out of the box first.

## STATUS 2026-10-19 (final): "Initial setup" category BUILT

Verified with 706 automated tests and a browser walk-through (balances, Home, Budget, Reports, Flow).

Judgment calls (please review):
1. **What it is:** a built-in category "Initial setup" in a "System" group, created at startup if missing, with fixed ids so each device makes the identical records (nothing doubles on sync). It cannot be renamed or deleted, and the group has no "add category" box. It appears in every category dropdown under "System".
2. **Counts as money, not as activity:** entries filed under it change the account's balance, net worth, cash, and Ready to Assign (like an opening balance would), and a card balance entered this way shows as owed and unfunded on the budget.
3. **Left out of:** income and spending in Reports, Year in review, Protection (spending runway), Home's monthly spending and its transaction count, the budget's categories, income, and uncategorized count, the forecast's everyday-spending estimate, retirement's trailing spending, payee rule suggestions, and repeating-charge detection. It still appears in the Transactions list, account ledgers, and CSV export, because they are real entries.
4. **Flow diagram:** left out by default, with a checkbox ("Include Initial setup entries") that shows positive entries as "Initial setup (money in)" and negative as "Initial setup (money out)". The checkbox is part of saved views.
5. **Splits:** a split line filed under it is ignored the same way.
6. Not built: a one-click "set this account's balance to match my bank" helper that would create the entry for you.

## STATUS 2026-10-19 (latest): saved color themes and credit limits BUILT

Verified with 692 automated tests and browser checks (themes: save, update, switch, copy code, import, bad code; credit limit: set, change, over the limit, no limit).

Judgment calls (please review):
1. **Saved themes:** the library (name, light and dark colors) lives in settings, so it is in backups and syncs between devices; which theme is active stays per device (localStorage), as before. Up to 20 themes; names unique (case-insensitive), up to 40 characters. Picking a saved theme copies its colors into the active palette, so a change made to that theme on another device appears here the next time you pick it. "Update" saves edits back; "Save as new" makes another. Deleting a saved theme keeps its colors on until you pick something else.
2. **Theme codes:** "ledger-theme-1:" followed by the name and 24 colors, encoded as text. An imported theme that clashes with a name gets "(2)", "(3)", and so on, and becomes the active theme.
3. **Credit limit:** optional, on credit card accounts only (set when adding the card, or from the card's page). Credit left = limit minus what you owe; a card in credit adds to it. 75% or more of the limit shows as a warning and over the limit in red, with a plain note about the usual 30% guideline. Accounts shows each card's credit left and a total.

## STATUS 2026-10-19 (later): flow (Sankey) diagram and one-open-at-a-time sidebar BUILT

Verified with 667 automated tests and browser checks (numbers hand-checked against test transactions, filters, custom dates, gross view, phone width).

Judgment calls (please review):
1. **Where:** a "Flow diagram" tab on Reports (the existing reports are the "Trends" tab).
2. **Counted:** every expense category, plus the principal part of loan, mortgage, and HELOC payments (they are transfers to the loan account, shown as "Loan principal"). Left out: credit card payments and moves to savings or investments. Card spending counts through its categories.
3. **Left over:** income minus spending shown as "Saved". If any category or account is switched off it is called "Left over" with a warning, since it is no longer true savings. If spending exceeds income, a "Drawn from savings" bar feeds the diagram instead.
4. **Periods:** "Last 3/6/12 months" are the whole months before this one; "This month" and "This year so far" run through today; "All time" starts at your first transaction; custom dates are inclusive and can be entered in either order.
5. **Gross view:** pay, taxes, and deductions come from your Income setup (the paycheck model), not from deposits, so they can differ from what reached your accounts. Spending still comes from your accounts. Taxes are withholding (federal incl. additional Medicare, Social Security and Medicare, state and family leave); deductions are listed by name (401(k), HSA, and so on). Years without a pay setup show a message.
6. **Account filter:** limits income and spending to the accounts you leave on; it does not affect the gross-view pay.
7. **Phone:** the diagram keeps about 200px per column so labels stay readable, so it scrolls sideways inside its box (with a hint).
8. **Sidebar (desktop):** all groups start collapsed and only one stays open at a time; the open one is remembered per device.
9. **Saved views (flow diagram):** a named view remembers net or gross, the period preset, groups or categories, and what is switched OFF (categories and accounts). Storing what is off means categories and accounts you add later appear in your saved views. Custom dates are not part of a view; they are remembered separately, with everything else, as what the page showed last time on this device. Views live in settings, so they are in backups and sync between devices.

## STATUS 2026-10-19: device sync BUILT (via a private GitHub repo)

Verified with 645 automated tests (two simulated devices through an in-memory remote, plus the GitHub client against a fake fetch) and browser checks. NOT yet tried against real GitHub: do the first real sync with a throwaway repo.

Judgment calls (please review):
1. **Where:** one encrypted file (`ledger-sync.bin`) at the root of a private repo you create. Gzip, then AES-GCM with a passphrase (PBKDF2). You create a fine-grained token limited to that repo (Contents: read and write); it and the passphrase are stored in this browser only. The app refuses a public repo.
2. **Merge:** per record, last edit wins (each record now has an `updatedAt`). Deletions are detected against the ids at the last sync and win unless the record was edited afterwards. Both-sides edits are listed on the Sync page (last 50). Budget lines, net worth months, tax settings per year, and scheduled-item log entries are collapsed to one per natural key if two devices made them at once.
3. **Ids:** new records now get time-based ids (about 1.8e15) so two devices cannot collide. Existing small ids are unchanged. The second device must REPLACE its data with the synced copy when it connects (small ids would collide otherwise).
4. **Not synced:** the price-data key (per device) and appearance/palette (per device, already in localStorage).
5. **Restoring a backup** on a synced device re-stamps everything so it wins, and deletes anything not in the backup on all devices (the restore confirmation says so).
6. **Timing:** on open, on return to the app, when back online, 8 seconds after a change, and every 5 minutes while open. Clock differences between devices could pick the wrong "later" edit if clocks are badly off.
7. Deletion markers are kept 365 days; a device offline longer could bring back something deleted elsewhere.

## STATUS 2026-10-17 (latest): monthly check-in, "Can I afford it?", budget targets, and charitable giving BUILT ("build: 1, 2, 3, 7")

Verified with 626 automated tests and browser checks (desktop and 375px phone width, no horizontal overflow). Database is now version 13; backups are version 13.

Judgment calls (please review):
1. **Targets:** monthly = assign a set amount; by date = remaining divided by months left, rounded up; yearly = next occurrence. When money is short, the soonest-due target is funded first.
2. **Giving:** gifts of shares assume a 15% long-term capital-gains rate for tax avoided. The 60% (cash) and 30% (shares) of income limits and carryforwards are not modeled. Gifts feed the Tax package and can set your itemized deduction in Tax planning.
3. **Afford it:** standard guidelines (28% housing, 36% total debt with 43% as a hard limit, car costs 15 to 20% of income and payment under 10%, 3 to 6 months of cash left over, a PMI note under 20% down). Rent vs buy ignores the mortgage-interest and property-tax deductions.
4. **Check-in:** the budget step counts as done when nothing is overspent and unassigned money is under $50. Prices older than 10 days, property values older than a year, and a backup older than 30 days count as to-do. Your own ticks are saved per month in settings. Home nudges you from the 25th if steps remain.

## STATUS 2026-10-20: cash-flow forecast, spending reports, debt payoff, "if something happens" guide, protection check, year in review, collapsible sidebar groups, and color palettes BUILT

Verified with 576 automated tests and browser checks of every new page (desktop and phone width).

Judgment calls (please review):
1. **Forecast:** starts from checking (and, optionally, savings). Everyday spending is the average of the last three full months, leaving out items posted from Scheduled and loan interest/escrow categories (forecast separately), and is editable. Transfers in scheduled rules are ignored (card payments would double-count card spending; loan payments come from the loan schedules). Tax due is placed on April 15 and refunds on March 15 of next year. A low-balance alert on Home looks 90 days ahead.
2. **Reports:** 13 months of data ending at the month you pick; income is whatever lands in income categories (or uncategorized money in), so it is only as complete as your entries.
3. **Payoff:** a mortgage is left out of the plan by default; card APRs and minimums are entered by you (a minimum of 2% or $25 is assumed until you do); loans use their next scheduled payment and current rate. "Extra vs invest" compares final money at the end of the original term, with an optional tax drag on investment returns.
4. **Protection:** guidelines only: life need = income x years + all debts + education goals (optionally minus savings); disability = 60% of pay; umbrella = net worth rounded up to $1M steps; emergency fund target 6 months (one earner) or 4 (two). Policies are entered by you (employer coverage included) and stored in settings, so they are in backups.
5. **Guide:** stores contacts, document locations, notes per account, and free text in settings (in backups). It warns not to store passwords. Balances are hidden by default so a printout shows less.
6. **Year in review:** net worth change uses saved monthly points (the last point of the previous year as the start when available).
7. **Sidebar:** each group's name collapses and expands its pages; the choice is remembered per device.
8. **Palettes:** Classic (original) plus four presets and a custom palette (12 colors, light and dark separately). The palette and mode are stored per device in the browser (not in backups). Charts keep their own validated series colors.
9. Payee matching now ignores store numbers of any length ("WHOLE FOODS #12" = "WHOLE FOODS #99").

Still open: Social Security claiming planner and survivor scenarios, cross-device sync, broker lot import, whole-plan scenarios, guided setup/demo mode, dividend/interest income tracking, rebalancing and asset location.

## STATUS 2026-10-17 (later): all six "larger scope" features BUILT ("go")

Verified with 472 automated tests and browser checks (net worth + property, tax planning page, Home alerts and Coming up, rules and quick add, tax package, phone layout of every new page).

Judgment calls (please review):
1. **Net worth history:** one point per month, updated automatically whenever the app is open (the month's last view is kept). Past months cannot be recomputed, so earlier points are added by hand (total only). Property is only what you enter; a value over a year old raises an alert. Home value is counted in net worth; mortgage/HELOC equity needs the loans ticked on the property.
2. **Tax planning:** estimates use the Income tab's settings plus sales and HSA withdrawals. The safe-harbor test compares total withholding with the smaller of 90% of this year's tax and 100% (110% if income is over $150,000) of last year's. Suggested extra withholding is spread over the remaining paychecks (one person at a time). Loss harvesting shows the tax saved by re-running the estimate with the selected lots sold; wash-sale risk is flagged when the same security is in an IRA/401(k)/HSA. The checklist's RMD estimate uses today's traditional balance, not last year-end.
3. **Alerts** (Home): backup, overspending, owing at tax time, estimated payment within 30 days, scheduled items due, accounts with no owner, missing/stale prices, lots missing cost or date, vests within 30 days, property value over a year old; and in the last 75 days of the year: year-end checklist and harvestable losses.
4. **Calendar:** a snapshot .ics (re-download to refresh), not a live subscription. Items: vests, estimated tax dates (only when you are on track to owe), RMD deadline, Dec 31 year-end reminder, pay-cap dates, scheduled items (next 60 days), next loan payments. Money/tax items include a reminder the day before.
5. **Rules:** a rule applies to a payee that contains its text (longest wins). Rules categorize and can rename on import; the quick-add and full transaction forms fill a category from rules or from how you filed that payee at least twice before (60% majority). Suggested rules need 3+ transactions, 90% the same category. Repeating charges need 3+ occurrences, regular spacing, similar amounts, and not already scheduled; stopped ones are skipped.
6. **Quick add** now opens a fast form (payee suggestions, amount, category, save and add another); splits, transfers, and memos are one click away.
7. **Tax package:** projected pay/withholding from the Income tab (use W-2 figures when you have them); sales by lot only for taxable accounts; mortgage interest from the loan schedule (simple monthly interest), not a 1098. PDF is the browser's print dialog ("Save as PDF"); CSV per table.

Still open: Social Security claiming planner and survivor scenarios, cross-device sync, broker lot import, whole-plan scenarios, guided setup/demo mode, dividend/interest income tracking.

## STATUS 2026-10-17: navigation and Home redesign BUILT (before the larger features below)

The 15-link top banner was replaced by an information architecture: Home / Money / Invest / Plan / More. Desktop: grouped sidebar; phone: bottom tab bar plus a scrolling row of the section's pages. Added: Home screen (net worth, ranked "needs attention" alerts, this month's spending, recent transactions, goals, quick links), global search (Ctrl+K or /), quick-add button (add a transaction from anywhere; shortcuts to trades, paycheck scenario, scheduled item), breadcrumbs, in-page tabs on Investments (Accounts / Realized gains / Prices & assumptions), a Settings page under More. Accounts moved from "/" to "/accounts"; every other address is unchanged.

Judgment calls: Import and Categories sit under Money; Income and Paycheck sit under Plan (with the planners) rather than their own group; the phone tab bar has five tabs; keyboard shortcuts are limited to search; the Home net worth excludes property until home value is added (next item in the queue).

The larger features (net worth history + home value, tax planning dashboard, alerts/Today expansion, calendar export, quick capture + rules, tax-time package) are still queued under "Larger scope" below; Home and alerts are the first slice of them.

## STATUS 2026-10-16: paycheck calculator, HSA accounts, and cost basis / realized gains were BUILT ("go")

Verified with 380 automated tests and a browser walkthrough (new scenario from a copy, live edit, compare; HSA account and withdrawal; lots, buy, sale with FIFO, undo, tax effect on the Income tab; phone layout).

Judgment calls (please review):
1. **Paycheck calculator** copies are independent of the Income tab (editing a scenario never changes the real setup). Scenario edits apply immediately (no Save button). The household yearly tax uses the other person's real income (optional) and your Income tab's tax settings. RSU vests are not part of a scenario (add bonuses to model a lump sum).
2. **HSA** is its own account type. A withdrawal logged as "not qualified" is added to other income on the Income tab with a 20% penalty if the owner is under 65 (no known owner or birth year assumes under 65). Death/disability exceptions are not modeled. Logging a withdrawal takes it out of the account's cash when cash is available. The Roth planner treats the HSA as a tax-free bucket that pays the "medical costs per year in retirement" you enter once everyone has retired; a leftover HSA is taxed at your heirs' rate for heirs.
3. **Tax lots:** existing taxable holdings become one "opening" lot with the recorded basis (or $0 if none was recorded) and an unknown purchase date, which counts as long-term. Fix the date and cost in the lots panel. Taxable holdings' share counts follow the lots (edit lots, not the share box). Adding shares to a taxable holding adds a lot (merged into the same holding).
4. **Sales:** the default method is remembered (FIFO to start); "pick specific lots" is per sale. Average cost allocates in proportion over all lots, and each lot's own date decides short vs long term. Proceeds go to cash only if you tick the box (same for buys). Wash sales and the carried-forward part of a capital loss are not modeled. A net loss deducts up to $3,000 against other income.
5. **Realized gains** feed the Income tab (short-term as ordinary income; long-term stacked at 0/15/20% using the 2026 thresholds for every year; 3.8% NIIT above $250,000; MA taxes them at 5%) and the first year of the Roth planner.
6. **Qualified accounts** (IRA, 401(k), Roth, HSA, 529): a sale only lowers the holding, with no gain or lots. You can edit the holding's total cost basis there.
7. **Held RSU vests** in a taxable account now create a tax lot dated on the vest.

Still open: dividend/interest income tracking (reinvested dividends create lots but the dividend itself is not counted as income), wash sales, the capital-loss carryforward, cost basis for inherited/gifted shares, importing broker lot data.

## STATUS 2026-10-14: the Roth conversion planner and RSU vesting (last two sections of this file) were BUILT ("build all")

Verified with 318 automated tests and a browser walkthrough (entering cash and stock vests, editing a vest price, recording held shares, running the planner and the simulations, phone layout).

Judgment calls (please review):
1. **RSU withholding** defaults to the federal supplemental rate (22%) and the MA flat rate (5%), plus Social Security/Medicare; set the real rates per person under "Withholding on vests". Over-$1M supplemental wages (37%) are not modeled.
2. **Held stock** assumes the tax is covered by selling shares at the vest (sell-to-cover): you keep the net shares, with the net value as cost basis. The paycheck-detail row shows net $0 for it (it is not spendable cash). "Add to holdings" only appears once the vest date has passed and creates or adds to a holding in the chosen brokerage account.
3. **Cash vests** are treated as wages paid on the vest date (taxed through payroll). The "at risk / escrow" flag was never answered, so it was not built.
4. **Roth planner scope:** two people at most; both live through the plan; conversions happen on January 1; a 401(k) rolls into the IRA when its owner retires (that is also when it becomes convertible); no early-withdrawal penalties or Roth 5-year rules; HSA ignored; survivor tax filing not modeled; heirs' tax is one flat rate.
5. **Before everyone has retired**, wages are assumed to cover spending and the ordinary taxes, so only the extra cost caused by a conversion (tax, IRMAA, lost ACA credit) comes out of savings. After that, spending plus all taxes come from Social Security, other income, RMDs, then taxable, traditional, Roth.
6. **Tax tables for the planner** are in `src/data/retirementTax.ts` (2026), with items marked UNVERIFIED (ACA applicable-percentage table, IRMAA dollar amounts, MA 65+ exemption, senior-deduction phase-out). Later years scale indexed amounts by your inflation assumption; non-indexed amounts (Social Security thresholds, NIIT threshold, senior deduction ending 2028) stay fixed.
7. **IRMAA** uses income from two years earlier; for the first two plan years it uses the first year's income. **ACA** credit assumes a two-person household and the "benchmark plan" premium you enter; spending should exclude health premiums before Medicare.
8. **Simulated futures** use one common market return per year for all accounts (lognormal), identical random paths for every strategy.
9. **Bracket-fill** strategies solve each year's conversion exactly for the ordinary-income bracket top (two passes, so withdrawals that change with the conversion are accounted for).

Still open: survivor/death scenarios, HSA, inherited-account 10-year payout, state tax other than MA, "at risk" cash vests, RSU vests feeding the Projections tab as separate cash flows.

## STATUS: everything below (through All Transactions) was BUILT on 2026-10-09 (owner asked "build these now")

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

---

## New feature: Roth conversion scenario planner

Requested 2026-10-13. Decisions confirmed by the owner. Do not build until the owner says all notes are in.

- [ ] **Compare Roth conversion strategies over the retirement horizon.**
  - **Needs per-account tax type** (traditional / Roth / taxable / HSA) because Retirement currently pools savings. Ask about IRA after-tax basis (pro-rata rule) and after-tax/Roth 401(k) money.
  - **Inputs:** both birth years and retirement years; wages (from Income); Social Security benefit and claiming ages considered; pensions/rental/other income; interest, dividends and gains from taxable holdings; spending need (from Retirement); source of conversion tax (outside money vs from the conversion); growth assumptions reuse the per-asset-class returns; optional heir bracket.
  - **Strategies:** none (baseline); fill to a chosen bracket; fixed dollar per year; gap years only (retirement to Social Security/RMDs); owner's own year-by-year table.
  - **Decisions:** conversion income counts for MA income tax (yes); model the ACA subsidy cliff (yes); exact tax calculation per scenario, not an approximation; compare on all three objectives: lowest lifetime taxes, highest ending wealth, highest after-tax wealth for heirs.
  - **Output:** tax by year per scenario, IRMAA surcharge (two-year lookback), taxable share of Social Security, RMDs with and without conversions, marginal bracket by year with cliffs flagged, ending after-tax wealth, how long money lasts (existing Monte Carlo).

## New feature: RSU vesting

Requested 2026-10-13, for both spouses. Details being clarified.

- [ ] **RSU vest events for each spouse.** Decisions confirmed 2026-10-13:
  - Entry: one row per vest event (date, shares, grant name, which person, ticker).
  - Value: shares x the ticker's price in Investments (manual or refreshed), so projected vests follow the price.
  - Withholding: varies/unknown, so a per-person withholding rate (default federal 22% flat supplemental, plus Social Security/Medicare/MA) compared against actual liability on the Income tab.
  - After vest: shares are held; each vest creates a holding in a brokerage account with the vest-date price as cost basis.
  - Vest income counts as wages (FICA, Social Security wage-base cap, tax estimates) in the vest year.
  - **Update 2026-10-13 (owner):**
    - Past vests (already happened this year) are entered too; they count toward this year's wages and withholding.
    - Future vests are valued at the ticker's current price; each vest can be given its **actual vest price**, which then sets the value and the cost basis for that date.
    - "After vest" is a per-vest choice: **held in a brokerage account** (new holding, vest price as basis) or **sold immediately** (proceeds are cash income, no holding, no gain/loss). The earlier "held" decision is superseded by this.
    - Ticker is set per vest event, so it works whether or not both spouses share a company.
  - **Update 2026-10-13 (owner, supersedes the stock-price, ticker and holding decisions above):** the RSUs are in a private company that was acquired, so there is no market price to pull. Every vest **pays out as cash at a fixed price**. So: no ticker, no price lookup, no holding or cost basis, no held/sold switch. Each vest is a dated cash payment taxed as wages (withholding rate per person, FICA/Social Security cap, MA). Open: enter as dollars per vest or as shares x a per-share deal price; whether the amount is certain or contingent (escrow/holdback).
  - **Update 2026-10-13 (owner, final; replaces the previous update):** both kinds exist. The owner's RSUs are in an acquired private company and pay out as cash; the spouse's are in a public company and vest as shares. Each vest (or grant) therefore has a **type choice: "Vests as cash" or "Tied to common stock"**.
    - **Cash:** ask for the synthetic (deal) price per share; value = shares x that price. No ticker, no price lookup, no holding. The payout is dated cash income taxed as wages.
    - **Common stock:** link to a ticker (price from Investments, manual or refreshed). Future vests use the current price; an optional actual vest price overrides it and sets the cost basis. Per-vest choice of **held in a brokerage account** (new holding at the vest price) or **sold immediately** (cash income, no holding).
    - Both types: past vests this year are entered too; withholding rate set per person (default 22% federal supplemental plus Social Security/Medicare/MA) compared with actual liability; vest income counts as wages (FICA, wage-base cap).
    - Still open: for cash vests, whether any payout is contingent (escrow/holdback) and should be flagged "at risk".

---

## New feature: cost basis and realized gains (Investments)

Requested 2026-10-15. Not built; waiting on answers to clarifying questions.

- [x] (built 2026-10-16) **Update cost basis** on a holding (Investments tab).
- [x] (built 2026-10-16) **Log completed transactions (sales)** so realized gains year to date can be tracked.
  - Open questions: single basis per holding or tax lots; how a sale picks which shares (average cost, FIFO, specific lots); short- vs long-term gains (needs purchase dates); whether a sale reduces the holding's shares and adds proceeds to the account's cash; whether to also log buys; whether the YTD figure feeds the Income/Roth tax estimates.
  - **Decisions (owner, 2026-10-15):**
    - Cost basis is tracked by **tax lots** (date, shares, cost per lot). Taxable (brokerage) accounts show holdings at lot level; existing holdings become one lot the owner can split/edit.
    - Basis is editable (per lot).
    - **Sale method is chosen per sale**: a default method (FIFO, highest cost, or average cost) with the option to pick specific lots. Selling shares sells the associated lot(s) within the Investments tab.
    - **Qualified accounts** (IRA, 401(k), Roth, 529): selling a position does NOT trigger any tax calculation (and needs no lot-level tracking).
    - Logging a sale **reduces the holding's shares** and **feeds the tax estimates** (realized gains YTD count in the Income tab estimate; short vs long term from lot dates).
    - **Buys are logged too** (each buy creates a lot with date and cost; reinvested dividends included).
    - Open: whether net sale proceeds are added to the account's cash balance (not selected, so default is no unless the owner says otherwise); wash sales are not modeled unless asked.

---

## New feature: HSA account type

Requested 2026-10-15. Not built (owner said wait). Details being clarified.

- [x] (built 2026-10-16) **Ability to categorize an account as an HSA** (Investments tab).
  - **Decisions (owner, 2026-10-15):**
    - HSA is its **own investment account type** (holds cash and investments; shows in allocation and net worth).
    - **Contributions link to the Income tab**: payroll HSA saving plus employer HSA money flow into the account in projections (within the yearly limit), like the 401(k) link.
    - **Counts in the Roth planner** as a tax-free bucket for medical costs in retirement.
    - **Track qualified medical withdrawals**: log each withdrawal as qualified (tax-free) or not (taxed, plus penalty before 65).
    - **Included in Projections**, growing with its holdings' assumed returns.
    - Open: how to treat HSA spending in the Roth planner (a yearly medical-cost figure it covers tax-free), and owner per person (self vs family coverage already exists on the Income tab).

---

## Gap: account owner (Investments)

Reported 2026-10-15. The data model has an owner on investment accounts (`InvAccount.personId`), but the Investments tab has no way to set it. The Roth planner depends on it (it assigns each IRA/401(k)/Roth to a person for RMD ages and conversions, and tells the owner to "set the owner on the Investments tab"; unowned accounts are counted as the first person's).

- [x] (built 2026-10-15) Add an **Owner** picker (people from the Income tab, plus "Joint/none") when creating an account and on each account card, editable later.
- [x] (built 2026-10-15) Show the owner on the account card; warn on retirement accounts with no owner.

---

## New feature: paycheck calculator

Requested 2026-10-16. Not built; waiting on clarifying answers.

- [x] (built 2026-10-16) A calculator for a single paycheck, with the option to **carry over existing deductions** from the Income tab's setup, **or enter new deductions manually**.
  - **Decisions (owner, 2026-10-16):**
    - Purpose: what-if on a new salary or raise; try different deductions (401(k), HSA, insurance, etc.).
    - Carry over: pick a person and year from the Income tab; copy their salary, pay schedule, deductions, and withholding into the calculator as an editable starting point (editing never changes the real setup). Or start blank and enter deductions manually.
    - Scope: one paycheck's gross-to-net breakdown plus the year (annual totals, when caps like Social Security and the 401(k) limit are reached, federal and MA liability vs withholding).
    - Scenarios can be saved, named, and compared side by side (e.g. current vs. new job).
    - Not selected: checking against a real pay stub; one-off bonus/vest net (bonuses can still be entered in the scenario).

---

## Larger scope: tax planning, net worth, and usability features

Requested 2026-10-17. Not built; waiting for the owner's go-ahead. Everything below was selected.

- [x] (built 2026-10-17) **Year-end tax planning dashboard.** Bracket room and projected federal/MA tax for the year; withholding vs. estimated payments (on track to owe or be refunded, with W-4 / quarterly payment suggestions); tax-loss harvesting from tax lots (losses available, tax saved, 30-day rebuy warning); year-end checklist (401(k)/HSA room, Roth conversion room, RSU timing, charitable gifts, RMDs due).
- [x] (built 2026-10-17) **Net worth over time + home screen.** Monthly automatic snapshots (cash, investments, home value, debts) with a history chart; home value and equity (value entered and updated over time); goal progress and next actions on one page; spending snapshot (this month's budget status and recent transactions).
- [x] (built 2026-10-17) **Today screen with alerts.** A ranked list of what needs attention across the app (bills due, overspent categories, withholding gap, upcoming RMD or RSU vest, IRMAA/ACA cliff proximity, stale prices, overdue backup).
- [x] (built 2026-10-17) **Calendar export.** Key dates (RSU vests, RMDs, estimated-tax due dates, cap dates, scheduled items) as an .ics file for the phone calendar.
- [x] (built 2026-10-17) **Quick capture and rules.** One-tap add-transaction screen, payee rules that auto-categorize (including on import), and recurring-charge detection.
- [x] (built 2026-10-17) **Tax-time package for the CPA.** One export (PDF and CSV set): wages and withholding, realized gains by lot, HSA activity, RSU income.
- Not selected for now: cross-device sync, guided setup/demo mode, Social Security claiming and survivor scenarios, broker lot import, whole-plan scenarios.
