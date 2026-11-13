# Ledger Signature D20.1A: native confirmation migration, foundation and low-risk batch (implementation report)

Date: 2026-11-13. State: **BUILT AND TESTED LOCALLY. UNCOMMITTED, NOT STAGED, NOT PUSHED, NOT DEPLOYED. Awaiting owner and ChatGPT review.** D20.1B, C, D and D21 are not started. Nothing is `ACC`.

## 1. D20 core release gate (verified before any edit)

- Repository `marshmond/ledger`, branch `main`. `git fetch` run: `HEAD` = `origin/main` = **`ff39a9af2a1b295fa799faa07e0d2d4271021afc`** (`feat(ui): improve dialogs confirmations and page recovery`), the D20 core release commit (the newest commit in Git history and the handoff's D20 entry).
- GitHub Actions: run **#111** ("Deploy to GitHub Pages", head SHA `ff39a9af...`) completed with conclusion `success`.
- GitHub Pages: `github-pages` deployment `7775877567` for the same SHA, final status `success` (public GitHub API; `gh` is not installed).
- Read: `docs/LEDGER-SIGNATURE-D20-REPORT.md`, the handoff, the backlog and `docs/UI-COVERAGE.md` (the D4 blueprint's open decisions were read through those, which restate OD-6 and D21). Working tree at the start: only the three protected untracked files, which were not edited, staged or deleted (the seed script was only read; the demo browser already held its invented data).

## 2. Owner decision

**OD-6: Owner approved option (a), replacement of all 38 native confirmations, in controlled batches with high-risk workflows last.** Recorded in the inventory, tracker, backlog and handoff. The approval does not cover financial calculations, business rules, schemas or save and validation semantics; none was changed.

## 3. Inventory (actual native confirmations)

Full table: `docs/LEDGER-SIGNATURE-D20.1-OD6-INVENTORY.md` (NC-01 to NC-38, with message, approval, cancellation, writes, validation, risk, batch and status for each).

- **Actual native `confirm()` calls at `ff39a9a`: 38.** After D20.1A: **33**.
- **Historical tracker metric** (rule unchanged, baseline stays the D4 37 in 24 files): measured 37 before, **32 in 20 files** now. The one call it cannot see is `confirm(msg)` in `TasksPage.tsx` (NC-06).
- Five local functions named `confirm` (not browser calls) and the native `alert()` calls are listed or noted and were not touched. A new test counts actual native calls with a broader rule that excludes them and checks the count against the inventory, so the two metrics cannot be confused.

## 4. Candidates and what was migrated

All five were inspected first. None had a multi-table write, financial dependency, validation step or hidden async side effect; all five were migrated.

| Inventory | Action | Underlying operation (unchanged) | Migrated |
|---|---|---|---|
| NC-12 `GivingPage` | Delete a gift | `db.donations.delete(id)` | Yes |
| NC-13 `GoalsPage` | Delete a goal | `db.goals.delete(id)` (the funding account is not touched) | Yes |
| NC-28 `ProtectionPage` | Delete a policy record | `useInsurance().remove(id)` (rewrites the stored policy list) | Yes |
| NC-11 `FlowViews` | Delete a saved view | remove by id from the stored view list, then clear the selection | Yes |
| NC-07 `AppearanceCard` | Delete a saved theme | remove by id from the stored theme list; colors stay on as "My own colors" | Yes |

Scope kept exact: in `AppearanceCard.tsx` the separate "Replace your colors" native confirm (NC-08) is untouched (assigned to D). No other native call elsewhere in these files exists.

## 5. Migration architecture (plain words)

- Each screen keeps a tiny piece of state that only says **which item** the person pressed "delete" on (an id, or a yes/no flag on a card that already belongs to one goal or one policy). Pressing "delete" now does nothing except remember that. The shared `ConfirmDialog` then asks. Cancel, Escape and the close icon only forget the choice.
- Only the dialog's own button (for example **Delete gift**) runs the same delete as before, on the remembered id, then closes. Nothing in the dialog code uses the browser's confirm, a promise queue or a global event; no new framework.
- **One small shared helper**, `src/lib/savedRemoval.ts`, for the two list-based items (saved views and saved themes). Reason: those lists are stored as one value, and the old code wrote back the copy the screen had loaded. That was safe while the browser box froze the page; with a Ledger dialog the page keeps running, so a view added by a synced device while the question is open would have been silently lost. The helper reads the stored list again at the moment of confirmation, inside one transaction on the settings table, and takes out only the chosen id. If the item is already gone it writes nothing. This mirrors the existing `deleteSavedFilter` pattern.
- Stale records: the gift dialog looks the gift up by id in the live list, so if it disappears (deleted on another device) the dialog closes by itself. Goal and policy dialogs live inside the card or row that is keyed by that record's id, so they disappear with it. Views and themes are looked up by id the same way. Nothing uses an array position or a name.
- The dialog itself is the D20 `ConfirmDialog` unchanged: Cancel first and focused, specific action label, danger styling, locked and busy while running, errors shown inside it, repeat presses ignored (`confirmRun.ts`).

## 6. Before and after

| | Before | After |
|---|---|---|
| Asking | The browser's own box (operating-system look, cannot be styled or described) | Ledger dialog in the Signature style, names the item, says what is and is not affected |
| Cancel | Returns, nothing changes | Same: clears the remembered choice only; focus returns to the "delete" button |
| Approve | Delete runs, then (view, theme) screen state updates | Same operation, same screen updates, plus a fresh read of the stored list (views and themes) |
| Failure | Unhandled | Stays in the dialog as an announced message; nothing reported as done; can be pressed again |
| Double press | Not possible (box froze the page) | Ignored while running |

Wording used (specific to each action, no invented consequences): Delete gift? / Delete goal? / Delete policy? (says it deletes the Ledger record only and does not cancel real coverage) / Delete saved view? / Delete saved theme? (keeps "The colors stay on until you pick something else"). Views and themes also say they are removed from synced devices, which the existing page text already states.

## 7. Safeguards

Cancel and Escape change nothing (checked in a browser for all five and by source test); press-once and no-false-success tested with the real handlers (`makeConfirmRunner`); errors keep the dialog open; a vanished record cannot cause a different one to go; only the settings table is touched for views and themes; the browser confirm is not called (page-level spy returned 0 calls in every browser check).

## 8. Tests

New `src/shell/d201aConfirmations.test.tsx`: **33 tests**: inventory against source (38 rows, batch split 5/12/14/7, migrated rows, actual native count 33, local functions excluded, tracker metric kept at 37 baseline and 32 measured); callers (no native call left in four files, exactly one in `AppearanceCard`, delete buttons only record the id, writes only inside the confirm handler on the picked id, wording, no second framework); drawn dialog (Cancel first, action label, danger styling, small, for all five wordings); disposable database (two similar themes, two similar views, vanished record is a no-write, list re-read keeps a view that arrived meanwhile, active view or theme deletion touches only the list, settings table only; two identical gifts, similar goals with the funding account intact); runner (two presses run once, failing database leaves the dialog open with a message and no success, retry after a failure works, drawing the dialog changes no table); documents (OD-6, CF-03 partial, D21 not started).

Run (details in section 15's results): the new file plus every existing test touching the shared dialogs, residue and coverage tracker, the plan pages, Settings, flow views, giving, protection, saved themes, palette and theme: **15 files, 343 tests, all pass**. `npx tsc --noEmit` clean. `npm run build` succeeds (existing chunk-size warning only). **The full suite was NOT run locally**, as instructed; release CI runs it after separate authorization.

No DOM test library exists in this project (no new dependency was added), so real click, key, focus and phone behavior was checked in a browser, below.

## 9. Browser checks

Invented demo household on its own port (5231; the owner's 5173 server and data were not used). Page-level spy on the browser's `confirm` read **0 calls** throughout. Extra invented records were added only to that demo origin (two identical gifts, two goals with one name, a second life policy with the same company, two saved views and two saved themes with near-identical names).

- **Gift (desktop, Classic):** opened (no data change, focus on Cancel), Escape (closed, 5 gifts, focus back on the delete button), reopened, Tab then Enter twice quickly: exactly the one chosen id removed, its identical twin kept, dialog closed.
- **Saved theme (own-colors palette):** Cancel (both themes kept, still in use); reopen, confirm: theme removed, other theme kept, "Colors right now" became "My own colors", accent color unchanged, stored choice no longer linked to the deleted theme. This is the "deleting the active saved theme" case.
- **Saved flow view (Signature Light, then Signature Dark, desktop):** Escape (nothing changed, selection kept, focus back); in Dark, Tab then Enter: the active view removed, other view kept, selection cleared, the diagram kept its period and detail. This is the "deleting an active saved view" case.
- **Goal (Signature Light, phone 375x812):** dialog width 351 of 375, no sideways scroll, two equal large buttons with Cancel first; confirmed on the second of two same-named goals: only that id removed, the funding account's cash unchanged.
- **Policy (phone):** Escape changed nothing; confirm removed only the chosen record; the other life policy with the same company stayed.
- **Vanished record:** with a gift dialog open, the gift was deleted from the database; the dialog closed by itself and nothing else was removed.
- Not checked: a real phone (touch, on-screen keyboard), a screen reader, Classic dark, forced colors, Safari and Firefox. The native prompt itself could not be photographed (drawn by the operating system outside the page).

## 10. Visual evidence

`C:\Users\alexm\Documents\Ledger-Design-Concepts\D20.1A-Evidence\`: `D20.1A-SHEET-1-CONFIRMATIONS.png` (standard deletion, saved view in Signature Light, the same in Signature Dark, phone 375 goal dialog, saved theme) and `_raw\` (each capture, `sheet.html`). **No "Before" image exists** (the old native box cannot be captured reliably; none was fabricated).

## 11. Source files changed

Modified: `src/pages/GivingPage.tsx`, `src/pages/GoalsPage.tsx`, `src/pages/ProtectionPage.tsx`, `src/pages/FlowViews.tsx`, `src/pages/AppearanceCard.tsx`; docs `docs/UI-COVERAGE.md`, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`. New: `src/lib/savedRemoval.ts`, `src/shell/d201aConfirmations.test.tsx`, `docs/LEDGER-SIGNATURE-D20.1-OD6-INVENTORY.md`, this report. Not touched: calculation engines, tax tables, income, RSU, `src/db.ts`, backup, sync, recurrence code, project financials, navigation, theme defaults, service worker, `package.json`, `src/shell/uiBaseline.ts`, the shared `Modal`, `ConfirmDialog` and `confirmRun.ts`, and the three protected files.

## 12. Remaining native confirmations and proposal

**33 remain** (historical rule: 32). Proposed assignments (every call in exactly one batch; details in the inventory):

- **D20.1B moderate (12):** Tasks list delete (NC-05); project vendor, commitment (remove, cancel agreement) and budget line (NC-01 to 04); Paycheck scenario delete and reset (NC-25, 26); Net Worth value, point and "add another" (NC-21, 23, 24); one RSU vest (NC-32); saved filter (NC-36).
- **D20.1C financial and multi-record (14):** category delete in use (NC-10); bulk project tag and bulk category (NC-09, 35); undo import (NC-15); investment holding, account, lot and sale undo (NC-18, 19, 33, 34); loan and property delete (NC-20, 22); HSA withdrawal (NC-14); income setup replace and remove (NC-16, 17); RSU grant delete (NC-31).
- **D20.1D complex (7):** reconciled-transaction move and split-to-single toggle (NC-37, 38); RSU even split and schedule-drops-vests (NC-29, 30); bulk Task project move (NC-06); "Replace your colors" select (NC-08); HSA/ESPP toggle (NC-27).

Reassignments against the D20 report's table are listed in inventory section 6 (HSA withdrawal and RSU grant delete moved up to C; bulk project tag to C; the toggle to D).

## 13. Separate save-sequence review required

Before D20.1D builds, each of NC-37 (validation, question, then multi-write save), NC-29 and NC-30 (computed list, question, save), NC-06 (plan, question, write), NC-27 and NC-38 (question inside a toggle) and NC-08 (select value set before the question) needs its existing and proposed sequence written down and reviewed. In C, NC-18, 19 and 22 delete across two tables in separate awaits with no transaction today; wrapping them in a transaction would be a persistence change and needs a decision, not an assumption. NC-01 and NC-02 refuse inside the helper after the answer; the dialog must show the refusal instead of the success toast.

## 14. Judgment calls (please review)

1. A shared helper was added only for saved views and themes (stale-list safety); gifts, goals and policies use plain local state. The alternative (one generic `useConfirm`) was avoided as the brief asked.
2. Views and themes now re-read the stored list at confirmation instead of reusing the screen's copy. Same operation, but a write path changed from "write back my copy" to "read, remove one id, write". If the item is already gone nothing is written (before, the list was rewritten unchanged).
3. If a gift, view or theme vanishes while its dialog is open, the dialog closes silently rather than showing an error. No message tells the person it was already gone.
4. After a successful delete the button that opened the dialog is gone (the row or card disappears), so keyboard focus falls to the start of the page. The browser box had the same effect; moving focus to a sensible heading is a possible later polish for all deletions, not done here.
5. The policy list delete still goes through `useInsurance().remove`, which filters the screen's current copy (as every edit on that page does). The re-read treatment was not applied there because the hook lives outside this batch's scope; the window is the instant between a synced change and the next screen refresh.
6. Wording adds "If you sync your devices, the view/theme is removed from them too" (views and themes) and "an amount you already copied into your tax estimate is not changed" (gifts). Both restate existing behavior; please confirm you want them.
7. The historical tracker rule and its baseline (37 / 24) were left as they are; the actual count is kept in the inventory and a test. The residue report will print "down" for the historical metric.
8. The theme dialog was only looked at on the own-colors palette (a saved theme is a custom palette), not on the Signature preset.

## 15. Not built

D20.1B, C and D (33 native confirmations); native `alert()` calls; any change to the "Replace your colors" select; focus-after-delete polish; real-device, screen-reader, forced-colors and Safari/Firefox checks. Nothing is accepted: CF-03 stays `NS` (partially migrated).

## 16. Git status

At the end of the work: modified `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`, `docs/UI-COVERAGE.md`, `src/pages/AppearanceCard.tsx`, `src/pages/FlowViews.tsx`, `src/pages/GivingPage.tsx`, `src/pages/GoalsPage.tsx`, `src/pages/ProtectionPage.tsx`; new `docs/LEDGER-SIGNATURE-D20.1-OD6-INVENTORY.md`, `docs/LEDGER-SIGNATURE-D20.1A-REPORT.md`, `src/lib/savedRemoval.ts`, `src/shell/d201aConfirmations.test.tsx`; the three protected untracked files unchanged. **Nothing staged, committed, pushed or deployed.**
