# Ledger Phase 0: post-implementation verification report

Date: 2026-11-05. Written against `docs/PHASE0-PLAN-2026-11-05.md`. Contains no personal or financial data; every figure comes from invented test data.

The review itself changed no code. One small fix followed it (the "refund larger than payments" gap, section 4); it is in the commit that adds this file.

## 1. Headline results

| Check | Result |
|---|---|
| Tests | At the time of the review, on pushed commit `a367bec`: 81 files, **1,108 tests, all pass**. Before Phase 0: 72 files, 1,050 tests. The 58 new tests are in 9 new files. No existing test file was edited. After the follow-up fix: **1,111 tests, all pass.** |
| TypeScript | `tsc --noEmit` exits 0, no output (both times). |
| Production build | Succeeds (both times). JS bundle about 1,278 KB, 374 KB compressed. The size warning pre-dates Phase 0. |
| Verified commit | `a367bec0b94806946c70f17aec7d6ff6b7e80cdb` (Phase 0). `main` equalled `origin/main`, working folder clean. |
| Follow-up | The refund-amount fix and this report are in the next commit on `main` (see `git log`). |
| Deployment | **Succeeded, indirectly confirmed.** The `gh` tool is not installed, so the Actions run itself was not read. The live site returned HTTP 200, serves the same JS file name as a local build of that commit (`index-IWQlWrRZ.js`), and includes the new security-policy tag. The workflow runs the tests before deploying. Whether the follow-up commit has been pushed is stated in the hand-off, not here. |
| Database schema | **Unchanged.** No diff in `src/db.ts`, `src/lib/backup.ts`, `src/lib/backupFile.ts`. Schema version still 15. |
| Backup and sync file format | **No format change.** The only data change is an optional `project` object on transactions and on splits, added to existing records; it is backed up and synced automatically (tested). New sync figures (file size, upload log, last file version) live in the device-only sync database, never in backups or the synced file. |

## 2. Work packages

Labels are the plan's. B7 and the owner actions (A0) are listed separately at the end.

### A1. Backup completeness test: complete
- **Files:** new `src/lib/backupCoverage.test.ts`. No application code changed.
- **Changed:** nothing in the app; a guard was added. It fails if any database table is missing from the export, the file checker, a restore, or the sync snapshot, and restores an old version-1 file.
- **Tests:** 5 added.
- **Deviation:** the optional step of building the backup lists from the database automatically was not done.
- **Risks:** it proves table coverage, not that every field inside a table survives.

### A2. Unknown fields kept on tasks and events: complete
- **Files:** `src/modules/tasks/model.ts`, `src/modules/calendar/model.ts`; new `src/modules/tasks/unknownFields.test.ts`.
- **Changed:** `asTask` and `asEvent` carry through fields they do not recognise, so edit, bulk change, complete, reopen, repeat-spawn and event save keep them. Clearing a known field still clears it.
- **Tests:** 5 added.
- **Deviation:** the plan allowed carrying fields in the readers or merging at save; the readers were chosen.
- **Risks:** Calendar layers and task lists are not covered. Only the event-retire save path was tested; other event saves use the same pattern. A device still running the old app version keeps stripping fields until it updates.

### A3. Finance project layer: complete (one gap found in review, then fixed)
- **Files:** new `src/lib/txnProject.ts`, `src/lib/txnProject.test.ts`; edits to `src/types.ts`, `src/lib/transfers.ts`, `src/lib/txnBulk.ts`.
- **Changed:** transactions and splits can be tagged to a project, optionally a budget line and a contract; bulk tagging; transfers and "Initial setup" entries are refused; the tag is cleared when a transaction becomes a transfer or is paired; project totals follow the plan's rules. No screens.
- **Tests:** about 27 in `txnProject.test.ts`, plus refund-mark and amount cases in `txnCreate.test.ts`.
- **Deviation:** goes beyond the original plan. The owner amended the refund rule after the plan (reversal versus credit, section 4). Added refusals, extra flags and a "needs choice / exceeds payments" count in bulk results.
- **Risks:** see section 4. Projects screens must supply the prompts the model relies on.

### B1. Date fixes and guard: complete
- **Files:** `src/modules/calendar/model.ts`, `src/modules/calendar/searchSource.ts`, `src/pages/BackupPage.tsx`; new `src/modules/calendar/dateZones.test.ts`, `src/lib/dateGuard.test.ts`.
- **Changed:** the event default date, the Calendar search fallback and the encrypted export filename now use the local day.
- **Tests:** 7 added, run in Los Angeles, Auckland and UTC; the guard fails if a new UTC-day slice appears outside five allowed files.
- **Risks:** the filename change is covered only by the guard, not run in a browser.

### B2. Shared code moved: complete, with deferrals
- **Files:** `time.ts` and `recurrence.ts` moved to `src/core/`; new `src/core/priority.ts`; `pickers.tsx`, `RepeatFields.tsx` moved to `src/ui/`; new `src/ui/PriorityMark.tsx`. One-line re-exports remain at the old Calendar paths. Imports updated in Tasks, Today and Ledger.
- **Changed:** nothing visible. Checked in a browser: Tasks, Calendar, Today at desktop and 375 px, no errors, no sideways scroll.
- **Tests:** none added; existing tests pass through the old paths.
- **Deviations:** the Calendar tests stayed where they were (the plan said they move). CSS not moved: Tasks and Today still use `calendar.css`. Today still reads the Calendar's data hook and the Calendar's quick-add still uses Tasks' parser (the plan expected both).
- **Risks:** the re-export files should be removed later.

### B3. Linkable Tasks and Calendar records: complete
- **Files:** new `src/modules/tasks/records.ts`, `src/modules/calendar/records.ts`, `src/modules/records.test.ts`; both modules' `index.tsx`.
- **Changed:** the "Link a record" picker offers Ledger, Calendar and Tasks; a deleted target shows "(no longer exists)".
- **Tests:** 3 added; also checked in a browser.
- **Risks:** Projects must register its own records.

### B4. Sync visibility and skipping a pointless download: complete
- **Files:** `src/lib/sync/engine.ts`, `github.ts`, `auto.ts`, `src/pages/SyncPage.tsx`; new `src/lib/sync/skip.test.ts`.
- **Changed:** the Sync page shows file size, record count and uploads (today and last 30 days). Automatic runs skip the download when GitHub's file is the version this device last saw and nothing changed here; "Sync now" always does a full run.
- **Tests:** 8 added, using an in-memory remote.
- **Risks:** **not tested against real GitHub or two real devices.** No direct unit test of the new `headSha` call (the refactored listing is covered by existing GitHub client tests). Manual check after deploy: press Sync now, look for the new line, confirm an automatic sync still updates "last synced".

### B5. Security policy: complete
- **Files:** new `src/shell/csp.ts`, `src/shell/csp.test.ts`; `vite.config.ts`.
- **Changed:** the production build only connects to this site, GitHub and the price service; the two inline theme scripts are allowed by hash; the dev server is untouched. Present on the live site.
- **Tests:** 2 added, including a check that every outside host the app fetches from is on the allowed list.
- **Risks:** **the offline service worker under the policy is unverified** (the preview browser cannot register one even without the policy). Real sync and price lookups under the policy are unverified, though their hosts are listed. Styles still allow inline use.

### B6. One create path for transactions: complete
- **Files:** new `src/lib/txnCreate.ts`, `src/lib/txnCreate.test.ts`; `src/pages/TxnForm.tsx`, `src/shell/QuickTxn.tsx`.
- **Changed:** the Add form and the quick-add box use `createTxn`. A transaction added through the quick-add box changed the balance correctly in a browser.
- **Tests:** 6 added (after the follow-up).
- **Risks:** the "More options" form and the edit form were not opened after the change (type-checked and unit-tested only).

### B7. Passphrase hint: not started
In the plan, not among the nine items approved.

### A0. Owner actions: not done (not code)
GitHub two-step sign-in or passkey; confirm the sync token is single-repository, Contents only, with an expiry; check whether any other GitHub Pages site shares the app's address.

## 3. Finance, Calendar and Tasks preserved?
All 1,050 tests that existed before Phase 0 still pass and none was edited. One of them caught a problem in an early version of a bulk-category change; the application code was fixed, not the test. Checked in a real browser (invented data, since removed): Tasks, Calendar, Today, the task editor, the link picker and the quick-add box, at desktop and 375 px. **Not verified:** real two-device sync, phone speed, the "More options" and edit transaction forms, the offline service worker.

## 4. Projects financial layer: refunds and partial reversals

### Rules as built (amended 2026-11-05)
Money coming back (a positive amount) tagged to a contract must be marked **Reversal** (undoes a payment: Paid falls, the contract is owed again, Agreed unchanged) or **Credit** (cash back for a price reduction: Paid falls, and Agreed must fall by the same through a negative change order, otherwise the contract looks owed again and is flagged). Unmarked is refused. Money in with no contract (insurance, rebate) needs no mark and only lowers Paid.

### Probe results (real calculation, $10,000 contract, $3,000 paid)
| Case | Paid | Outstanding | Verdict |
|---|---|---|---|
| Baseline | 3,000 | 7,000 | Correct |
| Partial reversal of $1,000 | 2,000 | **8,000** | **Correct** |
| Two $3,000 payments, one reversed | 3,000 | 7,000 | Correct |
| Full reversal | 0 | **10,000** | Correct (the owner's example) |
| Reversal, then paid again | 3,000 | 7,000 | Correct |
| Reversal on a contract with a $2,000 change order ($5,000 paid, $2,000 reversed) | 3,000 | 9,000 | Correct |
| $1,000 credit, no change order | 2,000 | 8,000, flagged | Correct (flags a credit with no matching reduction) |
| $1,000 credit with a -$1,000 change order | 2,000 | 7,000 (Agreed 9,000) | Correct |
| Reversal of $5,000 against $3,000 paid | **-2,000** | 10,000 | **Gap found; fixed (below)** |
| $1,000 refund tagged to the project only | 2,000 | **7,000** | Works as designed; see limitation |
| Old unmarked refund | 2,000 | 7,000, flagged | Flagged |

### Gap found in review, and the fix
A reversal larger than the payments left the contract's outstanding correctly clamped, but project-wide Paid went negative (-$2,000) and Expected total fell below Agreed, with no flag.
Fix (in the commit that adds this file): money coming back on a contract is refused if it is more than what was paid on it (messages like "That is more than the $3,000.00 paid on this contract so far"), when tagging, bulk tagging (counted as `exceedsPayments`, left alone) and creating a transaction on a project. The summary also reports `reversalsExceedPayments` and `paidByCommitment` (never below zero) for old or synced-in data. A partial reversal of a partial payment is a test. Two tests written earlier that tagged a refund before anything was paid were changed accordingly.

### Limitation that remains (a screen job)
A refund tagged to the project only (no contract) is "other money in" by the rules, so the contract's outstanding stays understated if the owner meant it to undo a contract payment. The model cannot know intent: the Projects screen must ask "is this refund about a contract?" whenever money coming back is tagged to a project.

## 5. Ready for Projects?
**Yes.** The data foundation, backup coverage, field preservation and money rules are in place and verified by tests and, for deployment, by the live site matching the pushed build.

## 6. Unresolved items before or during Projects
1. **Screens must carry the refund rules:** the "must choose Reversal or Credit" prompt, the pre-filled negative change order for credits, and the "is this refund about a contract?" question for project-only tags.
2. **Manual checks on the live site (not code blockers):** open the app offline; press Sync now and look for the new size line; let one automatic sync run. Plus anything on the new transaction create path in the "More options" and edit forms.
3. **Owner actions (A0):** GitHub two-step sign-in, token check, other-Pages-sites check.

Not blockers, still open: B7 (passphrase hint), building the backup lists automatically, compressing the weekly backup, removing the re-export files.
