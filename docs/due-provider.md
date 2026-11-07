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

## Linking records (optional)

`contributes.records` (`RecordSource`: `search`, `describe`) lets other modules link to your records through the shared Links table and show them by name. Ids are text because a module can have several kinds (`account:12`, `scheduled:7`, `loan:3`).

`RecordSource.openSource(id)` (optional) opens the record in its own module and says whether it still exists. Ledger's scheduled items open at `/ledger/scheduled?rule=<id>`, which puts that item straight into the edit form.

## Handing a Calendar event to a module (optional): `contributes.createFromEvent`

A module can offer "turn this event into one of mine". It names the event types it handles (`types`, e.g. `['bill']`), a button `label`, an `ownerName`, and a `Form` component the Calendar shows in a dialog. The Calendar passes an `EventSeed` (title, the date to start from, notes, the repeat in plain units, whether single dates were changed) and a `consequence` sentence. The module's form does its own confirming and writing, then calls `onCreated({ recordId, label })`. Only then does the Calendar retire the event (`retireEvent`: soft-deleted, with `retired: { module, recordId, note }` so nothing is lost). `onCancel` leaves the event untouched. Ledger registers this for the `bill` type (`src/modules/ledger/ScheduledFromEvent.tsx`, mapping in `fromEvent.ts`).

## Ledger's provider (`src/modules/ledger/dueProvider.ts`)

Reuses `dueInstances()` for scheduled items and `loadCalendar()` for vests, tax dates, RMDs, pay milestones and the next loan payment, so it matches Home, the sidebar count and the Scheduled page. Scheduled items past due drop off after the overdue window (Calendar settings, default 30 days). Not included: budget bill goals (month only), windfalls and goals (year only), donations and HSA withdrawals (records of past actions).

## Tasks' provider (src/modules/tasks/dueProvider.ts)

Open tasks with a due date (or a "do on" date) appear on the Tasks layer. Tasks are stored records, so this provider sets `actions` (complete, reopen, reschedule) and the Calendar writes straight to the task: a normal edit, not a copy. Tasks without a date stay off the Calendar.

## Bills & Subscriptions' provider (src/modules/bills/dueProvider.ts, B2)

A read-only layer "Bills & Subscriptions" (id `9_000_000_000_000_107`, provider id `bills`). Worked out on every draw from the bills, their recorded facts and their reminder Tasks; nothing is stored and no future period record or event is created. Horizon: today through the same day 12 months later (both ends included, clamped), so it moves with the clock by itself. Two kinds of item, never mixed:

- **Expected bills** `bills:due-<bill>-<slot>:<date>`: an open billing period (not paid, skipped or zero) on its timing date, which is the recorded actual due date when there is exactly one and otherwise the schedule's date. The period identity (the slot) never changes when the date moves, and `icsUid` is `bills-<bill>-<slot>@ledger.local`, so a phone calendar does not duplicate when the due date changes. A bill paid by hand, past its date and not confirmed stays inside the overdue window; an automatic payment past its date is not shown as overdue.
- **Contract dates** `bills:<notice|trial|renewal>-<bill>:<date>`: cancel-by and trial end are action deadlines (alarm one day before); a renewal is informational. A passed date is `handled`. A notice and a renewal on the same day are two items.

**Duplicates are decided by purpose and occurrence, not by title.** An open pay Task whose reminder date equals the marker's date for the SAME period stands for the marker (it is left out). A pay Task on a different day does not, because the reminder date and the due date are two facts. The same rule applies to a notice or trial Task and its marker. Cross-layer suppression against Finance scheduled items and Household Services contract dates is NOT done in B2 (those links arrive in later phases). Titles are `Due: <bill>`, `Cancel by: <bill>` and so on: never an amount, an account number, a note or a link.

## `projectId` on a derived item (added in Projects P3)

`DerivedItem` has an optional `projectId`. A provider whose items come from a project-linked record (the Tasks provider, for a task or milestone with a project; the Projects provider, for a project's start and target dates) sets it, and the Calendar then shows the project's name on the item and links to the project. Providers with nothing to do with projects leave it out. It is display and navigation only.
