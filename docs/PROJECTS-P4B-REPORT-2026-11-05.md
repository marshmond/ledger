# Projects P4B (integration, usability and safe deletion): implementation report

Date: 2026-11-05. Built on P4A (`1c478e0`). Contains no personal or financial data; all test and browser data was invented. **Nothing is committed, pushed or deployed.**

## 1. Executive summary

All six workstreams are built and verified. Permanent project deletion is **safe within the existing architecture** (no new table, no schema or sync change), so that workstream was not stopped.

| | |
|---|---|
| Deployment gate | `HEAD` and `origin/main` are both `1c478e0`; the GitHub Pages run for `1c478e0` concluded `success` (read from GitHub's public API); working tree was clean; the baseline suite passed (see 6 for one load-related flake). |
| Tests | 89 files, **1,340 tests pass** (was 1,300; 40 new: 21 in `p4b.test.ts`, 19 in `p4b-integration.test.ts`). Every pre-existing test passes **unchanged**, including all P4A and P3 tests. |
| TypeScript / build | `tsc --noEmit` clean; production build succeeds. |
| Schema / backup / sync format | **No change.** Schema still 15; `db.ts`, `backup.ts`, `backupFile.ts`, `sync/*` untouched. |
| Financial calculations | **No change** to any Finance or Projects calculation. The Reports engine gained one optional switch that is off by default (section 4). |

What the owner can now do: delete a project for good (with blocking, unlinking and a typed-name confirmation); type `+project` in the Add box or Tasks bar; move or take off many tasks at once with a preview and Undo; see task and milestone progress on the Projects list; see the project on search results; and filter Reports to one project.

## 2. Exact files

**Created:** `src/modules/projects/deletion.ts`, `src/modules/projects/DeleteProject.tsx`, `src/modules/projects/p4b.test.ts`, `src/modules/projects/p4b-integration.test.ts`, this report.

**Modified:**
- Deletion: `src/modules/projects/ProjectPage.tsx` (third button, dialog).
- Quick Add: `src/modules/tasks/quickAdd.ts` (parser), `quickAddDef.ts` (Add box), `QuickTask.tsx` (Tasks bar), `src/shell/AddBox.tsx` (placeholder hint only).
- Bulk assignment: `src/modules/tasks/data.ts`, `TasksPage.tsx`.
- Projects list: `src/modules/projects/work.ts` (`progressChips`), `ProjectsPage.tsx`, `projects.css`.
- Search: `src/modules/tasks/searchSource.ts`, `src/modules/calendar/searchSource.ts`.
- Reports: `src/lib/txnProject.ts` (`projectOnlyTxns`), `src/lib/reports.ts` (optional `net`), `src/pages/ReportsPage.tsx`.
- `docs/BACKLOG.md`.

## 3. Features by workstream

### WS1: Safe permanent project deletion
- **Three actions** on the project page: Archive, Restore (unchanged) and **Delete permanently…** (new, last).
- **Dependency scan** (`planProjectDeletion`) read from the code, not assumed. Found and handled: whole-transaction tags, split-part tags, commitments and change orders, budget lines, tasks and milestones, Calendar events (including a replaced copy of a repeating series), shared `links` rows pointing at the project, and the vendor list (a field inside the project record, so nothing separate). **Checked and found not to exist:** project references on scheduled/recurring payment definitions (only the transactions they create can carry a tag, and those are covered).
- **Blocks** (never overridden, nothing changed): any live commitment/change order, any transaction whole-tagged to the project, any split transaction with a part tagged to it. The dialog names each cause in plain words with a link to the tagged transactions in Finance and to the commitments, and offers Archive instead.
- **Unlinks, never deletes:** tasks (taken off the project), milestones (become ordinary tasks, the existing P3 rule, via `setTaskProject`), Calendar events including repeating ones (via `setEventProject`; recurrence, skipped dates, overrides and every other field untouched). Shared links that point at the project are removed (a link to nothing is worthless); the linked task or record is untouched.
- **Deletes:** the project's budget lines and the project record. Soft delete (`deletedAt` tombstone, the same as every delete in the app), so it syncs and does not reappear.
- **Atomic:** one database transaction over `moduleRecords`, `links` and `txns`. If anything throws, nothing changes (tested by forcing the last write to fail).
- **Confirmation:** names the project, says what will be deleted, what will be kept (with counts), that no transaction/account/payment is touched, and that old backup files still contain it. A project with lines or attached work needs its name typed; an empty one needs one click.
- **Conflict policy: SUPERSEDED, see section 14.** The first version of this report said an edit made on another device after the deletion would bring the project back without its lines. That was inconsistent with "permanent" and was fixed in the final follow-up: the deletion now wins over any copy edited on another device (before or after), its budget lines follow it, and only money that still points at the project, or an intentional backup restore, keeps it alive.
- **Not promised:** erasure from earlier backup files or Git history (the dialog says so).

### WS2: Project-aware Quick Add
- Shorthand `+word` in the **existing parser** (`parseQuickAdd`), so the Add box and the Tasks bar both get it with the same preview, commit and Undo; no second task-creation path. `+kitchen`, or `+test-kitchen` for "Test Kitchen".
- Match rule: whole name, letters and digits only, case and punctuation ignored. **No prefix or fuzzy matching** ("kitchen" never picks "Kitchen Remodel"). Two projects with the same normalised name are refused as ambiguous. Archived, completed, cancelled or missing projects are not used: the preview says so ("P4B Old Fence is archived, so the task was not put on it") and the word stays in the title, nothing is lost.
- Eligibility reuses `selectableProjects` (the same rule the Task editor uses). It is **checked again at commit**: if the project was closed or deleted in between, nothing is added and the Add box says why.
- Without a project list, or without a `+word`, parsing is identical to before (tested).

### WS3: Bulk project assignment (Tasks)
- New "Project…" menu in the selection bar: any open project, plus "No project (take off)" last. Archived and finished projects are not offered.
- `planTaskProject` says how many are added, replaced (and from which projects), already there, missing, and how many milestones would become ordinary. If any task replaces another project, a confirmation states exactly that first.
- `assignTasksToProject` is **all or nothing**: a closed or missing project, or any selected task that no longer exists, changes nothing and says why. Only the project (and the milestone flag when leaving a project) changes; dates, completion, repeats, lists, tags, priority and unknown fields are untouched. A milestone moved to another project stays a milestone.
- Undo (`restoreTaskData`) puts every changed task back exactly, atomically. Written in Tasks' own data layer (Tasks owns task records).

### WS4: Projects list progress
Compact chips per project: `Tasks 3/8`, `Milestones 1/2`, and `N overdue` (only for live work: not archived, cancelled or completed). A project with nothing says "No tasks yet" (no 0%). Uses `summarizeWork`, the same function the project page uses, so the counts always agree; milestones counted apart from tasks; other projects' tasks excluded.

### WS5: Search
Task and event results show `Project: <name>`, with "(archived)", "(cancelled)" or "(project removed)" when that is the truth; milestones get a "Milestone" badge. One batched project lookup per search (no query per result). Result ids and paths unchanged, so navigation and uniqueness are unchanged (tested). Tasks and events with no project have exactly their old lines.

### WS6: Project filter in Reports
- **Evaluated.** The **Trends** tab (monthly spending, category table, jumps, top payees) can safely be filtered because it is built from the transaction list. **Not filtered, by design:** the Flow diagram tab (income to categories flow; a single project has no income) and anything income-based, which is hidden while a project is chosen (income tile, savings rate, income line, income/saved/rate columns). The tab says so on screen.
- **How:** `projectOnlyTxns` (Finance layer) reduces the transactions to the project's own pieces using the same tag rule as the project page (a split's own tag wins over the transaction's): each transaction at most once, a split transaction keeps only its matching parts, transfers and setup entries never included. The same engine then runs on that list.
- **Credits and reversals:** with a project chosen the engine runs with `net: true`, so money coming back lowers spending whatever its category (otherwise an uncategorised refund would be read as income) and months are not held at zero; the months therefore add up to the project's "paid". Tested equal to `loadProjectSummary(...).paidCents`.
- **Unfiltered behaviour is exactly as before:** `net` is optional and off by default; tests compare the unfiltered matrix and top payees with and without project tags and with an empty options object.
- The active filter is a visible chip with "remove". An archived project is selectable (labelled); a removed project shows "(project removed)" and an empty report.

## 4. Architecture decisions and deviations
1. **Deletion lives in the Projects module** and changes other modules' records only through their own commands (`setTaskProject`, `setEventProject`). Shared links are removed through the shared `links` repo. No direct writes to Tasks or Calendar tables.
2. **Bulk assignment is in `tasks/data.ts`, not the Projects module**, because Tasks owns task records. It validates the target through `core/projectLink` (the shared reader Tasks already uses), so Tasks still does not import the Projects module.
3. **Quick Add uses `+`** because `!`, `#`, `@` were taken. Deviation from a "picker" idea: the Add box has no new control; the shorthand is shown in the Add box placeholder and the task shorthand hint, and the preview confirms the project or explains why not.
4. **Reports got one optional parameter** (`net`) on two existing functions rather than a second engine. This is the only change to code outside Projects that touches calculations; its default path is unchanged and tested.
5. **A keyboard quirk found and mitigated:** in a native menu that applies on change (as the existing bulk priority/list/tag menus do), arrow keys fire a change per press. For the new Project menu "No project (take off)" is therefore the **last** option and always asks for confirmation when it would change something.
6. **Calendar project filter: evaluated, not built.** The Projects calendar layer already shows start/target dates and project events appear in their calendar; a dedicated filter would be convenient but is not needed to meet the Projects scope, and building it would touch Calendar view code. Recommended as an optional small follow-up.

## 5. Deletion dependency rules and sync behaviour (summary)
| Dependency | Effect on deletion |
|---|---|
| Live commitment or change order | **Blocks** |
| Transaction whole-tagged to the project | **Blocks** |
| Split transaction with a part tagged | **Blocks** |
| Tasks / milestones | Unlinked, kept (milestone becomes an ordinary task) |
| Calendar events, repeating ones too | Unlinked, kept (all other fields untouched) |
| Shared links to the project | Removed (the other end is untouched) |
| Budget lines, the project record | Deleted (soft, tombstoned) |
| Vendors on the project | A list inside the record: goes with it; the contacts themselves are shared and untouched |
Sync: see section 14 for the final rule (deletion wins over stale copies, narrowly, for permanently deleted projects only). Tested with the real sync engine: deletion, its budget lines and the unlinked tasks reach the other device and the project does not return, whichever device edited or synced first.

## 6. Automated test results
1,340 pass (final follow-up: see section 14). New coverage: deleting an empty project; deleting one with budget lines and leaving another project's lines, transactions and balances untouched; refusing with a whole tag and with a split tag (changes nothing, tag never removed); refusing with commitments and change orders; unlinking tasks (fields, unknown fields, repeat kept), milestones becoming ordinary, recurring and plain events; shared links; stale references; a forced mid-way failure leaving every record byte-identical; no milestone on a deleted project; backup/export and restore (deleted stays deleted, an old backup still brings it back); two-device deletion propagation and three concurrent edit/delete orderings; Quick Add (match, no fuzzy match, ambiguity, archived/completed/cancelled, unchanged without projects, commit, Undo, closed meanwhile); bulk assignment (add, move, remove, fields preserved, milestones, all-or-nothing, Undo exactness); list progress; search labels and uniqueness; Reports (split pieces counted once, month totals equal project paid, refunds, transfers, unfiltered unchanged, stale project).
**One note:** in the very first full run (baseline, before any change) `src/shell/csp.test.ts` failed once with a 5-second timeout while the machine was busy; it passed alone and in every later full run. Treated as load-related flakiness, not a defect, but worth knowing.

## 7. Browser verification (desktop, 375 px, dark theme, invented data)
Done: blocked deletion dialog (named all three causes, links, no delete button); deletable dialog (counts, wording, delete disabled until the name is typed); actual deletion (navigated back to the list, project tombstoned, five tasks kept and unlinked, milestone now ordinary, transaction count unchanged); Add box `+project-name` preview ("Project P4B Garden Shed"), Add (task created on the project, Undo toast shown), archived-project and unknown-word previews; Tasks bulk bar: add (no confirmation), move (confirmation text correct), Undo restored both tasks exactly, archived projects absent from the menu; Projects list chips; global search labels and Milestone badge; Reports filter chip, $290.00 matching the project page's paid; 375 px dark for the list, the delete dialog, the bulk bar and the Reports filter with no horizontal overflow.
**Not done or not exact:** the Add-box Undo button was not clicked in the browser (the toast had expired by then; covered by the unit test); the "take off" path of the Tasks menu was exercised by accident once (it worked and confirmed) and is otherwise covered by tests; Calendar and Today pages were not re-checked beyond the suite. A **stale console error** is still in the pane's buffer from the earlier P4A session (`noLineNotes is not defined`, with a file timestamp from before this session's server started); the page that error came from renders correctly now, and **no new console errors** appeared.
A browser profile could not be isolated (the pane would not open a second origin), so the invented data lives in the pane's own storage alongside earlier invented projects; the owner's real application is a different browser and was not touched.

## 8. Financial regression results
All P1, P2, P3 and P4A tests pass unchanged (the P4A reconciliation property tests included). Deleting a project leaves every transaction, account and commitment untouched (compared as whole records). Unfiltered Reports are identical with and without project tags (asserted). Project-filtered report months add up to `loadProjectSummary` paid. Browser: the project page's paid ($290.00) equals the filtered report.

## 9. Backup and sync compatibility
No format change. A deleted project and its lines are ordinary tombstoned records, exported and restored by the existing code (tested). New code reads old records as before; `+project`, bulk assignment, chips, labels and the report filter store nothing new. An older app version on another device ignores nothing it needs: it would simply show a deleted project as deleted.

## 10. Known limitations and unresolved risks
- Deleting does not erase older backups or Git history, and the app says so.
- (Resolved in section 14: a project edited on one device after being deleted on another no longer comes back. Remaining risks of the new rule are listed there.)
- `+word` handles one project word per task; a second problem word is left in the title without its own note.
- Reports filter: the Flow diagram and the CSV download are unchanged (the CSV in project view still has an all-zero Income row); the Budget page is not filtered; no deep link from a project page to the filtered report was added.
- A transaction tagged to a project whose own record was removed on another device cannot block anything (the project no longer exists to be deleted); it is still reported on the Transactions page as before.
- The Tasks "Project…" menu applies on selection, like the other bulk menus.
- Not verified: two real devices, offline use, an older app version, real data.

## 11. Git working-tree status
Modified (15): src/lib/reports.ts, src/lib/txnProject.ts, src/modules/calendar/searchSource.ts, src/modules/projects/{ProjectPage, ProjectsPage}.tsx, projects.css, work.ts, src/modules/tasks/{QuickTask, TasksPage}.tsx, {data, quickAdd, quickAddDef, searchSource}.ts, src/pages/ReportsPage.tsx, src/shell/AddBox.tsx; plus docs/BACKLOG.md. New: deletion.ts, DeleteProject.tsx, p4b.test.ts, p4b-integration.test.ts and this report. Nothing staged; `HEAD` is `1c478e0`.

## 12. Commit-readiness
**Ready for review.** All checks pass and the tree contains only P4B work. Suggested before committing: try the delete dialog on a throwaway project, and a bulk move with the confirmation, on your own device.

## 14. FINAL FOLLOW-UP: permanent deletion now holds across devices

Date: 2026-11-05. Nothing is committed, pushed or deployed.

### 14.1 The original problem
Deleting a project writes `deletedAt` on its record like every delete in the app. The sync merge compares two copies of a record by `updatedAt` and keeps the newer one, so a copy edited on a stale device after the deletion beat the deletion and the project reappeared, and its budget lines (merged separately) stayed deleted. For "Delete permanently" that is wrong. Other deletes in the app rely on the same rule on purpose, so the rule itself was not changed.

### 14.2 Final conflict policy
For a project deleted with "Delete permanently" **only** (not Archive, not the Add box's Undo, not any other record):
1. **The deletion wins** over every other copy of that project, whether it was edited before or after the deletion, and whichever device syncs first. It stays deleted on all devices after any number of syncs.
2. **Its budget lines follow it**: a line edited, or newly made, on a stale device is deleted as well, so lines are never orphaned or half restored.
3. **Money keeps it alive.** If, after the merge, a live commitment/change order or a transaction (whole or split) still points at the project (made on a stale device), the project and its lines are kept as they are on the live side. Transaction history is never deleted and nothing financial is orphaned; the owner can then delete it properly (the dialog explains what blocks it).
4. **An intentional backup restore still wins**, as the sync notes already document ("a restored backup counts as an edit made now"): restoring stamps live projects with `revivedAt`, and a copy revived after the deletion beats it.
5. **Tasks, milestones and events** are untouched by the merge: the deletion already unlinked them. A task edited later on a stale device may carry the old pointer again; nothing is lost and every screen reads it as "(project removed)" (existing behaviour). A new task made on a stale device for the deleted project is kept and does not bring the project back.
6. **Everything else merges as before** (last writer wins), including ordinary project removals and archive/restore.

### 14.3 Exact code changes
- `src/lib/sync/projectDeletion.ts` (new): the narrow rule as a pure function (`enforceProjectDeletions`), plus the two marker names. Only changes records of module `projects`, kind `project` or `budgetLine`.
- `src/lib/sync/merge.ts`: after the ordinary merge, calls the rule on the merged `moduleRecords` table and re-derives that table's writes (11 added lines; the ordinary rules are untouched).
- `src/modules/projects/deletion.ts`: writes `data.permanentlyDeletedAt` on the project before soft-deleting it (inside the same transaction); comments updated.
- `src/lib/sync/track.ts` (`touchAll`, run after a restore when sync is on): live project records also get `data.revivedAt`, so a deliberate restore keeps winning.
- **No change** to the sync file format, the database schema or any migration: both markers are plain fields inside the project record's own `data`, which an older app version carries as unknown fields and the project reader preserves.

### 14.4 New and updated regression tests (all use the real `SyncEngine` and `mergeSnapshots`)
In `p4b.test.ts` (now 21 tests; the old two-device tests were replaced):
1. an older edit on the other device does not bring it back;
2. a NEWER edit against the stale copy, pushed first, does not either;
3. repeated syncs from both devices keep it deleted;
4. budget lines never come back (edited and brand new lines on the stale device both end deleted);
5. tasks, milestones and a repeating event stay intact and unlinked on both devices;
6. a new task on the stale device is kept and does not resurrect it;
7. Archive and Restore still work across devices;
8. unrelated records keep last-writer-wins, and a plain (Add-box-Undo-style) project removal is not given the new protection;
9. an intentional backup restore still wins over the deletion;
10. money keeps a project alive: a transaction made on the stale device keeps the project and its lines, the transaction is untouched, and the plan reports it as blocking.
**Mutation check:** with the new rule switched off, four of these (2, 3, 4 and the money one) fail; with it on, all pass.

### 14.5 Results
- Full suite: **89 files, 1,340 tests pass** (was 1,334: six more after replacing four old sync tests with ten). All earlier tests, including every P4A, P3 and sync test, pass unchanged.
- `tsc --noEmit`: clean. Production build: succeeds.
- Browser (invented data; desktop and 375 px dark): empty-project deletion (one click, marker stored, gone from the list); deletion with a task, a milestone and a budget line (dialog fits at 375 px dark with no horizontal overflow, delete disabled until the name is typed; afterwards the project and line are deleted, both tasks kept and unlinked, the milestone ordinary); a bulk task move with Undo (move applied, Undo restored both tasks exactly); the Reports project filter ($290.00, the same as the project page's paid); no new console errors (the pane's buffer still holds one old entry from the earlier P4A session, with a file timestamp from before this session).

### 14.6 Remaining risks
- **Project deletion is now stronger than ordinary last-writer-wins by design**, so a person who deletes a project by mistake and wants it back must use a backup (restoring one still works), not rely on another device's copy.
- A restore with sync **off** at the time stamps nothing; if sync is turned on later against a remote that holds a permanent deletion, the restored older project loses, as an older copy always did under last-writer-wins.
- The "money keeps it alive" case resurrects a project the owner deleted (rather than orphaning money); it is silent apart from the project reappearing. A notice was not added to avoid changing the sync conflict format.
- A stale task pointer (see 14.2.5) is not cleaned up by the merge; it is harmless and labelled.
- Not verified: two real devices, offline use, an older app version syncing against the new rule (it would carry the markers as unknown fields and merge with its old rule, so it could still resurrect a project on its own side until updated; update every device before relying on this).
- Old backup files and Git history still contain deleted projects, as the dialog says.

### 14.7 Git working-tree status and recommendation
Modified: docs/BACKLOG.md, src/lib/reports.ts, src/lib/sync/{merge, track}.ts, src/lib/txnProject.ts, src/modules/calendar/searchSource.ts, src/modules/projects/{ProjectPage, ProjectsPage}.tsx, projects.css, work.ts, src/modules/tasks/{QuickTask, TasksPage}.tsx, {data, quickAdd, quickAddDef, searchSource}.ts, src/pages/ReportsPage.tsx, src/shell/AddBox.tsx. New: src/lib/sync/projectDeletion.ts, src/modules/projects/{DeleteProject.tsx, deletion.ts, p4b.test.ts, p4b-integration.test.ts}, this report. Nothing staged; `HEAD` is `1c478e0`.
**Recommendation:** ready for the owner's final approval to commit. Because this touches the sync merge (narrowly), the owner may want to try a two-device delete-and-edit on real devices after deploying.

## 13. Do Projects P1 to P4B satisfy the approved Projects scope?
Substantially yes: projects with budgets and lines, vendors, commitments and change orders (single or multi-line), payments tagged to contracts and lines, reconciliation and warnings, tasks, milestones, events, Calendar and Today integration, Quick Add, bulk assignment, search context, list progress, Finance and Reports filtering, and archive, restore and safe deletion. **Remaining gaps, none implemented:**
1. The total-cost visualization card the owner described (bar and legend for contract, project or paid versus left), recorded in the backlog.
2. A Calendar project filter (evaluated; optional).
3. The design's "pre-select the line with the most left to pay" helper and the one-click "assign existing payments in proportion" (the latter deliberately not built because it would rewrite transactions into splits).
4. Browser checks still owed from P4A: typing the transaction form's split rows by hand.
5. Possible polish: a project link into the filtered report; a note on an overpaid line's "Expected"; project-aware CSV.
6. Real-device checks: two devices, offline, older app versions.
