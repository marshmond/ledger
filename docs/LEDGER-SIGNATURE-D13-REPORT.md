# Ledger Signature D13: Calendar redesign (2026-11-12)

**State: BUILT AND TESTED LOCALLY. NOT STAGED, NOT COMMITTED, NOT PUSHED, NOT DEPLOYED. Awaiting owner and ChatGPT review. NOT REAL-DEVICE OR SCREEN-READER TESTED. D14 is not started.**

Everything below is from this session's own runs. Every name, date and amount in the demo data and in the tests is invented. Screenshots are outside the repository in `C:\Users\alexm\Documents\Ledger-Design-Concepts\D13-Evidence\` (`baseline` before the change, `after` after it, and the composites at the top level).

This report separates **visual implementation** (everything in sections 7 to 10 and 14) from **new functionality**. The only new behavior is small and listed in section 19 (judgment calls 1 to 4).

---

## 1. Verified D12 release (before any code changed)

| Check | Result |
|---|---|
| Repository | `marshmond/ledger` (`origin` = `https://github.com/marshmond/ledger.git`) |
| Branch | `main` |
| HEAD vs origin | `git fetch` run; HEAD = origin/main = `6807b876023a131303f373847beaac4ffa0d384a` |
| D12 release commit | `6807b87` `feat(ui): redesign Ledger Home Family and Household Finances` (the previous baseline `6a6de39` is D11) |
| CI for that exact commit | Workflow "Deploy to GitHub Pages", run id `43264084030`, head sha `6807b87...`: completed / success; its `build` job (steps include `npm ci`, `npm test`) success. Read from the public Actions API (`gh` is not installed). |
| Pages deployment of that commit | Deployment `7743886473` (environment `github-pages`, sha `6807b87...`): latest status `success`. |
| Reports and docs read | D12 report and refinement report, `CHATGPT-HANDOFF.md`, `BACKLOG.md`, `UI-COVERAGE.md`, the Calendar F2.1 layer-controls report, D4 blueprint rows for C-01, IV-01 to IV-04, DL-03, W-09 to W-11 and the roadmap D13 entry. |
| Working tree | Only the three pre-existing untracked files (`docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`). They were not modified, staged or deleted. |

## 2. Calendar functionality inventory (read from source, then run)

One routed page, `/calendar` (`CalendarModule` > `CalendarPage`). Address parameters: `v` (view), `d` (the anchor date, now also the selected day), `r` (agenda range), `new` (open a blank event; also reads `project`), `open` (open the item with that key, e.g. from Today). All still work.

- **Views (4):** Month, Week, Work week, Agenda. Default: the address, else Settings > Calendar "open with" (unless "last"), else the last view used (`calendar-last-view`), else Month on a computer and Agenda on a phone (640 px or narrower). Agenda range 7, 14, 30 or 90 days (`calendar-agenda-range`, default 14).
- **Controls (all kept):** Previous, Next, Today (disabled only when the anchor is today), Jump to date, view tabs (arrow keys move between them), agenda range menu, Layers menu (with Select all, Deselect all, Manage calendars, Done), Export, Add event, Add task. Month: day number, "+N more", cell click. Week views: day heading opens the day dialog, time-slot click starts an event, all-day strip. Agenda: Overdue section and rows.
- **Dialogs:** event editor, derived-item detail (read-only, with the source button and, for Tasks, Mark done and Move), day dialog, Manage calendars (add, rename, recolor, delete, default), Export, repeat-scope question, hand-off dialog.
- **Persisted preferences (all unchanged, all device-local except Settings):** `calendar-last-view`, `calendar-agenda-range`, `calendar-hidden-layers` (two formats, see section 9), and the `calendarSettings` record (week start, open-with, default calendar, overdue days, Finance priorities).
- **Keyboard before D13:** tab list arrows; Escape in the layer menu and dialogs. The month grid declared `role="grid"` but had no arrow keys, no row elements, and every day button and chip was a Tab stop.
- **Which controls were purely presentational in D13:** the header (title, date line, add buttons), the toolbar grouping, the stacked-color mark on the Layers button, the segmented view control, the date tiles, the editor's section boxes. **Which are new behavior:** selecting a day (and the list that shows it), arrow-key movement in the month grid, double-click to start an event, stepping a month keeps the day of the month. Section 19.

## 3. Calendar source and layer inventory

Eight layers (`loadLayers`; built-ins have fixed ids around 9e15, in the order the menu lists them alphabetically): **Personal** (stored events, local), and seven automatic layers fed by the due providers: **Finance** (Ledger), **Tasks**, **Projects**, **Home & Assets**, **Household Services**, **Bills & Subscriptions**, **Family**. Owners can add more local calendars.

| Source | Stored or derived | Date semantics | Editing | Opens |
|---|---|---|---|---|
| Personal events (and owner-made calendars) | Stored events; occurrences expanded at read time by `occurrencesOf` (repeat rule, skips, overrides) | All-day = plain dates (no time zone); timed = one instant, shown in the device zone | Calendar's editor, scope question for repeats | Editor |
| Tasks | Derived from open Tasks (one per Task; a repeating Task shows its next date only) | Due date, all-day unless the Task has a time (then 30 minutes) | Read-only detail with Mark done and Move (changes the Task itself) | Task detail, source button |
| Household Services | Derived: the one open visit Task plus **expected visits across a rolling 12-month horizon** from `plannedVisits.ts`; renewal and notice markers | Plain dates (time only if the arrangement has one) | Read-only | Detail, "Open arrangement" |
| Bills & Subscriptions | Derived due markers; hidden only while the Finance marker of its linked Scheduled payment is itself shown (`dropCovered`, display only) | Plain dates | Read-only | Detail, source button |
| Finance | Derived Scheduled and tax markers | Plain dates | Read-only (approval lives in Ledger) | Detail, source button |
| Family | Derived birthdays and important dates | Plain dates | Read-only | Detail, source button |
| Projects, Home & Assets | Derived start and target dates, warranty ends | Plain dates | Read-only | Detail, source button |

Colors: every item carries its layer's own color (data). The Family layer color (`FAMILY_LAYER_COLOR`) and the D9 member identity colors (`--mc-*`) are **different systems**: the Calendar files contain no member identity piece and no `--mc-*` reference (pinned by a test).

## 4. Existing view inventory

Month (42 cells, six weeks from the first day of the week that holds the 1st), Week (seven columns, all-day strip, time grid with a "now" line), Work week (five columns), Agenda (Overdue section on top, then days in order with items). All four are still reachable in the same ways.

## 5. Baseline (before the change) and comparison (after)

Taken on a throwaway headless-Chrome profile holding the fictional D1 household (`localhost:5231`, sync off), fixed reference date **2026-11-12 (Thursday)**. Files in `D13-Evidence\baseline\`: `baseline-data.json` (every provider's derived date and title from 60 days back to 400 days ahead, every stored occurrence, layers and colors, table row counts), `baseline-month-cells.json` (each of the 42 cells' items), and pictures of all four views at 1440 and 375, the layer menu and the editor.

Comparison after the change (browser, section 16): the 42 month cells list **the same items in the same order** as the baseline; 13 months of Household Services visits drawn in the grid equal the baseline's 37 expected visits exactly (dates and titles; 26 of them House cleaning, every other Friday, 2026-11-27 to 2027-11-12), with no duplicates; browsing 13 months left every table's row count identical; exactly one open House cleaning Task exists (due 2026-11-13).

## 6. Files changed

**New (3):** `src/modules/calendar/calendarModel.ts` (pure decisions), `src/modules/calendar/SelectedDay.tsx`, `src/modules/calendar/d13Calendar.test.tsx` (53 tests).
**Edited (Calendar):** `CalendarPage.tsx`, `MonthView.tsx`, `AgendaView.tsx`, `TimeGrid.tsx` (day headings and block names), `parts.tsx` (item names), `LayerMenu.tsx` (the color stack), `EventEditor.tsx` (sections, sheet), `dialogs.tsx` (the day dialog shares the list), `calendar.css` (rewritten on tokens).
**Edited (tracking):** `src/shell/uiCoverage.test.ts` (the guard's list of rows beyond NS), `docs/UI-COVERAGE.md`, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`, this report.
**Not touched:** `useCalendarData.ts`, `layerVisibility.ts`, `layerMenuModel.ts`, `occurrences.ts`, `recurrence.ts`, `series.ts`, `data.ts`, `model.ts`, the providers (including `services/plannedVisits.ts`), `quickAddDef.ts`, `quickEvent.ts`, `searchSource.ts`, the shared Modal, Toast, Quick Add, Search, `db.ts`, sync, backup, theme storage, the service worker, `package.json` (no dependency), and the three protected untracked files.

## 7. Desktop redesign

Top to bottom: the shared `PageHeader` (eyebrow "Productivity", title "Calendar", a bold weekday and the date, and the two add buttons at the right); one quiet toolbar card (previous, Today, next as one joined group, the period in large type, then the segmented view control, the Layers button, the jump-to-date field and Export); then the **month grid as the focal point with the selected day beside it**.

- **Grid:** real `grid`/`row`/`gridcell` markup; uppercase weekday headings; weekend cells softly tinted; days outside the month sunken; the first of a month names the month ("NOV", "DEC"); chips keep their own colors, left bar, priority shape, dashed bar for automatic items.
- **Today versus selected:** today is a filled number plus the word "Today"; the selected day is a heavier frame (inset ring), a bolder number, `aria-selected`; both can be on one cell. Neither depends on color alone.
- **Selected day (right, 312 px, sticky; below the grid under 1100 px):** the shared `DateTile`, the full date, a "Today / Tomorrow" chip and the item count, every item (the existing rows, in the day's own order), Add event and Add task with that date.
- **Overflow:** a cell lists three items then "+N more"; the rest are in the selected-day list (nothing is dropped).
- **Week and Work week:** same time grid with tokens, uppercase weekday, filled number for today, labels raised from 9 or 10 px to 11 px (the documented micro size).
- **Agenda:** one card per day with a `DateTile`, "Today" chip, Overdue as a red-edged card with `DateInline` dates; full width.
- **Replaced from the old layout:** the left-heavy toolbar with its own h1 (the period used to be the page's h1), the two-row control cluster, the square-cornered cells with no weekend or boundary marks, plain day headings in the agenda, the pop-up day list for the month view (now a side list). **Kept:** all controls, the chips, the time grid structure, the layer menu, the dialogs.

## 8. Phone redesign

Same header (the two add buttons share a row), one toolbar card (stepper and period; the four views as a full-width segmented control; Layers, the date field and Export on one row at 375 px, wrapping at 320), the month as a compact grid of dots (shape still marks automatic items), the **selected day as a card under the grid** with all its items and the add buttons, and the existing round Add button, which the page now leaves room for (section 15, finding D13-F3). With no saved view the phone still opens on Agenda. The event editor is a bottom sheet (the shared `Modal` `variant="sheet"`, as Quick Add uses). The Layers menu is the existing bottom sheet (rows 44 px). A phone held sideways (812 x 375) uses the same sheet so the whole menu fits.

## 9. Overlay selection and persistence

The grouped selector **already existed** (Calendar F2.1): one compact button, a multi-select list with a color dot beside each layer, Select all, Deselect all, Manage calendars, Done; click, tap and keyboard (Escape closes and returns focus; Tab leaving closes; no hover opening, deliberately). D13 restyled it to the shared tokens, added a small decorative stack of the colors of the layers that are on (`<i aria-hidden>`; the spoken name "Calendars & Layers: 5 of 8 shown" is unchanged), and made it a bottom sheet on a short sideways phone. **No state, key or format changed**: `calendar-hidden-layers` keeps both formats (an old plain list of hidden ids, or `{"only":[ids]}`); a fresh install is everything on (including layers registered later); Select all returns to that; Deselect all is the explicit empty choice; an intentional "Personal only" survives new modules; unknown ids are ignored and dropped on the next write. Hiding a layer is display-only. Run in the browser: popover with 8 rows all checked, Deselect all (nothing drawn, message, popover stays open), Personal only (14 chips, all Personal), Escape (closes, focus on the button), reload (still Personal only), Agenda (still filtered), Select all (`[]`).

## 10. Event editor presentation

The same form, the same fields in the same order, now in five labelled sections (What, When, Calendar and priority, Details, Tags, people and links; Repeat keeps its own box), on a soft panel, with a **sticky Save and Cancel bar** and the dialog widened to 760 px. On a phone it is a bottom sheet (focus trap, Escape, scroll lock and keyboard following come from the shared `Modal` sheet variant; the Modal itself was not changed). `onSubmit`, `save`, `saveEdit`, `createEvent`, validation messages, the scope question, hand-off, delete and Mark done are untouched (pinned by tests). Derived items still open the read-only detail, never the editor.

## 11. Creation and prefill preservation

Verified in the browser: `#/calendar?new=1&d=2026-12-04` opens a New event on that date and tidies the address (`new` removed); `?open=e:<id>:<key>` opens that event and tidies; Search "Add an event" opens the Add box (the D10 contract), and typing "D13 quick lunch fri 12pm" created exactly one event on Friday 13 November; the selected day's Add event and double-clicking a cell fill in the date; the header "Add event" uses today when today is on screen, else the anchor (unchanged rule). The Quick Add parser, Search and the payload shapes were not edited.

## 12. Household Services recurrence preservation

D13 contains **no scheduling code**: the redesigned files do not import a cadence, recurrence or planned-visit function, and a test pins that. The projection (`plannedVisits.ts`, S4 correction 1) is unchanged: from today to the same day 12 months later, both ends included, clamped; the open visit Task is the single actionable next visit; later dates come from the one cadence adapter. New D13 tests use the real data layer with fictional arrangements and lay every month of the horizon out through the month model: **every other Friday gives 26 expected visits plus the one open Task, each in exactly one cell on its own date, all Fridays**; the 1st and 15th across a leap year and the year end (the Task holds 2028-01-01, the layer 2028-01-15, 2028-02-01, 2028-02-15, 2028-03-01, 2028-12-01); the 15th and the last business day (2028-02-29, 2028-02-15, 2028-04-28 and not 2028-04-30); drawing three times wrote no row and moved no timestamp. The existing S4 suite (14 tests on the horizon, February, leap years, month ends, weekends, moved visits, backup and two-device sync) still passes untouched. Other recurring sources were not changed.

## 13. Date and time correctness

All date arithmetic in the new model is `addDays` / `addMonths` on ISO date strings (UTC arithmetic, no local `Date`). A test lays grids out under five time zones (New York, London, Lord Howe, Auckland, UTC) across both US clock-change dates and checks every step is exactly one day, and that Left/Right across them lands on the next date. Month ends, year ends, leap February and clamping (Jan 31 plus a month is Feb 28; Feb 29 plus a year is Feb 28) are tested; the browser run stepped from 31 January to 28 February. All-day stays plain dates, timed items keep their instants, a due date is never read as a start time (the item mapping in `useCalendarData` is unchanged). The `dateZones` and `calendar` suites pass unchanged. Overnight timed events were not exercised beyond the existing tests.

## 14. Themes and accessibility findings

- **Themes:** viewed in Signature light and dark, Classic light and dark, and Slate and indigo light at 1440; colors come from tokens (one `#fff` check mark remains in `.cal-swatch`, as before; no new hex colors); event and layer colors stay data and remain distinguishable in dark.
- **Verified by test or run:** one Tab stop for the whole grid, arrow keys/Home/End/PageUp/PageDown, Shift+PageUp/Down for a year; a 30-stop Tab walk (every stop showed a focus ring except the native date picker button inside the jump-to-date field); `aria-selected` on exactly one cell, `aria-current="date"` on today; each day button's name is the full date, "today" and the count; each chip and row's name is title, when, source (marked "automatic, read-only" when derived), priority, repeats, overdue, done and project; overflow reachable (the list is real buttons); layer rows are real checkboxes; the editor sections are labelled; touch rules (44 px rows on touch, 32 px "+N more"); reduced motion rule; print hides the toolbar and side list.
- **Not verified:** a screen reader (none was run, so no screen-reader claim is made), a physical keyboard, a real phone, forced colors, Safari and Firefox, contrast by instrument (colors are token pairs already measured in earlier phases; the new ones are the existing text tones).
- **Known limitation:** in the month grid only the selected day's items are Tab stops (the others are `tabindex=-1` and are reached through that day's list); this is deliberate and documented in the code.

## 15. Findings

- **D13-F1 (pre-existing, not changed):** the shared Toast sits above dialogs (z-index 120 over 100). Two toasts stacked after saves can cover the sticky Save and Cancel bar if the editor is reopened within about eight seconds (seen in the browser run: a Cancel click was swallowed). Waiting for the toasts to clear, or Escape, works. Fixing it means changing the shared Toast or Modal, which this phase does not do.
- **D13-F2 (pre-existing, not changed):** when the editor opens, focus lands on the dialog box, not on the Title field, although the field has `autoFocus` (the same before D13: checked by running the old code from a stash). One Tab reaches the Title.
- **D13-F3 (fixed):** the page's own bottom padding replaced the shared one, so on a phone the last row could sit under the round Add button at the end of the page. It now leaves room (phone only, no new `!important`).
- **D13-F4 (fixed):** on a phone held sideways the Layers list was a drop-down running past the bottom of the screen; it is now the same bottom sheet.
- **D13-F5 (open, small):** on a 375 px phone the jump-to-date field is tight ("11/12/2026" nearly touches its icon). It is the native control; not restyled further.

## 16. Automated test results

- **New:** `d13Calendar.test.tsx`, 53 tests, covering the grid cut (week start, year ends, leap years, five time zones), selection and keyboard movement, today versus selected marks, roving Tab stop, grid roles, adjacent-month cells, multi-day items, dense days and the nothing-dropped rule, order, accessible names, long titles, empty days, color independence, the selected-day panel, agenda order and overdue, the page's view inventory and address contract, every control, the shared pieces, the layer scenarios (first load, select all, deselect all, one, Personal only, several, stored formats, unknown ids, display-only), the editor's fields and sections and the untouched persistence calls, the read-only boundary for derived items, style rules (today versus selected, focus, touch, reduced motion, no new hex, no text under 11 px), and Household Services (26 plus one, leap years, month ends, no duplicates, no writes, no scheduling code in the new files, no new dependency).
- **Calendar suites together:** 8 files, 167 tests, passing. **Related suites** (shell, contacts, family, services Calendar, core): 64 files, 1,192 tests, passing.
- **Guard updates:** `uiCoverage.test.ts` lists the new rows beyond NS; the D6 "priority overrides did not grow" guard caught a first draft and the stylesheet was corrected to add none.
- **Final full run (after the last CSS and docs edits):** `npx tsc --noEmit` exit 0; `npx vitest run` **261 files, 4,884 tests, 0 failures** (exit 0; 260 files and 4,883 tests before the guard fix and +0 files, +53 new D13 tests included); `npm run build` exit 0. An earlier full run had one failure (the "priority overrides did not grow" guard); the stylesheet was corrected and the run repeated.

## 17. Browser workflow results (headless Chrome, throwaway profile, fictional data, sync off)

All passed unless listed in section 15: open Calendar; navigate months (Nov, Dec, Jan, back); Today; a month boundary; select a date and read its list; a dense day (4 items, "+1 more"); open an existing event and Cancel; every view reachable; create a fictional event from the selected day (date pre-filled; exactly one record), edit it, cancel a subsequent edit (stored record byte-identical); layers (Deselect all, Personal only, Escape, reload, view change, Select all); Quick Add and Search creation; `new=1&d=`, `open=` deep links; 13 months of services; a derived service visit opens a read-only detail and its "Open arrangement" button goes to `#/services/a/<id>`; only one open House cleaning Task; no table changed while browsing. **Phone (375 and 320):** open, tap a day, open an item from the list, layers sheet (fixed, 44 px rows, Deselect all and Select all), editor sheet (date filled in, Save and Cancel visible, Escape dismisses), no horizontal overflow in Month, Week, Work week and Agenda, Agenda default, last row clears the Add button at the end of the page; sideways phone and an 800 px tablet also fit. **Not exercised in the browser:** delete an event, the repeat-scope dialog, Manage calendars, .ics export, the hand-off dialog (their code is untouched; their tests pass).

## 18. Evidence

`D13-Evidence\D13-CALENDAR-DESKTOP-FINAL.png` (Signature light and dark, 1440), `D13-CALENDAR-MOBILE-FINAL.png` (375: month, selected day, layers, editor, dark month, dark selected day), `D13-CALENDAR-DESIGN-COMPARISON.png` (before, after, and the approved Today and Tasks prototypes), `D13-CALENDAR-MOBILE-COMPARISON.png`, `D13-CALENDAR-THEMES.png`, `D13-CALENDAR-VIEWS.png`. Individual pictures are in `after\` (1440 light, dark, Classic, Slate, 1280, 1024; week, work week, agenda; editor; layers; focus ring; phone 375 and 320 viewport and full-page; sideways; tablet) with the scripted results in `flow1-results.json`, `flow2-results.json`, `mobile-results.json` and `tab-walk-month.json`. The full-page phone pictures show the round Add button where the page ends; that is a capture artifact, not an overlap (the end-of-page overlap test passes).

## 19. Design-fidelity assessment and judgment calls (please review)

**No approved Calendar prototype exists** in the design folder (D3.1 Today, D3.2, D3.3 Tasks and Household Finances, D3.4 and the D4 blueprint contain none), so the comparison is with the approved Today and Tasks language, not a Calendar prototype. Applied from it: eyebrow, large title, bold-weekday date line, navy primary action, the quiet bordered toolbar card, uppercase micro-labels, white cards on the cool canvas, date tiles, the "Today" chip, underline-free segmented view control, the red-edged Overdue card. Compared with the old Calendar the layout genuinely changed (header, toolbar, selected-day list, agenda cards, editor sections), it is not a recolor. **Honest weaknesses:** with the side list at 1440 the month cells are narrower than before, so chip titles are cut more ("House cleanin…"); the full text is in each chip's name and the side list. The phone toolbar is still three rows tall. Week and Work week are restyled, not recomposed. The Layers dot stack is hidden on a phone. These are trade-offs, not technical blockers.

Judgment calls:
1. **Clicking a month cell now selects the day; double-clicking an empty part creates an event** (a single click used to open a new event, which on a phone created events by accident). The selected day's Add event creates with the date filled in. **This is a gesture change for the owner to approve.**
2. **Stepping a month keeps the day of the month (clamped)** instead of jumping to the 1st, so the selected day is meaningful. The `d` value of the address is the selected day (it already was the anchor).
3. **The selected-day list replaces the pop-up for the month view only.** Week and Work week day headings still open the pop-up. Nothing else about the list changed (same rows, same order).
4. **Only the selected cell's items are Tab stops** (the list holds all of them).
5. The side list is 312 px and moves below the grid under 1100 px.
6. The editor uses the sheet variant on a phone.
7. `useToday` replaces `todayISO()` on the page so it follows midnight.
8. The add buttons moved into the page header; the period title is now an `h2` (the page has one `h1`, "Calendar").
9. Weekend tint and the first-of-month month name are new visual marks, not new data.
10. Section labels in the editor ("What", "When", "Calendar and priority", "Details", "Tags, people and links") are new words (American English).

**Not built (not authorized):** any new view, side panel beyond the selected-day list, new scheduling rule, recurrence model, member colors on events, hover opening of the layer menu, recoloring by member, or removal of a feature.

## 20. Coverage changes

`docs/UI-COVERAGE.md`: C-01 `BLT` (L, D, 375, 1440, Kbd, Func all Y); IV-01 Month `BLT` (all six Y); IV-02 Week `BLT` (L, D, 375, 1440); IV-03 Work week `BLT` (L, 375, 1440); IV-04 Agenda `BLT` (L, D, 375, 1440, Func); DL-03 `BLT` (the editor and the day dialog only); W-09 and W-10 `BLT` for the parts section 1.9 names; W-11 and the other Calendar dialogs untouched. New paragraph and section 1.9. The inventory is still 59, 23, 31, 63, 37. **Nothing is `ACC`.**

## 21. Real-device and screen-reader limitations

Not tested: any real phone (touch, the on-screen keyboard in the editor sheet, safe areas), any screen reader, a physical keyboard, forced colors, Safari or Firefox, print preview. Synthetic key and mouse events were used. These stay acceptance items for the owner.

## 22. Git status (at the end of the batch)

On `main`, HEAD = origin/main = `6807b87`. Modified: `docs/UI-COVERAGE.md`, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`, `src/shell/uiCoverage.test.ts`, and nine Calendar files (`AgendaView.tsx`, `CalendarPage.tsx`, `EventEditor.tsx`, `LayerMenu.tsx`, `MonthView.tsx`, `TimeGrid.tsx`, `calendar.css`, `dialogs.tsx`, `parts.tsx`). New: `calendarModel.ts`, `SelectedDay.tsx`, `d13Calendar.test.tsx`, this report. Untracked and untouched: the three protected files. Nothing staged, committed, pushed or deployed; no branch created.

**Handoff updated:** yes (`docs/CHATGPT-HANDOFF.md`, snapshot and Calendar entry). Unknown: the owner's and ChatGPT's verdict, real-device behavior, and the Pages result (nothing was pushed).

---

## D13 Final Correction and Visual Review (2026-11-12, after the first ChatGPT review)

**State: still BUILT AND TESTED LOCALLY, UNCOMMITTED, NOT STAGED, NOT PUSHED, NOT DEPLOYED, NOT ACCEPTED. D13.1 and D14 are not started.** Baseline re-verified: `main`, HEAD = origin/main = `6807b87` (D12 CI and Pages succeeded, section 1); D13 uncommitted; the three protected untracked files untouched.

### 1. Toast obstruction diagnosis (D13-F1)
Reproduced with fictional data before any change (1440 x 600 window, three events saved in a row, editor reopened): `elementFromPoint` at the center of Cancel returned a toast, and a real click on Cancel did not close the editor. With one toast, and in a 900 px tall window, nothing was covered. **Cause:** the notification container is fixed at the bottom center with `z-index: 120`, the dialog backdrop is `z-index: 100`, and the editor's sticky Save and Cancel bar sits at the bottom of the screen, so two or more stacked toasts lie on top of it and take the click. The container itself does not block pointer events (only the toasts do).

### 2. Exact correction
One CSS rule in `src/styles.css`, beside the toast rules: `body:has(.modal-back) .toasts { z-index: 90; }`. While any dialog backdrop exists the notifications sit below it (behind the dimmed backdrop, still in the page and still announced by `role="status"`); when the dialog closes they return to `z-index: 120` in front of the page. No other z-index changed, `pointer-events` was not touched (Undo and Dismiss still work), and neither the shared Toast nor the shared Modal component changed. One trade-off: a toast raised while a dialog is open is dimmed behind it until the dialog closes.

### 3. Regression results (headless Chrome, fictional data)
Three stacked toasts with the editor reopened: Save and Cancel not covered, and a real Cancel click closes it (desktop 1440 x 600 and phone 375 x 640 bottom sheet; one toast and two toasts were also clean). Escape closes the editor and returns focus to Add event (or to the item it was opened from). Quick Add: three events created in a row (three toasts), reopened, none of its controls covered, Escape closes it. With no dialog open the toast Undo button is the element under its own center, and clicking it removed the newest Quick Add event (two remained). The Search dialog opens over toasts, and toasts return to the front when it closes. Background controls stay blocked while the editor is open. Three new unit tests in `d13Calendar.test.tsx` pin the mechanism: toast z-index 120 over backdrop 100, the override below the backdrop and above the page, and no `pointer-events: none`.

### 4. Initial editor focus decision (D13-F2)
Fixed inside the Calendar editor only: a new event now starts in the Title box (an effect in `EventEditor.tsx`; it runs after the shared Modal's, which is why the field's own `autoFocus` had lost). Not applied when editing (the dialog keeps focus, as before), nor on a touch screen (it would raise the keyboard over the sheet). Checked: Title focused from the header Add event and from the selected day's Add event; Escape returns focus to the button that opened it. The shared Modal was not changed.

### 5. Calendar keyboard-navigation verification
From the selected day's number, six Right-arrows reached 18 November and Enter selected it; Tab then reached each of its 4 items in the list (4 of 4); Enter opened one; Escape returned focus to it. The earlier 30-stop Tab walk is unchanged (the grid is one stop; every stop showed a ring except the native picker button of the date field). The approved decisions are kept as built: click or tap selects, the visible Add event creates with the date filled in (double-click is only a shortcut), month stepping keeps the day of the month (clamped), the list replaces the month pop-up, and Week and Work week keep their day dialogs.

### 6. Visual review and small refinements
No source change was needed for the visual items. **Dense days:** a chip's complete title is in its hover tooltip, its accessible name, and the selected-day list beside it, which shows every item in full without a screen reader; the panel stays. **Phone toolbar:** three rows (stepper and period; the four views; Layers, date, Export) is what the existing controls need at 375; nothing was hidden. **Native date field at 375:** 105 px wide, the value "11/12/2026" fully inside the field (scroll width 103 = client width 103), no overlap with neighboring controls; at 320 it wraps under Layers at 133 px. Tight but readable and usable; no change.

### 7. Final automated tests
`npx tsc --noEmit` exit 0; targeted run (Calendar, shell including Quick Add and the coverage and layering guards, ui, Today, Tasks): 33 files, 707 tests, 0 failures; `npm run build` exit 0. No shared component changed (one CSS rule), so the full suite was not re-run; the earlier full run (261 files, 4,884 tests, 0 failures) predates this correction, and a full run must still pass in CI after a separately approved push.

### 8. Review images (outside the repository, `C:\Users\alexm\Documents\Ledger-Design-Concepts\D13-Evidence\`)
`D13-CALENDAR-DESKTOP-REVIEW.png` (light today-selected; dark and light dense day with "+1 more"; 1280 window), `D13-CALENDAR-MOBILE-REVIEW.png` (375: month, selected-day agenda, overlay selector, event sheet, dark), `D13-CALENDAR-INTERACTION-REVIEW.png` (Week, Agenda, layer selector in dark, keyboard focus ring), `D13-CALENDAR-EDITOR-REVIEW.png` (editor, Title focused). Individual pictures are in `after\`, and the toast reproduction pictures are in `final\`. The images are unedited captures of the final code. There is still no approved Calendar prototype; the reference is the Today and Tasks language.

### 9. Remaining limitations
Not tested on a real phone, with a screen reader, a physical keyboard, forced colors, Safari or Firefox. Delete, the repeat-scope question, Manage calendars and .ics export were not run in the browser. The native date picker button shows no focus ring (a browser control). A toast raised while a dialog is open is dimmed behind it until the dialog closes.

### 10. Exact Git status
`main`, HEAD = origin/main = `6807b87`. Modified: `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`, `docs/UI-COVERAGE.md`, `src/styles.css`, `src/shell/uiCoverage.test.ts`, and nine Calendar files (`AgendaView`, `CalendarPage`, `EventEditor`, `LayerMenu`, `MonthView`, `TimeGrid`, `calendar.css`, `dialogs`, `parts`). New: `calendarModel.ts`, `SelectedDay.tsx`, `d13Calendar.test.tsx`, and the D13 report. Untracked and untouched: the three protected files. Nothing staged, committed, pushed or deployed.

### Release verification (2026-11-12, immediately before the commit)

- **Error visibility with the toast rule:** every Calendar toast is a success or Undo message (saved, added, deleted, done, moved, calendar added or deleted, downloaded). A save failure uses the inline `role="alert"` message inside the editor (`setError`, above Save and Cancel), which is not a toast and is unaffected. Toasts raised while a dialog stays open (for example "Calendar added" in Manage calendars) are dimmed behind it until it closes, and the visible result (the new row) shows the change. Nothing important depends on a toast. No change made.
- **Secondary dialogs (fictional data, three toasts showing):** Manage calendars, Export, the repeating-event scope question and the hand-off dialog all opened, had no control under a toast, and dismissed normally; no stored record changed (two clean runs; one earlier attempt showed a small difference in one table right after an aborted run and did not repeat). Known and pre-existing: Escape with two dialogs open closes both (the shared Modal documents this), so Escape on the scope question also closed the editor without saving.
- **Diff checks:** none of `useCalendarData.ts`, the occurrence and recurrence code, `data.ts`, the services, Tasks and Bills code, `db.ts`, sync, backup, `package.json` or any provider is in the diff; 18 files are staged by path; the three protected untracked files are excluded.
- **Still open acceptance items:** real iOS and Android devices and the on-screen keyboard, physical keyboard and screen reader, Safari and Firefox, forced colors, the native date picker's focus appearance, and some event-title truncation in dense month cells (full titles remain in the tooltip, the accessible name and the selected-day list). There was no approved Calendar-specific prototype; the design was developed from the established Ledger Signature language. The D13.1 Today design-fidelity refinement stays on the roadmap.
