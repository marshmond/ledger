# Ledger Signature D18.2: Person-Level Gross-to-Net Income Breakdown

Date: 2026-11-13. **Built and tested locally; approved by owner and ChatGPT after review; release authorized (commit `feat(ui): add person-level gross-to-net income breakdown`). Release SHA, CI and Pages results are recorded in the release summary and were not verified when this line was written. D20 and D21 not started.** American English.

This is a presentation and aggregation change. No calculation, tax table, record, schema, backup or sync file changed.

## 1. Verified T2027 release (gate)

- Repository `marshmond/ledger` (origin `https://github.com/marshmond/ledger.git`), branch `main`. After `git fetch`, `HEAD` = `origin/main` = `fa5deb716a42c71880e21f06daaf39fe2524e720` ("feat(tax): add verified 2027 tax tables and year-aware rules").
- D19 is released: `bc35331`, Actions run #108 success.
- T2027 owner and ChatGPT approval is recorded in `docs/BACKLOG.md` ("release authorized"); the commit is `fa5deb7`.
- **GitHub Actions and Pages** (public GitHub API; `gh` is not installed): workflow "Deploy to GitHub Pages" run **#109** for `fa5deb7`, completed / success (created 2026-11-13 19:31Z); `github-pages` deployment `7774563284` for the same SHA has a `success` status (2026-11-13 19:33:35Z).
- Read: `docs/BACKLOG.md`, the top and snapshot of `docs/CHATGPT-HANDOFF.md`, and the T2027 notice (the T2027 report file was not re-read in full; its release state is taken from the backlog and the API results above).
- Working tree at the start: only the three protected untracked files (`docs/UI-DESIGN-D0-AUDIT-2026-11-10.md`, `docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md`, `scripts/dev-demo-seed.ts`). They were not modified, staged or deleted.
- A dev server already ran on port 5173 (another session). It was not touched; all browser work used separate ports 5232 and 5233 with throwaway, empty browser profiles, and both servers were stopped afterward.

## 2. Architecture found (verified before building)

- `PersonYear` (from `simulatePerson`) holds one `PayEvent` per paycheck, bonus and stock vest, each with `gross`, per-deduction-id amounts, six withholding fields, `net`, an optional `keptValue`, and yearly `totals`. `totals.gross` is exactly the sum of event gross: regular paychecks, bonuses, and stock vests. Nothing else is in gross.
- A deduction has a stored `type` (`k401_pretax`, `k401_roth`, `hsa`, `health`, `dental`, `vision`, `fsa`, `espp`, `custom`).
- **`keptValue`** (stock vests kept as shares): the event's `net` is set to 0 and `keptValue = max(0, gross - deductions - taxes)`. So per event `gross - deductions - taxes = net + keptValue`, except the edge case where a kept vest would have been negative (then the shortfall silently disappears, see section 9). The source comment on `keptValue` says "in dollars"; the code and every screen use cents. The comment is stale; `payroll.ts` was not changed.
- Employer 401(k) is `employerMatch` per event and never enters `gross` or `net`. Employer HSA is the profile's `employerHsaAnnualCents` (shown in `contributions.employerHsa`) and also never enters either.
- There is **no person-owned "other income"** in the model. The household "Other taxable income" is a household tax setting and was not touched.

## 3. Exact changed files

New:
- `src/pages/incomeStatementModel.ts`: the shared column schema and the pure statement builder (no React, no database).
- `src/pages/IncomeStatement.tsx`: `HouseholdComparison` and `PersonStatementView` (read-only; no inputs or buttons).
- `src/pages/d182IncomeStatement.test.tsx`: 30 tests.
- this report.

Modified:
- `src/pages/IncomePage.tsx`: builds the shared statements once (`useMemo`), draws the comparison under the hero, replaces each person's "At a glance" block with the statement (the model's warnings still show right below it), drops the now unused `Lines` import.
- `src/pages/plan.css`: about 85 appended lines, all `is-` classes, tokens only.
- Docs: `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`. `docs/UI-COVERAGE.md` was **not** changed (L-17 stays `BLT`; no acceptance mark was earned).

**Not changed:** anything in `src/lib` (`payroll.ts`, `income.ts`, `rsu*.ts`, tax data), `src/db.ts`, `src/types.ts`, `RsuSection`, `RsuGrants`, `ProfileEditor`, `PersonWorkspace`, `incomeOwners`, sync, backup, Search, Quick Add, navigation, other modules, `package.json`. No dependency added. No branch, remote or permission added.

## 4. Final visual structure

**Under the household hero:** a "Compare people, {year}" card, one table (see 5).

**Inside each expanded person workspace** (replacing "At a glance"): a read-only "{year} gross to net" statement. On a computer it is one bordered statement of five aligned groups from left to right:

`Income sources` -> `= Gross compensation` (large) -> `- Employee deductions` (seven category lines and a total) -> `- Taxes withheld` (six category lines and a total, with a note that this is not the year's tax bill) -> `= Cash take-home` (largest figure, tinted; "Equity kept as shares" sits under it with the note "Not cash").

Below the statement, a lighter **Employer contributions** strip (employer 401(k), employer HSA). Then the existing pay setup, bonuses, stock awards and the paycheck detail, unchanged.

**Phone (375 and 320):** the same groups stack in the same order: Income sources, Gross, Employee deductions, Taxes withheld, Cash take-home with Equity kept, Employer contributions. In the household comparison each person becomes one labeled list in the same order (a blank item keeps its row with a label and no amount).

Medium widths: the five groups wrap into two columns at 1180 px and below; the comparison table scrolls inside its own region (keyboard focusable, labeled) and never widens the page.

## 5. Shared column schema (`incomeStatementModel.ts`)

One list, built once for the household and year (`buildStatementSchema`), used for every person, in this fixed order:

| Group | Column ids (display label) |
|---|---|
| Income | `wages` (Regular wages), `bonus` (Bonuses), `rsu` (Vested stock awards), `gross` (Gross compensation, total) |
| Deductions | `ded.k401Pretax` Traditional 401(k), `ded.k401Roth` Roth 401(k), `ded.hsa` HSA, `ded.fsa` Health care FSA, `ded.insurance` Insurance premiums (health + dental + vision), `ded.espp` ESPP, `ded.other` Other deductions, `deductions` (total) |
| Taxes withheld | `tax.fed`, `tax.state` (Massachusetts), `tax.ss`, `tax.medicare`, `tax.addlMedicare`, `tax.pfml`, `taxes` (total) |
| Outcome | `net` (Cash take-home), `kept` (Equity kept as shares) |
| Employer | `er.k401`, `er.hsa` |

- Deduction slots come from the stored **type** (`deductionSlotFor`), never from the label. A deduction named "HSA" but typed `custom` lands in Other; one typed `hsa` stays in HSA whatever it is called (tested).
- The order never depends on amounts or on who has what.
- The list can grow in one case only: if some person's gross contains an earning that is not a wage, bonus or stock award, an "Other modeled earnings" column is inserted before Gross **in the same place for everyone** (tested). The model produces no such earning today.
- The household comparison table uses the same schema: income detail columns, then Gross, Employee deductions, Taxes withheld, Cash take-home, Equity kept as shares. Its household row sums only the people who have the item.

## 6. How missing categories keep alignment

Every person's statement has a cell for every column. A cell is one of three states:

- `value`: the person has the item, the model's amount is shown (a real `$0.00` is a value);
- `blank`: the person has no such item; the cell is empty, takes the same space, and carries a spoken label ("Bonuses for Jordan Demo: none entered");
- `unavailable`: the model produced no figures (no setup or no tax tables).

Nothing is built from "this person's non-empty categories". **Measured in the browser at 1440:** for Avery, Jordan and Skyler, the left, top and width of all 21 statement cells are identical (`same_AJ` and `same_AS` both true). The unit test also checks identical cell id order, labels, and per-state differences in the rendered markup.

## 7. Income-source derivation

- **Regular wages:** sum of `gross` over the person's `regular` events (so raises, partial years and pay frequency are what the model already did; the annual salary input is not used).
- **Bonuses:** `totals.bonusGross`; shown only if the person has a bonus event in the year.
- **Vested stock awards:** `totals.rsuGross`; shown only if a vest event exists (the model already excludes unvested and unpriced vests).
- `wages + bonuses + stock awards = totals.gross` exactly (tested, and the check is also run as `otherEarnings` for the optional extra column).
- **Other person-owned income: not built.** The model has none. Household "Other taxable income" is not shown or allocated to anyone.

## 8. Deduction and withholding aggregation

- Each deduction slot sums `totals.deductions[id]` for the profile's items of that type group. A slot has a value whenever the person has at least one deduction of that kind (so a capped or zero one shows `$0.00`); otherwise it is blank.
- "Employee deductions" total sums every event's deductions (the same sum the existing paycheck detail uses). The helper also computes `deductionPlacementGap` (category lines minus total); it is zero for every fixture and would be reported if a deduction were ever unplaceable.
- Taxes withheld use `totals.fedWithholding`, `stateWithholding`, `socialSecurity`, `medicare`, `addlMedicare` and `pfml`, all shown as values once the model calculated (a calculated `$0.00`, for example Additional Medicare, is shown, not hidden). The total is their sum.
- The section says plainly that these are paycheck withholding, not the year's tax bill (the estimated refund or amount due stays in the existing household results).
- Dependent-care FSA has no deduction type in the model; if someone enters one it is typed `custom` and appears under Other deductions. UNVERIFIED how the owner enters it.

## 9. Cash and retained-equity reconciliation

- Cash take-home is `totals.net` exactly. Equity kept as shares is the sum of the events' `keptValue` and is shown only when a kept vest exists. It is not added to cash.
- The helper reports `difference = gross - deductions - taxes - cash - kept`. For every fixture it is **0**.
- Cases the model treats unusually and the display handles honestly: (a) a paycheck where deductions and taxes exceed pay stays negative cash in the model; the statement shows a note naming how many paychecks; (b) a kept vest that would have been negative loses its shortfall inside the model; this would appear as a nonzero `difference` and the statement then prints a plain message ("nothing was adjusted to make it add up"). It does not insert a balancing figure. Neither case occurs in the fixtures; (b) is tested with a deliberately altered result, (a) with a negative paycheck copy.

## 10. Employer contributions

Shown in their own lighter section: employer 401(k) from `totals.employerMatch` when a match is configured, employer HSA from the profile when it is above zero. They are not in gross compensation, not subtracted, and not in take-home (tested by building the same person with and without a match: gross, deductions and net are identical).

## 11. Missing data and genuine zero

- No income setup: the statement keeps the layout, says "Not set up for {year}", shows "Not set up" in Gross and Cash, and the other cells are blank with the spoken label "not calculated". No `$` appears.
- No tax tables (for example 2099): "No 2099 tax tables, so no estimate" and "Not calculated" in the totals.
- The existing folded header summary already did this and is unchanged.
- Genuine zeros: Additional Medicare `$0.00`, a capped HSA, and so on. Blank is only for an item the person does not have.

## 12. Focused test results

- New `src/pages/d182IncomeStatement.test.tsx`: **30 tests, all pass.** Groups: shared schema; alignment in the drawn markup; blank, zero and unavailable; hand-worked amounts; reconciliation; employer contributions; household row totals; tax-year change; presentation-only guards (no database import, no writes, no payroll or tax call, no inline styles, hero then comparison then jump list order, the existing editors still on the page).
- Expected amounts are worked out by hand from invented setups (salary divided by 24 paychecks, percent of pay, 6.2% Social Security with the premium exempt, the stock award arithmetic), not by calling the aggregation helper. They matched on the first run. The statement values are also compared with the model's own totals.
- Related existing tests: `d181PersonIncome`, `d18Plan`, `taxCustomNotice`, `income`, `income-ui`, `payroll`, `payroll2`, `rsu`, `rsuGrant`, and the UI guards `uiCoverage` and `uiResidue`. **Total 12 files, 199 tests, all pass.**
- `npx tsc --noEmit` clean. `npm run build` succeeds (the existing chunk-size warning only).
- The **full suite was not run locally**, as instructed; release CI will run it after separate authorization.

## 13. Browser checks and evidence paths

Browser checks used an invented household (three people: two with setups, one without; one bonus; one cash vest and one kept vest) on a fresh profile at its own port. Checked: desktop 1440, phone 375 and 320, Signature Light, Signature Dark and Classic; no horizontal page overflow at any of those widths (page scroll width equals the viewport); the comparison scroll region has no spurious scroll at 1440; real clicks for independent expansion and collapse of the person workspaces; year switch to 2027 (everyone "Not set up for 2027", layout unchanged; the 2027 tax-table notice still shows) and back; the paycheck detail tables are still in each workspace (25 and 26 rows).

Pictures, folder `C:\Users\alexm\Documents\Ledger-Design-Concepts\D18.2-Evidence\`:
- `D18.2-SHEET-1-DESKTOP-COMPARISON.png` (comparison + two people's statements stacked)
- `D18.2-SHEET-2-EXPANDED-PERSON.png` (Jordan Demo in full, and a person with no setup)
- `D18.2-SHEET-3-MOBILE.png` (375 and 320 statements, the 375 comparison, the second person)
- `D18.2-SHEET-4-DARK-AND-BEFORE-AFTER.png` (Signature Dark, and D18.1 Before versus D18.2 After on desktop and phone; Before is the committed HEAD page served from a copy, After is this change)
- `D18.2-CLASSIC-DESKTOP.png`
- `_raw\` (every individual capture and `capture-report.json` with the overflow and cell-position measurements)

No approved prototype exists and none was invented. The sheets were composed from real captures of the running app.

## 14. Financial before and after

- Before (D18.1) the "At a glance" block showed: gross, of which bonus, of which stock awards, take-home, 401(k) pre-tax + Roth, employer match, HSA (you + employer), ESPP. Every one of those figures is still shown after, now in a labeled column, with more detail (tax and deduction categories, kept equity). Household hero, household tax settings and the 2026 results section are untouched and show the same amounts.
- For the invented household (2026): Avery gross $162,000.00, deductions $18,000.00, taxes withheld $42,928.80, cash $101,071.20; Jordan gross $108,000.08, deductions $12,799.92, taxes withheld $27,183.68, cash $66,718.68, equity kept $1,297.80; household cash $167,789.88 (matches the hero). Jordan's wages show $100,000.08 because the model rounds each of 24 paychecks to the cent.
- Opening the display performs no database write: the two new source files import no database, call no put/add/delete/update, and use no browser storage (guard test). The only writes in the browser session were the invented seed rows.

## 15. Remaining limitations and judgment calls (please review)

1. **No "Other income" column.** The brief said "if supported"; the model has no person-owned other income, so an always-empty column was not added. The schema can add "Other modeled earnings" automatically if the model ever produces one.
2. **Insurance premiums are one slot** (health + dental + vision), per the brief's list. Splitting them is a one-line schema change.
3. **FSA is labeled "Health care FSA"** because the model's `fsa` type is capped at the health FSA limit. Dependent-care FSA has no own type (falls under Other deductions).
4. **Withholding categories are always shown, as real values** once the model calculated, so Additional Medicare shows `$0.00` for most people. This follows "calculated zero" literally; it adds visual `$0.00` rows.
5. **The comparison has nine columns** (not the full deduction and tax detail), with a household row. On a phone it becomes labeled lists rather than a table.
6. **Wages is a value (maybe `$0.00`) whenever a setup exists**, even if no pay dates fall in the year (the model's own warning still appears under the statement).
7. **"Equity kept as shares" is shown only if a kept vest exists** and sits under Cash take-home, not as another column inside the net total.
8. A held-vest shortfall (net below zero) can disappear inside the model and shows as a reconciliation message only; this existing behavior was not changed.
9. The stale "in dollars" comment on `keptValue` in `payroll.ts` was left alone (no engine edits allowed).
10. The `.is-table` comparison uses a minimum width of 62rem and scrolls inside its own region below about 1190 px of card width.
11. Not done: keyboard Tab walk, screen reader, real phone, forced colors, Safari and Firefox, print, adding or editing records inside the new statement (it is read-only on purpose), the full local test suite, driving every other Income form again.
12. A concern for review: the evidence "Before" pictures come from a copy of the committed D18.1 code served on a second port, not from the owner's own data.

## 16. Exact Git status (end of work)

Branch `main`, `HEAD` = `origin/main` = `fa5deb7`; nothing staged, committed or pushed.

```
 M docs/BACKLOG.md
 M docs/CHATGPT-HANDOFF.md
 M src/pages/IncomePage.tsx
 M src/pages/plan.css
?? docs/LEDGER-SIGNATURE-D18.2-REPORT.md
?? docs/UI-DESIGN-D0-AUDIT-2026-11-10.md        (protected, untouched)
?? docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md    (protected, untouched)
?? scripts/dev-demo-seed.ts                      (protected, untouched)
?? src/pages/IncomeStatement.tsx
?? src/pages/d182IncomeStatement.test.tsx
?? src/pages/incomeStatementModel.ts
```

**Handoff:** `docs/CHATGPT-HANDOFF.md` was updated (top notice, snapshot line, change log; the T2027 "uncommitted" wording marked superseded by `fa5deb7`, run #109). Unknown: the D18.2 release SHA and CI result (not released); real-device and screen-reader behavior.
