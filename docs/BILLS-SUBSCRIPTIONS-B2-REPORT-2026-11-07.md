# Bills & Subscriptions B2: billing occurrences, due dates, Tasks, Calendar, Today and manual billing facts. Implementation report

Date: 2026-11-07. Status: **BUILT AND TESTED LOCALLY. NOT STAGED, NOT COMMITTED, NOT PUSHED, NOT DEPLOYED, NOT ACCEPTANCE-TESTED ON REAL DEVICES, NOT YET INDEPENDENTLY REVIEWED.** B3, B3.1, B4 and B5 are not authorized and not started. All example names, providers and amounts in this document, in the tests and in the browser checks are invented.

## 1. Executive summary (plain English)

B2 turns Bills & Subscriptions from "what I expect to pay" into "what I expect, what was billed, and what I told Ledger happened". For each bill the owner now sees its billing periods (each shown as a date and a description such as "December 2026", never an internal code). For a period the owner can enter the statement (amount, the real due date, a document number), set a due date, say "paid outside Finance" (with an amount if known), say "paid in full" without any amount, skip a period that was not billed, add a provider credit, or record an extra bill. Every one of these shows what will happen first, saves once even if pressed twice, and has an Undo that refuses if anything changed in between.

The simple electric-bill story works end to end (checked in the browser): add a monthly bill, see its next expected date, turn on "remind me to pay it" (a Task is made for a few days before the due date; only one at a time), enter the statement with the real due date (the amount and date update and the Task follows the date), press "Done, mark paid" (writes the note, finishes the Task and makes the next one together, with Undo), and the record stays for history.

Rules that were kept everywhere: nothing is posted to, read from or changed in Finance; an invoice, an autopay setting and a finished Task are never proof of payment; an unknown amount is never zero; a declaration with no amount never creates an amount; two disagreeing records are shown side by side and the amount owed stays unknown until the owner chooses; nothing is deleted by a repair (set-aside records stay visible as history).

Headline results: **2,609 tests pass in 147 files** (baseline 2,463 in 142, re-run at the start; 146 new tests, 16 of them in the section 21 corrections); `npx tsc --noEmit` clean; `npm run build` succeeds; `git diff --check` reports only line-ending notes; 58 mutation checks (all caught after three test gaps were closed); three injected-failure rollback tests; all ten required two-device scenarios with the real `SyncEngine`; browser checks at desktop and 375 px, light and dark, Hide Amounts, keyboard Tab and Escape. **Not verified:** a real phone, two physical devices, offline use, a real screen reader, measured contrast, a real older Ledger build.

## 2. Verified B1 SHA and deployment status

| Check | Result |
|---|---|
| Repository and remote | `marshmond/ledger` (`https://github.com/marshmond/ledger.git`). |
| Branch | `main`. |
| Local equals remote | After `git fetch origin`: `HEAD` = `origin/main` = `3bcf3a386666e368819842882860fe2b65459b85` (`feat(bills): B1 obligation registry, schedule reader and basic lifecycle`); `git log origin/main..HEAD` empty. |
| Deployment | Public Actions API (`gh` is not installed on this machine): workflow "Deploy to GitHub Pages", run **#69**, `head_sha` `3bcf3a38…`, `event` push, `completed` / **`success`** (created 2026-11-07 17:56:26 UTC, updated 17:57:44 UTC). |
| Working tree | **Clean** (`git status --short` printed nothing). No unrelated changes, no unreviewed commits (the newest five commits are B1, B0 Revision 2, S5, S4 and the S3 test fix). |
| Baseline | `npm test`: **142 files, 2,463 tests passed** (33 s), equal to the B1 report. |

The gate passed, so B2 proceeded. Read before any code: `CLAUDE.md`, the handoff, the backlog, B0 Revision 2 (sections 3.4, 3.4a, 5, 6, 10, 13, 14, 18 in full; the rest skimmed), the B1 report (sections 5, 6, 13), and the B1, Tasks, Calendar and Household Services source needed.

## 3. Baseline tests

2,463 passed in 142 files before any change. Final: **2,609 in 147** (2,593 in 146 before the section 21 corrections). The only existing tests edited are the ones that B2 intentionally contradicts: two B1 "guard" tests that said "no Task, no Calendar layer, no cycle record" (now guard the B2 rules instead, see section 5), one B1 hooks test that said "no due provider or Today card", and two older tests that counted the built-in Calendar layers (`calendar.test.ts`, `sync/sync.test.ts`: six became seven). No other existing test changed.

## 4. Files added and modified

**Modified (outside the Bills folder):** `src/modules/calendar/model.ts` (one constant `BILLS_ID`), `src/modules/calendar/data.ts` (one seed row), `src/modules/calendar/calendar.test.ts` and `src/lib/sync/sync.test.ts` (layer count), `README.md`, `docs/module-hooks.md`, `docs/due-provider.md`, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`.

**Modified (Bills, from B1):** `model.ts` (a top-level `noDeadlineTasks` flag), `schedule.ts` (`planScheduleChange` takes the slots holding facts, plus `slotStart`), `data.ts` (create, edit and lifecycle keep the bill's Tasks in step; schedule edits pass the fact slots; a clearer Delete refusal for reminder Tasks), `undo.ts` (links added by an action are removed by Undo), `paths.ts`, `index.tsx`, `BillsModule.tsx` (two routes), `OverviewPage.tsx`, `ObligationPage.tsx`, `ObligationForm.tsx` (reminder checkbox), `bills.css`, `billsTestkit.ts`, `guards.test.ts`, `hooks.test.ts`.

**Added (Bills logic, all pure unless noted):** `cycleModel.ts` (fact records and the lossless reader), `slots.ts`, `periods.ts`, `timing.ts`, `amounts.ts`, `labels.ts`, `cycleConflicts.ts`, `terms.ts`, `readModel.ts` (attention, cash timing, upcoming), `dueProvider.ts` (Calendar layer), `todayCards.tsx`. **Database layer:** `cycleData.ts` (record, edit, remove, preview), `cycleRepair.ts` (repairs, "leave as is" for a Task, the period move), `contractData.ts` (contract dates and reminders), `tasks.ts` (the only Task writer).
**Added (screens):** `PeriodParts.tsx`, `PeriodsCard.tsx`, `CycleDialogs.tsx`, `RepairDialogs.tsx`, `ContractCard.tsx`, `UpcomingPage.tsx`, `ReviewPage.tsx`.
**Added (tests and tools):** `b2-state.test.ts`, `b2-data.test.ts`, `b2-views.test.ts`, `b2-sync.test.ts`, `scripts/bills-b2-mutation-check.cjs`, and this report.

**Not touched (as required):** `src/db.ts`, `src/lib/backup.ts`, `backupFile.ts`, `src/lib/sync/*` (only a test), `src/types.ts`, every Finance file, Tasks, Projects, Home & Assets and Household Services code. No new table, migration, dependency or backend.

## 5. Implementation against the B2 scope

| Brief item | Where it is |
|---|---|
| 1 Upcoming bills with expected due dates | bill page "Billing periods", Overview "Coming up", `#/bills/upcoming` (90 days by week) |
| 2 Record an invoice and its actual due date | `FactDialog` kind `invoice`; the due date is on the invoice or a separate `due-date` fact |
| 3 Provider credit | kind `credit`; lowers owed, never a payment |
| 4 Paid outside Finance | kind `paid-outside` (date, optional amount); amount must be above zero or left empty |
| 5 Paid in full, no amount | kind `paid-in-full`; creates no amount |
| 6 Skip a period | kind `skip` |
| 7 Reminders for manual payments | `tasks.ts`, reminder checkbox and the "Reminders" card |
| 8 Cancel-by, trial and renewal dates | `terms.ts`, "Contract dates" card, Calendar markers, Tasks for cancel-by and trial |
| 9 Calendar, rolling 12 months | `dueProvider.ts`, layer `9_000_000_000_000_107` |
| 10 Identify records that disagree | `cycleConflicts.ts`, Needs review |
| 11 Review and repair | `cycleRepair.ts`, `RepairDialogs.tsx` |
| 12 Today attention | `todayCards.tsx` card `bills.attention` |
| 13 Pause, end, resume, change schedules without losing evidence | facts are separate records; lifecycle code never touches them; schedule changes respect them (section 7) |

**Facts implemented:** `invoice`, `due-date`, `paid-outside`, `paid-in-full`, `skip`, `credit`. `payment-link` and `suggestion-reject` are not implemented (B3 and B3.1); if such a record exists it is read as an unknown fact: kept byte for byte, shown as needing review, never counted.

**Boundaries held (guard tests):** Bills writes no Finance table and imports none of its engines; Tasks are written only from `tasks.ts` through `createTask`, `saveTask` and `completeTask`; `cycle` records are written only from `cycleData.ts` and `cycleRepair.ts`; no Calendar event is written and Bills writes no shared link itself (the one `about` link per reminder Task is written by the Tasks API, `createTask`; see section 21); the read-only files (read model, Calendar layer, Today card and every derivation) contain no write call; the Calendar layer id and its seed live in the Calendar module; no network or storage use; money is formatted only through the Hide-Amounts-aware helpers.

**Reminder default (judgment call 1).** The brief says a Task is made "when enabled" and lists "a Task created without a user setting" as a stop condition. A bill with no reminder setting therefore gets no Task (B1 bills have none). The Add form defaults the checkbox on for pay-by-hand bills, so the setting is a visible, stored choice.

## 6. Deviations from B0 and judgment calls (please review)

1. **Reminders are off unless turned on** (above). B0 5.5 said "default on for manual-pay"; the form default keeps the intent without a hidden creation.
2. **A partial typed payment leaves the period open.** If $90.00 is typed against a $91.00 bill the period is "Partly paid" and, with reminders on, another Task is made for it. The preview in the dialog says so. (Correct by the amounts rules; it can surprise.)
3. **Look-back windows:** counts and lists use 45 days; the bill page 75 days (with "Older periods" for recorded ones). Older unrecorded months are simply not listed, so a forgotten year never becomes a pile. B0 did not specify this.
4. **"Leave as is" is remembered on the bill** (`acknowledged`, key = the problem plus the update times of its records), so a changed record brings the question back. It silences the count but never the amounts: owed stays unknown while two bills disagree.
5. **Identical credits count once** (same amount and note) and are flagged; different notes count separately. B0 did not decide credits.
6. **Two different typed paid amounts count as zero** (and are flagged) until the owner chooses; identical ones count once (B0 N12).
7. **Skip versus payment:** only the skip can be set aside, never the payment ("must not disappear from recorded-payment history").
8. **"These are different bills"** moves the chosen invoice to a new `x` period and records `separatedFrom` (kept as an unknown field), not `movedFrom`, because the old period keeps its other records. `movedFrom` is reserved for a period move so "a record arrived at a vacated period" has no false positives.
9. **A move may land on a period that holds only records from the same move**, so an interrupted move can be finished (the late-arrival repair). Any other occupied target is refused.
10. **Loan-related bills** accept no payment record, and are left out of cash timing and attention counts.
11. **Autopay wording:** "Autopay not confirmed, please check" (B0's "not yet seen in Finance" is untrue while Ledger reads no Finance data). B3 changes the wording.
12. **Calendar horizon** is Household Services' rule (today to the same day 12 months later, both ends included).
13. **Untouched Tasks follow a corrected due date** (a `billsDoOn` marker records the date Bills gave); a Task the owner moved is left alone and a mismatch is reported.
14. **Duplicate rule by purpose and occurrence** (section 11), not by title.
15. **The "no deadline reminders" choice** is a top-level field `noDeadlineTasks` (first built nested inside `reminders`, which the deployed B1 build rewrites; corrected before commit, see section 21).
16. **Look-alike extra bills** (same amount and bill date on different periods, at least one an extra) were added to the B0 N9 list from N11's text.
17. **Not built from B0 10.4:** the "Activity after the end date" notice and re-homing orphan records (an orphan can be removed, with Undo, but not moved to another bill). Neither is in the B2 brief's list.

## 7. Slot identity and migration evidence

The B1 reader is unchanged; B2 adds `slots.ts` (period range, "does any schedule produce this slot", move targets). Identity safeguards, each a test (`b2-state.test.ts`, `b2-data.test.ts`):

| Safeguard | Evidence |
|---|---|
| A moving due date does not change identity | a `due-date` fact changes the timing date; slot and nominal unchanged; the phone-calendar id `bills-<bill>-<slot>@ledger.local` is the same before and after |
| `a`/`b` cannot silently change meaning | `planScheduleChange` counts a period holding a fact as applied: a change that would put a new schedule's bill in that period is refused ("December 2026 (first bill) already has recorded information ... Start the new schedule on 2027-01-01 or later"); a dated change on a clean boundary keeps every fact on its own slot |
| Business-day adjustments never move a period | same slots with and without an adjustment; facts stay attached |
| Two offline devices do not overwrite | section 14 |
| Unknown fact types and fields are kept | read, restore, sync and edit tests |
| No invalid record contributes an amount or hides a bill | 17 damaged shapes read as unreadable; an unreadable record leaves its period's expected bill and figures untouched |
| Facts that disagree are visible | `findConflicts`; period labels fall to "Due date unclear" and owed to unknown |
| Identical records flagged, never deleted | duplicate tests; nothing is removed by any detection |
| Idempotent against double submission | `op` per open form (tested, including two concurrent calls); stale guards on edit, remove, repair and move |
| No future occurrence pre-created | tests count records before and after every read: only what the owner recorded exists |

**Move to another billing period** (`planMove`, `applyMove`): preview lists every record (superseded ones included) and says amounts, payment records and actual due dates stay exactly as they are; validates the target (a period some schedule of the bill produces, or a new extra); refuses the same period, an unknown period, an occupied target, and a source that holds a record this version cannot read; re-reads and compares every record of both periods inside the transaction (a record added after the preview makes it refuse, writing nothing); writes everything in one transaction, with `movedFrom` on each record; guarded Undo (refused once any moved record changed). A record added later to the old period by another device is flagged "arrived after a move", not moved or merged, and can be moved to where the others went. This needed no new link or sync policy.

## 8. Conflict and repair evidence

`findConflicts` detects: two invoices with different amounts, two invoices with the same amount, different actual due dates (among invoices and due-date records), a skip beside a payment record, two different typed payment amounts, identical skips, declarations, due dates, typed payments or credits, one document number on two periods, look-alike extra bills, records in a period no schedule produces ("from an earlier schedule"), records at a period whose others were moved away, records of a missing bill, and unreadable records. Complementary evidence (an invoice, a due date, a credit and a payment note for one period) is tested to produce no conflict. Results sort stably and never change their input.

Repairs: **Use this one** (the others get `supersededBy`, stay visible as History, drop out of figures), **These are different bills**, **Leave as is**, **Remove** (only records of a missing bill and only ones this version can read), plus **Move**. Evidence: the amount owed is unknown while two invoices disagree and known after the choice; a skip is set aside and the payment keeps counting; Leave as is changes no record and is undone by a changed record; a stale preview (a third invoice arrived) is refused and writes nothing; Undo after an intervening change is refused; choices not offered for a problem are refused; records of a missing bill can be removed and restored by Undo; unreadable records have no repair and are untouched.

## 9. Payment-label and amount semantics

Four independent derivations (timing, amounts, evidence, attention) feed one primary label with fixed precedence (B0 6.5). Tests: the five timing classes partition every day count from -400 to +400 (exactly one class each, boundaries 8, 7, 1, 0, -1); the label function was enumerated over every combination of skip, owed state, paid state, declaration, suspension, timing, arrangement and invoice (`2 x 3 x 2 x 4 x 2 x 2 x 10 x 3 x 2` = 11,520 inputs), each with exactly one label and with invariants (never "Paid" with an amount remaining, never "Overdue" or "Not confirmed paid" with evidence, never "Overdue" without a recorded invoice or for autopay, "Autopay not confirmed" only after the 3-day grace); no label or evidence sentence contains a settlement word. Zero-dollar invoice, unknown amount, credits, typed payments, declarations and conflicts have their own tests. "Autopay", an invoice and a finished Task never count as paid. Refunds, reversals and Finance-backed evidence are deferred to B3; `suspended` exists in the label input (always false) so B3 plugs in without a redesign.

## 10. Task lifecycle and recurrence evidence

Created only when reminders are on, only for an active, non-loan bill; one open pay Task per bill standing for the earliest open period looking back 30 days; creation re-reads live Tasks inside the transaction (three concurrent edits make one Task and one link). Autopay gets none by default. The Task date is `due - leadDays`, never before today; the due date is shown beside it ("Reminder Task ... is for Nov 22 (the bill is due Nov 25)"). A corrected due date moves an untouched Task and leaves a Task the owner moved. Deadline Tasks for cancel-by and trial end (none for a passed date, none when switched off, an untouched one follows a corrected date, a moved one is left and reported). **Done, mark paid** (`recordFact` with `finishTaskId`): fact, finished Task and next Task in one transaction; Undo restores the Task to "To do", removes the new Task and its link. A Task finished elsewhere is "finished, not yet confirmed" until the owner records what happened or chooses Leave as is. Markers survive a normal Task edit. A Task the owner touched, and a finished Task, is never deleted or changed. **Corrected before commit (section 21):** pausing or ending removes (soft delete, restorable, guarded Undo) only an untouched Bills-made Task that stands for something the bill no longer expects, and a changed one stays open and is reported; resuming makes one new reminder. Nothing is created for future months.

## 11. Calendar-layer and horizon evidence

Layer `9_000_000_000_000_107`, seeded once beside the six existing layers (race-tested); the Finance and Household Services layers are untouched. A monthly bill shows exactly 12 dates from today (`2026-11-18` to `2027-10-18` for today `2026-11-07`), the horizon moves with the clock (tested at a later date), nothing is stored (records and links identical before and after). Item ids are `bills:due-<bill>-<slot>:<date>`, notice, trial and renewal are separate ids; a due-date fact moves the date and the phone-calendar id stays. Skipped, paid and zero periods are not shown; partly paid still is; a hand-paid bill past its date stays visible in the overdue window; automatic payments past their date are not shown as overdue. **Task versus due date:** a Task on another day does not hide the due date; a Task on the same day for the same period stands for the marker; same rule for notice and trial. Titles, details and calendar text carry no amount, account number, note or document number (tested with all of them present). Cross-layer suppression against Finance scheduled items and Household Services contract dates is **not done** (B3.1 and later).

## 12. Today and Overview evidence

One read model (`readModel.ts`) feeds the Overview, Upcoming, Needs review and the Today card: every count is the length of a list, so they cannot disagree (tested: equal; a payment lowers both together). Hand-computed counts match: due in 7 days, not confirmed paid, autopay check, conflicts, finished-but-unconfirmed Tasks, trials (7 days), cancel-by (14), renewals (30), passed contract dates. The Today card shows counts and words only (no bill name, no amount; tested), hides when empty, and never lists the Tasks. Old unrecorded months do not pile up (two, not 22). Cash timing (7, 30, 90 days) was computed by hand and matches: known, estimated, unknown; a partial payment lowers what remains; skipped, paid, loans and past-due are left out; disagreeing invoices count as unknown; a credit lowers the figure; the B1 12-month commitment figures are unchanged by recording facts.

## 13. Finance non-mutation tests

A behavioural test with a Finance account, a transaction, a scheduled item and a Calendar event runs every operation (create with reminders, record each fact type, finish a Task, edit, remove, save terms, move) and proves every Finance table is byte-for-byte identical and the unrelated Calendar event is unchanged; a second test proves reading periods, conflicts, attention and cash writes nothing; the two-device test proves both devices' Finance tables are unchanged; the guard tests prove no Bills file writes or imports Finance code. Bills reads no Finance data at all in B2 beyond the B1 account name.

## 14. Sync and backup evidence

Real `SyncEngine`, two devices (`b2-sync.test.ts`), the ten required scenarios:
1. A invoice + B due-date: both survive, both used, no conflict. 2. Different invoice amounts: both kept, owed unknown on both, the choice syncs and the set-aside record stays visible. 3. Skip vs payment: payment counts, flagged. 4. Same invoice twice: both kept, counted once, flagged. 5. A moves a period while B adds to the old one: flagged, not merged, target proposed. 6. Bill ended on A while B records a fact: both survive. 7. Bill missing on a device: records reported as belonging to a missing bill, kept, resolved when the bill returns. 8. Finished Task and fact in either order: each half-state is explained ("finished, not yet confirmed"; a stale open Task is reported), the combined state agrees. 9. Undo after a conflicting remote edit: refused, nothing written. 10. Unknown fact type and record kind: survive sync, restore and an edit of the same period, never counted.
Extras: two devices each turn reminders on (two Tasks kept, flagged, never deleted, asking again adds none), a removal on one device with an addition on the other, a schedule edit on one with a fact on the other, Finance identical on both. Backup: every record, link, Task marker and unknown fact comes back (a restore re-stamps update times, as since Phase 0, so those are compared apart); restoring twice changes nothing more; the file backup, checker and restore carry them; the summary counts "Billing-period records" and names no bill, amount or note. No backup-format change or migration was needed.

## 15. Mutation and fault-injection results

**Fault injection** (three tests): making the next Task fails after "Done, mark paid" -> no fact written, Task not finished; a repair fails halfway -> nothing superseded or acknowledged; a move fails halfway -> every record stays put. In each, the whole database is byte-for-byte unchanged.

**Mutation checks** (`scripts/bills-b2-mutation-check.cjs`; breaks one production line at a time, runs the B2 tests plus the guard and hooks tests, restores the file): 58 mutations over timing, amounts, labels, periods, conflicts, the fact model, the data layer, repairs and moves, Tasks, the read model, the Calendar layer, schedule changes and Undo. **First run: 55 caught, 3 survived (X4 an old recorded month making a Task, X5 an inactive bill making a Task for a period that holds a recorded bill, V2 past-due bills counted as cash needed).** Each survivor was a real gap in the tests; a test was added for each and the three were re-run: **all three CAUGHT. Final: 58 of 58 caught, 0 survivors.** (The final run used the B2 test files plus the guard and hooks tests; the B1 tests were not part of it.)

| # | What was broken | Result | If it were really broken |
|---|---|---|---|
| T1 | "upcoming" starts one day too early | CAUGHT (1 tests failed, 1 files failed) | a bill due in exactly 7 days would not be "due soon" |
| T2 | "due today" hidden by "due soon" | CAUGHT (1 tests failed, 1 files failed) | a bill due today would read as due soon |
| T3 | an unclear date is no longer checked first | CAUGHT (2 tests failed, 1 files failed) | two different due dates would be hidden by one of them |
| T4 | days until a date is inverted | CAUGHT (12 tests failed, 4 files failed) | every bill would read as past due or upcoming the wrong way round |
| T5 | conflicting due dates: the first wins | CAUGHT (1 tests failed, 1 files failed) | Ledger would silently choose one of two dates |
| A1 | an unknown amount becomes zero | CAUGHT (7 tests failed, 2 files failed) | unknown would be treated as $0.00 |
| A2 | two different invoices: the first wins | CAUGHT (5 tests failed, 4 files failed) | Ledger would silently choose one of two amounts |
| A3 | a credit counted as a payment | CAUGHT (2 tests failed, 2 files failed) | a credit would look like money paid |
| A4 | two different typed payments: the last wins | CAUGHT (1 tests failed, 1 files failed) | conflicting payments would count one of them |
| A5 | identical credits counted twice | CAUGHT (1 tests failed, 1 files failed) | a credit recorded twice would lower the amount owed twice |
| A6 | a $0.00 invoice treated as unknown | CAUGHT (4 tests failed, 3 files failed) | a confirmed zero bill would be confused with unknown |
| A7 | an unknown remaining becomes zero | CAUGHT (5 tests failed, 2 files failed) | unknown would be shown as nothing left to pay |
| L1 | "Overdue" without a recorded bill | CAUGHT (2 tests failed, 1 files failed) | an unmatched bill would be called overdue |
| L2 | automatic payments can be overdue | CAUGHT (4 tests failed, 2 files failed) | an autopay would be called overdue and not "scheduled" |
| L3 | autopay grace edge moves a day | CAUGHT (2 tests failed, 1 files failed) | the grace period would end a day early |
| L4 | a skip hides a payment | CAUGHT (4 tests failed, 2 files failed) | a payment record would disappear behind a skip |
| L5 | "Paid" while an amount remains | CAUGHT (6 tests failed, 3 files failed) | a partly paid bill would read as paid |
| L6 | a confirmed zero bill falls through to a timing label | CAUGHT (4 tests failed, 3 files failed) | a $0.00 bill would show as due or overdue |
| L7 | a declaration is ignored | CAUGHT (6 tests failed, 3 files failed) | a paid-in-full declaration would not count |
| P1 | set-aside records still count | CAUGHT (3 tests failed, 3 files failed) | a record set aside by a repair would still change the figures |
| P2 | a recorded due date is ignored for timing | CAUGHT (5 tests failed, 4 files failed) | a corrected due date would not change timing |
| K1 | skip beside a payment not reported | CAUGHT (3 tests failed, 3 files failed) | a skip that disagrees with a payment would go unnoticed |
| K2 | two different invoices not reported | CAUGHT (10 tests failed, 4 files failed) | conflicting invoice amounts would go unnoticed |
| K3 | different due dates not reported | CAUGHT (2 tests failed, 2 files failed) | conflicting due dates would go unnoticed |
| K4 | "leave as is" survives a changed record | CAUGHT (2 tests failed, 2 files failed) | a changed record would stay silenced |
| K5 | a missing bill is not reported | CAUGHT (3 tests failed, 3 files failed) | records of a missing bill would be invisible |
| K6 | look-alike extra bills not reported | CAUGHT (1 tests failed, 1 files failed) | an extra bill entered twice would go unnoticed |
| D1 | a double press writes twice | CAUGHT (1 tests failed, 1 files failed) | pressing twice would save two records |
| D2 | a second single-record fact is allowed | CAUGHT (1 tests failed, 1 files failed) | a period could get two invoices from one device |
| D3 | a stale edit is accepted | CAUGHT (1 tests failed, 1 files failed) | a stale edit would overwrite a newer change |
| D4 | a period no schedule makes is accepted | CAUGHT (1 tests failed, 1 files failed) | a fact could be recorded for a period that does not exist |
| D5 | a payment is accepted for a loan | CAUGHT (1 tests failed, 1 files failed) | a loan payment would be recorded outside Loans |
| D6 | finishing the wrong Task is accepted | CAUGHT (1 tests failed, 1 files failed) | a different Task than the one previewed could be finished |
| R1 | "use the payment" sets the payment aside | CAUGHT (1 tests failed, 1 files failed) | a repair would hide the payment instead of the skip |
| R2 | a stale repair picks another conflict | CAUGHT (1 tests failed, 1 files failed) | a repair previewed earlier could be applied to different records |
| R3 | a move onto an occupied period is allowed | CAUGHT (1 tests failed, 1 files failed) | two periods could be merged silently |
| R4 | a stale move is accepted | CAUGHT (1 tests failed, 1 files failed) | a move could ignore records added after the preview |
| R5 | a move forgets where records came from | CAUGHT (3 tests failed, 2 files failed) | the audit trail of a move would be lost |
| R6 | a period with an unreadable record can be moved | CAUGHT (1 tests failed, 1 files failed) | a record this version cannot read could be moved unsafely |
| X1 | a second reminder Task is made | CAUGHT (5 tests failed, 2 files failed) | every press would add another reminder Task |
| X2 | autopay gets a Task by default | CAUGHT (5 tests failed, 3 files failed) | every automatic bill would flood Tasks |
| X3 | a Task the owner moved follows the due date | CAUGHT (1 tests failed, 1 files failed) | the owner's own change to a Task would be overwritten |
| X4 | an old unrecorded month gets a Task | SURVIVED on the first run, then CAUGHT after a test was added | a pile of old months would become reminders |
| X5 | an inactive bill makes Tasks | SURVIVED on the first run, then CAUGHT after a test was added | a paused or ended bill would keep making reminders |
| X6 | a passed deadline makes a Task | CAUGHT (1 tests failed, 1 files failed) | a deadline that already passed would become a Task |
| V1 | the attention window never ends | CAUGHT (1 tests failed, 1 files failed) | every old unrecorded month would pile up in the counts |
| V2 | past-due bills counted as cash needed | SURVIVED on the first run, then CAUGHT after a test was added | old bills would be added to the expected cash figures |
| V3 | an unknown amount counted as known | CAUGHT (2 tests failed, 1 files failed) | unknown amounts would be counted as known bills |
| V4 | a finished Task is always "not confirmed" | CAUGHT (2 tests failed, 2 files failed) | a Task finished after the payment was recorded would still nag |
| V5 | acknowledged conflicts still counted | CAUGHT (1 tests failed, 1 files failed) | "leave as is" would not quiet the counts |
| H1 | the Calendar horizon is a month too long | CAUGHT (1 tests failed, 1 files failed) | the Calendar would show 13 months |
| H2 | a Task on a different day hides the due date | CAUGHT (1 tests failed, 1 files failed) | the due date would vanish from the Calendar whenever a reminder Task exists |
| H3 | automatic payments shown as overdue | CAUGHT (1 tests failed, 1 files failed) | an autopay past its date would appear as overdue |
| H4 | an amount in a Calendar title | CAUGHT (2 tests failed, 1 files failed) | an amount would leak into Calendar text |
| S1 | recorded periods are not "applied" in a schedule change | CAUGHT (2 tests failed, 2 files failed) | a schedule edit could re-attach facts to a different bill |
| U1 | Undo leaves the Task link behind | CAUGHT (2 tests failed, 1 files failed) | taking back "Done, mark paid" would leave a dangling link |
| M1 | a damaged invoice amount is read as zero | CAUGHT (1 tests failed, 1 files failed) | a damaged record would contribute a zero bill |
| M2 | an unknown fact type is dropped to a blank skip | CAUGHT (5 tests failed, 3 files failed) | a record from a newer version would turn into a skip and suppress a bill |

Honest note on the run: an earlier attempt was stopped part-way because it was slow; stopping it left one file in a broken state, which was detected with a check script (every mutation's original text must still be present), restored by hand, and the full Bills suite was re-run green before the final run.

## 16. Desktop and mobile browser checks (in-app browser pane, its own database, invented data; NOT a real phone or a real two-device test)

| Check | Result |
|---|---|
| Edit a bill: pay by hand + reminder | Saved; the bill page then showed "Reminder Task "Pay Example Power" is for Sun, Nov 15 (the bill is due Wed, Nov 18)". |
| Enter the bill with an actual due date | Preview "What will happen"; after saving: "Due Wed, Nov 25 (recorded by you; the schedule said Wed, Nov 18)", "Billed $114.20", the Task moved to Nov 22. |
| Done, mark paid | Dialog showed the period, the two choices, the preview (finish the Task, make the next one for Dec 15) and a checkbox; after saving: November "Paid" with the mandatory line, "$114.20 paid outside Finance, $0.00 left", exactly one open Task (December). |
| Records that disagree | Rows added directly into the pane's database (as another device would): the Needs review page listed two disagreements, one unreadable record and a Task problem, with side-by-side records and the three choices. "Use this one" showed "Keep "Billed $120.00" ... Set aside "Billed $100.00" ... stays visible under History" and applied; the count fell from 2 to 1. |
| Contract dates | Added renewal 15 Dec and cancel-by 28 Nov: shown with relative days and meanings; a deadline Task for 25 Nov appeared under Reminders. |
| Today | Card "Bills & Subscriptions" with counts only ("1 billing record disagrees with another", "1 billing record needs a look"), matching the Needs review page; the Calendar section of Today showed "Due: Streamly Premium" from the new layer. |
| 375 x 812 | Bill page: `scrollWidth` 375 = `innerWidth`, no overflowing element, no button under 40 px; Today card readable. |
| Dark mode | Today and the bill pages legible (checked on Today at 375 px). |
| Hide Amounts | Overview, All bills, bill page, Upcoming, Needs review, Today and the repair preview dialog: **0 unmasked dollar figures** (a first check found two static sentences that mentioned "$0.00" and one page not re-rendered; the sentences were reworded and everything re-checked). |
| Keyboard | Focus moved into the dialog on open, Tab stayed inside it, Escape closed it. |
| Skip, extra bill, credit, paid in full | Skip: preview then "Skipped" with its mandatory line. Extra bill ($35.00, due 30 Dec): shown as "an extra bill". Credit $5.00: "Billed $35.00, credit $5.00, owed $30.00". Paid in full: "Marked paid by you (no amount recorded)" and no paid amount appeared. |
| **Not done in the browser** | Changing a due date through the separate "Set the due date" form; the Calendar month grid itself (the layer was seen through Today); real phone; screen reader; measured contrast; two physical devices; offline use. |

## 17. Known limitations and unresolved risks

- Everything in sections 6 and 16 "not done"; real-device and two-device acceptance are outstanding.
- Whole-record last-writer-wins still applies to editing one existing fact or the bill itself (the "leave as is" memory lives on the bill).
- A partial payment note re-opens a period and can make another Task (section 6, item 2).
- Older open Tasks can stand for a period that was moved or settled elsewhere: reported, and removed only by the explicit "Update reminders" action and only if the owner never changed them.
- Look-back 45 days (counts) and 75 days (bill page): older unrecorded months are not listed.
- Facts of a bill cannot be re-homed to another bill; an orphan can only be removed.
- "Activity after the end date" notice not built.
- A pre-B2 (B1) build that edits a bill rewrites `reminders` (it keeps only `payTask` and `leadDays`) but keeps the top-level `noDeadlineTasks` field, so the choice survives (section 21). Residual: the choice is simulated against the B1 rule, not run on a real B1 build.
- Calendar and Today dates are the device's clock; no holiday calendar.

## 18. B3 prerequisites

B3 (Finance links) should: add `payment-link` facts and read them in `periods.ts` (the `suspended` input of `primaryLabel` is already there); change the autopay wording to "not yet seen in Finance"; add the one-source rule between typed and linked payments (`amounts.ts` already separates them); reuse `TxnPicker`, `txnRef`, `costSource` and `spend()`; keep the same read model so counts stay in agreement; extend the Today and Overview categories with stale links. Open questions for the owner: whether a typed outside-Finance amount should be convertible to a link (a "switch" with confirmation), and whether the autopay grace period should be adjustable.

## 19. Handoff and backlog update confirmation

**Handoff updated: yes** (`docs/CHATGPT-HANDOFF.md`): header and snapshot, B1 marked committed and deployed, a new B2 section (model, derivations, repairs, Tasks, Calendar, not-built list, risks), roadmap line, risk entry, change-log entry. It distinguishes B1 committed and deployed (verified), B2 built and tested locally, B2 uncommitted and not deployed, real-device acceptance outstanding, and says B3 is not authorized. **Backlog updated: yes** (new top entry with numbered judgment calls and the NOT built list; the B1 entry relabelled). `README.md`, `docs/module-hooks.md` and `docs/due-provider.md` updated. What remains unknown: B2's Pages result (nothing pushed) and everything on real devices.

## 20. Exact final Git status

```text
$ git rev-parse HEAD origin/main
3bcf3a386666e368819842882860fe2b65459b85
3bcf3a386666e368819842882860fe2b65459b85

$ git status --short
 M README.md
 M docs/BACKLOG.md
 M docs/CHATGPT-HANDOFF.md
 M docs/due-provider.md
 M docs/module-hooks.md
 M src/lib/sync/sync.test.ts
 M src/modules/bills/BillsModule.tsx
 M src/modules/bills/ObligationForm.tsx
 M src/modules/bills/ObligationPage.tsx
 M src/modules/bills/OverviewPage.tsx
 M src/modules/bills/bills.css
 M src/modules/bills/billsTestkit.ts
 M src/modules/bills/data.ts
 M src/modules/bills/guards.test.ts
 M src/modules/bills/hooks.test.ts
 M src/modules/bills/index.tsx
 M src/modules/bills/model.ts
 M src/modules/bills/paths.ts
 M src/modules/bills/schedule.ts
 M src/modules/bills/undo.ts
 M src/modules/calendar/calendar.test.ts
 M src/modules/calendar/data.ts
 M src/modules/calendar/model.ts
?? docs/BILLS-SUBSCRIPTIONS-B2-REPORT-2026-11-07.md
?? scripts/bills-b2-mutation-check.cjs
?? src/modules/bills/ContractCard.tsx
?? src/modules/bills/CycleDialogs.tsx
?? src/modules/bills/PeriodParts.tsx
?? src/modules/bills/PeriodsCard.tsx
?? src/modules/bills/RepairDialogs.tsx
?? src/modules/bills/ReviewPage.tsx
?? src/modules/bills/UpcomingPage.tsx
?? src/modules/bills/amounts.ts
?? src/modules/bills/b2-data.test.ts
?? src/modules/bills/b2-state.test.ts
?? src/modules/bills/b2-sync.test.ts
?? src/modules/bills/b2-views.test.ts
?? src/modules/bills/contractData.ts
?? src/modules/bills/cycleConflicts.ts
?? src/modules/bills/cycleData.ts
?? src/modules/bills/cycleModel.ts
?? src/modules/bills/cycleRepair.ts
?? src/modules/bills/dueProvider.ts
?? src/modules/bills/labels.ts
?? src/modules/bills/periods.ts
?? src/modules/bills/readModel.ts
?? src/modules/bills/slots.ts
?? src/modules/bills/tasks.ts
?? src/modules/bills/terms.ts
?? src/modules/bills/timing.ts
?? src/modules/bills/todayCards.tsx
```

Nothing is staged, committed, pushed or deployed. HEAD and origin/main are both the verified B1 commit 3bcf3a3. Every new file is untracked; the modified files are listed above. No file outside the repository was changed, and the dev server used for the browser checks is stopped.


## 21. PRE-COMMIT CORRECTIONS (added after ChatGPT's review: "APPROVED WITH FOLLOW-UPS, DO NOT COMMIT YET")

Status of this section: the four follow-ups were investigated and corrected or documented; everything below is built and tested locally and is **still uncommitted, unstaged, unpushed and undeployed**. B3 was not begun. Sections 1 to 20 above are the original report; where this section changes a statement there, the statement was edited in place and points here.

### 21.1 Paused and ended bills with existing Tasks (follow-up 1)

**What the code did before (confirmed by 9 failing tests written first against the unchanged code).** For a paused or ended bill `planBillTasks` returned an empty plan immediately. So: pausing or ending left an open reminder Task exactly as it was (still actionable, still dated, not reported anywhere); resuming or reopening made a new Task only if none was open; a Task the owner had moved was never touched (correct) but also never reported once the bill was inactive; nothing new was ever made for an inactive bill (correct). The misleading part: an untouched Bills-made reminder stayed actionable after the bill ended or the period it stood for was paused away. Also found by the sync test: after A ends a bill, a Task that B made offline before seeing the end stayed open and unreported.

**Behaviour now (`tasks.ts`, `data.ts`, `contractData.ts`, `ReviewPage.tsx`), case by case:**

| Case | Result |
|---|---|
| Manual bill with an open untouched reminder is **paused from today** | The reminder stands for a period the bill no longer expects, so it is **removed** (a soft delete through the Tasks API's `removeTasks`: it is restorable and the action has a guarded Undo). The preview in the dialog says so first ("1 reminder Task that Bills made and you have not changed will be removed ... Undo brings it back"). Nothing new is made. Billing records are not touched. |
| Paused **from a later date** | The period before the pause is still expected, so its reminder stays. |
| The same bill is **ended** | Untouched pay and cancel-by/trial reminders for periods or deadlines no longer expected are removed (same rules). The final bill (a period still expected up to the end date, or one that holds a recorded bill) keeps its reminder. Finished Tasks are never touched. |
| **Resumed or reopened** | The ordinary one-Task rule applies: if a Task for the period is open (for example one the owner kept) it is reused, otherwise exactly one is made. A removed Task is never revived, so there are no duplicates (tested, including asking again). |
| A reminder **the owner moved, renamed, started, annotated** or otherwise changed | "Untouched" is strict: still To do, the date still equals the date Bills gave it (`billsDoOn`), title, notes, priority, contacts, list, tags and checklist exactly as Bills made them. Anything else is "touched": it is **never removed or edited**, stays open, and is reported on Needs review and the Today count ("a reminder Task is still open although the bill is ended"). The dialog preview says "1 reminder Task you changed stays open". If the bill is resumed the report clears and the owner's Task (and its date) is reused. |
| **Partly paid, then paused** | The period holds recorded information and still owes a balance, so its reminder stays. |
| **Ended on one offline device while another finishes the Task** | Tested both ways. B finishes after A ended: both converge on a finished Task, an ended bill, no new reminder. B finished (and recorded the payment note) before A ended: both devices converge on the same state, the payment note survives on both, and the removal (later write) may hide the finished Task; it stays restorable (the Tasks screen's deleted list). Honest limit: this is ordinary last-writer-wins on the Task row. |
| A reminder B made offline before seeing the end | Now reported (a count and a Needs-review line) with an explicit **Update reminders** button (guarded, undoable) that removes untouched ones only. Nothing runs by itself after a sync, so the Task stays open until the owner presses it or any save on the bill runs the same step. |

Action date versus due date: removing or keeping a Task never changes any billing record or recorded due date (tested: a recorded 25 November due date survives an end, and the kept final reminder keeps its 22 November action date and `billsDue` of 25 November).

**Code changes:** `planBillTasks` gains a branch for paused or ended bills (`retire`, `stale`, never `create`) and an `untouched` test; `ensureBillTasksIn` removes the `retire` list through `removeTasks` after capturing each row for Undo; `planLifecycle` adds the Task lines to the preview; `tidyReminders` (the Update reminders action); attention counts the new "still open on an inactive bill" case; the source guard now allows `removeTasks` from `tasks.ts` only.

### 21.2 Task association and Undo (follow-up 2)

Inspected, not assumed:

- **Where the association lives.** (a) Markers inside the Task row's carried-through unknown fields (`billsObligation`, `billsCycle`, `billsPurpose`, `billsDue`, `billsDeadline`, `billsDoOn`): this is how Bills finds its Tasks (`loadBillTasks` filters by marker; the link is never consulted). (b) One shared `links` row per Task, `task -> obligation:<id>`, type `about`, written by the Tasks API's `createTask` (we pass the obligation as a reference). The obligation row holds no Task id.
- **Documentation inconsistency, corrected.** The report and guard text said "no shared link is written". Bills writes no link directly (the guard forbids `shared.links.add/remove` and any direct `links` write), but `createTask` does write the `about` link. Sections 5 and 10, `module-hooks.md` and the handoff now say so.
- **What Undo removes or restores.** Undo of "create bill with reminders", "Done, mark paid" and "End" restores or removes the Task rows it touched (they are rows in the same table, fingerprinted; Undo refuses if any changed) and soft-deletes exactly the link rows the action added (`Undo.linksAdded`); a Task retired by End is restored (its link was never removed).
- **Sync and backup.** Both the Task rows (with markers) and the link rows are ordinary records: tested through the real `SyncEngine` and through export, checker and restore (markers and links come back; counts in the summary name no title).
- **Task deleted or modified independently.** Modified: markers survive a normal edit, the Task keeps its association and shows as touched (never removed). Deleted by the owner: Bills (marker discovery) simply no longer sees it, and one fresh reminder is made when asked. **A genuine dangling-association bug was found and fixed:** the `about` link row stays live after its Task is deleted, and `planDelete` counted it ("1 reminder Task is linked"), so a bill with no history could not be permanently deleted. The guard now counts a Task link only while its Task is live (tested; one mutation check covers it).

### 21.3 Older-version reminder preference (follow-up 3)

- **Exact mechanism.** The deployed B1 reader (`asObligation`) reads `reminders` only as `{ payTask, leadDays }` and its `toStored` writes exactly that back; `reminders` is a known key, so any other key nested inside it is not carried by the unknown-field handling. B2 had put `deadlineTasks:false` inside `reminders`, so any edit of the same bill by a B1 build (the edit form, pause, end, review list, anything that writes the obligation) dropped it.
- **When it happens.** Only when an older build writes the same obligation; reading alone does nothing. By whole-record last-writer-wins that write then replaces the newer one.
- **Could it create unwanted Tasks?** Yes: with the choice gone the default (deadline Tasks on) returns, so a B2 device would make a cancel-by or trial Task the owner had switched off.
- **Fix (narrow, inside B2):** the choice is now the top-level obligation field `noDeadlineTasks: true`. B1 keeps unknown top-level fields (its `extras` carry-through, the same mechanism the B1 mutation check M6 protects), so it survives a B1 edit. B2 writes nothing nested in `reminders` any more. Nothing in older builds, sync, persistence or migration was changed. Nothing used the nested form in the wild (B2 is uncommitted), so no legacy reading is needed.
- **Evidence and limit.** A test applies the B1 rule to a stored record (keep only `payTask`/`leadDays` inside `reminders`, keep other top-level fields) and shows the choice and the no-Task result survive. It is a **simulation of the B1 rule from its source, not a run of the real B1 build**.

### 21.4 Direct Calendar browser acceptance (follow-up 4)

Method: the in-app browser pane; its database was emptied first (isolated, nothing from earlier runs), then seeded with invented data using the app's own code (`createObligation`, `recordFact`, `saveTerms`, `createArrangement`, plus a Finance account and monthly scheduled item) through the dev server's modules. Today in the pane: 2026-11-07. Seed: Example Power Co (manual, monthly 18th, reminders on, a 25 Nov due date recorded on its November bill), Maple Insurance (annual, trial end 12 Nov, cancel-by 20 Nov, renewal 15 Dec), Same Day Water (manual, reminder lead 0, monthly 30th), Streamly Premium (automatic, monthly 12th), Finance scheduled item "Example Rent" (monthly 20th), Household Services "House cleaning" (every two weeks).

| Check | Result (tested in the browser unless marked) |
|---|---|
| Bills layer in the layer selector | "Bills & Subscriptions (auto)" chip beside Finance, Home & Assets, Household Services, Personal, Projects, Tasks; seven layers. |
| Expected occurrences in the month view | November showed Due: Streamly Premium (12th), Cancel by: Maple Insurance (20th), Due: Example Power Co; December showed Renewal: Maple Insurance (15th), Due: Streamly (12th), Due: Example Power (18th), the 30th marker. |
| Corrected due date moves the marker | November bill: marker on 25 Nov. After editing the recorded due date to 27 Nov (real `editFact`), the marker is on the 27th; the 18 Nov schedule date shows nothing. The untouched reminder Task followed from 22 to 24 Nov. |
| Stable logical identity | Same period id `m2026-11` and same phone-calendar id `m2026-11@ledger.local` (after the `bills-<bill>-` prefix) before and after; only the date part of the item id changes (the `derivedId` convention). The December period's id was unchanged. |
| Task on another date does not hide the marker | Pay Example Power Co on 22/24 Nov and Due: Example Power Co on 25/27 Nov were both shown; likewise Trial ends: Maple (Task 9 Nov, marker 12 Nov) and Cancel or give notice (Task 17 Nov, marker 20 Nov). |
| Task on the same date suppresses only the duplicate | Same Day Water: "Pay Same Day Water" on 30 Nov and NO Due marker that day; the 30 Dec marker (a later period, no Task) is shown. |
| Notice, trial, renewal | Cancel by (20 Nov), Trial ends (12 Nov), Renewal (15 Dec) appear as separate markers; the detail panel for the renewal says "Ledger does not renew anything" and is read-only with "Open bill". |
| Layer toggle | Switching the Bills chip off removed every Bills marker (the only "Trial ends" left was the Task from the Tasks layer); Finance, Household Services and Tasks items stayed; back on, all returned. |
| Finance and Household Services layers | Example Rent (20th) and House cleaning visits displayed normally throughout. |
| Privacy and Hide Amounts | No Bills marker title or detail contains an amount, account number, note or document number (checked in the page for all markers and in a detail panel). With Hide Amounts on, the Bills markers still carry no figure. **Observation, not changed:** the Finance layer's own title "Example Rent $1,200.00" is shown even with Hide Amounts on (existing Finance behaviour, outside this work). |
| 375 px | Agenda view: `scrollWidth` 375 equals the width, no overflowing element, no control under 36 px, layer chips wrap, Bills items listed. |
| **Not verified** | The Week and Work-week views; the Export (.ics) file contents (only the stable ids and text were checked in code); a real phone; two physical devices; a screen reader; measured contrast; the phone's own calendar app receiving the ids. |

### 21.5 Additional tests

New file `b2-lifecycle.test.ts` (16 tests): pause from today, pause from a later date, end, a moved/renamed/started/annotated Task, a partly paid bill that is paused, action date versus due date, resume with no duplicates, a kept Task reused after resume, reopen, Undo of End and its refusal after a change, two simulated-sync orders (finish after end, end after finish) plus "Update reminders", Task association and markers, a Task deleted independently, a Task edited independently, and the older-build simulation. Five new mutation checks (Y1 to Y5: a moved Task counted as untouched; a period with records losing its reminder; every reminder of an inactive bill retired; the deadline choice ignored; a deleted Task still blocking Delete) were run: **all five CAUGHT**. Mutation X5 was re-pointed at the rewritten line and re-run: CAUGHT. Existing tests changed: only the source guard (now also allows `removeTasks` from `tasks.ts`) and one B2 test that used the old nested field.

### 21.6 Final automated results

`npm test`: **2,609 tests pass in 147 files** (the first B2 report: 2,593 in 146; the B1 baseline: 2,463 in 142; so 146 new in total, 16 in this pass). `npx tsc --noEmit`: clean. `npm run build`: succeeds (the existing chunk-size warning only). `git diff --check`: only line-ending notes, no whitespace errors.

### 21.7 Remaining limitations (additions to section 17)

- Removal of an untouched reminder is last-writer-wins on the Task row: a finished Task on another device can be hidden (restorable) if the removal is the later write.
- Nothing cleans up automatically after a sync: the stray reminder stays open (and is reported) until "Update reminders" or a save on the bill.
- A bill renamed after its reminders were made makes those reminders "touched" (the title no longer matches), so they are kept and reported rather than removed.
- The older-build protection is simulated, not run on a real B1 build.
- Calendar acceptance did not cover Week or Work-week views, .ics export contents or a phone's calendar app.

### 21.8 B3 scope recorded (not implemented)

The owner asked for two UX improvements to be done in B3. They are recorded in the backlog and the handoff and **nothing of them was built here**: **B3.0A** a Household Services Upcoming filter (windows 7, 14, 30 and 90 days, default 30, persisted, Overview visibility only; not the 12-month Calendar horizon and not the one-actionable-Task rule); **B3.0B** Calendar visibility controls (Select All and Deselect All; all calendars visible by default for a fresh configuration; manually selecting only Personal afterwards; explicit selections persisted; sensible behaviour when new layers are registered; no event or recurrence data mutated).

### 21.9 Handoff and backlog confirmation, and exact final Git status

**Handoff updated: yes** (only where findings change it: the Task rules, the older-build note, the correction summary, the B3 scope, a change-log entry). **Backlog updated: yes** (a correction note and the B3.0A/B3.0B scope). Section 20's Git block above is the state when the first report was written; this is the final state:

```text
$ git rev-parse HEAD origin/main
3bcf3a386666e368819842882860fe2b65459b85
3bcf3a386666e368819842882860fe2b65459b85

$ git status --short
 M README.md
 M docs/BACKLOG.md
 M docs/CHATGPT-HANDOFF.md
 M docs/due-provider.md
 M docs/module-hooks.md
 M src/lib/sync/sync.test.ts
 M src/modules/bills/BillsModule.tsx
 M src/modules/bills/ObligationForm.tsx
 M src/modules/bills/ObligationPage.tsx
 M src/modules/bills/OverviewPage.tsx
 M src/modules/bills/bills.css
 M src/modules/bills/billsTestkit.ts
 M src/modules/bills/data.ts
 M src/modules/bills/guards.test.ts
 M src/modules/bills/hooks.test.ts
 M src/modules/bills/index.tsx
 M src/modules/bills/model.ts
 M src/modules/bills/paths.ts
 M src/modules/bills/schedule.ts
 M src/modules/bills/undo.ts
 M src/modules/calendar/calendar.test.ts
 M src/modules/calendar/data.ts
 M src/modules/calendar/model.ts
?? docs/BILLS-SUBSCRIPTIONS-B2-REPORT-2026-11-07.md
?? scripts/bills-b2-mutation-check.cjs
?? src/modules/bills/ContractCard.tsx
?? src/modules/bills/CycleDialogs.tsx
?? src/modules/bills/PeriodParts.tsx
?? src/modules/bills/PeriodsCard.tsx
?? src/modules/bills/RepairDialogs.tsx
?? src/modules/bills/ReviewPage.tsx
?? src/modules/bills/UpcomingPage.tsx
?? src/modules/bills/amounts.ts
?? src/modules/bills/b2-data.test.ts
?? src/modules/bills/b2-lifecycle.test.ts
?? src/modules/bills/b2-state.test.ts
?? src/modules/bills/b2-sync.test.ts
?? src/modules/bills/b2-views.test.ts
?? src/modules/bills/contractData.ts
?? src/modules/bills/cycleConflicts.ts
?? src/modules/bills/cycleData.ts
?? src/modules/bills/cycleModel.ts
?? src/modules/bills/cycleRepair.ts
?? src/modules/bills/dueProvider.ts
?? src/modules/bills/labels.ts
?? src/modules/bills/periods.ts
?? src/modules/bills/readModel.ts
?? src/modules/bills/slots.ts
?? src/modules/bills/tasks.ts
?? src/modules/bills/terms.ts
?? src/modules/bills/timing.ts
?? src/modules/bills/todayCards.tsx
```

Nothing is staged, committed, pushed or deployed. HEAD and origin/main are both the verified B1 commit 3bcf3a3. Every new file is untracked. The dev server used for the browser checks is stopped, no scratch file is left in the repository, and the browser pane's own database was emptied and re-seeded with invented data (it is not the owner's data).
