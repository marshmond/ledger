# Ledger Signature D5: foundation (design tokens, opt-in preset, coverage tracker, guards)

Date: 2026-11-10. **Status: BUILT AND TESTED LOCALLY. UNCOMMITTED, NOT STAGED, NOT PUSHED, NOT DEPLOYED. Awaiting owner and ChatGPT review. NOT REAL-DEVICE TESTED.** D6 is not started.

**Planning baseline:** D4 (five documents in the owner's `Documents\Ledger-Design-Concepts\D4-Implementation-Blueprint` folder, kept outside the repository) is the approved plan; this phase follows it with the owner's D5 scope reductions (no demo-seed expansion, no Family model change, no page, navigation or workflow change, no font file, no CSP or service-worker change, no cleanup of existing CSS).

## In plain words

Ledger can now offer a new appearance called **Ledger Signature (preview)** (navy and muted teal on a cool grey background with white cards). It is a choice in Settings > Appearance, **off by default**, and nobody's current look changes when this is released. The app's screens have not been redesigned yet, so under Signature they simply pick up the new colours; the redesign comes screen by screen in later phases. This phase also adds the design "building blocks" later phases will use (named colours, sizes and shadows), a checklist file that tracks every screen, dialog and workflow in the app, and automatic checks that stop the old-style leftovers from growing.

Checked in a real browser: for Classic and the four older colour choices, in light and dark, the shared styles come out **identical** before and after this change (details in section 6). Not checked: a real phone, a screen reader, and a first-paint recording (see section 8).

## 1. Files changed and why

Production files (5 modified, 1 new):

| File | Change | Why |
|---|---|---|
| `src/palette.ts` | New type `PaletteColors` (the 12 colours plus optional `page` and `surface`); `PresetId` gains `signature`; Signature preset (light and dark) with `preview: true` and preset-only `extras`; `varsFor` always writes `--page` and `--surface` (falling back to `bg` and `card`, and to them again if a stored value is not a valid hex); `extrasOf`, `varsOf`, `withoutOptional`; `applyPalette` clears every variable a previous palette set and sets the browser-bar colour from `--page`. | The palette spike (section 2). |
| `src/pages/AppearanceCard.tsx` | Name entry for Signature; "(preview)" label driven by the preset's `preview` flag (remove the flag and the label disappears everywhere); swatches show canvas and card colours; "My own colors" started from a preset drops the two optional roles. | Make Signature selectable and keep custom palettes working. |
| `src/ui/tokens.css` | Additive tokens (section 3), all aliases of existing values; Family member colours with dark variants in both dark scopes. | Token foundation. |
| `src/styles.css` | Three existing lines: `@import './ui/components.css'` after tokens; `:root` font-family now reads `var(--font-sans)` (same stack as before); `body` background reads `var(--page)` (which is `--bg` for every older palette). | Cascade order, font token, canvas colour. Proven neutral (section 6). |
| `src/ui/components.css` | **New, comment only.** Rules for the shared component layer; no rule inside. | Infrastructure. |

Tests and documents:

| File | Purpose |
|---|---|
| `src/shell/signatureTokens.test.ts` (new, 53 tests) | Signature values valid; contrast of every new token, light and dark; dark-scope parity; older palettes protected; preference storage and backup unchanged; applying and clearing on the page; no font file. |
| `src/shell/uiCoverage.test.ts` (new, 15 tests) | Coverage guard (section 5). |
| `src/shell/uiResidue.test.ts` and `src/shell/uiBaseline.ts` (new, 16 tests) | Residue ratchet and the measuring code (section 7). |
| `src/palette.test.ts` (1 test edited) | "has four presets" became "has five presets" with their ids. The only existing test changed. |
| `docs/UI-COVERAGE.md` (new) | The tracker. |
| `docs/LEDGER-SIGNATURE-D5-REPORT.md` (new), `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md` | This report and the required records. |

Not touched: `scripts/dev-demo-seed.ts`, the two other untracked D0/D1 documents, `index.html`, the service worker and its build, the content security policy, `package.json`, the database, any Family, Calendar, Contacts, Finance or navigation file.

## 2. Palette compatibility findings (the spike)

D4's proposal (two optional roles, `page` and `surface`) **is safe**, with one refinement. No stored-format change was needed, so the stop condition was not triggered.

- **Storage is unchanged.** `ledger-palette` still holds only the choice (`{"id":"signature"}`); `ledger-palette-vars` still holds the resolved variables the pre-paint script in `index.html` applies (that script loops over whatever keys are stored, so it needed no change). `ledger-theme` is untouched. Both palette keys are already in the preference backup list, so a backup carries Signature and a restore puts it back byte for byte (tested).
- **Refinement:** the optional roles live on a new type `PaletteColors extends Colors`, not on `Colors` itself. Saved themes, theme codes, the colour map, stored custom palettes and every existing signature keep working unchanged, and `validColors` still checks the twelve required roles only. A stored `page`/`surface` that is not a valid hex is ignored.
- **Preset-only extras:** some Signature tokens have no palette role (control border, navy button, shadows, font stack). They are a small `extras` map on the preset, derived from the preset id; nothing extra is stored. Older palettes have none.
- **Switching** from Signature to anything else leaves nothing behind (tested with a stand-in page; checked in the browser: 32 variables for Signature, 17 for Calm teal with none of Signature's extras, 0 for Classic).
- **Light, Dark, Device:** the extras are written for the mode in effect (as the twelve colours already were), so all three behave as before. Dark values in the two stylesheet dark scopes are written twice by design; a new parity test fails if they differ (it passes for `tokens.css` and `styles.css`).
- **Before first paint:** the stored variables now include `--page` and the extras, so the pre-paint script applies them. Verified by test and by reading the stored value; not recorded as a first-paint capture (section 8).

## 3. Signature tokens and preset behaviour

**Colours (Signature light / dark).** Canvas `--page` `#EEF1F6` / `#0B1220`; card `--surface` `#FFFFFF` / `#131D31`; raised `#FFFFFF` / `#182339`; soft `#F6F8FB` / `#182339`; sunken `#EEF2F8` / `#1E2B46`; text `#101B33` / `#E9EEF7`; secondary text `--fg-2` `#37445B` / `#C3CDDF`; quiet `#566379` / `#9AA8BF`; hairline `#DFE5EE` / `#26354F`; control border `--control-line` `#7A879F` / `#6F82A3`; accent `#267880` / `#6CC0C8`; filled button `--btn-bg` `#0E1A33` / `#277A83`; good `#23694F` / `#72CBA3`; bad `#B0443B` / `#F2928A`; warning `#8F5D16` / `#E5B865`; info `#3B6BA3` / `#8FB0E6` on `#E6EEF8` / `#1B2A47`. The twelve required roles also carry `bg` and `card` (white, so inputs and tables sit on white), and sidebar colours (`#F6F8FB` / `#0B1220` with the accent as highlight).

**Three light values differ from D4's proposals**, because D4 said to re-measure and the first test run found them below the WCAG limits: accent `#277A83` to `#267880` (teal links on the grey canvas were 4.42:1, now 4.55:1); control border `#8390A8` to `#7A879F` (was 2.84:1 on the canvas, now 3.20:1, needs 3:1); info `#3D6FA8` to `#3B6BA3` (was 4.45:1 on its tint, now 4.70:1). The sidebar highlight follows the accent. All dark values are D4's as written.

**Other tokens (all in `src/ui/tokens.css`).** `--surface`, `--page`, `--surface-raised`, `--surface-soft`, `--surface-sunken`, `--fg-2`, `--control-line`, `--btn-bg`, `--btn-ink`, `--info`, `--info-soft` default to aliases of existing colours (for example `--page` is `var(--bg)`, `--control-line` is `var(--line-strong)`), so a palette that does not set them looks as before. Type: `--font-sans`, `--font-mono`, `--fs-micro` 11 px (the date-tile exception), `--fs-title` 34 px, `--fs-title-sm` 30, `--fs-metric` 29, `--fs-display` 48. Space and shape: `--sp-7`, `--r-xs` 6, `--r-md` 8, `--r-xl` 20, `--r-pill`, `--control-h-sm` 36. Shadows keep their names; Signature overrides `--shadow-1/2/3` with navy-tinted values. Family colours: `--mc-blue`, `--mc-green`, `--mc-orange`, `--mc-purple`, `--mc-pink`, `--mc-gold`, `--mc-teal`, `--mc-gray` (the eight stored values, light; D4's dark variants in both dark scopes) plus the monogram mixes `--mc-ink-mix: 58%` and `--mc-tint-mix: 16%`. A test pins that each equals `COLORS` in `src/modules/family/model.ts`, that every colour passes 3:1 as a dot and its monogram text 4.5:1, light and dark, on the Signature surfaces. No Family file changed.

**Variables D4 asked for but D5 deliberately did not define for everyone** (D4 section 1, item 6: "defining them changes some spots"):
- `--fs-md` is referenced by eight module rules with fallbacks of 1.05rem (five) and 1rem (three). Defining it globally would change those headings, so only Signature sets it (1rem). A test pins that it is not defined at `:root`; D6 settles it.
- `--r-md` is referenced by five rules, all with the fallback 8px. It is defined as 8px (provably harmless; a test checks every fallback is 8px) and Signature sets 10px (affects those five spots, under Signature only).
- `--fs-hero` stays 2.5rem (the `.hero` class uses it); D4's 3rem figure is the new `--fs-display`. `--r-lg` stays 14px (cards); Signature does not change it yet.

**Opt-in behaviour.** Signature is the fifth choice in Settings > Appearance, labelled "(preview)". Nothing stored means Classic. It is never the default. Device / Light / Dark controls and "My own colors" are unchanged; starting "My own colors" from Signature copies its twelve colours (not the two optional roles) so the colour map still controls the whole page.

**Fonts.** `--font-sans` is today's system stack. Only Signature puts `Inter` first, with the same fallbacks; no file is shipped, loaded or downloaded, and a test checks there is no `@font-face`, font URL or font file and that the security policy still reads `font-src 'self' data:`. Someone who has Inter installed on their device would see it under Signature; everyone else sees system fonts. Self-hosting is decision OD-3, after D6.

**`src/ui/components.css`** is imported right after `tokens.css` and holds only its rules-of-use comment. Because an `@import`'s rules come before the importing sheet's own rules, a rule there cannot override an existing screen; that suits brand-new `ui-` classes, and D6 should restyle existing rules where they are (tests read those files).

### Rules for D6 onward
Colours only through tokens; new shared classes use the `ui-` prefix; restyle existing selectors in place (several tests read `styles.css` and module sheets as text); no new inline style for anything static; no addition to the important-flag count; update the coverage tracker and the baseline in the same change.

## 4. How existing preferences are protected

1. Defaults are aliases (section 3); `--page` equals `--bg` and `--surface` equals `--card` for every palette that does not set them, including all stored values from before this release (their stored variable copies lack the two names, and the stylesheet alias fills them in).
2. The stored choice format is unchanged; an unknown id still falls back to Classic.
3. Custom palettes and saved themes carry the twelve roles only, and are not touched.
4. The two palette keys and the theme key stay in the backup preference list and round-trip.
5. Switching away from Signature clears its extras and canvas.
6. The measured proof in section 6 shows the shared styles for the existing palettes come out identical.

## 5. Coverage tracker and route counts

`docs/UI-COVERAGE.md`: **59** routed destinations (Ledger 31, Settings 5, Bills 5, Services 4, Assets 3, Family 3, Projects 2, Contacts 2, Today 1, Calendar 1, Tasks 1, Household Finances 1), **23** global surfaces, **31** in-page views, **37** workflows, **62** dialog call sites in 10 module rows, 3 confirmation styles (8 shared, 1 Bills-local, **37** browser-native), 5 pop-over kinds, 5 redirect kinds, the not-authorised list and the residue baseline. Every routed page has a stable ID, its component file (checked to exist), a planned phase, a status and six acceptance marks (light, dark, 375, 1440, keyboard, function). Everything is `NS`: no page was changed, so there is no implementation evidence to record. `ACC` requires all six marks.

**D4's 59 was checked against the source and is exact.** The Ledger route list has 32 entries; one (`/ledger/backup`) is a redirect to Settings, leaving 31 pages. The other counts (62 Modal sites in 41 files, 37 native confirms in 24 files, 307 inline styles in 83 files) reproduced exactly. Two definitions needed spelling out, neither changing a number: D4's "9 font sizes below 12px" counts `px` values only (two `rem` values make 11), and "37 confirm()" counts browser-box calls with a message (five local functions named `confirm` are not browser calls).

**The guard (`uiCoverage.test.ts`)** uses the registrations that exist: the module registry (all 11 modules must appear) and `LEDGER_ROUTE_PATHS`; for the eight files that declare routes as JSX it compares an explicit list in the test with the `<Route>` lines of those files, so a new page makes it fail; a tripwire fails if any other file declares routes; and it checks IDs are unique and gap-free, phases are D5 to D21, statuses and marks are valid, `ACC` needs every mark, named files exist, in-page views point at real pages, and the dialog rows total the measured 62. **What it cannot see:** query-string states, views inside a page, dialogs, and any route mechanism that does not use the `<Route>` element. Checked by deliberately removing a tracker row and adding a fake route: both were caught, then restored.

## 6. Verification results

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run build` | passes (the existing large-chunk warning only) |
| Targeted tests (37 files, 575 tests) | all pass: palette, theme, saved themes, preference backup, backup (G1, encrypted, file, coverage), all of `src/shell` (including `stS3Contrast`, `stS3Structure`, `stS3Accessibility`, `stS51Ui`, CSP, modal keys), `moduleGroups`, `shellFoundations`, Contacts, `family-guards`, `family-f5-integration`, service-worker build tests |
| New tests | 84 in 3 new files, plus 4 from the new preset in `palette.test.ts` (Signature is checked by the existing contrast loops: 88 more passing tests in all) |
| Full suite | **not run**, as instructed (additive tokens and an opt-in preset). Last recorded baseline 4,278 in 239 files; this change adds 88 tests in 3 files. CI runs the whole suite on push. Every test that reads `styles.css`, `tokens.css`, the palette or `AppearanceCard` is in the targeted run. |
| Release baseline | `HEAD` = `origin/main` = `8ab1789` (U2); Pages run #90 success (read from the public GitHub API; `gh` is not installed) |

**Browser (fictional D1 demo data only; the owner's existing demo server on port 5231 was used and left running; screenshots stay in the tool's own folder, outside the repository):**
- **Before and after, existing palettes.** An untouched copy of `HEAD` was served on a second port. In both, 43 probe elements (card, headings, links, every button kind, inputs, select, textarea, table, badges, banner, alert, segmented control) were measured for 15 style properties, plus 31 colour, size and shadow variables, the body background and the browser-bar colour, for **Classic, Calm teal, Deep navy and gold, Forest green and stone and Slate and indigo, each in light and dark: all 10 combinations identical.** (An earlier comparison on real screens was discarded because the two servers hold different data; the probe method removes that variable.) The probe copy was removed and its server stopped.
- **Signature, desktop (1440 emulated):** selected through the real Appearance screen; Today in light and dark checked by screenshot: grey canvas, white cards, teal accents, readable text, chips and dividers visible. The stored choice was `{"id":"signature"}`, the canvas `#EEF1F6`, button variable `#0E1A33`, browser bar `#EEF1F6`.
- **Signature, 375 px:** Appearance, Today, Accounts and Tasks, light and dark: **no horizontal overflow (scroll width = 375 on all eight)**; the palette list and Tasks screen checked by screenshot.
- The browser profile was returned to Classic and Device mode.

## 7. Baseline guards

`src/shell/uiBaseline.ts` measures, by simple text search, and `uiResidue.test.ts` fails if a number rises. All equal the D4 figures exactly:

| Measure | Baseline |
|---|---|
| Inline `style={{` in screens | 307 in 83 files |
| Raw `border-radius` pixel values | 67 |
| Raw `font-size` px or rem values | 36 (9 below 12px as pixels, 11 with rem) |
| Hex colours in CSS (excluding `tokens.css`, the one place colours belong) | 152, of which module sheets 56 |
| Files with their own `<h1>` | 13 |
| `className="card…"` | 395 (informational) |
| Browser-native `confirm()` | 37 in 24 files |
| `<Modal>` sites | 62 in 41 files |
| `!important` | 11 |

The Signature palette guards (valid values, contrast of the new tokens in light and dark, light and dark parity, fallbacks) are in `signatureTokens.test.ts`. Existing contrast tests (`stS3Contrast`) now also run against Signature automatically and pass.

## 8. Unexpected visual changes and outstanding concerns

**Unexpected visual changes:** none for Classic or the four older presets (measured). Under Signature (opt-in) the changes are the expected ones: new colours everywhere, filled buttons are teal rather than navy (D6 adopts `--btn-bg`), five module headings render at 1rem instead of 1.05rem (the other three already use 1rem) and five spots use a 10px radius.

**Outstanding concerns (please review):**
1. **Not seen on a real phone or screen reader.** The 375 px checks are an emulated width.
2. **First paint was not captured.** The pre-paint script is unchanged and the stored variables contain the new names (tested), but a recording of a reload with Signature selected was not made.
3. **Thin contrast margins on three tokens:** teal accent on the grey canvas 4.55:1 (limit 4.5), control border on the canvas 3.20:1 (limit 3), info on its tint 4.70:1. They pass and are guarded, but D6 should use `--accent-text` for small text on tinted fills.
4. **Downgrade case:** if a backup holding Signature is restored into an older copy of Ledger, that copy falls back to Classic (tested as logic), but its stored variable copy briefly contains names it does not know; they are removed on its next startup. Not a data risk.
5. **The ratchets fail the test run, and so the deploy, when a count rises** (including cosmetic ones such as an inline style added in an unrelated feature). That is D4's design; it can be relaxed to a warning if the owner prefers.
6. **Inter is not shipped**; under Signature most devices show their system font, so the preview does not yet show the intended typeface.
7. **The Ledger sidebar colours** for Signature are my choice (light surface, accent highlight) because D4 plans to replace that sidebar; harmless to change.
8. **The two optional roles are not editable** in "My own colors" (by design: the colour map is unchanged); a custom palette based on Signature therefore has a white canvas.

## 9. Judgment calls (please review)

1. Optional roles on a new `PaletteColors` type, not on `Colors`, to leave every existing signature and test alone.
2. Preset-only `extras` instead of new stored fields or a data attribute.
3. Three light values nudged from D4's proposals to pass contrast (section 3).
4. Signature `bg` and `card` are white and the grey canvas is `page`, so existing screens stay legible without edits.
5. `--fs-md` left undefined globally; `--r-md` defined as 8px; `--fs-hero`, `--r-lg` not changed (D4 differs; new names used instead).
6. Three existing lines in `styles.css` edited (import, font variable, body canvas); proven neutral.
7. "(preview)" label driven by a flag on the preset so removing the flag removes it.
8. Hex count excludes `tokens.css`.
9. All residue measures are hard ratchets at the D4 numbers.
10. Tracker records one primary component file per route; Settings tabs share the frame file; G-02 and W-29 stay `NS` although the Signature choice exists.
11. One existing test edited (preset count).
12. Full suite not run; CI will run it.

## 10. Explicitly deferred (not built)

Demo-seed expansion for Invest and Plan (`scripts/dev-demo-seed.ts` untouched); any Family model, helper or colour-id change (D9); any restyle of Today, Tasks, Ledger Home, Household Finances or Family or any other screen; header, switcher, Ledger sidebar, bottom bar or route changes; moving, replacing or cleaning up existing CSS, inline styles, radii or font sizes; `ui-` components, date tile, status chip, figure, icons (D6); self-hosting Inter, widening the service-worker list, changing the security policy (OD-3); browser-bar and manifest colours (D21); making Signature the default (D21); D6 onward.

## 11. Git status (at the end of this phase)

`HEAD` `8ab1789` on `main`, equal to `origin/main`; no branch, remote, worktree or dependency created; nothing staged or committed.

Modified (tracked): `src/pages/AppearanceCard.tsx`, `src/palette.test.ts`, `src/palette.ts`, `src/styles.css`, `src/ui/tokens.css`, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`.

Untracked, **new in D5**: `docs/UI-COVERAGE.md`, `docs/LEDGER-SIGNATURE-D5-REPORT.md`, `src/shell/signatureTokens.test.ts`, `src/shell/uiBaseline.ts`, `src/shell/uiCoverage.test.ts`, `src/shell/uiResidue.test.ts`, `src/ui/components.css`.

Untracked, **pre-existing and preserved (do not include in a release unless the owner decides)**: `docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`.

`dist/` was produced by the build and is ignored by git.

## 12. Handoff

`docs/CHATGPT-HANDOFF.md` **was updated** (snapshot, delivered-functionality entry, roadmap line, change log): D4 recorded as the approved planning baseline with the D5 scope adjustments, D5 recorded as built and tested locally and uncommitted. Unknown: whether the owner wants the D4 documents committed to the repository (they are outside it); the real-device checks.

**STOP for owner and ChatGPT review. Nothing was committed or pushed.**

## 13. Release correction and final verification (2026-11-11)

D5 was independently reviewed and conditionally approved. Sections 1 to 12 above are kept as the historical record of the build; where they call the residue measures a hard ratchet (sections 7 and 9 item 9, and concern 5 in section 8), this section supersedes them.

- **Cosmetic-guard correction.** `src/shell/uiResidue.test.ts` now only MEASURES and REPORTS: it prints every legacy-style count against the baseline in `uiBaseline.ts` (marking each up, down or same, with a warning line when any is higher) and never fails because a count moved. It still fails if the measuring itself breaks (no screens, tests or CSS found, or a non-numeric count). The baseline numbers and the comparison are unchanged. Hard failures that remain: route coverage and tracker structure (`uiCoverage.test.ts`, including the dialog total), and Signature palette validity, token contrast, dark-mode parity, preference compatibility and fallbacks (`signatureTokens.test.ts`, `palette.test.ts`, `stS3Contrast`). Wording in `docs/UI-COVERAGE.md` section 6 and the `uiBaseline.ts` header was updated to match. No runtime file changed.
- **Baseline re-verified:** `HEAD` = `origin/main` = `8ab1789`, Pages run #90 success; working tree unchanged since the report apart from this correction.
- **Tests rerun:** the residue, coverage, Signature token and palette tests (results in the release hand-off); the earlier 575-test targeted run was not repeated because the scope did not change. The full suite runs in CI.
- **Conclusions unchanged:** no change to the compatibility, contrast or before/after findings. Still not verified: a real phone, a screen reader, and a first-paint recording (see below if a quick check was made).
