# Ledger Signature D12 refinement: design integrity (2026-11-12)

**Status: built and tested locally. Uncommitted, not staged, not pushed, not deployed. Awaiting owner and ChatGPT review. Not tested on a real phone or with a screen reader. D13 is not started.**

> **Mobile header correction (same day): see section 24** (the Home heading is compact on a phone).
>
> **Final mobile fidelity correction (same day): see section 23** (the phone now shows net worth and the month as two cards).
>
> **Final visual fidelity pass (same day): see section 22.** It adds the hero Assets and Owed figures, the two-bar own-and-owe section, the segmented check-in bar and a panel divider, and records why spending and budget stay two panels. Where sections 6, 7, 19 and 20 differ from section 22, section 22 is current.

The owner's instruction for this pass: the approved prototypes are the visual targets, preserving the old layout is not a goal, and a well-designed default matters more than an unrestricted dashboard builder. This pass therefore rebuilds the **composition** of Ledger Home (not only its colors), corrects the Family task wording, and checks the net-worth trend chart with fictional saved history. Observed facts and my own judgments are kept apart.

## 1. Repository baseline

- Repository `marshmond/ledger`, branch `main`. After `git fetch`: `HEAD` = `origin/main` = `6a6de3930965caef3d2eacf2a637f843d74f5bd5` (the D11 release, unchanged since the first D12 pass).
- Working tree: the first D12 pass (uncommitted, see section 2) plus the three pre-existing untracked files, which were not opened for edit, staged or deleted.
- No branch, remote or repository was created; no dependency added; nothing staged, committed, pushed or deployed.

## 2. Was the first D12 still uncommitted?

**Yes.** It was never committed or released, so this refinement continues the same uncommitted change set against `6a6de39`. No history was rewritten.

## 3. Prototypes reviewed

D3.2 Ledger Home (desktop and mobile pictures, report), D3.2 Family, D3.3 Household Finances, D3.1 and D3.4 (as context), the D4 blueprint, the first D12 report, handoff, backlog and tracker. The approved pictures were copied unchanged into the evidence folder as the reference; nothing was altered to make the result look closer.

## 4. What was wrong with the first D12 Ledger Home (candid)

It improved colors, typography, bars, charts and the net-worth card, but it **kept the old independent-card grid**: the net-worth card was a half-width card beside Needs attention, Spending by category and Budget progress were two separate cards, every other card was the same size and weight, and the page read as an undifferentiated grid. My own estimate then was 65 to 70 percent fidelity, and I called the missing composition "a layout-model change" that I did not make. That was the wrong priority for this owner: preserving the card-grid customization came before the approved design. This pass reverses the order.

## 5. Exact architectural and layout changes

- **New pure layout model** `src/lib/homeSections.ts` (12 tests): seven *sections* in two columns, stored under a new key `ledger.home.layout.v2` as `{primary, side, hidden}`. The old card list (`homeLayout.ts`, `ledger.home.layout.v1`) is **not edited** and is only read.
- **`HomePage.tsx` rewritten around the sections.** Every provider and figure is the same as before (`spendingSnapshot`, `spendingSlices`, `budgetBars`, `monthlyFlow`, `loadNetWorth`, `changeOver`, `useLedgerAlerts`, `netWorthBars`). No second calculation layer, no duplicate loading.
- **New `HomeHero.tsx`**: the full-width top panel (section 6).
- **`home.css` rewritten** for the new structure (tokens only: no hex, no priority override, no new font).
- **`charts.tsx`:** the Income vs spending chart now draws at the card's real width (like the net-worth chart) so it does not balloon in the wide column; the net-worth chart's bar colors read optional local variables so they can use a light ramp on the dark panel. **No chart calculation or data format changed.**
- **`palette.ts`:** five more Signature-only chart colors (`--viz-hc1..5`) for the dark panel; Classic and the other presets are unchanged.
- **Family:** `ResponsibilitiesSection` is now `RelatedTasksSection` (section 12).

## 6. The financial hero

One full-width navy panel (a lighter navy in dark mode; a plain card under Classic and the older presets), in two panes:

- **Left:** "Net worth" with its History link, the figure at 48 px, the "Up or Down ... since <date>" line (from `changeOver`), then either the trend chart (two or more saved months) or the dotted "trend line appears once a couple of months of history have been saved" note.
- **Right:** the month name with its Budget link, then **Income, Spent and Ready to assign** as three large figures, then two slim bars (each is that figure's share of the larger of income and spent: the drawing the page always had; they carry their own names and values for assistive technology). "Spent" shows the words "More than income" when it exceeds income; "Ready to assign" is absent when there is no budget (never zero) and is marked when negative.

Not in the hero, deliberately: the prototype's **Assets and Owed chips** (net worth is not always assets minus owed, because the page leaves negative balances out of the assets ring), **"Spent 67 percent of income so far"** and **"Income less spending"** (new derived figures, not authorized). The panel is effective without them.

## 7. Spending and budget composition

One card, "Spending & budget", with two internal panels under shared headings: **Spending by category** (the existing ring and legend, link to Reports) and **Budget progress** (the existing bars with "Over budget" in words, link to Budget). Each panel keeps its own data provider, empty words and link. Side by side from 1280 px (and from 700 to 999 px), stacked otherwise. The prototype goes one step further and joins them into a single table keyed by category; that would mean matching two category lists (spending slices include unbudgeted categories, budget rows are budgeted ones) inside the view, a join I judged to be a new calculation. Alternative for review: allow the join, shown only for categories present in both, with the remainder listed separately.

## 8. Desktop two-column structure

Below the hero: **Needs attention** (full width, alerts side by side), **Get started** (one slim row; steps behind "Show all steps"), then two columns at 5 : 3 (from 1000 px): the **analysis column** (Spending & budget, Income vs spending, What you own and owe) and the **supporting column** (Recent transactions, Monthly check-in, Coming up, Goals), whose cards are visibly quieter (smaller padding and titles). The order of the supporting sections follows the prototype (recent, check-in, coming up, goals). Measured in the browser at 1440: hero and strip are both 1,219 px wide; the columns are 747 and 448 px, side by side, tops aligned.

## 9. Mobile adaptation

One column in the prototype's order: hero (net worth, then the month, figures stacked as label and amount rows), Needs attention, Get started, then the analysis sections, then the supporting sections. Checked at 375 and 320 px (light and dark at 375): no horizontal overflow; seven-digit amounts and long names were tried (DOM text only) and wrap inside their rings and rows instead of spilling; phone link targets are 44 px or taller (Tab walk, section 16). The prototype shows net worth and the month as two separate cards on a phone; here they are one navy block with the two panes stacked.

## 10. Customization decisions

Priority order applied: (1) the designed default, (2) reordering, (3) hide and show, (4) resizing and add or remove. Result:
- **Kept:** moving a section up or down inside its column; hiding and showing a section; "Reset to default". Reordering and hiding survive a reload.
- **Fixed on purpose:** the hero (net worth and month), Needs attention and Get started. Sections stay in their own column; nothing is resized. There is no drag-and-drop framework and no layout state library.
- **Gone:** per-card widths, removing the net-worth, month, Needs attention or Get started cards, and moving Spending by category and Budget progress separately (they are one section now).
- **Tradeoff, plainly:** a saved arrangement can no longer express card widths or a hidden alert strip, and it cannot put a supporting card in the wide column. I judged that acceptable for the approved composition.

## 11. Handling of existing saved preferences

`ledger.home.layout.v1` is **never written, changed or deleted** (a test pins that the code never calls `setItem` or `removeItem` on it). When it holds a customized layout and nothing newer exists, the new arrangement is **derived in memory**: sections follow the old cards' order, a section none of whose cards were on the page is hidden, Spending by category and Budget progress become one section where the first of them was, widths are dropped. A visible one-time note says so, names what now always shows, offers "Use the new default" and "Dismiss" (its own key `ledger.home.layoutNotice.v2`). The first explicit change writes only the new key. **Edit Home** shows "Use my earlier arrangement again", which removes only the new key. Observed in the browser on a fictional profile with a customized v1 layout: the note appeared, nothing was written, the v1 value stayed byte for byte identical through dismiss, a hide, and the restore, and the derived order (Goals before Recent; analysis and cash flow kept; the rest hidden) came back. A fresh profile gets the designed default with no note. Real preferences were not accessed.

## 12. Family wording correction

The tasks section is now **"Related tasks"** (was "Responsibilities") and the page intro says tasks and events that name a contact **"are associated with them"** (was "belong to them"). Rows already said "Associated with:"; the section note still says Ledger does not record who has to do them. Only wording and the internal component name changed: filters, counts, links, member colors and all data are untouched. Tests: the F4 render test now expects "Related tasks"; `d12Family.test.tsx` gained a test that neither Family file contains "Responsibilit", "belong to them", "owned by", "must complete" or "assigned to". Browser: the filter still goes 4 to 1 (Charlie) and back to 4, titles still open the Task, names the member, D9 colors unchanged.

## 13. Net-worth trend chart with fictional saved history

Verified on the throwaway profile with six invented monthly snapshots (June to November 2026, ending at the page's current figures; added and removed again). Observed:
- **No history and one month:** the dotted note, no chart.
- **Six months, Signature light and dark:** the chart is drawn inside the hero's left pane on the dark ground (labels, grid, line, dots and legend in the panel's own light colors; stacked bars in a light ramp), clearly integrated; the "Up +$17,368.04 since 2026-06-01" line comes from the existing reader.
- **Accessible description:** "Assets and amounts owed by month, with net worth as a line. Latest Nov '26: assets $31,830.04, owed $572.00, net worth $31,258.04."; the chart is keyboard-focusable (`tabindex` 0), and the arrow keys step through months (two steps back from the latest month read September with its net worth and parts).
- **Existing chart behavior unchanged** (calculations and the snapshot format were not touched). One cosmetic limit already in that chart: when the owed amount is tiny beside the assets, the "$0" and the small negative tick label sit close together. It is the chart's own tick logic and was not changed.

## 14. Financial figures before and after

Against the pre-D12 baseline (same fictional profile, same day, snapshots absent): **31 of 31 money figures identical** (same multiset). Every labelled value matches (Net worth, Income, Spent, Ready to assign, each spending category, each budget row, Owed, Cash and the recent payees' amounts; the recent rows are compared by amount because their date became a tile). The hero's Net worth, Income, Spent and Ready to assign equal the baseline values; the chart labels carry the provider values (net worth, spending total, each of six months, assets). Each money figure is drawn once (the month figures only in the hero). Household Finances and Family figures were rechecked in focus (section 16).

## 15. Automated test results

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | exit 0 (only the existing "chunks larger than 500 kB" notice) |
| Targeted runs during the work | Family (460 tests), Home pages, `homeSections`, leak guard: all passing before the full run |
| Full suite, run once after the code settled | **258 files, 4,799 tests, all passed, 0 failed** (115.88 s; read from the log) |
| New | `homeSections.test.ts` 12 (sections, moving, hiding, the earlier layout carried over in memory, nothing written to the earlier key, restore), `d12HomeComposition.test.tsx` 10 (order of the page, the stylesheet's full-width and two-column rules, the one-card spending and budget, the top panel with its honest empty and missing states, the chart inside the dark panel), one Family wording test |
| Updated | `d12Home.test.tsx` (storage keys, titles and places of the earlier cards, the top panel), `family-f4-render.test.tsx` and `d12Family.test.tsx` (the section is "Related tasks"), `d12Household.test.tsx` untouched |
| Not changed | every financial, Household golden-master, B5 UI and guard test, and the theme, token and coverage guards (one mistake caught earlier by a guard: a hex color fallback in a new stylesheet; replaced by a variable) |

## 16. Browser verification

Headless Chrome on a throwaway profile (fictional D1 household, sync off), real clicks and key events (not a physical keyboard or phone). **39 of 39 checks pass on the final run** (`refinement-browser-verification.json`): numbers and labels, hero, strip, two columns, one-card spending and budget, default order, fresh profile, edit bars, reorder (saved only under the new key), hide, reload, Show, Reset, no information lost, customized v1 layout (note, derived order, nothing written, dismiss, hide writes only v2, restore), history none, one month and six months, chart label, legend, arrow-key reading, dark hero, phone order and no overflow, history cleaned up, Family wording, filter, links, colors, Household tiles equal the readers and Hide amounts, no console messages. Tab walks (both widths, three pages): every stop shows a focus indicator; phone links 44 px or taller. Widths 1440, 1024, 800, 375, 320 light; 1440 dark; 375 dark; Classic and Slate at 1440: no horizontal overflow.

## 17. Evidence paths

`C:\Users\alexm\Documents\Ledger-Design-Concepts\D12-Evidence\refinement\`: `01` and `01b` reference (D3.2 desktop and mobile), `02` to `02c` before refinement, `03` after (desktop light), `03b` with history, `04` dark, `05` phone light, `06` phone dark, `07` to `07d` hero with history (keyboard reading, light, dark; no history), `08` integrated spending and budget, `09` two-column composition, `10` reordered state in edit mode, `10b` carried-over saved layout with the note, `11` Family Related tasks, `12` 1024, `13` 800, `14` 320, `15` Classic, `16` Slate, `17` long amounts at 320, **`18` and `19` side by side (prototype, before, after) for desktop and phone**, plus the two JSON result files.

## 18. Side-by-side assessment (candid)

Picture `18` shows the three together. Estimates are mine and qualitative.
- **Overall composition: now matches the prototype's structure** (hero, strip, slim Get started, two columns at the same proportions). Before: clearly the old card grid. About 85 to 90 percent.
- **Visual hierarchy:** the hero dominates and the supporting column is quieter; a reader sees "where I stand" first. Matches. The remaining weak spot is the left pane of the hero when there is no history (a figure and a note on a lot of navy).
- **Primary information placement:** net worth, income, spent, ready to assign all in the first screen, as in the prototype.
- **Supporting density:** close; supporting order matches the prototype.
- **Mobile:** same order as the prototype; the hero is one block rather than two cards.
- **Interaction:** the prototype shows Snooze and Dismiss on alerts and a "Show all steps" row; Home's alerts do not have Snooze or Dismiss (they exist on Today), and that is new behavior I did not build.
- **Overall Home fidelity after refinement: roughly 80 to 85 percent** (composition 85 to 90, details 70 to 80). It no longer resembles the old layout.

## 19. Remaining design deviations (material first)

1. Spending and budget are two panels in one card, not one merged table (section 7; the precise reasons are in 22.2).
2. ~~No Assets and Owed chips~~ (built in the final pass, 22.1); still no "67 percent of income" and no "Income less spending" in the hero.
3. No Snooze and Dismiss on Home's alerts.
4. ~~"What you own and owe" ring~~ (replaced by two bars in the final pass, 22.1).
5. ~~Monthly check-in ring~~ (replaced by the segmented bar in the final pass, 22.1).
6. Income is the app's positive green (not teal); the chart shows axis labels, not value labels on each column.
7. ~~On a phone the hero is one block~~ (two cards since the final mobile correction, section 23).
8. The net-worth chart's tick labels can crowd when owed is tiny (existing chart logic).

## 20. Outstanding owner decisions

1. Allow the Assets and Owed chips in the hero? Alternative: show them labelled "Assets (positive balances)" and "Owed (cards and loans)" with no equation between them.
2. Allow a category-keyed merged spending and budget table (a view-level join)?
3. Add Snooze and Dismiss to Home's alerts (new behavior; shared with Today)?
4. Accept the customization tradeoff (section 10), or add moving a supporting card to the other column?
5. Replace the check-in ring with the prototype's segmented bar, and the own and owe donut with two bars (presentation only)?
6. **Separate future work, not started:** a design-fidelity review of **D11 Today**, whose first implementation also retained more of the old layout than intended.

## 21. Exact Git status

```
M docs/BACKLOG.md
M docs/CHATGPT-HANDOFF.md
M docs/UI-COVERAGE.md
M src/modules/family/HouseholdSections.tsx
M src/modules/family/OverviewPage.tsx
M src/modules/family/family-f4-render.test.tsx
M src/modules/family/family.css
M src/modules/household/OverviewPage.tsx
M src/modules/household/Parts.tsx
M src/modules/household/household.css
M src/pages/HomePage.tsx
M src/palette.ts
M src/shell/uiCoverage.test.ts
M src/styles.css
M src/ui/charts.tsx
M src/ui/tokens.css
?? docs/LEDGER-SIGNATURE-D12-REFINEMENT-REPORT.md
?? docs/LEDGER-SIGNATURE-D12-REPORT.md
?? docs/UI-DESIGN-D0-AUDIT-2026-11-10.md
?? docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md
?? scripts/dev-demo-seed.ts
?? src/lib/homeSections.test.ts
?? src/lib/homeSections.ts
?? src/modules/family/d12Family.test.tsx
?? src/modules/household/d12Household.test.tsx
?? src/pages/HomeHero.tsx
?? src/pages/d12Contrast.test.ts
?? src/pages/d12Home.test.tsx
?? src/pages/d12HomeComposition.test.tsx
?? src/pages/home.css
```
(`dist/` and `node_modules/` are ignored. The first D12 pass and this refinement are one uncommitted change set.)

Nothing was staged, committed, pushed or deployed. `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md` and `docs/UI-COVERAGE.md` were updated and record the owner's design philosophy: prototype integrity is essential; the old layout is not sacred; reordering matters more than add, remove, hide or resize; financial and functional integrity stay non-negotiable; material deviations need explicit justification and review.

## 22. Final visual fidelity pass (2026-11-12)

The approved structure was kept as it was (full-width hero, two columns, compact Get started, `homeSections.ts`, within-column reordering, the v1/v2 compatibility, Related tasks, Household Finances). Baseline re-verified first: `main` = `origin/main` = `6a6de39`; the first D12 pass and the refinement are still uncommitted; the working tree held exactly the 30 files the two reports list; the three pre-existing untracked files were not touched.

### 22.1 Implemented

1. **Assets and Owed in the hero.** Two small boxes under the net worth: **"Assets (positive balances)"** and **"Owed (cards and loans)"**, each a label with its amount. They are the two values the page already worked out for its own "What you own and owe" section (the sum of the positive cash, investment and property balances, and the amount owed on cards and loans), so the labels are the true definitions. Nothing is subtracted or equated with the net worth above them, and the code and tests forbid it (net worth is not always assets minus owed, because a negative balance is left out of the assets). Shown only when at least one of the two is more than nothing (an empty household shows neither). Accessible names are the labels themselves (a definition list, label then amount). Seven-digit amounts at 320 px wrap by character inside their boxes (checked).
2. **What you own and owe as two bars.** The ring and the separate owed bar are replaced by two bars on **one drawing scale** (the longer fills the track), the parts the assets are made of (Cash and so on, each with its amount, as the ring's legend had), and the same link and empty words. The bars are plain markup hidden from assistive technology: no percentage is shown or spoken and nothing is computed between the figures. "More than assets" appears in words when owed exceeds assets. The shared generic chart file is not touched (the bars are not a new use of `BarList`). Tested with assets greater than owed, owed greater than assets, equal, no debts ($0.00 bar of no width) and no assets (the empty words, with no owed figure drawn alone, as before).
3. **Monthly check-in as a segmented bar.** One segment for each step that applies to you (the steps the check-in itself counts: status other than "does not apply"), filled when that step is done, a named progress bar ("Monthly check-in progress", value and "3 of 7 steps done"), the count in words, the next step and the streak line. It draws the check-in's own steps and progress; when it shows, what is done, what is next and when it is complete are unchanged (it reuses `useCheckin` output untouched). Complete ("All steps done."), incomplete and empty states are tested.
4. **A divider between the spending and budget panels** where they sit side by side (equal height), so the card reads as one block.

### 22.2 Deliberately not built, and why

- **A category-keyed spending and budget table: not built.** Three precise reasons, each pinned by a test (`d12HomeFinal.test.tsx`, last group): (a) the spending side is keyed by category **name**, not id: two different categories with one name already become one slice, and a slice carries only `name` and `cents`; the budget bars also carry a name, not an id; (b) the two sides count **different money**: spending includes every account, the budget leaves out accounts the owner excluded from budgeting, so for one category the slice can read $140.00 while the budget row reads $40.00, both correct by their own definitions, and one row would have to show two "spent" figures or silently pick one; (c) the lists are cut differently (five categories plus "Other" against six bars), so a category missing from one list is not proof that it has no spending or no budget (and "Other" is a label for several categories). A join by label would be unreliable and a join by id is impossible without changing a provider, which was not authorized. The two panels in one card with a divider are the safe form. Alternative for the owner: authorize a small change to the spending reader so slices carry the category id and the budget bar carries its id; then a row could show both figures with the difference explained.
- Snooze and Dismiss on Home's alerts, any new alert persistence, new income, difference or percentage figures, cross-column movement, a drag-and-drop framework, any change to Today or Calendar: all untouched, as instructed.

### 22.3 Financial values before and after

Same fictional profile and day as the D12 baseline. **Every baseline money figure is still present with its count; the page now shows 33 figures instead of 31: the two extras are exactly the hero's Assets ($31,830.04) and Owed ($572.00), the same amounts the own-and-owe section shows.** Every labelled value matches the baseline (14 labels: Income, Spent, Ready to assign, each category, each budget row, Owed, Cash, the recent rows by amount); the hero's Net worth, Income, Spent and Ready to assign equal the baseline values and the readers' output; the chart labels carry the readers' values (net worth, spending total, six months of income and spending). One label changed on purpose: the ring's label "Assets: Cash $31,830.04" is replaced by the visible Assets bar and the Cash line. No reader, calculation or format was changed.

### 22.4 Category-matching logic used for presentation

**None.** No category is matched between spending and budget anywhere in the code (a test pins that the analysis section contains no `categoryId` and no name lookup between the two lists).

### 22.5 Net-worth chart and check-in behavior

The trend chart was not changed in this pass; its history checks (six fictional months in light and dark, accessible description, arrow keys, and the none and one-month notes) were run again and pass with the hero's new Assets and Owed boxes above it. The check-in bar: 7 segments, 3 filled, "3 of 7 steps done", the same link and next step as before.

### 22.6 Customization regression

The same browser checks as the refinement were re-run on the final code and pass: fresh profile default; reorder, hide, reload, show, reset; no information lost; a fictional customized `ledger.home.layout.v1` carried over with the note, left byte for byte unchanged through dismiss, a change and "Use my earlier arrangement again"; nothing silently discarded.

### 22.7 Automated test results

**4,817 tests in 259 files pass** (full run once, after the last source and test edit, 122.42 s, exit 0; 18 new in `d12HomeFinal.test.tsx` on top of the refinement's 4,799 in 258; no financial, Household or guard test was changed). `npx tsc --noEmit` clean; `npm run build` exit 0. One catch by the short-number guard: an amount in a new test line needed its documented `// ids-ok` marker.

New in this pass: `d12HomeFinal.test.tsx` (18 tests: hero figures and labels, the two bars in each case, the check-in bar in each state, the evidence for not joining by category, the structure and customization still in place); five new pairs in `d12Contrast.test.ts`; two earlier hero tests were relaxed because they forbade the now-approved Assets and Owed figures (they still forbid any difference or percentage). No financial, Household or guard test was changed.

### 22.8 Final pictures (outside the repository)

`C:\Users\alexm\Documents\Ledger-Design-Concepts\D12-Evidence\refinement\`: **`D12-FINAL-PROTOTYPE-VS-IMPLEMENTATION-DESKTOP.png`** and **`D12-FINAL-PROTOTYPE-VS-IMPLEMENTATION-MOBILE.png`** (the unchanged approved prototype beside the final implementation at comparable sizes; made for attaching to ChatGPT), plus refreshed `03` to `17` (desktop light and dark, with and without history, phone light and dark, 1024, 800, 320, Classic, Slate, long values at 320, reorder and carried-over layout). The earlier before-refinement and side-by-side pictures (`02`, `18`, `19`) are kept for the history.

### 22.9 Remaining deviations from D3.2 (candid)

1. Spending and budget are two panels in one card with a divider, not one category table (22.2).
2. No Snooze and Dismiss on Home's alerts (new behavior, deferred).
3. No "Spent 67 percent of income so far" and no "Income less spending" (not authorized); the prototype's one-line note under the spending ring ("Rent is 87 percent of this month's spending") is also a new percentage and was not built.
4. The assets list shows the parts as text lines; the prototype shows one "Cash" sublabel and a "Net worth" total row (a total row beside Assets and Owed would imply they reconcile).
5. The hero's two bars carry the words "Income" and "Spent"; the prototype draws one bar and a percentage.
6. Income is the positive green, not teal; the Income vs spending chart shows axis labels rather than a value on each column.
7. ~~On a phone the hero is one block~~ (two cards since the final mobile correction, section 23).
8. The net-worth chart's tick labels can crowd when the owed amount is tiny (existing chart logic).

Overall Home fidelity after this pass, my own qualitative estimate: **about 90 percent for composition and 85 percent overall**; the remaining differences are the items above, none of which is a layout difference.

### 22.10 Exact Git status

```
M docs/BACKLOG.md
M docs/CHATGPT-HANDOFF.md
M docs/UI-COVERAGE.md
M src/modules/family/HouseholdSections.tsx
M src/modules/family/OverviewPage.tsx
M src/modules/family/family-f4-render.test.tsx
M src/modules/family/family.css
M src/modules/household/OverviewPage.tsx
M src/modules/household/Parts.tsx
M src/modules/household/household.css
M src/pages/HomePage.tsx
M src/palette.ts
M src/shell/uiCoverage.test.ts
M src/styles.css
M src/ui/charts.tsx
M src/ui/tokens.css
?? docs/LEDGER-SIGNATURE-D12-REFINEMENT-REPORT.md
?? docs/LEDGER-SIGNATURE-D12-REPORT.md
?? docs/UI-DESIGN-D0-AUDIT-2026-11-10.md
?? docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md
?? scripts/dev-demo-seed.ts
?? src/lib/homeSections.test.ts
?? src/lib/homeSections.ts
?? src/modules/family/d12Family.test.tsx
?? src/modules/household/d12Household.test.tsx
?? src/pages/HomeHero.tsx
?? src/pages/HomeParts.tsx
?? src/pages/d12Contrast.test.ts
?? src/pages/d12Home.test.tsx
?? src/pages/d12HomeComposition.test.tsx
?? src/pages/d12HomeFinal.test.tsx
?? src/pages/home.css
```
(`dist/` and `node_modules/` are ignored. The first D12 pass, the refinement and this pass are one uncommitted change set.)

Nothing was staged, committed, pushed or deployed; no branch, remote or dependency was created or added.

## 23. Final mobile fidelity correction (2026-11-12)

Baseline re-verified first: `main` = `origin/main` = `6a6de39`; everything from the three D12 passes is still uncommitted (32 files); the three pre-existing untracked files were not touched. The approved desktop was not changed.

### 23.1 What changed

On a phone (**640 px and narrower**) the top panel is drawn as **two cards**, as in the approved D3.2 mobile design:
- **Card 1, Net worth** (dark): the net worth, "Up or Down since", Assets and Owed, the History link, and the trend chart when two or more months are saved (or the dotted note).
- **Card 2, the month** (its own light card in Signature light; the dark card color in Signature dark): the month name, Budget link, Income, Spent and Ready to assign as label and amount rows, and the two slim bars.

It is **one set of markup and one set of data**: the same section with the same two panes, re-drawn by CSS inside a 640 px media query (the wrapper loses its background, the first pane keeps the dark surface, the second pane re-points the panel's text variables to the ordinary text colors and takes the card surface). Each figure is still drawn exactly once, and the hero is still outside the two stored columns, so a phone cannot store a second copy of it (a test pins both). Between 641 and 960 px (a tablet) the panel stays one combined dark panel, as in the approved desktop approach.

### 23.2 Differences from D3.2's mobile design

1. The page header above the cards is taller than the prototype's: the top bar says "Home", the page then repeats "Home" with its description, and the three header actions wrap onto two rows. The net-worth card therefore starts about 440 px down at 375 px, where the prototype's is near the top. That header is the shared `PageHeader` used by every page and was not changed here.
2. The prototype's month card carries "Spent 67 percent of income so far" and "Income less spending" (new derived figures, not authorized) and one bar; ours has the two named bars.
3. The Assets and Owed labels are the longer, precise ones ("Assets (positive balances)"), so they wrap to two lines inside their boxes.
4. The prototype shows no history; with history the net-worth card is taller by the chart.

### 23.3 History chart on a phone

The chart is drawn at **176 px** on a phone (240 px elsewhere), with a smaller legend; the Net worth page and every other width are unchanged (a new optional `height` on `NetWorthChart`, default 240; the Net worth page does not pass one). Nothing was hidden or removed: same bars and values, same accessible description ("Assets and amounts owed by month, with net worth as a line. Latest Nov '26: ..."), still focusable, and the arrow keys still read month by month on a phone-sized page (two steps back from the latest month read September). No label is cropped and the chart sits inside its card (measured at 375 and 320). The no-history and one-month states show the note and no chart. Measured at 375 px (full page): the net-worth card is **269 px** tall with no history and **476 px** with six months; the month card starts at page position **635 px** (no history) or **841 px** (history), and is 272 px tall. I prioritized a readable chart over a smaller card.

### 23.4 Bottom navigation, checked in a real phone-sized viewport

Not a defect. The overlap in the full-page picture is an artifact of capturing a long page while the tab bar is fixed to the viewport. Observed at 375 x 812: the tab bar is fixed and always ends at the bottom of the viewport (top 755, bottom 812), at the top of the page and after scrolling 900 px; the round Add button floats just above it (bottom-right, 52 px); at the end of the page the last card ends at 655 px, above both the tab bar (755) and the Add button (687), so nothing is permanently covered (the page keeps 157 px of bottom padding); a real tap on the Add button opens the Add box. Content scrolls under the bar and the button as designed. **No change was made to the navigation.** Evidence pictures taken as full pages hide the fixed bars for the capture only (labelled so); the viewport pictures show them in place.

### 23.5 Financial values unchanged

Read from the page in all eight phone states (375 and 320 px, light and dark, with and without history): Net worth $31,258.04; Assets (positive balances) $31,830.04; Owed (cards and loans) $572.00; Income $3,200.00; Spent $2,382.00; Ready to assign $19,056.04: identical to the D12 baseline in every state. Chart inputs are the same readers' output (the label values were re-checked in the desktop run). No reader, calculation, schema or format was changed. Seven-digit amounts ($12,345,678.90, text edited in the page, nothing saved): the net-worth figure, the two small figures and the month figures each stay on one line at 375 and 320 px; the two small figures stack and shrink slightly rather than split (the page adds the stacking itself when either amount is 12 characters or more; unit-tested); no overflow.

### 23.6 Desktop regression

The desktop CSS rules are asserted unchanged by tests, and the 43-check desktop browser run was repeated on the final code and passes: full-width panel (1,219 px, equal to the strip below it), columns 747 and 448 px side by side, default order, one-card Spending & budget, hero Assets and Owed, two own-and-owe bars, segmented check-in, reorder, hide, show, reset and reload, a customized earlier layout carried over with its note and left byte for byte unchanged, the net-worth chart with history in light and dark and its arrow-key reading, Family and Household checks. 1440, 1024, 800, 375, 320, light and dark, Classic and Slate: no horizontal overflow. Tab walks of Home, Household and Family at both widths: every stop shows a focus indicator; phone links are 44 px or taller.

### 23.7 Automated test results

**4,828 tests in 260 files pass** (full run once, after the last source and test edit, 113.84 s, exit 0; 11 new in `d12HomeMobile.test.tsx` on top of the previous pass's 4,817 in 259; no financial, Household, Family or guard test was changed). `npx tsc --noEmit` clean; `npm run build` exit 0.

New: `d12HomeMobile.test.tsx` (11 tests: one section and one set of data, hero outside the stored columns, desktop rules unchanged, the phone rules confined to the 640 px query, the chart's default height and its 176 px phone height with the same data and description, the no-history and one-month states, long amounts stacking, tokens only, customization untouched); six more pairs in `d12Contrast.test.ts` for the phone month card (figures, labels, positive and negative text, the Budget link, the bar). No financial, Household, Family or guard test was changed.

### 23.8 Final comparison pictures (outside the repository)

`C:\Users\alexm\Documents\Ledger-Design-Concepts\D12-Evidence\refinement\`:
- **`D12-FINAL-PROTOTYPE-VS-IMPLEMENTATION-MOBILE.png`**: the unchanged approved prototype beside the implementation with **no saved history** (the same content state).
- **`D12-MOBILE-NO-HISTORY-PROTOTYPE-VS-IMPLEMENTATION-LIGHT-AND-DARK.png`**: prototype, implementation light, implementation dark, all without history.
- **`D12-MOBILE-WITH-HISTORY-375-LIGHT-AND-DARK.png`**: real 812 px viewports with the tab bar and Add button in place (top of page and scrolled to the month card), light and dark, six fictional months.
- **`D12-MOBILE-WITH-HISTORY-320-LIGHT-AND-DARK.png`**: 320 px light, dark and long amounts.
- Single pictures `M-*` (full page, viewport top, month card, the chart read by keyboard, bottom navigation after scrolling, end of page) and `mobile-final-browser-verification.json` (55 checks).
The desktop comparison `D12-FINAL-PROTOTYPE-VS-IMPLEMENTATION-DESKTOP.png` is unchanged.

### 23.9 Remaining genuine limitations

1. The phone page header is taller than the prototype's (23.2 item 1), which keeps the cards lower on the first screen than the prototype. A change would touch the shared `PageHeader`.
2. With history the first card is 476 px tall; I did not trade readability for height.
3. The net-worth chart's lowest tick labels can crowd when the owed amount is tiny beside the assets (existing chart logic; visible in the phone chart).
4. The floating Add button sits over the chart while it is scrolled past (normal for a floating button).
5. Tablets (641 to 960 px) keep the combined panel.
6. Not tested on a real phone or with a screen reader; headless Chrome only.
7. Unchanged and still open from section 22: no category-keyed spending and budget table, no Snooze or Dismiss on Home alerts.

### 23.10 Exact Git status

```
M docs/BACKLOG.md
M docs/CHATGPT-HANDOFF.md
M docs/UI-COVERAGE.md
M src/modules/family/HouseholdSections.tsx
M src/modules/family/OverviewPage.tsx
M src/modules/family/family-f4-render.test.tsx
M src/modules/family/family.css
M src/modules/household/OverviewPage.tsx
M src/modules/household/Parts.tsx
M src/modules/household/household.css
M src/pages/HomePage.tsx
M src/palette.ts
M src/shell/uiCoverage.test.ts
M src/styles.css
M src/ui/charts.tsx
M src/ui/tokens.css
?? docs/LEDGER-SIGNATURE-D12-REFINEMENT-REPORT.md
?? docs/LEDGER-SIGNATURE-D12-REPORT.md
?? docs/UI-DESIGN-D0-AUDIT-2026-11-10.md
?? docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md
?? scripts/dev-demo-seed.ts
?? src/lib/homeSections.test.ts
?? src/lib/homeSections.ts
?? src/modules/family/d12Family.test.tsx
?? src/modules/household/d12Household.test.tsx
?? src/pages/HomeHero.tsx
?? src/pages/HomeParts.tsx
?? src/pages/d12Contrast.test.ts
?? src/pages/d12Home.test.tsx
?? src/pages/d12HomeComposition.test.tsx
?? src/pages/d12HomeFinal.test.tsx
?? src/pages/d12HomeMobile.test.tsx
?? src/pages/home.css
```
(`dist/` and `node_modules/` are ignored. All of D12 is one uncommitted change set.)

Nothing was staged, committed, pushed or deployed; D12 is not marked deployed or owner-accepted; no branch, remote or dependency was created or added.

## 24. Mobile header correction (2026-11-12)

Baseline re-verified: `main` = `origin/main` = `6a6de39`; all of D12 is still uncommitted; the three pre-existing untracked files were not touched. Correction to section 23.2: I had estimated the first card at about 440 px; measured, it was at **350 px** at 375 px wide, which is the number used below.

### 24.1 What caused the height (measured at 375 px, no history)

Global bar and the "Home" bar under it: 116 px (the app's own shell, not changed). Then the Home page header: **194 px**, made of the small "Ledger" label, the heading "Home" (repeating the bar above), the description, and the three actions wrapping onto two rows (check-in and Refresh prices, then Edit Home alone). Then the margin to the card. At 320 px the header was 216 px.

### 24.2 Exact change

Ledger Home only (the shared `PageHeader` is not changed, a test pins that). Home passes a class (`home-head`); inside a 640 px phone query: the title block (label, heading, description) is **visually hidden but kept in the page for screen readers** (the bar above already says "Home"), the page header's bottom margin is smaller, and the three actions share one compact row (smaller side padding, no wrapping inside a button). Nothing was removed: Monthly check-in, Refresh prices and Edit Home are the same plain buttons (still 44 px tall), keyboard order unchanged. No menu was needed. Desktop and tablet rules are untouched (a test pins that the new rules are inside the phone query).

### 24.3 Before and after (page position of each top edge, no history unless noted)

| Width and state | Header before | Header after | Net-worth card top before | after | Month card top before | after |
|---|---|---|---|---|---|---|
| 375, light | 194 px | 44 px | 350 px | 188 px | 635 px | 473 px |
| 320, light | 216 px | 88 px | 372 px | 232 px | 714 px | 574 px |
| 375, dark | 194 px | 44 px | 350 px | 188 px | 635 px | 473 px |
| 375, Classic | 169 px | 44 px | 313 px | 176 px | 598 px | 461 px |
| 375, light, six months of history | 194 px | 44 px | 350 px | 188 px | 841 px | 680 px |
| 640, light | 142 px | 44 px | 298 px | 188 px | 561 px | 451 px |
| 800, light (unchanged) | 86 px | 86 px | 253 px | 253 px | 514 px | 514 px |
| 1440, light (unchanged) | 86 px | 86 px | 243 px | 243 px | 243 px | 243 px |

At 375 x 812 the page now shows, without scrolling, the whole net-worth card (Assets and Owed included) and the month card's Income, Spent and Ready to assign (and its bars, with the floating Add button over the right end). At 320 px the actions wrap to two rows (the header is 88 px) and the net-worth card still starts at 232 px. With six months of history the net-worth card is taller by the chart, so the month card starts at 680 px rather than 473 px, but the net worth and its chart are in the first screen.

### 24.4 Visual improvements and preserved actions

The first screen goes straight from the shell's bar to the actions and the net-worth card, as in D3.2. Preserved: Monthly check-in (link and count), Refresh prices (button and its message), Edit Home (and Done); the heading and description for screen readers; the bottom tab bar (still fixed at the bottom, content scrolls under it); the global Add button (a real tap still opens the Add box).

### 24.5 Verification

Targeted, because the change is CSS plus one class name (no shared function or state changed): the Home, contrast, layout-model, UI coverage and short-number guard tests pass (110 tests in those files; 3 new in `d12HomeMobile.test.tsx`: the class and the unchanged shared header, nothing removed from the page, phone-only hidden title block and one-row actions); `npx tsc --noEmit` clean; `npm run build` exit 0. Browser (fictional data, headless Chrome): the 43 desktop and customization checks and the 55 phone checks pass again (figures identical, two cards, chart keyboard reading, bottom bar and Add button, long amounts, no overflow); Tab walks show a visible focus on every stop at 375; measured at 320, 375, 640, 800 and 1440, light and dark, Classic, with and without history, with no horizontal overflow. **The full suite was not re-run** (the last full run, before this correction, was 260 files, 4,828 tests, all passing; CI will run it again after a separately approved release).

### 24.6 Final pictures (outside the repository, `D12-Evidence\refinement\`)

- **`D12-HEADER-FINAL-375-PROTOTYPE-VS-BEFORE-VS-AFTER-VS-DARK.png`**: the approved prototype, the previous D12 header, the corrected header, and the corrected header in Signature dark, all as 375 x 812 viewports with no history (so the same state), with the navigation in place.
- **`D12-HEADER-FINAL-320-AND-HISTORY-AND-CLASSIC.png`**: corrected at 320 px, at 375 px with six fictional months in light and in dark, and in Classic.
- Single viewport pictures `H-before-*` and `H-after-*`, and `header-measurements-before.json` and `-after.json`.

### 24.7 Remaining limitations

1. At 320 px the three actions still wrap to two rows.
2. The bar under the app header still repeats "Home" as the visible title (it is the shell's bar, unchanged), and the page's own "Home" heading is hidden visually on a phone; the prototype's bar shows the section tabs instead.
3. The prototype's compact check-in pill with a mini progress bar is not reproduced (the button keeps its "3/7" text).
4. Not tested on a real phone or with a screen reader.

### 24.8 Exact Git status

```
M docs/BACKLOG.md
M docs/CHATGPT-HANDOFF.md
M docs/UI-COVERAGE.md
M src/modules/family/HouseholdSections.tsx
M src/modules/family/OverviewPage.tsx
M src/modules/family/family-f4-render.test.tsx
M src/modules/family/family.css
M src/modules/household/OverviewPage.tsx
M src/modules/household/Parts.tsx
M src/modules/household/household.css
M src/pages/HomePage.tsx
M src/palette.ts
M src/shell/uiCoverage.test.ts
M src/styles.css
M src/ui/charts.tsx
M src/ui/tokens.css
?? docs/LEDGER-SIGNATURE-D12-REFINEMENT-REPORT.md
?? docs/LEDGER-SIGNATURE-D12-REPORT.md
?? docs/UI-DESIGN-D0-AUDIT-2026-11-10.md
?? docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md
?? scripts/dev-demo-seed.ts
?? src/lib/homeSections.test.ts
?? src/lib/homeSections.ts
?? src/modules/family/d12Family.test.tsx
?? src/modules/household/d12Household.test.tsx
?? src/pages/HomeHero.tsx
?? src/pages/HomeParts.tsx
?? src/pages/d12Contrast.test.ts
?? src/pages/d12Home.test.tsx
?? src/pages/d12HomeComposition.test.tsx
?? src/pages/d12HomeFinal.test.tsx
?? src/pages/d12HomeMobile.test.tsx
?? src/pages/home.css
```

Nothing was staged, committed, pushed or deployed; D12 is not marked deployed or accepted; no branch, remote or dependency was created or added.
