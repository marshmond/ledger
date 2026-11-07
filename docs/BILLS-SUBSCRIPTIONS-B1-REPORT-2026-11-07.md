# Bills & Subscriptions B1: obligation registry, schedule definition and basic lifecycle. Implementation report

Date: 2026-11-07. Status: **BUILT AND TESTED LOCALLY. NOT STAGED, NOT COMMITTED, NOT PUSHED, NOT DEPLOYED, NOT ACCEPTANCE-TESTED ON REAL DEVICES.** B2 has not been started. All example names, providers and amounts in this document, in the tests and in the browser checks are invented.

## 1. Executive summary

B1 adds the foundation of Bills & Subscriptions as a new module (`#/bills`). The owner can open it, add a bill or subscription with three answers (what it is, how much, how often), pick or create its provider as an ordinary shared Contact, say how it is paid, see the next expected dates and a 12-month commitment estimate, edit it, pause, resume, end or reopen it, put it on a personal review list, and delete it only if it never had any history. Every action that changes something shows what will happen first and has an Undo that refuses, writing nothing, if anything changed in between.

What it deliberately is not: nothing is paid, posted, matched or recorded; nothing is created in Finance, Tasks or the Calendar; no billing-period record exists; there is no Today card, due provider or Calendar layer. Every figure is an EXPECTED amount worked out from the terms the owner typed. An unknown amount is counted but never treated as zero, and annual or irregular bills are never described as monthly spending.

Headline results:
- **2,463 tests pass in 142 files** (baseline 2,265 in 133, re-run at the start; 198 new tests in 9 new files). `npx tsc --noEmit` clean. `npm run build` succeeds (the existing chunk-size warning only). `git diff --check` reports only line-ending notes.
- **B1.0 took the preferred path:** the month-slot date helper moved to `src/lib/semimonthly.ts` with a re-export; Household Services behaviour and tests are untouched and green.
- **One real gap in the B0 identity contract was found and handled without improvising** (section 6.3): a "from now on" schedule change that starts mid-month, after that month's bill has passed, would make two schedules claim the same billing period. B1 refuses it with the period named and a clean start date suggested. This matters for B2 (section 13).
- **34 mutation checks** deliberately broke the recurrence, persistence, Undo, lifecycle, commitment and Quick Add code: 33 were caught by tests, 1 survived and is an equivalent mutant (dead defensive code, explained in section 11).
- Browser checks (invented data, the pane's own database) at desktop and 375 px, light and dark, with Hide Amounts, keyboard Tab and Escape, Quick Add, Pause then Undo, End then Reopen, the delete refusal and the schedule-change refusal and success.
- **Not verified:** a real phone, two physical devices, offline use, a real screen reader, measured contrast, and a real older Ledger build (section 12).

## 2. Verified Git and deployment baseline

| Check | Result |
|---|---|
| Repository | `C:\Users\alexm\projects\finance-app`, remote `https://github.com/marshmond/ledger.git` (`marshmond/ledger`). |
| Branch and SHA | `main`. After `git fetch origin`: `HEAD` = `origin/main` = `8059e5f52d1ae8205016b597dcc9013b73030136` (`docs(bills): B0 Revision 2 design plan; record S5 as deployed`). |
| Deployment | Public Actions API (`gh` is not installed on this machine): "Deploy to GitHub Pages" run **#68**, `head_sha` `8059e5f5…`, `completed` / **`success`**. S5 `6863ac2d…` run **#67** `completed` / `success`. |
| Working tree at the start | **Clean** (`git status --short` printed nothing). |
| B0 documentation | **Differs from the brief's expectation.** The brief said the B0 documentation "may still be uncommitted". It was already committed and pushed in `8059e5f` (the plan, the backlog and the handoff). Nothing needed preserving or discarding, and no unrelated change or unreviewed commit was present, so the scope was established safely and work proceeded. The committed B0 plan was read in full (sections 3, 5, 10, 13, 14, 18 in detail). |
| Baseline | `npm test`: **133 files, 2,265 tests passed** (29.9 s). Equals the S5 and B0 figure. |
| Approval recorded | ChatGPT: "B0 ARCHITECTURE APPROVED WITH IMPLEMENTATION SAFEGUARDS". Owner: defaults A-1 to A-11 accepted (including the revised A-3, A-8, A-11). B1 only authorized. Recorded in `docs/CHATGPT-HANDOFF.md` and `docs/BACKLOG.md`. |

The brief's other prerequisite documents were read: `CLAUDE.md`, the handoff, the backlog, the S3 and S5 reports (headings, the S3 semimonthly and cadence sections), `docs/module-hooks.md`, and the Services model, data, undo, schedule, search, quick-add, records and page code.

## 3. Files added and changed

**Changed (5 files, small):**
| File | Change |
|---|---|
| `src/modules/services/semimonthly.ts` | Now only `export * from '../../lib/semimonthly'` (was the 140-line helper). Every name and behaviour Household Services used is unchanged. |
| `src/modules/index.ts` | Registers `billsModule` (one import, one line). |
| `src/lib/backupSummary.ts` | Names the `bills` kinds and group ("Bills and subscriptions", "Billing-period records", "Bills & Subscriptions"). |
| `README.md`, `docs/module-hooks.md` | Bills sections. |
| `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md` | B1 entries, approval record, risks. |

**Added:**
| File | Purpose |
|---|---|
| `src/lib/semimonthly.ts` | The shared date helper (moved), plus the additive `slotProblem` and `monthSlotDates`. |
| `src/modules/bills/model.ts` (383 lines) | Obligation types, defensive reader `asObligation`, `toStored`, `applyEdit`, validation, prices and expected amounts, loan exclusion, labels. |
| `schedule.ts` (267) | Schedule types and reader, `expectedDates`, slot ids, `planScheduleChange`, descriptions. |
| `scheduleDraft.ts` (86) | The form's schedule draft (pure). |
| `commitments.ts` (77) | The 12-month Known / Estimated / unknown figures (pure). |
| `views.ts` (87) | List rows, filters, Overview read model (pure). |
| `data.ts` (302) | Load, create, edit, review list, lifecycle plan and apply, delete plan and apply, provider resolution. |
| `undo.ts` (81) | The local guarded Undo (about 80 lines, as B0 promised). |
| `util.ts`, `paths.ts`, `records.ts`, `searchSource.ts`, `quickAddDef.ts` (169) | Helpers, addresses, record links, Search, Quick Add `bs`. |
| `BillsModule.tsx`, `index.tsx`, `OverviewPage.tsx`, `ListPage.tsx`, `ObligationPage.tsx`, `ObligationForm.tsx`, `ScheduleFields.tsx`, `Dialogs.tsx`, `BillsParts.tsx`, `bills.css` | The screens. |
| 9 test files + `billsTestkit.ts` | 198 tests (section 9). |
| `scripts/bills-mutation-check.cjs` | Repeatable mutation check (section 11). A developer script, not part of the app. |
| `docs/BILLS-SUBSCRIPTIONS-B1-REPORT-2026-11-07.md` | This report. |

**Not touched (as required):** `src/db.ts`, `src/lib/backup.ts`, `backupFile.ts`, `src/lib/sync/*`, `src/types.ts`, `src/lib/schedule.ts`, Finance code, `src/modules/tasks/*`, `src/modules/calendar/*`, `src/core/recurrence.ts`, `services/undo.ts` and every Services behaviour. No new table, migration, dependency or backend.

## 4. Detailed B1 functionality

**Add and edit (`ObligationForm`).** Three questions first: What is it? How much? (the same each time, it varies, I do not know) How often? Then Who pays it? (automatic, by hand, not sure) and the provider. Under **More details**: type (guessed from words in the name, changeable), a "how important" label (a suggestion, never a restriction), the date Ledger starts expecting bills (default: today), the funding account (read from Finance, never written), "already paid through my loan payment" (insurance and tax only), the review list with a note, document links, notes (with the "no codes or passwords" warning). The schedule picker shows the pattern in words and **the next three expected dates before saving**. Validation is strict at save and gives plain messages (title first, then amount, schedule, provider). The provider is chosen from existing Contacts or typed; a typed name that matches an existing Contact reuses it ("No second contact is made").

**Schedules.** Weekly, every 2 weeks, every 4 weeks, every N weeks; monthly on a date, the last day, the last business day, with an optional weekend rule (the business day before or after, refused if it could leave its month); every 2 months, quarterly, every 6 months, once a year, every N months; twice a month (two slots); no regular schedule. The person picks the date of the next bill and the weekday, day and anchor month all come from it.

**Overview (`#/bills`).** Counts (active, paused, ended); **Expected recurring costs, next 12 months** split Known (fixed amounts) and Estimated (amounts that vary), each with a clearly labelled "averaged per month" line, plus an honest line for unknown amounts, on-demand bills and loan-related bills left out; **Coming up** (expected dates for 45 days, a preview, nothing created); **Your review list**; **Worth a look** (records that need review, a doubled billing period). Wording never says spent or paid.

**All bills (`#/bills/list`).** Active, Paused, Ended, All (with counts); type filter; provider filter; each row shows provider, amount in words, schedule in words, type, review-list tag and the next expected date.

**Detail (`#/bills/o/<id>`).** Status, type and importance chips; provider (with "contact removed" if the Contact is gone, using the saved name); Terms; Next expected dates (six, with per-date amounts); earlier schedules and pauses; the review-list choice; document links; notes; what the owner has done to it (a small life-story log); Edit, Pause or Resume, End or Reopen, Delete. A "Needs review" banner appears when stored values cannot be read by this version; a banner appears if two schedules claim one period; loan-related bills say so and link to Loans. No payment history is shown because none exists.

**Lifecycle.** Pause (from a date), Resume (expected again from a date; nothing is caught up), End (last expected day and a reason; ending while paused closes the pause), Reopen (the ended time stays without expected dates so nothing appears as missed), Delete (only when the bill has no history; otherwise the dialog says why and points to End). Each shows "What will happen" first, applies everything in one transaction, refuses if the record changed since the preview, and offers Undo.

**Search, Quick Add, record links.** Search matches title, provider name and type label only (never amounts, notes, links or contact details), kind "Bill" or "Subscription", ended items last. Quick Add `bs` (aliases `subscription`, `sub`) with a preview; Finance keeps `b` and `bill`. Records `obligation:<n>` can be linked from other modules (labels: title, provider, status).

**Hide Amounts.** Every figure on the Overview, list and detail pages goes through one helper and shows `$••••`; the browser check found zero unmasked amounts on all three pages.

## 5. Decisions and deviations from B0 (numbered, please review)

1. **Mid-month schedule change (the identity gap, section 6.3).** B0 rows 20 and 54 describe a change on the 1st. A change that starts later in the month, after that month's bill, would give two schedules one billing period. B1 refuses it (with the period, both dates and the nearest clean start) instead of choosing. An old schedule that never applied to any date is simply replaced.
2. **Weekly slots.** The slot is the Monday of the week holding the date, and a weekly schedule's first date must fall on its weekday (checked). Dates come from the existing `generateDates`; an oracle test proves the equality.
3. **No separate schedule end date.** B0 3.3 lists "plus optional end date". The bill's own end date (`endedOn`) does that job, so B1 has one concept, not two.
4. **Pause interval.** `to` is the first day expected again (B0 left this open). Ending closes an open pause one day after the end date. Reopening adds the ended time as a pause interval ("no dates, nothing missed"). This adds a stored interval B0 did not describe but needs no new field.
5. **Ended with a future date.** The status becomes Ended at once; dates are still expected up to and including the end date.
6. **Commitments use the same reader as the previews for every status**, with no special case, over `[today, same day next year minus one day]` so a monthly bill counts 12 times, not 13. (B0 T4 says "next 12 months".) The lifecycle previews use the same window.
7. **Importance default.** `other` defaults to "Not sure" (B0 said "others: essential").
8. **Quick Add leaves who pays as "not stated"** unless typed (B0's example preview said "pay by hand" for a utility but 9.3 says autopay is unknown unless said).
9. **Loans.** Every `loan`-type bill, one with a loan pointer and one marked paid through the loan is left out of the figures and the Coming-up list (A-8). There is no Loan picker screen yet; the `loanId` field is kept.
10. **Later-phase fields** (`terms`, `cancellation`, `reminders`, `scheduledRuleIds`, `payeeHints`, `categoryId`, `acknowledged`, `predecessorId`, `lifecycle`) are read, validated and written back, with no screen.
11. **Undo** also covers the review-list change and Delete (B0 listed add, edit, end, reopen, pause, resume). It never deletes the Contact, including for Quick Add (Services' Quick Add Undo can remove an untouched new Contact; B0's "no automatic deletion of shared Contacts" is followed here).
12. **A repeatable mutation script** `scripts/bills-mutation-check.cjs` was added to the repository so the section 11 results can be re-run.
13. **Tracking and the first price.** "Expected from" defaults to the day the bill is added; the first price step starts then. Editing the tracking date earlier moves the first step with it, so a date is never left without a price.
14. **Records written for old data.** An obligation with a damaged field keeps the damaged value in a reader-only `rawKept` map (generalising the S2 visit pattern) so an ordinary edit cannot erase it.

## 6. Recurrence and slot-identity evidence

### 6.1 B1.0 outcome
Preferred path. `src/lib/semimonthly.ts` is the old file with one changed import path plus the new single-slot functions. `src/modules/services/semimonthly.ts` re-exports everything. Evidence: the 52 existing Services recurrence tests (`cadence-semimonthly`, `cadence-flows`) and the whole Services suite pass unchanged; a test proves every exported name on the old path is the very same function object as on the new path and the two export lists are equal; golden twice-monthly dates and refusal messages are pinned.

### 6.2 The oracle and the calendar cases (`semimonthly.shared.test.ts`, `schedule.test.ts`)
- Day 1 to 31 x every 1, 2, 3, 6, 12 months x three 31-day anchor months, 2024 to 2034 (including the leap years 2024, 2028, 2032): **465 comparisons, all equal to `generateDates`**. February anchors for days 1 to 28 across the same periods. The 29th of February annual rule: 29 Feb in leap years, 28 Feb otherwise, equal to the yearly generator. The 31st clamps to 30 April, 28 or 29 February.
- Last day and last business day for every month of 2024 to 2027 against independent weekday arithmetic (no `Date`). Previous and next business-day adjustments for a Saturday, a Sunday and a weekday.
- Weekly families equal `generateDates` for every 1, 2, 3, 4, 6 weeks and Sunday, Monday, Friday anchors; every 2 and 4 weeks are exactly 14 and 28 days apart across a year end; twice a month equals the Household Services dates; `nextExpected` finds the next date of an every-24-months bill.
- Weekend adjustments that could leave their month are refused with a real example; every adjustment that passes stays inside its month over 2000 to 2130.

### 6.3 Slot identity, the safeguards, and the gap found
| Safeguard | Result |
|---|---|
| 1. The slot does not change merely because an actual due date moves | The reader has no due-date input at all (a test pins its input fields). A business-day adjustment, a different day of the month and a different weekday leave every slot unchanged over ten years. |
| 2. Twice-monthly identity under edits | `a`/`b` follow rank, so the order the days are entered in changes nothing; changing 1st/15th to 10th/20th keeps both slots; February, a 31st and December to January are pinned; for every valid rule in a broad sample (over 150 rules, 17 years) `a` is the earlier date. An exploration run over **all 3,431 valid twice-monthly rules and 2000 to 2130 found no month where `b` came before `a`**, so a and b can never swap. |
| 3. Slot identity versus displayed due date | Slots name periods (month, month plus position, week); the nominal date is returned separately. |
| 4. "Move to another billing period" | **Not implemented.** |
| 5. Controlled-migration requirements for B2 | Section 13. |
| 6. Stop and report if identity cannot be preserved | **One case found and reported here** (below). |

**The gap.** A schedule change "from now on" keeps the old schedule in a history. If it starts mid-month and the old schedule already produced that month's date, both schedules produce the same period. Example: a monthly bill on the 12th is changed to the 20th starting 15 December: the old schedule gave `m2026-12` on 12 December and the new one gives `m2026-12` on 20 December. This is neither covered by B0 rows 20 and 54 (which use the 1st) nor resolvable by choosing one. The twice-monthly version is the same (`s2026-12a` claimed twice). **Resolution inside the contract, not a broader design:** `planScheduleChange` refuses the start date and says "The old schedule already has a bill for December 2026 (2026-12-07) and the new one would put another in the same period (2026-12-20). Start the new schedule on 2027-01-01 or later." (for weekly schedules the advice is the next Monday). It also keeps the cases that are fine: a different cadence kind (no shared period), a start on a clean boundary, and an old schedule that never applied (simply replaced). The browser check shows the refusal and the success. Because identity is a period and not a date, there is no state in which the reader silently picks an identity; if damaged or synced data ever does hold two claims, `slotCollisions` reports them and the detail page and Overview show a "two schedules claim the same period" notice.

A second B2-relevant observation, from the same analysis: slots `a` and `b` are positional (the lower-ranked slot is `a`). An in-place correction that changes what `a` means (for example 1st and 15th corrected to 15th and last day) would, once B2 facts exist, silently re-attach `s…a` facts to a different bill. B1 only offers dated revisions or "replace when nothing applied", never an in-place correction, so nothing can go wrong in B1; section 13 records what B2 must do.

## 7. Finance non-mutation evidence

- **Behavioural test (`data.test.ts`):** with a Finance account, a transaction, a Finance scheduled item, a loan, one Task and one Calendar event in the database, every Bills operation was run (create, edit with a schedule change, review list, pause, resume, end, reopen, set and undo, create and delete). Afterwards every Finance table (all tables except the six shared stores) is **byte for byte identical** including `updatedAt`, every non-Bills module record is identical, the shared links are identical, and no Bills record of any kind except `obligation` exists.
- **Sync (`sync-backup.test.ts`):** Bills changes made on one device and synced to a second leave every Finance table identical on both devices.
- **Backup:** a restore leaves Finance identical (a restore re-stamps `updatedAt`, as every earlier phase documents; every other field is compared).
- **Source guards (`guards.test.ts`):** no Bills source file writes any Finance table (and the only Finance read is `db.accounts` for the funding-account pointer, in two files); none imports the Finance schedule, forecast, ledger, CSV, loan or budget code; none imports Tasks or Calendar code or calls `createTask`, `saveTask`, `createEvent`, `publishDueItem` or `completeTask`; no shared link is written; no `cycle` record is written; no `fetch`, `XMLHttpRequest` or storage use; money is formatted only in `BillsParts.tsx` and Quick Add (which masks it itself). The guards were themselves checked: deliberately adding a forbidden `d.txns.add`, a `createTask` import and a `fetch` made them fail.
- **No new table:** a test pins Dexie version 15 and that no table name mentions bills, obligations or cycles.

## 8. Sync, backup and older-build tests

**Simulated two devices, real `SyncEngine` (`sync-backup.test.ts`, 11 tests):** a bill and its Contact reach the other device with nothing doubled; each device adds a different bill offline and both end with both; unknown future fields and an unreadable status travel through sync and an edit on the other device and come back intact; **test 40**, both devices change the same bill: the later write wins on both and the other version is saved in the conflict notice with the full lost record; **test 38**, Undo after another device changed the record is refused and writes nothing; a bill ended on A while B edits its review list converge to the same valid record, and a billing-period record of a later phase is kept on both; a schedule change on A and a new bill on B do not interfere; an empty bill deleted on A disappears on B while a billing-period record added on B for it is NOT lost (it stays as an orphan for B2's review); a later-phase record kind and an unknown fact travel untouched; Finance tables are unaffected.

**Backup (`sync-backup.test.ts`, 6 tests, real export, file checker and restore):** every Bills record comes back exactly, including a future field, an unreadable value and a later-phase `cycle` record with an unknown fact; restoring twice changes nothing the second time; plain export and import round-trip and a restore replaces rather than adds; the backup summary names Bills records and counts them (3 bills and 1 billing-period record in the test), has no "other" group, and contains no names or amounts; the provider Contact link and the pause intervals are identical after a restore.

**Older versions (what was and was not proven).** A real older Ledger build was NOT run. The carry-through was proven the way B0 section 10.3 prescribed: rows of an unknown module are counted under "other application data" in the summary, round-trip through export and import unchanged, and a record kind or fact this build does not read is preserved by the reader and by sync. Whether an actual older build behaves the same is **not verified**.

## 9. Automated test totals

| File | Tests | Covers |
|---|---|---|
| `src/lib/semimonthly.shared.test.ts` | 12 | B1.0: shared helper, re-export identity, oracle, calendar cases |
| `bills/schedule.test.ts` | 28 | every pattern, month length, leap years, tracking, pauses, end, history, parsing |
| `bills/schedule-identity.test.ts` | 19 | slot safeguards, schedule-change collisions |
| `bills/model.test.ts` | 23 | defensive reader, fuzz, unknown fields, validation, amounts |
| `bills/data.test.ts` | 48 | provider reuse, edit, lifecycle, local Undo, delete, Finance non-mutation |
| `bills/commitments.test.ts` | 15 | hand-computed Known / Estimated / unknown figures |
| `bills/hooks.test.ts` | 26 | registration, Quick Add, Search, record links, privacy, schedule draft, read models |
| `bills/sync-backup.test.ts` | 17 | two-device sync, backup and restore |
| `bills/guards.test.ts` | 10 | source guards |
| **New** | **198** | |
| **Whole suite** | **2,463 in 142 files** | baseline 2,265 in 133; no existing test changed |

Commands run at the end: `npm test` (2,463 passed), `npx tsc --noEmit` (no output), `npm run build` (success), `git diff --check` (only line-ending notes for five files, no whitespace errors).

**What each kind of evidence is:** *Automated tests* are the 2,463 vitest tests (real Dexie via `fake-indexeddb`). *Simulated-device testing* is the real `SyncEngine` with two in-memory databases and an in-memory remote store. *Browser testing* is the in-app browser pane with its own isolated database and invented data. *Real-device acceptance* has NOT been done.

## 10. Browser results (in-app browser pane, isolated database, invented data; not a real device)

| Check | Result |
|---|---|
| Add form at desktop | Opened, typed a name and amount, chose "Paid automatically", added a new provider; Overview then showed 1 active, Known $185.88 (12 x $15.49), "about $15.49 a month, averaged", and two coming-up dates. |
| Quick Add | The Add box lists "Bill or subscription (bs)" beside Finance's unchanged "Scheduled payment (b)". `bs Example Power varies monthly 18th` previewed correctly ("amount varies", monthly on the 18th, next dates, expected dates only) and Add saved it. |
| Detail page | Terms, next six expected dates with amounts, review list, lifecycle buttons. |
| Pause then Undo | Preview ("12 expected dates in the next 12 months will be left out…", nothing in Finance, Tasks or the Calendar is changed), Pause applied (Paused chip, "no dates are expected until you resume", life-story entry), toast Undo restored Active. A first run showed "13 expected dates" (a 366-day window); fixed to the same 12-month window as the figures and re-checked. |
| End then Reopen | Preview lines correct; Ended chip; Delete refused with "cannot be deleted because it has been ended; its life story has entries" and no Delete button; Reopen preview ("ended only briefly, so no gap is kept") and Active again. |
| Schedule-change refusal and success | Editing the day from the 7th to the 20th starting 15 December was refused with the exact period message; starting 1 January saved, and the detail page then showed 7 Nov, 7 Dec (old schedule), 20 Jan, 20 Feb, 20 Mar (new schedule). |
| Validation | Submitting an empty form showed a plain message and `aria-invalid` on the field; after the fix the title message comes first. |
| Mobile 375 x 812 | Overview, form and detail rendered with **no horizontal scroll** (`scrollWidth` 375 = `innerWidth`); the modal 351 px wide. The only controls under 40 px were radio and checkbox inputs inside 40 px labels; a mobile rule now makes those labels 44 px. The three counts now sit in one row. |
| Hide Amounts | With the global preference on, the Overview, list and detail pages showed **0 unmasked `$digit` amounts** and 6, 1 and 7 masked ones respectively. |
| Dark mode | Overview and detail rendered correctly with `prefers-color-scheme: dark`; text, chips, cards and the floating Add button were legible. |
| Keyboard | Tab moved focus inside the dialog onto the schedule select with a visible 3 px focus ring; Escape closed the dialog. |
| Light mode | The desktop screenshots throughout (Overview, list, detail, form, dialogs) were taken in light mode. |
| **Not done in the browser** | The Quick Add Undo button and the empty-bill Delete success path (both unit-tested); a full Tab walk of every control; any real phone; a screen reader; measured contrast. |

## 11. Mutation and fault-injection evidence

`scripts/bills-mutation-check.cjs` breaks the production source deliberately, runs `src/modules/bills` and the shared helper tests, records whether any test fails, and restores the file (it restores from copies made first, even after a crash). **Final run on the finished code: 34 mutations, 33 caught, 1 survived (an equivalent mutant).** Areas: recurrence and dates (R1 to R13), the model and reader (M1 to M6), Undo (U1 to U3), lifecycle, delete, edit and Contact reuse (D1 to D7), commitments (C1 to C3), Quick Add (Q1) and the Overview (V1).

| # | What was broken | Result | If it were really broken |
|---|---|---|---|
| R1 | tracking start ignored | CAUGHT (3 tests failed, 3 files failed) | a new bill would show a pile of past dates |
| R2 | pause end becomes inclusive | CAUGHT (1 tests failed, 1 files failed) | the first day expected again would be skipped |
| R3 | end date ignored | CAUGHT (5 tests failed, 4 files failed) | an ended bill would keep producing dates |
| R4 | paused with no open pause no longer fails closed | CAUGHT (1 tests failed, 1 files failed) | a paused bill would produce dates |
| R5 | revision segments overlap | CAUGHT (1 tests failed, 1 files failed) | two schedules would both claim the change day |
| R6 | twice-monthly slots not in rank order | CAUGHT (2 tests failed, 1 files failed) | a and b could swap with the order the days were entered |
| R7 | week slot uses the Sunday | CAUGHT (5 tests failed, 2 files failed) | weekly slots would not be Mondays |
| R8 | months before the anchor produced | **SURVIVED** (equivalent mutant, below) | dates before the first bill month would appear |
| R9 | schedule-change collision check off | CAUGHT (4 tests failed, 2 files failed) | a mid-month change could double a billing period |
| R10 | unsupported status no longer fails closed | CAUGHT (3 tests failed, 3 files failed) | an unknown status would produce dates |
| R11 | ended with no end date no longer fails closed | CAUGHT (1 tests failed, 1 files failed) | an ended bill with no date would produce dates |
| R12 | weekend-crossing check off for one slot | CAUGHT (6 tests failed, 5 files failed) | a date could leave its month and break the period identity |
| R13 | every-N-months steps one month | CAUGHT (7 tests failed, 3 files failed) | quarterly and yearly bills would repeat monthly |
| M1 | unknown amount becomes zero | CAUGHT (2 tests failed, 2 files failed) | unknown would be treated as $0.00 |
| M2 | unreadable values not written back | CAUGHT (3 tests failed, 2 files failed) | an ordinary edit would erase a value this build cannot read |
| M3 | an edit keeps the old raw value | CAUGHT (1 tests failed, 1 files failed) | a deliberate change would be overwritten by the old raw value |
| M4 | price in force picks the first step | CAUGHT (3 tests failed, 2 files failed) | a price increase would never apply |
| M5 | paid-through-loan not excluded | CAUGHT (2 tests failed, 2 files failed) | loan escrow would be counted twice |
| M6 | unknown top-level fields dropped on write | CAUGHT (4 tests failed, 3 files failed) | future fields would be lost on every edit |
| U1 | Undo guard never refuses | CAUGHT (10 tests failed, 2 files failed) | Undo would overwrite another device's change |
| U2 | Undo of an add leaves the record | CAUGHT (3 tests failed, 2 files failed) | Undo of an add would do nothing |
| U3 | Undo accepts an unsealed action | CAUGHT (1 tests failed, 1 files failed) | an unverifiable Undo would be trusted |
| D1 | lifecycle ignores a record changed since the preview | CAUGHT (1 tests failed, 1 files failed) | a stale preview could be applied |
| D2 | delete ignores history | CAUGHT (1 tests failed, 1 files failed) | a bill with history could be deleted |
| D3 | ending leaves a pause open | CAUGHT (1 tests failed, 1 files failed) | a reopened bill would still be paused |
| D4 | reopen keeps no gap | CAUGHT (1 tests failed, 1 files failed) | reopening would produce a pile of missed dates |
| D5 | resume does not close the pause | CAUGHT (1 tests failed, 1 files failed) | a resumed bill would stay paused |
| D6 | edit ignores a record changed since the form opened | CAUGHT (1 tests failed, 1 files failed) | a stale edit would overwrite a newer change |
| D7 | contact lookup creates a duplicate | CAUGHT (1 tests failed, 1 files failed) | every bill would create a second Contact |
| C1 | 12-month window counts 13 | CAUGHT (1 tests failed, 1 files failed) | a monthly bill would count 13 times |
| C2 | loans counted in totals | CAUGHT (2 tests failed, 2 files failed) | a mortgage would be counted in the figures |
| C3 | estimated amounts counted as known | CAUGHT (1 tests failed, 1 files failed) | estimates would be shown as known |
| Q1 | Quick Add takes over the Finance prefix | CAUGHT (3 tests failed, 1 files failed) | typing b would no longer add a Finance scheduled payment |
| V1 | loans appear in upcoming dates | CAUGHT (1 tests failed, 1 files failed) | a loan would appear as an upcoming bill |

**R8** removes `month >= anchorMonth` from `monthSlotDates`. No test can fail because the loop already starts at `anchorMonth` and only moves forward, so the condition is unreachable defensive code (an equivalent mutant), not a test gap. An earlier run of mutation R3 (end date ignored) printed "UNCLEAR" because the mutated text was malformed and crashed the run; it was corrected and re-run and is CAUGHT.

## 12. Known limitations

- **Real-device acceptance, two physical devices, offline use, a real screen reader and measured contrast are NOT done**, and the earlier Home & Assets and Household Services acceptance lists are still open.
- **Only a first price is editable.** The price list shape is final (B4 adds editing). A price step added by another device is kept and honoured.
- **Whole-record last-writer-wins** on one bill: of two concurrent edits to the same bill the later one wins; the other is saved as an "Edits that lost a tie" notice, which is device-local and capped at 50. B1 does not depend on that list for anything important.
- **Undo is conservative:** any change to the touched row, even a re-save with the same content, makes Undo refuse; a refusal gives no automatic way back (edit by hand).
- **No payment, billing-period, status-label, Task, Calendar, Today or due-provider behaviour** (B2 onwards). A billing-period record that arrives from a later version or another device is preserved and blocks deletion of its bill, but nothing shows or repairs it yet.
- **The Loan picker and the Finance scheduled-item pointer have no screen**; the fields are preserved. Loans are left out of the figures only by type, loan pointer or "paid through the loan".
- **The commitment figures are estimates:** they use the amount typed, the schedule typed and a plain count of dates; no holiday calendar; "last business day" ignores holidays.
- **The Quick Add grammar is deliberately small** (one amount, one pattern, one day or date, an optional weekday); twice-a-month schedules need the form; an unclear line is refused with a reason.
- **Contacts have no screen** and no company field, so a provider's phone and email can be entered when it is created but not edited here.
- A restore replaces everything, as in every phase.

## 13. B2 prerequisites and recommended next step

**Recommended next step:** independent ChatGPT review of this report, the owner's authorization to commit and push B1, then a green Pages run, before B2 is briefed.

**B2 must carry these (the controlled-migration requirements for "Move to another billing period", and the related schedule rules):**
1. **Count periods that hold facts as "applied".** B1's `planScheduleChange` decides "the old schedule never applied, so replace it" from derived dates only. Once B2 stores a fact for a period that is not yet past (an invoice entered early), replacing a schedule would orphan that period's identity. `planScheduleChange` must take the set of slots that hold facts and treat them as applied.
2. **Never correct an `a`/`b` meaning in place.** Slots `a` and `b` are positional. When facts exist, any change that alters which bill `a` or `b` means must be a dated revision or an explicit migration.
3. **The migration is one explicit, previewed, guarded-Undo operation in a single transaction.** It shows every fact that will move, grouped by period, the source slot and the target slot, and states that no due date, amount or payment link changes.
4. **It writes the new slot on every fact of the period and keeps the old slot as `movedFrom` on each**, so the audit trail survives and the move can be undone; nothing is deleted or re-labelled automatically.
5. **The target must be a legal slot:** one the current or a historical schedule produces, or a new `x<id>` extra period. A target that already holds facts is refused unless the owner chooses the "These are different bills" repair.
6. **Concurrent devices:** a fact added to the old slot by another device after the move lands in a vacated slot. B2 must list such facts under "From an earlier schedule" (N3) and offer the move again, never merge them silently. The move and Undo must refuse if any fact of the period changed since the preview (the same whole-row fingerprint guard used here, extended to all facts of the period).
7. **Slot collisions in stored data** (two claims on one period from older or synced data) must show the N9 and N10 repair choices, not an automatic pick; `slotCollisions` is the B1 detector to reuse.
8. **A weekly change needs a Monday boundary and a monthly change a month boundary** (the B1 refusal and advice already enforce this for schedule edits).

Other B2 inputs already in place: the `expectedDates` reader and slot ids, the `lifecycle` log, `cycleRowsOf`, the local Undo (to be extended to fact records and Tasks), and the documented list of what B1 deliberately did not build.

## 14. Handoff and backlog update confirmation

**Handoff updated: yes** (`docs/CHATGPT-HANDOFF.md`): header and section 1 snapshot (B1 built and tested locally, uncommitted, not deployed, not accepted; baseline 2,463 in 142; the B0 documentation was already committed), a new "Bills & Subscriptions B1" section with the approval record (A-1 to A-11, B1 only) and invariants, the B0 heading changed to "approved", the roadmap note, a B1 carry-forward risk entry, and a change-log entry. **Backlog updated: yes** (`docs/BACKLOG.md`): a new top entry with the numbered judgment calls and what is NOT built; the B0 entry is relabelled "earlier" and marked approved. `README.md` and `docs/module-hooks.md` were updated. Nothing in the handoff or backlog claims a commit, push or deployment of B1. What remains unknown: B1's Pages result (nothing was pushed) and everything on real devices.

## 15. Exact final Git status

```text
$ git rev-parse HEAD origin/main
8059e5f52d1ae8205016b597dcc9013b73030136
8059e5f52d1ae8205016b597dcc9013b73030136

$ git status --short
 M README.md
 M docs/BACKLOG.md
 M docs/CHATGPT-HANDOFF.md
 M docs/module-hooks.md
 M src/lib/backupSummary.ts
 M src/modules/index.ts
 M src/modules/services/semimonthly.ts
?? docs/BILLS-SUBSCRIPTIONS-B1-REPORT-2026-11-07.md
?? scripts/bills-mutation-check.cjs
?? src/lib/semimonthly.shared.test.ts
?? src/lib/semimonthly.ts
?? src/modules/bills/

$ git diff --stat (tracked files)
 README.md                           |   7 ++
 docs/BACKLOG.md                     |  13 +++-
 docs/CHATGPT-HANDOFF.md             |  27 +++++--
 docs/module-hooks.md                |   7 ++
 src/lib/backupSummary.ts            |   5 +-
 src/modules/index.ts                |   2 +
 src/modules/services/semimonthly.ts | 141 +-----------------------------------
 7 files changed, 55 insertions(+), 147 deletions(-)
```

Nothing is staged, committed, pushed or deployed. The new untracked files are: this report, `scripts/bills-mutation-check.cjs`, `src/lib/semimonthly.ts`, `src/lib/semimonthly.shared.test.ts` and the whole `src/modules/bills/` folder (8 test files, 1 test helper and the module). `HEAD` and `origin/main` are both `8059e5f`; the dev server started for the browser checks is stopped, and no file outside the repository was changed.

