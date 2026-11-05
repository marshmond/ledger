# Module hooks for Today, search and quick-add

Added in Phase 3, Part A. These sit next to the due-provider contract (`docs/due-provider.md`) in `ModuleDef.contributes`. Today **nothing
uses them yet**: Part B (Today cards), Part C (search) and Part D (quick-add) will. A module that offers none of them behaves exactly as before.
The types live in `src/core/registry.ts`.

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

## `searchSource`: what global search can find

`search(query, limit)` returns `SearchResult[]` (`id`, `title`, `subtitle?`, `kind` badge text, `score?`, and either `path`, a full
address such as `/tasks`, or `open()` for hits that need more than navigation). Results are grouped by module under `group` (default: the
module name). A linear scan is fine; do not build an index unless a measurement says it is slow. `allSearchSources()` lists them.

## `quickAdd`: what the global add box can create

| Field | Meaning |
|---|---|
| `id`, `label` | Permanent id and the chooser text ("Task"). |
| `prefix` | Typed shortcut: text starting with `<prefix> ` picks this destination (`t`, `e`, `$`). Two modules with the same prefix (any case) or id are rejected at start-up. |
| `parse(text)` | Understands the text after the prefix and returns a `QuickAddPreview` (`summary`, `fields`, opaque `payload`), or `null` if it cannot. The box always shows the preview before saving. |
| `commit(preview)` | Creates the record. Only called after the user has seen the preview and pressed Add. |

The box never guesses a destination: no prefix and no choice means it asks. `allQuickAdds()` lists the destinations.

## The shell around them (also Part A)

- **Search and the Add button belong to the whole app.** `src/shell/GlobalFrame.tsx` owns the search dialog and its shortcuts
  (Ctrl/Cmd+K, or `/` when not typing); `src/core/ModuleBar.tsx` shows the Search and Add buttons and mounts the single quick-add
  (`src/shell/QuickAdd.tsx`). Anything can open search with `openSearch()` (`src/core/globalEvents.ts`) and the transaction form with
  `openAddTransaction()` (the `ledger:add-transaction` event still works). Their menu and hits are still Ledger's until Parts C and D.
- **Bottom-of-phone rule.** `ModuleDef.hasTabBar` says whether a module draws its own bottom tab bar (only Ledger). `GlobalFrame` sets
  `data-tabbar` on the page; the CSS variable `--tab-h` is then the tab bar's height (57 px) or 0. The round "+" button, the toasts and
  the page's bottom padding are all placed relative to `--tab-h`, so they sit at the screen edge in Calendar, Tasks and Today and above
  the tab bar in Ledger. A new module with a bottom bar sets `hasTabBar: true`; one without needs nothing.
- **Landing module.** `src/core/shellSettings.ts` keeps one `settings` row (`shellSettings`, so it is in backups and syncs):
  `landing` is `'today'` (default), `'last'`, or a module id. `resolveLanding` never returns a module that is not registered. Set it in
  Settings > General.
- **A date that follows midnight.** `useToday()` (`src/ui/useToday.ts`) returns today's date and updates it when the day changes
  (checked every 30 s and when the page becomes visible). Use it instead of `todayISO()` in anything that stays on screen.
