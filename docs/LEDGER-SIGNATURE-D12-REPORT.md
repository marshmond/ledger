# Ledger Signature D12: Ledger Home, Family overview and Household Finances (2026-11-12)

> **Superseded in part by the refinement (`docs/LEDGER-SIGNATURE-D12-REFINEMENT-REPORT.md`, same day):** Ledger Home was recomposed (full-width hero, two columns, one-card spending and budget, new section-based customization), the Family task section is now "Related tasks", and the net-worth chart was verified with history. Sections 2, 6, 12, 18 and 20 below describe the first pass for Ledger Home; the Household Finances and Family descriptions still hold.

**Status: built and tested locally. Uncommitted, not staged, not pushed, not deployed. Awaiting owner and ChatGPT review. Not tested on a real phone or with a screen reader. D13 is not started.**

D12 changes how three screens look. It does not change what any of them counts, stores, links to or says about money. Everything below separates what was observed (tests, scripts, pictures) from what is my judgment.

## 1. Release gate (verified before any code changed)

- Repository `marshmond/ledger`; branch `main`; after `git fetch`, `HEAD` = `origin/main` = **`6a6de3930965caef3d2eacf2a637f843d74f5bd5`** (`feat(ui): redesign Today and Tasks`, the D11 release). D10's `1298877` is no longer the baseline.
- **CI and Pages:** Actions run **#97** (id 43168240514) for that exact commit. At first look it was still running `npm test`; I waited. Final: `completed` / `success`; jobs `build` success and `deploy` success. Read from the public GitHub API (`gh` is not installed).
- **D11 correction present in that commit:** `bulkPriorityAction`, `bulkListAction` and `bulkTagAction` are in `src/modules/tasks/viewModel.ts` and called from `TasksPage.tsx` (lines 241, 244, 254); `bulkActions.test.ts` (14 tests) is in the commit's file list. The D11 report (section 20) records 252 files and 4,707 tests passing; CI's own `npm test` step then passed on the commit (the deploy job only runs after it).
- **Working tree:** only the three pre-existing untracked files (`docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`). They were not opened for edit, staged or deleted.
- **Design references read:** D3.2 report and pictures (Ledger Home, Family), D3.3 report and pictures (Household Finances), D3.1, D3.4 (Family color), D4 blueprint (design system, coverage, roadmap, open decisions, handoff), `docs/CHATGPT-HANDOFF.md`, `docs/BACKLOG.md`, `docs/UI-COVERAGE.md`.
- **A correction to the brief:** the brief says the Household Finances prototype is part of D3.2. It is not. D3.2 holds Ledger Home and Family; **Household Finances is in D3.3** (`D3.3-Final-Validation\Household-Finances-desktop.png`, `-mobile.png`, `-desktop-dark.png`, `Household-Finances.html`). I used D3.3 for it. Its windows are the ones in the brief (Expected 30 days, Committed 12 months, Recorded 12 months).

## 2. Ledger Home: what was there (read from `src/pages/HomePage.tsx`, `src/lib/homeLayout.ts`)

Twelve cards, stored per device in `ledger.home.layout.v1` (an ordered list of `{id, size}`; sizes `half` or `full`). Default order and width: `start` full, then eleven half cards.

| Card id | Title | What it shows, and from where | Links | Empty state |
|---|---|---|---|---|
| `start` | Get started | Four setup steps (accounts, income people, investment accounts, backup), progress bar; hidden once finished or dismissed (`ledger.onboarding.dismissed`) | each step's page | hidden |
| `networth` | Net worth | `loadNetWorth` total, `changeOver(snaps)` "since", trend chart when 2 or more saved months | /networth | "A trend line appears once a couple of months of history have been saved." |
| `attention` | Needs attention | `useLedgerAlerts` list (same list as Today), count badge | each alert's action | "Nothing needs attention right now." or "Alerts will show here once you have entered some data." |
| `month` | the month name | `spendingSnapshot`: Income and Spent bars, budget "Ready to assign" | /budget | (bars at zero) |
| `spending` | Spending by category | `spendingSlices` donut | /reports | "No spending recorded in {month} yet." |
| `budget` | Budget progress | `budgetBars` (spent of funds; over flag) | /budget | "Assign money to categories on the Budget page to track it here." |
| `cashflow` | Income vs spending | `monthlyFlow` six months, paired columns | /reports | "Income and spending for the last six months will chart here." |
| `breakdown` | What you own and owe | cash, investments, property donut (positive only) and the owed bar | /networth | "Add accounts, investments or property to see the mix." |
| `recent` | Recent transactions | six latest non-transfer transactions | account page, /transactions | "No transactions yet" with Add |
| `comingup` | Coming up | `ComingUp` (limit 5), masked by Hide amounts | each item | "Nothing is coming up. ..." |
| `checkin` | Monthly check-in | `useLedgerAlerts` check-in progress ring; hidden unless ready | /checkin | hidden |
| `goals` | Goals | goals as bars | /goals | "No goals yet" |

Customization: "Edit Home" shows move earlier or later, a width button (computer widths only) and Remove per card, "Add a card" for removed ones, and "Reset to default". Chart accessibility before D12: each ring or chart is an `svg role="img"` with a full-sentence label; bars are `role="progressbar"` with a name and value; the net-worth chart has arrow-key reading. Phone: one column.

## 3. Family overview: what was there

Six sections in `OverviewPage.tsx`: warnings (more than one "This is me"; possible duplicate member), an empty state, "In the household" (a plain list: mark, name link, then one line of role, "This is you", color name, an "added" date only when two members share a name, birthday, "needs a look"), a "Show" select that narrows the next three sections (view only, nothing saved), "Activities, next 7 days", "Responsibilities" (open Tasks that name a member; the page says Ledger does not record who has to do them), "Birthdays and dates, next 30 days", "Past members" and "Needs review" for unreadable records. Colors come from D9: `MemberMark` and `MemberDot`; the Calendar stripe on an activity is the calendar's own color.

## 4. Household Finances: the authoritative figures (read from `Parts.tsx`, `commitments.ts`, `unionSpend.ts`, `review.ts`, `overview.ts`)

| Figure | Exact meaning and window | Source reader |
|---|---|---|
| Expected payments | what is anticipated from today to 7, 30 or 90 days ahead (default 30, not persisted); "Expected, not spent"; bills count what is still to pay, service visits are estimates | `commitments.windows[]` |
| Committed ("Commitments for the next twelve months") | what bills and standing services add up to from today to one year ahead less a day; "plans, not payments"; not a forecast | `commitments.twelve` |
| Recorded spending | what a Finance transaction (or a valid part) or an amount typed as paid outside Finance supports, each payment counted once; period menu: Last 12 months (default), Last 90 days, Last 30 days, This year so far, All time | `loadHouseholdOverview(period, today).spending` |
| Known | a definite amount; Estimated: explicitly an estimate (service visits, variable bills); Not known: a count of items with no amount, "not added"; In dispute: a count, "not added" | `Totals` |
| Needs review | six classes of item; the count is the items that need action (the "good to know" class is not counted) | `review.ts` |
| "What is counted" | proof that Finance payments plus typed = recorded total | `spending.proof` |
| Hide amounts | the global `today.hideAmounts.v1`; masks every amount and every amount in an item's wording | `useMoney` |

The three ideas are never added together; the page says so, and a test pins that no sum across them appears.

## 5. Files changed

Modified: `src/pages/HomePage.tsx`, `src/ui/charts.tsx`, `src/ui/tokens.css`, `src/palette.ts`, `src/styles.css` (the chart-color and spending-column lines only), `src/modules/household/Parts.tsx`, `OverviewPage.tsx`, `household.css`, `src/modules/family/OverviewPage.tsx`, `HouseholdSections.tsx`, `family.css`, `src/shell/uiCoverage.test.ts`, `docs/UI-COVERAGE.md`, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`.
New: `src/pages/home.css`, `src/pages/d12Home.test.tsx`, `src/pages/d12Contrast.test.ts`, `src/modules/household/d12Household.test.tsx`, `src/modules/family/d12Family.test.tsx`, this report.
**Not touched:** any calculation or reader (`commitments.ts`, `unionSpend.ts`, `review.ts`, `overview.ts`, `homeCharts.ts`, `spending.ts`), `homeLayout.ts`, the database, migrations, backup, sync, Search, Quick Add, navigation, routes, theme storage, `MemberForm`, `MemberPage`, Calendar and Tasks code.

## 6. Ledger Home redesign

- **Net worth** is the one dark panel (Signature navy; in dark mode a lighter navy), figure at 48 px (scaled down on a phone), "since" line in light green or red-pink, and the trend chart on a white band under it. Classic and the older presets keep an ordinary card (the new tokens fall back to the card colors).
- **Get started** is one row: "Get started", "1 of 4 done", a small bar, the next step as a link, "Show all steps" and "Dismiss". The four steps are still one click away (`aria-expanded`, `aria-controls`).
- **This month:** the existing Income and Spent bars with their amounts set large, and "Ready to assign" as a highlighted row. The bars are the chart; no number was added.
- **Spending, Budget, Owed:** thinner bars, a thinner ring, aligned amounts; **over states now have words** ("Over budget", "More than income", "More than assets") via a new optional `overLabel` on `BarList`. Before, an over bar was told by color alone.
- **Income vs spending:** a dollar axis (the largest drawn value rounded up to a tidy tick), faint grid, a native hover title per column ("Nov (so far): Spent $2,382.00"), and the current month drawn dashed and lighter with "so far" and a note, so a part month is not read as a drop.
- **Recent transactions:** a small date tile, payee over account, amount aligned right. The ISO date text became the tile (its full date is spoken).
- **Header:** the module name as a small label; "Refresh prices" and "Edit Home" are quiet buttons.

## 7. Family overview redesign

Member cards in a grid (4 across on a computer, 2 on a phone, 1 at 320 px or when a name is long): D9 mark (48 px), name link, role, "This is you" chip, birthday with an "In N days" tag (read from the same 30-day list the Birthdays section draws), the color's NAME with a dot, and a color edge on top. **A member with no color keeps a dashed neutral edge and a gray mark and shows no color name; nothing assigns a color.** The "Show" filter is a row of chips on a computer (name chips with the member dot; selected = filled and bold, `aria-pressed`) and the original select on a phone; both set the same local choice. Activities, tasks and dates start with a date tile (overdue tone for an overdue task; warm tone only for birthdays; no tile, only a spacer, for a task with no date). Activities are on the left; tasks and dates on the right.

## 8. Household Finances redesign

Order: how to read (three pills visible), **summary tiles**, **Needs review**, Expected payments, then Commitments beside Contractual actions and Where things are managed, then Recorded spending beside Spending by household area, then What is counted. Certainty uses the shared `Figure`: Known is a solid edge; Estimated is dashed with a wave and the word; Not known is amber with a question mark, the word, a count and "not added, and not zero"; In dispute keeps its own words. Rows are a date tile, title, source chip, certainty chip with icon, and amount. The 7/30/90 control is a segmented control (still radio buttons, so the arrow keys work). "What is counted" is an equation for the eye with the same sentence for a screen reader. Disclosures have a turning chevron and the same names.

## 9. Financial figures before and after (same fictional dataset, same day)

Baseline saved in `D12-Evidence\baseline\` (`BASELINE-2026-11-12.md` and the page text of the throwaway profile). Reference date 2026-11-12 (the device date). Comparison done inside the same profile; the in-app browser pane's database holds extra test records, so its figures differ from the throwaway profile's and were used only to read the structure.

| Screen | Before | After | Result |
|---|---|---|---|
| Ledger Home | 31 money figures (strict cents form) | the same 31, same counts per value | identical |
| Household Finances | 28 | all 28 present with the same counts, plus **10 repeats**: the Expected and Committed tiles (known and estimated each: 4), the Recorded tile (total, Finance-backed, typed: 3), and the equation boxes (3) | no figure missing or changed; no new value |
| Family | no money | none | n/a |

The page figures were also compared to the readers directly in the browser: the Expected tile and card at 7, 30 and 90 days equal `commitments.windows`; the Committed tile equals `commitments.twelve`; the Recorded tile equals `spending.totalCents` for Last 12 months and Last 90 days; the Needs review count equals the reader's list. Values read from the readers are in `D12-Evidence\after\household-provider-values.json`.

## 10. Known, Estimated, Not known

Observed: four Known, four Estimated and four Not known figures on the page each carry their words; every Not known figure is a count of items ("1 item") with no dollar sign; a Known figure of nothing would still read "$0.00 ... 0 payments" (that is a known zero, not the unknown one); a row without an amount reads "Amount not known" with the Not known chip and no figure; In dispute is its own treatment with its own words. Tests (`d12Household.test.tsx`) pin each, and that no sum of known with estimated, or of Expected, Committed and Recorded, is shown.

## 11. Chart styling and data preservation

Same components, same data. Signature gets a navy-to-teal category ramp (light: navy, teal, light teal, steel, amber, pale steel; dark: lighter equivalents) through optional `--viz-c1` to `--viz-c6` variables; the old values remain the fallbacks, so Classic and the other presets are unchanged. **Semantic colors were not remapped by position:** "Spent" now reads its own token `--chart-spend` (navy in Signature, the old orange everywhere else) and income keeps the existing positive color (deep green), not a series slot. The category rings and bars are categorical and use the ramp. Tooltips: each Income vs spending column has a native title; the net-worth chart's own keyboard tooltip is unchanged. Keyboard and labels: unchanged, plus words on over bars. No dependency was added.

## 12. Saved layout

All 12 ids, titles, default order, default widths, the storage key and format, `sanitizeLayout`, Edit Home, Remove, Add a card and Reset are untouched (`homeLayout.ts` not edited). Observed in the browser: a saved layout of four cards in a custom order with a changed width was honored after a reload; removing a card saved in the same format; Reset restored the original 12. Nothing was migrated or reset.

## 13. Hide amounts

Household Finances (observed): with it on, no dollar digit in the page text or in any accessible name (aria-label, title, alt) and no proportion bar; masked amounts are `$••••`, never `$0.00`; counts stay. Tests render every card and the tiles hidden and check the same. **Ledger Home is not covered by Hide amounts** (its documented scope, `HIDE_AMOUNTS_SCOPE`), apart from the Coming up list; D12 did not change that.

## 14. Themes and palettes

Signature light and dark: both looked at on all three screens at 1440 and 375; Classic light and "Slate and indigo" light at 1440 on all three. The hero text pairs and the new Home words are 4.5:1 or better in Classic and every preset in both modes (`d12Contrast.test.ts`, arithmetic). Not looked at: "Calm teal", "Forest" and "Deep navy" for these pages. Signature is still opt-in; Classic is the default; theme storage untouched.

## 15. Automated test results

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | exit 0 (only the existing "chunks larger than 500 kB" notice) |
| Full suite, first run (after the code settled) | 256 files, 4,776 tests: 4,775 passed, **1 failed**: `leakScanGuard.test.ts` flagged two regex lines in my new tests (`/<h[1456]/` and a pattern ending in `100`) as short numbers; the guard's documented `// ids-ok: reason` marker was added to both lines (no behavior change) |
| Full suite, final run (after the last source, test and tracker edit) | **256 files, 4,776 tests, all passed, 0 failed** (104.18 s; read from the log) |
| Production build before the final run | exit 0 |
| Browser verification script, final run | 35 of 35 passed |

Residue measures (informational, `uiResidue.test.ts`): inline `style={{` 308 (baseline 307, one over: the three drawn bars take their width from data), raw font-size values 37 (baseline 36, one over: the 1.5rem figure value), hex colors in CSS 142 (152), in module CSS 49 (56), files with their own `<h1>` 12 (13), `!important` 11 (unchanged), Modal sites 63 (unchanged).

New: `d12Home.test.tsx` 20, `d12Household.test.tsx` 21, `d12Family.test.tsx` 16, `d12Contrast.test.ts` 12 (69 in total). Edited: `uiCoverage.test.ts` (the tracker's list of built rows). The existing B5 golden-master, UI and guard tests, the Family tests, D6 shared and Signature token tests all passed unchanged. One mistake caught by an existing test along the way: I first set the chart ramp as `--chart-N` extras, which `signatureTokens.test.ts` rejects (an undeclared variable); I moved them to the optional `--viz-c1..6` form that the test allows.

## 16. Browser verification

Headless Chrome on a throwaway profile holding the fictional D1 household, scripts driving real clicks and key events (not a physical keyboard or a phone). **35 checks, all passing** on the final run (`D12-Evidence\after\browser-verification.json`): Home: 12 cards in order; figures equal baseline; chart names and provider values; "so far" month; hero; Get started row; saved layout, Edit Home, Remove, Reset. Household: baseline figures, tile and card equal the readers at 7, 30 and 90 days; Recorded period; Needs review count; disclosures; jump buttons move focus; links; certainty treatments; Hide amounts. Family: one card per active member with its stored color id; filter narrows and restores; Add member opens the D9 form and Escape closes it; a card opens that member's page; no console errors or warnings. Separate scripts: Tab walks (every stop shows a focus indicator; phone link targets raised to 44 px after the first walk found 28 to 31 px links), stress text (seven-digit amounts, unbroken 55-character names, 320 and 375: no overflow), and a no-color member (one stored color cleared on the throwaway profile and put back; the card showed the dashed neutral edge and gray mark).

## 17. Evidence (outside the repository)

`C:\Users\alexm\Documents\Ledger-Design-Concepts\D12-Evidence\`: `baseline\` (before pictures at 1440 and 375, baseline text, `BASELINE-2026-11-12.md`), `after\` (H01 to H11 Home, R01 to R15 Household, F01 to F11 Family, stress and no-color pictures, `browser-verification.json`, `keyboard-tab-walks.json`, `household-provider-values.json`, `family-cards.json`, `home-links.txt`).

## 18. Fidelity against the prototypes (candid)

- **Ledger Home, about 65 to 70 percent.** Matches: the dark hero with a large net-worth figure, one-row Get started, large month figures, navy and teal ramp, dashed "so far" month, date tiles on transactions, an amber alert tone, quieter header buttons. Differs: the prototype's hero is one full-width band holding net worth, income, spent and ready to assign with a "67 percent of income" bar; here the hero is a half-width card beside Needs attention because the saved layout is an ordered list of half and full cards and the default must not change; Spending and Budget remain two cards; no Assets and Owed chips; no two-column left-analysis, right-lists composition. It reads as the same family but is a calmer grid than the picture.
- **Family overview, about 85 percent.** Matches: four member cards with marks, color edge, "This is you", birthday tag, color name; filter chips; date tiles; two columns. Differs: no per-member activity and task counts, no "This week by person", the original wording kept ("belong to them", "Responsibilities"), no "ASSOCIATED WITH" column labels (the existing "Associated with:" line stays).
- **Household Finances, about 85 to 90 percent.** Matches: the page order, three summary tiles with three edge treatments, Known, Estimated and Not known boxes, Needs review moved up with an amber edge, segmented 7/30/90 control, date-tile rows with source and certainty chips, the equation. Differs: no "Check overlap" row markers (not authorized); the area bars and Recorded bars are drawn only when Hide amounts is off; the summary tiles are not links (they have "See ..." buttons that move focus); the contractual-actions card has no date tile.
- Not reproduced without changing function: anything needing a derived figure or a layout change (listed in section 20).

## 19. Coverage tracker

`docs/UI-COVERAGE.md`: L-01, H-01 and F-01 read `BLT` with all six marks (each mark is explained in the new section 1.7, including that `Kbd` rests on synthetic Tab walks); W-37 (Household review) `BLT`; S-23 (charts) marks added. Nothing is `ACC`. Family detail, Contacts and every other module page stay `NS`. The 59-page inventory, totals and the guard's list were updated together; no real-phone or screen-reader mark was claimed.

## 20. Judgment calls, outstanding issues and deferred decisions (please review)

1. **Default Home layout unchanged.** To get the prototype's full-width hero band and two-column composition, the default order and widths would have to change (new users and "Reset to default" only; saved layouts would be untouched). Your call.
2. **Spending by category and Budget progress stay two cards.** Merging them into one would remove a card id, which breaks per-card hide and the stored layout.
3. **Not built (not authorized):** "Income less spending", "Spent 67 percent of income", Assets and Owed chips in the hero (net worth is not always assets minus owed: negative balances are left out of the assets ring), any score, "Check overlap" row markers, "This week by person", per-member counts.
4. **Income color:** income stays the app's positive color (deep green) rather than the prototype's teal, because that is the existing semantic color for money in.
5. **Family wording** ("belong to them", "Responsibilities") kept as is. D3.2 proposed "show up here" and "Tasks that name a member" to avoid implying ownership; this is an owner decision.
6. **New restating words on Household:** "Not spent yet", "Plans, not payments", "Backed by a record", "not added, and not zero", "Read-only: nothing here changes a record", and the three pills. Each restates what the page already said; review the wording.
7. **Household bars** (Recorded split, area bars) are drawings of existing figures (a ratio), no number is shown from them; hidden with Hide amounts.
8. **Get started** is collapsed by default, so a first-time visitor sees only the next step until they open "Show all steps".
9. **Needs review is always on the page, now near the top,** and says "Nothing needs a look." when empty (the same words as before).
10. **Not seen live:** Home with saved net-worth history (the white chart band under the dark hero, and its colors on the band); "Calm teal", "Forest" and "Deep navy" for these pages; real phones, screen readers, forced colors, Safari and Firefox.
11. **Tooling note:** `gh` is not installed, so release status was read from the public GitHub API. A one-line install would make later gates simpler.
12. **Contrast and tooltips:** the Income vs spending tooltip is the browser's native title (no custom popup); a custom keyboard tooltip would be a new component (deferred).

## 21. Git status at the end

```
M docs/BACKLOG.md
M docs/CHATGPT-HANDOFF.md
M docs/UI-COVERAGE.md
M src/modules/family/HouseholdSections.tsx
M src/modules/family/OverviewPage.tsx
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
?? docs/LEDGER-SIGNATURE-D12-REPORT.md
?? docs/UI-DESIGN-D0-AUDIT-2026-11-10.md
?? docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md
?? scripts/dev-demo-seed.ts
?? src/modules/family/d12Family.test.tsx
?? src/modules/household/d12Household.test.tsx
?? src/pages/d12Contrast.test.ts
?? src/pages/d12Home.test.tsx
?? src/pages/home.css
```
(`dist/` and `node_modules/` are ignored. The report itself is the last new file above.)

Nothing was staged, committed, pushed or deployed. No branch, remote or repository was created. No dependency was added. `docs/BACKLOG.md` and `docs/CHATGPT-HANDOFF.md` were updated in this batch (they say built, uncommitted, awaiting review).
