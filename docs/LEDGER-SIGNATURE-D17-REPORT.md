# Ledger Signature D17: Financial Insights, Investments and Debt Redesign

Date: 2026-11-13. **Built and tested locally. NOT staged, committed, pushed or deployed. Awaiting owner and ChatGPT review. D18 not started.** American English.

## 1. Release gate (D16)

- Repository `marshmond/ledger`, branch `main`; after `git fetch`, `HEAD` = `origin/main` = `3bd981b0d580a96cf8031120767bfe18f1a5922a` ("feat(ui): redesign core Money workspace", the D16 release commit).
- CI: workflow "Deploy to GitHub Pages", run #103 (`43374099026`), `build` job success (it runs `npm test` and `npm run build`) and `deploy` job success. Pages deployment `7758245307` (environment `github-pages`) is for the same SHA. Read from the public GitHub API because `gh` is not installed.
- `docs/LEDGER-SIGNATURE-D16-REPORT.md` read. The final mobile Actions refinement is in the commit (`src/pages/RowActions.tsx` and `d16Refinement.test.tsx` are in it), and the "Next scheduled" line is gone from `ScheduledPage.tsx` (0 matches in the committed file). The report's own section 16 still says "uncommitted"; that text is stale (the same commit holds it).
- Git status at the start: only the three protected untracked files. They were not touched.

## 2. Route inventory (verified against the repository)

| ID | Route | Page | In-page views |
|---|---|---|---|
| L-08 | `/ledger/forecast` | `ForecastPage.tsx` | none |
| L-09 | `/ledger/reports` (`?project`) | `ReportsPage.tsx`, `FlowPanel.tsx`, `FlowViews.tsx` | IV-29 Trends, IV-30 Flow diagram |
| L-13 | `/ledger/networth` | `NetWorthPage.tsx` | none |
| L-14 | `/ledger/investments` | `InvestmentsPage.tsx`, `TradePanels.tsx`, `PriceCell.tsx`, `HsaLog.tsx` | IV-24 Accounts, IV-25 Realized gains, IV-26 Prices and assumptions |
| L-15 | `/ledger/payoff` | `PayoffPage.tsx` | none |
| L-16 | `/ledger/debt` | `DebtPage.tsx`, `LoanCard.tsx` | none |

Nav groups: Forecast and Reports are in Money; Net worth, Investments, Payoff and Debt are in Invest (the page eyebrows follow that).

## 3. Existing views and workflows (all kept)

Forecast: look-ahead, everyday-spending override and "use the estimate", other income, warning level, count savings, include taxes, per-person vest switches, one-off items (add, delete), month table, next-24-items table, warning banner, chart with its table. Reports: Through month, project filter and its chip, five comparison figures, spending and income chart and table, jumps, categories chart and table with CSV download, top payees (month or 12 months), Flow diagram (saved views, Net or Gross, period and custom dates, Groups or All categories, account and category switches, "include Initial setup", readout, table). Net worth: headline and change, five components, history chart, add a past point, all points table with delete, property cards (value history, add value, secured loans, include, delete), add property. Investments: totals by kind, allocation by account, add account, per-account owner, tax type, rename, cash, holdings table (shares, price, value, cost basis, gain or loss), lots, buy, sell, remove, add holding, close, delete, HSA log, refresh prices, realized gains by year with undo, API key, price table, asset class assumptions. Debt: loan cards (summary, balance chart, details, rate changes, extra principal and draws, what-if rates, schedule with CSV, ledger link and payment recording), net worth table, add a loan. Payoff: debts table (include, card APR and minimum, remove), extra monthly amount, three strategies, chart, order list, refinance tool, extra-versus-invest tool.

## 4. Files changed

Modified: `src/pages/{ForecastPage,ReportsPage,FlowPanel,NetWorthPage,InvestmentsPage,TradePanels,DebtPage,LoanCard,PayoffPage}.tsx`, `src/pages/charts.tsx` (the shared line chart, opt-in options only), `src/pages/fields.tsx` (one optional `ariaLabel` on `NumField`), `src/shell/uiCoverage.test.ts`, `docs/UI-COVERAGE.md`, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`.
New: `src/pages/analysis.css`, `src/pages/analysisPresentation.ts`, `src/pages/d17Analysis.test.tsx`, this report.
**Not changed:** anything in `src/lib` (every engine), `src/db.ts`, `src/types.ts`, sync, backup, Search, Quick Add, global navigation, theme storage, the Service Worker, `package.json`. The shared `src/ui/charts.tsx` (Home's charts, including `NetWorthChart`) was not edited.

## 5. Forecast (L-08)

A navy hero with the 12-month end balance, labeled **Projected**, and four supporting figures each tagged **Actual** (cash today) or **Projected** (lowest point and date, money in, money out). A warning banner states the first date cash drops below the warning level (the same sentence as before, red-level when the projected low is below zero). A strip of **Assumptions in use** chips (look-ahead, everyday spending and whether it is the history estimate or your number, other income, warning level, savings counted, tax included). The look-ahead select moved next to the chart it changes (it was inside Assumptions). The chart is drawn at the box's real width with a month axis, and now plots the **exact** projected balance including months below zero (it used to draw $0 for them and apologize in a note). Month table and next-24 table keep every column and scroll sideways on a phone with the month or date kept in view. The calculation, inputs and settings keys are unchanged.

## 6. Reports (L-09)

Trends: a compact controls card (Through, Project and the chip), a five-figure band, the spending and income chart (month axis, exact readout), the monthly table, then Categories (top-5 chart, table, CSV) beside "Where spending jumped" and "Top payees" on a wide screen. The comparison text is now words ("This month is down $423.99 (−15%)") and **no longer red or green by direction**. Savings rate and "vs avg" are plain numbers with their sign. Flow diagram: same Sankey and controls, the controls in one card and the totals in a figures band. **On a phone the same flows are offered as a readable list first** (from, to, exact amount, share of income, a share bar) with a List or Diagram switch; the diagram and the table are unchanged, and nothing is hidden on a computer. The diagram itself was not redrawn: on a computer the layout is the same as before.

## 7. Net worth (L-13)

Hero with today's figure (**Current**), the change since the base point in words, saved-point count, latest point date, property value count. Then two cards, **What you own** (cash, investments, property) and **What you owe** (credit cards, loans), each line with its source and a link (Accounts, Investments, Debt). Owed amounts keep their stored negative sign and a sentence says a negative balance is a debt, not an error. History keeps the shared `NetWorthChart` untouched, adds a sentence that nothing is estimated between points, and a **missing-month note** (for example "No point was saved for July 2026"), because the chart places saved points side by side and a gap would otherwise look like no gap. Hand-entered points carry a **Total only** tag in the table. Property cards are recomposed; valuation forms and the delete confirmations are the same.

## 8. Investments (L-14)

Accounts: hero with the total (**Current, at stored prices**) and the totals by type in full cents (they were rounded to K). The missing-price notice is a banner with the same sentence. Allocation keeps its bar and table, now with a visible keyboard ring. Each account is a card whose header shows name, type, tax type, owner, holding count, invested, cash, a "No price" tag, total and a labeled show or hide button, so the account is understood before it is opened. The holdings table has the same columns (cost basis and gain or loss used to be hidden on a phone; they are now shown) and becomes labeled rows with 44 px buttons (Lots, Buy, Sell, Remove, each named for its ticker) on a phone. Gain and loss is plain text with a "+" sign, not green or red. Lots, buy and sell panels, their previews and every field are the same; the sell preview is tagged **Preview, not yet logged**. Add account moved into a collapsed section (open when there are no accounts). Realized gains: year control, four-figure band, sales as rows (gain with a sign and the short or long split; "Not taxed" tag; Undo named for its sale), the same notes. Prices and assumptions: key card tagged "Stored on this device"; the price table adds a **price kind** tag (No price, Entered by hand, From market data) and the date and source; "No price" rows say holdings are valued at $0 until a price is entered; assumptions are tagged **Your assumptions, not predictions** with the original explanation.

## 9. Debt (L-16)

Hero with what you owe on loans, tagged "From each loan's schedule", with a sentence that later schedule months are projections. Each loan card now shows rate, next payment and date, payoff month and **Owed now** in its header, a figures band (payment now, rate now, paid off and interest tagged **Projected**), and the existing chart (drawn at real width, exact readout). What-if loans carry a "What-if: not counted in your debt" tag. A loan linked to a ledger account is tagged. Interest for the rest of the loan is in full cents (it was K or M). Details, rates, extra principal, what-ifs, schedule, ledger link and payment recording are the same.

## 10. Payoff (L-15)

Three groups, in order: **Your debts** (current balances; rates and minimums you type are tagged **Your inputs**; a card with no rate carries a **Rate not entered** tag, and the original warning stays); **Pay them off** (the extra amount tagged Your input, three strategy cards you choose between, each with debt-free time, interest paid and interest saved, tagged **Projected**; the chart and order list; the same disclaimer plus "projections from what you entered, not guarantees"); **Refinance and extra payments** (inputs on the left, a dashed **Projected** result panel on the right; the return and tax rates are tagged as your assumptions). Saves and costs are said in words, not colors. Avalanche and snowball were already in the product and are unchanged.

## 11. Financial-data preservation

No file in `src/lib`, `src/db.ts` or `src/types.ts` changed (`git status` lists only presentation files). Before and after, on the fictional demo household (net worth $227,543.09; cash $31,830.04; investments $79,899.68; property $425,000.00; cards −$572.00; loans −$308,614.63; one realized sale of +$510.00; mortgage $293,814.63 owed, car loan $14,800.00; payoff avalanche interest $1,615.31 with no extra and $1,306.49 with $100 extra): **every exact-cents amount on all nine views is present after (331 compared, 0 missing) and all 130 input values are identical.** The Payoff extra-payment run moved from $0 to $100 and back, and the engine results changed as expected. The one value-bearing display change: Forecast now plots the exact projected balance below zero (the data series is the table's own `endCents` and `lowCents`; the old page replaced negatives by 0).

## 12. Chart semantics and accessibility

`LinesChart` (`src/pages/charts.tsx`) got four **opt-in** options (`fit`, `allowNegative`, `precise`, `axis="month"`); with none of them the markup is the same as before (a test pins that). Fit mode draws at the box's real width, so axis labels are 12 px instead of about 5.7 px on a 375 px phone. The other `LinesChart` callers (Afford, Review, Roth) are unchanged; Debt and Payoff and Reports and Forecast opt in. Readouts show exact cents when asked; the aria-label gives start and end values; arrow keys step through points; "Show as table" stays (every month in month mode). Kinds of figure are marked by a word and a border style (solid, dashed, dotted, warning edge), not by color alone. Red and green are not used for positive or negative; "Rate not entered" and "No price" use the warning tag with words. Hide amounts was **not** extended to these pages (its documented scope excludes them); a test pins that none of the six pages references it.

## 13. Screenshots

`Documents\Ledger-Design-Concepts\D17-Evidence`: `Forecast`, `Reports`, `Net-Worth`, `Investments`, `Debt-Payoff` (after, full page), `_raw\before` and `_raw\after` (25 each), `Comparisons` (five desktop sheets `D17-FORECAST-REVIEW.png`, `D17-REPORTS-REVIEW.png`, `D17-NET-WORTH-REVIEW.png`, `D17-INVESTMENTS-REVIEW.png`, `D17-DEBT-PAYOFF-REVIEW.png` and a `-MOBILE` file for each; Before, After light and, where made, After dark), `Verification` (`sweep-final.json`, `keyboard.json`). All labeled **Before versus After**; no approved D17 prototype exists and none was invented. Sheets show the top of each page; the full captures are in the folders. The scroll-hint lines were added after the last picture.

Full-page heights, Signature light:

| View | Desktop before | after | Phone before | after |
|---|---:|---:|---:|---:|
| Forecast | 3,722 | 4,229 | 4,361 | 5,069 |
| Reports Trends | 3,598 | 2,953 | 3,252 | 3,784 |
| Reports Flow | 1,275 | 1,465 | 1,881 | 2,212 |
| Net worth | 1,620 | 2,040 | 2,369 | 3,780 |
| Investments Accounts (one account open) | 1,765 | 1,936 | 2,901 | 3,195 |
| Realized gains | 962 | 962 | 1,010 | 1,263 |
| Prices and assumptions | 1,780 | 1,947 | 2,322 | 4,015 |
| Debt | 10,156 | 10,254 | 14,241 | 16,301 |
| Payoff | 2,725 | 2,799 | 3,325 | 5,415 |

## 14. Tests performed (proportionate)

- `npx tsc --noEmit`: clean. `npm run build`: succeeds (the usual large-chunk warning).
- New `src/pages/d17Analysis.test.tsx`: **13 tests**, all pass (wording helpers, month-gap helper, price kinds, chart options and that the default chart is unchanged, `NumField` name, and source guards: presentation helper has no storage, clock or engine import; none of the six pages references Hide amounts; no charting library; the stylesheet has no hex color and no priority override; gain and loss not colored by sign).
- Targeted existing suites run: `src/shell` (all 18 files, 400 tests, including the updated tracker guard), `d12HomeMobile` (it guards that the Net worth page passes no chart height; an early draft that did was reverted), `dateGuard`, `d16Money`, `d16Refinement`: **467 tests, 0 failures** across 23 files.
- **The full suite was not run locally**, as instructed; it runs in release CI.

## 15. Browser workflows performed (headless Chrome and the in-app pane; fictional data, sync off)

Forecast: look-ahead 12 to 6 months and back (hero $2,866.85 at 6 months equals the April row of the 12-month table), chart arrow keys. Reports: Through month (October's totals equal the monthly table), Flow period 3 months to this month and back, band and readout. Net worth: figures, missing-month note, all-points table. Investments: Accounts, one account opened, lots opened, Buy panel opened and **not submitted**, Realized gains, Prices. Debt: three loans read (one what-if). Payoff: extra 0 to 100 to 0 through the real field, strategy cards, order heading. Nothing was bought, sold, undone, saved or deleted; the only stored changes were the demo household's own look-ahead, flow period and payoff extra, all restored. Sweep: 108 cells, 0 problems (section in UI-COVERAGE 1.14). **Merely preserved by source review, not driven:** adding a past net worth point, adding or deleting property values, adding or removing accounts, holdings and classes, saving the API key, refresh prices, undo sale, the debt forms, rate changes, extra principal, ledger link and payment recording, one-off add and delete, refinance and extra-versus-invest result tables (read but not varied), CSV downloads.

## 16. Genuine design improvements

A headline figure with its meaning on every page; actual, projected, assumption and unknown figures told apart in words; Forecast and Reports charts readable on a phone and showing months and shortfalls; Net worth split into own and owe with sources, and honest about gaps; Investments accounts explained before opening, full figures instead of K rounding, a phone holdings layout that keeps cost basis and gain, price kinds spelled out; Payoff strategies as comparable choices with results marked projected; the Flow diagram has a readable phone alternative.

## 17. Remaining design differences and honest limits

- **Phone pages are taller** (table above), most for Payoff (+63%), Net worth (+60%), Prices (+73%) and Debt (+14%), from added context and labeled rows. Candidates: collapse the hero's supporting figures, or make asset-class assumptions scroll like the other tables. Not decided.
- The Flow diagram's drawing is unchanged on a computer; the improvement is around it and the phone list. No color-blind check of its bands was done.
- Reports and Forecast month tables scroll sideways on a phone (first column kept); only the record-like tables (holdings, lots, sales, debts, property values, assumptions) became labeled rows.
- The Net worth chart (shared, D12) was not touched: its y-axis labels stay 11 px and its tooltip stays hover or focus.
- Several `confirm()` dialogs remain (delete loan, holding, lot, property, sale undo, snapshot): D20.
- Debt and Debt-page loan forms and the schedule tables keep their old markup inside the new card.
- No chart contrast measurement and no forced-colors check were made.

## 18. Unresolved financial or product decisions

1. Forecast chart now draws the true negative balance (the old note said it showed $0). Confirm this is wanted.
2. Direction colors were removed from Reports comparisons and gain and loss. Say if spending going up should be flagged some other way.
3. The Investments "Add account" form is collapsed unless there are no accounts.
4. "Debt-free in" and similar results are still the engine's; the unknown-APR state is the existing "0 makes the card look free" warning plus a tag (no new treatment of unknown rates; the engine still uses 0).
5. Hide amounts still does not cover these pages (documented scope); extending it is a separate owner choice.

## 19. Outstanding checks

Real phone, screen reader, forced colors, Safari and Firefox, a color-vision check of chart series, and a keyboard walk of Reports, Net worth and Debt (only Forecast, Investments and Payoff were walked) are not done. Nothing is `ACC`.

## 20. Git status (exact)

Modified, unstaged: `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`, `docs/UI-COVERAGE.md`, `src/pages/{DebtPage,FlowPanel,ForecastPage,InvestmentsPage,LoanCard,NetWorthPage,PayoffPage,ReportsPage,TradePanels}.tsx`, `src/pages/charts.tsx`, `src/pages/fields.tsx`, `src/shell/uiCoverage.test.ts`. New, untracked: `src/pages/analysis.css`, `src/pages/analysisPresentation.ts`, `src/pages/d17Analysis.test.tsx`, `docs/LEDGER-SIGNATURE-D17-REPORT.md`, plus the three protected files (untouched): `docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`. Nothing staged, committed, pushed or deployed; no branch, remote or repository created. The demo server on port 5231 was left running (stop it by the process listening on that port).
