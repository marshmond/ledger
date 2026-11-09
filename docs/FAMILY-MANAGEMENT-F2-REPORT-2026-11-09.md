# Family Management F2: family dates, birthdays and Calendar integration

**Date:** 2026-11-09. **Status:** APPROVED FOR FINAL RELEASE VERIFICATION by independent review; the release checks passed (section 13) and the batch was committed and pushed as `feat(family): F2 dates and calendar integration` (the SHA and Pages run are in the git history, the Actions tab and the owner hand-off message, not here, so no second commit is needed). Sections 1 to 12 are the pre-release report and are kept as written (including the "uncommitted" git status in section 11). Not tested on a real device or with a screen reader. F3 to F5 and the Family Command Station are not started.
**All names, dates and notes in code, tests and this report are invented.**

## 1. Summary

Member birthdays and a new kind of **important date** now reach the Calendar and Today through one new read-only **Family due provider** and a built-in **Family** Calendar layer. Nothing is copied: no Calendar event, Task or yearly series is created, and every answer is worked out from the window the Calendar or Today asks for.

- **Birthdays** come from each active member's profile (name from the linked Contact, never the birth year, age, note, phone or email). Each member has an owner-facing switch "Show this birthday on my Calendar" (default on).
- **Important dates** (`family/date` records in `moduleRecords`) are anniversaries and other yearly dates, managed at `#/family/dates` (add, edit, switch Calendar on or off, archive, restore, upcoming list).
- **Stored Birthday events** the owner already made are never touched. When one exists for the **same Contact** and has an occurrence on the **same day**, the Family marker is left out of the display (`coveredBy`), only while that stored occurrence is itself shown.
- **February 29** follows the Calendar's own yearly rule: 28 February in a year without one.
- No new table, no Dexie version change (still 15), no sync or backup format change, no dependency, no backend, no Today card. Nothing about any shared display was built.

## 2. F1 release gate and exact deployed SHA

| Check | Result |
|---|---|
| Repository | `marshmond/ledger` (`origin` = `https://github.com/marshmond/ledger.git`) |
| Branch | `main` |
| Local HEAD = `origin/main` | Yes, after `git fetch`: **`ca8a4851625b7f6389aea470d08a3d9073cf85c8`** (`feat(family): F1 household member foundation`) |
| F1 committed and pushed | Yes |
| Pages deployment for that exact commit | Run **#80** for `ca8a485`: `completed` / `success` (read from the public Actions API; `gh` is not installed here). Earlier: #79 `ba4da59`, #78 `4b827eb` |
| Working tree before this batch | Clean (`git status --short` printed nothing) |
| F1 safeguards present | Yes, read in source and run: Contact-based identity, `createDistinctContact` (never matched by name), one active member per Contact with duplicate warning, defensive lossless reader, archive = status only, read-only dependency reader |
| **Actual released test baseline** | **3,685 passing tests in 205 files**, re-run in this session at that exact commit before any change (matches F1's report) |

## 3. Files changed

New (`src/modules/family/`): `calendarDates.ts` (pure month-day arithmetic), `dateModel.ts` (pure important-date record and defensive reader), `dateData.ts` (load, create, update, archive, restore, Calendar switch), `dueProvider.ts` (the provider), `upcoming.ts` (the dates list, pure), `DatesPage.tsx`, `DateForm.tsx`; tests `family-f2-dates.test.ts` (32), `family-f2-provider.test.ts` (31), `family-f2-guards.test.ts` (17), `family-f2-a11y.test.tsx` (4).
Edited, Family: `model.ts` (+`birthdayOnCalendar`, +`DATES_ROUTE`), `data.ts` (+`setBirthdayOnCalendar`), `index.tsx` (registers the provider), `FamilyModule.tsx` (+route `dates`), `OverviewPage.tsx` (+link), `MemberForm.tsx` (+checkbox), `MemberPage.tsx` (+row and quick switch), `family.css`.
Edited, Calendar (small and additive): `model.ts` (+`FAMILY_ID`), `data.ts` (seed the layer), `markerCoordination.ts` (a stored occurrence may be the covering item; +`storedItemKey`), `useCalendarData.ts` (uses `storedItemKey`; same key as before).
Edited, other: `src/lib/backupSummary.ts` (+label "Important dates").
Existing tests updated because a built-in layer was added or Family now contributes a provider: `calendar.test.ts`, `layerVisibility.test.ts` (the made-up layer id was `..._108`, now `..._999`), `lazyBoundary.test.ts`, `bills/b2-views.test.ts`, `lib/sync/sync.test.ts`, `family/family-guards.test.ts` (F1 said "contributes nothing", F2 says "exactly the due provider").
Docs: this report, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`. `docs/due-provider.md` and `docs/module-hooks.md` not changed (see section 10).

## 4. Calendar findings (inspected before writing code)

| Question | Finding |
|---|---|
| Yearly recurrence | `core/recurrence.ts` yearly steps `addMonths(start, 12·k·interval, startDay)` from the series start, with month-end clamping. |
| Existing birthday events | A Calendar event with `type: 'birthday'`, all-day, yearly, `contactIds` = the person's Contact, reminder a day before. Title "<name>'s birthday". |
| Due-provider contract | `docs/due-provider.md`: read-only, pure, stable ids `module:record:date`, never fails the Calendar, `coveredBy` display coordination. |
| Layer registration | Built-in layers have fixed ids `..._101` to `..._107`, seeded by `ensureCalendarSeed` with check-then-insert in one transaction; the layer's `providerId` equals the provider's `id`. |
| Layer visibility | One device-local preference interpreted by `layerVisibility.ts`; a layer registered later is on while the choice is "everything on". The Calendar filters by visibility, **then** `dropCovered`. Today applies `dropCovered` to everything and does not read visibility. |
| Today aggregation | `TodayDataProvider` calls the Calendar's own `useCalendarData` once (stored events plus every provider); the cards only slice that list. A provider appears on Today with no card. |
| Derived occurrence ids | `derivedId(module, recordId, date)`. |
| `coveredBy` | The covered item names another **derived** item's id, and `dropCovered` only counted derived (`source`) items as covering. **A stored event could not be a covering item.** |
| All-day dates | Plain `YYYY-MM-DD` strings; no time zone. |
| Calendar file (.ics) export | The dialog offers the owner's own calendars and, optionally, only the Finance layer. **No other derived layer, including Family, is exported.** |

### A. February 29

The Calendar's yearly series started on 29 February lands on **28 February in a year without one** and on 29 February in a leap year (it steps from the start, so it returns to the 29th). **Family uses exactly that rule** (`calendarDates.ts`): `dateInYear('02-29', 2025)` = `2025-02-28`, `2028` = `2028-02-29`, century years included (2100 has no 29th, 2000 does). A test compares Family's dates with `generateDates('2020-02-29', yearly, …)` over fourteen years and they are identical. **1 March is not used.** This is the F0 UNVERIFIED item, now verified and tested.

### B. How a stored birthday is identified

A stored birthday occurrence is named by the list key the Calendar already gives it, `e:<eventId>:<occurrenceKey>` (the occurrence key is the original date). A Family marker may carry that key in `coveredBy` when **all** of these hold: the event is live, `type === 'birthday'`, its `contactIds` contains the member's **Contact id** (never the title), and the event has an occurrence that **starts and ends on the marker's day** (a skipped occurrence is not an occurrence; one moved to another day is not on this day). Two different Contacts with the same name never match. **The framework gap:** `dropCovered` could not use a stored event as the covering item. I extended it by a few lines (section 6) rather than rewriting anything.

## 5. Birthday and important-date design

**Member birthday marker.** `family:birthday-<memberId>:<YYYY-MM-DD>` (the member record's immutable id plus the date); `icsUid` `family-birthday-<memberId>-<date>@ledger.local`; title `<Contact name>'s birthday` (the same wording as the Calendar's Birthday type; a test compares them); detail "Birthday"; all-day; priority low; opens the member page.
- **Who gets one:** an **active, readable** member with a valid birthday whose switch is not off and whose Contact exists and has a name. A missing, deleted or unnamed Contact gives no marker (no placeholder name is invented).
- **Past members (policy):** no birthday marker; it returns when they are marked in the household again.
- **Two active records for one Contact** (an unresolved cross-device duplicate): the **oldest active record** supplies the birthday and the switch, so the person gets one marker. If the oldest is marked past, the next takes over.
- **The switch:** `birthdayOnCalendar`, stored on the member record **only when `false`**; absent or unreadable means shown. Writing it (member form, or the one-button switch on the member page) changes that single field; every other stored field, including a note and a field this version cannot read, is written back exactly (tested). It controls the owner's Calendar only; the form says so.
- **Passed days** are `handled`, so a birthday is never "overdue". Today and later are `open`.

**Important date record.** `moduleRecords` `family/date`: `dateKind` (`anniversary` | `other`), `label` (at most 60 characters), `monthDay`, optional `year` (shown only on the Family dates page, never on the Calendar), optional `memberId` (a member **record** id, checked to exist when written), `onCalendar` (stored only when false), `status` (`active` | `archived`). Defensive lossless reader like the member record: a damaged required field gives "Needs review" (listed, not editable, never rewritten); a damaged optional field is named and left out; unknown fields survive every edit, archive and sync (tested). Marker `family:date-<recordId>:<date>`, title = the label, detail "Anniversary" or "Other important date".
- **Remove = archive.** There is no permanent delete (same stance as F1). An archived date leaves the Calendar and appears under "Archived dates", from which **Restore** brings it back. Archive asks first (Cancel has focus).
- A member's own birthday is never a `date` record (no second copy); the Family dates page lists birthdays from the profiles beside the records.
- A date about a past or removed member still shows until the owner archives it (judgment call 6).

**Pages.** `#/family/dates`: "Coming up" (birthdays and dates together, in the order they next fall, each marked "Not on my Calendar" when off), Edit, "Take off / Put on Calendar", Archive, Archived dates with Restore, "Needs review". Add and edit use the existing `Modal`, `ConfirmDialog` and form conventions. No Calendar event editor, no recurrence engine.

## 6. Stored birthday coordination

- **Display-only, as in B3.1.** The Family marker carries `coveredBy` = `storedItemKey(eventId, occurrenceKey)`. `dropCovered` (after the Calendar's visibility filter; Today applies it to everything) leaves the marker out **only while that stored occurrence is in the list it was given and not marked done**. A stored event is never the covered item and is never hidden. Nothing is deleted, stored or re-identified; the provider still reports the marker (a test proves this).
- **The one change to Calendar code:** `markerCoordination.ts` now also counts an item with `occ` (a stored event occurrence), not just a derived `source`, as a possible covering item, and exports `storedItemKey` so the Calendar and the provider use one definition of the key (`useCalendarData.ts` builds the key through it; a guard test pins that). Derived-item behavior is unchanged (the existing B3.1 tests pass untouched).

| # | Case | Result (test) |
|---|---|---|
| 1 | Family birthday, no stored event | One marker on Calendar and Today |
| 2 | Stored event, no Family birthday | Stored event unchanged |
| 3 | Both, same Contact, same day | Only the stored event shows; marker `coveredBy` it; events byte-identical afterwards |
| 4 | Two different Contacts, identical names | Both show (matched by Contact id only); a stored event with the right title but no Contact, a plain non-Birthday event, or a Birthday on another day covers nothing |
| 5 | Stored event suppressed by layer visibility | Hide Personal: the Family marker **comes back**. Hide Family: the stored event stays. Today ignores visibility, one shows. A deleted stored event brings the marker back |
| 6 | Family birthday switched off | Only the stored event shows |
| 7 | Skip or override | Skipped occurrence: marker shows. Moved to another day: both show (different days). Title edited on the same day: still one |
| 8 | Birthday date edited | Marker moves; coverage is decided again for the new date |
| 9 | Backup, restore and sync | See section 8 |
| + | Leap day | A stored yearly event begun 29 Feb coincides with the Family marker every year; one begun 28 Feb agrees in ordinary years and differs in leap years (documented limit) |

## 7. Calendar and Today integration

- **Registration:** `contributes.dueProvider` in `family/index.tsx`, so it works before Family is ever opened; the screens remain on demand (a guard walks the local imports from `index` and finds no page, form or module file; `lazyBoundary.test.ts` passes with `family` in the provider list). Exactly one `family` provider is registered (guard).
- **Layer:** `FAMILY_ID = 9_000_000_000_000_108`, name "Family", `providerId: 'family'`, colour = the Calendar's Pink swatch, seeded once (twice concurrently still gives one). A guard checks every `*_ID` in the Calendar model is unique. The old test placeholder `..._108` is now `..._999`, and a guard fails if a test uses `..._108` as a made-up id. Independent visibility and the "everything on / only these" preference work unchanged (case 5). No existing layer id changed.
- **Today:** the markers arrive through the existing aggregation with no new card. Verified in the pure Today slicing (`todayList`, `upcomingDays`) and in the real browser (section 8).
- **Window:** computed per request; a 60-year cap protects against a damaged range. The stored events are read **only when a birthday falls in the window**, and the provider touches only `moduleRecords` and `contacts` (a Dexie middleware test records every table read or written: reads `contacts` and `moduleRecords`, writes nothing).

## 8. Privacy and data integrity

- **Titles and exports:** no birth year, age, note, colour, phone, email or Contact detail in any title, detail, `icsUid` or source label (tests serialise them). The year of an important date appears only on the Family dates page.
- **Read-only:** the provider, the reader and the list never write (byte-identical database, including a real database holding damaged rows and an unknown kind; guard tests ban writes, transactions, storage, network, logging and clock reads in them).
- **Defensive handling:** damaged member or date rows, an unreadable member, a missing Contact and an unknown Family kind never crash the answer and are left exactly as they were (tested).
- **Backup, restore, sync:** a backup round trip gives identical markers (ids, titles, coverage) and keeps the switch; the backup summary names "Important dates"; with the real `SyncEngine` a date, an archive, a restore and a birthday switch made on one device reach the other and give the same markers. Encrypted backup and sync are unchanged (the same table).
- **Finance and other modules:** no Finance table or module is read or written; no Task is created (counted before and after).
- **Future Family Command Station:** stable member identities (record id and Contact id), stable occurrence ids, member display colours (unchanged on the member record) and the private-by-default rule are all preserved. **No display, share or publish field exists** (a guard checks the date record's known fields and bans such words in Family code). Calendar visibility is the owner's own Calendar only; the screens say "Your own Calendar and Today only. It does not share the birthday/date with anyone or anything else." The shared-origin exposure remains an accepted, documented risk; hosting was not reopened.

## 9. Test results

| Check | Result |
|---|---|
| New F2 tests | **84 tests in 4 files**: dates and Feb 29 and windows and time zones 32, provider/coordination/Today/backup/sync 31, guards 17, accessibility 4 |
| Released baseline (re-run at `ca8a485`) | 3,685 in 205 files |
| **`npm test` (final)** | **3,769 passed in 209 files** (+84 tests, +4 files). Earlier full runs found three older tests that counted seven layers or hand-written Family addresses; they were updated (a real consequence of the new layer, not flakiness) |
| `npx tsc --noEmit` | clean |
| `npm run build` | succeeds (only the existing large-chunk notice) |
| `git diff --check` | clean (only line-ending notices) |
| Time zones | The window and marker tests run under UTC, Pacific/Kiritimati (UTC+14), Pacific/Pago_Pago (UTC-11), New York on a clock-change day, Lord Howe and London: identical results |
| **Browser** (dev server, disposable origin `f2check.localhost`, invented data, deleted afterwards; no console errors) | New contact "Sam Example" with a birthday 3 days ahead: appears on **Today** ("Coming up") and the Calendar agenda; the **Family layer** shows in the legend (8 of 8). With an owner Birthday event for the same Contact (inserted straight into the disposable database) **only one shows** in Today and the agenda; **hiding Personal brings the Family marker back**, showing it again hides it. Family dates page: a 29 Feb anniversary with year 2013 is refused in plain words, 2012 saved and listed as **28 February 2027**; "Take off Calendar" marks it "Not on my Calendar"; Archive opens a dialog with Cancel focused, archives, lists it under Archived dates, Restore returns it. **No horizontal overflow at 375 and 320 px** on the dates page, date form, member page and member form; dark mode at 375 px readable |

**Not verified:** a real phone or screen reader; the Calendar month and week views (only the agenda and Today were driven); two real devices; the Calendar/Today **item assembly hook** (`useCalendarData`) is not rendered by any automated test (the repo has no hook-testing library). Instead the coordination is tested through the same pure filter with items built the way the hook builds them, a guard pins that the hook uses `storedItemKey` and `source`, and the browser run exercised the real hook end to end.

## 10. Remaining limitations

1. **Only typed Birthday events are coordinated.** A plain event the owner titled "Sam's birthday" (no Birthday type) is not matched, so that year shows two. The owner can switch the Family birthday off for that member.
2. **Different days do not coordinate:** an occurrence moved to another day, or a stored event begun on 28 February for a leap-day person (28 February in ordinary years, but the 29th in leap years), shows both in those cases.
3. **Today ignores layer visibility** (existing behavior since B3.1), so a stored birthday on a hidden Personal calendar still hides the Family marker on Today, while the Calendar correctly brings it back.
4. **Whole-record last-writer-wins:** turning a birthday switch off on one device while editing the same member on another keeps one version (the other is in the conflict list).
5. A birthday marker carries **no reminder alarm** (stored Birthday events have one a day before); the Family layer is **not in the .ics export** (only the Finance layer is offered, unchanged).
6. A date about a past or removed member still shows until archived; the member link of a date is validated only when written.
7. No Contact-editing screen exists yet (F1 limitation unchanged); the marker title follows the Contact's current name.
8. No Today card, Search, Quick Add, Family Tasks or Command Station (by scope). Documentation: `docs/due-provider.md` and `docs/module-hooks.md` were not updated; this report and the handoff carry the F2 contract (`coveredBy` by a stored occurrence key, the Family layer id, the record kinds). A short section can be added there on request.

## 11. Exact Git status (at completion of the report)

```
 M docs/BACKLOG.md
 M docs/CHATGPT-HANDOFF.md
 M src/lib/backupSummary.ts
 M src/lib/sync/sync.test.ts
 M src/modules/bills/b2-views.test.ts
 M src/modules/calendar/calendar.test.ts
 M src/modules/calendar/data.ts
 M src/modules/calendar/layerVisibility.test.ts
 M src/modules/calendar/markerCoordination.ts
 M src/modules/calendar/model.ts
 M src/modules/calendar/useCalendarData.ts
 M src/modules/family/FamilyModule.tsx
 M src/modules/family/MemberForm.tsx
 M src/modules/family/MemberPage.tsx
 M src/modules/family/OverviewPage.tsx
 M src/modules/family/data.ts
 M src/modules/family/family-guards.test.ts
 M src/modules/family/family.css
 M src/modules/family/index.tsx
 M src/modules/family/model.ts
 M src/modules/lazyBoundary.test.ts
?? docs/FAMILY-MANAGEMENT-F2-REPORT-2026-11-09.md
?? src/modules/family/DateForm.tsx
?? src/modules/family/DatesPage.tsx
?? src/modules/family/calendarDates.ts
?? src/modules/family/dateData.ts
?? src/modules/family/dateModel.ts
?? src/modules/family/dueProvider.ts
?? src/modules/family/family-f2-a11y.test.tsx
?? src/modules/family/family-f2-dates.test.ts
?? src/modules/family/family-f2-guards.test.ts
?? src/modules/family/family-f2-provider.test.ts
?? src/modules/family/upcoming.ts
```
Nothing staged, committed, pushed or deployed. `HEAD` = `origin/main` = `ca8a485`.

## 12. Recommendation for release

Suitable for independent review. Risk is low to moderate: no schema, sync-format, backup-format or dependency change, and Finance is untouched. The one shared-code change is a few additive lines in the Calendar's display filter (and one extra built-in layer, which changes the "8 calendars" count the owner will see). Existing stored Birthday events are never modified. If approved, after release the owner's first real checks should be: add a birthday to a member on a phone, confirm it shows once on Today and the Calendar, and (if they keep their own Birthday events) confirm only one shows. **Do not start F3 until F2 is reviewed.**

**Judgment calls (please review):**
1. The **Family marker is the covered item** and a stored Birthday occurrence is the covering one, so hiding or deleting the stored event can only ever make a Family marker reappear; this needed the small `dropCovered` extension.
2. A stored event matches only by **type `birthday` + Contact id + an occurrence on the very same day**, never by name or title.
3. **Past members have no birthday marker** (it returns when they are active again).
4. **Leap day = 28 February** in non-leap years, to agree with the Calendar's own yearly rule (1 March was rejected).
5. **Duplicate active records for one Contact** give one marker, from the oldest record.
6. A **date about a past or removed member still shows** until archived.
7. **Archive instead of permanent delete** for dates (restorable), matching F1's no-delete stance.
8. The **switches are stored only when off** (absent = on), so existing records are untouched and an older build carries the field through.
9. **No display or sharing field** was added, even a private-by-default one: absence already means private and F2 builds no tablet control.
10. **Passed birthdays are `handled`**, never overdue.
11. A Contact that is missing or unnamed gives **no marker** rather than an invented name.
12. The made-up `..._108` layer id in an old test was changed to `..._999`; Family took `..._108`.
13. The Family layer is **not offered in the .ics export** (the dialog only ever offered Finance).
14. A birthday marker has **no reminder alarm**.

**Handoff updated:** yes (`docs/CHATGPT-HANDOFF.md`: top notice, current phase, baseline, backlog status, F2 entry, roadmap, change log). **Backlog updated:** yes, including the approved future "Contacts & Relationships" roadmap (C0 to C2, then Personal CRM), recorded only and not built.

## 13. Final release verification (2026-11-09, after ChatGPT review: APPROVED FOR FINAL RELEASE VERIFICATION)

**Repository gate.** `main`; `HEAD` = `origin/main` = `ca8a4851625b7f6389aea470d08a3d9073cf85c8` after `git fetch`; no commit ahead of origin; Pages run #80 `success` (public Actions API); nothing staged; the working tree held exactly the 21 modified files, the report and the 11 new source files listed in section 11 (33 entries), no unrelated change.

**Focused browser acceptance** (dev server, a separate storage origin `f2accept.localhost` that was empty at the start and deleted afterwards, invented contacts "Sam Example", "Pat Sample" and "Robin Invented", one invented stored Birthday event for Sam; no console errors; the stored event and the Family records were inserted straight into that disposable database):

| # | Check | Result |
|---|---|---|
| 1 | Family birthdays in Calendar **month, week and agenda** views | PASS: all three birthdays (Sam from the stored event, Robin and Pat from Family) in each view, each once |
| 2 | Stored Birthday event for the same Contact and date | PASS: Sam's birthday is shown once (the stored event, labelled "Personal · repeats") |
| 3 | Switch a member's birthday off | PASS: Robin's marker disappeared from the Calendar; the dates page marks it "Not on my Calendar" |
| 4 | Hide the stored event's layer (Personal) | PASS: Sam's Family marker appears (labelled "Family"); showing Personal again hides it |
| 5 | Hide the Family layer | PASS: the stored Sam event stays visible; the Family markers go |
| 6 | Layer preference after refresh | PASS: the stored preference (`calendar-hidden-layers`) listed every layer except Family; after a reload Family was off, "7 of 8 calendars shown", Sam's stored event still shown |
| 7 | Important dates add, edit, archive, restore | PASS: added "Family game night" (10 Nov), renamed it, archived it (the confirmation focuses Cancel; it moved to "Archived dates"), restored it |
| 8 | Dates view and add dialog at **320 and 375 px, light and dark** (four combinations) | PASS in all four: no horizontal overflow (page or dialog), no control under 36 px, no text below 4.5:1 (3:1 for large text), measured against each element's real background |
| 9 | Today | PASS: shows the game night, Sam once and Pat (not Robin, switched off); the number of stored Tasks (0) and Calendar events (1) was identical before and after |

No material issue was found, so **no code was corrected** after the implementation report. Not driven in the browser, as before: a real phone, a screen reader, two real devices.

**Regression verification** (automated, all in the final run): stored Birthday events are never changed (byte-identical after coordination); coordination matches Contact ids and the actual occurrence date (same-name Contacts, untyped events, skipped and moved occurrences); 29 February follows the Calendar rule (compared with `generateDates`); provider reads write nothing (a database-layer spy saw reads of `contacts` and `moduleRecords` only and no write); unknown fields and malformed records are preserved; plain backup round trip and real two-device sync keep markers and switches; no Finance table or module is touched; Dexie is still version 15, no new table, dependency or sync-format change.

**Final run, once:** see the hand-off message for the counts: `npm test` **3,769 passed in 209 files**; `npx tsc --noEmit` clean; `npm run build` succeeds; `git diff --check` clean.

**Roadmap recorded (documentation only, not built).** **F2.1 — Calendar Layer Controls & UI Refinement (APPROVED as the NEXT phase after F2 release, before F3; DOCUMENTED ONLY, NOT BUILT, needs its own prompt and independent review).** Approved requirements: replace the crowded Calendar overlay controls with a compact "Calendars & Layers" dropdown/popover; open on hover or click on desktop and on tap on touch devices; accessible keyboard behavior including Escape and focus management; checkboxes for independent multi-layer selection; Select All and Deselect All; the existing colour swatches beside layer names; the control stays open while several layers are toggled; the existing layer-visibility preference (`calendar-hidden-layers`) keeps persisting; the layer list is derived from the established Calendar registry (the seeded layers and registered providers), not a hard-coded set; Calendar rendering, recurrence, Finance behavior and layer identifiers are preserved; no new persistence format and no schema migration. The future Family Command Station may reuse the interaction pattern but should eventually offer simpler family-member filtering rather than exposing every Ledger module layer.

**Known behavior to evaluate during future Calendar UX work (NOT changed in F2):** Today applies the display coordination (`dropCovered`) to everything and does not read Calendar layer visibility, while the Calendar applies it after its visibility filter. So a stored Birthday event on a hidden Calendar still hides the matching Family marker on Today (the Calendar itself brings the marker back). The approved **Contacts & Relationships** roadmap (C0 to C2, then Personal CRM) is unchanged and not started.

**Remaining owner-device acceptance items:** add a birthday to a member on a real phone and check it shows once on Today and the Calendar; if the owner keeps their own Birthday events, check only one shows; check a leap-day birthday on 28 February; screen-reader pass of the Family dates page and the new checkboxes; check the layer legend with eight layers on a phone.
