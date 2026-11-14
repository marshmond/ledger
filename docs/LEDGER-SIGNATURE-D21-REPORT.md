# Ledger Signature D21: finishing, default transition and release readiness (implementation report)

Date: 2026-11-13. Status: **BUILT AND TESTED LOCALLY; UNCOMMITTED, NOT STAGED, NOT PUSHED, NOT DEPLOYED. Awaiting owner and ChatGPT review. D21 is NOT complete and Ledger Signature is NOT accepted.**

## 1. Executive summary and actual implementation status

D21 was run as a finishing and verification phase. What was actually done:

| Workstream | Result |
|---|---|
| **A. Signature becomes the default** | **NOT done, on purpose.** A Classic choice is stored as *nothing* in this browser, so "chose Classic" and "never chose anything" cannot be told apart. Flipping the default would silently change the look on every device that is on Classic today. The brief says to stop that change and ask the owner. Section 5 sets out the evidence and four options. Today's behavior is now pinned by tests. |
| **B. Browser and shell finishing** | **Built:** the browser-bar colour is set from the saved Light/Dark and palette *before first paint*. **Reviewed, no change needed:** header, switcher, navigation, search and Add entry points, toasts, dialogs, page-error recovery (no defect found in the checks in section 11). |
| **C. Visual consistency** | Two small corrections from the sweep (one real page-width bug, 18 unnamed fields). A look at about ten screens (section 8). **No full 59-page visual review was done**; that is stated plainly in sections 8 and 17. |
| **D. Accessibility and responsiveness** | A scripted sweep of all 50 static routes and 20 dynamic addresses across six widths and three appearances (section 10), two real-key keyboard checks (section 11). No real phone, screen reader, forced-colors or Safari/Firefox testing. |
| **E. Coverage and readiness** | Tracker updated (S-20 only changed status). Readiness assessment in section 17. Nothing is `ACC`. |

**Recommendation: ready for owner review of the four small changes; D21 as a phase is NOT finished.** A follow-up **D21.x** is recommended (section 18): the default decision, an owner visual pass, and real-device and screen-reader checks.

## 2. Baseline Git commit, deployment and working-tree verification

- Branch `main`. After `git fetch`: `HEAD` = `origin/main` = **`21a20a144d3f81c15ab95090b485f6241abf1401`** (`feat(ui): complete native confirmation migration`, committed 2026-11-13 16:33 -0500).
- GitHub Actions, read from the public API (`gh` is not installed): run **#113** "Deploy to GitHub Pages", head `21a20a1…`, `completed` / `success`. Runs #112 (`e24407b`) and #111 (`ff39a9a`) also `success`.
- Working tree at the start: only the three protected untracked files (`docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`), the same three the D20.1B report lists as protected. Nothing staged, nothing modified. They were not touched, staged or used by any change.
- Baseline test run on this exact tree, before any change: **285 files, 5,457 tests, all passed** (164 s).

## 3. D20.1B prerequisite verification

- D20.1B is **committed** (`21a20a1`, "approved for release by owner and ChatGPT" in the handoff) and **deployed** (run #113 success). The handoff and backlog still say "SHA and CI result recorded in the next change"; this report and the handoff update now record them.
- Pending D20.1 batches: none found. The inventory reads 38 migrated, 0 native `confirm()` remaining. The backlog's older "NOT built: D20.1B, C, D" line is historical and superseded.
- Recorded follow-ups still open (not touched, not part of D21): NC-18, 19 and 22 still run as two separate writes without a transaction; three native `alert()` calls remain (`src/pages/CategoriesPage.tsx:90`, `src/modules/bills/quickAddDef.ts:128`, `src/modules/services/quickAddDef.ts:75`); CF-03 awaits owner acceptance.
- Documents read: the handoff (status lines and the D20.1B notice), the coverage tracker (all of it that matters here), the D4 roadmap, design system, open decisions and coverage files, the D20.1B report, and the palette, theme, backup and device-preference code. **Not read in full:** the D5, D6, D7, D19, D20 and D20.1A reports (read only through their tracker summaries and the sections the tracker cites).

## 4. Files changed and why

| File | Why |
|---|---|
| `index.html` | New small inline script after the theme-color meta tag: sets the bar colour before first paint (section 7). The build's content-security hashes pick it up automatically (checked: all three inline scripts are covered in `dist/index.html`). |
| `src/pages/analysis.css` | `.an-tablewrap` gets `position: relative`. Screen-reader-only text inside the wide "Compare people" table was positioned against the page, escaped the table's scroll box and made the whole Income page 1033 px wide at 800 to 1024 px windows. |
| `src/pages/ProfileEditor.tsx` | Income "Deductions" table: wrapped in the shared scroll box (it was 837 px wide at an 800 px window), and its name, "how it is figured" and amount fields got spoken names (they had none). No handler or stored value changed. |
| `src/pages/PayoffPage.tsx` | The "Minimum / month" field of each card had no spoken name; added one that names the card. |
| `src/shell/d21Appearance.test.ts` (new) | Runs the real inline script against fake storage (15 cases of mode, palette and storage) and pins how the default appearance works today. |
| `src/shell/d21Polish.test.ts` (new) | Source guards for the three small corrections. |
| `src/shell/uiCoverage.test.ts` | The guard lists exactly which tracker rows are beyond NS; S-20 was added to that list (and a comment) because S-20 is now `BLT`. No rule or baseline was weakened. |
| `docs/UI-COVERAGE.md`, `docs/CHATGPT-HANDOFF.md`, `docs/BACKLOG.md` | Status and evidence. The tracker's first line also lost a stray "BLT |BLT |…" prefix left by an earlier edit. |

**Not touched:** calculation engines, tax tables, `src/db.ts` and migrations, backup format, sync, recurrence code, service worker, manifest, `THEME_COLOR`, the palettes, `package.json`, confirmation workflows, navigation, shared `Modal` and `ConfirmDialog`, the three protected files.

## 5. Signature default-selection behavior before and after

### Before (verified, and now pinned by `d21Appearance.test.ts`)

- Storage: `ledger-palette` and `ledger-palette-vars` in this browser (`localStorage`). Light/Dark is separate (`ledger-theme`; "Device" stores nothing).
- A device with **nothing saved** gets **Classic** (`DEFAULT_CHOICE = classic`).
- **Choosing Classic stores nothing**: `savePalette({id:'classic'})` removes both keys. I confirmed it through the real Settings > Appearance click on the demo browser (`ledger-palette` was `null` afterwards). So a device that deliberately chose Classic has exactly the same storage as a device that never chose.
- Signature and every other preset store `{id}`; custom colors store the exact values plus the saved-theme link. An unreadable or unknown stored value falls back to Classic.
- **Not synced:** `src/lib/devicePrefs.ts` lists palette and mode as "this device only", so sync cannot overwrite them. **Backup:** `collectPreferences` writes a key only if present, so a backup from a Classic device carries *no* palette; restoring never clears the receiving device's own choice (tested).

### After (what D21 changed)

Nothing about the default. **Fresh install: still Classic. Existing explicit Signature, other presets, custom colors, Light/Dark: unchanged** (tests and live clicks).

### Why the flip was stopped

A flip needs a way to tell "never chose" from "chose Classic". There is none today. Changing the default would move every Classic device (the owner's, and any restored or synced-in device) to Signature with no way to know who wanted that, and a backup made on a Classic device would restore as Signature on a fresh device. The brief forbids converting implicit Classic without an explicit owner decision.

### Options for the owner (recommendation first)

| | Option | What it takes | Risk |
|---|---|---|---|
| **C** | **Two steps (recommended).** Step 1: Classic is saved explicitly from now on (`{id:'classic'}`), and on first load a device that already has Ledger data or saved preferences is pinned to its current look. Step 2, a later release after the owner has opened each device: Signature becomes the default for devices with no saved choice. | Small palette change, tests for fresh, explicit Classic, explicit Signature, other presets, custom, corrupt storage, restore from old and new backups. No schema or backup-format change. | A device never opened between the two releases is not pinned and flips. For a single owner with few devices, that is checkable by hand. |
| A | Keep Classic as the default; Signature stays a choice. | Nothing. | None; the redesigned app is shown only to people who pick it. |
| B | Flip now for everything with nothing saved, and save Classic explicitly from now on. | Smallest change. | Every device on implicit Classic changes look once; the owner re-picks Classic where wanted. |
| D | Flip only when the device "looks new" (no Ledger data, no other saved preference). | Small. | A guess. A restored device or a cleared browser looks new. Not recommended. |

If B or C is chosen, the static fallbacks (`THEME_COLOR`, the meta tag, the manifest colours) should become Signature's at the same time; today they are deliberately Classic's.

## 6. Saved-preference preservation evidence

- `d21Appearance.test.ts` (15 cases): Classic by default; Classic stores nothing; every preset round-trips; custom colors round-trip exactly with their saved-theme link; garbage, unknown and half-formed stored values give Classic; unavailable storage gives Classic and never throws; backup and restore keep the device's choice; palette and Light/Dark are stored apart.
- Live, demo browser: Signature dark was the starting state; switching Classic, Signature and Light/Dark through the UI and through the app's own functions left storage exactly as the unit tests predict; the state was restored to Signature dark at the end.
- Reload and navigation persistence: the sweep reloaded nothing, but hash navigation across 70 addresses kept the palette and mode throughout; the Income edit needed a reload and the palette survived it. A dedicated reload test was not run beyond that.
- Not applicable this time (nothing changed): writes on load, migrations, resets. The new script only reads storage (a test forbids `setItem`, `removeItem` and `clear`).

## 7. Browser theme-color implementation and limitations

- **Before:** the static tag said Classic blue for everyone until the app's JavaScript ran, then `applyTheme` set the right value. A Signature device or a dark device saw the wrong bar colour for the first moments of every load.
- **After:** a script after the meta tag reads `ledger-theme` and `ledger-palette-vars` (read only), works out light or dark (a forced mode wins; "Device" follows `prefers-color-scheme`), and sets the tag to the palette's `--page` colour, or Classic's blue (light) or dark grey (dark) when there is no palette or the stored value is not a valid colour. `src/theme.ts` still keeps it in sync after load. One attribute write, no layout, no viewport or safe-area change.
- **Values verified** (live, and in tests): Signature light `#EEF1F6`, Signature dark `#0B1220`, Classic light `#1f6feb`, Classic dark `#12151a`; every other preset and a custom palette use their own page colour; forced mode beats the device setting; broken storage falls back to Classic without an error.
- **Choice made:** Signature uses its canvas colour (what the code already did after load), not navy. The D4 note said "navy"; the Signature header is the canvas colour in both themes, so navy would make the toolbar differ from the header. Easy to change; listed as an owner decision.
- **Static values unchanged:** `THEME_COLOR` (`#1f6feb` / `#12151a`), the static meta tag and `manifest.webmanifest` (`theme_color` `#1f6feb`, `background_color` `#ffffff`) stay Classic's, because the default look has not changed. A test pins that the script's fallbacks equal `THEME_COLOR`.
- **Limitations (UNVERIFIED in real browsers; I only verified the value written):** browsers differ in how, and whether, they apply a changed `theme-color` after load (it is a hint); desktop Firefox ignores it; an installed home-screen app takes its splash and title colour from the manifest, which cannot follow the palette; `apple-mobile-web-app-status-bar-style` is unchanged (`default`). No real phone was available.

## 8. Visual consistency findings and corrections

What I looked at: about ten screens as pictures (Today, Tasks, Family, Household Finances and Ledger Home in Signature light at 1440; Transactions in dark at 1440; Today, Transactions and Income in dark at 375; Income's wide table at 800), plus the numbers the sweep collected for every page. **That is not a systematic review of all 59 pages in both themes and both widths**, and I did not look at pictures of the 20 dynamic addresses, Classic or the other presets.

Corrections made (clear, small, no layout or workflow change):
1. **Income page widened by its own table at 800 to 1024 px** (page 1033 px wide at an 800 px window, a sideways scroll bar on the whole page). Cause and fix in section 4. After the fix the page is 785 px wide (window less scroll bar) and the table scrolls inside its own box (picture `fix-income-compare-dark-800.jpg`).
2. **Income Deductions table 837 px wide in an 800 px window**: now inside the shared scroll box.
3. **18 form fields had no spoken name** (Income: name, "% of gross / $ fixed" and amount for each deduction; Debt payoff: card minimum payment).

Findings **not** changed (need an owner look or a decision):
- The Income Deductions rows still use the older plain table and inputs rather than the D18 table pattern. By reading the code, not by comparing pictures; it is likely visible residue.
- Three native `alert()` messages remain (section 3). Functional follow-up, not D21.
- Touch targets under 32 px in an emulated phone: row checkboxes (24 px), Tasks "Mark done" (28 px), Categories "Move up/down" (19 px tall). The app already makes `button.link` 44 px on real touch screens (`@media (pointer: coarse)`, `src/styles.css:97`), and this pane uses a mouse pointer, so the link-button cases may already be fine on a phone. Checkboxes and the round "Mark done" button are not covered by that rule. Needs a real phone before anyone changes it.
- One transient focus event outside the Search dialog was logged between Tab presses while the focus trap kept working and Escape restored focus. Not investigated further.
- Nothing seen contradicted the earlier phases' recorded design assessments, but I did not re-measure them.

## 9. Prototype comparisons

`C:\Users\alexm\Documents\Ledger-Design-Concepts\D21-Evidence\sheet.html` puts the approved prototype picture beside the final screen at the same display width for **five pages**: Today (D3.1), Ledger Home and Family overview (D3.2), Household Finances and Tasks (D3.3). Final pictures are 800-px-wide captures of a 1440 viewport, so they are coarse. **I composed the sheet but could not view it rendered** (the browser tool cannot screenshot local files), so I make no fidelity claim from it; the percentages recorded in earlier phase reports (for example Today about 70 to 75 percent, D11 section 19, before the D13.1 refinement) are unchanged and were not re-measured. Pages with no D3 prototype (everything under Ledger Money, Invest, Plan, More, Settings, Services, Bills, Contacts, Calendar and the dialogs) were not compared against anything.

## 10. Responsive testing matrix

Method: a script, run in the built-in browser against the invented household, opened each address and measured: page wider than the window, any element past the right edge outside a scroll box, number of visible `h1`, buttons/links without a name, fields without a label, an error banner, empty page. The viewport was emulated by the pane. **This is measurement, not a visual or touch test.**

Static routes (50: every static address in the tracker, plus `/ledger/taxpackage` and `/ledger/sync`):

| Width | Signature dark | Signature light | Classic light | Classic dark |
|---|---|---|---|---|
| 1440 | pass | pass | not run | not run |
| 1024 | **Income failed (9 px)**, others pass | not run | not run | not run |
| 800 | **Income failed (page 1033 px)**, others pass | pass | pass | not run |
| 640 | pass | not run | not run | not run |
| 375 | pass | pass | pass | pass |
| 320 | pass | pass | not run | not run |

Dynamic addresses (20, covering `projects/:id`, `assets/:id`, `services/a/:id`, `services/providers/:contactId`, `services/v/:id`, `bills/o/:id`, `family/m/:id`, `contacts/c/:id`, `ledger/account/:id`): Signature light 320, Signature dark 375, 800 and 1440: all pass.

"Pass" means: no sideways page scroll, exactly one visible `h1`, no unnamed button or link, no unlabeled field, no error banner, not empty. The two Income failures were fixed; Income at 800 was re-measured after the fix (785 px) and the later Signature light and Classic runs include it. **Income at 1024 was not re-measured after the fix.** The first sweeps' summaries did not list unlabeled fields (the script was updated afterwards); every run after the fix does, and all read clean.

Not covered: long titles, very large dollar figures, empty states and dense records as test inputs (only the demo data was used), landscape phones, 600 to 900 px beyond the 640 and 800 points, any real device. Modals and the phone sheet were not re-checked this phase (D20 recorded them).

## 11. Accessibility and keyboard verification results

Actually tested:
- **Real key presses (1440, Signature dark), Today:** 14 Tab stops. Every stop had a visible 2 px solid outline, in top-to-bottom order, scrolled into view. Not a complete tab-order audit of any page.
- **Search dialog, real keys:** opened with Enter on its button, six Tabs stayed inside (cycling between the field and Close), Escape closed it, focus returned to the Search button.
- **Scripted:** one `h1` per page; every button and link has a name; every visible field has a label or `aria-label` (after the 18 fixes) across the matrix above.
- **Static review only:** `prefers-reduced-motion` has a global rule that removes transitions and animations (`src/styles.css:528`) and a second for the sync dot; forced-colors rules exist in seven stylesheets. Neither was exercised in a browser.

**Not tested:** screen readers (none available; no claim of any kind), real phone touch targets and on-screen keyboard, forced-colors mode, reduced motion in a browser, contrast measurement for this phase (earlier phases' contrast tests still pass), nested-dialog Escape and focus restoration beyond the Search case (D20.1B recorded its own checks), Safari, Firefox.

## 12. Functional and financial regression results

- **Automated:** the full suite passes (section 13). It includes the existing golden-master, backup/restore, sync, calendar-projection, Services (rolling 12 months, one next Task), Contacts/Family (no automatic merges, colours and "This is me"), and money tests. D21 touched no calculation, tax, schema, backup, sync or recurrence file, so no financial figure or semantic can have changed through these edits; the only production changes are one HTML script, one CSS rule, three field attributes and one wrapper element.
- **In the browser:** Search (open, close, focus), theme and palette switching through Settings > Appearance, and 70 pages opening without an error banner. **Not clicked this phase:** Quick Add, Today and Tasks actions, Calendar, Family and Contacts edits, Services, Bills, Projects and Assets, transactions and budget, payroll and income edits, investments, debt, tax and retirement, backup and restore, sync, the confirmation and delete workflows. Their coverage this phase is the automated suite only. No before/after comparison of displayed amounts was needed (no financial presentation changed).

## 13. Exact commands run, test counts and failures

| Command | Result |
|---|---|
| `git branch`, `git rev-parse HEAD origin/main`, `git fetch origin`, `git status --short`, `git log` | as section 2 |
| `curl https://api.github.com/repos/marshmond/ledger/actions/runs` | run #113 success |
| `npx vitest run` (baseline, before any change) | 285 files, 5,457 tests passed |
| `npx vitest run src/shell/d21Appearance.test.ts src/theme.test.ts src/palette.test.ts src/shell/signatureTokens.test.ts` | 4 files, 103 tests passed |
| `npx vitest run src/shell/d21Polish.test.ts` | 5 passed |
| `npx tsc --noEmit` | no output (clean) |
| `npm run build` | built (the usual large-chunk warning only) |
| `npx vitest run` (final) | 287 files, 5,477 tests passed (the first full run after the changes failed exactly one test, the tracker guard that lists which rows are beyond NS; S-20 was added to that list deliberately and the suite was re-run) |

Failures: none. New tests: 20 (15 appearance and bar-colour, 5 polish); one existing guard list (`uiCoverage.test.ts`) gained S-20. Two dev servers were used: the owner's on 5173 was not touched; the demo server on 5231 was started by this session (stopped at the end, by its own process id).

## 14. Known limitations and unresolved issues

- The Signature default is not switched (section 5).
- Browser-bar behavior is unverified in any real browser; the manifest and install splash stay Classic.
- No real-device, screen-reader, forced-colors, reduced-motion-in-browser, Safari or Firefox evidence for anything.
- The visual review was about ten screens, not the full inventory; Classic and the other presets were measured, not looked at.
- Income at 1024 not re-measured after the fix; touch-target question open; Income Deductions older table style; three native `alert()` calls; NC-18/19/22 without transactions.
- Older follow-ups reviewed and classified (not implemented): see section 17.

## 15. Owner decisions required

1. **Default appearance strategy** (section 5): A, B, C (recommended) or D.
2. **Browser-bar colour for Signature:** keep the canvas colour (built) or use navy as the D4 note says.
3. **Native `alert()` calls and the NC-18/19/22 transactions:** a separate functional phase, or leave.
4. **Touch targets for row checkboxes and Tasks "Mark done"** (24 and 28 px): wait for a real phone check, or enlarge now.
5. **How real-device and screen-reader acceptance will be done** (who, which phone, which reader). Nothing can become `ACC` without it.

## 16. Coverage tracker updates

`docs/UI-COVERAGE.md`: S-20 `NS` to `BLT` with `L`, `D`, `Func` only; a D21 status paragraph; S-20 note; new section 1.18 with the sweep and keyboard evidence; stray prefix on line 1 removed. **Roll-up unchanged** (59, 23, 31, 63, 37 totals; 0 accepted). No other row's marks changed: a script is not a visual check, and two keyboard checks are not a per-row walk. The tracker's own goal (59/59, 23/23, 31/31 accepted) is **far from met**: nothing is `ACC`.

## 17. Release-blocker assessment

1. **Release blockers (for deploying these four changes):** none found. Type check, build and the full suite pass. This is *technical* readiness only.
2. **Important nonblocking findings:** the default decision; Income Deductions table style; touch targets (needs a phone); bar colour unverified on real browsers.
3. **Deferred functional improvements (not D21):** native `alert()` ×3; transactions for NC-18/19/22 and deleting an account's tax lots (NC-19); "Replace your colors" select shows no pending palette; focus after a delete removes its opener; earlier reports' follow-ups (Today two-column composition was refined in D13.1; others unchanged).
4. **Owner decisions required:** section 15.
5. **Unverified acceptance areas:** every row's owner acceptance; real devices; screen readers; forced colors; reduced motion; Safari and Firefox; contrast re-measurement; the full 59-page, two-theme, two-width visual pass; prototype fidelity beyond earlier reports; Classic and the other presets visually.
6. **Recommended post-Signature backlog:** see section 18.

Old follow-up classification (none implemented here): *appropriate for D21* — bar colour (done), 320 and tablet range (measured); *requires owner decision* — default flip, navy bar; *functional work outside D21* — alerts, NC transactions; *accepted limitation* — manifest colours cannot follow palette; *deferred verification* — everything real-device.

**Distinguishing the two kinds of readiness:** the code is technically deployable. Design and accessibility acceptance is **not** achieved and cannot be claimed.

## 18. Recommended next steps

**D21.x (recommended before calling the redesign finished):**
1. Owner decision on the default (section 5); if C, build step 1 with the tests listed there.
2. Owner visual pass over the pages in both themes at phone and desktop width using the demo household (or a guided sheet of pictures I produce), recording `ACC` per row.
3. A real-phone session (touch targets, on-screen keyboard, bar colour, install splash) and a screen-reader session on the five most-used pages.
4. A forced-colors and reduced-motion check in a browser; contrast measurement for Signature in both modes.
5. Decide the Income Deductions table restyle and the touch-target question from what the phone shows.

Then, separately: the `alert()` replacement and the NC-18/19/22 transactions.

## 19. Explicit confirmation

**No file was staged, committed, pushed or deployed. No repository was created, no configuration changed. No dependency was added.** The working tree holds the changes listed in section 4 plus the three protected untracked files, untouched. `docs/CHATGPT-HANDOFF.md` **was updated** (D21 status line, current phase, change log; unknowns: no D21 commit SHA or CI result exists). Evidence: `C:\Users\alexm\Documents\Ledger-Design-Concepts\D21-Evidence\` (`sheet.html`, `_raw\` ten captures, `prototypes\` five copies).
