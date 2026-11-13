# Ledger Signature D20.1B: the remaining 33 native confirmations (implementation report)

Date: 2026-11-13. State: **BUILT AND TESTED LOCALLY; REVIEWED AND APPROVED FOR RELEASE by the owner and ChatGPT (release commit `feat(ui): complete native confirmation migration`; its SHA and CI result are recorded in the release summary and the next handoff change).** CF-03 is recorded as built, pending owner acceptance (not accepted). D21 is not started.

## 1. Release prerequisite (verified before any edit)

- Repository `marshmond/ledger`, branch `main`. After `git fetch`: `HEAD` = `origin/main` = **`e24407bd9c45d8c8743f7fdd320fff7df49e1b2c`** (`feat(ui): migrate first native confirmations`, the D20.1A commit).
- GitHub Actions run **#112** ("Deploy to GitHub Pages", head SHA `e24407bd...`): `success`. The `github-pages` deployment for the same SHA: final status `success` (public GitHub API; `gh` is not installed on this machine).
- Read first: handoff, backlog, the D20.1A report and the OD-6 inventory. Working tree at the start: only the three protected untracked files. The handoff already carried an uncommitted status-line update made after the D20.1A commit (not by this work); this phase built on it.
- No branch, repository, remote, dependency or permission was added.

## 2. Result

- **Migrated in this phase: 33 of 33.** 38 original, 5 converted in D20.1A, 33 converted here.
- **Remaining actual browser-native `confirm()` calls: 0.** Recounted in the source with the broad rule (any `confirm(` that is not a member call and not a local `function confirm`): zero. The historical tracker rule (a quote right after the bracket) also reads 0; its D4 baseline stays 37 in 24 files, unchanged.
- Not counted and not touched: five local functions named `confirm` (ordinary handlers behind Ledger's own buttons) and the native `alert()` calls (`CategoriesPage.tsx` "Delete or move this group's categories first", `bills/quickAddDef.ts`, `services/quickAddDef.ts`), which are outside OD-6.
- **No exceptions.** Every native call was converted; none needed a substantial change to financial persistence.

## 3. How each one works (the D20.1A pattern, nothing new)

Each screen keeps a small piece of state that only says WHICH record the person pressed the button on (an id, or a yes/no flag on a card that already belongs to one record). The shared `ConfirmDialog` then asks; Cancel, Escape and the close icon only forget the choice. Only the dialog's own button runs the existing operation, on the remembered id, then closes. Failures and refusals appear inside the dialog and nothing is reported as done. Pressing twice runs once (`confirmRun.ts`). No new framework, queue, event bus or dependency. `kind` is used where the dialog's own text already says so ("linked", "irreversible", "replace"); `tone="primary"` is used for continue-type questions (add another point in a month, move a reconciled transaction, split to single, move tasks, fill evenly, replace colors, replace the income setup). All 33 table rows (source, treatment, behavior change, evidence, remaining risk) are in `docs/LEDGER-SIGNATURE-D20.1-OD6-INVENTORY.md` section 4b.

Two shared changes and two small helpers:

1. `src/shell/modalKeys.ts`: **Escape now acts only on the topmost dialog.** Needed because the Tasks "Lists" dialog (and any edit form shown in a dialog) can now have a question over it; before, Escape reached both and would have closed the Lists dialog as well. With one dialog open nothing changes. The old "known limit" test was updated to the new rule.
2. `src/lib/confirmedDeletes.ts` (new): the **category count and delete (NC-10) and the HSA withdrawal delete (NC-14) were MOVED here unchanged** so a test can drive them. The HSA delete now reads the withdrawal inside its transaction (see judgment call 2).

## 4. The seven complex cases

- **NC-06 bulk project move.** Plan (read only) then, only if a project would be replaced, the dialog, then the plan is worked out **again** at confirmation; if it differs (a task deleted, a task moved on another device) nothing is written and the dialog shows the new numbers; otherwise the one existing all-or-nothing assignment runs with its Undo. A milestone moved to another project stays a milestone (existing). Checked in a browser including the changed-underneath case.
- **NC-08 replace custom colors.** The "Start over from" select used to change its label before asking. It now stays on the old value until the dialog's Replace colors button is pressed, so cancelling leaves both the colors and the label as they were. Default theme untouched.
- **NC-27 HSA/ESPP checkbox.** The checkbox is controlled by the saved choice, so until the dialog's button is pressed it stays as it was. Confirm changes the draft with a functional update that removes only that benefit's own deduction (and the employer HSA amount for HSA); other deductions are untouched; nothing is saved by the dialog (the editor's own Save, or its live mode, does that as before).
- **NC-29 fill evenly.** Asked only when vests are entered (the original rule); confirm runs `fillEvenly` once; vests already in holdings are kept; no duplicate vests (tested).
- **NC-30 save grant that drops vests.** Validate, build the dropped list (vests in holdings are not part of it), ask; at confirmation the grant and its vests are read again and, if the dropped list changed, nothing is saved and the dialog says so. Then the one existing `saveGrant` runs once. The page's "busy" flag is now released in a `finally`. Checked in a browser, including a vest added while the question was open.
- **NC-37 move a reconciled transaction (highest risk).** All validation runs first; then the question, **before any write** (a source-order test checks that no write call comes before it); Cancel leaves the form open and the transaction untouched. On approval the transaction and the target account are read again (refuses if either changed), then the one existing save runs once; a failed save stays in the dialog. The form's Save button now calls `save()` with no argument: passing the click event would have counted as "confirmed" (the type checker caught this; a test pins it). The reconciliation rule itself (`moveTxn`: goes back to Cleared) is unchanged.
- **NC-38 split to single category.** Asked only when splits carry project tags; only the dialog turns the split off; nothing is saved by it.

## 5. Financial persistence: no exceptions, nothing rewritten

NC-18 (holding then its lots), NC-19 (the account's holdings, then the account) and NC-22 (property values, then the property) still run as **separate awaits without one transaction**, exactly as before; only the confirmation changed. Two existing quirks are recorded, not fixed: a failure between the two writes can leave a holding without lots, and NC-19 does not delete the account's tax lots. Proposed follow-ups (each needs its own decision): wrap those three in one transaction; delete the account's lots in NC-19.

## 6. Tests and build

- **New:** `src/shell/d201bConfirmations.test.tsx` (inventory against source; all 33 call sites by id; the "only remembers an id" and "write only in onConfirm" checks; stacked-dialog Escape; disposable-database checks for NC-01, 02, 03, 05, 06, 10, 14, 29, 30, 31, 35, 37; the NC-27, 37, 38 and 08 form sequences; documents).
- **Updated, not weakened:** `d201aConfirmations.test.tsx` (the inventory and count assertions now expect zero native calls and all rows migrated), `modalKeys.test.ts` (Escape on the top dialog only), `uiCoverage.test.ts` (CF-03 is now a `BLT` row).
- Results: the new file **86 tests, all pass**. The related set (everything under `src/shell` and `src/pages`, the Tasks, Projects, Household and Contacts modules, and the transaction-deletion, preference-backup, family-work and bills-commitment tests): **74 files, 1,560 tests, all pass**. Three older source-guard tests (`d16Money`, `d181PersonIncome`, and the coverage tracker list) asserted the exact text of the call sites that moved; they now assert the same intent against the new code (for example the engine call is still `undoBatch` / `bulkSetCategory`, now run from the dialog). Nothing was deleted or loosened.
- `npx tsc --noEmit`: clean. `npm run build`: succeeds (the existing chunk-size warning only).
- **The full suite was NOT run locally**, as instructed; release CI runs it after separate authorization.
- No DOM test library exists in this project (none was added), so clicks, keys, focus and layout were checked in a browser (next section).

## 7. Browser checks

Invented demo household on its own port (5231; the owner's 5173 server and data were not used). A page-level spy on the browser's `confirm` read **0 calls** throughout. Extra invented records were added only to that demo origin (a task list, a property, a saved filter, an HSA withdrawal, a second net-worth point, a scenario copy, a throwaway holding). Each flow was checked for: dialog opens and nothing is written, focus on Cancel, Escape or Cancel changes nothing, confirm (pressed twice quickly) changes exactly what it should once.

| Workflow | Checked | Result |
|---|---|---|
| Tasks list delete over the Lists dialog (NC-05) | Escape, then confirm | Escape closed only the question (Lists stayed); confirm removed the list, tasks kept with no list |
| Bulk Task project move (NC-06) | Cancel, a task changed underneath, then confirm | Cancel kept the selection and the data; the stale confirm wrote nothing and the dialog showed the new numbers; the next confirm moved 3 tasks once, milestone stayed a milestone, Undo toast shown |
| Project budget line (NC-01) | A line with a commitment, then a free line | Refusal shown inside the dialog and nothing removed; the free line was removed once |
| Paycheck scenario delete (NC-25), Signature Light then Dark | Cancel, then confirm | Only the copy was removed; the original stayed |
| Saved filter delete (NC-36) | Escape, then confirm | Nothing changed on Escape; removed on confirm; the select stayed blank |
| Investment holding remove (NC-18) | Escape, then confirm | Only that holding and its lot were removed; the same-ticker holding stayed |
| Bulk category change (NC-35) | Cancel, then confirm | 5 stayed 5 on cancel; 7 after confirm; selection cleared |
| RSU fill evenly (NC-29) and grant schedule (NC-30) | Cancel and confirm each; a vest added while the question was open | Cancel changed nothing; the stale confirm saved nothing and showed the new count; confirm saved once with no duplicate vests |
| Reconciled move (NC-37) | Save, Escape, Save, double-click Move | Escape left the form open and the transaction unchanged; confirm moved it once and set it to Cleared |
| 375 px phone, Signature Dark (NC-01) | Dialog layout | 351 of 375 wide, no sideways scroll, two 48 px buttons with Cancel first |

Not checked: a real phone (touch, on-screen keyboard), a screen reader, Classic dark, forced colors, Safari and Firefox; and in a browser, NC-02/03/04/08/09/10/14/15/16/17/19/20/21/22/23/24/26/27/31/32/33/34/38 (23 call sites) (covered by source checks, shared-component tests and, where named in the inventory, database tests, but not clicked). The confirm path of NC-19, NC-22 and NC-20 deletes real records, so they were not run even on demo data.

## 8. Screenshot evidence

`C:\Users\alexm\Documents\Ledger-Design-Concepts\D20.1B-Evidence\`: `sheet.html` (one compact sheet; open it in a browser) and `_raw\` (four captures: reconciled move in Signature Light, Paycheck delete in Signature Light, a refused budget-line removal in Signature Dark, and the 375 px phone dialog in Signature Dark). No composed PNG was produced; no "before" image exists (the native box cannot be captured).

## 9. Source files changed

Modified: `src/modules/projects/BudgetLines.tsx`, `Commitments.tsx`, `Vendors.tsx`; `src/modules/tasks/ListsDialog.tsx`, `TasksPage.tsx`; `src/pages/AppearanceCard.tsx`, `BulkProject.tsx`, `CategoriesPage.tsx`, `HsaLog.tsx`, `ImportPage.tsx`, `IncomePage.tsx`, `InvestmentsPage.tsx`, `LoanCard.tsx`, `NetWorthPage.tsx`, `PaycheckPage.tsx`, `ProfileEditor.tsx`, `RsuGrants.tsx`, `RsuSection.tsx`, `TradePanels.tsx`, `TransactionsPage.tsx`, `TxnForm.tsx`; `src/shell/modalKeys.ts`; tests `src/shell/d201aConfirmations.test.tsx`, `modalKeys.test.ts`, `uiCoverage.test.ts`, `src/pages/d16Money.test.tsx`, `d181PersonIncome.test.tsx`; docs `docs/LEDGER-SIGNATURE-D20.1-OD6-INVENTORY.md`, `docs/UI-COVERAGE.md`, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`. New: `src/lib/confirmedDeletes.ts`, `src/shell/d201bConfirmations.test.tsx`, this report.
Not touched: calculation engines, tax tables, payroll and RSU valuation code, `src/db.ts` and migrations, backup, sync, recurrence code, project financials, navigation, theme defaults, service worker, `package.json`, the shared `Modal`, `ConfirmDialog` and `confirmRun.ts`, `src/shell/uiBaseline.ts`, and the three protected files.

## 10. Judgment calls (please review)

1. **Escape acts only on the topmost dialog** (shared `modalKeys.ts`). A small change to shared behavior, needed for a question over the Lists dialog; with one dialog open nothing changes.
2. **HSA delete reads the withdrawal inside its transaction** (it used the screen's copy). Same operation; a withdrawal deleted on another device while the dialog was open now gives its cash back only once.
3. **Category delete (NC-10) recounts at confirmation** and, if the number changed, refuses and asks again. This is new friction on an existing financial action, added so the dialog never confirms an out-of-date number.
4. **"Start over from" no longer changes its label before the question** (NC-08), so cancelling leaves it as it was. The pending name is not shown while the dialog is open (the dialog names it).
5. **Dialog text states more than the native boxes did**, all read from existing code: what an import added and matched, how many rate changes and extra payments a loan has, how many selected transactions are splits or transfers, which cash returns on an HSA delete, which vests a schedule would drop. Please confirm the wording you want.
6. **Task, import and income dialogs refuse with a message** when the thing they point at is gone or changed (NC-06, NC-16, NC-30, NC-35, NC-37), rather than acting on out-of-date information.
7. **The vendor dialog (NC-04) shows counts taken when Remove was pressed**, as the old box did; the removal itself is by contact id.
8. **NC-30 still creates or finds a stock grant's ticker row BEFORE the question** (existing order); Cancel leaves the grant and vests untouched but that bare security row, if it was new, stays.
9. **Failures that used to show a toast now show inside the dialog** (NC-01, 02, 03, 09, 34); a refused removal no longer produces a success toast.
10. The historical tracker rule and its baseline (37 in 24 files) were left as they are.

## 11. NOT built

The `alert()` calls; wrapping NC-18, 19 and 22 in transactions; deleting an account's tax lots (NC-19); showing the pending palette in the select; moving focus after a delete removes its opener; real-device, screen-reader, forced-colors, Safari and Firefox checks; browser clicks for the flows listed in section 7 as not checked. Nothing is `ACC`. D21 is not started.

## 12. Handoff and git status

`docs/CHATGPT-HANDOFF.md` **was updated** (status line, current phase, change log; unknowns: the commit SHA and CI result, which do not exist yet). `docs/BACKLOG.md` and `docs/UI-COVERAGE.md` were updated too.

Git status at the end of the work (branch `main`, `HEAD` = `origin/main` = `e24407b`): **modified** `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`, `docs/LEDGER-SIGNATURE-D20.1-OD6-INVENTORY.md`, `docs/UI-COVERAGE.md`, `src/modules/projects/{BudgetLines,Commitments,Vendors}.tsx`, `src/modules/tasks/{ListsDialog,TasksPage}.tsx`, `src/pages/{AppearanceCard,BulkProject,CategoriesPage,HsaLog,ImportPage,IncomePage,InvestmentsPage,LoanCard,NetWorthPage,PaycheckPage,ProfileEditor,RsuGrants,RsuSection,TradePanels,TransactionsPage,TxnForm}.tsx`, `src/pages/d16Money.test.tsx`, `src/pages/d181PersonIncome.test.tsx`, `src/shell/{d201aConfirmations.test.tsx,modalKeys.test.ts,modalKeys.ts,uiCoverage.test.ts}`; **new (untracked)** `docs/LEDGER-SIGNATURE-D20.1B-REPORT.md`, `src/lib/confirmedDeletes.ts`, `src/shell/d201bConfirmations.test.tsx`; the three protected untracked files unchanged (`docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`). The temporary dev server on port 5231 was stopped (by its own process id; the one on 5173 was not touched). **Nothing staged, committed, pushed or deployed.**
