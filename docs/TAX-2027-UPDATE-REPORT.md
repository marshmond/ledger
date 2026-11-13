# T2027: 2027 tax tables, verification report

**Status (2026-11-13): APPROVED BY OWNER AND CHATGPT; RELEASE AUTHORIZED as `feat(tax): add verified 2027 tax tables and year-aware rules` (SHA and CI result are in the release summary and the next change to this file). Not real-device or screen-reader tested.**
This is a financial-data release, separate from the Ledger Signature redesign. D20 is not started.

**Plain summary.** Ledger now has built-in 2027 tax tables. Almost every number that matters for paychecks, bonuses and stock awards
came straight from the IRS, SSA and Massachusetts pages (federal brackets, standard deduction, 401(k), HSA, FSA, Social Security
limit, the Massachusetts family-leave deduction, and the capital-gains thresholds). **One important number does not exist yet:
Massachusetts has not published its 2027 4% surtax threshold.** It is carried as a clearly labelled placeholder (the 2026 amount) and the
Income page says so. It only affects a household with more than about $1.1 million of Massachusetts taxable income, and those results are provisional until DOR publishes. Nothing was set to zero
and nothing was invented. Nothing about 2026 changed.

## 1. Research date

Research was done on **2026-11-13**. Primary pages were read in full on that date. Several sites refuse automated downloads
(mass.gov and ssa.gov returned "403" to a simple fetch), so those pages were read in the app's built-in browser instead. The IRS
Revenue Procedure and Notice were read from the PDF text.

## 2. Official sources

| Source | Published | Used for |
|---|---|---|
| [IRS news release IR-2026-133](https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2027-taxpayers-continue-to-benefit-from-the-working-families-tax-cuts) and Revenue Procedure 2026-35 (PDF: irs.gov/pub/irs-drop/rp-26-35.pdf) | 2026-11-05 | Brackets, standard deduction, aged/blind deduction, capital-gains thresholds, health FSA |
| [IRS news release IR-2026-136](https://www.irs.gov/newsroom/401k-limit-increases-to-25500-for-2027-ira-limit-remains-7500) and Notice 2026-66 (PDF: irs.gov/pub/irs-drop/n-26-66.pdf) | 2026-11-12 | 401(k) deferral and catch-up limits |
| [IRS Revenue Procedure 2026-24, in IRB 2026-25](https://www.irs.gov/irb/2026-25_irb) | 2026-06-15 | HSA limits |
| [SSA 2027 COLA fact sheet](https://www.ssa.gov/cola/factsheets/2027.html) | 2026-10 | Social Security wage base, 7.65% rate, $200,000 / $250,000 Additional Medicare |
| [IRS Topics 560 and 751](https://www.irs.gov/taxtopics/tc560) | updated 2026-11-09 | Additional Medicare 0.9% thresholds, Medicare 1.45% |
| [MA DFML contribution rates](https://www.mass.gov/info-details/paid-family-and-medical-leave-employer-contribution-rates-and-calculator) | updated 2026-10-01 | PFML 2027 split and cap |
| [MA DOR personal income tax exemptions](https://www.mass.gov/info-details/personal-income-tax-exemptions) | updated 2026-10-30 | Exemptions ($8,800 joint, $1,000 dependent, $700 age 65+) |
| [MA DOR 4% surtax](https://www.mass.gov/info-details/massachusetts-4-surtax-on-taxable-income) | updated 2026-06-01 | Surtax thresholds (lists 2023 to 2026 only) |

**One caution about the Revenue Procedure PDF:** its text still contains the placeholder "[Release Date, 2026]" in section 1, so it looks like a
copy produced just before final release. Every figure that also appears in the IRS news release (brackets, standard deduction, health FSA)
matches it exactly. The two figures found only in the PDF are the capital-gains thresholds and the $1,700 aged deduction. They are
consistent with the pattern of the other figures, but worth a second look in the final published Rev. Proc. when convenient.

## 3. Field-by-field 2027 table

Status words: **Verified 2027** (read from an official page for this year), **Statutory** (fixed in law, not adjusted for inflation),
**Provisional** (no official 2027 value found; an earlier figure is carried and labelled), **Estimate** (an assumption Ledger already used).

| Field | 2027 value | 2026 value | Status | Source |
|---|---|---|---|---|
| Federal joint 10% bracket up to | $25,600 | $24,800 | Verified 2027 | Rev. Proc. 2026-35 s.3.01 |
| 12% up to | $104,050 | $100,800 | Verified 2027 | same |
| 22% up to | $218,250 | $211,400 | Verified 2027 | same |
| 24% up to | $416,650 | $403,550 | Verified 2027 | same |
| 32% up to | $529,100 | $512,450 | Verified 2027 | same |
| 35% up to | $793,650 | $768,700 | Verified 2027 | same |
| 37% over | $793,650 | $768,700 | Verified 2027 | same |
| Standard deduction, joint | $33,200 | $32,200 | Verified 2027 | s.3.15(1) |
| Extra standard deduction, age 65+ (per spouse) | $1,700 | $1,650 | Verified 2027 | s.3.15(3) |
| Capital gains 0% up to (joint) | $102,100 | $98,900 | Verified 2027 | s.3.03 |
| Capital gains 15% up to (joint) | $633,600 | $613,700 | Verified 2027 | s.3.03 |
| Health FSA | $3,500 | $3,400 | Verified 2027 | s.3.16 |
| Supplemental wage withholding | 22% | 22% | Statutory | Regulation; not in Rev. Proc. 2026-35, carried |
| Social Security rate / wage base | 6.2% / $192,300 | 6.2% / $184,500 | Verified 2027 | SSA |
| Medicare rate | 1.45% | 1.45% | Statutory | SSA, IRS Topic 751 |
| Additional Medicare 0.9%: employer withholding / joint liability | $200,000 / $250,000 | same | Statutory | SSA, IRS Topic 560 |
| Net investment income tax | 3.8% over $250,000 joint | same | Statutory | IRS Topic 559 |
| 401(k) employee deferral | $25,500 | $24,500 | Verified 2027 | Notice 2026-66 |
| Catch-up, age 50+ | $8,500 | $8,000 | Verified 2027 | same |
| Catch-up, ages 60 to 63 (replaces the 50+ amount) | $11,750 | $11,250 | Verified 2027 | same |
| HSA self-only / family | $4,500 / $9,000 | $4,400 / $8,750 | Verified 2027 | Rev. Proc. 2026-24 s.3.01 |
| HSA age-55 catch-up | $1,000 | $1,000 | Statutory | IRC 223(b)(3) |
| Dependent care FSA | $7,500 | $7,500 | Statutory (corrected, see section 16) | [IRS](https://www.irs.gov/forms-pubs/correction-to-the-dependent-care-benefits-exclusion-amount-in-the-2026-general-instructions-for-forms-w-2-and-w-3): P.L. 119-21 s.70404 raised it to $7,500 beginning in 2026. Not used by any calculation |
| ESPP stock limit | $25,000 | $25,000 | Statutory | IRC 423 |
| MA income tax rate | 5% | 5% | Estimate | DOR pages read did not state a 2027 rate |
| MA 4% surtax rate | 4% | 4% | Statutory | DOR surtax page |
| **MA 4% surtax threshold** | **$1,107,750 (placeholder, the 2026 amount)** | $1,083,150 (see section 13) | **Provisional** | DOR lists 2023 to 2026 only; 2027 not published; may change when Massachusetts publishes 2027 guidance |
| MA personal exemption, joint / dependent | $8,800 / $1,000 | same | Statutory | DOR exemptions page (names no tax year) |
| MA age 65+ exemption (used by Roth planner) | $700 | $700 | Statutory | same |
| MA FICA deduction cap per spouse | $2,000 | $2,000 | Estimate | Existing assumption, not re-checked |
| MA PFML employee rate | 0.46% | 0.46% | Verified 2027 | DFML (see below) |
| MA PFML wage cap | $192,300 | $184,500 | Verified 2027 | DFML: capped at the Social Security maximum |
| MA withholding rate / allowance per person | 5% / $4,400 | same | Estimate | Circular M for 2027 not published |

### Massachusetts PFML in plain words
DFML's page for 2027 says employees can be charged up to **0.28% for family leave** (40% of the 0.70% family share) plus up to
**0.18% for medical leave** (100% of the 0.18% medical share). That adds to **0.46%**, the same total employee rate as 2026 (0.18% family +
0.28% medical). The 0.88% figure on the page is the combined employee and employer amount, so it was **not** used. Only the split between
the two leave types moved. Individual contributions are capped at the Social Security taxable maximum, so the cap is $192,300 in 2027.
The 0.46% is the most an employer may withhold; an employer can choose to pay more of it, which Ledger does not model (unchanged).

### The prompt's cross-check table
All 14 figures in the task's cross-check table matched the primary sources (standard deduction, six bracket boundaries, 401(k) three limits,
wage base, both HSA limits, health FSA).

## 4. Fields not published or not verified

| Field | What depends on it | How handled |
|---|---|---|
| MA 4% surtax threshold, 2027 | Massachusetts tax for households above roughly $1.1M taxable income; Roth planner MA tax | 2026 amount carried, labelled **provisional** in the table's source panel and notes. It is not a 2027 figure and may change when Massachusetts publishes 2027 guidance, so surtax results for such households are provisional |
| MA income tax rate, FICA deduction cap, withholding allowance for 2027 | State tax and state withholding estimates | Existing assumptions, labelled "planning estimate". No 2027 Circular M exists yet |
| IRMAA tiers and surcharges, ACA poverty guideline and applicable-percentage table for 2027 | Roth planner only (Medicare surcharge and ACA subsidy cost) | 2026 figures carried and the 2027 notes say **NOT VERIFIED for 2027**. Leads for a later change: Rev. Proc. 2026-26 (2027 applicable-percentage table) and the 2026 poverty guideline of $21,640 for two people. Neither was applied |
| Whether MA excludes 401(k) deferrals from state wages | State tax | Existing UNVERIFIED note kept |
| Roth catch-up wage threshold ($155,000 for 2027, Notice 2026-66) | Not modelled by Ledger | Not added (no new tax features) |

No amount was replaced with zero. A year with no table (2028 and later) still calculates nothing, as before.

## 5. Source files changed

| File | Change |
|---|---|
| `src/data/taxYears.ts` | New `TAX_2027` and a `provenance` record (optional field on `TaxTables`); added to `TAX_YEARS`; `latestBuiltInYear()` |
| `src/data/retirementTax.ts` | New `RETIREMENT_RULES_2027`, a year lookup `RETIREMENT_RULES`, and `retirementRulesFor(year)` |
| `src/lib/payroll.ts` | Capital-gains thresholds and NIIT now come from the year's rules instead of the fixed 2026 object |
| `src/lib/taxPlan.ts` | "Room in the 0% gains band" uses the table year's threshold |
| `src/lib/income.ts` | Income model reports which year's gains rules it used (`capGainsRules`) |
| `src/lib/rothInputs.ts` | Roth planner starts from the newest built-in tables not after the first plan year (`planBaseTables`) |
| `src/pages/IncomePage.tsx`, `src/pages/TaxProvenance.tsx` (new) | Source panel for built-in tables; "Start from the latest tables" wording; copy-for-edit leaves the source list out |
| `src/pages/PaycheckPage.tsx`, `src/pages/RothPage.tsx` | One sentence of wording; Roth notes follow the plan year |
| `src/lib/income.test.ts` | Two tests that used 2027 as "a year with no tables" now use 2028 |
| `src/lib/tax2027.test.ts` (new) | 34 focused tests |

No database, migration, sync, backup or navigation file changed. `TAX_2026` and `RETIREMENT_RULES_2026` were not edited.

## 6. Year-aware calculation changes

Before this change, the capital-gains thresholds and the net investment income tax were read from the 2026 rules for every year, and the
Roth planner always started from the 2026 tables. Now:

- **Household tax (Income, Tax planning, Tax package, Year in review, Retirement, Projections)** uses the capital-gains thresholds of the
  table's own year. For 2026 the numbers are identical to before.
- **Tax planning, "room in the 0% capital-gains band"** uses the same year lookup.
- **Roth planner** starts from the newest built-in year that is not after the first plan year: 2026 today (unchanged), 2027 from January 1,
  2027. For a start year with no table (2028 on) it uses 2027 and adds a visible note that it is scaling the 2027 tables by your inflation
  assumption. The planner's later-year scaling by inflation is unchanged.
- **A year with no rules of its own** (a saved custom table for 2028, say) falls back to the newest earlier year's rules and the Income page
  shows "capital-gains rules for {year} are not built in, so {earlier year} thresholds were used". Before, 2026 was used silently. The
  fallback year is now 2027 for those cases, which is a change in a rare case (custom tables for 2028 or later).

Calculation formulas were not changed. Roth and Retirement algorithms were not touched.

## 7. Screens that now support 2027

- **Income:** choosing 2027 shows "Using built-in 2027 tax tables" and a collapsible source panel (counts of verified, fixed by law,
  provisional and planning-estimate values, the values still to confirm, and links to the official pages). Add person, Copy previous year,
  RSU, bonus, HSA and deductions are unchanged. Edit, save and "Reset to built-in" work as before.
- **Paycheck:** existing and new 2027 scenarios resolve the 2027 tables (the Social Security cap stops at $192,300). The timestamp sorting fix is unchanged.
- **Tax planning:** 2027 brackets, bracket room and the 0% gains band use 2027 figures.
- **Roth, Retirement, Projections, Tax package, Year in review, Giving:** read the same tables through the Income model, so a 2027 year
  uses them. Giving's standard-deduction comparison uses $33,200 for 2027.
- No layout or navigation changed.

## 8. Tests performed

- New `tax2027.test.ts`: **34 tests, all pass.** Expected values were typed from the official pages, not produced by the code under test. For
  example, the tax at each bracket start is checked against the "tax is" amounts printed in Rev. Proc. 2026-35 ($2,560; $11,974; $37,098;
  $84,714; $120,698; $213,290.50).
- Targeted suites (income, payroll, paycheck, gains, tax plan, tax package, Roth inputs/tax/plan, retirement table, Person income page,
  2027): **14 files, 237 tests, all pass.**
- Source-scanning guard tests plus shell suites: **23 files, 443 tests, all pass.**
- `npx tsc --noEmit`: clean. `npm run build`: clean (the usual chunk-size notice only).
- The full suite was **not** run locally (as instructed; release CI runs it).
- Browser check (dev server on its own address with an invented person; the real household data was never opened): Income for 2026 and 2027,
  the source panel at desktop and 375 px width (no sideways scroll), the edit box, Roth page and Tax planning for 2027, no console errors.
  **Not checked in a browser:** the Paycheck page for 2027 (covered by unit tests only), real phone, screen reader.

## 9. Before and after (invented data)

A household with one earner on **$150,000 salary**, nothing else (joint brackets):

| | 2026 tables | 2027 tables |
|---|---|---|
| Standard deduction | $32,200 | $33,200 |
| Federal taxable income | $117,800 | $116,800 |
| Federal tax before credits | $15,340 | $14,779 |

The same person on **$210,000** in 2027: Social Security $11,922.60 (stops at $192,300), Medicare $3,045, PFML $884.58 (2026: $848.70).

**Salary, bonus and stock-award year (2027):** $150,000 salary, $60,000 December bonus, $10,000 stock vest: gross $220,000; Social Security
$11,922.60; Medicare $3,190; Additional Medicare $180; PFML $884.58; taxable income $186,800; federal tax $30,179; bonus withheld at 22%
($13,200) and vest at 22% ($2,200).

**Capital gains** ($120,000 wages plus a $20,000 long-term gain): 2026 tax on the gain **$1,335** (15% starts at $98,900); 2027 **$705**
(15% starts at $102,100).

## 10. Custom-table override preservation

Unchanged precedence: a valid saved table for a year beats the built-in one. Tests cover: a saved custom 2027 table wins (and its wage base
is used); "Reset to built-in" returns to the 2027 built-in; a broken saved copy falls back to the built-in; the built-in table is never
modified. **Important for the owner:** if you already saved a 2027 table copied from 2026 (the old "Start from 2026 tables" button),
**that copy still wins and still holds 2026 numbers.** Use "Reset to built-in" on the Income page for 2027 to switch to the verified table.
Ledger never touches your saved table. Since the final corrections (section 16), Income shows an informational notice for 2027 when a saved table differs from the built-in one.

## 11. Remaining tax-model limitations

- The model treats every household as married filing jointly. 2027 single, head-of-household and separate figures were published but are not used.
- Federal withholding per paycheck is an estimate of the IRS percentage method; the annual liability is the better figure.
- Massachusetts withholding uses a flat 5% less an allowance, an approximation. It does not model the 9% supplemental rate DOR describes for
  income above the surtax threshold.
- IRMAA, ACA and Medicare figures in the Roth planner for 2027 are 2026 amounts (section 4).
- Child Tax Credit, EITC, adoption credit and AMT figures in the IRS release are not modelled.
- Rev. Proc. 2026-35 PDF text (see section 2 caution).

## 12. Decisions requiring owner approval

1. **Carrying the 2026 MA surtax threshold ($1,107,750) as the labelled 2027 placeholder.** Alternative: leave 2027 without a built-in
   table until DOR publishes (not recommended: it would block every 2027 calculation for one number that affects few households).
2. ~~Warn about an old saved 2027 copy~~ Built in the final corrections (section 16).
3. **2026 Massachusetts surtax threshold fix** (section 13): approve as a small separate correction, or leave 2026 as saved.
4. **Roth planner inputs for IRMAA / ACA 2027:** apply Rev. Proc. 2026-26 and the $21,640 poverty guideline in a follow-up (needs its own verification pass), or leave as labelled carry-forwards.
5. **README "Every January" instructions:** now partly out of date (a 2027 table exists). Not edited, as docs outside the report, backlog and handoff were not asked for.

## 13. Separate finding: the built-in 2026 Massachusetts surtax threshold looks wrong

`TAX_2026.ma.surtaxThreshold` is **$1,083,150**. The DOR page (updated 2026-06-01) lists: 2026 **$1,107,750**, 2025 **$1,083,150**, 2024 $1,053,750,
2023 $1,000,000. So the stored 2026 figure is the 2025 threshold. **Confirmed against the official page.** The old table notes already
called this "UNVERIFIED: sources disagree".

- **Scope:** only the Massachusetts 4% surtax in 2026 calculations: Income, Tax planning, Tax package and Year in review (all through `householdTax`), and the Roth planner's Massachusetts tax.
- **Impact:** only households with more than $1,083,150 of Massachusetts taxable income. For them the surtax is overstated by 4% of the gap, at most $984 ($1,107,750 minus $1,083,150, times 4%). Everyone below $1.08M: no change.
- **Not changed.** This task authorizes 2027 only, and the test file records the current $1,083,150 so a later fix is a deliberate change.
- **Recommended follow-up:** a one-line correction to $1,107,750 plus a test, and replace the "UNVERIFIED" wording. Your decision.

## 16. Final corrections before release (2026-11-13, after ChatGPT review)

**Gate re-verified:** repository `marshmond/ledger`, branch `main`, `HEAD` = `origin/main` = `bc353319db3b72f1a86265dc1ec17ca95dc9f056` (D19; run #108 and the Pages deployment succeeded, checked earlier today); T2027 still uncommitted; the working tree matched this report; no other work had begun; the three protected untracked files are untouched.

**Corrections made**
1. **Dependent-care FSA reclassified Provisional to Statutory.** Source read: [IRS correction notice](https://www.irs.gov/forms-pubs/correction-to-the-dependent-care-benefits-exclusion-amount-in-the-2026-general-instructions-for-forms-w-2-and-w-3): "P.L. 119-21, section 70404, increased the maximum amount of the exclusion to $7,500 beginning in 2026." It is a fixed statutory amount with no indexing stated, and Rev. Proc. 2026-35 has no entry for it, so it applies unchanged in 2027. Dollar amount unchanged; no calculation reads it. The source panel now counts 8 verified, 7 fixed by law, **1 provisional** (only the MA surtax threshold), 3 planning estimates; the IRS page was added to the source list.
2. **Notice for an outdated saved 2027 table** (Income, informational only). It shows only when the year is 2027, a saved custom table is active, and it differs from the built-in table in the joint standard deduction, Social Security wage base, federal brackets or 401(k) limit (it names which). It says the saved figures are used instead of the published ones, that this may be intentional, and links to View or edit (the existing editor, where Reset to built-in lives). It never resets, edits or migrates anything and does not change which table wins. It does not show for the built-in table or for a custom table that matches on those fields.
3. **MA surtax wording.** The provenance note and the table notes now say the $1,107,750 is the 2026 amount, not a 2027 figure, and may change when Massachusetts publishes 2027 guidance. The earlier "can only overstate" claim was removed from the code notes and from this report (sections 4 and 13 still state the 2026 over-statement, which is a fact about the old 2026 number). Still labelled provisional; 2026 table untouched.

**Focused verification:** `tax2027.test.ts` (34) and the new `taxCustomNotice.test.tsx` (5), plus income, payroll and gains suites: 5 files, 83 tests pass. `tsc` clean; `npm run build` clean. No full-suite run. Checked: built-in 2027 shows no notice (test); a 2027 table copied from 2026 shows it (test and browser, one capture on the throwaway profile); a deliberately customized table is used as saved and the built-in table is unchanged (test); clearing the saved text returns the built-in table (test, the existing Reset behaviour); 2026 results unchanged (existing 2026 tests in `tax2027.test.ts`: $15,340 tax, $1,335 gains tax); the provisional MA designation is still in the source panel and the notes.

**Saved tables:** none overwritten. In the browser, the saved custom 2027 row was read back after the notice displayed and was identical (wage base $184,500, standard deduction $32,200). **Financial calculations:** unchanged; only labels, notes and the notice changed.

**Follow-ups kept, not implemented:** (a) correct the 2026 MA surtax threshold from $1,083,150 to $1,107,750 (separate authorized correction); (b) update the 2027 MA surtax threshold when DOR publishes it; (c) verify Roth planner 2027 IRMAA and ACA sources (Rev. Proc. 2026-26, poverty guideline); (d) update the README "Every January: update the tax tables" instructions.

**Git status (exact):** see the final chat message; the files are the same as section 15 plus `src/pages/taxCustomNotice.test.tsx` (new) and edits to `src/pages/TaxProvenance.tsx`, `src/pages/IncomePage.tsx`, `src/data/taxYears.ts`, `src/lib/tax2027.test.ts`.

## 14. Handoff and backlog

`docs/BACKLOG.md` and `docs/CHATGPT-HANDOFF.md` were updated with the actual status: built, tested locally, uncommitted, not deployed.

## 15. Git status (exact)

See the final chat message for the output at the end of the work. At the time of writing:

(Inventory before the release commit; `src/pages/taxCustomNotice.test.tsx` is also new.)

```
 M docs/BACKLOG.md
 M docs/CHATGPT-HANDOFF.md
 M src/data/retirementTax.ts
 M src/data/taxYears.ts
 M src/lib/income.test.ts
 M src/lib/income.ts
 M src/lib/payroll.ts
 M src/lib/rothInputs.ts
 M src/lib/taxPlan.ts
 M src/pages/IncomePage.tsx
 M src/pages/PaycheckPage.tsx
 M src/pages/RothPage.tsx
?? docs/TAX-2027-UPDATE-REPORT.md
?? docs/UI-DESIGN-D0-AUDIT-2026-11-10.md          (protected, untouched)
?? docs/UI-DESIGN-D1-DEMO-DATA-2026-11-10.md      (protected, untouched)
?? scripts/dev-demo-seed.ts                       (protected, untouched)
?? src/lib/tax2027.test.ts
?? src/pages/TaxProvenance.tsx
```

Release gate (checked before any change): repository `marshmond/ledger`, branch `main`, `HEAD` = `origin/main` = `bc353319db3b72f1a86265dc1ec17ca95dc9f056`
(D19, "feat(ui): redesign More, Settings and documents"); Actions run #108 "Deploy to GitHub Pages" completed with conclusion success; the
GitHub Pages deployment for the same SHA has state success (read from the public GitHub API because `gh` is not installed).
