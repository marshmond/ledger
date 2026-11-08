# Bills & Subscriptions B3.1: recurring-expense discovery, payment-match suggestions and the Finance Scheduled link. Implementation report

Date: 2026-11-07. Status: **built and tested locally. NOT staged, NOT committed, NOT pushed, NOT deployed, NOT acceptance-tested on a real device, NOT yet independently reviewed.** B4 and B5 were not started and are not authorized. The governing rule held throughout: *Ledger may discover, suggest and explain. Only the owner may confirm relationships or actions.*

## 1. Executive summary (plain English)

Three things were asked for, and all three are built.

1. **Discover recurring expenses.** The Bills overview has a new section, *Discover recurring expenses*. Ledger reads the payments already in Finance and lists payees that repeat at a steady spacing: *Strong pattern*, *Possible pattern*, or (only two payments so far, no frequency claimed) *Needs more information*. It never lists income, transfers, loan payments or a bill you ended, counts a duplicated entry once, and never shows a percentage. **Review** explains why it thinks so, what is uncertain, and every payment it saw. From there four separate choices exist, each saying what it does and does not do: **Create a bill from this suggestion** (opens the normal Add form, prefilled; nothing is saved until you press Add, and no past payment is linked), **Link to an existing bill**, **Not a recurring expense**, and **Dismiss for now**. Looking and reviewing write nothing.
2. **Suggest payment matches.** In the existing *Link a Finance payment* dialog, up to three **suggested payments** now appear above the ordinary search, each with the evidence for it, anything uncertain, and whether it came from the bill's linked Scheduled payment. **Use this payment** only goes to the same preview and confirmation as picking by hand (the B3 checks still decide, and a suggestion is re-checked against a fresh read of Finance just before it is written). **Not this payment** is remembered for that billing period only (the new `suggestion-reject` fact), survives a reload, and can be taken back. A payment already linked somewhere else is shown separately and never as an ordinary recommendation.
3. **Connect a bill to a Finance Scheduled payment.** A bill can point at an existing Scheduled *spending* rule (income, transfers, missing rules and a rule another bill holds are refused with a reason). The bill then shows a read-only *Payment instruction in Finance* panel (payee, amount, repeats, next date, account, active or not, a link to the Scheduled screen) and a calm note where the two disagree. A Scheduled rule can also pre-fill a new bill. When a linked Finance marker and the bill's own marker fall on the same date the Calendar no longer shows both, but only while the Finance marker (which may be your only route to approving the payment) is itself shown.

Nothing in Finance is ever created, changed, cleared, posted or skipped by any of this: a test snapshots every Finance table around every operation. No table, migration, dependency, sync rule or backup format changed.

## 2. Verified B3 commit and successful deployment (the gate), and the clean starting state

| Check | Result |
|---|---|
| Repository and remote | `origin` = `https://github.com/marshmond/ledger.git` (`marshmond/ledger`) |
| Branch | `main`, tracking `origin/main` |
| `HEAD` equals `origin/main` (after `git fetch`) | yes: `ceb0ea81a4e07bc40f65869085b322ea20e0bc0c` (`feat(bills): B3 finance payment linking and usability enhancements`); `git rev-list --left-right --count HEAD...origin/main` = `0 0` |
| B3 on `origin/main` | yes (it is `HEAD`) |
| Matching Pages run | "Deploy to GitHub Pages" run **#71**, id 42421015228, `event` push, `head_sha` exactly the B3 SHA, `completed` / `success` (jobs `build` and `deploy` both `success`); created 2026-11-07T22:31:31Z, updated 22:33:36Z (public Actions API; the `gh` CLI is not installed) |
| Working tree at the start | clean (`git status --short` empty) |
| Unrelated or unreviewed commits | none (the previous commits are B2 `aca2208`, B1 `3bcf3a3`, the B0 plan `8059e5f`) |
| B3 present | yes: `payments.ts`, `PaymentUI.tsx`, `billsSpend.ts`, the `payment-link` fact, `layerVisibility.ts`, `upcomingWindow.ts`; the B3 tests ran |
| Baseline | **2,768 passing tests in 155 files** (re-run, not assumed) |

**An honest note on timing.** When the SHA was first checked (about 80 seconds after the push) run #71 was still `in_progress`. No application code was touched until it had completed successfully; documents were read in the meantime, which the brief allows.

## 3. Baseline and final test totals

Baseline 2,768 tests in 155 files. Final **2,973 tests in 164 files** (+205 tests in 9 new test files: suggestions 41, discovery 34, discovery data 18, Scheduled link 31, rejection / suggestion / link against a real database 26, Calendar coordination 21, two-device sync and backup 10, source guards 16, gap-closing and speed 8). `npx tsc --noEmit`, `npm run build` and `git diff --check` results are in section 19.

## 4. Files added and modified

**Added (source, 13):** `src/lib/financeRead.ts` (the one read-only Finance loader); `src/modules/bills/payeeMatch.ts`, `suggest.ts`, `suggestData.ts`, `discovery.ts`, `discoveryData.ts`, `scheduledLink.ts`, `scheduledLinkData.ts`, `formSeed.ts`, `SuggestionsUI.tsx`, `ScheduledUI.tsx`, `DiscoverCard.tsx`; `src/modules/calendar/markerCoordination.ts`.
**Added (tests, 9):** `bills/b31-suggest.test.ts`, `b31-discovery.test.ts`, `b31-discovery-data.test.ts`, `b31-scheduled.test.ts`, `b31-data.test.ts`, `b31-calendar.test.ts`, `b31-sync.test.ts`, `b31-guards.test.ts`, `b31x-gaps.test.ts` (named `b31x` so the mutation script could pick it up after the first run; it stays under that name). **Added (script):** `scripts/bills-b31-mutation-check.cjs`. **Added (doc):** this report.
**Modified (source, 17):** `src/core/dueProvider.ts` (one optional field, `coveredBy`); `src/lib/backupSummary.ts` (one label); Bills `cycleModel.ts` (the `suggestion-reject` fact), `cycleData.ts` (`rejectSuggestion`, `reconsiderRejection`, an edit refusal), `data.ts` (two optional hooks on `createObligation`), `dueProvider.ts` (`coveringId`), `readModel.ts` (rejected pieces join the existing single bulk read; the `ruleShared` category), `todayCards.tsx` and `OverviewPage.tsx` (link maps; the Discover section), `ObligationForm.tsx` (optional `seed`), `ObligationPage.tsx` (the Finance panel), `PaymentUI.tsx` (suggestions above the picker; a fresh-read check for a suggested pick), `PeriodsCard.tsx` (rejections), `ReviewPage.tsx` (the shared-rule group and repair), `bills.css`; Calendar `CalendarPage.tsx` and Today `TodayData.tsx` (one `dropCovered` call each).
**Modified (tests):** `b2-data.test.ts`, `b2-state.test.ts`, `b2-sync.test.ts`: the example name of "a fact type this build does not know" changed from `suggestion-reject` (now a known fact) to `cancellation-notice` (a future B4 name). **No assertion was removed or loosened** (B3's report foretold this: "now `suggestion-reject`, which still is unknown").
**Modified (docs):** `README.md`, `docs/BACKLOG.md`, `docs/CHATGPT-HANDOFF.md`, `docs/module-hooks.md`, `docs/due-provider.md`.
**Not touched:** `src/db.ts`, `merge.ts`, `backup.ts`, `types.ts`, the sync engine, `lib/rules.ts`, `lib/schedule.ts` and every other Finance engine, `ui/TxnRefs.tsx` (the shared picker), `assets/spending.ts` (`spend()`), `lib/txnRef.ts`, `lib/costSource.ts`, `lib/txnLookup.ts`, `services/householdSpend.ts`, the Tasks engine, any Calendar event or layer record, and the three existing Bills source-guard tests.

## 5. Existing Finance detection capabilities, and what was extended

I read `detectRecurring`, `normPayee`, `matchRule`, `suggestCategory`, `recurringFromGuess` (`src/lib/rules.ts`), `occurrencesBetween` / `dueInstances` / `postInstance` (`src/lib/schedule.ts`), the transaction and split model (`types.ts`, `lib/txnRef.ts`, `lib/setupCategory.ts`) and the Scheduled rule and log rows.

**What `detectRecurring(txns, scheduled, today)` returns:** a list of `RecurringGuess` = `{ payee, accountId, amountCents (signed median), frequency, lastDate, nextDate, count, categoryId, varies }`. **No list of dates, no per-payment amounts, no confidence number.**

**What it assumes (read from the code, not guessed):**
- it groups by account and `normPayee(payee)`, keeps one transaction per day, and needs at least three occurrences;
- a pattern is accepted only if the median gap is within a tolerance of weekly (7±1), biweekly (14±2), monthly (30.4±3.5), quarterly (91±6) or yearly (365±8) days and at least 75% of the gaps are within 1.6 times that tolerance;
- the amounts must all have the same sign and at least 60% must be within 15% of the median; `varies` is true below 95%;
- a pattern whose next date is more than two periods in the past is dropped (it probably stopped);
- it leaves out a payee already covered by an active scheduled rule on the same account (substring match);
- it skips transfers and a whole-transaction setup entry.

**Where it is not suitable as-is for Bills:** it does **not** leave out income (all-positive series pass), it counts each account separately (a subscription moved to another card splits into two shorter histories), it does not look inside splits (a split with a setup part is read at its whole amount), it does not know loans, and it cannot show its evidence. Its "already scheduled" exclusion is the opposite of what B3.1 needs (the brief wants to *show* the relationship, not hide the pattern).

**The extension (small, pure, tested, nothing in Finance edited):** `discovery.ts` `cleaned()` is an adapter in front of the **unchanged** detector. It feeds it only money-out, non-transfer, non-setup transactions (a split with a setup part is left out whole), de-duplicated (the same payee on the same day whatever the account, and the same bank id in one account), with the accounts merged, and passes no scheduled rules (the relationship is added afterwards). The detector decides what a pattern is, exactly as Finance does; the adapter rebuilds each pattern's evidence from the same grouping (a test asserts the count, frequency and typical amount equal the detector's own) and adds only observable facts. `lib/rules.ts` and `lib/schedule.ts` were not modified; their pure helpers are reached through the one read-only loader (section 14).

## 6. Discovery algorithm and exclusions

1. `cleaned()` as above. 2. `detectRecurring` runs once over the cleaned set. 3. For each accepted pattern the evidence is rebuilt: dates, amounts, gaps, typical/min/max amount, whether the amount is steady, the most common category. 4. Exactly two payments of nearly the same amount (within 5%), spaced like a known interval, the latest not stale, become *Needs more information* with **no frequency claimed**. 5. Relationships are added: a bill already covering the payee (a word-based match: see section 8), a bill with only a similar name, ended bills, Finance Scheduled spending rules that may stand for it (marked live or switched off, and whether another bill already points at them), and the owner's earlier choices (section 10).

**Never suggested, with the reason shown or counted:** income (money in); transfers; setup entries (a split with a setup part is left out whole); the interest-and-escrow expense Loans writes and any payee that reads as a mortgage or loan (counted: "tracked on the Loans page"); a duplicated entry as a second occurrence; an irregular set of payments (listed nowhere); a pattern that stopped (the detector's stale rule); a payee matching a bill the owner **ended** (counted: old payments never make an ended bill "newly active"); one annual payment (the detector needs three; two annual payments are *Needs more information*, never a cadence). **Never inferred from payment history:** cancellation, renewal, settlement, provider ownership or account access. A Scheduled rule is shown as "a plan; it does not show payments happened".

## 7. The three-tier suggestion approach

*Discovery tiers (derived only from what can be seen; never a percentage):* **Strong pattern** = the detector accepts it and every gap is inside its tolerance with at least 4 payments of a steady amount, or at least 6 of a varying amount (a utility); **Possible pattern** = accepted but with fewer payments, a changing amount, or a gap or two outside the tolerance (a quarterly or yearly pattern with exactly three payments is always only "possible"); **Needs more information** = two payments, no cadence claimed. Anything weaker is not listed.

*Match tiers (B0 4.7, honored; weaker than "possible" is not shown at all):* **Looks like the payment** (strong): posted from the bill's linked Scheduled rule for that date, OR the payee matches what Ledger knows about the bill, the date is within 3 days of the due date and a RELIABLE amount matches. **Possible match**: the payee (or the linked rule) points at the bill, the date is inside the usual window, and nothing contradicts it. At most three suggestions, plus at most three in the separate "already linked somewhere else" list.

## 8. Payment-match scoring, evidence and limits

`suggestMatches` is pure and deterministic. It uses **independent signals**, each stated in words, with a separate list of what is uncertain:
- **Payee** (`payeeMatch.ts`): Finance's own `normPayee`, then WORDS, ignoring filler words ("co", "bill", "pay") and industry words ("power", "water", "insurance", "premium"). *exact* = one whole name sits inside the other and they share a significant word; *partial* = they share a significant word only. "Another Power Co" is not "Example Power Co"; "STREAMLY*PREMIUM 8841" is "Streamly Premium"; a short generic bill name such as "Rent" never matches alone. A payee word the owner approved is trusted as written.
- **Date:** B0's windows: manual due −7 to +10 days, automatic −2 to +7 (around the actual due date when exactly one is recorded, else the nominal one).
- **Amount, only when reliable:** a recorded bill or a fixed price (exact or within 1%; after a partial payment the remainder also matches); a variable bill is judged against its own earlier linked payments (inside their range) and its amount is **never a reason to leave a payment out**.
- **Linked Scheduled rule:** only the posted log and the posted transaction count. **Not** "the date passed". A skipped entry is not evidence.
- **Category** as a minor hint.

**Limits:** an equal amount alone is never a suggestion; the same amount at a different provider is not; a weak payee resemblance needs a reliable amount match; money coming back is never suggested as a payment (a refund from the same payee within 60 days *after* a payment is noted against it and asks for a closer look); transfers and setup entries never; a piece already linked to this period never; a piece linked elsewhere goes to a qualified list with a plain warning ("a real payment can be shared by two bills; linking it here counts it once and never divides it"). Ordering is a fixed tuple (tier, rule posting, payee strength, closeness of date, whole before part, transaction id), so the same data gives the same answer in any input order. **Not done:** fuzzy character matching, learned weights, any network or AI call. If the data is insufficient the result says so ("No payment in Finance looks like this period yet…") and still offers the way out; it never claims a match.

## 9. Confirmation and rejection flows

*Confirming:* "Use this payment" sets the same `picked` reference the picker does, so the existing `planFact` preview ("What will happen") and the unchanged `recordFact` validation apply: same piece twice refused, a whole beside its part refused, a missing or restructured piece refused, the typed-to-Finance switch explicit. Before writing, a suggestion-sourced pick is checked again against a FRESH Finance read (`suggestionStale`); a payment deleted, edited, restructured or turned into a transfer while the owner was reading is refused in words and nothing is written (tested at the writer and the pure check). Opening the dialog, viewing and selecting write nothing (browser-verified: no table changed until Link this payment). There is no separate payment-link writer.

*Rejecting:* `rejectSuggestion` writes one `suggestion-reject` cycle fact (`{ obligationId, slot, fact, ref }`). Scope is the **billing period** (rejecting November says nothing about December; a test with the SAME transaction inside two periods' windows proves it). Idempotent (same operation or same piece reuses the record). Added or removed (soft delete, history kept), never edited (`editFact` refuses). It creates no Task, marks nothing paid or skipped, counts no money and changes no Finance row. Guarded Undo; "Look at it again" (`reconsiderRejection`) is guarded against a stale record. A rejected piece that has since changed in Finance (or whose split moved) is **not** reinstated as a strong match: it returns as "possible" with a plain warning, and the reject list says why ("changed in Finance since", "its parts were changed", "no longer in Finance"). A damaged rejection is read as unreadable (kept exactly, rejects nothing).

## 10. Candidate dismissals and persistence

Storage was chosen after reading the existing patterns: a **device-local preference was rejected** (a dismissal on the phone would return on the laptop); a new table was ruled out (no schema change). The choices are ordinary `bills` module records of a new kind `discovery`, one record per choice, so two devices that decide differently keep both and the newest decides (older ones stay as history). Fields: `key` (`p:` + normalised payee), `decision` (`not-recurring`, `dismissed`, `tracked`), `on`, optional `obligationId`, `op`, and a small `snap` (`f`, `n`, `last`, `cents`). **No transaction id, no payment list, no per-payment amount.** Named in the backup summary ("Recurring-expense review choices").

- *Not a recurring expense:* hidden until the pattern materially changes. *Dismiss for now:* hidden for 60 days, then it may return on its own. *Already tracked / Link to an existing bill:* hidden while that bill is in force; if the bill is deleted or ended the choice stops hiding anything.
- **Materially new** = a cadence appears, changes or is lost (two payments becoming a pattern), at least double the evidence and at least three more payments, or a fixed typical amount that moved by more than 25%.
- A review path always exists: *Set aside* lists every hidden pattern with **Look at it again** (guarded, undoable). Damaged choice records are ignored and never rewritten.

## 11. Finance Scheduled link, prefill and drift

*Link (`scheduledRuleIds`, an existing field; Finance's rows are never written).* Eligible = a Scheduled **spending** rule that exists. Refused with a reason: income, transfers, missing or deleted rules, a rule another bill in force holds, an ended bill, a loan bill, a sixth rule. Allowed with a warning: a switched-off or ended rule (shown as inactive). The dialog lists spending rules (rules another bill holds appear with the reason; income and transfers are only counted), previews the rule (payee, amount, repeats, account, state), states that Finance owns the payment, and confirms. The link is removable (previewed, guarded Undo). The write is one transaction that re-reads the bill, refuses a stale form and re-checks the rule rules.

*Two offline devices.* Both pointers are kept; the conflict shows on both devices (Needs review, Today and the Overview count it as "N Finance scheduled payments are linked to more than one bill"); the repair is explicit and previewed: **Keep it on this bill** (removes the pointer from the others; refused if any holder changed since), or **Leave as is** (remembered for exactly that set of bills; a new holder is a new problem). Tested with the real `SyncEngine` on two devices.

*Deleted or disabled rule.* The bill is kept; the pointer reads "not on this device, or it was deleted" or "switched off in Finance"; the bill's payment status never changes; no substitute rule is made (tested and browser-checked).

*Prefill.* `scheduleFromRule` (B0 mapping): weekly, biweekly, monthly, quarterly, yearly and semimonthly (two days; 31 = last day) become exact Bills schedules Bills accepts. A recurrence Bills cannot hold (two payments that would meet on one day of a short month) is **explained and left for the owner**, never silently substituted. Provider: an existing Contact with the same name is reused (no second Contact). No historical payment is copied. A bill can also be made from a suggestion's Scheduled rule in one step with the link offered as a checkbox (default on, validated in the same transaction).

*Drift (read-only).* Compared: missing, switched off / ended, bill ended or paused, cadence, a schedule the owner changed while Finance still runs the earlier pattern, no schedule, amount, and next dates. **Explained differences are `info`, said once and calmly** (a varying bill, a price that starts later such as an introductory price, a few days between the plan-to-pay date and the due date, a paused bill, dates before the tracking start); only an unexplained disagreement is `check` ("Worth a look"). Nothing is ever changed, posted, skipped or ended by a drift notice.

## 12. Cross-layer Calendar deduplication: the decision

Duplicate suppression is a **display decision**, made in two small steps. (1) The Bills provider marks an expected-payment marker `coveredBy` the id Finance gives its own marker only when ALL hold: the bill links the rule; the rule is a live spending rule; Finance offers it on THE SAME DATE; no posting or skip is logged for it; no unresolved drift. (2) A display filter (`calendar/markerCoordination.ts`) leaves the covered item out ONLY while the covering item is itself being shown. This deliberately differs from B0 4.3 (where the provider itself would omit its marker): provider-side omission cannot know which layers the owner has switched off, and would make both markers disappear. Nothing is deleted, stored or re-identified; ids and phone-calendar ids are unchanged; no stored occurrence exists (a test counts `dueItems` and every table).

## 13. Finance action visibility safeguards

The Finance Scheduled marker (the owner's Approve action) is **never the item hidden**: only an open covering item counts, an item that is itself covered never covers another, and the filter never removes a Finance item. When the Finance layer is switched off, the Bills marker returns (browser-verified: Finance off, Bills marker back; Finance on, the Bills marker stepped aside and the Finance markers, including a still-unapproved earlier one, stayed). Both stay when: dates differ (a payment-action date versus a due date); schedules differ; an amount or cadence disagreement is unresolved; the rule is off, ended, income, a transfer or missing; the bill ended; or the Finance item was approved or skipped (a posting is not proof of payment, so the Bills marker returns). Renewal, cancel-by and trial-end markers and reminder Tasks are never covered. **Not done, by design:** Household Services contract markers are not coordinated (no reliable link exists yet; B4's `bills-for` link is the prerequisite).

## 14. Finance non-mutation evidence

- **One read-only loader**, `src/lib/financeRead.ts` (`loadAllTxns`, `loadTxnsBetween`, `loadScheduled`), following the rule B3 set for `txnLookup.ts`. A guard test fails if it gains any write call, a transaction, a posting function, a forecast or import, a network call, or an extra export; another pins exactly which Bills files may import it. The existing B3 guards (no Bills file mentions `.txns`, `.recurring`, `.recurringLog` or `.loans`; none imports `lib/rules`, `lib/schedule` and the others) were **not weakened** and pass over every new file.
- A byte-for-byte Finance snapshot (every non-shared table, including each transaction's status and `recurringId` and the rule and log rows) is identical around: viewing suggestions (3 repeated loads), rejecting, reconsidering, confirming a link, linking and unlinking a rule, `keep it on this bill`, creating a bill from a suggestion or a rule, discovery loads, review choices, and the Calendar providers (3 repeated loads, together with the shared tables and zero stored `dueItems`).
- No Bills code posts, skips, edits or deletes a rule (guard), reads Bills amounts into the forecast, or creates a Finance transaction.

## 15. Split and shared-payment protection

A split transaction offers its whole and each money-out part as separate pieces, each judged on its own amount (a reliable amount offers only the piece that matches; after a partial payment the remainder matches a part). A whole is never offered when one of its parts is already linked to the period, and the reverse (shared `overlaps`); the confirmation's existing rule still refuses a whole beside its part. A split with a setup part is not a payment (whole excluded, setup part never offered). Reordered parts: a rejected part whose parts moved is not trusted as the same part (state `split-changed`, possible only, flagged). A piece linked to another period, another bill, or used by Household Services or Home & Assets (read through the shared `readTxnRefs` only) goes to the qualified "elsewhere" list with a warning and is never divided or auto-attributed.

## 16. Simulated two-device sync and backup

Real `SyncEngine` with two devices (which also syncs Finance) and the real backup export, checker and restore (`b31-sync.test.ts`, 10 tests): a rejection made on A reaches B; two devices rejecting DIFFERENT payments offline keep both on both; both rejecting the SAME payment keep both records (nothing silently discarded) and read it as rejected once; A reconsidering while B rejects another keeps the right union; a rejection never changes the Finance rows it points at; one rule linked to two bills offline keeps both pointers and shows the conflict on both devices, and "keep it on this bill" on one device resolves it on both (the rule untouched); a "not recurring" choice on A hides the suggestion on B and B taking it back shows it on A; two different choices about one pattern are both kept and the newest decides; a backup with a rejection, a review choice and a linked rule restores to the same suggestions, hidden patterns and link with the Finance tables equal; unknown fields on a rejection and a choice survive backup and restore. **Not tested:** real devices, offline use, a real older build (see sections 18 and 21).

## 17. Undo, transactional rollback and mutation tests

- **Guarded Undo** (the same local guard: the touched rows' fingerprints are sealed and Undo refuses, writing nothing, if any changed) covers rejection, reconsidering, a review choice, linking and unlinking, `keep it on this bill`, and bill creation from a suggestion. Each has a "refused after an intervening change" test.
- **Injected failures** (Dexie hooks, as in B3) leave **no partial records**: a failed rejection write; a failed review-choice write; a failed bill creation from a suggestion where the failure is in the *second* write (the "tracked" record), which rolls back the bill AND the new Contact; a failed link write; and refusals (income, held rule, deleted rule) that stop the whole bill creation before anything remains.
- **Double submit:** a repeated press with the same operation id writes once (rejection, choice, bill creation, "link to existing bill"); the same piece rejected again reuses the record; a second link of the same rule is visibly refused.
- **Mutation checks** (`scripts/bills-b31-mutation-check.cjs`): **66 mutations; 65 caught; 1 equivalent.** The first pass caught 58 and left 8 standing, each an honest finding:
- **SG4** (a rejection applies to every period), **SG15** (a weak payee needs no reliable amount), **SG16** (a passed Scheduled date counts as evidence), **CD7** (a repeated operation id writes again), **DD6** (a damaged review choice is trusted) and **RM4** (a shared rule is never counted) were real **test gaps**. Each was closed with a test (`b31x-gaps.test.ts`) and re-run: all caught. For **SG16** the first mutation was itself badly placed (inside a loop that never runs when the log is empty); it was rewritten to inject the fault where it matters, and is caught.
- **CP2** (a marker covered after the Finance item was approved) survived only because a second rule hid it, and that second rule turned out to be a **real defect**: after the owner approves a Scheduled item in Finance, the drift check compared the bill's next date with Finance's next *unapproved* date a whole period later and would have shown a false "30 days apart" warning. Drift now compares the bill's next date with the rule's occurrence nearest to it, approved or not (regression test added; CP2 is now caught).
- **DS13** is an **equivalent mutation** (the guard it removes is unreachable, because `detectRecurring` never returns a frequency outside the list). Left as is, and reported rather than hidden.

The categories covered: suggestion rules (identity, amount, windows, rejection scope, posted log, refunds, transfers, whole and part, tier), payee words, discovery (income, transfers, duplicates, cadence claims, ended and loan payees, snooze, material change, tiers, newest decision), Scheduled eligibility and conflicts, drift levels and prefill, Calendar covering (dates, approval, drift, rule state) and the display filter, rejection and choice writers (idempotence, staleness, edit refusal), bill creation (rule check, tracked record, repeat press), link writers, and the Needs-review count. The script restores every file after each run and at the end (verified: the full suite is green on the restored tree). It does not cover the React screens; their behaviour is covered by the browser checks below, not by mutation.

## 18. Browser acceptance

**Method, and what it is not.** The built-in browser pane (not a physical device) with its own database. It held leftover **invented** data from earlier acceptance runs (Example Checking, Example Power Co and similar; verified before clearing), so it was emptied and re-seeded with invented data through the app's own modules (Example Checking and Savings, Streamly Premium, Example Gas Co, Example Water Co, Example Gym, an employer, a savings transfer, an irregular store, two Scheduled rules). Today in the pane was 2026-11-07. **The pane was hidden for this run: screenshots timed out and real pointer clicks were refused**, so controls were operated at DOM level (`element.click()` on the real React controls, a dispatched Escape key) and every result was read back from the page text, the accessibility labels, measured geometry, computed colours and the database. **No screenshot review, no real mouse, and no real keyboard Tab walk of the new screens were done.** 375 px was viewport emulation; dark was colour-scheme emulation; both were reset afterwards and the dev server was stopped.

| Journey | Result (DOM-level, read back from the page and the database) |
|---|---|
| **A. Discover recurring expenses** | Discover section listed the steady subscription and the varying utility as *Strong pattern*, the two-payment gym under *Needs more information (1)*; income, the savings transfer and the irregular store were absent. **Review** showed why, what is uncertain, five dated payments and the matching Scheduled rule ("a plan"); **no table changed** after opening it. **Create a bill from this suggestion** opened the normal form prefilled (banner, amount, "same each time", a new provider, two opt-in checkboxes). **Add** wrote a bill, one "tracked" record and the owner-approved rule link; only `contacts` and `moduleRecords` changed; **no billing-period fact, no Finance table**; the page opened on the new bill with its Finance panel. *A defect was found and fixed:* the prefilled title was the raw bank text ("STREAMLY*PREMIUM 8841"); it is now tidied to "Streamly Premium" (unit-tested; the live bill was made before the fix, so the tidy title itself was verified by test, not in the pane). |
| **B. Find and confirm a payment** | In the existing dialog: the exact payee-and-amount payment and a split transaction's whole (also the exact amount) were offered as "Looks like the payment" with evidence; "Another Water Co" (same amount, different provider) and the split's 70/50 parts (the bill's amount is reliable) were **not**. **Use this payment** wrote nothing and went to the usual preview. **Not this payment** wrote **one** record (`moduleRecords` only, November, a reference only); it **survived a full reload**. Confirming wrote **one** link; **Finance byte-identical**; the period read "Paid / Recorded in Finance: pending". |
| **C. Finance Scheduled link** | The link dialog listed the free rule with a Preview, the rule another bill holds as unavailable with its reason, and previewed what would happen ("Finance controls the scheduled payment"). Confirming wrote only a bill record. The panel showed payee, amount, repeats, next date, account, state, an "Open in Finance" link, and a calm "Worth a look: expects $120.00 but Finance schedules $115.00". A payment approved in Finance (by Finance's own posting code) was suggested only as a *Possible match*, "From your linked Scheduled payment", with "you approved that posting yourself; it does not show the provider was paid" and the amount difference listed against it. Switching the rule off showed "Switched off in Finance"; deleting it showed "not on this device, or deleted"; **the bill and November's "Paid" were unchanged and no rule was recreated.** *Not exercised in the browser:* Remove this link (unit-tested). |
| **D. Calendar** | With the amounts disagreeing both markers showed. After the Finance rule agreed with the bill the Bills marker stepped aside and the Finance markers (including a still-unapproved earlier one) stayed. **Finance layer off: the Bills marker came back; on again: it stepped aside again**; the stored visibility preference was restored. *Unit-tested but not browser-checked:* a Bills reminder Task on another date, contract-deadline markers, Personal only, the .ics file. |
| **E. Adverse data** | A look-alike at another provider and a split's parts were not suggested; the rejected piece stayed rejected; a deleted or disabled rule behaved as above; a Scheduled rule given to two bills (written directly, as sync would deliver it) appeared as **One scheduled payment linked to two bills (1)** under Needs review with *Keep it on …* for each bill and *Leave as is*; **Keep it on "Example Water Co"** previewed, applied, left that bill linked and the other unlinked with an audit entry, and the conflict disappeared; Finance unchanged. Income and transfers that look like bills were absent from Discover. *Not exercised in the browser:* a missing (deleted) transaction behind a rejection or link (unit-tested), duplicate imports (unit-tested). Two equal-amount candidates were both offered, and the owner chooses. |

**UI acceptance.** *375 px:* the Overview with Discover, the Review dialog, the prefilled form, a bill page with the Finance panel, and the Link dialog with suggestions all measured `scrollWidth` 375 with no overflowing element, dialogs inside the viewport (12 px margins), and **no control under 44 px** in the dialogs (none under 36 px on the pages). Needs review was read at the pane's default width only. *Keyboard:* **Escape closed the Review dialog and focus returned to the button that opened it** (a dispatched key event, so a real-keyboard Tab walk is still NOT done). *Hide Amounts:* with it on, **no money figure** appeared in Discover, the Review dialog (7 masked), the Finance panel or the suggestions (including the accessibility labels). *Light and dark contrast* (computed colours, composited over the real backgrounds): evidence text 16.4 / 15.2, small muted help 4.97 / 7.10, tier chip 4.92 / 5.56, primary button 5.85 / 6.76 (light / dark), all at or above 4.5:1. *Empty, loading and error states:* "Looking at your Finance history…", the nothing-found sentence, "Ledger could not read your Finance history just now", "Looking at Finance…" and "Ledger could not look for suggestions just now" exist (the first two and the no-match message were seen; the two error states are code-reviewed only). *Console:* a fresh load logged no app error; 66 Vite hot-reload messages ("Module registered twice") came from the mutation script rewriting source files while the page was open.

**Not verified:** a physical phone, two physical devices, offline use, a real older build, a real screen reader, a real mouse or keyboard Tab walk, screenshots in either theme, custom palettes, the .ics file in a phone calendar, Week and Work-week views. All earlier real-device, offline, screen-reader, custom-palette and Calendar-export acceptance items remain open and are unchanged.

## 19. Privacy, accessibility and performance observations, and final automated results

**Final automated results**

| Check | Result |
|---|---|
| `npm test` | **2,973 tests pass in 164 files** (baseline 2,768 in 155) |
| `npx tsc --noEmit` | clean |
| `npm run build` | succeeds (the existing chunk-size warning only) |
| `git diff --check` | no whitespace errors (only the usual "LF will be replaced by CRLF" notes) |
| Existing Finance, Scheduled, Transactions and imports, Tasks, Calendar, Household Services, Home & Assets, Projects, Sync and backup, Global Settings and Hide Amounts tests | all pass; the only edits to existing tests are the three example-name swaps in section 4 |
| Schema | Dexie version 15, 40 tables (pinned by an existing and a new test); no migration |
| Dependencies | unchanged (pinned by a new test) |
| Network | none (a guard scans every new file and the loader) |

**Privacy.** Nothing new is stored beyond: a `suggestion-reject` reference (transaction id, date, payee text, amount of the rejected piece, the same as a payment link already holds), and a review-choice record holding a normalised payee, the choice, a date, an optional bill id and four small numbers (no transaction ids, no payment list). No account number, note or credential is read, stored or shown; the Finance panel shows an account by its name as Finance already does; nothing in the repository, tests or docs is real (invented payees only). Hide Amounts holds in every new view and dialog (a test checks the words with a masking function; the browser check above looked for figures).
**Accessibility (what was and was not checked).** Native buttons, `details` and `select`; named buttons ("Use this payment: <payee>, <date>, <amount>"); lists with labels; `role="status"` and `role="alert"` for states and refusals; the shared Modal's focus trap and Escape (focus return verified by DOM check). **Not** checked with a real screen reader or a real Tab walk.
**Performance.** Discovery reads the transaction table **once** (one `toArray`, no per-candidate database call; a test with a spy) and scanned about 6,000 payments in about half a second including seeding; a suggestion read uses the date index for a window and the existing single bulk read for stored links (no whole-table read, no per-transaction lookup; about a quarter of a second including seeding 3,000 payments). Pure, deterministic matching over loaded rows; no network, no AI service, no new dependency. The Overview's Discover query re-runs when any table it reads changes (the app's usual live-query behaviour), and shows a loading line while it runs.

## 20. Deviations from B0 or earlier phases

Deviations from B0 (and what each one replaced):
1. **No change to the shared picker (B0 E1 proposed optional `suggested` and initial-filter props).** Suggestions are rendered by Bills above the picker inside the existing dialog, so `TxnRefs.tsx` and every Home & Assets and Household Services caller are untouched.
2. **`suggestion-reject` stores a full `TxnRef`** (transaction, optional split part, snapshot, fingerprint) where B0 3.4 listed only `txnId`, so a rejected split part is recognised as "changed" rather than silently reapplied to a different part, and so it uses the same shared reader and validator as a payment link.
3. **Calendar suppression is a display filter, not provider-side omission (B0 4.3).** Provider-side omission cannot know which layers the owner has switched off and would let both markers disappear; the filter hides the Bills marker only while the Finance marker is shown. Identities do not change.
4. **A new shared read-only loader (`lib/financeRead.ts`)** rather than Bills opening Finance tables. B3's guards (no `.txns`, `.recurring`, `.recurringLog`, `.loans` in Bills; no import of the Finance files that contain writers) are unchanged and pass. Two of my pure readers briefly collided with the crude text check (a field named `txns`, a spread `[...txns]`); the **names were changed to `transactions` and `all`**; no guard was edited.
5. **Review choices are a new KIND of `bills` module record** (`discovery`), not a preference (a device-local preference would not sync) and not a new table.
6. **B0 4.7 "at most three candidates per cycle"** is honoured (three suggestions) with up to three more in a separate qualified "elsewhere" list.
7. **"Remember this payee" (B0's `payeeHints` with consent)** appears as a visible, default-ticked checkbox in the form and in "Link to an existing bill", never silently.
8. **`createObligation` gained two optional hooks** (`before`, `also`) so a bill made from a suggestion writes its "tracked" record and validates its rule link in the SAME transaction. Existing callers are unchanged.
9. **`loadBillsSnapshot`'s single bulk read now also reads rejected pieces**, so a rejection can say whether its piece changed.
10. **Three B2 tests' "unknown fact" example changed** (section 4). **B3's backup test's assertion that the summary "leaks no names" is vacuous** (it calls `.toString()` on an array of objects); I left it alone and wrote a working version for B3.1 (`JSON.stringify`). Worth a look in review.
11. **B0's optional B3.2 (create a Finance Scheduled item from a bill) is NOT built** (it needs approval to touch a Finance page).

Judgment calls (each reversible, none changes a financial rule):
1. **Suggestions: the amount is a reason to leave a payment out only when it is reliable** (a recorded bill or a fixed price, within 1%); a variable bill's amount only adds evidence for or against. 2. **A payment posted from the linked rule is shown even when its amount differs from the bill**, as "possible" with the difference stated (price changes are real). 3. **Payee matching is word-based** with two small word lists (filler words, industry words) so "Another Power Co" is not "Example Power Co"; the lists are a heuristic and are in `payeeMatch.ts`. 4. **Discovery merges accounts** (a subscription moved to another card is one pattern). 5. **Two payments become "Needs more information" only when the amounts are within 5%**, they are collapsed by default and no frequency is claimed. 6. **Loan-like payees (mortgage, loan, "interest & escrow") are left out** by name, since Loans owns them (counted, not hidden). 7. **A payee matching an ENDED bill is not suggested** (counted). 8. **"Dismiss for now" lasts 60 days**; **materially new** means a cadence change, double the evidence plus three more payments, or a fixed amount moved by more than 25%. 9. **An ended bill does not hold a Scheduled rule** (it neither blocks a new link nor makes a conflict). 10. **A switched-off or ended rule can be linked, with a warning.** 11. **A few days between the Scheduled date and the due date is information; more than five is "worth a look"**, compared against the rule's nearest occurrence. 12. **A bill made from a suggestion starts with "payment arrangement: not sure"** (never guessed) and the funding account of the latest payment. 13. **Scheduled rules are listed as "not a bill here" only if no bill matches the payee and no suggestion already shows them.** 14. **Bank text becomes a readable starting title** ("STREAMLY*PREMIUM 8841" becomes "Streamly Premium"), always editable. 15. **Rejection and review-choice writers make no Task** (a rejection changes no period's money).

## 21. Known limitations and owner decisions

**Known limitations:** real-device, two-physical-device, offline, older-real-build, screen-reader and Tab-walk acceptance are NOT done (browser-pane checks and `SyncEngine` simulations only). **A device still on the B3 build reads a `suggestion-reject` as "a record this version cannot read"** (kept exactly, never counted, listed under Needs review there) until it updates; the owner's review choices are a record kind B3 never reads. Discovery finds only weekly, biweekly, monthly, quarterly and yearly spacings with at least three payments (the detector's rules), so a twice-monthly or every-two-months expense is not found; a payee whose name changes (a bank re-labelling) splits into two. Discovery reads a split transaction at its whole amount. Suggestions look only at a window around the due date and show at most three. The "two equal-amount payments" case offers both and leaves the choice to the owner. The Finance panel compares a bill with its rule monthly-style (same cadence only). Household Services contract markers are not coordinated. Old (B3) and new Today wording are unchanged apart from one added line for a shared rule. The B3 report's statement "payments are matched by the owner only (no suggestion exists)" is now out of date.

**Owner decisions (new, plain English; each has a recommended default already in place):**
- **O-6.** Should "Dismiss for now" last 60 days? (Recommended: yes; it is one constant.)
- **O-7.** Should loan-like payees stay out of Discover? (Recommended: yes; Loans owns them. The alternative is to list them with a "tracked on Loans" note.)
- **O-8.** Should "Remember this payee" and "link the Scheduled payment" be ticked by default in the prefilled form? (Recommended: yes, visibly, because a bill with no remembered payee gets no suggestions.)
- **O-9.** Should a switched-off Scheduled rule be linkable (with a warning)? (Recommended: yes.)
- **O-10.** Should an ended bill keep its Scheduled pointer as history while no longer blocking a new bill? (Recommended: yes.)
- **O-11.** Do you want B3.2 (create a Finance Scheduled item from a bill; it touches a Finance page)? (Recommended: not yet.)
- **O-12.** Should the two-payment "Needs more information" group exist at all, or only patterns of three or more? (Recommended: keep it, collapsed.)
Earlier owner decisions O-1 to O-5 (B3 report section 20) are unchanged.

## 22. B4 and B5 prerequisites

**B4 (cancellation, renewal, price history)** can reuse: the `suggestion-reject` and `discovery` patterns (add or remove records, never edit), `matches` for "did it renew / was a payment made after the cancellation date" (suggestions are the after-cancellation check B0 14 names), and `coveringId`-style explicit links for any Household Services coordination. It needs: the `bills-for` link from a Bills obligation to a Services arrangement before Services contract markers can be coordinated; price-step editing; the cancellation facts. B4 must not infer cancellation from the absence of payments (this phase's discovery does not either). **B5 (household-wide union)** is untouched: `householdSpend` and `billsSpend` are unchanged, a suggestion or discovery result never enters a recorded-payment total (only a confirmed `payment-link` does), and the three-module union still needs its own function behind the golden-master gate.

## 23. Exact final Git status

```text
$ git rev-parse HEAD origin/main
ceb0ea81a4e07bc40f65869085b322ea20e0bc0c
ceb0ea81a4e07bc40f65869085b322ea20e0bc0c

$ git status --short
 M README.md
 M docs/BACKLOG.md
 M docs/CHATGPT-HANDOFF.md
 M docs/due-provider.md
 M docs/module-hooks.md
 M src/core/dueProvider.ts
 M src/lib/backupSummary.ts
 M src/modules/bills/ObligationForm.tsx
 M src/modules/bills/ObligationPage.tsx
 M src/modules/bills/OverviewPage.tsx
 M src/modules/bills/PaymentUI.tsx
 M src/modules/bills/PeriodsCard.tsx
 M src/modules/bills/ReviewPage.tsx
 M src/modules/bills/b2-data.test.ts
 M src/modules/bills/b2-state.test.ts
 M src/modules/bills/b2-sync.test.ts
 M src/modules/bills/bills.css
 M src/modules/bills/cycleData.ts
 M src/modules/bills/cycleModel.ts
 M src/modules/bills/data.ts
 M src/modules/bills/dueProvider.ts
 M src/modules/bills/readModel.ts
 M src/modules/bills/todayCards.tsx
 M src/modules/calendar/CalendarPage.tsx
 M src/modules/today/TodayData.tsx
?? docs/BILLS-SUBSCRIPTIONS-B3.1-REPORT-2026-11-07.md
?? scripts/bills-b31-mutation-check.cjs
?? src/lib/financeRead.ts
?? src/modules/bills/DiscoverCard.tsx
?? src/modules/bills/ScheduledUI.tsx
?? src/modules/bills/SuggestionsUI.tsx
?? src/modules/bills/b31-calendar.test.ts
?? src/modules/bills/b31-data.test.ts
?? src/modules/bills/b31-discovery-data.test.ts
?? src/modules/bills/b31-discovery.test.ts
?? src/modules/bills/b31-guards.test.ts
?? src/modules/bills/b31-scheduled.test.ts
?? src/modules/bills/b31-suggest.test.ts
?? src/modules/bills/b31-sync.test.ts
?? src/modules/bills/b31x-gaps.test.ts
?? src/modules/bills/discovery.ts
?? src/modules/bills/discoveryData.ts
?? src/modules/bills/formSeed.ts
?? src/modules/bills/payeeMatch.ts
?? src/modules/bills/scheduledLink.ts
?? src/modules/bills/scheduledLinkData.ts
?? src/modules/bills/suggest.ts
?? src/modules/bills/suggestData.ts
?? src/modules/calendar/markerCoordination.ts
```

49 changed or new paths (25 modified, 24 new). **Nothing is staged, committed, pushed or deployed.** `HEAD` and `origin/main` are both the verified B3 commit. The dev server is stopped and the viewport and colour-scheme emulation are reset. The mutation-result files were written outside the repository; no scratch file is left in it.

**Handoff updated: yes** (`docs/CHATGPT-HANDOFF.md`: header, snapshot, test baseline, a new B3.1 section, roadmap line, risks, change log, next action). **Backlog updated: yes** (new top entry with judgment calls, owner decisions and the not-built list). `README.md`, `docs/module-hooks.md` and `docs/due-provider.md` updated. **Unknown:** the Pages result for B3.1 (nothing of it is on GitHub), and everything on real devices.

**Is B3.1 ready for independent review? Yes**, with the limits in sections 18 and 21. Suggested order for the reviewer: section 14 (Finance non-mutation) and section 12 and 13 (Calendar coordination and the approval-action safeguard), then 9 and 10 (confirmation, rejection and the choice records), 11 (the Scheduled link and the drift fix found by mutation testing), 20 deviations 4 and 10, and the owner decisions O-6 to O-12. Do not commit until ChatGPT's review and the owner's explicit authorization. B4 and B5 have not been started and are not authorized.
