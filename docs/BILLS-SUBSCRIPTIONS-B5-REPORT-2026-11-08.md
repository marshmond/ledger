# Bills & Subscriptions B5: Household finances (commitments, expected payments and recorded spending across Bills, Household Services and Home & Assets). Implementation report

Date: 2026-11-08. Status: **built and tested locally. NOT staged, NOT committed, NOT pushed, NOT deployed, NOT acceptance-tested on a real device, NOT yet independently reviewed.** B3.2 and every later phase were not started. The rule that governed the whole build: *a payment recorded once in Finance is one payment however many household records point at it; a future obligation is an expectation, not an expense; a cancellation request is a request; an unknown amount stays unknown, never zero.*

## 1. Executive summary (plain English)

Ledger now has one page, **Household finances** (`#/household`), that answers seven questions without mixing three different ideas together. Nothing on it changes any record, and nothing in Finance is touched.

1. **What is expected soon?** Bills coming due and estimated service visits in the next 7, 30 or 90 days, each labelled *known*, *estimated*, *not known* or *in dispute*. A payment with no known amount is counted as a count and is never added as $0.00.
2. **What have we committed to?** The same bills and services over twelve months, using each subscription's recorded price changes and stopping after a *confirmed* cancellation date. A cancellation *request* changes nothing; two different confirmed dates change nothing until you choose.
3. **What has actually been recorded as spent?** One figure for Bills, Household Services and Home & Assets together. A Finance payment that a bill, a service visit and a maintenance record all link is **one** payment (the required $150.00 case counts $150.00, not $300.00 or $450.00). Refunds are subtracted; amounts you typed as "paid outside Finance" are added as typed and are never matched to a Finance payment by amount, date or name.
4. **Which area manages it?** The breakdown credits each payment to the one area whose records link it, or to *Shared between modules*, and the rows add up to the total. A second list explains exactly why the three module pages added together come to more.
5. **Where might the same payment be counted twice?** *Needs review* says what kind of thing each item is: a possible duplicate (a typed payment and a Finance payment that look alike and share a provider or a "bills for" link), missing or out-of-date evidence, two records that may describe one expense, subscription dates and cancellations, and a collapsed "good to know" list for legitimate sharing.
6. **What needs review?** The same list, each item linking to the record where it can be looked at. Ledger repairs nothing.
7. **Which subscriptions are approaching a renewal or deadline?** *Upcoming contractual actions* lists trials ending, renewals, cancel-by deadlines and cancellation requests still waiting for an answer.

Also: a read-only **Related bill** card on a Household Services arrangement (the small follow-up B4 left), and one **Today** card that shows counts only and only what the Bills and Services cards cannot say. When amounts are hidden every figure is masked. If a read fails the page shows an error and **no totals**, so a partial figure can never look complete. The figure says **"Not fully reconciled"** while something unresolved affects it.

**No table, migration, dependency, sync rule, backup format or Finance file changed, and none of the three existing spending readers was edited** (sections 4 and 19).

## 2. Verified B4 commit and GitHub Pages deployment (the gate)

| Check | Result |
|---|---|
| Repository and remote | `origin` = `https://github.com/marshmond/ledger.git` (`marshmond/ledger`) |
| Branch | `main` |
| `HEAD` equals `origin/main` (after `git fetch`) | yes: `a89f1972260b55a65ed45c78c03f733d619b35ef` (`feat(bills): B4 subscription lifecycle and price history`); `git rev-list --left-right --count HEAD...origin/main` = `0 0` |
| Matching Pages run | "Deploy to GitHub Pages" run **#73**, id 42453780059, `event` push, `head_sha` exactly the B4 SHA, **`completed` / `success`**; job `build` (npm ci, npm test, npm run build, configure and upload pages) and job `deploy` both `success` (public Actions API; the `gh` CLI is not installed) |
| Pre-commit corrections in that release | yes: the B4 report's post-correction figure is 3,169 tests in 172 files, and the re-run baseline on the released commit is exactly that |
| Working tree at the start | clean (`git status --short` empty) |
| Unexpected commits | none (previous: B3.1 `f2db2a7`, B3 `ceb0ea8`, B2 `aca2208`, B1 `3bcf3a3`, B0 plan `8059e5f`) |
| B5 already started? | no: the only "B5" text in source was forward references in comments (`billsSpend.ts`, two Bills tests) |
| Baseline | **3,169 passing tests in 172 files** (re-run, not assumed) |

**An honest note on timing.** When the SHA was first checked, run #73 was `in_progress` (the `npm test` step running, about two minutes after the push). No application code was touched until it completed `success` (about 2 minutes 18 seconds after it started); the required documents and source were read in the meantime, which the brief allows. A first attempt to open the dev server on `127.0.0.1` was refused by the pane; a `.localhost` sub-domain was used instead (section 21).

## 3. Baseline and final test totals

Baseline **3,169 tests in 172 files**. Final ****3,304 passing tests in 178 files**** (+135 tests in 6 new files, all in `src/modules/household/`). `npx tsc --noEmit` clean; `npm run build` succeeds (the usual chunk-size warning); `git diff --check` clean (only line-ending notes).

| New test file | Tests | What it is |
|---|---|---|
| `b5-golden-master.test.ts` | 33 | The gate: hand-computed expectations on the UNMODIFIED readers (section 5) |
| `b5-union.test.ts` | 33 | The union: the mandatory $150.00 case, whole and split across modules, refunds, typed amounts, stale references, Bills lifecycle, periods, order, and **300 seeded random households against an independent oracle** |
| `b5-commitments.test.ts` | 34 | Commitments and expected payments: every schedule kind, prices, cancellation states, day boundaries, Services estimates, every linked bill-and-arrangement outcome |
| `b5-data.test.ts` | 21 | Real databases: the loader, read-only fingerprints, bulk reads, scale, damaged data, injected failures, Related bill, **the real two-device `SyncEngine`**, backup and restore |
| `b5-guards.test.ts` | 8 | Source guards: read-only, no network, no storage, no Finance writer, registration, who imports the module |
| `b5-ui.test.ts` | 6 | Static markup: Hide Amounts on every card, accessible structure, honest loading and not-reconciled states |

Test-only helpers: `householdTestkit.ts` (pure fixtures) and `householdSeed.ts` (the invented household shared by the database and screen tests).

## 4. Files added and modified

**Added (source, 13):** `src/modules/household/` `model.ts` (the shared words and the three ideas), `unionSpend.ts`, `commitments.ts`, `review.ts`, `overview.ts` (loader, pure builder, Today counts), `relatedBill.ts`, `Parts.tsx` (the cards), `OverviewPage.tsx`, `HouseholdModule.tsx`, `RelatedBillCard.tsx`, `todayCards.tsx`, `index.tsx` (the module), `household.css`.
**Added (tests, 6 plus 2 helpers; script, 1; doc, 1):** the six test files above, `householdTestkit.ts`, `householdSeed.ts`; `scripts/household-b5-mutation-check.cjs`; this report.
**Modified (source, 2):** `src/modules/index.ts` (one `registerModule(householdModule)` and its import) and `src/modules/services/ArrangementPage.tsx` (one import and one `<RelatedBill arrangementId={a.id} />` line).
**Modified (docs):** this report, `docs/CHATGPT-HANDOFF.md`, `docs/BACKLOG.md`, `README.md`, `docs/module-hooks.md`, `docs/due-provider.md` (a note that B5 adds no Calendar layer).
**Not touched (verified with `git diff`, section 19):** `src/modules/assets/spending.ts` (`spend()`), `src/modules/services/householdSpend.ts`, `src/modules/bills/billsSpend.ts`, `src/lib/txnRef.ts`, `costSource.ts`, `txnLookup.ts`, `financeRead.ts`, every Finance engine and page, the Calendar, Tasks and Projects modules, `src/db.ts`, `src/core/`, the sync engine, `backup.ts`, `backupFile.ts`, `package.json` and the lock file.

## 5. Golden-master gate

**Written and run before any union code existed.** `b5-golden-master.test.ts` (32 tests when first run; 33 after the two gap repairs in section 20) passed on the first run against the unmodified readers. Every expected number is a literal, with the arithmetic beside it; none is produced by calling the function under test. It covers, with invented data:

| Reader | Scenarios pinned |
|---|---|
| Home & Assets `spend()` | whole-transaction reference ($150.00); split-part reference ($70.00 of $30.00 + $70.00); whole and part on different records, in either order (whole counts, part covered); one payment reached by three records on two assets (once, listed as shared); a typed amount ($80.00) and the same-size Finance payment (both count: never matched by value); a record holding both typed and references (references used, flagged); refund ($120.00 − $50.00 = $70.00, full refund = $0.00, refund alone = −$50.00); deleted transaction (counts nothing, `missing`); changed amount (linked at $100.00, live $125.00 counts $125.00); restructured split (counts nothing, `split-changed`); unknown versus a typed $0.00 |
| `householdSpend()` | the same $150.00 on a visit and a Home & Assets record (total $150.00, module pages $300.00, difference $150.00); a whole against a part across the two (whole counts, part covered, $130.00 → $100.00); a `recorded-as` job with typed $120.00 on both sides (counts once); two unlinked typed $120.00 amounts (both count, $240.00); a completed visit with no payment (unknown, not zero); a period narrowing by the LIVE transaction day |
| `billsRecordedPayments()` and the Bills period figures | a Finance link beside a typed payment in one period (link used, typed set aside); the same amount typed in one period and linked in another (two payments, $240.00); one payment on two periods and a second bill (once, shared across three periods); a **partial payment** (billed $240.00, paid $100.00, remaining $140.00; only $100.00 is recorded spending); a **provider credit** (billed $120.00, credit $20.00, paid $60.00: owed $100.00, remaining $40.00, recorded $60.00); refund; a deleted transaction with a typed amount in that period (typed does NOT resume counting) |
| Expected payments and commitments | an uninvoiced monthly $90.00 bill (12 dates, $1,080.00 known, recorded $0.00; 7 / 30 / 90 day cash timing $0.00 / $90.00 / $270.00); a varying bill (estimated) and a bill with no amount (unknown, 12 dates); a **confirmed future cancellation** (2 × $15.49 = $30.98, historical payments unchanged); a **request alone** (12 periods, unchanged); a **past cancellation** (no new commitments, payments stay recorded); an **unconfirmed expected service visit** (4 Fridays = $480.00, recorded $0.00); a per-month estimate (not converted) |
| Finance totals, forecasting, Scheduled | no Finance file was edited (section 19), so the existing Finance suite (all of it, unchanged, all green) is that golden master; B5 adds whole-database fingerprints proving the new page writes no Finance row |

**Discrepancies with the approved B0 architecture: none found.** (Differences in approach, not in behaviour, are in section 23.) The gate also has teeth: mutation checks G1 to G3 (section 20) break an existing reader and are caught by it.

## 6. Original spending-reader contracts (what was reused, unchanged)

- **`spend(records, lookup, groups)`** (`assets/spending.ts`, H3): one `CostRecord` is a typed amount, Finance references or nothing (references win, flagged `both`). A piece (`pieceKey`: transaction plus part, or whole) counts once however many records reach it; a counted whole covers its parts; a missing, split-changed, changed-structure or no-longer-spending reference counts 0 and is listed; refunds lower the total; the snapshot is never an amount. It credits a shared piece to the FIRST record in the order given and reports every record that reaches it (`recordIds`).
- **`householdSpend(input, lookup, period)`** (`services/householdSpend.ts`, S5): Services plus Home & Assets through `spend()`; S4's `recorded-as` pair makes a visit and its record(s) one payment event for TYPED amounts (the visit's typed amount counts once; any Finance reference on the job leaves every typed amount out); claims end as `included`, `merged`, `covered` or `excluded`; a reconciliation explains the difference from the two module totals.
- **`billsCostRecords` / `billsRecordedPayments`** (`bills/billsSpend.ts`, B3): one cost record per billing period holding payment evidence; the period's source is its Finance links when any exist (typed set aside, even if every link is stale), else the single typed amount (two different typed amounts count nothing), else nothing.

B5 changes none of these. `b3-spend.test.ts` still pins that `householdSpend.ts` and `spending.ts` never mention Bills, and `b5-guards.test.ts` pins that no reader mentions the household module.

## 7. Unified recorded-spending algorithm (`unionSpend.ts`, pure)

1. `householdSpend(household, lookup, period)` for Services plus Home & Assets (S5, including `recorded-as`).
2. `billsCostRecords` then `billsRecordedPayments` for Bills, with the same period narrowing S5 uses (a Finance reference by the LIVE transaction day, a typed amount by its own date).
3. **Merge their resolved pieces by `pieceKey`.** Same key in both: one piece, associations joined. A part one reader counts whose WHOLE the other counts: the part is removed and kept as a `covered-part` association on the whole. Parts that a reader already covered inside itself keep their association too.
4. Typed amounts are added as they are (S5's `included` typed claims; Bills' single typed amount per period). Set-aside typed amounts are kept and listed as not counted.
5. Every total is a sum of listed things: `financeCents` = counted pieces, `typedCents` = authoritative typed entries, `totalCents` = both. `proof` repeats the sum so the page can show it.

## 8. Whole and split de-duplication evidence

`b5-union.test.ts`: a whole in Bills and a part in Services (whole counts $100.00, the part is covered and kept as an association, module pages $130.00); a part in Bills under a whole in Home & Assets; different parts in different modules (two pieces, $30.00 + $70.00, no difference); the same part in two modules (one piece); one payment from three modules; a refund piece linked in two modules (lowers the net once); stale in one module and valid in another (counts once through the valid one, the stale one listed). The random test (section 17) shuffles every record array and asserts identical pieces, associations and totals.

## 9. Cross-module attribution policy (recorded decision)

The household total is exact and counts a payment once. The ADDITIVE breakdown credits a counted piece to the **one module whose records reach it, or to "Shared between modules"** when more than one does. Nothing is credited by list order, title or amount (mutation M6 proves the test notices). Every association is kept, so a shared payment still appears in each module's history in the drill-down. Each module's own total (as that module's page shows it) is returned beside it, **non-additive**, with the reconciliation `withinServicesHome + alsoInBills + coveredAcrossBills = (sum of the three) − total`. B0 12.5 had said "credited to the first in order (services, home, bills)"; B5's brief asked for an explicit, non-arbitrary policy, and "Shared between modules" is the least misleading choice (section 23).

## 10. Typed spending and unresolved overlaps

A typed outside-Finance amount is never the same payment as a Finance payment by amount, payee, date, Contact or description. Inside Bills the B3 rule holds (Finance links win a period; typed is kept and set aside; a stale link never lets typed resume). Across modules, a **possible duplicate** is a hint only and needs ALL of: a typed amount in one module, a counted Finance piece in a *different* module, the same amount to the cent, dates within 7 days, and either the same provider Contact or an explicit `bills-for` link. It changes no total; both stay counted; the figure stops being "reconciled" until the owner looks. Tests: a hit; the same amount and date with no provider evidence (no hint); a `bills-for` link as the evidence; three typed $50.00 payments in three modules (all counted, no hint).

## 11. Commitments aggregation and lifecycle cutoffs (`commitments.ts`)

Sources, each reused: Bills expected payments are the billing periods the Bills Overview, Upcoming and Today already use (what REMAINS on each open period; a test pins that the sums equal `cashTiming`); twelve-month Bills commitments are `buildCommitments` (which already follows B4's effective prices and stops expecting bills after a CONFIRMED, undisputed cancellation date); Services come from `expectedWindow` (per-visit estimates on the real cadence, counted from the real open visit; a moved visit counts once, on its day). **Home & Assets contributes none:** its maintenance plans are Tasks with no expected cost, and `assets/model.ts` has no expected-amount field. Tested: monthly, variable, unknown, semimonthly, biweekly, quarterly, annual; an introductory price then a later step ($5.00 on 18 Nov and 18 Dec, $15.00 from 18 Jan; twelve months $5.00 × 2 + $15.00 × 10); a confirmed future cancellation (only 18 Nov and 18 Dec); a request with no confirmation (all three, each row says so); two different confirmed dates (nothing cut off, rows say "in dispute"); two prices for one day (that payment is *in dispute*, not either price); a loan-tracked bill (excluded); paused and ended arrangements (none). **Cancellation on the Overview never hides a Calendar item.**

## 12. Expected cash timing and uncertainty labels

Windows are [today, today + N], both ends included (7 days ends 15 Nov, 30 ends 8 Dec, 90 ends 6 Feb 2027 for a 8 Nov start), derived by the existing date readers, never a fixed 30-day month. Boundary tests: a payment exactly 7 days away is in the 7-day window and one day later is not; 8 Dec is in the 30-day window and 9 Dec is not. Labels: **Known** (billed or fixed), **Estimated** ("varies" amounts and Services visit estimates), **Not known** (counted, never added), **In dispute** (two recorded prices or amounts; counted, never added). A Finance Scheduled payment linked to a bill is counted once, as the bill; no Finance rule or forecast is read (guard). A per-month, per-season, per-year or quoted Services estimate is not converted into a window figure (S3's rule) and is counted as not known.

## 13. The Overview and drill-down

Order: expected payments (7 / 30 / 90 day choice), upcoming contractual actions, commitments (twelve months), recorded spending (period choice, the same periods Services offers), spending by household area (additive table plus "why this is less than the three module pages added together" and a by-kind list), needs review, **what is counted** (every Finance payment with its date, Finance status word, every record that links it, a link to each, and why it counts once; every typed entry with whether it counts), where things are managed. "What is counted" begins with the proof line: *$552.98 from Finance payments plus $95.00 typed = $647.98.* Amounts are bold and tabular; counts are small pills, so the two are never confused. A loading state shows no totals; a failed read shows an error with Try again.

## 14. Household Services Related bill card

`relatedBill.ts` + `RelatedBillCard.tsx`: read only. It reads the EXISTING `bills-for` link through Bills' own `billsLinkedTo` and `getObligation` (no new link, no new field, no automatic linking by name). Shows the bill's title (a link to it), a state chip (Active, Paused, Cancelling, Ended, Not here, Needs review), how it is paid and when ("Monthly, on the 15th · I pay it by hand"), and the amount in force (masked with Hide Amounts). A missing bill ("It may have been deleted on another device, or it has not reached this device yet. The link is kept."), an ended bill and a paused one are explained, never hidden. Tests (`b5-data.test.ts`): shown and reads writes nothing; a same-name bill is NOT shown; a missing bill is explained and the link row stays; an ended bill; unlinking removes the row and leaves the arrangement, its visits and every Task byte-identical; survives sync and restore.

## 15. Today and Calendar

**Today:** one card, `household.attention` (priority 38, half width, `hideWhenEmpty`), counts only and only what the Bills and Services cards cannot say: possible duplicate payments across modules, a bill and a service that may be one expense, expected payments in the next 30 days with no known amount. It does not repeat any Bills or Services concern (verified in the browser beside the real Bills and Home & Assets cards). No name, no amount; it never writes. **Calendar:** untouched (no layer, no provider, no marker; `docs/due-provider.md` says so). Verified in the browser: 7 of 7 layers shown by default, each layer toggles, Select all restores, Deselect all present, Bills and Services markers and visits present, a Finance Scheduled marker still says "Scheduled payment to approve" with "Edit in Ledger", Escape closes its dialog. Folding a bill and an arrangement on the Overview hides nothing on the Calendar.

## 16. Cross-module Needs review categories (`review.ts`)

Informational (one payment supports several records, a whole and its part, a changed Finance amount, a folded pair); Possible duplicate (typed and Finance across modules; typed beside Finance in one Bills period, already left out); Confirmed duplicate (S4 `recorded-as` jobs: the second typed amount is already left out); Missing or out-of-date evidence (a linked payment that is deleted, restructured or no longer spending; a payment marked paid with no amount; two different typed amounts); Contractual overlap (a linked bill and arrangement that cannot safely be one expense); Lifecycle (the Bills read model's own items: disagreeing cancellation dates or prices, a request awaiting confirmation, charges after a cancellation, an active Scheduled payment for a cancelled bill, a passed trial or renewal date; plus the one new rule: a confirmed cancellation date while a linked arrangement still expects visits after it). Sharing is never reported as a duplicate. **No repair is offered**: every item links to the record that owns the fix.

## 17. Financial reconciliation proofs

- `invariants()` runs on every union scenario and every random world: total = Finance + typed; Σ piece cents = Finance; Σ authoritative typed = typed; the **additive attribution adds to the total exactly**; the by-kind breakdown adds to the total exactly; paid out − money back = Finance; Σ status words = Finance; every piece once; every piece has an association and a reason; the reconciliation explains the difference; **no text the data layer writes contains a `$`**.
- **Independent oracle** (in the test, reading raw transactions, sharing no code with `spend()`, `resolveRef` or `pieceKey`): 300 seeded random households (Services visits, Home & Assets records and Bills periods, refunds, split transactions, whole and part references, typed amounts), each also shuffled in every record array: total equals the oracle, pieces and attribution are identical in any order. The test asserts the generator really reached the hard paths (shared across modules in more than 40 worlds, cross-module cover in more than 5, refunds in more than 40, three-module pieces in more than 3).
- A hand-worked real-database household (`householdSeed.ts`): 150.00 + 15.49 + 15.49 + 62.00 + 340.00 − 30.00 + 95.00 = **$647.98**; the loader returns exactly that, with $552.98 Finance-backed, $95.00 typed, $30.00 money back and attribution Bills $92.98 / Services $0.00 / Home & Assets $405.00 / Shared $150.00.

## 18. Two-device `SyncEngine` and backup/restore evidence (`b5-data.test.ts`, real encryption, fake IndexedDB)

Both devices compute the same figure, pieces and associations and the same Related bill after a sync; a transaction linked independently on each device (Bills on A, a new Home & Assets record on B) converges: counted once with both associations; a payment deleted in Finance is flagged on BOTH devices and counts nothing on both; a typed Bills payment on A and a typed Home & Assets cost on B are both kept and counted on both; an unrelated Task edit on another device changes nothing about the figure; an existing guarded Undo (`runUndo`) still works after the household was read. **Backup:** `buildBackup`, `checkBackupText` and `restoreChecked` restore a database that produces the same total, pieces, review list, commitment windows and Related bill. The household module adds no record kind, so no backup summary label was needed.

## 19. Immutability and Finance non-mutation

Whole-database fingerprints (every row of every table, as text) before and after loading the overview twice are identical; the same after rendering the Related bill; a failed read leaves the database identical and a retry works. In the browser, a fingerprint of all 39 tables (every Finance table and every shared store) was identical after visiting the Services page and the household page. `b5-guards.test.ts`: no database write call, no Finance writer, no forecast or posting import, no network, no storage write, Finance read only through `loadTxnMap`, the readers do not mention the household module, and only `modules/index.ts` and `services/ArrangementPage.tsx` import it. **`git diff HEAD --stat` at the end of the build** (final Git status, section 25) shows the only modified existing source files are those two.

## 20. Mutation and fault-injection results

`scripts/household-b5-mutation-check.cjs` breaks production source on purpose, runs the 135 household tests, and restores the file. Each entry names the invariant, and the table says which test file caught it.

**25 mutations, 25 caught (after two genuine test gaps were repaired).** Mapping to the brief's list: shared piece counted twice = M1; whole beside its part = M2, G1; refund ignored = M3; typed over an authoritative Finance link = M4, G2; unknown counted as zero = M10; cancelled subscription projected indefinitely = M16; Bills and Services counted twice = M11, M13; a one-off Services charge suppressed = M12; breakdown that sums misleadingly = M6; stale reference counted as live = G4 (and M7 for "not flagged"); Finance transaction modified during a read = M17; Calendar recurrence changed by a dashboard filter = M19.

| ID | Broken on purpose | What it would mean | Caught by |
|---|---|---|---|
| M1 | a piece reached by two readers is not merged | a payment linked from Bills and Services counted once for each | `b5-union`, `b5-data`, `b5-ui` (22 tests) |
| M2 | no cover of a part by a whole across readers | a whole and its part both added | `b5-union` (3) |
| M3 | refunds ignored in the total | money back would not lower it | `b5-union`, `b5-data`, `b5-ui` (12) |
| M4 | a typed amount set aside by a Finance link is counted | typed added over the Finance payment | `b5-union` (1) |
| M5 | typed amounts of equal size in different modules merged | two real payments become one | `b5-union` (2) |
| M6 | a shared payment credited to the first module | the breakdown hides sharing and credits by list order | `b5-union`, `b5-data` (3) |
| M7 | stale evidence never makes the figure "not reconciled" | a total looks reconciled while a link counts nothing | `b5-union`, `b5-data`, `b5-ui` (5) |
| M8 | two different typed Bills amounts not reported | a dispute passes unnoticed | `b5-union` (1) |
| M9 | a possible duplicate needs no relationship evidence | any same amount and date is flagged | `b5-union` (1) |
| M10 | an unknown visit amount becomes a known $0.00 | unknown shown and added as nothing | `b5-commitments` (2) |
| M11 | a folded service row is still added | a bill and its service counted twice | `b5-commitments` (1) |
| M12 | folded whenever amounts are known (equality ignored) | a genuine extra charge swallowed | `b5-commitments`, `b5-data` (5) |
| M13 | linked records are never folded | a bill and its service counted twice | `b5-commitments` (1) |
| M14 | a window includes one day too many | a payment 8 days away in the 7-day window | `b5-commitments` (1) |
| M15 | twelve months run one day past the Bills window | Bills and Services summed over different windows | `b5-commitments` (1) |
| M16 | a confirmed cancellation no longer stops expected bills (Bills `model.ts`) | a cancelled subscription projected indefinitely | `b5-commitments`, `b5-golden-master` (3) |
| M17 | the load writes to Finance | reading the dashboard changes a transaction | `b5-data`, `b5-guards` (3) |
| M18 | a failed second Finance read replaced by an empty result | a partial total looks complete | `b5-data` (1) |
| M19 | a dashboard control writes the Calendar layer choice | a filter changes what the Calendar shows | `b5-guards` (1) |
| M20 | an amount ignores Hide Amounts | amounts show while hidden | `b5-ui` (1) |
| M21 | the related bill found by provider name | related by a similar name | `b5-data` (6) |
| G1 | `spend()`: a part counted beside its whole | existing reader broken | `b5-golden-master` (2) |
| G2 | Bills: a typed amount kept beside Finance links in one period | existing reader broken | `b5-golden-master` (1) |
| G3 | `householdSpend()`: typed amounts on a linked job count beside Finance | existing reader broken | `b5-golden-master` (1) |
| G4 | `resolveRef`: a restructured split treated as unchanged | a stale reference counted as live | `b5-golden-master`, `b5-union` (3) |

**Two real test gaps were found by this run and repaired before it was re-run.** (a) **G2 survived.** The total does not change when a typed amount is kept beside Finance links (`spend()` ignores it), so my first golden master missed the single-source property that Bills' own test asserts. I added assertions that the cost record carries references and no typed amount and that `both` is empty; G2 is now caught. (b) **G3's first "catch" was hollow:** my replacement text left an `else` with no `if`, so the file failed to parse (0 tests failed, 5 files failed to load). I rewrote the mutation to stay valid, it then **survived** (my household tests never covered a Finance payment on one side of a linked job and a typed amount on the other), I added that case with a hand-worked answer ($120.00, not $240.00), and G3 is now caught by one failing test.

**Fault injection (real database and browser).** A rejected Finance read (the first, and separately the second) rejects the whole load, leaves every table identical and a retry works; in the browser the page showed an error, **zero money figures and no totals**, then recovered with "Try again". Damaged records (an unknown billing fact, a link to a deleted transaction, a malformed arrangement) never break the load and never become money.

## 21. Browser acceptance evidence

An isolated, fresh origin (`http://b5.localhost:5173`, a different browser origin from the app's `localhost`; first checked empty apart from the app's 13 built-in categories and 7 category groups) with **invented data only**, seeded through the app's own creation functions: five bills (three subscriptions, a power bill, a cleaning bill), two service arrangements, four Home & Assets records, six Finance transactions plus one deleted after linking, a `bills-for` link made through the real preview and apply path, a future price increase, a confirmed future cancellation, a disputed cancellation date and an unconfirmed request. No existing database was cleared or overwritten.

**Real clicks, key presses and screenshots:** the 90-day choice (click) and ArrowLeft (key; selection and focus moved correctly); the Hide Amounts toggle on Today (click); a Calendar layer toggle and Select all (clicks); a Calendar marker (click) and Escape (key; the dialog closed); "Try again" after an injected failure (click); screenshots at desktop and 375 px, light and dark, with amounts hidden, of the failure state, the Related bill card and the Calendar. **DOM-level only (not clicks):** the period choice was set with a form-input call; page text scans (money leaks), overflow measurements, the 39-table fingerprint, console error capture, and hash navigation between pages.

- **Journey A (dashboard):** commitments, expected payments and recorded spending appear as three separate cards. The 30-day known $177.48 = Sparkle $150.00 + Streamly $15.49 + Daily News $9.00 + Cloudy $2.99; the twelve-month known $2,028.83 = Streamly 2 × $15.49 + 3 × $17.99 (price step, then the confirmed 31 Mar cutoff) + Cloudy 12 × $2.99 + Daily News 12 × $9.00 + Sparkle 12 × $150.00 (all hand-checked); 41 known and 38 estimated payments.
- **Journey B (cross-module duplicate):** the $150.00 cleaning payment linked from a Services arrangement, a Bills period and a Home & Assets record is one recorded amount; "What is counted" lists all three records with links; the review list has a "good to know" entry; the table fingerprint is unchanged.
- **Journey C (price change and cancellation):** the price step affects only the payments on or after it; the cutoff stops Streamly after 31 Mar; its historical payments stay in recorded spending; the disputed Cloudy date keeps its bills expected and says why; the unconfirmed Daily News request appears under actions and in review.
- **Journey D (Services association):** the arrangement shows "Sparkle Cleaning · Active · Monthly, on the 15th · I pay it by hand · $•••• each time" with a working link; visits and Tasks were not touched (fingerprint).
- **Journey E (privacy and Calendar):** with Hide Amounts on, the household page showed 46 masked figures and no dollar figure; Today showed none; the Related bill card showed none; Calendar layers stayed individually selectable; the Finance Scheduled marker and its approval route stayed; Services visits stayed.

**Real flaws found by looking, and fixed:** (1) the twelve-month cards said "4 payments" but counted bills (now payments: 41 and 38); (2) Bills and Services were summed over twelve-month windows ending a day apart (now one window, with a regression test); (3) the overlap notice repeated itself; (4) a folded service row could not name its bill (a lookup bug); (5) "1 assets"; (6) explanatory copy contained "$0.00", which showed up in the Hide Amounts scan (now "zero"); (7) the area table's header cells were shaded white against the card; (8) "Active" appeared twice on the Related bill card; (9) the shared payment's label repeated. Transient console errors during the session were hot-reload states between my own edits; a fresh load across four pages raised none.

**Not done and not claimed:** a real phone, offline use, a second physical device, an older build, a real screen reader, a measured contrast ratio, a full Tab walk of every control.

## 22. Privacy, accessibility and performance

**Privacy:** the repository gets no real data (everything is invented; the mutation results went to a scratch folder, not the repository). Text the data layer writes never contains an amount (tested), so Hide Amounts has nothing to hide there; the page masks every figure and passes titles through the existing masking function; Today shows counts only; no account number, provider note, phone, email or link is read or shown; no Project money is read. **Accessibility (structure, not assistive-technology testing):** every card is a labelled region, radio groups have a legend and arrow keys work, the table has a caption and scoped headers, disclosures have summaries, status and error areas have roles, and the choice buttons I styled are set to 40 px tall or more (44 px at phone width) in the stylesheet (read from the CSS, not measured on a device; the shared page header, select and floating add button are the app's own). **Performance (operation counts, not wall time):** 300 bills, 1,500 payment links, 60 arrangements and 3,000 transactions load with no per-transaction read, no full transaction-table read and at most two `bulkGet` calls (Bills' own, plus one for what only Services or Home & Assets reference); the union is linear (one pass per list plus one merge by key). The page reads the whole data set on each change; that is fine at this size in tests and not measured on real data.

## 23. Deviations from B0 and earlier decisions

1. **B0 12.5's `unionRecords` extraction was not done.** B0 proposed moving S5's record-building block into an exported helper behind the golden master. B5 instead composes the finished results of `householdSpend()` and `billsRecordedPayments()`. Same totals (proved by the oracle), zero change to the three readers, and the existing guard in `b3-spend.test.ts` stays true. B0's own fallback also named "no S5 file is touched"; B5 keeps that and still delivers the cross-module figure.
2. **Attribution is "one module or Shared", not "credited to the first in order"** (B0 12.5 said services, home, bills). The brief asked for an explicit, non-arbitrary policy.
3. **The three-module result is on a new page and a new module,** not only on the Bills overview (B0 12.5 item 4). The brief asked for a consolidated Overview.
4. **B0's "Tagged to Project X" chip and context count (test row 78) were not built.** A piece Finance also tags to a Project is still counted once and no Project money is read; the chip is simply absent.
5. **B0's optional Loans line (T9, needs owner approval A-8) was not built.** Loan-tracked bills are excluded, as in Bills.
6. **B0's "Provider-linked obligations" page and "Settings" are not part of B5.**
7. **The twelve-month window is Bills' own** (today to the same day next year minus one day), not Services' Calendar horizon (one day longer), so one figure never mixes two ends.
8. **A Services estimate that is not per visit is counted as "not known" in a window,** following S3's own rule (no approved part-month rule), rather than converted.
9. `b5-guards.test.ts` deliberately has NO "no change since the last commit" test (it would fail any legitimate later edit to the schema or sync code); that evidence is recorded here instead.

## 24. Known limitations and owner decisions

**Limitations:** see the handoff's B5 carry-forward (a pair matching over 30 and 90 days can differ over twelve months because 26 biweekly visits are not 24 half-months, so the twelve-month card raises an overlap notice by design; Home & Assets adds no commitment; the possible-duplicate hint needs amount, date and provider evidence; the page is not in Search or Quick Add; nothing is exportable; the Today card hides on a read error; real-device, offline, older-build, screen-reader and Tab-walk acceptance are not done).

**Owner decisions needed (proposed defaults in bold):**
- **O-18** Is exact equality the right test for folding a linked bill and arrangement? **Yes (conservative); a tolerance would risk hiding a real extra charge.**
- **O-19** Should the page be reachable from Search (a page link only, no amounts)? **Yes, later and small.**
- **O-20** Default period for recorded spending: **last 12 months** (as Services) or the calendar year?
- **O-21** Should any list on this page be exportable? **Not now (nothing is exported today).**
- **O-22** Should Today show the expected-payments-with-no-known-amount count at all, since the page already does? **Yes, 30 days, counts only.**

**Preserved backlog (nothing here was marked complete without its tests):** real-device acceptance, offline acceptance, older-build compatibility, a real screen-reader and Tab-walk review, custom palettes, Calendar export privacy (O-2 from B3: an optional "leave amounts out of exported files"), **B3.2** (deferred Finance Scheduled creation from a bill), and the deferred transaction-discovery refinements (B3.1 report section 21).

## 25. Exact final Git status

Branch `main`; `HEAD` = `origin/main` = `a89f197` (B4, deployed). **Nothing is staged, committed, pushed or deployed.** `git status --short` at the end of the build:

```
 M README.md
 M docs/BACKLOG.md
 M docs/CHATGPT-HANDOFF.md
 M docs/due-provider.md
 M docs/module-hooks.md
 M src/modules/index.ts
 M src/modules/services/ArrangementPage.tsx
?? docs/BILLS-SUBSCRIPTIONS-B5-REPORT-2026-11-08.md
?? scripts/household-b5-mutation-check.cjs
?? src/modules/household/            (21 files: 13 source, 6 test files, 2 test helpers)
```

`git diff --stat HEAD` over `src/modules/assets`, `src/modules/bills`, `src/modules/ledger`, `src/modules/calendar`, `src/modules/tasks`, `src/modules/projects`, `src/modules/today`, `src/lib`, `src/db.ts`, `src/core`, `src/shell`, `src/ui`, `package.json`, `package-lock.json`, `vite.config.ts` and `tsconfig.json` is **empty**; over `src/modules/services` it is `ArrangementPage.tsx | 3 +++` (one import, a blank line and the one component line). `src/modules/index.ts` is `+2` (an import and a registration). No real household data, secret, email address or phone number is in any added file (scanned). The mutation script wrote its results to a scratch folder, not the repository, and every file it breaks was restored (the empty diff above is taken after the last mutation run).

**Is B5 ready for independent review? Yes.** All gates that were run are green (3,304 tests in 178 files; `tsc`; the production build; `git diff --check`; 25 of 25 mutations caught; the browser journeys). What it does not and cannot claim: real-device, offline, second-device, older-build, screen-reader and full Tab-walk acceptance (section 21), and nothing about real data. **Do not commit or push until ChatGPT has reviewed this report and the owner has explicitly authorized it.**

## 26. Final release checks (ChatGPT verdict: APPROVED WITH TWO FINAL RELEASE CHECKS, 2026-11-08)

**Re-verified first:** branch `main`; `HEAD` = `origin/main` = `a89f1972260b55a65ed45c78c03f733d619b35ef`; Pages run #73 `completed` / `success`; the working tree held exactly the reviewed B5 files and nothing else.

**Check 1, Today read failure (one small production change, `todayCards.tsx`).** Today now tells three things apart: *loading*; a *successful load with nothing to say* (real zero counts: the card hides, as before); and *unavailable* (a source read failed): a discreet card, "Household figures could not be read just now, so nothing is shown", with a link to `#/household`, no counts, no badge, no digit, no name, no amount. The loader is `loadTodayState` (a failure returns `'unavailable'`, never zero counts) and the view is the pure `HouseholdCardView`. No new card and no Today-system change. Tests (`b5-release.test.ts`): a real injected failure of the first and of the second Finance read gives `unavailable`, writes nothing (whole-database fingerprint) and a retry gives the real counts; an empty household is real zeros, not `unavailable`; static markup for all four states.

**Check 2, period switching (no production change needed).** On the hand-worked household plus a $50.00 payment on 5 Oct and its $20.00 refund on 20 Oct, loaded for last 30 days (10 Oct to 8 Nov), last 90 days and all time: last 30 = Finance $227.49 ($150.00 + $15.49 + $62.00 − the $20.00 refund, whose payment is outside the window), typed $0.00 (the $95.00 gutter cleaning is 5 Oct), total $207.49, money back $20.00; last 90 and all time = Finance $572.98 + typed $95.00 = $677.98. In every period: total = Finance + typed, the additive attribution and the by-kind breakdown add to the total exactly, every piece appears once, the $150.00 three-module payment is one piece credited to "Shared", the reconciliation explains the difference, unknown counts are unchanged and never become amounts, the twelve-month commitments and the review list are byte-identical across periods, and a whole-database fingerprint is unchanged. Typed amounts follow their own date (in a window that holds 5 Oct, out of one that starts 6 Oct).

**Owner defaults recorded (approved):** folding a linked bill and arrangement needs exact equality (O-18); a Search link is deferred (O-19); recorded spending defaults to the last 12 months (O-20); export is deferred (O-21); the unknown expected-payment count stays on Today (O-22).

**Limitations still outstanding:** physical phones and two physical devices; offline testing; an actual older build; a screen reader and a full keyboard review; custom colour palettes; privacy of exported Calendar files; B3.2 (Finance Scheduled creation from a bill); discovery cadence refinements; the legacy B1 presentation of a future-dated End.

**Results:** see the final commit section below, appended after verification and deployment.
