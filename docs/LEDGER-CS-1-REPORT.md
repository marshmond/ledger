# Ledger CS-1: Secure Display Projection (report, 2026-11-16)

**Status: BUILT AND TESTED LOCALLY. UNCOMMITTED, NOT STAGED, NOT PUSHED, NOT DEPLOYED.** Awaiting review by ChatGPT and the owner. CS-2 is not started. No repository, token, passphrase, pairing code or network call was created.

**Handoff updated: yes** (`docs/CHATGPT-HANDOFF.md`, `docs/BACKLOG.md`, `docs/UI-COVERAGE.md`, the G1 gate report and the owner acceptance record).

---

## A. Executive summary

Ledger can now answer two questions safely, entirely on this device:

1. **Which household information has the owner explicitly authorized for a shared family display?** Everything starts private. The owner chooses, item by item or calendar by calendar, in Settings > Family display and in the event and Task editors. Choices are saved as append-only records (nothing is ever edited or deleted), so a revocation cannot be undone by an out-of-date device.
2. **What is the exact dataset that could be published?** A version-1 projection is built field by field from narrow source types and shown as a **local preview, labeled "not published"**. A validator rejects any unknown field, bad date, bad person reference, wrong count or wrong digest.

What the owner can do now: show or hide single events and Tasks; show a whole calendar after reading a plain explanation and a list of what would become visible; show an event as "Busy" (date and time only); keep one event private on a shared calendar; allow birthdays and important dates (name and date only); allow a household-service visit or a maintenance reminder under a name the owner types; hide everything with one switch; and see the exact preview.

What is deliberately not here: any tablet app, any publishing, any repository, any credential, any email, any external calendar, any new database table or migration, any Finance information.

## B. Baseline

| Item | Result |
|---|---|
| Branch / HEAD | `main`; HEAD = `origin/main` = `1fec899d9143fe313b0ce8465f1db21f77b02763` (CS-0.1 closeout). Verified at the start of both the gate check and the build. |
| Deployment of that commit | Pages run #127, completed, success (public API; `gh` is not installed). |
| Working tree at start | Only the three protected untracked files. They are untouched: `docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`. |
| Test baseline | 309 files, 6,085 tests (R4.2 baseline in the handoff). |
| Gate G1 | **First attempt stopped at the gate** (owner checks not documented). Then **the owner reported all four G1 checks complete** (steps 12, 13, 16 and device versions) **and approved L-2, L-3, L-4, L-6 and L-11 with the recommended defaults.** This is owner-reported, not tested by Claude. Per-device results were not supplied and none are invented here. The Part D results table in the owner acceptance record is intentionally left unticked; a note records the owner's report. |

## C. Architecture

```
 grants (moduleRecords: module 'display', kind 'grant')   <- append-only, immutable
        |
        v
 resolveGrants()      pure: heads via `supersedes`, hide wins, fail closed          src/display/grants.ts
        |
        v
 readDisplayState()   asks each SOURCE only for subjects that are shown              src/display/readState.ts
        |   Calendar events   -> existing occurrencesOf (no second recurrence engine)
        |   Tasks             -> existing Task model + repeat chain (modules/tasks/chain.ts)
        |   Family            -> registered narrow reader (core/displaySources.ts, modules/family/displayRead.ts)
        |   Services visits   -> schedule-only reader (modules/services/displaySchedule.ts)
        |   Maintenance       -> schedule-only reader (modules/assets/displaySchedule.ts)
        v
 buildProjection()    field by field from narrow types; opaque keyed ids          src/display/build.ts
        |
        v
 validateProjection() exact keys, dates, refs, counts, digest, limits             src/display/contract/index.ts
        |
        v
 Settings > Family display (local preview)                                         src/pages/FamilyDisplayPage.tsx
```

**New files** (all uncommitted):

| File | Purpose |
|---|---|
| `src/display/grants.ts` | Decision format, subject names, resolver, per-item effective state, history comparison. Pure. |
| `src/display/grantStore.ts` | Reads and APPENDS decisions; the series-split carry; the global switch. |
| `src/display/eligibility.ts` | The structural exclusions (Finance-type, unknown type, retired, project, linked, derived calendar). Pure. |
| `src/display/readState.ts` | The reader that applies decisions to each source and builds the narrow inputs and the owner's report; the calendar-sharing preview. |
| `src/display/editorStatus.ts`, `linkModules.ts` | Small helpers the editors use (so the editors do not load the whole preview builder). |
| `src/display/build.ts` | The projection builder and its narrow input types. |
| `src/display/contract/index.ts` | Version-1 contract: types, key lists, canonical JSON, digest, opaque ids, validator, plain-JSON codec. Imports nothing outside its folder (a test checks). |
| `src/display/DisplayControl.tsx`, `display.css` | The "On the family tablet" control and the page styles (tokens only). |
| `src/pages/FamilyDisplayPage.tsx` | Settings > Family display. |
| `src/core/displaySources.ts` | The neutral registry through which the display layer reads Family (see J.2). |
| `src/modules/family/displayRead.ts` | Family's own narrow reader (names, color ids, coarse group, dates only). |
| `src/modules/services/displaySchedule.ts`, `src/modules/assets/displaySchedule.ts` | Schedule-only readers (`{date, time}` and nothing else). |
| `src/modules/tasks/chain.ts` | The repeat-chain root of a Task. Pure. |
| `src/display/*.test.ts`, `displayTestkit.ts` | 116 new tests. |

**Edited existing files** (small): `src/modules/calendar/data.ts` (carry the decision on a series split, inside the existing transaction), `EventEditor.tsx` and `TaskEditor.tsx` (the control), `CalendarSettings.tsx` (a link), `src/modules/family/index.tsx` (one import that registers the reader), `src/modules/services/dueProvider.ts` (one word: `export`), `src/pages/SettingsPage.tsx` (a sixth page), `src/lib/backupSummary.ts` (counts the new record kind under Family), `docs/UI-COVERAGE.md` and `src/shell/uiCoverage.test.ts` (the tracker row G-06 and the guard that enforces it).

**Not touched:** the database schema (still Dexie v15, no migration, no new table), the sync engine, `familyView.ts` (R4.2: `buildFamilyView('display')` still throws and its tests pass unchanged), Finance, Bills, Projects.

### Compatibility audit of the new record kind (done before building)

| Area | Finding |
|---|---|
| Module-record readers and writers | Every reader selects by `[module+kind]`; none enumerates modules by name. The new kind is invisible to them. |
| Backup and restore | `exportAll` / `importAll` carry all of `moduleRecords`. The summary now names the kind under Family; an older build shows it under "other data". Tested: plain and encrypted round trips are exact. |
| Sync merge | `moduleRecords` merge by id with whole-record last-writer-wins; grant ids are unique, so devices UNION their decisions. The only module-specific rules are for projects and assets. Tested with the real `SyncEngine`. |
| Unknown module handling | An older build carries unknown rows through byte for byte (tested). The module name `display` is new to an older build only in its summary label. |
| Conflict reporting | The labeler falls back to `#<id>` for a record with no `name` or `title`. A conflict notice on a decision would read that way; decisions are never edited, so this arises only after a restore touches both devices. Noted, not changed. |
| Deletion cleanup | The only whole-table scans (`contactRemoval`, `contactUsage`, `services/undo`) look for Contact ids inside record data; decisions hold only member ids and decision ids, which are time-based unique numbers. No cleanup removes decisions. |
| `touchAll` after a restore | Bumps `updatedAt` on every row, including decisions. The data inside a decision is not changed. |
| Older-build compatibility | An older build simply does not know the records. It cannot create decisions, and it cannot erase them (tested). Limits in section K. |

## D. Display eligibility

**Decision record** (`moduleRecords`, module `display`, kind `grant`): `v`, `subject`, `decision` (show or hide), `level` (details or busy), `label` (the owner's display text), `people` (member ids, visits and reminders only), `titleAtGrant` (the title when approved, kept inside Ledger only, so the editor can say "the title changed"), `supersedes` (the decision ids this device had seen for that subject) and a random per-page-load `deviceId`.

**Subjects:** `event:<id>`, `calendar:<id>`, `task:<root id>`, `visit:<arrangement id>`, `reminder:<plan root id>`, `dates:all`, `dates:<member id>`, `date:<important date id>`, and `all` (the global switch).

**Resolution rules** (all tested in `grants.test.ts`):

- No decision means private. Unknown version, unknown word, unreadable fields, a record a sync marked deleted, or a loop of decisions: that subject is **hidden** and flagged for the owner.
- A subject's decisions form a graph by `supersedes`. The current ones ("heads") decide. Any head that says hide means hidden (concurrent hide and show: hidden). All heads show: shown, at the narrowest level (Busy beats details), with only the people all heads agree on.
- **Timestamps are never used.** A test gives an old approval a far-future timestamp and a revocation an old one; the revocation still wins.
- A decision cannot supersede another subject's record.
- An event's own decision beats its calendar's. A per-event hide beats a shared calendar. A new event on a shared calendar is eligible. A calendar that is not a local one, or no longer exists, grants nothing.
- The global switch overrides everything (and an unreadable global record counts as on). Turning it off is a new decision; nothing is deleted.
- A visit or reminder is shown only with an owner-typed label.

**Calendar-level sharing:** the dialog says every event "including events you add or move here later" can appear, with title, date, time and people; that notes, places and anything outside Calendar never appear; lists every event that would become eligible (count and titles, or "Busy"); lists events kept private and events that are not eligible (and why); adds a warning for the Personal calendar; requires an explicit confirmation; and can be reversed at any time (the "stop showing" dialog says how many events are shown only because of the calendar). Cancelling writes nothing (tested and seen in the browser).

## E. Projection contract (version 1)

Exactly the CS-0.1 F.6 fields; no others: `format`, `version`, `minReader`, `revision`, `publishedAt`, `generatedFor{tz,today}`, `window{from,to}`, `household{label}`, `prefs{weekStart}`, `people[{id,name,color,group}]`, `sources[{id,label}]`, `entries[{id,source,title,allDay,start,end,people,repeat,status}]`, `tasks[{id,title,due,status,people,repeat}]`, `grantsSeen[]`, `counts`, `digest`. Window: 14 days back to 120 ahead. Limits: 2,000 entries, 300 Tasks, 500 KB, 5,000 history ids. **Over a limit the builder throws; nothing is cut.**

- **Source adapters** return their own narrow types. Calendar: title, all-day flag, start and end, repeat flag, done flag, member ids (never notes, place, priority, reminders, tags, links, project, Contact ids). Tasks: title, due, status (todo, doing, waiting), member ids, repeat flag. Family: name, color id, group (adult, child, other: the role word is never returned), and for dates only the dates they fall on (no year of birth, no age, no note). Visits and reminders: `{date, time}` only; the title is the owner's label.
- **Opaque ids:** first 12 bytes of HMAC-SHA-256 over `<kind>:<record>:<occurrence>`, 24 hex characters. The key is passed in: the preview uses a throw-away random key (new each time the page opens, never stored); tests use fixed test-only keys. **No production display key exists and none is created.**
- **Digest:** SHA-256 of the canonical form of people, entries and tasks. It does not cover `grantsSeen`.
- **`grantsSeen`:** the opaque id of EVERY decision record the device holds (readable or not, superseded or not, inside or outside the window, even a record marked deleted). `compareHistory` finds what a restore removed and what is new.
- **Validator:** rejects unknown schema versions and formats, unknown keys at every level, missing keys, bad dates and times, end before start, invalid source kinds and statuses, broken or unsorted person references, repeated ids, wrong counts, wrong digest, oversized projections. It never throws and never partially accepts.
- **Codec:** canonical JSON only. The `LDP1` encrypted container, the display passphrase, key derivation and pairing are CS-2 (section K). Nothing encrypts or sends anything.

## F. Privacy evidence (the important negative tests)

`src/display/privacy.test.ts` seeds a hostile household: notes, places and reminders on every event; contact emails and phones (including a Contact who is not a household member); a member's birth year and note; a project, a bill-type event, an asset with serial number and address and cost, a service arrangement with provider name, phone, email, cost and notice dates; a Finance account. It approves items in every way and then searches the serialized projection.

- With no decisions the projection is empty (private by default).
- With everything approved, **no hostile value appears**, and the only text present is the owner's own titles and labels.
- **Finance-type, unknown-type, retired, project-linked and bill-linked events and Finance-linked Tasks are absent even with a shared calendar AND their own `show`** (and from the calendar-sharing preview), and the report names why ("belongs to Finance").
- An event sitting on the Finance layer is not inherited; a Task made from a Finance record is rejected; a done Task is absent; a paused or ended arrangement shows no visits.
- A recurring series carries only each date's title, time and date; an override's note and place are not carried; a skipped date is absent.
- Busy carries no title, note, place or project; a Contact who is not a household member never appears; a birthday carries a name and a date, never a year; a Task naming two people is one item.
- **The tables read on the way to the projection are asserted** with Dexie reading hooks: with no visit or reminder approved only Calendar, Tasks, Family and the decisions are read from the module table, and only the members' own Contacts, the shared links and the Calendar settings row from the other tables (no Finance table at all). An approved visit reads only that arrangement; an approved reminder reads no asset; a revoked subject causes no read of its source. A decision that names another module's record number reads nothing of it.
- **Exact keys:** each projection object's keys are asserted and pinned at compile time; the contract folder is checked to import nothing outside itself; the builder's input types are checked to contain no notes, place, phone, email, amount, account, link, birth year, project or provider field.
- **Mutation checks:** 16 deliberate breakages (hide no longer wins; Finance, linked, unknown-type and retired checks removed; split no longer carries the decision; split copies a show over a hide; derived calendars inherited; history ignores deleted records; history empty; digest check removed; unknown keys allowed; a missing Task ancestor treated as the root; done Tasks included; Busy shows the title; paused arrangements show visits). **All 16 are caught** by the tests (one initially was not, a paused-arrangement test was added, then it was caught).

## G. Calendar and Task lifecycle

- **"This and following" (new event id):** the old event's OWN decision is carried to the new event inside the same transaction as the split (a test makes the second write fail and confirms the split does not happen). A clean show (and Busy and its label) follows. A hide follows too, so an explicit "keep this one private" is not lost to a shared calendar. A conflicting or unreadable decision gives the new event a hide. An event with no decision of its own simply inherits its calendar as every event does. One occurrence edited, the whole series edited and a skipped date write nothing and change nothing.
- **Older build:** a split by an older build copies no decision, so the new event is hidden unless its calendar is shared (tested). **Known limit:** if the old event had an explicit hide on a SHARED calendar, an older-build split cannot be detected and the new event inherits the calendar. The editor banner, the "recently added or edited" list and "Keep private" are the controls. Listed in K.
- **Repeating Tasks:** the decision is keyed to the root of the `recurFrom` chain. Completing a Task creates its successor with no new code, and the successor is covered by the same decision; revoking hides it. A private series stays private when it repeats; a Task copied by hand is a new series and private. A soft-deleted ancestor still names the series; a MISSING ancestor or a loop makes the chain ambiguous and the Task is omitted (counted for the owner). A done Task is absent; reopening it brings it back under the same decision.
- **Deleted or missing records:** a deleted event is not shown and returns under the same approval if restored; a decision for a record that no longer exists is harmless and stays in the history; an event whose calendar was deleted inherits nothing (its own approval still applies).
- **Restore and history:** an older backup restores older decisions; the revocation is gone, the event is visible again, and `compareHistory` reports the missing decision, which is what a CS-2 publisher will check.
- **Out-of-window revocation (the required test):** an event 200 days ahead is approved, then revoked. The visible entries and the digest are identical, but `grantsSeen` gains the revocation. A stale device that lacks the revocation but shows the same schedule has the same digest and a DIFFERENT history, and `compareHistory` reports the missing decision (so a content-only check cannot let it bypass the causal check). An approval, a superseding approval and a revocation each advance the history with no visible change.
- **Two devices (real `SyncEngine`):** decisions travel and agree; a stale device that re-approves after a revocation leaves the event hidden everywhere with a conflict to resolve, and the owner's later decision settles it; a decision edited on a device with a fast clock cannot beat a revocation; an older build keeps the records byte for byte.
- **Time:** local wall-clock strings in the publishing device's zone, recorded in `generatedFor.tz`. With the zone set to America/New_York in the test: a weekly 09:00 event keeps 09:00 across the 2026-11-01 change; an event that spans the change keeps its start and end; an all-day multi-day event cannot shift; a 02:30 event on the missing hour still produces a real time.

## H. User experience

- **Event editor** (and **Task editor**): a section "On the family tablet" with Not shown / Shown / Shown as "Busy" (Tasks have no Busy). It says in plain words that nothing is published, that the choice is saved when Save is pressed (and dropped by Cancel; see section M), and that it covers every date of a repeating event or the next repeats of a Task. It shows the inherited state ("Shown because the calendar X is shown" with **Keep this one private**), the kept-private lock, "Cannot be shown: belongs to Finance", the title that would show, a "the title changed" notice, a conflict notice, and, for a new event on a shared calendar, that it will be eligible once saved.
- **Settings > Family display** (new page, sixth in Settings): a banner "This is a local preview. Nothing has been published."; Hide everything; a summary; Calendars (review and show with the dialog above, stop showing); Events (Busy or title, keep private; kept-private and not-eligible lists); Tasks; Family dates (all, per member, per date); Household Services visits and Maintenance reminders (a name field and who it is for); Recent changes and choices to review (shown items added or edited in 14 days, title changes, conflicts, with Keep private); and the Preview (days and times, names, Tasks; counts; time zone). It never says "published" or "updated on tablet", and "Hide everything" says it changes local choices only.
- **Seen in the in-app browser** with invented data (this profile's own demo database): the page in light and dark at about 800 px and at 375 px (no horizontal overflow); the calendar dialog at 375 px with the Personal warning; Cancel then confirm (a Cancel writes nothing: checked in the database); the event editor (Busy, inherited, keep private, "Cannot be shown"); the Task editor; Hide everything and Stop hiding; a reminder shown under a typed name. No console errors. **Not seen:** 1440 px, keyboard-only use, a screen reader, a real phone.

## I. Verification

| Check | Result |
|---|---|
| New tests | **116** in 5 files: grants 37, contract 24, privacy 17, lifecycle 32, timezone 6 |
| Full suite | **314 files, 6,201 tests pass** (baseline 309 files, 6,085; run once at the end) |
| `npx tsc --noEmit` | clean |
| `npm run build` | succeeds (the existing chunk-size warning only). Entry chunk 757.76 kB raw / 237.94 gzip, **+1.35 kB raw / +0.47 gzip over the R4.2 figure** (756.41 / 237.47; HEAD is a documentation-only release on top of R4.2). The new Settings page is in the on-demand Settings chunk (66.6 kB raw), and the Family chunk is unchanged (79.53 kB). |
| Existing guards | Four guards needed updating or tripped on the first full run and were handled, not bypassed: the Family import boundary (fixed by the registry, J.2), the leak-scan guard (used `scanText`), the page-address guard (links written `/settings/...`), and the UI coverage tracker (new row G-06 and the `CS-n` phase label). |
| Mutation checks | 16 of 16 caught |
| Browser | as in H, desktop-sized pane, 375 px, dark and light |
| Not verified | Real phone, real tablet, screen reader, keyboard-only use, 1440 px, any production key, any encrypted file. **Nothing in this report is real-device evidence.** |

## J. Decisions and deviations (please review)

1. **The contract lives in `src/display/contract/`, not a top-level `display-contract/`.** The TypeScript project includes only `src`. A test enforces that it imports nothing outside itself, so CS-3 can move it unchanged.
2. **Family is read through a registry, not an import.** An existing guard says no other code may import Family. `core/displaySources.ts` defines the narrow shape and Family registers its reader (one added import in `family/index.tsx`). The guard was NOT changed. Family does its own date math (including 29 February), so the display agrees with the Calendar layer.
3. **Eligibility subjects:** added `date:<id>` (one important date) beside `dates:all` and `dates:<member>`, because the design's F.4 names "per date". A reminder is keyed to the root of the maintenance Task's repeat chain (the design said "plan id"; a plan is a repeating Task linked to an asset).
4. **People list:** only people that a shown item names are included, so nobody is revealed by being in the household.
5. **Event types:** only a plain event and `birthday` may be shown; `bill`, `finance` and every other type are rejected (closed by default). Events must also be on one of the owner's own calendars and linked only to Calendar, Tasks, Family or Contacts (a stricter allow-list than the design's named exclusions, so a later module is excluded by default).
6. **Tasks:** rejected only when made from or linked to Ledger, Bills or Services records (a deny-list; the design lists no Task rules beyond "explicitly approved"). A Task linked to a project may be approved on its own, as the design says; the project is never published.
7. **A soft-deleted decision record is read as a hide**, not as "no decision", and still counts in `grantsSeen`.
8. **(Superseded by the final correction below.)** The editor control originally wrote immediately; it is now a pending form change applied on Save.
9. **"Recently changed" list** is shown events and Tasks edited in the last 14 days plus a "title changed since you approved it" marker (from the title copy kept in the decision, for items approved one by one). It cannot say which field changed for an event that is shown only through its calendar.
10. **The device marker in each decision is per page load,** not per device, so no new browser-storage key (which would need classifying) was added. It is an audit aid only.
11. **Busy:** the title is the fixed word "Busy". The data model allows an owner label but the page does not offer one in CS-1.
12. **Calendar and Tasks code now import `display/grantStore`** (the split carry), a small dependency from a module to the display layer. The reverse (display importing module screens) does not happen.
13. **No new production dependency.**

## K. Risks and open items (CS-2 and later)

- **Publication does not exist.** Settings does not say "published" because nothing is. CS-2 must build the H.5a protocol: a sync round first, a causal check against the display file, a re-check and compare-and-swap, failing closed; the display file's `grantsSeen` is the rendezvous. **CS-1 supplies the pieces** (the complete history, `compareHistory`, and the digest kept separate from it) **but nothing yet stores "what was last published"**, so "restore pauses publishing" is only a detection primitive.
- **Cryptography is unbuilt:** the display passphrase, key derivation, the `LDP1` container, non-extractable key storage, pairing and key expiry. The preview ids use a throw-away key.
- **Remote revocation:** "Removed from the tablet" versus "hidden in Ledger, not yet updated" needs a real publish result to mean anything.
- **Older-build limit** (section G): an explicit hide on a shared calendar is lost by an older-build "this and following" split.
- **Free-text titles are the owner's judgment.** A title typed as "Pay Dr. Lee $1,200" on an untyped event will show if the event is shown. The preview, the editor banner and Busy exist for this; there is no content scan.
- **Offline or never-synced revocation** cannot be prevented from being republished by another device (as the design states). Not testable until CS-2.
- **Event `updatedAt` as "recent"** is an approximation (any edit counts); a synced merge may refresh it.
- **Real-device acceptance** of this phase's screens is not done and is not claimed.

## L. Release recommendation

**Ready for ChatGPT and owner review; not for release until approved.** I recommend reviewing the judgment calls in J (especially 5, 6 and 9) before authorizing a commit. See the final correction below for the current release status.

Proposed commit message, when authorized:

```
feat(display): add secure display eligibility and projection preview
```

Proposed body: append-only display decisions in moduleRecords (no migration); pure eligibility resolver (hide wins, supersedes not timestamps); narrow Calendar, Tasks, Family, visits and reminders adapters with Finance, retired, linked and unknown-type exclusions; version-1 projection builder and validator with grantsSeen; calendar-level sharing with preview; editor controls and Settings > Family display local preview; no publishing.

After a commit and push, verify the Pages run and update the handoff in the next authorized change.

---

## M. FINAL CORRECTION (2026-11-16): editor save semantics, and the older-build risk

ChatGPT accepted the architecture, privacy approach, contract and test results in principle and required one correction. **Still uncommitted, unpushed and undeployed. CS-2 is not started.**

### M.1 Changed behavior

- **The "On the family tablet" controls are now pending form changes.** In the Event and Task editors, choosing Not shown / Shown / Busy (or "Keep this one private") only changes the form. The control shows "Pending: ... when you press Save". **Save** writes the decision; **Cancel**, closing the window and Escape write nothing. The control itself no longer imports the decision store (a test checks).
- **The decision is written inside the same transaction as the save**, on the identity that holds the saved record:
  - existing event: the event id; one occurrence or the whole series: the one event that holds the series;
  - **"this and following": the NEW event id** (the existing carry of the old event's own decision runs first, then the pending choice, so an explicit hide still survives a correctly performed split even when no choice is pending);
  - **new event: written in the same transaction as its creation**, so the event is never visible before its save succeeds and a failed creation leaves neither the event nor a decision;
  - Task: the root of its repeat chain (a successor stays covered); a Task whose chain is ambiguous is left alone.
- **No unnecessary record:** a choice equal to what is already in effect is not even marked pending, and the write step also skips it (so "Not shown" on a private event, or "Shown" on an event already shown, writes nothing). A conflict is the one exception: saving a choice over a conflict writes a decision that supersedes every current head.
- **Append-only is unchanged:** the new code only calls the existing append function. The Settings > Family display page is unchanged and still saves each explicitly confirmed action immediately.
- **Not changed:** the projection schema, source allow-lists, the eligibility algorithm, Calendar and Tasks behavior, the recurrence engine.

### M.2 Files modified in the correction

New: `src/display/pending.ts` (apply a pending choice to a saved event or Task), `src/display/pending.test.ts` (15 tests).
Edited: `src/display/DisplayControl.tsx` (controlled, pending), `src/modules/calendar/data.ts` (`createEvent` and `saveEdit` take an optional pending choice and apply it in their own transaction), `src/modules/calendar/EventEditor.tsx`, `src/modules/tasks/TaskEditor.tsx` (hold the pending choice; Task save and choice share one transaction), `src/modules/calendar/d13Calendar.test.tsx` (one pinned assertion that quotes the two save calls now quotes the new arguments; nothing else in it changed), and this report, the handoff and the backlog.

### M.3 Tests run and results

| Check | Result |
|---|---|
| New focused tests (`pending.test.ts`) | 15 pass |
| Cancel leaves decisions unchanged | source check that the control never writes and the editors pass the choice only to the save calls; a save with no pending choice writes no decision; **browser:** a choice then Cancel left the count of decisions at 7, the same choice then Save made it 8 |
| Save persists the intended decision | show, Busy, hide each written with Save and appended (three records, none edited); Task decision lands on the chain root; one occurrence and whole-series edits put it on the one event |
| A failed event save leaves no grant | failed creation (event and decision both absent) and failed edit (event unchanged, no decision) |
| A failed split does not partially carry | with the pending decision failing after the new event and the carried decision were written, the record count, the old series end and the history are exactly as before |
| An explicit hide survives a correct split | with no pending choice, on a shared calendar, the new event gets a hide and stays hidden |
| A new event gets its decision only after creation | created already private on a shared calendar (never visible); no choice means no record |
| Append-only and conflicts | saving over a conflict supersedes both heads and settles it; the earlier 116 tests still pass |
| Affected suites (calendar, tasks, display) | 19 files, 388 tests pass |
| `npx tsc --noEmit` | clean |
| `npm run build` | succeeds (entry 757.60 kB raw, +1.19 kB over R4.2) |
| Full suite | **315 files, 6,216 tests, all pass** (final run). The first run had one failure: an existing guard (`d13Calendar.test.tsx`) pins the exact text of the two editor save calls, which I changed on purpose; I updated that one assertion and re-ran. |

### M.4 Older-build recurrence limitation: a CS-2 RELEASE RISK (not solved by CS-1)

**CS-1 has not solved this and does not claim to.** If a device on an OLDER Ledger build (one that does not know about display decisions) uses "this and following" on an event that has an explicit **hide** on a **shared** calendar, the older build creates a new event id and copies no decision. The new event has no decision of its own, so it **inherits its calendar's "shown"** and becomes eligible. Ledger cannot tell afterwards that the new event was a continuation of a private one (the new event stores no pointer to its predecessor). The same older build can also add any new event to a shared calendar, which is by design eligible.

**Why it matters:** until publishing exists nothing leaves the device, so CS-1 is safe to release. Once CS-2 publishes, such an event could reach a household display.

**What CS-2 must do before household information is published (any one of these, owner's choice; the first is the simplest and is recommended as the minimum):**
1. **Compatibility gate (recommended minimum):** CS-2 must not enable publishing until the owner confirms every device runs a CS-1-or-later build, and Ledger should help enforce it: write a small synced "minimum build" marker that CS-1-or-later builds read, and refuse to publish while a device that does not honor it has edited the shared calendars (for example by recording the app build on each calendar event write and refusing to publish events last written by an unknown build). The ST-S5.1 mechanism that stops an out-of-date device erasing newer data is the model.
2. **Hold-for-review for new events on shared calendars:** CS-2 publishes an event that became eligible only by inheritance from a shared calendar after a review step, or after a short delay, using the existing "recently added or edited" list as the review point. This costs one extra step per new family event and also protects against a mistaken move onto a shared calendar.
3. **Lineage marker:** CS-1-or-later builds could stamp a "continued from" id on a split event, so a hide can be matched even if a later older-build edit drops the decision. This does not help for a split made by an older build (it writes no marker), so it complements, not replaces, 1 or 2.

Nothing here is a recurrence-engine rewrite.

### M.5 Remaining risks

- The older-build limitation above (CS-2 gate, not CS-1).
- All the section K items still stand (publication, cryptography and pairing unbuilt; a typed title is the owner's judgment; offline revocation; real-device and screen-reader acceptance not done; 1440 px and keyboard-only use not seen).
- A new event for which the owner picked a choice and then changed its calendar or type in the same form: the decision is applied to the saved event as it is, and eligibility is still decided at read time, so a Finance type or a derived calendar still blocks it.
- Choices made in an editor are applied at Save; if two devices save conflicting choices the existing conflict rule (hidden, owner chooses again) applies.

### M.6 Is CS-1 ready for release?

**Yes, for review and, if ChatGPT and the owner approve, for commit.** The one requested correction is made and tested; the older-build risk is documented prominently as a CS-2 publication gate rather than claimed solved. Proposed commit message unchanged. Not real-device tested.

## N. Release note

Approved by ChatGPT for commit and deployment. **CS-2 blocker:** the older-build limitation in M.4 must be reliably mitigated before any publication; build-version metadata alone is not sufficient; uncertain eligibility fails closed or needs explicit owner review; `grantsSeen` comparison stays even when the visible schedule is unchanged. Real-device acceptance of the CS-1 interface is not recorded.
