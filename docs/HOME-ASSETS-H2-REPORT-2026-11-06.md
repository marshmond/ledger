# Home & Assets H2 report: maintenance and service history

Date: 2026-11-06. Built to the H2 brief on the plan in `docs/HOME-ASSETS-H0-PLAN-2026-11-05.md` (Revision 2, sections 5, 8 and 10).
Status at time of writing: **built, tested, NOT committed, NOT pushed.** H3 to H5 are not started. Invented data only.

## 1. Executive summary

An asset page now answers: what maintenance it needs, when it is next due, when it was last serviced, what was done, by whom, for how
much, and what has built up over its life. Maintenance plans are ordinary Tasks (no second task or repeat engine). History is a new
durable `service` record kind that lives in the existing shared records table. "Done, log it" completes the task and saves the record in
**one database transaction**. A task finished anywhere else shows on the asset as "Completed task — not yet saved to service history",
with a one-click Save to history. Service records appear in Search, the Add box (`svc`) and shared links. Permanent deletion is blocked by
live service history, on this device and across devices.

| Check | Result |
|---|---|
| Tests | **1,460 pass** (94 files). Was 1,407; 53 new (46 in `service.test.ts`, 7 two-device sync tests in `service-sync.test.ts`) |
| Type check (`npx tsc --noEmit`) | Clean |
| Production build (`npm run build`) | Succeeds (the existing "chunk larger than 500 kB" notice is unchanged) |
| Schema, backup format, sync format, dependencies | **No change** (Dexie stays 15; `package.json` untouched) |
| Tasks, Calendar, Projects, Finance, Contacts, core code | **No file edited** |
| Browser (desktop, 375 px, dark, invented data) | Main flows checked (section 11) |

## 2. Prerequisite and deployment gate

1. H1 commit `bf2d3d5` is the local `HEAD` and equals `origin/main` (fetched).
2. GitHub Actions "Deploy to GitHub Pages" for `bf2d3d5`: status completed, conclusion **success** (read from the public Actions API; the `gh` tool is not installed here, so I could not use it).
3. Working tree was clean at the start.
4. Baseline before any change: 1,407 tests passing (92 files).
5. Read: `CLAUDE.md`, H0 plan, H1 brief and report. Inspected: Tasks `data.ts`, `recur.ts`, `model.ts`, `views.ts`, the Task editor; `core/contacts.ts`; the Assets repository, records hook, search source, Add box definition, deletion plan; `lib/sync/assetDeletion.ts`; the Add box shell and registry.
6. **The H0 interfaces matched the code.** One finding mattered: `completeTask` already opens its own transaction over `moduleRecords` and `links`. Dexie lets that join an enclosing transaction over a superset of those tables, so atomic Done-and-log needed **no change to Tasks** and no cross-module redesign (stop condition not triggered).

## 3. What was built (against the brief)

| Brief item | Status |
|---|---|
| 1 View linked maintenance tasks | Done: Maintenance card lists open linked tasks with due date, repeat wording, Overdue (Tasks' own rule) and a link to the normal Task editor |
| 2 Create recurring maintenance tasks | Done: Add maintenance creates an ordinary Task with the asset already linked, using the shared repeat control (fixed schedule or after completion) |
| 3 Optional suggestions | Done: six editable starting points, labelled generic and unverified; nothing is created until Add is pressed |
| 4 Complete and record | Done: "Done, log it" (section 6) |
| 5 Durable service-record model | Done (section 5) |
| 6 Log repairs, inspections, other work | Done: Log service, with or without a task |
| 7 Timeline | Done: newest first; date, work, kind, provider, cost, source task; notes and documents on expansion; Edit |
| 8 Completed tasks not saved | Done: derived rows, Save to history, Needs attention count |
| 9 Contacts for providers | Done: pick from shared Contacts or add one through `findOrCreateContact` |
| 10 Search, Add box, shared records | Done (section 8) |
| 11 Deletion safeguards | Done (section 9) |
| 12 Verification | Automated and browser (sections 10 and 11) |

## 4. Files created and modified

New in `src/modules/assets/`: `service.ts` (model, reader, validation), `serviceData.ts` (repository, atomic log), `maintenance.ts` (pure: last serviced,
next due, history, suggestions), `serviceQuickAdd.ts`, `ServiceForm.tsx`, `AddMaintenance.tsx`, `AssetWork.tsx` (Maintenance and Service history cards),
`service.test.ts`, `service-sync.test.ts`; and this report.
Modified: `AssetPage.tsx` (adds `AssetWork`), `LinkedWork.tsx` (now events only; linked tasks moved into the new cards), `records.ts` and `searchSource.ts`
(service records), `index.tsx` (second Add box destination), `deletion.ts` (comment only), `assets.css`, `README.md`, `docs/BACKLOG.md`, `docs/module-hooks.md`.
Not edited: `db.ts`, `types.ts`, backup files, `src/lib/sync/*` (the H1 rule already covers `service`), Tasks, Calendar, Projects, Finance, Contacts, core.

## 5. Service data model and validation

`module: 'assets'`, `kind: 'service'`, written only through `repo` (id, timestamps, soft delete). Fields: `assetId`, `date` (`YYYY-MM-DD`), `kind`
(maintenance, repair, inspection, improvement, replacement, other), `title`, `notes`, `providerContactId`, `costCents`, `taskId`, `taskTitleSnapshot`,
`projectId` (read and kept; no screen sets it until H3), `refs` (label, optional http/https link, note). Unknown fields (such as H3's `txnRefs`) pass through
every read and write. `asService` never throws on junk.

- **Unknown cost is not zero.** `costCents: null` means not recorded; a blank box saves `null`; typing `0` saves 0. Negative, non-numeric or absurd costs are refused. Stored as whole cents.
- Title 1 to 160 characters; real calendar date; **not in the future**; kind from the fixed list; notes up to 5,000; at most 20 documents; links `http:`/`https:` only (`javascript:`, `data:`, `file:`, `ftp:` refused).
- Writes re-check inside the same transaction: the asset must be live and not archived, a chosen provider must exist (an unchanged provider that was later removed is not an error when editing), and a task can have only one record.
- Editing cannot change the asset, the originating task or the title snapshot.
- Delete is a soft delete with Undo. Restoring refuses if the same task was saved again meanwhile (so Undo cannot make two records).

## 6. Task completion and recurrence integration

`logTaskService` (`serviceData.ts`) runs one transaction over `moduleRecords`, `links` and `contacts`: re-read the task (refuse if gone, not linked to this asset, or already
done); refuse if a record for this task exists; call Tasks' own `completeTask`; write the record. Any failure rolls everything back. Tested by injecting a real database failure:
service write fails, so the task stays open, no next task, no record; completion fails, so no record.
- Completing a repeating task makes the next one **once**, linked to the same asset, `todo`, with `recurFrom` set; the completed one stays for reference. Three simultaneous submissions give one record and one next task.
- Reopen keeps the record; a reopened task cannot be saved to history ("not completed any more"); the record also survives task rename, reschedule and deletion (the title snapshot keeps it readable).
- No Tasks-to-Assets hook exists. Tasks screens do not import the Assets module.
- The form states what will happen first ("It repeats, so the next one is made, due Sat, Feb 6, 2027"), using Tasks' own `nextDueDate`.

## 7. Durable history and de-duplication

Unsaved = a done linked task with no live service record carrying its id. The timeline shows each task once; saving makes the unsaved row disappear. Save to history re-checks inside its
transaction. Each cycle of a repeating task is its own entry. Archiving, retiring or editing an asset does not touch its records (tested byte for byte). A removed Contact shows "(contact removed)".

## 8. Contacts, Search, Add box, shared records

- **Contacts:** `findOrCreateContact` (no vendor table); the provider is not copied into recurring tasks.
- **Search:** service title and notes (and the kind word); one result per record, shown with date, kind and the asset's public label; notes, cost, provider and sensitive asset fields are never shown. Assets and records are each loaded once per search. Opens the asset page with the record expanded and highlighted (`#/assets/<id>?service=<id>`); a missing record gives a notice, not a crash.
- **Add box:** destination `svc` (aliases `service`, `repair`). Grammar: `Replaced pump on Dishwasher $180 yesterday`. The words after the last " on " must be one exact asset name (case, accents, spaces ignored), optionally followed by one amount and one date (today, yesterday, `2026-11-05`) in either order. It never guesses: unknown, duplicate or archived names, a second amount, a future date or a missing description show the reason in the preview and **Add refuses**. Cost is only set when typed; date defaults to today and is shown. Undo removes only the new record and keeps it if anything is linked to it.
- **Shared records:** `service:<n>` in the existing records hook (search shows them only when something is typed); `describe` returns null when missing.

## 9. Asset deletion and sync protections

`planAssetDeletion` already counted live records of kinds in `ASSET_DEPENDENT_KINDS` with `assetId`, so live service records block permanent deletion (plain-words reason; tested; failed deletion leaves every record and link byte-identical). `src/lib/sync/assetDeletion.ts` already keeps a flagged asset alive when a live dependent record points at it, so **no sync code changed** and Projects' rules are untouched.
Real `SyncEngine` and `mergeSnapshots` tests, two devices (seven): records sync independently with edits and deletions; a record made on a stale device keeps an asset that another device deleted permanently (record made before or after the deletion); with no history the H1 deletion still holds; a task deleted elsewhere leaves the record and snapshot readable; two devices saving the same completed task offline keep both records; a refused deletion changes nothing after sync.
**Mutation check:** with `service` removed from `ASSET_DEPENDENT_KINDS`, five tests fail (two local deletion tests and sync tests b, c, g); restored, all pass.

## 10. Automated test results

53 new tests plus the full existing suite (1,460 pass; H1, Projects P1 to P5, Tasks, Calendar, backup and sync tests unchanged and green). Coverage follows the brief's list: creation, validation, edit, delete, unknown fields, completed-task recognition, snapshots, no duplicate rows, atomic Done-and-log, both rollbacks, recurrence and link propagation, repeated and simultaneous submission, reopen, delete, Contact removal, manual service, no future dates, Needs attention, search uniqueness and masking, Add box matching, preview, commit and Undo, registration clash, deletion blocked, sync, backup export and restore, and a Finance and Projects invariant (accounts, transactions, categories, assignments, scheduled items, goals and project records are identical before and after logging services with costs).

## 11. Browser verification (desktop pane, an empty throw-away database on its own port, so no real data was touched)

Checked and working: Add maintenance with a suggestion and a repeat (appears under Maintenance and in Tasks once); the task on the Calendar once; Done, log it with a new Contact, cost and notes (record saved, next task once, history row); completing a linked task in Tasks, the "not yet saved" row and Needs attention 1, then Save to history (row replaced, attention nothing); `svc` preview and add, and the refusal for an unknown asset; Log service for an unscheduled repair with a Contact and cost 0 (shows $0.00); expanding, editing and saving a record; global search and the deep link from another page (opens, expands, highlights); a missing-record link notice; delete blocked by two service records; Archive disables Add maintenance, Log service and Done, log it, and Restore re-enables them; 375 px (no sideways scroll, buttons at least 44 px) and dark theme on the page and the Done, log it dialog; Escape cancels without changing the task; a fresh page load with an error listener while opening forms recorded no errors.
**Defects found and fixed during these checks:** the Add box refusal read "Will add: Cannot add yet…" with a double full stop; "after completion" repeats read "on day 10"; history rows were centred and detail facts squeezed into one column.
**NOT browser-verified:** keyboard-only navigation (only Enter and Escape tried), screen reader, the Task editor's Link a record box listing service records, document rows in the form, the delete-record Undo toast, the Event editor, Reopen from the Tasks screen followed by the asset page, two real devices, real-device phone use. The browser console buffer still shows hot-reload entries from my own mid-edit saves (a briefly missing import and "Module today is registered twice", as noted in H1); a fresh load is clean.

## 12. Financial and Projects regression

The typed cost is informational. No Finance transaction, balance, budget, report, Project commitment or Contact is written (tested). No asset-level spending, no new dashboard. `projectId` is only preserved. Projects P1 to P5 tests pass unchanged.

## 13. Backup and compatibility

Dexie stays 15. Service records are `moduleRecords`, so export and restore already carry them (tested, every field). A backup made before H2 restores with none. Devices must run H2 to see service history; an H1 device would carry the records without showing them. The H1 deletion rule must be on every device.

## 14. Judgment calls and deviations from H0 (please review)

1. **Archived assets refuse new history** (restore first); **retired (sold, replaced) assets still accept it**, since the work may predate the sale.
2. **The repeat is counted from the service date** the owner enters, not from the day they press the button, when using Done, log it (still `completeTask`). Late logging therefore gives an earlier next date. H0 said "today"; the date box defaults to today.
3. **Add maintenance requires a first due date** so the task shows in Tasks and the Calendar.
4. **Suggestion titles start with the asset name** ("Furnace: replace filter"), as in H0. Intervals (3 months, yearly, monthly) are **UNVERIFIED** generic starting points, labelled so.
5. **Every open linked task is shown as Maintenance** (there is no maintenance flag). Linked completed tasks moved from a collapsed count into Service history; `LinkedWork` now lists events only.
6. **An improvement does not count toward "Last serviced"**; everything else does. A service record beats a completed task on the same day.
7. **Add box:** kind defaults to Other (the shell does not pass the alias typed). A first work word equal to a shortcut word (for example "Repair ...") is removed by the Add box's own routing. It needs " on " and an exact name.
8. **Save to history refuses** when the task was reopened or deleted, instead of saving a record with no task.
9. **A provider is prefilled only when the task has exactly one person**; nothing else is guessed. Done, log it also prefills the task's notes.
10. **Records can be deleted** (soft, with Undo). A record made from a task then reappears as "not yet saved".
11. **Two devices offline can each save the same task**, giving two records. Both are kept (nothing lost); the check is local, as with every other record.
12. **Service records are offered in "Link a record" only when something is typed**, so the short default list stays assets.
13. The edit form cannot move a record to another asset or change its task link.

## 15. Known limitations and unverified scenarios

- Old completed linked tasks (from before H2) all show as "not yet saved", so an old asset may show a large Needs attention count. There is no "dismiss" or bulk save.
- No document uploads, mileage, warranty list or replacement flow (H4), no Calendar layer, no Today card (H5).
- Real two-device sync, offline use, and an older build syncing have still never been tested on real devices.
- Search ranks service hits just below assets; no per-asset filter.
- Keyboard-only and screen-reader use are not verified.

## 16. Git working-tree status

On `main` at `bf2d3d5`; nothing committed. Modified: `README.md`, `docs/BACKLOG.md`, `docs/module-hooks.md`, `src/modules/assets/{AssetPage.tsx, LinkedWork.tsx, assets.css, deletion.ts, index.tsx, records.ts, searchSource.ts}`.
New: nine files in `src/modules/assets/` (listed in section 4) and this report.

## 17. Commit-readiness recommendation

Ready for owner and ChatGPT review. Suggested order: review judgment calls 2, 7 and 8 and limitation 1; then, if wanted, run the "NOT verified" checks on the real phone after deployment; then commit locally, and push only when ready (a push deploys; check the Actions tab for a green run). H3 should not begin until this is approved.

---

# FINAL FOLLOW-UP (after architectural review): duplicate history and historical dates

Status: built and tested, NOT committed, NOT pushed. This section supersedes judgment call 2 and limitation "two devices can each save the same task" above.

## F1. Duplicate service history for one task

**Change.** `duplicateTaskGroups` (`maintenance.ts`) finds groups of two or more LIVE service records with the same non-empty originating `taskId`. Only the task id counts: records with the same title or date but no shared task are never grouped (tested). On the asset page the Service history card shows a warning for each group ("2 records were saved for the same task ..."), listing every record with its date, work, provider, cost and when it was saved, each with an **Open** button into the normal editor, whose existing **Delete…** (with Undo) removes an erroneous one. Rows in the group also carry a "Possible duplicate" chip. Nothing is merged, dropped or overwritten, automatically or otherwise. No schema, format or sync change.
**Related fix found in browser testing.** The earlier restore guard refused Undo of a duplicate's deletion (it blocked restoring a record when another live one shared its task). It is removed: Undo always works, and a restored duplicate simply brings the warning back.
**Summaries.** Last serviced is a date, so duplicates do not double it; Needs attention counts unsaved tasks, so a task with two records is not unsaved. Asset deletion stays blocked while any live service record exists (tested with duplicates present).
**Tests (real SyncEngine, two devices):** f, both records survive and are detected on both devices, last serviced and attention stay clear, deletion stays blocked; f2, deleting one on a device clears the warning on both, leaving the other record and the task untouched; f3, separate jobs with identical title and date are not flagged. Unit test: restoring beside a newer record for the same task gives two and the warning group.
**Remaining limit.** A duplicate can only be noticed after the devices sync; a person must choose which to delete. The check cannot tell a true duplicate from two deliberate records for one task, which is why it only warns.

## F2. Historical service dates and recurring tasks (exact semantics)

The repeat basis passed to Tasks' unchanged `completeTask` is now `completionBasis` (`maintenance.ts`):
- **Repeat after completion:** the entered service date (if not in the future). Logged on the day it was done, this is identical to pressing Done in Tasks (tested against `completeTask` directly). Logged later, the next task counts from the real service date.
- **Fixed schedule, or no repeat:** **today**, exactly as pressing Done in Tasks, so an old service date can never pull the schedule backwards. (This reverses the earlier "service date for everything" choice, which would have given a fixed task a next date in the past.) Tested: identical next due to `completeTask` for a service dated two days after the due date a year and a half ago.
- Exactly **one** next task is made in every case (tested); never a run of missed ones. After-completion with an old date can make a next task already past due; the confirmation line says so ("due Sat, Aug 1, 2026, which is already past, so it will show as overdue").
- Three dates stay separate: the completed task keeps its own due date and `completedAt` (the moment the button was pressed); the service record keeps the date typed; the next task's due date is computed from the basis above. Ordinary Tasks outside Home & Assets are untouched (`completeTask` and `recur.ts` are not edited).
**Limitation.** For repeat-after-completion the history can produce an immediately overdue next task by design. The service date cannot be in the future.

## F3. Results

- **Tests: 1,464 pass** (94 files; was 1,460): the full suite, including all H1, Projects, Tasks, Calendar, backup and sync tests unchanged.
- `npx tsc --noEmit` clean. `npm run build` succeeds. Dexie still 15; no change to schema, financial code, transactions or Projects sync rules.
- **Browser (invented data, dev server on a separate test origin; one pane origin that already held data was deliberately not touched):** normal Done, log it (re-run after the change: unaffected); a deliberately historical date (May 1, 2026, repeat after completion): confirmation line correct, exactly one next task due Aug 1 shown Overdue; duplicate warning with an injected second record for one task, at 375 px in dark theme (no sideways scroll); Open, Delete and Undo of the duplicate (warning clears, then returns); the raw injection used only the test database.
- **Not browser-verified:** the duplicate warning on desktop in dark theme specifically (checked at phone width in dark, desktop in light earlier), real two-device sync, keyboard-only use.

## F4. Files changed in this follow-up

`maintenance.ts` (`duplicateTaskGroups`, `completionBasis`), `serviceData.ts` (basis; restore guard removed), `ServiceForm.tsx` (confirmation line), `AssetWork.tsx` (warning and chip), `assets.css`, `service.test.ts`, `service-sync.test.ts`, this report, `docs/BACKLOG.md`.

## F5. Git status

`main` at `bf2d3d5`; nothing committed. Modified: `README.md`, `docs/BACKLOG.md`, `docs/module-hooks.md`, `src/modules/assets/{AssetPage.tsx, LinkedWork.tsx, assets.css, deletion.ts, index.tsx, records.ts, searchSource.ts}`. New: nine files in `src/modules/assets/` plus this report.
