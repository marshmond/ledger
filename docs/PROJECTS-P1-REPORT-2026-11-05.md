# Projects P1 (project foundation): implementation report

Date: 2026-11-05. Built on top of Phase 0 (`docs/PHASE0-PLAN-2026-11-05.md`, `docs/PHASE0-VERIFICATION-2026-11-05.md`). Contains no personal or financial data; all test and browser data was invented.

## Status
| | |
|---|---|
| Work package | P1 of four planned Projects work packages. P2 not started. |
| Commit | `5ee350a` ("Projects P1: project foundation"), on top of `14eb7cf` |
| Committed / pushed | Committed locally. **Not pushed**, so not deployed. |
| Tests | 82 files, **1,138 tests, all pass** (before P1: 81 files, 1,111 tests; 27 new tests, one new file) |
| TypeScript | `tsc --noEmit` clean |
| Production build | Succeeds |
| Schema / backup / sync format | **No change.** `src/db.ts`, `src/lib/backup.ts`, `src/lib/backupFile.ts` untouched. Schema version still 15. |

## 1. Features implemented

**Projects module.** Fifth in the top-bar switcher, registered through the existing module registry. A list at `#/projects` (tabs Open, Finished, Archived, All, each with a count) and one page per project at `#/projects/<id>`. Unknown addresses under `#/projects` show the list. Responsive; one column on a phone.

**Project data.** Name, notes, status (Planning, Active, On hold, Completed, Cancelled), start date, target completion date, overall budget in cents, vendor contact ids, archived flag. Create and edit in a dialog with plain-words checks: a name is needed, dates must be real calendar dates (2026-02-30 is refused), the target cannot be before the start, the budget must be an amount and not negative. Quick status change, and Archive and Restore (archive has an Undo) on the project page. No delete.

**Budget lines.** Add, rename, change the planned amount, reorder (up and down), remove. The page shows the lines total against the overall budget in words (not planned yet; over by; matches; or "no overall budget is set, so this total is the budget"). If the overall budget is blank, the lines' total is used, as the Phase 0 plan recommended. A line that transactions are tagged to cannot be removed.

**Vendors.** Reuse the shared Contacts, with two optional fields added (`phone`, `email`). Add someone from existing contacts, or add a new vendor (name, what they do, phone, email). An existing contact with the same name (ignoring case, accents and extra spaces) is reused, never duplicated; only its missing details are filled in. Edit a contact from the project (phone and email show as tap-to-call and mail links). Remove takes the contact off this project only. The same contact can be on several projects.

**Search, linking, Add.** Projects are found by name and notes in global search (own group). The "Link a record" picker offers Projects; archived ones are labelled. The Add box has a Project destination (shortcut `p`, then the name; starts in Planning; Undo removes it).

**Finance compatibility.** The records use the field names the Phase 0 Finance layer (`src/lib/txnProject.ts`) already reads, so a transaction can be tagged to a project and its lines, and `loadProjectSummary` gives the same planned total and "not planned yet" figure the screen shows. No Finance code was changed.

## 2. Files

**Created**
- `src/core/contacts.ts` (find or create a contact without duplicating, update details, checks)
- `src/modules/projects/model.ts` (record types, defensive readers, checks, budget summary)
- `src/modules/projects/data.ts` (projects, lines, vendors, ordering)
- `src/modules/projects/records.ts`, `searchSource.ts`, `quickAddDef.ts`, `index.tsx` (registry hooks)
- `src/modules/projects/ProjectsModule.tsx`, `ProjectsPage.tsx`, `ProjectPage.tsx`, `ProjectForm.tsx`, `BudgetLines.tsx`, `Vendors.tsx`, `projects.css`
- `src/modules/projects/projects.test.ts`

**Modified**
- `src/core/entities.ts` (optional `phone`, `email` on `Contact`)
- `src/modules/index.ts` (registers the module)
- `README.md`, `docs/BACKLOG.md`

## 3. Data model

Stored in the existing `moduleRecords` table, module `projects`, one record per fact: kind `project` and kind `budgetLine` (parent `projectId`, `name`, `plannedCents`, `sort`). Backup, restore and sync already cover the table (tested). Readers are defensive and carry through fields they do not know, so another module or a newer version cannot be silently erased. Money is whole cents. Budget lines are removed by soft delete (a marker record) so the removal syncs.

## 4. Tests added (27, all in `src/modules/projects/projects.test.ts`)
- Module registration, record source, search source, and no Add-box clash.
- Project creation, editing, every status, archive and restore without losing anything.
- Plain-words checks for the project form, the line form, and contact details.
- The Add box: preview, create, undo.
- Budget lines: order and totals; derived budget and the four comparison states (derived, balanced, under, over); editing; soft removal; reordering (swaps neighbours, stops at the ends, writes only lines that change, stable for ties); removal blocked when spending is tagged to the line.
- Vendors: new vendor with phone and email; same name reused and details filled, never overwritten; an older contact with no phone or email works; one contact on several projects and removal from one; clearing details and keeping unknown contact fields.
- Defensive reading of bad stored values; unknown fields survive every change; orphaned or other-project lines are not shown.
- Search ranking (open before archived, archived labelled) and record lookup (found, current name, archived label, missing, wrong module).
- Finance compatibility: planned totals match, a transaction can be tagged to the project and line, a blank budget falls back to the lines' total.
- Backup restore and the sync snapshot keep projects, lines, vendors and unknown fields; two devices changing different lines both survive.

## 5. Browser verification (invented data, removed afterwards)
Done at desktop width and at 375 px: empty list; create with a bad budget and a bad date (messages shown); project page; three lines with the over-budget comparison; reorder; vendor with a bad email (message) then a good one; status change; archive; the Archived tab; global search (Ctrl+K) opening the project; restore; the Add box shortcut with its "Will add" preview and Undo toast. No console errors and no sideways scroll at 375 px. Two small visual fixes came out of this (selected tab colour, a stray dot before a vendor's role).

Not verified in a browser: the "Link a record" picker for Projects (covered by tests only), offline use, real two-device sync.

## 6. Decisions and deviations (for review)
1. The status word is **Completed** (the Phase 0 plan said "done"). Finance does not read status.
2. **No delete** for projects, only archive and restore (plan decision R8). The Add box undo is the only removal, for a project made seconds earlier.
3. Vendor links are a list of contact ids **inside the project record**, as the plan said. Two devices adding different vendors to one project at the same moment would lose one; the lost edit is recoverable from the sync notices. Budget lines are separate records and do not have this problem.
4. A vendor is **not a separate record kind**. It is a shared contact that a project points at; "what they do" uses the contact's existing `relationship` text. A future personal-CRM or household-services module can use the same contact without a second copy.
5. Contacts gained only optional `phone` and `email`; nothing requires them, and existing contacts are unchanged.
6. The module has its own stylesheet and does not import the Calendar stylesheet. It also avoids the redirect component the router test bans.
7. Today has no Projects card and project dates are not on the Calendar yet (later steps).

## 7. Known limitations
- No way to delete a project, or a contact from Projects.
- No Today card; no Calendar dates; no tasks, milestones or events linked to projects.
- Vendors have no notes; lines have no categories or notes.
- Contacts are not searched from the Projects search group (Tasks search still finds them).
- Projects-only details: Settings > General can pick Projects as the landing module because it comes from the registry (not specifically tested).

## 8. Existing modules
All 1,111 earlier tests still pass and none was edited. In the browser, Tasks, Calendar, Today and the Add box behaved normally alongside Projects. Finance calculation code is unchanged.

## 9. Not built (as agreed)
Commitments and change orders, transaction tagging screens, spending figures and the dashboard, project-linked tasks and milestones, project-linked Calendar events, documents and file storage, AI, any backend.

## 10. Recommended P2
1. **Commitments** on the project page: quoted, accepted, declined, cancelled; change orders as child commitments (negative allowed); optional budget line and vendor.
2. **Tagging screens:** a Project box on the transaction form and in bulk actions, using the Finance layer. It must carry the Reversal or Credit prompt for money coming back on a contract, the pre-filled negative change order offered for credits, and the "is this refund about a contract?" question for project-only tags (see `docs/PHASE0-VERIFICATION-2026-11-05.md`, section 4).
3. **Dashboard:** show paid, agreed, left to pay, expected total and left in budget from `loadProjectSummary`, beside the existing budget summary, with the flags (over budget, overpaid contract, credit not reflected, reversal larger than payments).
4. Before or during P2: decide whether vendors should be on commitments (one vendor per commitment) and whether a project's vendor list stays on the project record.
