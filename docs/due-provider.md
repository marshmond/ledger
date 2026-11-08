# The due-provider contract

How a module puts dated things on the Calendar without copying anything.

**Rule: one owner per item.** A module that already knows about dates (Ledger's scheduled bills, Tasks' due dates) *works them out when asked*. The Calendar never stores a copy, so there is nothing to go stale, nothing to double up when two devices sync, and nothing to retract.

## What a module does

1. Write a `DueProvider` (type in `src/core/dueProvider.ts`):
   - `id` (permanent, e.g. `'ledger'`), `layerName` (e.g. `'Finance'`), `color`.
   - `getDueItems({ from, to, today, overdueDays })` returns `DerivedItem[]`.
2. Register it by adding `contributes: { dueProvider }` to the module's `ModuleDef` (`src/core/registry.ts`). A future feed adapter (a subscribed .ics link) is just another provider, registered with `registerDueProvider`.
3. The Calendar already has a calendar layer for it (Finance and Tasks are built in; the layer's `providerId` matches the provider `id`). Layers can be switched off and recoloured by the user.

## What a provider must do

- **Read-only and pure.** Never write to any table. The same input gives the same answer.
- **Return** items dated inside `from..to` (local dates, `YYYY-MM-DD`), plus *open* items dated in the `overdueDays` days before `today` when `overdueDays > 0` (the Agenda's "Overdue" section), even if they fall before `from`.
- **Be fast** for a month-sized range. It is called once per redraw, and again when the module's data changes. Do the database reads once per call, not once per day.
- **Leave out** anything already handled (posted, skipped, completed). Do not return handled items unless there is a reason to show them (`status: 'handled'`).
- **Never fail the Calendar.** If a provider throws, its layer is empty and the others still show.

## Older items (optional): `olderThan(cutoff, today)`

The Today screen's Overdue card lists open items from the last `overdueDays` days. A provider can also say how many open items are **older** than that
(dated before `cutoff`) and where to see them in its own module: `olderThan` returns `{ count, path }` (or null). Today shows it as "N older items in
<module>" with a link to `path`. Read-only. Tasks links to its Overdue view; Ledger links to Scheduled. It never changes how the module itself ages or counts items.

## The item (`DerivedItem`)

Built on the `DueItem` shape (`src/core/entities.ts`), never stored:

| Field | Meaning |
|---|---|
| `id` | Stable: `module:recordId:date` (`derivedId()`). |
| `sourceModule`, `sourceRecordId` | The owning module and record (text ids such as `scheduled:7`). |
| `title`, `date`, `time?`, `allDay`, `endDate?` | When it is. All-day items are plain dates with no time zone. |
| `priority` | `high` / `medium` / `low` / `reminder`. |
| `status` | `open` or `handled`. |
| `detail?` | One line of explanation. |
| `openSource()` | Opens the item in its own module (navigation only). `sourceLabel` is the button text ("Edit in Ledger"). |
| `actions?` | Optional write-through for modules whose items are normal editable records (Tasks: `complete`, `reopen`, `reschedule`). Leave it out for read-only sources such as Ledger. |
| `icsUid?`, `icsAlarmMinutes?` | For .ics export: the event id to use, and an alarm. Ledger uses its existing `bill-<ruleId>-<date>@ledger.local` ids so phone calendars do not show duplicates. |
| `coveredBy?` | **B3.1, display only.** The id of ANOTHER layer's item that already stands for this same occurrence. A display filter (`calendar/markerCoordination.ts`) may leave this item out, but ONLY while that other item is itself being shown. Nothing is deleted, stored or re-identified. See "B3.1 coordination" below. |

## Linking records (optional)

`contributes.records` (`RecordSource`: `search`, `describe`) lets other modules link to your records through the shared Links table and show them by name. Ids are text because a module can have several kinds (`account:12`, `scheduled:7`, `loan:3`).

`RecordSource.openSource(id)` (optional) opens the record in its own module and says whether it still exists. Ledger's scheduled items open at `/ledger/scheduled?rule=<id>`, which puts that item straight into the edit form.

## Handing a Calendar event to a module (optional): `contributes.createFromEvent`

A module can offer "turn this event into one of mine". It names the event types it handles (`types`, e.g. `['bill']`), a button `label`, an `ownerName`, and a `Form` component the Calendar shows in a dialog. The Calendar passes an `EventSeed` (title, the date to start from, notes, the repeat in plain units, whether single dates were changed) and a `consequence` sentence. The module's form does its own confirming and writing, then calls `onCreated({ recordId, label })`. Only then does the Calendar retire the event (`retireEvent`: soft-deleted, with `retired: { module, recordId, note }` so nothing is lost). `onCancel` leaves the event untouched. Ledger registers this for the `bill` type (`src/modules/ledger/ScheduledFromEvent.tsx`, mapping in `fromEvent.ts`).

## Ledger's provider (`src/modules/ledger/dueProvider.ts`)

Reuses `dueInstances()` for scheduled items and `loadCalendar()` for vests, tax dates, RMDs, pay milestones and the next loan payment, so it matches Home, the sidebar count and the Scheduled page. A scheduled item whose account no longer exists is still listed (so it is not forgotten) with a plain note added to its detail (ST-S1); it cannot be approved, because `postInstance` refuses to post to a missing account. Scheduled items past due drop off after the overdue window (Calendar settings, default 30 days). Not included: budget bill goals (month only), windfalls and goals (year only), donations and HSA withdrawals (records of past actions).

## Tasks' provider (src/modules/tasks/dueProvider.ts)

Open tasks with a due date (or a "do on" date) appear on the Tasks layer. Tasks are stored records, so this provider sets `actions` (complete, reopen, reschedule) and the Calendar writes straight to the task: a normal edit, not a copy. Tasks without a date stay off the Calendar.

## Bills & Subscriptions' provider (src/modules/bills/dueProvider.ts, B2)

A read-only layer "Bills & Subscriptions" (id `9_000_000_000_000_107`, provider id `bills`). Worked out on every draw from the bills, their recorded facts and their reminder Tasks; nothing is stored and no future period record or event is created. Horizon: today through the same day 12 months later (both ends included, clamped), so it moves with the clock by itself. Two kinds of item, never mixed:

- **Expected bills** `bills:due-<bill>-<slot>:<date>`: an open billing period (not paid, skipped or zero) on its timing date, which is the recorded actual due date when there is exactly one and otherwise the schedule's date. The period identity (the slot) never changes when the date moves, and `icsUid` is `bills-<bill>-<slot>@ledger.local`, so a phone calendar does not duplicate when the due date changes. A bill paid by hand, past its date and not confirmed stays inside the overdue window; an automatic payment past its date is not shown as overdue.
- **Contract dates** `bills:<notice|trial|renewal>-<bill>:<date>`: cancel-by and trial end are action deadlines (alarm one day before); a renewal is informational. A passed date is `handled`. A notice and a renewal on the same day are two items.

**Duplicates are decided by purpose and occurrence, not by title.** An open pay Task whose reminder date equals the marker's date for the SAME period stands for the marker (it is left out). A pay Task on a different day does not, because the reminder date and the due date are two facts. The same rule applies to a notice or trial Task and its marker. Cross-layer suppression against Finance scheduled items and Household Services contract dates is NOT done in B2 (those links arrive in later phases). **B3.1 update:** it is now done for a Finance rule the bill explicitly links, as a display decision (see "B3.1 coordination" below). Household Services contract markers are still NOT coordinated: that needs a reliable link between a Bills obligation and a Services arrangement, which arrives with B4's `bills-for` link (documented and deferred, not guessed from names). Titles are `Due: <bill>`, `Cancel by: <bill>` and so on: never an amount, an account number, a note or a link.

**B3 changes to the Bills layer.** A billing period paid by linked Finance payments is no longer an open due marker: `dueProvider.ts` reads the live Finance transactions in one bulk read (through the shared loader) and `periodsOf` gives the period's label from them. A period that is partly paid, or whose linked payment went missing, changed in structure or was reversed, is open again and shows its marker. Marker titles and details are still `Due: <bill>` and the label text, never an amount, and the period identity (`slot`) in the item id and in `icsUid` does not change when payment status does. Nothing is stored; no recurring event is created.

## B3.1 coordination: one expected payment, two layers (Bills and Finance)

The same expected payment can be drawn twice: by a Bills "Due" marker and by the Finance Scheduled marker of a rule the bill links (`scheduledRuleIds`). B3.1 coordinates them as a **display decision only**. It deletes no Calendar event, Task, billing-period fact or Scheduled instruction, changes no status, stores nothing and changes no identity (the Bills item keeps `bills:due-<bill>-<slot>:<date>` and `bills-<bill>-<slot>@ledger.local`; the Finance item keeps `ledger:scheduled-<rule>:<date>` and `bill-<rule>-<date>@ledger.local`).

- **Who decides (`modules/bills/dueProvider.ts`, `coveringId`).** A Bills expected-payment marker gets `coveredBy` = the id Finance's own provider gives that rule's marker only when ALL of these hold: the bill points at the rule (never a guess from title or amount); the rule is a live spending rule; Finance offers the rule on THE SAME DATE as the Bills marker; no posting or skip is logged for it (so its approval marker exists); and nothing unresolved disagrees between the bill and the rule (`scheduleDrift` has no "check" note). The provider reads the linked rules once, in bulk, through the shared read-only loader (`lib/financeRead`), and only when some bill links one.
- **Who hides (`modules/calendar/markerCoordination.ts`, `dropCovered`).** The Calendar applies it AFTER its layer-visibility filter; Today applies it to everything (Today does not read layer visibility). A covered item is left out only while its covering item is in the list it was given, and only an OPEN covering item counts. So switching the Finance layer off puts the Bills marker back (both can never disappear), "Personal only" and "Deselect all" are unaffected, an item that is itself covered never covers another, and **the covering Finance marker, which may be the owner's only route to approving the payment, is never the one hidden**.
- **When both stay.** Different dates (a payment-action date versus a due date), different schedules, an unresolved amount or cadence disagreement, a rule that is switched off, ended, income or a transfer, a missing rule, an ended bill, or a Scheduled item already approved or skipped in Finance (a posting is not proof of payment, so the Bills marker returns). Contract deadline markers (renewal, cancel-by, trial end) and reminder Tasks are never covered. A pay Task on another date keeps its own meaning (the existing same-day rule is unchanged).
- **Calendar file (.ics).** Unchanged: only the Finance layer is exported, with the same ids. The Bills layer is not exported, so no phone-calendar identity changes.

## B4 markers: renewals, cancellation and price changes (Bills)

The Bills layer (`bills`, same colour, same rolling window of today through the same day 12 calendar months later) draws these additional kinds, all worked out when the Calendar draws and never stored, copied or turned into events or Tasks:

- **`bills:renewal-<bill>:<date>`**: the recorded renewal date, then the renewal cadence repeated (weekly, monthly, every 3 months, yearly) inside the window. Titled "Renewal expected: <bill>" and described as expected, not confirmed. A confirmed cancellation stops the series at its effective date. A renewal date that has passed is `handled`; nothing is made when it passes. A recorded renewal the owner must make by hand also gets ONE decision Task for the nearest date; its marker is left out only when that Task is dated the same day.
- **`bills:cancel-<bill>:<date>`**: "Cancellation effective: <bill>" on the CONFIRMED effective date (only when no two confirmations disagree). Informational, low priority.
- **`bills:price-<bill>:<date>`**: "Price change: <bill>" on the day a recorded later price takes effect. Titles and details carry no amount.
- **`bills:notice-<bill>:<date>` and `bills:trial-<bill>:<date>`** (unchanged ids) now come from the dates in force: a recorded trial end or cancel-by date replaces the matching B2 contract date, a disputed one does not (the B2 date stays), only one cancel-by date is kept at a time, and a date after a confirmed cancellation is dropped.

**Household Services coordination (`coveredBy`, B3.1 mechanism).** Only when the owner linked the bill to a Household Services arrangement (`bills-for`), a Bills notice or renewal marker gets `coveredBy` = the id Services gives its own marker of the SAME kind on the SAME day (`services:<renewal|notice>-<arrangement>:<date>`; Bills writes that format itself because it must not import the Services module, and a test compares the two). The Calendar leaves the Bills marker out only while the Services marker is itself shown. A different day, a different kind, a trial, a cancellation date, a price change, a service visit, a Task and a Finance approval are never covered or hidden. Linking is never inferred from names.

Privacy and Hide Amounts: titles are the bill's own title plus a short word; details name no amount, note, reference or account (a test serialises every item and looks for them). Calendar-file (.ics) export is unchanged: only the Finance layer is exported.

## Household finances (B5): no Calendar layer, no marker, no change here

B5's consolidated Overview is a READ-ONLY financial composition, not a Calendar authority. It adds no layer, no due provider, no derived item and no marker, and it changes none of the existing ones: the Finance approval marker, the Bills layer (`..._107`), the Household Services layer (`..._106`) with its rolling 12-month visits, the `coveredBy` coordination and the layer-visibility choice (`calendar-hidden-layers`) are all as B4 left them. Folding a linked bill and arrangement into one commitment on the Overview never hides a Calendar item: every visit, Task, date and Finance approval stays on the Calendar whatever the Overview says. The Overview's page controls (period, 7/30/90 days) are page state only and never touch the Calendar's preference.

## Hide Amounts and the Finance layer (B3.0B)

`ledgerDueItems` honors the app-wide Hide Amounts switch for the SCREEN text of every Finance item. With it on, a scheduled item is titled with its payee only (detail still "Scheduled payment to approve."), and any other amount in a Finance title or detail (a loan payment, an RSU vest, an estimated-tax shortfall) shows as the usual masked figure. Dates, ids, priorities and scheduling do not change, and nothing about the Scheduled payment, balances or posting is touched.

**Calendar-file (.ics) export is a separate, deliberate act and keeps its existing text.** `DerivedItem` has two optional fields, `icsTitle` and `icsDetail`: a provider that shortens `title` or `detail` for the screen puts the full text there, and `buildIcs` writes `icsTitle ?? title` and `icsDetail ?? detail ?? ''`. So hiding amounts on screen never silently changes what an exported file holds. What the file does embed: the Finance layer (only when the owner ticks "Also include the Finance layer") writes each scheduled item as `<payee> <amount>` (the same text Ledger's own "Add to my calendar" file has always used, with the same ids), and the loan, vest and tax entries carry their amounts in title or detail. Own-calendar events, Bills and Household Services items carry no amount. The export dialog now warns when Hide Amounts is on and the Finance layer is ticked. Whether an export should have its own privacy choice (for example "leave amounts out of exported files") is an OPEN OWNER DECISION and was deliberately not made here.

## Calendar layer visibility (B3.0B)

Which layers the Calendar draws is the one device-local preference `calendar-hidden-layers`, interpreted by the pure `calendar/layerVisibility.ts`: either "everything except these" (the old list; `[]` is everything on, a fresh install, and "Select all") or "only these" (`{"only":[ids]}`; "Deselect all" is `only` with no ids, a valid empty Calendar). A layer registered later is on while the choice is "everything on" and off while the owner has chosen a set. Switching on every layer returns to "everything on". It changes only what the screen draws and which of the owner's own calendars the .ics export offers; it never touches an event, Task, record, provider or the Today screen.

## `projectId` on a derived item (added in Projects P3)

`DerivedItem` has an optional `projectId`. A provider whose items come from a project-linked record (the Tasks provider, for a task or milestone with a project; the Projects provider, for a project's start and target dates) sets it, and the Calendar then shows the project's name on the item and links to the project. Providers with nothing to do with projects leave it out. It is display and navigation only.
