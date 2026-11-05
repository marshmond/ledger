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
  `ledger.attention` and `ledger.cash` (`src/modules/ledger/todayCards.tsx`).
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
