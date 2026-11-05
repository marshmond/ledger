# Ledger roadmap (from the Monarch gap analysis)

Date: 2026-11-02. Nothing here is built or approved. Per the working rule in `CLAUDE.md`, the owner decides what to build; this is the
proposal. Gaps come from `docs/ledger-vs-monarch.md`; what exists comes from `docs/ledger-inventory.md`. Effort is rough (S days, M about
a week, L multi-week). Ranking is value over effort.

Ground rules every item must respect (from `CLAUDE.md`): money in whole cents; records point at each other by id; new optional fields need
no migration, but new tables need a migration, backup support and sync tracking; test data invented; check in a browser at desktop and 375px.

## Which of the prompt's ten items are already built

| # | Item | Status today | What is left |
|---|---|---|---|
| 1 | CSV/OFX import, dedupe, saved mappings, undoable matching | CSV, dedupe, batch undo, manual-entry matching exist | Saved mappings, OFX/QFX, paste-in, per-row match undo (Wave 1, item A) |
| 2 | Ordered rules engine | Payee-contains rules exist, no order | All of it (Wave 1, item B) |
| 3 | Flex budget | Envelope budget with targets exists | A flex view; needs the owner's decision (Wave 2, item F) |
| 4 | Reports builder | Fixed reports and a Sankey with saved views exist | Drill-through first, then the saved-report object (Wave 1 item D, Wave 2 item E) |
| 5 | Net worth over time, with attribution | Over time: built. Attribution: missing | Attribution (Wave 2, item G) |
| 6 | Recurring detection, confirm, calendar | Detection and one-click add exist; no calendar, no paid matching | Matching and calendar (Wave 1, item C) |
| 7 | Forecast, pay-down simulator, Monte Carlo | All three exist | Named projection scenarios only (Wave 3) |
| 8 | Keyboard-first review queue | Not built (Check-in lists uncategorized) | Wave 2, item H |
| 9 | Customizable Home | Built, per device | Sync the layout; separate phone layout; hide-without-remove (Wave 3) |
| 10 | Demo mode | Not built | Wave 1, item I |

Deferred as asked: live investment prices beyond what exists, tax-lot analytics, multi-user sync.

---

## Wave 1: highest value for the effort

### A. Import v2: saved mappings, OFX/QFX, paste-in (M)

- **User story.** When I download a statement from my bank every month, I do not want to re-pick columns, and I want the bank's own transaction ids so duplicates are impossible.
- **Data model.** One `settings` entry `importMappings`: `{ [accountId]: CsvMapping }` (no migration; syncs with settings). `Txn.externalId` already exists and is used for OFX `FITID`. Optional new `Txn.statementText` (see B) holds the original description.
- **UI.** Import page: after choosing the account, a saved mapping loads automatically with a note "Using your saved layout for NAME" and a "Change" link; "Save this layout" tick on the mapping card. Accept `.ofx`/`.qfx` in the same file picker; OFX needs no mapping step. New "Paste rows" box (tab- or comma-separated, same mapping) for banks with no export. Preview table gains an "Undo this match" link on matched rows before commit.
- **Acceptance.** (1) Second import for the same account skips the mapping step. (2) An OFX file imported twice adds nothing the second time (keyed on `FITID`). (3) Credit card OFX amounts have the right sign. (4) Existing CSV tests still pass; new tests cover OFX parsing, SGML-style OFX 1.x and XML OFX 2.x. (5) Nothing is written until confirm.
- **Risks.** OFX 1.x is not valid XML, so a small tolerant parser is needed (no dependency required). Banks differ on sign and on `FITID` stability; keep the fingerprint fallback. Do not log file contents.
- **Why first.** Aggregation is Monarch's core and Ledger has none; clean, remembered import is the substitute.

### B. Rules v2 (M-L)

- **User story.** I want rules to categorize, rename, tag and split by merchant and amount, see what a rule will change before it does, and run it over my history.
- **Data model.** Extend `PayeeRule` with optional fields only: `order`, `name`, `conditions` (list of `{field: 'payee'|'statement'|'amount'|'category'|'account', op: 'contains'|'equals'|'gt'|'lt'|'between', value}`), `match: 'all'|'any'` (this gives OR without nested logic; the Firefly weakness the prompt notes is mixing AND with OR, which this avoids by choosing one per rule), `actions` (`rename`, `categoryId`, `addTags`, `hide`, `needsReview`, `split: [{categoryId, percent|cents}]`), `stopProcessing`. Old rules keep working: no `conditions` means the current `pattern` behavior. `Txn` gets optional `statementText`, `tags: string[]`, `hidden`, `needsReview`. No migration needed for optional fields; confirm the index list is unchanged. Backup version stays 14 unless a new table is added.
- **UI.** Rules page: a draggable and arrow-reorderable list; edit form with condition rows and an All/Any switch; **Preview** button shows a table of the rows that would change (before/after) and a count, with nothing saved; **Apply to existing** with the same preview; a "Last run" panel listing rules that matched nothing, rules shadowed by an earlier "stop", and rules whose category was deleted (the visible-failure requirement). Keep "Rules the app suggests".
- **Acceptance.** (1) Rules run in list order; first "stop" ends the chain. (2) Preview and apply give the same rows. (3) Applying never changes a reconciled transaction unless the user ticks a box. (4) Split actions require an amount condition and must sum exactly to the transaction (last part takes the rounding cent). (5) A rule pointing at a deleted category is shown as broken, not silently skipped. (6) Old rules produce identical results to today (regression tests on `matchRule`).
- **Risks.** Largest change in the plan to `Txn` and to sync (merge is per record, later edit wins, so a bulk apply on one device overwrites edits made elsewhere; show that in the preview). Rename-on-import currently destroys the original payee, so statement text must be stored before any rule renames. Reconciled and transfer rows need guards.
- **Local-first notes.** No server. Rule failures are shown on the page, not logged elsewhere.

### C. Recurring v2: paid matching and a bill calendar (M)

- **User story.** I want to see this month's bills as paid, paid at a different amount, or still coming, without approving each one by hand.
- **Data model.** None required for matching: compute at display time by looking for a transaction in the same account, payee normalized like the rule, within a date window (default plus or minus 5 days of the due date) and amount within a tolerance. Optional `RecurringRule.tolerancePct` and `windowDays`. A dismissed-guess list in `settings` (`notRecurring: string[]`) so rejected detections stop reappearing.
- **UI.** Scheduled page gets a Month view: a 7-column grid, one chip per due item, green paid as expected, yellow paid at a different amount (shows both amounts), blue upcoming, grey skipped; click opens the item or the matching transaction. Home "Coming up" stays. Rules page detection gets "Not a repeating charge".
- **Chart spec.** Calendar grid in plain CSS grid, no library. Data shape: `{ date, ruleId, expectedCents, matchedTxnId?, actualCents?, state: 'paid'|'different'|'upcoming'|'skipped' }[]`. Empty state: "No scheduled items yet" with a link to the detection list.
- **Acceptance.** (1) An imported bill with a slightly different amount shows yellow. (2) Two items for the same payee do not claim one transaction twice. (3) Past months render from history without writing anything. (4) Works at 375px (list fallback under 480px).
- **Risks.** Payee text varies by bank; a wrong match is worse than none, so show matches as suggestions the user can unlink. Weekly items give 4 to 5 chips a month.

### D. Reports drill-through (S-M)

- **User story.** When a bar or slice looks wrong, I want to click it and see the transactions behind it.
- **Data model.** None. Reuse `TxnFilter` from `txnQuery.ts`; link to `#/transactions` with filter state in the query string (or in the existing last-filter setting).
- **UI.** Reports: category rows, month columns, top payees, and Home donut slices become links that open Transactions with the matching category/payee/month filter applied and a chip row that can be cleared.
- **Acceptance.** (1) The total on the Transactions page equals the number clicked. (2) Splits count the split amount, as the reports do. (3) Back button returns to Reports.
- **Risks.** Reports exclude transfers and the Initial setup category, so the target filter must apply the same exclusions or totals will not match; test that explicitly.

### I. Demo / sample-data mode (S-M)

- **User story.** I want to take screenshots, try a feature, or show someone the app without touching my real numbers.
- **Data model.** None. Opens a second Dexie database named `ledger-demo`, filled from an invented-data generator in `src/lib`.
- **UI.** More, Settings: "Try with sample data" switch with a persistent banner ("Sample data, your real data is untouched") and an "Exit" button. Sync, auto-backup and price lookups must be off in demo mode.
- **Acceptance.** (1) No write to the real database or to GitHub while in demo mode (test with a spy). (2) All pages render with the sample set. (3) Sample data is clearly invented and contains no real names or numbers (public repo rule).
- **Risks.** `db` is a module-level singleton, so switching databases needs care (a reload with a flag is the safe route). Highest-risk leak: sync or auto-backup running in demo mode.

---

## Wave 2: strong value, more work

### E. Reports builder: one saved-report config (L)

- **User story.** I want to ask "dining out by month for the last two quarters" once, save it, and see it update.
- **Data model.** `settings` key `savedReports`: `{ id, name, dimension: 'category'|'group'|'merchant'|'tag'|'account', measure: 'total'|'overTime', chart: 'pie'|'bar'|'stackedBar'|'sankey', range: {kind:'relative', n, unit}|{kind:'fixed', from, to}, filters: TxnFilter }`. Same pattern as `savedFilters` and `flowViews`, so no migration.
- **UI.** Reports gets a builder bar (group by, measure, chart, range, filters) and a saved-reports list; the existing fixed sections become presets. Sankey remains its own panel but takes the same range and filters.
- **Chart spec.** Pie: existing `Donut`. Bar: existing `BarList`. Stacked bar over time: new small SVG component modelled on `NetWorthChart` (data `{ label, parts:[{key, cents}] }[]`, legend, hover and arrow keys); no library needed. Empty state: "Nothing matches these filters" with a Clear filters button. Colors from the existing `--chart-N` tokens, never the only signal.
- **Acceptance.** (1) Every chart total matches Transactions for the same filters. (2) "Last 2 quarters" is relative and recomputes on load. (3) Pie is limited to the top N plus Other.
- **Risks.** Scope creep. Do D first; build E only after drill-through proves the filter plumbing.

### F. Flex-style budget view (M-L), needs a decision

- **User story.** I want one "flex" number for everyday spending, separate from fixed bills and yearly items.
- **Data model.** Optional `Category.bucket: 'fixed'|'nonMonthly'|'flex'`, so no migration. Fixed and non-monthly can be inferred from targets (monthly or repeating target means fixed or non-monthly) as the default.
- **UI.** A toggle on Budget: Envelope (today) or Flex. Flex shows three sections and a single remaining-flex figure (income minus fixed minus non-monthly minus goal contributions); weekly flex = monthly / 4.3 per the research.
- **Acceptance.** Same underlying transactions and assignments in both views; switching never changes data.
- **Risks.** The two models disagree on rollover (envelope always rolls; flex rolls only if toggled). Offering both risks confusing the user. See the decision at the end.

### G. Net worth change attribution (L)

- **User story.** When net worth moves, I want to know how much was my saving, how much was the market, and how much was paying down debt.
- **Data model.** Needs per-account history that snapshots lack. Add optional `parts` to `NetWorthSnapshot`: `{ accountId, cents }[]` for ledger accounts, investments, loans (new optional field, no migration). Contributions: derive from transfers into investment accounts and `Sale`/buy records; market change = total change minus contributions minus debt principal paid (loan ledger already splits principal and interest when linked). Mark the split as an estimate.
- **UI.** Net worth page: "What changed" card with a waterfall for the chosen month or year: income saved, contributions, market change, debt paid, other; hover for detail.
- **Chart spec.** Waterfall as SVG (hand-drawn like the rest). Data `{label, deltaCents, kind}[]` summing to the net worth change. Empty state: needs two snapshots with parts; before that, say why.
- **Acceptance.** Components sum exactly to the change; months without per-account data show "not available" rather than a guess.
- **Risks.** Existing history is total-only, so attribution starts from the day this ships. Manual balances make "market change" a residual that also absorbs data-entry mistakes. State that honestly in the UI. UNVERIFIED: whether the investment contributions are cleanly separable from the ledger today; needs a spike first.

### H. Keyboard-first review queue (M)

- **User story.** I want to clear the day's new transactions quickly: see one, accept or change its category, move on.
- **Data model.** Uses `Txn.needsReview` (from B); until then, "uncategorized or pending/cleared-not-reviewed". Optional `Txn.reviewedAt` is not needed.
- **UI.** `#/review-queue` (or a Check-in step opens it): one row at a time, suggested category shown (from `suggestCategory`), keys: Enter accept, C change category, S split, Tab next, U undo. Counter "12 left".
- **Acceptance.** Fully usable with keyboard only; every action undoable; no change on skip.
- **Risks.** `/review` already means Year in review; name carefully. Depends on B for the flag.

---

## Wave 3: later or opt-in

- **J. Sync the Home layout, hide without remove, separate phone layout (S-M).** Move the layout from browser storage to `settings` (already synced). Add `hidden: true` per card. Risk: two devices with different screens fighting over one layout, hence the separate phone entry.
- **K. Named projection scenarios (S-M).** Save sets of assumptions for Projections and Retirement as `settings` entries, compare side by side like Paycheck scenarios already do.
- **L. Save a debt-payoff plan into the budget (M).** From Payoff, create targets on the debt payment categories.
- **M. Optional AI assistant (M, opt-in).** Bring-your-own API key stored in this browser only (never in backups or sync, like the price key). Sends only date, amount, payee, category for the rows needed to answer, never account names or balances; shows the exact outgoing text with Send/Cancel; off by default. Privacy risk: anything sent to a third party leaves the device. Needs the owner's explicit comfort with that.
- **N. Exportable weekly summary (S).** A saved HTML or text file the owner can email to themselves; no server.
- **O. Two-person household via a shared private repo (L).** The existing sync can in principle serve two people with the same encrypted file; per-account privacy and permissions have no good local design. Flag: do not build without a clear need.
- **P. Time-weighted return vs S&P 500 (L).** Needs a price history source; defer with live prices as the owner asked.

---

## The one decision that gates the plan

**Do you want Ledger's budget to stay envelope-only, or to offer Flex too (item F)?** Everything else can be built without answering it, but F changes how people read the Budget page and how Home progress bars work.

A close second: **rules v2 (item B) changes the transaction record** (original statement text, tags, hidden, needs-review) and rewrites how rules run. It also feeds C, D, E and H, so it is the item whose design is hardest to undo.
