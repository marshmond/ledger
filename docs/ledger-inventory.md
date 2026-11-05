# Ledger inventory (what exists today)

Audit date: 2026-11-02. Method: read `src/App.tsx`, `src/shell/nav.ts`, `src/types.ts`, `src/db.ts`, the engines in `src/lib`, and the
page files in `src/pages`; cross-checked against `README.md` and `docs/BACKLOG.md`. I did NOT run the app for this audit, so every
statement below is "found in code", not "seen working". The last recorded test count (BACKLOG, 2026-11-02) is 831; I did not re-run it.

Stack: React 19, React Router (HashRouter), Dexie (IndexedDB), Papa Parse, Vite, Vitest. No charting library: every chart is hand-drawn SVG.

## 1. Routes and pages

Hash routes (`src/App.tsx`), grouped as in the sidebar (`src/shell/nav.ts`). Unknown paths fall back to Home.

| Route | Page | What it does |
|---|---|---|
| `/` | Home | Reorderable, removable cards (see section 4). "Refresh prices" and "Edit Home" buttons. |
| `/checkin` | Check-in | Monthly routine: ticks itself for due scheduled items, uncategorized, old pending, budget, targets, prices, property values, forecast, backup; streak counter. |
| `/accounts` | Accounts | Checking, savings, credit card, loan accounts; reconciled-today cue; include-in-budget tick; credit limits; primary payment account. |
| `/account/:id` | Account ledger | Transactions for one account: column filter boxes, splits, transfers, move to another account, reconcile to a statement, pending/cleared/reconciled. |
| `/transactions` | Transactions | All accounts together: filters, saved filters, sort, bulk category/status/delete (status has undo), CSV export of the filtered list. |
| `/budget` | Budget | Envelope budget: Ready to Assign, rollover, card payment lines, targets (monthly, by date, yearly, repeating), foldable groups, `+25`/`-10`/sum entry. |
| `/scheduled` | Scheduled | Recurring items you approve before they post (weekly to yearly, semimonthly); due-now list; skip. |
| `/forecast` | Forecast | Day-by-day cash forecast up to 2 years from paychecks, bills, loans, taxes, one-offs, estimated everyday spending; low-cash warning. |
| `/reports` | Reports | Spending/income by month, category lines, "where spending jumped", top payees, saving rate; Sankey flow diagram with saved views; CSV download of category table. |
| `/rules` | Rules | Payee rules, rules the app suggests, repeating charges the app notices. |
| `/import` | Import | CSV import with column mapping, duplicate protection, match to manual entries, undo by batch. |
| `/categories` | Categories | Groups and categories, drag or arrow reorder, income/expense kind, hide. |
| `/networth` | Net worth | Stacked bars (assets up, debts down) plus net worth line; table of monthly points; property values and equity. |
| `/investments` | Investments | Investment accounts, holdings, asset class per security, tax lots, buy/sell with FIFO/LIFO/HIFO/average/specific lot, realized gains, HSA withdrawals, optional Twelve Data prices. |
| `/payoff` | Payoff | Minimum vs avalanche vs snowball, refinance break-even, extra payment vs investing. |
| `/debt` | Debt | Mortgage, HELOC, other loans: amortization, extra principal, rate changes, what-if shocks, optional ledger link. |
| `/income` | Income | Per-person salary, bonuses, RSU grants/vests, 401(k)/HSA/ESPP, federal and Massachusetts tax vs withholding. |
| `/taxplan` | Tax planning | Year-end projections, bracket room, withholding/safe harbor, tax-loss harvesting, checklist. |
| `/giving` | Giving | Donations, receipts, deduction value, bunching. |
| `/afford` | Afford it | Purchase affordability, rent vs buy. |
| `/paycheck` | Paycheck | Gross-to-net calculator with saved scenarios. |
| `/projections` | Projections | Steady path plus Monte Carlo fan chart, today's or future dollars. |
| `/retirement` | Retirement | Sustainable spending, success odds, year-by-year tables, CSV. |
| `/goals` | Goals | Contribution needed for goals funded from an investment account (college/529 style). |
| `/protection` | Protection | Emergency-fund runway, insurance guidelines. |
| `/roth` | Roth | Roth conversion strategy comparison. |
| `/more` | Settings | Theme/palette, saved themes, keystroke-style amount entry, shortcuts. |
| `/review` | Year in review | Printable annual summary. |
| `/guide` | If something happens | Printable family guide. |
| `/taxpackage` | Tax package | Preparer worksheet; print/PDF/CSV. |
| `/sync` | Sync devices | Encrypted file in a private GitHub repo, record-level merge. |
| `/backup` | Backup | Encrypted export/restore; weekly automatic copies to the same GitHub repo. |

Other surfaces: global search (Ctrl+K or `/`) over pages, accounts, holdings, loans, scenarios, transactions (`src/lib/search.ts`); a "+" quick-add
for transactions (`src/shell/QuickTxn.tsx`); service worker for offline use (`public/sw.js`).

## 2. Data model

Storage: browser IndexedDB through Dexie, database name `ledger`, schema version 14 (`src/db.ts`). Money is whole cents; dates are `YYYY-MM-DD`.
Records point at each other by id. Tables (from `src/db.ts` and `src/types.ts`):

- **Everyday money:** `accounts`, `categoryGroups`, `categories`, `txns`, `importBatches`, `assignments`, `recurring`, `recurringLog`, `budgetTargets`, `payeeRules`, `donations`.
- **Income and tax:** `people`, `incomeProfiles`, `bonuses`, `taxSettings`, `rsuGrants`, `rsuVests`, `payScenarios`.
- **Investing:** `invAccounts`, `assetClasses`, `securities`, `holdings`, `taxLots`, `sales`, `hsaWithdrawals`, `windfalls`, `goals`.
- **Debt and property:** `loans`, `loanRates`, `loanEvents`, `properties`, `propertyValues`.
- **History and settings:** `netWorthSnapshots` (one per month), `settings` (key/value: price API key, last backup, projection, retirement, forecast, check-in marks, saved filters, saved flow views, saved themes, Roth plan, and so on).

Fields that matter for the Monarch comparison:

- `Txn`: account, date, amount, payee, memo, status (pending/cleared/reconciled), category, optional splits (category + amount), transfer link, `externalId`, `fingerprint`, import batch, recurring id. **No tags, no notes beyond memo, no attachments, no separate "original statement" text, no hidden flag, no review flag.**
- `PayeeRule`: `pattern` (payee contains), category, optional rename, optional account. **No amount/category criteria, no order field, no tags/split actions.**
- `RecurringRule` (Scheduled): account, payee, amount, category, frequency, start/end, active; `RecurringLog` records posted or skipped.
- `BudgetTarget`: monthly, by date, yearly, or repeating (every 3/6/12 months).
- `NetWorthSnapshot`: date, cash, investments, property, cards, loans, total. No per-account breakdown and no contribution/market split.
- `Account`: kind (checking, savings, credit card, loan), opening balance, closed, credit limit, left-out-of-budget flag, last reconciled date. **No owner/household tag on everyday accounts** (investment accounts have an optional person).

Import formats: CSV only (Papa Parse). Auto-detects columns by header name; date order MDY or DMY; one signed amount column or separate debit/credit; optional bank id column; invert-sign switch.
Export formats: Transactions page CSV (filtered list; no row cap found in `src/lib/txnQuery.ts`), category report CSV, retirement table CSV, Tax package CSV, calendar `.ics`, encrypted `.ledgerbackup` (version 14), and the sync file.

## 3. Charts and what draws them

All SVG written in the repo. No chart library is installed (`package.json` has none).

| Chart | Where | Drawn by |
|---|---|---|
| Donut (spending by category, assets) | Home | `Donut` in `src/ui/charts.tsx` |
| Bar list (budget progress, owed vs owned) | Home | `BarList` in `src/ui/charts.tsx` |
| Progress ring (check-in) | Home | `Ring` in `src/ui/charts.tsx` |
| Paired columns (income vs spending, 6 months) | Home | `PairedColumns` in `src/ui/charts.tsx` |
| Stacked bars with net worth line, hover/keyboard | Home, Net worth | `NetWorthChart` in `src/ui/charts.tsx` |
| Allocation bar | Investments | `AllocationBar` in `src/pages/charts.tsx` |
| Fan chart (Monte Carlo percentiles) | Projections, Retirement, Goals | `FanChart` in `src/pages/charts.tsx` |
| Multi-line chart | Reports (top categories), others | `LinesChart` in `src/pages/charts.tsx` |
| Reports month columns | Reports | `PairedColumns` (reused) |
| Sankey flow diagram, net or gross | Reports | `src/lib/flow.ts` + `flowLayout.ts`, drawn in `src/pages/FlowPanel.tsx` |

Not found: pie/bar chart type switch on Reports, click-through from a chart point to its transactions (no navigation code in `ReportsPage.tsx`), a monthly calendar of bills.

## 4. Automation and intelligence

| Feature | Where | How it works |
|---|---|---|
| Payee rules | `src/lib/rules.ts`, Rules page | Case-insensitive "payee contains" (also compares with digits/punctuation removed). Longest pattern wins, then oldest. Sets category, optional rename, optional single-account scope. Applied on CSV import and in quick add. **Not applied automatically to existing rows**; the Rules page has a button that calls `applyRulesToExisting` (`RulesPage.tsx` line 85), which only fills uncategorized, non-split, non-transfer rows and never overwrites a category. No preview, no ordering, no OR, no stop-processing, no failure reporting. |
| Learned category suggestions | `suggestCategory`, `suggestRules` | Suggests a category when 60%+ of at least 2 past same-payee transactions agree; offers a rule when a payee was categorized the same way 3+ times and 90% of the time. |
| Repeating charge detection | `detectRecurring` | Needs 3+ occurrences, weekly/biweekly/monthly/quarterly/yearly, amounts within 15% of the median for 60%+, skips stale and already-scheduled ones. Shown on Rules; one click creates a Scheduled item (that click is the confirm step). Runs when the page renders, not after an import. |
| Scheduled items | `src/lib/schedule.ts` | Due instances appear for approval; post (editable), or skip. |
| Alerts | `src/lib/alerts.ts`, Home "Needs attention" | Fifteen kinds in `src/lib/alerts.ts`: backup age, over-budget categories, money owed, check-in steps left, forecast low point, scheduled items due, investment accounts missing an owner, holdings with no or old prices, tax lots missing data, RSU vests soon, estimated tax due, year-end items, harvestable losses, stale property values. All are on-screen only (no push or email). |
| Cash forecast | `src/lib/forecast.ts` | Deterministic day-by-day, with low-balance warning. |
| Monte Carlo | `src/lib/projection.ts` | Seeded, correlated asset classes, geometric-return conversion; used by Projections, Retirement, Goals, Roth. |
| Payoff simulator | `src/lib/payoff.ts` | Minimum, avalanche, snowball; APR capped at 35%. |
| Import matching | `src/lib/csvImport.ts` | Duplicate by bank id or fingerprint (date, amount, payee, occurrence counter); manual entries with the same amount within 3 days are marked cleared instead of duplicated; before-opening rows flagged; undo per batch. |
| Transfer detection | `findTransferCandidates` in `src/lib/transfers.ts` | Suggests pairs to link. |
| Net worth snapshots | `src/lib/snapshots.ts` | One point a month, auto-saved on open; earlier points typed in by hand (total only). |
| Check-in | `src/lib/checkin.ts` | Self-ticking monthly checklist. |
| Sync and backup | `src/lib/sync/*`, `src/lib/autoBackup.ts` | See Pages. |
| Prices | `src/lib/prices.ts` | Twelve Data, free key, 8 requests/minute; key never leaves the device except to that service. |

No AI assistant, no household sharing, no push or email alerts, no receipt scanning, no bank aggregation.

## 5. Half-built, stubbed, or worth knowing

I found no `TODO`/`FIXME`/stub markers in non-test code. Items below come from the backlog's "Not built" lists and my reading:

1. **Rules are creation-time only, plus one manual button.** Changing a rule does not re-run it; the button fills only uncategorized rows, so a rule cannot re-categorize, rename or split rows that already have a category.
2. **Past net worth points are total-only.** Hand-entered history shows as a dot with no bars (BACKLOG 2026-10-29).
3. **Order applies only to Budget and Categories.** Pickers elsewhere use the old order (BACKLOG 2026-10-29).
4. **Home layout is per device**, not synced (BACKLOG 2026-10-28).
5. **Undo exists for bulk status change only**; deletes and bulk category changes have none (BACKLOG 2026-10-26).
6. **Price refresh from the Home button and the Investments button was never run against the real service** (BACKLOG 2026-11-02, 2026-10-26).
7. **Weekly GitHub backup upload was never run against a real repository**, only a pretend one (BACKLOG 2026-10-30). The Downloads folder holds a `.ledgerbackup` dated 2026-10-31, which suggests a manual export worked; that is not proof the automatic upload works.
8. **Left-out accounts and credit card payment lines** are UNVERIFIED by test (BACKLOG 2026-10-30, judgment call 2).
9. **Restoring an automatic backup is manual**; there is no in-app list.
10. **Dead code:** `Sparkline` is no longer used on Home (BACKLOG 2026-10-29).
11. Some of the largest files (`payroll.ts` 538 lines, `rothPlan.ts` 522, `LoanCard.tsx` 469) are tax and debt engines outside this comparison; I did not review them for bugs.

## 6. How this differs from the assumption in the prompt

The prompt's ten suggested items overlap with what is already built: Home is already a card system (reorder, remove, width; per device),
the Sankey exists with saved views, Monte Carlo exists, avalanche/snowball exists, net worth history exists, a monthly check-in exists,
and recurring detection exists with a confirm click. `docs/roadmap.md` is trimmed to the real gaps.
