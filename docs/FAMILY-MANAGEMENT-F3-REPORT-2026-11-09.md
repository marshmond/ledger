# Family Management F3: responsibilities, activities, projects and important contacts

**Date:** 2026-11-09. **Status: BUILT AND TESTED LOCALLY. UNCOMMITTED, NOT STAGED, NOT PUSHED, NOT DEPLOYED. Awaiting independent (ChatGPT) review.** Not real-device tested, no screen reader used.

## 1. Summary

A Family member's page now shows, in plain words and read-only, what Ledger already knows about that person:

- **Schedule:** the next 30 days of Calendar events that name the member's Contact (repeating events, skipped dates and one-date changes follow the Calendar's own engine).
- **To do:** open Tasks that name the member's Contact, in Tasks' own order (overdue first).
- **Projects:** projects whose existing "Vendors and people" list names the member's Contact (never guessed from a title).
- **Important contacts:** the one new thing Family stores: a small `family/contact` record (member, shared Contact, short purpose). Add (existing or new Contact), change purpose, remove (archive, can be put back), duplicates refused.
- **Important dates:** the member's existing F2 dates (anniversaries and others), listed.

Nothing is copied: no Calendar event, Task or Project is created, completed or edited from Family; each row is a link into the module that owns it. No schema change (Dexie is still v15), no sync-format or backup-format change, no new dependency, no Finance change, no tablet or sharing anything.

Result: **3,879 tests in 216 files** (+80 tests, +6 files on the released 3,799 in 210). `npx tsc --noEmit`, `npm run build` and `git diff --check` are clean.

## 2. Release gate and deployed F2.1 SHA

Verified before any code was written:

| Check | Result |
|---|---|
| Repository | `origin` = `https://github.com/marshmond/ledger.git` |
| Branch | `main` |
| Local HEAD = `origin/main` (after `git fetch`) | yes, both **`1208f05ed92130368a3976647fd25f8a99a1b86f`** (`feat(calendar): F2.1 compact layer controls`) |
| F2.1 committed and pushed | yes (it is HEAD and equals `origin/main`) |
| GitHub Pages for that exact commit | public Actions API: run **#82**, `head_sha` = `1208f05…`, `status` completed, `conclusion` **success**. The run shows `run_attempt` 3 (it was re-run twice before it succeeded; I did not look at why the earlier attempts did not) |
| Working tree clean | yes (the `git status` at session start and before the first edit were empty) |
| Family member and date models present | yes (`family/model.ts`, `family/dateModel.ts`, `dateData.ts`, due provider) |
| F2.1 Layer Menu present | yes (`calendar/LayerMenu.tsx`, `layerMenuModel.ts`, `layerMenu.test.tsx`) |
| Released test baseline | The handoff documents **3,799 in 210 files**. I did not run the suite on a clean checkout of `1208f05` before editing. It is consistent: the 80 new tests are all in 6 new files (210 + 6 = 216), no existing test file's count changed, and 3,799 + 80 = 3,879. `gh` is not installed here, so the Actions API was read with `curl` |

Documents read first: `CLAUDE.md`, `docs/CHATGPT-HANDOFF.md`, `docs/BACKLOG.md` (top), the F0 plan (sections 5 to 9 and F3), the F1, F2 and F2.1 reports' structure, and the source listed in section 3.

## 3. Files changed

New (all in `src/modules/family/`):

| File | What it is |
|---|---|
| `memberSchedule.ts` | Pure `buildMemberSchedule` plus read-only `readMemberSchedule`, `scheduleWhen`, `calendarLink` |
| `memberWork.ts` | Pure `memberTasks`, `memberProjects` plus read-only `readMemberTasks`, `readMemberProjects`, `taskWhen` |
| `importantContactModel.ts` | Pure record model: defensive reader, validation, stored shape, duplicate keys |
| `importantContactData.ts` | The only new writer: add, change purpose, archive/restore (`moduleRecords`, plus one new Contact only when asked) |
| `MemberSections.tsx` | Schedule, To do, Projects and member-dates sections (read-only) |
| `ImportantContacts.tsx` | Important-contacts section, add/change dialog, remove confirmation |
| `family-f3-schedule.test.ts` (17), `family-f3-work.test.ts` (14), `family-f3-contacts.test.ts` (20), `family-f3-sync.test.ts` (9), `family-f3-a11y.test.tsx` (6), `family-f3-guards.test.ts` (14) | 80 tests |

Edited:

| File | Change |
|---|---|
| `MemberPage.tsx` | Composes the new sections; order Profile, Schedule, To do, Projects, Important contacts, Important dates, Linked contact, Private note |
| `family.css` | Row styles (`fm-item*`, `fm-late`, 44 px phone targets) |
| `src/lib/backupSummary.ts` | Friendly label "Important contacts" for `family/contact` |
| `src/modules/calendar/useCalendarData.ts` | **One word:** `readVisibility` is now `export`ed (it already existed). Family needs the owner's switched-off-calendars preference and may not read browser storage itself |
| `family-guards.test.ts` | One expectation updated: the list of files allowed to write now includes `importantContactData.ts` (reason: it is the new writer) |

Not touched: `src/db.ts`, any sync file, backup format, Finance, Tasks, Projects, Today, Calendar logic.

## 4. Schedule integration

- **Association:** `event.contactIds` contains `member.contactId`. Matching is by Contact id only.
- **Reader:** one indexed read of the Calendar's live events (`[module+kind]`, the same as the Calendar's `loadEvents`), each row parsed with the Calendar's own `asEvent`, then the Calendar's own `occurrencesOf` for today through today + 30 days (`SCHEDULE_DAYS`, fixed, no setting). One row is read at a time inside `try/catch`, because a null row would otherwise crash the whole page (it crashes the Calendar's own `loadEvents`; see limits).
- **Recurring, skipped, overridden:** exactly the Calendar's outputs. Tested with the real Calendar write functions (`removeOccurrence` to skip, `saveEdit` to change one date): the skipped date disappears; the changed date shows its new date and title while keeping the original-date key.
- **No duplicates:** one entry per `eventId:original date`; an event naming two members is one occurrence on each profile and says "Also for: <other active member>" (only other active members are named, never an arbitrary Contact; two member records for one Contact count as one person).
- **Shown:** title, date, time (or "All day"; multi-day ranges), repeat marker, calendar name and its colour (name always in text, colour is never the only cue), location, "Done" for tracked items. Each title links to `#/calendar?v=agenda&d=<day>&open=e:<id>:<date>` (the Calendar's own link format; opened in the browser and confirmed to open its "Edit event" dialog).
- **Visibility:** the Calendar has no per-event private flag. Its one visibility mechanism is the device-local "calendars switched off" preference (`calendar-hidden-layers`). Events on a switched-off calendar are not listed; they are counted ("8 upcoming events are not shown because their calendars are switched off on this device"). This is the owner's own view; there is no shared-display behaviour.
- Cap of 8 rows with "Show all N events" (phone length).

## 5. Task integration

- **Association:** `task.contactIds` contains `member.contactId`.
- **Rules reused from Tasks:** `isOpen` (not done), `isOverdue`, `sortTasks(…, 'due')`. So overdue first (earliest date), then soonest, "do on" date used when there is no due date, undated last, ties by priority then title. Waiting and in-progress are labelled; "Overdue", "Repeats" and "High" are words.
- **Recurring tasks:** a repeating Task is one record that Tasks moves on when it is completed. Tested with Tasks' own `completeTask` and `reopenTask`: after completing, the old record leaves the list and exactly one new open one is listed; reopening brings back the original.
- **Identity:** the list carries the Task's own id; a Task with two members is the same record on both pages (tested: one stored row).
- **Removed association:** taking the member off a Task in Tasks (or deleting the Task) makes it leave the list. Family keeps no second association (tested). The page says so.
- **Navigation:** each title opens `#/tasks?task=<id>` (confirmed in the browser: Tasks' editor opens).
- **Inline completion deliberately NOT offered.** Completing a recurring Task has side effects (it creates the next one); keeping Family read-only means every action is performed by Tasks' own screen with no new code path to review. Documented as a choice, easy to add later by calling `completeTask`.
- Cap of 8 rows with "Show all N tasks".

## 6. Project relationship design

- **Evaluated:** (a) the project's `vendorContactIds` (the shared-Contact list behind the "Vendors and people" card, labelled "the people and businesses involved in a project"); (b) the shared `links` table; (c) a Task's or event's `projectId`.
- **Chosen: (a), read-only.** It is an existing, editable, synced, explicit person-to-project relationship, already supports many projects per Contact and many Contacts per project, and needs no new field or record.
- **Rejected:** (c), because a Task being for Sam and on a project does not make the project Sam's (tested: a Task for Sam on a project that does not list Sam does not list the project); a title containing the name (tested: not listed); (b), no project-to-contact link type exists.
- **Shown:** name (link to `#/projects/<id>`), status in words, target date; grouped open (planning, active, on hold), finished, then archived (labelled "Archived"). A deleted project simply leaves; a damaged project row is tolerated.
- **Limit and recommended extension:** Family cannot add a person to a project (that would be a write to Projects, which the guards forbid). The person is added on the project's own "Vendors and people" card, the label of which says "vendors". Smallest recommended extension (not built): rename that card to "People and vendors", and/or give Projects an "Add a household member" action that calls its existing `addVendor`.

## 7. Important contacts design

- **Record:** `moduleRecords`, module `family`, kind `contact`, fields **exactly** `memberId`, `contactId`, `purpose`, `status` (`active` or `archived`). A guard test pins the field list; there is no display, sharing or tablet field. No name, phone or email is copied (tested against the stored row).
- **Beyond the brief's suggested fields:** `status`, so "remove" is an archive (same pattern as F2 dates), reversible and never a delete.
- **Add:** choose an existing Contact (linked, never changed) or "Create a new contact". A new Contact is always separate (F1's `createDistinctContact`; a same-name Contact is shown with "Use this one instead", and saving needs an explicit tick), created in the same transaction as the association. `ContactPicker` was **not** reused: its typed-name path matches existing Contacts by name (the automatic merging F1 removed) and it is multi-select. The radio-list pattern from F1's member form is used instead.
- **Change purpose / Remove / Put back:** purpose changes only the purpose; remove archives with a confirmation that states the Contact is not deleted; "Show removed (n)" lists removed ones with "Put back". Row buttons have spoken names including the Contact, purpose and member.
- **Refused (words shown in the dialog):** no purpose; purpose over 60 characters; the person themselves; a missing, deleted or unreadable member; a missing or deleted Contact; an exact duplicate (same member, same Contact, same purpose ignoring case, spacing and accents) while the first is active; changing a purpose into a duplicate; putting a removed one back when an active duplicate exists.
- **Allowed:** one Contact important to several members; one Contact for one member with different purposes; re-adding after removing.
- **Defensive:** unknown fields kept through every edit; an unreadable row is counted ("could not be read by this version"), kept exactly, never rewritten; a Contact deleted later leaves the association in place and says so.
- **Privacy:** ordinary Contact details only (relationship, phone, email, as the member form already shows); the purpose box warns against health details, identity numbers and passwords; nothing is published.

## 8. Backup and sync results

Real `SyncEngine` and real backup code (`family-f3-sync.test.ts`, 9 tests):

- Two devices each add a **different** contact for the same member while offline: after sync both associations are on both devices; the member and all Contacts are unchanged.
- Two devices add the **same** association: both rows kept and flagged as a possible duplicate; nothing merged or deleted; removing one is an ordinary archive that syncs.
- Remove on A and change purpose on B: converge to one record on both (whole-record last writer, the same rule as the rest of Ledger); the Contact survives.
- A new Contact made through the flow arrives with its association, as a separate Contact beside a same-named one.
- Unknown fields from a newer build pass through sync and survive an edit.
- Plain backup restores the association and the referenced Contacts exactly; the summary reads "Family members 1, Important contacts 1". Encrypted backup contains neither the purpose nor any name, and restores through the real safety-copy sequence. An unreadable association row survives a backup round trip unchanged.
- Dexie is still v15; no table named for Family exists; no backup or sync file format changed.

## 9. Tests and browser verification

**Tests:** 80 new behaviour tests. Schedule (17): association, multiple members, window edges, order, multi-day, all-day vs timed, colours and open key, missing calendar, weekly series equals the Calendar's own expansion, skip and override through the real Calendar write functions, deleted and retired events, hidden calendars, read-only (every table byte-identical after reading), damaged rows. Work (14): open/overdue/order/shared/recurring/removed association/damaged rows; projects explicit-only, grouping, deleted and damaged; Finance tables untouched. Contacts (20), sync and backup (9), accessibility (6) and guards (14) as described above and in sections 7, 8 and 10.

**Commands, run once as asked, after the last edit except where noted:** `npm test` **3,879 passed, 216 files**; `npx tsc --noEmit` clean; `npm run build` succeeds (the existing chunk-size warning remains); `git diff --check` clean (only CRLF notices). One test-file type error (a cast) was found by `tsc` and fixed; after it and one wording edit I re-ran only the Family suites (227 passed), not the whole suite again.

**Browser (dev server on `localhost:5173`, invented data, built-in browser pane):**

| Check | Result |
|---|---|
| Member with Calendar events (weekly, timed, all-day, multi-day, shared, very long title) | Listed correctly; long title wraps; "Also for" shown |
| Member with Tasks (overdue, dated with time, undated, repeating, shared) | Overdue first, labels correct |
| Linked project (and an unlinked project whose title names the member, and an archived one) | Only linked ones listed; archived labelled |
| Add important contact (existing Contact) | Appears live; stored row has only the four fields |
| Duplicate (same Contact, "  school   OFFICE") | Refused with the words in the dialog |
| Remove (confirm dialog, Cancel focused) then Show removed then Put back | Archived, Contact row unchanged, restored |
| Navigation | Event link opened Calendar's "Edit event"; Task link opened Tasks' "Task" dialog; project link `#/projects/<id>` (link text checked, not clicked) |
| 375 px and 320 px | No horizontal overflow; 0 controls under 44 px after one fix (event/task/project title links were 32 px; now 44 px); add dialog fits at 320 px |
| Light and dark | Both render with the app's tokens (screenshots viewed) |
| No unexpected writes | No Calendar, Task or Project row's `updatedAt` changed after all the clicking; no console errors |
| Switched-off calendar | A hidden calendar gave "8 upcoming events are not shown…"; heading reworded to "No events shown" after this check (not re-viewed in the browser) |

Caveats: the browser pane's profile already held earlier disposable test data (it held two Family members I did not create); I added mine on top and left everything. Data was seeded by writing straight into IndexedDB, which the page does not notice until a reload (writes made in the app update live, observed). The browser tool listed some radio buttons by their value rather than their label text; the static accessibility test shows the label names, and I did not use a screen reader. A full-size screenshot timed out once; scaled screenshots worked.

## 10. Remaining limitations

1. Not real-device tested; no screen reader; no second physical device.
2. Fixed 30-day window; no filters, no past events, no "next occurrence" search beyond it.
3. A device-local preference (switched-off calendars) decides what the Schedule hides; a different device may show different events. Documented, deliberate.
4. A Calendar row that is `null` crashes the Calendar's own reader (existing behaviour); Family skips such rows but the Calendar screen would still fail. Not changed (out of scope).
5. Family cannot add a person to a project (see section 6).
6. Inline task completion and "add an event/task for this person" shortcuts are not offered.
7. A Contact's details are edited nowhere in Ledger yet (existing backlog item "Family profile Contact editing"); a new Contact from this flow has a name only.
8. Whole-record last-writer-wins applies to an association edited on two devices (as everywhere); the later edit wins and the other is in Ledger's conflict list.
9. Duplicate associations from two devices are flagged, not merged.
10. Past members' pages show the same sections.

## 11. Judgment calls (please review)

1. **Hidden calendars are respected** on the Schedule (counted, not listed), using the Calendar's own device preference; the alternative is to ignore the preference.
2. **Projects use `vendorContactIds` read-only**; no write path from Family.
3. **No inline task completion.**
4. **`status` field on the association** (archive instead of delete), beyond the brief's three suggested fields.
5. **`ContactPicker` not reused** (name-matching and multi-select), F1's radio list used.
6. **New Contact creation is supported** from the flow, with F1's explicit same-name rules.
7. **Association with the member's own Contact is refused.**
8. **Purpose limit 60 characters**, matching the F2 date label.
9. **Row caps of 8** with "Show all".
10. **Sections not collapsible**; lists are capped instead.
11. **One word changed in the Calendar** (`export` on `readVisibility`).
12. **An existing guard test's expectation updated** (list of writers).
13. **Family reads rows one at a time** with its own `try/catch` instead of calling `loadEvents` / `loadTasks`, so one damaged row cannot hide the rest.

## 12. Not built (by scope)

Family Quick Add, Search, Overview aggregation, Today cards, new Task or Calendar models, new recurrence, Contact editing, Contacts & Relationships, school records, documents, tablet / Command Station / publishing / sharing controls, Finance changes, hosting changes, F4.

## 13. Documentation

`docs/CHATGPT-HANDOFF.md` updated (new top notice, phase bullet, F3 delivered-functionality entry, test baseline). `docs/BACKLOG.md` updated (new status entry on top). F0 to F2.1 history is preserved.

## 14. Exact Git status

`HEAD` = `origin/main` = `1208f05ed92130368a3976647fd25f8a99a1b86f`. **Nothing staged, committed, pushed or deployed.** At the end of the build `git status --short` showed (documents added after this check are listed in the next paragraph):

```
 M src/lib/backupSummary.ts
 M src/modules/calendar/useCalendarData.ts
 M src/modules/family/MemberPage.tsx
 M src/modules/family/family-guards.test.ts
 M src/modules/family/family.css
?? src/modules/family/ImportantContacts.tsx
?? src/modules/family/MemberSections.tsx
?? src/modules/family/family-f3-a11y.test.tsx
?? src/modules/family/family-f3-contacts.test.ts
?? src/modules/family/family-f3-guards.test.ts
?? src/modules/family/family-f3-schedule.test.ts
?? src/modules/family/family-f3-sync.test.ts
?? src/modules/family/family-f3-work.test.ts
?? src/modules/family/importantContactData.ts
?? src/modules/family/importantContactModel.ts
?? src/modules/family/memberSchedule.ts
?? src/modules/family/memberWork.ts
```

Plus this report, `docs/CHATGPT-HANDOFF.md` and `docs/BACKLOG.md` (modified or new, unstaged).

## 15. Recommendation for release

**Recommend independent review, then release if approved.** The change is additive and read-only except for one new, tightly scoped record kind that rides the existing `moduleRecords` persistence; it was exercised through the real sync engine and the real backup and restore code. Points a reviewer may want to look at first: the hidden-calendar rule (judgment call 1), the read-only Projects choice (2), and the one-word Calendar export (11). Real-device and screen-reader checks remain the owner's. **Nothing may be committed or pushed until the owner explicitly authorizes it after review.**

---

## 16. Final release verification (2026-11-09)

Decision received: **APPROVED FOR FINAL RELEASE VERIFICATION**. Sections 1 to 15 above are the original implementation report and are kept unchanged (including section 14's pre-release Git status).

**Repository gate (re-checked):** branch `main`; `HEAD` = `origin/main` = `1208f05ed92130368a3976647fd25f8a99a1b86f` after `git fetch`; Pages run #82 for that SHA `completed` / `success` (public Actions API; attempt 3); the working tree held exactly the 20 paths listed in section 14 (no unexpected commits or unrelated changes). Released baseline for F3 is 3,879 tests in 216 files (the figure from section 9).

**Targeted browser verification** (separate origin `localhost:5199` with an empty profile, fictional data; real clicks through the Calendar, Family and Tasks screens, data seeded by writing to IndexedDB then reloading):

| # | Check | Result |
|---|---|---|
| 1 | Schedule shows the member's events (and not an unrelated person's) | PASS |
| 2 | A weekly event with one occurrence deleted through the Calendar's own "Delete, This event" | PASS: 17 Nov is absent |
| 3 | One occurrence moved through the Calendar's own editor ("This event", 24 Nov to 25 Nov) | PASS: listed on Wed 25 Nov, not 24 Nov |
| 4 | A switched-off calendar | PASS: its event omitted, "1 upcoming event is not shown…"; back on when the preference is cleared |
| 5 | To do shows linked open Tasks without copying them | PASS: 2 tasks (one overdue, one shared with another member); the unrelated person's task absent |
| 6 | Clicking an event opens the Calendar's editor for that occurrence | PASS: "Edit event", Soccer practice, 2026-11-25 |
| 7 | Clicking a Task opens that Task | PASS: Tasks' "Task" dialog, title "Sign form" |
| 8 | Clicking a Project opens that Project (actually clicked this time) | PASS: `#/projects/<id>`, heading "Backyard fort" |
| 9 | Add (existing Contact), change purpose, remove (confirmation), show removed and put back; a same-named new Contact without the explicit tick | PASS; the same-name attempt was refused with the Contact count unchanged (4) |
| 10 | No change to unrelated records | PASS: a snapshot of every non-Family `moduleRecords` row, every Contact, every link and every transaction taken before the click-throughs and association edits was byte-identical afterwards |
| 11 | 375 and 320 px, light and dark | PASS in all four combinations: no horizontal overflow, no control under 44 px (375 dark and 320 light measured in full), the eight sections present, no console errors |

**Targeted correction (one, wording only):** the hidden-calendar note read "Switch them on…" even for a single calendar; it now reads "You can switch it/them back on under Layers in the Calendar." Not re-viewed in the browser; the Family suites were re-run.

**Integrity verification (code and tests, no new audit):** Calendar and Task associations use the existing Contact ids (`contactIds`); recurrence, skip and override come from the Calendar's `occurrencesOf` (tested through the real Calendar write functions and re-seen in the browser); Projects are matched only through `vendorContactIds`; Family adds no event, Task or Project model (guard tests: Family writes only `moduleRecords`, plus one new Contact when asked); important contacts are `family/contact` rows with exactly four fields; a same-named new Contact is never merged (tests and the browser check above); removal archives the association and never touches the Contact (tests and browser); unknown fields and unreadable records are preserved (tests, including backup round trip and sync); backup, restore and encrypted-sync tests are green; no Finance, schema (Dexie v15), sync-format, backup-format or dependency change (`src/db.ts`, `src/lib/sync`, `package.json` untouched).

**Accepted decisions:** the member Schedule and To do are read-only; Projects use the existing Contact association (`vendorContactIds`); important-contact associations are separate records, never duplicate Contacts; inline Task completion and Contact editing remain deferred.

**Retained roadmap and backlog (recorded, not built):** Contacts & Relationships C0 (architecture and discovery), C1 (central directory and safe Contact editing), C2 (organization and relationship context), later Personal CRM; a navigation refinement after C1 (a flat, labelled module selector); a Projects label item ("People and vendors"); the Family Command Station stays a separate initiative with restricted, finance-isolated data access.

**Release:** see the commit and the Actions tab (not recorded here, to avoid a second commit). Remaining for the owner: real-device and screen-reader acceptance.
