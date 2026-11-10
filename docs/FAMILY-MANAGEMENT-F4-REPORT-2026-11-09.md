# Family Management F4: household overview, upcoming activities and responsibilities

**Date:** 2026-11-09. **Status: BUILT AND TESTED LOCALLY. UNCOMMITTED, NOT STAGED, NOT PUSHED, NOT DEPLOYED. Awaiting independent (ChatGPT) review.** Not real-device tested, no screen reader used.
All names and dates in the tests and browser checks are invented.

## 1. Summary

The existing Family page (`#/family`) is now a read-only household coordination page. Under the member cards it shows, in plain words:

- **Activities, next 7 days:** Calendar events that name an active household member. One row per event occurrence however many members it names; every member is listed by name and colour. Repeating series, skipped dates and moved dates come from the Calendar's own engine. Events on calendars the owner has switched off on this device are counted, never listed.
- **Responsibilities:** open Tasks that name an active household member, one row per Task, overdue first, then dated, then undated. Worded "Associated with", never "assigned", because Tasks has no assignment field. Nothing can be completed or edited here.
- **Birthdays and dates, next 30 days:** F2's own list (member birthdays and important dates), with the person each is about.
- **Optional "Show" filter** (Everyone by default) that narrows all three sections by one person. It lasts for the visit only and is not stored or synced.

Every row opens the screen that owns it (Calendar occurrence, Task, member profile, Family dates). No Calendar event, Task, Contact or Family record is created, copied, changed or timestamped by reading. No schema change (Dexie is still v15), no sync or backup format change, no new dependency, no Finance access, no tablet or sharing anything.

Result: **4,135 tests in 232 files** (+64 tests, +3 files on the released 4,071 in 229). `npx tsc --noEmit`, `npm run build` and `git diff --check` are clean (section 10 has the exact runs).

## 2. Release gate and deployed C2 SHA

Verified before any code was written:

| Check | Result |
|---|---|
| Repository | `origin` = `https://github.com/marshmond/ledger.git` (`marshmond/ledger`) |
| Branch | `main` |
| Local HEAD = `origin/main` (after `git fetch`) | yes, both **`f636d16a615520755e2eb99e8d2ae53295d403ad`** (`feat(contacts): C2 cross-module references and safe selection`) |
| C2 committed and pushed | yes (it is HEAD and equals `origin/main`) |
| GitHub Pages for that exact commit | public Actions API (`gh` is not installed here): run **#86**, `head_sha` = `f636d16…`, `status` completed, `conclusion` **success**. Runs #82 to #85 (F2.1, F3, C1, N1) are also green |
| Working tree clean | yes (`git status --short` printed nothing before the first edit) |
| F1 to F3, C1, C2 and N1 present | yes (Family member, date, important-contact and schedule/work readers, C1 Spouse and "This is me", C2 contact references, N1 grouped selector, all in `main`) |
| Released test baseline | The documented C2 final figure is **4,071 in 229 files**. I did **not** run the suite on a clean checkout before editing. It is consistent: this batch added exactly 3 test files (229 + 3 = 232) and 64 tests (4,071 + 64 = 4,135), and the first full run (before two test-file fixes, section 10) reported 4,134 passed plus the one rule failure described there |

Documents read first: `CLAUDE.md`, `docs/CHATGPT-HANDOFF.md` (top notice, snapshot, invariants, change log), `docs/BACKLOG.md` (top), the F0 plan (in full), the F3 report (in full), and the F1, F2, C0, C1, C2 and N1 reports' scope and decision sections through the handoff; plus the Family, Calendar, Tasks and Today source listed in section 3.

**F0 scope check (no stop).** The F0 plan lists F4 as: Overview ("This week" by person, "Coming up", "Needs attention" counts, "Important contacts", "Initiatives"), a Search source, Quick Add `fam`, an optional counts-only Today card, and one shared pure "family view" reader with an `audience` parameter (`display` unused). This prompt is narrower: it excludes Search and Quick Add, makes Today conditional, asks for three summary sections plus members, and forbids any display projection. I judged that a **narrowing**, not a conflict: the F0 architectural decisions (Contact is the identity, no new table, Calendar and Tasks are the sources of truth, nothing shared by default) are all kept. What is therefore not built, and should be read as deferred rather than dropped: Search, Quick Add, the counts-only "Needs attention" block, the per-member "Important contacts" and "Initiatives" blocks on the overview (they stay on the member page from F3), and the `audience` parameter (adding an unused parameter now would be speculative; the shared reader is pure, so it can be added in the Command Station design). If the reviewer reads this as a material conflict, please say so; nothing is committed.

## 3. Files changed

New (all in `src/modules/family/`):

| File | What it is |
|---|---|
| `householdOverview.ts` | Pure builders (`householdPeople`, `buildHouseholdActivities`, `buildHouseholdTasks`, `buildHouseholdDates`, `buildHouseholdOverview`, `forPerson`) and the one read-only reader `readHouseholdOverview` |
| `HouseholdSections.tsx` | The three sections (activities, responsibilities, dates) as read-only lists |
| `family-f4-overview.test.ts` (35), `family-f4-render.test.tsx` (15), `family-f4-guards.test.ts` (14) | 64 tests |

Edited:

| File | Change |
|---|---|
| `OverviewPage.tsx` | Adds one live query, the optional "Show" filter and the three sections; the member cards, Me-conflict and duplicate warnings, past members, needs-review and add flow are unchanged |
| `memberSchedule.ts` | **Exports only plus one extraction:** `readEvents` and `activeByContact` are now exported, and the row-building block of `buildMemberSchedule` moved, unchanged, into the exported `scheduleItemOf` so the member page and the overview build a row identically. No new import, no write path |
| `memberWork.ts` | `readTasks` is now exported (one word) |
| `family.css` | Styles for person chips, the filter and phone-size footer links |
| `family-f3-guards.test.ts` | One expectation: the list of files allowed to use F3's readers now includes the two new overview files (they are the new readers' users) |

Not touched: `src/db.ts`, any sync file, backup format or summary, Finance, Tasks, Projects, Today, Calendar code, `package.json`, `index.tsx` (no new registration).

## 4. Overview design

Order on `#/family`: header (Add member and Family dates unchanged) → Me-conflict and duplicate warnings (unchanged) → **In the household** (active member cards, unchanged: name from the Contact, role including Spouse, colour dot with the colour NAME in text, "This is you", birthday, link to the profile) → optional **Show** filter → **Activities, next 7 days** → **Responsibilities** → **Birthdays and dates, next 30 days** → Past members → Needs review.

- **"This is me":** unchanged and only the effective one. With two competing marks the existing warning shows and the cards say "This is you" for nobody (browser-checked). Reading never rewrites.
- **Active versus past:** only active, readable members count as the household; past members keep their own section, and their events and Tasks are not summarized.
- **Names** come from the shared Contact (a bulk read of just the members' Contacts, name field only). A member whose Contact is gone is shown as "Contact no longer exists", as before.
- **Empty states** are plain sentences for each section, for everyone and for a single person. No members: the page keeps its existing "No family members yet" state and shows no summaries. Only past members: the household card says nobody is in the household and the summaries do not appear (date records that remain are still shown).
- **Layout:** the same `card` / `fm-items` row pattern as the member page, so it matches the design system. Rows show 6 by default with "Show all N" (which stops at 50 and then points to the owning screen), plus an "Open the Calendar" / "Open Tasks" / "All family dates" link per section.
- **Privacy on rows:** no phone, email, Contact notes, member note, birth year, age or event location is read into or shown by the overview (guard and content tests).

## 5. Schedule aggregation

- **Association:** `event.contactIds` contains an active member's Contact id (Contact ids only, never names).
- **One pass:** one indexed read of the Calendar's live events (F3's `readEvents`, row by row with the Calendar's own `asEvent`), one read of the layers, then the Calendar's own `occurrencesOf` for today through today + 6. Not one query per member.
- **Window:** `ACTIVITY_DAYS = 7`: today and the six days after it. A multi-day event already under way is included once.
- **Identity and de-duplication:** key = `<eventId>:<original occurrence date>`. An event naming two members is one row listing both (name order, colour dot with the name in text, each name a link to that profile). The same person listed twice, or two member records for one Contact (a duplicate from two devices), count once. Two different events with the same title and the same people stay two rows (tested).
- **Skipped, modified, rescheduled:** exactly the Calendar's output, tested with the real Calendar write functions (`removeOccurrence`, `saveEdit`) and seen in the browser: a skipped occurrence is absent, a moved one shows its new day while keeping its original-date key.
- **Deleted, retired, damaged:** deleted and retired events are not listed; a null or wrongly typed row is skipped without hiding the others (tested); an event whose calendar no longer exists is listed in a neutral colour.
- **Navigation:** each title is the Calendar's own `open` link (`#/calendar?v=agenda&d=<day>&open=e:<id>:<original date>`); confirmed in the browser that clicking opens "Edit event" for the right event.
- **Calendar visibility:** the owner's device-local "calendars switched off" preference (the same one F3 uses, read through the Calendar's exported `readVisibility`). A hidden calendar's occurrences are counted once each and explained ("1 upcoming activity is not shown because its calendar is switched off on this device. You can switch it back on under Layers in the Calendar."), never listed. The person filter counts only that person's hidden items. No new Family visibility setting exists.
- **Stored Birthday events:** a Calendar event of type Birthday for the same Contact on the same day as that person's Family birthday is the same fact, so it is **not repeated as an activity**; the birthday appears once, in the dates section (judgment call 3).

## 6. Task aggregation

- **Association:** `task.contactIds` contains an active member's Contact id. Wording on the page: "Associated with", and an explicit line that Ledger does not record who has to do a task.
- **Rules reused from Tasks:** `isOpen`, `isOverdue`, `sortTasks(…, 'due')`. Open means not done (waiting and in-progress are open and labelled).
- **Order:** overdue first (earliest first), then every other open task in Tasks' own due order (dated by due date, else "do on" date, soonest first, ties by priority then title), undated last. Because overdue is separated first, a task that only has a past "do on" date is not mixed in front of a truly overdue one (judgment call 8).
- **Recurring Tasks:** a repeating Task is one record that Tasks advances when it is completed. Tested with Tasks' own `completeTask`: after completing, the row becomes the one successor, and the count of stored Task rows shows only Tasks created it.
- **Several members:** one row, all associated members listed.
- **Words, not colour:** "Overdue" and "High priority" are bold words (red tone only as a second cue); Repeats, Waiting and In progress are words.
- **Navigation:** `#/tasks?task=<id>` (clicked in the browser: Tasks opened the right Task). **No completion control and no input** on the section (a render test and a guard test).
- **Scope:** only Tasks that name a member; Projects and event titles are never used to infer responsibility (the F3 project reader is not used here).

## 7. Birthday and date integration

Reuses F2's `upcomingRows` unchanged (so the leap-day rule, the one-per-Contact rule for duplicate member records, and "active members only" for birthdays are F2's), cut to today through today + 30 (`DATE_DAYS`). Each row carries the person it is about (a coloured, named link to the profile) and links: a birthday opens the member; a date about a member opens that member; a household-wide date opens Family dates (the only date route that exists). Nothing is stored, no reminder, Task or Calendar event is made. Titles carry a name or label only: tests serialize the whole overview and find no birth year, age, member note, phone, email or Contact note.

Leap day: tested for 2027 (28 February) and 2028 (29 February) through the overview. Past members: no birthday; a date record about a past member stays listed until archived (F2's policy), named but not attached to a household person.

## 8. Optional member filter decision

**Built**, because it was small: a labelled "Show" drop-down (Everyone first and default) over the active members, shown only when there are two or more. `forPerson` is one pure function applied to all three sections, so they always agree (tested: activities, tasks, dates and the hidden-calendar count). It is local to the visit (React state), is not saved, synced or added to `PREFERENCE_KEYS`, and resets to Everyone if the chosen person leaves the household. Household-wide dates (no member) are not shown under a person filter because they are not that person's. It does not narrow the member cards. It is deliberately not a framework and has no tablet or sharing meaning.

## 9. Today integration decision

**No new Today card.** Verified in source: Today builds its dated items from every registered due provider (`TodayData.tsx` iterates `allDueProviders()`), and the Family provider (F2) already puts member birthdays and important dates on Today with stable ids and the stored-birthday coordination. Events and Tasks already appear in Today through Calendar and Tasks. A Family card would repeat all three. The guard test still pins "no Today card, search source or Add-box destination" for Family.

## 10. Tests and browser verification

**Behaviour tests (64 new).**

| Required topic | Where |
|---|---|
| 1 active and past members | `family-f4-overview` "the household" (past excluded; events and Tasks not summarized) |
| 2 Spouse and This is me | same (role `spouse`; the one effective `isMe`) |
| 3 conflicting Me | same (two marks: nobody is me, snapshot unchanged) |
| 4 activities across members, window edges | "activities: the next seven days" |
| 5 shared event de-duplication | same (one row, both people; same person twice; two same-title events stay two) |
| 6 recurring occurrences | same (equals the Calendar's `occurrencesOf`; 30 daily series are 7 rows each) |
| 7 skipped and rescheduled | same (real `removeOccurrence` and `saveEdit`) |
| 8 Calendar visibility | "calendars switched off" (counted not listed, shared hidden counted once, deselect all, per-person count) |
| 9 open Task aggregation | "responsibilities" |
| 10 overdue and recurring Tasks | same (real `completeTask`) |
| 11 Task for several members | same (one row, all named; association removed and deleted) |
| 12 undated Task ordering | same (full order with overdue, past do-on, same-day priority, undated last) |
| 13 birthdays and important dates | "birthdays and important dates" (30-day edge, past member, archived, switched off the Calendar, stored Birthday event shown once) |
| 14 leap day | same (2027 → 28 Feb, 2028 → 29 Feb) |
| 15 empty household and empty sections | "empty, missing and damaged data" and the render tests' empty states |
| 16 missing and malformed references | same (null and mistyped Calendar and Task rows, unreadable member and date rows, deleted Contact, duplicate member record) |
| 17 stable deep links | `family-f4-render` (Calendar `open` link, `#/tasks?task=<id>`, member and dates routes; exact hrefs) |
| 18 read-only and unchanged timestamps | "reading is read-only" (byte snapshot of **every table**, timestamps included, before and after, with Finance rows present) |
| 19 no Finance access | same snapshot test plus `family-f4-guards` (no Finance import or table in the new files; only the Contact **name** is read; the types carry no phone, email or notes) |
| 20 mobile accessibility and theme | `family-f4-render` (named regions, one `h2` each, no skipped level, every link and button named, dots are `aria-hidden`, names always in text) plus the real-browser checks below; the CSS uses the app's colour variables only |

Also guarded: no new table or migration (schema still version 15), registration unchanged (no Today card, search source or Add-box entry), the overview code is reached only from the lazily loaded page, the two edits to F3's readers add no write path, and Calendar, Tasks, Today and Projects still do not import Family.

**Commands.** Focused Family suites first (19 files, 308 tests green). Then, once as asked: `npm test`; `npx tsc --noEmit`; `npm run build`; `git diff --check`; `git status --short`.
- **First full run:** 4,134 passed, 1 failed, in 232 files. The failure was an existing repository rule (`src/lib/leakScanGuard.test.ts`): two of my new assertions looked for short digit strings in text without using the project's `scanText` / `scrubGeneratedIds`. I changed both to use them. That run's `tsc` also found a type cast in my test file; fixed.
- **After the fixes:** the four affected suites (69 tests) re-ran green, `tsc --noEmit` is clean, and the full `npm test`, `npm run build` and `git diff --check` were re-run once more (results below).
- **Final results (after the last edit to any code or test file):** `npm test` **4,135 passed in 232 files** (all green, about 57 s); `npx tsc --noEmit` clean; `npm run build` succeeds (the existing chunk-size warning remains); `git diff --check` exit 0 (only the usual LF/CRLF notices). The handoff, backlog and this report were edited after those runs; they are documents and cannot affect them.

**Browser (built-in browser pane, dev server on `localhost:5198`, a fresh origin with an empty profile; invented data).** Seeding used the app's own data modules loaded in the page (the Calendar, Tasks and Family create functions, and the Calendar's real `removeOccurrence` and `saveEdit` for the skip and the move), not the forms; the data was written, then the page reloaded (it does not notice outside writes until a reload, as in F3).

| # | Check | Result |
|---|---|---|
| 1 | Active members render (4: parent "This is you", spouse, two children, colours named in text, birthdays) and a past member sits in Past members | PASS |
| 2 | Spouse and This is me | PASS (Jo shows "Spouse · Purple"; Alex "This is you") |
| 3 | A conflicting second "This is me" | PASS: the existing warning appears, "This is you" appears nowhere (0) |
| 4 | An event naming two members is one row naming both | PASS (Swim meet: Robin Demo, Sam Demo; the all-day picnic: Jo Demo, Sam Demo) |
| 5 | A weekly series shows the right occurrence; a skipped occurrence is omitted; a moved occurrence uses its new date | PASS (Soccer practice today only; Piano lesson's skipped date absent; "Art class (moved)" on Sat 14 Nov, original date key kept; checked in the stored row too) |
| 6 | Events beyond 7 days, a past member's event, and a non-member contact's event | PASS: none listed |
| 7 | A stored Birthday event on the same day as the Family birthday | PASS: the birthday shows once (dates); the ordinary "Sam birthday party" event remains an activity |
| 8 | Hidden calendar layer | PASS: with School switched off the concert is gone and "1 upcoming activity is not shown because its calendar is switched off on this device…" appears |
| 9 | Linked Tasks without duplicates; overdue identified in words | PASS: the shared Task is one row naming both children; "Overdue · High priority" in words; repeating Task says "Repeats"; the unrelated contact's Task absent; undated Task last |
| 10 | Birthdays and important dates | PASS: Sam's birthday, a wedding anniversary (About Alex), Alex's birthday, a household date with no person; the 29 February birthday correctly absent (not within 30 days) |
| 11 | Filter "Robin Demo" | PASS: activities 2, tasks 2, dates 0, counts in the headers agree; Everyone restores all |
| 12 | Click an event | PASS (real click): "Dentist" opened the Calendar's "Edit event" for Dentist |
| 13 | Click a Task | PASS (real click): "Sign permission slip" opened Tasks' editor with that title (my first attempt navigated by typing the address; I repeated it by clicking) |
| 14 | Click a member | PASS: a person chip opened `#/family/m/<Robin's id>`, heading "Robin Demo" (done with a script `click()` on the link, not a pointer click) |
| 15 | No unexpected writes | PASS: a full snapshot of every table (including timestamps) taken before the reload, "Show all", the filter, the hidden-layer change and the clicks was byte-identical afterwards |
| 16 | 320 and 375 px, light and dark | PASS in all four (no horizontal overflow; 0 controls under 44 px after one fix: the three footer links were 28 px and now are 44 px); 320 light and 375 dark screenshots viewed |
| 17 | Light and dark themes | PASS (dark at 375: background and link tones from the app's variables, readable) |
| 18 | Console | PASS: no errors or warnings logged |

**Not browser-verified:** the overview's empty states (covered by render tests only), the person filter for a person with no Tasks, "Show all" with more than 6 Tasks (6 Activities were exercised), the 29 February birthday in the browser (tests only), screen reader, real phone, keyboard walk. The browser tool's data came from one pane profile only.

## 11. Privacy and data-integrity checks

- Read-only: no write, transaction, storage, network or logging call in `householdOverview.ts`, `HouseholdSections.tsx` or `OverviewPage.tsx` (guard test); the byte-snapshot tests and the browser snapshot show no row changed.
- Reads only: Family members and dates, Calendar events and layers, Tasks, and Contact **names**. Not read: Finance tables, Contact phone, email or notes, the member's private note, Projects.
- The new files use no clock (`today` is passed in; guard test).
- Contact ids everywhere; no name matching; two members with the same name stay separate (they are listed identically by name, see limitation 6).
- No new table, migration, sync or backup change; no new device preference (the filter is page state). The Calendar's existing switched-off-calendars preference is read, never written.
- Future Command Station: nothing here is a projection. The pure builders could become the allow-list reader later, with the `audience` rule added at that point.

## 12. Known limitations

1. Not real-device tested; no screen reader; no second physical device.
2. The 7-day and 30-day windows are fixed (no settings, no earlier dates).
3. Calendar visibility is a device-local preference: another device may show different activities. Changing it in another tab while the overview is open is not seen until the page is reloaded.
4. Dates about a past member stay listed until archived (F2's policy); they are named but not attached to a household person.
5. Household-wide dates disappear under a person filter.
6. Two different people with the same Contact name look identical in the "Show" list and on rows (the member cards share this); Ledger never merges them.
7. A Calendar row that is `null` still crashes the Calendar's own reader (existing); Family skips such rows.
8. "Show all" is capped at 50 rows; beyond that the owning screen has the rest.
9. The overview does not show Task or event details such as notes, locations, checklists or projects.
10. A Task with only a past "do on" date is listed after the truly overdue ones and is not called overdue (Tasks' own definition).
11. Real-time updates rely on the database's live queries; the browser data was seeded by direct writes, so live refresh from outside writes was not demonstrated.

## 13. Judgment calls (please review)

1. **Windows:** activities = today through today + 6 (7 days); dates = today through today + 30 inclusive (the same reach as a member's Schedule).
2. **Hidden calendars follow F3:** counted per occurrence, not listed; no Family-specific setting.
3. **Stored Birthday event versus Family birthday:** shown once, as the date row. This is the opposite of the Calendar's own rule (there the stored event wins and the Family marker is hidden). The overview needs the date row anyway (30 days against 7 for activities), so the activity is the one left out.
4. **Birthdays switched off the Calendar are still listed** (as on the Family dates page) and say "Not on my Calendar".
5. **The Family layer's visibility on the Calendar is not applied** to the dates (it is Family's own data, not an activity).
6. **Past members:** no birthday; their date records stay until archived (F2).
7. **Filter** is a drop-down in page state; household-wide dates are hidden under a person filter; member cards are not filtered.
8. **Task order:** overdue first by partition, then Tasks' own order.
9. **Preview of 6 rows** (F3 used 8) with "Show all" capped at 50 and a link to the owning screen.
10. **Event location omitted** from overview rows (minimum information).
11. **F3 files edited by exports and one extraction** (`scheduleItemOf`), and one F3 guard expectation updated; no behaviour change (the F3 suites pass unchanged).
12. **No Today card, Search source or Quick Add.**
13. **Member cards untouched:** they already satisfied the member-summary requirements.
14. **"Associated with" wording** for Tasks; "People:" for events (the Calendar's own word).

## 14. Not built (by scope)

Family Quick Add, Search contributions, a Today card, F5 integration, a second Family Calendar, a task assignment engine, completion from the overview, new Task or Calendar models, recurrence changes, ContactPicker changes, C3, Contact interaction history, notifications, multi-user accounts, Command Station, tablet publication, new Finance functionality, hosting changes, F5.

## 15. Documentation

`docs/CHATGPT-HANDOFF.md` updated (new top notice, current-phase bullet, F4 delivered-functionality entry, baseline, risks, next action and change-log entry). `docs/BACKLOG.md` updated (new status entry on top). F0 to C2 history is preserved. **F5 remains the next Family phase** (not started, not authorized).

## 16. Exact Git status

`HEAD` = `origin/main` = `f636d16a615520755e2eb99e8d2ae53295d403ad`. **Nothing staged, committed, pushed or deployed.** `git status --short` at the end of the build:

```
 M docs/BACKLOG.md
 M docs/CHATGPT-HANDOFF.md
 M src/modules/family/OverviewPage.tsx
 M src/modules/family/family-f3-guards.test.ts
 M src/modules/family/family.css
 M src/modules/family/memberSchedule.ts
 M src/modules/family/memberWork.ts
?? docs/FAMILY-MANAGEMENT-F4-REPORT-2026-11-09.md
?? src/modules/family/HouseholdSections.tsx
?? src/modules/family/family-f4-guards.test.ts
?? src/modules/family/family-f4-overview.test.ts
?? src/modules/family/family-f4-render.test.tsx
?? src/modules/family/householdOverview.ts
```

## 17. Recommendation for release

**Recommend independent review, then release if approved.** The overview is read-only and additive: no new data, table, setting or sync surface, and the Calendar, Tasks and Family writers are untouched. Points a reviewer may want to look at first: judgment call 3 (the stored Birthday event versus the Family birthday), 2 and 5 (visibility), the one extraction in `memberSchedule.ts` (11), and the Task wording (14). Real-device and screen-reader checks remain the owner's. **Nothing may be committed or pushed until the owner explicitly authorizes it after review.**

---

## 18. Final release verification (2026-11-09)

Decision received: **APPROVED FOR FINAL RELEASE VERIFICATION**. Sections 1 to 17 above are the original implementation report and are kept unchanged (including section 16's pre-release Git status).

**Repository gate (re-checked):** branch `main`; `HEAD` = `origin/main` = `f636d16a615520755e2eb99e8d2ae53295d403ad` after `git fetch`; no unpushed commits; Pages run #86 for that SHA `completed` / `success` (public Actions API); the working tree held exactly the 13 reviewed F4 paths (7 modified, 6 new) and nothing else. Baseline re-run on that tree before the verification edits: 4,135 passed in 232 files, `tsc` clean.

**Source review** (final diff read; no refactor made):
1. Read-only: `householdOverview.ts`, `HouseholdSections.tsx` and `OverviewPage.tsx` contain no write, transaction, storage, network or logging call (guard test); the browser snapshot of every table was byte-identical after viewing and clicking.
2. Calendar events and Tasks are read through their own parsers and never copied or written (no create, save or complete call exists in the new files).
3. Occurrence rules come from the Calendar's `occurrencesOf`; Task rules from `isOpen`, `isOverdue` and `sortTasks`.
4. A shared occurrence is one row, keyed `<eventId>:<original date>` (tested and seen in the browser).
5. A Task naming several members is one row listing all (tested and seen).
6. Two distinct events with the same title and people stay two rows: identity is never title or names (tested, "two different events with the same title and people stay two rows").
7. No new storage, preference, schema or sync surface: the filter is React state; schema is still version 15 (guard test).
8. No Finance table, page or engine is touched (guard test and a snapshot test with Finance rows present).
9. F3 member Schedule and To do are unchanged: the diff to `memberSchedule.ts` is two `export` keywords, one added type import and the move of the identical row-building block into `scheduleItemOf`; `memberWork.ts` is one `export`. All F3 suites pass unchanged and the F3 member page was re-driven in the browser (below).

**Birthday and date coordination** (the main judgment call; behaviour preserved as reported, not broadened):
- A stored Calendar Birthday event for the same Contact on the same day as that person's Family birthday appears once, as the Family date row (tested; browser: the stored "Sam Demo's birthday" event is not an activity row while the birthday is in the dates).
- An ordinary event on that day ("Sam birthday party", "Joint party") is still an activity (tested and browser).
- Two different Contacts with birthdays on the same date stay two date rows, and a stored event covers only its own Contact. **Added test:** "two different people with birthdays on the same day stay two date rows…" (browser: Robin and Sam on the same day, two date rows).
- The rule matches on Contact id and day only, never on a title or name.
- Leap day follows F2 (28 Feb in 2027, 29 Feb in 2028, tested). Archived dates and past-member rules are F2's, unchanged (tested).
- Family dates stay on the overview whatever the Calendar layers say. **Added test:** "family dates stay on the overview whatever the Calendar layers are switched to".
- The Calendar's own stored-versus-derived coordination (`markerCoordination.ts`, `dueProvider.ts`) was not modified.

**Targeted browser acceptance** (separate origin `localhost:5197`, empty profile, invented data, seeded through the app's own Calendar, Tasks and Family functions then reloaded; real pointer clicks for the event, Task and member):

| # | Check | Result |
|---|---|---|
| 1 | Active members displayed | PASS (4: parent, spouse, two children) |
| 2 | Spouse and This is me | PASS ("Spouse · Purple"; "Parent · This is you · Green") |
| 3 | Competing Me | PASS: the established warning appears and "This is you" appears nowhere |
| 4 | One shared event, both members, no duplicate | PASS (Swim meet: Robin Demo, Sam Demo, one row) |
| 5 | Skipped occurrence | PASS (the skipped Piano lesson date is absent from the overview) |
| 6 | Moved occurrence | PASS ("Art class (moved)" on Sat 14 Nov) |
| 7 | Stored birthday event plus Family birthday | PASS (no duplicate row) |
| 8 | Ordinary birthday party | PASS (listed) |
| 9 | Hidden calendar activity | PASS (counted: "1 upcoming activity is not shown…", not listed) |
| 10 | Shared Task once with all members | PASS (Pack swim bag, Robin Demo and Sam Demo) |
| 11 | Overdue clearly labelled | PASS ("Overdue · High priority" in words) |
| 12 | Filter consistent | PASS: Robin gives 1 activity, 1 task, 1 date and no hidden-calendar note; Everyone restores all (driven by setting the drop-down value, not a pointer) |
| 13 | Click an event | PASS: "Sam birthday party" opened the Calendar's editor for it |
| 14 | Click a Task | PASS: "Sign permission slip" opened that Task |
| 15 | Click a member | PASS: a person link opened Robin's profile (`#/family/m/<id>`) |
| 16 | F3 member page | PASS: Robin's Schedule lists the Swim meet and the Piano lesson occurrences (the skipped date absent), To do lists Pack swim bag |
| 17 | 320 and 375 px | PASS: no horizontal overflow in all four size and theme combinations. Undersized controls: 0 in the normal state (measured at 375 light and 320 dark after the conflict was cleared); with the Me conflict showing, 2 (see the observation below) |
| 18 | Light and dark | PASS (dark background and link tones from the app's variables; a 320 dark screenshot viewed) |
| – | No writes by viewing | PASS: a snapshot of every table taken before viewing was byte-identical afterwards |
| – | Console | PASS: no errors or warnings |

Not measured in this pass: undersized controls at 320 light and 375 dark in the normal (no-conflict) state; the earlier F4 campaign measured 0 in all four (section 10).

No material issue was found, so no application code was changed. **Observation (not a regression):** the two member links inside the existing C1 "More than one member is marked This is me" warning are 28 px tall on a phone. That block is unchanged C1 code and only appears in the conflict state. Recorded for a later accessibility pass, not fixed here.

**Data integrity and compatibility (existing tests and targeted source inspection):** rows use shared Contact ids; names are read from the shared Contact records on every read (`contacts.bulkGet`), so a name change shows through, and no name is stored; the overview types carry no phone, email, Contact notes or member note (guard and content tests; the seeded private note and phone text never appeared in the page text I read); reads write nothing; no persisted state was added, so backup and encrypted-sync formats are unchanged (`src/lib/sync`, `backupSummary.ts` and `db.ts` are untouched by this batch); C2 contact references, removal and N1 navigation are not touched; Today still receives Family dates through the due provider and no Today card, search source or Add-box entry exists (guard tests); no Command Station, tablet projection or sharing code exists.

**Final regression** (run once on the release candidate, after the two added tests): `npm test` **4,137 passed in 232 files** (4,135 as built plus the 2 added tests); `npx tsc --noEmit` clean; `npm run build` succeeds (existing chunk-size warning only); `git diff --check` exit 0 (LF/CRLF notices only); `git status --short` showed exactly the 13 reviewed paths. This section and the handoff and backlog wording were written before that run and are documents only.

**Accepted decisions (recorded):**
- The Family overview is read-only.
- Activities show seven days (today and the six after).
- Birthdays and important dates show 30 days (today through the 30th day after).
- Shared events and Tasks are de-duplicated by identity (event id plus original occurrence date; Task id), never by title or names.
- The optional member filter is local page state.
- Calendar visibility (switched-off calendars) applies to activities only.
- Family dates stay visible independently of Calendar layer visibility.
- Tasks are described as associated with members, not formally assigned.
- No redundant Today card was introduced.
- Search and Quick Add remain deferred to F5.

**Maintenance items preserved (not built here):** Contact creation safety (Assets, Bills, Projects and Services still match Contacts by name), the mobile Task editor overflow at 320 px, Contact directory performance at scale, and the C2 item about Contacts created from an editor persisting when it is cancelled.

**Remaining owner-device acceptance:** real phone, a second physical device, real sync, offline use and a screen reader.

**Release:** committed and pushed as `feat(family): F4 household overview and coordination`. The SHA and Pages result are read from `git log` and the Actions tab (not recorded here, to avoid a second commit). **F5 remains the next Family phase** (not started, not authorized).
