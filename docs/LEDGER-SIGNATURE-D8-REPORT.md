# Ledger Signature D8: Ledger desktop navigation (2026-11-11)

**Status: built and tested locally. UNCOMMITTED, NOT STAGED, NOT PUSHED, NOT DEPLOYED. Awaiting owner and ChatGPT review. NOT REAL-DEVICE OR SCREEN-READER TESTED.** D9 is not started.

Plain-language summary: on a computer (900 px and wider) Ledger's left-hand menu is gone. In its place a slim bar sits directly under the top header with Home, Money, Invest, Plan and More. Clicking a name takes you to that section's main page; a small arrow beside Money, Invest, Plan and More opens a list of that section's pages. Every one of the 31 pages, the page for each individual account, the breadcrumbs, the due-payment numbers and the Light/Dark/Device switch are still there. The pages themselves were not redesigned; they simply have more width. On a phone or a narrow window nothing changed: same bottom tab bar, same scrolling page tabs.

## 1. Release gate (verified before any edit)

| Check | Result |
|---|---|
| Repository and branch | `marshmond/ledger`, `main` |
| HEAD vs origin | `13acc043708e4c40af32e26ff32b0c888db0fd17` = `origin/main` (after `git fetch`) |
| D7 release commit | `13acc04` `feat(ui): redesign Ledger global header and module switcher` (D6 `17e509d` is not the baseline) |
| CI | GitHub public Actions API (`gh` is not installed): run **#93** "Deploy to GitHub Pages" for `13acc04`, **completed / success** (2026-11-12 03:43 UTC) |
| Pages deployment | deployment `7727785557` for `13acc04`, latest status **success** |
| D7 report and handoff | `docs/LEDGER-SIGNATURE-D7-REPORT.md` read (including section 17); the handoff still called D7 uncommitted, corrected in this batch |
| Phone sync-attention correction in the release | Yes: `src/core/SyncChip.tsx` and `src/shell/d7SyncAttention.test.tsx` are in the `13acc04` diff |
| Working tree at the start | only the three pre-existing untracked files (`docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`); all untouched |

No branch, repository or remote was created; no broader GitHub permission was requested; no production or household data was used (section 15).

## 2. Files modified

Source (7): `src/shell/LedgerNav.tsx` (new), `src/shell/ledgerNavModel.ts` (new), `src/shell/Shell.tsx`, `src/styles.css`, `src/ui/tokens.css` (two tokens), `src/palette.ts` (two Signature values).
Tests (3): `src/shell/d8LedgerNav.test.tsx` (new, 43 tests), `src/shell/d7Header.test.tsx` (one test's sticky-rule expectations), `src/shell/uiCoverage.test.ts` (expected list and title).
Docs (4): this report, `docs/UI-COVERAGE.md`, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`.

Not touched: `nav.ts`, `LedgerModule.tsx`, `routePaths.ts`, `ThemeToggle.tsx`, `ModuleBar.tsx`, `GlobalFrame.tsx`, `QuickAdd.tsx`, `SearchDialog.tsx`, the database, sync, backup, any calculation or page, `package.json`.

## 3. Existing financial navigation inventory (documented before changing it)

Read from `src/shell/Shell.tsx`, `nav.ts`, `sideState.ts`, `LedgerModule.tsx`, `routePaths.ts`, `styles.css`:

- **Desktop (900 px and up):** a 248 px sticky left sidebar (`.sidebar`, grid column), built from `GROUPS`: a Search button with a Ctrl K hint; Home as a plain link; Money, Invest, Plan, More as accordion headers (one open at a time, remembered in `localStorage` key `ledger-side-open`, and the group of the current page opened on arrival); the pages as links, with a count badge on Scheduled; at the foot a "Settings & about" link and the theme toggle. The `/more` page was left out of the More accordion (it is the foot link).
- **Active page:** React Router `NavLink` with `end`, plus an inline rule that `/account/…` lights Accounts. **Active group:** `groupForPath()` in `nav.ts` (an account page and any unknown address: Money and Home respectively).
- **Breadcrumbs:** the sticky `.topbar` row (`crumbsFor()`), `Money > Accounts > account name` on an account page; below 600 px it shows the section title instead.
- **Due count:** `dueInstances(db, today, 7)` in `Shell`, shown on Scheduled (sidebar and phone section tabs) and on the Money tab of the phone's bottom bar.
- **Phone and tablet (under 900 px):** `.sectiontabs` (scrolling pill row of the group's pages with edge fades) and the fixed five-tab `.tabbar`; `data-tabbar="yes"` gives `--tab-h: 57px` that the round Add button and toasts sit above.
- **Sticky variables:** `--bar-h` (D7 header), `--topbar-h` (56 px token), `--tab-h`; `.topbar` sticks at `--bar-h`, table headings at `--topbar-h + --bar-h`, the sidebar at `--bar-h`.
- **Search, Settings, Theme:** Search and Settings were already duplicated in the D7 header; the theme toggle existed only in the sidebar foot (and in Settings > Appearance).
- **Print:** `.sidebar, .tabbar, .topbar, .sectiontabs-wrap, .qa` are hidden.
- **Routes:** `LEDGER_ROUTES` lists 32 paths: the 31 navigation destinations (1 Home + 10 Money + 4 Invest + 10 Plan + 6 More) plus the individual account page `/account/:id`. D4's "31 pages" is the 31 navigation destinations; confirmed against the live source. `/backup` is a redirect to `/settings/backup` (the global Settings, outside Ledger's frame).
- **Defaults, from the source:** the group links go to `to` in `nav.ts`: Money `/accounts`, Invest `/networth`, Plan `/income`, More `/more`. They match D4's expectations; no discrepancy.

## 4. New desktop structure

`Shell` renders `LedgerNav` (a `nav` landmark named "Ledger sections") as the first child of `.shell`, then the existing `.shell-main` (crumb row, backup reminder, main) and the unchanged phone tab bar. `.shell` is no longer a grid. The bar is sticky at `top: var(--bar-h)` with height `--sub-h`; Signature: 46 px, line icons (the same five icons the phone tab bar uses); every other palette: 40 px, words only. Left to right: the five sections; at the right end the theme toggle. A section's underline plus bolder text marks the current section.

The bar and its lists use the palette's three menu roles (`--side-bg`, `--side-fg`, `--side-active`) for colour, so each palette keeps its own look and the contrast tests that already cover those roles cover this bar. Signature: light grey-blue bar, teal underline; Classic: light grey bar, blue underline; "Deep navy": navy bar, gold underline.

## 5. Section dropdown behaviour

- **Split link and disclosure.** The name (e.g. "Money") is a link to the default page (`aria-current` set as in section 9). The chevron beside it is a separate button (`aria-label` "Money pages", `aria-expanded`, `aria-controls`). Home has no chevron. Clicking a name never opens a list, and the chevron never navigates, so there is no ambiguous control.
- **List:** plain links in a panel under the tab (two columns for Money and Plan, one for Invest and More), 40 px rows, the current page marked by a tint, bolder text and a bar, a count badge on Scheduled. Items are read from `GROUPS`; the More list is Settings & about, Year in review, If something happens, Tax package, Sync devices, Data & Backups.
- **Behaviour:** Enter or Space on the chevron toggles; Tab walks from the chevron into the list links in order; Escape closes it and returns focus to the chevron; a press outside, Tab out of the section, choosing a page, or any page change closes it; opening another section's chevron replaces the open list. No hover handlers, no `role="menu"`, no focus trap, no new shortcut, no stored state.
- **Menu width:** `min-width 220px`, `max-width 100vw - 32px`, height capped to the space under the bar and scrolling inside itself. At 900 px the longest (Plan) opens at x 349 and ends well inside the screen.

## 6. Desktop sidebar removal

All `.sidebar`, `.side-*`, `.searchbtn.side` rules, the 248 px grid and the sidebar's sticky offset were deleted from `styles.css`; the sidebar markup, its search button and its open-group state were deleted from `Shell.tsx`. A test confirms none of them remain (comments aside). The freed width goes to the page: `.main` and the crumb row use `--ledger-w: clamp(1120px, 88vw, 1760px)` (was `78vw` beside the sidebar). Measured at 1440 px: content 1267 px wide, centred (it was 1123 px); the crumb row lines up with it. At 1024 px the content now uses the full width. No empty gutter was found at 1440, 1024 or 900 px.

## 7. Mobile and tablet preservation

The phone's bottom tab bar and section tabs markup in `Shell.tsx` is unchanged. Three small edits sit around it: `ICONS` is now imported from `LedgerNav.tsx` (the same icon markup, moved); the "an account page lights Accounts" rule comes from the navigation model (the result is identical: true only when the path equals the page, or an account page for Accounts); and the crumb row gets an extra class `topbar-home` on Home, which only the 900 px and wider stylesheet uses (below 900 px the row still shows "Home"). `.tabbar`, `.sectiontabs-wrap`, `--tab-h`, the Add button and toast rules were not edited.
Checked in the browser: at 899, 812 x 375 landscape, 800, 375 and 320 px the bar is absent, the five-tab bar and section tabs show, and there is no horizontal overflow; at 375 px each of the five tabs opens its default page (Home, Accounts, Net worth, Income, Settings) and the section tabs number 0, 10, 4, 10, 6 with a destination clicked inside each (Categories, Debt, Roth, Year in review). At 900 px exactly the bar appears and the phone bars are hidden; at 899 px the reverse. No width has both or neither.

## 8. Route and deep-link verification

- **Scripted walkthrough in the browser:** all 31 destinations opened from the bar's lists (Home; Money 10; Invest 4; Plan 10; More 6). For each: the correct section underlined, the crumb row correct, the browser title correct, no horizontal overflow. "Data & Backups" lands on the global Settings (`#/settings/backup`), as before, where the Ledger bar does not exist because Settings is outside Ledger's frame.
- **Direct link plus full reload** of `#/ledger/retirement`: Plan underlined, crumbs "Plan › Retirement". **Back and Forward** follow the history and the underline follows (the history included an unknown address, which shows Home, as before).
- **Tests** (`d8LedgerNav.test.tsx`): every Ledger route is a listed page except `/account/:id`; five sections, labels and defaults; counts 1/10/4/10/6 = 31; the model adds and drops nothing relative to `ALL_ITEMS`; the `/backup` redirect line is still in `LedgerModule.tsx`; every page lights exactly its own section and itself.

## 9. Account-detail and breadcrumb handling

`activePageFor('/account/:id')` is `/accounts`, so Money is underlined and Accounts is marked in the Money list. The crumb row is unchanged: `Money › Accounts › Demo Checking`, with Money and Accounts as links (seen in the browser; unit-tested). Marking: `aria-current="page"` is used only when the link IS the current page; a section whose page is elsewhere in it, and Accounts while viewing an individual account, get `aria-current="true"`. The crumb row keeps its own `aria-current="page"` on the last crumb. On desktop Home only, the crumb row is hidden because its one crumb ("Home") repeats the bar (judgment call 5); it is kept everywhere else and on phones.

## 10. Due-count badge behaviour

`Shell` still reads `dueInstances(db, today, 7)` once (unchanged) and passes the number to `LedgerNav`; the model shows it on Money and on Scheduled only and treats 0 or a negative as none. The bar does no date or amount work (a test pins that it imports nothing from `db` or `schedule`). The number is visible; the word "due" is kept for assistive technology (`<span class="sr-only"> due</span>`), so colour is not the only cue. Seen live with two temporary fictional demo rules (due in 1 and 3 days): Money shows "2", Scheduled shows "2", and `dueInstances` returned 2; after the rules were deleted the badges disappeared. The phone's own badges are untouched.

## 11. Theme, Search and Settings access

- **Theme:** the existing `ThemeToggle` component, unchanged, at the right end of the Ledger bar (always visible, one click). Seen: Dark → Device → Light → Dark, with `data-theme` and the saved value following each click. It is still also in Settings > Appearance. No Ledger-only setting.
- **Search:** the D7 header's Search (`openSearch`); header click opened "Search", Escape closed it. `GlobalFrame.tsx` shortcuts untouched. The sidebar's duplicate search button is gone.
- **Settings & about:** `/ledger/more` is the first entry of the More list and the destination of the More link; the global Settings link in the header remains. **Add and Sync:** untouched (header Add opened the Add box).

## 12. Responsive and sticky-position findings

- Measured at 1440 x 900 on Transactions scrolled: header 0 to 62, Ledger bar 62 to 108, crumb row 108 to 164, table heading pinned at 164. Nothing hidden under a bar, no overlap between the bars.
- Classic: header 0 to 36, bar 36 to 76 (40 px), crumb row from 76. Widths 1440, 1024, 900 (bar items end at x 560, theme toggle at 794 to 869, no overflow), 899, 812 x 375, 800, 375, 320: no horizontal overflow at any.
- Stacking order: header 50, Ledger bar 45, its lists 46, crumb row 20, the floating Add 40 (phone only), toasts 120; the bar's lists open over the page and under the header's module list.
- **Touch screens wider than 900 px:** `--sub-h` becomes `max(--lnav-h, 44px)` and the chevron and theme button get 44 px targets (by stylesheet; no touch device was available to test).
- **Transactions sticky rows:** found pre-existing (heading row 47 to 49 px against a 36 px offset, all palettes) and corrected after review; see section 20.
- Print: `.lnav` joins the hidden list; a test pins the rule. **No print preview was looked at.** Toast and modal placement were not changed and not re-observed.

## 13. Light, dark and other-palette findings

Signature light and dark (bar, lists, active states, badges), Classic light (40 px bar, no icons) and "Deep navy" light (navy bar, gold underline, readable) were looked at at 1440 px. One fix came out of this: the chevrons used the muted grey, which was too faint on the navy bar; they now use the bar's own text colour at 70% opacity. Dark mode for Classic and navy, and any palette at phone width, were not looked at. The default palette and palette storage were not changed.
Structure that applies to every palette (judgment call 7): the bar itself, the lists, the wider page, the two tokens' defaults. Only Signature changes bar size and icons.

## 14. Judgment calls (please review)

1. **Link plus separate chevron** for the four sections (the brief's suggested split pattern); the D3.2 prototype's single hover/click tab was not copied.
2. **"Settings & about"** is the name of `/more` in the desktop More list (it was the sidebar's foot label); `nav.ts` keeps "Settings" for phone tabs, breadcrumbs and search.
3. **Theme toggle at the right end of the bar**, not inside the More list: one click, and the bar has the room. Alternative: move it into More.
4. **Search and Settings are not repeated in the bar**; they are the D7 header's.
5. **Crumb row hidden on desktop Home only.** Alternative: keep it everywhere.
6. **Page width `88vw`, cap 1760 px** (was `78vw`); the crumb row lines up with the page. The D3.2 prototype used a fixed 1264 px column; the real pages use more.
7. **Structure applies to every palette; size and icons are Signature-only tokens;** colours are the existing `--side-*` roles, so the navy preset gets a navy bar. The palette builder still labels and previews those roles as a "sidebar" (D19).
8. **`aria-current`:** `page` only for the exact page, `true` for the containing section and for Accounts on an account page.
9. **Touch screens 900 px and up** get a 44 px bar and targets (stylesheet only).
10. **No Ledger-footnote in the list** (the prototype's "Ledger's own pages…" line) and no "Current" badge; the current page is marked by tint, weight and a bar.
11. **The Money tab shows the due count** in the bar (new on desktop; the old sidebar showed it only on Scheduled, and only when the group was open), as the brief asked for "Money navigation" counts.
12. **`sideState.ts` and its test are left in the repository** though the app no longer uses them (D4 said "stays harmless"); removing dead code is a separate small change.
13. **Row-wise order in the two-column lists** (Check-in | Accounts, Transactions | Budget, …), as in the prototype, not column-wise.

## 15. Automated tests and results

- `npx tsc --noEmit`: clean. `npm run build`: succeeds (existing large-chunk notice only).
- New `src/shell/d8LedgerNav.test.tsx`, **43 tests**: model (five sections, defaults, 31 destinations, no lost route, the redirect line, no addresses of its own); active section and page for every one of the 31 pages; the account page; trailing slash and unknown address; breadcrumbs; due count (shown on Money and Scheduled only, none for 0 or negative, wiring from `Shell`, no date or amount work in the bar, rendered text); the bar's markup (one landmark with a name, nothing nested, five links and hrefs, `aria-current`, four closed disclosure buttons with names, `aria-expanded` and `aria-controls`, no menu roles or hover handlers, every control named, the theme toggle); the lists (each section's links in order, two columns, the current page); behaviour in the source (one list open, Escape focus return, outside press, close on navigation, no focus trap); Shell (no sidebar left, phone bars intact and still built from `GROUPS`); stylesheet (old rules gone, 900 px breakpoint shared with the phone bars, sticky layers and z-order, touch targets, width, print, colours from palette roles with no literals, non-colour active cues); tokens (defaults, Signature-only).
- Updated, not weakened: `d7Header.test.tsx` (the sticky-rule expectations now include `--sub-h`, and the old `.sidebar` offset line is replaced by the new bar rule); `uiCoverage.test.ts` (S-13, S-14, S-17 added to the expected built list).
- Targeted runs during work: `src/shell`, `src/core`, palette, contacts guards, ledger: 509 passed. **Full suite, one run after the application code settled: 4,499 tests in 246 files, 0 failed (141 s).** After that run only documents changed (this report, the handoff, the backlog, the tracker); no application source changed, so the run still validates the final code. (Careful reading: the D7 report's "4,455 in 245 by addition" is one below 4,499 minus 43; the D7 total was never re-run clean, and I did not investigate the one-test difference.)
- The test setup renders to static markup only, so opening, Escape and focus return are covered by the browser checks (section 16), not by a unit test.

## 16. Browser verification evidence

Run in the Claude app's built-in browser against the fictional D1 demo household on `http://localhost:5231` (its own database, sync off; the demo seed's own rules require that address). No production data, no real sync. The demo server was stopped afterwards.

Screenshots (outside the repository, `C:\Users\alexm\Documents\Ledger-Design-Concepts\D8-Evidence\`):
- `D8-desktop-1440-signature-light-home.jpg`, `…-money-menu-open.jpg`, `…-plan-menu-open.jpg`, `…-transactions.jpg`, `…-account-detail.jpg`, `…-due-count-badges.jpg`
- `D8-desktop-1440-signature-dark-money-menu-open.jpg`, `D8-desktop-1440-classic-light-money-menu-open.jpg`, `D8-desktop-1440-navy-preset-plan-menu-open.jpg`
- `D8-phone-375-signature-light-home.jpg`, `D8-phone-375-signature-light-more-year-in-review.jpg`

Notes: the pane returns the 1440 pictures scaled to 800 px wide, and often returned a stale picture on the first capture after a change; each state was confirmed by script (computed styles, `aria-expanded`, positions) and a second capture. A mis-aimed click during the outside-press check hit a transaction's Delete button and opened its confirmation; it was cancelled, and the demo still held all 77 transactions. A sub-menu of Plan and the account page were shot once the page had finished loading. **Not captured:** a phone landscape picture (checked by script only), light-mode phone for Classic and navy, Signature dark at phone width.
Console: one error on a full page reload, `assetClasses.bulkAdd(): 7 of 10 operations failed ... Key already exists` from the default asset-class seeding in `src/db.ts` (dev mode runs effects twice). D8 did not touch that code; I did not investigate it further.

## 17. Coverage tracker updates (`docs/UI-COVERAGE.md`)

S-13 (bar replaces the sidebar), S-14 (top bar and breadcrumbs) and S-17 (theme toggle) now read `BLT` with the marks recorded in the new section 1.3. S-15 and S-16 were not visually modified and stay `NS`. All 59 routed destinations are kept; **none of the 31 Ledger pages is marked redesigned**. Nothing is `ACC`. The roll-up still shows 0 accepted. Real-device and screen-reader checks stay listed as open.

## 18. Outstanding issues and unverified items

- Real phone and tablet (touch, 44 px targets, safe-area insets on the new bar), any screen reader (how "Money, current section" and the chevron buttons are spoken), forced-colours mode, Safari and Firefox, print preview, dark mode at phone width, Classic and navy at phone width, dark mode for Classic and navy.
- The dev-mode console error (section 16): not caused by D8, not investigated. (The Transactions sticky overlap was corrected: section 20.)
- The palette builder still describes and previews a "Sidebar" (D19). `sideState.ts` is unused.
- The one-test difference in the D7 count (section 15).
- D3.2 differences from the prototype: the prototype centres the bar's content in a 1264 px column and shows a footnote in the list; the real bar spans the header's width and has the theme toggle at the right.

## 19. Git status (at the time of writing)

Branch `main`, HEAD `13acc04` (= `origin/main`). Modified, unstaged: `src/palette.ts`, `src/shell/Shell.tsx`, `src/shell/d7Header.test.tsx`, `src/shell/uiCoverage.test.ts`, `src/styles.css`, `src/ui/tokens.css`, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`, `docs/UI-COVERAGE.md`. New, untracked: `src/shell/LedgerNav.tsx`, `src/shell/ledgerNavModel.ts`, `src/shell/d8LedgerNav.test.tsx`, `docs/LEDGER-SIGNATURE-D8-REPORT.md`, and the three pre-existing untracked files (unchanged). Nothing staged, committed, pushed or deployed. `dist/` from the build is ignored.

## Handoff

`docs/CHATGPT-HANDOFF.md` was updated in this batch: new D8 top notice, current-phase and previous-phase bullets, delivered-functionality entry with the contract for later phases, baseline, roadmap line, change log; D7 marked committed and deployed (`13acc04`, run #93). Unknown: real-device and screen-reader results, and whether the palette builder's "sidebar" wording should change before D19.

## 20. Final verification and sticky-row correction (2026-11-11, after review)

**Baseline re-verified:** `main` = `origin/main` = `13acc04`; D8 still uncommitted and unstaged; the working tree matched section 19; the three pre-existing untracked files untouched.

**Sticky overlap: investigation.** The Transactions table has two sticky header rows: the column headings and, directly below, the filter row. The filter row's offset was a hard-coded `+ 36px` (the heading row's height was assumed, not set). Measured heading row height in the browser at 1440 px: Signature 47 px, Classic 49 px, "Deep navy" 49 px, so the filter row overlapped the headings by 11 to 13 px **in every palette**. The released D7 stylesheet (`git show HEAD:src/styles.css`) holds the identical `+ 36px` rule and D8 changed no table or heading size, so the overlap is **pre-existing** (present in D7; my D7 comparison is by source and measurement, not by running a D7 build). D8's bar only moved both rows down together (they still kept their relative offset), so D8 neither introduced nor worsened it. My earlier guess that D6 caused it, and that it was Signature-only, was wrong on the second point: it is not Signature-only.

**Correction (CSS only, `src/styles.css`):** the heading row now has one fixed height, `--txn-head-h: 50px` (set on `.txn-table`, applied as `height` on the first header row, content centred), and the filter row's offset uses the same variable: `top: calc(var(--topbar-h) + var(--bar-h) + var(--sub-h) + var(--txn-head-h))`. The two can no longer drift apart. The phone hides this header (`display: none` below 640 px), so mobile Transactions is unchanged; the Budget headings were not touched.

**Measured after the fix (scrolled, header rows):** Signature light 1440: headings 164 to 214, filters 214 to 263; Signature dark 1440: same; Signature 900 px: same; Signature 899 px (phone bars, no Ledger bar): 118 to 168 and 168 to 217; Classic and "Deep navy" at 1440: 132 to 182 and 182 to 231. In each case the rows meet exactly (no overlap, no gap), sit directly under the crumb row (which sits under the Ledger bar), and there is no horizontal overflow. 375 px: heading hidden as before, no overflow. Budget (1440): headings still stick at 164 px under the crumb row. Screenshot: `D8-Evidence\D8-fix-1440-signature-dark-transactions-scrolled.jpg`.

**Tests:** `tsc` clean; `npm run build` succeeds; `src/shell`, `src/core`, palette and `src/modules/ledger` tests: 497 passed in 29 files. One focused test added to `d8LedgerNav.test.tsx` (the filter offset uses the heading variable; no pixel value is pinned) and the D7 sticky-rule expectation updated to match. The full suite was not re-run (CSS and two test expectations only; the 4,499-test run from section 15 covers all other code).

**Final scope review:** the diff against `13acc04` is exactly the files listed in section 2 plus this correction; no change to `package.json`, `db.ts`, routes, calculations, Quick Add, Contacts or any page component; no dependency added.

**Remaining:** real phone or tablet, screen reader, forced colours, Safari and Firefox, print preview (all still outstanding); the palette builder "Sidebar" wording (D19). The dev-mode seeding console warning was not investigated, as instructed. No Ledger page is marked redesigned or accepted.
