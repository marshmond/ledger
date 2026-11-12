# Ledger Signature D7: global header and module switcher (2026-11-11)

**Status: conditionally approved on review; one correction (section 17: a sync problem stays visible in the phone header) is built and checked. NOT REAL-DEVICE TESTED.** Release status is in section 17. D8 is not started.

Plain-language summary: the strip across the top of every screen now looks like the approved Ledger Signature design (brand mark, a clear module switcher with an "All modules" caption, a search field with a Ctrl K hint, the sync status, Settings and a navy Add button). The module list opens as three labelled columns on a computer and as a two-column sheet on a phone. Every module, shortcut, address and keyboard behaviour works as before. Only the Signature look changes the header's size and decoration; every other palette keeps the thin bar it had.

## 1. Baseline and release gate (verified before any edit)

| Check | Result |
|---|---|
| Repository | `marshmond/ledger` (remote `origin`) |
| Branch | `main` |
| HEAD vs origin | `17e509d39064b33310df1aa4b2212fea671b7b9b` = `origin/main` (after `git fetch`) |
| D6 release commit | `17e509d` `feat(ui): add Ledger Signature shared components` (D5 is `63bbff0`, not the baseline) |
| CI and deployment | GitHub public Actions API (`gh` is not installed): run **#92** "Deploy to GitHub Pages" for `17e509d` **completed / success** (2026-11-12 03:04 UTC); deployment `7727213554` for `17e509d`, status **success** |
| Working tree at the start | only the three untracked files the brief asked to keep: `docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`. All three are untouched. |
| D6 report | `docs/LEDGER-SIGNATURE-D6-REPORT.md` read; the handoff still said D6 was uncommitted, which was stale (corrected in this batch). |

No branch, repository or remote was created. No broader GitHub permission was requested. Production data and sync were not touched (see section 12 for the demo origin used).

## 2. Files changed

Source (8):
- `src/core/ModuleBar.tsx`: new header markup; `ModuleFoot` (phone footer) added and exported.
- `src/core/SyncChip.tsx`: one optional `inline` prop (class only; no sync logic touched).
- `src/styles.css`: module bar, switcher list, sync chip rules rewritten in place; a D7 phone block appended.
- `src/ui/tokens.css`: 14 new header tokens whose defaults equal the old values.
- `src/palette.ts`: 13 header tokens added to the Signature shared set (same in light and dark).
- `src/ui/icons.tsx`: three icons added (`search`, `chevron-down`, `sliders`).
- `src/modules/household/index.tsx`: Household Finances icon (wallet).
- `src/modules/ledger/index.tsx`: Ledger icon (bar chart).

Tests (4): `src/shell/d7Header.test.tsx` (new, 24 tests); a one-line regex update in each of `src/core/moduleGroups.test.tsx` and `src/modules/contacts/contacts-guards.test.ts`, and the list of surfaces beyond `NS` in `src/shell/uiCoverage.test.ts` (see section 11).

Docs (4): this report, `docs/UI-COVERAGE.md`, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`.

Not touched: `GlobalFrame.tsx`, `QuickAdd.tsx`, `SkipAndRoute.tsx`, `Shell.tsx` (Ledger navigation), `moduleGroups.ts`, routes, database, sync, backup, service worker, security policy, calculations, any module's logic, `package.json`.

## 3. Desktop header (900 px and wider)

Left to right: Ledger mark and name, the module switcher (current module's icon and name, a divider, the caption "All modules", a chevron that turns when open), a spacer, Search (a field with the Ctrl K hint; the hint reads ⌘K on Mac, iPhone and iPad platforms), the sync status, Settings (sliders icon and word) and the navy Add button.

- Size: 62 px under Signature, from `--hdr-h`. Controls are 40 px (`--hdr-ctl-h`). The bar background is the card colour, with a hairline border and the small card shadow (`--hdr-shadow`).
- Between 641 and 899 px the bar keeps the brand mark, the switcher (name only), an icon-only Search, Sync and Settings. The Add button is the round floating one there (section 7).
- All colours are existing tokens (`--accent`, `--surface-soft`, `--control-line`, `--btn-bg` and so on). One literal remains, the white fallback inside `var(--on-accent, #fff)`, the same fallback the skip link already uses.

## 4. Mobile header (640 px and narrower)

Brand mark (the "L" only), the module switcher (name may wrap onto two lines; no ellipsis), and Search as a 44 px icon button. The round Add button stays where it was (bottom right, above the Ledger tab bar in Ledger). Sync and Settings are no longer in the bar; they sit in the foot of the open module list (section 5), where they are 44 px targets.

- Height: 60 px under Signature (`--hdr-h-phone`), 48 px for every other palette, as before.
- At 359 px and narrower the brand mark hides so the module name keeps the room (the D3 approach). Measured at 320 px: "Contacts & Relationships" fits on one line (button 229 px wide, Search 44 px, no horizontal overflow).
- Left and right padding now respect the device's side safe-area insets; the top inset was already in `--bar-h`.

## 5. Grouped module switcher

- Still the existing disclosure: a button with `aria-expanded` and `aria-controls="module-list"`, a list of plain links, Escape closes and returns focus to the button, a click outside closes, a route change closes. No ARIA menu, no dialog, no portal, no new navigation framework.
- `ModuleList` and `groupModules` are unchanged: the grouping (Today alone, Productivity, Household, Finances, and an "Other" group for any future module) is read from the registry; nothing is duplicated.
- Desktop: a panel under the bar, `min(700px, 100vw - 32px)` wide, a CSS grid of three columns with Today across the top. Rows are 40 px with 18 px icons; the current module has a soft accent fill, accent text and weight 600 (and `aria-current="page"`, as before). Hover uses the shared hover tint; keyboard focus uses the app's existing 2 px focus ring.
- Phone: the same list as a sheet under the bar (8 px from each side, at most 440 px wide), two columns per group, rows 44 px, long names wrap. It scrolls inside itself when the screen is short (`max-height` measured from the bottom of the bar and the bottom safe-area). At the foot: Settings and the sync status (the sync details open in the flow of the list instead of floating over it).
- The panel is anchored to the bar (which is sticky), not to the button, so it always fits the screen.
- Not added (no new copy, no clutter): the "Current" badge, the explanatory note about Ledger's own navigation, descriptions.

## 6. Icons and tokens

Icons: Home & Assets keeps the house. **Household Finances is now a wallet** (it was a second house, the D0 finding F9), and **Ledger is now a bar chart** (the D3 icon; its old card-and-coin icon was too close to a wallet). The other eight module icons are unchanged. A test checks that no two modules share an icon. Search, chevron and Settings glyphs (`⌕`, `▾`, none) are now inline SVG from `src/ui/icons.tsx`.

Tokens (new, in `src/ui/tokens.css`, defaults equal the old header; only Signature sets them):

| Token | Default (every other palette) | Signature |
|---|---|---|
| `--hdr-h` / `--hdr-h-touch` / `--hdr-h-phone` | 36 / 48 / 48 px | 62 / 62 / 60 px |
| `--hdr-ctl-h` | 28 px | 40 px |
| `--hdr-ctl-r` | `--r-sm` | `--r-md` |
| `--hdr-ctl-line` | `--line` | `--control-line` |
| `--hdr-search-bg` / `-line` / `-w` | transparent / transparent / auto | `--surface-soft` / `--control-line` / `min(300px, 26vw)` |
| `--hdr-shadow` | none | `--shadow-1` |
| `--ui-brand` / `--ui-modall` / `--ui-kbd` | none | flex / inline / inline-block |

`--bar-h` is now built from the three height tokens in `styles.css`; no hard-coded header height remains.

## 7. Existing behaviour preserved

- **Search:** the header control calls the existing `openSearch`; `GlobalFrame.tsx` (Ctrl/Cmd+K, `/`) is untouched; the accessible name stays "Search". Verified live: header Search opens "Search"; Ctrl+K opens it; Escape closes.
- **Add:** same `QuickAdd`, same Add box, same `N` shortcut (untouched). Verified live: header Add and `N` both open "Add". The existing round floating Add button is kept (the brief did not authorise removing it). It is round below 900 px, as before (the breakpoint is tied to Ledger's tab bar), so the navy in-bar Add appears from 900 px up. Unresolved choice for review: whether a later phase should move Add into the header on phones (the D3 prototypes do).
- **Settings and Sync:** Settings is a plain link to `/settings` (desktop bar; phone list foot). The sync chip's states, labels, popover, "Sync now" and "Sync settings" are unchanged; no sync, credential or network code was touched.
- **Appearance controls (Device/Light/Dark):** untouched (they live in Ledger's sidebar and Settings > Appearance).
- **Routes, ids, module availability:** unchanged; `/<id>` links, `aria-current`, "last module" memory unchanged.
- **Skip link** stays the first Tab stop; **route announcer** and main-content focus untouched.

## 8. Keyboard and accessibility findings

Measured in the browser (Signature, 1440): Tab order from a fresh page is Skip to main content, Switch module, Search, Sync, Settings, Quick add, then the page. **This is a change from the old order (Search, Add, Sync, Settings): Add is now last so Tab follows the picture, left to right.** One `nav` landmark ("Modules and tools"); no nested landmark. With the list open, Tab from the button went Today, Calendar, Tasks (links in reading order); Escape with focus inside the list closed it and put focus back on the button; Enter on a link navigated, closed the list, updated the route, the title ("Tasks · Ledger") and the button's name. Focus ring on list links: 2 px solid. The decorations (brand, "All modules", shortcut hint, every SVG) are `aria-hidden`; the switcher's spoken name is still exactly "Switch module. Current module: <name>". Tests pin all of this (section 11).

Not done: no screen reader, no touch device, no forced-colours check.

## 9. Sticky positions and breakpoints (measured)

Under Signature the bar is 62 px, and every layer below it followed because all of them already read `--bar-h`:
- 800 px, Ledger Transactions: bar bottom 62, page top bar 62 to 118, table heading pinned at **118**, filter row at **154** (no gap, no overlap); the round Add sat above the Ledger tab bar.
- 1440 px, Ledger Budget: sidebar top 62 (height 838 of 900), top bar 62 to 118, a table heading pinned at **118** while scrolled.
- 1440 px, Tasks "Select": bulk bar computed `top: 66px` (= 62 + 4).
- Phone sizes: bar 60 px at 375 and 320.
- No width range collided with Ledger's 900 px switch: at 660 px (the narrowest width above the phone rule) the longest name "Contacts & Relationships" fits beside Search, Sync and Settings (switcher 58 to 278 of 660 px, no horizontal scroll); 800 px fine; 900 px and up shows the full header.
- Print: the bar's print rule (`display: none`) is kept and pinned by a test; **no print preview was looked at**.
- Toasts and the modal layer were not changed; **their placement was not re-observed**.

## 10. Light, dark and other palettes

- Signature light and dark: header, list (both layouts), brand mark and Add checked visually; dark shows the teal Add button and teal mark as designed.
- Classic: bar stays 36 px, no brand mark, no caption, no hint; the list uses the three-column grid in the Classic colours; Add is the Classic accent blue. Looks coherent.
- "Deep navy and gold" preset: 36 px bar, navy-tinted active row, readable. **Only desktop width was looked at for Classic and the navy preset; phone width was not.**
- A test confirms no preset other than Signature sets any header token. The default palette was not changed.
- Changed for every palette, not only Signature (judgment call 2): the list's grid layout, the phone list foot, and Settings/Sync leaving the bar on a phone.

## 11. Tests

- `npx tsc --noEmit`: clean. `npm run build`: succeeds (existing large-chunk notice only).
- New `src/shell/d7Header.test.tsx`: 24 tests. Header structure and landmark; switcher is a disclosure (no menu, dialog, portal or key handler); spoken names for five modules including the four long ones; decorations hidden from assistive technology; Tab order; Search and Add attributes (Add's from its source); Settings link and `aria-current`; every registered module in exactly one group with the right link and name; group labels and counts; current-module marking; distinct module icons (assets vs household); the phone foot; `--bar-h` built from the tokens with every sticky consumer still reading it; print rule; grid columns; phone rules; long-name wrapping; 44 px touch rows; no stray colour literals; token defaults; Signature values in light and dark; no other preset sets a header token; Search, Add and shortcut wiring still where they were.
- Existing tests kept, two regexes updated because the list's height limit is now measured from the bar (`calc(100dvh - var(--bar-h) - 16px ...)` instead of `calc(100dvh - 72px)`): `moduleGroups.test.tsx` and `contacts-guards.test.ts`. Their intent (fits the screen, scrolls inside itself, older-browser fallback declared first) is unchanged.
- `src/shell/uiCoverage.test.ts` pins which surfaces are beyond `NS`. After the tracker edit it failed once, as designed, and its expected list now names S-01, S-02, S-03 (new) besides S-04, S-08, S-09, S-21, S-23. It was re-run with the whole `src/shell` folder afterwards (see below).
- Existing module-group, shell, accessibility, palette, token, residue and coverage-tracker tests pass.
- **Full suite, one run after the code settled: 4,446 tests passed in 244 files, 0 failed (110 s).** That is the D6 figure (4,422 in 243) plus the 24 new tests in 1 new file. After this run only documents and the tracker guard's expected list changed (below); no application source file changed, so the run still validates the final code. The D6 figure itself was taken from the D6 report, not re-run on a clean checkout.
- What tests cannot show (open, Escape, focus return, measured sizes) was checked by hand in the browser (sections 8 and 9). Opening and closing behaviour has no automated test because the test setup renders to static markup only.

## 12. Visual evidence

Run in the Claude app's built-in browser against the fictional D1 demo household on a separate address (`http://localhost:5231`, its own database, sync off; the demo seed's own safety rules require that address). No production or sync data was used. The demo dev server was stopped afterwards.

Screenshots (outside the repository, in `C:\Users\alexm\Documents\Ledger-Design-Concepts\D7-Evidence\`):
- `D7-desktop-1440-signature-light-menu-open.jpg`, `D7-desktop-1440-signature-dark-menu-open.jpg`, `D7-desktop-1440-classic-menu-open.jpg`, `D7-desktop-1440-navy-preset-menu-open.jpg`
- `D7-tablet-800-signature-ledger-transactions.jpg`
- `D7-phone-375-signature-tasks-closed.jpg`, `D7-phone-375-signature-menu-open.jpg`, `D7-phone-320-signature-menu-open.jpg`

The 1440 pictures were taken with the viewport set to 1440 x 900, but the tool returns them scaled to 800 px wide. The pane also returned a stale picture on the first capture after a state change several times; each state was confirmed through `aria-expanded` and measured element positions, and a second capture was taken.

## 13. Coverage tracker (`docs/UI-COVERAGE.md`)

S-01, S-02, S-03, S-04 and S-12 now read `BLT` with the marks recorded in the new section 1.2; S-17 is unchanged (Ledger's sidebar toggle was not touched). **Nothing is `ACC`**: owner review is pending and real-device and assistive-technology checks are not done. No routed page changed status; the roll-up still shows 0 accepted of 23 global surfaces. Section 1.2 lists what each mark rests on and what was not checked.

## 14. Judgment calls (please review)

1. **Heights and decoration are Signature-only, through tokens** (same pattern as D6). Classic and the other presets keep the 36/48 px bar with no brand mark.
2. **The structural parts apply to every palette**: the three-column list, the two-column phone sheet, and moving Settings and Sync into the list on a phone. Alternative: gate them too, so Classic phones keep Settings and Sync in the bar.
3. **Phone Add stays the floating round button**, not in the header, and below 900 px it stays round (the in-bar Add is 900 px and up). The D3 phone header shows Add in the bar.
4. **A phone no longer shows a healthy sync status at a glance.** Superseded by the correction in section 17: a problem (error, or edits to review) is shown in the bar; everything else is one tap away in the list.
5. **Tab order changed**: Add is now last.
6. **Icons:** Household Finances (wallet) and Ledger (bar chart) changed; Household Services keeps its current icon (the prototype's wrench was not adopted).
7. **Visible label is "Search", not "Search Ledger"** (so the visible text matches the accessible name).
8. **Switcher and search borders use the 3:1 control border** under Signature, a little stronger than the prototype's hairline.
9. **The list panel is anchored to the bar**, not the button.
10. **A long module name wraps** on a phone (the old ellipsis is gone), instead of being shortened.
11. Two existing tests' regexes were edited (section 11).

## 15. Not built, and not verified

Not built (out of scope by the brief): Ledger sidebar, section tabs or bottom tab bar changes (D8); Quick Add redesign (D10); sheet-style Quick Add; any change to Search, Today, Tasks, Calendar or Family; removal of the floating Add; self-hosted Inter (the stack still falls back to the system font).

Not verified: a real phone or tablet (touch, safe-area insets on a notched device, browser chrome); any screen reader; forced-colours mode; Safari and Firefox (only the app's built-in Chromium-based pane was used); the live sync chip in its configured, error and conflict states and its popover inside the phone list (sync is not set up on the demo address, so only "Sync off" was seen; the popover's inline placement is styled but not seen); dark mode at phone width; Classic and navy at phone width; print preview; toast placement; the ⌘K hint on a Mac; the effect of a very short or landscape phone beyond one 375 x 420 check (the list scrolled inside itself and its foot was reachable).

## 16. Git status (at the time of writing)

Branch `main`, HEAD `17e509d` (= `origin/main`). Modified, unstaged: the eight source files and the three edited test files in section 2, plus `docs/UI-COVERAGE.md`, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`. New, untracked: `src/shell/d7Header.test.tsx`, `docs/LEDGER-SIGNATURE-D7-REPORT.md`, and the three pre-existing untracked files (unchanged). Nothing staged, committed, pushed or deployed. `dist/` from the build is ignored by git.

## Handoff

`docs/CHATGPT-HANDOFF.md` was updated in this batch (new D7 notice, D6 corrected to committed and deployed as `17e509d`, run #92, current phase, test baseline, delivered-functionality entry, roadmap line, change log).

## 17. Final correction: sync problems stay visible on a phone (2026-11-11)

**Request (review condition):** a sync problem must be visible on a phone without opening the module list.

**Behaviour.** On 640 px and narrower, the bar's sync chip stays hidden when sync is healthy, syncing, paused, offline or not set up, so the clean D7 header is kept. When the EXISTING status says **error** ("Needs attention") or **edits to review** ("Review N"), the chip shows in the bar as a 44 px icon button after Search: a warning icon (a circle with an exclamation mark for an error, a triangle for edits to review), in the error or warning text colour, so shape as well as colour carries the meaning. The words ("Needs attention", "Review 2") are kept as the button's accessible name; the full details are its tooltip. Tapping it opens the existing sync details (the same popover: message, "Sync now", "Sync settings", which goes to `/settings/sync` or `/settings/sync#conflicts`). Nothing new is computed: `SyncChip` already derived an error/warning tone from `useSyncStatus`; it now adds the class `attn` for those two tones, and the stylesheet does the rest. No new states, notifications, timers or network calls; the sync service is untouched.

**Also changed:** pressing Escape in the sync details now returns focus to the chip when focus was inside the details (before, the details vanished with focus). The copy in the module list foot is unchanged (dot and words; its details open in the flow of the list).

**Files changed in this correction:** `src/core/SyncChip.tsx` (an icon, a text class, the `attn` class, the focus return), `src/styles.css` (the phone attention rules, one icon rule), `src/shell/d7Header.test.tsx` (one selector), new `src/shell/d7SyncAttention.test.tsx` (9 tests). Docs: this report, handoff, tracker, backlog.

**Tests run (targeted, not the full suite, as instructed):** `tsc` clean; `npm run build` succeeds; `src/shell`, `src/core`, `contacts-guards` and `palette` tests: **451 passed in 27 files** (the 24 header tests, the 9 new sync tests, and the existing focus, accessibility, navigation and tracker tests). The new tests cover each state with a mocked status (error, edits to review, healthy, syncing, paused, not set up, the list-foot copy), the icon being hidden from assistive technology with the words as the name, the stylesheet rules (44 px, shape cue, words kept for screen readers) and the focus return. Total tests are now 4,446 + 9 = **4,455 in 245 files** by addition; the full suite was **not** re-run, because only the chip, one stylesheet block and tests changed.

**Browser checks (Signature light unless stated; fictional demo household on its own address; sync was driven into a real error state by blocking the page's network calls with a stub, with a dummy configuration that never left the page and was removed afterwards; no account, token or data was used):**
- 375 px, error state: icon button 44 px at the right of Search, module name "Contacts & Relationships" wraps to two lines, no overlap, no horizontal overflow. 320 px: switcher 12 to 200, Search 216 to 260, sync 268 to 312, brand mark hidden, two-line name, popover 16 to 312 (fits), no overflow.
- Click opens the details (`aria-expanded` true, "Sync now" and "Sync settings" present); Escape closes them and focus returned to the chip; the list foot copy opened its details in the flow of the list with the same actions.
- Sync not set up: no sync control in the phone bar (the "Sync off" link is in the list foot), as designed.
- Mobile palettes at 375 px (error state on): Signature light (bar 60 px), Signature dark (60 px), Classic (48 px), "Slate and indigo" (48 px). In each: all 11 module links in the list, Settings and the sync status in the foot, no horizontal overflow, the list's bottom (about 540 to 552 px) well above the round Add button (top 744 px), icon in a readable red (dark: a light red), active row legible. The older palettes kept their own colours and their 48 px bar.
- **Not seen live:** the synced/healthy state and the edits-to-review state in the browser (no way to produce them without a real sync; both are covered by the mocked tests only).

**Scope review of the whole D7 diff:** only the files in section 2 plus the correction above. No change to Ledger navigation, `GlobalFrame`, `QuickAdd`, Search, routes, the registry, any module logic (the two module files differ only by an icon), the database, sync service, backup, service worker, security policy or `package.json`; no dependency added.

**Still not verified:** a real phone or tablet, any screen reader, forced-colours mode, Safari and Firefox, print preview, toast placement, the ⌘K hint on a Mac.
