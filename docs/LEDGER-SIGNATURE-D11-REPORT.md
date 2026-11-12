# Ledger Signature D11: Today and Tasks redesign (2026-11-12)

**State: CONDITIONALLY APPROVED; FINAL CORRECTION VERIFIED (report section 20); COMMITTED AND PUSHED as `feat(ui): redesign Today and Tasks` (read the SHA from `git log` and the Pages result from the Actions tab; not recorded here to avoid a second commit). NOT REAL-DEVICE OR SCREEN-READER TESTED. D12 is not started.**

Everything below is from this session's own runs. Every name, date and amount in the demo data and in the tests is invented. Screenshots are outside the repository in `C:\Users\alexm\Documents\Ledger-Design-Concepts\D11-Evidence\` (`baseline` before the change, `after` after it).

---

## 1. Release gate (verified before any code changed)

| Check | Result |
|---|---|
| Repository | `marshmond/ledger` (`origin` = `https://github.com/marshmond/ledger.git`) |
| Branch | `main` |
| HEAD vs origin | `git fetch` run; HEAD = origin/main = `1298877ea7353f3864b3666d81de450b7cdc0f17` |
| D10 release commit | `1298877` `feat(ui): redesign Quick Add desktop and mobile` |
| CI for that exact commit | "Deploy to GitHub Pages" run **#96**: `build` job success (steps `npm ci`, `npm test`, `npm run build`, upload) and `deploy` job success (`actions/deploy-pages`). Read from the public Actions API (`gh` is not installed). |
| D10 report | Read. Its full-suite line is a real result (248 files, 4,625 tests, exit 0, 132.95 s) and section 23 says the placeholder was already replaced; no placeholder remains. |
| Handoff and tracker | `docs/CHATGPT-HANDOFF.md`, `docs/BACKLOG.md`, `docs/UI-COVERAGE.md` read. |
| Working tree | Only the three pre-existing untracked files: `docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`. Untouched throughout. |

Designs read: D3.1 (Today) report and desktop picture, D3.3 (Tasks) report and desktop and phone pictures, and the D4 coverage blueprint rows for T-01, K-01, S-07, W-12, W-13.

## 2. Before the change: Today's inventory (read from source, then confirmed on the demo data)

Eleven cards, as D4 said. Four are Today's own (`src/modules/today/cards.tsx`); seven come from other modules through `contributes.todayCards`. **All eleven are unchanged** (a test reads the card source files and pins ids, titles, widths, priorities and hide-when-empty flags).

| Order | Card id | Title | Provider | Default width | Hidden when empty? | Empty behavior |
|---|---|---|---|---|---|---|
| 10 | `today.agenda` | Today | Today | full | no | "Nothing scheduled for today." |
| 15 | `today.reminders` | Reminders due | Today | half | yes | card disappears |
| 20 | `today.overdue` | Overdue | Today | half | yes (also kept when "older" links exist) | card disappears |
| 30 | `today.upcoming` | Coming up | Today | half | no | "Nothing in the next N days." |
| 35 | `projects.attention` | Projects | Projects | half | yes | disappears |
| 37 | `bills.attention` | Bills & Subscriptions | Bills | half | yes | disappears |
| 38 | `assets.attention` | Home & Assets | Assets | half | yes | disappears |
| 38 | `household.attention` | Household finances | Household | half | yes | disappears |
| 39 | `services.attention` | Household Services | Services | half | yes | disappears |
| 40 | `ledger.attention` | Needs attention | Ledger | half | no | "Alerts will show here once you have entered some data in Ledger." |
| 50 | `ledger.cash` | Cash outlook | Ledger | half | yes | disappears |

- **Layout and customization:** per device in `localStorage` key `today.layout.v1` (order, `half`/`full`, hidden); Edit layout has Move earlier/later, Make wider/narrower, Hide/Show, Reset to default, and two shared settings (look-ahead 3/7/14/30 days; overdue rows 5 to 25). Hide amounts is `today.hideAmounts.v1`.
- **Overdue** = open items that ended before today, not longer ago than the overdue window (30 days by default), oldest first, grouped by module; older ones are a link. **Coming up** = the days after today up to the look-ahead, not done, grouped by day. **Today** = items covering today, not overdue leftovers. These are `src/modules/today/logic.ts`, unchanged.
- **Hide amounts** masks `$` amounts in item titles on Today and its rows and is passed to every contributed card; the Ledger cards honor it (the cash outlook and warning level). Baseline check on the demo household with it on: no amount in the page text, no `$` amount in accessible names or tooltips, two `$••••` marks (cash outlook and warning level).
- **Baseline values on the demo household** (Thursday 2026-11-12): 3 overdue (two bills, one task), nothing scheduled today, 17 coming up in 7 days, cash outlook figure, 11 cards on the page.

## 3. Before the change: Tasks' inventory

- **Ten views** (`VIEWS` in `views.ts`): Today, Upcoming, Overdue, All, By list, By tag, By priority, Waiting, Completed, Deleted. Chosen with the address `?v=` or, failing that, the last view saved in `tasks-last-view`, else Today. Switching saves the view, clears `?task=`, clears the selection.
- **Filters** (one `Filter` state, default `NO_FILTER`): search words (title, notes, checklist), priority, list (any / none / one), tag, project (any / none / one; the box appears only when projects exist), and contact (set only by a link). Not saved across reloads; links `?tag=`, `?contact=`, `?project=` set them once and tidy the address. `?task=<id>` opens the editor.
- **Sort:** Due date (default), Priority, Newest first, Title, and Recently completed (Completed view only). Not saved. **Grouping** is the views themselves: Today (Overdue, Due today, Scheduled for today), Upcoming by day (7/14/30 days), By list, By tag, By priority.
- **Row:** tick (named "Mark done: ..."), the title button (opens the editor), priority mark, repeat mark, status pill, due text ("Due today", "Overdue · date", "Due date", "Do on date"), list, project (◇, ◆ for a milestone), tags, steps, "made from" link. Selecting swaps the tick for a check box; Deleted swaps it for Restore.
- **Bulk bar** (Select): count, All N, Complete, Reschedule (date + button), Priority, List, Project, Add tag, Delete; each undoable from the toast. **Lists...** opens the Lists dialog; the add box and the New task dialog share `QuickAddBar`.
- **Empty texts** per view, and "No tasks match these filters." No Tasks-specific keyboard shortcuts; the tab list has arrow-key movement.
- **Baseline on the demo household:** 16 open tasks; Today 1 (the overdue one), Upcoming 8 across 6 days, Overdue 1, Waiting 1; every view's groups and titles saved to `baseline/tasks-views-baseline.json`; complete then reopen flow recorded.

## 4. Files changed

**New (8 source and test files):** `src/modules/today/todayModel.ts`, `src/modules/today/TodayHero.tsx`, `src/modules/today/d11Today.test.tsx`, `src/modules/today/d11Contrast.test.ts`, `src/modules/tasks/viewModel.ts`, `src/modules/tasks/TasksControls.tsx`, `src/modules/tasks/d11Tasks.test.tsx`, `src/ui/useMediaQuery.ts`, plus this report.
**Edited:** `src/modules/today/TodayModule.tsx`, `TodayRow.tsx`, `cards.tsx`, `today.css`; `src/modules/tasks/TasksPage.tsx`, `TaskRow.tsx`, `tasks.css`; `src/shell/uiBaseline.ts` (Modal count) and `src/shell/uiCoverage.test.ts` (the tracker expectations); `docs/UI-COVERAGE.md`, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`, this report.
**Not touched:** `logic.ts`, `layout.ts`, `settings.ts`, `TodayData.tsx`, every other module's Today card, `views.ts`, `data.ts`, `model.ts`, `QuickTask.tsx`, `TaskEditor.tsx`, `ListsDialog.tsx`, the database, sync, backup, routes, themes, the shared components (`DateTile`, `StatusChip`, `PageHeader`, `Modal` were reused as they are), and the three pre-existing untracked files.

## 5. Today: layout

Top to bottom: the heading; the **Next up** bar; the **status band**; then the existing card grid.
- **Heading:** the shared `PageHeader`. The date line is a bold weekday and the rest ("**Thursday** · November 12, 2026"), worked out from the app's own `today` value (the same `useToday` as before), never a fixed date. Hide amounts and Edit layout are quieter (no outline; Edit layout is a plain button with a sliders icon), same switch and same behavior.
- **Grid:** the same `home-grid`, now `align-items: start` for Today only, so a short card (Overdue) is as tall as its content rather than stretched to match its neighbor.
- **Overdue rows:** each shows a red date tile (weekday, day, month; the full date and "overdue" are read out) beside the title, the existing "Overdue" chip, the source line and the existing action. **Coming up:** one tile per day (weekend and tomorrow tinted; "Tomorrow" printed under the tile) beside that day's rows; the old day heading is kept as a hidden heading.
- **Phone:** the same blocks, one column; the band is three columns (the small explanatory lines are hidden under 480 px, the cards below say the same); a seven-day strip (a picture only, hidden from screen readers) sits above Coming up; rows whose action is a words button put it under the title so the title keeps the width; a row with a round check button keeps it at the right.

## 6. Next up and the status band: what they use

**No new rule and no new number.** `todayModel.ts` calls the same functions the cards call.
- **Overdue** = the sum of the Overdue card's groups (the same number as its badge), with the per-module split in the card's order. **Today** = how many rows the Today card lists. **Coming up** = how many rows the Coming up card lists, with its range (tomorrow to today plus the look-ahead setting).
- **Next up** = the **first row of the Coming up list**, in that list's own order (all-day first, then by time). The left half of the bar says "Nothing scheduled for today" or "N on today's schedule". When nothing is coming up the bar says "Nothing in the next N days"; nothing is invented.
- **Not part of the card list:** the bar and band are mounted by the page, are not registered cards, do not appear in Edit layout or the saved layout, and cannot be hidden by it (a test pins this).
- The band holds counts and dates only (a test also pins that the new files contain no money formatting, database or storage code). Status is told by a word and an icon shape, never color alone.

## 7. Tasks: rows and list

- **One card** with a quiet column heading (Task, Project · progress, Due), group sub-headings inside it (with counts) instead of a card per group, and a priority key at the foot (decorative; the row already says the priority in words).
- **The D0 defect is fixed:** the row button is the shared left-aligned row (`ui-row`, the D6 treatment) and the title, due and meta text are left-aligned (a test reads the stylesheet; a script read the computed `text-align` of real rows as `left`). Long titles wrap inside the row (a 125-character title and a 72-character unbroken word checked at 320 px: no horizontal overflow).
- **Due column:** a word chip and the shared `DateInline` (bold weekday): "Overdue" (with an icon and a red row tint), "Due today", "Tomorrow", the date, "Do on <date>", "No due date", "Done". These restate the row's old wording and `isOverdue`; `dueState` adds no state.
- **Ticks:** 28 px circle with a 46 px hit area; an overdue or high-priority tick has a red ring; reminder's dashed ring and done's green fill are kept.
- **Bulk bar:** still sticky below the header (measured: 66 px with the header ending at 62 px); on a phone it is capped at 45 percent of the screen height and scrolls inside itself (section 20).

## 8. Tasks: phone views and the Filters sheet

- **Views:** Today, Upcoming, Overdue, All as a segmented control, plus **More** holding By list, By tag, By priority, Waiting, Completed, Deleted. Picking one makes it the active view (the same `v` address and saved view as on a computer), closes the menu and names it on the More button; Escape closes the menu and returns focus. When a More view is active the control wraps to two lines so More can show its name. Below 380 px an unused More shows only its chevron (name kept as its label); below 340 px counts shrink to dots (the number stays as text for screen readers). All ten views were opened on a phone and compared with the baseline.
- **Filters:** search and a **Filters** button (with a count of filters on) open the shared dialog as a bottom sheet with Priority, List, Tag, Project, Sort and (Upcoming) the range, "Clear filters", and "Show N tasks". Active filters are also listed in words under the search box.
- **One state:** the computer's chips and the sheet are the same `FilterFields` component reading and writing the page's single `filter` state. A test pins one `useState<Filter>`; a browser run compared five combinations on both layouts (identical results), and the state survived the window narrowing and widening.

## 9. Saved layout and Hide amounts

Edit layout (reorder, hide a card, reload: the layout stayed; Reset to default removed the stored value), Hide amounts (on: no amount in text, accessible names or tooltips; stayed on after a reload; off again), the 11 cards still present in the default order and widths, the look-ahead and overdue settings unchanged. The cards' own insides are unchanged, so amounts they show are masked as before. The cash figure before and after: `$23,974.72`, `Lowest point ... Thu, Feb 4`, warning level `$1,000.00` (the same, from the same card).

## 10. Task functionality and data integrity

Run against the demo database and read back (see section 13): complete and reopen, edit and revert, create from the page's add box (two tasks), bulk Reschedule and Undo (dates restored exactly), bulk Complete and Undo, selection cancel, the empty result, D10 Quick Add (**N**, typed line `t ... fri !high #tag`, the dialog's Add task button: exactly one Task, high, due date set, one tag). Test tasks were removed again and the one task a probe changed was restored.

## 11. Light, dark and other palettes

Signature light and dark are coherent at 1440, 800 (light), 375 and 320. The "Next up" bar uses the primary-button colors, so it is **navy in Signature light and teal in Signature dark** (the dark primary is teal); Classic uses the accent blue. Classic light and the empty profile were looked at; Classic dark and Slate captured. **Contrast** was computed for the new pairs in Classic and every preset in both modes (12 sets, 11 pairs each): the first draft failed on the Next up button (a translucent fill lowered its text to 3.2 to 4.4) and was changed to a solid swap of the bar's two colors; all pairs are now 4.5 or better (`d11Contrast.test.ts`). This is arithmetic, not a look at a real screen. Forced-colors was not added or seen. No animation or transition was added, so reduced motion is unaffected.

## 12. Automated test results

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | exit 0 (only the existing "chunks larger than 500 kB" notice) |
| Full suite, first run (after the code settled) | 251 files, 4,693 tests: 4,692 passed, **1 failed** (my new test used a short number string that `leakScanGuard.test.ts` flags; fixed with the guard's documented `// ids-ok` marker; the guard and the new files then passed in a targeted run, 134 tests) |
| Full suite, final run (after the documents and tracker guard were edited) | **251 files, 4,693 tests, all passed, 0 failed** (115.69 s; started 01:09, after the last source edit; the build ran just before it; the figures were read from the log, not added up) |
| New tests | 68: `d11Today.test.tsx` 25, `d11Tasks.test.tsx` 31, `d11Contrast.test.ts` 12 |
| Existing tests edited | `uiCoverage.test.ts` only (tracker expectations: 31 rows now beyond `NS`, dialogs 63 in 42 files) |

What the new tests pin: Today: the summary counts and Next up are the card lists' own functions; empty and look-ahead behavior; dates across month, year and clock-change days; the 11 card ids, titles, widths, priorities and flags; the default and a saved layout; both storage keys; the hero is not a card; Hide amounts masks the Next up title and a row, and the new files hold no money code; tile markup. Tasks: all ten views reachable and split 4 + 6; chips and sheet render identical options; `isFiltering` equals the old test; filter counts and wording; row controls and meanings; five due looks and their boundaries; nothing says assigned, owner or responsible; view contents and sorting unchanged; the bulk bar's role, labels and sticky offset; one filter state; the stylesheet rules (no hex, no important flag, left-aligned rows). **No DOM-testing dependency was added**; the view components are drawn with `renderToStaticMarkup`.

## 13. Browser verification (fictional demo household, headless Chrome on a throwaway profile, sync off)

Scripts drove real clicks, typing and key events; results were read from the page and the database. **This is not a physical keyboard or a phone.**
- **Today (all passed):** 11 cards in the default order; overdue and coming-up titles equal the baseline (3 and 17); band numbers equal the cards; Next up equals the first Coming up row; tiles carry the real dates (overdue tone on the three, tomorrow and weekend tones); hidden day headings are the old words; card links (listed in the evidence); Calendar link, Open bill, Next up button navigate; marking a row done updated the band and Undo restored it; Edit layout; saved layout across a reload; Reset; Hide amounts.
- **Tasks (all passed):** 10 views x desktop and phone equal the baseline; five filter combinations equal on both layouts; width changes keep state; empty result; Clear filters; sort by title and priority on both layouts; complete, reopen; edit and revert; create (long title, no due date); bulk selection with a count, sticky position, Reschedule and Complete with Undo, cancel; Filters sheet (focus inside, Escape returns focus, page locked and released); More menu (Escape returns focus); D10 Quick Add.
- **Keyboard:** Tab walks of Today (34 stops), Tasks on a computer and a phone: logical order, every stop showed a focus indicator (outline or ring).
- **Widths:** 1440, 800, 375, 320 in Signature light; 1440, 375, 320 dark; Classic and Slate; **no horizontal overflow at any of them**.

## 14. Evidence (outside the repository)

`D11-Evidence\baseline\` (before): `B01`-`B04` pictures of Today and Tasks at 1440 and 375, `today-baseline-text.txt`, `today-baseline-cards.json`, `tasks-views-baseline.json`, `tasks-complete-reopen-baseline.json`, `today-hide-amounts-baseline.json`.
`D11-Evidence\after\`: `T01`-`T11` Today (1440 light and dark, 800, 375 light and dark, 320, Classic, Slate, empty profile, Hide amounts), `K01`-`K18` Tasks (views, 1440, 800, 375, 320, dark, Classic, Slate, empty, long title at 320, mobile bulk, bulk scrolled), plus `tasks-mobile375-filters-sheet.jpg`, `tasks-mobile375-more-views.jpg`, `tasks-mobile375-empty-result.jpg`, `tasks-desktop-bulk.jpg`, `tasks-desktop-completed-view.jpg`. Files named `wip-*` are working captures and can be ignored.

## 15. Before and after

**Today:** was a stack of equal white cards under a plain title; now a quieter title, one prominent bar, one status band, then the same cards, with real date tiles in the two agenda cards and a phone day strip. Items and counts identical.
**Tasks:** was a centered-title list of loose rows under ten pill tabs and a wall of dropdowns; now one card, left-aligned one-line rows in aligned columns with a date column that reads at a glance, underlined tabs, slim chips, and on a phone four buttons + More and one Filters sheet.

## 16. Findings, deviations and unresolved decisions (please review)

**Finding D11-F1 (already in the app before D11; FIXED in the final correction, section 20): the bulk Priority, List and Add tag dropdowns store the wrong value.** In `TasksPage.tsx` each handler reads `e.target.value` inside a function that runs after the dropdown has reset to "", so a bulk "Priority: Low" stores an empty priority (the app then shows Medium), "No list" stores list id 0, and "Add tag" would add tag 0. The toast still says it worked. Reproduced on the demo data (priority `high` stored as `""`; list `none` stored as `0`); Undo restores the old values. Reschedule, Complete, Project and Delete read their values differently and work. The code is identical in the D10 commit. The fix was approved afterwards and is described in section 20.

**Deviations from the prototypes (deliberate):**
1. **Next up selection.** The prototype chose a timed event over an earlier all-day task. That is a new urgency rule, so Next up is the first row of the existing Coming up list instead. Whether later-today timed items should count is undecided.
2. **Today is not two columns.** D3.1 stacks Overdue and Coming up in a wide left column and puts Needs attention and the status blocks on the right. The saved layout is an ordered list of half and full cards, so that arrangement would need a layout-model change; the cards keep their order and widths.
3. **No "Bills due" or cash cell in the band.** "Bills due" is a count Today does not have today; Cash outlook stays its own card.
4. **No weekday eyebrow.** `PageHeader`'s eyebrow is hidden outside Signature, so the weekday is bold in the date line instead.
5. **No kind icons, no Family member names or colors on Today rows**, no "Household services" block (all excluded by the brief).
6. **Tasks:** no per-row menu, no flag or folder icons, no Family member chip (a task that names a Family member's Contact shows nothing on the row, and no copy says assigned or owned), no phone bottom dock for bulk actions (the bar stays sticky under the header, about 270 px tall on a phone), long titles wrap on a computer instead of truncating with a tooltip.
7. **The Next up bar is teal in Signature dark**, not navy.
8. **The Task creator dialog and editor were not restyled** (their shared Modal already follows Signature). Only the page's add box got a card frame, scoped to the page.
9. **Dialog count:** the Filters sheet is a new `<Modal>` site (63 in 42 files); the tracker, its guard constants and the baseline were raised together.
10. **Tasks: "Today" tab count and other counts** are the existing ones; nothing was recounted.

## 17. Not verified, and limits

Real phones (touch targets, the floating Add button over rows, the keyboard in the sheet, safe areas), screen readers (the markup, names and live "N tasks shown" line are written for them but were not heard), forced-colors mode, Safari and Firefox, the other three presets, the Task editor and Lists dialog in Signature, Today at 800 px beyond one picture, Signature dark 800, the Enter key in D10 Quick Add (a synthetic Enter did not submit in my driver; the dialog's Add task button did; D10's own report shows the real-keyboard run), and any amount shown by the Ledger cards other than through their own Hide amounts handling.

## 18. Coverage tracker, backlog, handoff, Git

- `docs/UI-COVERAGE.md`: T-01 and K-01 `BLT` (six marks); IV-05 to IV-14 `BLT` with `Func` only; W-12 and W-13 `BLT`; S-07 and DL-02 `NS`; dialog total 63 in 42; section 1.6 records exactly what each mark rests on. The 59-page inventory is intact and nothing is `ACC`.
- `docs/BACKLOG.md` and `docs/CHATGPT-HANDOFF.md` were updated in this batch (new top entries and change log lines); they say committed and pushed, with the deployment result to be read from Actions.
- **Git status at the end:** modified `docs/UI-COVERAGE.md`, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`, the seven source files and two guard files listed in section 4; new files listed in section 4 and this report; the three pre-existing untracked files unchanged. (That was the state before the final correction.) The release commit then staged exactly these files by path, plus `bulkActions.test.ts`; the three pre-existing untracked files stayed untracked and unchanged; no branch, remote or repository was created.

## 19. How closely each screen matches the approved prototype (candid)

- **Today, about 70 to 75 percent.** Matches: the page rhythm, the date-tile treatment, the "Next up" bar, one band instead of loose tiles, tomorrow and weekend tints, the phone strip, restraint in shadows. Differs: single-column agenda order instead of the two-column composition, no kind icons or member names, no cash or "Bills due" cell, bar color in dark. It reads as the same family but is calmer and plainer than the picture.
- **Tasks, about 85 to 90 percent.** Matches: the single list card, column headings, one-line rows, the due-date treatment, underlined tabs, slim chips, the phone's four buttons + More and Filters sheet, the priority key. Differs: no per-row menu or flag icons, no member chip, no bottom bulk dock, titles wrap instead of truncating.


---

## 20. Final correction, verification and release (2026-11-12)

**Baseline re-verified:** `main` = `origin/main` = `1298877`, nothing staged, the working tree held exactly the D11 files in section 4 and the three pre-existing untracked files (untouched).

**Bulk-action defect D11-F1: FIXED.**
- **Cause:** each of the three dropdowns (Priority, List, Add tag) is a controlled `<select value="">`, so it resets to "" the moment a choice is made. The change function passed to `bulkEdit` ran later (inside a database transaction) and read `e.target.value` then, so it saw "". Result: priority stored as an empty value (shown as Medium), "No list" stored as list id 0, Add tag stored tag id 0, and a success toast either way. The label in the toast was read early, which is why the toast looked right.
- **Correction (smallest safe):** three small pure helpers in `src/modules/tasks/viewModel.ts` (`bulkPriorityAction`, `bulkListAction`, `bulkTagAction`) take the value as a plain string that the handler reads first (`const a = bulkPriorityAction(e.target.value)`), check it, and return the same label and the same change as before. A value that is not a real choice (empty, unknown, 0, negative, non-numeric) returns null: nothing is written and no toast is shown. `bulkEdit`, `updateTasks`, Undo, the toast wording ("Priority low: 2 tasks", "List changed", "Tag added"), selection and eligibility are unchanged. "No list" still means `listId: null`. No schema change.
- **Regression tests:** `src/modules/tasks/bulkActions.test.ts`, 14 tests against a real fresh database, simulating the dropdown reset: the old pattern is shown to store `""`, `0` and `[0]`; each priority (low, high, medium, reminder) stores exactly that value with the right label and Undo restores both tasks; a specific list stores its positive id; No list stores null; Add tag adds the id once and keeps existing tags; invalid values write nothing; nothing zero or empty is ever persisted; two source guards (the page calls the helpers; the old lazy pattern is absent, and the same regex finds it in the D10 source).
- **Browser readback (fictional demo household, real page, database read before, after and after Undo):** Priority low, high and reminder; List with a specific list and with No list; Add tag with an existing tag: each stored the exact chosen value, the toast said what happened ("Priority high: 2 tasks", "List changed: 2 tasks", "Tag added: 2 tasks"), and Undo restored the exact earlier values. Neighbours rechecked and unchanged: Reschedule, Complete and Project (each set, each undone). The two test tasks, the check list and the check tag were put back or removed.
- **Historical data (NOT touched, no migration, the owner's real records not inspected):** a record changed through those three dropdowns before this fix may hold an empty priority (the app displays it as Medium), a list id of 0 (it matches no list, so the task shows under "No list" in By list), or a tag id of 0 (shown as "#?" on a row). Proposed for later review, read-only and non-destructive: a Settings or developer-console check that lists tasks whose raw `priority` is not one of the four values, whose `listId` is 0, or whose `tagIds` contain 0, shown to the owner for a decision before any change. Nothing was built for it.

**Mobile bulk-action check (375x812, 320x640, 375x560, 320x480; fictional data, scripted):** the selected count is visible; all nine bar controls (count, All N, Complete, date, Reschedule, Priority, List, Project, Tag, Delete) are reachable and at least 44 px high; no horizontal overflow; the corrected Priority dropdown stores the chosen value and Undo restores it at every size; Done selecting clears the mode; with the bar stuck under the header a lower row can be scrolled into view below it, uncovered. **One small CSS correction was essential:** on a short screen the 270 px bar took more than half of the viewport, so the bar is now capped at 45 percent of the screen height and scrolls inside itself (`max-height: 45dvh`; the 270 px bar on a normal phone is unchanged). No redesign and no bottom dock were built. Evidence: `D11-Evidence\after\R-bulk-*.jpg`.

**Final automated results (release candidate, after the correction):** `npx tsc --noEmit` exit 0; `npm run build` exit 0 (only the existing chunk-size notice); full suite **252 files, 4,707 tests, all passed, 0 failed** (101.07 s, run after the last source and CSS edit; the numbers were read from the log). The first full run of the release candidate had **one failure in `src/core/core.test.ts` ("shared data store > queries and tells you when something changes")**: a timing check that waits a fixed 100 ms for a live query, unrelated to this work, which passes when run alone (17 of 17) and in the clean full rerun. It was not edited (no unrelated repairs); it is a candidate for a separate look. New in this correction: `bulkActions.test.ts` (14 tests); the total went from 4,693 in 251 files to 4,707 in 252.

**Deferred design-review items (recorded, nothing implemented):**
1. *Today composition refinement:* evaluate the approved two-column agenda and sidebar arrangement without compromising existing saved dashboard layouts.
2. *Next up wording and selection:* the banner currently selects the first item from the existing Coming up list, which excludes today's items. Review whether the wording or the selection should account for remaining events today. **A possible confusion, not changed:** when today still has a later timed event, the left half says "N on today's schedule" while "Next up" names something from tomorrow or later; the two halves answer different questions.

**Still outstanding (not claimed):** real phones, screen readers, forced-colors mode, Safari and Firefox, the other three presets, the Task editor and Lists dialog in Signature. The prototype alignment statements in section 19 are qualitative design assessments, not measurements.
