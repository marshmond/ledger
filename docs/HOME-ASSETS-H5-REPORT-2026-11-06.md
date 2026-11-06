# Home & Assets H5: overview, Today card and final acceptance — implementation report

Date: 2026-11-06. Status: see "Final follow-up" at the end (architecture approved; committed and deployed after the follow-up; the sections below describe the build as first reported, with test counts as of that report).
Home & Assets is not formally closed until review, owner acceptance (section 17) and a successful deployment.

## 1. Executive summary

`#/assets` now opens on an **Overview** that answers five questions: what needs attention, what maintenance is coming, which warranties end soon, what work was done lately, and what was spent. The old list is now "All assets" (`#/assets/list`); every asset page, filter and form is unchanged. A **Today card** ("Home & Assets", counts only) was added through the existing `todayCards` contract.

Nothing new is stored. One read-only reader (`overviewData.ts` → pure `overview.ts`) feeds both the page and the card, and it reuses the existing rules: Tasks' overdue rule, H4's warranty window and implicit/explicit choice, H2's "unsaved" and "saved twice" rules, H4's orphan detector and H3's `spend()` (unchanged). No second financial, recurrence, reminder or AI mechanism was added.

Results: **1,618 tests pass** (was 1,586; 32 new), `tsc --noEmit` clean, production build clean. No schema, backup, sync or dependency change. No Finance, Projects, Tasks, Contacts or Calendar source file was edited.

One shared file outside Home & Assets was changed (`src/shell/Modal.tsx`, a small Tab-key focus trap, section 7).

## 2. H4 deployment verification (prerequisite gate)

| Check | Result |
|---|---|
| H4 shared-task deletion warning | Present in the H4 commit (backlog H4 follow-up; covered by a test) |
| Permanent handoff + maintenance procedure | `docs/CHATGPT-HANDOFF.md`, `docs/CLAUDE-HANDOFF-SOP.md` and the `CLAUDE.md` rule are in commit `89ffde9` |
| H4 committed and pushed | `HEAD` = `origin/main` = `89ffde98d31634f0413cb26197804a941a6cb48b` (after `git fetch`) |
| GitHub Actions | "Deploy to GitHub Pages" run #57 for that SHA: completed, **success** (read from the public Actions API; `gh` is not installed here) |
| Working tree at start | Clean |
| Baseline | The first full run in this session was started in a background shell whose output was lost; the baseline I rely on is the H4 report (1,586) plus a full run after my first code change that showed 1,583 passing and 3 failing, all three caused by my own change and fixed (section 9) |
| Stale documents found | `docs/BACKLOG.md` still said H4 was uncommitted, the handoff said "H4 NOT verified committed", and the README's Home & Assets paragraph had a block of duplicated text pasted into the middle of a sentence (from an earlier phase). All three corrected (sections 16, 18) |

## 3. Overview features implemented

Page: `src/modules/assets/OverviewPage.tsx`. Every line links to the underlying record.

- **Needs attention:** overdue maintenance (counts assets and tasks; first three tasks linked), warranties ending within 60 days, finished tasks not saved to service history (links to the asset), jobs saved twice, records that point at a missing asset (link to the repair card on the list page), linked payments that need a second look. When none apply: "Nothing needs attention right now."
- **Upcoming maintenance:** the next six dated, open Tasks linked to assets in use. One row per task, even when linked to several assets ("Dishwasher +1 more"). Overdue is marked in words and colour.
- **Warranties ending soon:** asset, warranty title, end date, days left, provider name (from Contacts), link to that warranty.
- **Recent service history:** the six latest service records (by service date), with asset, kind, provider and cost as an amount, "cost not recorded" or "cost needs review".
- **Spending on assets:** period selector (each year that has data, plus All time), total, maintenance/repairs, other groups, from Finance versus typed, by property or top-level asset, review/unknown/undated notes (section 6).
- **Empty state:** with no assets, one explanation and an "Add your first asset" button.
- Navigation: "All assets" and "Add asset" in the header; asset pages and the list have "← Overview" back links.

## 4. Today integration

`src/modules/assets/todayCards.tsx`; registered in `index.tsx`. Id `assets.attention`, title "Home & Assets", half width, `hideWhenEmpty`, priority 38 (after Projects, before Ledger's cards).

- Counts only, in the same wording as the Overview (`overviewText.ts` is shared). It never lists a maintenance task (Tasks already put overdue tasks on Today; confirmed in the browser: the task appears once, in Today's Overdue card). Warranty dates stay on the Calendar's Home & Assets layer; the card creates no Calendar item or Task.
- No money, no asset names, no serial numbers, plates, addresses, account details or document links, so "Hide amounts" has nothing to hide. Tested by searching the card text for planted names, identifiers and amounts.
- The card calls `reportEmpty(true)` when nothing needs attention, so it disappears.

## 5. Maintenance and warranty aggregation

- "Open maintenance" = open Tasks linked (either direction) to a live asset that is **in use** (not archived; In use or Stored; the same test `showsWarrantyMarkers` that decides Calendar warranty markers). Overdue = Tasks' own `isOverdue`. A task linked to a retired and an in-use asset counts, for the in-use one.
- Links are read once per direction with an index range (`loadAssetLinks`), not once per asset. Links to missing assets are ignored (they are the orphan detector's business).
- Warranties: H4's `effectiveWarranties` (the old single date is hidden once a real record exists) and `warrantyStatus` (`soon` = within 60 days, end day included; expired never counts). A test asserts the Overview's warranty dates equal what the Calendar provider returns for the same window.
- Saved-twice jobs: H2's `duplicateTaskGroups`. The Overview only counts them; the per-record warning and delete buttons stay on the asset page.

## 6. Financial spending summary and safeguards

Everything goes through H3's `spend()`; `overview.ts` only chooses which records and references go in and groups the result. A test proves the household figure equals `spend()` over all records.

- **Household vs place:** the household figure counts each payment once. Per-place rows (the property or top-level asset an item sits under) are separate runs of `spend()`. If one payment is linked in two properties, each place counts it once and the places add up to more than the household total; the page says so when that happens.
- **Periods:** a year narrows by each piece's own date. A Finance reference counts in the year of its live transaction date (falling back to the date stored when linked, then the record's date), so one job paid across New Year splits correctly by payment. A typed cost counts in the year of its service or purchase date. A typed cost with **no date** is in no year: the page says "N typed costs have no date, so they appear only under All time." Lifetime costs are never presented as this year's.
- Unknown cost is reported ("N service records have no cost recorded"), never shown as $0; a property whose only records have unknown costs reads "no cost recorded", not $0.00.
- Missing, changed-split or transfer references are left out of totals and counted. The count in Needs attention is lifetime even when a single year is selected, so a stale payment cannot hide behind the year filter (tested).
- Project money is not read at all. The page states "Project spending is not included."
- No aggregate is stored. No Finance table is written (a test snapshots moduleRecords, links and transactions before and after reading).

## 7. Usability and accessibility improvements

Changes: Overview as the landing view; plain-language headings and empty states; "All assets" vs "Overview" back links; phone tap targets for the main link of each overview row (44 px, measured); `Modal` Tab trap.

Review results (browser, invented data):

| Check | Result |
|---|---|
| Overview at 375 px | No sideways scroll (`scrollWidth` = 375); no overflowing elements |
| Overview tap targets at 375 px | Main row links 44 px after the CSS fix (were 20 px). Secondary inline links inside sentences remain text-sized |
| Dark theme contrast (measured) | Body text ≈ 13.9:1, links 15.2:1, muted 6.5:1, overdue red 6.6:1, OK and warning lines 6.0 and 8.6:1; all above 4.5:1 |
| Status without colour | Overdue says "Overdue, was due …"; attention lines carry a ⚠ and words |
| Replace dialog (H4) | `role=dialog`, `aria-modal`, named; all inputs labelled; fits the viewport; Escape closes and **focus returns to the Replace button** |
| Tab inside dialogs | **Defect found:** the shared dialog let Tab leave to the page behind it. **Fixed** in `src/shell/Modal.tsx` (Tab and Shift+Tab wrap inside the topmost dialog); verified by key presses in the browser |
| Orphan repair card (H4) | Controls labelled; Re-home disabled until a target is picked; re-homed a record and the Overview totals updated |
| Transaction picker (H3) | Inside the service form; every control labelled; picking buttons say which transaction |
| Not met / recorded | Several controls are 40 px tall (picker, orphan card, selects), under a 44 px target; the dialog close "✕" is 32 px; pressing Escape inside the picker closes the whole form (existing shared behaviour). Not redesigned in H5 |

**Not done: no real screen reader was used. Keyboard coverage is limited to the dialogs above plus native button/link behaviour; I did not tab through every page.**

## 8. Exact files changed

New: `src/modules/assets/overview.ts`, `overviewData.ts`, `overviewText.ts`, `OverviewPage.tsx`, `todayCards.tsx`, `h5-overview.test.ts`; `docs/HOME-ASSETS-H5-REPORT-2026-11-06.md`.
Edited: `src/modules/assets/AssetsModule.tsx` (routes), `AssetsPage.tsx` (title/back link), `index.tsx` (card, route path `/list`), `h3.css` (overview styles), `assets.test.ts` (one test: the duplicate-module check now strips the card so it still tests the Quick Add clash it was written for), `src/shell/Modal.tsx` (Tab trap); `README.md`, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`, `docs/module-hooks.md`.
Not touched: `package.json`, `src/db.ts`, anything under backup or sync, Finance, Projects, Tasks, Contacts, Calendar.

## 9. Automated test results

- `npm test`: **1,618 passed, 101 files** (baseline 1,586). `npx tsc --noEmit`: clean. `npm run build`: clean (the existing large-chunk warning only).
- **One flaky failure seen once in about 9 full runs:** `src/core/core.test.ts > shared data store > queries and tells you when something changes` (it waits 100 ms for a live query). It is a pre-existing timing-sensitive test I did not touch, and it passed on every other run. Not investigated further.
- My own first full run failed 3 tests, all caused by H5 and fixed: the page-address check (inline `to="/list"` is read as a Ledger path, so the addresses are constants), the Quick Add duplicate-module test (now also carried a Today card), and an arithmetic slip in a new test.
- New tests (32, `h5-overview.test.ts`): upcoming maintenance de-duplication and ordering; Tasks' overdue rule (due today is not overdue); archived/sold/disposed/replaced suppression and the stored-asset exception; retired plus in-use link; empty data; 60-day warranty edges, implicit-once, expired ignored, agreement with the Calendar provider; recent service cost display; one job not shown twice; unsaved-task counting per task and H2's per-asset rule; saved-twice; spending de-duplication across records, assets and hierarchy; place totals vs household; year boundaries (Dec 31 / Jan 1) and a record paid across two years; undated typed costs; unknown cost; stale references (changed split, deleted, turned into a transfer) in a year and lifetime; cycle-proof `rootOf`; `spend()` equality; orphan counting; Today card registration, counts-only text, privacy strings, no repeated task title, hides when empty, reading writes nothing; search shows no private field; backup export/restore gives an identical overview; two real `SyncEngine` devices converge on the same overview; no table changes and Dexie still 15; a 301-asset performance tripwire.
- **Mutation check:** with the "in use only" filter removed, 2 tests fail; restored, all pass. (A second mutation, dropping the typed-cost clearing on year slices, changed nothing observable, so that line only suppresses a notice; its comment was corrected.)

## 10. Desktop and mobile browser verification

Dev server, Browser pane, **a throw-away pane database** (invented "Demo …" assets, tasks, warranties, service records and a transaction; the owner's real data lives in another browser and was not touched).

Verified: Overview at desktop (light) and 375 px (light and measured dark); values compared with the seeded records (overdue task, two warranties, one unsaved task, recent history with a Finance-linked $240.00 and typed $65.00, spending $305.00 split $240.00 + $65.00); Today card (three counts, task not repeated); creating an orphan, seeing it counted, following the link, re-homing it, and the Overview then showing $115.00 for the car; the dialogs in section 7.
**Not verified in the browser:** the full H1–H5 desktop scenario of the brief (a split-transaction reference, a replaced appliance through the dialog, retirement of a property with its contents, backup restore, offline reload) was exercised by automated tests only; dark-mode screenshots (contrast was measured, not looked at); each Overview link was not clicked individually.

## 11. Offline, backup and sync verification

Automated only (real `SyncEngine` and merge, in-memory databases): a service record and a warranty made on device A appear on device B and both Overviews match after sync; a restored backup yields an identical Overview; reading the Overview changes nothing. Earlier suites (H1–H4) already cover: asset deletion versus service/warranty creation, replacement versus a stale device, Project/Asset links, backup revival and orphan repair. Not re-run as separate H5 scenarios: service record or warranty created offline then synced after a stale-asset deletion, and financial references resolving after a transaction syncs (the Overview re-reads live transactions, and the H3 sync suite covers the reference rules). **None of this was tested on real devices.**

## 12. Finance, Projects, Tasks and Calendar regression results

All existing tests pass (no Finance, Projects, Tasks, Contacts or Calendar file edited; `git diff` shows only the files in section 8). Finance balances and Reports are untouched. Tasks: maintenance remains ordinary Tasks, recurrence and "Done, log it" untouched, the H2/H4 suites pass. Calendar: warranties still come only from the Home & Assets provider (agreement test), maintenance only through Tasks, no stored events. Projects: no read of project money. Contacts: provider names are looked up when shown; a removed contact shows no name and breaks nothing.

## 13. Performance findings

- Reads per Overview: assets, warranties, service records, links (two indexed range reads), tasks (only when a task link exists), orphan scan, one bulk transaction read for referenced transactions; then in-memory work. No per-asset database query, nothing cached or stored.
- Invented dataset (301 assets, 400 tasks linked to two assets each, 300 service records, 100 Finance references, 100 warranties): **about 160 ms** for the whole read and build in the test environment. The test only fails above 5 s (a tripwire, not a benchmark).
- Limits: the Overview and Today card re-read when the underlying tables change (live query); the "unsaved task" step compares each in-use asset with each task link, which is fine at hundreds and would need an index at many thousands. The orphan scan is the same one the list page runs.

## 14. AI-readiness assessment (design only; nothing built)

The existing pure readers already give a safe read-only surface: asset identity and lifecycle (`publicLabel`, status), upcoming maintenance and attention (`buildOverview`), warranty status (`warrantyStatus`), recent service history (`ServiceRow`), verified spending (`spend`, `buildSpending`) and records needing attention (`Attention`). `loadOverview(period)` returns most of this in one call with no private field in it (labels are names only).
**Recommendation: do not add an AI context interface now.** A thin wrapper would only rename `loadOverview` and would be a guess before Ask Ledger's real questions are known. When Ask Ledger is designed, add one small read-only module (a function returning a minimised, name-only snapshot, with a separate explicit step for anything private) next to these readers. Principles to keep (also in the handoff): explicit control of what is shared, minimum data, local-first, figures calculated by Ledger and never generated by a model, read-only before assisted writes, confirm before any change, no API keys in the browser. No dependency, service, key, chatbot or vector store was added.

## 15. Judgment calls and deviations from H0 (please review)

1. **Attention suppression:** archived and sold/disposed/replaced assets raise no attention (overdue tasks, warranties, unsaved tasks); Stored assets still do, matching the Calendar rule. Their history and spending still count. A task finished on a retired asset therefore does not appear under "not saved". 
2. **Year = each piece's own date** (Finance payment by transaction date, typed cost by service/purchase date). This differs from "everything on the record's date" and is why a job paid across New Year splits.
3. **Undated typed costs** appear only under All time (H0 wanted "spend this year by property"; H3 data has no date for them).
4. **Lifetime review count** in Needs attention, even when a year is selected.
5. **Places can exceed the household total** (shared payment); stated on the page rather than prevented.
6. **Default period** is the current calendar year; the selector lists years that have data.
7. **Route change:** the list moved to `#/assets/list` and `#/assets` is the Overview. Existing links to the list (none found outside the module) would land on the Overview.
8. **Shared Modal changed** (Tab trap) although it sits outside Home & Assets; judged small, generic and safe, and verified. It affects every dialog in the app.
9. **Today card text** is count-only by design, so it never names the asset or task; the Overview names them.
10. **The printable asset sheet** (an optional H0 item) was not built.
11. **Saved-twice** is a count on the Overview; the resolving UI stays on the asset page.

## 16. Outstanding limitations

Real devices, screen reader, offline reload and older builds untested; 40 px controls and the 32 px dialog close; Escape in the picker closes the whole form; whole-record last-writer-wins; identical split parts are interchangeable to the H3 check; plain backups are unencrypted; old completed tasks all show as "not saved" (no bulk dismiss); a simultaneous replacement on two devices can leave an extra replacement asset (H4); the one pre-existing flaky core test (section 9).

## 17. Real-device acceptance checklist (owner)

Use a throw-away copy or invented data where possible. **Every line is NOT TESTED**; nothing below was done on a real device.

| # | Check | Status |
|---|---|---|
| 1 | Desktop browser: open Home & Assets from the deployed site; Overview matches the asset pages (counts, dates, one spending figure you can add up by hand) | NOT TESTED |
| 2 | Phone browser: Overview readable, no sideways scroll, rows easy to tap, Today card shows and opens Home & Assets | NOT TESTED |
| 3 | Add a property, an appliance inside it, a vehicle; find one by search | NOT TESTED (browser pane only, earlier phases) |
| 4 | Add maintenance, finish it with "Done, log it", see it under Recent service history once | NOT TESTED on device |
| 5 | Link a Finance transaction (one split part); edit the split in Finance; the Overview counts it under "second look" | NOT TESTED |
| 6 | Replace an appliance; its open task moves; history stays on the old one | NOT TESTED on device |
| 7 | Warranty ending within 60 days shows on the Overview, the Calendar layer and the Today count | NOT TESTED |
| 8 | Offline: turn off network, reload, open Overview and an asset page | NOT TESTED |
| 9 | Backup: export, restore into a fresh browser profile, Overview matches | NOT TESTED |
| 10 | Two devices: create a service record on one, sync, see it on the other | NOT TESTED |
| 11 | Two devices: delete an asset on one while the other adds a service record; check what survives and what the Needs attention card says | NOT TESTED |
| 12 | Keyboard only: reach Overview links, open Replace, Tab around, Escape | NOT TESTED beyond the dialog checks in section 7 |
| 13 | Screen reader (VoiceOver, TalkBack or NVDA) over the Overview and Today card | NOT TESTED |
| 14 | Dark mode on the phone | NOT TESTED (contrast measured only) |

Outstanding acceptance risk: two-device behaviour and offline use remain unproven outside simulation.

## 18. Backlog and handoff confirmation

Handoff updated: **yes**. Changed: snapshot (H4 deployed with SHA and run, H5 built and uncommitted), phase status for H4 and H5, open risks, change log, next action. `docs/BACKLOG.md`: new H5 status on top, H4 heading corrected to deployed, handoff line corrected. `README.md`: Home & Assets paragraph repaired (it had a duplicated block spliced into a sentence) and extended for the Overview, warranties and the Today card. `docs/module-hooks.md`: the card is listed. Still unknown: the H5 commit SHA and deployment (nothing is committed).

## 19. Git working-tree status

`main`, equal to `origin/main` (`89ffde9`). Uncommitted: 10 modified files and 7 new files (listed in section 8). No stash, no branch, nothing staged.

## 20. Commit-readiness recommendation

Ready for architectural review. Suggested conditions before commit: review judgment calls 1, 2, 3 and 8; decide whether the 40 px controls need a follow-up; then the owner's explicit go-ahead. After the push, check the Actions tab for a green run and record the SHA in the handoff during the next authorized change. Home & Assets should be treated as closed only after the checklist in section 17 has been worked through.

---

## Final follow-up (after architectural review)

Review verdict: H5 architecture approved, with one required safeguard: automated tests for the shared Modal's keyboard behaviour.

- **Change:** the key and focus logic that was inside `src/shell/Modal.tsx` moved, unchanged in behaviour, into a plain function `attachModal` in `src/shell/modalKeys.ts` so it can be tested (the test environment has no browser DOM and no DOM library was added). `Modal` now calls it from its effect. Its props, markup and the click-outside and ✕ close paths are untouched.
- **Tests (`src/shell/modalKeys.test.ts`, 11):** Tab on the last control wraps to the first; Shift+Tab on the first wraps to the last; Shift+Tab from the dialog box itself goes to the last control; Tab in the middle is left to the browser; stray focus is pulled back in; hidden and disabled controls are skipped; a dialog with no focusable controls neither traps nor throws; focus moves in on open and returns to the opener on close, and the listener is removed; a field that already has focus keeps it; with two dialogs only the topmost traps (the one underneath never takes focus); Escape closes once and is not passed on, Tab alone does not close; Escape still works when no box is mounted. **Mutation check:** with the "topmost dialog only" line removed, the nested-dialog test fails (a first, weaker version of that test did not catch it and was strengthened); restored, all pass.
- **Limits, stated plainly:** these tests use a small fake page, not a real browser, so they prove the logic, not rendering; the real-browser checks (Shift+Tab wraps to the last control, Tab wraps to the first, Escape closes, focus returns to the opener) **were repeated after the extraction** on the Replace dialog and behaved the same. Existing limit kept: with two dialogs open, Escape is heard by both (covered by a test that records it). The close button is 32 px and several controls are 40 px (unchanged; still open).
- **Final checks:** `npm test` **1,629 passed, 102 files** (1,618 + 11); `npx tsc --noEmit` clean; `npm run build` clean. `git diff` shows no change to Finance, Projects, Tasks, Contacts, Calendar, `package.json`, `src/db.ts`, or any backup or sync file; schema still 15.
- **Reliability issue recorded:** `src/core/core.test.ts > shared data store > queries and tells you when something changes` failed once in about nine full runs (it waits a fixed 100 ms for a live query). It is intermittent under load and pre-existing; not fixed here. Outstanding.
- **Still open:** the 40 px and 32 px controls, and every item in the real-device checklist (section 17, all NOT TESTED).
