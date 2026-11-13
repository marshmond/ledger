# Ledger Signature D16: core Money workspace redesign

Date: 2026-11-12. **Built and tested locally. NOT staged, NOT committed, NOT pushed, NOT deployed. Awaiting owner and ChatGPT review. D17 not started.**
Everything marked "seen" was seen in headless Chrome on throwaway copies of the fictional D1 demo household (own address `localhost:5231`, sync off). Anything only read in source or covered by a test is called that. American English throughout.

## 1. D15 release gate (verified before any code changed)

Repository `marshmond/ledger`, branch `main`, `HEAD` = `origin/main` = **`8e01e617d1506effea7092b7d0f8387b5895dbc8`** (D15, "redesign Services Bills and Family details"). `gh` is not installed, so the public GitHub API was read: workflow run `43347866698` ("Deploy to GitHub Pages", push) concluded `success` for that exact SHA (the `build` job ran `npm test` and `npm run build`; the `deploy` job succeeded); Pages deployment `7754875383` for that SHA reached `success`. The commit contains the final Bills refinement (`previewByDate` in `bills/presentation.ts`, `bills/d15BillsRefinement.test.tsx`, the recomposed Needs review page) and the D15 report section 28. The previous D14 release `6fd14a3` was not accepted as the gate. The working tree held only the three protected untracked files, which were not touched.

## 2. Route inventory (verified against the repository)

| ID | Route | Page file |
|---|---|---|
| L-02 | `/ledger/checkin` | `src/pages/CheckinPage.tsx` (+ `useCheckin.ts`, unchanged) |
| L-03 | `/ledger/accounts` | `AccountsPage.tsx` |
| L-04 | `/ledger/account/:id` | `LedgerPage.tsx` (+ `TxnForm`, `RenameAccount`, `CreditLimit`, `MinBalance`, `TxnFilterUi`, `SplitDetail`, unchanged) |
| L-05 | `/ledger/transactions` (`?q`, `?project`, `?txn`) | `TransactionsPage.tsx` |
| L-06 | `/ledger/budget` | `BudgetPage.tsx` (+ `BudgetTargets`, `InlineTarget`, unchanged) |
| L-07 | `/ledger/scheduled` (`?rule`) | `ScheduledPage.tsx` |
| L-10 | `/ledger/rules` | `RulesPage.tsx` |
| L-11 | `/ledger/import` | `ImportPage.tsx` |
| L-12 | `/ledger/categories` | `CategoriesPage.tsx` |

## 3. Workflow inventory (W-14 to W-19) and what the audit found

Every existing action was kept (a source test lists the labels). Findings from the audit that matter to review: **Rules have no priority number, no enabled/disabled state and no edit** (only add and delete; "the longest matching text wins"), so none was invented. **Scheduled shows no handled history** (approve posts a pending transaction, skip writes a log row; neither is listed anywhere), so "what has already been handled" is only visible as the "scheduled" chip on the posted transaction in the ledger. There are **no institution fields and no loan/cash-specific features** on accounts. Import has three real steps only. Accounts compute their balance in the page (opening balance plus transactions); that formula is untouched. Native `confirm()` remains on bulk category, delete saved filter, undo import, delete category (D20).

## 4. Financial baseline (before any change)

Reproducible snapshot taken with the app's own functions on the fixed demo household, reference date 2026-11-12: `Documents\Ledger-Design-Concepts\D16-Evidence\Verification\baseline-authoritative-values.json` (and `after-authoritative-values.json`). It holds: a content hash and row count of ten stored tables plus settings and module rows; every account's balance, pending, cleared, counts, status counts, last-reconciled date, minimum and credit status; `reconcileCheck` per account; split sums; transfer pairs and candidates; `loadBudget` for three months (Ready to Assign, every row's assigned, activity and available, unfunded cards); `targetNeed` and `planFunding`; `dueInstances` (0 and 7 days), `occurrencesBetween` for every rule; orphaned rules; `suggestRules`; `detectRecurring`; filter and sort results with `totals`; delete dependents per account. Demo data is the D1 household plus extra invented records (a second card at 99.5 percent of its limit, a loan, a closed account, a very long account name with a $12,345,703.90 balance, two transfers, a split, pending, reconciled and project-tagged rows, six scheduled items including one paused, three payee rules, three targets, one prior import).

## 5. Files changed

Modified: `src/pages/{CheckinPage,AccountsPage,LedgerPage,TransactionsPage,BudgetPage,ScheduledPage,RulesPage,ImportPage,CategoriesPage}.tsx`; `src/shell/uiCoverage.test.ts` (adds the D16 row IDs to the built list); `docs/UI-COVERAGE.md`, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`.
New: `src/pages/money.css`, `src/pages/moneyPresentation.ts`, `src/pages/d16Money.test.tsx` (27 tests), this report.
Not changed: every engine in `src/lib`, `src/db.ts`, schema, migrations, backup, sync, security policy, service worker, `styles.css` (so the sticky offsets are untouched), shared `Modal`/`ConfirmDialog`, `TxnForm`, Quick Add, Search, Ledger Home.

## 6. What was built, page by page

- **Accounts.** A band of the same five totals (Cash, Card debt, Credit left when any limit exists, Loans when any loan exists, Net), grouped lists per account type with counts, and the Add account form in a side column on a computer (below on a phone). Each row: name link, type, "Closed" and "Primary" chips, the reconciliation line, minimum line with "under it" in words, a credit bar (a native `progress` with its value in words), the include-in-budget box, and the balance. A card or loan balance is printed unchanged with the word **Owed** beside it and is **not colored by its sign**; a cash account below zero says "Below zero" in words. The reconciliation line reads only the stored last-reconciled date.
- **Account page.** A compact header (name with rename, type chip, balance as the large figure, then Cleared, Pending, Opening), Add transaction in the header, Reconcile and the account's own tools (primary payment, credit limit, minimum balance) side by side, possible transfers, the form (it now scrolls into view when it opens), then the register. Register rows have status chips with words, a Transfer chip, "scheduled" chip, and on a phone the second line carries date, category (or the other account) and the running balance (the phone used to show neither).
- **Transactions.** The same four totals as one band, the same toolbar and filter panel, a bulk-action bar with grouped controls and a live count, status and Transfer chips, and phone rows with payee and amount on the first line. Selected rows are tinted.
- **Budget.** A Ready to Assign hero (navy under Signature, a plain card elsewhere) with Cash and Income this month, a needs-attention strip (overspent categories, uncategorized outflows), Targets, group cards with the available figure in the header, and rows with an "Overspent" chip. On a phone each category is a card with **Assigned, Activity and Available all visible** (Activity was hidden before).
- **Check-in.** A month card with a segmented bar (one segment per step that applies, filled for done, dashed outline for needs you), then "Needs your attention" first and "Done" below, each step with a status chip in words, its link and its own tick box.
- **Scheduled.** A three-figure band (Due now with the overdue count, Recurring items, Paused), due items as rows with a date tile, Overdue chip, editable date and amount and Approve and Skip, recurring items split into active and paused with frequency, range, amount with in/out word and and the form below. (A "Next scheduled" date shown in the first pass was removed in the final refinement; see section 16.)
- **Rules.** A four-figure band (counts), then the same three sections (still collapsible and remembered) with the add-rule form in a card and the tables as labeled rows on a phone.
- **Import.** A three-step indicator read from the page's own state (file, columns, review), the three steps as cards, status chips for every classification, an unreadable-rows list, and past imports as rows with a long-filename-safe layout; an explicit sentence when date or description is not yet mapped.
- **Categories.** A four-figure band, group cards with count and arrows, category rows with labeled name box, type select and delete (drag handles, arrows, targets and the Initial setup note kept).

## 7. Preservation (how it was checked)

**Engine snapshot identical before and after** (every key `identical`: tables, balances, reconcile, splits, transfers, budgets, targets, due dates, occurrences, rules, suggestions, repeating detection, query results, dependents) in `golden-master-comparison.json`. **Every dollar figure that a page showed before is still shown after** (72 page, look and width comparisons; no figure missing; the new pages may add words and counts). Source tests pin the engine calls (`loadBudget`, `planFunding`, the balance formula, `reconcileCheck`, `finalizeReconcile`, `dueInstances`, `postInstance`, `commitImport`, `undoBatch`, `applyRulesToExisting`, `bulkSetCategory`), the destructive controls and deep-link reads, and that `moneyPresentation.ts` does no money maths, no write and no clock read. Presentation is "read the same value, place it, add a word".
Transfers: pair relationships, Unlink and Link as transfer are unchanged and the pair rows show a Transfer chip. Splits: the stored parts are untouched; the toggle and expansion are the same components. Reconciled rows: warnings and confirmations live in the unchanged `TxnForm` and `TxnDeleteDialog`.

## 8. Tests

`npx tsc --noEmit` clean. `npm run build` succeeds (the usual large-chunk warning). Full suite once: **274 files, 5,146 tests, 0 failures** (before D16: 273 files, 5,119). 27 new tests in `src/pages/d16Money.test.tsx`: wording helpers, check-in segments and groups equal the model, account row values and words (debt not red, closed accounts show no reconciliation, under-minimum in words, excluded box unchecked), due row actions and labels, engine results for occurrences and due instances and that listing creates no row, budget row values and that reading writes nothing, and the source guards above plus "no hex, raw radius or priority override in `money.css`".

## 9. Browser workflows (on throwaway copies, `browser-workflows.json`)

**47 of 47 passed** on the final code: add an account (others unchanged, empty name error in words); add, edit and delete a transaction (balance moved by exactly the amount and back; delete asks first); reconcile (balanced result, lock reconciles the cleared rows, a wrong balance says "Off by" and offers no lock); search, sort, bulk category (amount unchanged), the `?txn`, `?project` and `?q` deep links; budget assignment saved and Ready to Assign moved by exactly the change, group collapse, target editor; scheduled approve (exactly one pending transaction and one log row), skip (log row, no transaction), create, pause, delete (asks, removes only that item), `?rule` deep link; rule add (no existing transaction touched) and delete; category add, kind change, delete; CSV import (mapping, preview, unreadable row reported by line, preview wrote nothing, rows created in the chosen account, re-import creates no new rows, undo removes only that batch, an all-bad file offers nothing); check-in (opening marked nothing, a tick stores a mark); account delete blocked with reasons when scheduled items use it and nothing deleted. No console errors. **Not exercised in the browser:** split editing in the form, a transfer edited across accounts, moving a transaction to another account through the form, bulk status with Undo, saved filters, the Link as transfer button, drag-and-drop reordering, Copy last month and Fund targets (their code is unchanged and covered by the existing suites).

## 10. Responsive, theme and accessibility sweep (`responsive-accessibility-sweep.json`)

10 views x 5 widths (1440, 1024, 800, 375, 320) x 4 looks (Signature light and dark, Classic light, Slate light) = **200 cells: no horizontal overflow, exactly one h1, no skipped heading level, every interactive control has an accessible name, no clipped text.** The first sweep found the two transaction tables 18 px too wide at 800 px; narrower side padding at 641 to 1100 px fixed it. Small touch targets: up to 43 controls under 24 px in a view remain (inline "link" buttons such as row actions and "fund" or "edit"; they are the existing 44 px phone rules' exceptions, not changed). **Sticky header:** the prior offset problem did not reproduce at 1440 (header row bottom = filter row top, gap 0, on both tables); the shared rules in `styles.css` were left alone. No keyboard walk, no screen reader, no forced-colors mode and no real phone were used.

## 11. Visual evidence (`Documents\Ledger-Design-Concepts\D16-Evidence`)

`Baseline` (before: 9 routes plus the account variants, Signature light and dark and Classic, 1440 and 375, populated and empty, and 18 interaction states), `Accounts`, `Transactions`, `Budget`, `Scheduled`, `Checkin`, `Rules`, `Import`, `Categories` (after), `Comparisons` (seven labeled before and after sheets: Accounts, Account detail, Transactions, Budget, Scheduled, and the supporting pages as separate desktop and phone files), `Verification` (snapshots, comparison, workflows, sweep, page metrics). No page-specific approved prototype exists for the Money pages; the sheets compare before with after only and claim no prototype approval.

## 12. Honest page-by-page assessment

| Page | Structure | Dense data | Phone | Remaining resemblance to the old UI |
|---|---|---|---|---|
| Accounts | Clearly new: totals band, grouped cards, side form, debt worded | n/a | Good; the form drops below the list | Low |
| Account page | New header and tools; register kept as a table | Efficient; register is 4 percent shorter on a computer | **Longer:** 8,034 to 11,263 px for 75 rows (two-line meta, running balance, category now shown) | Medium (the register is the same table) |
| Transactions | Band, toolbar, chips and bulk bar recomposed; table kept | Efficient (6,080 to 5,917 px) | Longer (10,551 to 12,516 px) | Medium |
| Budget | New hero, attention strip and group cards | Table kept on a computer | **Better information, taller** (3,164 to 4,136 px): Activity now visible | Low on a computer, medium structurally |
| Check-in | New progress bar and attention-first groups | n/a | Fine | Low |
| Scheduled | New: date tiles, due and paused sections, band | n/a | Longer (2,923 to 4,202 px) | Low |
| Rules | Counts band and cards; the three sections are the old ones | Tables kept | **Much longer** (3,181 to 5,206 px): stacked rows replace a table that used to scroll sideways | Medium |
| Import | New step indicator and cards | Preview table kept | Fine (872 to 1,103 px) | Low to medium |
| Categories | New band and group cards; same controls and drag handles | n/a | Longer (3,092 to 3,886 px) | Medium |

I do not claim every page is as far from the old interface as Home, Today or Calendar: the account register, the transaction table, the budget table and the Rules and Categories controls keep their old working structure on a computer on purpose (dense tables were not replaced by cards).

## 13. Decisions and open items for review

1. **Phone page height is up on most pages** (numbers above; the account page and Transactions were reduced again in section 16). Candidates: show the running balance only on tap, drop "Add task" from phone rows, or paginate the register on a phone. Not decided; the information was kept visible because the old phone register hid category and balance.
2. Net, Card debt and Loans are printed in ink, not red or green; money-out and money-in totals keep red and green because they name a direction. Say if you want those neutral too.
3. ~~"Next scheduled" on Scheduled~~ **Resolved in section 16: the line was removed.**
4. **No bulk bar stickiness.** It stays in flow above the table (as before); a sticky bar was tried and removed because bottom-sticky does not follow the page and top-sticky collides with the table heading.
5. Pre-existing, not changed: choosing the same file twice in a row on Import does not re-read it (browser behavior); an account page for a missing id shows "Loading…" forever; the floating Add button overlaps the last amount on a phone; native `confirm()` sites remain (D20); no Rules edit, priority or disable exists.
6. Preferences preserved: folded sections (`ledger-collapsed`), theme and palette storage, month in Budget (not stored, as before). Signature is still opt-in.

## 14. Not done / limits

Not real-device, screen-reader or forced-colors tested; no Safari or Firefox; no keyboard walk (so no `Kbd` marks and no `ACC`). D20 dialogs, D17 to D19 pages untouched. Handoff, backlog and the coverage tracker were updated (see below).

## 15. Git status

Modified: nine page files, `src/shell/uiCoverage.test.ts`, `docs/UI-COVERAGE.md`, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`. New: `src/pages/money.css`, `src/pages/moneyPresentation.ts`, `src/pages/d16Money.test.tsx`, this report. Still untracked and untouched: `docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`. Nothing staged, committed, pushed or deployed; no branch, remote or repository created.

## 16. D16 Final Mobile Refinement and Financial Workflow Verification (2026-11-13)

Built and tested locally; **still NOT staged, committed, pushed or deployed; awaiting owner and ChatGPT review; D17 not started.** Baseline re-verified: `main` = `origin/main` = `8e01e617d1506effea7092b7d0f8387b5895dbc8` (D15; its CI run and Pages deployment succeeded, read in section 1), D16 uncommitted and unstaged, the three protected files untouched. Pictures: `Documents\Ledger-Design-Concepts\D16-Evidence\Refinement`. New files: `src/pages/RowActions.tsx`, `src/pages/d16Refinement.test.tsx`. Edited: `LedgerPage.tsx`, `TransactionsPage.tsx`, `ScheduledPage.tsx`, `money.css`. No engine, schema, sync, backup, shared dialog, global navigation or Quick Add file changed.

### 16.1 Diagnosis of the mobile rows

A first-pass phone row was four lines: payee and chips, a one-to-two-line meta line (date, category or other account, running balance), then a full 44 px row of text links (Add task, Clear, Edit, Unlink, Delete), with the amount to the right. The repeated link row was the single biggest cost (about 44 px plus padding in every one of 75 or 92 rows), and the links were small targets (up to 43 controls under 24 px in a view). Content that matters for scanning: payee, exact amount, date, category / split / transfer, status, running balance. Secondary: the actions. Interactions checked before changing anything: the row checkbox is a separate control in the first column; the split toggle is its own button inside the row; Edit scrolls to the form; Delete opens the guarded dialog; a whole-row tap target was **not** used because it would collide with selection and split expansion.

### 16.2 What changed (presentation only)

- **Phone only (640 px and narrower):** each row is two lines. Line 1: payee with its status chip (and Transfer chip) and the exact amount. Line 2: date, account or category (or the other account of a transfer) and, on the account page, the running balance, with **one labeled "Actions" button at the right** (44 px high). The row's actions sit in a small menu under that button: Add task, Clear (pending rows), Edit, Unlink (transfers), Delete (last, separated by a rule, in the danger color).
- The menu is a native `details`/`summary` (touch, Enter and Space all work; open state announced). The button is named for its row ("Actions for Demo Market, 2026-11-06"); each item keeps its own long name ("Delete Demo Market, 2026-11-06"). Escape closes it and returns focus to the button; a tap or click elsewhere closes it; choosing an action does not close it, so Delete's confirmation dialog still opens from, and returns focus to, a visible button. Delete still goes through `TxnDeleteDialog`; nothing was deleted by opening the menu (browser-checked).
- The row checkbox sits in a 44 px label area (it was a 24 px box); the split toggle is 44 px high; the Transactions phone row now shows the status chip for **every** row (cleared rows had none before).
- **Computer widths are unchanged:** the same row of links, the same table (page heights equal the first pass: account page 5,232 px, Transactions 5,917 px, at 1440). The only desktop-width difference is the intentional removal in Scheduled (below).
- **Nothing silently removed:** Add task, Clear, Edit, Unlink, Delete, Select, split details and transfer details are all present; no long-press, swipe or unlabeled icon is the only way to anything. Nothing was paginated, truncated or virtualized.

### 16.3 Phone page heights (Signature light, 375 px, full page)

| Page | D15 (before D16) | First D16 pass | Final |
|---|---:|---:|---:|
| Account page, 75 rows | 8,034 | 11,263 | **9,249** (-18% vs first pass, +15% vs D15) |
| Transactions, 92 rows | 10,551 | 12,516 | **10,399** (-17% vs first pass, -1.4% vs D15) |
| Credit card account | 2,384 | 3,031 | 2,749 |
| Scheduled | 2,923 | 4,202 | 4,089 (Next scheduled removed) |

Typical row heights now: 92 px for a single-line payee (was about 132), 124 to 184 px for a long payee or a split row. At 320 px a row is 92 to 244 px because the meta line wraps; the Transactions page is 11,772 px and the account page 9,811 px at 320. The account page is still taller than D15 because it now carries the balance hero, tools and the running balance and category on every row, which D15 hid on a phone. Budget, Rules, Categories and the other pages were not changed in this round and keep their section 12 heights.

### 16.4 Touch targets

Before: row links under 24 px; row checkbox 24 px. After (measured in the browser): Actions button 44 px, every menu item 44 px, checkbox area 44 by 44, split toggle 44. The 200-cell sweep finds **0** controls under 24 px on the phone Transactions and account views (it found up to 43 per view before; the remaining small inline controls elsewhere, such as "fund" and "edit" links in Budget, are unchanged). Adjacent controls do not overlap: the menu opens as a floating panel below the button and the button, checkbox and amount are separate grid cells.

### 16.5 Floating Add overlap

Reproduced: while scrolling, the round Add button sits over the right edge where amounts are printed, so an amount passing beneath it is hidden for a moment. **At the end of the page the last amount is clear of the button** (browser check: no rectangle overlap; the page already reserves space at the bottom). No permanent obstruction exists, so no change was made; a page-scoped gutter would waste about 64 px of every row. Left as a documented, transient limitation of any floating button; the global Quick Add was not touched.

### 16.6 Scheduled date label

The "Next scheduled" line (from `occurrencesBetween`, which ignores approved and skipped dates) was **removed**. No concise, reliable label exists without a new calculation, and the task said not to invent one. The recurring list keeps frequency, start and end dates, amount with in/out word, account and category or transfer, the Paused state, and edit, pause and delete. `occurrencesBetween`, `dueInstances`, Approve and Skip are unchanged (a source test pins the page free of the import and the words). Scheduled's desktop page is 103 px shorter (2,252 to 2,149).

### 16.7 Browser results: financial workflows (throwaway copy; `Refinement\Verification\financial-workflows.json`)

**25 of 25 passed.** Split: the split transaction opens with its parts; changing the parts (100.00 and 54.00 of 154.00) stores them with the same categories and the same overall amount; the account balance is unchanged; parts that do not add up (100.00 and 50.00) are refused and nothing is stored. Transfer: changing the amount updates both sides and keeps them linked, balances move by exactly the difference, no duplicate pair; moving one side to another account shows the existing move sentence, keeps the pair linked, makes no duplicate, and the balances follow. Account move: a plain transaction keeps its id, payee, date, category and amount, is gone from the original account, is in the destination, and both balances move by exactly its amount. Bulk status: only the selected rows changed (other pending rows untouched); the message offers Undo; Undo restores each row's own previous status exactly. Saved filters: save (stored, confirmed), restore after a reload (search text and fewer rows), delete (the existing confirmation) removes only the filter; transaction count and total unchanged throughout. Link as transfer: the two halves become one linked pair with amounts and accounts unchanged. Fund targets: stored assignments grew by exactly the amount the page reported and Ready to Assign fell by the same amount. Copy last month: next month holds exactly the current month's assignments. Category drag and drop: dragging a category above another changed only the order (same ids). No console errors. **Not tested:** moving a reconciled transaction (the warning text is in the unchanged form), cross-group category drops, drag on a real touch screen.

### 16.8 Keyboard verification (real key events, headless Chrome; `keyboard-and-touch.json`)

**30 of 30 passed.** Desktop Transactions: the search box, every filter and header control, select-all, sort buttons, column filters, row checkboxes, Edit and Delete are reached by Tab in a logical order and **every one shows a focus indicator**; Space selects a row and shows the bulk bar; the bulk controls are reached by Shift+Tab from the rows (they sit above the table, as before); Enter on a split toggle expands it (aria-expanded); Enter on Edit opens the form; Enter on Delete opens the dialog with focus inside, nothing deleted; Escape closes it and focus returns to the Delete button. Account page: the Reconcile controls are in the Tab order and Enter on Check reports "Off by" in words. Scheduled: Approve and Skip are reachable with their long names and Enter on Skip logs that date and posts nothing. Phone: Tab reaches each row's Actions button (named for its row, visible focus); Enter or Space opens the menu; Tab moves into it (Add task, Edit, Delete, each with a focus ring); Escape closes it and returns focus to the button; Enter on Edit opens the form; a tap elsewhere closes the menu; Delete from the menu opens the confirmation and deletes nothing; cancelling leaves every record; selecting a row neither opens its menu nor expands anything, and opening a menu does not change the selection. No keyboard trap was found. These were synthetic key events in headless Chrome, **not** a physical keyboard and **not** a screen reader; no screen-reader claim is made.

### 16.9 Financial snapshot comparison

`Refinement\Verification\golden-master-comparison.json`: the authoritative snapshot (balances, reconcile, splits, transfers, budgets, targets, due dates, occurrences, rule suggestions, repeating detection, filter results, delete dependents, stored table hashes) taken on the untouched fictional household with the final code is **identical to the pre-D16 baseline in every key**. No dollar figure shown by any page in D15 is missing in the final pages (72 comparisons). Desktop pages equal the first D16 pass in height and figures except Scheduled (the removed line) and one timing difference in Budget (the Targets section opens when the page loads before its data does, so Budget's height varies between 2,685 and 3,040 px between runs; this is existing behavior, not caused by this change). The workflow and keyboard runs used disposable copies; the untouched household was never mutated.

### 16.10 Tests

`npx tsc --noEmit` clean; `npm run build` succeeds. Full suite once on the final code: **275 files, 5,158 tests, 0 failures** (first D16 pass: 274, 5,146). 12 new tests in `src/pages/d16Refinement.test.tsx`: the phone and computer trees of the row actions, every action and its long name still inside the actions on both pages, Delete still through the guarded dialog, the selection box and split toggle outside the menu, the phone row's contents, no write or handler in the actions component, the Scheduled page free of the removed line and of `occurrencesBetween`, the engine functions still exported, 44 px targets and tokens in the CSS. (There is no financial masking on these pages to test: Hide amounts is a Today and Household setting.) The 200-cell sweep (10 views, 5 widths, 4 looks) was repeated on the final code: **0 problems**.

### 16.11 Visual evidence (`D16-Evidence\Refinement`)

`D16-ACCOUNT-MOBILE-FINAL.png` and `D16-TRANSACTIONS-MOBILE-FINAL.png` (D15 before, first D16 pass, final, full-page crops plus normal 375 by 812 screens in light, dark and Classic), `D16-TRANSACTION-ACTIONS-MOBILE.png` (closed and open menus at 375 and 320, dark, selected rows), `D16-SCHEDULED-FINAL.png`, `D16-DESKTOP-REGRESSION.png`; `Verification` holds the JSON results; `_raw` holds the individual captures. The crops are labeled with their page heights and the register crops start at the Transactions heading, so nothing important is cropped out.

### 16.12 Remaining limitations and concerns

Not real-device or screen-reader tested; the keyboard walk used synthetic events. The 800 px width uses the desktop table, where the Payee column is narrow and long payees make tall rows (unchanged from the first pass; a candidate for a later pass). On a phone the bulk-selection bar is tall (it includes the project controls). The Actions menu floats over the next row while open. Moving a reconciled transaction was not browser-tested. Page heights above are Signature light; Classic and dark differ by a few pixels.

### 16.13 Git status

Modified: nine D16 page files (Ledger, Transactions and Scheduled edited again), `src/shell/uiCoverage.test.ts`, `docs/UI-COVERAGE.md`, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`, `docs/LEDGER-SIGNATURE-D16-REPORT.md` (new, untracked). New and untracked: `src/pages/money.css`, `moneyPresentation.ts`, `RowActions.tsx`, `d16Money.test.tsx`, `d16Refinement.test.tsx`. Untouched protected untracked files: `docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`. Nothing staged, committed, pushed or deployed; no branch, remote, repository or dependency created.

## 17. Final release verification (2026-11-13)

ChatGPT approved the full D16 design and the five refinement sheets; commit and deployment were then explicitly authorized, conditional on the focused checks below. **No further UI change was made in this step.**

- **Baseline re-read:** `main` = `origin/main` = `8e01e617d1506effea7092b7d0f8387b5895dbc8` (D15; Actions run `43347866698` success; Pages deployment `7754875383` success); nothing was staged; the three protected files untracked and untouched.
- **Mobile Actions implementation:** unchanged from section 16 (native `details`/`summary` in `src/pages/RowActions.tsx`, used by the account register and Transactions on phones; the same row of links at computer widths).
- **Focused interaction checks, normal viewports, 375 px and 320 px, throwaway copy of the fictional household (`Refinement\Verification\final-interaction-checks.json`): 43 of 43 passed.** Actions opens by click; the account register offers Add task, Edit and Delete (plus Clear on a pending row and Unlink on a transfer row), Transactions offers Edit and Delete; a second tap, a tap elsewhere (and Escape, section 16.8) close the menu; for seven rows from the top, middle and end of each page the open menu stays fully inside the viewport at both widths; Edit opens the existing editor; Delete opens the existing confirmation and deletes nothing; selecting a row does not open its menu; a split toggle expands its parts without opening a menu; with every sixth row and the last rows brought into view, the floating Add button covers neither an amount nor an Actions button, and at the end of the page the last row is clear. Keyboard access and visible focus: section 16.8 (30 of 30, not repeated). Viewport screenshots: `Verification\final-account-375.png`, `final-account-320.png`, `final-transactions-375.png`, `final-transactions-320.png`.
- **Final mobile page heights (Signature light, 375 px):** account page 9,249 px (D15 8,034; first D16 pass 11,263); Transactions 10,399 px (D15 10,551; first pass 12,516).
- **Scheduled:** the "Next scheduled" line is removed; `occurrencesBetween`, `dueInstances`, Approve and Skip are untouched.
- **Desktop preserved:** account page 5,232 px and Transactions 5,917 px at 1440, equal to the approved first pass (section 16.9).
- **Final diff inspected against the D15 baseline:** modified are the nine D16 page files, `src/shell/uiCoverage.test.ts`, `docs/UI-COVERAGE.md`, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`; new are this report, `src/pages/money.css`, `moneyPresentation.ts`, `RowActions.tsx`, `d16Money.test.tsx`, `d16Refinement.test.tsx`. **Nothing under `src/lib`, `src/db.ts`, `src/core`, `src/modules`, `public`, `package.json` or the lockfile changed**, so no balance, posting, split or transfer arithmetic, reconciliation, budget, recurrence, import or undo, rule matching, schema, backup or sync code was touched. The only new import of library code in the pages is a type (`Step`) in Check-in. No data, secret or dependency is included.
- **Tests run for this step:** `npx tsc --noEmit` clean and `npm run build` succeeds on the final source; targeted run of nine files (the two D16 test files, the coverage guard, the accessibility and structure guards, the delete guards, the two sticky-offset guards and the schedule engine tests): **190 of 190 passed**. The full local suite was **not** rerun for this step (it last ran on the same source apart from documentation: 275 files, 5,158 tests, 0 failures); the release CI run is the confirming full run.
- **Browser-unverified (not claimed to have passed):** moving a reconciled transaction; cross-group category drops and drag on a real touch screen; Import with a real bank file; anything on a physical phone, a physical keyboard or a screen reader.
- **Outstanding limitations:** no real-device or screen-reader acceptance (the tracker marks stay `BLT`, nothing is `ACC`); the 800 px width keeps the desktop table with a narrow Payee column; the phone bulk-selection bar is tall; the Actions menu floats over the next row while open.
