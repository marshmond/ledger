# Bills & Subscriptions B0: architecture, domain design and implementation plan

Date: 2026-11-07. **Revision 2** (see the change summary immediately below). Status: **PROPOSED DESIGN, REVISION 2. It is awaiting a second independent review by ChatGPT and the owner. It is NOT an approved architecture, and Bills & Subscriptions is NOT built. B1 is NOT authorized.**
This is a design-only phase. No application source, schema, dependency, test or runtime state was changed. All example records, names and amounts in this document are invented (the repository is public): no real provider, address, account, card or balance appears here.

How to read this document: section 1 is the plain-English version. Sections 2 to 13 are the design, each with the decision, the alternatives I considered, why I prefer the recommendation, and what it means for the owner in practice. Section 14 is the proposed phase plan, section 15 lists what the owner must decide, and section 18 is the checklist that must be true before B1 starts. Anything I could not confirm is marked **UNVERIFIED**.

## Revision 2 (2026-11-07): what changed, what was kept, what was resolved

**Review verdict applied: REVISION REQUIRED BEFORE B1. The overall architecture was accepted in principle; this revision addresses nine specific concerns and does not redesign the module or widen its scope.** Status after this revision: **still a PROPOSED design, awaiting a second independent review. Not approved. B1 is not authorized.** Where the text of Revision 1 was contradicted, it was replaced, not left beside the new text. Sections 3.4 to 3.5, 4.1a, 4.6, 4.9, 6, 10.4 to 10.5, 12.2 to 12.3, 12.5, 13 (rows 53 to 86 added), 14 to 18 and the appendices are rewritten or new; smaller edits touch 1, 2, 3.1 to 3.3, 3.6, 4.1, 4.7, 4.8, 5.3 to 5.6 and 9.

### R2.1 Changes made

| Review area | Change | Where |
|---|---|---|
| 2. Recorded, pending and settled states | New section on exactly what Finance's `Txn.status` establishes (owner-maintained pending, cleared, reconciled; bank-file evidence; `recurringId`) and what it cannot. Six evidence kinds with labels. A mandatory Finance-status chip. No settlement words | 1 (finding 11), **4.1a**, 6.4 to 6.8 |
| 3. Cycle identity | The date key is replaced by an **immutable period `slot`** (`m`, `s`, `w`, `x`) plus a separate editable due date; a 12-rule normalization contract; duplicate and conflict detection and display | **3.4a**, 5.3, 5.6, 13 rows 53 to 62 |
| 6. Offline and concurrent edits | The `cycle` record becomes **one append-only fact** (kind name unchanged), so concurrent evidence cannot overwrite itself; explicit review and repair; "suggestions regenerate" is withdrawn | **3.4**, **10.4**, 13 rows 81 to 82 |
| 4. Status precedence | Section 6 rewritten: four independent derivations; five mutually exclusive timing classes; amounts (owed, paid, remaining) separate; a fixed-precedence label function; contradiction rules C1 to C5; nine worked examples | **6**, 13 rows 63 to 68 |
| 5. Reconciliation and loans | Conservative B5 extension: S5's `householdSpend` is **not changed**; golden-master gate; a separate three-claimant function; every displayed total defined. Loans: what is actually exposed; default exclusion with "See Loans"; explicit, never inferred, escrow marking | **12.2**, **12.5**, **4.9**, 13 rows 69 to 80, 83 |
| 7. Cancellation review | `reviewForCancelling` becomes `review` (any obligation, neutral wording); `need` is a suggested label; savings only from the owner's list | 3.2, 12.2 T7, 15.A A-11, row 84 |
| 8. B1 proportionality | B1.0 is the date helper only, with a precise copy-and-sweep fallback; **no Undo extraction** (a small local guard); an explicit "B1 does not need" list | 5.2, 10.5, **14 (B1)** |
| 9. Documentation | This summary; all affected examples, acceptance criteria, risks, impact map and readiness list updated | whole document |

### R2.2 Original decisions retained (not reopened)

A new Bills & Subscriptions module on the existing `moduleRecords`; two record kinds (`obligation` and sparse `cycle`); Finance Scheduled items unchanged and authoritative for what they do; Finance transactions as the only source of recorded money; explicit, never automatic, matching; the rolling 12-month derived Calendar layer; limited actionable Tasks; shared Contacts, transaction references and recurrence utilities; read-only cross-module reconciliation; no schema change and no backend; the phase structure B1, B2, B3, B3.1, B4, B5.

### R2.3 Concerns resolved, in one line each

1. **Recorded versus pending versus settled:** Ledger shows Finance's own status and never invents a settlement state (4.1a).
2. **Cycle identity:** a period id that survives a moved due date, a changed schedule day and a business-day change; duplicates and disagreements are shown, never silently merged (3.4a).
3. **Precedence:** timing classes partition every day count; evidence, amounts and timing are separate derivations; paid beats "due soon" (6).
4. **Stored confirmation versus live Finance:** a declaration is suspended, with words, when Finance contradicts it; it never wins silently (6.4).
5. **Cross-module totals:** a separate, gated function; each piece once; typed amounts never matched by value; scheduled forecasts and Project money never added (12.5).
6. **Loans:** exposed data listed; exclusion by default; escrow and insurance handled by an explicit owner mark (4.9).
7. **Offline evidence:** one fact, one record; nothing lost without a merge rule (10.4).
8. **Review list:** any obligation, owner-selected, neutral (3.2, A-11).
9. **B1 size:** date helper only, with a fallback; local Undo; nothing from B2 to B5 pulled forward (14).

### R2.4 Remaining deferrals

Everything in 16.2, plus: a shared Undo framework; the optional Loans line unless approved (A-8); the B3.2 Finance handoff; moving obligation-level price and schedule lists to append-only records (kept as an escalation path, 10.4). Items still **UNVERIFIED** are listed in 16.3, each with a spike and a fallback.

### R2.5 Decisions that genuinely need reconsideration

*Owner level:* **A-3** (the status wording: "Paid" with a mandatory Finance-status line, versus "Payment recorded"), **A-8** (loans now excluded by default instead of read from the schedule) and **A-11** (any obligation may be put on the review list). *Architect level:* **B-21**, the one refinement of an accepted decision (each `cycle` record is one fact rather than one mutable record per cycle), with the demonstrated failure that justifies it and a stated fallback; and **B-20**, the slot identity, where I chose a period-derived id rather than an opaque generated one (so two offline devices that independently record the same logical period land on the same identity with no coordination; an opaque id would make that impossible).

## 0. Stop-gate evidence and what was read

| # | Prerequisite | Result |
|---|---|---|
| 1 | Branch, `HEAD`, `origin/main` | Branch `main`. After `git fetch origin`: `HEAD` = `origin/main` = `6863ac2d389740d54d5998240c688ea0a0ac3a39` (`feat(services): S5 overview, unified household spending and deterministic insights`). |
| 2 | S5 commit exists on `origin/main` | **Yes.** `git branch -r --contains 6863ac2` lists `origin/main`. |
| 3 | Matching GitHub Pages deployment | **Yes.** Public Actions API (`gh` is not installed on this machine): workflow "Deploy to GitHub Pages", run **#67**, `head_sha` = `6863ac2d…`, `event` push, `status` completed, `conclusion` **success** (created 2026-11-07 10:47:52 UTC, updated 10:49:36 UTC). |
| 4 | Working tree clean | **Yes** (`git status --short` printed nothing at the start, and again after the baseline test run). |
| 5 | Handoff and backlog consistent with S5 | **No, and corrected in this batch (documentation only).** Both `docs/CHATGPT-HANDOFF.md` and `docs/BACKLOG.md` still said S5 was "built, uncommitted, not pushed, not deployed" (they were written before the commit). The repository and Actions show S5 is committed and deployed. Section 0 of the handoff and the top of the backlog now say so. Nothing else in them was rewritten. |
| 6 | Baseline | `npm test`: **133 test files, 2,265 tests passed** (35 s). Equals the S5 report. `tsc` and `npm run build` were not run (no code changed). |

The gate is therefore **passed**, and B0 proceeded.

**Revision 2 re-check (2026-11-07, later the same day):** after `git fetch origin`, `HEAD` = `origin/main` = `6863ac2d389740d54d5998240c688ea0a0ac3a39`; the only differences in the working tree are the three documentation files named in Appendix A; Pages run #67 was verified in Revision 1 and no new commit exists. The baseline test run was **not repeated** (no code changed since Revision 1: 2,265 tests in 133 files).

**Read in full or in the parts that matter:** `CLAUDE.md`, `docs/CHATGPT-HANDOFF.md`, top of `docs/BACKLOG.md`, `docs/HOUSEHOLD-SERVICES-S0-PLAN-2026-11-06.md` (headings, sections 0 to 4, 10 and 15 in detail), section outlines of the S5 and G1 reports (their handoff-level summaries were read in the handoff), `docs/module-hooks.md`, `docs/due-provider.md`, `docs/sync.md`. **Not re-read line by line:** the Projects P1 to P5 and Home & Assets H0 to H5 reports (their decisions are summarized in the handoff, which I read in full, and I read the code they produced).

**Code actually inspected:** `src/types.ts` (`RecurringRule`, `RecurringLog`, `Txn`, `BudgetTarget`), `src/lib/schedule.ts`, `src/lib/rules.ts` (including `detectRecurring`), `src/lib/csvImport.ts` (matching), `src/lib/forecastLive.ts`, `src/lib/calendarLive.ts`, `src/lib/loanLedger.ts`, `src/lib/txnRef.ts`, `src/lib/costSource.ts`, `src/lib/txnLookup.ts`, `src/lib/txnProject.ts`, `src/lib/dates.ts`, `src/core/recurrence.ts`, `src/core/store.ts`, `src/core/registry.ts`, `src/core/entities.ts`, `src/db.ts`, `src/lib/sync/merge.ts`, `src/lib/sync/track.ts`, `src/lib/backupSummary.ts`, `src/pages/ScheduledPage.tsx`, `src/modules/ledger/dueProvider.ts`, `src/modules/ledger/fromEvent.ts`, `src/modules/ledger/quickAddDef.tsx`, `src/modules/calendar/eventTypes.ts`, `src/modules/calendar/model.ts` and `data.ts` (layer ids and seed), `src/modules/tasks/model.ts`, `src/modules/assets/spending.ts` (signatures), `src/ui/TxnRefs.tsx` (the picker), and in Household Services: `model.ts`, `schedule.ts`, `semimonthly.ts`, `plannedVisits.ts`, `contract.ts`, `dueProvider.ts`, `todayCards.tsx`, `householdSpend.ts` (header and types), `records.ts`, `undo.ts` (header).
**Not inspected (limits):** the Reports module, the Finance Home and Budget pages beyond grep, the Tasks editor UI, the Calendar views, the sync engine and backup restore code beyond the parts named, and any real device. I did not run the app in a browser (nothing to verify in a design phase).

## 1. Executive summary (plain English)

**What Bills & Subscriptions should be.** A calm place that answers: what do we owe regularly, what does each thing cost, when is it due, who pays it (us by hand, or the company automatically), has it actually been paid, what is about to renew, and what must I do by what date if I want to stop it. It must never become a second accounting system.

**The one idea that keeps it safe: five different things, kept apart.**

| Thing | What it is | Where it lives | Example |
|---|---|---|---|
| **Obligation** | The standing commitment: what, to whom, how often, roughly how much | New Bills record (`obligation`) | "Streamly Premium, monthly, about $15.49" |
| **Expected occurrence** | One billing cycle: a due date and an expected (or unknown) amount | **Worked out on demand** from the obligation; a small stored **cycle** record exists only when something real is recorded about that cycle (an invoice amount, a "paid" confirmation, a skip) | "Due 12 Dec 2026" |
| **Payment arrangement** | How you intend to pay: autopay, by hand, unknown | A small field on the obligation | "Automatic, from the joint checking account" |
| **Actual payment** | Money that really moved | **Finance transactions, only referenced, never copied** | the card charge on 12 Dec |
| **Lifecycle** | Trial, active, paused, ended; renewal and cancellation facts | Fields on the obligation | "Cancel by 28 Feb; renews 14 Mar" |

**The rules that follow from that (the heart of the plan):**
1. **A payment method is not proof of payment.** "Autopay" means "expected to be collected", never "paid". A cycle counts as paid only through evidence you confirm: a link to a Finance transaction (shown with **Finance's own status**, pending, cleared or reconciled, which Ledger never upgrades or invents), "I paid this outside Ledger" (with a date, and an amount if you know it), or "paid in full" with no amount. "Recorded in Finance" is never described as "cleared by the bank" (section 4.1a).
2. **Ledger may suggest a matching transaction, but never links it silently, and a suggestion never counts as a payment.** One tap confirms it.
3. **"Not confirmed paid" is not "unpaid".** The word *Overdue* is used only when the evidence supports it (section 6.4).
4. **Finance stays the only place money is recorded.** Bills never creates, edits or deletes a transaction, never posts a scheduled payment and never feeds the cash forecast.
5. **Your existing Finance Scheduled items are left exactly as they are.** They are payment *instructions* (and they also carry income and transfers, and feed the forecast), so they cannot safely be converted into bills. A bill can optionally point at one.
6. **Future dates are worked out, not stored.** The Calendar shows a rolling 12 months of expected dates, nothing is pre-created, and Tasks exist only for the one next thing that needs *you* to act.
7. **Reminders are not actions.** A "cancel by" reminder never cancels anything, a renewal date never renews anything or creates a transaction, and a price estimate is never a payment.
8. **History is never erased by ending or archiving something.** An obligation with history cannot be permanently deleted.
9. **Nothing sensitive is stored that a link can replace.** No account numbers, card numbers, passwords or access codes. The provider is an ordinary Contact. Hide Amounts covers every figure.

**What it reuses (no new engines):** Contacts for providers; Finance transaction references, the one-source-at-a-time rule and the "each payment counted once" totals from Home & Assets and Household Services; the existing recurrence generator and the small twice-a-month helper for dates; Tasks for the one actionable next step; a new read-only Calendar layer built the same way as Household Services'; the Today card, Search and Quick Add hooks; the Household Services pattern for Overview, insights and Undo.

**What changes outside the new module is tiny:** one line to register the module, one new Calendar layer id, one backup-summary label, and (as small test-protected moves) pulling the twice-monthly date helper and the Undo guard out of Household Services so Bills can share them. **No schema change, no migration, no new table, no dependency, no backend.**

### Eleven things worth knowing that I found in the code

1. **Finance scheduled items are posting templates, not bills.** A `RecurringRule` is account-bound (account, payee, signed amount, category or transfer account, memo, one of six frequencies). It also carries *income* and *transfers*. "Approve" posts a **pending** transaction and writes a log row (`recurringLog`, keyed rule plus scheduled date) and sets `Txn.recurringId`. So a link between an occurrence and its transaction already exists for items posted this way (strong evidence).
2. **They feed other things.** The cash forecast uses them (`forecastLive.ts`), the sidebar badge and alerts and check-in count them, the Finance Calendar layer lists them with a phone-calendar id (`bill-<rule>-<date>@ledger.local`), a Calendar "bill" event can be handed to them, and the "everyday spending" estimate deliberately *excludes* transactions that carry a `recurringId`. Converting, deleting or reinterpreting them would silently change the forecast.
3. **Finance knows only six frequencies.** There is no "every 2 months", "every 6 months", "last business day" or "pay on the previous business day" there. The shared recurrence generator that Tasks, Calendar and Services use does support "every N months", and the Services twice-monthly helper supports last-day and business-day rules.
4. **A hazard in how Finance lists due items.** `dueInstances` walks from the rule's own start date, so a rule whose start date is long ago and which was never approved or skipped shows every missed date as due. Bills must not copy that: it needs a "tracking since" date (section 5.6).
5. **Anything paid outside the scheduled-item flow is counted as everyday spending** by the forecast. If Bills ever added its own expected amounts to the forecast, those payments would be counted twice. So Bills never feeds the forecast.
6. **Quick Add prefix `b` (and the word `bill`) already belongs to Finance** ("Scheduled payment"). Bills needs another prefix. `a`, `svc`, `e`, `$`, `p`, `hs`, `t` and their words are also taken.
7. **The shared Finance reference code is suitable as it is.** `txnRef.ts`, `costSource.ts`, `txnLookup.ts` and H3's `spend()` already do references to whole transactions and to one part, live amounts, stale-reference handling, refunds, de-duplication by `pieceKey`, and "typed amount or Finance link, never both". Small extensions are enough: a "suggested matches" mode in the transaction picker, a read-only "who else references this payment" index, and (B5 only, behind a golden-master gate) a separate three-claimant "recorded payments" function that leaves S5's `householdSpend` results untouched (sections 4.8 and 12.5).
8. **Household Services already solved most of the hard patterns**: a derived 12-month Calendar view that starts after the one open Task, one actionable Task per arrangement, contract dates that never renew anything, an Overview with a pure reader, a guarded Undo, and duplicate detection without deletion. B should copy the patterns, not the code. One piece is private to Services today and is worth a small shared extraction: the twice-monthly/slot date helper (`semimonthly.ts`), with a precise copy-and-test fallback (section 5.2). The Undo guard (`undo.ts`) is **not** extracted in B1 (Revision 2): Bills starts with a small local guard (section 10.5).
9. **A loan payment is two Finance entries** (a transfer for principal and an expense for interest and escrow), and transfers cannot be referenced as spending. A mortgage therefore cannot be "matched to one transaction" like a utility bill. It needs its own, smaller treatment (section 4.9).
10. **There is no Contacts screen and no company field on Contact** (Household Services found the same). Providers stay ordinary Contacts with a name snapshot on the Bills record.
11. **Finance's "pending / cleared / reconciled" is owner-maintained, not a bank settlement signal.** `Txn.status` is set by the person (the Clear button, the reconcile screen) or by a bank-file import (which creates cleared rows and clears a matching manual entry). A manual entry, a scheduled-item approval and a loan payment all start `pending`. Nothing in the model says that a payee received the money or that a payment failed; a return shows up only as another transaction, an edit or a deletion. Bills therefore reports Finance's status as Finance states it and never adds a settlement state of its own (section 4.1a).

### What I am asking the owner to decide

Eleven owner decisions (A-1 to A-11; A-3, A-8 and A-11 changed or are new in Revision 2) are listed in section 15.A, each with a recommended default. Everything else in this document is either an architectural detail for ChatGPT to challenge (section 15.B) or an implementation detail for the build phases.

## 2. Existing architecture inventory: what Ledger already has and can reuse

Verdicts: **Reuse** (as is), **Extend** (small, test-protected change), **Read only** (look, never write), **Avoid** (do not depend on it), **New** (nothing exists).

### 2.1 Finance

| Item | What it is today (read in source) | Verdict for Bills |
|---|---|---|
| `RecurringRule` (`recurring` table) | Posting template: `accountId`, `payee`, signed `amountCents`, `categoryId`, `transferAccountId?`, `memo`, `frequency` (weekly, biweekly, semimonthly, monthly, quarterly, yearly), `startDate`, `endDate?`, `semiDays?`, `active`. Includes income and transfers. | **Read only.** Optional one-way pointer from a Bills obligation. Never converted, edited or deleted by Bills. |
| `RecurringLog` (`recurringLog`) | `{ruleId, date (the scheduled date), action: posted or skipped, txnId?}`; natural key `ruleId|date` (sync collapses duplicates). | **Read only.** Strong evidence for a linked rule. |
| `Txn.recurringId` | Set on a transaction posted from a scheduled item (and on both halves of a scheduled transfer). | **Read only.** |
| `postInstance` / `skipInstance` / `dueInstances` / `occurrencesBetween` (`lib/schedule.ts`) | Approve posts a **pending** transaction; skip logs; due list includes every unhandled date from the rule start through today plus lookahead. | **Read only** (`occurrencesBetween` may be called to learn a rule's dates). **Avoid** copying its backlog behaviour. |
| Cash forecast (`forecastLive.ts`) | Scheduled items are one forecast stream; `estimateEveryday` skips transactions with `recurringId`. | **Avoid.** Bills never writes into it. |
| Finance Calendar layer (`modules/ledger/dueProvider.ts`) | Shows open scheduled items, with title "Payee $amount" and a stable phone-calendar id. | **Coordinate**: Bills suppresses its own marker for a date this layer already shows (section 5.5). |
| Shell badge, alerts, check-in, Search, record source `scheduled:<n>` | Count and list open scheduled items. | **Read only / leave alone.** |
| Calendar event type `bill` and its handoff to a Ledger scheduled item (`createFromEvent`, `fromEvent.ts`) | A Calendar "bill" event can be handed to Ledger, which then owns it. `matchRepeat` shows the mapping limits. | **Leave alone in B1 to B5** (judgment call 15.B-12). |
| `BudgetTarget` (kind monthly, by_date, yearly, repeating) | A **funding goal** for a budget category ("set aside $X every 3 months for a bill"). Not an obligation. | **Avoid merging.** Different meaning; may show a read-only cross-reference later. |
| Loans (`loans`, `loanLedger.ts`, `loanSchedule.ts`) | A loan payment is recorded as a transfer (principal) plus an expense (interest, escrow); the next payment appears on the Calendar from the schedule. | **Read only**, special handling (section 4.9). |
| `detectRecurring` (`lib/rules.ts`) | Finds payees charged on a regular rhythm at least three times, not already scheduled. Pure. | **Reuse** for "find subscriptions in my transactions" (B3.1). |
| `normPayee`, `matchRule`, payee rules | Normalises payee text; category suggestions. | **Reuse** for match scoring. |
| CSV import (`csvImport.ts`) | Marks an existing manual entry (one with no bank id or fingerprint, which includes entries approved from a scheduled item) cleared when the amount matches exactly and the date is within 3 days (`MATCH_WINDOW_DAYS = 3`); keeps the same transaction id. | **No change.** A linked pending transaction that import later clears stays linked (the id is stable). |
| Transaction references (`txnRef.ts`, `costSource.ts`, `txnLookup.ts`, H3 `spend()`, `pieceKey`) | See 4.8. | **Reuse as is** (S3 already moved them to `src/lib`; old asset paths re-export). |
| Project tagging (`txnProject.ts`, `Txn.project`) | A transaction or split can belong to a Project; Project "paid" is worked out from transactions. | **Read only**; show a chip, never add Project money to Bills totals. |

### 2.2 Shared platform

| Item | Detail | Verdict |
|---|---|---|
| `moduleRecords` store (`core/store.ts`) | One table, rows `{module, kind, data, id, createdAt, updatedAt, deletedAt}`; soft delete; time-based ids from `newId()`; unknown fields kept by `repo.put`. | **Reuse.** Module `bills`, kinds `obligation` and `cycle`. |
| Shared `links` | `{fromModule, fromId, toModule, toId, type}`; text ids like `arrangement:12`; `add` is idempotent. | **Reuse.** |
| Contacts (`core/contacts.ts`: `findOrCreateContact`, `validateContact`, `nameKey`) | Name, relationship, notes, phone, email. No type, no archive, no screen. | **Reuse**, store only the contact id plus a name snapshot. |
| `core/recurrence.ts` (`generateDates`, `normalizeRule`, `describeRule`) | Daily, weekly, monthly (date, nth, last weekday) and yearly with `interval` and `end`. Month-end clamping matches Finance. Pure. | **Reuse** (the one recurrence generator). |
| `lib/dates.ts` (`addMonths(iso, n, day)`, `endOfMonth`, `lastBusinessDay`, `priorBusinessDay`, `monthPayDate`) | Month-end clamping and weekend helpers already used by Finance pay dates. | **Reuse.** |
| Due-provider contract and Calendar layers | Read-only, pure, per-provider layer with a fixed built-in id (`..._101` to `..._106`); `ensureCalendarSeed` seeds them (`calendar/data.ts`). | **Extend**: one more layer `..._107` (section 5.4). |
| Today cards, Search source, Quick Add, `records` hook (`core/registry.ts`) | Documented in `docs/module-hooks.md`; ids must start with the module id; start-up rejects clashes. | **Reuse.** |
| Hide Amounts (`loadHideAmounts`, `useMoney` pattern, `maskAmounts`) | localStorage flag; cards receive `hideAmounts`; Services pages read the flag directly. | **Reuse.** |
| Sync (`merge.ts`, `track.ts`) | Whole-record last-writer-wins per table; narrow deletion rules only for Projects and Assets; `NATURAL_KEYS` only for four tables. | **No change** (section 10). |
| Backup (`backup.ts`, `backupFile.ts`, `backupSummary.ts`) | Whole database; module records included automatically; unknown modules listed under "other"; `MODULE_KINDS` gives friendly labels. | **Extend** one label (section 10). |
| Document references (`DocRef {label, url?, note}`, `isSafeUrl`) | Link metadata only, http(s) only, no file storage. | **Reuse** the shape and validator. |

### 2.3 Other modules

| Module | What B reuses | What B must not touch |
|---|---|---|
| Tasks | `createTask`/`saveTask`/`completeTask`; Task unknown-field markers carried through the editor (proved in S1). | Tasks' recurrence engine and editor. |
| Calendar | Layer registration pattern, `derivedId`, `DerivedItem`. | Event recurrence, the `bill` handoff. |
| Household Services | Patterns: `plannedVisits` horizon, `contract.ts` dates, `ensureNextVisitTask`, `servicesOverview`, `insights`, `undo`, `quickAddDef`, `records`, `householdSpend`. `semimonthly.ts` is worth a shared extraction (with a copy-and-test fallback); `undo.ts` is left alone (Bills gets a small local guard). | Its records, link types and Calendar layer `..._106`. |
| Home & Assets | `spend()`, `pieceUsers`, `DocRef`, `isSafeUrl`, warranty/asset links (read only). | Asset and warranty records. |
| Projects | `projectAllocations` (chip only). | Commitments, budgets, Project money. |

## 3. Proposed domain model and example records

### 3.1 Decision: a new module with two record kinds

**Recommended:** a new module `bills` ("Bills & Subscriptions", route `#/bills`) storing two kinds in `moduleRecords`: **`obligation`** (B1) and **`cycle`** (sparse, from B2; **Revision 2: each `cycle` record is one append-only *fact* about one billing period**, see 3.4). There is **no payment record**: payments are Finance transactions, and a `cycle` payment fact is only a reference to one.

**Alternatives considered:**
- *Extend Finance's Scheduled page and `RecurringRule`.* Rejected: a rule is account-bound, carries income and transfers, feeds the forecast, and has six frequencies; adding subscription terms, price history, trials and cancellation to it would change Finance's contract, backup shape and (because the table has a numeric schema) need a migration. It also cannot hold obligations with no account or no schedule.
- *Store everything inside Household Services arrangements.* Rejected: arrangements are about people who come to the home; most bills and every subscription have no visit.
- *One combined record per bill with all its cycles inside.* Rejected: whole-record last-writer-wins would lose a cycle edit made on the other device; the Services decision to keep `visit` separate from `arrangement` applies here too.
- *A new Dexie table.* Rejected: the shared store needs none, and a table means a migration plus backup/sync wiring (`docs/module-hooks.md` step 2).

**Why:** it matches how Projects, Home & Assets and Household Services were built, needs no migration, and lets backup and sync work unchanged.
**For the owner:** a new "Bills" entry appears beside Services. Nothing you have in Finance changes or moves.

### 3.2 The obligation record (kind `obligation`)

Fields grouped by purpose. Everything optional is stored only when set, so an unused feature leaves no trace. Unknown fields are carried through (the Services `KNOWN`/`extras` pattern). Money is whole cents; dates are `YYYY-MM-DD` with no time zone.

| Group | Field | Meaning |
|---|---|---|
| Identity | `title` | "Streamly Premium" (required, trimmed). |
| | `type` | One of: `utility`, `housing`, `insurance`, `telecom`, `childcare`, `subscription`, `membership`, `tax`, `loan`, `other`. A label that drives defaults and filters, never behaviour. |
| | `need` | `essential`, `flexible` or `unsure`. A **suggested label** defaulted by type (subscription and membership: flexible; others: essential) and changed freely by the owner. It filters and groups; it never restricts what can go on the review list (Revision 2). |
| Provider | `providerContactId`, `providerNameSnapshot` | An ordinary Contact (via `findOrCreateContact`), plus a name snapshot so history stays readable if the Contact is removed. |
| Money | `amountKind` | `fixed`, `variable` or `unknown`. |
| | `prices` | Append-only list of **price steps** `{from, cents|null, label}` sorted by `from`; the step in force on a date is the last one whose `from` is on or before it. Holds introductory prices, trials (a step of 0), and increases (a later step). `cents: null` = amount unknown. |
| Schedule | `schedule` | The current schedule (3.3). `null` = on demand. |
| | `scheduleHistory` | Append-only `{until, schedule}` of earlier schedules, so past expected dates are never silently re-derived under a new rule. |
| | `trackingSince` | The first date Ledger expects occurrences (default: the day the record is added; the owner may set an earlier date). Nothing before it is ever derived. |
| | `pauses` | List of `{from, to|null}`; no expected occurrences fall inside one. |
| Payment | `payment` | `{how: 'auto'|'manual'|'unknown', fundingAccountId?: number}`. A Finance account id (name read live). **Not** proof of payment. |
| | `scheduledRuleIds` | Optional pointer(s) to Finance scheduled items (4.3). Usually zero or one. |
| | `payeeHints` | Normalised payee words the owner approved for match suggestions ("streamly"). |
| | `categoryId` | Optional Finance category, used only as a hint for matching. |
| | `loanId`, `paidThroughLoan` | `loanId` marks an obligation of type `loan` that Loans owns (4.9). `paidThroughLoan: true` (owner-set, never inferred) marks insurance or tax already inside the loan payment. Both exclude the obligation from matching and cash totals. |
| Reminders | `reminders` | `{payTask: boolean, leadDays: number}`; `payTask` default on for manual-pay, off otherwise (5.5). `leadDays` (default 3) only sets the pay Task's "do on" date (due date minus `leadDays`); the "Due soon" window is a fixed 7 days for the whole module. |
| Lifecycle | `status` | `active`, `paused`, `ended` (7.1). |
| | `endedOn`, `endReason` | When and why (`cancelled`, `replaced`, `finished`, `other`). |
| | `terms` | `{autoRenews: true|false|unknown, renewalDate, noticeByDate, noticeDays, trialEndsOn}`; all optional. |
| | `cancellation` | `{requestedOn, effectiveOn, confirmedOn, confirmationRef, note}` or null (7.3). |
| | `lifecycle` | Append-only small log `{on, kind, note}` of things the owner recorded (renewed, price changed, paused, cancel requested, ...). Bounded (the reader caps at 200). |
| | `predecessorId` | The obligation this one replaced (set on the successor). |
| Review | `review` | `{on: boolean, note?: string, since?: date}`: the owner's **cancellation or cost-review list**. **Any** obligation may be put on it, including essential ones (the `need` label is only a suggestion; wording for essential items is "review the cost or alternatives", never "cancel"). The only input to "what stopping would change" (12.2 T7). Never inferred from usage. |
| | `acknowledged` | Notices the owner chose to leave (Services pattern). |
| Misc | `refs` | `DocRef[]`: statements, agreements, cancellation confirmations as **links only**. |
| | `notes` | Free text, with the same "never put codes or passwords here" warning as Services. |

### 3.3 The schedule (one model for every billing pattern)

```text
Schedule =
  { kind: 'weeks',   every: 1..52, weekday: 0..6, anchorDate }                 // weekly, every 2 weeks, 4-weekly
  { kind: 'months',  every: 1..24, slot: Slot, anchorMonth: 'YYYY-MM' }        // monthly, every 2 months, quarterly, 6-monthly, annual (every 12)
  { kind: 'twice-monthly', semi: Semimonthly, anchorMonth }                    // two slots every month (reuses semimonthly.ts)
  plus optional end date; or schedule = null for "on demand / irregular"
Slot = { kind: 'day', day: 1..31, adjust: 'none'|'previous'|'next' } | { kind: 'lastDay' } | { kind: 'lastBusinessDay' }
```

`Slot` and its resolver are the ones already in Household Services' `semimonthly.ts`. A one-slot "every N months" schedule and a two-slot "twice monthly" schedule therefore share one date resolver (section 5.2).

### 3.4 The cycle record (kind `cycle`): sparse, append-only **fact** records (Revision 2)

**What changed and why.** Revision 1 stored one mutable `cycle` record per billing cycle. Under the sync rules that is not safe enough: sync is whole-record last-writer-wins, and the "Edits that lost a tie" list is **device-local and capped at 50** (`MAX_CONFLICTS` in `sync/engine.ts`, kept in the engine's own `meta` store). So if two offline devices both add evidence to one cycle record, one device's evidence can vanish, and neither the conflict list nor "suggestions regenerate" is a guarantee of getting it back (a transaction the owner already rejected, or one outside the match window, would not reappear). The brief requires preserving evidence. **The fix keeps the accepted two record kinds** (`obligation` and sparse `cycle`) **but changes the granularity of `cycle`: each record is one recorded *fact* about one billing period, added and never overwritten by another device.** Facts for one period are grouped when read. Two devices adding different facts add different records, which sync as ordinary new records (the existing "record on only one side is added to the other" rule), so nothing is lost and **no `merge.ts` change is needed.**
*Alternative kept as the fallback:* one mutable cycle record per period plus a narrow "union the `txnRefs`" merge rule. It is a last resort because it needs a new rule in `merge.ts`, and the fact model already avoids the failure case.

Every cycle record has `obligationId`, `slot` (the period's identity, 3.4a) and `fact`:

| `fact` | Fields | Meaning | Edited later? |
|---|---|---|---|
| `invoice` | `invoicedCents` (whole cents, **0 allowed** = a confirmed zero bill; absent never means zero), `invoiceDate?`, `dueDate?`, `invoiceNumber?` (optional document reference, at most 40 characters, used only to spot look-alikes, never shown in Search, Calendar or Today, never an account number), `nominal?` (explanatory snapshot) | The household recorded a bill for this period | Yes (small LWW edit; see 10.4) |
| `due-date` | `dueDate` | The actual due date when no invoice is entered (variable-date bills) | Yes |
| `payment-link` | `ref` (one H3 `TxnRef`: whole transaction or one part, snapshot, split fingerprint) | The owner confirmed this Finance piece is a payment toward this period | **No.** Added or removed (soft delete), never edited |
| `paid-outside` | `paidOn`, `cents` (whole cents, or null = amount not recorded) | The owner says a payment happened outside Finance | Yes |
| `paid-in-full` | `on?` | The owner declares the bill paid in full **without** any amount | Yes |
| `skip` | `reason?` | Not billed or not payable this period | Yes |
| `credit` | `cents`, `note?` | A provider credit that lowers what is owed (never a payment) | Yes |
| `suggestion-reject` | `txnId` | "Not this one": a suggested transaction the owner rejected, so it does not return | No (added or removed) |
| *(any fact)* | `supersededBy?` (a record id), `movedFrom?` (a slot) | Repair marks (3.4a) | set only by an explicit owner action |

**One source at a time, kept:** a period's **paid amount** comes from Finance links *or* a typed `paid-outside` amount, never both (the existing `costSource.ts` rule and its switch confirmation, applied when the owner writes). If both exist because two devices wrote one each, the reader uses the Finance links, leaves the typed amount out of every total and lists it for review (this is exactly H3's `both` rule).

### 3.4a Cycle identity and normalization contract (Revision 2)

**Decision: identity is an immutable *schedule-period identifier* (`slot`); the editable actual due date is a separate fact.** Revision 1 used the nominal due *date* as the key. That fails when a schedule revision changes the day (a stored 12 June bill versus a derived 20 June one), when a business-day rule is changed, or when a weekday is changed. A **period** is stable under all of those, so it is the identity.

| Schedule kind | Slot | Example | What it names |
|---|---|---|---|
| `months` (every N months, one slot) | `m<YYYY-MM>` | `m2026-12` | The calendar month of the occurrence. A slot never leaves its month (the existing Services invariant, enforced at save and tested), so the month is stable even when the day or a business-day adjustment changes. |
| `twice-monthly` | `s<YYYY-MM>a` or `…b` | `s2026-12b` | The month plus the slot's canonical position (the lower-ranked slot is `a`, the existing `canonicalSemi` order). Both dates stay inside their month, so month boundaries cannot move a slot to another month. |
| `weeks` | `w<YYYY-MM-DD>` | `w2026-12-07` | The **Monday** of the week that holds the occurrence. Changing the weekday keeps the week; changing the every-N parity may stop producing some weeks (see N3). |
| extra / on-demand / unscheduled | `x<id>` | `x1730000000123456` | A bill that no schedule produced. The id comes from `newId()` when the bill is first recorded. |

**The contract (every rule is a test in B2):**

| # | Rule |
|---|---|
| N1 | `slot` is **immutable** once any fact exists. The only way to change it is the explicit, previewed action "Move to another billing period", which writes the new slot on every fact of that period and keeps the old one as `movedFrom` on each (an audit trail, undoable). |
| N2 | **A due date that moves** (provider says the 20th, not the 12th) changes only the `dueDate` fact; identity is unchanged. |
| N3 | **Schedule revisions and existing records.** Facts keep their slots. A derived period is "expected" only if the schedule in force for it produces that slot. A fact whose slot no schedule produces (monthly changed to every-two-months, or to twice-monthly) is shown under **"From an earlier schedule"**: its payments still count as recorded, it is not an "expected" period, and the owner may move it to a current period (N1). Nothing is deleted or re-labelled automatically. |
| N4 | **A business-day adjustment that moves a date** changes the *nominal date* inside the same month, never the slot. The schedule's adjustment may be edited later without touching any stored fact. |
| N5 | **Two bills on one date.** Different obligations have different `obligationId`, so they never share a period. Two genuinely different bills of one obligation in one period are an `m`/`s`/`w` bill plus an `x` extra bill (the owner chooses "These are different bills", N9). |
| N6 | **Twice-monthly near month boundaries.** `a` and `b` are canonical (rank order, independent of which date a rule falls on); each date is inside its own month by the existing refusals (no adjustment may cross a month, no two slots may meet on one day). A 31st in a 30-day month resolves to that month's last day and keeps its slot. |
| N7 | **The nominal date is derived, not stored as truth.** Timing uses: the agreed actual due date if exactly one distinct `dueDate` exists among non-superseded facts, else the nominal date of the slot under the schedule in force. A stored `nominal` is explanation only. |
| N8 | **Normalization at read:** a fact is read defensively (`readCycleFact`): unknown `fact` values are kept and shown as "Needs review" (never dropped, never counted); slots must match the four patterns or the fact is shown under "Needs review"; `obligationId` must be a whole number; money is whole cents; dates are real calendar dates. Unknown fields are carried through. |
| N9 | **Duplicate and conflict detection** (grouping key `obligationId|slot`; a pure function `cycleConflicts`): two non-superseded `invoice` facts; two `skip`; two distinct `dueDate` values; a `skip` together with any payment evidence; a typed `paid-outside` amount together with Finance links; the same `pieceKey` linked on two periods of one obligation; the same `invoiceNumber` on two periods or extras; two `paid-outside` with different amounts. **No conflict is ever resolved automatically.** |
| N10 | **Display.** The period page lists "Records for this period" newest first, each with its type and the date it was recorded. Facts that agree are shown once with "(recorded twice)". Facts that disagree are shown side by side with three explicit buttons: **Use this one** (the other gets `supersededBy` and moves to History, still visible), **These are different bills** (one moves to a new `x` period) and **Leave as is**. Superseded facts are excluded from every figure but never deleted. A merge of payment links is never needed (links are unioned by `pieceKey`). |
| N11 | **Idempotency.** Each form carries an operation id (the Services pattern: one per open form, so a double press saves once). Opening the invoice form for a period that already has an invoice edits that fact instead of adding a second one. Extra bills that look alike (same obligation and amount and invoice date, or the same invoice number) raise a look-alike notice and are never rejected. Re-importing a bank file does not touch Bills: Finance de-duplicates its own transactions, and if an import is undone the linked transaction becomes a `missing` reference, which is flagged (6.5). |
| N12 | **What conflicts do to figures** (the "do not silently merge" rule): amounts in conflict are not guessed. Conflicting invoice amounts make "amount owed" **unknown** (shown as "records disagree"); conflicting typed paid amounts count as 0 and are listed for review (identical ones count once); conflicting due dates make timing read "Due date unclear" and the Calendar marker uses the nominal date with the detail "due date to be confirmed". **A recorded payment always counts in recorded totals, and a skip never removes it.** |

**Why this meets the nine concerns:** (1) a moving due date changes a fact, not the identity (N2); (2) revisions and old records are handled by "earlier schedule" and explicit moves (N3); (3) a business-day change moves the nominal date only (N4); (4) same-date bills are separated by obligation, or by `x` extras (N5); (5) boundary cases cannot cross a month (N6); (6) two offline devices creating the same logical cycle simply add facts to the same period, and any disagreement is detected and displayed (N9, N10); (7) an unscheduled extra invoice has its own `x` identity (N5); (8) repeated recording is idempotent per form and look-alike-flagged (N11); (9) different due dates are kept as distinct facts and surface as "Due date unclear" (N7, N12).

### 3.5 Example records (invented)

An autopay subscription with an introductory price, on the owner's cost-review list:

```json
{ "module": "bills", "kind": "obligation", "data": {
  "title": "Streamly Premium", "type": "subscription", "need": "flexible",
  "providerContactId": 1730000000123456, "providerNameSnapshot": "Streamly",
  "status": "active", "trackingSince": "2026-11-07", "amountKind": "fixed",
  "prices": [ { "from": "2026-11-12", "cents": 499, "label": "introductory" },
              { "from": "2027-02-12", "cents": 1549, "label": "regular" } ],
  "schedule": { "kind": "months", "every": 1, "anchorMonth": "2026-11", "slot": { "kind": "day", "day": 12, "adjust": "none" } },
  "payment": { "how": "auto", "fundingAccountId": 42 },
  "terms": { "autoRenews": true, "renewalDate": null, "noticeByDate": null, "trialEndsOn": null },
  "reminders": { "payTask": false, "leadDays": 3 }, "review": { "on": true, "note": "check if we still use it" } } }
```

A variable manual bill whose December period has three fact records (an invoice with a later due date, one linked payment, and a typed look-alike that another device added):

```json
{ "module": "bills", "kind": "obligation", "data": {
  "title": "Example Power Co", "type": "utility", "need": "essential", "amountKind": "variable",
  "prices": [ { "from": "2026-01-01", "cents": 9000, "label": "typical" } ],
  "schedule": { "kind": "months", "every": 1, "anchorMonth": "2026-11", "slot": { "kind": "day", "day": 18, "adjust": "none" } },
  "payment": { "how": "manual" }, "reminders": { "payTask": true, "leadDays": 3 } } }
{ "module": "bills", "kind": "cycle", "data": { "obligationId": 1730000000777000, "slot": "m2026-12", "fact": "invoice",
  "invoicedCents": 11420, "invoiceDate": "2026-12-01", "dueDate": "2026-12-20", "nominal": "2026-12-18" } }
{ "module": "bills", "kind": "cycle", "data": { "obligationId": 1730000000777000, "slot": "m2026-12", "fact": "payment-link",
  "ref": { "txnId": 1730000009991000, "snapshot": { "date": "2026-12-19", "payee": "Example Power", "amountCents": -11420 } } } }
{ "module": "bills", "kind": "cycle", "data": { "obligationId": 1730000000777000, "slot": "m2026-12", "fact": "paid-outside",
  "paidOn": "2026-12-19", "cents": 11420 } }
```

The third record is flagged by N9 ("a typed amount and a Finance link were both recorded"): the Finance link is used, the typed amount is left out of totals and listed for review.

An annual obligation with deadlines (an insurance policy) and an extra mid-year bill:

```json
{ "module": "bills", "kind": "obligation", "data": {
  "title": "Home insurance (Maple Insurance)", "type": "insurance", "need": "essential", "amountKind": "fixed",
  "prices": [ { "from": "2026-03-15", "cents": 120000, "label": "" } ],
  "schedule": { "kind": "months", "every": 12, "anchorMonth": "2027-03", "slot": { "kind": "day", "day": 15, "adjust": "none" } },
  "payment": { "how": "manual" },
  "terms": { "autoRenews": true, "renewalDate": "2027-03-15", "noticeByDate": "2027-02-13", "noticeDays": 30 } } }
{ "module": "bills", "kind": "cycle", "data": { "obligationId": 1730000000888000, "slot": "x1730000044444000", "fact": "invoice",
  "invoicedCents": 3500, "invoiceDate": "2026-08-02", "dueDate": "2026-08-30", "invoiceNumber": "A-1042" } }
```

### 3.6 Where the five concepts live (answering the brief's A to E)

- **Obligation:** the `obligation` record.
- **Expected occurrence:** **hybrid, sparse.** Recommended: derive expected occurrences on demand from the obligation (pure function, section 5.2) and persist a `cycle` **fact record** only when something real is recorded (an invoice, a payment link, a declaration, a skip, a due-date change; 3.4), grouped by the period's immutable `slot` (3.4a). *Alternatives:* (a) **persist 12 months up front**: rejected, because it contradicts the owner's standing "do not pre-create 12 months" preference, every schedule edit would have to rewrite many records, and two devices would create overlapping copies; (b) **derive everything and store nothing**: rejected, because an invoiced amount, a payment confirmation, a skip and a match decision are facts that must survive. *Why the hybrid is better:* the stored set stays small (a handful of cycles per year per obligation at most), corrections are edits to one small fact, history is real records, two devices adding evidence cannot overwrite each other, and a schedule change never corrupts the past (because of `scheduleHistory` and period-based `slot` identity). *For the owner:* nothing is created for you in advance. A bill's "record" appears only when you enter an invoice, mark it paid, link a payment or skip it.
- **Payment arrangement:** `payment` on the obligation (plus the optional Finance account and scheduled-item pointer).
- **Actual payment:** a Finance transaction, referenced from a `payment-link` fact on a billing period.
- **Lifecycle:** `status`, `terms`, `cancellation`, `lifecycle` on the obligation. I recommend **one small state set (active, paused, ended)** plus *optional* dated terms. I deliberately do **not** use one big state machine (trial, active, paused, cancelled, expired, renewed, ...) because most bills have no trial, renewal or notice and a single machine would force meaningless states on them. "In trial", "cancellation requested" and "renewal date passed" are **derived labels** from the dates, never stored statuses (section 7).

## 4. Finance integration and scheduled-payment strategy (highest priority)

### 4.1 The thirteen required behaviours at a glance

| # | Required behaviour | Mechanism (recommended) | Phase |
|---|---|---|---|
| 1 | Link to existing transactions without duplicating them | Each confirmed payment is a `payment-link` **fact record** holding one `TxnRef` (H3 shape: `txnId`, optional `splitIndex`, explanatory snapshot, split fingerprint); never edited, only added or removed. Amounts are read live from Finance; the snapshot is explanation only. | B3 |
| 2 | Stable references and existing matching mechanisms | Transaction ids are stable (time-based, kept by sync and backup). Split parts have no ids, so the existing fingerprint rule applies unchanged. Suggestions reuse `normPayee`, the Finance filter used by `TxnPicker`, and (for rules) `recurringLog`. | B3, B3.1 |
| 3 | Missing, changed or deleted transaction | `resolveRef` states: `ok`, `changed` (live amount used, flagged), `missing`, `split-changed`, `not-spending` contribute 0 and raise "payment needs review". The stored link is kept, and no stored declaration silently overrides the live contradiction (6.4). A period that loses its only evidence returns to its timing label. | B3 |
| 4 | Never count a payment twice | Totals use H3 `spend()` over one cost record per period: each `pieceKey` once, a whole transaction covers its parts, refunds lower the total, transfers and setup entries never count. Across modules, one separate union function behind a golden-master gate (12.5). | B3, B5 |
| 5 | Expected, invoiced, scheduled and paid kept apart | Four labelled values, never summed (4.5). | B2, B3 |
| 6 | Variable monthly amounts | `amountKind: variable`: expected is a typical value (median of the last up to six recorded payments, else the owner's estimate), shown with a range; flagged only against a stable history (12.4). | B2, B5 |
| 7 | Partial and multiple payments | A period may hold several `payment-link` facts. Owed, paid and remaining are derived separately (4.6, 6.3). | B3 |
| 8 | Refunds, reversals, credits | A positive piece lowers net paid (H3). A reversal after "paid" returns the period to its timing label, suspends any "paid in full" declaration and raises a review item (6.4, example 4). A provider credit is a typed `credit` fact, never a payment. | B3 |
| 9 | Annual or irregular payments | Annual = `months` every 12; irregular = no schedule, cycles added by the owner. Two lenses are kept apart: cash timing (the full amount on its due date) and averaged monthly (12.2). | B1, B2 |
| 10 | Recognise matches without silently associating | `suggestMatches` (4.7) returns ranked candidates; nothing is stored until the owner confirms; suggestions never count. | B3.1 |
| 11 | Several obligations paid in one transaction | Each cycle may reference the same transaction or its own split. Totals count the piece once; a shared payment is **never divided**; the UI says "shared with N other bills" and points to splitting it in Finance. | B3 |
| 12 | Autopay is not paid | Autopay is a state label ("scheduled for automatic payment"); after the due date plus a grace period with no evidence it reads "Autopay not yet seen in Finance". It never counts as paid. | B2, B3 |
| 13 | Same obligation represented elsewhere | Bills figures and Finance forecast figures are never summed. A Finance scheduled item that looks like an untracked bill raises a "possible duplicate representation" notice, and link-or-ignore is the owner's choice. Cross-module payments use one union. | B3.1, B5 |

### 4.1a What Finance actually says about a payment (Revision 2)

I read the transaction model and every place that sets `Txn.status`. **What Finance provides, and nothing more:**

| Fact | Where it comes from | What it does and does not establish |
|---|---|---|
| `status: 'pending'` | The default for a manual entry (`txnCreate`, the quick transaction form), for **Approve on a Scheduled item** (`postInstance`) and for **loan payments** (`recordLoanPayment`) | "Entered in Ledger, not yet marked cleared." It does not say whether the money has left the account. |
| `status: 'cleared'` | The owner presses **Clear** or edits the status; **a bank-file import** creates new rows as cleared and turns a matching manual entry (same amount, within 3 days) to cleared | "The owner, or a bank file, marked it cleared." For an import it means a bank file listed it. For a hand-cleared entry it means only that the owner said so. |
| `status: 'reconciled'` | The reconcile screen (`finalizeReconcile`) locks the cleared rows covered by a statement check | "Included in a reconciliation the owner completed." Moving a reconciled entry to another account puts it back to cleared. |
| `externalId`, `fingerprint`, `importBatchId` present | A bank-file import created, or matched, the row | "This row appeared in an imported bank file." Optional extra detail. |
| `recurringId` | Set when a Scheduled item was approved | "Posted from scheduled item N." The owner pressed Approve; that is not proof the bank paid. |

**What Finance cannot say:** that the provider received the money; that a bank settled a hand-cleared entry; that a payment failed or was returned (a return appears only as another transaction, an edit or a deletion); or that an approved Scheduled item was actually paid. **Bills therefore invents no settlement state.** It shows Finance's own words and never upgrades them. Balances in Finance count pending entries too (`accountBalance`); reconcile counts only non-pending ones. Bills reads, never writes, `Txn.status`.

**Six kinds of evidence, kept distinct (labels are what the owner sees):**

| # | Evidence | Stored by Bills as | Counts toward recorded-payment totals? | Label (primary line is in 6.5; this is the chip) |
|---|---|---|---|---|
| 1 | A Finance transaction the owner **linked**, status pending | `payment-link` fact | **Yes**, the live amount | "Recorded in Finance: pending" |
| 2 | The same, status cleared (hand-cleared or from a bank file) | `payment-link` fact | **Yes** | "Recorded in Finance: cleared", plus "seen in an imported bank file" when `externalId` or `fingerprint` is present |
| 2b | The same, status reconciled | `payment-link` fact | **Yes** | "Recorded in Finance: reconciled" |
| 3 | **Owner-confirmed link** | this *is* kinds 1 to 2b: the link is the confirmation | as above | "You linked this payment" (detail line) |
| 4 | **Declaration that it was paid outside Finance** | `paid-outside` fact (date, and an amount only if known) | **Yes, only if an amount was entered** (a separate "typed" line, never merged with Finance by value) | "You paid this outside Ledger" |
| 5 | **Declaration that it is paid in full, no amount** | `paid-in-full` fact | **No** (there is no amount) | "You marked this paid in full (no amount recorded)" |
| 6 | **Suggested or inferred match** (including "posted from the linked scheduled item") | nothing (computed; only a rejection is stored) | **Never** | "Possible payment found, not linked" |

**Statements I will not make:** "settled", "bank-confirmed", "received", or "cleared" for anything Finance has not marked cleared. A linked pending transaction is **recorded, not cleared**, and says so.
**Wording decision (flagged B-19):** the primary label is **"Paid"** when a confirmed link or declaration covers what is owed, with the evidence line underneath ("Recorded in Finance: pending"). The alternative is "Payment recorded" as the primary wording everywhere; it is more literal but reads oddly for a bill the owner sees as paid. Either way the second line is mandatory.
**Never written:** Bills never changes a status, never clears a transaction, never posts or approves a scheduled item, and never edits a link target.

### 4.2 Scheduled Finance transactions: the central question

**Facts from the code (section 1, findings 1 to 5):** a scheduled item is an account-bound posting template that also covers income and transfers, posts a *pending* transaction on approval, feeds the forecast, alerts, the sidebar badge, the Finance Calendar layer, phone-calendar ids and the "everyday spending" exclusion, and supports only six frequencies.

**Options evaluated**

| Option | Verdict | Reason |
|---|---|---|
| **(a) Scheduled items remain authoritative payment instructions, linked from Bills records** | **Recommended** | Zero change to Finance behaviour, backup, sync, forecast or phone-calendar ids. Bills adds meaning (provider, terms, history, deadlines) around an unchanged instruction. |
| (b) Convert scheduled items into Bills records | Rejected | It would delete or hide rows that the forecast, badge, alerts and ICS depend on; income and transfers have no obligation meaning; the six-frequency rule cannot hold what Bills needs; old devices would lose the feature. A conversion also cannot be undone safely on a synced household. |
| (c) A shared scheduling primitive used by both | Rejected | Finance's `occurrencesBetween` is a closed six-frequency engine. The shared primitive that already exists is `core/recurrence.generateDates` plus the slot resolver; Finance would have to be rewritten to use it, which the brief forbids and which risks the forecast. |
| (d) Another arrangement | Considered: "Bills creates and owns the instruction" via an explicit handoff (a prefilled Finance form the owner saves). | **Deferred and optional** (section 14, B3.1; needs approval to touch the Finance Scheduled page). |

**What "linked" means (exactly):** the obligation stores `scheduledRuleIds: number[]` (the rule ids). It is a **pointer from Bills to Finance**. Finance's table is not changed and does not know about it. The link gives Bills: (1) a read-only "Payment instruction in Finance" panel (frequency, next date, amount, account, active or not); (2) **strong evidence** for matching (a transaction posted from this rule on scheduled date D, found through `recurringLog`/`Txn.recurringId`); (3) a **drift notice** when Bills and the rule disagree (dates or amount), informational and never auto-fixed.

**Link rules:** only a spending rule can be linked (`amountCents < 0`, no `transferAccountId`); one rule feeds at most one obligation (checked when linking, and detected and flagged, never auto-resolved, if two devices link the same rule); a deleted or not-yet-synced rule shows "not on this device" or "deleted", never "paid" or "unpaid".

**Mapping a rule to a schedule** (used to prefill a new obligation from a rule, with a preview; the rule is untouched): weekly = `weeks` every 1; biweekly = `weeks` every 2; monthly = `months` every 1 on the start day; quarterly = every 3; yearly = every 12; semimonthly = `twice-monthly` (`semiDays` 31 = last day). The reverse (obligation to rule) cannot express every-2-months, 6-monthly, last business day or "previous business day", so it is never offered silently: the owner picks the closest Finance option or declines (the same stance as `matchRepeat` in `fromEvent.ts`).

**Migration and compatibility strategy:**
- **Nothing is migrated, deleted or reinterpreted.** Existing scheduled items keep working exactly as today whether or not Bills exists.
- **Adoption is optional and explicit.** A "Bills you may not be tracking" list (B3.1) can show scheduled spending items and `detectRecurring` guesses that no obligation covers; "Track as a bill" opens a prefilled form; saving creates an obligation and the pointer. The rule is not edited.
- **Backup/sync:** the obligation holds only rule ids. Rules keep syncing as before. A restore that replaces rules keeps the same ids, so pointers still resolve; if ids differ the pointer shows "not found" (never wrong data).
- **Old builds:** they ignore the `bills` module records (rows in `moduleRecords`) and keep running scheduled items unchanged.

### 4.3 Calendar and forecast: no double counting with Finance

- The Finance Calendar layer already shows each open scheduled item. When an obligation is linked to a rule, **the Bills layer suppresses its own marker for any date the rule's open instances already show** (computed with the same `occurrencesBetween` minus `recurringLog`), and shows the Bills marker only for dates Finance does not show. If the dates differ (the rule says the 1st, the bill says the 3rd) both appear and a drift notice explains why.
- **Bills never writes to, or reads into, the cash forecast.** The forecast's single scheduled stream stays Finance's. Payments that are not posted through Scheduled will keep being counted in "everyday spending", as today. This is stated on screen (`How figures are worked out`) so nobody adds the two.
- If the owner wants a bill in the forecast, the way is the explicit Finance route (a scheduled item), never a hidden Bills feed.

### 4.4 Autopay is not paid

States for an `auto` obligation (details in section 6): *Scheduled for automatic payment* (before the due date), then if there is no evidence by `dueDate + 3 days` (default grace; owner-adjustable later) *Autopay not yet seen in Finance, please check*. With a linked rule, a transaction posted from it by the owner's own Approve action is still shown as a **suggestion to confirm**, not counted, until the owner taps Confirm (one tap, or "Confirm all N" with a preview).

### 4.5 Four amounts that are never added together

| Amount | Where it comes from | Label | Counted as money spent? |
|---|---|---|---|
| **Expected** | The price step in force on the date (fixed), the typical value (variable), or unknown | "Expected" or "Estimate" | **Never** |
| **Invoiced** | `invoicedCents` typed by the owner from a statement | "Billed" | **Never** (it is a claim, not a payment) |
| **Scheduled** | The linked Finance rule's `amountCents`, read live | "Scheduled in Finance" | **Never** |
| **Paid** | Live Finance amounts of confirmed `payment-link` facts, or a typed outside-Finance amount (only when no link exists) | "Paid" (with Finance's own status as a chip, 4.1a) | **Yes**, only these |

### 4.6 Partial payments, overpayment, refunds, credits and what is still owed (Revision 2)

The exact definitions are in section 6.3 and the precedence in 6.5. In short: **amount owed**, **amount paid** and **amount remaining** are three separately derived numbers. A partial payment lowers *remaining*, never *owed*. A provider **credit** lowers *owed* (it is a typed fact, never a payment). A refund or reversal is a Finance piece with money coming back: it lowers *paid* (H3: a positive piece lowers spending). Overpayment is *paid* above *owed* and is shown as "paid more than billed", never hidden. A confirmed zero-dollar invoice means *owed* is 0 and it needs no payment (6.3). None of these is stored; each is recomputed from the live Finance amounts every time.

### 4.7 Recognising matches without silent association

`suggestMatches(cycle, obligation, transactions)` (pure, deterministic, unit-tested) offers at most three candidates per cycle:

| Tier | Rule | Shown as |
|---|---|---|
| **Strong** | Posted from the linked scheduled item for that date (`recurringLog`), **or** payee matches a hint and the amount equals expected/billed and the date is within 3 days of the due date | "Looks like the payment: confirm?" |
| **Possible** | Payee hint matches and the amount is within tolerance (fixed: exact or within 1 percent; variable: within the history range, else within 50 percent), date within the window (manual: due minus 7 to plus 10 days; autopay: due minus 2 to plus 7) | "Possible match" |
| *(not shown)* | Anything weaker; transfers and setup entries; transactions already confirmed on another cycle of the same obligation; transactions with a `suggestion-reject` fact | none |

Ties break by closeness of date, then of amount, then lower id. **Nothing is stored until the owner confirms.** "Not this one" adds a `suggestion-reject` fact (3.4). "Remember this payee" (a checkbox, default on, on confirmation) appends a normalised payee word to `payeeHints`; never silently. A transaction that already belongs to a **different obligation's** confirmed cycle is shown dimmed with that obligation's name (it may be a shared payment).
If two devices confirm different matches on one period, **both `payment-link` facts are kept** (they are separate records), the totals union them by `pieceKey`, and a sum above what is owed raises "check for a duplicate payment" (section 10.4). Revision 1's reliance on suggestions reappearing is withdrawn.

### 4.8 Are the shared reference utilities suitable? Yes, with three small, test-protected extensions

| Utility | Suitable as is? | Extension |
|---|---|---|
| `lib/txnRef.ts` (`TxnRef`, `makeTxnRef`, `resolveRef`, `pieceKey`, `readTxnRefs`, `validateTxnRefs`, `checkNewRefs`) | **Yes.** Covers whole and part references, stale states and double-link guards. | none |
| `lib/costSource.ts` (`chooseCost`, `initialChoice`) | **Yes.** Exactly the "typed or Finance, never both, switch needs confirmation" rule. | none |
| `lib/txnLookup.ts` (`loadTxnMap`, `newRefsProblem`) | **Yes.** | none |
| `assets/spending.ts` `spend()` and `CostRecord<G>` | **Yes.** Already generic over group labels (S3). A cycle becomes a `CostRecord` (`assetId` carries the obligation id as the owner, `group` the obligation `type` or `need`). | none |
| `ui/TxnRefs.tsx` `TxnPicker` | Mostly. It filters by text, date and amount boxes and has Hide Amounts support. | **E1:** an optional `suggested` list shown first and an optional initial filter, so "Find the payment" opens already narrowed. Existing callers unchanged. |
| `services/householdSpend.ts` | Union of **two** modules (`Mod = 'services' | 'home'`). | **E2 (B5, Revision 2):** **do not widen `Mod` or change `householdSpend`'s results.** Add a separate `recordedAcrossModules` function that reuses a behaviour-neutral extraction of S5's record-building step, behind a golden-master gate with a stated fallback (12.5). |
| `assets/spending.ts` `pieceUsers` | Per aggregate only. | **E3 (B3):** a small read-only `pieceIndex` across Bills, Services and Home & Assets, used only to show "also linked from ..." chips. |

### 4.9 Loan payments, escrow and rent (Revision 2: exclusion by default)

**What the Loans code actually exposes (read in source):**

| Item | Detail |
|---|---|
| `Loan` record (`types.ts`) | `kind`, `scenario` (a what-if loan, never tied to the ledger), `setup`, `nextPaymentDate`, `paymentOverrideCents` (the owner's real principal-and-interest payment), `escrowMonthlyCents` and `pmiMonthlyCents` (owner-typed monthly figures, "shown as part of the monthly total; they do not affect the loan balance"), `ledgerAccountId`, `interestCategoryId`, `escrowCategoryId`, rate changes and extra/draw events |
| `loanView` / `buildSchedule` / `nextRow` (`loanSchedule.ts`) | A **modelled** schedule. Each row's `payment` is interest plus scheduled principal only. `monthlyTotal(loan, payment)` adds the typed escrow and PMI. The Finance Calendar's loan item uses `nextRow(...).payment`, so it shows principal-and-interest only |
| `recordLoanPayment` (`loanLedger.ts`) | Writes **two pending Finance entries**: a transfer to the loan account (principal and any extra; not spending, so it cannot be a `TxnRef`) and **one expense** for interest plus escrow (split by category when they differ; payee "<loan name>: interest & escrow"); optionally a loan event |

**What it does NOT expose:** lender statements; the actual property-tax or insurance disbursements made from escrow; how escrow changes over the years (one constant monthly figure); whether that figure covers taxes, insurance or both; real payment dates; and, for adjustable-rate and HELOC loans, any assurance that the model matches the lender. I read the types, `recordLoanPayment`, `nextRow`, `monthlyTotal` and the Calendar use; **I did not read the body of `buildSchedule`** (about lines 121 to 255), so how it behaves in draw, repay and rate-shock phases is **UNVERIFIED**. Revision 1 said B5 could read the commitment amount from the loan schedule. **That claim is withdrawn as a default.**

**Revised recommendation (conservative; "see Loans" rather than guessing):**
- An obligation of type `loan` carries an explicit `loanId`. It is listed ("Tracked in Loans") and links to the Loan page. It is **excluded from payment matching, from "not confirmed paid" and "Overdue", from the cash-requirement totals and from the commitment totals.** Its cycles accept no payment links (the principal side is a transfer, and the interest-and-escrow expense is only part of the payment).
- **Optional, separately labelled line (B5, needs owner approval A-8):** "From your Loans page (a model, not lender statements): principal and interest $X, escrow $Y, PMI $Z a month", from `monthlyTotal`, only for non-scenario, non-HELOC loans. It is its **own bucket**, never added to Bills' Known or Estimated totals unless the owner switches on "include loan payments in my monthly view", and never described as confirmed.
- **Escrow, insurance and tax already inside the loan payment:** the owner can mark an obligation `paidThroughLoan` (with the `loanId`). It is then excluded from cash and commitment totals and reads "Paid through your loan payment". **Ledger never infers this** from `escrowMonthlyCents`. If a loan has escrow above zero and the owner also tracks an insurance or tax obligation that is **not** marked, a quiet, dismissible hint says "Your loan includes escrow; is this already paid through it?". It changes no figure.
- **Never counted as a Bills payment:** the principal transfer (not spending), and the interest-and-escrow expense (Bills never links it). Nothing about loans can therefore enter a Bills recorded-payments total or the cross-module union.
- **Rent, utilities, insurance, subscriptions, childcare, taxes:** one Finance expense per payment; normal matching.

### 4.10 What Bills must never do to Finance (the guard list, to be enforced by tests)

Never create, edit, re-categorise or delete a transaction; never post, skip or edit a scheduled item; never change `Txn.recurringId`; never write `recurringLog`; never read Bills amounts into the forecast; never add a Finance table. A test must prove that, after any Bills operation, every Finance table is byte-for-byte identical (the S5 "repeated loads change no row" test pattern).

## 5. Recurrence, due dates and Calendar visibility

### 5.1 Billing patterns and how each is represented

| Real pattern | Representation | Date source |
|---|---|---|
| Weekly | `weeks`, every 1, a weekday | `generateDates` (weekly) |
| Every two weeks / four-weekly | `weeks`, every 2 or 4, a weekday | `generateDates` |
| Twice per calendar month (for example the 1st and the 15th, or the 15th and the last business day) | `twice-monthly` with two slots | the existing semimonthly helper (extracted, 5.2) |
| Monthly on a date | `months`, every 1, slot `day` | slot resolver |
| Monthly on the last day, or the last business day | `months`, every 1, slot `lastDay` or `lastBusinessDay` | slot resolver |
| Every two months, quarterly, every six months | `months`, every 2, 3 or 6 (any 1 to 24) | slot resolver |
| Annually (a date, or a month and day) | `months`, every 12, the month given by `anchorMonth` | slot resolver |
| A date that moves to a business day (pay on the previous or next business day) | slot `adjust: previous or next` | slot resolver (never allowed to cross into another month; refused at save with an example, exactly as Services does) |
| Variable date each month (a utility that states its own due date) | schedule gives the *expected* date; the period's `due-date` or `invoice` fact stores the real `dueDate`; identity (`slot`) never changes | cycle fact |
| Irregular or on demand (an occasional invoice) | `schedule: null`; the owner records a bill and it gets an `x<id>` period | cycle fact only |
| Custom interval | Weeks and months cover every real case I found (28-day phone plans are "every 4 weeks"). "Every N days" is **not** offered in B1 to B5. | n/a (deferred; trivial to add later with the same generator) |

### 5.2 One recurrence generator, not a competing one (decision)

**Recommended:** reuse the existing pieces and add no new recurrence algorithm:
- **Weekly families:** `core/recurrence.generateDates` unchanged.
- **Monthly families and twice-monthly:** the slot resolver already in Household Services' `semimonthly.ts` (fixed day with month-end clamping, last day, last business day, previous/next business-day adjustment, the "never crosses a month, never two slots on one day" refusals). **B1 step 1 moves that file to `src/lib/` and leaves a one-line re-export in `modules/services/`** (the same move S3 made for `txnRef.ts`: callers unchanged, existing tests unchanged, new tests added). A one-slot "every N months" schedule is the same resolver stepped N months at a time.
- **An oracle test, not a second engine:** a required property test proves the slot path equals `generateDates` for every plain "day of month" rule (day 1 to 31, every 1/2/3/6/12 months, ten years including leap years). The proven generator therefore acts as a referee for the new adapter.

**Alternatives considered:** (a) use `generateDates` for everything: it cannot say "last business day" or "adjust to a weekday" and its monthly "last" mode is a *weekday* rule ("last Tuesday"); (b) import `modules/services/semimonthly` directly from Bills: a module reaching into another module's private file, which the earlier phases avoided; (c) reuse Finance's `occurrencesBetween`: closed to six frequencies and not generic; (d) write a Bills-only recurrence: the competing engine the brief forbids.
**Why this is preferable:** one date resolver in the whole app for the hard cases, and the easy cases are proven equal to the existing generator.
**For the owner:** every pattern in the table works the same way in Bills as the twice-a-month and last-business-day choices already do in Household Services.
**What I verified:** `semimonthly.ts` is 140 lines and already exports a single-slot resolver, `slotDate(slot, month)`, plus `readSlot`, `slotWords`, `semiProblem` (the two-slot refusals) and `semiDates`/`semiNext`. **UNVERIFIED:** whether `slotDate` handles the previous/next business-day adjustment across a month edge exactly as a *single* monthly slot needs, and whether a one-slot version of the "never leaves its month" refusal exists (`semiProblem` is written for two slots). B1 step 1 must confirm both, adding a small one-slot check if needed, without changing any Services behaviour.

### 5.3 The dates, kept distinct

| Date | Meaning | Stored where |
|---|---|---|
| **Cycle identity (`slot`)** | The immutable period identifier (3.4a), not a date. | derived; `slot` on every cycle fact |
| **Nominal date** | The date the schedule in force gives that period. Explanation and the default timing date. | derived (a stored `nominal` is a snapshot only) |
| **Billing period** | The service period a charge covers (for example 1 Nov to 30 Nov). | **Reserved, not built** (no use case needs it yet) |
| **Invoice date** | The statement date. | cycle `invoiceDate` |
| **Due date** | The date the provider says payment is due; may differ from the key. | cycle `dueDate` (else the key) |
| **Scheduled payment date** | When an autopay draft or the owner's planned payment happens. | cycle `scheduledPayDate` |
| **Actual payment date** | When money moved. | **Never stored by Bills.** Read live from the Finance transaction (or `paidOn` for a payment outside Finance). |
| **Renewal date** | When a term, plan or subscription renews. | obligation `terms.renewalDate` |
| **Cancellation deadline** | The last day to act or give notice. | obligation `terms.noticeByDate` |
| **Trial end** | When a free or promotional trial ends. | obligation `terms.trialEndsOn` |
| **Tracking since** | The first date Bills expects anything. | obligation `trackingSince` |

### 5.4 Calendar: a rolling 12 months, derived, never stored (decision)

**Recommended:** a **new read-only Calendar layer** "Bills & Subscriptions" with the next fixed built-in id **`9_000_000_000_000_107`** (`BILLS_ID` in `calendar/model.ts`, seeded in `calendar/data.ts` exactly as `SERVICES_ID` is) and a `bills` due provider registered through `contributes.dueProvider`.

| Alternative | Verdict | Reason |
|---|---|---|
| New layer `..._107` | **Chosen** | Honest ownership; the owner can switch it off or recolour it separately; no change to Finance's or Services' providers. |
| Add Bills items to the Finance layer (`..._102`) | Rejected | Finance's provider is Ledger-owned and shows only scheduled items; mixing would blur which numbers belong to whom and invite duplicates. |
| Add them to the Services layer (`..._106`) | Rejected | Wrong owner; a subscription is not a service visit. |
| Stored recurring Calendar events | Rejected | Event proliferation, edits that must be applied to many copies, and sync overlap (the brief rules this out). |

**What the layer returns** (all derived when the Calendar draws; nothing stored; a provider that throws leaves only its own layer empty):

| Item | Meaning | Priority and status |
|---|---|---|
| **Expected payment** (`bills:due-<obligation>-<slot>:<timing date>`) | A billing period due in the window. Informational. | `low` for autopay, `medium` for manual, `high` when manual and due within 3 days and not paid; `open` until the cycle is paid or skipped. |
| **Cancel-by / notice deadline** (`bills:notice-<obligation>:<date>`) | An **action** deadline. | `medium`, `high` within 7 days; `open` until the date passes. |
| **Trial ends** (`bills:trial-<obligation>:<date>`) | An action deadline (the price changes). | as notice. |
| **Renewal** (`bills:renewal-<obligation>:<date>`) | Informational. | `low`. |

Titles carry the obligation name only, **never an amount** (Services precedent; this also answers Hide Amounts for Calendar previews). Ids follow `derivedId`, so devices never double up. ICS: expected payments carry `bills-<obligation>-<slot>@ledger.local` (stable even when the due date moves); deadlines carry a 1-day alarm.
**Horizon:** today through the same day-of-month 12 calendar months later, both ends included, clamped to the month length (the exact convention and `horizonEnd` of Services' `plannedVisits.ts`). It moves forward with the clock; nothing is written to extend it.
**No duplicates:** (1) a date already shown by the Tasks layer (an open Bills Task stands for that cycle) is not repeated (the Bills layer starts after it, as Services does); (2) a date already shown by the Finance layer for a linked rule is suppressed (4.3); (3) a cycle that is paid or skipped is not an expected payment any more; (4) a renewal or notice marker is suppressed when the obligation is linked to a Services arrangement that has its own date of that kind (8.6).
**Overdue visibility:** the layer returns open manual-pay cycles dated within the Calendar's `overdueDays` window and "not confirmed paid", with the detail text "Not confirmed paid: no payment recorded yet". **Autopay cycles past their date are not returned as overdue** (they are counted by the Today card as "autopay not yet seen"). The Today screen's generic "Overdue" list is Ledger's existing heading for any open dated item before today; the item's own wording stays accurate (judgment call 15.B-7).

### 5.5 Tasks: only the next action, opt-in (decision)

**Recommended:** Bills never pre-creates Tasks for future cycles and never creates one for every obligation. Per obligation, at most:
- **one open "pay" Task** for the next due manual-pay cycle, only when `reminders.payTask` is on (default **on for manual-pay**, **off for autopay and subscriptions**);
- **one open deadline Task** per deadline kind (notice-by, trial end) when a date is set (default **on**, because missing these has a cost).

Tasks follow the Household Services recipe: one transaction re-reads the live linked Tasks before creating; the Task carries markers in its unknown fields (`billsObligation`, `billsCycle` = the period's `slot`, `billsPurpose: 'pay' | 'notice' | 'trial'`) that the Tasks editor already preserves (proved for Services); a link `task -> obligation` of type `about`; duplicates created on two devices are detected and flagged, never auto-deleted. **Finishing a Task is not evidence of payment**: "Done, mark paid" completes the Task and writes the `paid-outside` or `paid-in-full` fact in one transaction (or opens the Finance link picker, which writes a `payment-link` fact); a Task finished elsewhere appears as "Task finished, not yet confirmed" (the H2/S2 pattern).
**Alternatives:** a Task per cycle for the year (rejected, brief); no Tasks at all (rejected: a manual bill and a cancel-by date are exactly what Tasks are for); automatic Tasks for everything (rejected: 40 autopay subscriptions would flood the list).

### 5.6 Behaviour on awkward dates (all deterministic, all tested in B1/B2)

| Situation | Behaviour |
|---|---|
| Day 31 in a 30-day month; day 29 to 31 in February | Clamped to the month's last real day (same as Finance and Tasks). |
| Leap year | Feb 29 exists only in leap years; a rule on the 29th lands on the 28th in other Februaries; an annual rule anchored on 29 Feb lands on 28 Feb. |
| Weekend due date | The due date stays what the provider says. The *schedule* may opt into previous/next business day; then the adjusted date is the cycle's identity, and an adjustment that would leave the month is refused at save. No holiday calendar (as in Services). |
| Time zones and daylight saving | None: all dates are plain `YYYY-MM-DD`. "Today" follows the device clock through `useToday()` and changes at midnight. |
| Skipped cycle | The owner marks that cycle `skipped`; the schedule is untouched; the cycle is excluded from "expected". |
| Schedule edited ("from now on") | The old schedule is appended to `scheduleHistory` with an `until` date; dates before it come from the old schedule, dates after from the new one; existing cycle facts keep their **slots** (identity is the period, 3.4a). A fact whose slot no schedule produces is shown under "From an earlier schedule", never deleted, and may be moved to a current period by an explicit action (N1, N3). A day change within the same cadence creates no new period, so no duplicate or orphan. |
| Paused | No expected cycle falls inside a pause interval; resuming continues the schedule; the skipped months simply do not exist. |
| Ended | No expected cycle after `endedOn`; history and recorded payments stay. |
| Tracking since | Nothing before `trackingSince` is ever derived, so adding a bill never creates a pile of "missed" past cycles (the hazard in finding 4). The owner may move it earlier on purpose. |
| Price changes mid-year | A price step with a `from` date; each cycle uses the step in force on its key. |

## 6. Billing, payment and reconciliation state models (rewritten in Revision 2)

### 6.1 Four independent derivations, never one merged status

A period's display is computed from four separate pure functions. None is stored. Each reads the same facts (3.4) and the live Finance data, and **none of them is an input to another**: a late date cannot change an amount, and a payment cannot change timing.

| Derivation | Question | Output |
|---|---|---|
| **Timing** (6.2) | Where is the due date relative to today? | exactly one class |
| **Amounts** (6.3) | What is owed, what is paid, what remains? | `owed`, `paid`, `remaining`, `overpaid`, each known or unknown |
| **Evidence** (6.4) | What supports "paid", and does live Finance contradict it? | a list of evidence items plus suspension flags |
| **Attention** (6.7) | What needs a person's eyes? | badges and review items |

The **primary label** (6.5) is a fixed-precedence function of those four. Badges never change it, except where 6.5 says so explicitly.

### 6.2 Timing: five mutually exclusive classes

Let `d` = the number of days from today to the period's **timing date** (the single agreed actual due date, else the nominal date of its slot: rule N7), positive when it is in the future.

| Class | Condition | |
|---|---|---|
| **Due date unclear** | two or more distinct due dates among the period's non-superseded facts (N12) | checked first; none of the others apply |
| **Upcoming** | `d >= 8` | |
| **Due soon** | `1 <= d <= 7` | |
| **Due today** | `d == 0` | |
| **Past due** | `d <= -1` | |

Revision 1 tested "due within 7 days" before "due today", so a bill due today matched both. The classes above partition every integer `d`. **A required exhaustive test** runs `d` from -400 to +400 and asserts exactly one class (plus the unclear case) at every value, with explicit boundary cases at 8, 7, 1, 0, -1 and the autopay grace edge.

### 6.3 Amounts: owed, paid and remaining (independent of timing and of any label)

| Quantity | Definition |
|---|---|
| **Owed basis** | `billed` if exactly one distinct non-superseded `invoice` amount exists (**including a confirmed 0**); else `expected` (the price step in force, fixed); else `estimate` (variable: the typical value); else `unknown`. Two different invoice amounts give `unknown (records disagree)`. |
| **Credit** | the sum of non-superseded `credit` facts |
| **Owed** | `max(0, basis amount - credit)` when the basis is billed, expected or estimate; **unknown** when the basis is unknown. An estimate is flagged as one wherever it appears. |
| **Paid** | the net spending of the **counted** Finance pieces (each `pieceKey` once; a refund is a negative piece; a piece in state `missing`, `split-changed` or `not-spending` counts 0 and is flagged; state `changed` uses the live amount), plus a typed `paid-outside` amount **only when the period has no Finance link** (one source at a time; a typed amount alongside links is left out and listed for review, N12). A `paid-in-full` declaration adds nothing here (it has no amount). |
| **Remaining** | `max(0, owed - paid)` when owed is known; **unknown** otherwise (never shown as zero) |
| **Overpaid** | `max(0, paid - owed)` when owed is known |

Consequences, each a test:
- A **partial payment** lowers *remaining*, never *owed*. A **credit** lowers *owed*, never counts as *paid*.
- A **confirmed $0.00 invoice** (a deliberate fact, distinct from "no invoice") gives *owed* 0 and *remaining* 0: the period is **satisfied without any payment**. If a payment is found anyway it shows as *overpaid*, with no accusation.
- An **expected** amount of 0 with no invoice (a free trial month) gives "No payment expected". That is a forecast, not a confirmed fact, so a payment that turns up is still shown and counted.
- A **declaration** ("paid in full") does not change any amount. It only affects the label (6.5) and only while Finance does not contradict it (6.4).

### 6.4 Evidence, and when live Finance contradicts a stored declaration

Evidence items (4.1a): linked Finance pieces (each with Finance's own status), a typed outside-Finance payment, a paid-in-full declaration, and (never counting) suggestions.

**Rule: a stored declaration or link never silently overrides live Finance evidence that contradicts it.** The contradictions, each derived from live data, each shown to the owner in words:

| # | Live fact | Effect |
|---|---|---|
| C1 | A linked piece is `missing` (transaction deleted, an import undone, or not on this device yet), `split-changed` (the split moved, so the part cannot be trusted) or `not-spending` (now a transfer) | It contributes **0 to paid**; the stored link is **kept** (never auto-removed) with its snapshot text; a declaration on the same period does **not** make up for it silently: the label falls back to what the remaining live evidence supports and the badge says "A linked payment needs review" |
| C2 | The net of the counted Finance pieces is **0 or less while at least one outflow piece and one money-back piece are linked** (a reversal or refund) | *Paid* is 0; the badge says "A payment was reversed or refunded"; a `paid-in-full` declaration is **suspended**: the label is "Needs review: marked paid, but Finance shows it was reversed" until the owner re-affirms (a new, dated declaration; the old one stays as history) |
| C3 | A linked transaction's **amount, date or payee changed** since linking (state `changed`) | The **live amount** is used; *remaining* is recomputed; badge "Changed in Finance since you linked it". There is no stored "paid" bit to go stale: paid is recomputed every time |
| C4 | A `paid-in-full` declaration with Finance links whose net is **below** *owed* | Not a contradiction (a provider may have waived the rest). The label respects the owner's statement and states the difference: "Marked paid in full by you; Finance shows $60.00 of $120.00" |
| C5 | A typed `paid-outside` amount together with Finance links | Finance links win; the typed amount is left out of every total and listed for review |

### 6.5 The primary label: one function, fixed precedence (first line that applies wins)

| # | Condition | Primary label | Counts as paid in totals |
|---|---|---|---|
| P1 | An unconflicted `skip` and no payment evidence | **Skipped** | no |
| P2 | *Owed* is a known 0 and *paid* is 0 or less | **No payment due** (confirmed $0.00 bill) or **No payment expected** (expected 0, nothing billed) | no |
| P3 | *Paid* above 0, owed known, *remaining* 0 | **Paid** (plus "paid more than billed" when overpaid) | yes |
| P4 | *Paid* above 0, owed known, *remaining* above 0 | **Partly paid ($X of $Y)** | the part |
| P5 | *Paid* above 0, owed unknown | **Payment recorded ($X)** | the amount |
| P6 | No amount paid, an unsuspended `paid-in-full` declaration (or a typed `paid-outside` with no amount) | **Marked paid by you (no amount recorded)** | no amount |
| P7 | A declaration suspended by C1 or C2 | **Needs review: a payment you marked is no longer supported by Finance** | no |
| P8 | No evidence, **auto**, timing Upcoming, Due soon, Due today, or Past due with `-grace <= d <= -1` | **Scheduled for automatic payment** (with "due in N days", "due today" or "due date passed") | no |
| P9 | No evidence, **auto**, Past due with `d < -grace` (default grace 3 days) | **Autopay not yet seen in Finance, please check** | no |
| P10 | No evidence, **manual or not sure**, Upcoming | **Upcoming** | no |
| P11 | ... Due soon | **Due soon** | no |
| P12 | ... Due today | **Due today** | no |
| P13 | ... Past due, **an invoice is recorded** | **Overdue** (billed, no payment recorded) | no |
| P14 | ... Past due, no invoice | **Not confirmed paid** | no |
| P15 | Due date unclear, no evidence | **Due date unclear** (two dates recorded) | no |

Each of P8 to P14 is guarded by "no evidence": the paid, declared and suspended cases (P3 to P7) sit above the timing cases, so a **paid bill past its date is never "Overdue" or "Not confirmed paid"**, and an unpaid one is never "Paid". The word **Overdue** requires a recorded invoice and a manual-pay bill and no evidence (the rule and rationale from Revision 1, unchanged: an unmatched transaction is not proof that anything is owed). Autopay is never called overdue. "Unknown how it is paid" is treated as manual. **A required exhaustive test** enumerates every combination of (skip, owed state, paid state, declaration state, suspended, timing class, auto or manual, invoice present) and asserts exactly one primary label, and that no label contradicts the amounts (never "Paid" with remaining above 0; never "Overdue" with evidence; never a settlement word).

### 6.6 What changes the display, and what never does

- Changes it: a new or removed fact (an invoice, a link, a declaration, a skip); a Finance edit, deletion, refund or reversal (recomputed on the next read); the passage of days (timing only).
- **Never** changes it: a suggestion, the autopay setting, a reminder or Task being finished, a renewal date passing, or an owner opening a screen. Nothing derived is written back.

### 6.7 Badges and review items (attention; they sit beside the label, never replace it)

"Possible payment found" (never counted); "Shared with N other bills"; "Also linked from Household Services or Home & Assets"; "Tagged to Project X"; "Changed in Finance since linked"; "A linked payment needs review"; "A payment was reversed or refunded"; "Two records disagree" (N9); "Paid more than billed"; "Recorded in Finance: pending for N days" (informational, from `Txn.status`); "A typed amount was left out because links exist"; "Payment looks like it was taken after the cancellation date" (7.3). Review items feed the Needs-review page, the Today counts and the Overview from the same function.

### 6.8 Worked examples (invented; cents are whole cents)

| # | Situation | What Bills shows | Recorded-payment total |
|---|---|---|---|
| 1 | **Pending scheduled transaction.** "Streamly" is a linked Finance scheduled item; on 12 Dec the owner pressed Approve, which posted a **pending** $15.49 entry carrying `recurringId` | Before confirming: label **Scheduled for automatic payment**, chip "Possible payment found: posted from your Finance scheduled item on 12 Dec". Not counted. After the owner confirms: label **Paid**, chip **"Recorded in Finance: pending"** (not "cleared") | $0.00, then $15.49 |
| 2 | **Cleared imported transaction.** The owner imports a bank file on 14 Dec; a cleared $15.49 row with an `externalId` appears (or the import turns the pending entry in example 1 to cleared) | Link confirmed: **Paid**, chip **"Recorded in Finance: cleared, seen in an imported bank file"**. If the pending entry was already linked, the chip simply changes to cleared on its own; the link still points at the same transaction id | $15.49 |
| 3 | **Partial payments.** Billed $120.00 (invoice fact); the owner links a $60.00 payment | **Partly paid ($60.00 of $120.00)**, remaining $60.00; after a second $60.00 link: **Paid**, remaining $0.00 | $60.00, then $120.00 |
| 4 | **Reversal.** Paid $120.00 linked; the bank returns the payment and the owner records +$120.00 "money back" and links it to the same period | Net paid $0.00; label returns to the timing label (**Overdue** if an invoice is recorded and it is manual and past due; otherwise **Not confirmed paid**); badge "A payment was reversed or refunded". If the owner had also marked it paid in full: **Needs review: marked paid, but Finance shows it was reversed** | $0.00 |
| 5 | **Missing reference.** A linked transaction is deleted (or the import that made it is undone) | The link is **kept** and shown with its snapshot ("was $120.00 at Example Power on 19 Dec when linked"); *paid* 0; label by timing; badge "A linked payment needs review"; actions "Pick another" or "Remove link" | $0.00 |
| 6 | **Confirmed zero invoice.** The owner enters a $0.00 invoice for a billing credit month | **No payment due (billed $0.00)**; remaining $0.00; satisfied with no payment | $0.00 |
| 7 | **Declaration against under-payment.** Billed $120.00, linked $100.00, marked paid in full | **Marked paid in full by you; Finance shows $100.00 of $120.00** (the difference is shown, no alarm) | $100.00 |
| 8 | **Amount edited after linking.** $15.49 link; the transaction is edited to $16.49 | Live $16.49 used; remaining recomputed; badge "Changed in Finance since you linked it" | $16.49 |
| 9 | **Stale split.** A part of a split transaction is linked; the splits are reordered | `split-changed`: counts 0, flagged, must be re-picked; never moves to the part now in that position | $0.00 |

## 7. Subscription lifecycle, renewals and cancellations

### 7.1 States (deliberately small) and derived labels

Stored: `active`, `paused`, `ended` (reason: cancelled, replaced, finished, other). Everything else is a **derived label** from dates the owner entered:

| Derived label | When | What it does NOT mean |
|---|---|---|
| In trial (until D) | `trialEndsOn` is today or later | nothing about whether it will convert |
| Trial ended, please check | `trialEndsOn` passed and no price step or note since | Ledger does not know whether it converted or was cancelled |
| Renewal date passed: did it renew? | `renewalDate` passed and not updated | it did **not** renew automatically in Ledger |
| Cancellation requested, not confirmed | `cancellation.requestedOn` set, `confirmedOn` empty | it is **still active** until the owner marks it ended |
| Cancellation confirmed, ends D | `confirmedOn` set | still active until `effectiveOn` passes and the owner confirms the end |
| Ends soon | `effectiveOn` within 30 days | nothing ended yet |

**Alternative (rejected):** one status machine (trial, active, paused, cancelled, expired, renewed). It forces nonsense states on a water bill and would encourage Ledger to *change* state by itself when a date passes, which the brief forbids.

### 7.2 Trials, introductory prices and price changes (one mechanism)

All three are **price steps** with a `from` date (3.2): a trial is a step of 0; an introductory price is a step followed by the regular step; an increase is a later step. The cycle's expected amount is the step in force on its key. Entering a price change asks for the effective date and shows "from 1 Mar: $15.49 (was $13.99; +$1.50 per month, +$18.00 per year)". Monthly versus annual billing options are two **schedule revisions** on one obligation (switching appends the old schedule to `scheduleHistory` and adds a price step), recorded in `lifecycle` as "changed to annual billing". Historical prices stay forever (the list is append-only; an owner can correct a typo, which is an edit, not a deletion).

### 7.3 Cancellation workflow: request, effective, confirmation are three separate facts

1. **Reminder / deadline** (`noticeByDate`): a Calendar marker and optionally a Task. *Does nothing to the subscription.*
2. **"I asked to cancel"**: the owner enters `requestedOn` (and optionally a confirmation link in `refs`). The obligation stays `active`; the page shows "Cancellation requested, not confirmed". The notice-deadline Task, if any, is offered "Done" because the action was taken.
3. **"Provider confirmed"**: `confirmedOn` and `effectiveOn` (the last day of service). Still `active` until that date.
4. **"It has ended"**: only the owner marks `status: ended` (reason cancelled, `endedOn`). Ledger may *prompt* ("the cancellation date has passed: has it ended?") but never changes status itself. After ending: no future expected cycles; payments and history stay.
5. **After-the-fact check:** a Finance transaction that matches this obligation (strong or possible suggestion) **dated after `effectiveOn`** raises "A payment looks like it was taken after the cancellation date, worth checking" (deterministic; a nudge, not an accusation).

### 7.4 Renewals

`renewalDate` is the *next expected* renewal (owner-entered, plus `noticeDays` to prefill `noticeByDate` in a preview). When it passes, the obligation shows "did it renew?" with three explicit buttons: **Renewed** (enter the new renewal date, optionally the new price, which appends a price step and a `lifecycle` entry), **It ended** (7.3 step 4), **Not sure** (acknowledge for 30 days). **Nothing renews, repeats yearly or creates a transaction by itself.** The renewal history is the `lifecycle` log plus the price steps.

### 7.5 Pausing, replacing, provider and account changes

- **Pause/resume:** an interval in `pauses` (a start, an optional end); no cycles inside it; a pause may have a planned resume date as a marker.
- **Replacing a subscription or switching a provider** (a new electricity supplier; swapping one streaming service for another): the Services answer applies: **a successor obligation**, with `predecessorId`, an end on the old one (reason replaced), and an undoable single transaction. History, payments and price steps stay with the old record; the successor starts clean. A provider's *account number* changes nothing because none is stored.
- **Unknown contract terms:** every field is optional; an obligation with no terms simply shows none ("Terms not recorded"). Overview shows a quiet count, never a warning.

### 7.6 Documents

Statements, agreements and cancellation confirmations are `DocRef` links (label, optional http(s) URL, optional note) validated by the existing `isSafeUrl`. No upload, no binary storage, no storage migration, no claim that a backup contains a file (the standing Ledger rule).

### 7.7 Worked examples (invented)

| Case | Obligation | Notes |
|---|---|---|
| A streaming service with a 30-day free trial, then a promo, then full price | One obligation; price steps 0, 499, 1549; `trialEndsOn`; Calendar "Trial ends" marker; deadline Task | Cycles during the trial read "No payment expected". |
| An annual insurance policy | `months` every 12; `renewalDate`, `noticeByDate` | Cash timing shows the full premium on its date; the monthly figure is averaged and labelled so. |
| A gym membership with a 12-month term and 30 days' notice | monthly; `renewalDate`, `noticeDays: 30` | Notice date is a preview the owner confirms. |
| Cancelled streaming service | `cancellation.requestedOn`, then `confirmedOn`, then `status: ended` | A later charge raises the after-the-fact check. |

## 8. Cross-module relationships and ownership boundaries

### 8.1 Who owns what

| Module | Owns | Does not own |
|---|---|---|
| **Finance** | Transactions, splits, categories, balances, scheduled items (instructions), loans | Obligations, renewal terms, cancellation facts |
| **Bills & Subscriptions** | The obligation (what is owed and to whom), its schedule, price history, payment arrangement, cycle facts, trial/renewal/notice dates, cancellation facts, payment *links* | Money, balances, the forecast, service visits, assets, Project scope |
| **Household Services** | Provider arrangements, visits, service history, **contract dates of a service agreement** | The bill for it |
| **Home & Assets** | Physical assets, maintenance, warranties (coverage dates and claims) | Premiums or fees |
| **Projects** | Defined scope, budgets, commitments, Project financial reporting | Recurring bills |
| **Contacts** | Provider identity (a name, phone, email) | Anything else |

### 8.2 Link types (shared `links` table, no new table)

| Link | From to | Meaning |
|---|---|---|
| `about` | Task to obligation | The Task is the next action for that obligation (existing type, same as Services). |
| **`bills-for`** | obligation to `services:arrangement:<n>` or `assets:asset:<n>` | "This bill is the money side of that record" (a lawn-care contract fee; the insurance on a house). Created only from Bills; the other side gets a read-only "Bills" card in B5. |
| `involves` | obligation to a Project id | Information only (a permit-related recurring fee). No Project money is read or written. |

Links are created in the same transaction as the record, use `links.add` (idempotent), and are cleaned by the existing soft-delete behaviour on either end. A link to a deleted or not-yet-synced record shows "not on this device" and never blocks.

### 8.3 When to link and when to stay independent

| Situation | Decision |
|---|---|
| A landscaper comes weekly **and** charges an annual agreement fee | Services arrangement (visits) **plus** a Bills obligation (the annual fee) linked `bills-for`. Neither duplicates the other's dates or money. |
| House insurance | Bills obligation, linked `bills-for` the property asset. The asset's warranty records are unaffected. |
| A home warranty plan sold with a contract | Coverage dates stay a Home & Assets warranty; the monthly fee is a Bills obligation (linked to the asset). The warranty's expiry is not re-entered in Bills. |
| A renovation contractor's progress payments | Projects commitments. **Not** an obligation. |
| A streaming service, software, a magazine | Independent. No other module. |
| A mortgage | Bills obligation of type `loan` with a `loanId` pointer; Loans owns the payment (4.9). |
| Property tax | Independent obligation (quarterly or annual). If paid through escrow, mark it "paid through the loan". |
| Car insurance | Independent obligation, optionally linked to the vehicle asset. |

**Rule of thumb for the owner:** link when another module already holds a real record of the same thing; stay independent when there is none. Linking is always optional and never required to use Bills.

### 8.4 One provider, many relationships (the landscaping example)

Contact "Maple Lawn Care" is **one** Contact. Services holds the weekly-mowing arrangement and each visit; Bills holds "Maple Lawn annual agreement" (renewal 1 Apr, notice 1 Mar, annual fee) linked `bills-for` that arrangement; Finance holds the actual payments, which the Bills cycle and Services visits may both reference. No provider table, no copy of a visit, no copy of a payment. A neutral "everything with this provider" view is **B5** and is a read-only card on the existing Services provider page plus a `#/bills?provider=<contact>` filter, not a new vendor database.

### 8.5 One payment referenced in several modules

A Finance piece can be referenced by a Bills cycle, a Services visit and a Home & Assets service record. Rules (all inherited from H3 and S5):
- **Display:** each module shows the payment in its own context. A read-only chip lists the other places that reference the same piece (E3, 4.8) and, separately, "tagged to Project X".
- **Counting:** a payment is counted **once** by `pieceKey` in any aggregate; a whole transaction covers its parts; a shared payment is **never divided or allocated**; typed amounts are **never matched by value** (the S5 rule), so two typed amounts that coincide both count and the household is told this is a limit.
- **Union:** B5 widens `householdSpend` to three claimants so the existing "recorded payments, each counted once" figure can include Bills. It is **not** a household-wide spending engine and is never labelled "all spending".
- **Project money** is never added to a Bills figure.

### 8.6 One date, one owner (renewals of service agreements)

The S0 boundary says renewal and notice dates of a *service agreement* belong to Services, and Bills must read them, not re-enter them. Decision: when an obligation is linked `bills-for` a Services arrangement that has its own `renewalDate` or `noticeByDate`, Bills **shows those dates read-only ("from Household Services") and its Calendar layer suppresses its own markers of that kind**. If both modules hold a date of one kind, a quiet notice says the two exist and which one the Calendar shows.
**Alternative:** let Bills own all contract dates and migrate Services' (rejected: it rewrites a shipped, accepted module). **Alternative:** show both (rejected: duplicate Calendar entries the owner would have to reconcile).

### 8.7 Existing "bill" representations: what happens to them

Finance scheduled items, Calendar events of type "Bill" and Finance "Finance date" events (for example subscription renewals) all exist today. **Decision:** none is converted or removed. B1 to B5 add Bills beside them. Where an item appears in two places the owner is told ("This looks like Finance scheduled item X: link it?") and chooses; Ledger never decides. Taking over the Calendar `bill` event handoff is deferred (15.B-12).

## 9. User-facing screens, Today, Search and Quick Add

### 9.1 Principles

Fast everyday use, progressive disclosure, plain labels, no jargon. A person must be able to add a streaming subscription, track an electric bill or check an insurance renewal without learning the model in section 3. The patterns, components and tests already in Household Services' pages are the template (cards, Overview parts, dialogs through `shell/Modal.tsx` with its Tab-trap, 44 px touch targets, light and dark, 375 px, Hide Amounts through `loadHideAmounts`).

### 9.2 Screens and routes (proposed)

| Screen | Route | What it shows | Phase |
|---|---|---|---|
| **Overview** (the module's home) | `#/bills` | Needs attention (one list), Due soon, Scheduled for automatic payment, Payments recorded recently, Trials ending, Renewals and cancel-by dates, Recent price changes, Typical commitments (labelled), Things to know | B1 (small), grows to B5 |
| **All obligations** | `#/bills/list` | Filter by type, need, status (active, paused, ended), provider, autopay or manual; sort by next due, name, monthly cost | B1 |
| **Obligation detail** | `#/bills/o/<id>` | Plain header (what, who, how often, next date, autopay or manual), cost (price steps), upcoming dates, **payment history** (cycles with their labels), terms and deadlines, cancellation, linked records (provider, Services arrangement, asset, Project, Finance scheduled item, Loan), documents, lifecycle history, notes | B1 skeleton, filled B2 to B4 |
| **Upcoming payments** | `#/bills/upcoming` | The next 90 days, grouped by week, with cash-timing totals split known and estimated | B2 |
| **Needs review** | `#/bills/review` | Not confirmed paid, autopay not seen, stale payment links, suggestions to confirm, "did it renew?", records that disagree (N9, with the three repair buttons of N10), activity after an end date, orphans, periods "from an earlier schedule", possible duplicate payments | B2 (simple), B3 to B5 |
| **Add / edit** | dialog from the list or `bs` in Quick Add | Three questions first, the rest folded away (9.3) | B1 |
| **Provider-linked obligations** | `#/bills?provider=<contact>` and a read-only card on the Services provider page | Every obligation for one Contact | B5 |
| **Settings** | inside the module | Grace period for autopay (default 3 days), leave defaults | B2/B5 |

All routes use hash addressing like the rest of the app; deep links carry ids and dates only, never names or amounts (`#/bills/o/<id>?period=<slot>`). A payment drills into Finance with the existing `#/ledger/transactions?txn=<id>` link.

### 9.3 Adding an obligation (progressive disclosure)

First screen, three questions: **What is it?** (a name; typing "Streamly" may offer an existing Contact), **How much?** (an amount, or "It varies", or "I do not know"), **How often and when?** (Monthly on a date is the default; the options are the patterns in 5.1 in plain words). A fourth toggle: **Who pays it?** (Automatic, I pay it by hand, Not sure). Then **Save**. Everything else sits under **More details** (provider Contact, type and need, autopay account, price changes, renewal and cancel-by dates, trial, Finance scheduled item, linked records, documents, notes, "Remind me", and **"Put on my review list"** (a neutral checkbox, available for every obligation, with an optional note)). Defaults: type guessed from words (insurance, electric, water, rent), need by type, `trackingSince` today, autopay unknown unless said. A live preview shows "Next three dates: 12 Dec, 12 Jan, 12 Feb" and plain-language text of the schedule before saving (Services' pattern). Validation is strict at save (real dates, whole non-negative cents, valid schedule, no refused month-crossing), soft warnings never block.

### 9.4 Quick Add

Prefix **`bs`** with aliases `subscription` (and `sub` if free at build time; clash-checked at start-up). **Finance keeps `b` and `bill`** ("Scheduled payment") unchanged. Preview first, then Add, with Undo, exactly like `hs`. Examples (invented):

| Typed | Preview |
|---|---|
| `bs Streamly 15.49 monthly 12th autopay` | Streamly, $15.49, monthly on the 12th, automatic (subscription) |
| `bs Example Power varies monthly 18th` | Example Power, amount varies, monthly on the 18th, pay by hand |
| `bs Home insurance 1200 yearly 15 mar` | Home insurance, $1,200.00, once a year on 15 March |

An unclear line refuses with a plain reason rather than guessing. The grammar is a B1 build detail.

### 9.5 Today

One card, **`bills.attention`** (id starts with the module id), **counts only, half width, hidden when empty**, reading the same pure reader as the Overview so the counts agree: "N bills due in the next 7 days", "N bills not confirmed paid", "N autopay payments not yet seen", "N possible payments to confirm", "N trials ending in 7 days", "N cancel-by deadlines in 14 days", "N renewals in 30 days". No names, no amounts (so Hide Amounts has nothing to hide). Dated items themselves (the next manual payment, a deadline) already reach Today through the due provider and Tasks, so the card does not list them (the same rule H5 and S5 followed). An optional **money** card ("Next 30 days: $X known, $Y estimated"), honouring `hideAmounts`, is a B5 candidate and an owner choice (15.A).

### 9.6 Search

A source in group "Bills & Subscriptions": **obligation title, provider name and type label only** (no amounts, no notes, no links, no references), result kind "Bill" or "Subscription", deep link to the detail page. Ended items appear last. Nothing is indexed; a linear scan is fine at household scale.

### 9.7 Calendar and Finance drill-downs

Calendar items open the obligation (`openSource`), never edit it in place. A cycle's payment line opens the Finance transaction. A linked scheduled item opens `#/ledger/scheduled?rule=<id>`. The Calendar's own "Bill" and "Finance date" event types stay as they are.

### 9.8 Accessibility and responsive requirements (to be tested, not assumed)

375 px layouts with no horizontal scroll; light and dark; every control keyboard reachable; dialogs through the shared `Modal` (Tab stays inside, Escape closes the top dialog only); labels with real text (not colour alone) for every label in 6.5 and every badge in 6.7; amounts masked under Hide Amounts, including inside the transaction picker (the existing `hide` prop and "Show amounts" reveal). Real screen-reader, real-phone and contrast checks stay owner-acceptance items, as in every earlier phase.

## 10. Local-first storage, synchronization, backup and deletion

### 10.1 Persistence model (decision)

**Recommended:** `moduleRecords` rows of module `bills`, kinds `obligation` and `cycle`. Record ids for links and the `records` hook are text: `obligation:<n>` and `cycle:<n>`. Defensive readers (`readObligation`, `readCycleFact`) never throw on a damaged or future record: unknown fields are carried through untouched, an unreadable status is shown as "Needs review" and written back unchanged by an ordinary edit (the S2 visit pattern), and `lifecycle` is capped when read. **No new Dexie table, no migration, schema stays 15.** *Alternative:* a dedicated table (rejected, 3.1).

### 10.2 Backup and restore

Module records are in every backup automatically (G1: whole-database export, all-or-nothing restore, record counts in an optional manifest). B1 adds `bills: { group: 'bills', kinds: { obligation: 'Bills and subscriptions', cycle: 'Billing-period records' } }` and a "Bills & Subscriptions" group to `backupSummary.ts` (otherwise it is shown under "other application data", never dropped). G1's `backupCoverage` tests must stay green; no new table means no change to `exportAll`/`importAll`. A round-trip test (export, wipe, restore) must prove obligations, every cycle fact (including `payment-link` references and repair marks), price steps, schedule history, links and Task markers survive and that every Finance table is untouched. **A restore is a replacement, as today** (documented in the UI); restored records are re-stamped so they win on other synced devices. Plain backups remain unencrypted and sensitive; B adds no new secret.

### 10.3 Older versions of the app

An older build sees `bills` rows as module records it does not understand: they stay in the database, are carried through a restore and synced untouched, and appear under "other application data" in its backup summary (G1 behaviour, **to be proved by a test that writes `bills` rows through the current code and round-trips them**; I have not run a real older build). Bills does not alter any existing record's shape except adding the Task markers, which the current Tasks editor already preserves (proved for Services). A *newer* backup is refused only on the database `version`, which does not change. A future Bills field is preserved by the extras pattern.

### 10.4 Two devices, offline: evidence is preserved, conflicts are shown, nothing is silently merged (rewritten in Revision 2)

**Design principle.** The fact-record model (3.4) means the things most likely to be added on two devices at once (payment links, invoices, declarations, skips) are **separate records**, and sync already adds a record that exists on one side only to the other. Two devices therefore cannot overwrite each other's *new* evidence. What remains subject to whole-record last-writer-wins is an **edit of one existing record** (an obligation, or one existing fact such as an invoice amount); for those the existing "Edits that lost a tie" list applies, with the caveat that it is device-local and capped at 50, so Bills does **not** rely on it for anything important.

| Scenario (the brief's list first) | What happens to the evidence | Detection and repair (all feasible with `moduleRecords` transactions and a local guarded Undo) | New merge rule? |
|---|---|---|---|
| **Two devices independently create "the same cycle"** (same `obligationId` and `slot`) | Both devices' facts are kept. They group under one period. Facts that agree show once with "(recorded twice)" | If any singular fact disagrees (N9), the period shows "Two records disagree" with the three actions of N10. Nothing is deleted | **No** |
| **Two devices record different invoice amounts** | Two `invoice` facts remain | *Owed* reads "unknown (records disagree)"; remaining unknown; Needs-review item. **Use this one** marks the other `supersededBy` (kept in History); **These are different bills** moves one to an `x` period | **No** |
| **One device skips a cycle while the other records a payment** | A `skip` fact and payment facts coexist; **the payment counts, the skip never removes it** | Badge "Skipped on one record, payment recorded on another"; the skip is ignored for "expected" until resolved; actions: remove the skip (soft delete, undoable) or leave both | **No** |
| **Both devices confirm different payments against the same cycle** | Two `payment-link` records; **both** kept; totals union by `pieceKey` | If their sum exceeds *owed*: "Paid more than billed: two payments are recorded; check for a duplicate payment". The owner can unlink either | **No** |
| **A Finance reference "loses an edit through last-writer-wins"** | **It cannot.** A `payment-link` fact is never edited, only added or removed, so a concurrent add by the other device is a different record. (An unlink is an edit of that one record; the other device, which did not touch it, creates no conflict.) | This is the concrete failure the fact model removes. **Revision 1's reliance on "suggestions regenerate" is withdrawn**: a transaction the owner had rejected, or one outside the match window, would not have come back | **No** |
| **An obligation is ended while another device records facts** | Facts attach to `obligationId` and survive on either side of the end | If the `ended` edit wins, facts dated after `endedOn` raise "Activity after the end date" (acknowledge, or Reopen). If the *other* obligation edit wins (an obligation edit is whole-record last-writer-wins), the obligation looks active again; the lost version is in the conflict list (best effort) **and** the owner sees that its facts and Tasks are intact. Residual risk R4 | **No**; see the escalation path below |
| **A schedule changes while an invoice is recorded** | Invoice facts are keyed by period (`slot`), not by date, so they are independent of the schedule edit and survive whichever schedule wins | If the winning schedule does not produce the slot, the period is listed under "From an earlier schedule" with the explicit "Move to another billing period" (N1, N3) | **No** |
| Two devices link one Finance scheduled item to different obligations | Both pointers kept | Detected at read time and flagged; the owner keeps one | **No** |
| Obligation permanently deleted on A while B added facts | The soft delete is an edit like any other; facts may be left without an obligation on B | Guard on A (10.5); **orphan check** on B lists facts with no live obligation; actions: re-home them to a chosen obligation (explicit, previewed) or remove those that hold no payment link. **Payment links are never removed automatically** | **No** (the S0 policy: history wins) |
| A device offline for over a year | The existing tombstone limit applies | documented in `docs/sync.md` | **No** |

**Escalation path if review finds a gap.** (1) If an obligation-level append (a price step, a schedule revision, a lifecycle entry) proves too easy to lose, move those lists out of the obligation into append-only records of the same shape as the facts (the B-2 alternative). That is still no merge change. (2) A new rule in `merge.ts` is a **last resort**, and only if a real-`SyncEngine` test shows evidence loss that no read-time rule can surface **and** the rule can be shown, by running the existing Tasks, Projects, Assets and Services sync tests unchanged, not to affect them. I do not recommend one.

**Tests (real `SyncEngine`, two devices):** every row above, including: fact union with no double count; conflicting invoices unresolved until a button is pressed; skip versus payment; two links summing above owed; concurrent end versus fact; concurrent schedule change versus invoice; orphan repair; and "a payment link added on each device is present on both after sync" (the case Revision 1 could lose).

### 10.5 Archive, end, delete, undo (Revision 2: a local Undo, no framework)

- **Ended is the archive.** `status: ended` (reversible: "Reopen"). It stops expected periods; history, facts and links stay; ended items live under the "Past" filter.
- **Permanent delete is allowed only for an obligation that never had anything**: no fact records, no payment links, no Finance pointers, no Task that was ever completed, no successor or predecessor. A preview lists what goes (links; an open Task asks Keep or Delete, with the H4 shared-Task warning). Otherwise Delete is replaced by End.
- **Cancelled or ended never erases payment history.** Facts, links and references remain and still count in recorded payments.
- **Stale references** each have a named, visible state (a Finance transaction `missing`; a Finance scheduled item "deleted" or "not on this device"; a Contact removed, shown by its name snapshot; a link to a deleted Services arrangement or asset "not on this device"). None blocks editing; none is shown as paid.
- **Undo (Revision 2).** B1 ships a **small local guard** in `src/modules/bills/undo.ts` (on the order of 80 lines): before a write it captures the whole stored rows it will touch; after the write it records their fingerprints with the already-exported `stable()` (order-independent JSON from `sync/merge.ts`); Undo re-reads inside one transaction and **refuses, writing nothing**, if any row differs, otherwise restores the captured rows. It covers exactly the B1 actions (add, edit, end, reopen, pause, resume) and later B2 facts. It does **not** touch `services/undo.ts` and does not try to be generic. **Why not extract Services' guard:** it also reverses Tasks, links and Contacts and is tied to Services' arrangement and visit shapes; extracting it would turn the first Bills phase into a framework refactor. **Deferred:** a shared framework only if a third module needs the same API and the owner approves a separate refactor with Services' existing undo tests as the guard.
- **Unknown future fields** are preserved on every write; Bills reads other modules only through their exported readers and ids and writes only its own records, links and Tasks.

## 11. Privacy, security and Hide Amounts

### 11.1 Fields: supported, avoided, masked

| Category | Fields |
|---|---|
| **Supported** | Title, type, need, provider (a Contact link plus name snapshot), amounts and price steps, schedule, autopay yes/no, a Finance **account link** (by id; the name is read live), Finance category (hint), trial/renewal/notice/cancellation dates, document **links** (label, http(s) URL, note), notes |
| **Avoided in B1 to B5** (deliberately, as Services avoided them) | Account or customer numbers, card numbers (even partial), bank routing or account numbers, passwords, PINs, access or security codes, security answers, government identifiers, payment instructions, a free-text "login" field |
| **Masked until deliberately shown** | None are stored. If a future phase adds a provider reference number it needs its own approval, masking (shown as dots until the owner reveals it, the Home & Assets `Sensitive` pattern), and exclusion from Search, Calendar, Today and ICS. |
| **Warned** | The notes field carries the same visible warning as Services: never put codes or passwords here. A plain backup can contain everything in notes. |

**Why prefer links:** the Contact already holds name, phone and email; Finance already holds the account; the document link points at the statement. Duplicating any of them multiplies what a leaked backup would reveal and adds nothing the owner needs.

### 11.2 Hide Amounts: where it applies (all of them)

| Surface | Rule |
|---|---|
| Obligation amounts, price steps and price history, expected and billed figures, cycle payment lines | Masked (`$••••`) through one `useMoney` helper reading `loadHideAmounts` |
| Subscription and commitment summaries, annualized figures, savings, cost increases | Masked |
| Overview figures and the optional money Today card | Masked (the card receives `hideAmounts`) |
| Transaction picker and reference lines | The existing `hide` prop; "Show amounts" reveals temporarily |
| **Calendar item titles and ICS** | **Carry no amount at all**, so there is nothing to mask (Services precedent) |
| **Search results** | Title, provider and type only; no amounts |
| **Today counts** | Counts only; no amounts |
| Insight and attention text | Titles, dates and counts; money only through the masking function (S5 rule) |

Public tests and docs use invented providers and amounts only. A test must fail if any title, Search subtitle, Today line or Calendar/ICS text contains a currency amount.

### 11.3 Backup and G1 safeguards

No new secret is introduced. G1's integrity checks, the manifest, the Pre-Import safety copy and the privacy warning apply to Bills records as to every module. A privacy review of the final diff (no real data in fixtures, no account numbers in code, no amounts in text) is part of every phase's acceptance.

### 11.4 External sharing

None. No data leaves the device in B1 to B5. No AI model, API, proxy or background agent is introduced.

## 12. Deterministic insights, figures and AI readiness

### 12.1 Principles

Every figure is computed on read by a pure function that the page, the Today card and any later assistant all call. Nothing is stored. Each figure shows a one-line "how this is worked out" and counts what it left out. An estimate is never added to a recorded payment. Insights are called **insights**, never "AI". Language follows the S5 rule: a plain observation, never blame, never "you forgot".

### 12.2 Definitions: every total the module displays (rewritten in Revision 2)

**Two families that are never put on one line and never added together:** **Commitments** (what is *expected*; a plan, not money that moved) and **Recorded payments** (what Finance, or the owner, says was paid). Each screen puts them under different headings, and every figure carries "how this is worked out" and the count of what it left out. Everything is computed on read by pure functions; nothing is stored.

| # | Figure | Definition | Always excludes | Label shown |
|---|---|---|---|---|
| T1 | **Expected cash needed, next N days** (commitments) | For each period whose timing date falls in the window and that is not skipped: its **remaining** amount (6.3). Split **Known** (owed basis billed or fixed-expected), **Estimated** (variable typical value) and a **count with unknown amount** (in neither total). Autopay periods are included and labelled automatic. | skipped periods; periods with `remaining` 0; `loan`-tracked and `paidThroughLoan` obligations; periods inside a pause or after an end; Finance scheduled forecasts | "Expected, not paid" |
| T2 | **Typical month, averaged** (commitments) | T4 divided by 12, labelled "averaged over 12 months". Known and Estimated kept apart | same as T4 | "Averaged" |
| T3 | **Known recurring commitments** | The Known part of T4 only (billed or fixed amounts), per obligation and in total | same as T4 | "Known" |
| T4 | **Estimated annualized cost** (commitments) | The sum of the expected amounts of every derived period in the next 12 months, each at the price step in force on its date (so a known price increase is included), split Known / Estimated / count unknown | skipped and paused periods; ended obligations; loan-tracked and `paidThroughLoan` ones (listed separately as "See Loans") | "Next 12 months, expected" |
| T5 | **Bills recorded payments** (recorded) | H3 `spend()` over one cost record per period: its confirmed Finance pieces (live amounts, each `pieceKey` once, refunds lower it) or, if it has no link, its typed `paid-outside` amount (conflicting typed amounts count 0 and are listed). For a chosen period: Finance pieces by the live transaction's date, typed amounts by `paidOn`; an undated typed amount appears only under "All time". Shows three parts: **linked in Finance**, **typed outside Finance**, and an information line "of which pending in Finance $X" (never subtracted). | declarations without an amount; suggestions; stale references (0, listed); loan-tracked obligations; Project money | "Recorded payments, each counted once (recorded in Finance or by you; not bank-confirmed)" |
| T6 | **Cost increases** | From price steps: for each obligation whose step changed in the period, new minus old per period and the **annualized impact** (difference times periods per year); upcoming steps as "rises on 1 Mar". Plus a gentle "the amount paid differs from the expected price" nudge for a fixed obligation whose last two confirmed payments both differ in the same direction | variable bills (never an "increase" from one odd payment) | "Price changes" |
| T7 | **Review list: what stopping would change** | The annualized expected cost (T4's method, from the later of today and any cancellation effective date) of the obligations the **owner put on the review list** (`review.on`), split by their `need` label (essential, flexible, not sure) with counts and an unknown-amount count | any obligation not on the list; anything inferred from usage | "If you stopped everything on your review list: $X a year (your selection, not a prediction)" |
| T8 | **Across-modules recorded payments** (B5 only) | Section 12.5 | see 12.5 | "Recorded payments across Household Services, Home & Assets and Bills, each counted once. Not all household spending." |
| T9 | **Loans line** (B5, optional, needs owner approval A-8) | `monthlyTotal` from the Loans page for non-scenario, non-HELOC loans: principal and interest, typed escrow, typed PMI | added to nothing unless the owner switches on "include loan payments in my monthly view" | "From your Loans page (a model, not lender statements)" |

**Amount sanity rules:** an estimate is never a payment; a billed amount is a claim, not a payment; a scheduled Finance amount is an instruction, not a payment; only T5 and T8 contain money that moved.

### 12.3 Deterministic insights (each pure, each with a stated threshold)

| Insight | Rule (proposed thresholds, all reviewable) |
|---|---|
| Rising subscription costs | A fixed obligation with a price-step increase in the last 12 months, with the annualized impact |
| Unexpected price change | A fixed obligation whose last two confirmed payments both differ from the expected step by at least 5 percent and at least $1 in the same direction |
| Variable bill outside its usual range | At least 3 other clear recorded payments, a stable usual value, and this one at least 1.5 times or at most half of the median and at least $10 apart (the S5 "unusual cost" shape) |
| Upcoming expensive periods | Month totals of the next 12 months where a month is at least 1.25 times the median month and at least $100 above it |
| Renewals with a short notice window | A `noticeByDate` within 14 days (and a `renewalDate` within 30 days) |
| Missing payment confirmations | Periods at primary labels P9 (autopay not yet seen) and P14 (not confirmed paid), counted and listed, never called unpaid |
| Possible duplicate payment | Net paid at least 1.8 times what is owed, or two linked payments of equal amount within 7 days in one period: "check for a duplicate payment" |
| Duplicate or overlapping subscriptions | Same provider Contact, or two subscriptions whose normalised titles share at least 80 percent of their words, or an owner-entered shared category label; always "possible", acknowledgeable |
| Payment after cancellation | 7.3 step 5 |
| Possible duplicate representation | A Finance scheduled spending item whose normalised payee matches an obligation's provider or hints and that is not linked |
| Review list | Counts and the T7 figure, only for what the owner listed. Any obligation may be listed (the `need` label is a suggestion, not a restriction); essential ones are labelled "review the cost or alternatives, cancelling may not be possible" |
| **Unused subscriptions** | **No insight.** Ledger has no usage data and nothing is inferred |

### 12.4 AI readiness (read-only interfaces, no AI built)

No model, no conversational interface, no external API, no background agent, and no data sent anywhere in B0 to B5. The reader structure that a future "Ask Ledger" could call, accurately and without re-implementing any calculation:

| Interface (pure, read-only, returns ids, names, dates, counts; money only on explicit request) | Answers |
|---|---|
| `loadBillsOverview(today)` / `buildBillsOverview` | Whole-module state; the same object the Overview and Today card use |
| `upcomingObligations(window)` | "What is due in the next two weeks?" |
| `commitments(today)` | "What are we committed to in a typical month or year?" (Known / Estimated / unknown) |
| `deadlines(window)` | "What do I have to cancel by when?" |
| `priceChanges(window)` | "Which prices went up?" |
| `unconfirmedCycles()` | "Which bills have no recorded payment?" |
| `obligationsForProvider(contactId)` | "Everything with this provider" |

Defaults for any later use (carried from the handoff): no phone, email, amount, URL or notes in any model context by default; proposals only with an exact preview and explicit confirmation; no external credentials in browser code; a separate architecture approval before any external model.


### 12.5 B5 extension: recorded payments across Household Services, Home & Assets and Bills (Revision 2, conservative)

**What I traced.** `householdSpend` (S5) builds records for Services (`payRecords`) and Home & Assets (`costRecords`), decides typed-amount "payment events" from `recorded-as` links, narrows by period, then calls the **unchanged** H3 `spend<Mod>()` over one list. `spend()` counts each `pieceKey` once, lets a counted whole transaction cover its parts, lowers the total by refunds, counts stale references as 0 and lists them, credits a shared piece to the **first** record in the order given, and adds typed amounts record by record. Its `Mod` type is `'services' | 'home'`, and `modOf` decides a record's module from its id prefix. `spend()` itself is generic over group labels. Bills cycles can therefore be a third claimant **without changing `spend()`**.

**Design: do not change what S5 reports; add a separate result.**

1. **Gate 1 (before any B5 code): a golden master.** Add a test that records the complete output of the existing `householdSpend` (every field: totals, pieces, claims, reconciliation, counts, review) for the whole S5 matrix and for the 300 seeded random worlds, and fails on any difference. It must pass on the code as it is today.
2. **Gate 2: a behaviour-neutral extraction.** Move the block that builds the union record list (events, left-out typed amounts, period narrowing) into an exported `unionRecords(input, lookup, period)` that `householdSpend` itself calls. The golden master proves nothing changed. **If the golden master cannot be built, or the extraction changes any byte, B5 drops the cross-module figure** and Bills shows its own total (T5) with "also counted in Household Services / Home & Assets" chips only (the fallback; no S5 file is touched).
3. **New function `recordedAcrossModules`** in `src/modules/bills/acrossModules.ts`: take `unionRecords(...)` for Services and Home (the identical S5 records), append one **Bills cost record per period** (group `bills`; references from the period's non-superseded `payment-link` facts; a typed `paid-outside` amount only when the period has no link and its typed amounts do not conflict), call the unchanged `spend<'services'|'home'|'bills'>` once for the union, and once per module on that module's records alone for the module totals. Fixed record order: services, home, bills, so a shared piece is credited to the first and shown as merged for the others.
4. **S5's own screens keep calling `householdSpend`.** The Services overview shows exactly what it showed. The three-module result appears only on the Bills overview, titled as in T8. S5's `servicesCents`, `homeCents`, `linkedInBothCents`, reconciliation and claims are **not redefined**; the new result has its own fields (`billsCents`, `linkedInSeveralCents`, a three-way reconciliation derived claim by claim, as S5 derives its own).

**How each required property is met:**

| Required property | Mechanism |
|---|---|
| Preserve every S5 result | Gates 1 and 2; S5 screens untouched; with zero Bills records, `recordedAcrossModules` equals S5 on every numeric field (test) |
| Each distinct Finance piece once | `pieceKey` through `spend()`, across all three claimants |
| Never match typed amounts by value | No pair link exists between Bills and the others, so a typed Bills amount is simply included beside the others. A hint (same Contact, same day, typed on both) is raised, never changing a total |
| Do not add Finance scheduled forecasts | The function never reads `recurring`, `recurringLog` or the forecast. A pending entry posted from a scheduled item counts **only** if some record references it, like any transaction; an unposted scheduled item counts nothing |
| Do not add Projects spending twice | Project money is never read. A piece that Finance also tags to a Project is counted **once** as a recorded payment and carries the S5 context count and a "Tagged to Project X" chip; no Project paid total is added |
| One payment referenced by Bills, Services and Home & Assets | Counted once; credited to Services (first in order); Home and Bills claims are `merged`; "linked in several" shows its amount; nothing is divided |
| A whole transaction overlapping parts across modules | `spend()`'s rule that a counted whole covers its parts, applied over the union; each module's own total still shows the parts as that module counts them; the reconciliation shows "covered across modules" |
| Refunds and stale references | A refund is a negative piece counted once; a stale reference counts 0 in each record that holds it and is listed once per record; if another module holds a valid reference to the same piece, the piece counts through that one |
| Obligations versus recorded spending | Section 12.2: different headings, never on one line, never summed |
| Not "all household spending" | Mandatory label and a one-line scope: "Only payments linked or typed in these three places; rent, food and everything else are outside them" |

**Test matrix for this extension (rows 69 to 80 of section 13):** golden master on the S5 matrix and 300 random worlds (identical); zero-Bills equality; one piece in all three modules; whole in Bills over parts in Services; parts in Bills under a whole in Home & Assets; parts with different split indexes in two modules; refund counted once; stale in one module and good in another; typed amounts equal in two modules (both counted, hint raised); Project-tagged piece (counted once, no Project money); a pending scheduled-posted entry referenced by nobody (counts nothing); order independence; and "no Finance table read except `txns`".

## 13. Edge-case and financial-integrity test matrix

Types: **U** unit (pure), **D** real-Dexie integration, **S** real `SyncEngine` two-device, **B** backup round trip, **M** mutation check (the production code is deliberately broken to prove the test fails), **UI** browser check. All data invented. Cents are whole cents.

| # | Scenario | Expected result | Phase | Type |
|---|---|---|---|---|
| 1 | Autopay $15.49, due 12 Dec, no transaction, today 13 Dec | "Scheduled for automatic payment"; recorded $0; not counted anywhere as paid | B2/B3 | U |
| 2 | Same, today 16 Dec | "Autopay not yet seen in Finance, please check"; recorded $0 | B2 | U |
| 3 | A matching $15.49 expense appears on 12 Dec, unconfirmed | Suggestion chip; recorded stays $0; one tap stores the link; then recorded $15.49 | B3.1 | U, D |
| 4 | Confirmed link, the transaction's amount is later edited to $16.49 | State `changed`; live $16.49 used; flagged; the snapshot is not used as spend | B3 | U |
| 5 | Confirmed link, transaction deleted | State `missing`; counts 0; badge "A linked payment needs review"; the stored link is kept; label returns to its timing label (example 5 of 6.8) | B3 | U, D |
| 6 | A split part is linked; the transaction's splits are later reordered | `split-changed`; counts 0; must be re-picked; never moves to the part now in that slot | B3 | U |
| 7 | One $200.00 payment linked from two bills (whole transaction) | Recorded total counts $200.00 once; each bill shows "shared with 1 other bill"; neither is allocated $100 | B3 | U |
| 8 | The same payment linked from a Bills cycle and a Services visit | The three-module recorded-payments figure counts it once (12.5); each module shows its own chip | B5 | U |
| 9 | A whole transaction and one of its parts linked on the same cycle | Refused at save with the existing plain message | B3 | U |
| 10 | Billed $120.00, paid $60.00 then $60.00 (two pieces) | Partly paid ($60.00 of $120.00), then Paid; recorded $120.00 | B3 | U |
| 11 | Billed $120.00, paid $130.00 | Paid, plus "paid more than billed, check for a credit" | B3 | U |
| 12 | Paid $120.00, then a $120.00 refund linked | Net paid $0; label reverts; refund shown as "money back"; reversal review item | B3 | U |
| 13 | Provider credit $20.00 typed on a $120.00 bill | Owed $100.00; credit never in any paid total | B3 | U |
| 14 | Variable bill, six recorded payments | Typical = median; range shown; a $460.00 cycle against a $90.00 median and 3 or more clear samples is flagged; with only 2 samples never flagged | B5 | U |
| 15 | Annual $1,200.00 insurance | Full $1,200.00 in the cash lens on its date and $100.00 in the averaged lens, never both on one line | B2/B5 | U |
| 16 | Every pattern in 5.1 over a full year plus 12 months ahead | Exact date lists (weekly, 2-weekly, 4-weekly, twice monthly incl. last business day, monthly, every 2/3/6/12 months) | B1 | U |
| 17 | Day 31 into April, 29 to 31 into February in a leap and a non-leap year | Clamped to the last real day | B1 | U |
| 18 | Oracle: slot path equals `generateDates` for all plain day rules, 10 years | Identical lists | B1 | U, M |
| 19 | Weekend with previous-business-day adjust that would leave the month | Refused at save with an example | B1 | U |
| 20 | Schedule changed on 1 Jun: 12th becomes the 20th | Dates before 1 Jun stay on the 12th, after on the 20th; stored cycle facts keep their slots (the June bill stays one period, no duplicate, no orphan); nothing deleted | B2 | U, D |
| 21 | Pause 1 Feb to 30 Apr; resume | No expected cycles in the pause; resume continues | B2 | U |
| 22 | Obligation added today | No past cycle is derived (`trackingSince`); no "missed" pile | B2 | U |
| 23 | Skipped cycle | Excluded from expected and from "not confirmed paid" | B2 | U |
| 24 | Manual bill past due, **no** invoice | "Not confirmed paid", never "Overdue" | B2 | U |
| 25 | Manual bill past due, invoice entered, no payment | "Overdue (billed, no payment recorded)" | B2 | U |
| 26 | Trial month (price step 0) | "No payment expected"; not in due lists or cash requirement | B2/B4 | U |
| 27 | Intro price to regular price on 12 Feb | Cycle before uses the intro step, after uses the regular; a Calendar "price change" is not required | B4 | U |
| 28 | Cancellation requested, then confirmed, then ended | Status stays active until the owner ends it; no future cycles after `endedOn`; history intact; a later matching charge raises the after-cancellation check | B4 | U, D |
| 29 | Renewal date passes | "Did it renew?" prompt; nothing renews, no transaction or cycle is created | B4 | U |
| 30 | Calendar: linked to a Finance rule | Bills marker suppressed on dates Finance shows; shown where Finance does not; drift note when dates differ | B3.1 | U, D |
| 31 | Calendar: open pay Task for the next cycle | No duplicate marker for that cycle; later cycles derived; horizon moves with the clock; nothing stored | B2 | U, D |
| 32 | Calendar: obligation linked to a Services arrangement that has a renewal date | Bills renewal marker suppressed; Services' shown | B4 | U |
| 33 | Today counts versus Overview counts | Identical for shared categories | B2/B5 | U |
| 34 | Hide Amounts on | No currency amount in any title, Search subtitle, Today line, Calendar or ICS text; pages and the picker masked | all | U, UI |
| 35 | Obligation with history, Delete | Replaced by End; preview text; no data lost | B1 | D |
| 36 | End, then Reopen | Status and cycles restored; no duplicate Task | B1 | D |
| 37 | Replace provider (successor) | Old ended with `predecessorId`, payments stay on old, successor clean, one transaction, Undo | B4 | D |
| 38 | Undo then change by another device | Refused, nothing written | B1/B2 | D, S |
| 39 | Two devices record facts for the same period offline | Every fact from both devices is kept (separate records); links union by `pieceKey`, no double count; disagreements detected per N9 and shown with the N10 buttons | B2/B3 | S |
| 40 | Two devices change the same obligation | Last writer wins; the other version saved and restorable | B1 | S |
| 41 | Obligation deleted on A, cycle added on B | Orphan detected; repair offered; nothing silently lost | B2 | S |
| 42 | Backup then restore (including tombstones) | Every Bills record, link, ref and Task marker equal; Finance tables unchanged | B1 to B5 | B |
| 43 | `bills` rows through current backup, restore and sync with unknown future fields | Preserved byte for byte | B1 | B, S |
| 44 | Finance rule deleted after linking | Pointer shows "deleted"; nothing changes in Bills totals; no crash | B3.1 | D |
| 45 | Finance rule edited (amount, frequency) after linking | Drift note only; no automatic change | B3.1 | U |
| 46 | Income or transfer rule | Cannot be linked | B3.1 | U |
| 47 | Same rule linked from two obligations | Refused; if it arrives by sync, flagged | B3.1 | U, S |
| 48 | Loan-tracked obligation | Excluded from matching, "not confirmed paid", "Overdue", cash and commitment totals; shows "Tracked in Loans"; accepts no payment links (see row 83) | B3/B5 | U |
| 49 | Every Bills operation | Every Finance table identical before and after | B1 to B5 | D, M |
| 50 | Mutation checks | Breaking: the paid threshold, the Overdue rule, the autopay rule, `pieceKey` dedupe, the suggestion tier, the grace period, the horizon end, `trackingSince`, the timing partition, the label precedence order, the "suspend a declaration on reversal" rule, the one-source rule, the conflict detector or the "payment counts, skip never removes it" rule each makes at least one test fail | B2 to B5 | M |
| 51 | Random worlds (the S5 style) | Invariants hold over several hundred generated households: totals equal the sum of included claims, order independence, each piece once | B3, B5 | U |
| 52 | Performance | Overview of 100 obligations and 2,000 cycle facts stays linear (operation counts, not wall time) | B5 | U |
| 53 | **Identity:** a due date moves (a `due-date` fact) | Same `slot`; facts stay attached; timing uses the new date | B2 | U |
| 54 | **Identity:** schedule revision changes the day (12th to 20th) while a June invoice already exists | One June period (`m2026-06`); no duplicate expected period and no orphan; nominal date now the 20th | B2 | U, D |
| 55 | **Identity:** the business-day adjustment is edited | Nominal date moves inside the month; slot and all facts unchanged | B2 | U |
| 56 | **Identity:** twice-monthly with a 31st, last business day, February, December to January | `a` and `b` canonical, each inside its own month; never swapped by which date comes first | B1/B2 | U |
| 57 | **Identity:** weekly weekday changed; every-N parity changed | Weekday change keeps the `w` Monday slot; a parity change leaves old weeks under "From an earlier schedule" | B2 | U |
| 58 | **Identity:** monthly changed to twice-monthly or every two months | Old facts stay under "From an earlier schedule"; payments still count; "Move to another billing period" writes the new slot and `movedFrom`, undoable | B2 | U, D |
| 59 | **Identity:** two obligations due the same day; an extra invoice in an already-billed month | Separate by `obligationId`; the extra gets an `x` slot | B2 | U |
| 60 | **Conflicts:** every N9 case (two invoices, two skips, two due dates, skip plus payment, typed plus link, one piece on two periods, repeated invoice number, two different typed amounts) | Detected, listed, never auto-resolved; each button (Use this one, Different bills, Leave as is) works, keeps the other fact as history and passes Undo | B2/B3 | U, D |
| 61 | **Idempotency:** double press; reopening an invoice form; look-alike extras | One record; the existing invoice is edited; a look-alike notice and no rejection | B2 | D |
| 62 | **Conflicts:** two different due dates | "Due date unclear"; Calendar uses the nominal date with "due date to be confirmed" | B2 | U |
| 63 | **Timing partition:** `d` from -400 to +400 | Exactly one class at every value (and "unclear" when dates conflict); boundary cases 8, 7, 1, 0, -1 and the grace edge | B2 | U, M |
| 64 | **Label precedence:** every combination of skip, owed state, paid state, declaration, suspension, timing, arrangement and invoice | Exactly one primary label; never "Paid" with remaining above 0; never "Overdue" with evidence; no settlement word anywhere | B2/B3 | U, M |
| 65 | **Finance status:** a linked pending, then cleared, then reconciled transaction; a bank-file match | Chip follows Finance's own status (and "seen in an imported bank file" only when `externalId` or `fingerprint` is present); totals unchanged by status; a string scan finds no "settled", "bank-confirmed" or "received" | B3 | U |
| 66 | **Declaration versus live Finance:** C1 to C5 (stale link, reversal, amount change, under-payment, typed plus link) | Declarations are suspended or qualified in words, never silently override; re-affirming clears a suspension; the old declaration stays as history | B3 | U |
| 67 | **Zero amounts:** a confirmed $0.00 invoice; an expected $0 trial month with a payment found anyway | "No payment due" satisfied without payment; "No payment expected" does not hide a real payment (shown as overpaid or recorded) | B2/B3 | U |
| 68 | **Partial and credits:** billed $120.00, credit $20.00, paid $60.00 | Owed $100.00, paid $60.00, remaining $40.00; the credit is never in a paid total | B3 | U |
| 69 | **Union gate 1:** golden master of the full S5 `householdSpend` output on the S5 matrix and 300 seeded random worlds | Identical before and after the behaviour-neutral extraction | B5 | U |
| 70 | **Union:** zero Bills records | `recordedAcrossModules` equals S5 on every numeric field and claim | B5 | U |
| 71 | **Union:** one payment linked from Bills, Services and Home & Assets | Counted once, credited to Services, others merged; not divided | B5 | U |
| 72 | **Union:** whole transaction in Bills over parts in Services | Whole counted, parts covered; Services' own total still shows its parts | B5 | U |
| 73 | **Union:** parts in Bills under a whole in Home & Assets | Same rule in the other direction | B5 | U |
| 74 | **Union:** parts with different split indexes in two modules | Each distinct piece once; the reconciliation explains the difference | B5 | U |
| 75 | **Union:** a refund piece linked in two modules | Lowers the total once | B5 | U |
| 76 | **Union:** stale in one module, valid in another | Counts through the valid one; the stale one is listed, counts 0 | B5 | U |
| 77 | **Union:** equal typed amounts in two modules | Both count; a hint (same Contact, same day) only | B5 | U |
| 78 | **Union:** a piece Finance also tags to a Project | Counted once; context count and chip; no Project money read | B5 | U |
| 79 | **Union:** a pending entry posted from a scheduled item that no record references | Counts nothing; the function reads no scheduled-item table | B5 | U |
| 80 | **Union:** record order changed; Finance tables read | Same total and same pieces (credit may differ, never the total); only `txns` is read from Finance | B5 | U |
| 81 | **Offline:** each device adds a different payment link to one period; then syncs | Both links present on both devices; union; no double count | B3 | S |
| 82 | **Offline:** skip versus payment; two invoice amounts; end versus fact; schedule change versus invoice; orphan repair | Each row of 10.4 behaves as stated; nothing deleted; every repair is previewed and undoable | B2/B3 | S |
| 83 | **Loans:** a loan-tracked obligation and a `paidThroughLoan` insurance obligation | Excluded from matching, cash and commitment totals; "See Loans" link; the escrow hint is dismissible and changes no figure; payment links are refused | B3/B5 | U |
| 84 | **Review list:** an essential obligation put on the list | Allowed; neutral wording; T7 includes only listed obligations, split by need label with counts; nothing is inferred | B1/B5 | U |
| 85 | **B1 proportionality:** all Services semimonthly and Undo tests pass unchanged; fallback agreement test | Services behaviour unchanged; if the helper is copied, a sweep test shows the copy equals Services' `slotDate` | B1 | U |
| 86 | **Local Undo guard (B1):** change a record after an action, then Undo | Refused, nothing written; without an intervening change the rows are restored exactly | B1 | D |

## 14. Proposed phased implementation roadmap (updated in Revision 2)

The phase structure **B1, B2, B3, B3.1, B4, B5 is unchanged** from Revision 1 and from the review. Revision 2 changes only what is inside some phases (B1.0 is smaller; B2 and B3 carry the fact records and the new state model; B5's cross-module figure is gated). The three Revision 1 departures from the original hypothesis stand: contract dates are in B2, B3 is split, and B1 starts with a small prerequisite step.

Each phase ends the same way as Household Services: report, handoff and backlog updated, owner checklist, **no commit or push without the owner's authorization**, then verify the Actions run before the next phase.

### B1: Obligation registry, provider links, schedule definition, basic lifecycle

- **Scope:** (1) **B1.0, before any Bills code, a spike with two outcomes:** *date helper.* Move `semimonthly.ts` to `src/lib/` and leave a one-line re-export in Services (Services tests unchanged), confirm that `slotDate` serves a single slot stepped by N months, and add the oracle test against `generateDates`. **Fallback if that cannot be done without changing any Services output (or if the single-slot month-edge behaviour differs): do not move it.** Copy the roughly 30-line single-slot resolver into `src/modules/bills/monthSlots.ts`, and add a sweep test proving it equals Services' exported `slotDate` for every slot kind, adjustment, month and year in a ten-year range. Duplication is then explicit and tested, and Services is not touched. *Undo:* **no extraction.** B1 builds the small local guard of section 10.5 inside `src/modules/bills/`. (2) Module shell `#/bills`. (3) `obligation` record: defensive reader, strict save validation, unknown fields preserved. (4) Add/edit form (three questions, "More details" including the review-list checkbox), list with filters, detail page skeleton, small Overview (counts and the **typical commitments** figure T2 to T4 with Known/Estimated/unknown, labelled averaged). (5) A pure `expectedDates(obligation, from, to)` for every pattern in 5.1 that honours `trackingSince`, pauses, end, schedule history and price steps and returns **slot ids and nominal dates** (needed because the commitments figure and the "next three dates" preview use it); **nothing derived is stored.** (6) Provider Contact link with name snapshot. (7) Status active, paused, ended with Reopen (a pause writes one `pauses` interval); permanent delete only when empty; local Undo. (8) Search, Quick Add `bs`, `records` hook, `backupSummary` label. (9) First price step only (full price-step editing is B4; the data shape is final now).
- **B1 does not need, and must not build:** cycle fact records, slot identity storage, conflict detection, the label ladder, timing classes, any Finance reading beyond account and category pickers, the Calendar layer, Tasks, the Today card, contract-date markers, cancellation or renewal workflows, cross-module links, insights, loan handling beyond the `loanId` field and the "Tracked in Loans" label. Everything in B1 works from the obligation record alone. (Confirmed against the B1 scope list: nothing there reads a fact record or a Finance transaction.)
- **Files likely to change:** new `src/modules/bills/*` (`index.tsx`, `BillsModule.tsx`, `model.ts`, `schedule.ts`, `data.ts`, `validate.ts`, `views.ts`, `commitments.ts`, `undo.ts`, `ObligationForm.tsx`, `ObligationPage.tsx`, `ListPage.tsx`, `OverviewPage.tsx`, `quickAddDef.ts`, `searchSource.ts`, `records.ts`, `paths.ts`, `bills.css`, tests, and `monthSlots.ts` only if the fallback is used); possibly moved `src/lib/semimonthly.ts` (+ re-export); `src/modules/index.ts` (one line); `src/lib/backupSummary.ts`; `docs/module-hooks.md`, README. **Not touched:** `services/undo.ts`, any Services behaviour.
- **Dependencies:** owner decisions 15.A; ChatGPT's approval of Revision 2; a B1 brief.
- **Acceptance:** every pattern in 5.1 produces exactly the expected dates (tests 16 to 19, 56); an obligation can be added in three questions at 375 px in light and dark with Hide Amounts; commitments figures match hand-computed cases and show Known/Estimated/unknown; ended obligations keep everything; delete refused when history exists; any obligation, including an essential one, can go on the review list (test 84); Search and Quick Add work and clash-check at start-up; backup round trip (tests 42, 43); two-device obligation edit (test 40); local Undo refuses after an intervening change (test 86); Finance tables identical after every operation (test 49).
- **Regression:** the 2,265-test baseline passes unchanged, including all Services semimonthly and Undo tests (test 85); `backupCoverage` and G1 tests; Quick Add clash tests; `tsc` and build clean.
- **Explicit deferrals:** everything in "B1 does not need" above.
- **Stop conditions:** the helper can be neither moved nor copied with an agreeing sweep test; a test shows a need to change `merge.ts`, `backup.ts` or `db.ts`; any code path writes a Finance table; the local Undo guard grows beyond the B1 actions (then stop and ask, rather than build a framework).

### B2: Occurrences, due dates, Tasks, Calendar, Today, contract dates, manual cycle facts

- **Scope:** derived occurrences with schedule revisions, pauses, ends and `trackingSince`; **the identity and normalization contract (3.4a)**; `cycle` fact records for **`invoice`, `due-date`, `paid-outside`, `paid-in-full`, `skip` and `credit`** with the conflict detector (N9), the three repair buttons (N10), idempotent forms (N11) and the "From an earlier schedule" and orphan lists; **timing classes (6.2), amounts (6.3), evidence and the label precedence (6.4, 6.5) for everything that needs no Finance data** (a typed or declared payment only; links arrive in B3); a pure `bills` due provider and the new layer `..._107` (rolling 12 months, no stored events, no duplicates with Tasks); contract dates (renewal, notice-by, trial end) with Calendar markers; opt-in Tasks (pay, notice, trial) with "Done, mark paid" in one transaction and "finished, not yet confirmed"; Upcoming and Needs-review pages; the `bills.attention` Today card (counts only); cash-timing figure T1 (Known/Estimated/unknown) for 7, 30 and 90 days; the local Undo guard extended to fact records and Tasks.
- **Files likely to change:** new `occurrences.ts`, `slots.ts`, `cycleModel.ts`, `cycleFacts.ts`, `cycleConflicts.ts`, `timing.ts`, `amounts.ts`, `labels.ts`, `dueProvider.ts`, `tasks.ts`, `todayCards.tsx`, `UpcomingPage.tsx`, `ReviewPage.tsx`, `CycleDialogs.tsx`; small edits `calendar/model.ts` (`BILLS_ID`), `calendar/data.ts` (seed entry); `docs/due-provider.md`, `docs/module-hooks.md`.
- **Dependencies:** B1 deployed and reviewed.
- **Acceptance:** tests 1, 2, 15, 20 to 26, 31, 33, 39, 41, 53 to 64, 67, 81 (typed part), 82; the Calendar shows 12 rolling months with no duplicate against an open Task and nothing stored; no Task exists for a future period; autopay is never called paid or overdue; Today counts equal the Overview; Hide Amounts clean (test 34).
- **Regression:** Tasks, Calendar, Services Calendar-layer and Today tests unchanged; the Task editor preserves the Bills markers (test, as proved for Services); baseline plus B1 green.
- **Explicit deferrals:** any Finance transaction link, suggestions, scheduled-item pointer, price-step editing UI, cancellation workflow, cross-module links, insights beyond counts.
- **Stop conditions:** a Calendar item appears twice in any configuration tested; a Task is created without a user setting; any derived date contradicts the oracle; a timing or label test finds a combination with no label or two labels; a Finance table changes.

### B3: Finance payment links and reconciliation

- **Scope:** `payment-link` facts: confirm a payment by picking Finance pieces (the existing `TxnPicker`, no suggestions yet) or enter "paid outside Finance" (the `costSource` one-source rule and switch confirmation); the **Finance-status chip** from `Txn.status` and bank-file evidence (4.1a); stale-reference review for all `RefState`s; contradiction handling C1 to C5 (6.4); partial, overpay, refund, reversal and credit behaviour (6.3, 6.8); T5 recorded payments through unchanged `spend()` by period and by type; "shared with N other bills" and cross-module chips through the read-only `pieceIndex` (E3); loan-tracked and `paidThroughLoan` obligations excluded (4.9); Today counts for stale links.
- **Files likely to change:** new `payments.ts`, `billsSpend.ts`, `financeStatus.ts`, `PaymentUI.tsx`, `pieceIndex.ts` (lib), tests; edits inside the module's pages.
- **Dependencies:** B2 deployed and reviewed.
- **Acceptance:** tests 4 to 7, 9 to 13, 39, 48, 51 (random worlds), 64 to 68, 81, 83 (loan part); one-source rule; a payment never counted twice in any module combination tested; no settlement wording anywhere (test 65); browser checks of link, unlink, stale and reversal flows with pending, cleared and reconciled invented transactions.
- **Regression:** H3 and S3 spending tests unchanged (`spend()` is not modified); `txnRef`, `costSource` tests unchanged; Services and Assets totals unchanged.
- **Explicit deferrals:** suggestions and match scoring, scheduled-item link, onboarding detection, the cross-module recorded-payments figure.
- **Stop conditions:** any need to modify `spend()` semantics, `txnRef`, or a Finance table; a double count found in the matrix; any wording that implies bank settlement.

### B3.1: Match assistance and the Finance scheduled-item link

- **Scope:** `suggestMatches` and the three tiers (4.7); the picker's `suggested` and initial-filter props (E1; existing callers unchanged); `suggestion-reject` facts; `payeeHints` with consent; link an obligation to a Finance scheduled spending item (`scheduledRuleIds`) with the validation in 4.2; strong evidence through `recurringLog` (a suggestion, never proof); drift notice; Bills marker suppression for dates Finance already shows; "Bills you may not be tracking" from unlinked scheduled items and `detectRecurring`; "possible duplicate representation" insight.
- **Files likely to change:** new `suggest.ts`, `scheduledLink.ts`, `Untracked.tsx`; edit `src/ui/TxnRefs.tsx` (optional props only); `dueProvider.ts`.
- **Dependencies:** B3 deployed and reviewed; owner decision on the optional **B3.2** (create a Finance scheduled item from a bill; needs a prefill parameter on Finance's Scheduled page, so it needs explicit approval to touch a Finance page).
- **Acceptance:** tests 3, 30, 44 to 47; no suggestion is ever stored or counted; ranking is deterministic and order independent; Finance tables identical after link and unlink.
- **Regression:** `rules.test.ts`, `schedule.test.ts`, Ledger Calendar-provider tests, `txnPickerHide` test, CSV import tests unchanged.
- **Explicit deferrals:** creating or editing a Finance scheduled item (B3.2), any change to Finance forecast or alerts.
- **Stop conditions:** a need to change `schedule.ts`, `RecurringRule` or the forecast; false positives that cannot be controlled by tiers and consent.

### B4: Subscription lifecycle, cancellation, renewal and price history

- **Scope:** cancellation workflow (request, confirmation, end, after-the-fact check; 7.3); the "did it renew?" flow and renewal history; price-step editing (intro, increase, trial) with the annualized-impact preview; monthly to annual billing change as a schedule revision; replace/migrate successor (single transaction, Undo); documents as `DocRef` links; `bills-for` links to a Services arrangement or asset and `involves` to a Project, with the "one date, one owner" suppression (8.6); trial-conversion helper ("trial ended, please check").
- **Files likely to change:** new `lifecycle.ts`, `cancellation.ts`, `prices.ts`, `replace.ts`, `crossLinks.ts`, `LifecycleDialogs.tsx`, `PriceDialogs.tsx`; small read-only edits to Services' and Assets' pages are **deferred to B5**.
- **Dependencies:** B3.1 (the after-cancellation check uses suggestions).
- **Acceptance:** tests 27 to 29, 32, 37; a cancel-by reminder never changes status; a renewal date never creates a period or transaction; history and payments survive ending; a replacement leaves no duplicate Task.
- **Regression:** Services contract and Calendar tests unchanged; Tasks unchanged.
- **Explicit deferrals:** automatic renewal or cancellation of anything, reading contracts, notifications outside the Calendar and Tasks.
- **Stop conditions:** any path that changes lifecycle state without an owner action; a change needed in Services' records.

### B5: Consolidated Overview, commitment analysis, insights, cross-module figure and acceptance

- **Scope:** the full Overview from one pure reader shared with Today; the figures T1 to T7 and insights in 12.2 and 12.3, each with its definition and exclusions; the review-list figure T7; **the three-module recorded-payments figure T8 only if Gate 1 and Gate 2 of 12.5 pass** (golden master, then the behaviour-neutral extraction), otherwise Bills shows its own T5 with chips; the provider-linked view and read-only "Bills" cards on the Services provider page and the asset page; the **optional** Loans line T9 (default off, owner approval A-8) and the "See Loans" links; optional money Today card (only if the owner approves); AI-readiness readers (12.4) as pure exports; performance test; owner acceptance checklist.
- **Files likely to change:** new `overview.ts`, `overviewData.ts`, `insights.ts`, `commitments.ts`, `acrossModules.ts`, `OverviewPage.tsx`, `OverviewParts.tsx`, a golden-master test; **a behaviour-neutral extraction of `unionRecords` inside `services/householdSpend.ts`**, only after Gate 1; `services/ProviderPage.tsx`, `assets/AssetPage.tsx` (small read-only cards).
- **Dependencies:** B4 deployed and reviewed.
- **Acceptance:** tests 8, 14, 33, 48, 50 to 52, 69 to 80, 83, 84; Overview and Today counts agree; every figure shows its definition and what it excluded; the S5 household matrix passes unchanged; owner checklist produced and every real-device item labelled NOT TESTED unless actually run.
- **Regression:** the whole suite; S5 household tests; Home & Assets overview tests.
- **Explicit deferrals:** AI interface, notifications service, account-number fields, file storage, forecast integration, Calendar `bill` handoff changes, reading bank data, a shared Undo framework.
- **Stop conditions:** the golden master cannot be built, or the extraction changes any byte of S5 output (then drop T8, do not edit S5); a figure that cannot be explained claim by claim; any need to modify `spend()`.

## 15. Architectural judgment calls requiring approval (updated in Revision 2)

### 15.A Owner decisions (plain English, one round, each with a recommended default)

A-1, A-2, A-4, A-5, A-6, A-7, A-9 and A-10 are **unchanged** from Revision 1. A-3 and A-8 are **revised**, and **A-11 is new**.

| # | Question | Recommended default | Alternative | What it means in practice |
|---|---|---|---|---|
| A-1 | Where should bills and subscriptions live? | **A new "Bills & Subscriptions" module** beside Finance and Household Services. Finance's Scheduled page is left exactly as it is. | Grow the Scheduled page into a bills tool | Nothing in Finance moves or changes. A new entry appears in the module bar. |
| A-2 | What happens to my existing Finance Scheduled items? | **They stay as the payment instructions** (and keep feeding the forecast). A bill can optionally *point at* one. Nothing is converted, posted, edited or deleted by Bills. | Convert them into bills | Your forecast and reminders keep working as today. You choose, one by one, whether to track one as a bill. |
| A-3 *(revised)* | When does Ledger call something paid, and what does it say about Finance's pending and cleared? | **Paid only with evidence or your own statement.** Evidence is a Finance transaction you linked, "I paid this outside Ledger", or "paid in full" with no amount. **Finance's own status is shown beside it** (pending, cleared, reconciled; "seen in an imported bank file" when true) and **Ledger never says "cleared by the bank" or "settled"**. A suggestion never counts until you confirm it. Autopay is "scheduled", not paid. "Overdue" appears only when you entered a bill (invoice) and have not paid it; otherwise "Not confirmed paid". The main word is "Paid" with a line under it such as "Recorded in Finance: pending". | Treat any unmatched past date as overdue; or use "Payment recorded" as the main word | Fewer false alarms and no claim Ledger cannot back up. A bill you linked to a pending Finance entry reads "Paid, recorded in Finance: pending" until you clear it in Finance. |
| A-4 | How should the Calendar and Tasks behave? | **A new Calendar layer shows a rolling 12 months** of expected dates (worked out, not stored). **Tasks only for the next thing you must do:** on by default for bills you pay by hand and for cancel-by and trial-end dates, off for autopay. | Create a Task for every bill; stored recurring events | A tidy Task list; cancel-by dates are reminded by default; nothing piles up. |
| A-5 | Should a new bill show missed past payments? | **No.** Tracking starts the day you add it (you can pick an earlier date on purpose). | Backfill from the start of the schedule | Adding a bill never creates a pile of "overdue" history. |
| A-6 | Who owns the renewal and cancel-by dates of a service agreement (a lawn-care contract)? | **Household Services keeps them.** If a bill is linked to that agreement, Bills shows the dates once, from Services. | Re-enter them in Bills | One date, one place; no duplicate Calendar entries. |
| A-7 | Quick Add shortcut for a bill or subscription | **`bs`** (and the word `subscription`). Finance's `b` and `bill` are unchanged. | Take over `b` and `bill` | Typing `b ...` still adds a Finance scheduled payment as it does now. |
| A-8 *(revised)* | How should a mortgage or loan payment appear? | **Listed with a "See Loans" link, and left out of matching, "not confirmed paid" and every Bills total.** (Loans records a payment as two entries, a transfer and an expense, and does not know your real tax and insurance payments.) Insurance or tax paid through the loan can be marked "paid through the loan" by you (never guessed). **Optional, off by default:** a separately labelled line "From your Loans page (a model, not lender statements)" showing principal and interest plus the escrow and PMI you typed there. | Take the amount from the loan schedule into the Bills totals; or track the mortgage like any other bill | You are never shown a mortgage as "unpaid" or double counted. The mortgage figure you see, if you turn it on, is clearly a model. |
| A-9 | What may be stored, and what is masked? | **No account or card numbers, passwords or access codes, ever.** Provider = an ordinary Contact. **Hide Amounts covers every figure**, and no amount appears in Calendar titles, Search or Today text. | Optional masked reference numbers | A leaked backup reveals less. If you later want reference numbers it needs a separate approval. |
| A-10 | The phase plan | **B1 to B5 as in section 14** (B3 split into B3 and B3.1; contract dates in B2). B5 adds the combined "recorded payments across Services, Home & Assets and Bills" figure **only if a safety test of the existing figure passes first** (12.5), and **no money card on Today** until you approve it. | One bigger Finance phase; money card from B2 | Smaller reviewable steps; the highest-risk parts are isolated and gated. |
| A-11 *(new)* | Which items can go on my cancellation or cost-review list? | **Any of them.** "Essential" and "flexible" are only suggested labels you can change. Putting something on the list never cancels it. The "what stopping would change" figure counts **only what you listed** and never guesses from usage. Essential items read "review the cost or alternatives". | Only "flexible" items may be listed | You can review your internet bill or insurance price without being told it is optional. |

### 15.B Architectural decisions for ChatGPT's independent review

"Rev 2" marks a decision that changed or was refined.

| # | Decision | Recommended | Main alternative | Section |
|---|---|---|---|---|
| B-1 *(Rev 2)* | How expected occurrences exist | **Hybrid:** derived, plus sparse stored `cycle` **fact** records only when something real is recorded | Persist 12 months; derive only | 3.4, 3.6 |
| B-2 | Where price steps, schedule revisions and the lifecycle log live | **Embedded in the obligation** (edited rarely, by one person); escalation path if review disagrees: append-only records of the same shape as facts | Separate append-only records now | 3.2, 10.4 |
| B-3 *(Rev 2)* | One date resolver | Move Services' slot helper to `src/lib/` with a re-export and an oracle test; **fallback: copy it into Bills with a sweep test proving it equals Services' `slotDate`** | Import from Services directly; a Bills-only engine | 5.2, 14 |
| B-4 *(Rev 2)* | Undo | **No extraction.** A small local guard in `src/modules/bills/undo.ts` covering exactly the Bills actions; a shared framework deferred until a third module needs it | Extract Services' guard in B1; no Undo | 10.5 |
| B-5 | Sync policy | **No change to `merge.ts`**; the fact model, read-time union, conflict detection and explicit repair instead of a deletion-wins rule | A Bills deletion-wins rule like Assets | 10.4 |
| B-6 *(Rev 2)* | Concurrent facts for one period | **Different facts are different records and are kept; singular facts that disagree are detected and shown, never auto-merged; repair is explicit and undoable; superseded facts stay as history** | One mutable cycle record with a merge rule | 3.4a, 10.4 |
| B-7 | Wording on Today's generic "Overdue" list | The provider's item states "Not confirmed paid: no payment recorded yet"; autopay is never returned as overdue | Hide unmatched items from Today's list | 5.4 |
| B-8 | Cross-module link type | New type `bills-for` (obligation to arrangement or asset), reuse `about` and `involves` | Reuse `serves` | 8.2 |
| B-9 *(Rev 2)* | A union rule for payment links on concurrent edits | **Not needed**: links are separate records. Kept only as the last-resort fallback to the fact model | Build it now | 10.4 |
| B-10 *(Rev 2)* | Cross-module recorded payments | **A separate `recordedAcrossModules` function**; S5's `householdSpend` is not changed; Gates 1 and 2 (golden master, neutral extraction) precede it; fallback: no union, chips only | Widen `householdSpend`'s `Mod` | 12.5 |
| B-11 | Picker suggestions | Optional props on `TxnPicker` (E1) | A new picker | 4.8 |
| B-12 | The Calendar `bill` event handoff | Left with Ledger in B1 to B5 | Move it to Bills | 8.7 |
| B-13 | `trackingSince` | Defaults to the day the record is added | Defaults to the schedule's first date | 5.6 |
| B-14 | Tasks | Markers `billsObligation`, `billsCycle` (the `slot`), `billsPurpose` in unknown fields; link type `about` | A Bills-owned reminder store | 5.5 |
| B-15 | Cross-module touches | One layer id `..._107` and one seed entry in Calendar; one label in `backupSummary`; E1 and E3; the gated `unionRecords` extraction in B5 | None possible without these | 17 |
| B-16 | Obligation `type` | A fixed list with `other`; behaviour never depends on it | Owner-defined types | 3.2 |
| B-17 *(Rev 2)* | Cycle dispositions | Replaced by facts: `skip`, `paid-in-full`, `paid-outside` are facts, not a stored status; "disputed" and "waived" deferred | Add them now | 3.4 |
| B-18 | "Overdue" threshold | Invoice recorded plus manual plus past due plus no evidence | A grace period on top | 6.5 |
| B-19 *(new)* | Primary wording | **"Paid" plus a mandatory evidence line** that carries Finance's own status | "Payment recorded" everywhere | 4.1a |
| B-20 *(new)* | Cycle identity | **Immutable period `slot`** (`m`, `s`, `w`, `x`) plus separate editable due date; explicit "move to another period" is the only identity change | Nominal date as key (Revision 1) | 3.4a |
| B-21 *(new)* | The one refinement of an accepted decision | Keep two kinds; make each `cycle` record **one fact** rather than one mutable record per cycle. Justified by a demonstrated failure: whole-record last-writer-wins plus a device-local conflict list capped at 50 can lose a payment link | One mutable record plus a merge rule | 3.4 |
| B-22 *(new)* | Loans | Exclusion with "See Loans"; optional separate modelled line; explicit `paidThroughLoan`, never inferred | Read loan schedule into totals | 4.9 |
| B-23 *(new)* | Review list | Any obligation may be listed; `need` is a suggested label | Only flexible items | 3.2, 12.2 |

## 16. Risks, deferrals and open questions (updated in Revision 2)

### 16.1 Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | The household tracks the same bill as a Finance scheduled item **and** a Bills obligation and thinks the amounts add up | Medium / medium | They are never summed; an explicit link; "possible duplicate representation" notice; on-screen definitions (12.2) |
| R2 | A wrong match is confirmed | Medium / low | Never automatic; one-tap unlink; the transaction is untouched; "not this one" memory |
| R3 | Autopay read as "paid", or a pending entry read as "cleared" | Medium / high | State wording, grace period, the mandatory Finance-status line, no settlement words (test 65), mutation checks |
| R4 | *(narrowed)* Whole-record last-writer-wins on an **obligation** edit (a price step, a schedule revision, an end) made on two devices loses one | Low / medium | Facts and payment links are not exposed to it (Revision 2). Obligation edits are rare and single-owner; the conflict list is best effort (device-local, capped at 50); escalation path: move those lists to append-only records (10.4) |
| R5 | Two Tasks or two Calendar entries for one occurrence | Medium / low | Same recipe as Services; tests 30, 31 |
| R6 | Moving the slot helper changes a Services date | Low / high | Move plus re-export with Services tests unchanged, an oracle test, and the copy-and-sweep fallback |
| R7 | *(changed)* The local Undo guard grows into a framework | Medium / low | Scope fixed to the Bills actions; stop condition in B1 |
| R8 | Scope creep into accounting, forecasting or reminders services | Medium / high | Section 4.10 guard list, test 49, explicit deferrals per phase |
| R9 | Match suggestions read a very large transaction list | Low / low | Suggestions only for periods on screen; the in-memory snapshot pattern Search already uses (a 20,000-transaction scan was measured at about 8 ms there) |
| R10 | An amount leaks into a Calendar title, Search result or Today line | Medium / medium | Test 34 fails the build if any currency text appears |
| R11 | Adopting an old Finance rule imports a long backlog of "due" dates | Medium / medium | Bills ignores the rule's backlog (`trackingSince`); Finance's own behaviour is unchanged |
| R12 | Home & Assets and Household Services real-device acceptance is still **not done** | Known | Carried; Bills inherits its Calendar and Task behaviour |
| R13 | A device with a wrong clock | Low / medium | Existing sync limitation (documented) |
| R14 | Loan data is a model, not statements | Known | Exclusion and "See Loans" by default (4.9); optional line labelled as a model |
| R15 | Quick Add words clash | Low / low | Start-up rejects clashes; tests |
| R16 *(new)* | Fact records raise the record count (a few per paid period) | Low / low | A household with 50 bills fully recorded adds hundreds of small rows a year, against thousands of transactions already held; readers group with one pass (test 52) |
| R17 *(new)* | The conflict screens (N9, N10) are more complex than the usual path | Medium / low | They appear only when facts disagree; the three-button pattern is the same everywhere; tested in the browser at 375 px |
| R18 *(new)* | The golden master for S5 cannot be built, or the extraction changes S5 output | Low / medium | Stop condition: drop the three-module figure; Bills shows its own total with chips; no S5 file is edited |
| R19 *(new)* | "Paid" beside a pending entry confuses a reader | Low / low | Mandatory evidence line; wording is owner decision A-3 with a named alternative |

### 16.2 Deferrals (not in B1 to B5)

AI of any kind; bank connections (the standing decision is manual CSV; SimpleFIN is the option to revisit); notifications outside Calendar and Tasks; automatic renewal, cancellation or payment; creating or editing Finance scheduled items (B3.2, only if approved); account or reference numbers; file storage for statements; "every N days" schedules; billing-period (service period) dates; a holiday calendar; a usage-based "unused subscription" insight; per-period disputes and waivers; any `merge.ts` rule; **a shared Undo framework**; a visual redesign; Family Management and Personal CRM.

### 16.3 Open questions

1. Does the owner have existing Finance scheduled items that are really bills? (I did not and must not inspect the owner's data.)
2. Is the autopay grace period of 3 days right, and should the "Due soon" window of 7 days be adjustable?
3. Should the optional money card appear on Today at all (A-10)?
4. Are the insight thresholds in 12.3 sensible, or should they be tuned after the owner sees real figures?
5. **UNVERIFIED (each is a B1.0 or later spike with a stated fallback):** the single-slot behaviour of `slotDate` at month edges (fallback: copy and sweep test); the body of `buildSchedule` (draw, repay and rate-shock phases; only matters if the optional Loans line is approved); that an older build carries `bills` rows through backup and sync untouched (G1 says it does; B1 must test it); the Task editor's handling of the new marker keys (proved for Services' keys only); that `#/ledger/transactions?txn=<id>` still opens a transaction (read, not run).
6. Whether to keep "Paid" with an evidence line (recommended) or "Payment recorded" as the primary word (A-3).

## 17. Source-file impact map (updated in Revision 2)

**New (all inside `src/modules/bills/` unless stated):** the files listed under each phase in section 14, plus tests: reader, schedule oracle, slot identity, fact conflicts, timing and label exhaustive tests, payments, suggestions, Calendar provider, Today counts, privacy (no amounts in text, no settlement words), backup round trip, two-device `SyncEngine` scenarios, the S5 golden master, and mutation helpers (following the Services test organisation).

**Small edits to existing files (all additive; each named in the phase that makes it):**

| File | Change | Phase | Risk guard |
|---|---|---|---|
| `src/modules/index.ts` | register `billsModule` | B1 | start-up hook checks |
| `src/lib/semimonthly.ts` (new location) and `src/modules/services/semimonthly.ts` | move plus re-export; **or nothing at all if the fallback copy is used** | B1.0 | Services tests unchanged; oracle or sweep test |
| `src/lib/backupSummary.ts` | `bills` kinds and group label | B1 | backup coverage tests |
| `src/modules/calendar/model.ts`, `src/modules/calendar/data.ts` | `BILLS_ID = ..._107`; seed entry | B2 | Calendar seed tests |
| `src/ui/TxnRefs.tsx` | optional `suggested` and initial-filter props (E1) | B3.1 | `txnPickerHide` test; existing callers unchanged |
| `src/lib/` (new `pieceIndex.ts`) | read-only cross-module piece index (E3) | B3 | pure tests |
| `src/modules/services/householdSpend.ts` | **only** a behaviour-neutral extraction of `unionRecords`, after the golden master exists; `householdSpend`'s results unchanged | B5 (gated) | Gate 1 golden master, S5 matrix and 300 random worlds |
| `src/modules/services/ProviderPage.tsx`, `src/modules/assets/AssetPage.tsx` | read-only "Bills" card | B5 | existing page tests; read only |
| `docs/module-hooks.md`, `docs/due-provider.md`, `README.md` | document Bills hooks and layer | each phase | docs only |

**Must not change (guarded by tests and the stop conditions):** `src/db.ts`, `src/lib/backup.ts`, `src/lib/backupFile.ts` (no new table), `src/lib/sync/merge.ts`, `src/lib/sync/track.ts`, `src/lib/schedule.ts`, `src/types.ts` (`RecurringRule`, `RecurringLog`, `Txn`, `Loan`), `src/lib/forecast*.ts`, `src/lib/csvImport.ts`, `src/lib/loanLedger.ts`, `src/lib/loanSchedule.ts`, `src/pages/ScheduledPage.tsx` (unless B3.2 is approved), `src/modules/tasks/*`, `src/core/recurrence.ts`, `src/modules/assets/spending.ts` semantics, `src/lib/txnRef.ts`, `src/lib/costSource.ts`, **`src/modules/services/undo.ts`** and every Services behaviour.

## 18. B1 implementation readiness criteria (updated in Revision 2)

B1 may start only when **all** of these are true:

- [ ] ChatGPT has reviewed **Revision 2** of this plan and issued a verdict, and any requested changes are applied (with revision notes, as S0 did).
- [ ] The owner has answered A-1 to A-11 (accepting the defaults or choosing otherwise), and the answers are recorded in `docs/BACKLOG.md` and `docs/CHATGPT-HANDOFF.md`.
- [ ] The owner has explicitly authorized B1. (This document does **not** authorize it.)
- [ ] `main` equals `origin/main`, the latest Pages run is green, the tree is clean, and the baseline is re-run (2,265 tests in 133 files as of this document, `tsc`, `npm run build`).
- [ ] A B1 brief exists listing scope, files, acceptance, regression, deferrals, the "B1 does not need" list and stop conditions from section 14.
- [ ] The B1.0 spike (single-slot `slotDate`, with the copy-and-sweep fallback) and the older-build carry-through test are written into the brief as the **first** steps, each with its stop condition. **No Undo extraction is in B1.**
- [ ] Invented fixtures are listed (providers such as "Example Power Co", "Streamly", "Maple Insurance", "Maple Lawn Care"; amounts such as $15.49, $90.00, $1,200.00); a privacy pass of the diff is part of acceptance.
- [ ] The owner's real-device checklist for Home & Assets and Household Services is acknowledged as still open (not a blocker, but carried).
- [ ] The handoff and backlog distinguish planned, built uncommitted, committed, deployed and acceptance-tested for Bills (today: **proposed only**, Revision 2 awaiting review).

## Appendix A. What B0 changed in the repository, and the Git and deployment state

**Files created (Revision 1):** `docs/BILLS-SUBSCRIPTIONS-B0-PLAN-2026-11-07.md` (this document, revised in place in Revision 2).
**Files modified (documentation only):** `docs/CHATGPT-HANDOFF.md` and `docs/BACKLOG.md`. Revision 1 recorded S5 as committed and deployed (it said uncommitted) and B0 as a proposed design. **Revision 2 changes the same three files only** and records B0 Revision 2 as awaiting independent review, not approved, with B1 not authorized.
**No application source, test, schema, dependency, configuration or runtime state was changed in Revision 1 or Revision 2.** No commit, stage or push was made. The only command that ran code was the read-only baseline `npm test` (2,265 passed in 133 files) in Revision 1.
**Git and deployment state:** branch `main`, `HEAD` = `origin/main` = `6863ac2d389740d54d5998240c688ea0a0ac3a39`, Pages run #67 `success`; the working tree has three documentation changes (one new file, two modified), **uncommitted and unstaged**.

## Appendix B. Source limitations

- This plan is based on reading the repository, not on running Bills (it does not exist). Statements of the form "the code does X" come from reading the named files; where I did not read the whole file or run the behaviour, the text says **UNVERIFIED**.
- Revision 2 additionally read: every site that sets `Txn.status` (`txnCreate`, `QuickTxn`, `schedule.ts`, `loanLedger.ts`, `csvImport.ts`, `ledger.ts`, `transfers.ts`, `LedgerPage.tsx`), the `Loan` types, `recordLoanPayment`, `nextRow`, `monthlyTotal`, the Calendar's loan item, `spend()` in full, `householdSpend`'s record building, events, narrowing and claim generation, and the sync engine's conflict store. **Not read:** the body of `buildSchedule`, the rest of `householdSpend` after claim generation (hints and totals), the Finance reconcile screen, and any UI code.
- Nothing here was tested on a real device, and no real household data was inspected.
- Thresholds in 12.2 to 12.3 and the 3-day grace and 7-day "due soon" values are **proposals** for review, not measured against real data.
