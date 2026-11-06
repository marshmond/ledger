# Projects P3 report: tasks, milestones, Calendar and Today

Date: 2026-11-05. All example data is invented. **Nothing is committed or pushed.** P4 is not started.

## 13. Current commit and deployment status (stated first)

| | |
|---|---|
| Branch | `main`, in step with `origin/main` at `b96c37b` (P2, its follow-ups, the P2 report and the P3 backlog are already pushed) |
| P3 work | **In the working tree only. Not committed, not pushed, not deployed.** (Includes the review follow-ups, section 14.) |
| Waiting for | The owner's review of this report and approval |
| Tests | **1,254 pass in 86 files** (was 1,206 in 85; 48 new, 3 existing assertions updated, see section 8) |
| Type check, build | `tsc --noEmit` clean; `npm run build` succeeds |
| Database | **No schema change** (still version 15); no backup or sync format change |

## 1. Summary of new functionality

- **Tasks on a project.** A task can belong to one project. The project page has a Tasks section: add a task, add an existing one,
  tick or untick, open the normal Task editor, take a task off the project (it is kept), and filter To do / Overdue / Done / All with a
  progress bar and counts.
- **Milestones.** A milestone is a normal task flagged as a project checkpoint ("Permit approved"). A Milestones section with
  add, due date, tick, reopen, progress bar and an "N overdue" flag. Milestones are never counted among the ordinary tasks.
- **Events on a project.** A Calendar event can belong to a project. The project page has an Events section (add an event, add an existing
  one, take one off, open it in Calendar). Events are edited in the normal Calendar editor, which now has a Project box.
- **Coming up on the project page.** One list of the next 30 days: open tasks, milestones and events, plus anything overdue, each linking to
  its own screen.
- **Calendar.** A small project marker (a diamond and the project name) on every project event, task and milestone in the Agenda and Day
  lists, in a chip's tooltip, and in the detail dialog (with a link to the project). A new read-only **Projects** calendar layer shows each
  active project's start date and target date. Milestones appear through the existing Tasks layer (marked with a filled diamond).
- **Today.** A **Projects** card listing only active projects that need a look (section 5).
- **Navigation.** Task to project and event to project (editors, rows, detail dialog); project to task, event and **transaction in
  Finance** (each project transaction row opens it; "See in Finance" lists the project's transactions).
- **Finance.** A **Project filter** on the Transactions page (Filters panel, a removable chip, and the address
  `#/ledger/transactions?project=<id>`); `?txn=<id>` opens one transaction.
- **Multi-line commitment design review** written and saved (`docs/PROJECTS-MULTILINE-COMMITMENT-DESIGN.md`). Not implemented.

## 2. Files created and modified

Created:
- `src/core/projectLink.ts`: how Tasks, Calendar, Today and Finance read a project's name and state from a stored `projectId` (read-only; copes with archived, cancelled and missing projects).
- `src/modules/projects/work.ts`: pure counting and "coming up" rules, and the commands that link tasks and events (they call the Tasks and Calendar data layers).
- `src/modules/projects/ProjectWork.tsx`: the four new sections on the project page.
- `src/modules/projects/dueProvider.ts`: project start and target markers for the Calendar.
- `src/modules/projects/todayLogic.ts`, `todayCards.tsx`: the Today card (pure rules, then the screen).
- `src/modules/projects/p3.test.ts`: 48 tests.
- `docs/PROJECTS-MULTILINE-COMMITMENT-DESIGN.md`, this report.

Modified (the functional edits are small; each is one concern):
- Tasks: `model.ts` (optional `projectId`, `isMilestone`, read defensively), `TaskEditor.tsx` (Project box, Milestone box, Open project), `TaskRow.tsx` (project tag), `TasksPage.tsx` and `views.ts` (project filter, `?project=` link), `dueProvider.ts` (project id on items, milestone marker), `tasks.css`.
- Calendar: `model.ts` (optional `projectId`, new built-in calendar id), `series.ts` (`projectId` in the series extras), `data.ts` (`setEventProject`, `loadProjectEvents`, seeds the Projects calendar), `EventEditor.tsx` (Project box), `CalendarPage.tsx` (`?new=1&project=`), `useCalendarData.ts`, `AgendaView.tsx`, `parts.tsx`, `dialogs.tsx`, `records.ts` (exports the event address helper), `calendar.css`.
- Projects: `ProjectPage.tsx`, `Financials.tsx` (transaction links), `index.tsx` (registers the provider and card), `projects.css`.
- Core and Today: `core/dueProvider.ts` (optional `projectId` on a derived item), `today/today.css`.
- Finance: `lib/txnQuery.ts` (project filter), `pages/TxnFilterUi.tsx`, `pages/TransactionsPage.tsx`.
- Tests changed: `calendar.test.ts`, `sync.test.ts` (section 8).

## 3. Tests added and final results

48 new tests in `src/modules/projects/p3.test.ts` (invented data, one database per test):

- **Tasks (12):** create on a project; refuses empty title or missing project; assign and remove without deleting; one project at a time; edit, complete and reopen keep the project and unknown fields; assigning keeps unknown fields; a repeating task keeps its project on the next one; archived, cancelled and missing projects; the project picker rules; delete versus remove; bad `projectId` values; the Tasks project filter.
- **Milestones (8):** flag, due date, complete and reopen; no table of its own; counted once (tasks and milestones separate in every total); overdue rule; appears once on the Calendar through the Tasks provider with no extra event; removing from a project, needing a project, refusing repeats; moving keeps the flag; an older task with both a milestone flag and a repeat stays predictable (counts, Calendar, unknown fields).
- **Calendar and project dates (13):** create and read; unchanged events; an ordinary edit keeps the project; change and remove in the editor; link and unlink keep other fields; recurring series through edit-one, edit-following and delete-one; whole-series link; archived and stale ids; retired events; project start/target markers (including archived, cancelled, completed, on-hold exclusion, handled-not-overdue past dates, and both entries when a milestone shares the target day).
- **Project page and navigation (3):** the combined "coming up" list; repeating events list next dates only; every record opens at a real address.
- **Today (5):** which projects appear and in what order; excluded statuses; quiet when nothing is late; one row per project with counts only (no task listed twice); the card is registered.
- **Finance and cross-module (7):** project filter (whole transaction, split pieces, old saved filters); project totals identical before and after adding tasks, milestones and events; search finds a project task once; record links; backup and restore; sync snapshot; schema is still version 15.

**Results:** full suite 1,254 pass (86 files); `npx tsc --noEmit` clean; `npm run build` succeeds (the usual large-chunk notice only).

## 4. Browser verification

Real browser (the in-app preview, a fresh empty profile), invented data, desktop and 375 px.

Checked and working:
- Created a project (Active, with start and target dates); on its page added two milestones and two tasks (Add buttons and the Return key); progress bars, an "overdue" flag and the "coming up" list showed correctly.
- Ticked a milestone (progress 1 of 2, row moved to done), unticked it, removed a task from the project (toast said the task is kept; counts 1 of 1).
- Calendar: opened "Add event" from the project (`?new=1&project=`): the Project box was preselected; saved; the Agenda showed the event, the tasks and milestones with the project name, the project's target date on the new Projects layer, and the Projects layer in the legend.
- Today: the Projects card showed "1 milestone overdue · Target in 9 days · Milestones 0/2 · Tasks 0/2", and the overdue milestone and the coming-up tasks appeared once each in the existing cards.
- Task editor: Project box showed the project, with the Milestone box and an Open project link.
- Finance: the project link opened `#/ledger/transactions?project=<id>`: a "Project: Test Kitchen" chip, the address tidied itself; the transaction link on the project page opened that transaction's edit form with the project selected.
- 375 px: project page, Today, Tasks and Calendar had no sideways scroll; the project sections read cleanly (screenshot reviewed).
- No new console errors after a clean reload. (The console shows two older hot-reload messages from my edits while the preview was running; they are not from loading the page.)

**Verified in the follow-up round (section 14):** changing and removing a project in the Calendar editor, the Milestone box, the Tasks project filter, "this and following" on a repeating event, dark theme (partly). **Still not verified in a browser:** archived-project and missing-project displays (unit-tested only); the Task and Event editors in dark theme; reloading while offline; two real devices syncing. I added one test account and one test transaction to the preview profile by writing to its database directly (the preview's own throwaway profile, not the owner's data).

## 5. Changes to Tasks, Calendar and Today

**Tasks:** two optional fields on the existing task record (`projectId`, `isMilestone`). Editor: a Project box (archived and finished projects are not offered, but the one already chosen stays selectable), a Milestone box (hidden with no project; disabled while a repeat is set, and choosing it clears the repeat setting). Rows show the project. The list has a project filter ("Any project", "No project", or one). `#/tasks?project=<id>` filters.

**Calendar:** one optional field on the existing event record (`projectId`). Editor Project box; the project covers every date of a repeating event (said in the editor). Markers on items; a read-only **Projects** layer (project start and target dates, informational). Milestones come through the existing Tasks layer; **no event is created for a milestone**.

**Today:** one new card, **Projects** (default half width, hidden when empty, after "Coming up"). Rule, restrained by design: a project appears only if it is **active** (Planning or Active; not On hold, Completed, Cancelled or archived) **and** it has overdue milestones, overdue tasks, a target date already passed, or a target within 14 days. Each row is the project name (a link), short phrases ("1 milestone overdue", "Target in 9 days") and counts ("Milestones 1/3 · Tasks 2/7"). Up to 4 rows, then "N more". The card lists **no individual task or event**, because Today's other cards already do, so nothing is shown twice. Reasoning: Today should say "this project needs a look" and one click leads to the detail.

## 6. Navigation and filtering improvements

| From | To | How |
|---|---|---|
| Task (editor) | its project | Open project link; project name on the row |
| Event (editor, Agenda, detail) | its project | Open project link; marker |
| Project | task, milestone | "Coming up" list and rows open the task |
| Project | event | opens in Calendar at that event |
| Project | add event | `#/calendar?new=1&project=<id>` |
| Project | a transaction | payee link opens it in Finance (`?txn=<id>`) |
| Project | all its transactions | "See in Finance" (`?project=<id>`) |
| Today | project | project name in the Projects card |

Filters: Transactions page Project menu and chip; Tasks page project filter. Not added: a project filter in Reports or in Calendar (Calendar keeps its layer switches).

## 7. Data integrity decisions and edge cases

- **Archived project:** tasks and events stay linked and fully usable; labels read "Name (archived)"; the project page says it is archived; it is not offered for new links; Today and the Calendar markers leave it out. Restoring brings everything back.
- **Archiving or cancelling a project with open tasks:** nothing is changed or deleted (no silent edits); the page states that the work is kept and no longer shows on Today.
- **Deleting a project:** projects are archived, never deleted (existing rule); only the Add box's undo removes a brand-new project.
- **Missing or stale `projectId`** (project removed on another device, or a corrupt value): the record stays an ordinary task or event; the editor shows "(project removed)" with a plain explanation; saving "No project" clears it; linking to a missing project is refused with a message. A non-number value is read as "no project".
- **Recurring tasks:** the next one keeps the project (and the milestone flag if an older or foreign record has both, see the deviation below).
- **Recurring events:** the project belongs to the whole series. Editing one date, "this and following" (the new series copies the project) and deleting one date all keep it. Linking a repeating event covers every date.
- **Milestones reopened:** reopening is the ordinary reopen; the milestone flag and project stay.
- **Task deleted versus taken off a project:** "Remove" on the project page only clears the project (the task is kept, with Undo); deleting a task is the normal Tasks delete. A milestone taken off its project becomes an ordinary task, because a milestone needs a project.
- **Date-only deadlines:** due, start and target dates are plain `YYYY-MM-DD` strings compared as text, and "today" comes from the device's local date, so no time zone shift. A task due today is not overdue.
- **Sync conflicts:** tasks and events are single records merged last-writer-wins by the existing sync, so a project change and an edit made at the same time on two devices keep whichever is later; this is the same behaviour as every other task or event field. The project id travels in the record, so another device receives it (checked in the sync snapshot test). Unverified with real devices.
- **Duplicates on Today and Calendar:** milestones and tasks come from one provider, so each appears once; the project's target marker and a milestone due the same day are **both shown** (two different facts, each once; changed in the review follow-ups); the Today card carries counts only.
- **Records from before P3:** have no `projectId`; nothing is migrated; every existing test passes (three assertions updated, section 8).
- **Unknown fields** are kept through every new command (tests for tasks and events).

## 8. Deviations from the requested scope

1. **The fields were not already in the models.** The brief says `projectId` was anticipated in Phase 0 on tasks (and says to add it to events). Only an unknown-field test mentioned them. I added them as typed, optional, defensively read fields; the existing Phase 0 test passes unchanged.
2. **A fourth built-in calendar, "Projects"** (fixed id like the others) feeds the start and target markers. It is a record, not a schema change. Two existing tests that counted the built-in calendars (3) were updated to 4.
3. **"Prefer non-recurring milestones":** enforced in the editor and in `setMilestone` (a repeating task cannot be made a milestone; making a milestone clears the repeat setting) rather than by blocking the low-level repeat. I did not block it there because a Phase 0 test requires that unknown fields, including these two, pass to the next occurrence of a repeating task, and because blocking would silently drop a recurrence from foreign data. Effect: a repeating "milestone" arriving from another source would still create its next one.
4. **The Today card shows counts, not items** (reasoning in section 5).
5. **On-hold projects are left out of the Today card** (judgment; see below).
6. **Not built from the brief's "where practical" items:** a project word in the Add box's task shorthand; bulk "move to project" in the Tasks selection bar; project name in global-search result lines; project counts on the Projects list page; a project filter in Reports.

Judgment calls (please review):
1. (Review round: unchanged.) Today lists only Planning and Active projects, with a 14-day target window; On hold is left out so a paused project does not nag.
2. (Replaced in review: the target marker and a same-day milestone are both shown.)
3. Markers for dates already past are "handled", so a missed target never sits in Overdue forever; the Today card shows "N days past target" instead.
4. One project per task and per event; a repeating event's project covers the whole series.
5. Linking a task or event that is already on another project **moves** it (the choice list says "now on X", with Undo).
6. A milestone is a filled-diamond title prefix on the Calendar and Today lists.

## 9. Known limitations

- A contract still has one home budget line (the design review covers the fix; it is P4 material).
- Two devices changing the same task or event at once keep the later change (existing behaviour, now also for the project field).
- Not verified: offline use and real two-device sync of any P3 data; the browser items listed in section 4.
- The Projects calendar layer can be switched off in the legend like any other; its markers are exported in a calendar file like other automatic layers (not specifically tested).
- The Task editor flashes the first menu choice for a moment before the project list finishes loading (cosmetic).
- Bulk selection in Tasks cannot set a project.

## 10. Database, backup and sync compatibility

- **No schema change; no backup format change.** Tasks, events and projects are `moduleRecords`; `projectId` and `isMilestone` are extra fields inside them. The new calendar is one more `moduleRecords` row of an existing kind.
- Backup and restore round trip keeps both fields (test). The sync snapshot carries them (test). Older copies of the app keep them as unknown fields and carry them along.
- Finance reads nothing new from the database except the existing project tag on transactions (the new filter reads it).

## 11. P1 and P2 financial behaviour

Unchanged. No Finance calculation, commitment record or transaction tag logic was touched. A test creates a project with a budget line and a tagged payment, takes its summary, then adds tasks, a milestone and an event, and checks that the **whole summary object is identical** and paid is still $250.00. All 1,206 earlier tests still pass (three assertions changed, none about money).

## 12. Recommended P4 scope

1. **Multi-line commitment allocation**, per the design document (small, contained, no schema change), after one multiple-choice design round with the owner.
2. Quick-add polish: project word in the Add box's task shorthand; "move to project" in the Tasks selection bar; project name in search results; progress on the Projects list.
3. A project filter in Reports and, if wanted, in Calendar.
4. Verify offline use and two-device sync of Projects, Tasks and Calendar on the real devices (still outstanding from P2).
5. Then the longer roadmap in `docs/BACKLOG.md` (Home & Assets, Household Services, Bills, Subscriptions, Family, Personal CRM, Documents, AI assistant), each as its own approved step.

Not started: P4 or anything on that list.

## 14. Review follow-ups (owner's review, 2026-11-05)

**1. Target-date marker.** Removed the rule that hid a project's target marker when an open milestone was due the same day. The Calendar now shows "Target: <project>" (Projects layer) and "◆ <milestone>" (Tasks layer) as two separate entries; neither record is touched (a test compares every stored record before and after and checks both entries, once each).

**2. Legacy repeating milestone** (a task carrying both `isMilestone` and a repeat rule, from an older or foreign source). Behaviour is now defined and tested, with no new data model or migration:
- Recurrence is unchanged: finishing one makes the next, which keeps the project, the flag and every unknown field.
- Counts: each stored record counts once, in **milestones only** (the finished one and the new open one); ordinary task counts are unaffected; the "next milestone" is the open one.
- Calendar: the open one shows once with the milestone marker; the finished one is gone from it.
- Editor fix found while doing this: saving such a task used to drop the milestone flag silently. It now keeps it. The Milestone box stays ticked, the repeat settings stay visible, and a plain note explains that finishing one makes the next; unticking the box, or turning the repeat off, is the owner's choice. The editor still never creates the combination (ticking Milestone clears the repeat, and a repeating task cannot be ticked).
- Regression test: "an older or foreign task with both a milestone flag and a repeat stays predictable".

**3. Browser verification** (in-app preview, invented data, desktop; desktop 375 px was checked in the first round):

| Item | Result |
|---|---|
| Change the project in the Calendar editor | Verified. For a repeating event: this-and-following gave the old series an end date with no project and a new series with the new project; "All events" changed it again |
| Remove the project in the Calendar editor | Verified ("No project", all events); event kept |
| Toggle Milestone in the Task editor | Verified on and off (stored flag set and cleared, project kept); removing the project hides the box and clears the flag |
| Legacy repeating milestone in the editor | Verified: box ticked, repeat visible, note shown; an ordinary Save kept flag, repeat and project |
| Tasks project filter | Verified: Any / No project / one project / a project with no tasks ("No tasks match these filters") |
| Recurring event, "this and following" | Verified (above) |
| Dark theme | Verified on the project page, Calendar Agenda and (loading state only) Today; readable contrast on the new sections. Not checked: the Task and Event editors in dark |
| Offline editing and reload | **Partly.** I stopped my dev server and saved a Calendar edit: it saved to the local database with no network need (the app is local-first). A true offline reload could not be checked: another dev server on the same port kept answering, and the offline-capable service worker exists only in the production build, which I did not install. **Unverified: reload while offline.** |

Housekeeping: I seeded a few extra records by writing to the preview profile's database (a second project, a recurring event, a legacy milestone, and earlier a test account and transaction) and removed every one of them afterwards, plus restored the one task I deliberately edited. The preview profile also holds the owner's own test tasks, which I left alone. Nothing here touched real data.

**Results:** 1,254 tests pass in 86 files (one new); `tsc --noEmit` clean; `npm run build` succeeds. No schema change.

**Exact files changed by the follow-ups:** `src/modules/projects/dueProvider.ts` (marker rule), `src/modules/tasks/TaskEditor.tsx` (milestone box and repeat display), `src/modules/projects/p3.test.ts` (one test rewritten, one added), this report, `docs/BACKLOG.md`.

**Remaining risks and limitations:** offline reload and two-device sync unverified; a repeating milestone from foreign data keeps repeating by design; Task and Event editors not checked in dark theme; items listed in section 9 still apply.

**Commit readiness:** all checks pass and the tree contains only P3 work (33 modified files, 9 new). `HEAD` is still `b96c37b`. Nothing is staged, committed, pushed or deployed; waiting for the owner's explicit approval.
