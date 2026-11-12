# Ledger Signature D13.1: Today dashboard design-fidelity refinement (2026-11-12)

**State: BUILT AND TESTED LOCALLY; UNCOMMITTED, NOT STAGED, NOT PUSHED, NOT DEPLOYED; AWAITING OWNER AND CHATGPT REVIEW. NOT REAL-DEVICE OR SCREEN-READER TESTED. D14 IS NOT STARTED. The desktop was approved; a final mobile correction (three-day Coming up preview, Cash outlook after Overdue on a phone) is described in section 25 and supersedes the phone statements in sections 8, 20 and 21.**

Everything below is from this session's own runs. Every name, date and amount in the demo data and in the tests is invented. Screenshots are outside the repository in `C:\Users\alexm\Documents\Ledger-Design-Concepts\D13.1-Evidence\` (`baseline` = D11 Today before this change, `after` = after it).

---

## 1. Release gate (verified before any code changed)

| Check | Result |
|---|---|
| Repository | `marshmond/ledger` (`origin` = `https://github.com/marshmond/ledger.git`) |
| Branch | `main` |
| HEAD vs origin | `git fetch` run; HEAD = origin/main = `bec7a86b262fa11875b07447475aadf38f007050` |
| D13 release commit | `bec7a86` `feat(ui): redesign Calendar workspace and event editor` (the D12 release `6807b87` was not used as the baseline) |
| CI for that exact commit | "Deploy to GitHub Pages" run **#99**: completed, success. Read from the public Actions API (`gh` is not installed). |
| Pages deployment | Deployment `7745769026`, environment `github-pages`, sha `bec7a86`, state success (the D12 deployment was already `inactive`). |
| D13 toast and dialog correction | Included in that commit: `body:has(.modal-back) .toasts { z-index: 90; }` is at `src/styles.css` line 361 of `bec7a86`. |
| D13 report and handoff | `docs/LEDGER-SIGNATURE-D13-REPORT.md` read (sections on D13-F1 and the toast fix). `docs/CHATGPT-HANDOFF.md` and `docs/BACKLOG.md` still described D13 as "uncommitted" at the gate; that wording is stale and is corrected in this batch. |
| Working tree | Only the three protected untracked files: `docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`. They were not modified, staged or deleted. |

## 2. Design references read

- **Approved D3.1 prototype** (authoritative visual target): `D3.1-Ledger-Signature\D3.1-DESIGN-REPORT.md`, `Ledger-Signature-desktop.png` (1440 wide) and `Ledger-Signature-mobile.png` (375 at 2x). The HTML prototype and `shot.mjs` were present; the pictures were used. There is no dark picture of the prototype ("Static pictures: no hover, focus, loading or dark mode").
- Also read for context: the D3.1 report's "Unresolved design choices" and "Proposed or changed elements", the D11 report (sections 2, 5, 6, 16, 19, 20), the D12 `homeSections.ts` pattern and `HomePage.tsx`, `docs/UI-COVERAGE.md`, and the Today source. The D4 blueprint files and the D3.2 to D3.4 reports were not re-read in full for this refinement; the D11 report records what they said about Today, and only Today was changed.
- Prototype data and demo data differ on purpose (the prototype is Tuesday Nov 10 with a 16-item week; the demo household is Thursday Nov 12 with 17). Comparisons are labeled.

## 3. What D11 left short (and why this phase exists)

D11 matched the prototype's colors, date tiles, Next up bar and band, but kept the old arrangement: an ordered list of half and full width cards (`today.layout.v1`). Result: Overdue and Coming up sat side by side as equal cards, the supporting cards (Bills, Home & Assets, Household finances, Needs attention, Cash outlook) were equal-weight cards in a two-wide grid under them, rows had a colored bar, a time column and a second line, and the phone header spent a row on its two controls. D11's own estimate was 70 to 75 percent.

## 4. Existing Today card inventory (confirmed from source and on the demo household)

Eleven cards, unchanged in id, title, provider, priority, default width, hide-when-empty flag, accessible name, link and empty text (a test reads the card source files and pins them):

| Card id | Title | Provider | Hidden when empty? | Now placed in |
|---|---|---|---|---|
| `today.agenda` | Today | Today | no (slim one-line card when empty) | agenda column, 1st |
| `today.reminders` | Reminders due | Today | yes | agenda column, 2nd |
| `today.overdue` | Overdue | Today | yes (kept when "older" links exist) | agenda column, 3rd |
| `today.upcoming` | Coming up | Today | no | agenda column, 4th |
| `ledger.attention` | Needs attention | Ledger | no | side column, 1st section |
| `ledger.cash` | Cash outlook | Ledger | yes | side column, 2nd section |
| `bills.attention` | Bills & Subscriptions | Bills | yes | side column, "Household status" group |
| `household.attention` | Household finances | Household | yes | same group |
| `assets.attention` | Home & Assets | Assets | yes | same group |
| `services.attention` | Household Services | Services | yes | same group |
| `projects.attention` | Projects | Projects | yes | same group |

**Data providers:** one aggregation (`TodayDataProvider` using the Calendar's `useCalendarData` plus every due provider, with the "older" links query) feeds the four Today cards; each other card reads its own module (`useLedgerAlerts`, `loadForecast`, the Bills, Services, Assets, Household and Projects read models). None of this was edited. The pure rules (`logic.ts`: `todayList`, `overdueGroups`, `limitOverdue`, `upcomingDays`, `reminderItems`, `maskAmounts`) and `settings.ts`, `TodayData.tsx`, `layout.ts` are byte-for-byte unchanged.

## 5. Existing customization (before) and the compatibility strategy

- **Before:** `localStorage` key `today.layout.v1` = ordered list of `{id, size: half|full, hidden}` for all cards; Edit layout had move earlier/later, make wider/narrower, Hide/Show, Reset to default (which deleted the key), plus two shared settings (look-ahead days, overdue rows). Hide amounts is `today.hideAmounts.v1`.
- **Which of those constrained D3.1:** the width control and the single ordered list (a wide agenda column beside a narrow side column cannot be expressed as half and full cards).
- **After (new key `today.layout.v2`, `{ side: string[], hidden: string[] }`):** the agenda column is fixed; the side column's sections can be moved up or down; any card can be hidden and shown; widths are gone. `today.layout.v1` is **never written, changed or deleted** by the new code (a test proves the earlier value is byte-for-byte unchanged after every operation, including Reset).
- **Compatibility:** with no new key and a customized earlier layout, the new arrangement is **derived in memory** (side section order follows the earlier card order, a group sits where its first card was, every hidden card stays hidden, widths are dropped), nothing is written, and a dismissible note says so ("Your earlier Today layout was carried over ... Card widths no longer apply ... Your earlier saved layout is untouched") with "Got it" and "Use the new default arrangement". Only an explicit change writes `v2`. After that, Edit layout offers "Use my earlier layout again" (removes only `v2`, so the earlier layout is carried over again). "Reset to default" writes the designed default under `v2`.
- **Trade-off for the owner to review:** a width choice made in the earlier layout cannot be honored (there is no per-card width any more). Nothing else is lost.

## 6. Exact files changed

**New (4):** `src/modules/today/composition.ts` (pure arrangement model and storage), `src/modules/today/d131Composition.test.ts` (18 tests), `src/modules/today/d131Today.test.tsx` (21 tests), `src/modules/today/d131Contrast.test.ts` (12 tests: Classic and every preset, light and dark).
**Edited (7):** `src/modules/today/TodayModule.tsx` (page composition, Edit layout), `src/modules/today/TodayRow.tsx` (row markup), `src/modules/today/cards.tsx` (card markup: head line with count, module strips, `data-day`), `src/modules/today/TodayHero.tsx` (two small text changes), `src/modules/today/todayModel.ts` (`kindIcon`), `src/modules/today/today.css`, `src/modules/ledger/todayCards.tsx` (a decorative icon on each Needs attention row; the alert, its actions and its memory are unchanged).
**Documents:** this report, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`, `docs/UI-COVERAGE.md`.
**Not touched:** `logic.ts`, `layout.ts`, `settings.ts`, `TodayData.tsx`, every other module's Today card, the database, sync, backup, routes, themes and their storage, the shared components (`PageHeader`, `DateTile`, `StatusChip`, `Toast`, `Modal`), Quick Add, Search, global navigation, D12 Home, D13 Calendar, `package.json` (no dependency), the service worker, and the three protected untracked files.

## 7. Desktop composition

Top to bottom: heading and date line; the **Next up bar** (navy, title enlarged to the prototype's weight); the **status band** (Overdue, Today, Coming up); then two columns inside a size container (the columns appear when that area is at least 880 px wide, about 62 and 38 percent, so a window narrowed by a sidebar still falls back to one column).
- **Agenda column (fixed order):** Today (a slim one-line card when empty, so it does not repeat the bar), Reminders due (only when due), **Overdue**, **Coming up**. Each is one open section: a head line with a hairline, full-width rows, no card inside a card.
- **Overdue:** a strip per module with its name and count ("BILLS & SUBSCRIPTIONS 2"), rows that start with the red date tile (weekday, day, month), the title with the shared Overdue chip, the source line with a small kind icon, and an outlined action button ("Open bill") or the check button.
- **Coming up:** a gutter with one date tile per day (tomorrow tinted and captioned "Tomorrow", weekend tinted), and one-line rows: time column, kind icon box, title and source on one line (the source drops below only when there is no room), then "Edit in Calendar", "Open bill" or the check button.
- **Supporting column:** Needs attention (rows separated by hairlines with a small icon), Cash outlook, then the **Household status** panel: the five attention cards drawn as one panel with a small-caps strip per card (name, count, link) and rows with a chevron.

## 8. Mobile composition

*(Superseded in part by section 25: the phone now previews the first three days of Coming up with a Show all button, and Cash outlook follows Overdue.)*

Order: compact header (title and the two controls share one row, the date line under it; Edit layout shows only its icon, its name kept for screen readers); the Next up card (stacked); the three-count band; the agenda cards; the seven-day strip above Coming up (kept from D11); then the supporting sections. Rows are three lines at most: title, "time · source", with the kind icon at the left. Words buttons ("Open bill", "Edit in Calendar") become a 44 px chevron at the right (the words stay as the accessible name; the title opens the same place) so titles keep the width; check buttons stay at the right. Measured at 375 x 812 the first screen holds the header, the whole Next up card and the band, and the top of the Today card. The phone page is about 4,320 px tall (D11 on the same data: about 5,040); on a computer it is about 2,170 px (D11: about 2,440). The approved phone prototype is shorter still (about 2,670 px) because it collapses Coming up to three days (deviation 6 below).

## 9. Next up: current rule, findings and the unresolved decision

- **Exact current rule (unchanged):** Next up is the **first row of the Coming up list** (the days after today, in that list's own order: all-day items first, then by time). Today's items are in the Today list, never in Coming up.
- **Data available for later today:** `todayList` holds every item covering today (events with a start time, all-day events, tasks and bills due today). Items carry `allDay`, `startMs` and `firstDay`, so timed events can be compared with the clock; a task or bill due today has no time, so it cannot be ordered against a timed event without a rule.
- **Would a true chronological Next up need a new product rule?** Yes: whether an all-day task due today outranks a timed event this afternoon, what to show after the last timed event of the day, and whether overdue items count are priority decisions. None was invented.
- **Presentational change made (accurate, no new rule):** when today still has items, the label reads "Next up · after today" (and the left half says "N on today's schedule" with "Listed under Today below"), so the bar never claims that a tomorrow item is the next thing today. With nothing today the label stays plain "Next up"; the left half says "Nothing scheduled for today" and "No events or due items today".
- **Options for the owner (not built):** (A) keep as is; (B) Next up = next timed event still ahead today, else the first Coming up row; (C) all of today's remaining items first (timed by time, then all-day), then Coming up. B and C change what Next up means and need an explicit decision on task-versus-event priority.

## 10. Overdue and Coming up data preservation

A before/after comparison on the same fictional household and the same day (`today-state-B.json` before, `today-state-A.json` after): the 20 rows (section, day, title, action) are **identical and in the same order** at 1440 and at 375; the three band numbers and their subtitles are identical (Overdue 3, Today 0, Coming up 17); the Next up text is identical; the set of cards on the page is identical (only their order differs, by design). Overdue eligibility, grouping, ordering, the overdue-rows limit and the "older" links are the same functions.

## 11. Supporting-card treatment

The five attention cards are visually one "Household status" group (a decorative title; the group itself is a labelled `role="group"`; each card keeps its own `h2`, accessible name, badge and link, and still disappears by itself when empty; the group disappears when all its cards do). Needs attention and Cash outlook are ordinary quiet cards. No card was removed, merged in data, or re-implemented.

## 12. Customization decisions (owner's priority: designed default, then reordering, then hide/show, then sizing)

Fixed: Next up bar, status band, the four agenda cards' order. Reorderable: the side sections (Needs attention, Cash outlook, Household status, and any card a later module adds, appended at the end). Hide and Show: every card, including agenda cards (kept from D11 so nothing a person hid before is forced back on). Not offered: resizing. A hidden "Today" or "Overdue" card remains one click away in Edit layout's "Hidden cards" list.

## 13. Saved-preference compatibility: tested

Unit tests on a recording fake storage (section 17) and a browser run on the demo profile: fresh profile gets the default and writes nothing; a customized earlier layout (Cash outlook first, Bills hidden, widths changed) is carried over, the note shows, **nothing is written** (neither key), "Got it" writes nothing, "Use the new default arrangement" saves the default under `v2` and leaves `v1` untouched, "Use my earlier layout again" removes only `v2`; moving a section and hiding a card write only `v2`; the saved arrangement and the hidden card survive a reload; Reset to default restores the designed order and the card.

## 14. Hide amounts

Semantics unchanged (same switch, same key `today.hideAmounts.v1`, same help text, passed to every card). Rows and the Next up bar mask `$` amounts in titles and places exactly as before (tests: markup, accessible name and tooltip). The new decorative icons carry no text. In the browser, with a fictional task titled "...$60" and the switch on: no `$` amount anywhere in the page text, accessible names or tooltips at 1440 and 375, and `$••••` shown for the cash outlook and warning level; it stayed on after a reload. The Ledger cards' own Hide amounts handling was not changed.

## 15. Task and Calendar integration

Browser (fictional data): the check button completes a task, the Coming up count falls by one and the row leaves; Undo in the toast restores it (desktop and phone); the Next up button opens Tasks; an event title opens the Calendar agenda on its day and the event editor; "Open bill" opens Bills; the card links resolve to `#/calendar?v=agenda`, `#/ledger`, `#/ledger/forecast`, `#/bills/upcoming`, `#/assets`; the Add button (desktop) and the floating Add (a real pointer tap on the phone) open Quick Add. `openItem`, `openLabel` and the completion code are the D11 code; a unit test pins the Calendar deep-link address. No recurrence, schedule or database code was touched (a source guard checks the new files).

## 16. Date and time correctness

Same `today` from `useToday` (checks every 30 seconds and when the window becomes visible or focused), so an open Today moves to the new day by itself; no timer, clock or storage was added to the Today files (a source guard checks this). Tests cover the next seven days across a month end, a year end, a leap day and a non-leap February, and the clock-change days 2026-03-08 and 2026-11-01 (a date-only item stays on its date; "Tomorrow" is right the day before). No new time zone logic. Midnight itself was not waited for in a browser.

## 17. Automated test results

| Check | Result |
|---|---|
| Targeted: `src/modules/today`, ledger, tracker | 6 files, 120 tests passed (after the last source edit: re-run before the full suite) |
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | exit 0 (only the existing "chunks larger than 500 kB" notice) |
| Full suite, once, after the last source edit | **264 files, 4,938 tests, all passed, 0 failed** (118.07 s, exit 0; started after the last source and stylesheet edit; the figures were read from the log). The tracker and coverage guards were run again after the three documents were edited (see section 24). |
| New tests | 51 in the first pass: `d131Composition.test.ts` 18, `d131Today.test.tsx` 21, `d131Contrast.test.ts` 12 (the "49" first written here was a miscount; the total of 4,938 was read from the log). Section 25 adds 24 more. |
| Existing tests edited | none |

What the new tests pin: the eleven card ids come from the source files and are each placed exactly once; the agenda order is fixed whatever is saved; the default and every storage path above (including that `today.layout.v1` is never written); sanitizing bad data; moving, hiding and showing; row markup (time or tile, kind icon decorative, Overdue chip, check versus words button, masked amounts); Next up and band (selection unchanged, "after today" only when today has items, empty states, masking); date rules; the page's reading order, the container query and column proportions, no hex colors or `!important`, 44 px targets, no timer or money code; contrast of the new tinted words in 12 palettes (arithmetic, not a look at a screen).

## 18. Browser verification (fictional demo household, headless Chrome on a throwaway profile, sync off)

Driven by DevTools-protocol scripts with real pointer events for the phone tap and key events for Tab. **Not a physical phone or keyboard.**
- **Desktop (25 checks, all passed):** listed in `after\browser-verify-desktop.json`: navigation, completion and Undo, Quick Add, default order, edit mode controls (agenda cards have Hide but no move), saved order and hidden card across reload, Reset, the earlier-layout note and its three buttons, Hide amounts and reload.
- **Phone (20 checks, all passed)** on a second throwaway profile with added fictional records (a 120-character title, an unbroken 90-character word, a busy day, two tasks due today): at 375 x 812 and 320 x 640 no horizontal overflow; long and unbroken titles stay inside their rows; every button, check and title target is at least 44 px (the first run found the icon-only Edit layout at 34 x 32; fixed); the last card clears the floating Add button by 32 px; overdue and upcoming items open their modules; complete and Undo; Quick Add sheet by a real tap; Hide amounts. Also no overflow at 812 x 375 (short landscape), 375 x 560, 768 (one column), 1024 and 1280 (two columns).
- **Keyboard:** a 61-stop Tab walk on desktop in a logical order (Hide amounts, Edit layout, Next up, the agenda rows left to right, then the side column); every stop showed a focus indicator.
- **Themes:** Signature light and dark, Classic light and dark, Slate light (desktop) and Classic light and Slate dark (phone): no overflow, nothing broken. The empty profile (no records) at 1440 and 375 is usable ("Nothing in the next 7 days", "Alerts will show here once you have entered some data in Ledger").
- No console errors in any run.

## 19. Screenshot locations (all outside the repository)

`D13.1-Evidence\`:
- `P01-D3.1-prototype-desktop-UNCHANGED.png`, `P02-D3.1-prototype-mobile-UNCHANGED.png` (byte copies of the approved pictures).
- `D13.1-TODAY-DESKTOP-PROTOTYPE-VS-FINAL.png`, `D13.1-TODAY-MOBILE-PROTOTYPE-VS-FINAL.png` (prototype left, implementation right, same scale; labeled with the differing data and dates).
- `baseline\B01`..`B07` (D11 Today before: desktop light and dark, phone light and dark, Hide amounts) plus `today-state-B.json`.
- `after\A01`..`A07` (same views after), `A05` Signature dark, `A08` Overdue agenda and `A09` Next Seven Days close-ups (and phone `A08m`, `A09m`), `A10b` supporting sections, `A10` and `A11` Edit layout and a customized layout, `A12` earlier-layout note, `A13`..`A17` Classic and Slate, `A18` Next up and band, `A19` and `A19m` empty profile, `A20` focus ring, `M375-*` and `M320-*` phone checks (initial view, full page, page bottom, Quick Add sheet, Hide amounts, dark), `V-*` other sizes, and the JSON results.

## 20. How closely the result matches D3.1 (candid)

**About 85 to 90 percent on composition and hierarchy, about 80 percent on content; the pictures are the evidence, not the number.** Matches: the page rhythm; the navy Next up bar with its split "today / next" halves; one status band; the two-column desktop composition at the prototype's proportions (Overdue then Coming up on the left; Needs attention, Cash outlook and the Household status panel on the right); module strips with counts; red date tiles in Overdue; the date gutter, time column and kind icons in Coming up; outlined action buttons; the chevron rows in Household status; hairline rows instead of colored bars; the compact phone header.

**Material deviations and their real reasons:**
1. **No "Bills due" or Cash outlook cell in the band** (the prototype has four cells). "Bills due" is a count Today does not have, and a new count is excluded; Cash outlook is a Ledger-owned card, so it leads the side column instead.
2. **No "Household services (Proposed)" block**: it is a new dashboard block, excluded. The existing Household Services attention card is in the Household status panel.
3. **No Family member names or colors on rows, no kind legend** (Family association on a row is not an existing Today feature; the kind icon replaces the legend).
4. **No second "Calendar >" button in the Next up bar and no member chip**: only the existing action is offered.
5. **No weekday eyebrow**: the shared `PageHeader` hides its eyebrow outside Signature; the bold weekday in the date line stays (D11 decision).
6. **(Superseded by section 25: both are now built.) Phone: no three-day collapse ("Show all 16 items") and the cash card is not between Overdue and Coming up.** The brief says not to hide agenda items and fixes the order Overdue, Next Seven Days, then supporting content, so both prototype choices were deliberately not followed. The phone page is therefore longer than the prototype's.
7. **Next up selection** is the existing rule (section 9), not the prototype's timed-event-first pick.
8. **Row density:** Overdue rows are two lines like the prototype; Coming up rows are one line on desktop. Rows are a little taller than the prototype's (44 px tap targets, the check button is 40 px).
9. **Navy in Signature dark is teal** (the primary-button color, decided in D11).

## 21. Outstanding product decisions

1. Next up semantics (section 9): keep, or choose option B or C.
2. Widths from the earlier layout are dropped (section 5): accept, or want something else.
3. ~~Phone: keep "show every day" or allow the prototype's three-day collapse; where Cash outlook sits on a phone.~~ Resolved in section 25 (three-day preview built; Cash outlook after Overdue on a phone).
4. Whether a later phase may add "Bills due" and a cash cell to the band (new count and a Ledger-owned card in the band).
5. Whether Family member names or colors should appear on Today rows (needs a Family-link decision; not assignment).
6. Whether agenda cards should stay hideable.

## 22. Not verified, and limits

Real phones (touch, the floating Add over rows, safe areas, the on-screen keyboard), screen readers (names, the group label and the hidden day headings were written for them but not heard), forced-colors mode, Safari and Firefox, the other presets on a phone beyond the two looked at, midnight rollover in a browser, Today with a very large number of items, and Tab order on a phone. The DOM order puts the agenda before the supporting column on every size; at two columns the visual order is the same. The prototype-match percentages are qualitative.

## 23. Findings noticed (not changed)

- Three `.toasts` containers exist on the page at once (shell and module providers); they were already there and are empty when idle.
- `layout.ts` functions for the earlier layout (`loadLayout`, `saveLayout`, `resetLayout`, `toggleEntry*`, `moveEntry`) are no longer used by the page; they are kept (tests and the carry-over read use `resolveLayout` and `defaultLayout`). They can be removed in a later cleanup.
- The handoff and backlog still described D13 as uncommitted at the gate; corrected here.

## 24. Documents and Git

- **Handoff updated:** yes (`docs/CHATGPT-HANDOFF.md`: top notice, current phase, test baseline, delivered-functionality entry, change log). It says the D13.1 work is built locally and pending review, D13 is committed and deployed as `bec7a86` (run #99), and nothing is committed.
- **`docs/BACKLOG.md`:** new top entry. **`docs/UI-COVERAGE.md`:** new section 1.10 and a summary line; T-01 and W-13 stay `BLT` with no new mark claimed beyond what section 1.10 records; nothing is `ACC`.
- **Guards re-run after the documents were edited:** `src/shell` and `src/modules/today` (the tracker, residue and leak guards live there): 509 tests passed, 0 failed. The full suite was not repeated for a documents-only edit.
- **Git status at the end:** modified: the seven source files above and the three tracked documents; new: `composition.ts`, the three `d131*` test files and this report; the three protected untracked files unchanged. Nothing staged, committed, pushed or deployed; no branch, remote or repository created. The demo dev server on port 5231 was left running (stop it by the process id listening on that port).


---

## 25. Final mobile design-fidelity correction (2026-11-12, after the desktop was approved)

**State: BUILT AND TESTED LOCALLY; still UNCOMMITTED, NOT STAGED, NOT PUSHED, NOT DEPLOYED; awaiting owner and ChatGPT review. Owner acceptance is NOT recorded.** The desktop arrangement was approved and was not changed.

**Gate re-verified before any edit:** `main` = `origin/main` = `bec7a86`; D13 CI run #99 and the Pages deployment succeeded; nothing staged; the working tree matched section 24 (seven edited source files, three edited documents, the new files, the three protected untracked files).

### 25.1 What was built

1. **Coming up preview on a phone (640 px and narrower, the same width the stylesheet uses).** While collapsed, only the first three populated days are drawn, each whole (a busy day shows every item). One ordinary button under them reads **"Show all 17 items"** (the number is the real count of Coming up rows, the same number the status band shows; a second line says "Also Mon 16 to Thu 19 · 10 more", with the month named when the hidden days cross a month or year). With three days or fewer there is no button. After it is used the button reads **"Show fewer"** (second line "Back to the first 3 days"). A computer and a tablet always draw every day and no button.
2. **Cash outlook on a phone** follows Overdue (the D3.1 mobile order: Overdue, Cash outlook, Coming up, Needs attention, Household status). It is the same registered card, drawn once; on a computer and a tablet it stays in the supporting column where the arrangement puts it.

### 25.2 How the preview works (display only)

- **Selection rule:** `previewDays(days, 3)` in `todayModel.ts` takes the first three entries of the list `upcomingDays` already returns (whole days, same objects, same order); the rest are the hidden days. Nothing is recounted, filtered or re-sorted, `logic.ts` and the look-ahead setting are untouched, and no second provider or query exists (a test counts one `useTodayData()` and one `upcomingDays(` call).
- **Semantics:** a `<button type="button">` with `aria-expanded` (false when collapsed, true when expanded) and `aria-controls` pointing at the list's container; no custom role, tabindex, gesture or animation. Mouse, touch, Enter and Space all work (browser run).
- **Focus and scroll:** after "Show all" the focus moves to the first revealed row (the browser scrolls it into view, so the new days appear instead of the page jumping past them), and a hidden status line says "Showing all 14 items" once. After "Show fewer" the button keeps focus. The state is not saved anywhere: every visit and every reload starts compact (browser run).
- **Hide amounts, completion, Undo, navigation:** the rows are the same `TodayRow`; masking, the check button, the toast Undo and the Calendar and module links behave as before (tests and browser run).

### 25.3 Cash outlook placement and customization rule

- **Rule (pure, in `composition.ts`, `composeToday(cards, arrangement, { phone })`):** on a phone the `ledger.cash` card is removed from the supporting column and drawn in the agenda column right after Overdue. Its Hide setting still applies (a hidden card stays hidden; Edit layout still lists it). The position the owner gave it in the supporting column is kept in the saved arrangement and still applies on a computer and a tablet. The owner's order for the other supporting sections is honored on a phone.
- **Why this is safe:** one render at a time (React draws it in the agenda column on a phone and in the side column elsewhere), so the page order IS the visual order and the Tab order; no CSS `order`, no duplicate card, no second data load, no new calculation. A test fails if the stylesheet ever uses `order:` or a reversed flex direction.
- **Edit layout on a phone:** Cash outlook shows in the agenda column with "on a phone it follows Overdue" and a Hide button; the move arrows of the other sections step past it (`moveUnit(..., skip)`), so a visible change always follows a tap. Browser run: with the saved order Needs attention, Cash outlook, Household status, "Move Needs attention later" saved Household status, Cash outlook, Needs attention and the visible order matched.
- **Storage:** `today.layout.v1` and `today.layout.v2` are never written by composing or by the preview (browser run with three fictional profiles below).

### 25.4 Page height (375 x 812, fictional demo household, Signature Light)

| State | Page height |
|---|---|
| D11 Today before D13.1 | 5,040 px |
| D13.1 first pass (all days, Cash outlook after the whole agenda) | 4,319 px |
| **After this correction, collapsed (default)** | **3,382 px** |
| After "Show all 17 items" | 4,388 px |
| Approved phone prototype | 2,668 px |

On a phone the first screen is unchanged (header, Next up, band, the top of the Today card). Needs attention and Household status now begin about 940 px higher than in the first pass (the preview removes 4 of 7 days and Cash outlook sits earlier).

### 25.5 Files changed in this correction

**New:** `src/modules/today/d131MobilePreview.test.tsx` (24 tests).
**Edited:** `cards.tsx` (a presentational `UpcomingAgenda` plus the card's state), `todayModel.ts` (`PREVIEW_DAYS`, `PHONE_QUERY`, `previewDays`, `showAllLabel`, `hiddenRangeText`, `moreText`), `composition.ts` (`PHONE_PROMOTED`, `composeToday` option, `moveUnit` skip list), `TodayModule.tsx` (phone flag, the Edit layout note and skip), `today.css` (the Show all button and Cash outlook padding on a phone), `d131Contrast.test.ts` (two pairs added), and the report, handoff, backlog and tracker. **Not touched:** `logic.ts`, `layout.ts`, `settings.ts`, `TodayData.tsx`, `TodayRow.tsx`, `TodayHero.tsx`, every module's card, the database, sync, recurrence, Quick Add, Search, navigation, Home, Calendar, `package.json`, and the three protected untracked files.

### 25.6 Automated results

| Check | Result |
|---|---|
| Today folder after the last source edit | 7 files, 144 tests passed |
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | exit 0 (only the existing chunk-size notice) |
| **Full suite, once, after the last edit** | **265 files, 4,962 tests, all passed, 0 failed** (109.98 s, exit 0; read from the log). The first full run of this correction had 1 failure: the leak-scan guard flagged a date regex in my new test (it looks for short numbers); fixed with the guard's documented `// ids-ok` marker, the type checker also flagged an unused helper, and the whole suite was run again. |
| New tests | 24 in `d131MobilePreview.test.tsx` (plus two contrast pairs inside the 12 existing palette tests). D13.1 total: 75 new tests (18 composition, 21 rows and structure, 12 contrast, 24 preview). The first-pass count of "49" in sections 6 and 17 should read 51 (the contrast file has 12 tests). |

What the 24 pin: three populated days collapsed; fewer than three, exactly three and none (no button); a busy day with nine rows shown whole; the real total in the label (and singular wording); expanded shows every day and row in the original order with Show fewer, `aria-expanded` and the status line and the focus marker on the first revealed day; collapsing returns exactly the first view; check and Open actions in both states; Hide amounts masking in both; a computer always draws everything; the button is an ordinary button with `aria-controls` to a real container; range wording across a month, a year and a leap day; the expanded state is not stored; the Coming up rules in `logic.ts` are untouched; no CSS ordering trick; one phone width; Cash outlook drawn once on a phone and on a computer, in the right place, unchanged elsewhere, hidden stays hidden, absent card changes nothing; moves skip the promoted card; earlier layouts are still carried over and composing never writes.

### 25.7 Browser verification (fictional household, headless Chrome on throwaway profiles, sync off)

Driven by DevTools-protocol scripts with real pointer taps for the phone and key events for Enter, Space and Tab. **Not a physical phone or keyboard.** Run after a harness fix (see 25.9).
- **Phone, 375 and 320 (53 checks on the demo household, 51 on the busy one, all passed):** collapsed shows exactly the first three days (the same dates as the baseline); the label's number equals the status band (17); the button is at least 44 px tall and controls a real list; collapsed and expanded have no horizontal overflow; a real tap on Show all reveals all seven days and every row, equal in content and order to the D11 baseline Coming up rows; the button reads Show fewer with `aria-expanded` true; focus is on the first revealed row; the status line announces it; a tap on Show fewer returns to the same three days and rows; Enter expands and Space collapses; a reload is compact again and no stored preference changed; the section order is Overdue, Cash outlook, Coming up, Needs attention, Household status; Cash outlook is on the page exactly once, in the agenda column; the Tab order follows the page order (Overdue, Cash outlook, Coming up) and Show all is a Tab stop after the third day.
- **Workflows at 375:** an event opened from the preview opens the Calendar on its day; completing a task lowers Coming up and the Show all count together and Undo restores both; Hide amounts leaves no amount in text, names or tooltips and Cash outlook shows `$••••`; the last card clears the floating Add by at least 4 px (32 px measured) and a real tap on it opens Quick Add; the busy profile (a 120-character title, an unbroken 90-character word, a busy day) fits.
- **Other sizes:** 640 x 360, 375 x 560 and 812 x 375 have no overflow (812 is wider than a phone, so it uses the computer layout in one column with the full list). Earlier checks still pass: 20 phone checks (targets, clearance, overflow, themes) and a 61-stop keyboard walk.
- **Computer, 1440:** the full-page pictures (Signature Light and Dark) are **byte-for-byte identical** (SHA-256) to the captures taken before this correction; the 20 desktop rows, the three counts and Next up equal the baseline; all seven days are drawn with no Show all button; Cash outlook stays in the supporting column once; 25 workflow checks (navigation, completion and Undo, Quick Add, edit mode, reload, Reset, the earlier-layout note and its buttons, Hide amounts) passed again.
- **Preferences (14 checks, all passed):** *no saved preferences* (nothing written by any of the above); *an earlier `today.layout.v1` customization* (note shown on both sizes; on a phone Cash outlook follows Overdue and Bills stays hidden; on a computer Cash outlook first in the side column; no key written, v1 byte-for-byte unchanged, even after Show all); *an existing `today.layout.v2` customization* (computer: Household status then Cash outlook, Needs attention hidden; phone: Cash outlook after Overdue and only the Household status panel in the side column; v2 unchanged by loading or by Show all; the phone move rule above).
- Signature Dark and Classic were captured collapsed and expanded at 375 and looked at; no console errors in any run.

### 25.8 Evidence (outside the repository, `D13.1-Evidence\\`)

`D13.1-TODAY-MOBILE-FINAL-COLLAPSED.png` (full page, default state), `D13.1-TODAY-MOBILE-FINAL-EXPANDED.png` (full page after Show all, captured from the top of the page because a full-page capture taken while scrolled draws the fixed header and skip link in the middle of the picture), `D13.1-TODAY-MOBILE-FINAL-VIEWPORT-375x812.png` (the normal first screen), `D13.1-TODAY-MOBILE-PROTOTYPE-VS-REFINED.png` (the unchanged prototype, the collapsed result and the expanded result at the same scale, labeled with their different data and dates), `D13.1-TODAY-DESKTOP-PRESERVED-1440-VIEWPORT.png` and `-FULL.png` (the desktop, unchanged), and in `after\\`: `N375-*` (Hide amounts with Cash outlook, dark and Classic collapsed and expanded, earlier-layout phone, phone Edit layout, short viewports), `browser-verify-mobile-preview-demo.json`, `-busy.json` and `browser-verify-preferences.json`. The older prototype-versus-final pictures were regenerated from the current code.

### 25.9 Candid assessment and remaining differences

**Phone fidelity is now about 85 to 90 percent in order and density** (before: the same hierarchy but nearly twice the length). The order is the prototype's; the first three days and the Show all row match it; Cash outlook sits where the prototype puts it. **Remaining differences from the approved phone prototype:**
1. The page is still taller when collapsed (3,382 px against 2,668 px): rows keep 44 px targets and a "time · source" line, overdue rows show the Overdue chip on its own line, and Cash outlook is a plain card without the prototype's green "Stays above your warning level" pill.
2. No "Bills due" cell, no Household services block, no Family names or member chips on rows, no weekday eyebrow, no kind legend (unchanged from the desktop decisions in section 20).
3. Next up keeps its D11 rule (section 9); the decision is still open.
4. Words buttons are chevrons on a phone (kept).
5. Cash outlook is promoted only at 640 px and narrower; a tablet in one column keeps it in the supporting column.

**Harness note (not an app issue):** during this correction a test harness left stale values in a throwaway profile because the browser had not yet flushed removed local-storage keys when the harness killed it; the scripts now wait for the flush, the profile was cleaned, and every result above was produced after that fix. No real preference was touched.

### 25.10 Outstanding product decisions (unchanged from section 21, with item 3 narrowed)

Next up semantics; dropped widths; whether the phone preview should be three days (built) or another number; a "Bills due" or cash cell in the band; Family names on rows; whether agenda cards stay hideable.

### 25.11 Git status at the end

Modified (tracked): `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`, `docs/UI-COVERAGE.md`, `src/modules/ledger/todayCards.tsx`, `src/modules/today/{TodayHero,TodayModule,TodayRow,cards,today.css,todayModel}` (ten files, the same ten as before this correction). New (untracked): `composition.ts`, `d131Composition.test.ts`, `d131Today.test.tsx`, `d131Contrast.test.ts`, `d131MobilePreview.test.tsx` and this report. The three protected untracked files are unchanged. Nothing staged, committed, pushed or deployed; no branch, remote or repository created. The demo dev server on port 5231 is still running.
