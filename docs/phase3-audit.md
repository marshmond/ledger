# Phase 3 audit (read-only): what exists before building "Today"

Written 2026-11-04 at commit `3459e3a` (Phase 2 pushed). No code was changed to produce this. It holds shapes and structure only, no personal data.
Evidence is marked: **read** = I read the code, **ran** = I ran it (tests, or the dev server with invented data), **not verified** = I did not check.
This is the second pass, written against the complete request (sections 1 to 7). The first pass only had sections 1 to 5 up to a cut-off sentence; sections 5 (rest), 6 and 7 are new, and a few earlier statements were tightened.

Baseline: 944 tests in 66 files pass, type check and production build clean (ran). I have not confirmed the GitHub Actions run for the last push.

---

## 1. What Phase 2 built (vs. what was asked)

### What exists and where
| Piece | Where | What other code calls |
|---|---|---|
| Due-provider contract | `src/core/dueProvider.ts`, doc `docs/due-provider.md` | `registerDueProvider`, `queryProviders({from,to,today,overdueDays})`, `derivedId`, `goTo`. Items are `DerivedItem` (stable id `module:recordId:date`, `status`, `openSource()`, optional `actions {complete, reopen, reschedule}`, `icsUid`). Failures in one provider are isolated. |
| Module registry | `src/core/registry.ts` | `registerModule`, `allModules`, `getModule`, `recordSource`, `handoffFor`, `lastModuleId`. `ModuleDef.contributes` = `dueProvider`, `records` (`search`, `describe`, optional `openSource`), `createFromEvent`. |
| Shared store | `src/core/store.ts` | `store.shared.{contacts,tags,attachments,links}`, `moduleStore`, soft delete (`isLive`). Calendar and Tasks records live in the existing `moduleRecords` table (kinds `event`, `calendar`, `task`, `list`). |
| Calendar module | `src/modules/calendar/` | Month/Week/Work week/Agenda, events with repeats (this / following / all), reminders, priority, tags, people, linked records, layers, .ics export, Settings > Calendar. Data helpers in `data.ts` (`loadEvents`, `createEvent`, `retireEvent`...), `useCalendarData` (what the Calendar draws), `occurrencesOf`/`statusOf` (expansion, "soon", "overdue"). |
| Tasks module | `src/modules/tasks/` | Stored tasks and lists, views (Today, Upcoming, Overdue...), quick-add parser `quickAdd.ts`, repeats, checklist, bulk actions. `data.ts` (`loadTasks`, `completeTask`, `reopenTask`...), `views.ts` (`buildView`, `counts`, `isOverdue`), `dueProvider.ts`. |
| Cross-module helpers | `src/core/taskBridge.ts` | `createTaskFrom(module, record)` / `requestTask` open a prefilled new-task form (mounted once in `App.tsx` as `TaskCreator`). `TaskActions` shows "Add task" + open-task count on Ledger records. |
| Ledger provider | `src/modules/ledger/dueProvider.ts` | `ledgerDueItems`: scheduled items from `dueInstances()`, everything else from `loadCalendar()`. All-day only. Priorities by class from Calendar settings. |
| Settings | `src/core/calendarSettings.ts` | One `settings` row (`calendarSettings`): week start, open-with view, default calendar, `overdueDays` (30), per-class Finance priorities. |

### Where I deviated, interpreted, or you changed the plan
- **Ledger provider (C1) was built in Part A**, not Part C, because Part A's Finance layer needed it. Part C only added click-through polish.
- **Calendar and Tasks data in `moduleRecords`**, no database version bump (backup and sync already walk it).
- **Skipped or simplified:** drag to move/resize events (edit instead); reminders are in-app only (a "Due soon" flag; no push, text or email; a push-notification decision is logged in the backlog); layer on/off switches are per device; repeating timed events keep the same clock time on this device; "Add task" only on Ledger accounts, scheduled items and transactions (not loans, budgets...); no detailed "new task" form (quick-add plus the editor); no screen for retired events; no Undo for a Bill-to-Ledger conversion.
- **Your decisions that changed things:** completed tasks stay hidden on the Calendar; "Add task" for an account lives on the account page, not the Accounts list; a linked task can be marked done in place from the record; only the Bill type offers the Ledger handoff; Finance and Birthday types stay Calendar events; push notifications deferred; the other ~38 native `confirm()` pop-ups are yours to handle later.
- **Fixed after your review:** quick-add number words ("every two weeks"); Upcoming and Completed obey Sort; Scheduled Delete (browser pop-up replaced by an in-app dialog); "Start from" menu text; People and Tag pickers (browser suggestion pop-up replaced by a menu).
- **Reported but never reproduced:** Calendar showing a just-completed task until you switch tabs (clears in ~200 ms in my runs); a repeating task with no due date producing a next task dated today (I always got one interval later). Both are in the backlog.
- **Known leftovers:** the Tasks form's "List" box still uses the browser suggestion pop-up (may open off to one side like the People box did); 38 native `confirm()` calls elsewhere.
- I am working from the backlog and my notes for the exact wording of the Phase 2 prompt, not the original text.

### The old `dueItems` table (read)
Still in the database (`src/db.ts`), in backup and restore (`src/lib/backup.ts`, optional field), and covered by sync (sync walks every table). `src/core/dueItems.ts` (`publishDueItem`, `retractDueItem`, `syncDueItems`, `listDueItems`) is imported only by `core.test.ts`. **No screen or module reads or writes it.** Not needed for Phase 3 either: the provider contract replaced it. Options: leave it (harmless, small cost in backup), or remove it with a database version bump plus a backup-format tweak. I have not removed anything.

### Ledger's original calendar vs. the new Calendar (read; overlaps you will see)
- Home still has **"Coming up"** (`ComingUp.tsx`, via `loadCalendar`) and the **"Add to my calendar" .ics** download. Both untouched. The Calendar's Finance layer reads the same sources, so dates agree, but:
  - Window: Home's list takes scheduled items only ~60 days ahead; the Calendar goes further (up to ~800 days). Same for what the two .ics exports contain.
  - Overdue: see the table below. The Calendar stops at 30 days; Ledger's own counts do not.
  - Whether Home's "Coming up" lists already-overdue unhandled bills: **not verified**.
- Two places create "dates that matter": Ledger Scheduled (bills) and Calendar events of type Bill; the Bill handoff exists to avoid doubles, but a hand-made Bill event is a separate copy until converted.

---

## 2. What a dashboard can read today

### Registry: what a module can declare
`ModuleDef`: `id`, `name`, `icon`, `Component`, `routePaths`, `nav`, and `contributes.{dueProvider, records, createFromEvent}`.
**Missing for a dashboard card:** any hook for a card or summary (title, size, a component or a small data contract, "hide when empty", priority). Date-based items are already covered by the due provider; **non-date items have no contract** (backup is stale, over budget, low cash, unapproved import). Those live only in Ledger's `computeAlerts` and are computed inside `HomePage`.

### Per-module data for a "today" view
- **Events today:** `loadEvents()` + `occurrencesOf(event, from, to)`; flags from `statusOf` ("soon" = a reminder time has passed, "overdue" = only for events marked "keep until done"). Everything is expanded client-side.
- **Tasks:** `buildView('today', ...)` already returns Overdue, Due today and "Scheduled for today"; `counts()` gives per-view counts. The Tasks provider also feeds the Calendar.
- **Bills due soon:** `ledgerDueItems` through `queryProviders` (Finance layer), or `dueInstances(db, today, N)` directly (what the sidebar badge and the Home alert use).
- **Cash flow:** `loadForecast(db, today)` (day-by-day forecast; `firstBelow` is the first date below your warning level) feeds the Home alert "Cash may drop to ... on ...". `computeAlerts` has about fifteen alert kinds, all computed in `HomePage` from ~25 table reads.
- **The false-positive "cash may drop" alert on empty accounts (read, partly ran):** the *no cash account* case is guarded (`HomePage.tsx` only passes `forecastLow` when an open checking/savings account exists). The *account exists but is at $0 or under the warning level with no history* case is **not** guarded: `forecast.ts` sets `firstBelow` to today when the starting balance is under the threshold, so the alert would read "Cash may drop to $0.00 today". I did not reproduce it: the dev data has no alert of that kind (ran), so this is from reading the code only.

### Cost on load
Measured: almost nothing. On the tiny invented dev data Home loads in ~290 ms on a desktop (ran). **Nothing was measured on a phone or on realistic volumes.** From reading:
- `HomePage` makes 25 `useLiveQuery` calls, most of them full-table `toArray()` (all transactions, lots, vests...), plus `loadForecast` (17 table reads and a forecast run), `loadCalendar` (13 table reads, income model run for two years), `useTaxPlanData`, `useCheckin`. The Ledger `Shell` adds `dueInstances` and `loadNetWorth`.
- Calendar and Tasks each load their whole kind (`loadEvents`, `loadTasks`) and filter in JavaScript; every provider re-runs whenever any table it read changes. No shared cache between modules; each module recomputes for itself.
- A Today screen that merges all of this on top would run all of it at once. The likely phone risk is the Ledger side (forecast and income model), not Calendar or Tasks. **Not verified.**
- **Midnight rollover (read, not verified):** `todayISO()` is read at render time. A Today screen left open overnight keeps yesterday's date until something re-renders it. The Calendar re-renders every 30 s (`useNow`); Home does not tick.

### Overdue handling: where the rules disagree (read)
| Place | What counts as overdue | How far back |
|---|---|---|
| Tasks pages (Overdue view, counts) | Any open task due before today | Unlimited |
| Calendar, tasks | Same tasks, but only inside the overdue window | `overdueDays` (default 30) |
| Calendar, events | Only events marked "keep until done" and not done, once over | Same window |
| Calendar, Finance bills | Unhandled scheduled items | Same window |
| Scheduled page, sidebar badge, Home alert | All unhandled scheduled items from the rule's start, plus 7 days ahead | Unlimited |
So a bill 45 days late is counted in Ledger and gone from the Calendar; a task 45 days late is in Tasks and gone from the Calendar. A Today screen has to pick one rule (or show "older than N days" separately).

---

## 3. Global quick-add

- **Today it is not global (read).** The `Add` menu, the round phone button and the search palette live in the Ledger `Shell` (`src/shell/Shell.tsx`, `QuickAdd.tsx`, `SearchDialog.tsx`). The Calendar and Tasks modules render only a backup reminder and their page; they have no search, no quick-add and no Ctrl+K.
- **Ledger quick-add:** menu of four items (add a transaction, log a trade, add a scheduled item, new paycheck scenario). "Add a transaction" opens `QuickTxn`: payee (suggestions from history), amount (math allowed), in/out, category suggested from your rules and history, primary account first, date, "Save and add another", full form one click away. Anything can open it by dispatching the `ledger:add-transaction` window event. The round phone button is portaled to `document.body` (a past fix so it stops being nudged by the sticky header); I did not re-check how it sits over Calendar or Tasks content, because those modules do not show it.
- **Tasks quick-add:** `parseQuickAdd` (pure, tested) reads date words, `at 3pm`, `!priority`, `#tag`, `@list`, `every ...`, number words; the bar always shows a "Will add" preview and a "Use as plain title" switch. Opened from anywhere through `createTaskFrom` / `requestTask`.
- **Events:** no quick-add. The event form is only inside the Calendar page; there is no shorthand parser for events and no bridge like `requestTask`.
- **Routing one input to the right module, what exists:** signals available today are the Tasks tokens (`!`, `#`, `@`, `every`, date words, a time of day), an amount in the text (`parseAmountMath`), and a known payee (`recentPayees`, `suggestCategory`). Nothing combines them; there is no "is this a task, an event or a transaction" step.
- **What it would take:** (1) a quick-add shell that is mounted for all modules (outside Ledger's `Shell`, e.g. next to `ModuleBar`); (2) a small registry hook so each module declares what it can create and a "can you parse this" function returning a preview (`contributes.quickAdd`); (3) an event parser or event bridge; (4) a rule that is visible rather than guessed: an explicit chooser or prefix, with the same "Will add ..." preview the task bar already has. Auto-guessing between task and transaction is the part most likely to surprise you.

---

## 4. Global search

- **What exists (read):** `SearchDialog` (Ledger shell only; Ctrl+K or `/`) over `searchAll` in `src/lib/search.ts`: Ledger **pages** (`ALL_ITEMS` from Ledger's nav only), accounts, investment accounts, holdings, loans, paycheck scenarios, and **transactions** (payee, memo, or the amount as typed; 6 shown plus "See all N" to the Transactions page). Plus five actions. Tasks has its own text filter (title, notes, checklist items). Transactions has a `?q=` filter. **Calendar has no text search.**
- **How and cost:** on open, one live query reads seven whole tables (all transactions included) into memory; matching is a linear scan on every keystroke; it re-reads while open whenever those tables change. No index. Fine for thousands of rows on a desktop; **not measured on a phone or at realistic volumes**. With tasks, events and contacts added it is still a scan; I would not add an index until a measurement says so.
- **Not searchable today:** scheduled items (by name), calendar events, tasks, contacts, tags, categories, budgets and goals, payee rules, RSU grants, attachments and notes, property, Calendar and Tasks pages themselves (the page list is Ledger's only). Event and task text lives inside `moduleRecords.data` (JSON), so it can only be scanned in memory, not by a database index.
- **A small bug to know about (read, not run):** in `SearchDialog.tsx` the action filter splits the query with `split(/s+/)`, which splits on the letter "s" instead of whitespace (it should be `\s+`). Effect is mostly lenient (words get cut into fragments that still match as substrings), but multi-word action queries can match oddly.
- **Actions list** has no "Add task" or "Add event".

---

## 5. Shell, navigation and layout

- **How the app opens:** `App.tsx` registers modules (Ledger, Calendar, Tasks, in that order) and routes `/<module>/*`. `/` (and any unknown address) goes through `Fallback` / `legacyTarget` to the **last module used** (`localStorage` key `ledger-last-module`; default = first registered = Ledger). `ModuleBar` is the one global strip (module switcher, sync status, Settings); `/settings/*` is outside any module.
- **Each module draws its own frame.** Only Ledger has the full `Shell` (sidebar, bottom tab bar on phones, breadcrumbs, search, quick add, theme toggle). Calendar and Tasks are one page each inside `shell-main`.
- **Where Today would sit:** a new `ModuleDef` with its own `Component` would appear in the switcher automatically (it lists `allModules()`), and `/today` would route like the others. Two things need changing: the default landing (today `/` opens the last module, not a chosen one) and `legacyTarget`, which ignores a module whose only route is `/`. Ledger's own `Home` (`/ledger`) is a customizable card page (12 cards, order and width saved per device in `localStorage` key `ledger.home.layout.v1`, not synced) and would overlap a Today screen: decide whether Today replaces it, wraps it, or links to it. Ledger's nav also labels Home with the keyword "today".
- **Design system:** shared and in good shape. `src/ui/tokens.css` (type scale, spacing, two radii, shadows, control height, derived colors) on top of palette variables (`styles.css`, `palette.ts`, saved themes); shared components in `src/ui/components.tsx` (`PageHeader`, `EmptyState`, `Stat`, `Banner`, `Sparkline`, `useEdgeFade`), `src/ui/charts.tsx`, `Toast`, and `shell/Modal`. Calendar and Tasks add their own class families (`cal-*`, `tk-*`) on the same tokens; `tasks.css` leans on `calendar.css` (the Tasks module imports it).
- **What a dashboard card should look like across modules:** the card look (`.card`, `.card-head` with a title and one link, `.home-grid`, `.hc` half/full width, `.kv`, `.list-row`, `.alerts`) is already in `styles.css`, so every Today card can be the same frame. The consistent part is the **row**, and the pieces already exist: a derived item (`DerivedItem`) carries title, date/time, priority, a "source" button and optional actions; the Calendar's `AgendaRow` and `PriorityMark` already draw a layer-colour bar, a priority shape (▲ ◆ ▽ ○, so colour is never the only signal), the title and a time or "all day"; Tasks has the round check button (`tk-check`). One shared Today row = colour bar + priority mark + title + time + (check button when the item has `actions.complete`, otherwise an "Edit in <module>" link). Overdue and "soon" flags already exist as small text badges. The card list on Ledger Home is an inline object inside `HomePage.tsx`, not a component contract, so reusing Home's cards means extracting them first; a registry-driven card hook (section 2) is the cleaner base. Home's edit mode (reorder, width, remove, reset to default) is a reusable pattern.

### Phone vs. desktop (read; browser checks were done in earlier phases, listed below)
- **Breakpoints:** 900 px is the big one (below it: bottom tab bar, section tabs under the top bar, one-column Home, the round quick-add button; at or above it: left sidebar, two-column Home, "Add" button in the top bar). 640 px is the second (tighter pages, table-to-card tweaks). 600 px shows breadcrumbs. Touch devices (`pointer: coarse`) get 44 px controls; the viewport allows the iPhone safe areas.
- **Ledger:** full shell at both sizes (sidebar or tab bar, search, quick add). The Home card width control is hidden below 900 px.
- **Calendar:** a 640 px rule set: month cells show dots instead of chips, the time grid compresses, forms go one column; no bottom tab bar, no sidebar, the global `ModuleBar` is the only chrome.
- **Tasks:** a 640 px rule set (controls wrap, bulk bar shrinks); same chrome as Calendar.
- **Verified in earlier phases (ran, 375 px, invented data):** Ledger Home and most pages, Calendar views, the Tasks page, and the Part C forms: no sideways scroll. **Not verified:** the 641 to 899 px range (a tablet or a landscape phone), a real iPhone, and anything involving a persistent button over Calendar or Tasks pages (see below).
- **Implication for Today:** Calendar and Tasks have no tab bar, and Ledger's round "+" button and toasts are positioned for Ledger's tab bar (about 72 to 76 px above the bottom edge). A Today screen and a global quick-add button need one shared bottom-bar decision for all modules, or the button will float in the wrong place in two of the three.

---

## 6. Sync, backup and settings touchpoints

### What a dashboard would need to persist, and where each kind can live (read)
| What | Natural home | Syncs? | In a backup file? |
|---|---|---|---|
| Card order, widths, hidden cards (like Ledger Home) | `localStorage`, like Home's `ledger.home.layout.v1` | **No** (per device) | **Yes**, but only if its key is added to `PREFERENCE_KEYS` in `backupFile.ts` (Home's key is there; Calendar's and Tasks' remembered view, hidden layers and the last module are not) |
| Same, but shared across devices | one row in the `settings` table (the way `calendarSettings` is stored) | **Yes** (sync walks every table except the price key) | **Yes** (settings are in the backup) |
| Dismissed or snoozed alerts and "done for today" ticks | not stored anywhere today: Ledger alerts are recomputed on every load and cannot be dismissed (only the onboarding card has a per-device dismiss) | depends on the choice | depends on the choice |
| Default landing module, Today options (look-ahead days, overdue window, show amounts) | a `settings` row, or extend `calendarSettings` | Yes | Yes |
No database version bump is needed for any of these (the `settings` table and `moduleRecords` already exist and are covered by sync, backup and restore). Layouts differ between a phone and a desktop, which argues for per-device layout and shared options. A dismissed alert needs a stable key (alert id plus the period it applies to) so it comes back when the situation changes; that key scheme does not exist yet.

### Known issues, leftovers and TODOs that touch a dashboard
- **No `TODO` or `FIXME` comments exist in the source** (searched). Open items live in the backlog and in this audit.
- **Forecast alert:** the "$0 cash account" case is unguarded (section 2), so Today would show it too.
- **Overdue rules disagree** across modules (section 2); Today must choose.
- **Search:** the `split(/s+/)` bug in the palette's action filter; search is Ledger-shell-only and does not cover tasks, events or scheduled items.
- **Not reproduced reports:** Calendar showing a done task for a moment; a repeating no-due-date task producing a "today" next task. Both would show up on a Today list if real; I could not find either.
- **Native browser pop-ups:** about 38 `confirm()` calls remain (a blocked pop-up made Scheduled Delete look dead). A Today screen should not add any; the Tasks List box still uses the browser suggestion pop-up.
- **Reminders are in-app only** ("Due soon" is computed while the app is open). Today can show them but cannot alert you; push is a logged decision for later.
- **Sync caveats that matter more once Today edits records:** merges are whole-record, latest edit wins (a task completed on the phone while edited on the desktop produces a "lost tie" copy); clock differences can pick the wrong winner; a brand-new second device was **never** tested for real (the fresh-browser step was skipped in Phase 1; two-device behaviour is covered by tests only).
- **Tax tables need a January update** and a few items are marked UNVERIFIED in `src/data` (not dashboard-related unless Today shows tax dates; the Finance layer already does).
- **Housekeeping:** `dueItems` is unused; `Coming up` and the Calendar overlap; the four untracked planning docs are deliberately not committed.

---

## 7. Recommendation

### Proposed structure (five parts, a stop and checklist after each)
**Part A: Foundations (small and mostly invisible).**
1. A global frame: move search and quick-add out of Ledger's shell so they work in every module, and settle the bottom-bar rule for phones (section 5).
2. New registry hooks, written like the due-provider contract and documented in `docs/due-provider.md`: a Today card or summary hook, a search-source hook (what to index and how to open a hit), and a quick-add hook (what a module can create and a preview of it).
3. Today registered as a module or fixed route with a launch-landing setting.
4. Fix the small known defects that Today would inherit: the `/s+/` regex, the unguarded "$0 account" forecast alert, a date tick across midnight, the Tasks List box pop-up.
Stop: nothing new on screen except the frame and the setting.

**Part B: The Today screen.** One list for today (events, tasks, bills, vests and tax dates through the existing provider, using the shared row from section 5), an overdue block with one rule, a "needs attention" card fed by Ledger's alerts, a small cash outlook (low point only), reminders that are due. Layout, hide and reorder, per device. Phone first, then desktop.
Stop: you live with it for a few days before anything else is built on it.

**Part C: Global search.** The hook from Part A, indexes for tasks, events, scheduled items, contacts and tags added to the existing transaction and account search; results grouped by module; open at the record. Measure before adding any index.
Stop.

**Part D: Global quick-add.** One box with a visible "Will add: ..." preview and an explicit destination (task, event, transaction), reusing the task parser and the transaction form; an event shorthand parser is new. This is last because it carries the most risk of surprising you.
Stop.

**Part E: Verification and tuning.** Measure load on a phone-sized profile with a realistic data volume; midnight and two-device checks; backlog, docs, checklist.

Reasoning for the order: the foundation unlocks everything and has little to review; Today is the real deliverable and should be settled before the two input features use it; search extends something that already works; quick-add is the only part that guesses what you mean, so it benefits from living with Today first.

### The five decisions I need from you before the prompt is written
1. **Is Today the front door, and what happens to Ledger Home?** Options: Today replaces Ledger's Home as the app's launch screen (Ledger Home stays as Ledger's overview page); Today is a new module you open yourself and the app still opens to the last module; or Today wraps Ledger Home's cards. This sets routing, the default setting and how much of Ledger Home's code moves.
2. **One overdue rule.** Show everything overdue however old, or only the last 30 days (matching the Calendar) with an "older items" link, or per module as today. Ledger itself will not change how it treats old items.
3. **What does Today show by default, and are amounts visible?** For example: today's agenda, overdue, bills due in 7 days, needs-attention alerts, cash low point. Decide also whether money figures appear by default on a screen that is the first thing you see on a phone, or sit behind a "show amounts" switch.
4. **How does quick-add choose the destination?** An explicit choice or prefix with a preview (my recommendation), or automatic detection with a preview and a one-tap correction; and which destinations are in (task, event, transaction; scheduled bill?).
5. **Where do layout and dismissals live?** Per device only (like Ledger Home; different phone and desktop layouts), shared across devices (one `settings` row), or layout per device and dismissed alerts shared. This decides whether a dismissed alert on the phone is also dismissed on the desktop.
Smaller choices I can default if you do not mind: whether Today can complete a task in place (I would say yes, it already works from the Calendar) and whether bills can be approved or skipped there (I would say no: money actions stay in Ledger, with an "Edit in Ledger" link).

### What I would keep out of Phase 3
- Push, text or email notifications, and anything for the Apple Watch (logged decision; try calendar alerts first).
- Google Calendar, calendar subscriptions, drag to move, natural-language "AI" parsing.
- Any new Ledger data fields (card due days, subscription cancel-by, birthdays on contacts); those are listed in the backlog for a later Ledger phase.
- Approving, posting or skipping money items from Today, and any change to how Ledger counts or ages scheduled items.
- Rebuilding or restyling Ledger's pages; replacing the other ~38 browser pop-ups across Ledger (a separate hygiene pass).
- A search index or any database change unless Part E measures a real slowdown.
- Removing the unused `dueItems` table, unless you want it as a small clean-up at the very start (it is safe to leave).
- Cross-device sync of layouts (unless decision 5 asks for it) and any analytics.

---

## Things I am unsure about or did not verify
- Anything on a real phone or with realistic data volumes (performance, quick-add overlap, search cost).
- The unguarded "$0 cash account" forecast alert (from code only).
- Whether Home's "Coming up" lists overdue unhandled bills.
- The midnight rollover on Home and on a Today screen.
- That the last push's GitHub Actions run was green.
- The exact wording of the original Phase 2 prompt (worked from the backlog).
- The 641 to 899 px range, a real iPhone, and how a floating button behaves over Calendar and Tasks.
- Whether the backup file really restores the preference keys end to end (I read `collectPreferences` and `applyPreferences` and their test file exists; I did not run a restore).
- My recommended part order and the five decisions are judgment, not facts; the estimates of effort are not given because I have not scoped them.
