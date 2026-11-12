# Ledger Signature D6: shared components and visual foundation

Date: 2026-11-11. **Status: BUILT AND TESTED LOCALLY. UNCOMMITTED, NOT STAGED, NOT PUSHED, NOT DEPLOYED. Awaiting owner and ChatGPT review. NOT REAL-DEVICE TESTED.** D7 is not started.

**Release gate (checked first):** `main` = `origin/main` = `63bbff0` (`feat(ui): add Ledger Signature foundation and coverage tracking`, D5). The public Actions API shows Pages run #91 for that exact commit: build job (npm ci, npm test, npm run build) and deploy job both `success`; the deployment status is `success`. The D5 cosmetic-guard correction is inside that commit (`src/shell/uiResidue.test.ts` there only reports counts). `gh` is not installed, so the public GitHub API was read instead. The D0 and D1 documents and `scripts/dev-demo-seed.ts` were left exactly as they were (still untracked, not edited, not staged).

## In plain words

Ledger Signature now has its **shared building blocks**. Buttons, fields, cards, tables, notices, dialogs, toasts and chart surfaces all pick up the navy-and-teal look **when Signature is chosen in Settings > Appearance**. For everyone else (Classic and the four older colour choices) nothing moved: the same measurements were taken before and after on 94 sample elements and the answer was "no difference" (section 6). New reusable pieces exist for later phases but are **not placed on any screen yet**: a date tile, a status chip, a financial figure, a small icon set, segmented-control and tab styles, a left-aligned button row, and an opt-in phone-sheet form of the dialog.

No page was redesigned, and nothing about money, the household, navigation, saving or sync changed.

## 1. How it was done (one idea)

Every new look is a **named setting with a default equal to today's value** (in `src/ui/tokens.css`). Only the Signature preset (`src/palette.ts`) gives them different values. So the shared styles can say "use the card corner size" and Classic still gets 14 px while Signature gets 16 px. No marker is added to the page and `index.html` was not touched (the first-paint script already applies whatever Signature stores, so there is no flash). Because of this, an older colour choice cannot change unless a default is wrong, and a test pins every default (section 9).

## 2. Exact files changed

Modified (8 code and test files, 1 tracker): `src/palette.ts` (+26: Signature's extra settings), `src/ui/tokens.css` (+44: the new settings with their old values), `src/styles.css` (about 84 lines edited in place, nothing moved), `src/ui/components.css` (the new `ui-` classes), `src/ui/components.tsx` (PageHeader optional `eyebrow`, EmptyState and Banner icons, new `EmptyLine`), `src/shell/Modal.tsx` (optional `variant="sheet"`, class names only), `src/shell/signatureTokens.test.ts` (3 expectations reworded for D6), `src/shell/uiCoverage.test.ts` (1 test: the five D6 surfaces may read `BLT`), `docs/UI-COVERAGE.md`.

New: `src/ui/icons.tsx`, `src/ui/dateTileModel.ts`, `src/ui/DateTile.tsx`, `src/ui/StatusChip.tsx`, `src/ui/figureModel.ts`, `src/ui/Figure.tsx`, `src/shell/d6Shared.test.tsx` (66 tests), this report. Also updated: `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`.

**Named in the brief but not changed (nothing needed):** `src/ui/Toast.tsx`, `src/shell/ConfirmDialog.tsx`, `src/ui/charts.tsx` (all restyled through CSS settings only). Not touched: `index.html`, the service worker, the security policy, the database, sync, backup, appearance storage, any module file, any route.

## 3. Shared components updated or introduced

Restyled in place (Signature look only; same markup unless noted): buttons (primary, outlined, danger, link, ghost, disabled), links, text, search, select and text-area fields (white fill, 3:1 border, error border, disabled fill, label colour), check boxes and radio buttons (accent tick), cards, tiles, page title, card title, tables (soft heading fill, small capitals), `.badge`, alerts, banners, popovers (filter, suggestion list, Add menu), the dialog and its backdrop, toasts, the Add button colour, and the chart surface, text, grid, axis and series 1 to 4.

New and **unplaced** (class names, all `ui-`, in `src/ui/components.css`): `ui-iconbtn`, `ui-loading` / busy spinner, `ui-field` `ui-label` `ui-help` `ui-error`, `ui-row` (also the left-aligned **button row**), `ui-chip` (six tones), `ui-seg` (segmented control), `ui-tabs`, `ui-dtile` and `ui-dinline`, `ui-figure` and `ui-band`, `ui-empty-line`, text roles (`ui-eyebrow`, `ui-section-title`, `ui-card-title`, `ui-desc`, `ui-meta`, `ui-caption`, `ui-num`), and the dialog sheet pair.

New React pieces: `DateTile` and `DateInline`; `StatusChip`; `Figure`; `Icon` (ten line icons); `EmptyLine`; `PageHeader eyebrow`; `Modal variant="sheet"`.

## 4. Styling rules and token decisions

- **The brief's button rule** (one filled button per region) is written into the top of `components.css` as design guidance. It is not enforced by code and nothing was demoted: Calendar currently shows two navy filled buttons ("Add event" beside the global Add). Each module adopts the rule in its own phase.
- **Colours only through settings** in the new stylesheet (a test fails on any hex or `rgb()` there), no priority overrides (still 11 in the app), no font, no new dependency.
- **Controls** moved from the 8 px corner setting to `--r-md` (8 px for everyone, 10 px in Signature) and from `--line-strong` to `--control-line` (the same colour for everyone; the 3:1 border in Signature).
- **Page title** 34 px (30 on a phone) in Signature only; body text size untouched (15 px).
- **`--fs-md` is still not defined for everyone** (the D5 decision stands: eight module headings would change). The card title uses `--fs-md` with a fallback to the old `--fs-lg`.
- **Signature now stores 69 variables in all** (32 before, 37 added; about 1.9 KB): they ride in the same `ledger-palette-vars` key and are cleared again when another palette is chosen.

## 5. Light and dark behaviour

Dark values live in the existing places (Signature's dark extras; the chart's two dark scopes keep their old fallbacks and a test makes them equal). New dark choices: white-to-deep-navy field fill `#0E1727` so fields are visible inside dark cards; the filled button hover `#216D75`; toast `#223454` with a hairline; backdrop `rgba(3,7,14,.7)`. Every new text and border pairing passes WCAG in both modes by test (4.5:1 for text, 3:1 for borders and chart marks), including the six chip, tile and segment pairings on **all five existing palettes** in light and dark.

## 6. Compatibility with the existing palettes

**Measured:** a fixture of 94 elements (all old shared classes: headings, links, every button type, fields, card, table, badges, banners, alerts, segmented buttons, filter chip, empty state, tile, stat, rows, toast, dialog, chart surface, tabs, popovers) across **Classic, Calm teal, Deep navy and gold, Forest green and stone, Slate and indigo, light and dark**, 27 computed properties each. The same fixture was read from a copy of the released code (`63bbff0`) and from the new code in the same browser session, at **1280 px** and at **375 px with touch**: **0 differences** in both. For Signature the same comparison shows 317 differences at desktop width, which is the intended change. Chart variables (`--surface-1`, `--ink`, `--grid`, `--axis`, `--s1` to `--s8`) were also read for all five older choices, light and dark: all 14 equal their old literal values.

Limit: this proves the shared classes, not every module's own sheet. The module sheets load after none of the new rules (the new stylesheet sits before them and styles only `ui-` classes), but each module's own pages under older palettes were only sampled (section 7).

## 7. Screens actually checked

All under the fictional D1 demo household on its own address (sync off), in the Claude app's built-in browser.
- **Signature, light, desktop width:** one page from each of the eleven modules: Today, Calendar, Tasks, Projects, Home & Assets, Household Services, Bills, Family, Contacts, Ledger (Home and Transactions) and Household Finances.
- **Signature, dark, desktop width:** Ledger Transactions (the densest table), Accounts, Reports (a chart), Household Finances, Calendar.
- **Signature, 375 px:** Tasks, Ledger Transactions, Household Finances (screenshots); a measurement of horizontal overflow on 17 addresses at 375 px and 14 at 320 px: **none overflowed** (this is a measurement, not a visual check at 320).
- **Shared flows under Signature dark:** the Add box, Search (typed a word, saw results), the Delete-account confirmation (opened and cancelled; nothing deleted), and a live toast.
- **A gallery of every new piece** (temporary, deleted) in light and dark.
- **Older palettes:** Classic light (Transactions) and Deep navy dark (Family) viewed; the measured comparison in section 6 is the real evidence.
- **Not viewed:** light mode on Reports, any page at 320 px visually, Signature dark at phone width, Calm teal, Forest and Slate by eye, every in-page view and dialog call site, a real phone.
- **Side effect:** to see the live toast I marked a fictional demo task done and put it back ("Mark not done" in the Completed view, because the 8-second Undo window had passed). The task is back in Today; its completion history is changed.

## 8. Accessibility and interaction findings

- **Dialogs:** in the Add box, Search and the confirmation, Tab stayed inside, Escape closed, and focus went back to the button that opened it. In the confirmation Cancel had focus first. The existing `modalKeys` tests and the structure and accessibility guards all pass. `Modal` gained two optional class names and no code path.
- **Focus visibility:** a 2 px accent outline on buttons, tabs and segmented options (read back: solid 2 px teal), and a teal border plus a soft ring on fields, in both modes.
- **Segmented control and tabs** are plain buttons and links: Tab and Enter work; they add **no** arrow-key behaviour of their own. The app's existing `rovingKeys` stays each module's job when it adopts them. Not changed, not tested by D6.
- **Status and dates never rely on colour:** every chip carries its words plus a distinct icon shape (tested: no two tones share one); a date tile hides its small labels from screen readers and carries the full date as text ("Wednesday, November 11, 2026, today"), says "overdue" in words when told it is overdue, and can print a caption; an error line starts with the word "Error:"; the selected segment has bold text and a ring as well as a fill; estimated and not-known figures print the words "Estimated" and "Not known".
- **Reduced motion:** the existing app-wide rule already switches animations off (the new spinner is one); not toggled in the browser. **Forced colours:** the new classes have a rule for selected and status states; **not testable here**, needs a real check.
- **Labels and associations** were not changed (no markup was altered on any form). **Contrast** was tested by calculation, not by an on-screen tool.

## 9. Automated test results

- `tsc --noEmit`: clean. `npm run build`: succeeds (the old large-chunk warning remains).
- **Full suite run once, after the code settled: 243 files, 4,422 tests, all pass** (87.9 s). The new file `src/shell/d6Shared.test.tsx` has 66 tests; the count before D6 (4,356 in 242) is inferred, not re-run on a clean checkout. A later edit to the coverage guard test and the tracker was followed by a re-run of that file alone (15 passed); no code changed after the full run.
- New tests cover: the date tile model (weekdays, leap day, New Year, the clock-change days, invalid dates, overdue and special only when told), the tile and inline date markup, the six chip tones, the figure rules (a missing value is "not known" never zero, estimated words, progress held to 0 to 100, no arithmetic in the source), icons, `EmptyLine`, unchanged Banner, EmptyState, PageHeader and Modal text and structure, the sheet variant adding class names only and being used nowhere, every old-value default, the chart fallbacks and dark-scope equality, contrast of the new Signature values in both modes, tint pairings on every palette, and rules for the new stylesheet.
- **Mutation check:** deliberately changing a default, making the figure show `$0.00` for a missing value, and breaking the weekend rule made three tests fail; all were restored.
- Existing tests edited: three expectations in `signatureTokens.test.ts` (they said "only the page background reads a new token" and listed the allowed extras) and one in `uiCoverage.test.ts` (it said nothing is beyond `NS`). None was loosened beyond naming exactly what D6 changed.

## 10. Unexpected findings and corrections

1. **D4's chart colours did not work as written.** The app uses chart colours by position (Reports draws Spending as series 2 and Income as series 3; Buy and Rent, loan lines and payoff strategies likewise). With D4's tonal ramp (navy, teal, light teal, grey-blue) Spending and Income came out as two near-identical teals, which I saw on screen. Corrected before finishing: **series 1 and 2 are D4's** (navy `#1D3A6B` / teal `#267880`; dark blue `#8FB0E6` / teal `#3A9AA4`), **series 3 and 4 are different hues** (light: gold `#A8730F`, slate `#8391AA`; dark: amber `#E5B865`, pale slate `#D0D8E6`). A test now demands that any two of the four differ clearly. Series 5 to 8 keep their old hues. Please review (judgment call 2).
2. The two helper files were first named `dateTile.ts` and `DateTile.tsx`, which collide on Windows (names differ only by case); renamed to `dateTileModel.ts` and `figureModel.ts`.
3. The browser pane renders screenshots late and reports width 0 when hidden; comparisons were therefore done in one session at fixed widths, and the first (hidden-pane, different screen density) baseline was discarded.
4. Not a regression, but visible: Tasks row titles are still centred under every palette (the known defect the new button-row reset is for; Tasks was not changed).

**Owner decision at release verification:** the series change is approved provisionally. D12 and D17 must review semantic chart-color consistency, particularly Income versus Spending (series are used by position: Spending is series 2 and Income series 3). No chart calculation or data mapping changed in D6.

## 11. Explicitly deferred

Placing the date tile, chip, figure or icons on any page (D11 onward); wiring the page-title **eyebrow** (no module name is available to a page header without guessing from the address, so the prop exists, draws only under Signature, and is passed by nobody); migrating module chips, tabs and segmented controls; adopting `EmptyLine`; Home's six-colour chart set (`--chart-1` to `-6`) and the Reports series-to-meaning mapping (D12, D17); chart axis labels 11 px to 12 px (D17); the dialog **sheet's** scroll lock and on-screen-keyboard height (D10, which first adopts it; today it is only a CSS shape below 640 px); replacing browser `confirm()` (still a separate decision); header, switcher and Ledger sidebar (D7, D8); self-hosted Inter (OD-3); removing the unused `.qa-menu` and `.brand-link` rules (not done, kept as they were); Signature as the default (D21).

## 12. Updated coverage status

`docs/UI-COVERAGE.md`: the 59-page inventory, 23 surfaces, 31 views, 37 workflows and 62 dialog sites are all still there. **Five global surfaces moved to `BLT`** (S-04 Add button, S-08 Modal and ConfirmDialog, S-09 Toasts, S-21 shared page pieces, S-23 Charts) with only the marks that were recorded; three more (S-05 Add box, S-06 Search, S-10 backup banner) have recorded marks but stay `NS`. **No routed page changed and nothing is `ACC`** (roll-up still 0 accepted). New section 1.1 lists what each mark rests on and what was not checked. Residue (report only): inline styles 308 in 84 files (+1, one data-driven bar width), raw radii 69 (+2), raw font sizes 38 (+2), hex 150 (-2); every other count unchanged.

## 13. Git status

`main` at `63bbff0`, equal to `origin/main`. Nothing staged, committed or pushed; no branch, remote or dependency added. Modified: the nine files in section 2 (eight code and test files and the tracker) plus `docs/UI-COVERAGE.md`, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`. New (untracked): `src/ui/icons.tsx`, `src/ui/dateTileModel.ts`, `src/ui/DateTile.tsx`, `src/ui/StatusChip.tsx`, `src/ui/figureModel.ts`, `src/ui/Figure.tsx`, `src/shell/d6Shared.test.tsx`, this report. Still untracked and untouched: `docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`. Temporary helpers (a style-comparison script in `public/`, a component gallery in `src/`, a second dev server on port 5232, a copy of the released code in the scratch folder) were removed or stopped; the demo profile is back on Classic with no stored theme.

## 14. For owner and ChatGPT review

Judgment calls (please review):
1. **Tokens, not a page marker**, for scoping Signature (section 1). Cost: 37 more stored variables (69 in all, about 1.9 KB). Benefit: no flash, no `index.html` change, a test per default.
2. **Chart series 3 and 4 differ from D4** (section 10, item 1).
3. **Signature table headings are small capitals** on a soft fill, on every table (including long headings). Easy to turn off with one token if too strong.
4. **Signature page titles are 34 px / 30 px** on every page, including dense ones (D4 allowed stepping down per page later).
5. **Disabled fields** look different only under Signature (before D6 a disabled field looked like an enabled one under every palette; that is unchanged for the others).
6. **The Add button follows the primary-button colour** (navy in Signature): colour only, header structure untouched.
7. `--fs-md` still undefined for everyone; `--r-md` now used by controls.
8. **Today** is the strongest tile tone and today, special and overdue tiles get a thicker edge as a shape cue; the tile widens when a caption is given.

Open and unverified: real phone and touch behaviour; screen reader and forced-colours; Reports and other charts in light; Calm teal, Forest and Slate by eye; Signature dark at phone width; the live Undo path of the toast; any page at 320 px by eye; Inter is not shipped, so the look on a device without it uses the system font.

**Handoff:** `docs/CHATGPT-HANDOFF.md` was updated (top notice, current-phase and test-baseline lines; D5 recorded as committed and deployed `63bbff0`, run #91). **Not committed or pushed. Stopped for review. D7 not started.**
