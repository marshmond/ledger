# Ledger Signature D21.1: universal design system and appearance unification (implementation report)

Date: 2026-11-13. Status: **BUILT AND TESTED LOCALLY; UNCOMMITTED, NOT STAGED, NOT PUSHED, NOT DEPLOYED. Awaiting owner and ChatGPT review. Nothing in this phase is owner-accepted (`ACC`); no real-device or screen-reader check was done.**

Pictures: `Documents\Ledger-Design-Concepts\D21.1-Evidence` (open `sheet.html`; every image it references is in that folder). All screenshots are of the running app, on the invented demo household, in a desktop Chromium browser at emulated widths. None is a mockup. None is from a real phone.

## 1. Executive summary

Ledger Signature is now the one interface. A palette chooses colors only; the layout, header, navigation, type, cards, tables, dialogs and the shape of the charts are the same under every palette.

| Item | Result |
|---|---|
| Signature is the default | **Done.** A device with nothing saved draws Signature Navy straight from the stylesheet (`src/ui/palette-base.css`), with no stored value and no script needed. |
| Old interface selection removed | **Done.** "Classic blue" and the four older presets are gone from Settings > Appearance and from the code. There is no second look to select. |
| Five curated palettes | **Done.** Signature Navy, Coastal Slate, Evergreen, Warm Stone, Midnight Plum, each complete for Light and Dark (55 palette variables each). |
| Light, Dark and Device | **Done.** Three radio buttons on the Appearance page (the menu-bar button still cycles them). Mode and palette are independent. |
| Preferences safe | **Done.** Documented mapping; one-time transition that keeps the old id in `from`, never deletes, is repeat-safe and leaves damaged values in place. Custom colors and saved themes are untouched byte for byte. |
| Signature Navy unchanged | **Verified by pixel comparison:** 52 of 56 captures (14 pages, Light and Dark, 1440 and 375 px) are pixel-identical to the approved prior Signature; the other 4 are the Appearance page, which was redesigned on purpose (section 12). |
| Tests | **288 files, 5,667 tests pass** (was 287 / 5,477: +1 file, +190 tests); `tsc` clean; production build passes; 48 of 48 real-browser checks pass. |

**Recommended verdict: ready for owner review, not for acceptance.** Section 21 records the final Calendar contrast correction. Section 19 lists what must still be decided or verified (real devices, screen reader, owner's visual review of the four new palettes).

## 2. Git baseline and deployment verification

- Branch `main`. After `git fetch`: `HEAD` = `origin/main` = **`582ce649cdb79742f198e20b18845dd04812fd31`** (`feat(ui): finish Ledger Signature D21 polish`).
- GitHub Actions, read from the public API (`gh` is not installed): run **#114** "Deploy to GitHub Pages", head `582ce64`, `completed` / `success`. Runs #113 and #112 also `success`.
- **The D21 prerequisite is met:** the D21 change set (browser-bar colour, Income overflow, accessibility names, tests and documentation) is committed in `582ce64` and deployed. The two earlier handoff lines that still said "uncommitted" were only stale text (the handoff already carried an uncommitted note recording the release); this phase updates it.
- Working tree at the start: only the handoff edit and the three protected untracked files (`docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`). **They were not edited, staged or moved.** The demo seed script was only *run* (as its own header says) on a throw-away browser profile on port 5231.
- Baseline picture set of the approved prior Signature (14 pages, Light and Dark, 1440 and 375 px) was captured **before any production change**, from `HEAD` with the old `signature` palette chosen, and kept as `_baseline-prior-signature/` in the evidence folder.
- Baseline test run: 287 files, 5,477 tests (from the D21 report). Final run in section 15.

## 3. Files changed

**Application (11 files, 1 new):**

| File | Change |
|---|---|
| `src/palette.ts` | Rewritten: five palettes (colors only), the custom-theme adapter `deriveExtras`, the older-id map, `migrateStoredPalette`, `mixHex`, pre-paint copy format version 2. |
| `src/ui/palette-base.css` (**new**) | The default colors (Signature Navy) for light, device-dark and forced-dark: every palette variable. |
| `src/ui/tokens.css` | Signature structure is now the default (62 px header, 46 px navigation, 10/16/20 px corners, Inter first, 600 buttons, capital table headings, shadows built from a palette tint); the old Classic values are gone. |
| `src/styles.css` | Classic colors removed from `:root` and both dark blocks; imports `palette-base.css`; stale comments corrected. |
| `src/theme.ts` | `THEME_COLOR` is Signature Navy's canvas; `initTheme` runs the one-time transition first. |
| `index.html` | Pre-paint scripts use only a version-2 palette copy; static bar colour and fallbacks are Signature Navy's. |
| `public/manifest.webmanifest` | `theme_color` and `background_color` are `#EEF1F6` (were Classic's blue and white). |
| `src/pages/AppearanceCard.tsx` | Rebuilt for one interface, five palettes, saved themes and custom colors, with real previews and a mode picker. |
| `src/pages/settings.css` | Styles for the palette pictures and the mode picker (tokens only). |
| Comment-only edits | `household.css`, `today.css`, `analysis.css`, `home.css`, `money.css`, `plan.css`, `components.css`, `README.md` (no longer describe two interface generations). No rule changed. |

**Tests:** new `src/shell/d211Palettes.test.ts` (171 tests) and fixture file `src/shell/legacyFixtures.ts` (the old Classic and four preset colors, used by tests only; the app does not import it). Updated, with the superseded rule written down in each file: `palette.test.ts`, `shell/d21Appearance.test.ts`, `shell/signatureTokens.test.ts`, `shell/d6Shared.test.tsx`, `shell/d7Header.test.tsx`, `shell/d8LedgerNav.test.tsx`, `shell/stS3Contrast.test.ts`, `pages/d12Home.test.tsx`, `pages/d12HomeComposition.test.tsx`, `pages/d12Contrast.test.ts`, `modules/today/d11Contrast.test.ts`, `modules/today/d131Contrast.test.ts`, `modules/family/family-d9-identity.test.tsx`, `lib/savedThemes.test.ts`, `shell/d201aConfirmations.test.tsx` (import only).

**Docs:** this report, `docs/CHATGPT-HANDOFF.md`, `docs/UI-COVERAGE.md`, `docs/BACKLOG.md`.

**Not touched:** calculation engines, tax tables, `src/db.ts` and migrations, backup format, sync, recurrence and Tasks/Calendar code, service worker, `package.json` (no new dependency), Family model and its eight stored colors, the three protected files.

## 4. Original appearance architecture and the coupling found

Before D21.1 "Signature" was not just a color set. It was the only thing that switched the design on:

1. `src/palette.ts` held the Signature preset with a block of **structural** variables (`SIGNATURE_SHARED` plus the light/dark extras): corner radii (`--r-md`, `--r-lg`, `--r-modal`), `--fs-md`, the Inter font stack, button weight, page-title size and tracking, table-heading style, the 62 px header, 40 px controls, the search field, the Ledger mark and "All modules" caption, the 46 px navigation with icons, and the show/hide switches (`--ui-brand`, `--ui-lnav-ic`, `--ui-glyph`, ...). They were written to the page as inline CSS variables **only when `signature` was chosen**.
2. `src/ui/tokens.css` and `src/styles.css` held the **Classic** values of every one of those variables as the defaults (36 px bar, 28 px controls, 8/14 px corners, system font, no brand mark, no icons in the navigation, plain table headings, Classic blue and grey colors).
3. The four older presets and every custom palette set colors only, so they showed the **Classic structure** in their own colors.
4. `savePalette` removed both stored keys for Classic, so a Classic choice and "never chose" looked the same on a device (the finding that stopped D21).
5. `index.html`, `THEME_COLOR` and the manifest used Classic's blue and dark grey; ten module/shared stylesheets and several tests described "Classic and the older presets" versus "Signature".

**Audit result for code that keys off palette identity:** none. A search of every source file for palette ids, `data-palette`, palette-named classes and comparisons found no selector, markup branch or component that varies by palette; all variation went through CSS variables. So no component needed to be rewritten. The coupling was entirely in *where the structural variables lived* (palette code instead of the stylesheet) and *what the stylesheet defaulted to* (Classic).

## 5. New universal Signature architecture

- **Structure lives in the stylesheet, once.** `src/ui/tokens.css` now holds the Signature structure as the default for everyone. `src/styles.css` and the module stylesheets read it through the same tokens they always read.
- **Colors live in one file and one data table.** `src/ui/palette-base.css` carries Signature Navy's colors; `src/palette.ts` carries all five palettes. A test compares the two variable by variable, in all three scopes (light, device-dark, forced-dark), so a device with nothing saved looks exactly like one that chose Signature Navy.
- **A palette may set only colors.** Palette code writes 55 variables (17 base colors and derived text colors, 38 extras) and nothing else. A test fails if any palette, or any custom palette, sets a size, corner, type, header, navigation, table, shadow-shape or layout variable.
- **Custom colors go through an adapter, not a second design.** A custom palette stores twelve colors, as before. `deriveExtras` computes the other 38 roles from them (rules in section 9), so a theme made years ago renders in the Signature interface.
- **Nothing is keyed to a palette's name.** A source guard fails if any file other than `palette.ts` and the Appearance page names a palette.
- **Dead fallbacks left alone:** many rules still write `var(--r-md, 8px)` and similar; the variable is always defined now, so the fallback never applies. Removing them is cleanup outside this phase (section 18).

## 6. Palette definitions and the semantic token strategy

The starting colors you gave are design directions. Each palette's working values were adjusted where they would not reach the contrast the interface needs (for example the link color is a darker step of each accent so text reads at 4.5:1). Light values (Dark values are separate, not inverted):

| Palette | Canvas | Card | Primary button | Link and active accent | Starting accent (kept in charts, previews and the mark) |
|---|---|---|---|---|---|
| Signature Navy | `#EEF1F6` | `#FFFFFF` | `#0E1A33` | `#267880` | `#287E85` family |
| Coastal Slate | `#F1F4F6` | `#FFFFFF` | `#34475A` | `#376679` | `#668999` |
| Evergreen | `#F0F4EF` | `#FFFFFF` | `#24483D` | `#2F6A55` | `#729481` |
| Warm Stone | `#F7F4EE` | `#FFFFFF` | `#51493F` | `#7A5C46` | `#9F816B` |
| Midnight Plum | `#F3F0F6` | `#FFFFFF` | `#40334E` | `#6B5580` | `#8D789F` |

(Signature Navy's primary is the approved `#0E1A33` that has shipped since D5; the brief's `#14263F` is the same family and was **not** substituted, because the brief also requires the approved appearance not to change.)

Every palette defines, for Light and for Dark: canvas, card, raised, soft and sunken surfaces, field fill, text, secondary and quiet text, hairline and control border, link/active accent, menu bar and its highlight, primary button with hover and its text, informational color and fill, shadow tint, scrim, toast, chart series 1 to 4, Home category colors 1 to 6, the dark Home panel with its text, quiet text, good/bad figures and chart ramp, and the spending color. Hover, active and focus states are derived from these (hover tint 6%, focus ring 35% accent).

**Strategy:** semantic variables, not four colors everywhere. **The status colors (good, bad, warning, information) are shared by all five palettes** (a test enforces it), so a gain, a loss or a warning means the same thing whatever the palette. Palette personality lives in canvas, surfaces, text tint, primary button, accent, menu bar, chart colors and the Home panel. The eight stored Family identity colors are **not palette variables** and are unchanged (a test pins the stored values and that no palette sets any `--mc-*`).

## 7. Before and after default behavior

| | Before D21.1 | After |
|---|---|---|
| Nothing saved | Classic | **Signature Navy** (from the stylesheet; nothing written) |
| Chose Signature | `{"id":"signature"}` | Same look; stored as `{"id":"signature-navy"}` after the transition |
| Chose Classic | stored nothing | not an option |
| Chose a palette | stored `{id}` | stored `{id}` (Signature Navy too) |
| What a palette changes | colors, and (only Signature) the whole design | **colors only** |
| Browser-bar color | Classic blue / dark grey | the chosen palette's canvas; Signature Navy `#EEF1F6` / `#0B1220` before first paint |
| Manifest colors | `#1f6feb` / `#ffffff` | `#EEF1F6` / `#EEF1F6` |

## 8. Legacy preference migration and compatibility rules

**Mapping (documented, deterministic):**

| Stored before | Read as | Why |
|---|---|---|
| nothing (Classic) | Signature Navy | the new default |
| `classic` (never stored, accepted) | Signature Navy | same |
| `signature` | Signature Navy | the same look, new name |
| `navy` "Deep navy and gold" | Signature Navy | the navy family |
| `teal` "Calm teal" | Evergreen | soft, natural green-teal on a warm-green canvas |
| `forest` "Forest green and stone" | Evergreen | green accent |
| `slate` "Slate and indigo" | Coastal Slate | cool grey-blue |
| `custom` (with or without a saved theme) | unchanged | colors and saved-theme link preserved |
| anything else or damaged | Signature Navy for display; **the stored value is left in place** | nothing deleted |

**One-time transition** (`migrateStoredPalette`, run at startup): reads two browser keys and writes only the palette's pre-paint copy and, for an old id, the choice. Results: `none` (nothing written), `current`, `migrated` (the old id is replaced by the new one and kept as `from`), `refreshed` (a missing or older-format pre-paint copy is rebuilt, for example after restoring an old backup), `unreadable` (left untouched). It never touches the database, Light/Dark, or any other key (a test checks the source and a live check measured it).

**Pre-paint copy:** `ledger-palette-vars` now carries `v: 2`. `index.html` ignores an older copy rather than apply half of it; the app rewrites it on the first start. **One-time cost:** on the first load after this release, a device that had a non-default palette may show Signature Navy for the moment before the app starts, then its (mapped) palette. It happens once per device.

**Backup and restore:** no backup-format change. A backup made by the previous version (older id, older copy) restores unchanged and is mapped on the next start; a backup made today restores to an identical, already-current state; a backup without a palette still leaves the device's own choice alone; older backups remain restorable (tests: `d211Palettes.test.ts` "restoring a backup made by the previous version", "a backup made today").

## 9. Custom-theme preservation evidence

- **What is stored does not change.** Twelve colors per mode, the saved-theme link, the saved-theme list in the database (synced), theme codes. A test round-trips every fixture (Classic, the four older presets, the five new palettes' own twelve colors) and checks the stored object has exactly the same keys; another checks the migration leaves a custom choice byte for byte equal.
- **Adapter rules (`deriveExtras`), in plain terms:** raised surface and fields use the page background; soft and sunken fills are 4% and 8% of the text color over the card; secondary text is the text color nudged toward the quiet color; the control border is 24% text over the page; **buttons use the accent** with a text color chosen to read on it; information uses the accent; the toast is text-colored; chart colors are the fixed set the app has always drawn; the **dark Home panel** is a dark tone of the text color (Light) or of the accent (Dark), darkened further until its text reaches 7:1, with quiet text and good/bad figures forced to 4.5:1 or replaced by the plain text color.
- **Measured:** for Classic and each of the four older presets (the starting points of most old custom themes) and for the five new palettes taken as custom colors, in Light and Dark: every derived variable is set (no earlier palette can show through), buttons read at 4.5:1, the Home panel at 7:1 with readable quiet text and figures, the toast reads.
- **Live:** a stored Classic-colors custom theme with a saved-theme link was loaded in the browser: storage was unchanged byte for byte, the page used its accent, and the Appearance page lists it (`behaviour/custom-theme-from-classic-colors-1440.jpg`).
- **Where an old custom theme cannot read well:** the existing "Readability check" in the editor (kept) names each failing pair in plain words and its ratio. Nothing is changed silently. **Proposed remedy, not built:** a "Fix automatically" button in the editor that proposes the nearest readable color for each flagged role and asks first (needs an owner decision).
- Saved themes (database) are not read or written by the transition at all.

## 10. Settings > Appearance changes

Top to bottom: **Colors right now** (status line); **Color palette** (five palette cards and "My own colors"; each card shows a small picture of the interface in **Light (left) and Dark (right)** drawn from that palette's own variables, its name, a one-line description and an "In use" tag; a radio group with arrow-key movement); **Appearance mode** (Light, Dark, Device as three radio buttons); **My themes** (saved themes as the same cards, "Add a theme from a code"); and, when "My own colors" is chosen, the existing editor: color map for the chosen mode, **Readability check**, **Preview** (now drawn with the adapter, so it matches the real interface), Save as new theme, Update, rename, delete (confirmation kept), copy theme code, "Start over from" the five palettes (confirmation kept).

Removed: the Classic card, the "preview" label, the Light/Dark explanation list and the long mode introduction. Starting a custom palette from a built-in one now puts the palette's canvas in "Page background" and its card color in "Cards and panels" (before, the canvas was dropped). No migration warning is shown to anyone.

## 11. Light and Dark results for all palettes

Measured on the palette data (WCAG, in `d211Palettes.test.ts`; every row passes the thresholds shown):

| Palette | Mode | Text on canvas | Quiet text | Link on card | Good | Bad | Warning | Button text on button | Control border on canvas (3:1) | Home panel text | Link on canvas |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Signature Navy | Light | 15.1 | 5.4 | 5.1 | 6.6 | 5.6 | 5.6 | 17.3 | 3.2 | 17.3 | 4.5 |
| Signature Navy | Dark | 16.1 | 7.8 | 8.0 | 8.6 | 7.4 | 9.1 | 5.0 | 4.8 | 13.6 | 8.9 |
| Coastal Slate | Light | 14.6 | 5.6 | 6.3 | 6.6 | 5.6 | 5.6 | 9.6 | 3.3 | 11.7 | 5.7 |
| Coastal Slate | Dark | 15.7 | 7.6 | 7.7 | 8.7 | 7.4 | 9.1 | 5.7 | 4.6 | 13.5 | 8.4 |
| Evergreen | Light | 14.5 | 5.7 | 6.3 | 6.6 | 5.6 | 5.6 | 10.1 | 3.5 | 11.5 | 5.7 |
| Evergreen | Dark | 15.8 | 7.5 | 8.0 | 8.8 | 7.5 | 9.3 | 5.8 | 4.5 | 12.4 | 8.8 |
| Warm Stone | Light | 14.5 | 6.1 | 6.1 | 6.6 | 5.6 | 5.6 | 8.8 | 3.9 | 11.6 | 5.5 |
| Warm Stone | Dark | 15.4 | 6.8 | 8.5 | 9.0 | 7.7 | 9.5 | 4.9 | 4.5 | 13.7 | 9.1 |
| Midnight Plum | Light | 15.3 | 6.4 | 6.5 | 6.6 | 5.6 | 5.6 | 11.7 | 3.9 | 13.9 | 5.7 |
| Midnight Plum | Dark | 15.8 | 6.7 | 8.3 | 9.1 | 7.8 | 9.6 | 5.7 | 4.7 | 14.7 | 8.9 |

Dark is separately designed: surfaces step up from a darker canvas, accents are lighter steps (not inverted), buttons are darker mid-tones with white text, and the Home panel stays dark in both modes. Also tested per palette and mode: text on all five surfaces and in fields; link, good, bad, warning and information as text; the text tone on each color's own tint; toast 7:1; menu bar text and highlight; focus accent 3:1 against canvas, card and field; chart series 1 to 4 at 3:1 and told apart by lightness or hue; the Home panel's chart ramp at 3:1; Family colors as dots (3:1) and monogram text (4.5:1) on each palette's card.

**Automated browser contrast sweep** (real Chromium, 21,909 visible text elements across 14 pages x 5 palettes x 2 modes at 1440 px; effective background resolved through ancestors): distinct failing items per palette (Light / Dark): Signature Navy 11 / 2, Coastal Slate 13 / 5, Evergreen 13 / 5, Warm Stone 13 / 12, Midnight Plum 13 / 8. Every one is either (a) a **disabled control** (Add, Add target, Prev, Next, Today, Add theme at 50% opacity: exempt from the contrast rule, confirmed disabled in the page) or (b) the small time and priority marks and screen-reader-only text on the **de-emphasised out-of-month Calendar chips** (85% opacity), which read 3.95 to 4.3:1 in Signature Navy Light (pre-existing, the approved palette) and 4.1 to 4.49:1 in the dark mode of the four other palettes. **No other text element in any palette failed.**

## 12. Prototype and Signature Navy fidelity comparisons

- **Signature Navy vs the approved prior Signature (pixel comparison, evidence in the sheet):** the same 14 pages, Light and Dark, 1440 and 375 px = 56 pairs, captured from `HEAD` (old `signature` palette chosen) before the change and from the new build (a) with **nothing saved** and (b) with Signature Navy **chosen explicitly**. Result in both cases: **52 of 56 pixel-identical** (no channel differs by more than 1 of 255 anywhere); the 4 that differ are Settings > Appearance (Light and Dark, 1440 and 375), which was redesigned on purpose. No other page differs by a single pixel.
- **Prototype fidelity:** the D3 prototypes (Today, Ledger Home, Family, Household Finances, Tasks) are included beside the current captures in the sheet. Because Signature Navy is pixel-identical to what was already reviewed in D6 to D21, fidelity to the prototypes is **the same as it was at D21**; D21.1 did not re-review it and does not claim a new prototype acceptance.
- Mid-size and small widths (800 and 320 px) have no prior baseline; they are shown for all five palettes in the sheet, not compared.

## 13. Desktop and mobile screenshot evidence

Everything is in `D21.1-Evidence` and listed in `sheet.html`:

- `contact-sheets/<page>-1440.jpg` and `-375.jpg`: all five palettes side by side, Light on the top row and Dark below, for each of the 14 pages (Today, Tasks, Calendar, Ledger Home, Transactions, Budget, Income, Investments, Family, Household Services, Bills & Subscriptions, Projects, Contacts, Settings > Appearance). These sheets are composites of the real screenshots in the per-palette folders (labelled as such on the image).
- `<palette-id>/<page>-<mode>-<width>.jpg`: the individual captures (1440 and 375 for 14 pages; 800 and 320 for Today, Ledger Home, Transactions, Budget, Family and Settings > Appearance).
- `_baseline-prior-signature/`: the approved prior Signature, for the comparison in section 12.
- `behaviour/`: a saved theme on the Appearance page, the delete-theme confirmation, a custom theme from Classic's colors, and the phone Add sheet in Midnight Plum dark.
- `prototypes/`: the D3 prototype images.

## 14. Contrast and accessibility findings

- Palette data: all pass (section 11). Browser sweep: see the sweep result in section 11; the remedy for the Calendar chips is owner decision 3 in section 17.
- **Keyboard (real keys, Chromium):** arrow keys move through the palette cards and choose (roving radio group); the focused card has a 2 px solid outline; a focus outline of 2 px or more is drawn on controls under all five palettes in Light and Dark.
- **Touch targets (375 px, emulated):** every palette card and mode button is at least 44 x 44.
- **Layout:** no sideways page scroll at 375 px on Appearance, Today and Transactions, nor at 320 px on Appearance and Ledger Home, for all five palettes in Light and Dark.
- **Palette switching moves nothing:** header, navigation, page title and page size were measured under all five palettes (Light and Dark, five pages): identical for all five palettes on Today, Ledger Home, Transactions, Family and Settings > Appearance in Light and Dark (this check found a 2 px growth of the chosen palette card on the Appearance page, from a thicker border; fixed by ringing the card with an inset line instead).
- **First paint:** with the app script blocked, the saved palette, mode and browser-bar color were already applied by `index.html`.
- **Not verified, and not claimed:** real phone, screen reader (NVDA, VoiceOver, TalkBack), forced-colors mode, Safari, Firefox, print in a real printer, reduced-motion. The palette pictures are decoration (`aria-hidden`); each card is named by its text.

## 15. Test counts and exact commands

Run from the repository root, on the final tree:

```
npx tsc --noEmit            # clean
npx vitest run              # 288 files, 5,667 tests, all pass
npm run build               # passes; the three inline scripts in dist/index.html are all covered by the content-security hashes (checked)
```

- Baseline (D21 report): 287 files, 5,477 tests. Now: 288 files, 5,667 tests. New file `src/shell/d211Palettes.test.ts` (171 tests); existing files were rewritten where a rule was superseded (section 16a); none was deleted or skipped.
- Existing appearance, theme, contrast, token, header, navigation, Home, Family identity, saved-theme, backup and sync-coverage tests all run and pass. The UI baseline and residue guards run; the coverage-tracker guard passes with no status change.
- **Browser checks** (Chromium via Playwright against the dev server on port 5231, demo household, throw-away profile): 48 checks, 48 pass: fresh device writes nothing and draws Signature Navy; each of the five palettes chosen through the UI in Light and Dark is stored as `{"id":...}` and applied, with the browser-bar color equal to its canvas; **no database table changed** (all 40 tables' row counts and sizes identical before and after) and only appearance keys (plus the remembered last module while navigating) changed in browser storage; header, navigation, title and page size identical across palettes on 5 pages in both modes; first paint correct with the app script blocked; the six older ids migrate as mapped, repeat-safe; a stored custom theme is kept byte for byte; an unknown value is left in place; saved theme create, rename, cancel-delete and confirm-delete through the real controls; arrow keys and focus outline; 375 and 320 px overflow; 44 px targets; the phone Add sheet. The scripts are scratch files and are not part of the repository.

## 16. Regressions discovered and corrections applied

1. **Derived-color mix direction (caught by existing tests before any picture):** the first version of `deriveExtras` mixed the soft and sunken surfaces, control border and Home panel the wrong way round (96% text instead of 4%), so custom themes would have drawn near-black fills. The D6 "tones" test failed (2.6:1); corrected, and the adapter is now covered by 42 dedicated tests.
2. **Chart series (my own new test):** four palettes' first-draft series 1 to 4 were too close together or under 3:1 on cards. Re-tuned and re-measured.
3. **Palette cards were centred vertically** (a button default), so a card with a longer description moved its picture up; fixed (`justify-content: flex-start`) and confirmed in the screenshot.
4. **Preview shapes used raw pixel radii and a raw font size** (the residue report moved above its baseline); switched to tokens, back below baseline.
5. **Superseded guards (not relaxed; each replaced):** see section 16a.
6. **Layout growth found by the browser check:** the chosen palette card had a 2 px border (others 1 px), so choosing a palette made that card, and the Appearance page, 2 px taller. Changed to an inset ring (no size change); confirmed by re-running the check.
7. **Test-script flaws, not app defects:** my first browser run flagged four checks that were wrong in the script (a remembered "last module" key written while navigating, an unsettled page height, a hash-only reload, a wrong starting card for the arrow-key test). Fixed and re-run; results in section 14.

### 16a. Superseded rules (prior rule, approved new requirement, replacement guard)

| Prior rule (file) | Approved new requirement | Replacement guard |
|---|---|---|
| "Older palettes are protected: every shared token defaults to the Classic value" (`d6Shared`, `signatureTokens`) | Signature is the interface for every palette | Same tokens pinned at their Signature values in the stylesheet; no palette may set one (`d6Shared`, `d211Palettes`) |
| "Only Signature changes the header / the navigation bar" (`d7Header`, `d8LedgerNav`) | Signature header and navigation for every palette | Defaults pinned (62/60 px, 46 px + icons); no palette may set a header or navigation token |
| "The look is Signature-only and Classic is unchanged" for Home (`d12Home`, `d12HomeComposition`) | Signature Home for every palette | Every palette sets the whole hero, spending and category set; hero ramp present for all five |
| "A device with nothing saved gets Classic; choosing Classic stores nothing; manifest and bar are Classic's" (`d21Appearance`) | Signature Navy default; explicit storage | Rewritten for the new model, including the old-format copy being ignored |
| "Stylesheet colors read from `styles.css`" (`stS3Contrast`) | Default colors live in `palette-base.css` | Same pairs, read from there; one pair uses the text tone on the accent tint as every chip does |
| Four older presets measured as palettes (several contrast tests) | They no longer exist | They are measured as stored custom themes through the adapter (`legacyFixtures`) |

**Informational residue report (`uiResidue`):** it never fails, and four counts read above the D5 baseline. Hex colors in CSS: 322 vs 152, because the default palette moved from `styles.css` to `palette-base.css` (about 170 declarations in three scopes, the one intended home of color values); hex in module CSS fell to 41 (baseline 56). Inline styles and raw font sizes are unchanged by this phase. Raw border radii are 64, below the baseline of 67. No baseline was edited.

## 17. Remaining owner decisions

1. **Approve the mapping** (Calm teal and Forest green to Evergreen; Slate and indigo to Coastal Slate; Deep navy and gold and the earlier Signature to Signature Navy). Anyone on the old four presets will see a different palette once; their saved themes are unaffected.
2. **Approve the working values** that differ from the starting colors (darker link colors, shared status colors, Signature Navy's primary kept at `#0E1A33`).
3. **Calendar out-of-month chips: RESOLVED in section 21** (opacity removed from out-of-month chips, reminders and the projected mark; calendar CSS only; 0 failing text elements in all palettes and modes).
4. **Custom-theme remedy:** build the "Fix automatically" proposal (section 9)?
5. **Installed-app colors:** the manifest now uses Signature Navy's canvas for the splash and bar; confirm.
6. **Acceptance:** nothing is `ACC`. Real-device, screen-reader, forced-colors and Safari/Firefox checks are still needed.
7. Still open from D21 (unchanged, not authorized here): the three native `alert()` calls and the non-atomic financial writes NC-18, NC-19 and NC-22.

## 18. Known limitations

- Chromium only, at emulated widths; not a real phone; no screen reader; no forced-colors check.
- One-time first-load flash of Signature Navy on a device that had a non-default palette (section 8).
- Dead `var(--x, old)` fallbacks remain in many rules and the `--ui-glyph-legacy` markup still exists (hidden); removing them is separate cleanup.
- Fixed status colors outside the palette system remain by design: two Bills border colors (`#c9892b`, `#4b7bb5`) and the sync-chip dots keep their meaning in every palette.
- The palette pictures show shapes, not words, and use the palette variables directly; they will not show a derived-variable change until the picture is updated.
- The contrast sweep estimates the background behind text through ancestors and skips gradients and images; it is a screen, not a certificate.

## 19. Recommended release verdict

**APPROVED FOR RELEASE by the owner and ChatGPT (2026-11-14), after ChatGPT's implementation and visual review.** The Calendar contrast issue (section 17, decision 3) is resolved by the final correction in section 21 and that correction is accepted; no further design or functional change was requested. Decisions 1 and 2 (palette mapping, adjusted working colors) are accepted with the approval. The default flip, the architecture change and the migration are verified by unit tests (full suite: 289 files, 5,680 tests), a full pixel comparison against the approved Signature, and live checks of the transition, saved themes, keyboard and phone widths.

**Release acceptance limitations (unchanged, not claimed):** nothing is `ACC` in the coverage tracker; no real-device, screen-reader, forced-colors, Safari or Firefox testing was done; the deferred custom-theme "Fix automatically" proposal, native `alert()` replacements and financial transaction atomicity (NC-18, 19, 22) remain separate unauthorized work. **Next phase: R0, Product Assessment and Strategic Roadmap (not started by this release).**

## 20. No commit, push or deployment

**No `git add`, `git commit`, `git push` or deployment was run.** The only git commands used were `status`, `diff`, `log`, `fetch` and `rev-parse` (read-only apart from `fetch`). All changes are in the working tree, together with the three protected untracked files exactly as they were.

## 21. Final accessibility correction and review package (added after technical review)

**Scope:** only the Calendar chip contrast finding from section 17, decision 3. No palette, token, financial, schema, preference, backup, sync, migration, navigation or architecture change.

**Cause:** days outside the month were de-emphasised by `opacity: 0.85` on the whole chip, reminders by `0.78` (chips) and `0.8` (agenda rows), and the projected mark by `0.7`. Opacity multiplies every text color, so small time and priority marks fell to 3.2 to 4.5:1 (also in Signature Navy Light, which is why the earlier report called it pre-existing).

**Rules changed (all in `src/modules/calendar/calendar.css`, nothing else):**

| Rule | Before | After |
|---|---|---|
| `.cal-cell.out .cal-chip` | `opacity: 0.85` | no opacity; `background: color-mix(in srgb, var(--chip) 8%, var(--surface-sunken)); color: var(--fg-2)` |
| `.cal-chip.p-reminder` | `opacity: 0.78` | no opacity; `color: var(--fg-2)` (dotted edge, italic, 7% fill and weight 400 unchanged) |
| `.cal-row.p-reminder` (agenda) | `opacity: 0.8` | no opacity; `color: var(--fg-2)` (italic unchanged) |
| `.cal-chip-proj` (the projected mark) | `opacity: 0.7` | no opacity |

Unchanged on purpose: chip edge colors, edge styles and widths, priority shapes, `.cal-chip.done` (0.6, strike-through carries the meaning), all event data, controls and behavior. The out-of-month cell keeps its sunken fill and quiet day number, so in-month and out-of-month stay clearly different (see the before and after images). Non-text indicators (edge colors) are untouched.

**Measured before and after** (real Chromium, Calendar page, every visible text element against its effective background; the disabled "Today" button at 50% opacity is exempt and excluded; same demo household; both runs on this build):

| | Before | After |
|---|---|---|
| Text elements below 4.5:1, 1440 px, Light, each of 5 palettes | 8 to 9 (lowest 3.71 Navy, 3.75 Slate, 3.81 Evergreen, 3.98 Stone, 4.19 Plum; also "Tasks" label 3.87 to 4.39) | **0** |
| Same, Dark | 0 (Navy, Slate, Evergreen), 7 Stone, 6 Plum (lowest 4.24 to 4.34) | **0** |
| Same, 375 px, Light and Dark | 3 to 4 in 7 of 10 combinations (lowest 3.87 to 4.44) | **0** |

The full per-palette, per-mode table is in the review package. In all 20 combinations (5 palettes x Light/Dark x 1440/375) the only remaining flagged element is the disabled "Today" button.

**Tests:** new `src/modules/calendar/d211CalendarContrast.test.ts` (13 tests): the four rules carry no opacity, out-of-month chips keep their edge and use fill and text color, `.done` is unchanged, and chip text pairs (secondary and quiet text on out-of-month, in-month and reminder fills, for the eight layer colors and each palette accent) are at least 4.5:1 for all five palettes in Light and Dark. Final run: **289 files, 5,680 tests pass** (was 288 / 5,667); `tsc` clean; production build passes.

**Review package:** `Documents\Ledger-Design-Concepts\D21.1-Evidence\D21.1-review-package.zip` (6.4 MB; the same content unzipped in `review-package\`: `index.html` plus an `img` folder of 100 images; extraction was tested and all 200 references resolve). It contains Today and Ledger Home in all five palettes, Light and Dark, at 1440 and 375 px; Settings > Appearance in all five palettes, Light and Dark, at 1440 and 375 px; and Calendar before and after for all five palettes, Light and Dark, at 1440 and 375 px, with the measured table. The earlier `sheet.html` evidence is preserved unchanged; its images are in the same folder tree, so share the ZIP, not the sheet.

**Still not done:** real device, screen reader, forced colors, Safari and Firefox; owner acceptance. The deferred custom-theme fixer, native `alert()` replacements and financial transaction atomicity are untouched.
