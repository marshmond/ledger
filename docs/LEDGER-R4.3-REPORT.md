# Ledger R4.3: Richer Calendar Export (report)

Status (2026-11-16): **RELEASED: committed as d4d3eb6 (feat(calendar): add richer household calendar export) plus 6647bf6 (a one-line test fix: the first push, Pages run #131, FAILED only because my own test matched the digits 1500 inside a generated id on the CI machine; no app code was wrong). Pages run #132 on 6647bf6 completed success. Final wording cleanup applied after review: the Hide Amounts help text and the export label (Include Finance-generated amounts) now say what the option controls; historical Finance-only export text in due-provider.md is marked historical. Still NOT real-device tested or imported into a real calendar app.** (Earlier build-time status: BUILT AND TESTED LOCALLY, UNCOMMITTED. AWAITING CHATGPT REVIEW. NOT REAL-DEVICE TESTED; NOT IMPORTED INTO ANY REAL CALENDAR APP.** Proposed commit message: `feat(calendar): add richer household calendar export`.

Gate verified first: `main` = `origin/main` = `ee408ca` (`docs(display): record CS-2 reliability check and release`) and GitHub Pages run **#130** `completed` / `success` (public Actions API; `gh` is not installed), so CS-2 is committed and deployed and none of it is mixed in. The three protected untracked files (`docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`) were not modified (the seed script was read, not run; the demo household was already on the demo address).

**Family Command Station:** CS-3 and the live Family Command Station remain **deferred by the owner** pending decisions about the screen, hardware, physical location, power and mounting. Nothing of CS-3 or live display setup was started, and the approved CS-1/CS-2 foundation (`src/display/`) was not touched.

## 1. What the owner can now export

Calendar > **Export…** opens one dialog. The owner ticks which calendars and layers go into a single `.ics` snapshot:

- **Your calendars** (Personal and any calendar the owner made): their stored events, written whole with repeat rules, skipped dates and one-date changes, exactly as before (not cut to the 12-month window).
- **Household layers:** Family, Tasks, Bills & Subscriptions, Household Services, Home & Assets, Projects, Finance. Each is offered only if its due provider is registered. Each covers today through the same day 12 months later.

Also in the dialog: Select all, Deselect all, "N of M selected", a per-layer count ("13 dates", "Nothing scheduled in this period", "Could not be read"), a Privacy section, a reminders switch, a "What the file will contain" summary with a sample of titles, and Download. The boxes start from what the Calendar is showing but are the dialog's own; the Calendar's visibility preference is only read.

Manage calendars: the per-calendar **Export** link now also appears for built-in layers (a single derived layer can be exported with the same privacy and alarm options).

## 2. Layers and limitations

| Layer | Source (unchanged) | In the file | Limits |
|---|---|---|---|
| Your calendars | stored events | titles, dates, times, repeat, notes, location, tags, reminders | owner free text is written as typed |
| Family | Family provider | birthdays and important dates, names/labels only | no age, birth year, notes or contact detail; honors each member's and date's own Calendar switch |
| Tasks | Tasks provider | open dated Tasks and start dates; timed Tasks keep their time | notes never exported; undated Tasks excluded; not a sync link back |
| Bills & Subscriptions | Bills provider | expected bills and contract dates, stable period ids | no amounts or payment status (provider text is already amount-free) |
| Household Services | Services provider | contract dates and expected visits (visit time kept) | no new scheduling engine |
| Home & Assets | Assets provider | warranty end dates (what the provider offers) | maintenance is on the Tasks layer only (unchanged) |
| Projects | Projects provider | start and target dates | milestones are Tasks |
| Finance | Ledger provider | scheduled items, loan payments, vests, tax and RMD dates | separately selectable, never implied by another layer |

## 3. UI changes

`src/modules/calendar/ExportDialog.tsx` (new; `dialogs.tsx` re-exports it so `CalendarPage` is unchanged), a small block of CSS (`.cal-x*`), and the Export link in Manage calendars. No Calendar redesign. Checked in the browser at desktop and 375 px, dark and light (see section 11).

## 4. Privacy and Hide Amounts

- The dialog says a calendar file is an ordinary file outside Ledger's encrypted storage that anyone with a copy can read, and that titles and notes typed by the owner are written as typed (Ledger cannot recognize sensitive free text).
- **"Include financial amounts in exported events": default OFF.**
- Off: Finance items use approved amount-free words supplied by the Finance provider (`icsPlainTitle`, `icsPlainDetail`, new optional fields): the scheduled payee only, "<loan> payment", an RSU vest line without its figure, the estimated-tax line without its figure. A Finance item that lacks them is written generically ("Finance date") rather than with its raw title (fail closed). No digits are stripped from any text. Alarm text uses the same amount-free title.
- On: the provider's existing full text (`icsTitle ?? title`, `icsDetail ?? detail`). No money field is invented. The dialog says anyone with the file can see the amounts.
- **Hide Amounts on:** the option still starts off, a note says so, and ticking it shows an explicit "Include amounts anyway?" choice. On-screen Hide Amounts is unchanged.
- Task notes are never exported (judgment call 1).
- Stricter Family-only file (`family/familyIcs.ts`) is untouched.

## 5. Alarms

Stored events keep their own reminders. A derived item uses its provider's `icsAlarmMinutes` (Finance non-milestone dates, Bills action deadlines, and, new, Household Services notice-by dates, all one day before). A derived item with a clock time and no provider alarm gets one an hour before. Informational dates (renewals, price changes, warranty ends, project dates, birthdays) and all-day Tasks get none. At most one alarm per entry. "Include reminders" off removes every alarm, including stored ones.

## 6. Duplicate coordination

After the layers are chosen, the existing `dropCovered` rule (`calendar/markerCoordination.ts`) is applied to the stored occurrences and derived items that are in the file. So a Bills marker covered by a Finance payment is written once only if Finance is also ticked (otherwise it stays), and a Family birthday covered by a stored Birthday event is written once only if that event's calendar is also ticked. Matching is by id (`coveredBy`), never by title or amount. Two entries never share a UID (a repeated id falls back to the item's own id), and two legitimate events with the same title and date are both kept. **Known gap:** a Bills marker or Services expected visit that a Task already stands for is left out by that provider whether or not Tasks is ticked; the dialog tells the owner to tick Tasks in that case (judgment call 4).

## 7. BK-03 (Calendar layer choices in backups)

**Recommendation: yes, include `calendar-hidden-layers` only (not the last view or agenda range), as a separate small change. Deferred, not implemented in R4.3.** Why it is safe: one entry in `PREFERENCE_KEYS` plus moving it from the "not in backup" row to the "in backup" row of `devicePrefs.ts`; the value is read defensively; old backups simply lack the key; an older build ignores it; built-in layer ids are fixed and custom ones travel in the same backup; unknown ids are already ignored. Why deferred: it changes what a restore overwrites (visible calendars on that device), the owner has never decided it, the brief asked not to change backup semantics without a concrete reason, and the export does not depend on it. R4.3 leaves the preference exactly as it was.

## 8. Failure and empty states

- No layers selected: Download disabled, "Nothing is selected."
- Nothing in range: disabled, "There is nothing to export for these choices."
- A layer with no items: "Nothing scheduled in this period" (a normal state).
- A provider that throws or is not registered: reported as NOT READ, named in a warning with **Try again**; Download stays disabled until it is read or unticked. (The Calendar screen's own empty-on-failure behavior is unchanged.) Download re-reads the sources and refuses if any ticked source fails.
- Browser download failure: the error is caught and shown; nothing is written to the database.
- Repeated downloads: identical ids; only `DTSTAMP` changes. Large data: the demo household produced a 37 KB file with 117 entries instantly.

## 9. Files changed

New: `src/modules/calendar/exportPlan.ts` (pure builder), `exportRead.ts` (failure-aware reads), `ExportDialog.tsx`, `exportR43.test.ts`. Edited: `ics.ts` (timed derived items), `dialogs.tsx`, `calendar.css`, `src/core/dueProvider.ts` (two optional fields), `src/lib/calendar.ts` (optional plain text on four kinds), `modules/ledger/dueProvider.ts` (sets the plain text), `modules/services/dueProvider.ts` (notice-by alarm), `layerVisibility.test.ts` (one guard re-pointed at the new dialog, see section 10), `docs/due-provider.md`, this report, `docs/CHATGPT-HANDOFF.md`, `docs/BACKLOG.md`. No table, migration, dependency, network call, backup or sync change. `docs/UI-COVERAGE.md` checked: its W-10 row ("Calendars manager, layer menu, .ics export") is still accurate; no row changed.

## 10. Tests and build

Focused first: `src/modules/calendar/exportR43.test.ts` (19 tests: each layer contributes its own dates; an unselected layer contributes nothing; Task notes and an undated Task never appear; timed Tasks stay timed; reading and building change no table; amounts absent by default with Hide Amounts on and off, including descriptions and alarm text, and present only when chosen; Finance without approved plain text fails closed; every amount-bearing Finance kind has amount-free words; well-formed structure, folding, one alarm per entry, unique ids; recurring event keeps its id, skipped date and edited occurrence; repeated export identical but for the time stamp; alarms on/off and the default rules; Family birthday and Bills/Finance coordination both ways; same-title entries both kept; the dialog's ticks never write the Calendar's visibility; a provider that throws or is missing is reported as not read). Invented data with sensitive-looking amounts, notes and an account number. Then the related suites (Calendar, Family, Ledger, Services, shell, calendar library: 95 files, 2,150 tests, one guard re-pointed, see below). Then one full run on the finished code: 322 files, 6,357 tests; 19 new tests in one new file (`exportR43.test.ts`); `tsc` and `npm run build` clean. That run had 2 failures, both dealt with: (1) my new test file broke the repo's leak-scan guard (short numbers must go through `scanText`), fixed in the test; (2) `src/display/privacy.test.ts` (birthday) failed once under full-suite load on a digits-in-generated-id pattern match and passes alone and on re-run (a pre-existing flake in a CS-1 test, not touched). The three affected files were re-run after the fix and pass (41 tests). The full suite was not re-run a second time.

**One existing guard was changed:** `layerVisibility.test.ts` asserted that the old export dialog in `dialogs.tsx` contained `l.sourceType === 'local' && isVisible(l.id)`. It now asserts that `ExportDialog.tsx` chooses its starting ticks with `defaultKeys(offered, isVisible)` and never mentions storage, the visibility key or any visibility writer. The rule it protects (the export reads but never writes the Calendar's preference) is kept, and made stricter.

## 11. Browser observations (built-in browser, invented demo household on the demo address, sync off)

- Dialog at desktop: all eight layers listed with counts (Personal 8 events; Family 6, Tasks 13, Bills 49, Services 31, Home & Assets 2, Projects 2, Finance 6 dates); summary "109 dates ... 8 events"; amounts "not included".
- The real Download (the page's download call intercepted so no file reached the disk): 117 entries, **no dollar figure anywhere**, no duplicate ids, five timed entries as absolute times, one alarm, `X-WR-CALNAME:Ledger household calendar`, file name `ledger-household-calendar.ics`.
- With Hide Amounts on: ticking "Include financial amounts" showed the confirmation; after "Include amounts" the file held the full Finance text (for example a property-tax payee with its amount).
- Deselect all: Download disabled, "Nothing is selected" and the Calendar's `calendar-hidden-layers` unchanged (null before and after). Select all restored it.
- Single-layer export from Manage calendars (Home & Assets): only that layer, 2 dates.
- 375 px, dark mode: no sideways scroll (scroll width 375), dialog 351 px wide, layer rows and counts readable. Console: no errors. Light mode at 375 px and a keyboard walk were not separately checked.
- **NOT verified:** importing the downloaded file into a real calendar app (Google, Apple, Outlook) or a phone; the format follows the Calendar export's existing tested conventions plus a structural check (balanced BEGIN/END, UIDs, DTSTAMP, folding, one TRIGGER per alarm), not an external validator; a screen reader; Safari and Firefox; a failing provider in the browser (covered by a unit test).

## 12. Judgment calls (please review)

1. **Task notes are not exported.** They are free text, other modules write into them, and Task text is the likeliest place for a stray figure. A Task is its title, date and time.
2. **Defaults follow the Calendar's visible layers,** including Finance (which is safe because amounts default off). Previously Finance was off by default in the export.
3. **Timed derived items are written as absolute 30-minute events** (the Calendar draws them the same way), with a one-hour default alarm. This is new behavior for items that were never exported before (Tasks, Services visits).
4. **Tasks and the Bills/Services deferral** is documented and flagged in the dialog, not changed in those providers (changing them is outside "reuse existing mechanisms").
5. **Services notice-by dates now carry a one-day alarm** in a calendar file only (the provider's screen text and ids are unchanged); renewals stay information.
6. **The file is named `ledger-household-calendar.ics`** when it holds derived layers, `calendar.ics` for your own calendars only, and the layer name for a single one.
7. **The Hide Amounts help text still says exports "still contain" amounts** (an existing test pins the sentence). That is now true only of backups and the Finance "Add to my calendar" file; consider updating the wording.
8. **Past, still-open items are not exported** (the window starts today; no overdue window), unlike the Calendar screen.

## 13. Deviations from the roadmap

None material. The roadmap's acceptance test, "round-trip import into a standard calendar of a seeded household", was not done (no calendar app was available without owner setup); a structural check and the browser download stand in, and this is stated above.

## 14. Remaining limitations

No automatic updates or subscriptions (a snapshot); no custom date range; no per-person filter in the file; no Task-deferred marker coordination (item 4); no BK-03 (section 7); Hide Amounts help wording (item 7); real-device and real-calendar import untested.

## 15. Release recommendation

**Ready for ChatGPT review.** Not committed, staged, pushed or deployed. After approval and an explicit go-ahead: commit as `feat(calendar): add richer household calendar export`, push, check the Actions run, and (owner) try the file in the phone's own calendar. CS-3 and the live Family Command Station stay deferred. BK-03 is one small follow-up if the owner agrees.
