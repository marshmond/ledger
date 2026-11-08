# Bills & Subscriptions B4: subscription lifecycle, trials and renewals, cancellation evidence, price history and the Household Services link. Implementation report

Date: 2026-11-07 (work ran past midnight into 2026-11-08 local time). Status: **built and tested locally. NOT staged, NOT committed, NOT pushed, NOT deployed, NOT acceptance-tested on a real device, NOT yet independently reviewed.** B5 and B3.2 were not started. The governing rule held throughout: *Ledger records what the owner knows and what evidence exists. It never cancels, renews, converts, reprices or ends anything for the owner.*

## 1. Executive summary (plain English)

Ledger now understands the life of a subscription, not only its recurring price. On a bill's page there is a **Subscription life** card (collapsed for ordinary bills, open for subscriptions and for any bill that has recorded history). Everything on it is something the owner recorded; nothing is done to the provider, and nothing in Finance changes.

1. **Where it stands.** Several states can hold at once (for example *active*, *cancellation requested, confirmation pending* and *renewal expected*), and none is a stored status that erases history: *trial*, *trial ended, conversion not confirmed*, *cancellation planned*, *requested, confirmation pending*, *confirmed, effective on a date*, *effective* (the date arrived), *ended*, *renewal expected*, *renewal date passed, not confirmed* and *needs review*. A request is never worded as a confirmation, and a confirmation never means service ended before its effective date.
2. **Trials and renewals.** Record a trial (dates, payment method on file, conversion automatic or manual, price after, must-cancel-by date); extend it; record what happened. Record renewal terms (date, cadence, automatic or manual, notice days, whether it changes price or terms, confirmed or estimated). A passed trial or renewal date only ever raises a review item ("Ledger did not renew anything and does not know what happened"); *Did it renew?* records the answer and the next date in one step.
3. **Price history.** Effective-dated price steps (fixed, estimated or unknown; optional end date; source). A new price changes only what is *expected*: recorded bills, payments and Finance are never touched, and an unknown price is never zero. A preview says which future bills change, by how much, which already-recorded periods keep their amounts, and warns when a price starts partway between billing dates (record any partial-period difference as an extra bill). A latest payment that differs from the expected price raises a calm notice ("might be tax, a fee, a credit or a one-off"), never a change.
4. **Cancellation.** *Record a cancellation request* (the dialog says Ledger is only recording it, not contacting the provider) and, separately, *Record a cancellation confirmation* (with the effective date, provider reference, final charge or refund as notes only, access-until date) (a checkbox that also ended the bill was REMOVED before commit; see section 25). Withdrawals, a provider changing the date, reactivation and an immediate cancellation are all supported as new records; the earlier ones stay visible, dimmed, in a readable **History**. After the confirmed effective date, expected bills stop; invoices already recorded, final bills and refunds stay recordable.
5. **After the cancellation.** Transactions in Finance that look like the subscription and are dated after its cancellation date raise "possible charges after cancellation" (pending, refund-offset, expected-final, weak-resemblance and other-bill cases are handled in words). A Finance Scheduled payment still active for a cancelled or ended bill is a review item. Ledger disputes, links, reverses and refunds nothing.
6. **Disagreements are shown, never silently resolved.** Two offline devices recording different effective dates, different prices for one day, different renewal dates, or a withdrawal beside a confirmation neither saw, all survive on both devices; the disputed value is not used until the owner chooses (*Choose which stands* keeps the others as history, or *Leave as is*).
7. **Household Services.** An optional, owner-confirmed `bills-for` link between a bill and a Household Services arrangement (preview, audit record, guarded Undo, removable). It lets the Calendar leave out a Bills cancel-by or renewal marker only when the arrangement shows the same kind of date on the same day, and only while that Services marker is shown. Visits, Tasks, other dates and Finance approvals are never hidden, and no total changes.

**No table, migration, dependency, sync rule or backup format changed.** Lifecycle evidence is a new *kind* of `bills` record (the escalation path B0 section 10.4 already names), not a field on the obligation. See sections 5 and 6 for why.

## 2. Verified B3.1 commit and GitHub Pages deployment (the gate)

| Check | Result |
|---|---|
| Repository and remote | `origin` = `https://github.com/marshmond/ledger.git` (`marshmond/ledger`) |
| Branch | `main`, tracking `origin/main` |
| `HEAD` equals `origin/main` (after `git fetch`) | yes: `f2db2a782b8646a52fbf8b8d8620772c52df8e29` (`feat(bills): B3.1 recurring discovery and Finance Scheduled integration`); `git rev-list --left-right --count HEAD...origin/main` = `0 0` |
| Matching Pages run | "Deploy to GitHub Pages" run **#72**, id 42447051449, `event` push, `head_sha` exactly the B3.1 SHA, **`completed` / `success`** (jobs `build` and `deploy` both `success`) (public Actions API; the `gh` CLI is not installed) |
| Working tree at the start | clean (`git status --short` empty) |
| Unrelated or unreviewed commits | none (previous commits: B3 `ceb0ea8`, B2 `aca2208`, B1 `3bcf3a3`, B0 plan `8059e5f`) |
| B3.1 present | yes: `suggest.ts`, `discovery.ts`, `scheduledLink.ts`, `financeRead.ts`, `markerCoordination.ts` and their tests |
| Baseline | **2,973 passing tests in 164 files** (re-run, not assumed; matches the reported B3.1 final) |

**An honest note on timing.** When the SHA was first checked (about 70 seconds after the push) run #72 was `in_progress` (its test step still running). No application code was touched until it completed `success`; the required documents and source were read in the meantime, which the brief allows.

## 3. Baseline and final test totals

Baseline 2,973 tests in 164 files. Final: **3,141 passing tests in 170 files** (baseline 2,973 in 164; +168 tests in 6 new test files) (see section 21 for the check results). New test files (all prefixed so a mutation run can select them): `b4-model.test.ts` (66: reader, replacing, prices, deadlines, renewals, cancellation states, trial and renewal states, timeline, charges after cancellation), `b4-data.test.ts` (45: every action against a real database, stale previews, rollback, Undo, Tasks, review items, Finance reads), `b4-sync.test.ts` (20: the real `SyncEngine` with two devices, backup and restore, an older reader), `b4-calendar.test.ts` (15), `b4-guards.test.ts` (17), `b4price.test.ts` (5).

## 4. Files added and modified

**Added (source, 10):** `src/modules/bills/lifecycleModel.ts` (the record kinds, defensive reader, validation), `lifecycleState.ts` (the pure meaning of the records: effective set, conflicts, prices, deadlines, renewals, states, timeline), `lifecycleRead.ts` (the one read that attaches the view), `lifecycleCharges.ts` (charges after a cancellation), `lifecycleFinance.ts` (read-only Finance reads for the checks), `lifecycleData.ts` (previews, guarded appliers, acknowledgement), `crossLinks.ts` (the Household Services link), `priceEvidence.ts` (a possible price change from Finance, pure), `LifecycleCard.tsx`, `LifecycleDialogs.tsx`.
**Added (tests, 6; script, 1; doc, 1):** the six test files above; `scripts/bills-b4-mutation-check.cjs`; this report.
**Modified (source):** `model.ts` (reader-only `lc`, `estimated`/`conflict` on a price step, `expectedAmountOn` and `scheduleSource` use the view), `data.ts` (loaders attach the view; delete refuses when lifecycle records exist), `views.ts` (`currentAmount`), `tasks.ts` (effective deadlines, two new Task purposes, follow-up Task writer, planner reads the view), `dueProvider.ts` (renewal series, cancellation and price markers, Services coordination), `readModel.ts` (four attention categories, snapshot reads), `ReviewPage.tsx`, `OverviewPage.tsx`, `todayCards.tsx` (new categories), `ObligationPage.tsx` (the card and a header chip), `undo.ts` (removed links), `bills.css`; `src/lib/backupSummary.ts` (one label).
**Modified (tests):** `b31-guards.test.ts`: **one allow-list entry added** (`lifecycleFinance.ts` may use the read-only Finance loader). No assertion was removed or loosened; see section 5 deviation 6.
**Modified (docs):** this report, `docs/CHATGPT-HANDOFF.md`, `docs/BACKLOG.md`, `README.md`, `docs/module-hooks.md`, `docs/due-provider.md`.
**Not touched:** `src/db.ts`, `merge.ts`, `backup.ts`, `types.ts`, the sync engine, every Finance engine and page, `lib/rules.ts`, `lib/schedule.ts`, `lib/txnRef.ts`, `lib/costSource.ts`, `lib/txnLookup.ts`, `lib/financeRead.ts`, `assets/spending.ts` (`spend()`), `services/householdSpend.ts`, every Services file, the Tasks engine and the Calendar module.

## 5. B0 compliance and deviations

B0 Revision 2 sections 3.2, 7 and 14 (B4) were followed. Deviations and judgment calls, each with its reason:

1. **Lifecycle evidence lives in a new `lifecycle` record kind, not in the obligation's `terms`, `cancellation` and `lifecycle` fields (B0 B-2).** B0 chose embedded fields "edited rarely, by one person" and named the escalation path: "if an obligation-level append proves too easy to lose, move those lists out into append-only records of the same shape as facts. That is still no merge change." The B4 brief requires exactly that (append-only facts; two devices' different confirmations or prices must be flagged, which a whole-record last-writer-wins field cannot do). It is the same pattern B3.1 used for review choices (`discovery`). The B2 `terms` (contract dates) and B1 `lifecycle` log (the owner's pause, end and reopen actions) keep working unchanged and the new records overlay them. The unused B0 `cancellation` field is left alone.
2. **Cancellation never changes the stored status.** A confirmed, undisputed effective date stops *expected* bills through the reader (`scheduleSource`); the owner ends the bill (B0 7.3 step 4) through the separate End workflow, which has its own preview (an earlier "also mark ended" checkbox was removed before commit, section 25).
3. **A trial that ends on the cancel-by day is now one Task, not two** (B2 made two). This changes B2 behaviour for existing bills whose two dates coincide; the brief asks for it ("avoid duplicate Tasks when a trial deadline overlaps a cancellation deadline").
4. **Two new `billsPurpose` values (`renewal`, `followup`).** An older build does not recognise them and treats such a Task as an ordinary Task.
5. **`undo.ts` gained `linksRemoved`** (and refuses to restore a link if the same relationship was re-created, so Undo can never duplicate it).
6. **Guards.** (a) `b31-guards.test.ts` lists the files allowed to use the read-only Finance loader; `lifecycleFinance.ts` was added (one string). (b) The older guards that forbid Bills from writing shared links match the text `shared.links.add` and `d.links.add`; `crossLinks.ts` uses `repo<Link>(d.links)`, which those expressions do not match. That is a gap in how the old guard is written, not a decision to evade it, so `b4-guards.test.ts` states the real rule: **only `crossLinks.ts` (and `undo.ts`, which removes or restores links its own recorder noted) writes a link, only of type `bills-for`**. Please look at this in review. (c) Bills must not import the Services module (an existing guard), so the Services marker id format is written out in `dueProvider.ts` and a test compares it with Services' own `deadlineKey`.
7. **B0 "monthly to annual billing change as a schedule revision", "replace/migrate successor", "documents as DocRef links" and `involves` to a Project (listed under B0's B4) are NOT built here**: the brief for this phase does not list them. Schedule revisions already exist (B1 edit form); document links already exist (B1 `refs`).
8. **Reminders after a request.** The brief says not to silently stop Tasks because a request was recorded; none is stopped. A *confirmation* retires only untouched Bills-made Tasks that stand for something no longer expected, said in the preview first, with Undo.

Judgment calls (each reversible; none changes a financial rule): (1) a request with no confirmation becomes a review item after **7 days** (`AWAITING_DAYS`); (2) charges after a cancellation are looked for for **400 days** after it, so an old cancellation stops raising attention by itself; (3) a refund offsets a charge only if it comes on or after it, within **60 days**, and covers it **in full** (refunds are spent down across charges, earliest first); (4) a "final charge expected" note excuses a charge only up to the amount the owner recorded, within 60 days; (5) a weak payee resemblance is listed apart and never counted; (6) a payment that differs from the expected price is noticed only when it leaves the period over-paid against the expected price (a lower amount looks like a partial payment, already covered by "partly paid"); (7) trial and renewal review items age out after 60 days (B2's window); (8) one cancel-by date is kept at a time, preferring the trial's while the trial is open; (9) "Leave as is" is a record keyed to the exact evidence, so changed evidence is raised again; (10) a bill the owner ended with reason "cancelled" is checked for later charges from its end date even without a confirmation.

## 6. Lifecycle facts and the derived status model

**Records** (`moduleRecords`, module `bills`, kind `lifecycle`; one record = one thing the owner recorded about one obligation): `trial`, `trial-extend`, `trial-outcome`, `price-step`, `renewal`, `renewal-outcome`, `cancel-plan`, `cancel-request`, `cancel-confirm`, `cancel-withdraw`, `reactivate`, `service-link`, `ack`. Common fields: `obligationId`, `fact`, `op`, `replaces`, `targets`, `seen`. Added, never edited. A replaced or negated record stays visible. A replacement counts only if its id is *later* than what it replaces (ids are time-based), so two records can never replace each other. Unknown fields are carried; unknown types and damaged records are listed and counted for nothing.

**`seen`** is the list of lifecycle ids the writing device could see. It is what tells *one owner correcting themselves* from *two offline devices that did not see each other*: only the latter raises a "withdrawal and a confirmation that disagree" item. It adds no sync policy.

**Derived states** (`lifecycleStates`, never stored; several can hold): `review`, `ended`, `cancel-effective`, `cancel-confirmed`, `cancel-requested`, `cancel-planned`, `trial`, `trial-check`, `renewal-check`, `renewal-soon`. The one effect on bills: `scheduleSource` stops expected dates after a confirmed, undisputed effective date (the stored `status` stays `active`, so nothing contradicts B1).

## 7. Trial and introductory-offer workflows

Record a trial (`trial`; optionally the prices: a zero step with an end date, then the price after it, or *unknown* if it is unknown); extend it (`trial-extend` replaces the end date; the earlier date is history); record the outcome (`trial-outcome`: converted, ended with no charge, cancelled). Tests: begins and ends; unknown conversion price recorded as unknown, never zero; automatic versus manual; extension moves the one Task instead of adding one; early cancellation; expired without evidence is a review item only; introductory pricing; a confirmed zero-dollar period; trial-to-paid with no Finance posting leaves no transaction, link or invoice. A provider charging during a trial despite the expected zero price is noticed: a payment linked to a trial period leaves it over-paid against the expected zero, so the "latest payment differs from the expected price" notice appears, and nothing is rewritten (tested in `b4price.test.ts`).

## 8. Price-step data model and historical preservation

`price-step { from, until?, cents | absent = unknown, status: fixed | estimated | unknown, label, source, note }`. The effective list is the first price(s) entered on the bill plus the recorded steps; the step in force on a date is the last whose `from` is on or before it. Rules, each a test: a single change; several future steps in date order; an introductory price then the standard price; an explicit end date with nothing after it reads unknown (not carried forward, not zero); **two different prices from one day, or a recorded step that disagrees with the first price on its day, read as unknown with a review item; a later step starting inside an earlier step's explicit range reads unknown**; an estimated step reads as an estimate; a price effective in a short month applies from the first bill dated on or after it; retroactive prices change only expected amounts. **A new price never touches an invoice, a payment link or a Finance transaction (the cycle records and Finance tables are byte-identical before and after, tested).** Schedule revisions and price revisions are separate records and a price step never writes a billing-period fact. A price that starts partway between billing dates is allowed with a warning and a pointer to the existing extra-bill route. A provider credit is a separate `credit` fact and is not a price.

## 9. Renewal and notice-deadline behaviour

`renewal` records the next renewal and its cadence; the Calendar worked out the repeats inside its rolling 12 months (annual, monthly with end-of-month clamping and no drift, weekly, every 3 months; an unknown cadence gives only the recorded date; a confirmed cancellation stops the series). Nothing is stored for a future date (tested: no due item, no Calendar record, no Task for an automatic renewal). A renewal the owner must make by hand gets **one** decision Task. A passed date raises *Renewal date passed: not confirmed* for 60 days; *Did it renew?* records the answer and next date; *Leave as is* quiets exactly that date. Notice days fill the cancel-by date; one cancel-by date is kept at a time.

## 10. Cancellation request workflow

*Record a cancellation request* (date, requested effective date, method, reference, still-awaiting-confirmation, optional one follow-up Task). It writes one `cancel-request` record and nothing else: the bill record is byte-identical (tested), expected bills continue in every period, reminder Tasks are not stopped, Finance Scheduled is not touched. Wording: *Cancellation requested, confirmation pending*; the dialog says Ledger is only recording the request.

## 11. Cancellation confirmation and effective-date behaviour

*Record a cancellation confirmation* (confirmed date, effective date, provider reference, final charge expected/none/unknown with amount, expected refund, access-until) (corrected before commit: a confirmation never changes the stored status, section 25). The preview states what stays, what stops, how many expected bills remain, Task changes and that Finance Scheduled needs separate action. Effective on a later date: confirmed, not ended; expected bills run up to and including the effective day, then stop; the confirmation date is not the effective date (tested with the brief's January 5/8/31 example). Immediate cancellation, confirmation without a request, a provider changing the date (a replacing record) and final bills after the effective date (an extra bill can still be recorded) are tested. Final charges and refunds are notes only: no money is created.

## 12. Withdrawal, reactivation and conflict handling

*Withdraw the cancellation* (owner changed mind / provider did not accept / provider withdrew) and *Reactivated* negate the targeted records and optionally reopen an ended bill. Conflicts detected (each a test, two with the real `SyncEngine`): two confirmations with different effective dates; a withdrawal or reactivation beside a request or confirmation written without seeing it; two prices from one day; a price starting inside another's range; two renewal dates; two trial end dates; two different trial outcomes; unreadable records; one Services arrangement linked from two bills. While a conflict stands the disputed value is not used. *Choose which stands* writes one new record that replaces the others (all kept as history); *Leave as is* records the exact evidence and does not pick a value.

## 13. Post-cancellation payment review

`lifecycleCharges.ts` (pure) and `lifecycleFinance.ts` (one date-range read through the read-only loader). Counted: exact payee matches after the effective date. Listed apart, never counted: weak resemblances, charges the owner linked to another bill (the "same provider, different service" case), charges a refund covers in full, charges within the final charge the owner said to expect. Pending is flagged "may not be final". A payment the owner linked to *this* bill is still listed. Never: dispute, contact, reverse, refund, link, reopen, or conclude the cancellation failed (tests snapshot Finance and the billing-period records around it). Acknowledgement is keyed to the set of charges, so a new charge raises it again.

## 14. Tasks, Today and Calendar coordination

Tasks: effective deadlines drive the planner; one Task per meaning (trial end and cancel-by on one day is one); a recorded request makes no *new* cancel-by or trial Task; a follow-up Task is made only on request and only one at a time; Tasks the owner touched are never removed; a confirmation retires only untouched Bills-made Tasks that no longer stand for anything, previewed, undoable. Today: counts only, from the same list as Overview and Needs review (four new categories: cancellation awaiting confirmation, subscription records that disagree, possible charges after cancellation, Finance scheduled payment still active). Calendar: renewal series, cancellation-effective and price-change markers (titles carry no amount, note or reference; tested by serialising every item), same rolling 12 months, stable ids, no stored events; Select all / Deselect all and the Services 7/14/30/90 filter are untouched (their existing tests pass).

## 15. Household Services association

Implemented (`crossLinks.ts`): preview, one confirmation, an audit record and a guarded Undo in one transaction; duplicate prevention; removable; no matching by name; `householdSpend()` and `billsRecordedPayments()` untouched. **Display is on the Bills page only**: showing it on the Services page is a Services page edit that B0 defers to B5 and the brief forbids broadening, so it is not done (the link row is in the shared table and a later phase can show it). Calendar coordination uses the real link rows (not the audit records) and only for the same kind on the same day. Tests: link and unlink; duplicate prevention (two devices linking at once leave one relationship, one unlink clears both rows); two-device sync; backup and restore; guarded Undo (refuses after a change and never duplicates); identical versus different marker purposes; visits never hidden; Services record byte-identical; Finance identical.

## 16. Finance non-mutation and payment-integrity evidence

Tests snapshot every Finance table (and the billing-period records) around: a request, a confirmation with final-charge and refund notes, a price change, a trial with prices, trial-to-paid, linking a Household Services arrangement, building every Calendar marker, loading the review items and noticing a price difference. Nothing changes. Expected amounts never become payments, a renewal is not payment evidence, a cancellation is not a refund, a price change does not alter a recorded invoice or Finance transaction, confirmed links remain live references (a payment link added on one device survives a cancellation recorded on the other), typed-versus-Finance precedence and whole/split deduplication are untouched (the B3 and B3.1 tests pass unchanged), and no code in the new files writes a Finance table, a Scheduled rule, a payment link or a Calendar event (guards).

## 17. Two-device sync and backup tests

Real `SyncEngine`, two devices, Finance synced too: trial extension on one device and a converted outcome on the other (both kept, no conflict); different prices for one day (both survive, unknown, review item on both, settled once on one device); different future steps (both applied in order); two confirmations with different effective dates (neither used, bills keep being expected, review item on both) and with the same date (one cancellation, no conflict); a withdrawal seen-the-request versus an unseen confirmation (conflict) and the same sequence when everything was seen (plain history); a cancellation with a new invoice (the final invoice's period still shows); a cancellation with a payment link (the link survives and counts); a bill ended while a Scheduled payment is live (review item on the other device, Finance untouched); link and unlink, offline double link, two bills on one arrangement, a link to an arrangement not on this device, Undo after a remote change. Backup: a real export, restore and summary (records, links and the derived state restore exactly; the summary counts them without naming anything); unknown fields and an unknown record type survive. **Older build (B3.1):** it reads only `obligation`, `cycle` and `discovery`, so it never reads or converts lifecycle records, keeps them through sync and backup, and an unrelated edit leaves them untouched (tested by simulating the older reader from its source queries; **I have not run a real older build**). Limitation: an older build does not know the confirmed cancellation date, so it keeps showing expected bills after it until updated, and does not draw the new markers. Nothing is lost.

## 18. Guarded Undo and rollback testing

Every action returns an Undo that refuses, writing nothing, if any row it touched changed (including by another device). A stale preview refuses and writes nothing (another action, or an edit of the bill, in between). A failure injected after the writes (a test seam, `afterWrite`) rolls back everything: no record, no Task, the bill unchanged. Linking and unlinking roll back the same way; Undo of an unlink refuses if the relationship was re-created.

## 19. Mutation-testing results

Script: `scripts/bills-b4-mutation-check.cjs`. For each entry the production source is deliberately broken, the B4 tests plus the Bills guard tests and the B2 tests are run, and the file is restored (the run restored every file; a later full run is green). **27 of 27 mutations were CAUGHT; none survived; none failed to apply.** Entries map to the brief's list: confirmation treated as request (C2), request treated as confirmation (C1), effective date ignored (C3, C4), overlapping price silently selected (P1, P2), old invoice overwritten by a new price (P4), cancellation hiding a posted payment (H1), post-cancellation charge not reported (A1), renewal falsely marked confirmed (R1, R2), Task duplicated (T1, T2), Calendar marker removed incorrectly (K1), Finance Scheduled modified (W3), unknown fact discarded (W1); the rest cover conflicts, unknown prices, stale previews, derived data written into the bill, and Undo duplicating a link. **Honest note:** my first list of 26 missed "cancellation hiding a posted payment"; I noticed when checking against the brief and added H1 afterwards (run alone; it is caught).

| Mutation | Result | What the break would have meant |
|---|---|---|
| C1 a request alone sets the cancellation date | CAUGHT (5 tests failed, 2 files failed) | a request would stop expected bills as if the provider had confirmed |
| C2 a confirmation is not shown as a confirmation | CAUGHT (2 tests failed, 1 files failed) | a confirmed cancellation would read as a mere request or nothing |
| C3 the effective date is ignored by the expected-dates reader | CAUGHT (3 tests failed, 3 files failed) | bills would keep being expected after a confirmed cancellation |
| C4 the confirmation date is used instead of the effective date | CAUGHT (3 tests failed, 2 files failed) | service would be treated as ending the day the provider replied |
| C5 two different effective dates are not flagged | CAUGHT (5 tests failed, 3 files failed) | one of two disagreeing dates would be used silently |
| C6 a withdrawal does not negate what it targets | CAUGHT (6 tests failed, 3 files failed) | a withdrawn cancellation would still stop expected bills |
| C7 a withdrawal and an unseen confirmation are not flagged | CAUGHT (2 tests failed, 2 files failed) | a withdrawal and a confirmation from devices that did not see each other would be silently ordered |
| C8 a "replacement" with an earlier id counts | CAUGHT (1 tests failed, 1 files failed) | two records could replace each other and both vanish |
| P1 two prices from one day: one is silently chosen | CAUGHT (3 tests failed, 2 files failed) | a disputed price would be used as if it were agreed |
| P2 an overlapping price is silently used | CAUGHT (1 tests failed, 1 files failed) | a price starting inside another price's range would win silently |
| P3 an unknown price becomes zero | CAUGHT (9 tests failed, 3 files failed) | an unknown price would be shown as free |
| P4 a recorded invoice is overwritten by the expected price | CAUGHT (15 tests failed, 6 files failed) | a new price would change what an old bill says |
| P5 after an explicit end date the old price carries on | CAUGHT (1 tests failed, 1 files failed) | a price with an end date would be carried forward as if it had none |
| R1 a passed renewal date is treated as handled | CAUGHT (1 tests failed, 1 files failed) | an unconfirmed renewal would stop asking, as if it had been confirmed |
| R2 the renewal review item never appears | CAUGHT (1 tests failed, 1 files failed) | a renewal that may not have happened would never be raised |
| T1 a second follow-up Task is made while one is open | CAUGHT (1 tests failed, 1 files failed) | recording two requests would pile up Tasks |
| T2 a trial that ends on the cancel-by day makes two Tasks | CAUGHT (2 tests failed, 2 files failed) | one action would get two reminders |
| K1 a Bills marker is hidden for any kind of Services date | CAUGHT (2 tests failed, 1 files failed) | a trial or other marker could be left out because of a Services link |
| A1 a charge after the cancellation is not reported | CAUGHT (9 tests failed, 2 files failed) | a possible charge after cancellation would go unnoticed |
| A2 a refund of the wrong size offsets a charge | CAUGHT (1 tests failed, 1 files failed) | a small refund would hide a larger charge |
| A3 a charge before the effective date is counted | CAUGHT (1 tests failed, 1 files failed) | ordinary payments before the cancellation would be flagged |
| W1 an unreadable lifecycle record is dropped on read | CAUGHT (1 tests failed, 1 files failed) | a record from a newer version would vanish from view |
| W2 a stale preview is applied | CAUGHT (2 tests failed, 1 files failed) | a decision made on out-of-date evidence would be written |
| W3 an action writes to a Finance Scheduled rule | CAUGHT (67 tests failed, 7 files failed) | Finance would be changed by a lifecycle record |
| W4 the lifecycle view is written into the bill | CAUGHT (1 tests failed, 1 files failed) | derived evidence would be copied into the whole-record last-writer-wins bill |
| U1 Undo of an unlink restores a duplicate link | CAUGHT (1 tests failed, 1 files failed) | Undo would duplicate a relationship someone re-created |
| H1 a cancellation hides a period that holds a recorded bill or payment | CAUGHT (2 tests failed, 1 files failed) | a final invoice or posted payment after the effective date would disappear from view |

## 20. Browser acceptance evidence

**What was run (and what was not).** The Browser pane's own `localhost:5173` database already held data I did not create (2 accounts, 34 transactions, 12 module records), so I **did not touch it**. I started a second dev server on `localhost:5174` (a different origin, so a separate, empty database), confirmed it was empty, and seeded **invented data only** (two bills, one Household Services arrangement, two transactions) by direct IndexedDB writes. Every lifecycle action was then done through the **real dialogs** (field values set by script, buttons pressed by script; not a human typing). Both extra servers were stopped afterwards; the invented data stays in that pane origin and is inert.

| Journey | Result |
|---|---|
| **A. Trial to subscription** | Recorded a trial (Nov 10 to Nov 24, automatic conversion, $14.99 after, must cancel by Nov 22) with prices. The card showed "In trial until 2026-11-24" and the trial facts; History listed the start, the zero-price step, the end and the price after, the future ones marked *expected*; ONE Task ("Cancel or give notice by the deadline", dated Nov 19 because the reminder is 3 days before) and no duplicate trial Task. Extended the trial to Dec 8: the old end date appeared as "replaced by a later record", the Task moved to "Trial ends" (Dec 5) instead of a second one being made. Calendar: "Trial ends" Task (high) on Dec 5 and the Bills marker (medium) on Dec 8 as separate things. **The browser found a real flaw here (the extension had dropped the trial's details from the card); it is fixed and has a test.** |
| **B. Price change** | Recorded $17.99 from Jan 1, 2027. The preview said "+$3.00 per bill", "12 expected bills change ... about +$36.00" and warned that Jan 1 is not a billing date (the extra-bill note). Price history then listed the first price, the trial steps and the new one, each with its source and a Correct link; the "next price change" and the Calendar "Price change" markers appeared with no amount in the title. |
| **C. Cancellation** | Recorded a request (follow-up Task ticked): chip "Cancellation requested, confirmation pending", the bill stayed Active, every expected date continued. Recorded a confirmation effective Dec 31: chip "Cancellation confirmed, effective 2026-12-31"; the preview said the untouched follow-up Task would be removed, how many expected bills stay and stop, and that Finance does not change; after saving, "Next expected dates" stopped after Dec 12, the status was still **Active**, History showed request, confirmation and the effective date marked expected. |
| **D. Charge after cancellation** | Used "Provider changed the date" to move the effective date to Oct 1 (an invented cleared $17.99 transaction on Oct 12 is after it). The card listed "Possible charges after the cancellation" with the cautious wording; Needs review showed it with Open the bill and Leave as is; Today showed "1 subscription has possible charges after cancellation" with no name or amount. No payment link, dispute or Finance change was made, and the replaced confirmation stayed in History. |
| **E. Renewal** | Recorded an annual renewal Apr 15, 2027, "I have to renew it", 30 days notice: facts showed the renewal and the cancel-by Mar 16; THREE distinct open Tasks (trial end, cancel-by Mar 13, renewal Apr 12); the April 2027 Calendar showed "Renewal expected: Cinemax Plus" on the 15th. |
| **F. Household Services** | Linked the bill to the arrangement (preview text, "Link them"). With the same notice date (Mar 16) and renewal date (Apr 15) on both, the Bills markers were left out of the Calendar while "Notice deadline: House cleaners" and "Renewal: House cleaners" stayed; the bill's own Tasks stayed. (No service visits existed in this invented data; visits not being hidden is tested in `b4-calendar.test.ts`.) |

**UI checks.** 375px: no horizontal overflow on the bill page or in five dialogs (price, trial, renewal, confirmation, withdrawal; dialogs 351px wide). Escape closed all five (a synthetic Escape key event, **not a real keyboard walk**). Dark mode at 375px: two screenshots reviewed, text and chips readable. Hide Amounts on: **no dollar figure** on the card, the price history, History, the charges list, any dialog or the Calendar (the charges list showed `$••••`). Calendar: Select all / Deselect all went from 7 of 7 to 0 of 7 and back. Household Services Upcoming: the 7 / 14 / 30 / 90 day buttons are present (their behaviour is covered by its existing tests; I did not click through them). An ordinary utility bill shows only a collapsed "Subscription tools" line. The pane console held two dev-server hot-reload messages ("Module today is registered twice") timestamped from when I edited source files while a page was open; they are a Vite hot-reload artefact, and the app worked normally after reloads.

**NOT done:** a real keyboard Tab walk, a screen-reader pass, a real phone or two physical devices, a light-mode screenshot review, and a real older (B3.1) build. Screenshots reviewed: two (dark, 375px); everything else was checked by reading the page text and structure.

## 21. Privacy, accessibility, performance findings and final automated results

| Check | Result |
|---|---|
| `npm test` | **3,141 tests pass in 170 files** at the time of section 1 to 24 (baseline 2,973 in 164); **3,169 in 172 files after the pre-commit correction** (section 25) |
| `npx tsc --noEmit` | clean |
| `npm run build` | succeeds (the existing chunk-size warning only) |
| `git diff --check` | no whitespace errors (only the usual "LF will be replaced by CRLF" notes) |
| Existing Finance, Scheduled, Transactions and imports, Tasks, Calendar, Household Services, Home & Assets, Projects, Sync and backup, Global Settings and Hide Amounts tests | all pass; the only edit to an existing test file is the one allow-list string in `b31-guards.test.ts` |
| Schema | Dexie version 15, 40 tables (pinned by `b4-guards.test.ts`); no migration |
| Dependencies | unchanged (pinned) |
| Network, timers, browser storage in the new files | none (guard) |

**Privacy.** Stored beyond what Bills already stored: lifecycle records holding dates, whole-cent amounts the owner typed, a method word, a short reference (at most 40 characters, with the warning "not an account number"), short notes (at most 200 characters) and ids. No account number, card number, password or access code field exists (a guard); no real data is in code, tests or docs (all names and amounts are invented); Calendar titles carry the bill's own title and a short word only, never an amount, note or reference (a test serialises every item); Today shows counts only; Hide Amounts is respected in every new view and dialog (browser check above, plus `Hide Amounts` unit tests that run the preview through a masking function).
**Accessibility (what was and was not checked).** Native buttons, inputs, `select`, `fieldset`/`legend`, `details`; named dialogs with the shared Modal's focus handling and Escape; `role="status"` and `role="alert"` for notices and refusals; state is never colour alone (each state has words). **Not** checked with a real screen reader or a real Tab walk.
**Performance.** No dedicated B4 performance test was written. The lifecycle loader is one indexed read of the `lifecycle` rows per load (filtered per bill in memory; a bill has tens of records at most); the Finance checks read one date range of transactions only when some bill has a past cancellation date, plus one small links read; discovery and matching are unchanged. The whole suite still runs in about 40 seconds.

## 22. Known limitations and owner decisions

**Known limitations:** real-device, two-physical-device, offline, older-real-build, screen-reader and Tab-walk acceptance are NOT done (browser-pane checks and `SyncEngine` simulations only). Older (B3.1) builds do not know a confirmed cancellation date (section 17). A replacement counts only when its id is later than what it replaces: a device whose clock is far behind could record a correction that reads as a disagreement (safe direction: it is shown, not hidden). A price lower than expected is not noticed from Finance (section 5 judgment call 6). Charges after a cancellation look at the 400 days after it. Payee matching is the B3.1 word-based matcher, so a different service from the same provider cannot be told apart by name (the owner linking it to its own bill, or leaving it as is, is the answer). The Household Services link is shown on the Bills page only. The "also mark ended" choice was removed before commit (section 25). Trial/renewal passed-date items age out after 60 days. Services pages, B5 combined totals and B3.2 are untouched.

**Owner decisions (new; each has a recommended default already in place):**
- **O-13.** Should a cancellation request with no confirmation become a review item after 7 days? (Recommended: yes; one constant.)
- **O-14 (withdrawn before commit).** There is no "also mark ended" action any more; a confirmation never changes the stored status (section 25).
- **O-15.** Should charges after a cancellation be looked for for 400 days after it? (Recommended: yes.)
- **O-16.** Should the Household Services link also be shown on the Services page, in B5? (Recommended: yes, as a small read-only card.)
- **O-17.** Should a price lower than expected also be noticed from Finance? (Recommended: not yet; it is indistinguishable from a partial payment.)

## 23. B5 prerequisites

B5 (consolidated Overview, commitments, the three-module recorded-payments figure) can reuse the effective-price reader (`lc.prices`), the lifecycle view for "what stopping would change" (`cutoffOn`), the Services link rows, and the unchanged `householdSpend`/`billsRecordedPayments`. It still needs its own golden-master-gated union function; B4 changed no total. The Services page card for the `bills-for` link, the optional B3.2 and the not-built B0 items in section 5 deviation 7 remain.

## 24. Exact final Git status

```text
$ git rev-parse HEAD origin/main
f2db2a782b8646a52fbf8b8d8620772c52df8e29
f2db2a782b8646a52fbf8b8d8620772c52df8e29

$ git status --short      (nothing staged)
Modified (20): README.md, docs/BACKLOG.md, docs/CHATGPT-HANDOFF.md, docs/due-provider.md, docs/module-hooks.md, src/lib/backupSummary.ts,
  src/modules/bills/: ObligationPage.tsx, OverviewPage.tsx, ReviewPage.tsx, b31-guards.test.ts, bills.css, billsTestkit.ts, data.ts,
  dueProvider.ts, model.ts, readModel.ts, tasks.ts, todayCards.tsx, undo.ts, views.ts
Untracked (18): docs/BILLS-SUBSCRIPTIONS-B4-REPORT-2026-11-07.md, scripts/bills-b4-mutation-check.cjs,
  src/modules/bills/: LifecycleCard.tsx, LifecycleDialogs.tsx, crossLinks.ts, lifecycleCharges.ts, lifecycleData.ts, lifecycleFinance.ts,
  lifecycleModel.ts, lifecycleRead.ts, lifecycleState.ts, priceEvidence.ts, b4-calendar.test.ts, b4-data.test.ts, b4-guards.test.ts,
  b4-model.test.ts, b4-sync.test.ts, b4price.test.ts
```

**Handoff, backlog, README, module-hooks and due-provider docs were updated** in this batch. They state: B3.1 committed and deployed (`f2db2a7`, run #72 success); B4 built and tested locally and **not** committed, staged, pushed or deployed; B5 and B3.2 not started; physical-device and remaining accessibility acceptance outstanding. Unknown: how B4 behaves on a real phone, a real older build, and with a screen reader. Nothing was staged, committed, pushed or deployed. **B4 is ready for independent review** (an explicit go-ahead from the owner is needed before any commit).

## 25. PRE-COMMIT CORRECTION (after ChatGPT's "APPROVED WITH FOLLOW-UPS, DO NOT COMMIT YET")

Status of this section: written 2026-11-08. Still **NOT staged, NOT committed, NOT pushed, NOT deployed.** B5 and B3.2 not started. Nothing in sections 1 to 24 above was rewritten except where it described the removed checkbox; those few sentences now say "(corrected before commit; see section 25)".

### 25.1 Future-dated cancellation versus Ended status

**The original behaviour (reproduced with a real database before changing anything).** The confirmation dialog had a checkbox "Also mark this bill as ended on the effective date". Ticked, it ran the B1 End rule at once. For a cancellation confirmed on Jan 8 and effective Jan 31 that produced, on Jan 8: stored status **Ended** with `endedOn` Jan 31; the card and header chip read only "Ended" (the "confirmed, effective Jan 31" state was hidden); the Calendar's "Cancellation effective" marker and every other deadline marker disappeared (the layer skips ended bills); the untouched reminder Tasks were retired; and the Today and Overview counts treated the bill as ended. Expected periods were still produced up to Jan 31 (B1's End keeps them), so no billing occurrence was lost, but the current-state display was premature and misleading. Unticked (the default) the behaviour was already correct.

**The correction (the preferred one).** The "also mark ended" action is **removed entirely** (field `markEnded`, checkbox, preview line, code path). A confirmation now records evidence only: it never writes the bill record (a test compares the stored row byte for byte), the stored B1 status is untouched, and the effective date alone decides what is expected through the existing B4 cutoff. Ending the bill is the owner's separate, existing **End** workflow with its own preview. To make that easy, once the effective date has arrived and the bill is still active, the card shows **Mark it ended…**, which opens the existing End dialog with the effective date prefilled (the owner can change it). No timer, background job or automatic status change was added.

**Exact behaviour after the correction** (each line is a test in `b4-boundary.test.ts`; example: confirmed Jan 8, effective Jan 31, monthly bill on the 31st):
- Jan 8 to Jan 30: *Cancellation confirmed, effective 2027-01-31*; stored status Active; header chip and card agree.
- **Jan 31 (effective date equal to today): *Cancellation effective***; the date itself is still covered, so the Jan 31 period is expected; Feb 28 and later are not. (A mutation that made the boundary exclusive is caught.)
- After Jan 31: still *Cancellation effective* and still Active until the owner ends it; the card offers **Mark it ended…**; no new Task or marker is created for dates after it.
- Historical periods stay visible; a final invoice in a later period (and an extra partial bill) can still be recorded and stays visible, open, and not "expected".
- Immediate cancellation (confirmed and effective the same day): effective that day.
- Withdrawn: expected bills resume, state returns to plain Active. Replaced by a later effective date: the cutoff moves and the earlier date no longer makes it "effective". Reactivated: negated, billing resumes. (All history stays.)
- The owner's own B1 End *before* a confirmation governs (its end date wins; the later confirmation changes no status); an End *after* a confirmation is separate and consistent (Ended, with the owner's end date).
- Reminder Tasks: a deadline before the effective date keeps its Task; one after it is retired only if Bills made it and nobody changed it (previewed, with Undo); an owner-edited Task is never removed; a withdrawn confirmation brings the Task back; nothing is created for dates after the cutoff.
- Today, Overview, Needs review and the Calendar come from one list: no attention item while it is merely confirmed; the Calendar's effective-date marker is *open* until the day then *handled*; a charge dated after the date appears in all of them as the same single "possible charges" item.
- Finance Scheduled: unchanged by a confirmation (snapshot identical), its own approval markers are exactly as before, and once the date has passed the still-active instruction is a review item (`scheduledAfterEnd`) while nothing there is touched.
- Two-device conflicting confirmations, withdrawal versus an unseen confirmation, and guarded Undo after a remote change are covered by the existing `b4-sync.test.ts` and `b4-data.test.ts` tests, which still pass; the rollback and Undo tests that used the checkbox now use a plain confirmation.

**A second defect found while testing this (and fixed).** The Finance reads for these checks took their "today" from the real clock while the screens use the app's `today`, so a simulated or midnight-adjacent day could disagree (a rule linked to a bill whose cancellation had just taken effect was not read). The loader now reads the window after each cancellation date and every linked rule of bills that were ended or have a confirmed date **without consulting the clock**; the pure checks (`afterFor`, `scheduledAfterEnd`) apply `today`. A test with a simulated date caught it.

**Browser check.** On an isolated pane origin (invented data): the confirmation dialog has no checkbox and says "The bill's status is not changed ... until you choose End yourself"; with an effective date in the past the chip reads "Cancellation effective", the status stays Active, and **Mark it ended…** opens the End dialog with the date prefilled ("End \"Streamly Premium\" on 2026-10-01. Reason: cancelled."); Escape closed it without ending anything.

### 25.2 Shared-link write guard

**Inspection.** Every place Bills touches the shared `links` table: `crossLinks.ts` (creates and soft-deletes the `bills-for` link, inside the transaction that also writes the audit record), `undo.ts` (removes links its recorder noted as added, restores links it noted as removed, after fingerprint checks, refusing a duplicate), `tasks.ts` (only *reads* a Task's link after the Tasks API made it, to record it for Undo), `data.ts` (a read-only `linkedTo` when deciding whether a bill may be deleted), `cycleData.ts` and `data.ts` (the table listed in a transaction scope). The Task `about` links are made only by the Tasks API. The Scheduled-rule association stays an obligation field (`scheduledRuleIds`), not a link.

**What changed.**
1. `crossLinks.ts` gained `assertBillsLink`, called before the only write: anything but type `bills-for` from `obligation:<n>` to `arrangement:<n>` (another type, another module, a malformed id) throws and the transaction writes nothing.
2. New `b4-links.test.ts` (11 tests), **behavioural first**: a battery of every kind of Bills action (Tasks, trial, renewal, request with follow-up, confirmation, billing facts, the Scheduled pointer, link, unlink, Undo, restore) against a real database, then an **audit of every live link that touches Bills**: only Task `about` and `bills-for` exist. Negative tests: an audit flags a rogue `serves`, a `bills-for` to a visit row and an `involves` link inserted directly; the writer rejects seven bad shapes; linking to a Services *visit*, an asset or a missing id is refused; a failure after the writes leaves no link and no audit record.
3. **Targeted source restriction instead of blanket text matching:** only five files may reference the table at all (`crossLinks`, `undo`, `tasks`, `data`, `cycleData`), only `crossLinks` and `undo` may wrap it in a repository, no file may alias it, no file may call a write method on it, the one writer calls the assertion first and writes once, and a meta-test proves the patterns catch other spellings (a differently named handle, a wrapper variable, an alias, the shared store) while ignoring a harmless property called `links`.
4. The earlier B3.1 guards are unchanged. The Scheduled-rule association is explicitly protected as allowed.

### 25.3 B2 and B4 deadline coexistence (no code change was needed)

Tested in `b4-boundary.test.ts` (numbers are the review's): 1 the same trial end in B2 and B4 gives one Task and one marker; 2 the same cancel-by gives one notice Task; 3 trial end and notice on one day give one Task and no second marker; 4 a trial extended after its reminder exists moves the untouched Task (same Task id, new date), and an owner-moved Task is left exactly as the owner set it, not duplicated, not removed (it is reported as "a reminder Task to check"); 5 a renewal date change moves the one Task; 6 a confirmed cancellation removes the expected renewal marker and Task and stores no future Task or Calendar record; 7 a withdrawn confirmation brings the Task back; 8 an owner-edited Task is never removed (tested for the notice, trial and confirmation cases); 9 a linked Household Services marker covers only the Bills marker of the same kind and day, the Bills Tasks are unchanged (and visits are covered by `b4-calendar.test.ts`); 10 Finance Scheduled's approval markers are identical before and after a confirmation. Reminder action dates stay separate from deadlines (the Task is dated three days before; the marker stays on the real date), the rolling 12-month derived horizon is unchanged and at most a handful of Tasks ever exist.

### 25.4 Broader integrity (reconfirmed, nothing weakened)

A request is not a confirmation, and the confirmation date is not the effective date (`b4-model` and `b4-boundary`); a price never changes a recorded invoice and an unknown price is never zero (`b4-model`, `b4-data`); disputed evidence is never silently chosen (`b4-model`, `b4-sync`); linked Finance payments remain live references; no Finance or Scheduled write (snapshots), no Services spending change, no Bills spending-union change; backup and the real `SyncEngine` simulations still pass; Dexie 15 with 40 tables and the dependencies are pinned and unchanged.

### 25.5 Tests, mutation checks and final totals

- **New tests:** `b4-boundary.test.ts` 17 and `b4-links.test.ts` 11 (28 in all). Existing tests changed: the ones that used the removed checkbox (`b4-data`, `b4-sync`, `b4-calendar`, plus the `b4-guards` rule about who may change a bill record, now "a confirmation can never end a bill; only withdrawal or reactivation may reopen"); no regression test was weakened or removed, and the earlier B3.1 guards are unchanged.
- **Mutation checks added (all CAUGHT):** E1 (the effective day itself is not yet "effective"), E2 (an owner-edited Task treated as untouched and removed), L1 (the link writer stops checking what it writes). With the earlier 27 that is **30 of 30 caught**. (The earlier mutation run's fixed list still names the removed behaviour nowhere.)
- **Final totals:** `npm test` **3,169 tests pass in 172 files** (3,141 in 170 before this correction; baseline 2,973 in 164). `npx tsc --noEmit` clean. `npm run build` succeeds (the usual chunk-size warning). `git diff --check` clean (only LF/CRLF notes).
- **Honest note on timing flakiness (and the one config change it caused):** with the extra two-device sync tests the whole suite got heavy enough that, in about 5 of 12 full runs, a SyncEngine test or an old exhaustive sweep (`b2-sync`, `b3-sync`, `b4-sync`, `schedule-identity`; each passes alone in 1 to 2 s) exceeded vitest's default 5 s limit, which would also turn the GitHub deploy check red. I raised the default `testTimeout` to 30 s in `vite.config.ts` (one line; no assertion changed, no test edited). Four consecutive full runs afterwards: 3,169 of 3,169 pass each time.

### 25.6 Files modified in this correction

Source: `lifecycleData.ts` (removed `markEnded`), `LifecycleDialogs.tsx` (checkbox removed), `LifecycleCard.tsx` ("Mark it ended…" and the clock-independent after-cancel call), `Dialogs.tsx` (optional `initialDate` on the existing End dialog), `lifecycleFinance.ts` (clock-independent read; `afterFor`), `readModel.ts` (uses `afterFor`), `crossLinks.ts` (`assertBillsLink`). Tests: `b4-boundary.test.ts` and `b4-links.test.ts` (new); `b4-data`, `b4-sync`, `b4-calendar`, `b4-guards` (adjusted as above). Script: `scripts/bills-b4-mutation-check.cjs` (+3 entries). Config: `vite.config.ts` (`testTimeout: 30_000`, see 25.5). Docs: this report, `docs/CHATGPT-HANDOFF.md`, `docs/BACKLOG.md`. **Not touched:** Finance, the sync engine, the database schema, dependencies, Services, Tasks, Calendar modules, `merge.ts`, `backup.ts`.

### 25.7 Remaining limitations

Unchanged from section 22 apart from: the "also mark ended" limitation and owner decision **O-14 are withdrawn** (there is no such action). Still true: no real device, screen-reader, real Tab walk or real older-build acceptance; the Household Services link shows on the Bills page only; the B1 End workflow itself (unchanged) can still be given a future date and then shows the bill as Ended from that moment, which is B1's existing, separately previewed behaviour and was deliberately not changed; a lower-than-expected payment is not noticed from Finance.

### 25.8 Exact Git status

```text
$ git rev-parse HEAD origin/main
f2db2a782b8646a52fbf8b8d8620772c52df8e29
f2db2a782b8646a52fbf8b8d8620772c52df8e29

$ git status --short      (nothing staged)
Modified (22): README.md, vite.config.ts, docs/BACKLOG.md, docs/CHATGPT-HANDOFF.md, docs/due-provider.md, docs/module-hooks.md, src/lib/backupSummary.ts,
  src/modules/bills/: Dialogs.tsx, ObligationPage.tsx, OverviewPage.tsx, ReviewPage.tsx, b31-guards.test.ts, bills.css, billsTestkit.ts,
  data.ts, dueProvider.ts, model.ts, readModel.ts, tasks.ts, todayCards.tsx, undo.ts, views.ts
Untracked (20): docs/BILLS-SUBSCRIPTIONS-B4-REPORT-2026-11-07.md, scripts/bills-b4-mutation-check.cjs,
  src/modules/bills/: LifecycleCard.tsx, LifecycleDialogs.tsx, crossLinks.ts, lifecycleCharges.ts, lifecycleData.ts, lifecycleFinance.ts,
  lifecycleModel.ts, lifecycleRead.ts, lifecycleState.ts, priceEvidence.ts, b4-boundary.test.ts, b4-calendar.test.ts, b4-data.test.ts,
  b4-guards.test.ts, b4-links.test.ts, b4-model.test.ts, b4-sync.test.ts, b4price.test.ts
```

The handoff and backlog were updated (below the B4 entries, a "pre-commit correction" paragraph; the "also mark ended" wording and decision O-14 withdrawn; totals 3,169 in 172 files). Nothing was staged, committed, pushed or deployed. **B4 is ready for a second independent review.**
