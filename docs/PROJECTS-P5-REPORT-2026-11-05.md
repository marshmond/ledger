# Projects P5 (final visualizations): implementation report

Date: 2026-11-05. Built on P4B (`6545763`, deployed successfully). Plan: `docs/PROJECTS-P5-PLAN-2026-11-05.md`. Invented data only. **Nothing is committed, pushed or deployed.** Home & Assets not started.

## Status
| | |
|---|---|
| Prerequisites | `6545763` is on `origin/main` and its GitHub Pages run succeeded (read from GitHub's public API); the working tree held only the two expected plan/backlog documents; the baseline suite passed (1,340). |
| Tests | 90 files, **1,366 tests pass** (was 1,340; 26 new in `src/modules/projects/p5.test.ts`). Every earlier test, including all P4A allocation and P4B deletion/sync tests, passes unchanged. |
| TypeScript / build | `tsc --noEmit` clean; production build succeeds. |
| Schema / backup / sync | **No change.** No table, migration, sync or stored-record change; no new dependency. |
| Financial calculations | **No change.** The chart only reads `ProjectSummary` and `ContractSummary`. |

## 1. Features implemented (all eight plan items)
1. **Project cost bar** ("Where the money goes", between "Needs attention" and "Budget by line"): big **Expected total cost** figure, one bar, one segment per budget line by its expected cost, legend with share and exact amount.
2. **Agreement bar** ("Where this agreement goes") inside every split agreement, by agreed amount per line (change orders included); unsplit agreements get no bar.
3. **Paid and left** switch on both bars (default Expected cost / Agreed). Two-tone segments (dark = paid, light = left); legend columns Paid, Left to pay, and the part.
4. **"No budget line"**: a neutral hatched segment when it holds real cost (with the reason in the legend); when it is only a balancing figure it is not drawn and a note says so.
5. **Responsive, accessible, theme-aware**: reuses the shared chart colours `--s1` to `--s8` (light and dark); legend stacks into labelled rows at phone width; legend is the accessible data table; the bar has one descriptive label; parts are keyboard-focusable with their own labels and a live caption; hatching and words so nothing depends on colour.
6. **"See spending over time"** link in the project card to `#/ledger/reports?project=<id>`; Reports opens on the Trends tab with that project selected, shows the "Only: project" chip, and tidies the address. A missing, non-numeric or deleted id leaves the filter off.
7. **Project CSV**: filtered download is named `project-<safe-name>-spending-<from>-to-<to>.csv` and has no Income row; the unfiltered download is unchanged byte for byte (pinned by a golden-string test).
8. **Regression and browser verification** (sections 5 to 7).

## 2. Exact files
**Created:** `src/modules/projects/CostBar.tsx`, `src/modules/projects/p5.test.ts`, `docs/PROJECTS-P5-PLAN-2026-11-05.md` (the approved plan), this report.
**Modified:** `src/modules/projects/financialView.ts` (`buildCostBar`, `projectCostBar`, `agreementCostBar`), `Financials.tsx` (the card and link), `Commitments.tsx` (agreement bar), `ProjectPage.tsx` (passes the project id), `projects.css`, `src/lib/reports.ts` (`projectCsvName`, `categoryCsv` option, link helpers), `src/pages/ReportsPage.tsx` (arrival link, filtered CSV), `docs/BACKLOG.md`.
**Untouched on purpose:** the shared Investments `AllocationBar` and everything in `src/pages/charts.tsx`.

## 3. Design deviations and explanations
1. **A sibling component instead of reusing `AllocationBar`.** The shared bar has no paid/left view, no negative handling, no neutral segment and is used by Investments; the plan said not to change it. `CostBar` uses the same colour tokens and visual language.
2. **Tooltips became a live caption under the bar** (hover or focus shows the part's figures there). It works by touch and keyboard and is read out by screen readers; a floating tooltip does neither well.
3. **`No budget line` is never labelled "paid beyond its share".** Found during browser checks: its negative "left" only balances other rows. The label is for budget lines only; its legend row says "balances the lines".
4. **Colour slots follow the line's place in the project's own order** (stable when amounts change). With more than seven lines, the seven largest keep their own colour and the rest are grouped as "Other lines (n)", which takes the eighth colour.
5. The "Paid and left" notch for a line paid beyond its share is a small red corner at the end of its segment, plus words in the legend and caption.

## 4. Visualization edge cases (all tested)
- **Zero expected cost:** no bar, "nothing to show as parts of a whole", exact rows still listed. **Negative total:** no bar, says money back exceeds spending, exact rows listed. **No lines:** an empty state.
- **Positive segments offset by a negative line:** the bar still draws the positive parts, but says "the parts drawn add up to X, not to the expected total of Y, because C (−Z) offsets part of it", shares are of the parts drawn, the negative row is still listed exactly, and the legend (not the bar) adds up to the total. A bar is never shown as reconciling when it does not.
- **Overpaid line:** exact paid and signed left shown, never clamped; flagged in words ("paid beyond its share"); the bar's width is the line's expected cost (paid plus left) and only the dark fill is limited to the segment width for drawing. The project total is unchanged and the note says the extra comes out of other lines.
- **Unassigned payments:** on the project bar they appear in the "No budget line" row; on an agreement bar as "Paid, line not chosen", listed but not drawn as a cost.
- **More than seven lines:** grouped; the group's legend row lists every member with exact figures and its figures add up to the summary.
- Removed line and stale split rows keep reconciling with the dashboard.

## 5. Tests added and results
26 tests in `p5.test.ts`: normal multi-line allocation; single-line and multi-line agreements; accepted negative change order; partial payment (paid plus left equals the part on every row); overpaid line (exact negative left, words, no clamping); zero, empty and negative totals; positive segments offset by a negative line; balancing-only versus genuine "No budget line"; unassigned payment on an agreement; removed line and stale split; more than seven lines (grouping, members, colour stability, no grouping at seven); a **200-seed property test** over messy random projects (the exact legend rows always add up to `expectedTotalCents`, paid adds up to `paidCents`, a drawn bar only claims to reconcile when it does); CSV (unfiltered golden string, option objects change nothing, project view drops only Income, only the selected project, split parts once, credits and reversals netted, selected months only); safe file names (spaces, accents, path tricks, dots, symbols, empty, very long); deep-link helpers (address, non-numeric ids, deleted or unknown project).
**Full suite: 90 files, 1,366 tests pass.** `tsc --noEmit` clean. `npm run build` succeeds.
Note: a bug in my own script (a regex lost its backslash) was caught by the deep-link test and fixed before anything else; a second copy of the same mistake in the page was found by reading the code and replaced with a direct name lookup.

## 6. Browser verification (invented data, desktop and 375 px, dark and light, Verify House and a 10-line project)
- **Project bar:** three coloured segments, $45,000.00, legend with shares; the balancing-only "No budget line" correctly not drawn, with its note; Plumbing marked "paid beyond its share".
- **Paid and left:** two-tone segments, the notch on Plumbing, legend with exact signed left (−$1,000.00 paid beyond its share; −$3,500.00 "balances the lines" on No budget line). The toggle state persists across updates.
- **Agreement bar:** correct figures, "Paid, line not chosen" listed apart from the lines.
- **Keyboard and labels:** Tab reaches the toggle, then each part in order; each part has an accessible label ("Electrical: 33.3%, $15,000.00"); the live caption updated on focus; the bar has one summary label.
- **Reports deep link:** from the project card the Trends tab opened filtered to the project with the chip, address tidied; an unknown id (`project=999`) on a fresh load left the filter off and tidied the address.
- **CSV download:** filtered file `project-verify-house-spending-2025-12-to-2026-11.csv` with no Income row and a total of $32,500.00 (the project's paid); the unfiltered file `spending-2025-12-to-2026-11.csv` kept its name and its Income row.
- **Phone (375 px) and dark:** no horizontal overflow on the project page; the 10-line project showed eight distinct colours with "Other lines (3)" and a stacked legend; the hatched "No budget line" swatch was visible.
- **Console:** no new errors. (The pane's buffer still holds one old entry from the earlier P4A session, `noLineNotes is not defined`, with a file timestamp from before this work; the pages involved render correctly.)
- **Defect found and fixed during this check:** "No budget line" wrongly showed "paid beyond its share" (see deviation 3); re-checked afterwards.
The owner's real data was not touched (the pane's own invented data only).

## 7. Financial regression results
All P4A allocation and reconciliation tests and all P4B deletion and sync tests pass unchanged. The property test confirms the bar's legend always reconciles with `ProjectSummary`. The unfiltered CSV is byte-for-byte identical (golden test) and the unfiltered Reports matrix is unchanged (existing P4B tests). The filtered CSV total equals the project page's paid figure in the browser.

## 8. Backup and sync impact
None. Nothing new is stored. The component reads existing summaries; the link and CSV changes are in screens and a pure helper.

## 9. Known limitations
- No component-level test tooling exists (no DOM test library), so the screen behaviour (toggle, focus caption, deep-link effect) is verified in the browser, and the logic behind it in pure, tested functions.
- In "Paid and left", a segment is drawn at its expected-cost width with the paid portion limited to that width; a paid amount larger than the expected cost is shown by the notch and the exact legend, not by a longer bar.
- The shares of a bar that does not reconcile are of the parts drawn (the note says so).
- Agreement bars appear only on split agreements.
- Only the Trends tab filters by project; the Flow diagram is unfiltered, as before.
- A project name with only symbols gets the file name `project-project-spending-...`.
- Real-device checks (two devices, offline, older versions) remain in the separate acceptance checklist in the plan and are **not** part of this verification.

## 10. Git working-tree status
Modified: docs/BACKLOG.md, src/lib/reports.ts, src/modules/projects/{Commitments, Financials, ProjectPage}.tsx, financialView.ts, projects.css, src/pages/ReportsPage.tsx. New: src/modules/projects/CostBar.tsx, src/modules/projects/p5.test.ts, docs/PROJECTS-P5-PLAN-2026-11-05.md, this report. Nothing staged; `HEAD` is `6545763`.

## 11. Commit-readiness
Ready for architectural review and the owner's approval to commit. All checks pass and the tree holds only P5 work. The separate real-device acceptance checklist (plan section 6) should be run on the deployed site after release.
