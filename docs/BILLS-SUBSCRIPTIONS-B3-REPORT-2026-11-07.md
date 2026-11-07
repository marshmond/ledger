# Bills & Subscriptions B3: Finance payment links, with the two usability enhancements (B3.0A, B3.0B). Implementation report

Date: 2026-11-07. **RELEASE NOTE (ChatGPT verdict after section 23: APPROVED TO COMMIT/PUSH; committed as the B3 release commit; the commit SHA and the Pages result are recorded in the release report, not here, to avoid a second commit). Section 23 SUPERSEDES earlier status statements in this document: the Home Hide Amounts gap (sections 7 and 20, O-3) and the 3.6:1 chip contrast (section 18) are RESOLVED or were measurement errors, and the paid-in-full discrepancy now has a review pathway.** Original status text, written before the commit: built and tested locally, not staged, not committed, not pushed, not deployed, not acceptance-tested on a real device (still true of real-device, phone-calendar and screen-reader acceptance). B3.1, B4 and B5 were not started.

## 1. Executive summary (plain English)

Three things were asked for, and all three are built.

1. **Household Services "Upcoming" window (B3.0A).** The Upcoming card on the Household Services Overview now lets you choose how far ahead to look: 7, 14, 30 or 90 days (30 is the default, and your choice is remembered on this device). It changes only that list. The Calendar still shows 12 months of expected visits, the "one actionable Task per arrangement" rule is untouched, and no Task or event is written when you change it. If more visits match than the first ten rows, the card says "Showing 10 of 13 visits in the next 90 days" and a **Show all** button lists every one, so nothing is cut silently.
2. **Calendar "Select all / Deselect all" (B3.0B).** The Calendar's calendar chips now have **Select all** and **Deselect all** beside them, and a line saying "N of 7 calendars shown". After Deselect all you can switch on just Personal. The choice is remembered, a calendar added later appears by itself only while everything is on (it never disturbs a "Personal only" choice), and an empty Calendar is a valid state with a plain explanation. It changes only what the screen draws; nothing is stored in the database.
3. **Finance Hide Amounts correction (B3.0B).** The Finance Calendar layer used to show "Example Rent $1,200.00" even with Hide Amounts on. With Hide Amounts on it now shows "Example Rent" (and any other Finance amount as the usual masked figure). The Calendar *file* you can export is a separate, deliberate action and still contains the amounts (documented, with a warning in the export dialog; whether exports need their own privacy choice is an owner decision).
4. **B3: linking real Finance payments to bills.** On a billing period you choose **Link a Finance payment**, pick an existing Finance transaction (or one part of a split), read what will happen, and confirm. Ledger stores a *reference*, never a copy: amounts, dates and Finance's own status (pending, cleared, reconciled) are read live every time. Several payments can be linked to one period; a refund lowers what is recorded; a deleted, restructured or reversed payment is kept, counts for nothing, and is flagged for review. You can **replace** or **remove** a link (previewed, with Undo), and **replace a typed "paid outside Finance" payment with a Finance payment** (explicit confirmation; the typed payment stays in the history and is never counted twice). Bills never writes to Finance: no transaction is created, edited, cleared, reconciled or posted, and no scheduled item is touched. A read-only **Payment history** on each bill shows every period. Today and the Overview report stale, changed, partly paid, unseen-autopay, typed-versus-Finance and duplicate-payment situations as counts only.

Nothing was committed or deployed. No table, migration, dependency, sync rule or backup format changed.

## 2. Verified B2 commit and successful deployment (the gate)

| Check | Result |
|---|---|
| Repository and remote | the local `finance-app/` folder; `origin` = `https://github.com/marshmond/ledger.git` |
| Branch | `main` |
| `HEAD` equals `origin/main` (after `git fetch`) | yes: `aca220865f5f0bf241e713081a404aab4961490e` (`feat(bills): B2 billing cycles, reminders and calendar integration`) |
| B2 on `origin/main` | yes (it is `HEAD`) |
| Matching Pages run | "Deploy to GitHub Pages" run **#70**, `completed` / `success` (public Actions API; the `gh` CLI is not installed) |
| Working tree at the start | clean (`git status --short` empty) |
| Unrelated or unreviewed commits | none (HEAD is the B2 commit; the commit before is B1 `3bcf3a3`) |
| Baseline | **2,609 passing tests in 147 files** (re-run, not assumed) |

## 3. Baseline and final test counts

Baseline **2,609 tests in 147 files** (re-run, not assumed). Final **2,761 tests in 154 files** (152 new tests in 7 new test files: Bills state 43, data 26, sync and backup 14, spend and boundaries 24; Calendar visibility 19; Finance Hide Amounts 6; Services window 20). `npx tsc --noEmit`, `npm run build` and `git diff --check` results are in section 19.

## 4. Files added and modified

**Added (source):** `src/modules/bills/payments.ts` (pure Finance-payment derivation), `paymentLinks.ts` (confirmation rules and words), `billsSpend.ts` (Bills-only recorded payments for B5), `PaymentUI.tsx` (link dialog, payment list), `PaymentHistoryCard.tsx` (read-only history); `src/modules/calendar/layerVisibility.ts` (pure visibility rules); `src/modules/services/upcomingWindow.ts` (window choice and preference).
**Added (tests, 8 files):** `bills/b3-state.test.ts`, `b3-data.test.ts`, `b3-sync.test.ts`, `b3-spend.test.ts`; `calendar/layerVisibility.test.ts`; `ledger/dueProviderHide.test.ts`; `services/b30a-upcoming.test.ts`. **Added (script):** `scripts/bills-b3-mutation-check.cjs`.
**Modified (source):** Bills `cycleModel.ts` (the `payment-link` fact), `amounts.ts`, `labels.ts`, `periods.ts`, `cycleConflicts.ts`, `cycleRepair.ts` (one case, and two preview sentences now say "Nothing in Finance is changed" because Finance is read for the reminder plan), `ReviewPage.tsx` (the five new payment groups), `cycleData.ts`, `tasks.ts`, `data.ts`, `contractData.ts`, `readModel.ts`, `dueProvider.ts`, `todayCards.tsx`, `OverviewPage.tsx`, `PeriodsCard.tsx`, `PeriodParts.tsx`, `CycleDialogs.tsx`, `RepairDialogs.tsx`, `ObligationPage.tsx`, `bills.css`; Calendar `useCalendarData.ts`, `CalendarPage.tsx`, `dialogs.tsx`, `ics.ts`, `calendar.css`; Finance `modules/ledger/dueProvider.ts`; shared `core/dueProvider.ts` (two optional fields) and `modules/today/layout.ts` (`loadHideAmounts` no longer throws where there is no storage); Services `servicesOverview.ts`, `OverviewPage.tsx`, `OverviewParts.tsx`.
**Modified (tests):** `services/s5-overview.test.ts` (the 60-day assertion became the new 30-day default: an intended behaviour change, not a weakened check) and three B2 Bills tests that used `payment-link` as their example of "a fact type this build does not know" (now `suggestion-reject`, which still is unknown). No assertion was removed.
**Modified (docs):** `README.md`, `docs/module-hooks.md`, `docs/due-provider.md`, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`.
**Not touched:** `src/db.ts`, `merge.ts`, `backup.ts`, `src/types.ts`, the sync engine, `assets/spending.ts` (`spend()`), `lib/txnRef.ts`, `lib/costSource.ts`, `lib/txnLookup.ts`, `ui/TxnRefs.tsx` (the shared picker), `services/householdSpend.ts`, any Finance engine, the Tasks engine.

## 5. B3.0A: Household Services Upcoming window

- **What changed.** `buildServicesOverview` takes `upcomingDays` (7, 14, 30 or 90, default 30) and builds the Upcoming list for exactly that window; the old fixed 60 days (and the fixed 10-row cut inside the reader) are gone. The page keeps the choice in `localStorage` (`services-upcoming-days`), through `loadUpcomingDays` / `saveUpcomingDays` (invalid or unavailable storage gives 30).
- **Boundary.** "N days" is today up to and including the date N days from today (a visit exactly 7 days away is in the 7-day window, 8 days away is out). Judgment call 1.
- **The open visit Task.** Listed when it is inside the window; one already overdue is always listed (marked overdue, never hidden by a narrow window); one beyond the window is left out. A moved visit still shows "Moved from <date>" and later expected dates do not shift (the reader's expected dates come from the cadence; the test proves the list is identical per window).
- **No silent truncation.** The reader returns EVERY visit in the window. The card shows the first 10 rows and, when more match, says "Showing 10 of 13 visits in the next 90 days." with a **Show all 13 visits** button (a real toggle with `aria-expanded`). The provider filter is applied before the row limit.
- **Unchanged (proved by tests):** recurrence, the 12-month Calendar layer (the same ids before and after changing the window; about 52 weekly visits still listed), the one-open-Task rule, paused and ended arrangements (never listed), every table (a snapshot of records, links, transactions and settings is identical after loading all four windows three times).
- **Control.** A compact labelled native `<select>` ("Show the next ... days") with an `aria-describedby` status line; keyboard operable by default. 375 px, light and dark: see section 18.
- **Tests (20, `b30a-upcoming.test.ts`):** the four windows, exact inclusion and exclusion at 7, 14, 30 and 90 days (using weekly arrangements that land exactly on each boundary), device date, far and overdue Tasks, moved visit, provider filter before the row limit, paused and ended, no writes, the Calendar layer unchanged, persistence, invalid saved values, broken storage, the card's markup (labelled selector, "Showing 10 of 13", "Show all", empty state, "changes only this list").

## 6. B3.0B: Calendar Select all / Deselect all

- **One visibility system.** Calendar visibility already lived in one device-local preference, `calendar-hidden-layers` (a list of layer ids that are switched off). It still does; `layerVisibility.ts` interprets it. Two states: **"everything except these"** (the old list; `[]` = everything on = a fresh install and Select all) and **"only these"** (`{"only":[ids]}`; **Deselect all** is "only" with no ids). No migration: every earlier value reads exactly as before, and an older build reads the new form as "everything on" (it can show too much, never hide something unexpectedly).
- **Semantics (the brief's recommended ones).** Fresh: all visible. Deselect all: none, also after a reload. Manual choices are kept exactly. Select all: every current layer, and every future one. A layer registered later is on only while everything is on; during any chosen set it is off until the owner switches it on, so a Personal-only choice survives new modules. Switching every layer on by hand returns to "everything on". Ids of layers that no longer exist are ignored and dropped on the next write. Judgment call 2 explains the one reading that needed a decision.
- **UI.** `Legend` has **Select all** and **Deselect all** buttons (real buttons, 36 px, wrapping), the existing per-layer chips with `aria-pressed`, "Manage calendars", and a status line "N of 7 calendars shown". With nothing on, the page says so in words ("Every calendar is switched off, so nothing is shown ... Nothing was deleted or changed").
- **Scope of visibility.** One filter in `CalendarPage` feeds the Month, Week, Work week, Agenda and Day-panel views. **Today does not read this preference** (a test pins it), so Today's Calendar surfaces are unaffected. **.ics export:** it already offered exactly the visible local calendars; it still does. After Deselect all it lists none and says how to export one calendar anyway ("Manage calendars", then Export). No export content changed because of this.
- **No mutation.** The module is pure (a test rejects storage, database, React, network); running 40 operations against a real seeded database changes no row.
- **Tests (19, `layerVisibility.test.ts`):** fresh install, unreadable values, earlier lists, Deselect all and reload, Personal-only and reload, Select all, single switch-off, switch everything on, new layer in each state, deleted layer, no layers loaded, unregistered-layer items, older-build compatibility (the old reader copied verbatim), purity, one filter for every view, Today not affected, no database change.

## 7. Finance Calendar Hide Amounts correction

- **Cause.** `ledgerDueItems` built a scheduled item's title as `${payee} ${formatCents(amount)}` (and `lib/calendar.ts` puts amounts in loan, RSU and estimated-tax text) without consulting Hide Amounts.
- **Fix (narrow).** `ledgerDueItems(d, q, hide = loadHideAmounts())`. With Hide Amounts on: a scheduled item's title is its payee only (detail still "Scheduled payment to approve."), and any other amount in a Finance title or detail is masked with the existing `maskMoney` figure. Dates, ids, priorities, `icsUid`, scheduling, the Scheduled payment, balances and posting are unchanged (tests compare the shown and hidden lists field by field and snapshot every Finance table). `useCalendarData` re-runs when the switch changes. `loadHideAmounts()` no longer throws where there is no storage (tests, private windows).
- **ICS.** Finding: the Finance layer in the .ics export (opt-in "Also include the Finance layer") embeds the amount in the event title (`<payee> <amount>`, the same text as Ledger's own "Add to my calendar" file, with the same ids) and loan, vest and tax entries carry amounts in title or detail. Own-calendar events, Bills and Household Services items carry none. **Behaviour was deliberately not changed:** `DerivedItem` gained two optional fields, `icsTitle` and `icsDetail`, so the file keeps its full text while the screen is masked (test: the exported file is byte-identical with Hide Amounts on and off). The export dialog now warns when Hide Amounts is on and the Finance layer is ticked. **Open owner decision O-2:** whether exports should have their own "leave amounts out" choice.
- **Not covered:** Home's "Coming up" card (`ComingUp.tsx`) also lists these items with amounts and was not part of this fix (it reads `loadCalendar` with its own formatter). Noted for the owner.
- **Tests (6, `dueProviderHide.test.ts`):** Hide Amounts off is exactly the old text; on has no figure in any string of any Finance item; only the words differ; toggling returns the original; no Finance row changes; the file keeps the full text.

## 8. Finance payment-link data model

- **One more `cycle` fact:** `{ obligationId, slot, fact: 'payment-link', ref }` where `ref` is the shared `TxnRef` (`txnId`, optional `splitIndex`, explanatory `snapshot {date, payee, amountCents}`, split fingerprint `fp {splitCount, amountCents, categoryId}`), read by the shared `readTxnRefs`, validated by the shared `validateTxnRefs`. No competing format. Exactly one piece per fact. **Added or removed (a soft delete), never edited** (`editFact` refuses). It holds no amount of its own (a test asserts the stored row has no `cents`).
- **Defensive reading.** A `payment-link` whose reference is missing or junk is read as unreadable ("needs review"), kept exactly as saved, never counted and never rewritten (test with five damaged shapes). A build that predates B3 reads the whole fact as unknown and carries it through every edit, sync and restore (test 11 in `b3-sync.test.ts`, and the three B2 tests that still use another unknown type).
- **No schema change:** Dexie stays at version 15 with 40 tables (a test pins both). No new link type, no migration.

## 9. Transaction picker and confirmation workflow

- `PaymentUI.tsx` `LinkPaymentDialog` hosts the **shared `TxnPicker`** unchanged (it already has `hide`, the "Show amounts" reveal, whole-or-part choice, search by payee, date and amount, and hides transfers and setup entries). No shared-component edit, so Home & Assets and Household Services behave as before (their tests are unchanged and pass).
- **Steps:** pick (a whole transaction or one part) → the dialog shows the picked payment (payee, date, live amount, account context through the picker, a link into Finance) and **"What will happen"** from `planFact` (the same checks saving makes, so the preview refuses exactly what saving refuses) → what the period will look like afterwards in words ("Partly paid: $50 of $120 recorded, $70 left") → optional "Also finish the reminder Task" → **Link this payment**. One press writes once (an operation id per open dialog).
- **Remove or replace:** each linked payment has **Replace this payment** (pick another; one transaction removes the old link and adds the new one; Undo restores both) and **Remove link** (a preview that says the transaction stays in Finance and the bill may show unpaid again, and, if reminders are on, that its reminder Task may be made again).
- **Refusals in words:** the same piece twice ("This payment is already linked to this billing period."), a whole transaction beside its part, a deleted transaction, a transfer or setup entry, a part whose split changed, a loan-tracked bill ("Loan payments are tracked on the Loans page"), a bill that no longer exists. Nothing is written in any of those cases.
- **Privacy.** The picker and every list honor Hide Amounts (figures masked, direction kept, status and payee shown). No account number or other Finance identifier is shown, searched or stored by Bills; Search, Today and the Calendar carry no amount.

## 10. Typed versus Finance payment precedence

The B0 rule is kept: **one authoritative money source per period, never both added.**

- **At write time.** Linking while a typed outside-Finance payment (with an amount) exists is refused until the owner ticks "Replace the outside-Finance payment with a Finance-linked payment" (the dialog explains: a Finance transaction now represents the payment; the typed payment stays in the history and is set aside; Ledger will not count both; no Finance transaction is modified). On confirmation, ONE transaction adds the link and marks the typed record `supersededBy` the link (set aside, visible under "Set aside, not counted", never erased); Undo restores the typed record exactly and removes the link, and is refused if anything changed since. The reverse is refused: a typed amount cannot be added (or an existing typed record changed to carry one) while links are in force; a declaration without an amount (paid outside, no amount; paid in full) is always allowed because it is not money.
- **At read time (two devices).** If one device typed a payment and another linked Finance, both records are kept. Finance counts, the typed amount is left out of every figure (`typedLeftOut`) and shown ("a typed payment ($120.00) is left out while a Finance payment is linked"), a **typed-and-finance** conflict is raised (Needs review and Today), and the only resolution is an explicit, previewed, guarded "Use this Finance payment (set the typed amount aside)". Nothing is erased automatically (test 4 in `b3-sync.test.ts`, real `SyncEngine`).
- **Even a stale link wins over typed money** (the owner chose Finance; a typed amount must not stand in silently): Finance counts 0 and the period is flagged.
- **Two real payments.** A household that really paid twice links two distinct Finance pieces (each counts). Nothing is merged because payee, date or amount match (test: two identical-looking independent payments both count).
- **B0 policy question (owner decision O-1).** A legitimate case this rule cannot represent: a $120 bill paid as $70 through the bank (recorded in Finance, linked) and $50 in cash (never in Finance). Under the one-source rule the $50 cannot be typed beside the link. Recommendation: keep one source in B3; if it matters, a later phase adds an explicitly labelled "also paid in cash" amount with its own confirmation. It was NOT improvised here.

## 11. Whole and split deduplication and reconciliation evidence

Money rules are Home & Assets' `spend()` (unchanged), called by `payments.ts` with one record per period: each `pieceKey` once, a whole transaction covers its parts, missing, split-changed and no-longer-spending references count 0 and are kept, a changed whole uses the live amount and is flagged, refunds lower the net. `payments.ts` adds only the link role (counted, duplicate, covered, review), Finance's status of each counted piece, and the reversal test (a counted net of zero or less because money came back).

- **Reconciliation proof:** a 300-world seeded random test (deleted, changed, transferred and reordered transactions; refunds; repeats; whole beside part; typed and declared amounts; four coverage assertions so the generator really exercised every branch) checks, for every world, that the net equals the sum of counted pieces AND equals `spend()` on the same references, paid is never negative, remaining and overpaid follow owed, "Paid" never appears while something remains, "Overdue" never appears with money recorded, typed amounts are never added, and no settlement word appears. A deterministic 216-case matrix (invoice × payments × typed × declaration × status) reconciles every combination.
- **Across periods and bills** (`billsSpend.ts`, section 15): one piece linked to several periods is counted once and flagged.

## 12. Payment status and label examples (live data; wording from the code)

| Situation | Primary label | Second line (what Ledger knows) |
|---|---|---|
| $120 billed, $120 linked, status pending | **Paid** | Recorded in Finance: pending. It is entered in Finance but not marked cleared. That is your own entry; it does not show that the provider has been paid. |
| same, status cleared | **Paid** | Recorded in Finance: cleared. It was marked cleared in Finance (by you or from an imported bank file). That does not by itself show that the provider received it. |
| same, status reconciled | **Paid** | Recorded in Finance: reconciled. It is included in an account reconciliation you completed in Ledger. |
| $120 billed, $50 linked | **Partly paid ($50.00 of $120.00)**, $70.00 left | Recorded in Finance: pending (or the status of the piece) |
| two $60 pieces, one pending and one cleared | **Paid** | Recorded in Finance: 1 pending, 1 cleared. Finance's status words are your own marks and imports; they do not show that the provider received the money. |
| $120 paid then $120 linked as money back | **Overdue (billed, no payment recorded)** if past due, else the timing label | ... A payment was reversed or refunded in Finance. |
| linked transaction deleted | timing label (**Overdue** or **Not confirmed paid**) | ... A linked Finance payment needs review and is not counted. |
| marked paid in full, linked $100 of $120 | **Marked paid in full by you; Finance shows $100.00 of $120.00** | You declared it paid in full. Finance shows $100.00 of $120.00; the difference is shown, not hidden. |
| marked paid in full, linked payment deleted or reversed | **Needs review: a payment you marked is no longer supported by Finance** | You marked this paid, but the Finance payment linked to it is missing, changed or was reversed, so nothing is counted until you look. |
| automatic payment past its date, nothing linked | **Autopay not yet seen in Finance, please check** | No payment is linked from Finance or recorded here. An automatic payment may not have happened, or may not be in Finance yet. |

Never written: "settled", "bank-confirmed", "received by the bank", "failed", "bounced", "declined". "Cleared" appears only as Finance's own status word (tests scan every label, evidence line and status text).

## 13. Partial payments, credits, refunds and reversals

Four amounts stay apart and are never added: expected, invoiced, credits, paid. The derivations (all tested): owed = billed (a confirmed 0 included), else expected, else estimate, else unknown (two different invoices give "records disagree"); owed minus credits (a credit is never a payment); paid = the net of counted Finance pieces (or the typed amount only when nothing is linked); remaining = owed minus paid (unknown stays unknown, never zero); overpaid shown as "paid more than billed". Worked cases (all in `b3-state.test.ts`): $120 / $120; $120 / $50; $120 / two $60; $120 with a $20 credit and $100 paid; $120 paid and refunded in full (net 0, reversal reported, period open again); $120 paid and $20 refunded ($100 recorded, no reversal); whole transaction and its part; two parts of one split; the same piece twice; a $0.00 invoice (with and without a payment); a payment with the amount owed unknown; conflicting invoices; a changed Finance amount; a deleted transaction; a transfer; a stale split fingerprint. A refund is never described as proof that a payment failed.

## 14. Task, Today and Calendar integration evidence

- **Tasks (`tasks.ts` is still the only writer, through the existing Tasks API; the Tasks engine is not changed).** The planner is now given the live Finance transactions (`planningPeriods(..., lookup)`, REQUIRED; a guard test fails any production call that omits it, because a forgotten lookup would read every linked payment as missing and plan a reminder for a paid bill). Fully paying a period offers "Also finish the reminder Task" in the preview and, when ticked, finishes it and makes the next one in the same transaction (still ONE open pay Task; Finance untouched; tested). A partial payment leaves the same period open with its one reminder; paying the rest then closes it. Removing the only payment reopens the period and ensures one reminder for it again; the later reminder already made is **reported, not deleted** (it appears under "a reminder Task refers to a period that has since changed"), and an owner-edited Task is never changed. A Finance change after payment (a deleted payment, a refund) recomputes and **reports** but silently creates and deletes **no** Task (tested with a snapshot of every Task). Opening the Overview, Today or the Calendar writes nothing (tested over repeated loads).
- **Today (`bills.attention`, counts only).** New lines: "N linked payments need review", "N linked payments changed in Finance", "N bills are partly paid" (only when due soon, today or late), "N automatic payments not yet seen in Finance", "N bills have a typed payment and a Finance payment", "N payments are linked more than once". A test pins that no line carries a bill name, provider, amount or four-digit number, and that the Overview and Today use one function. Payment problems are scanned over EVERY recorded period (a stale link on a months-old period is still reported; test).
- **Calendar.** A period paid by linked Finance payments is not an open Due marker; a partly paid one, or one whose payment went missing or was reversed, shows its marker; titles stay `Due: <bill>` with no amount; the period identity in the item id does not change with payment status; no Calendar event record is ever created (counted in the test); the Bills layer's 12-month horizon, Task-versus-due-date semantics, stable ids and the Finance, Services and Personal layers are untouched.

## 15. Payment history and source-of-truth boundaries

- **Payment history (`PaymentHistoryCard`, read only, on every bill page).** For each billing period that holds a record, newest first: label and the "what Ledger knows" line, the amounts line, what is still owed, the linked Finance payments (live amount, Finance's status word, "changed in Finance", a link into the transaction), what you typed as paid outside Finance (marked "left out of the figures while a Finance payment is linked" when applicable), provider credits (marked "not a payment"), a collapsed "Set aside, not counted" list (typed payments and links you replaced), and any review notes. It has no buttons that change a payment. There is **no separate Bills payment ledger**: it is a view over the same facts. It survives schedule changes, pausing, ending and provider changes (periods are identified by their own slot) and backup and restore (tested), offline sync (tested), and later Finance changes or deletion (live recalculation; the snapshot keeps the explanation).
- **Boundaries.** Finance stays the sole authority for transactions; Bills never creates, edits, deletes, clears, reconciles, categorizes or posts one, and never changes a scheduled rule, recurring log, forecast or balance. A test snapshots every Finance table around link, replace, remove, switch, repair, move and Undo (byte for byte equal, including the transaction's status).
- **Bills-only recorded payments for B5 (`billsSpend.ts`).** Pure: `billsCostRecords(obligations, cycles)` (one record per period with payment evidence, fixed order, group = the bill's type, loans and unknown bills left out) → the shared `spend()` → `billsRecordedPayments(records, lookup)` (total, finance, typed, by type, shared pieces, review) and `explain` (every counted piece with the periods behind it). Tested: one payment linked to several periods or bills counts once and is flagged (and the conflict reader reports it); a whole supersedes parts everywhere; refunds reduce the net; missing, stale and transferred references count 0 and are listed; typed amounts are not added beside links and not matched to Finance by value; pending, cleared and reconciled never change a number; invoices, credits, expectations are never counted; deterministic in any input order. **B5 boundary:** `householdSpend` was not changed or widened (a test asserts its source does not mention Bills and `spend()` does not either); Projects money, Finance forecasts and scheduled estimates are not in any figure. B5 will own the three-module union and its golden-master gate.

## 16. Simulated two-device sync and backup

Real `SyncEngine` with two devices (which also syncs the Finance tables) and the real backup export, checker and restore (`b3-sync.test.ts`, 14 tests). 1 a link made on A reaches B and both compute the same paid amount and status; 2 two devices link different pieces to one period: both kept, added; 3 the same piece on both: both facts kept (nothing silently discarded), counted once, duplicate reported; 4 typed on A and linked on B: both kept, Finance counts, typed left out, conflict on both, explicit repair syncs and the typed record survives as history; 5 A removes a link while B edits the bill: nothing else lost, the removal travels; 6 a Finance transaction altered then deleted on A reaches B (live amount, then review; the link is kept, the snapshot explains); 7 a split reordered on A: the part link needs review on both, never moved to the part now in that position; 8 the bill ended on A while B links a payment: the link survives and counts; 9 a period moved while links exist: links move with it and count for the new period on both; 10 a guarded Undo is refused after another device changed what it touched, writing nothing; 11 an unknown fact type and its fields survive an edit of the same period, sync and restore beside links; backup: typed set aside plus two links (cleared, reconciled) restores to identical periods, amounts and statuses, every Finance table equal; the same transaction referenced from Bills and Home & Assets: neither module's records or totals change. Real devices, offline and an older real build were NOT tested (section 18).

## 17. Mutation and fault-injection evidence

`scripts/bills-b3-mutation-check.cjs` breaks the production source on purpose, runs the B3 tests (Bills B3, the source guards, Calendar visibility, Finance Hide Amounts, Services window), restores the file and reports whether a test noticed. **46 mutations, all CAUGHT in the end** (a mutation no test noticed is a gap, and every gap found was closed with a real test, not by weakening anything).

| Area | Mutations (each CAUGHT) |
|---|---|
| Money derivation (`payments.ts`, `amounts.ts`) | a repeated link not flagged as a duplicate; the net adds every link instead of using `spend()`; a reversal never detected; paid allowed to go negative; Finance status dropped; a typed amount added to the Finance amount; the typed amount left out not reported; a link not counted as payment evidence; a stale link letting a typed amount stand in |
| Labels and periods (`labels.ts`, `periods.ts`) | the "declared paid in full, Finance shows less" case lost; a suspended declaration trusted; a declaration never suspended; the Finance lookup dropped (54 tests fail) |
| Confirmation rules and writes (`paymentLinks.ts`, `cycleData.ts`) | the same piece linkable twice; whole beside its part accepted; the typed-to-Finance switch needing no confirmation; a missing transaction linkable; the typed payment not set aside on the switch; a typed amount allowed over links; replacing a link keeping the old one; a link editable; the new reference not read before the write |
| Conflicts and read model (`cycleConflicts.ts`, `readModel.ts`) | typed beside Finance not reported; a duplicated piece not reported; one piece on two periods not reported; old periods not scanned for payment problems; a changed payment not reported; an upcoming partial payment counted as needing action |
| Calendar and Tasks (`dueProvider.ts`, `tasks.ts`) | the Calendar layer ignoring Finance payments; the reminder planner ignoring Finance payments |
| Bills-only reader (`billsSpend.ts`) | a typed amount counted beside links; a loan-tracked bill counted; shared pieces not reported |
| Calendar visibility (`layerVisibility.ts`) | Deselect all hiding nothing; a chosen set showing every layer; an earlier hidden list ignored; switching everything on not returning to "all on"; unreadable saved text hiding everything |
| Finance Hide Amounts (`ledger/dueProvider.ts`) | a scheduled item keeping its amount when hidden; the calendar file losing the amount when hidden; other Finance items keeping their amount |
| Services window (`servicesOverview.ts`, `upcomingWindow.ts`) | the window ending a day early; a far open visit listed; the default being 90; an invalid saved window accepted; more visits than rows cut silently; the provider filter ignored |

**What the checks taught (honest account).** (1) The first run crashed at mutation 26 because Windows refused a file write while restoring; every production file was then compared with its original text (one was still mutated, `readModel.ts`; it was restored by hand, and the full suite was green afterwards). The script was hardened (retried writes, per-file restore with verification, resume) and re-run from that point. (2) **AM3** (a link not counted as payment evidence) survived at first: only a link that counted had been tested beside a skip; a test with a link whose transaction is gone now covers it. (3) **VB2**'s search text was mistyped and was not applied; fixed, then caught. (4) **BS1** (a typed amount counted beside links) survived because the shared `spend()` ignores a typed amount when links exist; the reader's own record now has an explicit check that nothing is both typed and linked. (5) **SW5** (a long list cut silently) survived because the "Show all" state was not unit-tested; the rule was extracted to the pure `visibleUpcoming` and tested. One mutation (PY3) shows as a false "present" in my restore verifier only because its replacement text (`reversed: false,`) also appears elsewhere in the file legitimately.

**Fault injection and other evidence.** An injected failure in the typed-payment write (the second write of the switch) leaves no link and the typed payment untouched; an injected failure when the reminder Task is made after the link was written rolls the link back too; a stale Undo is refused without writing; a deleted, changed, reordered or transferred Finance transaction is recomputed live; the 300-world random test and the 216-case matrix (section 11) and the source guards (no Finance write, Finance read only through the shared loader, every period derivation given the lookup) all run in the normal suite.

## 18. Browser acceptance

**Method, and what it is not.** The built-in browser pane (not a physical device) with its own database, emptied and then seeded with invented data using the app's own code through the dev server (Example Power Co, Streamly Premium, Example Rent, Example dentist visit, three weekly Household Services arrangements, an Example Checking account with five invented transactions). Today in the pane was 2026-11-07. **The pane was hidden for this run, so screenshots and real pointer clicks were not possible:** controls were operated at DOM level (`element.click()` on the real React controls and `form_input` for the selector), and every result was read back from the page text, the accessibility tree, computed styles and the database. A visual review, a real mouse and keyboard Tab walk, and a screen reader were NOT done in this pass. 375 px was checked by viewport emulation and measurement (no horizontal overflow, no control under 36 px); dark and light by colour-scheme emulation. The server and the emulation were stopped and reset afterwards.

| Journey | Result |
|---|---|
| **A. Household Services window** | Default 30 days ("Showing 10 of 15 visits in the next 30 days", Show all 15). 7 days listed 4 visits (the one exactly 7 days away included); 14 days listed 7; 90 days "Showing 10 of 39" and **Show all 39** listed all 39 (`aria-expanded` true). The choice survived a full page reload (`services-upcoming-days` = 90). The Calendar's Household Services layer still returned 154 items to 2027-11-06 (12 months) and the record count did not change. |
| **B. Calendar controls** | Fresh: 7 of 7 shown (Bills & Subscriptions included), nothing stored. **Deselect all**: 0 of 7, the plain "Every calendar is switched off ..." message, stored `{"only":[]}`, Personal event and Finance item both gone, no record added. **Personal only**: 1 of 7, only the Personal event shown, stored `{"only":[<Personal id>]}`; unchanged after a reload and in the Agenda, Week and Work-week views. **Select all**: 7 of 7, Bills markers and the Finance item back, stored `[]`. **Finance Hide Amounts**: Hide Amounts off "Example Rent $1,200.00"; on "Example Rent" and no money figure anywhere on the Calendar (the bug seen in B2). The export dialog warns when Hide Amounts is on and the Finance layer is ticked. |
| **C. Finance-linked bill** | November (billed $120.00): picked the $120.00 pending transaction, preview said "Paid: $120.00 recorded against $120.00 billed"; after Link: **Paid**, "Recorded in Finance: pending ...", "Billed $120.00 · recorded in Finance $120.00, $0.00 left", the payment list (live amount, status, Replace this payment, Remove link) and the read-only Payment history row. **Every Finance table was byte-identical before and after.** The Bills Calendar marker for the 18th disappeared when paid. Editing the Finance transaction to $90.00 while the page was open recalculated the page by itself to **Partly paid ($90.00 of $120.00)** with "$30.00 left" and brought the marker back; restoring it returned **Paid**. Today's Bills card showed counts only ("1 bill not confirmed paid", "1 automatic payment not yet seen in Finance"). |
| **D. Typed payment conversion** | December had a typed $120.00 outside-Finance payment (label Paid, "paid outside Finance"). "Replace the typed payment with a Finance payment" opened a dialog titled with that sentence; picking a payment BEFORE confirming showed the refusal text and a disabled button; ticking the confirmation enabled it and the plan said the typed payment will be set aside, Ledger will not count both, no Finance transaction changes ("Paid: $120.00 recorded against $120.00 billed"). After: recorded in Finance **$120.00 (not $240.00)**, "Set aside, not counted (1)" in the history, the typed record still in the database with `supersededBy` set and not deleted, Finance tables unchanged. |
| **E. Multiple payments** | October (the period holding the reminder Task): linking the $50.00 cleared payment gave **Partly paid ($50.00 of $120.00)**, "$70.00 left", the same single open reminder; linking the $70.00 reconciled one showed "The reminder Task ... will be finished" and "A reminder Task will be made ... 2027-01-15", the checkbox "Also finish the reminder Task", and the result **Paid** with "Recorded in Finance: 1 cleared, 1 reconciled". Exactly one open pay Task remained, for **January 2027** (November and December were already paid through Finance, so the planner skipped them). |
| **F. Error handling** | Deleting the $50.00 transaction in Finance: October read partly paid again ($70.00 of $120.00 and late) and the link was kept ("Linked Finance payments to look at"). A split part linked and then reordered in Finance: **split-changed** (February 2027), counts nothing. The same piece linked twice (as two devices could deliver it): "The same payment linked more than once", counted once. A typed amount delivered beside a Finance link: "A typed payment and a Finance payment", Finance counted; "Use this Finance payment (set the typed amount aside)" opened a preview ("Keep ... Set aside ... It stays visible under History"), applied, and left both records in the database with the typed one set aside; Nothing in Finance changed. **A defect was found here and fixed:** the Needs-review page did not list the five new payment categories (Today counted them but its links led to an empty page). The page now has a group for each, and a test fails if a counted category has no place on the page. |
| **375 px (services, Calendar Agenda, bill page, Needs review)** | `scrollWidth` 375 = width on all four, no overflowing element, no control under 36 px. The Link dialog at 375 px: inside the viewport (12 px margins), no overflow. |
| **Dark (375 px, Hide Amounts on)** | Background rgb(18,21,26), text rgb(232,234,237). No money figure anywhere on the bill page; the picker shows $•••• with "Show amounts" (`aria-pressed` false then true; real figures only after choosing it). **Escape** closed the dialog and focus returned to the button that opened it. |
| **Light (375 px)** | No overflow. **SUPERSEDED by section 23.1 and 23.5: this figure was a measurement error and the chips actually pass 4.5:1.** Original text: the small status chips (the "Active", "Paid" and "Partly paid" chip style from B1 and B2) measure about 3.6:1 against their background by a rough computation (below the 4.5:1 normally wanted for small text). This is the existing chip style, not new in B3, and it is NOT fixed here. |

**Not verified in the browser:** a visual (screenshot) review in either theme; a real keyboard Tab walk through the new dialogs and the Select all / Deselect all buttons (they are native buttons and a native select); a screen reader; Week and Work-week views visually (their content was checked through the page text); the .ics file opened in a phone calendar; a real phone; two physical devices; offline use.

## 19. Final automated results

| Check | Result |
|---|---|
| `npm test` | **2,761 tests pass in 154 files** (baseline 2,609 in 147) |
| `npx tsc --noEmit` | clean |
| `npm run build` | succeeds (the existing chunk-size warning only) |
| `git diff --check` | no whitespace errors (only the usual "LF will be replaced by CRLF" notes) |
| Existing Services, H3, S5, Home & Assets, Projects, Tasks, Calendar and Finance tests | all pass; the only edits to existing tests are the two intended ones in section 4 |
| Schema | Dexie version 15, 40 tables (pinned by a test); no migration |
| Privacy scan of every added line and new file | no email, name, token, account or real figure (a scan for personal identifiers found only the repository name and, before this was removed, a local folder path in this report) |

**One flaky existing test, not caused by B3 and not changed:** `services/s4-calendar.test.ts` test 13 scans JSON that contains random time-based record ids for strings such as `4455` or `12345`; it failed once in one full run when an id happened to contain one, then passed three times alone and in the next full run. It is the same kind of problem the handoff already notes for `core.test.ts` (a test must not match random ids). Recorded, not edited.

## 20. Judgment calls (please review) and owner decisions

Judgment calls (each is reversible and none changes a financial rule):

1. **Upcoming window boundary.** "N days" includes the date exactly N days from today (not N minus one); an overdue open visit Task stays listed because it needs action. (Alternative: exclusive end, or hide overdue.)
2. **Calendar: once any calendar is hidden by hand, the choice becomes a chosen set.** The brief says a new layer should appear automatically "only when the configuration is still in an all-visible mode", so hiding even one calendar means a later new calendar starts off until switched on. A list written by the earlier version keeps its old meaning (new calendars on) until the owner next changes a switch. (Alternative: keep a plain hidden list for single hides, so new calendars always appear unless chosen otherwise: owner decision O-5.)
3. **Both new preferences are per-device conveniences, not in backups and never synced** (`services-upcoming-days`, and the existing `calendar-hidden-layers`), like the Calendar's other view preferences. `docs/module-hooks.md` says new preference keys go into `PREFERENCE_KEYS`; the Calendar's own never did, so this follows the actual convention.
4. **Finance Hide Amounts text.** A scheduled item shows its payee only (no placeholder), other amounts show the existing masked figure; the .ics export is left exactly as it was and documented (O-2). Home's "Coming up" card is a separate surface and was not changed (O-3).
5. **Any Finance link makes Finance the money source for that period, even if every link is stale.** A typed amount must not silently stand in for a link that no longer counts; it is kept, shown, left out, and a conflict is raised.
6. **"Marked paid in full" with Finance showing less keeps the owner's statement** and states the difference ("Marked paid in full by you; Finance shows $100.00 of $120.00"); figures stay honest and the period is treated as settled by declaration. Applies only to a Finance source, so the B2 typed behaviour is unchanged. (Alternative: show "Partly paid": O-4.)
7. **A "reversal" includes money-back-only.** If the only linked piece is money coming back, paid is 0 and it counts as a reversal, so a declaration cannot hide it.
8. **Removing a payment reopens the period and ensures one reminder for it** (the existing B2 behaviour for removing a typed payment); a later reminder already made is reported on Needs review, never deleted. The remove preview says so.
9. **Payment problems are scanned over every recorded period**, not only the 45-day attention window, so a stale link on an old period is never forgotten; "partly paid" counts only when due soon, today or late.
10. **A piece linked to several periods is flagged with "Leave as is" only**; the owner removes the wrong link by hand (Bills cannot know which period is right).
11. **The Finance rows are read just before the write transaction opens**, never inside it (the shared pattern: Finance tables never join a Bills transaction). The cost is a tiny window where a Finance change leaves the planned reminders one step stale until the next save.
12. **Tests that changed:** `s5-overview.test.ts` (60 days became the new 30-day default); three B2 tests used `payment-link` as "a fact type this build does not know" and now use `suggestion-reject`; the source guard in `guards.test.ts` was not weakened (Bills still may not touch `d.txns`); `b3-spend.test.ts` adds the B3 form of that guard (Finance is read only through the shared loader) and pins the schema.
13. **`loadHideAmounts` now looks up storage inside its `try`** so it returns "not hidden" instead of throwing where there is no storage (tests, private windows); behaviour in a browser is unchanged.
14. **Autopay wording** changed from "not confirmed" to "not yet seen in Finance" (the B2 report said B3 would).

Owner decisions needed:

- **O-1 (a B0 policy question):** one bill paid partly through Finance and partly in cash. The one-source rule cannot represent the cash part beside a link. Recommendation: keep one source for now; if it matters, add an explicitly labelled "also paid in cash" amount later.
- **O-2:** should exported calendar files have their own "leave amounts out" choice? Today the Finance layer in an .ics file contains amounts even with Hide Amounts on (documented; the dialog warns).
- **O-3 (RESOLVED in section 23):** Home's "Coming up" card now honors Hide Amounts.
- **O-4:** should "declared paid in full, Finance shows less" read "Partly paid" instead of the owner's statement?
- **O-5:** should hiding ONE calendar keep later new calendars visible (judgment call 2)?

## 21. Known limitations, B3.1 and B4 prerequisites

**Known limitations:** real-device, two-physical-device, offline, older-real-build, screen-reader and measured-contrast acceptance are NOT done (browser-pane checks and `SyncEngine` simulations only); whole-record last-writer-wins still applies to an edit of an existing fact or the bill itself; payments are matched by the owner only (no suggestion exists); a restored backup shows a link as "missing" until the transaction is on that device; Finance's status words are the owner's marks and imports, not settlement; a payment linked from several periods or bills is flagged but not apportioned (a shared payment is never divided); look-back for counts remains 45 days (payment problems excepted); Week and Work-week views and the .ics file inside a phone calendar were not checked; Home's "Coming up" still shows Finance amounts.

**B3.1 prerequisites (not started, not authorized):** suggestions (`suggestMatches`, three tiers, `suggestion-reject` fact, `payeeHints` with consent) must show suggestions only and store nothing until the owner confirms through the same `LinkPaymentDialog`; the optional picker props (`suggested`, initial filter) are additive; the Finance scheduled-item pointer and cross-layer marker suppression need the `payment-shared` and `typed-and-finance` handling already here; `suggestion-reject` is deliberately still an unknown fact type to this build. **B4 prerequisites:** cancellation and renewal facts follow the same one-fact-per-record pattern; a payment after a cancellation date needs the period reader (already live). **B5 prerequisites:** consume `billsCostRecords` / `billsRecordedPayments` / `explain` from a separate union function behind the golden-master gate; do not widen `householdSpend`.

## 22. Exact Git status, handoff and backlog updates

```text
$ git rev-parse HEAD origin/main
aca220865f5f0bf241e713081a404aab4961490e
aca220865f5f0bf241e713081a404aab4961490e

$ git status --short
 M README.md
 M docs/BACKLOG.md
 M docs/CHATGPT-HANDOFF.md
 M docs/due-provider.md
 M docs/module-hooks.md
 M src/core/dueProvider.ts
 M src/modules/bills/CycleDialogs.tsx
 M src/modules/bills/ObligationPage.tsx
 M src/modules/bills/OverviewPage.tsx
 M src/modules/bills/PeriodParts.tsx
 M src/modules/bills/PeriodsCard.tsx
 M src/modules/bills/RepairDialogs.tsx
 M src/modules/bills/ReviewPage.tsx
 M src/modules/bills/amounts.ts
 M src/modules/bills/b2-data.test.ts
 M src/modules/bills/b2-state.test.ts
 M src/modules/bills/b2-sync.test.ts
 M src/modules/bills/bills.css
 M src/modules/bills/contractData.ts
 M src/modules/bills/cycleConflicts.ts
 M src/modules/bills/cycleData.ts
 M src/modules/bills/cycleModel.ts
 M src/modules/bills/cycleRepair.ts
 M src/modules/bills/data.ts
 M src/modules/bills/dueProvider.ts
 M src/modules/bills/labels.ts
 M src/modules/bills/periods.ts
 M src/modules/bills/readModel.ts
 M src/modules/bills/tasks.ts
 M src/modules/bills/todayCards.tsx
 M src/modules/calendar/CalendarPage.tsx
 M src/modules/calendar/calendar.css
 M src/modules/calendar/dialogs.tsx
 M src/modules/calendar/ics.ts
 M src/modules/calendar/useCalendarData.ts
 M src/modules/ledger/dueProvider.ts
 M src/modules/services/OverviewPage.tsx
 M src/modules/services/OverviewParts.tsx
 M src/modules/services/s5-overview.test.ts
 M src/modules/services/servicesOverview.ts
 M src/modules/today/layout.ts
?? docs/BILLS-SUBSCRIPTIONS-B3-REPORT-2026-11-07.md
?? scripts/bills-b3-mutation-check.cjs
?? src/modules/bills/PaymentHistoryCard.tsx
?? src/modules/bills/PaymentUI.tsx
?? src/modules/bills/b3-data.test.ts
?? src/modules/bills/b3-spend.test.ts
?? src/modules/bills/b3-state.test.ts
?? src/modules/bills/b3-sync.test.ts
?? src/modules/bills/billsSpend.ts
?? src/modules/bills/paymentLinks.ts
?? src/modules/bills/payments.ts
?? src/modules/calendar/layerVisibility.test.ts
?? src/modules/calendar/layerVisibility.ts
?? src/modules/ledger/dueProviderHide.test.ts
?? src/modules/services/b30a-upcoming.test.ts
?? src/modules/services/upcomingWindow.ts
```

Nothing is staged, committed, pushed or deployed. `HEAD` and `origin/main` are both the verified B2 commit. The Pages deployment of B3 does not exist. The dev server used for the browser checks is stopped and the viewport and colour-scheme emulation were reset. No scratch file is left in the repository (the mutation script's own result files were written outside it).

**Handoff updated: yes** (`docs/CHATGPT-HANDOFF.md`: header, snapshot, test baseline, backlog line, a new B3 section, the corrected B2 status, roadmap lines, a B3 carry-forward risk entry, change-log entry and next action). **Backlog updated: yes** (new top entry with judgment calls, owner decisions O-1 to O-5 and the not-built list; the B2 entry relabelled as committed and deployed). `README.md`, `docs/module-hooks.md` and `docs/due-provider.md` updated. **Differences between local docs, GitHub and deployment:** none beyond the above (nothing of B3 is on GitHub); what remains unknown is the Pages result for B3 and everything on real devices.

**Ready for independent review: yes**, with the stated limits (section 18 "Not verified" and the owner decisions in section 20). Do not commit until ChatGPT's review and the owner's explicit authorization.

## 23. PRE-COMMIT FOLLOW-UP (after ChatGPT's "APPROVED WITH FOLLOW-UPS, DO NOT COMMIT YET")

Status: everything below is built and tested locally and is still **uncommitted, unstaged, unpushed and undeployed**. The reviewed B3 financial architecture is unchanged (confirmation in 23.8). Sections 1 to 22 above are the original report; where this section changes a statement there, this section governs.

### 23.1 Findings, concern by concern

1. **Visual and keyboard acceptance.** The browser pane could now draw, so screenshots and real pointer and key presses were possible. Reviewed directly: the Link dialog (desktop dark; 375 px light with Hide Amounts), a stale-split link in the period list, Needs Review (including the new group), the Calendar with Select all, Deselect all and Personal only (real clicks), the Services Upcoming selector at 375 px, the bill page at 375 px with Hide Amounts, and a real keyboard walk of the Link dialog (Enter opens it, Tab order search box, date, amount, then each transaction's buttons, never leaving the dialog, Escape closes it). **One real defect was found and fixed:** after Escape, focus went to the page instead of the button that opened the dialog. Cause: the shared `Modal` recorded "where focus came from" in an effect that runs after an autofocused field (the picker's search box) has already taken focus, so it "restored" focus to a field that was about to disappear. Fix (narrow, shared): `Modal` now reads the opener during its first render and passes it to `attachModal` as an optional fourth argument (`src/shell/Modal.tsx`, `src/shell/modalKeys.ts`; the old three-argument behaviour is unchanged and tested). Verified with real keys: Enter then Escape returns focus to "Link a Finance payment". This benefits every dialog with an autofocused field.
2. **Status-chip contrast.** The earlier "about 3.6:1" was a **measurement error** (my rough script mis-read the modern `color-mix` colours and walked to the wrong background). Re-measured with the browser's actual computed colours (canvas-converted, alpha composited over every ancestor background) and cross-checked from the design tokens: all chip and small-text states pass 4.5:1 in both themes (table 23.5). **No styling change was made.**
3. **Home "Coming up" and Hide Amounts.** Confirmed: the card showed the Finance title with its amount ("Example Rent $1,200.00"). Fixed narrowly in `src/pages/ComingUp.tsx`: the shown title goes through the existing `maskMoney` when the shared Hide Amounts switch is on ("Example Rent $••••", "Test mortgage payment $••••"); the date, kind, payee, link and id are untouched; the switch is re-read when the window regains focus, becomes visible or another tab changes it (nothing is stored; Today is where the switch lives, so the Home page also reads it fresh on every visit). The downloaded "Add to my calendar" file is untouched (built from the raw events; a test pins it) and no Finance record or Calendar event is touched. Verified in the browser: on shows $••••, off shows $1,200.00, toggling back and forth follows.
4. **Paid in full versus smaller Finance evidence.** Existing behaviour confirmed: the declaration is preserved, the REAL Finance amount is shown ("Marked paid in full by you; Finance shows $90.00 of $120.00", "recorded in Finance $90.00"), no typed payment is invented, nothing is called cleared or settled, Finance is untouched. **The review pathway was missing** (it was visible on the bill but not listed anywhere), so a narrow addition was made: a new counted category `declaredShort`, listed on Needs Review under "Marked paid in full, but Finance shows less" (text: your declaration is kept and nothing was added or cleared; link the remaining payment or remove the declaration) and counted on Today and the Overview ("1 bill marked paid in full shows less in Finance"; counts and words only, no amount, no name). It stops being listed when the discrepancy is resolved (linking the rest, or removing the declaration). It is deliberately not silenced by "Leave as is": an unresolved discrepancy stays discoverable.
5. **Deferred decisions** are recorded in the backlog (section 23.7 and `docs/BACKLOG.md`).

### 23.2 Files changed in this pass

Source: `src/shell/Modal.tsx`, `src/shell/modalKeys.ts` (focus restoration), `src/pages/ComingUp.tsx` (Hide Amounts), `src/modules/bills/readModel.ts`, `todayCards.tsx`, `OverviewPage.tsx`, `ReviewPage.tsx` (the `declaredShort` category). Tests: `src/shell/modalKeys.test.ts` (extended), `src/modules/bills/b3-data.test.ts` (extended), new `src/pages/comingUpHide.test.ts`. Docs: this report, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`. No CSS, schema, Finance, sync or backup file changed.

### 23.3 New tests (7)

`modalKeys.test.ts` 2 (focus returns to the button that opened the dialog even when a field inside took focus first; unchanged behaviour without a recorded opener); `comingUpHide.test.ts` 4 (off equals the old text; on has no figure in any shown title; toggling back and forth is a pure function of the switch and changes nothing; dates, kinds, ids and links untouched and the downloaded file keeps its text, read-only); `b3-data.test.ts` 1 (declared paid in full beside a smaller link: declaration kept, real Finance amount, no typed payment invented, Finance byte-identical, listed in Needs Review and Today without any amount or "settled", and no longer listed once the rest is linked). The existing guard test that every counted category has a place on the Needs-review page also covers `declaredShort`.

### 23.4 Final test totals

`npm test`: **2,768 tests pass in 155 files** (B3 report: 2,761 in 154; original baseline 2,609 in 147). `npx tsc --noEmit` clean. `npm run build` succeeds (existing chunk-size warning only). `git diff --check`: no whitespace errors (line-ending notes only). The 46 mutation checks of section 17 were not re-run: this pass changed no file they mutate except `readModel.ts` (additive category), and the full suite is green.

### 23.5 Contrast measurements (computed colours, normal 12 px text)

| State | Light before (wrong method) | Light actual | Dark actual |
|---|---|---|---|
| Active, Paid, Partly paid, Payment recorded (accent on soft accent) | 3.57 | **4.92** | **5.56** |
| Plain, Essential, Upcoming, Finance status chips (muted on card) | 3.57 | **4.72** | **6.49** |
| Not confirmed paid, Overdue and similar (warning colour) | n/a | **5.15** | **8.59** |
| Small muted text, the "what Ledger knows" line | n/a | 4.72 | 6.49 |

All are at or above 4.5:1, so there is no "after" change: before and after are the same because nothing was changed. These are the default palette; a custom palette chosen in Settings would need its own check.

### 23.6 Browser acceptance evidence and limits

Done with a real pointer and keyboard where noted, in the in-app pane with its own invented database: Link dialog (screenshot, real Enter, five real Tabs, real Escape and focus return); stale-split review state; Needs Review including the new group (screenshot); Calendar real clicks on Deselect all, Personal and Select all (screenshots; 1 of 7 then 7 of 7); Services selector at 375 px light (screenshot); bill page at 375 px light with Hide Amounts (screenshot, no figure) and the Link dialog at 375 px with Hide Amounts (screenshot, masked, no overflow); Home Coming up with Hide Amounts on, off and toggled (text read-back); contrast in both themes. **Still NOT verified:** a physical phone, two physical devices, offline use, a real screen reader, a full real Tab walk of every new screen (only the Link dialog was walked), Week and Work-week views visually, the .ics file inside a phone calendar, and custom palettes. The typed-to-Finance confirmation dialog and Payment history were reviewed in the earlier pass (text and structure) and not re-screenshotted here.

### 23.7 Deferred product decisions (also in the backlog)

Mixed cash plus Finance payments: deferred. Calendar export amounts: existing export behaviour and warning retained; an optional separate privacy control is deferred. Home Hide Amounts: corrected in this pass. Paid-in-full discrepancies: the owner's statement is preserved and contradictory Finance evidence is explained and reviewable. Calendar new-layer visibility: the existing chosen-set behaviour is approved. Not implemented: subscription discovery, cancellation automation, household-wide reconciliation (B3.1, B4, B5).

### 23.8 Confirmation: the B3 financial architecture is unchanged

Not touched in this pass: the `payment-link` fact and its reading, `payments.ts`, `amounts.ts` (one-source precedence), `paymentLinks.ts`, `cycleData.ts`, `billsSpend.ts`, the shared `spend()`, `txnRef`, `costSource`, `txnLookup`, the picker, any Finance table or behaviour, sync, backup, the schema (still Dexie 15, 40 tables, pinned by a test), the 12-month Calendar visibility, Select all / Deselect all, the 7/14/30/90 selector and the one-Task rules. The only Bills change is one additional, read-only attention category.

### 23.9 Final Git status

`HEAD` and `origin/main` are still `aca220865f5f0bf241e713081a404aab4961490e`. Compared with section 22 the only additions are modified `src/shell/Modal.tsx`, `src/shell/modalKeys.ts`, `src/shell/modalKeys.test.ts`, `src/pages/ComingUp.tsx` and a new `src/pages/comingUpHide.test.ts` (62 changed or new paths in all). Nothing is staged, committed, pushed or deployed. The dev server is stopped and the viewport and colour-scheme emulation are reset. **Handoff updated: yes. Backlog updated: yes.**
