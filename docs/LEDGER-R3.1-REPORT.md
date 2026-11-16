# Ledger R3.1: Year Ahead (report)

Status (2026-11-16): **BUILT AND TESTED LOCALLY. UNCOMMITTED, NOT STAGED, NOT PUSHED, NOT DEPLOYED. Awaiting owner and ChatGPT review. NOT REAL-DEVICE TESTED.**

Gate verified first: `main` = `origin/main` = `2f7670b` (`feat(finance): suggest payment links across household modules`, R2.2) and GitHub Pages run **#122** is `completed` / `success` (public Actions API; `gh` is not installed), so R2.2 is committed and deployed and nothing of it is mixed in. The three protected untracked files (`docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`) were read once (the seed script, to run the demo) and not modified.

## A. Executive summary

**Year Ahead** answers "what do I need to prepare for over the next twelve months?" on one read-only page, `#/household/year-ahead`, reached by a **Year Ahead** button at the top of Household Finances (and by Search).

- It shows the rolling twelve months from today (the actual range is printed at the top).
- **Four small summaries, never added together:** Bills and services (known, estimated, not known), Finance-only payments, Project payments still to pay, and Important dates (no money).
- **A "Planning attention" list** of the things that need a decision or more information: bills and services that may be the same expense, scheduled payments that resemble a bill, payments with no known amount, the biggest not-every-month payments, project amounts with no date, the nearest contract deadlines.
- **Month by month:** twelve periods, each with a one-line summary and the payments and dates inside it. Every row names its source module, says Known / Estimated / Not known, says whether the Finance Forecast already holds it, and links to the original record.
- On a phone a short **Coming up first** list sits above the summaries, so the next few items are visible without scrolling through them.

Nothing is written. It adds no table, migration, dependency, backend, backup or sync change, and no model call.

## B. Data sources and composition

The page is a pure composer (`src/modules/household/yearAhead.ts`) over a loader (`yearAheadData.ts`) that only runs when the page is opened. It owns **no money rule**; each row comes from a reader that already exists.

| Source | Reader reused | What appears |
|---|---|---|
| Bills & Subscriptions | the same `expectedDates` + `expectedAmountOn` loop `buildCommitments` totals (price changes, pauses, confirmed cancellations, schedule revisions all handled by those readers); `upcomingDeadlines` | one row per expected billing date; renewal, trial and cancel-by dates as **date-only** rows |
| Household Services | `servicesRows` / `expectedWindow` (B5), `contractDeadlines` | estimated visit rows, estimate-less visits as "not known", renewal and notice dates |
| Bills + Services figures | `householdCommitments().twelve` (B5) | the group figure **is** B5's figure, unchanged |
| Finance Scheduled | `occurrencesBetween` (the Scheduled page's own date generator), the rule log | active spending rules only (no transfers, no income), minus dates already posted or skipped |
| Finance loans and taxes | `loadForecast`'s own `input.loans` and `input.taxes` | loan payments and tax-due amounts; refunds (money in) are skipped |
| Projects | `loadProjectSummary` (`summariseProject`) | agreed amount still to pay on accepted agreements of open projects |
| Home & Assets | `effectiveWarranties`, `taskAssetMap`, `showsWarrantyMarkers`, `isOverdue` | warranty end dates and open dated maintenance, **informational only** |

**Date window.** `commitmentWindow(today)` (Bills' own): from today to the same day next year minus one day, using `addMonths`'s month-end clamping. The twelve periods are `[today + k months, today + k+1 months - 1 day]`, contiguous with no gap or overlap, ending on the window's last day (tested for 2026-11-16, 2028-02-29, 2026-01-31, 2026-12-31). Period labels are date ranges ("Nov 16 to Dec 15"), not calendar months, so there are exactly twelve and they match the window the rest of Household Finances uses. Overdue maintenance is before today, so it is counted separately, not placed in a month.

**Deduplication and overlap rules.**
1. *Bill + service.* B5's fold rule decides, unchanged: folded only when each links to exactly the other and their window totals are equal to the cent. A folded service's visit rows stay listed, labelled "counted once, as the linked bill", and are not added. Anything less certain keeps both, flags both rows, and raises an attention item with the most that could be counted twice.
2. *Finance scheduled rule a bill points at* (`scheduledRuleIds`): counted **once, as the bill**; the rule is not listed again (the summary says how many). Such a bill is marked "In the Forecast".
3. *Finance scheduled rule that resembles a bill, an arrangement or a loan* (the existing word-based `payeeMatch`, any match): listed with the record it may duplicate, marked "not added to any figure", and **kept out of the Finance-only figure**. If Bills could not be read, every scheduled rule is treated this way.
4. *A renewal, trial or notice date* is a date-only row with no amount; it is never an extra payment.

## C. Financial correctness

- **Three money groups, never summed:** Bills and services, Finance-only, Projects. There is no grand total and no "you will spend" sentence (a test pins this). Per-period lines show each group's subtotal separately.
- **Commitments, expected payments, recorded spending, Forecast stay distinct.** Year Ahead shows plans (commitments). It uses no recorded spending at all. It never recomputes a cash balance and calls only the Forecast's loan/tax items, as data. Each Finance row says whether the Forecast already holds it ("In the Forecast" / "Not in the Forecast"); a bill is "In the Forecast" only if a linked, active scheduled payment on a Forecast account exists. The page's "How to read" box says appearing here does not mean the Forecast contains it.
- **Certainty keeps its words:** Known (fixed amount, or the amount on a scheduled payment), Estimated (variable amounts, per-visit service estimates, loan payments "worked out from the loan's terms", tax amounts), Not known (counted, never zero), In dispute (recorded prices disagree). A service estimate that is per month, season or year is **not** turned into a figure; it is listed in attention as not known.
- **Reconciliation.** The Bills-and-services figure equals B5's twelve-month figure for the same date, and the listed bill rows add up to Bills' own `buildCommitments` known and estimated cents (tested on the seeded household).
- **Projects:** the figure is `leftCents` (agreed minus paid, never below zero) of **accepted** agreements of open, un-archived projects. A quote, a budget, a finished project and an overpaid agreement contribute nothing. **No payment date is stored for a commitment, so every project row is "Date not specified" and sits in its own card outside the months.** Its project's target date, when set, is mentioned in the note only.
- **Limitations (where a reliable total cannot be shown).** (a) The Finance-only figure excludes possible overlaps, so it can be low; the summary says how many payments were left out. (b) The Bills-and-services figure may include both halves of a related bill and service; the summary states the maximum overlap. (c) Bills count what the schedule expects, as B5 does; they do not subtract a payment already made this period. (d) If any source fails to load, the figure for its group is not shown at all (and Bills + Services need both).
- **Hide Amounts:** every amount, including an amount typed into a record title or note, is masked (tested; also checked in the browser: 0 visible dollar amounts, 60 masked).

## D. User experience

- **Navigation.** Household Finances has a primary **Year Ahead** button; Year Ahead has a **Household Finances** button back. Search finds "Year ahead" (also by "twelve months", "annual", "renewals", "planning") and still finds "Household finances" alone for its own name. The new route is inside the existing Household module (no twelfth module).
- **Quick Add (judgment, section F-1):** Quick Add is a record-creation box (every entry parses text into a new record), so no fake "create" action was added; navigation lives in Search and the module UI.
- **Desktop (1440):** four summary cards in a row, then Planning attention, Date not specified, and the twelve periods (first three with items open; Open all / Close all).
- **Phone (375):** one column; "Coming up first" (next five items) appears above the summaries; rows stack to date tile, title and amount, then tags; 44 px touch targets; no horizontal overflow (scroll width 375).
- **Screenshots** (invented demo household; `Documentsedger-design-conceptsr3.1-evidence` (outside the repository)): `desktop-light-summary.jpg`, `desktop-light-months.jpg`, `desktop-dark-summary.jpg`, `phone-light-top.jpg`, `phone-light-months.jpg`, `phone-dark-months.jpg`. Navy Light and Dark were seen through the app's own appearance (dark through the browser's color-scheme emulation).

## E. Verification

- **Focused tests:** `src/modules/household/yearAhead.test.ts` (18: window and leap-year, reconciliation with B5, bill-and-service overlap and fold, unknown amounts, renewal date, Finance standalone/linked/overlap, loans and taxes, projects, Home & Assets, failed sources, links and read-only digest) and `yearAheadUi.test.tsx` (4: three-group markup with certainty words, Hide Amounts, no form controls, Search).
- **Guards updated:** the B5 import guard now exempts the three Year Ahead files from the "no Finance read" rule and gives them a stricter whitelist (dates, money, financeRead, payeeMatch, forecastLive, txnProject, search) plus a no-posting-code check; the UI-coverage tracker gained row **H-02** (BLT; no Kbd mark), counts 59 to 60, and accepts an `R3.1`-style phase.
- **Final runs:** `npx tsc --noEmit` clean; full suite **301 files, 5,935 tests pass** (R2.2 baseline 299 / 5,912; +2 files, +23 tests); `npm run build` clean (entry chunk 858.46 kB raw / 270.27 kB gzip, up 1.35 kB; the page and loader live in the on-demand Household chunk). One earlier full run showed `payments-privacy.test.ts` failing once; it passes alone and in the later full runs (it did not recur), so it looks load-sensitive and unrelated.
- **Browser (built-in browser, fictional D1 demo household on port 5231, two invented Finance scheduled payments added):** desktop 1440 and phone 375, light and dark; no horizontal overflow; Year Ahead reached from Household Finances; Search opens it; one source link of each kind opens the right record (bill, service, scheduled payment, project, asset); Hide Amounts masks everything.
- **Not verified:** real phone, screen reader, keyboard walk-through, Safari/Firefox, a household with real loans or tax data (loan and tax rows are tested on hand-built Forecast items, not seen in the browser), maintenance rows in the browser (tested with hand-built data).

## F. Judgment calls (please review)

1. **Quick Add left alone.** It only creates records; navigation is in Search and the module UI.
2. **Twelve rolling periods, not calendar months,** so there are exactly twelve and they match the commitment window; labelled with date ranges.
3. **Bills-and-services figure is B5's own twelve-month figure;** the listed rows are the same dates. Disputed bills show "recorded prices disagree" and no amount.
4. **Finance-only excludes possible overlaps; Bills-and-services keeps B5's both-counted behavior** (with the exposure stated). The asymmetry is deliberate: Finance items are additions to B5's figure, so an uncertain one is held out rather than risk a double count.
5. **Overlap detection is the existing word-based payee match, any match.** It can flag a harmless coincidence; it is conservative by design.
6. **Loan payments and taxes are labelled Estimated** (calculated, not contractual); scheduled payments are Known (the amount the owner entered).
7. **Not-every-month = four or fewer occurrences in the window.** A plain count, not a threshold on amount; the "largest first" list surfaces large ones without inventing a "large" cutoff.
8. **Home & Assets contributes dates only.** There are no future lifecycle milestones in the model (status dates are past events), so none appear; no replacement cost is shown.
9. **No payment dates for project commitments** exist in the data, so no milestone rows; undated amounts sit in their own card.
10. **Scheduled rules are read directly (`recurring` and its log) plus `loadForecast(months: 13)`** for loans and taxes. `loadForecast` reads the whole transaction table (it needs balances), so opening the page costs about as much as opening the Forecast page. Nothing runs on Today or at start-up.
11. **Screenshots are kept outside the repository** (`Documentsedger-design-conceptsr3.1-evidence`), as in earlier phases.
12. **The `Not in the Forecast` chip appears on every bill row** without a linked scheduled payment. It is repetitive but is the clearest way to show the Forecast distinction row by row.

**NOT built:** R3.2 Quick Answers, R3.3 Budget suggestions, new forecasting, tax or loan calculations, Bill-to-Scheduled creation, payment automation, notifications, replacement-cost fields, filters or customization, a Household Finances redesign.

## G. Release recommendation

R3.1 is **ready for owner and ChatGPT review**. Nothing is committed, staged or pushed. If approved, one commit covers `src/modules/household/` (new `yearAhead.ts`, `yearAheadData.ts`, `YearAheadPage.tsx`, tests; edits to `commitments.ts` (two exports), `Parts.tsx` (one export), `OverviewPage.tsx`, `HouseholdModule.tsx`, `model.ts`, `searchSource.ts`, `household.css`, `b5-guards.test.ts`), `src/shell/uiCoverage.test.ts`, `docs/UI-COVERAGE.md`, `Documentsedger-design-conceptsr3.1-evidence` (outside the repository), and these documents. The recommended next phase is **R3.2: Quick Answers** (it needs owner definitions first).
