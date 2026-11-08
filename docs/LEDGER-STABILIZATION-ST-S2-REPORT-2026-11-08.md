# Ledger Stabilization ST-S2: cross-module deletion safety, shared utilities and workflow consistency

**Date:** 2026-11-08 (America/New_York). **Author:** Claude. **Status: BUILT AND TESTED LOCALLY. NOT STAGED, NOT COMMITTED, NOT PUSHED, NOT DEPLOYED, NOT REAL-DEVICE TESTED, NOT yet independently reviewed.** ST-S3 and Family Management were not started.

## 1. Executive summary

- **DI-02 (the main item).** Deleting a Finance transaction now shows what else in Ledger points at it, and only deletes when the owner presses Delete. A shared, read-only contract (`src/core/txnDependents.ts`) lets each module report its own references through the existing module registry, so Finance imports no household module. Readers exist for Bills, Household Services, Home & Assets, Projects and Finance's own scheduled-payment history.
- **The delete is guarded and all-or-nothing.** `applyTxnDeletion` plans again inside one database transaction and refuses (deleting nothing) if anything differs from what the owner was shown, or if any reader cannot run. A bulk selection is one transaction: a failure halfway through 50 rolls back all 50 (tested, and reproduced in the real browser).
- **No household record is deleted, edited or "repaired"** and no typed amount is substituted. The existing readers' own "payment not found, needs review" behaviour is what the owner sees afterwards. `spend()`, `householdSpend()`, `billsRecordedPayments()` and the B5 union are untouched and their golden masters pass unchanged.
- **Shared utilities (ARCH-01, 02, 03):** Hide Amounts moved to `src/core/hideAmounts.ts`; one `isSafeUrl` (`src/lib/safeUrl.ts`) replaces three identical copies; five identical local-date helpers now delegate to the existing `localISO`.
- **Wording and discovery (UX-02, UX-01, NV-01):** the household notice says "Cross-module totals verified" or "Some spending relationships need review" instead of borrowing Finance's word "reconciled"; Today states what Hide Amounts does and does not cover; Household finances is found by global Search (page only, no figures).
- **Tests:** 3,357 in 183 files before, **3,449 in 189 files** after (+92 tests, +6 files). `npx tsc --noEmit` clean, `npm run build` succeeds (the existing 2.28 MB chunk warning), `git diff --check` clean. No schema change, no migration, no new dependency, no new table, no sync-format change.
- **One real defect found by my own browser check and fixed during the work** (section 9): an edit to only the memo of a transaction after the preview was not treated as a change.

## 2. Verified ST-S1 commit and deployment

| Check | Result |
|---|---|
| Repository | `origin` = `https://github.com/marshmond/ledger.git` |
| Branch | `main` |
| `HEAD` vs `origin/main` after `git fetch` | both `5e1f1829a5fc607afca2bdc811cccec7893a7fea`; 0 commits ahead |
| ST-S1 commit | `5e1f182` "fix(stabilization): ST-S1 account integrity, lossless sync conflicts, date-safe tests, backup preferences" |
| Pages run for that exact commit | **#75, `completed` / `success`** (2026-11-08T19:16:19Z); #74 (`8e77af4`) and #73 also success. Read from the public GitHub API with `curl`; the `gh` tool is not installed on this machine |
| ST-S1 final conflict-history corrections included | yes: `src/lib/sync/conflicts.ts` and `conflictHistory.test.ts` are tracked at `HEAD`; the 56 tests under `src/lib/sync` pass |
| Working tree at the start | clean |
| Unexpected commits | none (`HEAD~1` is the B5 commit `8e77af4`) |
| Baseline test count | **3,357 passed in 183 files** (re-run before any change; same as the ST-S1 report) |

## 3. Baseline and final test counts

| | Tests | Files |
|---|---:|---:|
| Baseline at `5e1f182` | 3,357 | 183 |
| Final (uncommitted) | **3,449** | **189** |

Named groups, each run on its own at the end: financial golden masters 90, Finance Scheduled integrity 39, ST-S1 sync and conflict history 56, Bills 841, Household finances 148, Household Services 610, Home & Assets 252, Calendar and Tasks 113, backup and restore 51, shifted-date and time-zone 57. All pass.

## 4. File inventory

**New source (12 files):** `src/core/txnDependents.ts` (contract and reader), `src/core/txnDependentsBuild.ts` (shared helper for the module readers), `src/core/hideAmounts.ts`, `src/lib/txnDeletion.ts` (plan and guarded apply), `src/lib/safeUrl.ts`, `src/pages/TxnDeleteDialog.tsx`, `src/modules/{bills,services,assets,projects,ledger}/txnReferences.ts` (5 readers), `src/modules/household/searchSource.ts`.

**New tests (6 files, +92 tests):** `src/lib/txnDeletion.test.ts` (32), `src/lib/txnDeletionGuards.test.ts` (13), `src/lib/safeUrl.test.ts` (31), `src/core/hideAmounts.test.ts` (6), `src/core/localDate.test.ts` (3), `src/modules/household/st-s2.test.ts` (7).

**Changed source (functional):** `src/core/registry.ts` (new optional `contributes.txnReferences` and `allTxnReferenceProviders()`); the five module `index.tsx` files (register their reader); `src/lib/txnBulk.ts` (`bulkDelete` now one transaction); `src/pages/LedgerPage.tsx`, `src/pages/TransactionsPage.tsx` (use the dialog); `src/modules/today/layout.ts` and `TodayModule.tsx` (Hide Amounts moved; scope sentence); 13 files that import Hide Amounts (import path only); `src/modules/assets/validate.ts`, `src/modules/bills/util.ts`, `src/modules/services/model.ts` (re-export the shared link check); `src/lib/money.ts`, `src/lib/backupFile.ts`, `src/modules/assets/maintenance.ts`, `src/modules/services/visits.ts` (delegate to `localISO`); `src/modules/household/Parts.tsx` and `index.tsx` (wording; search source).

**Changed tests (existing assertions updated to the approved new contract, listed in section 21):** `src/modules/bills/hooks.test.ts`, `src/modules/household/b5-guards.test.ts`, `src/modules/household/b5-ui.test.ts`, `src/modules/today/today.test.ts` (import path only).

**Docs:** this report, `docs/CHATGPT-HANDOFF.md`, `docs/BACKLOG.md`, `docs/module-hooks.md`, `README.md`. Historical reports were not edited.

## 5. Transaction dependency-reader design

- **Contract** (`src/core/txnDependents.ts`): a module contributes `txnReferences: { label, find({ ids, txns, d }) }` and returns `TxnDependent` rows: transaction id, module, record id, record title (never an amount), singular/plural noun for counting, plain-words relation, `scope` (`whole` or `part`) with the split positions, `standing` (`current`, `stale`, `historical`), `evidence` (does this record count the payment today), an optional note and a path to open the record.
- **Reader** `readTxnDependents(ids, txns, d, providers)` runs every reader. A reader that throws is reported under `unverified` and the others still run; the result is `verified` only when all ran. **No readers registered is also "not verified"**. The same (transaction, record) pair reported twice is merged.
- **Finance imports no household module.** Providers are found through `allTxnReferenceProviders()` in the registry. A guard test checks the Finance side imports nothing from bills, services, assets, projects, household or ledger.
- **By id only, never by payee or amount.** A test creates a transaction with the same payee, amount and date as a linked payment and shows it has no dependents.
- **Judging a reference** uses the same `resolveRef` as the spending readers, so `stale` means exactly "needs review" there (the transaction is gone, the part no longer matches, or it became a transfer).
- **Readers:**
  - *Bills:* a `payment-link` fact is a dependent of the billing period (`bill:<id>:<period>`); several facts for one period are one dependent. A replaced link is `historical`. A `suggestion-reject` fact is `historical` ("counts no money"). A fact this version cannot read is **not skipped**: if its stored `ref` names the transaction it is reported as `historical` and kept as saved. A note says a typed outside-Finance amount for the period stays set aside.
  - *Household Services:* a visit's `txnRefs` and an arrangement's `txnRefs`, each one record.
  - *Home & Assets:* an asset's `purchaseTxnRefs` and a service record's `txnRefs`, whole and part.
  - *Projects:* the project tag lives on the transaction (or a split part) itself, not in a shared reference, so the reader uses `projectAllocations` and rebuilds the part positions. A tag naming a project that no longer exists is `stale`.
  - *Finance (Ledger):* scheduled-payment log entries that name the transaction, as `historical` ("the schedule keeps remembering that date as posted"). Transfer partners are named by the plan itself.
- **Read-only:** a guard test rejects any table write, `.transaction(`, `console.`, storage or network call in the five readers; a test shows the whole database is byte-identical after planning.

## 6. Single-delete preview and confirmation behaviour

`TxnDeleteDialog` replaces the plain `confirm()` on the account page and on All Transactions. It shows:

- the sentence "This payment is used by 1 billing period, 1 home-maintenance record, 1 service arrangement and 1 project." (counts distinct records per module), or "Nothing else in Ledger points at this transaction.";
- what happens: "leaves those records in place; their payment references will say the payment was not found and need review; nothing else is deleted and no typed amount is put in its place";
- the spending effect: "4 records will stop counting this payment in recorded spending (and any Project paid figure) until you link a payment again" (only records whose link is currently in force are counted as evidence);
- links to each affected record, marked "one part of a split", "already needs review" or "history only", with any note;
- **Cancel** (first in tab order) and an explicit **Delete**.

It shows **no amount of any kind** (guarded by a test), so Hide Amounts has nothing to hide, and no account identifiers. States: loading, "could not check" with **Check again** (Delete stays disabled), "something changed" (new list, confirm again), and an error line. The dialog uses the existing `Modal` (Escape, focus trap, labelled dialog).

## 7. Bulk-delete atomicity

- The bulk selection is planned and applied the same way: every module's dependents are gathered, a record reached by several transactions is counted once, and split and transfer facts are stated ("4 selected, 1 split"; "the matching half of a transfer will be deleted too (5 in all)").
- `applyTxnDeletion` deletes everything in **one Dexie transaction** over `txns`, `moduleRecords`, `recurring` and `recurringLog`.
- **Failure injection:** a Dexie `deleting` hook throws on the 25th of 50 deletions. All 50 transactions remain and a full-database digest is identical before and after (test). Without the fault the same plan deletes all 50. The plain `bulkDelete` (kept for internal use) is now one transaction too and has the same 50-transaction test. The same injection was done in the real browser on a 5-transaction selection (section 19).
- **Transfers:** choosing one half names the other and deletes both (existing Finance behaviour, now stated in advance); choosing both halves counts 2, not 4. Deletion is not refused because a transfer pair is always deleted as a pair; no Finance invariant is left half-applied.
- **Internal operations are unchanged:** `deleteTxn` (used by account clean-up) is untouched; import rollback (`undoBatch`) does not use either function. `bulkDelete` keeps its signature and result.

## 8. Cross-module reference handling

Tested on real fake-indexeddb databases with the real readers: no dependents; one Bills link; one piece on two Bills periods (2 records); a Services arrangement and a visit; Home & Assets whole and part; a Project whole tag, a split-part tag and a deleted project; one payment in all four modules; two stored references to one record (one dependent); a reference already stale after a split change; a rejected suggestion and an unreadable Bills entry (history, not omitted); a scheduled-payment log entry. After an explicit delete the household total falls by exactly that payment, the readers list the linked records as "not in Finance", `reconciled` is false, and **the module records are byte-identical** (`moduleRecords` dump equal before and after).

## 9. Race and stale-preview safeguards

The plan carries a **fingerprint**: every stored field of every transaction to be deleted (except the sync time stamp, in a fixed key order), the list of chosen ids that were missing, whether all readers ran, and the sorted dependents. Inside the delete transaction the plan is rebuilt from live data; any difference throws `DeletionRefused('stale')`, a reader failure throws `DeletionRefused('unverified')`, and nothing is deleted. Tests: amount edited, memo or status edited, split restructured, a new link added by another module (ignored in the mutation run), a link removed, a different selection, a reader that works at preview time and fails at apply time, no readers, already deleted elsewhere, nothing left. A save that writes the same values again does not make the preview stale.

**Defect found by my own browser check:** my first fingerprint covered only some fields, so editing just the memo after the preview let Delete go through (the app deleted one of my invented transactions). I widened it to all fields, added the test above, and re-ran the browser check: the owner now sees "Something changed since you looked. Nothing was deleted" and the new list.

## 10. Shared Hide Amounts helper (ARCH-01)

`loadHideAmounts`, `saveHideAmounts` and `HIDE_AMOUNTS_KEY` moved to `src/core/hideAmounts.ts`. Same key (`today.hideAmounts.v1`, still in the backup's preference list), same default (not hidden), same safe reads, same Today switch. There is **no change notification today and none was added**: a screen reads it when it opens, as before. No compatibility re-export was needed: all 14 importers were updated and Today's own file no longer defines it (guard tests: nothing outside `modules/today` imports it from Today; Today's `layout.ts` no longer contains it). `today.test.ts` only changed its import path.

## 11. Shared safe-link validation (ARCH-02)

Inspected all copies: Home & Assets (`validate.ts`), Bills (`util.ts`) and Household Services (`model.ts`) were **identical** (`new URL`, `http:` or `https:` only). They now re-export `src/lib/safeUrl.ts`; the three exports are the very same function (tested). The frozen legacy copy in `src/modules/services/legacy/preS3-model.ts` (a migration snapshot, identical) was deliberately **left alone**. The check refuses `javascript:` (any case, spaces, embedded tab), `data:`, `file:`, `blob:`, `vbscript:`, `ftp:`, `mailto:`, `tel:`, `about:`, relative paths, bare words, empty and malformed text; it accepts `http`/`https` in any scheme case. As before, leading and trailing spaces are tolerated (the URL parser ignores them); nothing stored is rewritten. A test runs the Bills and Services validators and shows the same message for bad links and acceptance of good ones. 31 tests.

## 12. Local-date utility assessment (ARCH-03)

Found five helpers with identical intended behaviour (the calendar date on this device at an instant, not UTC): `core/time.localISO` (canonical), `lib/money.todayISO`, `lib/backupFile.localDay`, `modules/assets/maintenance.localDate` and `modules/services/visits.isoOfMs`. All now delegate to `localISO`. **Left separate, on purpose:** the `MM-DD-YY` file-name formatter in `SyncPage.tsx` (a different format), `OverviewPage`'s year label, and the date-arithmetic files already allowed by `dateGuard.test.ts`. The new test compares all five helpers with an independent `Intl` reference in nine zones (UTC-11 `Pacific/Pago_Pago`, UTC+14 `Pacific/Kiritimati`, Honolulu, New York across both daylight-saving changes, London, Kolkata, Auckland, Lord Howe) at 12 instants (year end, leap day 2028-02-29, end of day), and checks the shifted clock (`vi.setSystemTime`) still drives `todayISO` and `localDay`. No date moved.

## 13. Household reconciliation terminology (UX-02)

Only user-facing text changed: "Not fully reconciled." became **"Some spending relationships need review."** and "Nothing unresolved is affecting this figure." became **"Cross-module totals verified."** followed by "This compares Ledger's own records with each other; it is not a check against a bank statement." Finance's `reconciled` status, its labels in Bills and Household finances ("marked reconciled in Finance", "Recorded in Finance: reconciled") and every internal field name (`reconciled`, `reconciles`, `reconciliation`) are **unchanged**, so no B5 output changed. Tests assert both messages in both states, that the old phrase is gone and that the Finance wording is intact. The README line was updated.

## 14. Hide Amounts scope clarification (UX-01)

Decision followed: **masking was not widened.** Today's switch (the only place it lives) now carries the sentence "Hides amounts on Today, Calendar, Bills, Services, Home & Assets and Household finances. Ledger's own pages (Accounts, Transactions, Budget, Reports, Net worth) still show amounts. It is for glancing at a screen, not a privacy lock." It is the switch's screen-reader description always, and shown on screen while the switch is on. (A `title` tooltip was tried and removed: the accessibility tree used it as the switch's name instead of "Hide amounts".) Real-browser check with the switch on: Bills and Household finances showed no `$` figures; Ledger Accounts showed 5. **Screens where amounts stay visible:** Accounts, Transactions, Budget, Reports, Net worth and the rest of Ledger Home (except its "Coming up" list); exports and backups still contain amounts. Broader masking remains a separate owner decision.

## 15. Household finances Search registration (NV-01)

The existing Search architecture supports a page destination cleanly (Today does the same), so a `searchSource` was added to the household module: result "Household finances · Go to this page", path `/household`, no data read. Keywords deliberately exclude "bills", "services" and "subscriptions". Tests: found by "household finances", "household", "finances", "household spending", "combined spending"; empty and unrelated text find nothing; title and subtitle contain no digit or `$`; registered once; across all registered sources the result ids are unique and exactly one result has path `/household`; a search for "bills" does not return it; the module still contributes only `searchSource` and `todayCards` (no Quick Add prefix). Real browser: a mouse click and the Enter key each opened `#/household`, with Hide Amounts on and no figures in the result.

## 16. Financial integrity evidence

- The 90 golden-master tests (`b5-golden-master`, `b5-union`, `b3-spend`, Household Services `householdSpend`) pass unchanged; the full suite passes.
- No file under the spending readers changed: `src/modules/assets/spending.ts`, `bills/billsSpend.ts`, `services/householdSpend.ts`, `household/unionSpend.ts` have no diff.
- **B3 precedence:** a test puts a typed $70 beside a linked $62 payment for one period (the form refuses this; it can arrive by sync), deletes the payment, and the household total falls by $62.00 and does **not** rise by $70.
- **B5 whole/part deduplication** is untouched; the dependents reader counts records, not money.
- After an explicit deletion the existing "not in Finance" reviews appear and the figure is flagged.

## 17. Sync and backup results

Real `SyncEngine`, two devices, real encryption:

- Device A deletes a payment while device B links the same payment to another billing period; after sync both devices have the transaction gone, **both Bills periods listed as "not in Finance"** (visible, not silently repaired), the same figure, `reconciled` false, and identical overview output.
- Both devices delete the same payment: still converges and the pointing records stay.
- A backup taken after the deletion restores to the same total and the same review list; an unknown field on a record survives; the figure after restore equals the live one.
- Not changed: the sync merge, the encrypted file format, the schema, ST-S1's conflict history (its 56 tests pass).
- **Not tested:** older-build behaviour (no older build was available to run) and two physical devices.

## 18. Mutation results

Manual mutation run (one deliberate bug at a time, the relevant tests run, file restored; all files verified restored):

| Mutation | Result |
|---|---|
| Dependency warnings suppressed (plan returns no dependents) | caught |
| Unrecognized link type omitted (unreadable Bills entry skipped) | caught |
| Bulk delete made non-atomic (deletes outside one transaction) | caught |
| New link added after preview ignored (fingerprint drops the dependents) | caught |
| Reader failure at apply time ignored | caught |
| Stale fingerprint never compared | caught |
| Unsafe URL admitted (`data:` allowed) | caught |
| Local-date boundary shifted (UTC day) | caught |
| Finance `reconciled` relabeled | caught |
| Hide Amounts imported from Today again | caught |
| Typed payment reactivated beside a Finance link: only the Bills reader changed | **missed, and correctly so**: `spend()` independently enforces "references win", so this is an equivalent mutant |
| The same, in both Bills and `sourceOf` | caught |

## 19. Browser acceptance

A separate disposable origin `http://st-s2-check.localhost:5173` with an empty database and invented data only (the repository's own test seed, plus a project, a transfer and a split). No existing database was touched. The `127.0.0.1` address was refused by the browser pane, hence the `.localhost` name. The data stays in that origin's storage inside the pane; it is invented and can be cleared at will. The dev server was stopped.

| Check | Method |
|---|---|
| A. Delete a payment linked from Bills, Services, Home & Assets and a Project: preview lists all four with links | real clicks, DOM and screenshot |
| A. Cancel: 14 transactions, 16 records and the payment unchanged | real click, database check |
| A. Delete: 1 transaction gone, 16 records unchanged, household readers show 3 "not in Finance" items, total down by exactly that payment | real click, database and overview check |
| B. Select a split, a transfer half and two furnace payments: "4 selected, 1 split ... used by 2 home-maintenance records ... (5 in all)" | real clicks, screenshot |
| B. Injected failure on the 3rd of 5 deletions: error shown, dialog stays open, 13 transactions and 16 records unchanged | real click, Dexie hook injected |
| B. Fault removed, confirm: 5 gone, 16 records unchanged, selection cleared | real click, database check |
| B. **Cancel on the bulk dialog** | **not separately clicked** (same Cancel code as single delete, which was) |
| Reader failure: "Could not finish checking", Check again offered, Delete disabled; recovers after the reader works | real clicks (a reader was made to throw from the page) |
| Stale preview: memo edited after the preview, Delete pressed: nothing deleted, warning and new list | real click (this found the defect in section 9; re-run after the fix) |
| C. Hide Amounts across modules (Bills, Household finances masked; Accounts not); safe-link function results; Today and Calendar show 2026-11-08 and the check agrees with the browser's own date in America/New_York | real navigation, DOM inspection |
| D. Search "household fin": result, no figures, click and Enter both open `#/household` | real clicks and keys |
| 375px (emulated mobile) and dark theme: dialog 351px wide inside a 375px viewport, no horizontal page or dialog overflow, dark colours readable | emulated viewport, screenshot, DOM measurement |
| Keyboard: Enter in Search; dialog is a labelled `role="dialog"`, Escape closes it | real keys |

**Not done:** a real phone, a screen reader, two physical devices. One of my own test steps (pressing Ctrl+K then clicking the Search button) briefly looked like an Enter-key failure; it was my sequence (the palette's first action "Add a task" ran, creating nothing), not a defect. The pane's screenshots sometimes capture the moment before a dialog paints; DOM checks were used to confirm.

## 20. Privacy and accessibility observations

- The dialog and all reader messages carry no amount, account number, credential or note text (tests). Search shows no figures. The readers and the Finance side contain no `console.`, storage, network, token, passphrase or credential access (guard test). I made no network request from the app; my only network use was reading the public GitHub Actions status with `curl`.
- Accessibility: labelled dialog, focus handled by the existing Modal, status and alert roles on loading and error text, Cancel before Delete, a screen-reader description for the Hide Amounts switch. Not evaluated with a screen reader. The pre-existing AX-01 to AX-04 findings are ST-S3 and were not worked on.
- Observed, not changed: the Transactions page shows a horizontal page scrollbar at the 800px pane width behind the dialog (pre-existing layout, not caused by this work; the 375px measurement showed no overflow).

## 21. Deviations from the S0 roadmap and changes to existing tests

- **UX-04 (Undo for deletes) was not built**: the S0 audit says "with DI-02" for wording; this phase added the preview and confirmation wording but no Undo (a separate feature decision).
- The prompt's example sentence was met in spirit; the actual counting nouns come from each module ("billing period", "service visit", "home-maintenance record", "project").
- **Three existing guard tests asserted the previous phase's closed contract and were updated to the approved new one** (not weakened, not deleted): `bills/hooks.test.ts` (the Bills module now also contributes `txnReferences`), `household/b5-guards.test.ts` twice (the household module now has a page-only `searchSource`; its source file may import `lib/search`). `b5-ui.test.ts` assertions were reworded to the new notice text and `today.test.ts` changed an import path.
- Unlike the prompt's wording "inspect all selected transactions ... refuse the entire operation if a required validation fails", **a transfer is not refused**; its other half is deleted and named in advance, which is Finance's existing behaviour.

## 22. Known limitations and deferred decisions

- Two devices can still create the stale state across sync (a deletion on one, a new link on the other). It is visible, by design, and not prevented.
- A reader added later that reads a table outside `txns`, `moduleRecords`, `recurring`, `recurringLog` makes the delete refuse (safe) until the transaction scope is widened.
- No Undo for deletes; no repair tool for stale references; no widened Hide Amounts masking; no bulk-cancel real click; no older-build, real-device or screen-reader testing.
- Unreadable facts are only detected where the module stores a `ref` field in the shared shape (Bills facts); an unknown future reference field elsewhere cannot be seen.
- The pre-existing audit items outside this phase (AX, PF-01 script size, SE-01 hosting) are untouched. **The separate hosting-isolation decision remains pending; no hosting, DNS or GitHub change was made.**

## 23. Exact final Git status (not staged, not committed)

`HEAD` = `origin/main` = `5e1f1829a5fc607afca2bdc811cccec7893a7fea`; 0 commits ahead. **41 modified tracked files** (37 source and test files, plus `README.md`, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`, `docs/module-hooks.md`) and **19 new untracked files** (12 source files, 6 test files, this report). **Nothing staged** (0 files in the index). No commits ahead of `origin/main`. `git diff --check` reports no whitespace problems (git only prints its usual line-ending notices on this Windows checkout). No `gh`, hosting, DNS or GitHub setting was changed; the only network use was a read of public Actions status.

**Handoff updated:** yes, `docs/CHATGPT-HANDOFF.md` (snapshot, phase status, decisions, risks, change log). **Backlog updated:** yes. **module-hooks.md:** yes (new `txnReferences` hook). **README:** yes (delete preview, Search, household wording).
