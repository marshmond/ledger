# Ledger R1.3: "Finish the loop" (finishing a Task leads to logging the work) — build report

**Date:** 2026-11-16. **Author:** Claude (local implementation assistant). **Status: APPROVED BY CHATGPT WITH ONE SAFEGUARD (multi-asset, applied and tested); AUTHORIZED FOR RELEASE (commit and push; SHA and Actions result in the handoff).** (Earlier status: built and tested locally, awaiting review. NOT REAL-DEVICE TESTED; real-device and screen-reader acceptance are not recorded.** No phase after R1.3 was started.

**Privacy:** every name, date and amount in this report, in the tests and in the screenshots is invented (the documented demo household, `scripts/dev-demo-seed.ts`, run only on its own demo address, port 5231). No real household data, balance, backup, export or credential appears anywhere.

**Gate verified first:** `main` = `origin/main` = `3f5f529` (`feat(today): add weekly household review`, R1.2) and GitHub Pages run **#119** `completed` / `success` for it (public Actions API; `gh` is not installed). So R1.2 is committed and deployed and nothing of it was mixed into this work. Only the three protected untracked files were present beforehand (`docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`); none was edited.

---

## A. Executive summary

When you tick off a Task that stands for a household visit (Household Services) or for maintenance on an asset (Home & Assets), the small "Done" message at the bottom of the screen now carries **one extra button beside Undo**: **Log completed visit** or **Log maintenance**. It opens the existing logging dialog right where you are (Tasks, Today, the Calendar), with the task's name and the day it was finished already filled in. Nothing is saved until you press that dialog's own button. If you ignore the message, nothing happens. An ordinary task gets exactly the message it always had.

Ticking a task done is still only that: the reminder is done. It is not treated as proof the visit happened, that it was paid for, or that any money moved. No visit, no history entry and no money record is ever created by finishing a Task (tests prove it), and no new place to store anything was added.

The two lists of "finished but never logged" work also got easier to clear:

- **Household Services** (the existing "Needs attention" card): finished visits can be ticked and logged **one after another**, each in its own form.
- **Home & Assets**: the overview now has a **"Finished, not yet saved"** list. Each task has its own **Save to history…** button that opens the form on the spot (before, it took you to the asset page first), and several can be ticked and saved one after another.

There is deliberately **no "log all" and no "dismiss"** (section D explains why).

---

## B. Workflow integration

### B.1 Where the extra button appears

| Where a Task is finished | What happens now |
|---|---|
| **Tasks** page: the circle on a row | The "Done" message may carry the extra button. |
| **Tasks** page: "Complete" on several selected rows | One message: "Completed 3 tasks", and, if some of them can be logged, **"Log N one at a time"** (a walk through only those, section D). |
| **Task editor** ("Mark done", and also choosing status Done and saving) | Same offer. |
| **Today**: the check button on a task row | Same offer (checked in the browser). |
| **Calendar**: a task's detail, "Mark done" | Same offer (checked in the browser). The Calendar did not gain any new way to complete things. |
| A record's own linked-tasks list (`✓ N tasks` on an account, bill and so on) | Same offer. |
| A **Project's** task list | Same offer. |

Not changed: finishing a Calendar event that "tracks done", and any non-Task item. A Task finished on another device while this one is closed gets no message here, but it appears in the "finished, not yet logged" lists, which is the safety net.

### B.2 How it fits together (a small shared layer, not three copies)

- `src/core/taskFollowUp.ts` (new, neutral, writes nothing): `announceTaskDone` shows the ordinary "Done: ..." message with its ordinary Undo and, when a finished Task has something to log, adds one button. Every entry point above calls this one function after its own existing `completeTask`. `resolveTaskFollowUp` asks the modules.
- **Module boundaries kept.** Tasks, Today and the Calendar import neither Household Services nor Home & Assets. Each of those two registers one new optional hook, `contributes.taskFollowUp` (`read` plus a lazily loaded `Dialog`), like the existing `attention` and `weekReview` hooks. Documented in `docs/module-hooks.md`.
- **An ordinary Task loads no module code.** The Task's own links are read first (one small query); a module is asked only if the Task is linked to a record of that module. A Task linked to something else (an account, a bill) gets no offer and no module is even called (tested).
- `src/shell/FollowUpHost.tsx` (new, mounted once in `App.tsx`, like the quick-task form): when the button is pressed it loads the module's dialog and opens it **on top of whatever screen you are on**. No navigation happens.
- **Household Services** (`services/followUp.ts`, `FollowUpDialog.tsx`): offers "Log completed visit" when the Task is a finished visit Task of an existing arrangement, is not a "remind me to book" Task, and no live visit names it yet. The dialog is the **existing `LogVisitDialog`** ("Log this visit"), unchanged in what it saves (`logVisitFromTask`).
- **Home & Assets** (`assets/followUp.ts`, `FollowUpDialog.tsx`): offers "Log maintenance" when the finished Task is linked to a live, un-archived asset and no live service record carries its id (the same test `logTaskService` refuses on). The dialog is the **existing `ServiceForm`** in its "Save to service history" form (`logTaskService`, `complete: false`).
- Both readers and dialogs are separate files fetched only when needed (a new assertion in `lazyBoundary.test.ts` pins that they are not in the first download).

Existing components gained only optional props: `LogVisitDialog` (`onSaved`, `queue`, `finished`), `ServiceForm` (`onSaved`, `queue`), and the toast (`action`). With none of them given, they behave as before.

### B.3 What the person sees

The message reads, for example, "Done. The next one is created.   **Log completed visit**   Undo   ✕". The extra button stays about 12 seconds (the plain message 4.5 to 8 seconds as before). The dialog says in plain words that finishing a task is not proof the visit happened and shows the day the visit was scheduled for beside the day it is being logged (starting at the day the Task was finished). On a phone the message wraps so the buttons are on their own line and at least 44 px tall.

---

## C. Recurrence and data safeguards

- **No automatic writes.** Finishing a Task still calls only Tasks' own `completeTask`. A test finishes both a visit Task and a maintenance Task and checks that there are no visits, no service records and no Finance transactions afterwards. Looking at the offer, opening the dialog's preview and cancelling leave every table byte-for-byte unchanged (tested against a fingerprint of the Tasks, links, contacts and Finance tables).
- **The finished occurrence stays the finished occurrence.** The button carries the id of the Task that was finished, never "the open visit". For a recurring visit, `completeTask` has already made the next Task; a test checks that the offer is for the finished Task, that logging it records a visit whose `taskId` is the finished Task and whose occurrence is the date that Task stood for, that exactly one open next visit remains (no duplicate Task), that no visit is tied to the next Task, and that the next Task itself gets no offer.
- **No second recurrence engine.** The dialog's own existing planning (`planLogVisit`, `nextAfterVisit`) still decides what happens to the next visit, including re-aligning a copy that Tasks made. Nothing in R1.3 computes a date.
- **Cancel, Undo, reopen.** Cancelling the dialog never reverses the completion (verified in the browser and tested). Undo of the completion uses Tasks' own `reopenTask`; a logged visit or history entry is **not** deleted by it (tested), and finishing the same Task again gets no second offer because it is already logged. If the Task is reopened before the button is used, the dialog says "That task is not finished any more... Nothing was changed." and writes nothing.
- **Duplicates.** The existing protections are untouched and re-tested: two simultaneous saves of one visit give one visit; a second save of one maintenance Task is refused ("already saved") and the dialog points to the existing entry instead of making another. Existing "possible duplicate" flags are not touched.
- **Things that no longer exist.** A deleted Task, a removed arrangement, a removed or archived asset, or a Task that is not a visit Task (a booking reminder) each get no button, and if the button is already on screen the dialog shows a plain reason instead of opening a form.
- **Financial truth.** No transaction is created or changed. The "amount charged" and "cost" fields are the same optional notes as before ("not recorded as a payment", "not counted as money spent"; blank means "not recorded", never $0). Finance imports nothing from the household modules.
- **Storage.** No table, migration, backup or sync change, no new flag, no preference. Nothing about the offer is stored; it is worked out from the Task's links when the Task is finished.

---

## D. Bulk resolution

**What was built.** On both overviews, when two or more finished items are waiting, each gets a tick box; "Select all (N)" and "Clear"; a plain sentence that names exactly which items are selected (by name and date) and says each opens its own form and nothing is saved until that form's own button; and a button **"Log N selected, one at a time…"** (Services) or **"Save N selected, one at a time…"** (Home & Assets). The forms open one after another in the same place. Each says "N of M". **Skip this one** leaves that item unlogged and moves on; saving moves on; closing the form (Cancel, Not now, X, Escape) stops the whole list and keeps everything already saved. The same walk powers "Log N one at a time" after a bulk "Complete" in Tasks. The walking rules are pure functions (`advanceRun`, `stopRun`) with tests, including that the close that follows a save never ends the walk early.

**Existing operations reused.** `logVisitFromTask` (through `LogVisitDialog`) and `logTaskService` (through `ServiceForm`), one record per press. Nothing new writes.

**What was deliberately not built, and why.**

- **No "log all" / "save all".** A visit needs its own outcome (done, skipped, cancelled), date, notes and optional charge; a maintenance entry needs what was done, the cost and who did it. Saving a group at once would mean inventing those, and finishing a task is not proof the work happened. Each is therefore saved only by its own form.
- **No "dismiss".** Ledger has no record of "reviewed and left out", and R1.3 forbids inventing a storage model for it. The honest ways out already exist: for a visit that did not happen, the arrangement page's **It was skipped / It was cancelled** (a real recorded outcome, not a hidden flag); for maintenance there is none today. This is documented here and in the backlog as a limitation for a later, deliberate decision.
- On phones the Services list is long because each entry keeps its existing layout; I did not redesign it.

---

## E. UX evidence

Invented demo household, built-in browser; files in `C:\Users\alexm\Documents\Ledger-Design-Concepts\R1.3-Evidence\` (outside the repository, as for R1.1 and R1.2):

| File | What it shows |
|---|---|
| `01-desktop-tasks-done-offer-visit.jpg` | Tasks, 1024 px: "Done. The next one is created." with **Log completed visit** and Undo |
| `02-desktop-log-visit-dialog.jpg` | The existing "Log this visit" dialog, opened in place, with the scheduled day and the day finished |
| `03-desktop-tasks-done-offer-maintenance.jpg` | A maintenance task: **Log maintenance** beside Undo |
| `04-desktop-save-to-history-form.jpg` | The existing "Save to service history" form for the Gas furnace, title and date filled in, cost blank |
| `05-desktop-ordinary-task-unchanged.jpg` | An ordinary task: the same message as always, no extra button |
| `06-desktop-calendar-done-offer.jpg` | The Calendar's "Mark done" with the same offer |
| `07-desktop-services-select-several.jpg` | Household Services: two of three finished visits ticked, with their scheduled dates and the one-at-a-time button |
| `08-desktop-services-one-at-a-time.jpg` | "Visit 1 of 2": Not now / Skip this one / Log this visit |
| `09-desktop-assets-unsaved-list.jpg` | Home & Assets: the new "Finished, not yet saved" list with a button on each |
| `10-desktop-assets-one-at-a-time-form.jpg` | "Task 1 of 2" in the existing Save-to-history form |
| `11-phone-done-offer.jpg` | 375 px: the message wraps, buttons on their own line |
| `12-phone-log-visit-dialog.jpg` | 375 px: the dialog |
| `13-phone-services-select.jpg` | 375 px: two selected visits and the one-at-a-time button |
| `14-phone-assets-unsaved.jpg` | 375 px: the new list with ticks |

Findings from my own first look, fixed before this report: the dialog briefly said "Done, log it" (which suggests it will finish the task) until its preview loaded (it now says "Log this visit" from the start); on a phone the message squeezed its words into a narrow column (now wraps); three finished visits of one service were indistinguishable in the list and in the tick boxes' names (each now shows the day it was scheduled for; the Home & Assets rows show the day it was finished).

Honest limits: not tried on a real phone or with a screen reader; the Today screenshot was verified in the page's own markup (the message text was read back: "Done: ... Log completed visit Undo") rather than kept as an image, because the message had timed out before the first capture.

---

## F. Verification

**Targeted tests (`src/modules/followUp.test.tsx`, 29 tests, all passing):** the offer for a finished visit Task and a finished maintenance Task; no offer for an ordinary Task, a Task linked only to something else (and no module is even called), a still-open Task, a booking reminder, a deleted arrangement, Task, or asset, an archived asset, and work already logged or saved (with a pointer to the existing entry); finishing writes no visit, history entry or transaction; the recurring-visit case (finished occurrence kept, one open next visit, no duplicate, next Task not offered); the dialog's plan is "finished elsewhere", with the scheduled and finished days; cancelling and previewing change nothing; Undo and reopen keep the record and give no second offer; two simultaneous saves give one visit; the shared "Done" message (unchanged for an ordinary Task, one button for an eligible one that only opens when pressed, a failing reader never breaks it, bulk wording); the one-at-a-time rules; and the wording and structure of both overview lists (tick boxes only with several items, no "save all" or "dismiss"). One assertion was added to `lazyBoundary.test.ts`. **No existing test was edited or loosened.** (One existing guard, `d14Assets.test.tsx` "writes nothing while rendering", caught a `Set.add` in my first selection code; I rewrote the code to use arrays rather than change the guard.)

**Existing suites run after each change:** Tasks, Household Services (visits, undo-guard), Home & Assets, core, ui, then the whole suite.

**Full suite (final):** see the number in the handoff and backlog entries: **297 files, 5,866 tests, all passing** (baseline at the start: 296 files, 5,835 tests; +1 file, +30 tests).

**TypeScript (`npx tsc --noEmit`):** clean. **Production build (`npm run build`):** clean (the existing "chunks over 500 kB" notice is unchanged).

**First download** (the entry file plus every file the start page loads, measured the same way as in R1.2 against a scratch build of `3f5f529`): **1,183.4 kB raw / 379.5 kB gzip before, 1,187.7 kB / 382.0 kB after: +4.3 kB raw, +2.5 kB gzip.** The readers and dialogs are separate files fetched on demand. Not measured: load time on a phone.

**Browser checks (demo household, built-in browser, no console errors):** complete the House cleaning visit in Tasks, press **Log completed visit**, save: one visit recorded for exactly that Task and the date it was scheduled, one open next visit (not duplicated), no money record. Complete the furnace-filter task: **Log maintenance** opens the form, **Cancel**: the task stays done, a next one exists, no history entry was created. Complete an ordinary task in Today and Tasks: no extra button. Complete a visit task from Today and from the Calendar: the button appears; Undo in the Calendar reopened the Task, removed the untouched copy and left the logged visits alone. Household Services: tick two of three finished visits, **Skip** the first, **Log** the second: one saved, the other still listed. Home & Assets: tick two, **Save** the first, **Cancel** the second: one history entry (cost "not recorded"), the other still listed, the list count dropped from 2 to 1. Phone (375 px): the message, the dialog and both lists. Not exercised in the browser: the offline "could not open that just now" message (the code path is small and has no test).

---

## G. Judgment calls (please review)

1. **The dialog opens in place** through one app-wide host, instead of sending you to the arrangement or asset page. This avoids "unrelated navigation" and a lost place on Today, at the cost of one small new shell component. The alternative was a link to the page with the dialog preopened (as `fromVisit` does).
2. **One extra button in the existing "Done" message**, not a banner or a blocking dialog; the message stays longer (12 s) only when it carries the button.
3. **When the Task is linked to several eligible assets** (superseded by the review, see the final rule below): the first version used the lowest-numbered one, which could file the work under the wrong asset. It now offers nothing and leaves the manual per-asset save. **Final multi-asset rule (ChatGPT review, 2026-11-16):** when a finished Task is linked to more than one eligible (live, un-archived) asset, nothing in the Task says which one the work was done on, so Ledger does NOT choose by database order: no "Log maintenance" button is offered, and the existing manual "Save to history" on the asset's own page stays available (the one-history-entry-per-Task rule is unchanged). With exactly one eligible asset (an archived or deleted one does not count) the contextual flow is unchanged. On the Home & Assets overview a task linked to several assets shows links to those assets instead of a button and has no tick box. No new selection screen was added; Household Services is untouched. R1.3 is the last R1 phase; no further R1 refinement is planned; the next phase is R2.1 Money Intake / Import v2 (not started).
4. **Only "Log completed visit" is offered**, not "skipped" or "cancelled". Those two outcomes stay on the arrangement page and in the overview's own list. If you want "It was skipped" next to the new button, say so.
5. **A Task finished by choosing status Done in the editor and saving** also gets the offer (it is the same kind of "finished"). Editing other fields does not.
6. **Bulk is a walk, not a batch** (section D). No "log all", no "dismiss". A decision for you: whether Ledger should ever have a stored "reviewed, nothing to log" mark. It would need a new field and sync coverage, so it is left for a deliberate phase.
7. **Home & Assets overview:** the three-line "Save X to history" links inside the Needs attention card were replaced by the full "Finished, not yet saved" card (up to 25 shown, then "N more on their asset pages"). The counts in the band and in Needs attention are unchanged. A finished task's day is read from the Task for display only.
8. **The scheduled day shown in lists and dialogs is the Task's own due date.** The stored occurrence marker can be stale on a copy that Tasks made while earlier visits were still unlogged (the existing "looks like a copy" warning); I left that existing behavior alone.
9. **The toast gained an optional third argument** (an action button). Every existing call is unchanged.
10. **Dialog wording changed in one place:** the note in "Log this visit" for a task finished elsewhere now reads "...finished in Tasks, Today or the Calendar (it was scheduled for ...). Check the date the visit really happened. Finishing a task is not proof the visit took place, so nothing is logged until you press the button."
11. **First-download cost:** +4.3 kB raw / +2.5 kB gzip (the neutral layer, the host and the toast button).

**Not built (by design):** R2 intake, R3 question answering, notifications, AI, a stored "dismissed" state, new recurrence or maintenance models, payment automation, any financial record, a Task-engine change, any redesign of Today, Tasks, the Calendar or the household overviews, an offer on Needs you or This Week rows, an offer when a Task is finished on another device.

**Known limits:** not real-device or screen-reader tested; when two finished tasks of one service are logged out of order, the existing re-alignment behavior of the arrangement applies (unchanged); the offline message path is untested.

---

## H. Release recommendation

**Ready for owner and ChatGPT review.** Nothing was committed, staged, pushed or deployed. If approved, suggested commit message: `feat(tasks): offer to log finished visits and maintenance (R1.3 finish the loop)`; after the push, check the Actions tab for a green run. Real-device and screen-reader acceptance remain separate.

**Handoff updated:** yes (`docs/CHATGPT-HANDOFF.md`: top notice, current phase, historical overview, status line, change log; `docs/BACKLOG.md`: status entry), plus `README.md` and `docs/module-hooks.md`. **Git baseline at the start:** `main` = `origin/main` = `3f5f529`; Actions run #119 success.
