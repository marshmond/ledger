# Module hooks for Today, search and quick-add

Added in Phase 3. These sit next to the due-provider contract (`docs/due-provider.md`) in `ModuleDef.contributes`. **`todayCards` is in use
since Part B** (the Today module and Ledger each offer cards); `searchSource` is in use since Part C (Ledger, Calendar, Tasks and Today each offer one); `quickAdd` is in use since Part D (Tasks, Calendar and Ledger each offer destinations). A module that
offers none of them behaves exactly as before. The types live in `src/core/registry.ts`.

```ts
contributes: {
  todayCards?: TodayCardDef[];
  searchSource?: SearchSource;
  quickAdd?: QuickAddDef;
}
```

## `todayCards`: a card on the Today screen

| Field | Meaning |
|---|---|
| `id` | Permanent, and must start with the module id (`ledger.alerts`). Saved layouts refer to it. A wrong or repeated id is rejected when the app starts. |
| `title` | Card heading, also used in the edit-layout list. |
| `defaultWidth` | `'half'` or `'full'` on desktop (phones are one column). |
| `priority` | Position in the default layout; lower comes first. |
| `hideWhenEmpty` | Hide the card (rather than show an empty state) when it reports it has nothing. |
| `Component` | Receives `{ today, hideAmounts, reportEmpty }`. `today` changes at midnight. A card that shows money must honour `hideAmounts`. Call `reportEmpty(true)` when there is nothing to show. |

Dated things (events, tasks, bills) should normally come through the due provider, not a card. Use a card for what is not date-based
(alerts, a cash outlook, a count).

`allTodayCards()` returns every card in default order.

### How Today uses them (Part B)

- **Cards in use.** Today module: `today.agenda`, `today.reminders`, `today.overdue`, `today.upcoming` (`src/modules/today/cards.tsx`). Ledger:
  `ledger.attention` and `ledger.cash` (`src/modules/ledger/todayCards.tsx`). Projects: `projects.attention`. Home & Assets (H5): `assets.attention` (`src/modules/assets/todayCards.tsx`), a counts-only card (no asset names, amounts or private details) that never lists the maintenance tasks themselves, because Tasks already put those on Today; it hides itself when nothing needs attention and reads the same `loadOverview` the Overview page uses.
- **One aggregation for dated items.** `TodayDataProvider` (`src/modules/today/TodayData.tsx`) calls the Calendar's data hook once (your events plus
  every due provider, covering the overdue window, today and the look-ahead). The four Today cards read that list through `useTodayData()` and
  only slice it (`src/modules/today/logic.ts`, pure and tested). A new module's tasks or bills show up with no card of its own.
- **Sharing a query between cards.** `useSharedLive(key, loader)` (`src/core/sharedLive.ts`) runs one live database query per key and shares it. The
  cash forecast feeds both Ledger's alerts and the cash outlook, so it is worked out once. The key must name everything the query depends on.
- **Hide amounts.** A card that shows money must honour `hideAmounts`. Text that may contain money (an alert title, a bill name) goes through
  `maskAmounts()` (`logic.ts`).
- **Layout.** `src/modules/today/layout.ts`: per device, saved under `today.layout.v1` (in the backup preference list). Cards come from the registry,
  so a new card appears at the end by itself and a card that disappears is ignored.
- **Failing cards.** Each card is wrapped in an error boundary, so one card breaking never blanks the screen.
- **"N older items".** A due provider can add `olderThan(cutoff, today)` (see `docs/due-provider.md`).

## `searchSource`: what global search can find

`search(query, limit)` returns `SearchResult[]` (`id`, `title`, `subtitle?`, `kind` badge text, `score?`, and either `path`, a full
address such as `/tasks`, or `open()` for hits that need more than navigation). Results are grouped by module under `group` (default: the
module name). A linear scan is fine; do not build an index unless a measurement says it is slow. `allSearchSources()` lists them.

### How search uses them (Part C)

- **Every module answers, the dialog groups.** `src/shell/SearchDialog.tsx` waits 90 ms after typing stops, asks every source in parallel (a source that
  throws is left out), and `groupResults()` (`src/shell/searchGroups.ts`) orders the groups by their best hit. Hits open by `path` (a full address, query
  string allowed) or `open()`.
- **Optional `start()`.** Called when the dialog opens; it returns a function called when it closes. Ledger uses it to keep a live in-memory snapshot of
  its tables (reading 20,000 transactions out of the database cost about 90 ms per keystroke; scanning them costs about 8 ms). Nothing is stored or indexed.
- **Sources in use.** Ledger (`modules/ledger/searchSource.ts`: pages, accounts, investments, holdings, loans, scenarios, scheduled items, transactions), Calendar
  (`modules/calendar/searchSource.ts`: the page and events by title, notes, location), Tasks (`modules/tasks/searchSource.ts`: the page, tasks by title, notes and
  checklist, plus the shared tags and contacts), Today (`modules/today/searchSource.ts`: the page). The matching code in each is pure and tested.
- **Deep links these rely on.** `#/tasks?task=<id>` (opens a task), `#/tasks?v=all&tag=<id>` and `&contact=<id>` (filter), `#/calendar?v=agenda&d=<date>&open=<key>`
  (opens an event), `#/calendar?new=1` (blank event), `#/ledger/scheduled?rule=<id>` (edit a scheduled item).

## `quickAdd`: what the global add box can create

`contributes.quickAdd` is one destination or a list. Each one is a button in the Add box.

| Field | Meaning |
|---|---|
| `id`, `label` | Permanent id and the chooser text ("Task"). |
| `prefix`, `aliases?` | Typed shortcuts: text starting with one of them and a space picks this destination (`t `, `task `, `task: `). Two destinations that share a prefix or alias (any case), or an id, are rejected at start-up. |
| `parse(text, {plain})` | Understands the text after the shortcut and returns a `QuickAddPreview` (`summary`, `fields`, opaque `payload`), or `null`. The box always shows it as "Will add: ..." before saving. `plain` turns the shorthand off (the whole text is the title). |
| `commit(preview)` | Creates the record, only after the user has seen the preview and pressed Add. May return a function that undoes it (shown as Undo in the toast). |
| `start()` | Optional. Called when the box opens, returns a stop function. Lets the synchronous `parse` know existing calendars, lists and tags (so the preview can say "(new)"). |
| `Form` | Optional. For a destination that is a form, not a line of text (Ledger's transaction): the box shows this component instead of a preview. |
| `open({navigate})` | Optional. For a destination that is another screen's own form (Ledger's scheduled payment): the box shows a button that calls this. |

The box never guesses a destination: no shortcut and no choice means it asks. `allQuickAdds()` lists the destinations; the pure routing is `routeQuickAdd()` in `src/core/quickAddRoute.ts`.

### How the Add box uses them (Part D)

- `src/shell/AddBox.tsx` is the one box (the "+" / Add button, `openAddBox({dest, text})` in `core/globalEvents.ts`, and the old `ledger:add-transaction` event all open it). Choices read Task, Event, Transaction, Scheduled payment; destinations from new modules follow.
- **Destinations in use.** Tasks: `task` (`modules/tasks/quickAddDef.ts`, the Tasks bar's own parser). Calendar: `event` (`modules/calendar/quickAddDef.ts`, parser in `quickEvent.ts`). Ledger: `transaction` (the quick transaction form) and `scheduled` (opens Ledger Scheduled) in `modules/ledger/quickAddDef.tsx`.
- **Events from anywhere:** `requestEvent({title, date})` (`core/eventBridge.ts`) opens the box on Event with that text, like `requestTask` for tasks.
- **Event words:** the same date, priority, tag and repeat words as the Tasks bar (it reuses that parser), plus time ranges (`3-4pm`), `@calendar`. No date = today, no time = all-day, one time = one hour.

## The shell around them (also Part A)

- **Search and the Add button belong to the whole app.** `src/shell/GlobalFrame.tsx` owns the search dialog and its shortcuts
  (Ctrl/Cmd+K, or `/` when not typing); `src/core/ModuleBar.tsx` shows the Search and Add buttons and mounts the single quick-add
  (`src/shell/QuickAdd.tsx`). Anything can open search with `openSearch()` (`src/core/globalEvents.ts`) and the transaction form with
  `openAddTransaction()` (the `ledger:add-transaction` event still works)..
- **Bottom-of-phone rule.** `ModuleDef.hasTabBar` says whether a module draws its own bottom tab bar (only Ledger). `GlobalFrame` sets
  `data-tabbar` on the page; the CSS variable `--tab-h` is then the tab bar's height (57 px) or 0. The round "+" button, the toasts and
  the page's bottom padding are all placed relative to `--tab-h`, so they sit at the screen edge in Calendar, Tasks and Today and above
  the tab bar in Ledger. A new module with a bottom bar sets `hasTabBar: true`; one without needs nothing.
- **Landing module.** `src/core/shellSettings.ts` keeps one `settings` row (`shellSettings`, so it is in backups and syncs):
  `landing` is `'today'` (default), `'last'`, or a module id. `resolveLanding` never returns a module that is not registered. Set it in
  Settings > General.
- **A date that follows midnight.** `useToday()` (`src/ui/useToday.ts`) returns today's date and updates it when the day changes
  (checked every 30 s and when the page becomes visible). Use it instead of `todayISO()` in anything that stays on screen.

## Home & Assets record ids (H1)

`modules/assets/records.ts` registers `contributes.records` with text ids `asset:<n>` and `service:<n>` (H2; `warranty:<n>` comes in H4). A Task or Calendar event links to an asset through the shared Links (type `about`) from its own "Link a record" box. Search group "Home & Assets" (serial and plate match by prefix, 4+ characters, and are never shown); Add box destination `asset` (prefix `a`, aliases `asset`, `item`; "Name in Exact Asset Name"). H2 adds service records: search by title and notes (opens `#/assets/<id>?service=<id>`), and the Add box destination `service` (prefix `svc`, aliases `service`, `repair`; "Work on Exact Asset Name $amount date", refuses with a reason when unclear).

`modules/services/records.ts` (Household Services, S1) registers `contributes.records` with text ids `arrangement:<n>`; labels are the title, provider name and status only (never phone, email, notes, links or amounts). A Task is linked to its arrangement through the shared Links (task -> arrangement, type `about`), and an arrangement to an asset through type `serves` (arrangement -> `assets:asset:<n>`, created from Household Services only). The Task carries two markers in its carried-through unknown fields, `servicesArrangement` and `servicesOccurrence` (the cadence date it stands for); the Tasks editor preserves them (tested). Search group "Household Services" (arrangement title and provider name; deep links `#/services/a/<id>` and `#/services/providers/<contact>`); Add box destination `household-service` (prefix `hs`, alias `household`; preview first, Undo removes it). **S2 additions:** a visit record (module `services`, kind `visit`, ids `visit:<n>`, described by title and provider name only) is also returned by the records source and Search (title and provider name only; notes, amounts, links and contact details are never searched or shown). The Task carries a third optional marker, `servicesPurpose: 'book'` (a booking reminder; no marker means a visit Task). A visit links to assets with type `serves` (visit -> `assets:asset:<n>`). Today card `services.attention` (`modules/services/todayCards.tsx`): counts only, `hideWhenEmpty`, read-only, from the same reader as the overview. Add box: `hs visit <what> with <provider> [date] [$amount]` is a one-off visit. No Calendar layer in S1 to S3.

**S4 additions (Household Services, cross-module workflows and contract dates).**
- **Link types** (shared Links, no new table): `serves` (arrangement or visit to `assets:asset:<n>`, unchanged); **`recorded-as`** (`visit:<n>` to `assets:service:<n>`; the handoff identity and duplicate guard, one per visit and asset; written in the same transaction as the Home & Assets service record, `modules/services/handoff.ts`); **`involves`** (`arrangement:<n>` or `visit:<n>` to a Project, whose id is a plain number; information only, `modules/services/projectLinks.ts`). Deleting either end already unlinks cleanly; nothing in S4 reads or writes Project money or Finance.
- **Due provider and Calendar layer:** `contributes.dueProvider` = `servicesDueProvider` (id `services`, layer "Household Services", `modules/services/dueProvider.ts`). The sixth built-in Calendar layer has the fixed id **`9_000_000_000_000_106`** (`SERVICES_ID` in `modules/calendar/model.ts`; ids `..._101` to `..._105` are Personal, Finance, Tasks, Projects, Home & Assets), seeded by `ensureCalendarSeed`. One read-only marker per `renewalDate` and per `noticeByDate` of every arrangement that is not ended (a paused one still shows them): ids `services:<renewal|notice>-<arrangement id>:<date>`, titles "Renewal: <arrangement title>" and "Notice deadline: <arrangement title>", nothing stored, no Task or event, title only. **Expected visits (S4 pre-commit correction):** the same layer also shows every expected occurrence of an ACTIVE arrangement with a fixed schedule over a rolling 12-month horizon (`modules/services/plannedVisits.ts`): ids `services:visit-<arrangement id>:<date>` (cannot collide with the two above), title as the visit Task ("House cleaning: Rosa's Cleaning"), `time` = the arrangement's visit time (else all day), priority low, status always `open`, no actions. Dates come from the arrangement's cadence through the existing `cadenceBetween` (no new recurrence engine). **Contract with the Tasks layer:** the Tasks provider is unchanged and shows only the ONE open visit Task (it does not expand repeats); the Services layer starts strictly AFTER that Task's date and after the date it stands for, after any finished visit, and never before today, so no visit appears twice and a moved visit does not shift later dates. **Horizon:** from the `today` the Calendar passes in through the same day-of-month 12 calendar months later, both ends included, clamped to the month length (moves with the clock, nothing stored). Paused, ended, on-demand, "after each visit" and damaged schedules produce none. A future one-off skip or cancellation is not stored anywhere, so it cannot be removed in advance.
- **Today card `services.attention`** now also gets counts of renewal dates and notice deadlines from today through 30 days ahead (`attentionCounts(snapshot, today)`; the same `contractDeadlines` the Calendar uses): "N agreement notice deadline(s) in the next 30 days" and "N renewal date(s) in the next 30 days". Counts only.
- **Fields:** arrangement `renewalDate`, `noticeByDate` (`YYYY-MM-DD`, stored only when set; carried through by older builds). Undo (`undo.ts`) gained an additive `linkOps` (links added and removed) for Move to replacement and Project links; the sealed-state guard is unchanged.
- **Home & Assets touch points** (small, bounded): the asset page card `AssetServicesCard`, `ServiceForm` handoff mode and `AssetWork` `?fromVisit=<visit id>` (ids only in the address), the source chip on a service entry, the delete preview sentence (`planAssetDeletion` returns `serviceArrangements` and `serviceVisits`), and `insertService` exported from `serviceData.ts`.

**S5 additions (Household Services, Overview, household spending and insights).** No new table, link type, Calendar layer, Today card, search source or dependency. What changed:
- **One shared reader** (`modules/services/servicesOverview.ts`): `loadServicesOverview(period, today)` reads the Services snapshot (with its live links, one `links` read), the Home & Assets service records and the Finance transactions any payment reference points at (one bulk read), then hands them to the pure `buildServicesOverview`. It asks the code that already decides each thing: `buildOverview` (views.ts; the Today counts come from it), `contractDeadlines` (Calendar and Today), `plannedVisitDates` (Calendar), `servicesSpend` / `expectedWindow` (S3), `householdSpend` (below) and `buildInsights`. Nothing is stored or written; a test pins that repeated loads change no row.
- **`householdSpend(input, lookup, period)`** (`modules/services/householdSpend.ts`, pure): the deduplicated union of Household Services and Home & Assets recorded payments. It reuses H3's `spend()`, `resolveRef` and `pieceKey` unchanged and S4's `recorded-as` links (`pairsFromLinks`). Claims end as `included`, `merged`, `covered` or `excluded`; the included claims add up to the total, and `reconciliation` explains the difference from the two module totals claim by claim (overlap counted in both, parts covered by a whole in the other module, typed amounts on linked jobs). It never reads Project money (it only counts, for context, pieces Finance also tags to a Project).
- **`insights.ts`** (pure, deterministic, no model): trend against the comparable prior period, the 12-month estimate (kept apart from recorded money), unusual cost (needs 3 other reliable visits and a stable usual price), long gap, repeated skips or cancellations, dates that keep moving, optional unrecorded maintenance. `providerBreakdown` attributes spending to a provider only when unambiguous. `periods.ts` defines the periods and their prior periods.
- **Today** keeps its own light, count-only card (`attentionCounts` and `attentionLines` are unchanged); the Overview's Needs attention uses the same functions for the categories they share. S5 adds three Overview-only conditions (stale Finance references, duplicate handoffs, typed-amount notes) that are not on Today, because they need a Finance read that Today deliberately avoids.
- **Public-safe words:** Overview text carries titles, dates and counts; money comes only through a money function so Hide Amounts masks it; no phone, email, notes, links or typed amounts.

**Bills & Subscriptions additions (B1: registry, previews and figures; B2: billing-period facts, Tasks, Calendar layer, Today card).** Module `bills` (route `#/bills`; `#/bills/list`, `#/bills/upcoming`, `#/bills/review`, `#/bills/o/<id>`), records in `moduleRecords` (kind `obligation` and, from B2, kind `cycle`). No new table, no new link type (Bills Tasks use the existing `about` link), no migration.
- **Record ids and labels:** `modules/bills/records.ts` registers `contributes.records` with text ids `obligation:<n>`; labels are the title, provider name and status only (never an amount, note, link or contact detail). Search group "Bills & Subscriptions" (`searchSource.ts`): title, provider name and type label only; kind "Bill" or "Subscription"; ended items rank last.
- **Add box:** destination `bills-obligation`, prefix `bs`, aliases `subscription` and `sub` (clash-checked at start-up, tested; Finance keeps `b` and `bill`). Examples: `bs Streamly 15.49 monthly 12th autopay`, `bs Example Power varies monthly 18th`, `bs Home insurance 1200 yearly 15 mar`; `with <provider>` names the provider; an unclear line is shown with a plain problem and refused at Add; twice-a-month schedules need the form. Preview first; Undo removes the bill but never deletes the Contact.
- **Shared date helper:** `src/lib/semimonthly.ts` (moved from `modules/services/semimonthly.ts`, which now only re-exports it; Services behaviour unchanged) plus the additive single-slot functions `slotProblem` and `monthSlotDates`. `modules/bills/schedule.ts` has the pure `expectedDates` reader (previews and figures only; it returns each date with its period slot `m<YYYY-MM>`, `s<YYYY-MM>a|b` or `w<Monday>` and stores nothing).
- **Undo:** a small local guard in `modules/bills/undo.ts` (whole stored rows captured before, fingerprinted after; Undo refuses and writes nothing if anything differs). It does not touch `services/undo.ts`.
- **Backup:** `backupSummary.ts` names the `bills` kinds ("Bills and subscriptions", "Billing-period records"); nothing else changed. B2 needed no backup change: the facts are ordinary module records.
- **B2 `cycle` records (one FACT per record):** `obligationId`, `slot` (the immutable period identity `m<YYYY-MM>`, `s<YYYY-MM>a|b`, `w<Monday>` or `x<id>`; never a date), `fact` (`invoice`, `due-date`, `paid-outside`, `paid-in-full`, `skip`, `credit`), `op` (one id per open form, so a double press saves once) and the repair marks `supersededBy` and `movedFrom` (a `separatedFrom` is kept as an unknown field). `modules/bills/cycleModel.ts` reads them defensively and losslessly: an unknown fact type or a damaged field gives `body: null`, shown as "needs review", counted for nothing and never rewritten; unknown fields ride through every edit. Only `cycleData.ts` (record, edit, remove) and `cycleRepair.ts` (repairs and the period move) write them. Two devices adding facts add separate records, so sync needs no new rule.
- **B2 derivations (all pure, none stored):** `periods.ts` (a period = a bill + a slot, built on demand from the schedule and the facts), `timing.ts` (five mutually exclusive classes), `amounts.ts` (owed, paid, remaining; unknown is never zero), `labels.ts` (one primary label, fixed precedence, no settlement words), `cycleConflicts.ts` (contradictory evidence and look-alikes, never resolved automatically) and `readModel.ts` (the one list behind the Overview, Upcoming, Needs review and the Today card, plus the cash figures).
- **B2 Tasks:** `tasks.ts` is the ONLY file that writes Tasks, through `createTask`, `saveTask`, `completeTask` and `removeTasks`. Markers in the Task's unknown fields: `billsObligation`, `billsCycle` (a slot), `billsPurpose` (`pay`, `notice`, `trial`), `billsDue`, `billsDeadline`, `billsDoOn`; link `task -> obligation:<id>` (`about`). One open pay Task per bill, none unless reminders are on, creation re-reads the live Tasks inside the transaction. Bills finds its Tasks by the markers on the Task row (never by the link); the `about` link is written by `createTask` and is only a pointer for other screens and the delete guard. The only removal is an untouched Bills-made Task of a paused or ended bill that stands for something no longer expected (soft delete, guarded Undo); a Task the owner touched or finished is never changed. The "no Tasks for cancel-by and trial-end" choice is the top-level obligation field `noDeadlineTasks` (an older build keeps unknown top-level fields but rewrites `reminders`).
- **B2 Calendar layer:** id `9_000_000_000_000_107` (`BILLS_ID` in `calendar/model.ts`, seeded in `calendar/data.ts`), due provider `bills` (`dueProvider.ts`). Item ids `bills:due-<bill>-<slot>:<date>` and `bills:<notice|trial|renewal>-<bill>:<date>`.
- **B2 Today card:** `bills.attention` (counts only, hidden when empty, priority 37) from `todayCards.tsx`.
- **B2 Undo:** the same local guard, extended to cover the Tasks a Bills action makes or finishes (ordinary rows in the same table) and the links those new Tasks carry (`Undo.linksAdded`).

## Keeping a new module backup-compatible (G1)

Backup, restore and sync work on the whole database, so a module normally needs **no backup code**:

1. Store records in the shared stores (`moduleRecords`, `links`, `contacts`, `tags`, `attachments`, `dueItems`). They are exported, restored, validated and counted automatically (a module the summary does not know is listed under "Other application data", never dropped). Optionally add its kinds to `MODULE_KINDS` in `src/lib/backupSummary.ts` so they get a friendly label.
2. Only if you add a **new Dexie table**: add it to `exportAll`/`readAll` and `importAll` in `src/lib/backup.ts`, to `OPTIONAL_LISTS` in `src/lib/backupFile.ts`, and make sure sync walks it (it walks every table). `src/lib/backupCoverage.test.ts` and the "coverage guard" tests in `src/lib/backupG1.test.ts` fail until all of these agree. That needs a migration (see `src/db.ts`) and raises `CURRENT_SCHEMA_VERSION`.
3. A new screen preference in `localStorage`: add its key to `PREFERENCE_KEYS` in `src/lib/backupFile.ts`. Never add a token, passphrase or API key.
4. Never put a secret in the `settings` table (it is exported and synced). The one exception, the price key, is filtered out of exports and never synced.
5. Records that carry files: Ledger stores names and web addresses only. Do not imply a backup contains the file.
