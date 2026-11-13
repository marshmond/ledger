# Ledger Signature D20: dialogs, confirmations and error recovery (implementation report)

Date: 2026-11-13. State: **D20 CORE approved for release by the owner and ChatGPT after review (release SHA and CI result are recorded in the release summary, not in this file). Native `confirm()` replacement is NOT part of this release (OD-6 open). D20.1 is proposed, NOT authorized. D21 is not started. Nothing is `ACC`.**

## 1. D18.2 release gate (verified before any edit)

- Repository `marshmond/ledger`, branch `main`. `git fetch` run: `HEAD` = `origin/main` = **`795bacf8efc66e511005772907e4180e9b87bdc9`** (`feat(ui): add person-level gross-to-net income breakdown`), the D18.2 release commit.
- GitHub Actions: run **#110** ("Deploy to GitHub Pages", push to `main`, head SHA `795bacf8...`) completed with conclusion `success` (public GitHub API; `gh` is not installed).
- GitHub Pages: `github-pages` deployment `7775025231` for the same SHA, final status `success` (created 19:56:14 UTC).
- Working tree at the start: only the three protected untracked files (`docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`). They were not edited, staged or deleted (the seed was only *run* from a browser tab on its own port, as its header describes).
- Read: D4 blueprint (design system, roadmap D20, open decisions OD-6, D21), `docs/UI-COVERAGE.md`, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`. The D18.2 report file was not re-read line by line; its release is confirmed from Git and CI, and the handoff.

## 2. Dialog inventory (recounted from source)

`<Modal` call sites: **63 in 42 files, unchanged** from the tracker (guard `uiResidue`). Plus **9** `<ConfirmDialog` uses (the shared one: Backup, Sync x2, Ledger account delete, Contact removal, Family member, Family date, Important contact; and the Bills-local `ConfirmDialog` in `LifecycleCard`, CF-02).

| Group | Sites | Kind | Notes found |
|---|---:|---|---|
| DL-01 Shell | 3 | Add box (sheet), Search (wide), shared confirmation | Add box keeps its own sheet look (D10). |
| DL-02 Tasks | 4 | forms (editor wide), Lists, phone Filters sheet | Lists dialog contains a native `confirm()` for list deletion. |
| DL-03 Calendar | 8 | forms, read-only detail, calendar management, handoff | Event editor is a sheet on phones. Repeat-scope choice dialog is a plain Modal. |
| DL-04 Projects | 3 | forms, permanent delete with dependency plan | Native `confirm()` in commitments, budget lines, vendors (not dialogs). |
| DL-05 Home & Assets | 7 | forms, lifecycle, permanent delete with plan | |
| DL-06 Contacts | 2 | form, "cannot be removed" detail | Removal itself is the shared ConfirmDialog. |
| DL-07 Services | 13 | forms (many wide), repair/payment/visit dialogs | |
| DL-08 Bills | 17 | forms, cycle/payment/scheduled/repair dialogs, preview-then-confirm | Own `confirm()` functions are local handlers, not browser calls. |
| DL-09 Family | 3 | forms | |
| DL-10 Ledger | 3 | blocked-delete detail, delete recurring, transaction delete | |

Workflow, validation, save/cancel and unsaved-draft behaviour of every site was left as it was; no dialog warns before discarding edits today, and none was given one.

## 3. Shared Modal changes (`src/shell/Modal.tsx`, `src/styles.css`, `src/ui/components.css`)

All new props are optional and default to the old behaviour (a Modal with no new props renders the identical class text, checked by a test).

- `size` `'sm' | 'md' | 'lg'` (`lg` = `wide`; `sm` = 420 px, used by confirmations). `description` (wired to `aria-describedby`). `locked` (while true, Escape, a click outside and the close button do nothing; `aria-busy`).
- **Sticky title bar** (title and close stay in view while a long form scrolls; the box has no top padding so a sticky bar is not pushed down by its container). **Sticky form action row**: any `.modal form > .row` whose class ends in `-actions` (every module already uses `as-actions`, `pj-actions`, `bl-actions` and so on) stays at the bottom. This inherits to all ~40 forms without editing them. Family keeps its own identical rule.
- **One scroll region:** the box is capped at the backdrop's height (`max-height: 100%`) and scrolls inside itself; `scroll-padding` keeps a focused field clear of the sticky bars.
- **Every dialog follows the visible area** (on-screen keyboard): `useSheetBehavior(back, true, variant === 'sheet')`. The scroll lock stays sheet-only (`attachSheet(..., { lock })`, default `true`, so D10 behaviour is unchanged).
- Safe-area inset at the bottom; sheets also pad the action row for the home indicator. Tokens only: no new hex, no `!important`.

Compatibility edits to existing tests (intended behaviour changes, listed): `d10QuickAdd.test.tsx` (the "plain dialog never attaches" assertion became "every dialog follows the visible height; only a sheet asks for the lock"), `d6Shared.test.tsx` (allow the `.row` and `.fm-actions` classes in the sheet footer selector), `lazyModule.test.tsx` (the old "a real bug is rethrown" test is replaced by the new behaviour, section 11), `uiCoverage.test.ts` (S-11 and CF-01 added to the built list, as the tracker procedure requires).

## 4. ConfirmDialog changes

Kept: Cancel first and focused; the action names itself; busy disables both buttons and blocks repeats; an error returned or thrown stays inside the dialog as an announced alert; callers keep their own re-checks.
Added: small width; weight accent on the edge (danger red by default for destructive confirmations, warn for `kind="replace"`, info for `kind="linked"`); the destructive button is filled in the soft status pair only inside its confirmation (D4 rule OD-10); the dialog is **locked while running** (Escape, backdrop and Close cannot dismiss it mid-action); the error uses the shared `ui-dialog-error` style (left bar, soft background, same text); phone buttons are two equal 48 px targets, Cancel still first.
Optional `kind` (`linked`, `irreversible`, `replace`) adds one labelled line (words and icon, never colour alone). **Visual only.** Applied to two callers whose text already says so: Sync "remove saved versions" (`irreversible`) and Contact removal (`linked`). Restoring a backup and Sync replace-this-device do not use `ConfirmDialog` today and were not touched.
The press-the-action logic moved to `src/shell/confirmRun.ts` (same semantics) so it can be unit tested.

## 5. Module groups covered

Shared look inherited by all 63 sites. **Looked at in a browser:** Projects form, Add asset, Contact form, Calendar due-item detail, Calendar New event (sheet), Search, Delete account confirmation, Remove contact confirmation. **Not opened in D20:** Task editor, Services, Bills, Family forms, Ledger transaction dialogs, Add box, Backup/Sync confirmations. Those groups stay `NS` in the tracker; they inherit but have not been looked at.

## 6. Mobile behaviour

Measured in a real browser (Chrome headless, 375x812 and 320x700, touch emulation): **no horizontal page overflow in any captured state**; dialogs stay within the visible area, title bar and action bar stay in view; the Calendar editor remains a bottom sheet; ordinary dialogs were not converted to sheets. The keyboard rows in the pictures are **simulated** (the visible area is cut the way the app does when `visualViewport` shrinks). A real phone keyboard and real safe-area insets are **UNVERIFIED** (owner-only).

## 7. Keyboard and focus

Real keys in a browser (1440): Shift+Tab/Tab wrap inside an ordinary dialog, Escape closes it, focus returns to the opener (Projects "New project"); the delete confirmation opens on Cancel and Escape closes it with nothing deleted, focus back on "Delete account". Search opens with Ctrl+K and closes with Escape. Unit tests cover wrap at both ends of a 40-control form, Escape, the lock, focus return. No Tab walk of every dialog, and no screen-reader check, was done (UNVERIFIED).

## 8. Escape, backdrop and close safeguards

Existing behaviour kept for every dialog: all still close on Escape, backdrop and the close icon unless a caller is busy. The only new restriction is `locked`, used by `ConfirmDialog` while its action runs (previously Escape was already ignored while running; backdrop and the Close button now are too, which closes a small duplicate-write gap). No new unsaved-changes policy was introduced.

## 9. Native confirmation audit (OD-6)

**OD-6 status: OPEN.** The D4 file recommends option (a) (replace all, after the visual phases, High risk) but records no owner decision; the handoff and backlog list it as gated. Therefore **nothing was replaced** and CF-03 is **pending owner decision**.

Counting: the tracker rule counts **37** calls in 24 files; the source has a **38th** native call it does not match (`confirm(msg)` in `TasksPage.tsx`, bulk project move), plus native `alert()` calls (`CategoriesPage.tsx:87`, and `window.alert` in `bills/quickAddDef.ts` and `services/quickAddDef.ts`). The five local functions named `confirm` are not browser calls.

All are synchronous `if (!confirm(...)) return;` guards: approval continues the handler, cancel returns with nothing changed. A conversion makes the answer asynchronous. "Easy" = the confirm is the first statement of a click handler and everything after it is one awaited call; "Needs design" = validation, plan or several writes surround it.

| Action | Existing behavior | Proposed treatment | Risk | Owner decision needed |
|---|---|---|---|---|
| Delete a transaction category in use (`CategoriesPage:75`) | Counts uses, native confirm, then delete and uncategorize | `ConfirmDialog` with the same count text; keep the count check inside `onConfirm` | Medium | Yes (OD-6) |
| Reconciled transaction move (`TxnForm:112`) | Validation first, native confirm, then a multi-write save | **Needs design**: two-step save (validate, confirm, then save) so the form is not half-saved | High | Yes, and approval of the save-sequence change |
| Single category drops split project tags (`TxnForm:240`) | Native confirm inside a toggle handler | Dialog before the toggle; no write | Low | Yes |
| Bulk set category (`TransactionsPage:123`) | Native confirm, then `bulkSetCategory` | Dialog with the same text; `onConfirm` runs the write | Medium | Yes |
| Delete a saved filter (`TransactionsPage:221`) | Native confirm inside a select change | Dialog; reset the select on cancel | Low | Yes |
| Remove project tag from selected transactions (`BulkProject:82`) | Native confirm, then run | Dialog | Medium | Yes |
| Undo import (`ImportPage:211`) | Native confirm, `undoBatch` | Dialog (ConfirmDialog already shows errors) | High (many records) | Yes |
| Remove investment holding / delete account with holdings (`InvestmentsPage:193, 214`) | Native confirm, multi-table deletes | Dialog; transaction stays in `onConfirm` | High | Yes |
| Remove lot / undo sale (`TradePanels:70, 253`) | Native confirm, `deleteLot` / `undoSale` | Dialog | High | Yes |
| Delete loan, delete property and history (`LoanCard:206`, `NetWorthPage:77`) | Native confirm, cascade delete | Dialog | High | Yes |
| Delete net-worth value / point, add another point in same month (`NetWorthPage:70, 179, 200`) | Native confirm | Dialog (the "add another" one is a continue prompt: needs wording) | Low to Medium | Yes |
| Delete gift, goal, policy, HSA withdrawal, RSU vest (`GivingPage`, `GoalsPage`, `ProtectionPage`, `HsaLog`, `RsuSection`) | Native confirm then single delete | Dialog | Low | Yes |
| RSU grant: replace vests, schedule drops vests, delete grant (`RsuGrants:53, 191, 320`) | Native confirm inside a computation | **Needs design** (decision depends on computed lists) | Medium to High | Yes |
| Income setup replace / remove (`IncomePage:247, 248`) | Native confirm, then save or delete | Dialog | High (income data) | Yes |
| Turn off HSA/ESPP deduction (`ProfileEditor:94`) | Native confirm in a toggle | Dialog before the toggle | Medium | Yes |
| Paycheck scenario delete / reset (`PaycheckPage:133, 310`) | Native confirm | Dialog | Medium | Yes |
| Theme delete / replace colors (`AppearanceCard:190, 208`) | Native confirm; the second sits in a select change | Dialog; revert the select on cancel | Low | Yes |
| Saved view delete (`FlowViews:64`) | Native confirm | Dialog | Low | Yes |
| Tasks: list delete, bulk project move (`ListsDialog:20`, `TasksPage:140`) | Native confirm; bulk move runs after a plan and before the write | Dialog; bulk move **needs design** (plan, confirm, then write) | Medium | Yes |
| Projects: remove vendor, budget line, commitment, cancel agreement (`Vendors:64`, `BudgetLines:72`, `Commitments:44, 161`) | Native confirm, then module call | Dialog; texts depend on financial dependencies | Medium | Yes |

**Recommendation (not implemented):** if the owner approves OD-6 option (a), migrate in this order, one module per batch, each with its own test and an invented-data delete/undo run: (1) single-delete leaf records (gifts, goals, policies, views, themes, values), (2) Projects and Tasks, (3) Ledger bulk and cascade deletes, (4) the "Needs design" rows last (reconciled move, RSU grant, bulk project move), each with a separate approval because they touch save order. A shared asynchronous helper (one `useConfirm()` that returns a promise and renders `ConfirmDialog`) would keep the call sites small. Alternative, option (b): accept the native boxes as a recorded exception.

## 10. OD-6 decision status

Unresolved. Honoured: no native call was replaced, no save sequence was changed, no domain validation was replaced by a visual confirmation. The tracker marks CF-03 `NS` with "pending owner decision".

## 11. Screen-error recovery design

- `ModuleLoadBoundary` (wraps every module and Settings) used to **rethrow** any error that was not a chunk-load failure, which unmounted the whole app (the Paycheck-timestamp incident). It now shows `PageProblem`: "This page ran into a problem." with a statement that saved records were not deleted, **Try again**, **Go to Today** (`#/today`), **Reload Ledger**, and a plain note that a reload keeps saved data but discards unsaved text in an open form. No stack or error text is shown; the details go to `console.error` only.
- `PageErrorBoundary` (new) wraps just the page inside Ledger's `Shell`, so the Ledger navigation, breadcrumbs and section tabs stay on screen and usable. Other modules are covered by the module boundary (their own sub-navigation goes with the page; the global top bar remains).
- Reset on navigation: `resetKey = pathname`; going to another page draws it fresh. A failed file fetch is not reset by navigation (existing self-heal and Try again kept). Retry is only ever a person pressing Try again or navigating: **no automatic retry, no loop** (a second failure shows the state again; seen in the browser).
- Chunk-load failures keep their message and the existing `retryLazyModule` retry (restyled with the shared state panel; text unchanged).
- Never touches stored data, storage, Sync or the network (a test reads the source for that). Focus moves to the heading when the state appears.
- **What it catches:** errors thrown while React draws (render, lifecycle, constructors) below a boundary, and unfetchable module files. **What it does NOT catch:** errors in event handlers, rejected async work (database calls, timers), and errors in the boundary itself. This is not a universal crash-recovery system.
- Verified in a browser by making one invented transaction unreadable (name stored as an object): Before the whole app went blank; After the page shows the message with Ledger's bars usable, Try again with the record still unreadable shows it again, Go to Today works, navigating to another Ledger page recovers, and after restoring the record Try again redraws the page. The record was restored exactly. The module-level state (`<Main>` variant) was only unit tested and seen on the blocked-module path, not on a real render crash.

## 12. Loading and failure states

`ModuleLoading` keeps its 150 ms delay and polite status; its inline style became a class. No change to delays or retry behaviour. Failed-load states use the shared `ui-state` panel (icon, words, role="alert").

## 13. Safeguards preserved

Cancel-first and initial Cancel focus; specific action labels; busy and no repeat (now unit tested through `confirmRun`); errors stay open; account delete still calls `deleteAccountWithTransactions` inside `onConfirm` (re-check in one transaction); contact removal keeps its plan and refusal handling; `modalKeys` Tab trap, Escape and focus return unchanged; sheet scroll lock unchanged. A test snapshots every table before and after drawing and dismissing dialogs (no change).

## 14. Tests and checks

- New `src/shell/d20Dialogs.test.tsx`: **40 tests** (Modal structure and sizes, description, lock, guarded close, 40-control long form, reduced visible area with and without the lock, ConfirmDialog structure and kinds, runner (single run, refusal, throw, success, newest handler), boundary behaviour for normal, chunk and retry cases, reset on navigation, console-only reporting, no storage/network in boundary code, wiring, stylesheet contract, no database change).
- Targeted run of every test mentioning styles, Modal, ConfirmDialog, Shell, the loader, Sync, contact removal or the tracker: **27 files, 734 tests, all pass** (after the one-class allowance edit in `d6Shared`, rerun: 66 pass). `npx tsc --noEmit` clean. `npm run build` succeeds (existing chunk-size warning only). **The full suite was NOT run locally**, as instructed; release CI runs it after separate authorization.
- Browser: Chrome headless at 1440, 375 and 320 plus the in-app browser for keyboard checks; Signature light for all, Signature Dark for the delete confirmation and the page error. Not done: Classic, forced colors, contrast measurement, real phone, screen reader, Safari, Firefox.

## 15. Visual evidence

`C:\Users\alexm\Documents\Ledger-Design-Concepts\D20-Evidence\`: `D20-SHEET-1-SHARED-DIALOGS.png`, `D20-SHEET-2-CONFIRMATIONS.png`, `D20-SHEET-3-MOBILE.png`, `D20-SHEET-4-ERROR-RECOVERY.png`, and `_raw\` (every capture, `capture-before.json`, `capture-after.json` with overflow and dialog measurements). Labelled Before versus After (no approved D20 prototype exists). Before = the committed HEAD served from a copy; After = this change; both on a freshly seeded invented household. Not pictured: confirmation error and busy states, native confirm boxes.

## 16. Not built, deferred, or open

- **OD-6 native confirmations: nothing replaced.** Owner decision needed (section 9).
- A Bills-local confirm (CF-02) and the Add box were not restyled beyond inheritance.
- No new unsaved-changes warning on any form (would be a behaviour change).
- Task editor, Services, Bills, Family forms and Ledger transaction dialogs not looked at in a browser; their tracker groups stay `NS`.
- Search and Task creator tracker rows (S-06, S-07) not changed (Search was viewed once, no marks recorded).
- Real phone keyboard and safe areas, screen readers, forced colors, contrast figures: UNVERIFIED. D21 decisions (default palette) untouched.

## 17. Source files changed

Modified: `src/App.tsx`, `src/shell/Modal.tsx`, `src/shell/ConfirmDialog.tsx`, `src/shell/ModuleLoader.tsx`, `src/shell/Shell.tsx`, `src/shell/modalKeys.ts`, `src/shell/sheetBehavior.ts`, `src/styles.css`, `src/ui/components.css`, `src/pages/SyncPage.tsx` (one `kind` prop), `src/modules/contacts/RemoveContact.tsx` (one `kind` prop); tests `src/core/lazyModule.test.tsx`, `src/shell/d10QuickAdd.test.tsx`, `src/shell/d6Shared.test.tsx`, `src/shell/uiCoverage.test.ts`; docs `docs/UI-COVERAGE.md`, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`. New: `src/shell/confirmRun.ts`, `src/shell/d20Dialogs.test.tsx`, this report. No file in `src/lib`, `src/db.ts`, `src/types.ts`, sync, backup, tax tables, service worker, navigation or `package.json` changed; no dependency.

## 18. Judgment calls (please review)

1. The sticky Cancel/Save bar is applied by a class-name pattern (`-actions`) so all forms inherit it; the alternative is touching ~40 forms. It depends on every module naming its action row that way (true today; a test pins the rule, not the names).
2. Every ordinary dialog now follows the on-screen keyboard (previously only sheets). The page behind a plain dialog is still not scroll-locked.
3. `ConfirmDialog` is now locked during its action, which also blocks the backdrop and Close button (previously only Escape and Cancel were blocked).
4. `PageProblem` hides all technical text; a person reporting a problem must open the browser console. A "copy details" button was not added (no new data flow).
5. The module-level error state removes the module's own sub-navigation with the page; only Ledger got the page-level boundary. Adding per-module page boundaries is a separate, small follow-up.
6. `kind` is applied to two confirmations only. Backup restore and Sync replace do not use `ConfirmDialog`, so no "replace" wording was added to them.
7. The tracker rule that counts native `confirm()` misses one call; the baseline was not changed (37) so as not to alter a guard number; reported here instead.
8. Mixed evidence caveat: "Before" is from a copy of HEAD on the same port, not the owner's data.

## 19. Git status

See the release summary; at the time of the final verification the D20 files were the only changes besides the three protected untracked files, and nothing was staged.

## 20. Final verification before release (2026-11-13)

Baseline re-checked: `main` = `origin/main` = `795bacf`, nothing staged, no changes in `src/lib`, `src/db.ts`, `src/types.ts`, sync, backup, service worker, tax tables, navigation or `package.json`.

Four extra dialogs opened in a real browser (invented household), each Cancelled, then every stored module record compared with a snapshot taken before (unchanged each time):

| Dialog | Setup | Result |
|---|---|---|
| Tasks: edit a task | desktop, Classic; title edited then Cancel | layout correct, action bar visible, long form scrolls, no save |
| Services: edit arrangement | phone 375, "More details" expanded | scrolls inside the dialog, last field clear of the sticky bar, Cancel/Save reachable, no page overflow |
| Bills: edit bill | desktop, Classic | standard layout, schedule preview visible, Save/Cancel visible, Cancel changes nothing |
| Family: edit member | desktop, Signature Dark | 9 color radios usable (selection changed and cancelled), buttons visible, dark surface correct, no overflow |
| Family: add member, contact list | phone 375, Signature Dark | the inline contact list scrolls inside the dialog and is not hidden by the sticky bars |

A Classic appearance check of a standard dialog is the Tasks and Bills rows. Native `<select>` pop-ups are drawn by the browser outside the page and could not be inspected. No defect found; no correction made. Still NOT individually browser-tested: all other module dialogs (about 55 of the 63 sites); the shared look reaches them by inheritance only.

## 21. Native confirmations: accurate inventory and what is proposed

- Actual browser-native `confirm()` calls: **38** (the 37 the tracker rule counts in 24 files, plus `confirm(msg)` in `TasksPage.tsx`, which the rule's pattern does not match because its argument is a variable). Separate native `alert()` calls: `CategoriesPage.tsx:87`, `bills/quickAddDef.ts`, `services/quickAddDef.ts`.
- The tracker count (37) and `uiBaseline.ts` were deliberately NOT changed: widening the counting pattern would alter the measurement definition, so the discrepancy is recorded here and in the tracker for D20.1.
- **Proposal for D20.1, pending an explicit owner decision on OD-6, NOT authorized and NOT started:** replace only the authorized native confirmations with the existing `ConfirmDialog`, preserving cancellation, validation, dependency checks and save order; treat simple single-delete confirmations separately from high-risk multi-write workflows (reconciled-transaction move, RSU grant, bulk task project move); migrate in small groups, each with proportionate tests and an invented-data delete and Undo run. No call is migrated until it is specifically authorized. CF-03 stays not accepted.
