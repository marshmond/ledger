# Home & Assets H0: architecture review and phased plan

Date: 2026-11-05. **Design and planning only. Nothing in this document is built, committed, pushed or deployed.** No feature below may be marked
implemented until its phase is built, tested and accepted.

Method: I read `CLAUDE.md`, `docs/BACKLOG.md`, `docs/roadmap.md`, `docs/ledger-inventory.md`, `docs/module-hooks.md`, `docs/due-provider.md`,
`docs/sync.md`, `docs/AUDIT-2026-11-05.md`, the Phase 0 documents and the Projects P1 to P5 reports, then **read the code those documents
describe** (listed per section). I did not run the app in a browser for H0 (nothing to run yet). I ran the test suite once as a baseline:
**1,366 tests pass, 90 files** (matches the P5 report). I did not run the type check or a build.

## Revision 2 (2026-11-05, after architectural review by ChatGPT)

The overall architecture is approved by the reviewer, **subject to the owner's final acceptance of the eight decisions in section 13**. Those
decisions are *recommended defaults only; none is owner-approved yet.* Changes made in this revision:

1. **Permanent deletion now follows the Projects P4B "deletion wins" design** (new section 9.7). This **supersedes** the original advice in 9.5
   not to copy it. Analysis found it can be done as one narrow, additive rule; it is built last in H1 so it can be split off if review objects.
2. **"Done, log it" is specified in full** (new section 5.7): preview before confirm, no invented values, atomic, no duplicates.
3. **Financial integrity is tightened** (new section 6.8): the either/or rule is stated as a validation rule, stale references force re-selection,
   project spending stays separate.
4. **H1 scope is fenced** (section 10, H1) and the detailed build instructions live in `docs/HOME-ASSETS-H1-BRIEF-2026-11-05.md`.
5. **H0.5 is folded into H1** as two identified prerequisite work packages (section 10). The Projects P5 deployment was **verified successful**
   (GitHub Actions run #53 for commit `47100bc`, "completed successfully"; `main` equals `origin/main`).

How to read this: section 0 is the whole idea in plain words. Sections 1 to 14 are the requested deliverables. Section 13 is the one
decision round for the owner; everything else is a recommendation with a default.

---

## 0. The plan in plain words

Home & Assets becomes a fifth module (after Projects). It keeps a **list of the things the household owns that need looking after**:
the house, the furnace, the dishwasher, the car. Each thing is one simple record (name, type, where it sits, make/model, when bought,
warranty end, who services it, notes). Things can sit inside other things (a furnace inside the heating system inside the house), but
nobody has to build a tree: a flat list works from day one.

**Maintenance is not a new system.** "Change the furnace filter every 3 months" is an ordinary repeating Task (the Tasks module already knows
how to repeat, show on the Calendar and appear on Today), linked to the furnace. The asset page just gathers its linked tasks. **What
was done, by whom and at what cost** is a small durable "service record" that Home & Assets owns, so history survives if someone edits or
deletes a task.

**Money is never re-entered and never changed.** A service record can point at a transaction you already have in Finance; the app reads the
amount from there. Nothing here edits a transaction, an account balance or a report. Big jobs stay in Projects; an asset can be linked to
the project that renovated it, and the asset page shows the project's spending as context without adding it to its own total (so nothing is
counted twice).

**People and businesses are the shared Contacts.** No second vendor list.

**Documents are references for now** (a label and an optional web link to a receipt in your own cloud storage). No files are stored.

**Nothing needs a new database table, a new dependency or a server.** Everything fits in the existing shared record table that Tasks,
Calendar and Projects already use, so backup, restore and device sync cover it automatically.

Five phases, each ending with something usable (section 10). Eight decisions are yours (section 13); each has a recommended default.

---

## 1. Executive summary and product vision

**Vision.** One calm place that answers: *What do we own? What does it need? What was done to it? What did it cost? What is due next?*

**Principles applied.** Useful with only a name filled in; optional detail appears when asked for; reuse Tasks, Calendar, Contacts,
Projects and Finance; local-first; history and money are never silently lost.

**Headline recommendations**

| # | Recommendation | Why |
|---|---|---|
| 1 | One generic `asset` record with a `type`, a `parentId` and a few optional fields; type-specific extras go in a free "specs" list | One screen, one search, one set of rules; no per-type tables to keep in step |
| 2 | Store as shared module records (module `assets`; kinds `asset`, later `service`, `warranty`). **No new Dexie table, no schema bump (stays 15)** | Backup and sync already walk `moduleRecords`; the backup-coverage test already guards it |
| 3 | Maintenance plans = Tasks linked to the asset through the shared Links. No new recurrence engine | `completeTask` already creates the next task and copies links (verified) |
| 4 | Durable `service` record for completed work; the asset timeline also shows completed linked tasks as "not yet saved to history" | Task history is editable and deletable, so it is not durable on its own |
| 5 | Finance link is a **reference from a service/purchase record to a transaction**, not a new field on transactions (field on `Txn` is the alternative, section 6.3) | Zero change to Finance; owner can still choose the stronger tag later |
| 6 | Project to asset is many-to-many through shared Links; project spending is shown beside an asset, never added to it | Avoids double counting by construction |
| 7 | Ledger's existing `properties` table (net worth entries for homes/vehicles) stays as it is; an asset may point at one | No change to net worth; no second valuation system |
| 8 | Archive, retire (sold/disposed/replaced) and permanent delete are three different actions; permanent delete is blocked once anything refers to the asset | Same safe pattern as Projects P4B |
| 9 | Registration (records, search, Quick Add) ships in H1, not H5, because H2 needs asset links from Tasks | Dependency found in the code |

---

## 2. Existing Ledger capabilities available for reuse

All verified in code, not only in the reports.

| Capability | Where (verified) | How Home & Assets uses it |
|---|---|---|
| Module registry and hooks (`dueProvider`, `records`, `todayCards`, `searchSource`, `quickAdd`) | `src/core/registry.ts`; modules listed in `src/modules/index.ts` | One `ModuleDef`; start-up checks reject duplicate card ids and Quick Add prefixes |
| Shared record store: small JSON records in `moduleRecords`, soft delete (`deletedAt`), time-based ids, `[module+kind]` index | `src/core/store.ts`, `src/db.ts` (schema 15), `src/lib/sync/track.ts` `newId()` | Home of `asset`, `service`, `warranty` records. Unknown fields are kept on every write (`repo.put` spreads the existing record) |
| Defensive readers that keep unknown fields | `asProject`/`extras()` in `projects/model.ts`; `asTask` in `tasks/model.ts` | Same pattern for `asAsset` etc., with a test per reader |
| Backup and sync cover every table, guarded by a test | `src/lib/backupCoverage.test.ts`, `src/lib/backup.ts` (version 15), `src/lib/sync/merge.ts` | Nothing to add; `moduleRecords` is already in all four lists |
| Repeating tasks, "repeat after completion", next task created on completion, links copied to the next task | `tasks/recur.ts` (`spawnNext` spreads the whole task, so extra fields survive), `tasks/data.ts` `completeTask` | The maintenance engine. Verified: `completeTask` re-adds every outgoing link to the spawned task |
| Tasks already carry `contactIds`, `tagIds`, checklist, notes | `tasks/model.ts` | Contractor on a task needs no change |
| Calendar: derived items from due providers, fixed-id built-in layers | `core/dueProvider.ts`, `calendar/model.ts` (`PERSONAL_ID`..`PROJECTS_ID` = ...101 to ...104) | Maintenance already appears via the Tasks layer. A fifth layer (fixed id ...105) is needed only for warranty-end dates (H4) |
| Today: dated items come through the Calendar data hook; cards for non-dated things | `docs/module-hooks.md`, `modules/projects/todayCards.tsx` | One counts-only card (never repeats a task) |
| Global search with grouped results; Add box with preview/commit/undo | `shell/SearchDialog.tsx`, `shell/AddBox.tsx`, prefixes in use: `t`, `e`, `$`, `b`, `p` | `searchSource` and an `asset` destination (suggested prefix `a`, free today) |
| Linking records across modules: `contributes.records` (`search`, `describe`, `openSource`), the shared `links` table, and the picker `RecordLinks` in `ui/pickers.tsx` | `core/registry.ts`, `ui/pickers.tsx`, `core/store.ts` | Tasks and Events can link to an asset with **no change to Tasks or Calendar** once Assets registers `records`. Tasks and Calendar already register theirs |
| Shared Contacts (name, relationship, phone, email, notes); find-or-create without duplicates | `core/contacts.ts`; used by `projects/Vendors.tsx` | All people/businesses. No Contacts change needed |
| Read-only cross-module reader pattern (`projectId` plus a reader that copes with archived, cancelled and missing) | `core/projectLink.ts` | Same shape for assets: `core/assetLink.ts` (H2/H3) |
| Project costs computed once by Finance from transactions | `lib/txnProject.ts` (definitions in its header), `Txn.project`, `Split.project` in `types.ts` | Read-only source for "project spending beside an asset" |
| Safe permanent deletion with plan/execute, one transaction, and a narrow sync exception | `projects/deletion.ts`, `lib/sync/projectDeletion.ts` | Template for asset deletion; the sync exception is **not** copied by default (section 9.5) |
| Sensitive-value masking switch on Today | `TodayCardProps.hideAmounts`, `maskAmounts()` | Pattern for hiding serial numbers and similar |

**Things found in the code that shape this design**

1. **Ledger already has a `properties` table** (`types.ts` `Property`: name, kind home/vehicle/other, `loanIds`, `excluded`) with dated values
   (`propertyValues`) used by net worth, equity and the stale-value alert (`lib/property.ts`, `NetWorthPage`, `DebtPage`). It uses numeric
   auto ids and is hard-deleted (not soft-deleted). This overlaps in *name* with "Properties" in this plan. See 3.5.
2. **`links` has no referential integrity.** Deleting a target leaves a dangling link, noticed when something tries to show it
   (`RefLabel` in `ui/pickers.tsx` shows "(no longer exists)"). Asset deletion must remove links to the asset, as `deleteProjectPermanently` does.
3. **`useLinkedTasks` only counts open tasks** (`tasks/linked.ts`). A maintenance history needs completed tasks too, so Assets needs its own query.
4. **The shared `attachments` table is description-only** (`storage: 'none'`, fields shaped around files). `dueItems` is dead code (audit item). Neither is used here.
5. **Sync conflict notices label module records by `#id`.** `labelOf()` in `lib/sync/merge.ts` looks for `name`/`title` at the top of a record,
   but module records keep them inside `data`. I did not confirm this in a browser (UNVERIFIED), but by reading it, an "Edits that lost a tie"
   entry for an asset will read "#1234…" rather than the asset's name. Cheap fix; proposed in H1 as a prerequisite (section 10).
6. **Backlog is stale on one point:** it says P5 is "NOT COMMITTED", but `git log` shows P5 committed (`47100bc`) and the tree is clean. I
   could not check whether it was pushed or whether the deployment is green (no GitHub access here). Per `CLAUDE.md`, please check the Actions
   tab before H1 starts.
7. **Two-device sync and offline use have never been tested on real devices** (backlog, Projects P3/P5, audit risk 8). Everything below that
   leans on sync is design-level confidence, not field-tested.

---

## 3. Recommended asset taxonomy and record model

### 3.1 One generic record, not several

**Recommendation: a single `asset` record kind** with a `type` and optional fields.

Why not one record kind per type (property, vehicle, appliance...)?

- A furnace, a roof and a car need the same things: name, parent, make/model/serial, dates, warranty, contacts, notes, maintenance, history, cost.
  Type differences are about 5 fields (an address, a plate). A shared record means one editor, one list, one search, one set of deletion rules.
- Type-specific records multiply the places that must be kept in step (search, Quick Add, deletion guard, tests) by the number of types.
- Moving an item from "appliance" to "system" later (a heat pump you decide to treat as a system) is a one-field change, not a data migration.

### 3.2 Types (first release)

| `type` | Typical examples | Notes |
|---|---|---|
| `property` | House, rental, cottage, lot | Top of a tree. Has `address` (sensitive). May point at a Ledger net-worth entry |
| `area` | Kitchen, garage, roof, yard, basement | A place or part of a building. Optional |
| `system` | HVAC, plumbing, electrical, septic, solar | Groups items; optional |
| `appliance` | Dishwasher, furnace, water heater, tools, equipment | "Appliances and equipment" merged: no practical difference in what we store |
| `vehicle` | Car, boat, trailer | Has `plate` (sensitive); VIN goes in `serialNumber` |
| `other` | Piano, bike, anything meaningful | The catch-all, so a type never blocks entry |

The list is fixed in code (it picks icons and which optional boxes show) and is **extendable by adding a value**; an unknown type read from
another device or a newer version is shown as "Other" and preserved (same defensive reading as `STATUSES.includes(...)` in `projects/model.ts`).
`equipment` is deliberately not a separate type.

### 3.3 Record shape (`module: 'assets'`, `kind: 'asset'`)

| Field | Universal? | Notes |
|---|---|---|
| `name` | all, **required** | The only required field |
| `type` | all | default `appliance` when created inside a property, else `other`; never forced |
| `parentId` | all, optional | id of another live asset; see section 4 |
| `status` | all | `active` (default), `stored`, `sold`, `disposed`, `replaced` |
| `statusDate`, `statusNote` | all | When and why it left service (sold to whom, recycled, etc.) |
| `replacedById` | optional | Set on the OLD asset when status is `replaced` (section 9) |
| `archived` | all | Hide from everyday lists; independent of status (section 9) |
| `notes` | all | Free text |
| `manufacturer`, `model` | most | Plain text. **Not** a contact (3.6) |
| `serialNumber` | most | Sensitive (section 7.5). VIN for vehicles |
| `purchaseDate`, `installDate` | most | `YYYY-MM-DD`; "placed in service" = `installDate` |
| `purchaseCents` | most, optional | Whole cents. Manual value (section 6). Never feeds any calculation except "spent" |
| `warrantyEndDate`, `warrantyNote` | most | One simple warranty in H1. H4 upgrades to several (7.2) |
| `contacts` | all | `[{ contactId, role }]`, role is free text with suggestions (3.6) |
| `specs` | all | Small list `[{ label, value }]` for anything type-specific (filter size, BTU, paint code). Progressive disclosure: collapsed until used |
| `refs` | all | Document references `[{ label, url?, note? }]` (section 7.3) |
| `address` | `property` only | Sensitive |
| `plate` | `vehicle` only | Sensitive |
| `ledgerPropertyId` | `property`, `vehicle`, `other` | Optional pointer to Ledger's net-worth entry (3.5) |
| (unknown fields) | | Carried through untouched on every read and write |

Money is whole cents, dates are `YYYY-MM-DD` with no time zone, ids are the existing time-based numbers. Reference ids used in links and
the Add box are text with a kind prefix (`asset:1234`), exactly like Ledger's `account:12`, so later kinds (`service:`, `warranty:`) never clash.

**Deliberately absent:** current value, depreciation, estimated replacement cost, cost basis. The brief says no unsupported valuation. If the
owner wants a value, it belongs in Ledger's existing net-worth entries (3.5), where it already has history and alerts. Capital-improvement
cost basis for a home sale has tax rules I have not verified: **UNVERIFIED and out of scope**; the records would let a future step total
improvements, but no tax figure is promised.

### 3.4 Minimum viable entry

Creating an asset needs a **name**. Everything else is optional and hidden under "More details", "Contacts", "Specs", "Documents". An asset
with only a name still appears in lists, search, links and the Add box.

### 3.5 Relationship to Ledger's existing `properties`

Options considered:

| Option | Verdict |
|---|---|
| A. Keep Ledger's `properties` exactly as is; an asset may store `ledgerPropertyId` and show the latest value read-only | **Recommended.** Net worth, equity, loan links and the stale-value alert are untouched |
| B. Merge: make Assets the owner and migrate `properties` | Rejected. Touches net worth, a hard-deleted numeric-id table and the sync path for a gain of one fewer "add the house" step |
| C. Assets creates a Ledger property automatically | Rejected. Hidden writes into Finance; surprising when deleted |

Under A: the asset page says "Net worth entry: *Home* (latest value $X, dated D), open in Finance". If the Ledger property is deleted
(hard delete) the pointer reads "(net worth entry removed)" and nothing breaks. The word "property" in the UI of Home & Assets means the
asset type; Ledger's is called "net worth entry" in any sentence where both appear. A one-time "create the matching net worth entry" button is
**not** proposed.

### 3.6 Manufacturer versus Contact

- **Manufacturer = plain text.** Households do not "know" Whirlpool the way they know a plumber, and putting every brand into Contacts
  would swamp the shared Contacts list that the future Household Services and Personal CRM modules will read.
- **A Contact when the household would phone or email them:** installer, contractor, service company, warranty provider, dealer. Roles are
  free text with suggestions (`installer`, `contractor`, `service`, `warranty`, `seller`).
- Reverse lookup ("what do I have through this plumber?") is a scan, the same as `projectsUsingContact` in `projects/data.ts`. No new index.

---

## 4. Parent-child relationship model

- **Child points at parent** (`parentId`). A parent never stores a list of children. This keeps edits on two devices from overwriting each
  other (the audit's "design new modules as many small records" lesson) and means deleting or moving a child touches one record.
- **Depth is a guideline, not a rule.** Suggested shapes: `Property > Item` (most common) or `Property > Area/System > Item`. The editor
  offers the parent as one searchable "Where is it?" box, not a forced chain. The Add box and the quick form default to the property you are
  already in. Items can also have no parent ("the lawn mower").
- **Hard rules (tested):** a parent must be a live asset; an asset cannot be its own ancestor (no loops, checked by walking up, with a depth
  limit of 12 as a safety stop); a vehicle's parent should be a property or nothing (soft hint only).
- **Display:** the list shows a breadcrumb (`Home > Kitchen > Dishwasher`) built at display time from names, so renaming a parent never
  breaks anything ("names are labels, ids are references" rule from `CLAUDE.md`).
- **Many-to-many "relates to" (a sensor to a system) is not modelled.** Parent/child covers the stated cases. Cross-asset relationships such
  as "replaced by" use a dedicated field (section 9).
- **Moving and deleting a parent:** moving a parent moves its subtree automatically (children keep their `parentId`). Archiving or retiring a
  parent never changes its children. Permanent deletion is blocked while children exist (move or delete them first), with a link to each.
- **Rollups** (for example "spent on this property and everything in it") are computed on read by walking the tree, de-duplicating by
  transaction piece (section 6.4). Nothing is stored.

---

## 5. Maintenance and service-history design

### 5.1 Two different things

| Concept | What it is | Where it lives |
|---|---|---|
| **Maintenance plan** ("what must be done, how often, when next") | A Task, usually repeating, linked to the asset | Tasks module. **No new recurrence or reminder engine** |
| **Service history** ("what was done, when, by whom, cost, notes") | A durable `service` record | Home & Assets, kind `service` (H2) |

### 5.2 Plans reuse Tasks (verified contracts)

- A task is linked to an asset with the existing `createTask(data, [ref])` path: a `links` row `tasks:<id>` to `assets:asset:<id>`, type `about`.
  (`createTask` already accepts extra refs; `RecordLinks` in the Task editor works as soon as Assets registers `records`.)
- Repeating uses Tasks' own `repeat` (`mode: 'fixed'` or `'after'`). "Replace filter every 3 months" is **after completion**; "service boiler
  every year" is **fixed**; "renew registration" is a yearly fixed task with `createdFrom` set to the vehicle.
- `completeTask` marks the task done and `spawnNext` creates the next one with `...t` (all fields) and re-adds the outgoing links, so the
  asset link survives every cycle (verified in `tasks/data.ts` lines for `spawnedId`). `reopenTask` removes an untouched freshly spawned next task.
- The asset page's **Maintenance** section = open linked tasks with `repeat` or a due date, "next due" from the task's `dueDate`. Calendar,
  Today and Search already show them; nothing is copied.
- **Setting up plans:** "Add maintenance" creates the Task (title prefixed by the asset name, for example "Furnace: replace filter") with a
  repeat chosen from the normal repeat control. A small built-in list of **suggestions** (replace HVAC filter, test smoke alarms, flush water
  heater, service boiler, inspect roof, renew registration) offers a starting title and interval. The intervals are generic starting points
  taken from common household practice, **UNVERIFIED against any manual or standard**; the form says "typical, check your manual" and the
  owner can change them. This is a convenience, not a database of recommendations (owner decision Q7).
- **No automatic tasks:** creating an asset never creates tasks by itself.

### 5.3 Why a durable `service` record is also needed

What a completed repeating task keeps: a `done` task with `completedAt`, `recurFrom`, notes, `contactIds`. What it does **not** have: cost,
a "what was done" field apart from notes, a type of work (repair vs inspection), a reference to a transaction. Worse, tasks are not durable
history: they can be edited, soft-deleted in bulk (`removeTasks`), and "completed" can be undone (`reopenTask`). One-off repairs often never
had a task at all. Therefore:

- **Service record** (kind `service`, one record per event, never a list inside the asset): `assetId`, `date`, `kind`
  (`maintenance`, `repair`, `inspection`, `improvement`, `replacement`, `other`), `title`, `notes`, `providerContactId` (optional), `costCents`
  (optional, manual), `txnRefs` (H3), `projectId` (optional, one project), `refs` (invoice links), and, when it came from a task,
  `taskId` plus a **snapshot** of the task title (so the origin survives deletion of the task).
- A service record is **owned by Home & Assets and never edited by Tasks**. Deleting or editing the task later changes nothing in it.

### 5.4 How the two meet (no change to Tasks)

1. **Done from the asset page** ("Done, log it"): one database transaction completes the task (`completeTask`) and writes the service record
   (date prefilled from today, optional cost/provider/notes). The next repeat is created by Tasks as usual.
2. **Done anywhere else** (Tasks page, Calendar, Today): the asset timeline shows the completed task as **"Completed task, not yet saved to
   history"** with a one-click "Save to history". It is derived from the linked done task, so it is not durable until saved; the Needs
   attention list counts these ("3 completed tasks not saved to history").
3. **Done outside the app** (the plumber came, no task): "Log service" creates a record directly, with any date.
4. A derived item whose `taskId` already has a service record is not shown twice (de-duplicated by `taskId`).

There is deliberately **no hook** that makes Tasks call Assets when a task is completed. A hook would add a new coupling between modules for a
gain (automatic logging from other screens) that the derived "not yet saved" row already covers; it is listed as an alternative in section 11.

### 5.5 Surviving edits, regeneration and replacement

| Event | What happens |
|---|---|
| Task renamed or rescheduled | Plan follows the task. Saved service records unchanged |
| Repeating task completes | Next task keeps the asset link (verified). Saved records unchanged |
| Task deleted | Link is stale and ignored (Tasks soft-deletes; a restored task re-appears). Saved service records unchanged; a record created from it keeps the title snapshot |
| Asset replaced | Old asset keeps all its history. Its open tasks are not touched until the owner chooses (section 9.3) |
| Asset deleted permanently | Only possible when it has no history (section 9.4) |

### 5.6 "Last done", "next due", "overdue"

- Last done = latest of: the newest `service` record date, and the newest completed linked task date. Shown with its source.
- Next due = the earliest open linked task's due date. Overdue = Tasks' existing rule. Assets adds **no** due logic of its own.

---

### 5.7 "Done, log it": the exact operation (H2; added in Revision 2)

Entry points: the **Maintenance** row of an asset page (open linked task). Nothing else completes-and-logs.

1. **Open a confirmation panel, do not act yet.** It shows the service record that *would* be saved, editable:
   - Prefilled from known facts only: the **date** (today, editable), the **asset** (fixed), the **title** (the task title), **notes** (the task
     notes, if any), the **provider** (only if the task has exactly one contact; otherwise blank), the kind (`maintenance`, editable) and
     `taskId` plus a snapshot of the task title.
   - **Never invented:** cost stays empty, work performed stays whatever the task notes said (empty if none), provider stays empty when unclear.
     Nothing is estimated from a "typical" price or interval.
   - A line says what else happens: "This marks the task done. It repeats, so the next one is due on D" (computed with the same
     `nextDueDate` the Tasks module uses, shown, not stored).
2. **Confirm** runs one database transaction over `moduleRecords` and `links`: (a) re-read the task; refuse if it is already done or gone;
   (b) refuse if a service record with this `taskId` already exists (open it instead); (c) `completeTask` (which creates the next task and re-adds
   its links); (d) write the service record. Any throw rolls back everything: **both succeed or neither does**.
3. **Duplicates:** the unique key is `taskId` (one service record per completed task instance; a recurring series has a new task id each cycle, so
   each cycle can be logged once). "Save to history" on a derived row uses the same check. A manual "Log service" has no `taskId` and may
   legitimately repeat.
4. **Recurrence preserved:** completion goes through `completeTask` unchanged. No Assets code computes dates or creates tasks.
5. **Edits, reopen, delete of the task later:** the record keeps its own copy of date, title and notes at save time. `reopenTask` re-opens the
   task and removes only an *untouched freshly spawned* next task (existing Tasks rule); the service record stays, and the confirmation panel
   would refuse to log that task instance a second time. Deleting the task changes nothing in the record.
6. **Cancel** leaves the task and history exactly as they were.

---

## 6. Financial and Projects integration model

**Hard constraints observed:** no change to balances, transaction calculations, categories, reports or financial history; no second
budgeting or commitment engine.

### 6.1 What exists (verified)

A transaction (or one of its splits) can point at a project: `Txn.project` and `Split.project` (`ProjectRef`: `projectId`, optional
`budgetLineId`, `commitmentId`, `effect`). Finance's `lib/txnProject.ts` works out "paid" from transactions only, never stores an amount, and
never counts transfers. Project summaries come from there, so project figures always add up.

### 6.2 Cost sources inside Home & Assets

| Cost | Where recorded | Rule |
|---|---|---|
| Purchase / acquisition | `asset.purchaseCents` (manual) **or** (H3) a reference to the buying transaction | Either a typed amount **or** a reference, not both; the reference wins and shows the live amount |
| Installation | A `service` record of kind `improvement`/`replacement` with the install cost | Same either/or rule |
| Maintenance, repair, vehicle upkeep | `service` record cost, manual or by transaction reference | Same |
| Large renovation | A **Project**, linked to the asset (6.5) | Never retyped as asset costs |

Typed amounts exist because many costs are cash, paid before Ledger was used, or paid by someone else. A reference exists to avoid
re-typing what Finance already knows.

### 6.3 How an asset attributes a transaction: the options

| Option | What changes | Pros | Cons | Verdict |
|---|---|---|---|---|
| **B. Reference from the record** (`txnRefs: [{ txnId, splitIndex?, snapshot }]` on a `service` record or asset purchase) | Nothing in Finance | No Ledger code, schema or `Txn` change; reversible; cannot affect any total in Finance; works for both whole transactions and one split part | No "Asset" filter in Transactions; the transaction does not show its asset; split index can drift if the transaction's splits are edited | **Recommended for H3** |
| A. `Txn.asset` (and `Split.asset`) like `Txn.project` | `types.ts`, transaction form, bulk bar, `editTxn`, filters, deletion guards, sync enforcement, many tests | Strongest attribution; filter and reports possible; splits robust | Large change in the most sensitive area; adds a second attribution dimension to guard for double counting; every Ledger writer must carry it | Do not start here. Revisit only if B proves insufficient (owner decision Q2) |
| C. Shared `links` row `txn:<id>` to asset | Nothing | Reuses links | Whole-transaction only (no amounts for splits), no integrity, no snapshot | Rejected; B is the same without the weaknesses |

B details:

- **Snapshot** `{ date, payee, amountCents }` stored at link time, used only as the fallback text when the transaction is later deleted or
  merged ("Transaction removed; amount was $X"). The live transaction is the source of truth while it exists. If the live amount differs
  from the snapshot the record shows a quiet "amount changed since linked" note.
- **Splits:** store `splitIndex`. If the splits of that transaction are edited so the index no longer exists, the record shows "split
  changed, please re-pick" instead of guessing. (Under A this would not happen, which is the main argument for A if real use shows drift.)
- **Picker:** reuse the existing Transactions list/search; only unlinked-to-this-asset results; never lets the user change the transaction.
- **Refunds:** a positive (money-back) transaction piece reduces spend, the same sign convention as `txnProject` ("Paid = minus the sum").
- **Transfers** are never offered (same rule as `projectAllocations`).

### 6.4 One rule that prevents double counting

> **Spend on an asset = the sum of distinct transaction pieces, where a piece is `(txnId, splitIndex or whole)`, plus the typed amounts of
> records that have no transaction reference. A piece reached through more than one path counts once.**

- Rollups to a parent (property total) use the same rule over the subtree, de-duplicated by piece key.
- Typed amounts cannot be de-duplicated (no key), so the UI states "amounts you typed are counted as typed".
- The asset page shows **two lines**, never silently merged:
  1. *Spent directly* (rule above).
  2. *Through linked projects (shown for context, not added)*: for each linked project, "Paid $X of project total" read from Finance's
     existing project summary (the same function P5 uses; no second calculation).
- This is what prevents Projects and Assets double counting: a renovation tagged to a project lives in Projects; it appears next to the asset
  and is **not** summed into its direct spend. If the owner also wants a project's spending attributed *to one specific asset*, they save a
  service record of kind `improvement` that references the same transactions; the asset then counts those pieces once in "direct", while the
  Projects page remains unchanged (the two are different pages and there is no grand total across both).
- A project that serves many assets (kitchen renovation: house, dishwasher, flooring) is shown on each asset as "involved", never divided.

### 6.5 Projects: link, don't merge

- **Link:** Project to Asset is many-to-many (a roof asset has projects in 2019 and 2031; one project touches several assets), so it uses the
  shared Links: `projects:<projectId>` to `assets:asset:<id>`, type `involves`. This follows the rule already used in the code: a
  `projectId` field only where a record belongs to **at most one** project (tasks, events, and a service record's `projectId`).
- **Deletion:** `deleteProjectPermanently` already removes every live link that points at the project (`linksTo` checks both ends, any module),
  so deleting a project cleans these links with **no Projects change**. Asset deletion must do the same for its links (9.4).
- **Examples:**
  - *Kitchen renovation improves a property:* link the project to the property and to affected items; the property page lists it under Projects.
  - *Roof replacement updates the roofing system:* when the project is completed, the project page offers **"Record in Home & Assets..."** (H3):
    a prefilled form to (a) add a `service` record of kind `improvement`/`replacement` to the roof asset, with `projectId` set, and
    (b) optionally mark the old roof `replaced` and create the new one. Nothing is saved until the owner confirms. This uses the same
    "module's own form does its own confirming" idea as `createFromEvent`, but needs a small, explicit addition on the Projects side
    (a button opening Assets' form); flagged for review in section 12.
  - *Vehicle repair project:* link the vehicle; the repair itself is usually a plain `service` record, not a Project.
- **Never:** every maintenance task becoming a Project; Assets holding budgets, commitments or contracts; Assets writing to project records.

### 6.6 What Assets never does with money

It does not create, edit, categorize, split or delete a transaction; does not change an account balance; does not add a Finance category;
does not feed net worth. Its only money outputs are totals computed on read.

### 6.7 Explicit proposals for review (nothing is changed yet)

If Finance fields were ever needed they would be `Txn.asset?: { assetId }` and `Split.asset?` (option A above). **Not proposed for H1 to
H5.** H3 requires no change to Finance or `types.ts`.

---

### 6.8 Financial integrity rules (H3; added in Revision 2)

1. **Either/or cost rule (validation, not convention).** A record's cost is *either* a typed amount (`costCents`) *or* a list of transaction
   references (`txnRefs`), never both. The form shows one choice ("Typed amount" / "From Finance"); switching asks before discarding the other;
   the data layer rejects a record with both, and the reader treats a record that arrives with both (older device, hand edit) as
   **references win** and flags it for tidy-up. The same rule applies to the purchase price on an asset (`purchaseCents` or a purchase reference).
2. **No silent double counting.** Spend is the sum of distinct pieces keyed `(txnId, splitIndex | whole)`. Attaching the same piece twice, on the
   same record or on two records of the same asset subtree, is refused at save time ("already counted on *Title*"), and the read-side sum
   de-duplicates anyway as a second defence. A **whole** transaction and one of its **split parts** conflict: choosing both is refused.
3. **Stale references force re-selection, never a guess.** A reference stores `txnId`, optional `splitIndex` and a **fingerprint** of the split
   at link time (`splitCount`, that part's `amountCents`, its `categoryId`). If the transaction is gone, or its splits no longer match the
   fingerprint, the reference is marked **"needs re-selecting"**: it contributes **$0 to totals** (not a wrong amount), the record shows why
   in words, and the owner must re-pick. A transaction whose total amount changed but whose referenced piece did not is still valid.
   A whole-transaction reference follows the live amount (and shows "changed since linked" next to the snapshot).
4. **Project spending stays separate** (6.4): never added to direct spend; a project's figures come from Finance's existing project summary.
5. **Read-only on Finance.** The picker never edits a transaction; deleting a record never touches the transaction.

---

## 7. Contacts, warranty and Documents boundaries

### 7.1 Contacts

- Reuse `core/contacts.ts` (`findOrCreateContact`, `updateContactDetails`) and the shared `contacts` records. No vendor table.
- Where contacts appear: `asset.contacts` (`[{ contactId, role }]`), `service.providerContactId`, `warranty.providerContactId` (H4). A
  contact can serve a project, a task, an event and an asset at once; editing it changes it everywhere.
- Contact deleted or missing: shown "(contact removed)"; the role is kept so the owner can re-pick. Readers never throw.
- **Boundary with Household Services:** Home & Assets answers "who has touched or supports **this thing**". Household Services (future) will
  own **ongoing service relationships** (lawn care every week, cleaner, snow removal): a plan with a contact, a schedule, a rate and perhaps
  a pointer to an asset ("serves: Lawn mower / Yard"). That module would reference assets by id and Contacts by id; it would not copy
  either. Nothing here pre-builds it. A `service` record here is a *single event*, never a recurring contract.
- **Boundary with Personal CRM:** Contacts v2 ideas (birthdays, relationship notes, interaction log) belong there. Assets uses only name,
  phone, email and the existing `relationship` text.

### 7.2 Warranties

- **H1:** `warrantyEndDate` and `warrantyNote` on the asset (one date, one note). Enough for "when does it expire?".
- **H4:** a `warranty` record kind (`assetId`, `title`, `startDate`, `endDate`, `providerContactId`, `coverageNotes`, `claimInfo`, `refs`) so an
  asset can have several (manufacturer, extended, labour on an installation). The H1 fields are read as one implicit warranty when no
  `warranty` records exist, the same "single value reads as one implicit entry" approach the multi-line commitment design used (P4A 3.6). No
  data rewrite; writing an explicit warranty record hides the implicit one.
- **Reminders:** warranty end dates come through a read-only due provider (H4): a Calendar item "Warranty ends: Dishwasher", handled once
  past, never in Overdue (same rule as project target markers). A task is not created automatically.
- **Date arithmetic:** coverage windows are dates the owner types; the app does not infer "1 year from purchase" unless the owner picks
  "start from purchase date + N years/months" in the form, which fills the date once and stores only the date.
- **Warranty claims history** is a service record (kind `repair`, note "under warranty").

### 7.3 Documents

- **Today:** `refs: [{ label, url?, note? }]` on assets, service records and warranties. `url` accepts only `http(s)` links (validated, opened
  with `rel="noopener noreferrer"`), usually a link into the household's own cloud storage. `note` handles "paper receipt, blue folder,
  kitchen drawer". **No file contents, no photos, no upload.**
- **Why not the existing `attachments` table:** it describes files (name, mime, size) with `storage: 'none'`; it has no status flow, and the future
  Documents module has not decided what it will store. Using it now would commit that design early.
- **Path forward:** when Documents exists, it can offer "turn these references into Documents" and replace them with Links of type
  `document`. `refs` stays readable (unknown-field-safe), so no migration is forced. Documents-with-files also needs a rethink of whole-database
  sync (audit risk 1); not started here.
- **Public-repository rule:** no real links, receipts or serial numbers in tests, docs or commit messages. Test data is invented.

### 7.4 Links to other things

`refs` is for outside documents. Links to Ledger/Tasks/Calendar/Projects records use the shared Links table and the `records` hook (not `refs`).

### 7.5 Privacy considerations (specific)

| Data | Why sensitive | Handling proposed |
|---|---|---|
| Serial number, VIN | Used for warranty fraud, theft, vehicle records | Stored (useful for claims). Shown masked until "Show" is pressed (per-device switch, default masked). Never in a list row, Today, search result text, notification text or `.ics` |
| Plate | Identifies the vehicle and owner | Same as above |
| Property address | Identifies the household | Same as above; never in titles that reach Calendar/Today/`.ics` |
| Purchase prices, costs | Financial detail | Honour the Today "Hide amounts" switch on cards; asset pages follow the app's existing hide-amounts behaviour where it exists |
| Contact phone/email | Third-party personal data | Already in the shared Contacts; nothing new stored |
| Alarm codes, door/garage codes, Wi-Fi passwords, account/policy numbers | Credentials and identifiers | **Not stored by design.** The notes field shows a plain-language warning. No special field exists |
| Calendar/ICS exports and search | Leave the device or appear on shared screens | Task titles can name the asset ("Furnace: replace filter") but must not contain serial, address or plate; the app composes them, so this is enforced in code and tested |

Search matches serial/plate text only on an exact or prefix match and **never shows the value in the result line**. Sync and the weekly backup are
encrypted on the device (sync.md; Phase 0). The Phase 0 **plain** backup option is *not* encrypted: assets' sensitive fields will be in it,
which the Backup page should state (a one-line addition, flagged for H1/H5). CSV export of assets is deferred; if added later it excludes
sensitive columns by default.

---

## 8. Calendar, Today, Search and Quick Add

### 8.1 Calendar

- **Maintenance** already appears through the Tasks layer (open tasks with due dates). The Calendar shows the task's title; opening it goes
  to the task. **No Assets layer for tasks** (would duplicate).
- **Derived Assets layer** (H4, fixed layer id `9_000_000_000_000_105`, name "Home & Assets", via a read-only `dueProvider` that never
  writes): warranty end dates only. Nothing is stored or copied, so there is nothing to double up when two devices sync.
- Existing tests that count built-in calendars change from 4 to 5, as P3 changed 3 to 4 (known, expected).
- A Calendar asset filter (like the unbuilt Calendar project filter) is deferred.

### 8.2 Today

- Dated maintenance already flows in from Tasks (Overdue/Upcoming). A card must not repeat it.
- One **counts-only card** `assets.attention` (H5; `hideWhenEmpty: true`; `defaultWidth: 'half'`): warranties ending within a window, assets
  with overdue maintenance (count and the most overdue one's name), and "N completed tasks not saved to history". Honours `hideAmounts`
  (it shows no money in the first version). A "keep an eye on" flag for assets with no plan is deferred.
- Card ids must start with `assets.`; start-up rejects clashes.

### 8.3 Global search (`searchSource`)

- Group "Home & Assets": the page; assets by name, manufacturer, model, notes, specs and type (breadcrumb in the subtitle: `Home > Kitchen`
  and status); service records by title and notes (H2); warranties (H4).
- Serial/plate: exact or prefix match only, value never shown (7.5).
- Archived assets rank last; retired assets show their status. Results open `/assets/asset/<id>` and `/assets/...?service=<id>`.
- Pure, tested matching function over already loaded records, like `searchTasksData`. A linear scan is fine; hundreds of records.

### 8.4 Quick Add

- Destination `asset` (H1): prefix `a`, aliases `asset`, `item`. Understands `Dishwasher in Kitchen` (the part after ` in ` matches an existing
  asset name **exactly**, like `+project`; ambiguous or unknown names are refused with a visible reason, not guessed) and shows "Will add: ..."
  before saving, with Undo.
- Destination `service` (H2): prefix `svc`, alias `service`, `repair`: `repair dishwasher 180 yesterday` creates a service record on the named
  asset (exact-name match rule again). Preview before save.
- A task shorthand word for assets (like `+project`) is **not** proposed: tasks are linked from the asset page or the Task editor's existing
  "Link a record" control.
- `quickAdd` conflicts (prefix/alias/id) are caught at start-up.

### 8.5 Shared record links

`contributes.records` (`search`, `describe`, `openSource`). Ids: `asset:<n>`, `service:<n>`, `warranty:<n>`. `describe` returns the
breadcrumb name, "(retired)" or "(archived)" in the label, and the path, or `null` when the record is gone, in which case the Task/Event
editor already shows "(no longer exists)". No change to Tasks or Calendar.

### 8.6 No duplicate reminders

One owner per item: tasks own maintenance dates; the warranty provider owns warranty dates; service records have no dates in the future. No
reminder is ever copied into another table.

---

## 9. Asset lifecycle, deletion and sync rules

### 9.1 Four different actions

| Action | Meaning | Effect | Reversible |
|---|---|---|---|
| **Archive** | "I don't want to see this day to day" | `archived: true`. Hidden from default lists and the Add box; still searchable (last), still linked, still counted in history/spend. Works for any status | Yes (Restore) |
| **Retire** (status `sold`, `disposed`, `replaced`, also `stored`) | The real-world fate. `statusDate`, `statusNote`, optional `replacedById` | Stays visible in a "Past" list with its full history; its open tasks are handled by an explicit prompt (9.3); children are NOT changed | Yes (set status back to active) |
| **Delete permanently** | "Created by mistake" | Soft delete (tombstone, so it syncs). Allowed only when nothing refers to it (9.4) | Not from the app after the fact; old backups keep it |
| (No cascading delete anywhere) | | | |

### 9.2 Scenario table

| Scenario | What the owner does | What is kept |
|---|---|---|
| Appliance sold | Retire as `sold`, date, note | Everything: purchase, service history, linked projects, spend |
| Appliance replaced | Retire as `replaced`; "Replaced by..." picks or creates the new asset (prefilled type, parent, location) | Old record and history; new asset starts fresh; each shows the other ("Replaces..." / "Replaced by...") |
| Vehicle no longer owned | Retire as `sold` or `disposed` | Same. Registration tasks prompted per 9.3 |
| Property sold | Retire the property as `sold`. **Children are not auto-retired**; the page offers "Retire everything inside (N items)" as a previewed bulk action the owner confirms, all or nothing | History and spend for the whole tree |
| Created by mistake | Delete permanently if clean; otherwise it is blocked and the reason says what to unlink or archive instead | n/a |
| Referenced by transactions or Projects | Cannot be deleted; can be retired or archived | Links and references keep resolving to a readable name |

### 9.3 What happens to open maintenance tasks when an asset is retired

A previewed dialog lists the open linked tasks. For each (or all): **Keep linked (default)**, **Move to the replacement asset** (re-link, history
stays on the old asset), **Stop repeating** (set `repeat: null` through the Tasks save path), or **Delete task**. Nothing happens unless the
owner chooses; "Keep linked" is the do-nothing default, so a skipped dialog loses nothing. All chosen changes apply in one transaction.

### 9.4 Permanent deletion (modelled on `projects/deletion.ts`)

`planAssetDeletion(id)` returns plain-words reasons and counts; `deleteAssetPermanently(id)` re-checks inside one transaction and either
changes nothing (throws) or applies everything.

- **Blocks while any of these exist (live):** child assets; service records (H2); warranties (H4); transaction references (H3); a replaced-by
  or replaces pointer from another asset; a `service.projectId`.
- **Unlinks (does not delete):** shared Links to tasks, events, projects, transactions; tasks stay as ordinary tasks.
- **Deletes:** the asset record itself, as a soft delete. No cascade.
- **Guard coverage test:** a unit test lists every record kind that carries an `assetId`/`parentId`/`replacedById`/link type and asserts the
  plan counts each. Adding a kind in a later phase without extending the guard fails the test. (This is the main defence against the
  incremental-phases risk: H1's guard knows only children; each later phase adds its own reference and test.)

### 9.5 Tombstones, concurrent edits and the P4B lesson

Facts: soft-deleted module records sync like any edit (`deletedAt` + `updatedAt`). The merge is last-writer-wins per record and **not
field-level**; the losing version goes to "Edits that lost a tie" and can be put back (docs/sync.md). Deleted-on-one-device and edited-on-the-other:
deletion stands, edit is saved (`mergeSnapshots`). Tombstones last a year.

P4B showed that for a *project*, a stale edit could resurrect a permanently deleted project, so it added a narrow sync exception
(`projectDeletion.ts`). **SUPERSEDED by Revision 2: see 9.7; the exception IS adopted for assets.** Original reasoning, kept for the record (it recommended not copying the exception initially):

- Permanent deletion is rare and only allowed for clean records, so the "stale edit resurrects it" case produces an asset with no history,
  which is harmless and recoverable.
- The harmful case is different: **a stale device creates a service record or link pointing at an asset that was deleted elsewhere.** The merge
  keeps the record; it points at nothing. Readers cope (shown as "(asset removed)"), and Needs-attention lists "N records point to an asset
  that no longer exists" with **Re-home** (pick another asset) and **Delete** actions. No history is destroyed by sync.
- Reconsider after the first real two-device test (still outstanding); keep the exception as a documented option and a pre-existing test pattern
  (10 sync-engine tests exist for projects).

Other concurrency notes:

- Two devices editing the same asset's different fields: later whole record wins, the other is saved (documented limit). Lists inside an
  asset (`contacts`, `specs`, `refs`) are rarely edited at the same instant; this is acceptable and stated.
- History events are **separate records** (`service`, `warranty`), so two devices logging different services never conflict.
- Retiring/replacing writes the old asset (status) and, if created, the new asset: two records, not atomic across devices. A stale device
  could show the old asset as active while the new exists; the pointer is on the old asset only (single writer), so no loop is possible.

### 9.6 Local-first compatibility checklist (J)

| Topic | Finding |
|---|---|
| Dexie ownership | `moduleRecords` rows, module `assets`; **no new table, no migration, schema stays 15**; no sync-meta change |
| Registration | One `ModuleDef` in `src/modules/index.ts`; module id `assets` is permanent (used in routes `#/assets`, in link rows and as the data namespace) |
| Backup | Covered (`moduleRecords` in `exportAll`, `importAll`, `BackupFile`, `backupFile.ts`); coverage test passes unchanged. Backup version stays 15 |
| Sync format | Unchanged; records need `id` and `updatedAt`, supplied by `repo.put` |
| Unknown fields | Readers keep unknown keys (`extras()` pattern); each reader has a test with an extra field round-tripping |
| Older app versions | Records of module `assets` are ignored by an older build and preserved (it keeps unknown module records in the same table). Backups made before H1 restore with no assets |
| IDs | Time-based numeric ids from `newId()`; reference ids are text `asset:<n>`. **No fixed built-in ids** needed except the Calendar layer (H4) |
| Fixed-id caution | Any built-in record would use a fixed id around 9e15 and be inserted last in a bulk insert (`CLAUDE.md`); none planned in H1 to H3 |
| Check-then-insert | Quick Add/"Add from template" and replace flows run inside one transaction (React dev mode double effects) |
| Cross-device merge | Per record; many small records by design |
| Deletion semantics | Soft delete, no cascade, blocked while referenced (9.4) |
| Size | Hundreds of small records; negligible next to transactions. Whole-database sync growth risk is pre-existing (audit risk 1), not worsened meaningfully |
| New dependency | None |
| Backend | None |

---

### 9.7 Permanent deletion wins across devices (Revision 2; verified against the merge engine)

**Finding: it can be done within H1, as one narrow additive rule, with no change to sync semantics, file format, schema or any migration.**
How the existing engine works (read in `lib/sync/merge.ts`, `projectDeletion.ts`, `track.ts`):

- Shared-store records are soft-deleted (`deletedAt` inside the record), so the merge sees a deletion as just a newer copy. Last writer wins,
  so an edit made later on a stale device would beat the deletion and recreate the asset: exactly what must not happen.
- P4B solved this for projects *after* the ordinary merge, in a pure function `enforceProjectDeletions` (called once from `mergeSnapshots`, one
  restore line in `touchAll`), keyed on a marker inside the project's own `data`. It is hard-wired to module `projects`, kind `project` and
  `budgetLine`, so it cannot simply be reused for assets.

**Recommended rule for assets (new file `src/lib/sync/assetDeletion.ts`, sibling of `projectDeletion.ts`; project code is not refactored):**

1. `deleteAssetPermanently` writes `data.permanentlyDeletedAt` on the asset, then soft-deletes it, in one transaction (as projects do).
2. After the ordinary merge (one extra call in `mergeSnapshots`, next to the project call), a flagged asset **stays deleted whatever any copy says,
   before or after**, and the merged table is updated. Nothing else changes: only module `assets`, kind `asset`.
3. **What keeps it alive (history and structure are never orphaned):** after the merge, any *live* record that points at it:
   a child asset (`parentId`), an asset with `replacedById` pointing at it, or a record of a dependent kind (`service`, `warranty`; the list is a
   single constant `ASSET_DEPENDENT_KINDS` that also feeds the deletion-guard test, so a later phase cannot forget it). Because transaction
   references live *inside* service records, this also protects every financial reference without Assets ever reading `txns`. Then the asset is kept as it
   is on the live side, exactly like "money keeps a project alive". Transactions are never owned or edited by Assets, so no financial record can be lost.
4. **Order independence:** a protected child may itself be flagged. Enforcement therefore **repeats until nothing changes** (bounded by the number of
   flagged assets), so a parent/child/grandchild chain gives the same answer whichever device syncs first. Tested.
5. **An intentional backup restore still wins:** `touchAll` also stamps live assets with `data.revivedAt` (one added condition), identical to projects.
6. **A stale device cannot silently recreate an empty asset.** A flagged deletion beats a later edit. A *new* record created there that points at it
   (service record, child) keeps it alive visibly (rule 3) rather than vanishing; a stray link or task pointing at it is left as a harmless
   "(no longer exists)" reference. No history is destroyed.
7. **Everything else keeps last-writer-wins:** archive/restore/retire, editing, and an ordinary soft removal such as the Add box's Undo of a just-created
   asset are *not* given this protection (no marker).
8. **Known, accepted limits (same as P4B):** every device must run the H1 build before relying on it (older builds carry the marker as an unknown
   field and use plain last-writer-wins); when a protected asset reappears there is no notice (the sync conflict format is not changed); the
   ordinary merge's conflict notice may name the wrong survivor in a deletion-wins case (better readable after H1-P1); a deleted-by-mistake asset
   is recoverable only from a backup, because deletion is meant to hold.

**Blocker assessment:** none found. Risk is limited to the second small addition to `merge.ts` in a short time; mitigated by (a) the new rule being
a pure function with its own tests using the real `SyncEngine`, (b) a mutation check (rule off must fail the key tests), (c) the full
existing sync and Projects suites passing unchanged. **If review or testing finds a problem, H1 ships without permanent delete** (archive and
retire only, Delete hidden); nothing else in H1 depends on it. Work package order in the H1 brief keeps this cleanly separable.

---

## 10. Proposed H1 to H5 implementation sequence

### Sequencing changes from the brief's draft, and why

1. **Registration moves into H1** (`records`, `searchSource`, basic `quickAdd`). H2 needs Tasks to link to assets, and `RecordLinks` only
   lists modules that registered `records`. Doing it in H5 would block H2.
2. **Contacts on assets moves into H1/H2**, not H3. It is cheap (Contacts exist), and a service record in H2 needs `providerContactId`.
3. **H3 becomes "Finance references and Projects links"**; Contacts is no longer in it. It depends on H2 (service records are what money attaches to).
4. **Simple warranty date in H1**; H4 adds multiple warranties **plus** lifecycle (replace/retire flows). Basic status/archive/delete-of-clean-records
   still lands in H1, because "created by mistake" cannot wait.
5. **Deletion guard grows with every phase** (a test enforces it).
6. **H0.5 prerequisites (revised: folded into H1, no separate phase).** (a) P5 deployment: **verified green** (run #53, commit `47100bc`). (b)
   **H1-P1:** `labelOf` in `merge.ts` reads a module record's `data.name`/`data.title` so conflict notices are readable (pure function, test).
   (c) **H1-P2:** one added sentence on the plain-backup card saying it also contains Home & Assets identifiers. Both are small, safe and
   testable; details in the H1 brief section 0. If review dislikes either, it is dropped and recorded as a limitation without blocking H1.
7. **Permanent deletion (9.7) is the last H1 work package** and can be cut from H1 without affecting the rest.

### H1: Properties and asset registry

- **Scope fence (Revision 2):** H1 does **not** include service records, transaction references, multi-warranty workflows, the Today card, a
  Calendar layer or any dashboard. Detailed instructions: `docs/HOME-ASSETS-H1-BRIEF-2026-11-05.md` (work packages P1 to P9, with permanent
  deletion and its sync rule last). Sensitive-value reveal is per page view, not stored.
- **User-visible:** a "Home & Assets" module with an asset list (grouped by property, search/filter by type and status, archived/past views),
  an asset page and a small form (name first; More details, Contacts, Specs, Documents collapsed), parent picker with breadcrumb, retire/archive/
  restore, safe permanent delete of clean records, one warranty date, links from Tasks/Events to assets, global search, Add box `a`.
- **Data:** kind `asset` (3.3). No schema, backup or sync change.
- **Modules and files likely to change:** new `src/modules/assets/` (`index.tsx`, `AssetsModule.tsx`, `model.ts`, `data.ts`, `records.ts`,
  `searchSource.ts`, `quickAddDef.ts`, `deletion.ts`, `AssetsPage.tsx`, `AssetPage.tsx`, `AssetForm.tsx`, `assets.css`, tests); one line in
  `src/modules/index.ts`; README feature list. Optional (H0.5b): `src/lib/sync/merge.ts` `labelOf`.
- **Integration boundaries:** Assets is the only writer of asset records; Tasks/Calendar link by id only; no Finance code touched; Ledger
  `properties` read-only (latest value).
- **Tests and acceptance:**
  - Reader keeps unknown fields; bad types/statuses/dates fall back safely; parent cycles refused; names as labels (rename parent updates breadcrumbs).
  - `repo.put` round trip; backup export/restore keeps assets; backup coverage test unchanged and green; old backup restores without assets.
  - Deletion plan: blocked by children; allowed when clean; links removed; soft-deleted record syncs (merge test with an asset record; deleted-vs-edited).
  - `records.describe` returns null for missing; Task editor can link an asset (browser check).
  - Search: name/manufacturer/model/notes match; serial matches but is not displayed; archived ranks last.
  - Add box: exact-name `in` matching, ambiguity refusal, Undo.
  - Browser (desktop + 375px, dark): add a property and three nested items with only names; add details; retire; restore; sensitive fields masked; no console errors.
  - Full suite stays green; no change to existing test expectations other than the module list (check `modules/search.test.ts`/`records.test.ts`).
- **Backward compatibility:** additive only.
- **Deferred:** maintenance UI, service records, money, projects, multiple warranties, Today card, Calendar layer.

### H2: Maintenance and service history

- **User-visible:** Maintenance section on the asset page (open linked tasks, next due, "Add maintenance" with suggestions, "Done, log it"),
  service history timeline (service records + derived "completed task, not yet saved"), "Log service" form (date, kind, title, notes, provider contact,
  typed cost), Needs-attention count, Add box `svc`, search over service records.
- **Data:** kind `service` (5.3). Typed `costCents` only (no transaction references until H3). No schema change.
- **Files:** `assets/maintenance.ts` (pure: last done/next due/derived timeline), `ServiceForm.tsx`, `ServiceList.tsx`, `core/assetLink.ts`
  (read-only reader for others), deletion guard extended, search source extended, records `service:`.
- **Boundaries:** uses `createTask`, `completeTask`, `loadTasks` and the links table as they are; **no change to Tasks**; no new recurrence or reminder code.
- **Tests and acceptance:** completing the task from the asset page writes the service record and spawns the next task in one transaction (rollback
  test); the next task keeps the asset link; completing from the Tasks page shows the derived row, "Save to history" creates a record once (no
  duplicate by `taskId`); deleting the task leaves the record and its title snapshot; reopen after save does not delete the record; derived
  rows disappear when the record exists; contact removed handled; guard test updated for `service`; browser check of Calendar/Today showing
  the linked task with no duplicate.
- **Compatibility:** additive; H1 data unchanged.
- **Deferred:** transaction references, warranties list, replacement flow, odometer/mileage, photos.

### H3: Finance references and Projects links

- **User-visible:** "Spent" summary on an asset and rollups on parents (direct spend, with the de-duplication rule), pick a Finance
  transaction (or one split part) on a service record or as the purchase; "Linked projects" on the asset with each project's paid-so-far shown beside (not
  added); link a project from either side; "Record in Home & Assets..." on a completed project (prefilled, confirm to save).
- **Data:** optional `txnRefs` on `service` and a purchase reference on `asset`; Link type `involves`. **No `Txn` change.** No schema change.
- **Files:** `assets/spend.ts` (pure, tested), `TxnPicker.tsx`, `ProjectLinks.tsx`, Assets side of the handoff form; **small Projects UI addition:** a
  "Related assets" list and the "Record in Home & Assets..." button (read through `core/assetLink.ts`, the same pattern Tasks/Calendar use for
  projects; Projects code is otherwise untouched). Flagged for review because Projects is accepted and stable.
- **Boundaries:** read-only on Finance and Projects; no write to transactions; project figures come from Finance's existing project summary.
- **Tests and acceptance:** the dedupe rule (same piece via two paths counts once; a refund subtracts; a split part counts only its part; a
  transfer is refused; a deleted transaction falls back to the snapshot; a changed split shows "re-pick"); a rollup equals the sum of
  children's distinct pieces; project paid is displayed separately and never added; snapshot of every Finance and Projects test suite
  unchanged (1,366 tests still pass); project deletion removes `involves` links (existing code path, new test); Finance balances/reports are
  byte-identical before and after linking (assert via a before/after snapshot test).
- **Compatibility:** additive.
- **Deferred:** `Txn.asset` tag (Q2 option A), Reports/Transactions asset filter, vehicle cost-per-mile, cost basis/tax.

### H4: Warranties and lifecycle management

- **User-visible:** several warranties per asset (start, end, provider contact, coverage notes, document references); a warranty-end layer on
  the Calendar; full retire/replace flows (replaced-by, "Retire everything inside", open-task prompt 9.3); Past list; restore; the
  "Needs-attention" list with orphan repair (re-home / delete).
- **Data:** kind `warranty`; `replacedById` use; implicit warranty from H1 fields.
- **Files:** `warranties.ts`, `WarrantyForm.tsx`, `lifecycle.ts`, `dueProvider.ts` (read-only), Calendar `ASSETS_ID` constant and seeding in
  `calendar/model.ts`/`data.ts`, test expectation 4 to 5 built-in layers.
- **Boundaries:** Calendar gets one new built-in derived layer through the existing provider contract; no events stored.
- **Tests and acceptance:** implicit warranty shown once and hidden by an explicit one; provider is pure and fast; handled-after-end-date not
  overdue; replace flow moves chosen tasks atomically and leaves history on the old asset; bulk retire previews and is all-or-nothing; orphan
  repair; two-device-style merge tests for stale service records pointing at deleted assets.
- **Compatibility:** additive; new Calendar layer id fixed (`...105`) so two devices create one.
- **Deferred:** recall lookups, claim tracking beyond a service record, automatic warranty-start inference.

### H5: Dashboard, Today and final acceptance

- **User-visible:** a Home & Assets overview (needs attention, next maintenance, expiring warranties, recent service, spend this year by property),
  Today card `assets.attention`, mobile polish, a printable asset sheet (no sensitive fields by default) for the "If something happens" guide
  idea (optional), README and backlog closure.
- **Data:** none.
- **Files:** `Overview.tsx`, `todayCards.tsx`, README, `docs/BACKLOG.md`, acceptance checklist document.
- **Tests and acceptance:** card never repeats a task already shown by Today; hides when empty; honours hide-amounts; the owner's real-device
  checklist (deployed desktop and phone, backup/restore, offline reload, two devices including a deletion conflict), as for Projects P5.
- **Deferred:** everything in section 14.

---

## 11. Alternatives considered and rejected

| Alternative | Why rejected |
|---|---|
| One record type per asset type | More code paths and tests per type; moving between types needs migration (3.1) |
| New Dexie tables (`assets`, `serviceLog`), schema 16 | Needs a migration, backup/restore and sync tracking work and `exportAll`/`importAll`/`BackupFile` edits for no query benefit; `[module+kind]` index handles hundreds of rows. The backup-coverage test would catch omissions but the work is avoidable |
| Extend Ledger `properties` into the asset registry | Ledger table is hard-deleted, numeric auto-id, tied to net worth and loans; high blast radius (3.5) |
| Maintenance plan as its own record with its own interval and next-due | A second recurrence engine competing with Tasks and Calendar; duplicate reminders |
| History only as completed Tasks | Not durable, no cost or kind, tasks can be reopened or deleted (5.3) |
| Silent auto-creation of a service record whenever a linked task is completed (via a hook) | Couples Tasks to Assets; writes records the owner did not review; the derived "not yet saved" row gives most of the benefit |
| A `assetId` field on tasks (like `projectId`) instead of links | Would need Tasks model, editor, filter, search and deletion changes. Links need none today. If Tasks later needs an asset filter, adding the field is a compatible follow-up |
| Parent stores `childIds` | Two-device edits overwrite each other; every move touches two records |
| `Txn.asset` tag in H3 | Large change in the most sensitive code path (6.3); defer until the lighter reference proves insufficient |
| Share links `txn:<id>` to asset | Whole-transaction only, no snapshot (6.3) |
| Add project spending into the asset total | Double counting; a shared project cannot be divided truthfully (6.4) |
| Manufacturer as a Contact | Floods shared Contacts (3.6) |
| Use the `attachments` table or store files for documents | No file store exists; Documents module will decide; sync cannot carry files (7.3) |
| Depreciation, "current value", replacement cost | Not supported by data we hold; unverified methods; net worth values already exist in Finance |
| Odometer, fuel and mileage tracking in vehicle type | A feature of its own; deferred |
| ~~Do not copy the P4B permanent-deletion sync exception~~ | **Reversed in Revision 2.** A stale edit must not silently recreate an empty asset; adopted as a narrow sibling rule (9.7) |
| Home & Assets as a Ledger sub-page | Not Finance data; the shell already supports modules with their own bar/search/Add |
| Per-asset reminders table | Violates "one owner per item" |

---

## 12. Security, data-integrity and compatibility risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| 1 | **Double counting** spend across paths or between Projects and Assets | Medium / high (trust) | One de-duplication rule by transaction piece (6.4); project spend shown separately; tested |
| 2 | **Deletion guard drifts** as phases add references | Medium / high | Guard-coverage test enumerating every referencing kind (9.4) |
| 3 | **Dangling references** (deleted asset, contact, task, transaction, Ledger property) | High / low-medium | Every reader copes ("(removed)"), snapshots where it matters, orphan repair list |
| 4 | **Maintenance history silently lost** if it only lived in Tasks | Medium / high | Durable `service` records; derived rows flagged "not yet saved"; atomic "Done, log it" |
| 5 | **Two-device behaviour is untested on real devices** | Known / medium | Many small records; merge tests; real-device checklist in H5; no new sync rules assumed |
| 6 | **Stale device edits or creates records for a deleted asset** | Low-medium / medium | Deletion-wins rule (9.7) keeps it deleted unless history/children point at it; orphan repair for stray links; no history destroyed |
| 7 | **Conflict notices show `#id`** for module records (reading of `labelOf`; UNVERIFIED in browser) | Medium / low | H0.5b fix, with test |
| 8 | **Sensitive data exposure** (serial, VIN, plate, address) via plain backup, calendar exports, screenshots | Medium / medium | Masking, no sensitive text in titles/search lines/ICS, plain-backup note, never store codes/passwords |
| 9 | **Changing Projects** (accepted, stable) in H3 for "Related assets" and the handoff button | Low / medium | Read-only reader in `core/`, one small component, full Projects test suite must pass unchanged; explicit owner approval (Q8) |
| 10 | **Calendar layer count tests** (4 to 5) and layer seeding | Low / low | Expected change; fixed id; covered in H4 |
| 11 | **Split index drift** when a referenced transaction's splits are edited | Low / medium | "re-pick" state; Q2 option A is the structural fix if it happens |
| 12 | **Name collision** "property" (asset type) vs Ledger `properties` (net worth) | Medium / low (confusion) | UI wording (3.5); the link is optional; no shared ids |
| 13 | **Typical-interval suggestions mistaken for advice** | Medium / low-medium | Labelled "typical, check your manual", editable, **UNVERIFIED** against manuals; the owner can decline the feature (Q7) |
| 14 | **Whole-database sync growth** | Pre-existing | Assets add very little; unchanged audit item |
| 15 | **Tombstone expiry (1 year)** and a long-offline device resurrecting a deleted asset | Low / low | Documented limit; deleting is only for clean records |
| 16 | **Timezone date bugs** (audit lists UTC-based date helpers at 8 sites) | Low / low | Use the local-date helpers and plain `YYYY-MM-DD`; no time-of-day for assets |
| 17 | **UI size/complexity** (a form with 20 fields becomes the thing nobody uses) | Medium / medium | Name-only creation; progressive disclosure; Add box one-liner |
| 18 | **Credentials in plain localStorage** (audit risk 5) | Pre-existing | Out of scope, but asset sensitive data raises its importance |

---

## 13. Decisions requiring the owner (one round, recommended defaults first)

1. **Where does money attach?** (6.3)
   (a) **A service or purchase record can point at a Finance transaction (or one split part); no change to Finance (recommended).**
   (b) Add an "Asset" tag directly on transactions, like the Project tag (bigger Finance change, stronger filtering).
   (c) Typed amounts only; no link to Finance.
2. **How should completed maintenance become permanent history?** (5.4)
   (a) **Completing from the asset page logs it automatically; completing elsewhere shows "not yet saved" with one-click Save (recommended).**
   (b) Always log automatically from anywhere (needs a hook between Tasks and Assets).
   (c) Manual only.
3. **Permanent deletion** (9)
   (a) **Archive/retire for anything with history; permanent delete only for records nothing refers to (recommended).**
   (b) Archive and retire only; never delete.
   (c) Delete with everything attached, after a warning.
4. **Existing net-worth "properties" in Finance** (3.5)
   (a) **Leave as is; an asset may point at one (recommended).**
   (b) Merge them into Home & Assets later as a separate approved step.
5. **Sensitive details** (7.5)
   (a) **Store serial/VIN/plate/address, masked until shown, never in lists, search lines, calendar or notifications; never store codes or passwords (recommended).**
   (b) Do not store serial/VIN/plate/address at all.
6. **Projects touch** (6.5, H3)
   (a) **Allow a small "Related assets" list and a "Record in Home & Assets..." button on the project page (recommended).**
   (b) Link only from the asset side; do not touch the Projects page.
7. **Maintenance suggestions** (5.2)
   (a) **Include a short built-in list of typical tasks and intervals (labelled "typical, check your manual", editable) (recommended).**
   (b) Leave them out; owner types every plan.
8. **Naming and place:** module name **"Home & Assets"**, address `#/assets` (permanent id `assets`), icon house/box, after Projects in the
   top bar. (a) Yes (recommended). (b) A different name.

Defaults used if you say "go" with no answers: 1a, 2a, 3a, 4a, 5a, 6a, 7a, 8a.

**Status (2026-11-05): the owner CONFIRMED Q1 to Q8, all "A" (the recommended defaults).** H1 build still waits for an explicit go-ahead. Q3(a) is refined: permanent delete is allowed for clean records, and the deletion is protected
across devices by the rule in 9.7.

Questions I am **not** asking because the code decides them: no new table, no dependency, module id, record ids, soft delete.

---

## 14. Backlog additions and deferred features

**Proposed backlog (not built, not approved):** H0.5 prerequisites; H1 to H5 as in section 10; decision round Q1 to Q8.

**Deferred, with reasons**

- Valuation, depreciation, replacement-cost estimates, cost basis and any tax figure (unsupported / UNVERIFIED).
- `Txn.asset` tag, Transactions and Reports asset filter (revisit after H3 use).
- Odometer, fuel, mileage and per-mile cost for vehicles.
- Insurance policies and claims; recalls and manual lookups (external data); energy usage.
- File storage, photos, scanned receipts (Documents module; sync rethink).
- Household Services (recurring service plans), Personal CRM, Bills, Subscriptions, Family Management, AI assistant.
- Push or email reminders (backlog decision stands: calendar alerts first).
- Calendar asset filter; asset CSV export (sensitive columns off by default if built).
- Floor plans, room maps, QR labels, barcode scanning; "contents inventory" of valuables for insurance.
- Per-field merge and special permanent-deletion sync rule (revisit after a real two-device test).
- Multi-user permissions, sharing, any hosted service (explicitly out of scope).
- A task shorthand word for assets (`+asset`); a "keep an eye on" watch flag for the Today card.

**Not verified in H0:** nothing was run in a browser (no behaviour exists yet). The `labelOf` conflict-label behaviour, the P5 deployment
status and every two-device behaviour are unconfirmed (marked above). Maintenance interval suggestions and any home-sale tax treatment are
UNVERIFIED and not part of the build unless the owner opts in.
