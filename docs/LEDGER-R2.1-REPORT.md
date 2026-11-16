# Ledger R2.1: Money Intake, Import v2 (report)

Status (2026-11-16): **APPROVED BY CHATGPT (one wording correction, applied) AND RELEASED as `feat(finance): remember import mappings and support pasted transactions` (SHA and Actions result in the handoff change log). NOT REAL-DEVICE TESTED.**

Gate verified first: `main` = `origin/main` = `16d6659` (R1.3, `feat(tasks): connect task completion to household logging`), and GitHub Pages run **#120** is `completed` / `success` (public Actions API; `gh` is not installed). R1.3 is committed and deployed, so nothing of it is mixed in. The three protected untracked files (`docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`) were not touched.

## A. Executive summary

Importing is now quicker the second time. The first time you import into an account you pick the columns as before. After you confirm that import, Ledger remembers the layout **for that account**. The next time you bring in a file (or pasted rows) for the same account, Ledger recognizes the columns, shows "Using your saved layout", and goes straight to the preview of rows. A "Change mapping" button is always there. If the file does not fit the remembered layout (a column is missing, renamed or repeated) Ledger says why and asks you to choose the columns, rather than guessing.

You can also choose **Paste transactions** instead of uploading a file: paste rows (with the header line) into a box and press "Read pasted rows". Pasted rows go through exactly the same reading, preview, duplicate check, confirmation and undo as an uploaded file.

Nothing about money logic changed: amounts, signs, duplicate detection, preview, confirmation and the per-import Undo are the existing code.

## B. User workflow

1. **First import into an account.** Choose the account, choose "Upload CSV file" or "Paste transactions", supply the rows. The page shows the usual column choices plus a line: "After you import, Ledger remembers these columns for <account>. Nothing is remembered until then." Review the preview, press Import.
2. **Repeat import.** The page shows "Using your saved layout for <account>" with a short list of which column is which, then the preview. Reordered columns are fine (matching is by column title, ignoring capitals and extra spaces).
3. **Paste.** "Paste transactions" shows a text box. Include the header line. Copying cells from a spreadsheet (tab separated) also works. Empty input, a header with no rows, or text that is not columns gets a plain explanation. The pasted text lives only on this screen; it is cleared after an import and never saved.
4. **Changing the layout.** Press "Change mapping", adjust, and import. The new choices replace the old layout after you confirm. If the file does not fit the saved layout, the manual choices appear with a note saying what is missing; importing then replaces the old layout.
5. **Switching input method** clears the loaded rows (the account stays chosen) so the two methods cannot be mixed up.

The page title is now "Import transactions" (was "Import CSV"). The three-step bar's wording is unchanged.

## C. Data preservation

- **Where:** one row per account in the existing `settings` table, key `import-layout:<account id>`. The key uses the account's id, never its name, so renaming an account is safe. No new table, no migration, no new dependency, no network.
- **What:** only column titles for each role (date, description, amount or debit/credit, optional bank id), the date order, and the flip-signs choice, plus a version number. No transaction rows, no file contents, no file name or path, no credentials. (A test checks the stored value holds no row text.)
- **When written:** only inside the Import button's handler, **after** the import itself succeeded. Selecting a file, pasting, applying a saved layout, changing the mapping and canceling write nothing. If saving the layout were to fail, the import still stands and the message simply omits "remembered".
- **Sync and backup:** `settings` rows are already tracked by sync and included in backups, so the layout travels with both with no format change. A test exports a backup, restores it into a fresh database and reads the layout back.
- **Deleting an account** also deletes its remembered layout (inside the same transaction).
- **Stored value is read defensively:** a malformed or unknown-version value counts as "nothing saved".

## D. Financial correctness

- **One pipeline.** Both input methods call the same `parseTransactionText` (which calls the existing `parseCsv`), then the existing `normalizeRows`, `classifyRows` and `commitImport`. No second parser. Upload and paste of the same text give identical rows and identical duplicate results (tested).
- **Duplicates.** `classifyRows` and fingerprints are untouched; a saved layout only changes which columns are read, so it cannot weaken duplicate detection. Browser check: a reordered second file with one overlapping row showed "Already imported" for it and "New" for the other; a pasted row imported earlier by upload showed "Already imported".
- **Signs.** The sign logic is unchanged. A saved layout restores the exact debit/credit columns and the flip-signs choice that you confirmed; a layout that does not fit is never applied. Tests: money out negative and money in positive for separate debit and credit columns; a saved flip-signs choice applies to its own account only.
- **Preview and confirmation.** Rows are only classified for preview; commit happens only on the Import button.
- **Undo.** The existing per-import undo is used as is (a pasted import is an ordinary import batch named "Pasted transactions, <date>"). Browser check: undo removed exactly the pasted import's transaction and left the earlier import alone. Note: undoing an import does **not** restore the layout that import replaced (see judgment call 4).

## E. UX evidence

Screenshots (outside the repository, invented data): `Documents\Ledger-Design-Concepts\R2.1-Evidence`

1. `1-first-import-mapping-desktop.jpg`: first import, manual columns and preview (money out negative).
2. `2-saved-layout-and-preview-desktop.jpg`: "Using your saved layout" and "Change mapping", reordered file, duplicate and new row.
3. `3-paste-and-layout-mismatch-desktop.jpg`: pasted rows, and the plain reason when the saved layout does not fit.
4. `4-paste-mobile-375.jpg`: paste on a 375 px phone width.
5. `5-saved-layout-preview-mobile-375.jpg`: saved layout and stacked preview at 375 px (no sideways scrolling; page width measured equal to window width).

## F. Verification

- New tests: `src/lib/csvImportR21.test.ts`, 15 tests: previewing writes nothing; confirm saves and a compatible second import applies it; per-account (a second account gets nothing); reordered columns and capital/spacing differences; missing and repeated columns fall back with a reason; replacement and malformed stored values; saved flip-signs applies only to its account; account deletion removes its layout; upload and paste identical and duplicates identical; tab-separated and quoted-comma input; debit/credit signs; empty/header-only/not-columns messages; undo of a pasted import; backup and restore round trip.
- One existing guard test ("no test looks for a short forbidden number without scanText") caught a regex in my new test; fixed with the repository's `// ids-ok` marker. No existing test was edited.
- Full suite, `tsc` and build: see the results line in the handoff entry (filled in at the end of this batch): **298 files, 5,881 tests pass** (baseline 297 / 5,866), `tsc` clean, build clean.
- Browser walkthrough (Chromium pane, empty database with two invented accounts, `npm run dev`): first upload and manual mapping; confirm shows "Your column layout is remembered for Demo Checking" and exactly one `import-layout:<id>` settings row appears (and none before confirming); second upload (reordered columns) used the saved layout; paste with an incompatible layout showed the reason and manual choices; paste import replaced the layout; Undo removed it; empty/header-only paste messages; 375 px layout. No console errors observed in the steps used.
- **Not checked:** real phone, screen reader, Safari/Firefox, an actual bank file, a real spreadsheet copy and paste (tab-separated was tested in code only), the sync merge of a layout edited on two devices at once (last edit wins, as for every settings row).

## G. Judgment calls (please review)

1. **Stored in the `settings` table, not in `PREFERENCE_KEYS`.** `PREFERENCE_KEYS` lists device-only browser storage (`localStorage`). The R0 plan said "a `settings` entry that rides sync and backup"; the settings table already does both, so no key was added to `PREFERENCE_KEYS` (adding it there would also have been wrong, because the layout is per account and is not a screen preference). Please confirm.
2. **One settings row per account** (`import-layout:<id>`) rather than one row holding all accounts, so two devices editing different accounts do not overwrite each other.
3. **Matching is by column title** (case and spacing ignored); every column the layout names must be present exactly once. An extra new column in the file does not block it. A file whose titles changed always asks you.
4. **Undo does not restore a replaced layout.** A layout is replaced when you confirm an import with different columns; undoing that import removes its rows but keeps the newer layout (the old one would have been in the way of nothing, and the newer layout is what the bank is currently sending). Simple and harmless; flag if you want it reversed.
5. **Layout saved on every confirmed import** (including when unchanged); this refreshes its sync time stamp only.
6. **Paste needs a button ("Read pasted rows")** instead of reading on every keystroke, so a half-pasted table is never previewed.
7. **Account required before supplying rows** (as the file chooser already was), because the saved layout belongs to the account.
8. **The stepper wording** now reads "Choose account and transactions" (corrected after review; only the step titles changed, tests check step ids and needed no edit).
9. **Pasted imports are named "Pasted transactions, <date>"** in Past imports and the Undo dialog.
10. **Accounts of kind "credit card"** keep the previous behavior (the old code had a branch that changed nothing; it was removed, not altered).

## H. Release recommendation

Ready for owner and ChatGPT review. Nothing is committed, pushed or deployed. Suggested owner check on a real device: one real bank CSV into one account twice, and one paste from a spreadsheet. **Next proposed phase: R2.2, Import-time Payment-Link Suggestions** (not started; needs its own approval). OFX/QFX, bank connections, rules v2, receipt scanning and R2.2 were deliberately not built.

## I. Final approval

ChatGPT approved R2.1 after reviewing this report and the five screenshots, with one correction: the progress step "Choose account and file" became "Choose account and transactions". Accepted decisions: per-account layouts; stored in `settings` (not `PREFERENCE_KEYS`); synced and backed up through it; a saved layout is kept when its import is undone; saved only after a confirmed import; one pipeline for upload and paste; duplicates, signs, preview, confirmation and Undo unchanged. Verification after the correction: page and R2.1 tests (243) pass, `tsc` clean; the full suite (5,881 tests, 298 files) was not repeated for a text change. Next phase: **R2.2 Import-time Payment-Link Suggestions** (not started).
