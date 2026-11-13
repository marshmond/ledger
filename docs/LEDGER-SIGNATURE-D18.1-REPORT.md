# Ledger Signature D18.1: Person-Centric Income Organization

Date: 2026-11-13. **Built and tested locally. NOT staged, committed, pushed or deployed. Awaiting owner and ChatGPT review. D19 not started. Owner acceptance not given.** American English.

This is a presentation and information-architecture change. No calculation, record, association, schema, migration, backup or sync file changed.

## 1. Release gate (D18)

- Repository `marshmond/ledger` (origin `https://github.com/marshmond/ledger.git`), branch `main`. After `git fetch`, `HEAD` = `origin/main` = `e42361373a4f8fa10bc86417cef1732032e5d24c` ("feat(ui): redesign financial planning workspace").
- Read from the public GitHub API (`gh` is not installed): the workflow "Deploy to GitHub Pages" run **#106** for `e423613` finished **completed / success** (2026-11-13 16:26:45Z); the `github-pages` deployment `7770485329` for the same full SHA has status **success** (environment URL `https://marshmond.github.io/ledger/`). Run #105 (`aba2b9b`) also succeeded.
- The D18 Retirement `PercentField` correction is in `e423613` (`src/pages/fields.tsx` and `src/pages/d18Plan.test.tsx` are in that commit's file list).
- Read: `docs/LEDGER-SIGNATURE-D18-REPORT.md`, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md` (its top notices still said D18 was uncommitted when work began: stale, now corrected).
- Working tree at the start: only the three protected untracked files (`docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`). They were not opened for edit, staged or deleted.

## 2. Architecture found (verified before building)

`IncomePage` read `db.people`, `incomeProfiles`, `bonuses`, `rsuVests` (and, through `RsuGrants`, `rsuGrants`) and built everything with `buildIncomeModel`. Every record points to its person by `personId` (a number); names are only labels. `RsuSection` and `RsuGrants` showed **everyone's** vests and grants in one shared list, with a Person select in the forms, so an unfiltered copy inside each person would have duplicated records; they needed a scope. Nothing in the app deletes a person (no `db.people.delete` exists), and the Income People area only adds (there was no rename or edit of a person to preserve).

## 3. Source files changed

Modified: `src/pages/IncomePage.tsx` (recomposed), `src/pages/RsuSection.tsx`, `src/pages/RsuGrants.tsx` (person scope), `src/pages/ProfileEditor.tsx` (one optional `embedded` prop), `src/pages/Collapsible.tsx` (one optional argument, section 8), `src/pages/PlanParts.tsx` (optional `onJump` on a jump item), `src/pages/plan.css` (new `pw-` rules at the end).
New: `src/pages/PersonWorkspace.tsx`, `src/pages/incomeOwners.ts`, `src/pages/d181PersonIncome.test.tsx`, this report.
Docs: `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`. `docs/UI-COVERAGE.md` was **not** changed (no row changed status; Income, RSU grants and income setup keep their D18 coverage).
**Not changed:** anything in `src/lib` (every engine, including `rsu*`, `income`, `payroll`, `hsa`), `src/db.ts`, `src/types.ts`, sync, backup, Search, Quick Add, navigation outside Income, `package.json`.

## 4. Final page hierarchy (Income)

1. Header with the Year select; tax-table notices (unchanged).
2. **Household hero** (navy, unchanged): take-home (Estimate), gross, Social Security + Medicare with MA PFML, federal and Massachusetts refund or amount due.
3. Jump list: People, one button per person (by id), Needs review (only when needed), Household tax settings, results.
4. **People** (existing section, same add form and chips, plus one sentence that these are Income people, kept separate from Family and not matched to it).
5. **Compensation by person**: one expandable workspace per Income person, in list order, each independent (see 5).
6. **Needs review** (only when records point to a missing person; see 7).
7. **Household tax settings** (unchanged).
8. **Household results** (unchanged contents except that paycheck detail moved to the person): federal and Massachusetts tables, key dates (each named by person), Take-home by month (a column per person and the household), About these numbers.

## 5. Person workspace

Folded header: person name, the selected year, an **Estimate** tag and the income model's own figures: Gross pay, Take-home, Bonus (only if above zero) and Stock awards labeled "counted when they vest" (only if above zero), plus "N notes to read" when the model has warnings. A person with no profile reads "Not set up for 2026" (no zeros); a profile with no model result reads "No 2026 tax tables, so no estimate" or "No 2026 estimate yet". No salary figure is shown in the header (choosing which raise applies would be a new calculation).
Expanded, in order: **{year} at a glance** (the former per-person card, same rows and warnings), **Pay setup** (the existing `ProfileEditor`, same handlers, with its own fold button replaced by a plain heading; or the existing Set up / Copy from prior year prompt), **Bonuses**, **Stock awards (RSUs)** (the scoped section: grants with worksheets, Add a single vest, withholding, vests list, Add to holdings), **paycheck detail** (the existing per-paycheck table and deductions line, moved here from the results).
Several can be open at once; none is required to be. The open choice is remembered on this device under `income.person.<personId>`; first person starts open and the others folded when nothing is saved. Folded content stays mounted, so a half-typed form is kept.

## 6. RSU component scoping

- `RsuSection` and `RsuGrants` gained two optional props: `personId` (show only that person's vests and grants, found by stored id) and `unassigned` (show only records whose person is not on the page). With neither, they behave as before.
- Scoped: new vests and grants start with the workspace's person, shown as fixed text (no select). The person select appears **only when editing an existing record** (a deliberate move), with a sentence saying the record then moves to that person. A new record cannot be saved under another person (the saved owner is forced to the workspace person).
- Withholding rows list only that person's income profile for the selected year; "no price" and "no income setup" warnings are computed from that person's vests only; Show every year is scoped to the person; the Person column is dropped in a person's list.
- Fixed a latent clash: radio groups (`rsukind`, `rsuafter`, `grantkind`, `grantafter`) shared one name per page, so two people's forms would have shared a group. Each form now has its own `useId` name.
- Vest dates, shares, prices, valuation, cost basis, `recordHeldVest`, `saveGrant` and `deleteGrant` are untouched. Renaming a grant's person still moves its vests (existing `saveGrant` behavior).

## 7. Record ownership safeguards, incomplete setup and orphans

- Ownership is only ever the stored `personId`. Nothing matches by name, nothing is reassigned or repaired automatically, and drawing, opening, folding or jumping writes nothing.
- A person with no income profile for the year stays visible with a setup prompt, and their bonuses and stock awards remain reachable. Opening them creates no profile. Switching to a year with no profile never copies silently: the existing **Set up {year}** and **Copy from {year-1}** buttons are the only way.
- **Needs review.** Bonuses, vests and grants whose `personId` matches no person are listed in a clearly labeled section (all years), using only the existing actions: a bonus can be deleted; a vest or grant can be edited, which lets the owner choose a person (an explicit move). It is shown only once the people list has loaded, so it cannot flash while data is loading. The hero and all totals are unchanged by such records (not counted in anyone's figures). Not handled: an income profile for a missing person (it showed nowhere before either).

## 8. Collapse-state change (please review)

`Collapsible`'s saved state only remembered "collapsed" (open was the default, so opening forgot the key). A section that **starts folded** would then reopen folded after a reload. `writeCollapsed` and `useCollapsed` gained one optional flag: a section whose default is closed stores both choices. Sections that default open behave exactly as before (the existing `income-ui` tests and two new tests pin that). Old saved fold states for the previous Income sections (`income.bonuses`, `income.rsu`, `income.p<id>`) are no longer used on this page.

## 9. Tests and build

- New `src/pages/d181PersonIncome.test.tsx`: **24 tests**, all pass (ownership scoping by id including two people with one name; the new-bonus owner; stable keys; the header summary and "Not set up"; explicit fold storage; the first person open and the next folded, with folded content still in the page; RSU section scoped to one person, to the review list, and unscoped as before; fixed owner and no person select on new records; per-person withholding; unique radio names; source guards that the header and jump touch no database, that review records are never written, and that no profile is created by opening a workspace).
- Targeted run `src/pages`, `src/shell`, `src/lib/rsu*`, `src/lib/income*`: **632 tests in 33 files, 0 failures**. `npx tsc --noEmit` clean. `npm run build` succeeds (usual large-chunk warning).
- **The full suite was not run locally**, as instructed.

## 10. Browser checks (fictional data, real clicks and events)

Headless Chrome 157 on the dev server at `localhost:5231`, own browser profile, fictional household (Avery Test and Jordan Sample; Avery has a cash grant, Jordan a stock vest and a cash vest, a bonus each, a 2025 profile for Avery only). Checked:

- First person open and second folded by default; A closed/B open; both open; both closed; reload keeps each state; storage keys contain person ids and no names. Toggling changed no record (database snapshot identical).
- Jump button for a folded person opens it and moves focus to it.
- Each person's salary, bonuses, grants and vests appear only in their workspace.
- Add bonus in Jordan's workspace saved Jordan as owner; Add vest in Avery's saved Avery; New grant in Jordan's saved Jordan; none appeared under the other person.
- Deliberate move: editing a vest and choosing Jordan produced one record owned by Jordan, shown only under Jordan.
- Year 2027: both people still shown, "Not set up for 2027", Copy from 2026 and Set up 2027 offered, nothing written.
- A person added through the form (then three people): appears folded as "Not set up", no profile created by adding or opening; bonus form and stock awards reachable.
- Orphan bonus, vest and grant: Needs review section and jump button appear; none shown under a person; household take-home unchanged; deliberately choosing a person for the orphan vest moved only that vest; the other two stayed.
- A half-edited salary stays (with "unsaved") through fold and reopen and is not written.
- No horizontal page overflow at 1440, 375 and 320 (A open, B open, both folded, dark, Classic). No console errors or page exceptions.

**Not driven (preserved by source review only):** deleting a bonus or vest, Add to holdings, refresh price, the grant worksheet and Fill evenly, editing a grant, saving a profile, Copy from prior year clicks, tax tables. **Not done:** a keyboard Tab walk (the folds are native buttons with `aria-expanded`, `aria-controls` and a visible focus ring), a screen reader, a real phone, Safari or Firefox, forced colors, a contrast measurement.

## 11. Before and after (authoritative values, fictional household, 2026)

Method: the main-area text and every input value were read from the deployed D18 page (a clean extract of `e423613`) and from the new page, with the same data and both workspaces open. **Every amount on the D18 page is present on the new page at least as many times (43 distinct amounts; 83 occurrences before, 91 after: the extra eight are the new header summaries), and every input value is present (71 before, 79 after: the extra eight are the second RSU form and a bonus form per person).** Household take-home $199,716.60; gross $296,000.00; Social Security + Medicare $22,644.12 (MA PFML $1,361.60); federal expected amount due $802.16; Massachusetts expected refund $199.84. Avery Test gross $165,000.00 (bonus $12,000.00, stock awards $3,000.00), take-home $109,164.54; Jordan Sample gross $131,000.00 (bonus $5,000.00, stock awards $6,000.00), take-home $90,552.06. Unchanged. The hero was also unchanged with orphan records present.
Full-page heights, Signature Light, both people open: desktop 7,265 → 8,863 px; phone 13,094 → 16,301. With the default (first open, second folded): desktop 6,026; phone, both folded: 5,101.

## 12. Visual evidence

`C:\Users\alexm\Documents\Ledger-Design-Concepts\D18.1-Evidence\`: `D18.1-SHEET-1-DESKTOP-REVIEW.png` (Before versus After, Person A open, Person B folded), `D18.1-SHEET-2-DESKTOP-PERSON-B-AND-DARK.png` (Person B open; Signature Dark), `D18.1-SHEET-3-MOBILE-REVIEW.png` (Before, both folded, Person B open), `D18.1-SHEET-4-MOBILE-PERSON-B-LOWER.png` (Person B's bonuses and stock awards on a phone), and `_raw\before`, `_raw\after` (full-page captures, including Classic desktop and phone, a 320 phone, `income-values.json`). Labeled D18 Before versus D18.1 After. No approved prototype exists and none was invented.

## 13. Judgment calls (please review)

1. **Key dates stayed in the household results** (each already names its person); paycheck detail moved into the person, with a one-line note left in the results.
2. **The header shows model figures only** (gross, take-home, bonus, stock awards); no salary figure, because choosing the applicable raise is a calculation.
3. **"Stock awards" in the header and at-a-glance is the model's existing `rsuGrossCents` for the year**, which includes vests dated later in the year (they are projections until they happen), exactly as the D18 card did; labeled "counted when they vest".
4. **First person open, others folded by default**, by list order; a saved choice always wins. Needed the small `Collapsible` change in section 8.
5. **A new vest or grant cannot change person in a person's workspace**; only editing an existing one can, with an explanation. In the old shared form every new record had a free person choice.
6. **Needs review is shown for bonuses, vests and grants only**, and starts with every year. It cannot occur through the app today (nothing deletes a person); it can occur after a restore or sync.
7. **The People section stays an open section** with a Family-separation sentence (the old page also opened it), rather than being folded, because an early default-closed state would flicker while data loads.
8. **Per-person stock awards stay a section** (open by default, folds with the same control), so the person's salary and bonuses are reached without opening a nested fold.
9. **Added a left accent border to each workspace** so ownership is visible when several are open.
10. **Old saved fold states** for the former Income sections are not carried over.

## 14. Remaining limitations

Phone pages stay long when a person is open (the pay editor is the same form); folding the other person is the main saving. Hide amounts still does not cover Income. `confirm()` dialogs remain (D20). Income profiles for a missing person are not surfaced. Tab order, screen reader, real devices and other browsers are untested.

## 15. Handoff

`docs/CHATGPT-HANDOFF.md` and `docs/BACKLOG.md` were updated: D18.1 is recorded as built locally and awaiting review, D18 as committed and deployed (`e423613`, run #106), D19 not started. Unknown: the CI result for D18.1 (not released).

## 16. Git status (exact)

See the final reply; summarized: modified, unstaged: `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`, `src/pages/{Collapsible,IncomePage,PlanParts,ProfileEditor,RsuGrants,RsuSection}.tsx`, `src/pages/plan.css`. New, untracked: `src/pages/PersonWorkspace.tsx`, `src/pages/incomeOwners.ts`, `src/pages/d181PersonIncome.test.tsx`, this report, plus the three protected files (untouched). Nothing staged, committed, pushed or deployed; no branch, remote or repository created.

## 17. Final verification and release (2026-11-13)

- **Baseline re-checked:** `main` = `origin/main` = `e423613` (D18); Actions run #106 success; Pages deployment for the same SHA success; D18.1 changes unstaged and uncommitted; protected files untouched. Source unchanged since sections 9 to 11 were written, so the 632 targeted tests, `tsc`, build and before/after comparison apply to the final source.
- **Shared changes reviewed:** `Collapsible` (optional fourth argument; sections that start open store exactly as before), `PlanParts` (optional `onJump`), `ProfileEditor` (optional `embedded`, default false; the Paycheck page does not pass it), `RsuSection` and `RsuGrants` (optional scope props; only Income uses them). No engine, schema or `src/lib` file changed.
- **Smoke check, grant worksheet** (fictional data): "worksheet" on Avery's cash grant opened that grant's four-vest schedule (4 of 4 entered) inside Avery's workspace only; Fill evenly 200 shares replaced the vests with 4 x 50, same four records, same owner, no extra records.
- **Smoke check, Add to holdings** (fictional held stock vest, 40 shares at $40, brokerage account): the button appeared only in the owner's workspace; one click created exactly one tax lot (25 shares, basis $1,000.00, source `rsu`) and one holding in the right account, added $38.24 leftover cash, marked the vest recorded and replaced the button with "in holdings"; the vest count did not change. No error, no console exception.
- **Remaining limitations:** unchanged from section 14; real-device, screen-reader, keyboard Tab walk and other-browser acceptance are NOT done. D19 not started.
