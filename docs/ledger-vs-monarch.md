# Ledger vs. Monarch Money: gap matrix

Date: 2026-11-02. Ledger status comes from `docs/ledger-inventory.md` (read from code, not run). Monarch facts are copied from the
benchmark checklist in the prompt; I did not research Monarch myself, and the research report file was not in `docs/`. Anything the
prompt marked unconfirmed is marked unconfirmed here too.

Legend. Status: Have / Partial / Missing. Effort: S (days), M (about a week), L (multi-week). Value: for a single-household, local-first user.
Fit: Good = works fully offline with no server; Opt-in = needs the user to supply a key or file; Poor = no good local option.

## Import and data in

| Monarch feature | Status | Evidence | Effort | Value | Fit / local-first substitute |
|---|---|---|---|---|---|
| Bank aggregation (Plaid, MX) | Missing, by design | none; README says no server | n/a | High for Monarch, Low here | Poor. Substitutes below. BACKLOG records the owner chose manual CSV for now, SimpleFIN Bridge as the thing to revisit. |
| CSV import, auto-detect columns | Have | `csvImport.ts` `detectMapping`; `ImportPage.tsx` | n/a | High | Good |
| Duplicate prevention | Have | bank id, then fingerprint with occurrence counter; `classifyRows` | n/a | High | Good |
| Match to manual entries | Have, basic | same amount within 3 days, marks cleared; undo by batch | S to improve | Med | Good. Missing vs Actual Budget: payee similarity and a per-row undo on the match. |
| Saved column mappings per account | Missing | mapping resets on every file (`ImportPage.tsx` `onFile`) | S | High | Good (store in `settings`) |
| OFX / QFX import | Missing | no parser | M | Med-High (many banks offer it; it carries a unique transaction id, which makes dedupe exact) | Good |
| Re-import updating changed rows | Missing | duplicates are skipped, not updated | M | Low-Med | Good. Monarch behavior also unconfirmed. |
| Paste-in transactions | Missing | | S | Med | Good |
| Quick-add | Have | `shell/QuickTxn.tsx`, `+` button, primary account | n/a | High | Good |
| Receipt scanning | Missing | | L | Low | Poor locally without an OCR model; opt-in bring-your-own-key at most |
| Uncapped, filtered CSV export | Have | `txnQuery.ts` `toCsv`, Transactions page; no cap found | n/a | Med | Good (already beats Monarch's 10,000 cap and no filters, per the prompt) |

## Transactions and rules

| Monarch feature | Status | Evidence | Effort | Value | Fit |
|---|---|---|---|---|---|
| Ordered rules | Missing | `PayeeRule` has no order; longest match wins | M | High | Good |
| Criteria: merchant contains / exact | Partial | contains only; against payee as stored | S | High | Good |
| Criteria: amount, category, account | Partial | account only | M | High | Good |
| OR logic | Missing | | M | Med | Good |
| Action: rename merchant | Have | `rename` | n/a | High | Good |
| Action: set category | Have | | n/a | High | Good |
| Action: tags, hide, review status, link to goal | Missing | no such fields on `Txn` | M | Med | Good |
| Smart split by percent or dollar | Missing | splits exist (`Txn.splits`) but no rule can make them | M | Med | Good |
| Preview changes before saving | Missing | | S-M | High | Good |
| Retroactive apply | Partial | button fills uncategorized rows only | S | High | Good |
| Visible rule failures / what a rule did | Missing | no log | M | Med | Good. Firefly's silent failures are the thing to avoid. |
| Original statement text kept beside cleaned name | Missing | rename overwrites payee on import (`commitImport`) | S | Med | Good. Needed so rules can match the original after a rename. |
| Tags | Missing | | M | Med | Good |
| Notes | Partial | `memo` only | n/a | Low | Good |
| Attachments | Missing | | L | Low | Poor (IndexedDB bloat, sync file size, public-repo risk avoided but private repo limits apply) |
| Bulk edit | Partial | category, status, delete; status has undo | S | Med | Good. Add undo for category and delete. |
| Merchant merge / rename in bulk | Missing | only via rules | S | Med | Good |
| Manual transactions | Have | | n/a | High | Good |
| Swipe-style review queue | Partial | Check-in "categorize" step and filters; no one-at-a-time queue | M | Med | Good (keyboard-first, per the prompt) |
| Activity log | Missing | | M | Low-Med | Good |

## Budgeting

| Monarch feature | Status | Evidence | Effort | Value | Fit |
|---|---|---|---|---|---|
| Category budgeting with rollover | Have, and stricter | envelope budget with Ready to Assign (`lib/budget.ts`); rollover always on | n/a | High | Good |
| Per-category rollover toggle | Missing | rollover is built into the envelope rule | M | Low-Med | Good. Conflicts with the envelope model; probably skip. |
| Flex budgeting (Fixed / Non-monthly / Flex) | Missing | targets have monthly/yearly/repeating kinds but no bucket view | M-L | Med (see decision in the roadmap) | Good |
| Weekly flex (monthly / 4.3) | Missing | | S | Low | Good |
| Green/yellow/red status | Partial | Home budget bars turn amber past 85%, red when over | S | Low | Good |
| Move money between buckets | Partial | assigning by hand; no move button | S | Med | Good |
| Goal contributions inside the budget | Missing | `Goal` is separate from the budget | M | Med | Good |

## Recurring

| Monarch feature | Status | Evidence | Effort | Value | Fit |
|---|---|---|---|---|---|
| Detection with confirm | Partial | `detectRecurring` on Rules page, one click adds | S | Med | Good. Missing: "not recurring" memory (dismissed guesses reappear), re-run after import. |
| One recurring item per merchant | Partial | detection avoids already-scheduled payees | S | Low | Good |
| Monthly calendar (paid / different amount / upcoming) | Missing | Home "Coming up" list and `.ics` export only; Scheduled page is a list | M | Med-High | Good |
| List view, all recurring | Have | `ScheduledPage.tsx` | n/a | Med | Good |
| Match posted transactions to a recurring item (paid status) | Missing | `Txn.recurringId` is set only when approved from Scheduled; imported bills are not matched | M | High (this is what makes the calendar and "bill paid" work) | Good |

## Goals

| Monarch feature | Status | Evidence | Effort | Value | Fit |
|---|---|---|---|---|---|
| Save Up goals linked to account balances | Partial | `Goal` is funded by one investment account; no everyday-account goals | M | Med | Good |
| Pay Down goals with avalanche/snowball, debt-free date | Have (separate page) | `payoff.ts`, `PayoffPage.tsx` | n/a | High | Good. Not saved as a plan into the budget. |
| Save the debt plan into the budget | Missing | | M | Med | Good |

## Dashboard and visualizations

| Monarch feature | Status | Evidence | Effort | Value | Fit |
|---|---|---|---|---|---|
| Reorderable, hideable dashboard cards | Have | `homeLayout.ts`, Edit Home; per device | n/a | High | Good. Gap: layout is not synced; no separate phone layout. |
| Spending trend, budget, net worth, transactions cards | Have | Home cards | n/a | High | Good |
| Cash Flow report (income, spending, difference, saving rate) | Have, partial | `reports.ts` `savingsRates`, month columns | S | Med | Good. No quarterly/yearly grouping. |
| Spending/Income report: group by category, group, or merchant | Partial | categories and top payees as separate lists | M | High | Good |
| Pie or bar toggle, total vs change over time | Missing | Home donut only | M | Med | Good |
| Filters: timeframe, category, merchant, account, tag, amount | Partial | Transactions page has most filters; Reports has none | M | High | Good |
| Click a data point to open its transactions | Missing | no navigation from charts | S-M | High | Good |
| Saved reports with relative ranges | Missing | flow views are saved; other reports are not | M | Med-High | Good |
| Sankey | Have | `flow.ts`, saved views, net and gross | n/a | Med | Good. Missing: share with amounts hidden. |
| Net worth over time by account type | Have, partial | `NetWorthChart`, monthly snapshots | n/a | High | Good. Per-account lines missing; history before first use is total-only. |
| Net worth change attribution (market / contributions / debt paydown) | Missing | snapshots hold no per-account or flow data | L | High (Monarch does not document it; Ledger's investments, lots and loans give real inputs) | Good |
| Month in Review | Missing | "Year in review" exists for the year only | M | Low-Med | Good |
| Weekly recap | Missing (Monarch's is unconfirmed) | | S-M | Low | Opt-in: exportable summary |

## Investments and planning

| Monarch feature | Status | Evidence | Effort | Value | Fit |
|---|---|---|---|---|---|
| Holdings by type/institution/account, allocation | Have | `InvestmentsPage`, `AllocationBar` | n/a | High | Good |
| Prices | Have, opt-in | Twelve Data key, manual fallback; BACKLOG notes it was never run against the real service | n/a | Med | Opt-in |
| Cost basis and tax lots | Have (Monarch paywalls it) | `lots.ts`, five sale methods | n/a | High | Good |
| Realized gains, tax-loss harvesting | Have (Monarch undocumented) | `Sale`, `taxPlan.ts` | n/a | High | Good |
| Time-weighted return vs S&P 500 | Missing | no return history; benchmark would need prices over time | L | Med | Poor/opt-in (needs a price history source) |
| Deterministic forecast, scenarios, life events | Have, more | `ProjectionPage`, `RetirementPage`, `Windfall`, `PayScenario` | n/a | High | Good |
| Monte Carlo (Monarch has none) | Have | `projection.ts` | n/a | High | Good |
| Named scenarios for projections | Partial | pay scenarios and Roth strategies are saved; projection settings are one set | S-M | Med | Good |

## Intelligence, alerts, collaboration

| Monarch feature | Status | Evidence | Effort | Value | Fit / design |
|---|---|---|---|---|---|
| AI assistant | Missing | | M | Med | Opt-in only. Bring-your-own-key; send only date, amount, payee and category, never account names or balances; show the exact payload before sending; off by default. Public-repo and privacy rules in CLAUDE.md apply. |
| MCP connector for outside AI tools | Missing | | L | Low | Poor: needs a local server process, which a browser app cannot run. |
| Alerts | Partial | on-screen "Needs attention" (15 kinds) | n/a | Med | Poor for push/email (needs a server). Local substitutes: calendar `.ics` (exists), exportable weekly summary file. |
| Budget/flex threshold alerts | Partial | over-budget alert exists; no 80% warning | S | Low-Med | Good |
| Household sharing | Missing | sync is one person's file; investments have an owner field | L | Low-Med (owner is a two-person household) | Opt-in: BACKLOG shows two people already exist for income. A shared private repo with the same encrypted file could serve two people today; per-account privacy is unsolved. Flag: **no good local option for granular permissions.** |
| Advisor access | Missing | | n/a | Low | Poor. Tax package and "If something happens" printouts cover most of it. |
| Credit score, advice cards | Missing | | n/a | Low | Poor. Skip. |

## Other differences worth knowing

| Item | Status | Note |
|---|---|---|
| Demo / sample-data mode | Missing | No sample data in `src`. Helps testing, screenshots, and onboarding. S-M, Good. |
| Keyboard-first review | Missing | Global search and shortcuts exist; no review queue. |
| Tax, payroll, Roth, RSU, mortgage, HELOC, Giving, Afford, Protection | Have; Monarch has none | Ledger's real advantage beyond privacy. |
| Offline use | Have | service worker |
| Subscription | None | |
| Mobile app | Partial | Installable PWA, phone layouts checked at 375px. |
