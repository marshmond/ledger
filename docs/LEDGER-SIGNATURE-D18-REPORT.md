# Ledger Signature D18: Financial Planning Workspace Redesign

Date: 2026-11-13. **Built and tested locally. NOT staged, committed, pushed or deployed. Awaiting owner and ChatGPT review. D19 not started.** American English.

## 1. Release gate (D17)

- Repository `marshmond/ledger`, branch `main`; after `git fetch`, `HEAD` = `origin/main` = `aba2b9bc8a71c5637bba613ab38d8f35a949430b` ("fix(paycheck): handle numeric scenario timestamps").
- The D17 release commit is `61aef1b` ("feat(ui): redesign financial insights investments and debt"). The Pages workflow "Deploy to GitHub Pages" completed with **success** for `61aef1b` (run #104) and for `aba2b9b` (run #105, the Paycheck crash fix on top of it); the `github-pages` deployments list `61aef1b` and `aba2b9b`. Read from the public GitHub API because `gh` is not installed.
- `docs/LEDGER-SIGNATURE-D17-REPORT.md` read. The approved D17 change that Forecast draws the true below-zero balance is in `ForecastPage.tsx` and the shared `LinesChart` options at `HEAD`.
- Git status at the start: only the three protected untracked files (`docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`). They were imported by the throwaway demo setup but never edited, staged or deleted.

## 2. Routes (verified against the repository)

| ID | Route | Page | In-page views |
|---|---|---|---|
| L-17 | `/ledger/income` | `IncomePage.tsx` (with `ProfileEditor`, `RsuSection`, `RsuGrants`) | W-21 RSU grants and vests, W-22 income setup per person, bonuses, tax tables |
| L-18 | `/ledger/taxplan` | `TaxPlanPage.tsx` | none |
| L-19 | `/ledger/giving` | `GivingPage.tsx` | none |
| L-20 | `/ledger/afford` | `AffordPage.tsx` | IV-27 Can I afford it?, IV-28 Rent or buy? |
| L-21 | `/ledger/paycheck` | `PaycheckPage.tsx` | W-22 paycheck scenarios |
| L-22 | `/ledger/projections` | `ProjectionPage.tsx` | none |
| L-23 | `/ledger/retirement` | `RetirementPage.tsx` (with `ScenarioTable`) | none |
| L-24 | `/ledger/goals` | `GoalsPage.tsx` | none |
| L-25 | `/ledger/protection` | `ProtectionPage.tsx` | none |
| L-26 | `/ledger/roth` | `RothPage.tsx` | none |

W-23 (planning calculators) is the set of the eight calculator pages above. The HSA log is on the Investments page (D17) and the HSA effect on income is shown in the Income federal-tax lines; both are unchanged.

## 3. Files changed

Modified: `src/pages/{IncomePage,PaycheckPage,TaxPlanPage,GivingPage,AffordPage,ProjectionPage,RetirementPage,RothPage,GoalsPage,ProtectionPage}.tsx`, `src/pages/charts.tsx` (`FanChart` gained one opt-in `fit` option), `src/pages/fields.tsx` (`MoneyField` gained an optional `ariaLabel`), `src/pages/analysis.css` (one rule: checkboxes inside `.an-form` are no longer stretched to full width), `src/shell/uiCoverage.test.ts` (allow-list), `docs/UI-COVERAGE.md`, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`.
New: `src/pages/PlanParts.tsx`, `src/pages/plan.css`, `src/pages/d18Plan.test.tsx`, this report.
**Not changed:** anything in `src/lib` (every engine), `src/db.ts`, `src/types.ts`, `src/core`, Search, Quick Add, global navigation, theme storage, the Service Worker, sync, backup, `package.json`, `ProfileEditor`, `RsuSection`, `RsuGrants`, `ScenarioTable` and `HsaLog` (their markup is the same; they pick up the new look from `plan.css` through their parent page).

## 4. Page by page

- **Income.** Navy panel with household take-home (**Estimate**), then gross, Social Security and Medicare (with MA PFML), and the federal and Massachusetts refund or amount due. One card per person splits gross into bonus and stock awards ("counted when they vest") and lists take-home and contributions. A jump list (People, Pay setup, Bonuses, Stock awards, Household tax settings, results) makes the long page navigable and makes the RSU section easy to find. Pay setup, Bonuses, RSU and tax settings keep their sections; results are two tax cards, a key-dates card, the month table (scrolls sideways on a phone) and per-person paycheck detail. An equity note says a vest is income on its date and an unvested award is not cash.
- **Paycheck.** Saved scenarios and Start a scenario first; an open scenario shows its **Results** panel next to its **Edit** panel on a computer and above it on a phone, so the result is seen before the inputs. The panel is headed "Scenario estimate, not an actual paycheck". Compare tags each choice "Your real setup" or "Scenario", marks the baseline column, and shows differences as a signed amount with no color.
- **Tax planning.** Panel with projected taxes, a jump list, **Where things stand** (Bracket room with the top federal bracket as a big figure, Withholding and estimated payments with the safe-harbor result as a worded status) separated from **Things you could do** (the gap-closing options, tax-loss harvesting with a result box tagged Estimate, and the year-end checklist with a word on every row: Done, To do, For your information).
- **Giving.** Panel with the year's gifts (**Recorded gifts**), cash, shares and property, and gain tax avoided (**Estimate**); paperwork reminders; Log a gift beside the year's gifts (cash or shares tag, cost basis and holding period under each noncash gift, the receipt as a worded checkbox); the tax analysis and bunching card tagged Estimate with a sentence that nothing is filed.
- **Affordability.** Can I afford it?: panel with total monthly cost (**Rule of thumb**) and loan, payment and cash up front; the purchase inputs in groups (What and when, Financing, Ongoing house costs, Up-front costs); the checks with a word each (Within guideline, Caution, Outside guideline); the guideline maximum; the forecast effect with a worded status and a readable chart. Rent or buy?: a neutral panel for the difference after N years ("one possible outcome, not a recommendation"), then Buy and Rent-and-invest as two cards with their own assumptions and results, and the net worth chart.
- **Projections.** Panel with the median outcome and starting value, poor, strong, steady and contributed figures; the fan chart now draws at its real width on a phone; assumptions grouped (Time and inflation, How results are shown with a sentence on today's versus future dollars, Simulation); Target with the chance of reaching it as a share of simulated futures; Contributions as labeled rows; per-account end values.
- **Retirement.** On a computer: **Your plan** assumptions and the other inputs on the left, a results panel on the right that stays in view while you scroll (probability of lasting, status in words, median savings, withdrawal rate, average-return path, and the Find spending that lasts tool). On a phone the results come first. Other retirement income, debts, and windfalls are separate cards; below them the savings chart, the year-by-year table with CSV, the still-funded table and what the model leaves out.
- **Goals.** One card per goal with a summary line (account, first cost year, years, yearly cost, your share), a collapsed **Goal settings** disclosure with the fields in two groups (opened automatically for a new goal with no cost), the Calculate button, and the modeled results with a word saying whether the planned contribution meets the confidence goal. "How it works" sits beside the goals.
- **Protection.** Panel with emergency fund runway and target; **What the guidelines found** with a word per finding (Looks fine, Note, Needs attention); then **Guideline estimates** (emergency fund, life and disability with Guideline and Recorded column labels and "Meets / Below the guideline" under each gap, umbrella with Suggested limit tagged Guideline and Entered tagged Recorded) separated from **Your recorded policies** (a card per policy with a summary line and its fields).
- **Roth.** A "Which strategy comes out best" band on top (the three winners, tagged Projected), a jump list, Your situation (recorded balances with your inputs per person), Assumptions in five labeled groups, Strategies as a grid of cards, and Results (comparison table that scrolls with its first column kept, simulated futures, year-by-year chart and table).

## 5. Preserved

Every input, default, saved scenario and action on the ten pages (all labels were kept verbatim): see the tests' source guards (each page still imports the engines it used) and section 9. No stored record was created, changed or deleted by the redesign. Deliberately **not** changed: `confirm()` dialogs (D20), the Hide amounts scope (these pages do not use it; a test pins that), every disclaimer (the only edits are listed in section 12).

## 6. Cross-module links

Read from the source and kept: Income to Paycheck (About text link), Paycheck to Income, Tax planning to Income, Investments and Roth planner, Giving to Tax planning and Income, Afford to Income, Projections to Investments, Income, Retirement and Goals, Retirement to Projections and Debt, Goals to Investments and Projections, Protection to Goals, the Tax planning checklist links (Open →). **Only the jump list and the Afford tabs were driven by script;** the other links were not clicked. D10 Quick Add's New paycheck scenario action: its source was not touched (not driven). No new data association was created.

## 7. Tests and build

- `npx tsc --noEmit`: clean. `npm run build`: succeeds (the usual large-chunk warning).
- New `src/pages/d18Plan.test.tsx`: **12 tests**, all pass (the shared pieces, `FanChart` default unchanged and `fit` opt-in, the presentation file does no storage, clock or engine work, each page still uses its engines, the stylesheet has no hex or priority override, Hide amounts not used, no sign-colored refunds).
- Targeted existing suites: `src/shell`, `src/pages`, date guard, Hide amounts, leak scan and read-only trap: **568 tests in 32 files, 0 failures** (includes the 12 new and the tracker guard, whose allow-list gained the 23 D18 IDs).
- **The full suite was not run locally**, as instructed; it runs in release CI.

## 8. Browser checks (headless Chrome on a throwaway copy of the fictional demo household, own address `localhost:5231`, sync off, own browser profile)

Every page at 1440 and 375, plus 320, Signature light, Signature dark (see the tracker for which views) and Classic light (Income, Afford, Protection, Tax planning at 1440 and 375). **No horizontal page overflow in any capture** (after fixing three defects found on the way: a checkbox stretched to full width inside a form, a stack column that grew to its widest table, and a heading overlapped by a negative margin). Interactions driven through the real controls: Income year to 2027 (shows the Set up 2027 prompts) and back; RSU section reached from the jump list; Afford price changed, Rent or buy years 10 to 15 and back; Projections dollars to future and back; Retirement year 2050 to 2052 and back; Goals settings opened, cost 30,000 to 31,000 and back, Calculate; Roth strategy chosen; Giving form fields named; Protection years 10 to 12 and back; Paycheck scenario opened and two columns compared; Retirement Find spending that lasts; Roth Run simulations. **Merely preserved by source review, not driven:** adding or deleting people, bonuses, vests, grants, gifts, goals, policies, strategies, windfalls and income streams; saving tax tables; copying, duplicating and deleting scenarios; Use in my tax estimate; CSV download; every `confirm()` dialog.

## 9. Financial before and after

Fictional household (key values, unchanged): Income 2026 household take-home $171,111.12 and gross $276,999.84; federal expected refund $84.32; Tax planning projected taxes $67,624.27 with $4,580.16 of bracket room; Paycheck baseline take-home per paycheck $3,874.15 against the raised scenario $4,222.84; Retirement sustainable spending $135,419.85; Goals "To be 80% sure" $12,308.79 a year; Giving given $6,100.00; Protection emergency fund 11.2 months.
Method: the text of each page's main area and the value of every input were read before and after the redesign, with the same data and the same interactions (33 views). **2,803 distinct exact-cents amounts compared: all present after except five, all the same item** (the option text "No account (start from $0)" in the Goals select, which is now inside the folded Goal settings, so the page text no longer lists it; it is still in the page, and it appears in the five Goals views). **795 input values compared: all equal except one**, explained in section 11 (item 1). New amounts after: premiums and coverage in the Protection policy summary chips, the Afford chart axis labels and the first-tab price shown on Rent or buy. The simulation results (Roth Run simulations, Retirement, Projections) came out identical before and after in these runs, so they were compared exactly. Files: `D18-Evidence\_raw\compare-values.json`.

## 10. Screenshots

`Documents\Ledger-Design-Concepts\D18-Evidence`: `Income-Paycheck`, `Tax-Roth`, `Affordability`, `Projections-Retirement`, `Goals-Giving-Protection` (after, full page, light and dark), `Comparisons` (five desktop sheets `D18-INCOME-PAYCHECK-REVIEW.png`, `D18-TAX-ROTH-REVIEW.png`, `D18-AFFORDABILITY-REVIEW.png`, `D18-PROJECTIONS-RETIREMENT-REVIEW.png`, `D18-GOALS-GIVING-PROTECTION-REVIEW.png`, and a `-MOBILE` sheet for each; Before, After light, After dark), `_raw\before`, `_raw\before-flow`, `_raw\after`, `_raw\after-flow`, `_raw\after-extra` (Classic, 320 and dark phone views) and `compare-values.json`. All labeled **Before versus After**; no approved D18 prototype exists and none was invented. The Before pictures are the deployed D17 baseline. Sheets show the top of each page.

Full-page heights, Signature light (px):

| Page | Desktop before | after | Phone before | after |
|---|---:|---:|---:|---:|
| Income | 7,209 | 8,176 | 12,448 | 14,747 |
| Paycheck (scenario open, compared) | 4,555 | 4,558 | 7,072 | 8,624 |
| Tax planning | 2,150 | 2,229 | 3,418 | 5,145 |
| Roth | 8,506 | 7,670 | 10,113 | 11,796 |
| Afford: can I afford it | 2,136 | 2,238 | 2,657 | 4,418 |
| Afford: rent or buy | 1,371 | 1,769 | 1,628 | 2,587 |
| Projections | 2,905 | 3,167 | 3,778 | 5,616 |
| Retirement | 7,774 | 8,231 | 8,465 | 10,249 |
| Goals (calculated) | 1,162 | 1,025 | 2,409 | 1,989 |
| Giving | 1,562 | 1,748 | 2,440 | 3,652 |
| Protection | 2,218 | 3,570 | 4,323 | 6,894 |

## 11. Remaining design differences and honest limits (visual assessment per page)

Hierarchy, input and result clarity and preserved function improved on all ten. Honest per-page limits:

- **Income:** much better hierarchy; the per-person pay editor (`ProfileEditor`) is the same form inside the new frame, with its own nested sections.
- **Paycheck:** results are beside the edit panel; the edit form is still long, and on a phone the page is 22% taller.
- **Tax planning, Giving:** clear; phone pages grew by 50% and 50% from stacked labeled rows.
- **Afford:** assumptions and checks read as inputs and results; Rent or buy is better separated.
- **Projections, Retirement:** charts are readable on a phone (12 px labels); Retirement is still a long page with many inputs.
- **Goals, Protection:** Goals is clearer and shorter; Protection is longer on both widths because policies and guidelines are separated with their own summary lines.
- **Roth:** the best-strategy band and the grouped assumptions help; the year-by-year table still has 15 columns and scrolls sideways on a phone.
- On a computer the Paycheck and Retirement result panels are in the right column but come first in reading order (so a phone and a screen reader meet the result first). Tab order therefore visits the result before the inputs on the left.
- **Phone pages are taller** (table above); candidates for a later pass: fold the guideline explanations, make the long year-by-year tables scroll.

## 12. Outstanding issues and product decisions (please review)

1. **Existing defect, not fixed:** `PercentField` (Retirement "Want the money to last in") keeps the value it first rendered. In the very first Before capture, taken the moment the page opened, it showed 90 (the default) while the saved value was 85; every later capture showed 85. It can show a stale value if the page paints before settings load. It is present before and after D18. A small fix is possible after a yes.
2. The Afford forecast chart and the Rent-or-buy chart now plot the exact balance, including below zero, with the month axis and exact readouts, as D17 did for Forecast (they drew $0 before). Please confirm.
3. Wording edits: Projections "How to read this" no longer says "the orange steady path" (it says "the steady path"); Retirement's result is stated in words (Meets or Below your goal) instead of green or red; Giving reminders are prefixed "Paperwork:"; the Roth winners moved from inside Results to the top of the page; Retirement's "Enter your yearly retirement spending" line now says "in Your plan"; refund or amount due, gain or loss, and gap are no longer colored by sign.
4. The Retirement results panel and the Goals "How it works" card are sticky on a computer. Sticky offsets use the header, Plan bar and page bar tokens.
5. Goal settings fold away behind a summary line for any goal that already has a cost.
6. Hide amounts still does not cover these pages (documented scope).
7. The old `Household total` card on Income was folded into the navy panel (gross, take-home, Social Security and Medicare, MA PFML); no figure was dropped (compared above).

## 13. Real-device and accessibility limitations

Not done: a real phone, a screen reader, forced colors, Safari or Firefox, a contrast measurement, a keyboard Tab walk (`Kbd` is not marked for any D18 row; only the jump buttons were driven, and they move focus to the section). Headings: each page has one h1 and h2 sections; inputs in groups are in fieldsets with legends; unlabeled table inputs were given names (Projections contributions); chart summaries and "Show as table" are those of the existing charts. Nothing is `ACC`.

## 14. Handoff

`docs/CHATGPT-HANDOFF.md` was updated (current snapshot, phase status, next action, decisions awaiting review, risks, change log), and `docs/BACKLOG.md` has the D18 status entry. D18 is recorded as built locally and awaiting review, not committed or deployed. Unknown: the CI result for D18, since it is not released.

## 15. Git status (exact)

Modified, unstaged: `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`, `docs/UI-COVERAGE.md`, `src/pages/{AffordPage,GivingPage,GoalsPage,IncomePage,PaycheckPage,ProjectionPage,ProtectionPage,RetirementPage,RothPage,TaxPlanPage}.tsx`, `src/pages/analysis.css`, `src/pages/charts.tsx`, `src/pages/fields.tsx`, `src/shell/uiCoverage.test.ts`. New, untracked: `src/pages/PlanParts.tsx`, `src/pages/plan.css`, `src/pages/d18Plan.test.tsx`, `docs/LEDGER-SIGNATURE-D18-REPORT.md`, plus the three protected files (untouched). Nothing staged, committed, pushed or deployed; no branch, remote, repository or dependency created. The demo server on port 5231 was stopped at the end.

## 16. Correction: Retirement confidence field showed a stale value (2026-11-13, same uncommitted D18 change set)

- **Root cause.** `PercentField` copied its `value` into local text once (`useState(String(value))`) and never looked at `value` again. Settings load asynchronously, so if the page painted first, the field kept the default 90 although 85 was saved. Display only: the saved value and the calculation were always right. Its only caller is Retirement "Want the money to last in (% of futures)".
- **Fix.** `src/pages/fields.tsx` only: the field remembers the last `value` it saw and, when it changes while the user is **not** focused in the field, shows the new value. While the user is typing the text is left alone. Validation, limits and blur-to-commit are unchanged; the sync only sets display text and never calls `onChange`, so loading writes nothing.
- **Tests.** Three added to `src/pages/d18Plan.test.tsx` (the sync and editing guard, commit and limits kept with no write in the sync, first render shows the value). `tsc` clean, `npm run build` succeeds, `src/pages` and `src/shell`: 545 tests in 28 files pass. The full suite was not run.
- **Browser check** (fictional data, throwaway profile, real events): saved 85 shows 85, also after reload; typing 70 saves 70; "abc" is rejected and the field keeps 70; 150 is clamped to 99 and saved; while a value was being typed ("7"), a saved change to 88 underneath did not overwrite it, and blurring with 85 saved 85. The demo data was restored to 85.
- **Calculations.** No file in `src/lib`, defaults or stored data changed; Retirement still reads `rs.targetConfidencePct`.
- **Git status.** Same as section 15 plus `src/pages/fields.tsx` (already modified) and `src/pages/d18Plan.test.tsx` (already new) edited again, and this section. Nothing staged, committed, pushed or deployed. The demo server on 5231 was stopped.
