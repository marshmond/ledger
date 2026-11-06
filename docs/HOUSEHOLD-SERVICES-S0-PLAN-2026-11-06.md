# Household Services S0: architecture and integration design

Date: 2026-11-06. Status: **REVISION 2 (after architectural review). Architecture approved in principle by ChatGPT; owner decisions Q1 to Q9 accepted as planning defaults subject to the refinements below. DESIGN ONLY. This revision is awaiting final review. Nothing built, committed or pushed.** S1 is *proposed*, not authorized.
All examples in this document are invented. The repository is public: no real providers, addresses, codes or amounts appear here.

## 0. Revision 2 (2026-11-06): what changed and where

Review verdict applied: overall architecture approved in principle; Q1 to Q9 accepted as defaults; five refinements required before S1. Everything not listed here is unchanged, including the S1 to S5 sequence.

| # | Refinement | Changes made (section) |
|---|---|---|
| 1 | Recurrence and scheduling authority | New **6.6 to 6.10** (6.6 authority and reschedule semantics, 6.7 drift detection and resolution, 6.8 no-duplicate-Task rules for pause/resume/replace and concurrent devices, 6.9 timed appointments, 6.10 regression requirements). 5.2 gains a cadence **anchor date** and a Task **occurrence marker**; 6.2 item 3 and 6.3 revised; S2's "optional Calendar appointment" is replaced by "timed visit = due time on the Task" (6.9); roadmap S1/S2 and acceptance criteria updated. No second recurrence engine: only `generateDates` and `normalizeRule` are used. |
| 2 | Cancellations and payments | **5.4 visit model rewritten**: skipped, cancelled and completed are different; `chargedCents` now carries a `chargeKind` (service, cancellation fee, other) so a cancelled visit can have a legitimate fee; payments may attach to any status but never change it. 6.3, 7.1 to 7.2, 7.4 (new rows), 12.2, 14.1 and S2/S3 revised. The earlier sentence "neither skipped nor cancelled visits ever carry a payment" is withdrawn. |
| 3 | Privacy | **`accountNumber` removed** from the S1 arrangement model (5.2), from the privacy table (13) and from the S1 tests. Provider account/customer identifiers are deferred until a specific use case and a privacy/storage review. The ban on codes, passwords and bank/payment instructions in ordinary notes is kept. |
| 4 | Household-wide financial integrity | **7.6 rewritten** as a full specification of `householdHomeSpend` (claims, algorithm, nine named cases, reconciliation identity, what it never claims). 7.4 and 8.2 aligned. |
| 5 | S1 scope | S1 links an arrangement to an existing asset **from the Household Services UI only**. Any reverse Home & Assets UI (asset-page card, replacement action, delete-plan sentence, prefilled record handoff) is **S4**. Revised in 8.3, 11, 16 (S1, S4) and 19 (acceptance criteria) and the file lists. |

Judgment calls made while revising (please review):
1. A reschedule changes **one visit only**; the standing cadence changes only by editing the arrangement (6.6).
2. The arrangement's cadence is anchored to its own **anchor date**, not to the Task's current due date, and Services (not `spawnNext`) computes the next due date at "Done, log it" (S2). This is how a one-time move avoids shifting later visits.
3. Drift is **detected and explained, never silently repaired**; every fix is a previewed, explicit choice (6.7).
4. A timed appointment is, by default, the **Task with a due time**; a separate Calendar event is not built in S1 or S2 (6.9).
5. For a visit linked to an asset service record by `recorded-as`, the household total treats the pair as **one payment event** and prefers Finance pieces over typed amounts (7.6). This favours never double counting over never undercounting; it is flagged on screen.
6. The household total never claims which module "owns" a shared piece (7.6).

## 1. Executive summary (plain language)

Household Services will answer "who comes to the house, how often, what did it cost, and what happened last time", without becoming a second contacts book, a second calendar, a second to-do list or a second accounting system.

**The recommended design in one paragraph.** Keep four different things as four different things:

| Thing | Where it lives | Example |
|---|---|---|
| The **provider** (a person or company) | Shared **Contacts** (no copy) | "Maple Lawn Care" |
| The **arrangement** (the standing relationship) | New Household Services record | "Lawn mowing, weekly, April to October" |
| The **visit** (what actually happened on a day) | New Household Services record, created only when a visit is finished, skipped or cancelled | "Mowed on 12 May" |
| The **reminder / next date** | An ordinary **Task** (appointments with a clock time may be a Calendar event) | "Maple Lawn Care visit, due Fri 15 May" |
| The **money paid** | **Finance transactions**, referenced read-only (the way Home & Assets H3 already does it) | the card payment on 14 May |

Everything is stored in the existing shared record store. **No new database table, no schema change, no migration, no new dependency** (Dexie stays at 15). Scheduling reuses the Tasks repeat engine unchanged. Money reuses H3's reference rules. A one-off job (a plumber came once) needs only a provider and a description: no arrangement and no Task.

**What the design deliberately refuses to do:** add a second recurrence engine, store payment amounts that Finance already holds, create a second vendor list, post or schedule payments (that belongs to the later Bills & Subscriptions module), store files, or store gate/garage codes.

**Verdict on the stop conditions** (brief section 16): none was triggered. The recurrence model needs no change to Tasks or Calendar; financial attribution needs no change to Finance; cross-device history can be preserved with current sync machinery. One genuine gap was found (section 6.4: *seasonal* schedules are not expressible in one Tasks repeat rule). A bounded, optional answer is proposed that does not touch Tasks.

**Ten things worth knowing that I found in the code** (details in sections 4 to 6):

1. There is **no Contacts screen** in the app. Contacts are created and edited through pickers and the Projects "Vendors" tab. Household Services must bring a small provider page; it cannot "reuse a Contacts page" because there is none.
2. A Contact has **no "person versus company" field and no archive**, only name, relationship, notes, phone, email and soft delete. The design copes without changing Contacts.
3. The Tasks repeat engine supports weekly, every-N-weeks, monthly (date, "2nd Tuesday", last), quarterly (every 3 months) and yearly. It does **not** support "April to October only".
4. A repeating Task only ever has **one open copy** (the next is created when you finish the current one). So "all future Fridays" do not exist as records; expected-cost projections must be computed with the existing pure date generator.
5. **Rescheduling one weekly Task can move the weekday of all later ones** unless the rule names its weekday explicitly (read from `nextDueDate` and `generateDates`; not executed). The design requires an explicit weekday.
6. `txnRef.ts` and `spending.ts` are pure and reusable, but `spend()` is typed to asset cost groups. Reuse needs one small, test-protected generalisation in S3.
7. The existing asset permanent-deletion sync rule only protects records of module `assets`. Household Services records would not be protected by it, so the design uses a different, simpler history-preserving policy (section 12) instead of copying a "deletion wins" rule.
8. Two devices completing the same repeating Task offline create **two "next" Tasks**. This is existing Tasks behaviour. Household Services must detect and warn about it (section 12).
9. The Quick Add prefixes `svc`, `a`, `b`, `p`, `t`, `e` and `$` are taken (and the words `service` and `repair` are `svc` aliases). A new prefix is needed (proposed `hs`).
10. H5 deployed correctly (section 2), but its own backlog and handoff text still said "uncommitted" because they were written before the commit. Reconciled in this batch.

## 2. Current repository and deployment verification

| # | Prerequisite | Result |
|---|---|---|
| 1 | H5 committed and pushed | **Yes.** `HEAD` = `origin/main` = `442299939c18052854d1e2175015d6115d32b937` (`feat(assets): complete overview, Today integration and final acceptance`), after `git fetch`. |
| 2 | Deployment succeeded | **Yes.** Public GitHub Actions API: "Deploy to GitHub Pages", run **#58**, `head_sha` = that commit, status completed, conclusion **success** (created 2026-11-06 15:32 UTC). `gh` is not installed here, so the public API was used. |
| 3 | H5 Modal regression safeguard | **Yes.** `src/shell/modalKeys.ts` and `src/shell/modalKeys.test.ts` (135 lines, 11 tests per the H5 report) are in the H5 commit's file list; the report's final follow-up records the real-browser re-check and mutation check. I did not re-do the browser check. |
| 4 | Read `CLAUDE.md`, handoff, backlog | Yes (all three, top of backlog in full; older backlog sections skimmed). |
| 5 | Read the H5 report and follow-up | Yes, including "Final follow-up" and the section 17 checklist. |
| 6 | Working tree | **Clean** at the start (`git status --short` printed nothing). |
| 7 | Outstanding Home & Assets acceptance | **All 14 items of H5 report section 17 remain NOT TESTED** and are carried unchanged into the handoff and backlog. Also still open: 40 px and 32 px controls, Escape-in-picker, the intermittent `core.test.ts` timing test. |

**Baseline test run (read-only, `npm test`):** 102 files, **1,629 tests passed**, 0 failed. This equals the H5 report. I did not run `tsc` or `npm run build` (no code changed).

**Stale text found and corrected in this batch:** the backlog top status and the handoff snapshot still called H5 "NOT committed". Both now record `4422999` and run #58. H5 judgment calls 1, 2, 3 and 8 were listed as awaiting review; I could not find a recorded owner verdict on them in the files I read, so they stay marked "for review" rather than "approved".

**Not checked:** the other docs under `docs/` beyond those named above, the Reports module, backup/restore code in depth, and the Search and Quick Add shell internals (only their documented hook contracts in `registry.ts`).

## 3. Product vision and primary workflows

Questions the module must answer (brief section 1), and where the answer comes from:

| Question | Answer comes from |
|---|---|
| Who cleans our house, when next? | Arrangement (provider) + its open linked Task (next date) |
| Who serviced the furnace last? | Latest visit on the arrangement; and/or the Home & Assets service record |
| How often does the landscaper come? | Arrangement cadence, checked against actual visit dates |
| What do we typically pay? | Median/average of *verified* paid visit amounts (Finance-linked or typed), labelled as such |
| Which providers have recurring arrangements? | Active arrangements grouped by provider |
| What is due this week? | Open linked Tasks (Tasks already show on Today and Calendar) |
| Did we pay for the last visit? | The visit's payment state (section 7). "Not linked" is not "unpaid". |
| What contracts/documents do we have? | Document links on the arrangement and visits (http/https only) |
| Which property or asset does it service? | Shared link arrangement -> asset |
| What has this company done historically? | Provider page: all visits whose provider is that contact |
| What when we replace a provider? | "Replace provider" creates a successor arrangement (section 5.3) |
| Expected upcoming cost vs money spent? | Two separately labelled numbers (section 7.2) |

**Minimum data for common workflows** (progressive disclosure: everything else is optional and folded away):

| Workflow | Required | Optional, added later |
|---|---|---|
| Standing arrangement | Provider name, what they do ("Lawn mowing") | How often and weekday, first date, property/asset, typical price, season, contract link, renewal date, notes |
| One-off job | Provider name, what was done, date | Amount or payment link, asset, document link |
| Record a finished visit | One tap on "Done, log it" (date defaults to today) | Amount, payment link, note |
| Schedule a visit | A date | Time (only then does it become a Calendar appointment, see 6.3) |
| Replace provider | New provider name | Ending date, reason |

Quick Add (proposed prefix `hs`): `hs Cleaner every other Friday` previews a new arrangement; `hs visit Maple Lawn Care mowed yesterday $85` previews a one-off visit. Exact grammar is an S1/S2 build detail; the preview-then-confirm and Undo pattern is the one Projects and Assets already use.

## 4. Existing Ledger capabilities and reusable components

Read in source, with the function names I found. Anything marked *(contract only)* I read only in documentation/type form.

### 4.1 Contacts
- `src/core/entities.ts` `Contact`: `name`, `relationship?` (free text), `notes?`, `phone?`, `email?`. No type (person/organization), no company link, no archive, no address.
- `src/core/contacts.ts`: `findOrCreateContact` (de-duplicates by case/accent-insensitive name in one transaction, fills only *missing* details), `updateContactDetails`, `validateContact`, `nameKey`. `repo.put` keeps unknown fields, so a future CRM can add fields to Contact without breaking Household Services.
- Deletion is **soft delete only** (`repo.remove`). Other modules reference contacts by id and cope with a missing contact (H5 report: "a removed contact shows no name and breaks nothing").
- UI: `ContactPicker` (`src/ui/pickers.tsx`) and the Projects Vendors tab (`modules/projects/Vendors.tsx`). **No Contacts screen exists.** `grep` of `src/modules` found no Contacts module.
- Tasks and Calendar events carry `contactIds`. Assets use `contacts: [{contactId, role}]` and `providerContactId` on service records.

### 4.2 Tasks (`src/modules/tasks`)
- Stored as `moduleRecords` module `tasks`, kind `task`; `TaskData` has `dueDate/dueTime/startDate`, `repeat: {mode:'fixed'|'after', rule}`, `contactIds`, `projectId`, `createdFrom`, `recurFrom`, plus unknown fields carried through (`asTask`).
- `completeTask(id, today)` marks done and (for a repeating task) creates the next one in the same transaction, copying the links; `reopenTask` removes an untouched spawned copy; `removeTasks`/`restoreTasks`, `saveTask`, `createTask(data, refs)` (stores shared links).
- Recurrence (`core/recurrence.ts`): `freq` daily/weekly/monthly/yearly, `interval`, `byWeekday`, `monthly: date|nth|last`, `end: never|until|count`. `generateDates(start, rule, from, to)` is a **pure date generator**.
- `spawnNext` / `nextDueDate` (`tasks/recur.ts`): fixed mode steps from the later of due date and completion day; "after" mode adds the interval to the completion day.
- H2 used exactly this for maintenance: a plan is an ordinary linked Task; a separate durable `service` record is written by "Done, log it" in one Dexie transaction with `completeTask`.

### 4.3 Calendar and Today
- `core/dueProvider.ts`: a module registers ONE pure, read-only `DueProvider`; the Calendar shows it as a built-in derived layer. Built-in layer ids are fixed (`9_000_000_000_000_101`..`105`; 105 = Home & Assets). `derivedId(module, recordId, date)` gives stable ids so devices never double up.
- Tasks layer shows open tasks with a due or "do on" date (with complete/reopen/reschedule actions). Calendar events (`calendar/model.ts`) are stored records with `contactIds`, recurrence, skipped dates and per-occurrence overrides.
- Today cards: `ModuleDef.contributes.todayCards`, ids `<module>.<name>`, `hideWhenEmpty`, `hideAmounts` honoured by money cards. H5's card is counts-only.
- Duplicate-reminder rule already used: Home & Assets never lists maintenance Tasks on Today because Tasks already do.

### 4.4 Home & Assets
- `AssetData` (types property/area/system/appliance/vehicle/other, parent, status incl. replaced + `replacedById`, `contacts` with roles, `refs` document links, sensitive `serialNumber`/`address`/`plate`).
- `ServiceData` (kind, title, date, `providerContactId`, `costCents|null`, `txnRefs`, `taskId`, `projectId`, `refs`). `ASSET_DEPENDENT_KINDS = ['service','warranty']`.
- H3: `txnRef.ts` (`TxnRef`, `makeTxnRef`, `resolveRef`, `pieceKey`, `validateTxnRefs`, `checkNewRefs`), `spending.ts` (`spend`, `costRecords`, `pieceUsers`), `projectAssetLink.ts` (links `projects:<id>` -> `assets:asset:<id>`, type `involves`).
- H4: lifecycle/replace (`lifecycle.ts`), orphan detection (`orphans.ts`), warranty provider layer.
- H5: `loadOverview` / pure `buildOverview` (`overviewData.ts`, `overview.ts`): the template for a read-only reader shared by a page and a Today card.

### 4.5 Finance and Projects
- `Txn` (`src/types.ts`): signed `amountCents` (outflow negative), optional `splits` **without ids**, `transferTxnId`, `recurringId`, optional `project: ProjectRef`.
- Finance scheduled payments are `RecurringRule` (`frequency` weekly/biweekly/semimonthly/monthly/quarterly/yearly, `active`) with a `recurringLog`; posting sets `Txn.recurringId`.
- Projects: `vendorContactIds` on the project; commitments and paid-to-date come from Projects' own summary (`financialView.ts`); `lib/txnProject.ts` attributes transactions to projects.
- Rule from H3, kept: **a project's money is shown beside, never added to, another module's spend.**

### 4.6 Shared infrastructure
- `moduleRecords` via `createStore().moduleStore(id)`; every record has `id`, `createdAt`, `updatedAt`, `deletedAt`. Backup/restore and sync walk every table, so records in `moduleRecords` are covered with no sync change (`docs/sync.md`).
- Shared `links` (`fromModule/fromId/toModule/toId/type`), `store.shared.links.add` is idempotent.
- Hooks in `ModuleDef.contributes`: `dueProvider`, `records` (link pickers and names), `todayCards`, `searchSource`, `quickAdd`, `createFromEvent`. Registration checks Today ids and Quick Add prefix clashes at start-up.
- Sync: per-record last-writer-wins, plus two narrow deletion rules (`projectDeletion.ts`, `assetDeletion.ts`) called from `merge.ts` and `touchAll`.

### 4.7 Conflicts and constraints found
1. No Contacts screen; no organization/archive support (4.1).
2. Tasks cannot express a season; only one open copy of a repeat (4.2).
3. Asset deletion protection is keyed to `x.module === 'assets'` (`assetDeletion.ts` `hasDependents`), so it cannot protect a `services` record without editing that file.
4. `spend()` groups are hard-coded to `acquisition | maintenance | other`.
5. `txnRef.ts` lives under `modules/assets/`; another module importing it creates a cross-module dependency (acceptable if it is moved or re-exported, see 7.5).
6. Quick Add words `svc`, `service`, `repair`, `a`, `asset`, `item`, `b`, `bill`, `scheduled`, `p`, `t`, `e`, `$`, `txn`, `expense` are taken.
7. Finance splits have no ids (fingerprint workaround from H3 applies unchanged).

## 5. Proposed record ownership and data model

All new records: `moduleRecords`, module id **`services`**, kinds **`arrangement`** (S1) and **`visit`** (S2). Same defensive-reader pattern as assets (`asArrangement`, `asVisit`: never throw, keep unknown fields, validate on save). Money in whole cents, dates `YYYY-MM-DD`, ids as numbers, record-source ids `arrangement:<n>` and `visit:<n>`.

### 5.1 Provider = an ordinary Contact (no provider record)
- **No `provider` record kind.** Provider "metadata" lives on the arrangement (role/trade is the arrangement title; provider account/customer numbers are deliberately not stored, see section 13). A provider page is a *view* that groups arrangements and visits by `providerContactId`.
- **Several people at one company:** the arrangement points at **one primary Contact** (what the owner calls the provider, normally the company: "Maple Lawn Care") and may list **extra contact ids** (the people to call). The company is a Contact too, so the existing `relationship` text ("lawn care company") is enough. Rejected alternative: add organization/person fields to Contact now. That is a Contacts-wide change that belongs to the future Personal CRM; the design stays compatible because unknown Contact fields survive `repo.put`.
- **Name snapshot:** arrangements and visits store `providerNameSnapshot` (a business name, not sensitive) so history stays readable if the Contact is deleted or not yet synced to this device. Phone and email are never snapshotted (read live from the Contact).

### 5.2 Arrangement (S1)
```
arrangement {
  title                       "House cleaning"            required
  providerContactId           number | null               null = "no provider yet" (an insight)
  providerNameSnapshot        string
  extraContactIds             number[]
  status                      'active' | 'paused' | 'ended'
  endReason                   'cancelled' | 'replaced' | 'finished' | 'other' | null
  startDate, endDate          date | null
  cadence                     { mode:'fixed'|'after', rule: Recurrence, anchorDate } | null   (null = on demand)
                              the INTENDED schedule (section 6.6); weekly rules always carry an explicit weekday;
                              anchorDate = the first intended occurrence (fixed mode), never moved by a one-time reschedule
  season                      { fromMonth, toMonth } | null    (S2 optional, section 6.4)
  expected                    { basis:'perVisit'|'perMonth'|'perSeason'|'perYear'|'quote', cents } | null
  (no provider account/customer number in S1: deferred, see section 13)
  renewalDate, noticeByDate   date | null   (S4)
  refs                        [{label,url?,note?}]  document links, http/https only (reuse AssetRef + isSafeUrl)
  notes                       string        (warning text: no codes)
  predecessorId               number | null     (successor points back; section 5.3)
  openTaskId                  number | null     (convenience pointer; truth = shared link, see 6.2)
}
```
Shared links (not fields) for relationships that other modules also look up: arrangement -> asset (`serves`, to `assets:asset:<id>`, many-to-many, same shape as `involves`), arrangement -> Project (`involves`). Reason: deletion of either end already unlinks cleanly (the precedent), and it avoids teaching the asset sync rule about a second module.

### 5.3 Provider change = successor arrangement (decision)
"Replace provider" **ends** the old arrangement (`status: ended`, `endReason: replaced`, `endDate`) and creates a **new arrangement** copying title, asset links, cadence, expected cost and notes, with `predecessorId` set. Only the successor stores the pointer, so the two records are never edited together by one action in a way that can half-sync. Old visits stay with the old arrangement and old provider forever. The old arrangement's open Task is stopped (default "Stop repeating", or keep/delete as chosen), a new Task is created for the successor, all in one transaction. Rejected alternative "edit the provider in place": it rewrites which company did past work and makes "what did we pay Maple Lawn Care in 2026" unanswerable.

### 5.4 Visit (S2)
```
visit {
  arrangementId       number | null        null = one-off job (no arrangement needed)
  providerContactId   number | null        copied at creation; independent of later arrangement changes
  providerNameSnapshot string
  title               string               "Fall cleanup" (defaults to the arrangement title)
  status              'completed' | 'skipped' | 'cancelled'      (Revision 2: three DIFFERENT facts, below)
  cancelledBy         'household' | 'provider' | null            only when status = cancelled
  date, endDate?      date                 completed: not in the future; for skipped/cancelled, the date the visit would have been
  notes               string
  chargedCents        number | null        amount BILLED for this visit, INFORMATION ONLY (never summed into spending)
  chargeKind          'service' | 'cancellationFee' | 'other' | null   what the charge is for; required when chargedCents is set
                      (completed -> normally 'service'; cancelled -> normally 'cancellationFee'; skipped -> rarely any)
  payment             'none' | 'finance' | 'manual'    one source at a time (H3 rule); allowed on ANY status (a fee gets paid too)
  txnRefs             TxnRef[]             when 'finance'
  paidManualCents     number | null       when 'manual' (paid outside Finance, e.g. cash)
  taskId              number | null        the Task it was logged from (one visit per task: duplicate guard)
  taskTitleSnapshot   string
  assetIds? via links; projectId? via link
  assetRecordId       service record id in Home & Assets if the owner chose to record it there (section 8)
  refs                document links (invoice, work order, quote)
}
```
**Skipped, cancelled, fee, payment: four separate facts (Revision 2).**
- **Completed** = the service was delivered. It is the *only* status that counts as service delivered: "last serviced", visit counts, cadence-gap checks, "typical cost per visit" and the Home & Assets handoff use completed visits only.
- **Skipped** = the household or provider chose not to have this occurrence and nothing was booked to happen (cleaner on holiday; "skip this week"). No service. A charge is unusual; it is allowed but the form says "Skipped visits usually have no charge".
- **Cancelled** = the visit was expected or booked and did not happen (by the household or the provider, `cancelledBy`). No service. It may carry a **legitimate charge** such as a late-cancellation fee (`chargedCents` + `chargeKind: cancellationFee`) and a payment for it. A cancelled visit is never shown as completed service anywhere, including with a fee and a payment attached; it appears in history as "Cancelled, fee charged $X, paid" in its own words.
- **Fee charged** (`chargedCents`, `chargeKind`) is what the provider billed; it is information, not spending.
- **Payment made** (`txnRefs` or `paidManualCents`) is what left the household, from Finance. A payment never changes `status`. **A Finance payment is never proof that work occurred**: no visit is created, completed or confirmed from a payment, and a payment on a cancelled or skipped visit means "a fee was paid", not "service happened".
- Totals keep these apart (S3): "Paid for visits" (completed), "Paid in fees for cancelled or skipped visits", "Other". Average and typical cost per visit use completed visits only, so a fee-only visit cannot lower or raise the typical price.
- Validation: `completed` needs a date not in the future and may not have `cancelledBy`; `cancelled` and `skipped` may have a future or past date; `chargeKind: service` on a cancelled visit is refused ("a cancelled visit cannot be charged as service; choose cancellation fee or other").

**Planned visits are not stored as visit records.** "Planned" is a Task (or Calendar event). A visit record exists only after something happened (completed), was deliberately passed over (skipped) or did not happen (cancelled). This is the single most important simplification: no pre-generated future records to go stale, duplicate across devices, or need reconciling with the Task.

### 5.5 Payment reference
Not a record. It is `txnRefs` on a visit (and, in S3, optionally on an arrangement for fees not tied to visits, such as a monthly retainer). Same `TxnRef` shape and rules as H3.

### 5.6 Why separate arrangement and visit records (decision 1)
A visit needs its own date, status, amount, payment, notes and provider-at-the-time; an arrangement outlives any visit, can be paused, ended or replaced, and must survive a cancelled visit. Merging them forces either one giant record that is overwritten by every visit (last-writer-wins would lose history in a two-device conflict) or an arrangement that cannot exist without a visit. Separate records also give each device its own record to write when it logs a visit.

### 5.7 New tables or migrations?
**None justified.** `moduleRecords` has a `[module+kind]` index and holds hundreds of assets in H5's performance test (301 assets, ~160 ms for a whole overview). A household has tens of arrangements and hundreds of visits per decade. Revisit only if a measured need appears.

## 6. Scheduling and recurrence strategy

### 6.1 What existing Tasks and Calendar already do

| Need | Supported today? | How |
|---|---|---|
| Weekly | Yes | `weekly`, interval 1, `byWeekday` |
| Every other week | Yes | `weekly`, interval 2 (parity set by the due date's week) |
| Monthly (date, 2nd Tuesday, last Friday) | Yes | `monthly` + `date/nth/last` |
| Quarterly | Yes | `monthly`, interval 3 |
| Annual inspection | Yes | `yearly` |
| On demand | Yes | no repeat; a Task only when a visit is planned |
| One-off appointment | Yes | a Task, or a Calendar event if it has a clock time |
| Rescheduled visit | Yes | edit the Task date, or Calendar's reschedule action |
| Skipped occurrence | Partly | Tasks have no "skip": finishing the Task creates the next; the visit record says *skipped* |
| Cancelled occurrence | Partly | same as skip, with status *cancelled* |
| "April to October only" | **No** | see 6.4 |

### 6.2 Recommended approach (one coherent model)
1. The **arrangement owns the intended cadence** (`cadence`, and `season` later) and **Tasks execute it**. The arrangement is the master because it must survive pause/resume and drive cost projections even when no Task is open; the Task is the working copy that reminds, gets rescheduled and gets finished (full authority rules in 6.6).
2. The arrangement **owns at most one open linked Task**, "the next visit". The Task is created from the cadence (title "Cleaning: Rosa's Cleaning", due date the next occurrence, repeat copied from the cadence, linked to the arrangement via shared link `about`, `contactIds` = the provider). Link, not a field, is the truth (a Task can be linked in the Task editor by the owner); the `openTaskId` field is only a convenience and is re-derived when it disagrees.
3. **Timed appointments (Revision 2):** a visit with a clock time ("HVAC technician, Tuesday 9:00") is the **same Task with a due time** (Tasks already support `dueTime`, and it shows timed on the Calendar's Tasks layer, Today and the ICS export). A separate Calendar event is **not built in S1 or S2**; why, and what would be required if the owner later wants one, is in 6.9.
4. **Completed visits** are the durable `visit` record, written by an atomic "Done, log it" (the H2 pattern): `completeTask` + `visit` write in one transaction; a repeating Task spawns the next one once and keeps the links. A Task finished elsewhere appears as "finished, not yet logged" with a Save button (the H2 `unsavedTasks` pattern, re-implemented for the `services` module; not shared code).
5. **Three concepts kept apart:** a Task *reminding the household to arrange service* ("Book furnace tune-up", no appointment yet) is a Task with the arrangement link; a *scheduled appointment* is a Task with a date (or Calendar event with a time); a *completed visit* is a `visit`. Marking a "Book..." Task done does **not** log a visit; only the explicit "Done, log it" / "Skipped" / "Cancelled" actions do. The Task gets a one-word purpose (`Remind me to book` vs `Visit`) stored on the arrangement link or Task title prefix, to be decided in S2 (small build detail).

### 6.3 Reschedule, skip, cancel (decision 9)
- **Reschedule:** edit the Task's date or use Calendar's reschedule. No visit record. **A reschedule changes that one visit only, never the standing cadence** (rules in 6.6). **Why this needs design (read from code, not executed):** left alone, `nextDueDate` uses the Task's current due date as its anchor, so moving a weekly Task to another weekday would shift every later one, and an every-other-week series could change which weeks are used if the move crosses a Sunday-to-Saturday week boundary. Revision 2 removes that dependence: the next date is computed from the arrangement's own anchor date (6.6), and weekly cadences always carry an explicit weekday.
- **Skip this visit** ("cleaner is away"): `completeTask` + visit with `status: skipped` (nothing booked; no service). Next occurrence appears. Skips are history and count in the "unexpected gaps" insight as expected, not as a gap.
- **Cancel this visit:** same, `status: cancelled` (booked, then did not happen; `cancelledBy`). Not service. May carry a cancellation fee and a payment for it (5.4); it is never shown or counted as completed service.
- **Pause arrangement:** open Task is stopped or deleted (owner's choice, default stop repeating); cadence is kept so Resume recreates it.
- **End arrangement:** status `ended`, open Task handled with the H4 choices (Keep as is / Stop repeating / Delete; shared-task delete warning reused in wording).

### 6.4 Seasonal schedules (the one real gap)
"Every Friday, April to October" cannot be one `Recurrence` (it has `until` but no start window or month filter). **Recommendation: a limited, optional enhancement inside Household Services, not in Tasks or core recurrence.** The arrangement stores `season {fromMonth, toMonth}` (e.g. 4 to 10). When "Done, log it" / skip / cancel spawns the next Task and its date falls outside the season, the *Services* action (in the same transaction) moves the spawned Task to the first in-season date produced by `generateDates` for the cadence; after the season, the same action produces a "Season starts" Task for next April. About 40 lines on top of `generateDates`, no engine change, no change to existing Task behaviour. Limits (stated now): a Task edited by hand outside Household Services is not re-fitted; winter gaps show as "off-season", never as missed visits.
**If the owner prefers zero seasonal code:** create the arrangement with an `until` date each year (a yearly "renew the season" reminder). This is the fallback and costs nothing.

### 6.5 Rejected alternatives
| Alternative | Why not |
|---|---|
| A recurrence engine inside Services | Duplicates `core/recurrence.ts`; two engines drift. Not needed (6.1). |
| Pre-generate planned visit records for the season | Stale, duplicated across devices, must be reconciled with Tasks. |
| Let the Task own the schedule (as H2 maintenance does) | Pause/resume and cost projection would lose the rule when the Task is deleted. H2 had no projection need. |
| Calendar events for every visit | A second reminder system next to Tasks; weaker completion semantics; recurring events have no "done". |

### 6.6 Scheduling authority (Revision 2)

**Rule of authority:** the arrangement says *what the schedule should be*; the Task is *the next occurrence being carried out*. Neither engine is new: dates come only from the existing `generateDates` and `normalizeRule`.

- **What is stored where.** Arrangement: `cadence {mode, rule, anchorDate}` (+ `season` later). Task (the one open "next visit"): ordinary Task fields plus a Services marker stored in the Task's carried-through unknown fields, `servicesOccurrence: 'YYYY-MM-DD'` = *the cadence date this Task stands for*, and `servicesArrangement: <id>`. The Task's own `repeat` is written from the cadence when the Task is created, so Tasks, Today and Calendar behave normally even if Services is never opened. (S1 test must confirm the Task editor preserves unknown fields on save; `asTask` and `saveTask` carry them, but the editor path was not read.)
- **Reschedule one visit.** Editing the Task's due date (or the Calendar's reschedule) moves **that visit only**. The Task keeps `servicesOccurrence` (the original cadence date), so it reads "moved from Fri 15 May to Sat 16 May". No visit record, no change to the arrangement, no change to later dates.
- **How later dates stay put (S2).** When "Done, log it", Skip or Cancel is used from Services, Services (inside the same transaction as `completeTask`) discards the date `spawnNext` computed and sets the new Task's due date to the next cadence date strictly after the finished Task's `servicesOccurrence`, found with `generateDates(anchorDate, rule, ...)` (fixed mode). For `after` mode ("3 months after the last service") the next date is the completion/service date plus the interval, as Tasks already do, because that cadence is *defined* relative to the last visit. The new Task carries the new `servicesOccurrence`. If the finished Task was moved to a date past the next cadence date, the next occurrence is the first cadence date after the finish day (no pile-up of missed visits, matching Tasks' own behaviour).
- **Change the standing schedule.** Only by editing the arrangement ("Change schedule"): a preview states "Future visits will follow this new pattern; the current open visit moves to <date>" and offers *Move the current visit too* or *Keep the current visit as it is, apply from the next one*. Saving rewrites the cadence (new `anchorDate`), then updates the single open Task in the same transaction. Nothing else changes the cadence; editing a Task never does (it is only detected, 6.7).
- **Completed in Tasks instead of Services.** A Task finished in the Tasks screen spawns its next Task by Tasks' normal rule and shows in Services as "finished, not yet logged" (the H2 pattern). The spawned copy inherits the old `servicesOccurrence`; Services detects the stale marker (it is not later than the previous one) and treats it as drift (6.7), offering "Re-align to the arrangement". No silent rewrite.

### 6.7 Detecting and resolving drift

Read-only detector `scheduleHealth(arrangement, linkedTasks)` (pure), run by the Overview, the arrangement page and S1's tests. States, in priority order:

| State | Detected when | Shown as | Explicit fixes (each previewed, none automatic) |
|---|---|---|---|
| `no-task` | active arrangement with a cadence and no live open linked Task | Needs attention: "Nothing scheduled" | Schedule next visit (creates one, 6.9) |
| `duplicate-open` | more than one live open Task linked to the arrangement | Needs attention: "N upcoming-visit tasks" listing them | Keep this one (the others are deleted with Undo); Keep all |
| `rule-differs` | the Task's normalized `repeat` differs from the cadence (frequency, interval, weekday set, monthly mode, end, mode) | Needs attention: "The task repeats differently from the arrangement" with both in words | **Make the task follow the arrangement**; **Make the arrangement follow the task** (cadence and anchor rewritten from the task); Leave as is (acknowledged for this task rule until it changes again) |
| `off-cadence` | the Task's due date is not a cadence date and does not match `servicesOccurrence`'s allowed move (a manual date edit that lost the marker, or an unmarked task) | Informational: "Due on a date outside the usual pattern" | Treat as a one-time move (stamp the marker); Re-align to the next cadence date |
| `moved-once` | due date differs from `servicesOccurrence` but the marker is intact | Quiet note on the visit: "moved from <date>" | none needed |
| `stale-marker` | marker not later than the last logged visit's occurrence (Task completed in Tasks and respawned) | Needs attention | Re-align to the arrangement |
| `ok` | otherwise | nothing | |

Rules: detection never writes. A fix is a single transaction that re-reads the live records first (so a fix chosen on stale data fails with a clear message instead of overwriting). Fixes are the only way Task and cadence are brought back together.

### 6.8 Pause, resume, replace: exactly one open Task per arrangement

**Invariant:** at most one live, open Task linked to an arrangement as its "next visit". It is enforced by one function, `ensureNextVisitTask(arrangementId)`, the only code that creates one, always inside a Dexie transaction that **first re-reads the live linked Tasks**:
1. a live open linked Task exists -> reuse it (re-aligned only if the owner chose a fix); no new Task is created;
2. none exists and the arrangement is active with a cadence -> create exactly one;
3. otherwise do nothing.

- **Pause:** status `paused`; the open Task is handled by the owner's choice (default **Remove it, with Undo**; or *Keep it as a one-off*, or *Stop it repeating*). Cadence is kept.
- **Resume:** calls `ensureNextVisitTask`: reuses a kept Task, otherwise creates one next cadence date on or after today (never a past date, so no "overdue" pile-up).
- **Replace provider:** one transaction: end the old arrangement; apply the owner's choice to the old open Task (default *Stop repeating* so a last visit stays as a one-off, or Remove, or Keep); create the successor; `ensureNextVisitTask(successor)`. The successor's Task links to the successor only. The invariant is per arrangement, so old and new never share a Task.
- **End:** same choices as Pause; ended arrangements create no Task.
- **Undo** of any of these restores the previous Task state in the same transaction pattern H4 uses, and re-checks the invariant.

**Concurrent devices.** Tasks get time-based ids, so two devices that both press Resume (or both complete the same Task) can each create a Task, and sync keeps both (existing Tasks behaviour, not changed). The design therefore does not try to prevent this; it **detects** it (`duplicate-open`, plus visit duplicates by `taskId`, 12.3) and requires an explicit, previewed choice. Alternatives considered and rejected for S1: deterministic Task ids derived from arrangement and occurrence date (collides with Tasks' own id handling and `spawnNext`), and a merge rule that deletes the extra Task (would be an automatic deletion). Two devices editing the same arrangement's cadence follow whole-record last-writer-wins with the existing conflict notice; the next `rule-differs` check then shows if the surviving Task disagrees with the surviving cadence.

### 6.9 Timed appointments: the Task keeps the job; no duplicate reminders

- **Default (S1, S2): one object, the Task.** A visit with a time is the Task with `dueTime` (and optionally `startDate` for "do on"). One reminder, one completion, one "Done, log it", one entry on Calendar and Today. Nothing to keep in step.
- **A separate Calendar event is not built in S1 or S2.** An event has no completion state, so it cannot replace the Task without losing "Done, log it", and keeping both means two Calendar entries for one visit and two reminder streams (the Tasks layer and the event). Services cannot hide either entry without changing Tasks or Calendar, which is out of bounds.
- **If the owner later wants an event** (end time, location, invitees), the rules would be: the Task stays the only thing completed and logged; the event is created *from* the Task, is linked to the arrangement, has **no reminders of its own**, and is titled "Appointment details:"; the Task carries the reminder; deleting or moving the event never changes the Task, and completing the Task never deletes the event; the Overview counts the pair as one visit (by the link). The remaining cost is the visible second Calendar entry, which is why it is deferred. This needs a fresh owner decision and is not part of Q1 to Q9.
- **Completion logging is never lost:** logging is always from the Task (or the "finished, not yet logged" list), so a deleted or edited event cannot lose it.

### 6.10 Regression requirements (targeted, in addition to each phase's general tests)

**S1 must include:**
1. Task creation writes the cadence's rule with an **explicit weekday** for weekly cadences, the marker fields, and exactly one link.
2. `ensureNextVisitTask` creates one Task when none exists, reuses an existing one, and never creates a second when called twice in a row or inside two overlapping transactions (React dev double-run safe).
3. Pause (each of the three task choices), Resume, End, Replace provider: after each, the arrangement has at most one live open Task; Replace leaves old and new with different Tasks; each is all-or-nothing (inject a failure and assert nothing changed).
4. `scheduleHealth` returns each state in 6.7 for hand-built cases, and never writes (snapshot of `moduleRecords`/`links` before and after).
5. Each fix action: previewed text matches the result; a fix on stale data refuses and changes nothing; "follow the arrangement" and "follow the task" round-trip.
6. Editing the Task in the real Task editor path (or the same `saveTask` call it uses) preserves `servicesOccurrence` and `servicesArrangement`.
7. Two real `SyncEngine` devices: both Resume offline -> `duplicate-open` after sync, nothing deleted automatically; cancel-vs-edit converges.
8. Changing the cadence ("Change schedule"): both preview options produce the stated dates.

**S2 must include:**
9. Reschedule within a week and across a week boundary, weekly and every-other-week: **later dates remain the cadence dates** and `moved-once` is shown.
10. "Done, log it", Skip and Cancel: the next Task's date equals the next cadence date after the finished occurrence, in `fixed` mode, including finishing late by a week and finishing early; `after` mode uses the service date.
11. A Task completed in the Tasks screen shows "not yet logged"; its respawned Task is flagged `stale-marker`; "Re-align" fixes it.
12. Timed visit: the Task with `dueTime` appears once on the Calendar and once in Today, and `completeTask` + visit still logs it.
13. Both devices log the same Task: two visits kept and flagged, nothing merged or removed.
14. Cancelled visit with a fee and a payment: status stays `cancelled`; it is excluded from "last serviced", visit counts, gap detection and typical cost; a Finance payment on any visit changes no status.
15. Mutation checks: remove the `ensureNextVisitTask` re-read -> the duplicate-open tests fail; remove the "completed only" filter -> the cancelled-visit test fails.

## 7. Finance integration and double-counting safeguards

### 7.1 Four money concepts, kept apart (never summed into one number)
| Concept | Stored as | Label shown | Counts as "spent"? |
|---|---|---|---|
| Estimated future cost | `arrangement.expected` + cadence, projected on read | "Expected (estimate)" | **No, ever** |
| Quoted/contracted | `arrangement.expected` with `basis: 'quote'` or a document link | "Quoted" | **No** |
| Invoiced / charged | `visit.chargedCents` | "Charged" | **No** (information, used for the reconciliation hint only) |
| Actually paid | Finance transaction pieces (`txnRefs`) or a typed "paid outside Finance" amount | "Paid" | **Yes** |

No accounts-payable ledger is created. Projects already tracks commitments for project work; Services deliberately has nothing equivalent. Quotes/invoices are document links plus one informational number.

### 7.2 Distinctions to keep on screen
- A completed visit is **not** automatically paid: payment state is `Paid (linked)`, `Paid outside Finance (typed)`, or `No payment recorded`. The last is not called "unpaid": we cannot know (cash, not imported yet, paid by someone else).
- A linked payment is **not** proof the visit happened: the payment is listed as a payment on the visit that references it, and a payment with no visit is simply not in Services (no inference from Finance payee names in S1 to S5; a "possible visits" suggestion is an AI-later idea).
- A cancelled or skipped visit may have a **fee charged** and a **payment**; both are shown in the visit's own words ("Cancelled by household, late-cancellation fee $40 charged, paid") and it never reads or counts as service delivered (5.4). Fees paid are totalled apart from payments for completed visits.
- Expected totals always carry the word "estimate" and are shown in a different card from "Paid so far".

### 7.3 Reference model: reuse, do not copy
Reuse `TxnRef`, `makeTxnRef`, `resolveRef`, `validateTxnRefs`, `checkNewRefs`, `pieceKey` **unchanged**: whole transaction or one split part (fingerprint), read-only, live Finance amount wins, stale/missing/changed-split references need review and count 0, transfers and setup entries excluded, refunds lower spend. Nothing writes to Finance. Reuse mechanics (S3): move `txnRef.ts`, `txnLookup.ts` and the picker to a shared location with the old paths re-exporting them (mechanical, all H3 tests must pass unchanged). Generalise `spend()` to take any group labels (a type parameter), with H3's three groups remaining the default. This touches Home & Assets code (permitted in S3, covered by H3's 57 tests) and **no Finance code**.

### 7.4 Double-counting scenarios

| # | Scenario | What happens | Where totals may be aggregated |
|---|---|---|---|
| 1 | Landscaping visit paid through Finance | Visit holds a `txnRef`; spend uses the live Finance amount | Visit, arrangement, provider, Services household total |
| 2 | Same transaction linked to an asset service record | Same `pieceKey` appears in two modules' records | Each module's own total counts it once. Only the household union (7.6) merges them, by `pieceKey` |
| 3 | Contractor payment also attributed to a Project | Finance holds `Txn.project`; Services holds a ref | Services shows "also counted in project X" beside the figure. **Project money and Services money are never added** (H3 rule) |
| 4 | Monthly fee paid monthly | One visit or one arrangement-level payment ref per month's transaction | Arrangement total counts each month's piece once |
| 5 | One invoice covering several visits | The same `txnRef` on several visits | Counted once at arrangement/provider level (`spend()` rule 2). Per-visit amount is **not apportioned**; the visit rows say "shared payment, 3 visits" |
| 6 | Deposit then final payment | Two refs on one visit (up to 20 refs are allowed) | Sum of both pieces |
| 7 | Refund | A positive piece; `spend = -amount` lowers the total (existing rule 5) | Wherever its visit is counted |
| 8 | Several properties, same provider | One arrangement per property (cleaner than one arrangement with two assets) | Per-property rows may exceed the provider total when a payment is linked in two; the page says so (H5 precedent) |
| 10 | Late-cancellation fee, then paid | Cancelled visit holds `chargedCents` (kind `cancellationFee`) and a `txnRef` | Counted once as "fees for cancelled or skipped visits"; excluded from typical price and from "services delivered" |
| 9 | Split transaction across distinct services | Each visit references only its own part (fingerprint check) | Each part once; a part whose structure changed needs review and counts 0 |

### 7.5 Typed amounts
Allowed only as "paid outside Finance", one source at a time (refs win if both appear, flagged), never merged with a Finance piece "because the numbers match" (no key). Switching source needs explicit confirmation naming what is dropped (H3 behaviour).

### 7.6 Household-wide summary
**Revision 2: full specification.** One pure helper, `householdHomeSpend(input, lookup, period?)`, built in S5 (its pieces may arrive earlier). It reads only: Home & Assets purchases and service records (via H3's `costRecords`), Household Services visits (and S3's arrangement-level payment refs), the `recorded-as` links, and live Finance transactions through the same `TxnLookup` H3 uses. It writes nothing, reads no Project money, needs no Finance model change, and stores no total.

**What it is, and is not.** It answers one question: *"how much money has left the household, counting each linked payment once, across Home & Assets and Household Services?"* It is **not** an allocation. It never says which module, asset, provider or visit a shared payment "belongs to", and it never splits a payment between records. Module screens keep their own totals; the two kinds of number are labelled differently and are allowed to differ (below).

**Algorithm (deterministic, order-independent):**
1. **Collect claims.** Every record yields claims: a *piece claim* per `TxnRef` (key = `pieceKey`), a *typed claim* per typed paid/cost amount (no key), or nothing (unknown cost).
2. **Resolve each piece claim** with `resolveRef` against the live transaction. `missing`, `not-spending` and `split-changed` claims are **review claims**: they contribute 0 and are listed. `ok` and `changed` claims use the **live** amount, never the snapshot.
3. **Whole supersedes parts, globally.** If any *valid* claim, from any module or record, is the whole transaction, then every claim on a part of that same transaction is "covered" and not added again.
4. **Dedupe by key.** All valid claims with the same `pieceKey` count once, whichever records or modules hold them. The result lists, for each such piece, *which kinds of record reach it* ("Home & Assets service record; Household Services visit"), never an amount per record.
5. **Typed claims** count once each, with the linked-pair exception in the table below. Typed amounts are never compared with, or merged into, Finance pieces or other typed amounts by value.
6. **Period:** each piece by its own date, typed claims by their record date, undated typed claims only under All time (H5 rule).
7. **Output:** `householdTotalCents`; its Finance part and typed part; `pieces` (each counted once); `sharedPieces`; `review` (excluded, with plain-words reason and owning record); `coveredParts`; `excludedTyped` (typed amounts deliberately not added, with reason); `unknownCost` records; and a reconciliation block (below).

**Named cases:**

| Case | Behaviour |
|---|---|
| Same Finance piece in Home & Assets and Household Services | Counted **once** in the household total; each module's own total still counts it once for itself; the page says "linked in both". |
| Whole transaction overlaps split references (same module or different) | The whole counts; its parts are `coveredParts` and not added. Consequence stated on screen: the household figure counts the whole payment, so it cannot show how it divides between parts. |
| Visit linked to an asset service record by `recorded-as` | The pair is treated as **one payment event**. Their Finance pieces are unioned and de-duplicated. If either side has Finance pieces, any typed amount on either side is **excluded and listed** ("typed amount on a linked record not added because a Finance payment is linked"). If neither has Finance pieces, the typed amount counts **once**, taken from the Household Services visit; if the two typed amounts differ, the visit's is used and the difference is flagged for review. This chooses never double counting over never undercounting, and says so. |
| Typed amount entered in both records, **no** link | Cannot be known to be the same money: **both are counted**, and nothing is merged. A hint on the Overview ("these two records may describe the same job; link them to count once") appears only when the two records are the same date, same asset and same provider; it never changes a total. |
| Unrelated typed amounts that happen to be equal | Both counted. No value-based matching exists anywhere. A test asserts it. |
| Refunds | A refund is a positive Finance piece and lowers the total by its live amount, counted once like any piece, even if the original payment is linked in one module and the refund in another. A refund linked on a cancelled-visit fee reduces the fees line, not "services delivered". |
| Missing or changed references | Missing, now-transfer or changed-split claims are excluded and listed (never replaced by the snapshot). If the same piece is also reached by a **valid** claim elsewhere (e.g. the other module holds a correct split reference), the piece counts once through that valid claim and the stale one is listed for review in its own record. A changed whole-transaction claim uses the live amount and is listed as "changed". |
| One payment covering several visits or several properties | One piece, counted once; "shared by N records" is shown; it is **not apportioned**. Per-visit and per-property rows can therefore add up to more than the household figure, and the page says so. |
| Module totals versus household total | They are expected to differ. The page shows: *Home & Assets total*, *Household Services total*, then **"Linked in both (counted once at household level)"** = the sum of live amounts of pieces reached by both modules, and **"Typed amounts not added (linked pairs)"**; and the identity `H&A total + Services total − linked-in-both − typed-not-added = household total` (property rows and visit rows are not part of the identity). A test asserts the identity for generated data. |

**Never implies an allocation that does not exist:** no "your landscaping share of this payment", no automatic split of a shared payment, no per-module breakdown of the household total, and nothing says a payment *proves* a service happened. The household total is labelled "Linked payments, each counted once", not "cost of services".

**Required tests (S5; the pure pieces earlier):** each case above; permutation-order independence (shuffle claim order, same result); identity holds on random data; nothing written to Finance or any table (snapshot); Projects money absent; period boundaries; mutation checks (drop "whole supersedes parts", drop the pair exception, drop dedupe by key -> the named tests fail).

### 7.7 Out of S0 scope (stated)
No change to balances, Reports, Finance calculations or Projects logic. A link from an arrangement to a Finance scheduled payment (`RecurringRule`) is **deferred to Bills & Subscriptions** (section 10).

## 8. Home & Assets and Projects boundaries

### 8.1 Ownership rules
| Situation | Owner | Why |
|---|---|---|
| Replace HVAC filter, descale kettle, check smoke alarm | **Home & Assets** (maintenance Task + service record) | Maintenance of a physical thing; no standing provider |
| Weekly house cleaning, lawn mowing, snow removal | **Household Services** | A relationship with a provider about the home, not about a specific asset's condition |
| HVAC contractor annual service plan | **Both, linked** | Services owns the arrangement and visits; the asset's durable maintenance history stays in Home & Assets |
| Pest control quarterly | Services (arrangement linked to the property) | |
| Kitchen renovation | **Projects**; assets linked via H3 `involves`; provider on the project | Defined scope and budget |
| One-off drain repair by a plumber | Services one-off visit; optional "Record in Home & Assets" if it concerned a named appliance/system | |

**Rule of thumb for the owner (one line):** *If it is about the condition of a thing, it is a Home & Assets service record. If it is about a person or company who comes, it is a Household Services visit. If it has a scope and a budget, it is a Project.*

### 8.2 Link, do not duplicate
- A visit on an arrangement that serves a *system/appliance/vehicle* asset and has kind maintenance/repair/inspection offers **"Record maintenance in Home & Assets"** on the completed visit. It opens Home & Assets' existing service form **prefilled** (asset, date, title, provider, kind, notes) and **saves nothing until the owner presses Save** (same pattern as the existing Project -> asset handoff in H3). It needs one new entry point and a way to receive a prefill; it does not change how Home & Assets stores or counts.
- After saving, a shared link `visit -> assets:service:<id>` (type `recorded-as`) makes both sides show each other and prevents a second offer. The link is the dedup key.
- **This whole handoff is S4.** Only completed visits are offered it (never skipped or cancelled; a fee is not maintenance).
- **Money on the prefill:** copy Finance `txnRefs` (same payment, identical `pieceKey`, safe: counted once in each module's total and once in the household total). **Do not copy typed amounts by default** (they have no key and would count twice in the two modules' own totals); a ticked, warned option allows it, and `householdHomeSpend` then counts the pair once under the `recorded-as` rule in 7.6.
- Prefilled records are marked in their notes with a back-reference text only (never private details).

### 8.3 Asset replacement or retirement
Arrangements store no asset ids; the shared link `serves` points at the asset. **S1 (Revision 2): the owner links an arrangement to an existing asset from the Household Services screen only (a picker over live assets, name and type shown, nothing sensitive).** S1 shows the linked asset's name and, read-only, its status ("Replaced", "Sold", "Archived") on the arrangement; it adds **no** card, button, link, count or text on any Home & Assets page, and edits no Home & Assets file. In **S4**, the Services reader additionally flags the arrangement ("Serves a replaced asset: move to the new one, keep, or end") and offers **Move to replacement** when `replacedById` exists; this still needs no edit to Home & Assets code, while the reverse Home & Assets UI (an asset-page "Household services" card, the prefilled handoff above, the delete-plan sentence) is S4 and does edit small Assets files. Visits keep their own asset links and history. Permanent deletion of an asset is not blocked by Services links (they are relationships, not history owners); S4 adds one sentence to the delete plan ("N service arrangements mention this; they keep their history and lose the link"), a small Assets-side edit listed under S4.

### 8.4 Projects
- Services visit or arrangement may link to a Project (`involves`) as information; the project page can list "Related services" by the reverse link, like Related assets.
- Provider page shows projects whose `vendorContactIds` include the provider (read-only).
- No project money is ever added to Services figures. The same payment may appear in a project and a visit; each shows its own lens.
- "Convert a Services job into a Project" and the reverse are **not** designed (no concrete requirement); the rule of thumb tells the owner where to start.

## 9. Provider and Contacts integration

- **Source of truth:** `contacts` table. Household Services never stores a second name/phone/email.
- **Provider page** (`#/services/providers/:contactId`, S1): header (name, phone/email shown on the page, edit through `updateContactDetails`, "Open in a task/event" is not needed), active arrangements, past/ended arrangements (with `endReason`, predecessor/successor chain), upcoming (open Tasks), completed visits (newest first), linked assets, Projects where the contact is a vendor, historical paid totals (S3), documents. Built as a read model from existing records.
- **Same company, several people:** primary Contact plus `extraContactIds` (5.1). No Contact schema change.
- **Pickers:** reuse `ContactPicker`/`findOrCreateContact` (name de-duplication). A provider is created inline from the arrangement form ("Provider name").
- **Contact deleted or missing on this device:** the arrangement shows the snapshot name with "(contact removed)" and the provider page says so; nothing breaks. Re-pointing to another Contact is a one-field fix.
- **Contact is not an archive-capable record.** "Archive a provider" is therefore *ending all its arrangements*; there is no provider archive flag. A provider with no active arrangements is shown under "Past providers".
- **Future Personal CRM:** extends Contact (notes, interactions, company link). Because Household Services reads providers only through contact ids and `updateContactDetails`, nothing needs redoing. The CRM can read arrangements/visits through the `records` hook to show service history on a contact.
- **Not built:** a general Contacts page. If the owner wants a standalone Contacts screen, that is a separate small module for the CRM milestone; S1's provider page is intentionally scoped to providers.

## 10. Documents, renewals and Bills & Subscriptions boundaries

- **Documents:** link metadata only (`label`, `https://` URL, `note`) on arrangements and visits, validated by the existing `isSafeUrl`; types are just labels (Agreement, Insurance certificate, Quote, Invoice, Work order, Cancellation terms). No upload, no binary storage, no cloud infrastructure.
- **Renewals and notice deadlines:** `renewalDate` and `noticeByDate` on the arrangement (S4). They appear as markers on a **new derived Calendar layer** "Household Services" (id `9_000_000_000_000_106`, same pattern as the warranty layer: one marker per date, nothing stored, title = arrangement title only, past dates informational). Earlier phases need no layer: the next visit is a Task. A Today card shows **counts only** ("2 renewals in the next 30 days").
- **Boundary table** (the contract with the next modules):

| Concept | Defining question | Owner |
|---|---|---|
| Household service arrangement | Does someone come to the home or do work for it? | **Household Services** |
| Subscription | Does it renew and bill automatically with no visit (streaming, software, alarm monitoring)? | Bills & Subscriptions (later) |
| Recurring bill | Is it an amount due on dates (utilities, tax, rent)? | Finance scheduled payments, evolved by Bills & Subscriptions |
| Warranty or service contract on an item | Does it cover repair of a specific asset? | Home & Assets warranty (H4) |
| Maintenance plan sold by a contractor | Both: a recurring visit and a contract | Arrangement (visits) **plus** an H&A warranty record if it covers repairs |

- **No duplicate obligations:** Services never creates a Finance scheduled payment and never posts. If an arrangement is paid by a Finance scheduled payment, that link is made later in Bills & Subscriptions; Services will read it, not own it. Contract end/renewal dates for *service agreements* belong to Services; when B&S ships it must read them through the `records` hook, not re-enter them.
- **Waste collection** (municipal, billed in taxes): allowed as an arrangement with no provider cost ("Pick-up on Thursdays"); the charge itself is a bill.

## 11. Navigation and UX proposal

Module: **Household Services**, route `#/services`, module id `services`, module #6, own icon. Two-line mobile-first screens, same visual patterns as Home & Assets (cards, "Needs attention" first, folded optional sections, 44 px targets on main rows).

| Screen | Contents |
|---|---|
| **Overview** (`#/services`) | *Needs attention* (no provider, nothing scheduled, finished but not logged, renewals soon, duplicate next-visit tasks, orphaned visits); *Next visits* (open linked Tasks, next 14 days, linking to the Task); *Recurring arrangements* (provider, cadence in words, next date, typical cost); *Recent completed work*; *Expected charges next 30 days* (labelled estimate) with *Paid recently* beside it; *Providers with recent activity*. Each section hides when empty. |
| **Arrangement page** | Header (title, provider, status chip), cadence + next date, "Schedule next visit" / "Done, log it", expected cost, linked assets/properties, documents, notes, visit history, payments, "Replace provider", "Pause", "End". |
| **Provider page** | Section 9. |
| **All arrangements / history** (`#/services/list`) | Filters: Active, Paused, Ended, One-off visits; search by title or provider name. |
| **Add arrangement** | One short form: Provider, What they do. Everything else under "More details" (How often, Where/what it serves, Cost, Contract, Notes). |
| **Record one-off service** | Provider, What, Date; optional Amount/payment, asset. |
| **Replace provider / End / Pause** | One dialog each with a review line and Undo, modelled on H4's lifecycle dialog (Keep, Stop repeating, Delete the open task). |

Integration list:
- **Global Search:** arrangement title, provider name, visit title/notes (notes searchable, never displayed in the snippet), deep links. No phone, email, account numbers, URLs or amounts in results.
- **Quick Add:** prefix **`hs`** (alias `household`); keep `svc` for Home & Assets. Words `service`/`repair` stay with `svc`. Registration already fails at start-up on a clash.
- **Today (S2/S5):** one card `services.attention`, half width, `hideWhenEmpty`, **counts only** ("1 visit not logged", "2 renewals soon"); it never repeats a Task title and never shows money (so "Hide amounts" has nothing to hide).
- **Calendar:** next visits via the Tasks layer; appointments via Calendar events; renewals via the layer in S4.
- **Contacts:** provider page and `updateContactDetails`.
- **Home & Assets:** "Record in Home & Assets" and the property/asset links; attention for retired assets.
- **Phone:** all pages checked at 375 px and dark mode in each phase (as H5 did).

## 12. Lifecycle, deletion and synchronization

### 12.1 Policy (decision 12): history is never removed by a stale device
- **No "deletion wins" rule for Services** and **no change to `merge.ts`**. Reason: the asset rule exists because assets have a *permanent delete* that must beat stale edits. Services records are mostly history; the safe default is the opposite: history survives. Visits are self-describing (own date, provider id, name snapshot, title snapshot, payment refs), so they stay meaningful even if their arrangement vanishes.
- **UI rules:** an arrangement with any visit cannot be deleted, only ended or paused. An arrangement with no visits may be removed (soft delete with Undo, open task handled with the choices). A visit may be deleted (soft, Undo) and then shows its Task as "not yet logged" again (H2 behaviour).
- **Orphans:** a visit whose arrangement is missing/deleted shows under "Needs attention: visits without an arrangement" with *Keep as a one-off* (clears the arrangement id) or *Re-attach*. Same shape as the H4 orphan card, implemented for `services`.

### 12.2 Lifecycle table
| Record/event | Behaviour |
|---|---|
| Active / archived provider | No flag. A provider with no active arrangement is "past". Contact itself is only soft-deletable; history uses the snapshot name. |
| Active / paused / ended arrangement | `status`; ended keeps `endReason`, `endDate`, predecessor/successor chain. Ended arrangements accept no new Task, still accept late logged visits ("Log a late visit"). |
| Scheduled visit | A Task; deleting or rescheduling it changes nothing in history. |
| Completed/skipped/cancelled visit | Durable; survives Task deletion, reopening, rescheduling and arrangement end. |
| Provider changed | Successor arrangement (5.3); old visits stay on the old provider. |
| Asset replaced | Flag + "Move to replacement" (8.3). |
| Asset permanently deleted | Link removed; arrangement/visits keep history; an "asset no longer exists" note replaces the name. Not blocked. |
| Finance transaction deleted/edited | Reference becomes `missing`/`changed`/`split-changed` per `resolveRef`; counts 0 until reviewed; snapshot text explains. |
| Deleted Task or Calendar event | Arrangement shows "no upcoming visit scheduled" (an insight, not an error). Visits unaffected. |
| Missing linked record on this device | Names fall back to snapshots; amounts left out; nothing throws (defensive readers). |

### 12.3 Two-device scenarios
Sync is whole-record last-writer-wins per record; the notable consequence is that two edits of the *same* record lose one of them (the app shows a readable conflict notice, added in H1 prerequisite P1). The design keeps writers on *different* records wherever possible.

| Scenario | Result with this design | Residual risk |
|---|---|---|
| A cancels the arrangement; B records a visit | Two different records merge cleanly: arrangement ended, visit exists. Services notes "visit dated after the arrangement ended" (informational). | None for data; wording only |
| Both devices finish the same visit | Two visit records are made. Duplicate guard by `(taskId)` (and `(arrangementId, date)` for tasks logged by hand) flags both for review; **nothing auto-deleted or merged** (H2 follow-up precedent). Both devices also spawn a "next" Task (existing Tasks behaviour), so the arrangement shows "more than one upcoming visit task" with the extras listed. | Needs a human click; same as H2 |
| A changes provider (successor); B edits an older visit | Visit is its own record with its own provider id; no conflict. Successor creation touches the old arrangement only to end it; B's visit edit is untouched. | If B also edits the *old arrangement* the later write wins; conflict notice appears |
| Asset replaced; arrangement edited elsewhere | Asset and arrangement are separate records; the link may point at the retired asset after merge; Services flags it. | Link added on B to an asset deleted on A leaves a dangling link, handled by "asset no longer exists" |
| Payment link removed on A, changed on B | Same visit record: later write wins; the earlier version surfaces as a conflict notice. Finance is unharmed. The owner re-links if the winning version has no payment. | Possible silent loss of a reference if the notice is missed; documented, not prevented |
| Device lacks a Contact or Finance transaction | Snapshot names; reference states `missing`; nothing counted until it syncs. | Temporary "needs review" noise right after sync |

All of the above are **design analysis**. S2 and S3 must add tests using the real `SyncEngine` and merge (the H4 approach); S5 adds the physical two-device checklist. None was tested in S0.

### 12.4 Backup/restore and sync
No new table, so backup (versioned) and sync cover the records unchanged (`docs/sync.md`). Restore must be tested with arrangements/visits/links in S1/S2 (as H5 did for the Overview). Older app builds will carry the records as unknown `moduleRecords` kinds and show nothing; sync between a new and an old build keeps the data intact. Real-device checks stay open.

## 13. Privacy and security

| Field | Default handling |
|---|---|
| Provider name, arrangement title, cadence, status | May appear in lists, search titles, Task titles, Calendar titles |
| Phone, email | Read live from Contact; shown only on the provider page; **never** in search results, Calendar/ICS text, Today, notification text or any future AI context |
| Home address, property label | The asset's name only; the address field (Assets, masked) is never copied |
| Provider account/customer number | **Not stored in S1 (Revision 2).** Deferred until there is a specific use case and a privacy/storage review (masking alone is not enough, since plain backups are unencrypted). A pasted account number in notes is covered by the notes rules below |
| Amounts (expected, charged, paid) | Shown on Services pages; Today card shows none; "Hide amounts" honoured; excluded from Calendar and ICS |
| Document URLs, contract details | Pages only, safe http/https, labels may be searched, URLs never in snippets |
| Notes | Searchable, never printed in snippets or Today; warning under the field |
| Payment instructions (bank details) | **Not supported as a field.** Keep in the contract document link |
| Gate/garage codes, passwords, bank/payment instructions (retained prohibition) | **No field, and not for ordinary notes.** The notes field shows "Do not store codes or passwords here. Plain backups and exports are not encrypted." A light best-effort warning appears if a note matches words like "code", "pin", "password" or a long digit run; this is a nudge, **not** a security control |

- Local-first: everything stays in the browser database; no new network call. Test data stays invented; fixtures use made-up names.
- Cross-module: `publicLabel`-style builders (one function that cannot read private fields) build every outward string, as assets do.
- Plain backups remain unencrypted; the existing warning stays. Encrypted storage for access secrets is a **separate future decision** (would need a vault design); until then, the recommendation to the owner is to keep codes in a password manager.
- External sharing: none. Calendar ICS export of Tasks is existing behaviour; Services adds no export in S1 to S5.

## 14. AI-readiness and deterministic insights

Nothing AI is built. The contribution is clean data and a read-only reader.

### 14.1 Reliable now (deterministic, no model)
| Insight | Basis | Phase |
|---|---|---|
| Services due in the next 30 days | Open linked Tasks | S1/S2 |
| Visits finished but not logged | Task done, no visit (H2 pattern) | S2 |
| Visits not yet confirmed | Open Task with `waiting` status or a "needs confirming" flag on the Task | S2 (if kept simple) |
| Arrangements without a provider / without a scheduled visit | Nulls and missing Task | S1 |
| Gaps in recurring service | Last completed/skipped visit older than 1.5 x the cadence interval, off-season excluded | S5 |
| Expected versus actual cost | Typical paid amount (median of verified visits) versus `expected`; labelled estimate vs paid | S3/S5 |
| Contracts approaching renewal | `renewalDate`/`noticeByDate` | S4 |
| Providers with recent activity | Last visit date | S5 |
| Payments needing a second look | `resolveRef` states | S3 |
| Repeated repairs (same asset, `repair` kind, N times in 12 months) | Counting visits/service records; threshold fixed and shown | S5 |

### 14.2 Needs judgment (statistical or AI interpretation; not in S1 to S5)
"This price rise is unusual", "this provider is getting worse", "you should switch providers", matching Finance payees to unlogged visits, extracting terms from a contract. These are labelled suggestions for later (Ask Ledger stage) and must never write data without a previewed, confirmed action.

### 14.3 Reader pattern for a future Ask Ledger
Copy the H5 pattern: one pure `buildServicesOverview(snapshot)` and one loader `loadServicesOverview()` returning a **minimised, name-only snapshot** (no phone, email, address, account number, URLs, notes). Figures come only from `spend()` and the household union, never from a model. Anything private is a separate explicit step. Recommendation (same as H5): **do not add an AI interface or context module in Services phases**; add one small module when Ask Ledger's real questions are known. No AI APIs, chatbot framework, vector store, embeddings, agents or backend are introduced. External AI use needs explicit consent, data minimisation and credentials held outside the browser, per the handoff's AI strategy; that approval is separate.

## 15. Architecture decision table (for owner and architect)

Defaults are listed in recommended order. "Consequence" = what later modules inherit.

| # | Decision | Recommended default and why | Alternatives | Consequence |
|---|---|---|---|---|
| 1 | Arrangements and visits separate records? | **Yes, two kinds** (5.6). Survives provider change, cancellation, two-device edits | One combined record; arrangement only (no visit history) | Clean history for Bills & Subscriptions and CRM to read |
| 2 | Providers stay Contacts? | **Yes; no provider record.** Primary Contact + extra contacts; snapshot name | New provider table or kind; add company fields to Contact now | CRM extends Contact; no migration of services |
| 3 | How are recurring visits scheduled? | **Arrangement cadence + one linked recurring Task** (6.2) | Calendar events; own scheduler; Task-owns-rule | No second engine; Today/Calendar/ICS work unchanged |
| 4 | Do completed visits automatically create records? | **Only through "Done, log it" (one tap), plus a visible "finished, not yet logged" list** for Tasks finished elsewhere (H2 pattern). No silent writes | Auto-log on any Task completion | Honest history; no phantom visits from unrelated "Book..." tasks |
| 5 | Where does asset-specific maintenance history live? | **Home & Assets** keeps it; Services offers an explicit prefilled "Record in Home & Assets" that saves only on Save | Services owns it; auto-copy | One durable history per asset; `recorded-as` link prevents duplicates |
| 6 | How do payments reference Finance? | **H3 references** (whole/split, read-only), one source at a time, plus typed "paid outside Finance" | Copy amounts; new payables ledger | No Finance change; reuse with a small shared extraction in S3 |
| 7 | How are shared transactions de-duplicated? | **`pieceKey`**, per module total plus one household union helper (7.6) | Sum module totals | Any future module that references transactions must use the same key |
| 8 | Provider change = successor arrangement? | **Yes** (5.3) | Edit provider in place | Per-provider history stays truthful |
| 9 | Cancellations, skips, rescheduling | Skipped and cancelled are visit statuses, never service delivered; a cancelled visit may have a fee and a payment (5.4); a reschedule moves one visit and never the cadence (6.6); pause/end/replace keep exactly one open Task (6.8). Weekly rules always carry an explicit weekday | Delete the Task; stored planned visits | One tested reschedule rule; no stale planned records |
| 10 | Interaction with Bills & Subscriptions | Services never schedules/posts payments; renewals of *service agreements* stay with Services; B&S reads them (section 10) | Services owns all recurring charges | Clear module contract; no duplicate obligations |
| 11 | New Calendar due-provider layer? | **Not until S4**, then one layer for renewal/notice markers only. Visits already ride the Tasks layer | Layer from S1; no layer ever (use Tasks for renewals) | One more fixed id (`..._106`) in S4; counts-only Today card |
| 12 | Deletion and sync conflicts | **History wins; no deletion rule in merge.ts; arrangements with visits cannot be deleted; orphans are repairable** (12.1) | Copy the asset deletion-wins rule | Smaller blast radius; no change to sync core |
| 13 | New Dexie tables/migrations? | **None** (5.7). Schema stays 15 | Own tables | Backup/sync cover everything unchanged |
| 14 | Which insights in S1 vs later? | S1: no provider/nothing scheduled/due soon. S2: not logged, duplicates. S3: payment review, expected vs paid. S4: renewals. S5: gaps, repeated repairs, dashboard (14.1) | All at S5; none until Ask Ledger | Insights are plain "insights", not "AI" |
| 15 | Privacy controls needed from day one | **No provider account number (deferred), no code/payment-instruction fields, no phone/email/amount/URL in search, Calendar, Today or AI context, notes warning** (section 13) | Add later | Retrofitting privacy after data exists is much harder |

## 16. Proposed S1 to S5 roadmap

Sequence changed from the brief's hypothesis in one respect, justified by the code: **S1 also creates the linked "next visit" Task** (without it "when are they coming next?" has no answer, and the Task is a tiny amount of code using existing `createTask`). Visit logging stays in S2. The rest of the order follows dependencies (visits before payments; payments before the dashboard and cross-module workflows).

### S1: Providers and standing arrangements (smallest useful module)
- **User-visible:** module "Household Services"; Add arrangement (provider + what they do, then optional how often/weekday/first date/linked asset/typical price/contract link/notes); arrangement page; provider page (read-only history, edit contact details); "Schedule next visit" creating the one linked recurring Task; "Change schedule" (6.6); schedule-health notices with explicit fixes (6.7); pause/resume/end; "Replace provider" (successor); Needs attention (no provider, nothing scheduled, drift); search; Quick Add `hs`; deep links. **Asset linking is one-way: from the arrangement form to an existing asset (Revision 2).**
- **Data:** `arrangement` records only (cadence with anchor date; **no account/customer number**); shared links `serves`, `about`; Task marker fields `servicesOccurrence`, `servicesArrangement`. No schema change.
- **Integrations:** Contacts (`findOrCreateContact`, `updateContactDetails`), Tasks (`createTask`, `saveTask`, stop-repeating choices; no Tasks code changed), Assets (read-only picker and status display; **no Home & Assets file or screen changes**).
- **Infrastructure reused:** registry hooks (`records`, `searchSource`, `quickAdd`), `Recurrence` UI controls (RepeatFields pattern), `generateDates`, `normalizeRule`, `isSafeUrl`.
- **Likely files:** new `src/modules/services/*` (model, data, `nextVisitTask.ts` with `ensureNextVisitTask`, `scheduleHealth.ts`, arrangement/provider pages, form, searchSource, records, quickAddDef, tests, css); edits: `src/modules/index.ts` (register), maybe `src/ui/pickers.tsx` only if a contact-picker tweak is needed; docs. **Not touched: anything under `src/modules/assets`.**
- **Risks:** Task editor preserving the marker fields (to confirm by test); drift states and their fixes; ContactPicker has no "company" concept; Quick Add grammar.
- **Tests:** model/validate/reader defensiveness; the S1 regression list in 6.10 (items 1 to 8); successor creation atomicity and rollback; search/Quick Add/records hooks; backup round trip; real `SyncEngine` two-device (cancel vs edit; both Resume); privacy tests (search, Task titles and cards never contain planted phone/email/notes/URLs, and there is **no** account-number field anywhere); a test that no file under `src/modules/assets` and no Assets screen changed. Browser: desktop + 375 px + dark, throw-away DB.
- **Prerequisites:** owner approval of S0 decisions; H&A real-device checklist may run in parallel but is not a code dependency; no deployment prerequisite beyond a green `main`.
- **Excluded:** visits, "Done, log it", any money, Today card, Calendar layer, seasons, any Calendar event, **any reverse Home & Assets UI (S4)**.
- **Acceptance (suggested, section 19).**

### S2: Visits, scheduling and history
- **Visible:** "Done, log it" / "Skip" / "Cancel this visit" (one transaction with `completeTask`); one-off visit; "finished, not yet logged" list; late visit logging; duplicate warning; visit history on arrangement and provider; timed visit = due time on the Task (6.9); cancelled visits with a fee charged and (typed note of) the fee, kept apart from completed service (5.4); Today card (counts); optional seasonal re-fit (6.4) with the fallback; cadence-anchored next date (6.6).
- **Data:** `visit` records (status, `cancelledBy`, `chargedCents` + `chargeKind`); `visit -> arrangement` field; link `about` to Task if needed. No schema change. (Finance payment links on visits arrive in S3.)
- **Integrations:** Tasks (`completeTask`, `spawnNext` untouched; Services overrides only the new Task's due date), Today. **No Calendar event.**
- **Files:** `services/visit*.ts`, `visitData.ts`, pages, `todayCards.tsx`; `index.tsx`.
- **Risks:** duplicate completion across devices; reschedule and cadence anchoring (6.6); double "next" Tasks; season edge cases (month boundaries, leap years).
- **Tests:** the S2 regression list in 6.10 (items 9 to 15); atomic rollback both ways (H2 style); duplicate detection; season fit; two-device convergence; mutation checks on the duplicate guard and the completed-only filter.
- **Excluded:** Finance references and payments, renewals, Home & Assets handoff, any Calendar event.

### S3: Financial integration
- **Visible:** expected cost on arrangement; charged amount and its kind (service, cancellation fee, other); payment link (Finance) or typed "paid outside Finance" on any visit status, never changing the status; payment state words; fees for cancelled or skipped visits totalled apart; typical price from completed visits only; arrangement/provider "paid so far" and typical amount; "Expected next 30/90 days (estimate)" computed with `generateDates`; reconciliation hint (charged versus linked payment); shared-payment note; project/asset "also counted" notes.
- **Data:** fields on visit/arrangement (additive). Possibly move `txnRef.ts`/`txnLookup.ts`/picker to a shared path with re-exports; generalise `spend()` groups.
- **Integrations:** Finance (read-only), Projects (read-only labels).
- **Risks:** touching H3 code (mitigated by re-exports + its test suite); split fingerprint limits (unchanged); expected-versus-paid wording.
- **Tests:** every scenario in 7.4; a test that nothing writes to Finance; refund; split reordering; mutation checks (fingerprint, transfer guard); year-boundary dating copied from H5 rule.
- **Excluded:** apportioning one payment across visits, linking Finance scheduled payments, the household total across modules (S5; spec in 7.6). S3 builds only Services-only totals.

### S4: Cross-module workflows and contract dates
- **Visible:** the **reverse Home & Assets UI**, deferred here from S1 (an asset-page "Household services" card listing arrangements that serve it); "Record maintenance in Home & Assets" for completed visits only (prefilled, explicit Save, `recorded-as` link); asset replacement flag + "Move to replacement"; Projects related-services card; renewal/notice dates + derived Calendar layer + Today count; asset delete plan sentence; provider history improvements.
- **Data:** `renewalDate`, `noticeByDate`; links `recorded-as`, `involves`.
- **Files:** `services/*`, small Assets edits (asset-page card, service form prefill entry, delete plan text), Projects page card, `calendar/model.ts` (new fixed id `..._106`), `docs/module-hooks.md`.
- **Risks:** Assets and Projects page edits; layer id registration; double-counting with typed amounts (rule in 8.2).
- **Excluded:** subscription billing, scheduled-payment links, auto-copy of typed amounts.

### S5: Overview, insights and acceptance
- **Visible:** full Overview (section 11), insights (14.1), the household total `householdHomeSpend` per the 7.6 specification (labelled "Linked payments, each counted once"; never an allocation), polish, accessibility pass (44 px, Escape in dialogs), backup/sync end-to-end, owner real-device checklist.
- **Risks:** performance with large histories (tripwire test as H5), keeping insight wording honest.
- **Excluded:** AI of any kind, statistical anomaly detection, external sharing.

Each phase ends with a report, a backlog entry (tests, numbered judgment calls, NOT built list) and a handoff update, as `CLAUDE.md` requires; none starts without a separate go-ahead.

## 17. Known risks, constraints and tradeoffs

1. Seasonal scheduling needs a small wrapper or the yearly-renewal fallback (6.4).
2. Reschedule/weekday shift and every-other-week parity are read from code, **not executed**; S1/S2 tests must confirm.
3. No Contacts screen and no company field: the provider page is the only provider UI; "archive provider" is derived.
4. Whole-record last-writer-wins: two edits to the same arrangement or visit lose one; mitigated by keeping writers on different records and by conflict notices.
5. Duplicate "next visit" Tasks across devices are an existing Tasks property, now surfaced in Services but not fixed.
6. A shared payment cannot be apportioned across visits; per-visit amounts for such invoices are "shared".
7. Typed amounts have no key; the `recorded-as` link rule only covers explicit pairs.
8. Notes are unencrypted; the code-detection nudge is best-effort.
9. H&A real-device acceptance is still wholly NOT TESTED; Services will inherit the same untested physical sync, offline and older-build risks until S5.
10. Intermittent `core.test.ts` timing test (pre-existing) may fail a run.
11. S3 touches Home & Assets code (extraction) and S4 touches small Assets/Projects/Calendar files; both are bounded and test-protected, but they are real edits to deployed modules.
12. Quick Add routing eats a first word equal to a prefix; `hs` was chosen to be unlikely to clash with ordinary first words.
13. I did not execute any prototype; everything above that depends on behaviour (recurrence, merge) is from reading code and existing tests.

## 18. Recommended owner decisions (one round; every item has a recommended "A")

| # | Question | A (recommended) | B |
|---|---|---|---|
| Q1 | Record structure | **A.** Provider stays a Contact; each standing service is an *arrangement*; each finished visit is a *visit*; a one-off job needs only a visit | B. One combined record per service (simpler, loses history when things change) |
| Q2 | Scheduling | **A.** Next visit is an ordinary Task (shows in Tasks, Today and Calendar); a Calendar appointment only when you add a time | B. Calendar events for every visit |
| Q3 | Recording a finished visit | **A.** One tap "Done, log it"; Tasks finished elsewhere show "not yet logged" until you save them | B. Log automatically when any linked Task is completed |
| Q4 | Money | **A.** Reference Finance payments read-only; "typical cost" and "expected" are labelled estimates and never counted as spent; typed amounts only for cash outside Finance | B. Typed amounts only, no Finance links |
| Q5 | Changing provider | **A.** "Replace provider" ends the old arrangement and starts a new one; old visits stay with the old company | B. Edit the provider on the existing arrangement |
| Q6 | Seasonal services ("April to October") | **A.** Build the small optional season fit in S2; if it proves awkward, fall back to a yearly reminder to renew the season | B. No season support at all; use a yearly reminder from the start |
| Q7 | Gate/garage codes and payment details | **A.** No field for them; notes carry a warning; keep codes in a password manager | B. A masked "access notes" field (still not encrypted; not recommended) |
| Q8 | Name and shortcut | **A.** "Household Services" at `#/services`; Quick Add `hs` | B. Another name/prefix |
| Q9 | S1 scope | **A.** S1 includes creating the "next visit" Task; visits wait for S2 | B. S1 without Tasks |

Everything else in section 15 follows from these or from the safest default and does not need the owner.

## 19. Suggested S1 acceptance criteria

1. A new module "Household Services" appears in the module bar, opens at `#/services`, and is reachable by Search and Quick Add `hs`.
2. Creating an arrangement needs only a provider name and a title; both saved, provider visible in Contacts pickers elsewhere; a second arrangement with the same provider name does not create a second Contact.
3. Setting "every other Friday" and a first date creates exactly one linked open Task whose rule names the weekday explicitly, with the Services marker fields; it appears in Tasks and on the Calendar's Tasks layer, not twice on Today.
4. The arrangement page and Overview show provider, cadence in plain words and the next date (from the Task); with the Task deleted they say "no visit scheduled" and list it under Needs attention.
5. **One open Task, always (Revision 2).** After Pause (each of the three task choices), Resume, End and Replace provider, and after calling "Schedule next visit" twice in a row, an arrangement has at most one live open Task; Replace leaves old and new arrangements with different Tasks; each action is all-or-nothing with Undo.
6. **Drift is shown, never silently repaired (Revision 2).** Editing the linked Task's repeat, due date, or deleting it produces the matching notice from 6.7 (`rule-differs`, `off-cadence`, `moved-once`, `no-task`), writes nothing by itself, and each offered fix previews its effect, refuses on stale data, and works. "Change schedule" offers the two previewed options in 6.6.
7. "Replace provider" ends the old arrangement and creates a successor with the same title, linked assets and cadence in one step; the old arrangement still shows its original provider.
8. **Asset linking, one-way (Revision 2).** From the arrangement form the owner can link and unlink an existing asset (name and type shown); the arrangement shows that asset's name and read-only status. Nothing changes on any Home & Assets screen: no card, link, count or text, and no file under `src/modules/assets` is modified. (The reverse view, replacement action and delete-plan text are S4.)
9. Provider page lists active, past and (empty for now) visit sections, shows linked assets and Projects where the contact is a vendor, and edits phone/email through the existing contact functions.
10. **Privacy (Revision 2).** There is **no** account/customer-number field in the model, form, search or tests. Tests prove phone, email, notes and document URLs never appear in Search results, Task titles or notes created by Services, Calendar text or Today. The notes field shows the no-codes/passwords/bank-instructions warning. Provider account identifiers are not stored anywhere.
11. Backup export and restore reproduce the arrangements, links and provider page; two real `SyncEngine` devices converge (cancel versus edit; both Resume offline gives `duplicate-open` with nothing deleted automatically).
12. `npm test`, `npx tsc --noEmit` and `npm run build` pass; no Finance, Projects, Tasks, Contacts, Calendar or Home & Assets source change; no schema change; no new dependency.
13. Browser check with invented data at desktop and 375 px (no sideways scroll, 44 px main targets) and dark mode; honest list of what was not checked.
14. Backlog entry and handoff updated; owner real-device checklist provided; nothing committed without authorization.

## 20. Exact files created or modified in S0

- **Created:** `docs/HOUSEHOLD-SERVICES-S0-PLAN-2026-11-06.md` (this file, now Revision 2).
- **Modified:** `docs/BACKLOG.md` (S0 status, revised in Revision 2; the H5 status heading corrected to committed and deployed `4422999`, run #58); `docs/CHATGPT-HANDOFF.md` (snapshot, H5 delivered status, S0 summary, roadmap, risks, change log, next action).
- **Not touched:** every file under `src/`, `package.json`, lockfile, `src/db.ts`, backup/sync code, `README.md`, `CLAUDE.md`, `.github`.

## 21. Git status and confirmation

- Branch `main`, equal to `origin/main` (`4422999`) at the start. At the end: exactly the three docs files above show as changed (one new, two modified); no `src/` change, no new dependency, no schema change, no migration, no browser work done, nothing staged, nothing committed, nothing pushed, nothing deployed.
- Tests actually run: `npm test` once (read-only baseline): 102 files, 1,629 passed. `tsc` and `build` were **not** run (nothing to check).
- Handoff updated: **yes** (see handoff change log, 2026-11-06 S0 entry).
- S0 is **not** marked final-approved. Architecture is approved in principle and Q1 to Q9 are accepted as planning defaults (per the review); Revision 2 awaits final review. S1 is proposed, not authorized.
- Revision 2 added no code, test run or browser work; the only new factual claims are design statements, and the one code-behaviour caveat (Task editor preserving unknown fields) is flagged as an S1 test.
